// Cliffs — Edge of the Sea.  Built from numbers with ../procgen/: a physically based sky with matching haze, a Gerstner
// ocean with foam at the cliff foot and around the islands, generated PBR rock for the layered cliff face (triplanar, so
// it never stretches) blended into grass and soil on the ledge, faceted sea-stacks and islands, dune-style grass and
// scrub, soft sun shadows near the viewer.  You sit well back on a broad, walled ledge (never a sheer drop at your
// feet).  Three seats, automatic quality tier, afternoon -> golden light.

import { THREE, createWorld, fbm, vnoise, smoothstep, rng, hash, sectionRow, choiceGrid } from '../seated/common.js?v=20261114lie4';
import { pickQuality, createLoader, makeSunRig, aimSun } from '../seated/proc.js?v=20261114x';
import { createBirds } from '../shared/birds.js';
import { makeMaterialMaps, standardMaterial } from '../procgen/textures.js?v=20261114x';
import { QUALITY, createTreeLibrary, createTreeField } from '../procgen/trees.js?v=20261114x';
import { createSplatMaterial, createGrass, createFlowers } from '../procgen/terrain.js?v=20261114x';
import { createRocks } from '../procgen/rocks.js?v=20261114x';
import { createSky } from '../procgen/sky.js?v=20261114x';
import { createWater } from '../procgen/water.js?v=20261114x';

const R = rng(7771);
const rr = (a, b) => a + R() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;
const H = 56;                                 // clifftop height above the sea
const AZ = -26;                               // sun azimuth: ahead and to the right

const { Q, name: qName, pref: qPref0, isCoarse, setQuality } = pickQuality(QUALITY);
let qPref = qPref0;
const DETAIL = { high: { grass: 6000, flowers: 320, pebbles: 120, shrubs: 80, rocks: 16, water: 128, cols: 1 }, medium: { grass: 3000, flowers: 180, pebbles: 70, shrubs: 50, rocks: 10, water: 80, cols: 1 }, light: { grass: 1400, flowers: 90, pebbles: 40, shrubs: 30, rocks: 6, water: 56, cols: 1 } }[qName];

let timeMode = 'auto', pCur = 0, curSeat = 'ledge', switchTo = () => {};
const W = await createWorld({
  lie: { story: 'sky', ceiling: 70, step: 8, clouds: true },
  eye: 1.15, bg: 0xe8dfcf, title: 'Cliffs — Edge of the Sea', startPitch: -0.08, startYaw: 0, loading: true,
  hint: isCoarse ? 'Drag to look around · Menu → Viewpoint to change ledge' : 'Drag to look around · keys 1–3 or Menu → Viewpoint to change ledge',
  rows: [sectionRow('Viewpoint'), ...choiceGrid([['Centre ledge', 'ledge'], ['West ledge', 'west'], ['East ledge', 'east']], () => curSeat, (id) => switchTo(id), 3),
    sectionRow('Light'), ...choiceGrid([['Auto', 'auto'], ['Afternoon', 'a'], ['Golden', 'b']], () => timeMode, (v) => { timeMode = v; }, 3),
    sectionRow('Quality'), ...choiceGrid([['Auto', 'auto'], ['High', 'high'], ['Medium', 'medium'], ['Light', 'light']], () => qPref, (v) => { qPref = v; setQuality(v, W); }, 4)],
  tone: { exposure: 1.0, bloom: 0.28, radius: 0.6, threshold: 0.97 },
});
const { scene, renderer } = W;
const loader = createLoader(16, 'Carving the coast'); const tick = loader.tick;

// ---------------- sky, light ----------------
await tick('sky');
scene.fog = new THREE.FogExp2(0xdfe0d6, 0.00052);
const sky = createSky({ renderer, scene, sun: { elevation: 32, azimuth: AZ }, turbidity: 2.8, rayleigh: 1.5, mie: 0.005, mieG: 0.85, clouds: { cover: 0.5, scale: 1.0, wind: [0.0035, 0.001] }, seed: 7 });
scene.environment = sky.env; scene.fog.color.copy(sky.haze);
const sun = makeSunRig({ scene, renderer, Q, extent: 55 });

