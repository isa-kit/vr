// Beach — Sunset Shore.  Built from numbers with ../procgen/: physically based sunset sky with matching haze, a Gerstner
// sea, PBR sand with a swash that runs up the beach and retreats (foam lace, wet sand, drying tide mark), faceted rock
// headlands, dune grass and scrub.  The sun slowly sinks from golden hour into dusk.  Quality tier is automatic
// (desktop / phone / headset) and switchable in the menu.  Wave sounds are cued to the visible wave clock.

import { THREE, createWorld, fbm, smoothstep, rng, sectionRow, choiceGrid } from '../seated/common.js?v=20261114b';
import { pickQuality, createLoader, makeSunRig, aimSun } from '../seated/proc.js?v=20261114b';
import { createBirds } from '../shared/birds.js';
import { makeMaterialMaps, standardMaterial } from '../procgen/textures.js?v=20261114b';
import { QUALITY, createTreeLibrary, createTreeField } from '../procgen/trees.js?v=20261114b';
import { createGrass, createLogs } from '../procgen/terrain.js?v=20261114b';
import { createRocks } from '../procgen/rocks.js?v=20261114b';
import { createSky } from '../procgen/sky.js?v=20261114b';
import { createWater, createShoreline } from '../procgen/water.js?v=20261114b';

const R = rng(31415);
const rr = (a, b) => a + R() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;
const ZS = -3.0;            // where the sand dips below the still-water line
const PERIOD = 12.0;        // seconds between waves
const SEAT_Z = 7;           // the swash never gets closer than ~7 m
const AZ = -14;             // sun azimuth: a little right of straight ahead

const { Q, name: qName, pref: qPref0, isCoarse, setQuality } = pickQuality(QUALITY);
let qPref = qPref0;
const DETAIL = { high: { sand: [220, 140], water: 128, grass: 5000, shrubs: 170, pebbles: 90 }, medium: { sand: [150, 100], water: 80, grass: 2600, shrubs: 100, pebbles: 50 }, light: { sand: [110, 80], water: 48, grass: 1200, shrubs: 60, pebbles: 28 } }[qName];

let timeMode = 'auto', pCur = 0, curSeat = 'shore', switchTo = () => {};
const W = await createWorld({
  eye: 0.95, bg: 0xf0b88a, title: 'Beach — Sunset Shore', startPitch: -0.07, loading: true,
  hint: isCoarse ? 'Drag to look around · Menu → Viewpoint to change seat' : 'Drag to look around · keys 1–3 or Menu → Viewpoint to change seat',
  rows: [sectionRow('Viewpoint'), ...choiceGrid([['Shore', 'shore'], ['Dune top', 'dune'], ['Along the beach', 'along']], () => curSeat, (id) => switchTo(id), 3),
    sectionRow('Light'), ...choiceGrid([['Auto', 'auto'], ['Golden', 'a'], ['Dusk', 'b']], () => timeMode, (v) => { timeMode = v; }, 3),
    sectionRow('Quality'), ...choiceGrid([['Auto', 'auto'], ['High', 'high'], ['Medium', 'medium'], ['Light', 'light']], () => qPref, (v) => { qPref = v; setQuality(v, W); }, 4)],
  tone: { exposure: 1.0, bloom: 0.3, radius: 0.65, threshold: 0.97 },
});
const { scene, renderer } = W;
const loader = createLoader(14, 'Shaping the shore');
const tick = loader.tick;

// ---------------- sky, light ----------------
await tick('sky');
scene.fog = new THREE.FogExp2(0xe8b890, 0.0011);
const sky = createSky({ renderer, scene, sun: { elevation: 5, azimuth: AZ }, turbidity: 4.2, rayleigh: 2.8, mie: 0.008, mieG: 0.92, clouds: { cover: 0.5, scale: 1.1, wind: [0.003, 0.0008] }, seed: 6 });
scene.environment = sky.env; scene.fog.color.copy(sky.haze);
const sun = makeSunRig({ scene, renderer, Q, extent: 46 });

