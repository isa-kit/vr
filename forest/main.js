// Forest — Morning Light.  A large forest landscape with four seated viewpoints (hilltop overlook, forest floor,
// meadow, lakeside).  EVERYTHING here is generated at load from numbers by ../procgen/: grown trees (3 LODs + baked
// impostors), PBR bark/litter/soil/rock/grass maps, blended terrain, boulders, a physically based sky with matching haze,
// and a Gerstner lake.  No downloaded models or textures.  Quality tier (High / Medium / Light) is picked automatically
// (desktop / phone / headset) and can be changed in the menu; the frame-rate governor can still thin things at runtime.

import {
  THREE, SHADER_TAIL, createWorld, makeNoiseTexture, softTexture, fbm, smoothstep, rng, sectionRow, choiceGrid,
} from '../seated/common.js?v=20261114std2';
import { createBirds } from '../shared/birds.js';
import { yieldNow } from '../seated/proc.js?v=20261114x';
import { makeMaterialMaps, makeLeafAtlas, standardMaterial } from '../procgen/textures.js?v=20261114x';
import { QUALITY, createTreeLibrary, createTreeField } from '../procgen/trees.js?v=20261114x';
import { createHeightfield, createTerrain, createGrass, createFlowers, createLitter, createFerns, createLogs } from '../procgen/terrain.js?v=20261114x';
import { createRocks } from '../procgen/rocks.js?v=20261114x';
import { createSky } from '../procgen/sky.js?v=20261114x';
import { createWater } from '../procgen/water.js?v=20261114x';

const R = rng(20260);
const rr = (a, b) => a + R() * (b - a);

// ---------------- quality tier ----------------
const isHeadsetUA = /OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent);
const isCoarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
let qPref = 'auto'; try { qPref = localStorage.getItem('oortia-quality') || 'auto'; } catch (e) { /* ignore */ }
const qName = QUALITY[qPref] ? qPref : (isHeadsetUA ? 'light' : isCoarse ? 'medium' : 'high');
const Q = QUALITY[qName];
const DETAIL = { high: { grass: 10000, flowers: 520, litter: 1600, stones: 260, ferns: 650, terrain: 176, water: 128, trees: 1 }, medium: { grass: 5200, flowers: 300, litter: 900, stones: 150, ferns: 350, terrain: 144, water: 80, trees: 0.8 }, light: { grass: 2200, flowers: 160, litter: 450, stones: 70, ferns: 220, terrain: 112, water: 48, trees: 0.55 } }[qName];

// ---------------- world layout ----------------
const HILL = { x: 250, z: -300, h: 140, r: 205 };
const LAKE = { x: -90, z: -520, rx: 95, rz: 55, level: 0 };
const MEADOW = { x: -235, z: -40, r: 46 };
const FACING = (fromX, fromZ, toX, toZ) => Math.atan2(-(toX - fromX), -(toZ - fromZ));
const HSEAT = (() => { const dx = LAKE.x - HILL.x, dz = LAKE.z - HILL.z, l = Math.hypot(dx, dz); return { x: HILL.x + dx / l * 114, z: HILL.z + dz / l * 114 }; })();
const VPS = [
  { id: 'hill', label: 'Hilltop', x: HSEAT.x, z: HSEAT.z, yaw: FACING(HSEAT.x, HSEAT.z, LAKE.x, LAKE.z), pitch: -0.2, tilt: -0.1, fog: 0.0008, far: 1000, shafts: false, grass: 1, flat: [3, 6], birds: 'high', moteY: -6, lodScale: 1 },
  { id: 'floor', label: 'Forest floor', x: 0, z: 0, yaw: 0, pitch: 0.1, fog: 0.0072, far: 320, shafts: true, grass: 0, flat: [3, 22], birds: 'low', moteY: 7, lodScale: 1.5 },
  { id: 'meadow', label: 'Meadow', x: MEADOW.x, z: MEADOW.z + 30, yaw: 0, pitch: 0.06, fog: 0.0062, far: 540, shafts: true, grass: 2, flat: [3, 24], birds: 'low', moteY: 5, lodScale: 1.2 },
  { id: 'lake', label: 'Lakeside', x: LAKE.x, z: LAKE.z + LAKE.rz * 1.35, yaw: 0, pitch: 0.03, fog: 0.0052, far: 620, shafts: false, grass: 1, flat: [3, 20], birds: 'low', moteY: 5, lodScale: 1.2 },
];
let curId = 'hill';
try { const sv = localStorage.getItem('oortia-forest-vp'); if (VPS.some(v => v.id === sv)) curId = sv; } catch (e) { /* ignore */ }
let switchTo = () => {};
const setQuality = (v) => { try { localStorage.setItem('oortia-quality', v); } catch (e) { /* ignore */ } qPref = v; if (W.comfort) W.comfort.fade(() => location.reload()); else location.reload(); };