// ---------------- coastline ----------------
const cz0 = (x) => -1.4 + 0.0016 * x * x + 5 * Math.sin(x * 0.045 + 1.3) + 3 * Math.sin(x * 0.11 + 4.1) + 2 * Math.sin(x * 0.23);
const C0 = cz0(0);
const SEAT_S = 22;      // the seat is 22 m back from the lip, on a broad grassy ledge that slopes gently down to a low wall
const RAMP = 8;         // metres the ledge falls between the seat and the wall
const coastZ = (x) => cz0(x) - C0 - SEAT_S;
const baseZ = (x) => coastZ(x) - 7.5;
const topH = (x, z, s) => H - RAMP * (1 - smoothstep(0, SEAT_S, s)) + 2.4 * (fbm(x * 0.012 + 3, z * 0.012 + 8) - 0.5) + 0.05 * Math.min(Math.max(s, 0), 480) * smoothstep(5, 120, s) + (fbm(x * 0.09, z * 0.09) - 0.5) * 0.5;
const groundH = (x, z) => { const s = z - coastZ(x); return s >= 0 ? topH(x, z, s) : Math.max(0, H * (1 - Math.min(1, -s / 9))); };   // for scatter placement on the land side
const hfn = { height: groundH };
const seatY = topH(0, 0, -coastZ(0));

// ---------------- generated materials ----------------
const maps = {};
for (const k of ['litter', 'grass', 'soil', 'rock']) { await tick(k + ' map'); maps[k] = await makeMaterialMaps(k, { size: Q.tex, seed: k.length + 2 }); }