// ---------------- beach profile ----------------
const sandH1 = (z) => z >= ZS ? (z - ZS) * 0.06 : -9 * (1 - Math.exp(-(ZS - z) * 0.0125));
const duneH = (x, z) => smoothstep(ZS + 30, ZS + 100, z) * (fbm(x * 0.018 + 4, z * 0.018 + 1) - 0.32) * 13 * smoothstep(8, 40, Math.abs(x) + (z - ZS) * 0.35);
const groundH = (x, z) => sandH1(z) + Math.max(duneH(x, z), 0) + (z > ZS ? (fbm(x * 0.3, z * 0.3) - 0.5) * 0.05 : 0);
const hfn = { height: groundH };

// ---------------- sand (PBR maps + swash / wet sand / tide mark) ----------------
await tick('sand');
const sandMaps = await makeMaterialMaps('sand', { size: Q.tex, seed: 3 });
const sandMat = standardMaterial(sandMaps, { roughness: 1, normalScale: 1.4 });
const shore = createShoreline({ base: { x: 0, z: ZS }, land: [0, 1], runup: 3, period: PERIOD, surge: 0.3, dry: 28, groundH });
shore.patchMaterial(sandMat, { wetDark: 0.5 });
{
  const [nx, nz] = DETAIL.sand, geo = new THREE.PlaneGeometry(1000, 520, nx, nz).rotateX(-Math.PI / 2).translate(0, 0, 130), p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) { p.setY(i, groundH(p.getX(i), p.getZ(i))); uv.setXY(i, p.getX(i) * 0.4, p.getZ(i) * 0.4); }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, sandMat); mesh.receiveShadow = true; mesh.frustumCulled = false; scene.add(mesh);
}

// ---------------- rocks: headlands, stacks, pebbles ----------------
await tick('rocks');
const rockMaps = await makeMaterialMaps('rock', { size: Q.tex, seed: 4 });
const rockMat = standardMaterial(rockMaps, { vertexColors: true, roughness: 1 });
const variants = [{ seed: 11, detail: 4, flatten: 0.55, facets: 9, moss: 0.7, texScale: 10 }, { seed: 12, detail: 4, flatten: 0.8, facets: 8, moss: 0.6, texScale: 10 }, { seed: 13, detail: 4, flatten: 1.7, facets: 7, moss: 0.2, texScale: 4 }, { seed: 14, detail: 3, flatten: 0.7, facets: 6, texScale: 0.5 }];
const BIG = [   // [x, z, scale, variant]   headlands left and right, sea stacks, distant ridges
  [-175, -40, 52, 0], [-250, -110, 46, 1], [-120, -85, 16, 3], [-60, -60, 8, 2], [110, -150, 8, 2], [190, -230, 34, 1],
  [380, -420, 130, 0], [-600, -520, 170, 1], [560, -700, 150, 0],
];
const rockDepth = (x, z) => { let d = 99; for (const [rx, rz, s] of BIG) d = Math.min(d, (Math.hypot(x - rx, z - rz) - s * 1.1) * 0.35); return Math.max(0, d); };
scene.add(createRocks({ items: BIG.map(([x, z, s, v]) => ({ x, y: groundH(x, z) - 0.6, z, s, yaw: R() * 6.28, variant: v })), variants, material: rockMat, castShadow: false }));
{
  const items = []; for (let i = 0; i < DETAIL.pebbles; i++) { const x = rr(-9, 9), z = rr(ZS + 3, SEAT_Z + 6); items.push({ x, y: groundH(x, z) - 0.01, z, s: rr(0.05, 0.16), yaw: R() * 6.28, variant: 3 }); }
  scene.add(createRocks({ items, variants, material: rockMat }));
}