const W = await createWorld({
  lie: { story: 'trees', ceiling: 44, step: 5 },
  onLying: (on) => { if (on && curId !== 'floor') applyViewpoint('floor'); },   // lie on the forest floor, under the canopy
  eye: 1.15, bg: 0xbccfc4, title: 'Forest — Morning Light', startPitch: 0.1, loading: true,
  hint: (isCoarse ? 'Drag to look around · Menu → Viewpoint to change seat' : 'Drag to look around · keys 1–4 or Menu → Viewpoint to change seat'),
  rows: [sectionRow('Viewpoint'), ...choiceGrid(VPS.map(v => [v.label, v.id]), () => curId, (id) => switchTo(id), 2),
    sectionRow('Quality'), ...choiceGrid([['Auto', 'auto'], ['High', 'high'], ['Medium', 'medium'], ['Light', 'light']], () => qPref, setQuality, 4)],
  tone: { exposure: 1.12, bloom: 0.22, radius: 0.7, threshold: 0.98 },
});
const { scene, renderer } = W;

// ---------------- loading screen ----------------
const card = document.querySelector('#enter .card'), goBtn = card && card.querySelector('.go');
if (goBtn) goBtn.style.display = 'none';
const bar = document.createElement('div'), fill = document.createElement('div'), label = document.createElement('div');
bar.style.cssText = 'margin:16px auto 0;width:min(260px,70vw);height:6px;border-radius:3px;background:rgba(255,255,255,.25);overflow:hidden'; fill.style.cssText = 'height:100%;width:0%;background:#fff;transition:width .25s';
label.style.cssText = 'margin-top:9px;font-size:13px;opacity:.85'; bar.appendChild(fill); if (card) card.append(bar, label);
let steps = 0; const TOTAL = 24;
const T0 = performance.now(), TT = []; window.__TT = TT;
const tick = async (l) => { TT.push([l || '', Math.round(performance.now() - T0)]); steps++; fill.style.width = Math.min(96, steps / TOTAL * 100) + '%'; label.textContent = 'Growing the forest… ' + (l || ''); await yieldNow(); };

// ---------------- sky, light, haze ----------------
await tick('sky');
scene.fog = new THREE.FogExp2(0xbccfc4, 0.0036);
const sky = createSky({ renderer, scene, sun: { elevation: 23, azimuth: -35 }, turbidity: 2.9, rayleigh: 1.2, mie: 0.004, mieG: 0.82, clouds: { cover: 0.66, scale: 0.75 }, seed: 4 });
scene.environment = sky.env; scene.environmentIntensity = 1.35; scene.fog.color.copy(sky.haze);
const sunDir = sky.sunDir;
const sun = new THREE.DirectionalLight(sky.sunColor, sky.sunIntensity); scene.add(sun, sun.target);
if (Q.shadowMap) {
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  sun.castShadow = true; sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap); const sc = sun.shadow.camera, ex = qName === 'high' ? 70 : 52;
  sc.left = -ex; sc.right = ex; sc.top = ex; sc.bottom = -ex; sc.near = 1; sc.far = 420; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.07; sun.shadow.radius = 3;
}
const noise = makeNoiseTexture(256);

// ---------------- terrain height ----------------
const lakeU = (x, z) => Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
const hf = createHeightfield({
  seed: 5, base: { amp: 15, freq: 0.0027, oct: 4 }, ridge: { amp: 30, freq: 0.0017, carve: 0.3 }, detail: { amp: 2.2, freq: 0.03 },
  features: [{ type: 'hill', x: HILL.x, z: HILL.z, h: HILL.h, r: HILL.r }],
  flats: [...VPS.map(v => ({ x: v.x, z: v.z, r0: v.flat[0], r1: v.flat[1] })), { x: MEADOW.x, z: MEADOW.z + 30, r0: 28, r1: 72 }],
  post: (x, z, h) => { const u = lakeU(x, z); h += (LAKE.level + 0.9 - h) * (1 - smoothstep(1.2, 2.6, u)); return h + (LAKE.level - 2.6 - h) * (1 - smoothstep(0.6, 1.15, u)); },
});
LAKE.level = hf.raw(LAKE.x, LAKE.z) - 0.5;
const groundH = hf.height, gh0 = (v) => groundH(v.x, v.z);
await tick('terrain');