// ---------------- cliff + land (one ribbon per column; PBR rock face, grass top) ----------------
{
  const xs = [0]; { let x = 0, d = 2.6; for (let i = 0; i < 70; i++) { x += d; d *= 1.045; xs.push(x); } }
  const cols = []; for (let i = xs.length - 1; i >= 1; i--) cols.push(-xs[i]); for (const x of xs) cols.push(x);
  const landS = [1800, 1150, 760, 500, 330, 215, 140, 90, 60, 42, 30, 22, 17, 12, 8, 5, 3, 1.5, 0.6, 0];
  const NQ = 44, NL = landS.length, per = NL + NQ + 1;
  const pos = [], mix = [], tint = [], uvs = [], idx = [];
  const stratTint = [[1.05, 0.98, 0.9], [0.9, 0.9, 0.92], [1.12, 1.02, 0.9], [0.95, 0.93, 0.88], [1.0, 0.9, 0.82]];
  for (let ci = 0; ci < cols.length; ci++) {
    const x = cols[ci], zc = coastZ(x);
    for (let l = 0; l < NL; l++) {
      const s = landS[l], z = zc + s, y = topH(x, z, s), n = fbm(x * 0.05, z * 0.05);
      pos.push(x, y, z); uvs.push(x * 0.25, z * 0.25);
      const edge = 1 - smoothstep(0, 14, s);
      mix.push(0.1 + 0.2 * n, 0.85 - 0.3 * edge, 0.04 + 0.35 * edge, edge * 0.2); const v = 0.85 + 0.3 * n; tint.push(v, v, v * 0.92);
    }
    const y0 = topH(x, zc, 0);
    for (let q = 1; q <= NQ; q++) {
      const t = q / NQ, n1 = vnoise(x * 0.07, t * 3.0);
      const dz = 1.2 * t + 6.3 * Math.pow(t, 5) + 1.1 * (((t * 8 + n1 * 1.6) % 1) - 0.5) * Math.pow(Math.sin(Math.PI * t), 0.7) + 2.4 * (vnoise(x * 0.11 + 5, t * 5) - 0.5) * Math.sin(Math.PI * t);
      pos.push(x, y0 * (1 - t), zc - dz); uvs.push((x + zc - dz) * 0.2, y0 * (1 - t) * 0.2);
      const grassCap = 1 - smoothstep(0, 0.08, t), layer = Math.floor(t * 8 + n1 * 1.5), st = stratTint[Math.floor(hash(layer, 3.3) * 5) % 5], dark = smoothstep(0.88, 1, t);
      mix.push(0.02, 0.02 + 0.8 * grassCap, 0.05 + 0.1 * grassCap, 0.9 - 0.85 * grassCap);
      const vv = (0.85 + 0.3 * vnoise(x * 0.3, t * 14)) * (1 - 0.45 * dark); tint.push(st[0] * vv, st[1] * vv, st[2] * vv);
    }
    pos.push(x, -5, zc - 9); mix.push(0, 0, 0.2, 0.8); tint.push(0.2, 0.2, 0.2); uvs.push(0, 0);
  }
  for (let ci = 0; ci < cols.length - 1; ci++) for (let r = 0; r < per - 1; r++) { const a = ci * per + r, b = (ci + 1) * per + r; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('aMix', new THREE.Float32BufferAttribute(mix, 4)); geo.setAttribute('color', new THREE.Float32BufferAttribute(tint, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const { material } = createSplatMaterial({ maps, tile: [0.3, 0.26, 0.28, 0.16], normalFrom: maps.grass }); material.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, material); mesh.receiveShadow = true; mesh.frustumCulled = false; scene.add(mesh);
}
const rockMat = standardMaterial(maps.rock, { vertexColors: true, roughness: 1, color: 0x9d968a });

// ---------------- stone wall along the lip + stone seat ----------------
await tick('wall');
{
  const wallMat = standardMaterial(maps.rock, { roughness: 1, color: 0xd6cfc2 }), step = 2.1, xs = []; for (let x = -200; x <= 200; x += step) xs.push(x);
  const wall = new THREE.InstancedMesh(new THREE.BoxGeometry(2.3, 1.1, 0.7), wallMat, xs.length), d = new THREE.Object3D(), tints = [0xc9c2b4, 0xd8d1c4, 0xb9b3a7, 0xe0d9cb].map(h => new THREE.Color(h));
  xs.forEach((x, i) => { const z = coastZ(x) + 0.9, z2 = coastZ(x + step) + 0.9; d.position.set(x + step / 2, topH(x, z, 0.9) + 0.4, (z + z2) / 2); d.rotation.set(0, -Math.atan2(z2 - z, step), 0); d.scale.set(1.02, rr(0.92, 1.12), rr(0.95, 1.25)); d.updateMatrix(); wall.setMatrixAt(i, d.matrix); wall.setColorAt(i, tints[i % 4]); });
  wall.castShadow = !!Q.shadowMap; wall.receiveShadow = true; scene.add(wall);
  window.__slab = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.3, 28), standardMaterial(maps.rock, { roughness: 1, color: 0xe2dccf })); window.__slab.receiveShadow = true; scene.add(window.__slab);
}
const slab = window.__slab; delete window.__slab;