// ---------------- sea ----------------
await tick('sea');
const WAVES = [{ dir: [0.1, 1], steep: 0.09, len: 60 }, { dir: [-0.3, 1], steep: 0.07, len: 30 }, { dir: [0.5, 0.85], steep: 0.05, len: 14 }, { dir: [-0.6, 0.8], steep: 0.035, len: 7 }];
const nearSea = createWater({ level: 0, bounds: { cx: 0, cz: ZS - 160, w: 700, d: 340 }, segments: DETAIL.water, depthFn: (x, z) => Math.min(-groundH(x, z), rockDepth(x, z) + 0.02), maxDepth: 6, depthRes: 384, waves: WAVES, calm: 0.55, foam: 0.9, colors: { shallow: 0x5fae9e, deep: 0x14404e } });
const farSea = createWater({ level: -0.05, bounds: { cx: 0, cz: ZS - 1900, w: 4400, d: 3200 }, segments: 96, waves: WAVES, calm: 0.55, foam: 0.5, colors: { shallow: 0x5fae9e, deep: 0x14404e } });
scene.add(farSea.mesh, nearSea.mesh);

// ---------------- scrub, grass, driftwood ----------------
await tick('dune scrub');
const lib = await createTreeLibrary({ renderer, scene, quality: Q, species: ['shrub'], sun: null, env: null, tick, seed: 3 });
const shrubs = [];
for (let i = 0; i < DETAIL.shrubs * 4 && shrubs.length < DETAIL.shrubs; i++) {
  const x = rr(-170, 170), z = rr(ZS + 34, ZS + 118); if (fbm(x * 0.03 + 5, z * 0.03) < 0.42) continue; const gy = groundH(x, z);
  shrubs.push({ x, y: gy - 0.05, z, s: rr(0.8, 2.0), yaw: R() * 6.28, species: 'shrub', variant: Math.floor(R() * Q.variants), tint: [rr(0.95, 1.15), rr(0.9, 1.05), rr(0.7, 0.95)] });
}
const field = createTreeField(lib, shrubs, scene); field.setShadows(!!Q.shadowMap); field.layout({ x: 0, z: 40, lod0: 70, lod1: 140, far: 240, impostors: false, minDist: 2 });
const grass = createGrass({ hf: hfn, count: DETAIL.grass, radius: 30, height: [0.35, 0.9], seed: 4, colors: { lo: 0x6b7f3c, mid: 0xa9b061, hi: 0xe3dba2 }, windU: lib.wind }); scene.add(grass.mesh);
scene.add(createLogs({ hf: hfn, barkMat: standardMaterial(lib.barkMaps['bark:oak'], { roughness: 1, color: 0xcbbfae }), items: [{ x: -2.9, z: SEAT_Z + 1.8, len: 3.4, r: 0.17, yaw: 0.5 }, { x: 14, z: SEAT_Z + 12, len: 2.6, r: 0.13, yaw: 2.1 }] }));
await tick('boat and gulls');

// ---------------- sailboat ----------------
const boat = new THREE.Group();
{
  const hull = new THREE.Mesh(new THREE.BoxGeometry(5.5, 1.1, 1.6), new THREE.MeshStandardMaterial({ color: 0x2a2220, roughness: 0.8 })); hull.position.y = 0.2; boat.add(hull);
  const sm = new THREE.MeshStandardMaterial({ color: 0xf3dfc8, side: THREE.DoubleSide, roughness: 0.9 });
  const tri = (pts) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3)); g.computeVertexNormals(); return g; };
  boat.add(new THREE.Mesh(tri([-0.3, 0.8, 0, -0.3, 7.5, 0, 2.8, 0.8, 0]), sm), new THREE.Mesh(tri([-0.7, 0.8, 0, -0.7, 6.2, 0, -2.6, 0.8, 0]), sm));
  boat.position.set(-120, 0, -330); scene.add(boat);
}

// ---------------- gulls: loose flocks on long lazy arcs out over the sea (shared calm-bird module) ----------------
const birds = createBirds({ parent: scene, color: 0xf4f4ef, wingColor: 0xcfd4da, tipColor: 0x3a3d44, seed: 9, flocks: [
  { n: 4, cx: 10, cz: -55, ra: 60, rb: 24, y: 12, yv: 3, period: 73, size: 1.8 },
  { n: 3, cx: -35, cz: -90, ra: 80, rb: 32, y: 18, yv: 4, period: 80, size: 1.9 },
  { n: 2, cx: 5, cz: -42, ra: 48, rb: 16, y: 8, yv: 2, period: 63, size: 1.7 },
] });
W.detailFns.push((f) => { birds.group.visible = f > 0.3; });