// ---------------- materials (generated) ----------------
const maps = {};
for (const k of ['litter', 'grass', 'soil', 'rock']) { maps[k] = await makeMaterialMaps(k, { size: Q.tex, seed: 2 }); await tick(k + ' map'); }
const terrain = createTerrain({
  hf, maps, radius: 1250, sectors: DETAIL.terrain, seed: 3,
  extraWeights: (x, z) => {
    const m = 1 - smoothstep(MEADOW.r * 0.8, MEADOW.r * 1.4, Math.hypot(x - MEADOW.x, z - MEADOW.z)), hh = 1 - smoothstep(35, 90, Math.hypot(x - HILL.x, z - HILL.z)), u = lakeU(x, z), lk = 1 - smoothstep(1.2, 1.9, u), mud = 1 - smoothstep(1.0, 1.25, u);
    return { grass: 1 + 7 * m + 5 * hh + 3 * lk, litter: 1 - 0.85 * Math.max(m, hh) - 0.5 * lk, soil: 1 + 4 * mud };
  },
});
scene.add(terrain.mesh);

// ---------------- trees ----------------
const lib = await createTreeLibrary({ renderer, scene, quality: Q, species: ['oak', 'birch', 'pine', 'fir'], sun: { dir: sunDir, color: sky.sunColor, intensity: sky.sunIntensity }, env: sky.env, tick, seed: 1 });
const items = [];
function plant(SP, fill) {
  const CX = 0, CZ = -250, RAD = 820, S = { fir: [0.7, 1.95], pine: [0.8, 1.7], oak: [0.85, 1.5], birch: [0.8, 1.4] };
  for (let gx = CX - RAD; gx <= CX + RAD; gx += SP) for (let gz = CZ - RAD; gz <= CZ + RAD; gz += SP) {
    const x = gx + rr(-0.44, 0.44) * SP, z = gz + rr(-0.44, 0.44) * SP;
    if (Math.hypot(x - CX, z - CZ) > RAD) continue;
    const dh = Math.hypot(x - HILL.x, z - HILL.z);
    if (dh < 30 || Math.hypot(x - HSEAT.x, z - HSEAT.z) < 34 || (Math.hypot(x - HSEAT.x, z - HSEAT.z) < 125 && groundH(x, z) > groundH(HSEAT.x, HSEAT.z) - 26 && ((x - HSEAT.x) * (LAKE.x - HSEAT.x) + (z - HSEAT.z) * (LAKE.z - HSEAT.z)) > -0.35 * Math.hypot(x - HSEAT.x, z - HSEAT.z) * Math.hypot(LAKE.x - HSEAT.x, LAKE.z - HSEAT.z) && (fill || R() > 0.07)) || R() > smoothstep(34, 78, dh) * 0.95 + 0.05 * (dh > 95)) continue;
    if (lakeU(x, z) < (fill ? 1.25 : 1.5)) continue;
    if (R() > smoothstep(MEADOW.r * 0.85, MEADOW.r * 1.3, Math.hypot(x - MEADOW.x, z - MEADOW.z))) continue;
    if (Math.hypot(x / 9.5, (z + 9) / 17) < 1 || Math.hypot(x, z) < 6) continue;
    if (R() > (fill ? 0.8 : 0.62) + (fill ? 0.2 : 0.38) * smoothstep(0.25, 0.5, fbm(x * 0.012 + 3, z * 0.012 + 8))) continue;
    const fz = 1 - smoothstep(120, 280, Math.hypot(x, z)), patch = fbm(x * 0.007 + 40, z * 0.007 + 11);
    const pc = Math.max(0.12, Math.min(0.95, 0.3 + 0.5 * fz + 0.9 * (0.5 - patch)));
    const big = fbm(x * 0.0034 + 60, z * 0.0034 + 20), bl = smoothstep(0.5, 0.6, big), pc2 = pc * (1 - 0.8 * bl) , sp = R() < pc2 ? (R() < 0.72 + 0.2 * fz ? 'fir' : 'pine') : (R() < 0.42 + 0.2 * bl ? 'birch' : 'oak');
    const b = rr(0.78, 1.2), warm = patch > 0.6 ? 1.14 : patch < 0.38 ? 0.9 : 1, gold = (sp === 'oak' || sp === 'birch') && R() < (0.12 + 0.3 * bl);
    items.push({ x, y: groundH(x, z) - 0.15, z, s: rr(S[sp][0], S[sp][1]) * (fill ? 0.92 : 1), yaw: R() * 6.28, species: sp, variant: Math.floor(R() * Q.variants), fill, tint: [b * warm * (gold ? 1.35 : 1), b * (gold ? 1.1 : 1), b / warm * (gold ? 0.6 : 1)] });
  }
}
plant(10.5, false);
await tick('planting the near forest');
plant({ high: 5.2, medium: 7, light: 9 }[qName], true);   // dense impostor-only canopy fill, drawn only far from the seat
await tick('planting ' + items.length + ' trees');
const field = createTreeField(lib, items, scene); field.setShadows(!!Q.shadowMap);