// ---------------- islands, sea-stacks, far headlands (faceted PBR rock, mossy tops) ----------------
await tick('islands');
const variants = [{ seed: 21, detail: 4, flatten: 0.5, facets: 15, rough: 0.55, moss: 1.0, texScale: 8 }, { seed: 22, detail: 4, flatten: 1.0, facets: 9, moss: 0.35, texScale: 3 }, { seed: 23, detail: 4, flatten: 0.7, facets: 14, rough: 0.55, moss: 0.9, texScale: 9 }, { seed: 24, detail: 3, flatten: 0.8, facets: 6, texScale: 0.5, moss: 0.4 }];
// Islands and sea stacks are real landforms: a polar mesh whose radius wobbles, with a steep stratified cliff face that rises straight out of the water
// (base 8 m below the surface, so the sea meets it with foam) and a grassy top. [x, z, radius, height, profile start (small = spire, large = flat-topped island)]
const ISL = [
  [-70, -185, 8, 30, 0.38], [95, -215, 9, 36, 0.4], [-170, -255, 11, 42, 0.36],
  [205, -290, 46, 30, 0.8], [-250, -370, 62, 38, 0.78], [-175, -470, 44, 32, 0.8], [130, -560, 90, 44, 0.76],
  [560, -950, 240, 60, 0.74], [-700, -1150, 290, 75, 0.74], [-80, -1500, 380, 92, 0.74],
];
const islWob = (i, th) => 1 + 0.3 * (fbm(Math.cos(th) * 1.4 + i * 7.3, Math.sin(th) * 1.4 + i * 3.1) - 0.5) * 2;
function islY(i, e, x, z) {
  const [, , R, H, st] = ISL[i];
  if (e >= 1) return -8 * smoothstep(1.0, 1.12, e);
  let f = Math.pow(1 - smoothstep(st, 1.0, e), 0.62);
  const stair = Math.floor(f * 7) / 7 + smoothstep(0, 1, f * 7 - Math.floor(f * 7)) / 7; f = f * 0.5 + stair * 0.5;
  const apex = 1 + (st > 0.6 ? 0.42 : 0.1) * Math.pow(1 - Math.min(e / st, 1), 1.4); return H * f * apex * (0.86 + 0.26 * fbm(x * 0.9 / R * 4 + i, z * 0.9 / R * 4)) + (f > 0.98 ? 0.6 * fbm(x * 0.12, z * 0.12) : 0);
}
const islSurf = (i, x, z) => { const [cx, cz, R] = ISL[i], dx = x - cx, dz = z - cz, th = Math.atan2(dz, dx); return islY(i, Math.hypot(dx, dz) / (R * islWob(i, th)), x, z); };
const rockDepth = (x, z) => { let d = 99; for (let i = 0; i < ISL.length; i++) { const [cx, cz, R] = ISL[i]; const dx = x - cx, dz = z - cz; if (Math.abs(dx) > R * 1.7 || Math.abs(dz) > R * 1.7) continue; const e = Math.hypot(dx, dz) / (R * islWob(i, Math.atan2(dz, dx))); d = Math.min(d, e < 1 ? 0 : (e - 1) * R * 0.5); } for (const [rx, rz, s] of FOOT) { if (Math.abs(x - rx) > 14) continue; d = Math.min(d, (Math.hypot(x - rx, z - rz) - s * 1.35) * 0.4); } return Math.max(0, d); };
function buildIsland(i) {
  const [cx, cz, R] = ISL[i], K = 112, ES = [0, 0.22, 0.4, 0.55, 0.66, 0.74, 0.8, 0.85, 0.89, 0.92, 0.945, 0.965, 0.98, 0.992, 1.0, 1.02, 1.045, 1.075, 1.11, 1.16], NE = ES.length;
  const pos = [], mix = [], tint = [], uvs = [], idx = [];
  const strat = [[1.05, 0.98, 0.9], [0.88, 0.88, 0.9], [1.1, 1.0, 0.88], [0.94, 0.92, 0.86], [1.0, 0.9, 0.82]];
  for (let r = 0; r < NE; r++) for (let k = 0; k < K; k++) {
    const th = (k / K) * 6.2832, w = islWob(i, th), x = cx + Math.cos(th) * ES[r] * R * w, z = cz + Math.sin(th) * ES[r] * R * w, y = islY(i, ES[r], x, z);
    pos.push(x, y, z); uvs.push(x * 0.2, z * 0.2); const band = Math.floor(Math.max(0, y) / 2.6 + vnoise(x * 0.05, z * 0.05) * 1.5), st = strat[Math.floor(hash(band, 3.3 + i) * 5) % 5], v = 0.85 + 0.3 * vnoise(x * 0.3, y * 0.9);
    tint.push(st[0] * v, st[1] * v, st[2] * v); mix.push(0, 0, 0, 1);
  }
  for (let r = 0; r < NE - 1; r++) for (let k = 0; k < K; k++) { const a = r * K + k, b = r * K + (k + 1) % K, c = (r + 1) * K + k, d = (r + 1) * K + (k + 1) % K; idx.push(a, c, b, b, c, d); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(idx); geo.computeVertexNormals();
  if (geo.attributes.normal.getY(0) < 0) { for (let q = 0; q < idx.length; q += 3) { const t = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = t; } geo.setIndex(idx); geo.computeVertexNormals(); }
  const nrm = geo.attributes.normal; for (let q = 0; q < nrm.count; q++) { const y = pos[q * 3 + 1], gr = smoothstep(0.78, 0.93, nrm.getY(q)) * smoothstep(0.3, 1.5, y); mix[q * 4 + 1] = gr; mix[q * 4 + 2] = gr * 0.12; mix[q * 4 + 3] = 1 - gr; if (gr > 0.5) { tint[q * 3] *= 0.9; tint[q * 3 + 1] *= 1.0; tint[q * 3 + 2] *= 0.85; } if (y < 0.6) { const dk = 0.55 + 0.45 * smoothstep(-3, 0.6, y); tint[q * 3] *= dk; tint[q * 3 + 1] *= dk; tint[q * 3 + 2] *= dk; } }
  geo.setAttribute('aMix', new THREE.Float32BufferAttribute(mix, 4)); geo.setAttribute('color', new THREE.Float32BufferAttribute(tint, 3)); geo.computeBoundingSphere();
  return geo;
}
{
  const { material } = createSplatMaterial({ maps, tile: [0.3, 0.26, 0.28, 0.12], normalFrom: maps.grass }); material.side = THREE.DoubleSide;
  for (let i = 0; i < ISL.length; i++) { const m = new THREE.Mesh(buildIsland(i), material); m.frustumCulled = false; m.receiveShadow = true; scene.add(m); }
}
const FOOT = []; for (let i = 0; i < 150; i++) { const x = (R() - 0.5) * 2 * (40 + Math.pow(R(), 2) * 320), z = baseZ(x) - rr(0, 7); FOOT.push([x, z, rr(0.9, 3.4)]); }
// rocks at the foot of the cliff and around the seats: sunk to their widest girth so the waterline cuts them (no hovering belly)
scene.add(createRocks({ items: FOOT.map(([x, z, s]) => ({ x, y: -s * 0.85, z, s, yaw: R() * 6.28, variant: 3 })), variants, material: rockMat }));
// lighthouse on the far-left headland
let lamp;
{
  const g = new THREE.Group(), white = new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.7 }), red = new THREE.MeshStandardMaterial({ color: 0xb5342a, roughness: 0.7 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.4, 22, 14), white); tower.position.y = 11; g.add(tower);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.86, 2.0, 5, 14), red); band.position.y = 11; g.add(band);
  const gal = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.0, 0.9, 14), new THREE.MeshStandardMaterial({ color: 0x2a2f36 })); gal.position.y = 22.4; g.add(gal);
  lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 12), new THREE.MeshBasicMaterial({ color: 0xffe8a8, fog: false })); lamp.position.y = 24; g.add(lamp);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.2, 12), red); roof.position.y = 26.2; g.add(roof);
  g.position.set(-175 + 6, islSurf(5, -175 + 6, -470 + 4) - 0.3, -470 + 4); scene.add(g);
}