// ---------------- time of day: golden hour -> dusk -> back (~10 min), or pinned from the menu ----------------
let sceneT = 0, lastEl = 99;
function applyTime(p, force) {
  const el = lerp(5.5, -2.8, p);
  if (force || Math.abs(el - lastEl) > 0.4) { lastEl = el; sky.setSun(el, AZ); scene.environment = sky.env; scene.fog.color.copy(sky.haze); aimSun(sun, sky, W.rig.position.x, W.rig.position.y, W.rig.position.z); }
  const h = Math.sin(el * Math.PI / 180), vis = smoothstep(-0.06, 0.03, h);
  sun.color.copy(sky.sunColor); sun.intensity = sky.sunIntensity * vis; scene.environmentIntensity = lerp(1.0, 0.55, p);
}
applyTime(0, true);
W.detailFns.push((f) => { grass.thin(f); birds.group.visible = f > 0.3; });
W.onFrame((dt, t) => {
  sceneT = t;
  const target = timeMode === 'auto' ? 0.5 - 0.5 * Math.cos(t * 0.0105) : timeMode === 'a' ? 0 : 1;
  pCur += (target - pCur) * Math.min(1, dt * 0.7); applyTime(pCur, false);
  sky.update(t, W.rig.position); shore.update(t); nearSea.update(t); farSea.update(t); lib.update(t);
  boat.position.x = -120 + ((t * 0.55) % 520); boat.position.y = Math.sin(t * 0.7) * 0.12; boat.rotation.z = Math.sin(t * 0.55) * 0.035;
  birds.update(t);
});

// ---------------- audio (waves are cued to the visible wave clock) ----------------
W.buildAudio = (A) => {
  const { ctx, master } = A;
  const rv = A.reverb(2.4, 2.4), wet = A.gain(0.45); rv.connect(wet); wet.connect(master);
  // distant surf bed
  const bed = A.noise('brown'), bg = A.gain(0.075); A.chain(bed, A.filter('lowpass', 260), bg, master); A.lfo(bg.gain, 0.11, 0.03);
  const mid = A.noise('pink'), mg = A.gain(0.03), mbp = A.filter('bandpass', 700, 0.5); A.chain(mid, mbp, mg, master); A.lfo(mg.gain, 0.11, 0.015); A.lfo(mbp.frequency, 0.09, 200);
  // light sea breeze
  const wind = A.noise('pink'), wbp = A.filter('bandpass', 380, 0.5), wg = A.gain(0.035); A.chain(wind, wbp, wg, master); A.lfo(wg.gain, 0.05, 0.02);
  // each wave: rising roar -> crash -> fizzing wash up the sand -> drain
  let lastN = -1;
  setInterval(() => {
    const n = Math.floor((sceneT + 1.1) / PERIOD);
    if (n === lastN || ctx.state !== 'running') return; lastN = n;
    const hh = Math.sin((n * 3.17 + 1.3) * 127.1) * 43758.5453, amp = 0.55 + 0.45 * (hh - Math.floor(hh));
    const t0 = ctx.currentTime, pan = (Math.random() - 0.5) * 0.5;
    const nz = A.noise('pink'), lp = A.filter('lowpass', 300, 0.6), g = A.gain(0.0001), pn = A.pan(pan);
    A.chain(nz, lp, g, pn, master); pn.connect(rv);
    lp.frequency.setValueAtTime(260, t0); lp.frequency.linearRampToValueAtTime(1800, t0 + 1.7); lp.frequency.exponentialRampToValueAtTime(420, t0 + 6.5);
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.1 * amp, t0 + 2.4); g.gain.exponentialRampToValueAtTime(0.0008, t0 + 7);
    const wsh = A.noise('white'), hp = A.filter('highpass', 3400, 0.7), wg2 = A.gain(0.0001), bub = A.gain(1);
    A.chain(wsh, hp, bub, wg2, pn); A.lfo(bub.gain, 38 + Math.random() * 20, 0.5); 
    wg2.gain.setValueAtTime(0.0001, t0 + 1.5); wg2.gain.linearRampToValueAtTime(0.03 * amp, t0 + 2.6); wg2.gain.linearRampToValueAtTime(0.02 * amp, t0 + 4.6); wg2.gain.exponentialRampToValueAtTime(0.0006, t0 + 8.2);
    const sz = A.noise('white'), sbp = A.filter('bandpass', 1500, 0.6), sg = A.gain(0.0001); A.chain(sz, sbp, sg, pn);
    sg.gain.setValueAtTime(0.0001, t0 + 1.2); sg.gain.linearRampToValueAtTime(0.03 * amp, t0 + 2.3); sg.gain.exponentialRampToValueAtTime(0.0006, t0 + 3.6);
    setTimeout(() => { for (const s of [nz, wsh, sz]) { try { s.stop(); } catch (e) {} } }, 9500);
  }, 400);
  // gulls
  const bus = (pan) => { const pn = A.pan(pan), lp = A.filter('lowpass', 5200), d = A.gain(0.6), s = A.gain(0.55); A.chain(pn, lp); lp.connect(d); d.connect(master); lp.connect(s); s.connect(rv); return pn; };
  A.every(() => {
    const dest = bus((Math.random() - 0.5) * 1.8), base = 1500 + Math.random() * 500, n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) A.blip({ f: [[0, base], [0.09, base * 1.55], [0.32 - i * 0.02, base]], dur: 0.38, vol: 0.03, attack: 0.03, type: 'triangle', dest, at: i * 0.42, vib: 70, vibRate: 55 });
  }, 10, 24, 4);
  // distant bell buoy
  A.every(() => {
    const dest = bus((Math.random() - 0.5) * 1.2);
    A.blip({ f: [[0, 523], [3, 520]], dur: 3.2, vol: 0.02, attack: 0.004, dest });
    A.blip({ f: [[0, 1319], [2, 1315]], dur: 1.8, vol: 0.006, attack: 0.004, dest });
  }, 22, 42, 10);
};