// ---------------- lake ----------------
const water = createWater({ level: LAKE.level, bounds: { cx: LAKE.x, cz: LAKE.z, w: LAKE.rx * 2.7, d: LAKE.rz * 2.7 }, segments: DETAIL.water, depthFn: (x, z) => LAKE.level - groundH(x, z), maxDepth: 3, colors: { shallow: 0x4a8a78, deep: 0x12383e }, calm: 0.35 });
scene.add(water.mesh);
await tick('water');

// ---------------- near-field detail ----------------
const grass = createGrass({ hf, count: DETAIL.grass, radius: 25, height: [0.13, 0.4], seed: 2, windU: lib.wind, tuft: 6, width: 0.018, spread: 0.11, clump: 0.5, falloff: 1.75, dry: 0.16, colors: { lo: 0x22401a, mid: 0x5d8a34, hi: 0x93ab4e } }); scene.add(grass.mesh);
const flowers = createFlowers({ hf, count: DETAIL.flowers * 1.8, radius: 20, seed: 4, windU: lib.wind, height: [0.22, 0.46], size: 0.1 }); scene.add(flowers.mesh);
const litter = createLitter({ hf, count: DETAIL.litter, radius: 13, seed: 6 }); scene.add(litter.mesh);
const ferns = createFerns({ hf, atlas: makeLeafAtlas('fern', { size: Q.atlas, seed: 2 }), count: DETAIL.ferns, radius: 45, seed: 3, size: [0.5, 0.9], windU: lib.wind }); scene.add(ferns.mesh);
const rockMat = standardMaterial(maps.rock, { vertexColors: true, roughness: 1 });
const PEB = [0, 1, 2].map(i => ({ seed: 41 + i, detail: 2, flatten: 0.55 + 0.15 * i, facets: 5, rough: 0.1, texScale: 7, moss: 0.25 }));
const pebMat = standardMaterial(maps.rock, { vertexColors: true, roughness: 1, color: 0xd9cdb8 });
let pebbles = null;
function layPebbles(vp) {
  if (pebbles) { scene.remove(pebbles); pebbles.userData.meshes.forEach(m => m.geometry.dispose()); pebbles = null; }
  if (vp.id === 'floor') return;
  const r2 = rng(77 + Math.floor(vp.x)), its = [];
  for (let i = 0; i < DETAIL.stones * 3 && its.length < DETAIL.stones; i++) { const a = r2() * 6.283, r = 0.7 + Math.pow(r2(), 1.6) * 15, x = vp.x + Math.cos(a) * r, z = vp.z + Math.sin(a) * r; if (lakeU(x, z) < 1.15) continue; its.push({ x, y: groundH(x, z) - 0.012, z, s: 0.02 + Math.pow(r2(), 2.4) * 0.1, yaw: r2() * 6.28, variant: its.length % 3 }); }
  pebbles = createRocks({ items: its, variants: PEB, material: pebMat }); scene.add(pebbles);
}
const rockVariants = [{ seed: 1, detail: 3, flatten: 0.7, facets: 7 }, { seed: 2, detail: 3, flatten: 0.5, facets: 6, aspect: 1.5 }, { seed: 3, detail: 3, flatten: 0.85, facets: 4 }, { seed: 4, detail: 3, flatten: 0.6, facets: 8 }];
const props = {};
for (const v of VPS) {
  const g = new THREE.Group(), rocks = [], gy = gh0(v);
  for (let i = 0; i < (v.id === 'floor' ? 22 : 10); i++) {
    const a = R() * 6.28, r = (v.id === 'floor' ? 5 : 8) + R() * (v.id === 'floor' ? 55 : 40), x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
    if (lakeU(x, z) < 1.2 || Math.hypot(x - v.x, z - v.z) < 4) continue; rocks.push({ x, y: groundH(x, z) - 0.05, z, s: rr(0.5, 2.0), yaw: R() * 6.28, variant: i });
  }
  g.add(createRocks({ items: rocks, variants: rockVariants, material: rockMat, castShadow: !!Q.shadowMap }));
  if (v.id === 'floor') g.add(createLogs({ hf, barkMat: standardMaterial(lib.barkMaps['bark:oak'], { roughness: 1 }), mossMat: new THREE.MeshStandardMaterial({ color: 0x4d6e2c, roughness: 1 }), items: [{ x: -2.4, z: -5.8, len: 9, r: 0.45, yaw: 0.35 }, { x: 16, z: -22, len: 7, r: 0.36, yaw: 2.2 }, { x: -24, z: 10, len: 8, r: 0.4, yaw: 1.1 }] }));
  scene.add(g); props[v.id] = g;
}
await tick('rocks');