// ---------------- ocean ----------------
await tick('ocean');
const WAVES = [{ dir: [0.12, 1], steep: 0.08, len: 120 }, { dir: [-0.35, 1], steep: 0.06, len: 64 }, { dir: [0.55, 0.85], steep: 0.045, len: 29 }, { dir: [-0.7, 0.7], steep: 0.035, len: 13 }];
const coastDepth = (x, z) => Math.max(0, (baseZ(x) - z) * 0.45);
const nearSea = createWater({ level: 0, bounds: { cx: 0, cz: -230, w: 1600, d: 1300 }, segments: DETAIL.water, depthFn: (x, z) => Math.min(coastDepth(x, z), rockDepth(x, z) + 0.02), maxDepth: 8, depthRes: 384, waves: WAVES, calm: 0.7, foam: 0.9, colors: { shallow: 0x3a9aa4, deep: 0x0a3a52 } });
const farSea = createWater({ level: -0.06, bounds: { cx: 0, cz: -2600, w: 6500, d: 4400 }, segments: 96, waves: WAVES, calm: 0.7, foam: 0.4, colors: { shallow: 0x3a9aa4, deep: 0x0a3a52 } });
scene.add(farSea.mesh, nearSea.mesh);

// ---------------- grass, scrub, boulders around the seats ----------------
await tick('grass and scrub');
const lib = await createTreeLibrary({ renderer, scene, quality: Q, species: ['shrub'], sun: null, env: null, tick, seed: 5 });
const SEATS = [['ledge', 0], ['west', -95], ['east', 95]].map(([id, x]) => { const z = coastZ(x) + SEAT_S, slope = (coastZ(x + 1) - coastZ(x - 1)) / 2; return { id, x, z, y: topH(x, z, SEAT_S), yaw: Math.atan2(-slope, 1) }; });
const shrubs = [];
for (const v of SEATS) for (let i = 0; i < DETAIL.shrubs; i++) {
  const a = R() * 6.283, r = rr(14, 55), x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r, s = z - coastZ(x); if (s < 12 || Math.hypot(x - v.x, z - v.z) < 12) continue;
  shrubs.push({ x, y: topH(x, z, s) - 0.05, z, s: rr(0.9, 2.2), yaw: R() * 6.28, species: 'shrub', variant: Math.floor(R() * Q.variants), tint: [rr(0.9, 1.1), rr(0.9, 1.05), rr(0.75, 0.95)] });
}
const field = createTreeField(lib, shrubs, scene); field.setShadows(!!Q.shadowMap);
const grass = createGrass({ hf: { height: (x, z) => topH(x, z, z - coastZ(x)) }, count: DETAIL.grass, radius: 26, height: [0.18, 0.5], seed: 5, tuft: 6, width: 0.02, spread: 0.12, clump: 0.5, falloff: 1.9, dry: 0.18, colors: { lo: 0x365a20, mid: 0x6a9040, hi: 0xaebd62 }, windU: lib.wind }); scene.add(grass.mesh);
const flowers = createFlowers({ hf: { height: (x, z) => topH(x, z, z - coastZ(x)) }, count: DETAIL.flowers, radius: 18, seed: 8, windU: lib.wind, colors: [0xe58fb0, 0xf4f2ea, 0xf2d24a, 0xb9a0e6], height: [0.14, 0.3], size: 0.09 }); scene.add(flowers.mesh);
const PEB = [0, 1, 2].map(i => ({ seed: 61 + i, detail: 2, flatten: 0.5 + 0.12 * i, facets: 5, rough: 0.08, texScale: 7, moss: 0.2 }));
const pebMat = standardMaterial(maps.rock, { vertexColors: true, roughness: 1, color: 0xd9cdb8 });
const boulders = new THREE.Group(); scene.add(boulders);
function layoutBoulders(v) {
  boulders.clear(); const items = [];
  for (let i = 0; i < DETAIL.rocks; i++) { const a = R() * 6.283, r = rr(12, 60), x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r, s = z - coastZ(x); if (s < 12) continue; items.push({ x, y: topH(x, z, s) - 0.05, z, s: rr(0.5, 1.8), yaw: R() * 6.28, variant: 3 }); }
  boulders.add(createRocks({ items, variants, material: rockMat, castShadow: !!Q.shadowMap }));
  const pi = []; for (let i = 0; i < DETAIL.pebbles * 4 && pi.length < DETAIL.pebbles; i++) { const a = R() * 6.283, r = 0.8 + Math.pow(R(), 1.6) * 16, x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r, s = z - coastZ(x); if (s < 9 || Math.hypot(x - v.x, z - v.z) < 2.6) continue; pi.push({ x, y: topH(x, z, s) - 0.012, z, s: 0.03 + Math.pow(R(), 2.2) * 0.14, yaw: R() * 6.28, variant: pi.length % 3 }); }
  boulders.add(createRocks({ items: pi, variants: PEB, material: pebMat }));
}
await tick('gulls');