// ---------------- viewpoints: the shore, a dune top looking over the surf, and looking along the beach; switching goes through black ----------------
const SEATS = [
  { id: 'shore', x: 0, z: SEAT_Z, yaw: 0, pitch: -0.07 },
  { id: 'dune', x: -8, z: SEAT_Z + 56, yaw: 0, pitch: -0.12 },
  { id: 'along', x: 0, z: SEAT_Z, yaw: 1.2, pitch: -0.05 },
].map(v => ({ ...v, y: groundH(v.x, v.z) }));
try { const sv = localStorage.getItem('oortia-beach-vp'); if (SEATS.some(v => v.id === sv)) curSeat = sv; } catch (e) { /* ignore */ }
function applySeat(id) {
  const v = SEATS.find(q => q.id === id) || SEATS[0]; curSeat = v.id;
  W.setSeat({ x: v.x, y: v.y, z: v.z, yaw: v.yaw, pitch: v.pitch });
  aimSun(sun, sky, v.x, v.y, v.z);
  grass.layout(v.x, v.z, { exclude: (x, z) => z < ZS + 24 });
  try { localStorage.setItem('oortia-beach-vp', v.id); } catch (e) { /* ignore */ }
}
switchTo = (id) => { if (id === curSeat) return; if (W.comfort) W.comfort.fade(() => applySeat(id)); else applySeat(id); };
addEventListener('keydown', (e) => { const m = /^Digit([1-9])$/.exec(e.code); if (!m || e.ctrlKey || e.metaKey || e.altKey) return; const v = SEATS[+m[1] - 1]; if (v) switchTo(v.id); });
if (location.hash === '#debug') window.__B = { shore, sky, sun, groundH, applySeat, switchTo, nearSea };   // dev aid
applySeat(curSeat);
await tick('done'); loader.done(W);
W.start();