// ---------------- light shafts ----------------
const shafts = [], shaftG = new THREE.Group(); scene.add(shaftG);
{
  const toGround = sunDir.clone().negate();                         // direction the light travels
  const shearX = toGround.x / -toGround.y, shearZ = toGround.z / -toGround.y;   // horizontal drift per metre of height lost
  const vs = `varying vec2 vUv; varying vec3 vW, vN; uniform vec2 uShear;
    void main(){ vUv = uv; vec3 p = position; p.xz += -uShear * p.y;
      vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * w; }`;
  const fs = `varying vec2 vUv; varying vec3 vW, vN; uniform float uTime, uPhase, uInt; uniform vec3 uColor; uniform sampler2D uNoise;
    void main(){
      float edge = pow(max(1.0 - abs(vUv.x * 2.0 - 1.0), 0.0), 1.6);
      float vert = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y)) * 0.85 + 0.15 * smoothstep(0.0, 0.2, vUv.y);
      float pulse = 0.55 + 0.45 * sin(uTime * 0.21 + uPhase) * sin(uTime * 0.09 + uPhase * 2.3);
      vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;
      float ang = smoothstep(0.08, 0.6, abs(dot(normalize(vN), V)));
      float nearF = smoothstep(2.5, 11.0, dist) * exp(-dist * 0.011);
      float streak = 0.55 + 0.9 * texture2D(uNoise, vec2(vUv.x * 2.0 + uPhase, vUv.y * 0.25 - uTime * 0.004)).g;
      float a = edge * vert * pulse * ang * nearF * streak * uInt;
      gl_FragColor = vec4(uColor * a, a);
      ${SHADER_TAIL}
    }`;
  const n = 15;
  for (let i = 0; i < n; i++) {
    const w = rr(3.5, 8.5), H = rr(34, 48);
    const x = rr(-30, 30), z = rr(-62, -9);
    const base = new THREE.PlaneGeometry(w, H, 1, 1).translate(0, H / 2, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uTime: { value: 0 }, uPhase: { value: R() * 20 }, uInt: { value: 0.4 }, uColor: { value: new THREE.Color(0xffe7b8) }, uNoise: { value: noise }, uShear: { value: new THREE.Vector2(shearX, shearZ) } },
    });
    const grp = new THREE.Group(); grp.position.set(x, groundH(x, z) - groundH(0, 0) - 1, z); const ry = R() * 3;
    for (let k = 0; k < 2; k++) { const m = new THREE.Mesh(base, mat); m.rotation.y = ry + k * 1.05; m.renderOrder = 5; grp.add(m); }
    shaftG.add(grp); shafts.push(mat);
  }
}



// ---------------- mist (low drifting banks) ----------------
const mist = [], mistG = new THREE.Group(); scene.add(mistG);
{
  const tex = softTexture();
  for (let i = 0; i < 34; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xe3ece6, transparent: true, opacity: rr(0.13, 0.26), depthWrite: false, fog: false }));
    const a = R() * 6.28, r = 12 + R() * 70;
    s.position.set(Math.cos(a) * r, rr(1.5, 7), Math.sin(a) * r - 15);
    s.scale.set(rr(30, 60), rr(8, 14), 1); s.userData = { vx: rr(0.08, 0.3), z0: s.position.z };
    mistG.add(s); mist.push(s);
  }
}