// ---------------- seabirds: loose flocks on long lazy arcs (shared calm-bird module) ----------------
const birds = createBirds({ parent: scene, color: 0xf4f4ef, wingColor: 0xcfd4da, tipColor: 0x3a3d44, seed: 5, flocks: [
  { n: 4, cx: 15, cz: -62, ra: 55, rb: 22, y: seatY - 2, yv: 3, period: 67, size: 2.0 },
  { n: 3, cx: -45, cz: -100, ra: 75, rb: 28, y: seatY + 3, yv: 3, period: 73, size: 2.1 },
  { n: 2, cx: 25, cz: -78, ra: 60, rb: 22, y: seatY - 6, yv: 3, period: 66, size: 1.9 },
  { n: 1, cx: -10, cz: -110, ra: 95, rb: 30, y: seatY - 8, yv: 4, period: 71, size: 3.0 },   // a big soaring bird
] });
W.detailFns.push((f) => { birds.group.visible = f > 0.3; });


// ---------------- time of day: afternoon -> golden (~8 min), or pinned from the menu ----------------
let lastEl = 99;
function applyTime(p, force) {
  const el = lerp(32, 7, p);
  if (force || Math.abs(el - lastEl) > 0.5) { lastEl = el; sky.setSun(el, AZ); scene.environment = sky.env; scene.fog.color.copy(sky.haze); aimSun(sun, sky, W.rig.position.x, W.rig.position.y, W.rig.position.z); }
  sun.color.copy(sky.sunColor); sun.intensity = sky.sunIntensity; scene.environmentIntensity = lerp(1.05, 0.8, p);
}
applyTime(0, true);
W.detailFns.push((f) => { grass.thin(f); birds.group.visible = f > 0.3; });
W.onFrame((dt, t) => {
  const target = timeMode === 'auto' ? 0.5 - 0.5 * Math.cos(t * 0.0125) : timeMode === 'a' ? 0 : 1;
  pCur += (target - pCur) * Math.min(1, dt * 0.7); applyTime(pCur * 0.92, false);
  sky.update(t, W.rig.position); nearSea.update(t); farSea.update(t); lib.update(t);
  lamp.material.color.setRGB(1.3, 1.15, 0.7).multiplyScalar(0.85 + 0.15 * Math.sin(t * 0.35) + 0.3 * pCur);
  birds.update(t);
});