// ---------------- drifting pollen / leaves ----------------
function makeMotes({ count, box, center, size, color, opacity, fall, drift, additive }) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2)); g.setIndex([0, 1, 2, 0, 2, 3]);
  const seed = new Float32Array(count * 4); for (let i = 0; i < seed.length; i++) seed[i] = R();
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4)); g.instanceCount = count;
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uTime: { value: 0 }, uBox: { value: new THREE.Vector3(...box) }, uCenter: { value: new THREE.Vector3(...center) }, uSize: { value: size }, uFall: { value: fall }, uDrift: { value: new THREE.Vector2(...drift) }, uColor: { value: new THREE.Color(color) }, uOp: { value: opacity } },
    vertexShader: `attribute vec4 aSeed; varying vec2 vUv; varying float vT, vDist; uniform float uTime, uSize, uFall; uniform vec3 uBox, uCenter; uniform vec2 uDrift;
      void main(){ vUv = uv; vec3 p = aSeed.xyz * uBox;
        p.x += sin(uTime * 0.17 + aSeed.w * 30.0) * 1.6 + uTime * uDrift.x;
        p.z += cos(uTime * 0.13 + aSeed.w * 21.0) * 1.6 + uTime * uDrift.y;
        p.y += sin(uTime * 0.21 + aSeed.w * 12.0) * 0.5 - uTime * uFall;
        p = mod(p, uBox) - uBox * 0.5 + uCenter;
        vT = aSeed.w; vec4 mv = viewMatrix * vec4(p, 1.0); vDist = length(mv.xyz);
        mv.xy += position.xy * uSize * (0.55 + 0.9 * aSeed.w);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec2 vUv; varying float vT, vDist; uniform float uTime, uOp; uniform vec3 uColor;
      void main(){ float d = length(vUv - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); a *= a;
        a *= (0.78 + 0.22 * sin(uTime * (0.15 + 0.2 * vT) + vT * 40.0)) * uOp * smoothstep(2.5, 7.0, vDist); gl_FragColor = vec4(uColor, a); ${SHADER_TAIL} }`,
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 6; scene.add(mesh); return m;
}
const pollen = makeMotes({ count: 260, box: [44, 18, 44], center: [0, 7, -14], size: 0.055, color: 0xfff1c8, opacity: 1.0, fall: 0.03, drift: [0.12, -0.05], additive: true });
const leaves = makeMotes({ count: 34, box: [40, 26, 40], center: [0, 11, -12], size: 0.07, color: 0xd1a53c, opacity: 0.9, fall: 0.42, drift: [0.35, 0.1], additive: false });



// ---------------- birds: pigeons between the trees (low seats), crows and hawks over the canopy (hilltop) ----------------
const birdsLow = createBirds({ parent: scene, color: 0x8d857a, wingColor: 0x7c766c, tipColor: 0x4a443c, seed: 11, flocks: [
  { n: 3, cx: -10, cz: -70, ra: 38, rb: 22, y: 17, yv: 3, period: 59, size: 0.7 },
  { n: 2, cx: 20, cz: -85, ra: 45, rb: 20, y: 24, yv: 3, period: 54, size: 0.75 },
] });
const birdsHigh = createBirds({ parent: scene, color: 0x3d372f, wingColor: 0x4a4338, tipColor: 0x2a261f, seed: 23, flocks: [
  { n: 3, cx: -15, cz: -140, ra: 95, rb: 45, y: -16, yv: 4, period: 80, size: 1.8 },
  { n: 2, cx: 90, cz: -220, ra: 115, rb: 50, y: -6, yv: 6, period: 92, size: 2.0 },
  { n: 1, cx: -60, cz: -95, ra: 75, rb: 30, y: -24, yv: 3, period: 72, size: 2.4 },
  { n: 3, cx: 40, cz: -60, ra: 70, rb: 28, y: -12, yv: 3, period: 66, size: 1.6 },
] });
W.detailFns.push((f) => { birdsLow.group.visible = birdsLow.on && f > 0.3; birdsHigh.group.visible = birdsHigh.on && f > 0.3; });


// ---------------- viewpoint switching ----------------
let lodScale = 1;
function layoutField(vp) { const l1 = Q.lod1 * vp.lodScale * lodScale; field.layout({ x: vp.x, z: vp.z, lod0: Q.lod0 * vp.lodScale * lodScale, lod1: l1, far: vp.far, fillMin: Math.max(90, l1 * 1.15) }); }
function applyViewpoint(id) {
  const vp = VPS.find(v => v.id === id) || VPS[0]; curId = vp.id;
  const gy = gh0(vp);
  W.setSeat({ x: vp.x, y: gy, z: vp.z, yaw: vp.yaw, pitch: vp.pitch, tilt: vp.tilt ?? 0.12 });
  scene.fog.density = vp.fog;
  terrain.rebuild(vp.x, vp.z);
  layoutField(vp);
  grass.layout(vp.x, vp.z, { exclude: (x, z) => lakeU(x, z) < 1.12 }); grass.mesh.visible = vp.grass > 0;
  flowers.layout(vp.x, vp.z, { exclude: (x, z) => lakeU(x, z) < 1.2 }); flowers.mesh.visible = vp.grass > 0;
  litter.layout(vp.x, vp.z, { exclude: (x, z) => lakeU(x, z) < 1.2 }); layPebbles(vp);
  ferns.layout(vp.x, vp.z, { exclude: (x, z) => lakeU(x, z) < 1.3 }); ferns.mesh.visible = vp.id === 'floor';
  for (const k of Object.keys(props)) props[k].visible = k === vp.id;
  sun.target.position.set(vp.x, gy, vp.z); sun.position.copy(sun.target.position).addScaledVector(sunDir, 160);
  shaftG.visible = vp.shafts; shaftG.position.set(vp.x, gy, vp.z); shaftG.rotation.y = vp.yaw;
  mistG.position.set(vp.x, gy + (vp.id === 'hill' ? -26 : 0), vp.z); mistG.rotation.y = vp.yaw;
  for (const u of [pollen.uniforms, leaves.uniforms]) u.uCenter.value.set(vp.x, gy + vp.moteY + (u === leaves.uniforms ? 4 : 0), vp.z);
  birdsLow.on = vp.birds === 'low'; birdsHigh.on = vp.birds === 'high';
  for (const b of [birdsLow, birdsHigh]) { b.group.visible = b.on; b.group.position.set(vp.x, gy, vp.z); b.group.rotation.y = vp.yaw; }
  try { localStorage.setItem('oortia-forest-vp', vp.id); } catch (e) { /* ignore */ }
}
switchTo = (id) => {
  if (id === curId) return;
  if (W.comfort) W.comfort.fade(() => applyViewpoint(id)); else applyViewpoint(id);   // always through black, never a glide
};
addEventListener('keydown', (e) => {
  const m = /^Digit([1-9])$/.exec(e.code); if (!m || e.ctrlKey || e.metaKey || e.altKey) return;
  const v = VPS[+m[1] - 1]; if (v) switchTo(v.id);
});
W.detailFns.push((f) => { grass.thin(f); ferns.thin(f); const ls = f < 0.75 ? 0.55 : 1; if (ls !== lodScale) { lodScale = ls; layoutField(VPS.find(v => v.id === curId)); } });

// ---------------- animate ----------------
W.onFrame((dt, t) => {
  const cloud = 0.8 + 0.2 * Math.sin(t * 0.045) * Math.sin(t * 0.027 + 1.0);      // slow drifting cloud-shadow
  sun.intensity = sky.sunIntensity * (0.78 + 0.22 * cloud);
  for (const m of shafts) { m.uniforms.uTime.value = t; m.uniforms.uInt.value = 0.5 + 0.3 * cloud; }
  sky.update(t, W.rig.position); lib.update(t); water.update(t);
  pollen.uniforms.uTime.value = t; leaves.uniforms.uTime.value = t;
  for (const s of mist) { s.position.x += s.userData.vx * dt; if (s.position.x > 85) s.position.x = -85; s.position.y += Math.sin(t * 0.1 + s.userData.z0) * 0.0015; }
  if (birdsLow.on) birdsLow.update(t); if (birdsHigh.on) birdsHigh.update(t);
});