// ---------------- audio ----------------
W.buildAudio = (A) => {
  const { ctx, master } = A;
  const rv = A.reverb(2.2, 2.4), wet = A.gain(0.5); rv.connect(wet); wet.connect(master);
  // wind: broad, with slow gusts that also sweep the filter
  const wind = A.noise('pink'), wbp = A.filter('bandpass', 520, 0.5), wg = A.gain(0.10);
  A.chain(wind, wbp, wg, master); A.lfo(wg.gain, 0.045, 0.05); A.lfo(wg.gain, 0.11, 0.025); A.lfo(wbp.frequency, 0.06, 220);
  const hi = A.noise('white'), hbp = A.filter('bandpass', 2400, 0.7), hg = A.gain(0.012);
  A.chain(hi, A.filter('highpass', 1800), hbp, hg, master); A.lfo(hg.gain, 0.09, 0.008); A.lfo(hbp.frequency, 0.05, 700);
  // grass hiss at the feet
  const gr = A.noise('white'), gg = A.gain(0.006); A.chain(gr, A.filter('highpass', 5000), gg, master); A.lfo(gg.gain, 0.14, 0.004);
  // ocean bed rumble
  const bed = A.noise('brown'), bg = A.gain(0.07); A.chain(bed, A.filter('lowpass', 220), bg, master); A.lfo(bg.gain, 0.07, 0.03);
  // surf: a swell arrives, booms against the cliff, hisses back
  A.every(() => {
    const t0 = ctx.currentTime, pan = (Math.random() - 0.5) * 1.2, amp = 0.6 + Math.random() * 0.7;
    const n = A.noise('pink'), lp = A.filter('lowpass', 300, 0.7), g = A.gain(0.0001), p = A.pan(pan);
    A.chain(n, lp, g, p, master); p.connect(rv);
    lp.frequency.setValueAtTime(280, t0); lp.frequency.linearRampToValueAtTime(1100, t0 + 2.8); lp.frequency.exponentialRampToValueAtTime(260, t0 + 8);
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.11 * amp, t0 + 3.4); g.gain.exponentialRampToValueAtTime(0.0008, t0 + 9);
    setTimeout(() => { try { n.stop(); } catch (e) {} }, 9000);
    const h = A.noise('white'), hb = A.filter('bandpass', 3000, 0.8), hg2 = A.gain(0.0001); A.chain(h, hb, hg2, p);
    hg2.gain.setValueAtTime(0.0001, t0 + 2.4); hg2.gain.linearRampToValueAtTime(0.03 * amp, t0 + 3.0); hg2.gain.exponentialRampToValueAtTime(0.0005, t0 + 8);
    setTimeout(() => { try { h.stop(); } catch (e) {} }, 9000);
    A.blip({ f: [[0, 62], [1.2, 38]], dur: 1.4, type: 'sine', vol: 0.06 * amp, attack: 0.05, at: 2.7, pan: pan * 0.5 });
  }, 7, 11, 0.3);
  // gulls
  const bus = (pan) => { const pn = A.pan(pan), lp = A.filter('lowpass', 5200), d = A.gain(0.6), s = A.gain(0.5); A.chain(pn, lp); lp.connect(d); d.connect(master); lp.connect(s); s.connect(rv); return pn; };
  A.every(() => {
    const dest = bus((Math.random() - 0.5) * 1.8), base = 1500 + Math.random() * 500, near = 0.5 + Math.random() * 0.6, n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) A.blip({ f: [[0, base], [0.09, base * 1.55], [0.32 - i * 0.02, base * 1.0]], dur: 0.38, vol: 0.035 * near, attack: 0.03, type: 'triangle', dest, at: i * 0.42, vib: 70, vibRate: 55 });
  }, 8, 20, 3);
  A.every(() => {   // short mewing calls
    const dest = bus((Math.random() - 0.5) * 1.6), base = 1900 + Math.random() * 400;
    for (let i = 0; i < 3; i++) A.blip({ f: [[0, base * 0.9], [0.1, base * 1.2], [0.2, base]], dur: 0.22, vol: 0.022, attack: 0.02, type: 'triangle', dest, at: i * 0.26, vib: 50, vibRate: 40 });
  }, 14, 30, 8);
};