// ---------------- audio ----------------
W.buildAudio = (A) => {
  const { ctx, master } = A;
  const rv = A.reverb(3.2, 2.2), wet = A.gain(0.65); rv.connect(wet); wet.connect(master);
  // canopy wind
  const wind = A.noise('pink'); const wg = A.gain(0.08);
  A.chain(wind, A.filter('bandpass', 420, 0.45), wg, master);
  A.lfo(wg.gain, 0.05, 0.035); A.lfo(wg.gain, 0.13, 0.015);
  const rum = A.noise('brown'); const rg = A.gain(0.05); A.chain(rum, A.filter('lowpass', 160), rg, master); A.lfo(rg.gain, 0.04, 0.02);
  // rustling leaves
  const leaf = A.noise('white'); const lg = A.gain(0.006);
  A.chain(leaf, A.filter('highpass', 3200), A.filter('bandpass', 6200, 0.6), lg, master); A.lfo(lg.gain, 0.11, 0.0045); A.lfo(lg.gain, 0.29, 0.002);
  // distant stream, to the left
  const st = A.noise('pink'); const sg = A.gain(0.022);
  A.chain(st, A.filter('bandpass', 1500, 0.9), sg, A.pan(-0.55), master); A.lfo(sg.gain, 7.3, 0.006); A.lfo(sg.gain, 0.2, 0.006);
  const st2 = A.noise('white'); const sg2 = A.gain(0.008); A.chain(st2, A.filter('bandpass', 3000, 1.4), sg2, A.pan(-0.6), master); A.lfo(sg2.gain, 11, 0.004);

  const bus = (pan) => { const p = A.pan(pan), d = A.gain(0.55), s = A.gain(0.75); p.connect(d); d.connect(master); p.connect(s); s.connect(rv); return p; };
  const rp = () => (Math.random() * 2 - 1) * 0.9;
  // songbird: a run of liquid notes
  A.every(() => {
    const dest = bus(rp()), base = 2000 + Math.random() * 1400, n = 4 + Math.floor(Math.random() * 5); let at = 0;
    for (let i = 0; i < n; i++) {
      const f0 = base * (0.8 + Math.random() * 0.7), f1 = f0 * (0.7 + Math.random() * 0.7), d = 0.07 + Math.random() * 0.12;
      A.blip({ f: [[0, f0], [d, f1]], dur: d + 0.03, vol: 0.05, attack: 0.012, dest, at, vib: 25, vibRate: 30 });
      at += d + 0.03 + (Math.random() < 0.25 ? 0.12 : 0.01);
    }
  }, 5, 12);
  // chickadee "fee-bee"
  A.every(() => {
    const dest = bus(rp()), f = 3300 + Math.random() * 300;
    A.blip({ f: [[0, f], [0.4, f]], dur: 0.42, vol: 0.045, attack: 0.03, dest });
    A.blip({ f: [[0, f * 0.88], [0.5, f * 0.86]], dur: 0.52, vol: 0.045, attack: 0.03, dest, at: 0.5 });
  }, 14, 30);
  // tits: bright triplets
  A.every(() => {
    const dest = bus(rp()), f = 4600 + Math.random() * 900, n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) A.blip({ f: [[0, f], [0.05, f * 1.15]], dur: 0.07, vol: 0.035, attack: 0.005, dest, at: i * 0.13 });
  }, 7, 18);
  // wood pigeon: low, soft coo
  A.every(() => {
    const dest = bus(rp() * 0.6);
    [[0, 410], [0.32, 440], [0.62, 420], [0.95, 410], [1.25, 395]].forEach(([at, f], i) =>
      A.blip({ f: [[0, f], [0.25, f * 0.95]], dur: i === 1 ? 0.45 : 0.28, vol: 0.05, attack: 0.05, dest, at, type: 'sine' }));
  }, 24, 50, 6);
  // far woodpecker drum
  A.every(() => {
    const dest = bus(rp()), n = 12 + Math.floor(Math.random() * 8);
    for (let i = 0; i < n; i++) {
      const at = i * 0.085 + Math.random() * 0.01, s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 2205, ctx.sampleRate);
      const d = s.buffer.getChannelData(0); for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / d.length, 6);
      const f = A.filter('bandpass', 1400, 2), g = A.gain(0.035); A.chain(s, f, g, dest); s.start(ctx.currentTime + at);
    }
  }, 50, 100, 12);
};



if (location.hash === '#debug') window.__F = { groundH, VPS, items, applyViewpoint, switchTo, lib, field, sky, sun, terrain, water, hf, grass };   // dev aid
applyViewpoint(curId);
await tick('done');
fill.style.width = '100%'; label.textContent = ''; bar.remove(); label.remove(); if (goBtn) goBtn.style.display = ''; W.loading = false;
W.start();