// ---------------- viewpoints: three seats on the same broad walled ledge, each facing the sea; switching always goes through black ----------------
try { const sv = localStorage.getItem('oortia-cliffs-vp'); if (SEATS.some(v => v.id === sv)) curSeat = sv; } catch (e) { /* ignore */ }
function applySeat(id) {
  const v = SEATS.find(q => q.id === id) || SEATS[0]; curSeat = v.id;
  W.setSeat({ x: v.x, y: v.y, z: v.z, yaw: v.yaw, pitch: -0.08 });
  slab.position.set(v.x, v.y - 0.12, v.z); aimSun(sun, sky, v.x, v.y, v.z);
  grass.layout(v.x, v.z, { exclude: (x, z) => z - coastZ(x) < 9 || Math.hypot(x - v.x, z - v.z) < 2.6 }); flowers.layout(v.x, v.z, { exclude: (x, z) => z - coastZ(x) < 9 || Math.hypot(x - v.x, z - v.z) < 2.6 }); layoutBoulders(v);
  field.layout({ x: v.x, z: v.z, lod0: 50, lod1: 120, far: 140, impostors: false, minDist: 8 });
  try { localStorage.setItem('oortia-cliffs-vp', v.id); } catch (e) { /* ignore */ }
}
switchTo = (id) => { if (id === curSeat) return; if (W.comfort) W.comfort.fade(() => applySeat(id)); else applySeat(id); };
addEventListener('keydown', (e) => { const m = /^Digit([1-9])$/.exec(e.code); if (!m || e.ctrlKey || e.metaKey || e.altKey) return; const v = SEATS[+m[1] - 1]; if (v) switchTo(v.id); });
if (location.hash === '#debug') window.__C = { sky, sun, applySeat, switchTo, nearSea, SEATS };   // dev aid
applySeat(curSeat);
await tick('done'); loader.done(W);
W.start();
