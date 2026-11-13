// Sand Castle — protect the picnic! An open beach with a picnic laid out in the middle and the tide
// rolling in. Build walls, moats and towers to hold the waves back. The "physics" is cheated: the
// sand is a heightfield you sculpt (it slumps to a natural slope), and the tide is a flood-fill that
// only flows where the sand is low enough — so a good wall really does stop the sea.
//
// VR: both controllers are drawn with rays. Grip grabs the spade / bucket / magnifying glass (point at
// one and squeeze, or reach for it); trigger uses it. Squeeze both grips on empty air and pull apart /
// push together to zoom the whole world. Desktop: wheel + drag to orbit/zoom from sand-grain close-ups
// to a high overview, plus a loupe (L).

import * as THREE from 'three';
import { detectXR, createXRMenu, recenterRig, choiceGrid, stepperRow } from '../shared/xrmenu.js?v=20261114f';
import { createToolkit, createLens } from '../shared/xrtools.js?v=20261114f';
import { createComfort, rotateRigAboutHead, stickVector } from '../shared/comfort.js?v=20261114f';
import { createTouch } from '../shared/touch.js?v=20261114f';
import { createBirds } from '../shared/birds.js?v=20261114f';
import * as RZ from './realism.js?v=20261114f';
import { createSky } from '../procgen/sky.js?v=20261114g';
import { createWater, createShoreline } from '../procgen/water.js?v=20261115d';
import { makeMaterialMaps } from '../procgen/textures.js?v=20261114g';
import { beautify, SHADER_TAIL } from '../shared/beauty.js?v=20261114f';

let sky, ocean, shore, shores, fx, comfort, touch, wt = 0, qLevel = 0, gulls, hemi, sandTex, envTex, smallStuff, pebbleFull = 0;
const sandMats = [];
let quality = 'auto';
try { quality = localStorage.getItem('oortia-sand-quality') || 'auto'; } catch (e) { /* ignore */ }

// ---------- sand grid ----------
const TRAY = 5.0;                       // sculptable patch (m) — blends into the open beach around it
const GN = 256;                         // cells per side → ~2 cm cells
const CELL = TRAY / (GN - 1);
const HALF = TRAY / 2;
const MAXH = 0.8;
const BASE = 0.05;                      // untouched beach level; you can dig BELOW this (down to MINH) to make holes
const MINH = BASE - 0.5;                // deepest hole: 50 cm
const wet = new Float32Array(GN * GN);  // 0 dry … 1 soaked: wet sand is dark and holds steep walls; dry sand slumps flat
const wetSea = new Float32Array(GN * GN);   // sand the swash has just soaked: dries in ~30 s (built walls keep `wet` much longer)
const pw = new Float32Array(GN * GN);   // pooled water depth (m) sitting in holes; seeps away once the tide pulls back
const BUCKET_CAP = 10;                  // water units; one unit ≈ a litre
let bucketWater = 0, cupWater = 0;
const TRAY_C = new THREE.Vector3(0, 0, -3.0);
const sand = new Float32Array(GN * GN).fill(BASE);
const grain = new Float32Array(GN * GN);
for (let i = 0; i < grain.length; i++) grain[i] = (Math.random() - 0.5) * 0.09;
const PROT = new Uint8Array(GN * GN);   // cells you cannot edit: the picnic pad + the patch border

const BRUSHES = [0.04, 0.06, 0.09, 0.12, 0.16, 0.22, 0.3, 0.4];
let brushIdx = 3, brush = BRUSHES[3];
const TOOLS = [['Pile', 'pile'], ['Dig', 'dig'], ['Scoop', 'scoop'], ['Smooth', 'smooth'], ['Tower', 'tower'], ['Wall', 'wall'],
               ['Moat', 'moat'], ['Flag', 'flag'], ['Shell', 'shell'], ['Star', 'star']];
const CLICK_TOOLS = new Set(['tower', 'flag', 'shell', 'star']);
let tool = 'pile';

let scene, camera, renderer, dolly, env, sandMesh, sandGeo, waterMesh, menu, kit, caps, decoGroup, sun, lens, picnic;
const clock = new THREE.Clock();
const keys = {};
const ray = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2(0, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Matrix4();
const sunDir = new THREE.Vector3(-0.75, 0.58, -0.32).normalize();   // raking side-light: lit faces, long shadows
const horizonColor = new THREE.Color(0xdcecf5);

// desktop orbit camera — from a few cm above the grains to a high overview
// Default view: sitting/kneeling on the beach, eye ≈ 1 m, looking across the sand to the picnic with the sea and horizon in frame.
// The pitch is capped so zooming out rises a little but never becomes a top-down map view.
const START_DIST = 3.6, MIN_DIST = 0.12, MAX_DIST = 60, PMIN = 0.03, PMAX = 0.5, START_PITCH = 0.22;
const orbit = { yaw: 0, pitch: START_PITCH, dist: START_DIST, target: new THREE.Vector3(0, 0.25, TRAY_C.z) };
const VR_HOME = new THREE.Vector3(0, 0, 1.4);       // a few steps back from the patch, so the picnic is across the sand, not under your feet
const SCALE_MIN = 1 / 30, SCALE_MAX = 10;   // VR: viewer scale (small = giant world / grain-level, large = high overview)

// ---------- helpers ----------
const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const gi = (i, j) => j * GN + i;

// beach ground: flat around the patch, sloping into the sea beyond the patch's far (−z) edge
function groundH(x, z) {
  const edge = TRAY_C.z - HALF;
  if (z > edge) return -0.004;
  return -0.004 - 0.5 * smoothstep(edge, edge - 3.5, z) - 6.0 * smoothstep(edge - 3.5, edge - 70, z);
}
// world height of whatever you'd stand a tool on
function surfaceY(x, z) {
  const lx = x - TRAY_C.x, lz = z - TRAY_C.z;
  if (Math.abs(lx) < HALF - 0.05 && Math.abs(lz) < HALF - 0.05) return TRAY_C.y + heightAt(lx, lz) - BASE;
  return groundH(x, z);
}

// ---------- boot ----------
Promise.resolve().then(async () => { caps = await detectXR(); await init(); });

async function init() {
  scene = new THREE.Scene();
  scene.background = horizonColor.clone();
  scene.fog = new THREE.Fog(horizonColor, 30, 220);

  camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.02, 800);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: caps.ar });   // alpha only if passthrough can be toggled
  if (caps.ar) renderer.setClearColor(0x000000, 0);
  touch = createTouch({ canvas: renderer.domElement, look: false, stick: false });     // the canvas is handled below (sculpt / orbit / pinch)
  renderer.setPixelRatio(touch.pixelRatio(2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.xr.enabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;       // only re-render shadows when the sand actually changes
  renderer.shadowMap.needsUpdate = true;
  document.body.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = 'none';
  fx = beautify(renderer, scene, camera, { tone: 'neutral', exposure: 1.0, bloom: 0.12, radius: 0.3, threshold: 2.2 });

  dolly = new THREE.Group();
  dolly.add(camera);
  scene.add(dolly);

  hemi = new THREE.HemisphereLight(0xdff0ff, 0xbfa87e, 0.45);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xffe6c0, 1.45);
  sun.position.copy(TRAY_C).addScaledVector(sunDir, 10);
  sun.target.position.copy(TRAY_C);
  scene.add(sun, sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -3.7, right: 3.7, top: 3.7, bottom: -3.7, near: 1, far: 20 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.025; sun.shadow.radius = 3;

  env = new THREE.Group();            // sky, beach, sea, crate — hidden when passthrough is on
  scene.add(env);
  // sky, clouds, ambient light, haze: procgen/sky.js (physically based, deterministic)
  sky = createSky({ renderer, scene, sun: { elevation: 35, azimuth: 67 }, clouds: { cover: 0.32 }, seed: 3 });
  sunDir.copy(sky.sunDir);
  sky.mesh.scale.setScalar(500); sky.dome.scale.setScalar(0.38);      // keep the dome inside the camera far plane
  env.add(sky.mesh, sky.dome);
  envTex = sky.env; scene.environment = envTex; scene.environmentIntensity = 0.55;
  scene.fog.color.copy(sky.haze); scene.background = sky.haze.clone();
  sun.color.copy(sky.sunColor); sun.intensity = 1.45 * sky.sunIntensity / 3.2;
  // sand: procgen/textures.js 'sand' (colour + normal + roughness)
  const sm = await makeMaterialMaps('sand', { size: touch.isTouch ? 256 : 512, seed: 6 });
  sandTex = { albedo: sm.map, normal: sm.normalMap, rough: sm.roughnessMap };
  buildBeach();
  buildOcean();
  gulls = createBirds({ parent: env, color: 0xf4f4ef, wingColor: 0xdde1e6, tipColor: 0x3a3d44, seed: 5, flocks: [
    { n: 3, cx: -12, cz: -30, ra: 30, rb: 16, y: 6.5, yv: 1.5, period: 95, size: 1.7 },
    { n: 2, cx: 22, cz: -42, ra: 36, rb: 18, y: 10, yv: 2, period: 125, size: 1.5 } ] });
  buildSandTable();
  buildWater();
  decoGroup = new THREE.Group(); scene.add(decoGroup);
  buildPicnic();
  buildCursors();
  buildTools();
  buildStatusLabel();

  comfort = createComfort({ renderer, scene, camera, dolly, groundHit,
    onQuality: (q) => { qLevel = q; gulls.group.visible = q < 2; applyQuality(); } });
  { const h = document.getElementById('help'); if (h) h.textContent = touch.helpText('One finger sculpts · two fingers pinch to zoom & orbit · pick a tool below · ☰ Menu for options', h.textContent); }

  menu = createXRMenu({
    renderer, camera, dolly, caps,
    title: 'Sand Castle',
    startOpenDesktop: innerWidth > 760,
    hint: touch.helpText('Protect the picnic from the tide! Dig holes — the sea fills them; Scoop water into your bucket, then build Walls/Towers: wet sand holds, dry sand slumps. One finger sculpts, two fingers pinch/orbit.', 'Protect the picnic from the tide! Dig holes — the sea fills them; Scoop (3) water into your bucket, then build Walls/Towers: wet sand holds, dry sand slumps. Drag sand to sculpt · drag empty space or right-drag to orbit · wheel zooms · 1–9 tools · [ ] brush · Ctrl+Z undo · L loupe'),
    rows: [
      choiceGrid(TOOLS, () => tool, selectTool, 4),
      stepperRow('Brush', () => Math.round(brush * 100) + ' cm', () => stepBrush(-1), () => stepBrush(1)),
      { cells: [{ text: '↶  Undo', action: undo }, { text: 'Reset sand', action: resetSand }] },
      stepperRow('Zoom', zoomText, () => zoomBy(-1), () => zoomBy(1)),
      { label: 'Magnifier', cells: [
        { text: () => (lens.on ? 'On' : 'Off'), action: toggleDesktopLens, active: () => lens.on, w: 1.5, visible: () => !renderer.xr.isPresenting },
        { text: '–', action: () => lensZoomStep(-1), tone: 'accent' },
        { text: () => '×' + lens.zoom, w: 1.1 },
        { text: '+', action: () => lensZoomStep(1), tone: 'accent' } ] },
      { label: 'Bucket', cells: [
        { text: () => '💧 ' + bucketWater.toFixed(1) + ' / ' + BUCKET_CAP, w: 2.2 },
        { text: 'Empty', action: () => { bucketWater = 0; cupWater = 0; }, w: 1 } ] },
      { label: 'Quality', cells: [['Auto', 'auto'], ['High', 'high'], ['Med', 'medium'], ['Light', 'light']].map(([t, id]) => ({ text: t, active: () => quality === id, action: () => { quality = id; try { localStorage.setItem('oortia-sand-quality', id); } catch (e) { /* ignore */ } applyQuality(); } })) },
      { label: 'Tide', cells: [
        { text: () => (tide.on ? 'On' : 'Off'), action: () => { tide.on = !tide.on; if (tide.on) restartTide(); }, active: () => tide.on, w: 0.9 },
        { text: () => STRENGTH_NAMES[tide.strength], action: () => { tide.strength = (tide.strength + 1) % 3; syncShore(); }, w: 1.2 },
        { text: 'Restart', action: restartPicnic, tone: 'accent', w: 1.1 } ] },
      ...comfort.rows({ movement: true, teleport: true }),
    ],
    fade: comfort.fade,
    sound: { get: () => soundOn, set: setSound },
    setBackdrop,
    recenter,
    onBeforeEnter: startAudio,
    onSessionStart: () => { dolly.position.copy(VR_HOME); dolly.rotation.set(0, 0, 0); dolly.scale.setScalar(1); endDesktopLens(); },
    onSessionEnd: () => { dolly.position.set(0, 0, 0); dolly.rotation.set(0, 0, 0); dolly.scale.setScalar(1); },
  });
  comfort.attachMenu(menu);
  kit = createToolkit({ renderer, scene, dolly, camera, menu });
  registerTools();
  buildToolbar();

  // either hand can pick tools (menu consumes the click) or sculpt (everything else)
  menu.onSelectStart((c, hand, idx) => beginStroke(SRC[1 + idx]));
  menu.onSelectEnd((c, hand, idx) => endStroke(SRC[1 + idx]));
  menu.onButton((hand, b) => {
    if (hand === 'right' && b === 4) cycleTool(1);        // A
    if (hand === 'right' && b === 5) cycleTool(-1);       // B
  });
  menu.onSqueeze((c, hand, i, down) => { gripDown[i] = down; });
  applyQuality(); setStatus();
  renderer.xr.addEventListener('sessionstart', applyQuality); renderer.xr.addEventListener('sessionend', applyQuality);

  addEventListener('resize', onResize);
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  initPointer();
  const enter = document.getElementById('enter');
  enter.addEventListener('click', () => { startAudio(); enter.style.opacity = '0'; setTimeout(() => enter.remove(), 500); });
  renderer.xr.addEventListener('sessionstart', startAudio);

  if (location.hash === '#debug') window.__sc = { scene, sky, tide, wt: () => wt, reach: () => Array.from(reachCol).reduce((a, v) => (v > a ? v : a), -9), orbit, sand, src: SRC, camera: () => camera.position.toArray(), ndc: mouseNDC, getTool: () => tool, wet, pw, state: () => ({ bucketWater, cupWater, maxPool: pw.reduce((a, v) => (v > a ? v : a), 0), wetCells: wet.reduce((a, v) => a + (v > 0.5 ? 1 : 0), 0) }), dig: (lx, lz, r = 0.2, depth = 0.25) => { const rc = r / CELL, ci = (lx + HALF) / CELL, cj = (lz + HALF) / CELL; for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) { const d = Math.hypot(i - ci, j - cj); if (d < rc && !PROT[gi(i, j)]) sand[gi(i, j)] = BASE - depth * (1 - smoothstep(0.6 * rc, rc, d)); } markAll(); }, fillBucket: (lx, lz) => fillBucketAt(lx, lz, 5), project: (lx, lz) => { const v = new THREE.Vector3(TRAY_C.x + lx, TRAY_C.y + heightAt(lx, lz) - BASE, TRAY_C.z + lz).project(camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, wallLine: (x0, z0, x1, z1) => { const n = 80; for (let q = 0; q <= n; q++) stampWall(x0 + (x1 - x0) * q / n, z0 + (z1 - z0) * q / n, q * Math.hypot(x1 - x0, z1 - z0) / n); } };
  renderer.setAnimationLoop(animate);
}

// ---------- quality tiers: High (desktop) / Medium (phone) / Light (headset) ----------
const QTIERS = { high: { name: 'High', env: true, normal: true, shadow: 2048, pebbles: 1, idx: 0 }, medium: { name: 'Medium', env: true, normal: true, shadow: 1024, pebbles: 0.5, idx: 1 }, light: { name: 'Light', env: false, normal: false, shadow: 1024, pebbles: 0.2, idx: 2 } };
const QORDER = ['high', 'medium', 'light'];
function baseQuality() {
  if (quality !== 'auto' && QTIERS[quality]) return quality;
  return renderer && renderer.xr.isPresenting ? 'light' : (touch && touch.isTouch ? 'medium' : 'high');
}
let curTier = QTIERS.high;
function applyQuality() {
  const b = QTIERS[baseQuality()], idx = Math.max(b.idx, qLevel >= 2 ? 2 : qLevel >= 1 ? 1 : 0);
  const t = QTIERS[QORDER[idx]]; curTier = t;
  scene.environment = t.env ? envTex : null; hemi.intensity = t.env ? 0.45 : 1.0;
  for (const m of sandMats) { m.normalMap = t.normal ? sandTex.normal : null; m.map = t.normal ? sandTex.albedo : null; m.roughnessMap = t.normal ? sandTex.rough : null; m.needsUpdate = true; }
  if (sun.shadow.mapSize.x !== t.shadow) { sun.shadow.mapSize.set(t.shadow, t.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  renderer.shadowMap.needsUpdate = true;
  if (smallStuff) smallStuff.children[0].count = Math.floor(pebbleFull * t.pebbles);
}
function qualityText() { return QTIERS[baseQuality()].name + (curTier.idx !== QTIERS[baseQuality()].idx ? ' → ' + curTier.name : '') + (quality === 'auto' ? ' (auto)' : ''); }

// ---------- sky ----------
function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x4a90d8) }, mid: { value: new THREE.Color(0xcfe7f3) }, bot: { value: new THREE.Color(0xeaf5fb) } },
    vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec3 vP; uniform vec3 top,mid,bot; void main(){ float h=normalize(vP).y;
      vec3 c=h>0.0?mix(mid,top,pow(clamp(h,0.0,1.0),0.7)):mix(mid,bot,clamp(-h*5.0,0.0,1.0)); gl_FragColor=vec4(c,1.0); ${SHADER_TAIL} }`,
  });
  env.add(new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), mat));
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d'); const rg = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,252,240,1)'); rg.addColorStop(0.3, 'rgba(255,248,224,0.75)'); rg.addColorStop(1, 'rgba(255,248,224,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, fog: false }));
  spr.position.copy(sunDir).multiplyScalar(400); spr.scale.setScalar(90); env.add(spr);
}

// fine procedural grain (fades with distance) so close-ups and the magnifier have detail
function sandMaterial(cutPatch = false) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: sandTex.albedo, normalMap: sandTex.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.93, metalness: 0, roughnessMap: sandTex.rough, color: new THREE.Color(1, 1, 1) });
  m.customProgramCacheKey = () => (cutPatch ? 'sandpbr-cut' : 'sandpbr');
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float aWet; varying float vWet; varying vec3 vSandW;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n vWet = aWet; vSandW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'varying float vWet; varying vec3 vSandW;\n' + sh.fragmentShader
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.16, vWet);        // wet sand: glossy')
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${cutPatch ? `if (abs(vSandW.x - (${TRAY_C.x.toFixed(3)})) < ${HALF.toFixed(3)} && abs(vSandW.z - (${TRAY_C.z.toFixed(3)})) < ${HALF.toFixed(3)}) discard;` : ''}`);
  };
  sandMats.push(m);
  return m;
}
const DRY_C = new THREE.Color(0xfff4e2), WET_C = new THREE.Color(0xc4b49c);

// ---------- open beach ----------
function buildBeach() {
  const geo = new THREE.PlaneGeometry(240, 240, 240, 240); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), tmp = new THREE.Color();
  const edge = TRAY_C.z - HALF;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = groundH(x, z);
    pos.setY(i, h);
    tmp.copy(DRY_C).lerp(WET_C, smoothstep(edge - 0.3, edge - 2.5, z));
    const patch = Math.sin(x * 0.37 + Math.sin(z * 0.23) * 2.0) * Math.cos(z * 0.31 - x * 0.11) * 0.04, ripple = Math.sin((x * 1.9 + z * 4.6) + Math.sin(x * 0.4) * 3.0) * 0.018;
    tmp.offsetHSL(0, 0, patch + ripple + (Math.random() - 0.5) * 0.015);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const uvs = new Float32Array(pos.count * 2); for (let i = 0; i < pos.count; i++) { uvs[i * 2] = pos.getX(i) / 0.3; uvs[i * 2 + 1] = pos.getZ(i) / 0.3; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); geo.setAttribute('aWet', new THREE.BufferAttribute(new Float32Array(pos.count), 1));
  const beachMat = sandMaterial(true);
  // waves that run up the sloped beach and retreat: water film, foam lace at the leading edge, wet darkening and a tide mark (procgen/water.js)
  shores = RUNUPS.map((r) => createShoreline({ base: { x: 0, z: SHORE_BASE_Z }, land: [0, 1], runup: r, period: SHORE_PERIOD, groundH: (x, z) => groundH(x, z) }));
  shore = shores[1]; shore.patchMaterial(beachMat);           // the visible swash. Strength changes only its run-up number; the game reads the SAME function
  syncShore();
  const beach = new THREE.Mesh(geo, beachMat);   // cut out under the patch so holes are real
  beach.receiveShadow = true; env.add(beach);

  // a driftwood crate at hand height; the spade, bucket and magnifier live on it
  const crate = RZ.buildCrate(0.62, 0.62, 0.5);
  crate.position.set(CRATE.x, CRATE.top / 2, CRATE.z); env.add(crate);
  const towel = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.44), new THREE.MeshStandardMaterial({ ...RZ.makeTowelTextures(), roughness: 0.95 }));
  towel.rotation.x = -Math.PI / 2; towel.position.set(CRATE.x, CRATE.top + 0.002, CRATE.z); env.add(towel);
  // pebbles and shells scattered procedurally over the open beach (never on the sculpting patch)
  const edge2 = TRAY_C.z - HALF;
  smallStuff = RZ.scatterSmall(env, { pebbles: 420, shells: 70, area: { x0: -14, x1: 14, z0: edge2 - 3, z1: 6 },
    groundY: (x, z) => groundH(x, z), avoid: (x, z) => (Math.abs(x - TRAY_C.x) < HALF + 0.2 && Math.abs(z - TRAY_C.z) < HALF + 0.2) || (Math.abs(x - CRATE.x) < 0.5 && Math.abs(z - CRATE.z) < 0.45) });
  pebbleFull = smallStuff.children[0].count;
}
const CRATE = { x: 0.95, z: 1.0, top: 0.62 };

// ---------- the sea (far water) ----------
// ---------- the ocean: procgen/water.js (Gerstner swell rolling toward the beach, fresnel, glitter, shore foam from the real beach depth) ----------
const SEA_LEVEL = -0.52;
function buildOcean() {
  ocean = createWater({
    level: SEA_LEVEL, bounds: { cx: 0, cz: -130, w: 320, d: 250 }, segments: touch.isTouch ? 90 : 170, maxDepth: 6,
    depthFn: (x, z) => Math.max(0, SEA_LEVEL - groundH(x, z)),
    waves: [{ dir: [0.12, 1], steep: 0.10, len: 26, speed: 0.9 }, { dir: [-0.25, 1], steep: 0.07, len: 14, speed: 1 }, { dir: [0.3, 0.9], steep: 0.045, len: 7, speed: 1.1 }, { dir: [0.0, 1], steep: 0.03, len: 3.5, speed: 1.2 }],
    colors: { shallow: 0x5fb3a8, deep: 0x0f4a5e }, foam: 1.0, ripples: 1, calm: 0.55,
  });
  env.add(ocean.mesh);
}

// ---------- the sand patch (hand-built grid so we can update only the changed rows) ----------
let firstUpload = true;
let dirty = null;                      // {i0,i1,j0,j1}
function markDirty(i0, i1, j0, j1) {
  i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(GN - 1, i1); j1 = Math.min(GN - 1, j1);
  if (!dirty) dirty = { i0, i1, j0, j1 };
  else { dirty.i0 = Math.min(dirty.i0, i0); dirty.i1 = Math.max(dirty.i1, i1); dirty.j0 = Math.min(dirty.j0, j0); dirty.j1 = Math.max(dirty.j1, j1); }
}
const markAll = () => markDirty(0, GN - 1, 0, GN - 1);

function buildSandTable() {
  const n = GN * GN;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
    const k = gi(i, j) * 3;
    pos[k] = i * CELL - HALF; pos[k + 1] = BASE; pos[k + 2] = j * CELL - HALF; nor[k + 1] = 1;
  }
  const idx = new Uint32Array((GN - 1) * (GN - 1) * 6);
  let t = 0;
  for (let j = 0; j < GN - 1; j++) for (let i = 0; i < GN - 1; i++) {
    const a = gi(i, j), b = gi(i + 1, j), c = gi(i, j + 1), d = gi(i + 1, j + 1);
    idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d;
  }
  sandGeo = new THREE.BufferGeometry();
  sandGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sandGeo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  sandGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  sandGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  sandGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.3, 0), TRAY * 0.8);
  sandGeo.boundingBox = new THREE.Box3(new THREE.Vector3(-HALF, MINH, -HALF), new THREE.Vector3(HALF, MAXH, HALF));
  const uv = new Float32Array(n * 2);
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) { const k = gi(i, j) * 2; uv[k] = (i * CELL - HALF + TRAY_C.x) / 0.3; uv[k + 1] = (j * CELL - HALF + TRAY_C.z) / 0.3; }
  sandGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); sandGeo.setAttribute('aWet', new THREE.BufferAttribute(new Float32Array(n), 1));
  sandMesh = new THREE.Mesh(sandGeo, sandMaterial(false));
  sandMesh.position.set(TRAY_C.x, TRAY_C.y - BASE, TRAY_C.z);        // untouched sand sits at y = 0, flush with the beach
  sandMesh.frustumCulled = false;
  sandMesh.castShadow = true; sandMesh.receiveShadow = true;
  scene.add(sandMesh);

  // protected cells: the picnic pad and a thin border so the patch always meets the beach seamlessly
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
    const lx = i * CELL - HALF, lz = j * CELL - HALF;
    if (i < 4 || j < 4 || i > GN - 5 || j > GN - 5 || (Math.abs(lx) < 0.8 && Math.abs(lz) < 0.66)) PROT[gi(i, j)] = 1;
  }
  markAll();
}

let DRY = [DRY_C.r, DRY_C.g, DRY_C.b], WET = [DRY_C.r * 0.60, DRY_C.g * 0.57, DRY_C.b * 0.53];   // wet sand: same hue, much darker
function updateSandGeo() {
  if (!dirty) return;
  const r = { i0: Math.max(0, dirty.i0 - 1), i1: Math.min(GN - 1, dirty.i1 + 1), j0: Math.max(0, dirty.j0 - 1), j1: Math.min(GN - 1, dirty.j1 + 1) };
  dirty = null;
  const pos = sandGeo.attributes.position, nor = sandGeo.attributes.normal, col = sandGeo.attributes.color, wetA = sandGeo.attributes.aWet;
  const P = pos.array, N = nor.array, C = col.array, WA = wetA.array;
  for (let j = r.j0; j <= r.j1; j++) {
    for (let i = r.i0; i <= r.i1; i++) {
      const id = gi(i, j), k = id * 3, h = sand[id];
      P[k + 1] = h;
      const nx = (sand[gi(Math.max(0, i - 1), j)] - sand[gi(Math.min(GN - 1, i + 1), j)]) / (2 * CELL);
      const nz = (sand[gi(i, Math.max(0, j - 1))] - sand[gi(i, Math.min(GN - 1, j + 1))]) / (2 * CELL);
      const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
      N[k] = nx * inv; N[k + 1] = inv; N[k + 2] = nz * inv;
      const w = Math.max(wet[id], wetSea[id], smoothstep(BASE - 0.015, BASE - 0.06, h)), dryness = 1 - w; WA[id] = Math.max(w * 0.9, Math.min(1, (fd[id] + pw[id]) * 40));
      const _dry = dryness, slope = 0.86 + 0.14 * inv, g = (1 + grain[id]) * slope;
      C[k] = (WET[0] + (DRY[0] - WET[0]) * dryness) * g;
      C[k + 1] = (WET[1] + (DRY[1] - WET[1]) * dryness) * g;
      C[k + 2] = (WET[2] + (DRY[2] - WET[2]) * dryness) * g;
    }
  }
  for (const a of [pos, nor, col, wetA]) {
    if (!firstUpload) { a.clearUpdateRanges(); a.addUpdateRange(r.j0 * GN * 3, (r.j1 - r.j0 + 1) * GN * 3); }
    a.needsUpdate = true;
  }
  firstUpload = false;
  renderer.shadowMap.needsUpdate = true;
  settleDecos();
  waterDirty = true;
}

function heightAt(lx, lz) {
  const fx = (lx + HALF) / CELL, fz = (lz + HALF) / CELL;
  const i = clamp(Math.floor(fx), 0, GN - 2), j = clamp(Math.floor(fz), 0, GN - 2);
  const tx = clamp(fx - i, 0, 1), tz = clamp(fz - j, 0, 1);
  return sand[gi(i, j)] * (1 - tx) * (1 - tz) + sand[gi(i + 1, j)] * tx * (1 - tz)
       + sand[gi(i, j + 1)] * (1 - tx) * tz + sand[gi(i + 1, j + 1)] * tx * tz;
}

// analytic heightfield raycast (a triangle raycast against 130k tris per frame would be far too slow)
function raySand(origin, dir, out) {
  const ox = origin.x - TRAY_C.x, oz = origin.z - TRAY_C.z;
  const oy = origin.y - TRAY_C.y + BASE;                       // in height units (flat sand = BASE)
  const dx = dir.x, dy = dir.y, dz = dir.z;
  let t0 = 0, t1 = 1e9;
  const slab = (o, d, lo, hi) => {
    if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
    let a = (lo - o) / d, b = (hi - o) / d; if (a > b) { const x = a; a = b; b = x; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); return t0 <= t1;
  };
  if (!slab(ox, dx, -HALF, HALF) || !slab(oy, dy, MINH, MAXH + 0.02) || !slab(oz, dz, -HALF, HALF)) return false;
  const step = CELL * 0.7;
  let prev = t0, t = t0;
  const below = (tt) => (oy + dy * tt) <= heightAt(ox + dx * tt, oz + dz * tt);
  if (!below(t0)) {
    let found = false;
    for (t = t0 + step; t <= t1 + step; t += step) {
      const tt = Math.min(t, t1);
      if (below(tt)) { found = true; t = tt; break; }
      prev = tt;
      if (tt >= t1) break;
    }
    if (!found) return false;
    let lo = prev, hi = t;
    for (let k = 0; k < 10; k++) { const mid = (lo + hi) / 2; if (below(mid)) hi = mid; else lo = mid; }
    t = hi;
  } else t = t0;
  out.on = true; out.lx = ox + dx * t; out.lz = oz + dz * t; out.y = TRAY_C.y + (oy + dy * t) - BASE; out.dist = t;
  return true;
}

// ---------- sand editing (the cheated physics) ----------
function cellRect(lx, lz, rm, extra = 0) {
  const ci = (lx + HALF) / CELL, cj = (lz + HALF) / CELL, rc = rm / CELL + extra;
  return { ci, cj, rc, i0: Math.max(0, Math.floor(ci - rc)), i1: Math.min(GN - 1, Math.ceil(ci + rc)), j0: Math.max(0, Math.floor(cj - rc)), j1: Math.min(GN - 1, Math.ceil(cj + rc)) };
}

// ----- water economy: building costs bucket water; wet sand holds steep walls, dry sand slumps flat -----
function spendWater(units) {
  if (units <= 0) return bucketWater > 0.02;
  if (bucketWater >= units) { bucketWater -= units; return true; }
  bucketWater = 0; return false;
}
const wetEff = (c) => (sand[c] < BASE - 0.02 ? 1 : wet[c]);      // sand below beach level is naturally damp

function brushPile(lx, lz, dt, dir) {
  const r = cellRect(lx, lz, brush);
  const rate = (dir > 0 ? 0.55 : 0.4) * dt * dir;
  const watered = dir > 0 && spendWater(0.7 * dt);                // piling uses water; the pile is wet only if it got some
  for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
    const d = Math.hypot(i - r.ci, j - r.cj) / r.rc; if (d > 1) continue;
    const id = gi(i, j); if (PROT[id]) continue;
    const f = smoothstep(1, 0, d);
    sand[id] = clamp(sand[id] + rate * f + (Math.random() - 0.5) * 0.0016 * f * (watered ? 0.4 : 1), MINH, MAXH);    // loose grains: tool marks and a little crumble
    if (watered && f > 0.2) wet[id] = 1;
  }
  slumpRect(r, 2); markDirty(r.i0 - 4, r.i1 + 4, r.j0 - 4, r.j1 + 4);
}
function brushSmooth(lx, lz, dt) {
  const r = cellRect(lx, lz, brush);
  const k = Math.min(1, dt * 9);
  for (let j = Math.max(1, r.j0); j <= Math.min(GN - 2, r.j1); j++) for (let i = Math.max(1, r.i0); i <= Math.min(GN - 2, r.i1); i++) {
    const d = Math.hypot(i - r.ci, j - r.cj) / r.rc; if (d > 1) continue;
    const id = gi(i, j); if (PROT[id]) continue;
    const avg = (sand[id - 1] + sand[id + 1] + sand[id - GN] + sand[id + GN] + sand[id]) / 5;
    sand[id] += (avg - sand[id]) * smoothstep(1, 0, d) * k;
  }
  markDirty(r.i0, r.i1, r.j0, r.j1);
}
// angle-of-repose cheat, only around where the hand just worked. Wet sand holds a far steeper slope.
function slumpRect(r, iter) {
  const i0 = Math.max(0, r.i0 - 3), i1 = Math.min(GN - 1, r.i1 + 3), j0 = Math.max(0, r.j0 - 3), j1 = Math.min(GN - 1, r.j1 + 3);
  for (let k = 0; k < iter; k++) {
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = gi(i, j), hc = sand[c];
      if (PROT[c]) continue;
      const wc = wetEff(c);
      for (let q = 0; q < 4; q++) {
        const ni = i + (q === 0 ? -1 : q === 1 ? 1 : 0), nj = j + (q === 2 ? -1 : q === 3 ? 1 : 0);
        if (ni < 0 || nj < 0 || ni >= GN || nj >= GN) continue;
        const n = gi(ni, nj); if (PROT[n]) continue;
        const maxStep = CELL * (0.75 + 3.4 * Math.max(wc, wetEff(n)));
        const diff = hc - sand[n];
        if (diff > maxStep) { const m = (diff - maxStep) * 0.25; sand[c] -= m; sand[n] += m; }
      }
    }
  }
}

// wall: a ridge with crenellations along the stroke. With water it is tall, steep and wet; dry it is a low, wide mound.
function stampWall(lx, lz, travel, seg = 0) {
  const watered = spendWater(0.3 * seg) || (seg === 0 && bucketWater > 0.02);
  const w0 = Math.max(brush * 0.35, 2.2 * CELL), H0 = clamp(0.1 + brush * 1.2, 0.15, 0.36);
  const w = watered ? w0 : w0 * 1.6, H = watered ? H0 : H0 * 0.42;
  const crenel = watered && Math.floor(travel / (w * 2.2)) % 2 ? 0.8 : 1;
  const r = cellRect(lx, lz, w * 1.6);
  for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
    const d = Math.hypot(i - r.ci, j - r.cj) * CELL; if (d > w * 1.6) continue;
    const id = gi(i, j); if (PROT[id]) continue;
    const prof = d < w * 0.7 ? 1 : 1 - smoothstep(w * 0.7, w * 1.6, d);
    sand[id] = Math.max(sand[id], Math.min(MAXH, BASE + H * crenel * prof + (prof < 0.9 ? (Math.random() - 0.5) * 0.004 * (watered ? 0.5 : 1.2) : 0)));   // ragged crumbly edges
    if (watered && prof > 0.25) wet[id] = 1;
  }
  if (!watered) slumpRect(r, 3);
  markDirty(r.i0 - 3, r.i1 + 3, r.j0 - 3, r.j1 + 3);
}
// moat: a flat-bottomed channel dug well below beach level (12 cm), so the tide can fill it
function stampMoat(lx, lz) {
  const m = Math.max(brush * 0.8, 3 * CELL), floor = BASE - 0.12;
  const r = cellRect(lx, lz, m * 1.35);
  for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
    const d = Math.hypot(i - r.ci, j - r.cj) * CELL; if (d > m * 1.35) continue;
    const id = gi(i, j); if (PROT[id]) continue;
    const t = d < m * 0.55 ? 1 : 1 - smoothstep(m * 0.55, m * 1.35, d);
    sand[id] = Math.min(sand[id], sand[id] * (1 - t) + floor * t);
  }
  slumpRect(r, 1); markDirty(r.i0 - 3, r.i1 + 3, r.j0 - 3, r.j1 + 3);
}
// bucket-molded tower: flat-topped, lightly tapered, battlements — wet sand holds it; dry sand gives a low slumped mound
function stampTower(lx, lz, R, H) {
  R = R ?? clamp(brush * 1.6, 0.12, 0.6); H = H ?? Math.min(MAXH, R * 1.9);
  const watered = spendWater(1.0 * (R / 0.2));
  if (!watered) H *= 0.5;
  const r = cellRect(lx, lz, R * 1.15);
  const k = Math.max(6, Math.round(R / 0.035));
  for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
    const d = Math.hypot(i - r.ci, j - r.cj) * CELL; if (d > R * 1.15) continue;
    const id = gi(i, j); if (PROT[id]) continue;
    let h;
    if (d < R * 0.78) h = H;
    else if (d < R) h = H * (1 - ((d - R * 0.78) / (R * 0.22)) * 0.5);
    else h = H * 0.5 * (1 - (d - R) / (R * 0.15));
    if (watered && d > R * 0.6 && d < R * 0.82) {
      const ang = Math.atan2(j - r.cj, i - r.ci);
      if (Math.cos(ang * k) > 0.25) h += 0.05 * (R / 0.2);
    }
    sand[id] = Math.max(sand[id], Math.min(MAXH, BASE + h + (d > R * 0.7 ? (Math.random() - 0.5) * 0.006 : 0)));
    if (watered) wet[id] = 1;
  }
  if (!watered) slumpRect(r, 5);
  markDirty(r.i0 - 3, r.i1 + 3, r.j0 - 3, r.j1 + 3);
}

// ----- pools: reading, scooping and draining water that sits in holes / floods the beach -----
function waterDepthAt(lx, lz) {
  const i = clamp(Math.round((lx + HALF) / CELL), 0, GN - 1), j = clamp(Math.round((lz + HALF) / CELL), 0, GN - 1);
  const c = gi(i, j);
  return Math.max(pw[c], fd[c]);
}
// take `units` of water out of the pool around a point; returns how much was actually gathered
function drawWater(lx, lz, units) {
  const r = cellRect(lx, lz, 0.16);
  let avail = 0, n = 0;
  for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
    const c = gi(i, j); if (pw[c] > 0.004 && Math.hypot(i - r.ci, j - r.cj) <= r.rc) { avail += pw[c]; n++; }
  }
  if (!n) return 0;
  const AREA = n * CELL * CELL * 1000;                  // litres per metre of depth over those cells
  const got = Math.min(units, avail / n * AREA * 0.9);
  const dec = got / AREA;                               // metres removed from each cell
  for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
    const c = gi(i, j); if (pw[c] > 0.004 && Math.hypot(i - r.ci, j - r.cj) <= r.rc) pw[c] = Math.max(0, pw[c] - dec);
  }
  waterDirty = true;
  return got;
}
// the bucket (or the desktop Scoop tool) filling from a pool
function fillBucketAt(lx, lz, units) {
  if (bucketWater >= BUCKET_CAP) return;
  const got = drawWater(lx, lz, Math.min(units, BUCKET_CAP - bucketWater));
  bucketWater += got;
}

// ---------- decorations (flag / shell / starfish) ----------
let decos = [];                       // [{type,x,z,rot,color,s,mesh}]
const SHELL_COLORS = [0xf3d9d0, 0xeabfcb, 0xf0e4d2, 0xf7e7b4], FLAG_COLORS = [0xe84a3c, 0xf2b630, 0x3f86d6, 0x4fb477];
let starGeo = null;
function makeDecoMesh(d) {
  const g = new THREE.Group();
  if (d.type === 'flag') {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.5, 6), new THREE.MeshLambertMaterial({ color: 0xf2eee4 }));
    pole.position.y = 0.25; g.add(pole);
    const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.2, -0.065); sh.lineTo(0, -0.13); sh.closePath();
    const cloth = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshLambertMaterial({ color: d.color, side: THREE.DoubleSide }));
    cloth.position.set(0.006, 0.49, 0); g.add(cloth);
  } else if (d.type === 'shell') {
    const m = new THREE.MeshLambertMaterial({ color: d.color });
    if (d.s > 0.5) {                                   // scallop
      g.add(new THREE.Mesh(RZ.scallopGeometry(), new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.4 })));
    } else {                                           // spiral
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 9), m);
      cone.rotation.z = Math.PI / 2 - 0.35; cone.position.y = 0.035; g.add(cone);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.04, 9, 7), m); ball.position.set(-0.03, 0.04, 0); g.add(ball);
    }
  } else {
    if (!starGeo) {
      const sh = new THREE.Shape();
      for (let q = 0; q < 10; q++) { const a = q * Math.PI / 5 - Math.PI / 2, rr = q % 2 ? 0.035 : 0.095; q ? sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      sh.closePath();
      starGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.014, bevelEnabled: false });
      starGeo.rotateX(-Math.PI / 2);
    }
    g.add(new THREE.Mesh(starGeo, new THREE.MeshLambertMaterial({ color: 0xe9894a })));
  }
  g.traverse((o) => { o.castShadow = true; });
  return g;
}
function addDeco(d) {
  d.mesh = makeDecoMesh(d);
  d.mesh.rotation.y = d.rot;
  decoGroup.add(d.mesh); decos.push(d);
  placeDeco(d);
  renderer.shadowMap.needsUpdate = true;
}
function placeDeco(d) {
  d.mesh.position.set(TRAY_C.x + d.x, TRAY_C.y + heightAt(d.x, d.z) - BASE - (d.type === 'flag' ? 0.03 : 0.004), TRAY_C.z + d.z);
}
function settleDecos() { for (const d of decos) placeDeco(d); }
function clearDecos() { for (const d of decos) decoGroup.remove(d.mesh); decos = []; }
function placeDecoAt(type, lx, lz) {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  addDeco({ type, x: lx, z: lz, rot: Math.random() * Math.PI * 2, s: Math.random(),
    color: type === 'flag' ? pick(FLAG_COLORS) : pick(SHELL_COLORS) });
}

// ---------- undo ----------
const undoStack = [];
function pushUndo() {
  undoStack.push({ sand: sand.slice(), wet: wet.slice(), decos: decos.map((d) => ({ type: d.type, x: d.x, z: d.z, rot: d.rot, s: d.s, color: d.color })) });
  if (undoStack.length > 20) undoStack.shift();
}
function undo() {
  const u = undoStack.pop(); if (!u) return;
  sand.set(u.sand); wet.set(u.wet); clearDecos(); u.decos.forEach((d) => addDeco({ ...d })); markAll();
}
function resetSand() { pushUndo(); sand.fill(BASE); wet.fill(0); wetSea.fill(0); pw.fill(0); clearDecos(); markAll(); }

// ============================ the picnic ============================
const picnicItems = [];
function gingham() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#fbf6ee'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(214,52,60,0.75)';
  for (let k = 0; k < 8; k += 2) { g.fillRect(k * 32, 0, 32, 256); g.fillRect(0, k * 32, 256, 32); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 2.3);
  t.anisotropy = 8; return t;
}
function buildPicnic() {
  picnic = new THREE.Group(); picnic.position.set(TRAY_C.x, TRAY_C.y, TRAY_C.z); scene.add(picnic);
  const add = (obj, thr, x, z, y = 0, rot = 0) => {
    obj.position.set(x, y, z); obj.rotation.y = rot; obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    picnic.add(obj); picnicItems.push({ mesh: obj, thr, gone: false, t: 0, z0: z, y0: y }); return obj;
  };
  const blanket = RZ.buildBlanket(); picnic.add(blanket); picnic.userData.blanket = blanket;   // woven gingham with folds
  const R = RZ.rng(12);
  add(RZ.buildBasket(), 0.25, -0.38, -0.12, 0.006, 0.3);
  add(RZ.buildWatermelonSlice(), 0.36, 0.3, -0.25, 0.024, 0.8);
  add(RZ.buildPlate(), 0.9, 0.05, 0.2, 0.006);
  add(RZ.buildCheese(), 0.66, 0.06, 0.2, 0.012, 0.6);
  add(RZ.buildBread(), 0.72, 0.14, 0.02, 0.006, 0.55);
  add(RZ.buildApple(R), 0.85, 0.3, 0.18, 0.006);
  add(RZ.buildApple(R), 0.8, 0.37, 0.09, 0.006, 1.2);
  add(RZ.buildCupcake(), 0.6, -0.15, 0.3, 0.006);
  add(RZ.buildBottle(), 0.48, -0.6, 0.25, 0.006);
  add(RZ.buildEnamelCup(0x2f6fb5), 0.55, -0.43, 0.36, 0.006);
  add(RZ.buildEnamelCup(0xc9473a), 0.5, -0.33, 0.43, 0.006, 1.2);
  const um = RZ.buildUmbrella(); um.rotation.z = 0.08; add(um, 0.12, 0.62, -0.38, 0);          // beach umbrella (last to go)
}

// ---------- tide ----------
// ---------- the tide IS the shoreline: the visible foam front (procgen/water.js createShoreline) decides what floods ----------
const STRENGTH_NAMES = ['Calm', 'Normal', 'Wild'];
const RUNUPS = [5.2, 7.0, 8.6];                         // metres the biggest swash reaches up the beach from the waterline
const SHORE_BASE_Z = -9.1, SHORE_PERIOD = 12;
const PATCH_D0 = (TRAY_C.z - HALF) - SHORE_BASE_Z;     // 3.6 m from the waterline to the sculpting patch
const tide = { on: true, strength: 1, wave: 0, waves: 8, grace: 25, start: 25, lvl: 0.05, health: 1, state: 'play', acc: 0, lastN: -1 };
const fd = new Float32Array(GN * GN);        // flood depth per cell
const fdist = new Int16Array(GN * GN);
const fq = new Int32Array(GN * GN);
const reachCol = new Float32Array(GN);       // how far into the patch the visible front has reached, per column (m)
let waterDirty = true, waterAcc = 0;
function syncShore() { shore.uniforms.uShoreP.value.y = RUNUPS[tide.strength]; }     // the shader's run-up follows the chosen strength

function restartTide() { tide.state = 'play'; tide.start = wt + tide.grace; tide.lastN = -1; fd.fill(0); waterDirty = true; }
function restartPicnic() {
  tide.health = 1;
  for (const it of picnicItems) { it.gone = false; it.t = 0; it.mesh.visible = true; it.mesh.scale.setScalar(1); it.mesh.position.z = it.z0; it.mesh.position.y = it.y0; }
  restartTide();
}

// Flood fill driven by the shoreline's own front: a patch cell is reached iff the visible foam line has got that far up the beach
// at that cell's lateral position, and every cell on the way is lower than the water surface (so walls block, holes fill).
function computeFlood(dtEro) {
  fd.fill(0);
  const sh = shores[tide.strength], t = wt, zEdge = TRAY_C.z - HALF;
  let any = false, mid = null;
  for (let i = 0; i < GN; i++) {
    const u = sh.coords(i * CELL - HALF + TRAY_C.x, zEdge).u, f = sh.front(u, t);
    reachCol[i] = f.s - PATCH_D0; if (reachCol[i] > 0.02) any = true;
    if (i === GN >> 1) mid = f;
  }
  if (!any) return false;
  const surgeK = mid.surging ? 1 : Math.max(0.35, 1 - (mid.tau - 0.3) / 0.7);
  tide.lvl = 0.02 + 0.07 * (mid.smax / RUNUPS[tide.strength]) * surgeK;      // a stronger wave piles the water a little higher
  const S = BASE + tide.lvl;
  fdist.fill(-1);
  let qh = 0, qt = 0;
  for (let i = 0; i < GN; i++) for (let j = 0; j < 3; j++) { const c = gi(i, j); if (reachCol[i] > j * CELL && sand[c] <= S) { fdist[c] = 0; fq[qt++] = c; } }
  let e0 = GN, e1 = 0, f0 = GN, f1 = 0, changed = false;
  const touch = (c) => { const ci = c % GN, cj = (c / GN) | 0; e0 = Math.min(e0, ci); e1 = Math.max(e1, ci); f0 = Math.min(f0, cj); f1 = Math.max(f1, cj); changed = true; };
  while (qh < qt) {
    const c = fq[qh++], h = sand[c], ci = c % GN, cj = (c / GN) | 0;
    const depthRaw = S - h, lead = Math.max(0, reachCol[ci] - cj * CELL) * 0.35;      // thin wedge right at the foam line
    const hole = h < BASE - 0.004;
    const dep = Math.max(0, hole ? depthRaw : Math.min(depthRaw, lead));            // holes fill all the way to the water line
    fd[c] = dep;
    if (hole && dep > pw[c]) pw[c] = dep;                                           // …and keep that water after the sea draws back
    if (dep > 0.005 && wetSea[c] < 1) { wetSea[c] = 1; touch(c); }
    if (dep > 0.01 && h > BASE + 0.003 && !PROT[c]) {                              // the sea nibbles at low mounds (dry ones fastest)
      sand[c] -= (h - BASE) * 0.6 * dtEro * (1 - 0.85 * wet[c]); touch(c);
    }
    for (let q = 0; q < 4; q++) {
      if ((q === 0 && ci === 0) || (q === 1 && ci === GN - 1) || (q === 2 && cj === 0) || (q === 3 && cj === GN - 1)) continue;
      const n = c + (q === 0 ? -1 : q === 1 ? 1 : q === 2 ? -GN : GN), ni = n % GN, nj = (n / GN) | 0;
      if (fdist[n] >= 0 || nj * CELL > reachCol[ni]) continue;                       // the front has not got there yet
      if (sand[n] <= S) { fdist[n] = 1; fq[qt++] = n; }
      else if (!PROT[n]) {                                                           // water lapping at a wall: wet walls shrug it off, dry ones crumble
        sand[n] -= (sand[n] - BASE) * 0.05 * dtEro * (1 - 0.88 * wet[n]);
        if (wet[n] < 0.6) wet[n] = Math.min(1, wet[n] + 0.1);
        touch(n);
      }
    }
  }
  if (changed) markDirty(e0 - 1, e1 + 1, f0 - 1, f1 + 1);
  return true;
}

// pools seep away once the sea has pulled back; wet sand slowly dries
let wetTimer = 0;
function drainPools(step) {
  let any = false;
  const drain = 0.0065 * step;                                  // ≈ 40 cm per minute: a window to use the water
  for (let c = 0; c < GN * GN; c++) {
    if (pw[c] > 0) { pw[c] = Math.max(0, pw[c] - drain); any = true; }
  }
  if (any) waterDirty = true;
  wetTimer += step;
  if (wetTimer > 3) {
    let ch = false; const dec = wetTimer * 0.004, dec2 = wetTimer / 30; wetTimer = 0;
    for (let c = 0; c < GN * GN; c++) { if (wet[c] > 0) { wet[c] = Math.max(0, wet[c] - dec); ch = true; } if (wetSea[c] > 0) { wetSea[c] = Math.max(0, wetSea[c] - dec2); ch = true; } }
    if (ch) markAll();
  }
}

let floodActive = false, surgingNow = false;
function updateTide(dt) {                                      // dt is 0 while paused, and the shoreline time wt is frozen too
  tide.acc += dt;
  if (tide.acc >= 0.2) {                                       // flood-fill 5×/s
    const step = tide.acc; tide.acc = 0;
    drainPools(step);
    const flooded = tide.on ? computeFlood(step) : false;
    if (flooded || floodActive) { if (!flooded) fd.fill(0); waterDirty = true; }
    floodActive = flooded;
    const playing = tide.on && tide.state === 'play' && wt >= tide.start;
    if (playing) {
      tide.wave = Math.floor((wt - tide.start) / SHORE_PERIOD);
      if (tide.wave !== tide.lastN) { tide.lastN = tide.wave; if (actx && soundOn) whoosh(); }
      if (flooded) {                                           // picnic damage: how much of the blanket is under water?
        let wetN = 0, n = 0;
        for (let x = -0.6; x <= 0.61; x += 0.15) for (let z = -0.45; z <= 0.46; z += 0.15) {
          const i = clamp(Math.round((x + HALF) / CELL), 0, GN - 1), j = clamp(Math.round((z + HALF) / CELL), 0, GN - 1);
          n++; if (fd[gi(i, j)] > 0.012) wetN++;
        }
        const frac = wetN / n;
        if (frac > 0) tide.health = Math.max(0, tide.health - frac * step * 0.07);
        if (tide.health <= 0) tide.state = 'lost';
      }
      if (tide.state === 'play' && tide.wave >= tide.waves) tide.state = 'won';
    }
    surgingNow = flooded && shores[tide.strength].front(0, wt).surging;
    setStatus();
  }
  // washed-away items
  for (const it of picnicItems) {
    const shouldGo = tide.health <= it.thr;
    if (shouldGo && !it.gone) { it.gone = true; it.t = 0; }
    if (it.gone && it.t < 1.6) { it.t += dt; it.mesh.position.z += dt * 0.45; it.mesh.position.y = it.y0 + Math.sin(it.t * 6) * 0.01; const s = Math.max(0.001, 1 - it.t / 1.6); it.mesh.scale.setScalar(s); if (it.t >= 1.6) it.mesh.visible = false; }
  }
}

function updateWater(t) {
  waterMesh.material.uniforms.time.value = t;
  waterAcc += 1;
  if (!waterDirty || waterAcc < (qLevel >= 1 ? 8 : 4)) return;           // ≤ 15 Hz
  waterDirty = false; waterAcc = 0;
  const P = waterMesh.geometry.attributes.position, D = waterMesh.geometry.attributes.aDepth;
  for (let c = 0; c < GN * GN; c++) {
    const h = sand[c], d = Math.max(fd[c], pw[c]);
    P.array[c * 3 + 1] = h + d + 0.004; D.array[c] = d;
  }
  P.needsUpdate = true; D.needsUpdate = true;
}
function buildWater() {
  const n = GN * GN;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) { const k = gi(i, j) * 3; pos[k] = i * CELL - HALF; pos[k + 1] = BASE; pos[k + 2] = j * CELL - HALF; }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setIndex(sandGeo.index);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.3, 0), TRAY * 0.8);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 }, sunD: { value: sunDir } },
    vertexShader: `attribute float aDepth; varying float vD; varying vec3 vW; varying float vX;
      void main(){ vD = aDepth; vX = position.x; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying float vD; varying vec3 vW; varying float vX; uniform float time; uniform vec3 sunD;
      void main(){
        float a = smoothstep(0.0, 0.012, vD) * smoothstep(0.0, 0.7, ${HALF.toFixed(3)} - abs(vX));
        if (a < 0.01) discard;
        // gentle ripple normals
        vec2 g = vec2(cos((vW.x + vW.z * 0.6) * 7.0 + time * 1.6) * 3.5 + cos((vW.x * 0.4 - vW.z) * 9.0 - time * 1.3) * 1.8,
                      cos((vW.x + vW.z * 0.6) * 7.0 + time * 1.6) * 2.1 - cos((vW.x * 0.4 - vW.z) * 9.0 - time * 1.3) * 4.5) * 0.012;
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
        vec3 absorb = mix(vec3(0.42, 0.60, 0.50), vec3(0.03, 0.19, 0.27), smoothstep(0.0, 0.16, vD));   // sandy shallows → deeper blue-green (refraction-ish tint)
        vec3 col = mix(absorb, vec3(0.66, 0.80, 0.92), fres * 0.85 + 0.04);
        vec3 H = normalize(V + normalize(sunD));
        col += vec3(1.0, 0.95, 0.82) * pow(max(dot(N, H), 0.0), 240.0) * 1.8;                           // sun glint
        float rim = smoothstep(0.0, 0.003, vD) * (1.0 - smoothstep(0.003, 0.010, vD));                    // meniscus line
        float foam = 1.0 - smoothstep(0.0, 0.03, vD);
        col = mix(col, vec3(0.97, 0.98, 0.97), foam * 0.32 + rim * 0.4);
        gl_FragColor = vec4(col, a * mix(0.30, 0.9, smoothstep(0.0, 0.07, vD)));
        ${SHADER_TAIL}
      }`,
  });
  waterMesh = new THREE.Mesh(geo, mat);
  waterMesh.position.copy(sandMesh.position); waterMesh.frustumCulled = false; waterMesh.renderOrder = 3;
  scene.add(waterMesh);
}

// ---------- status label (desktop line + a floating billboard over the picnic) ----------
let statusMesh, statusCtx, statusTex, statusText = '';
function buildStatusLabel() {
  const c = document.createElement('canvas'); c.width = 768; c.height = 192; statusCtx = c.getContext('2d');
  statusTex = new THREE.CanvasTexture(c); statusTex.colorSpace = THREE.SRGBColorSpace;
  statusMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.375), new THREE.MeshBasicMaterial({ map: statusTex, transparent: true, depthTest: false, toneMapped: false, fog: false }));
  statusMesh.renderOrder = 950; statusMesh.position.set(TRAY_C.x, 1.9, TRAY_C.z); scene.add(statusMesh);
}
function setStatus() {
  const hearts = Math.ceil(tide.health * 5 - 1e-6), h = '♥'.repeat(Math.max(0, hearts)) + '♡'.repeat(5 - Math.max(0, hearts));
  let line2;
  if (!tide.on) line2 = 'Tide is off';
  else if (tide.state === 'won') line2 = 'The picnic is safe — enjoy! 🎉';
  else if (tide.state === 'lost') line2 = 'Washed away… press Restart in the menu';
  else if (wt < tide.start) line2 = 'Waves count from the first set in ' + Math.max(0, Math.ceil(tide.start - wt)) + ' s — build!';
  else line2 = 'Wave ' + Math.min(tide.waves, tide.wave + 1) + ' / ' + tide.waves + (surgingNow ? '  — incoming!' : '');
  const bk = ' 💧' + bucketWater.toFixed(1);
  const text = 'Picnic ' + h + bk + '|' + line2;
  if (text === statusText) return;
  statusText = text;
  const g = statusCtx;
  g.clearRect(0, 0, 768, 192);
  g.fillStyle = 'rgba(12,15,28,0.78)'; g.beginPath(); g.roundRect(4, 4, 760, 184, 40); g.fill();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffe9c2'; g.font = '700 70px system-ui, sans-serif'; g.fillText('Picnic ' + h + bk, 384, 66);
  g.fillStyle = tide.state === 'lost' ? '#ff9a9a' : '#cfe8ff'; g.font = '600 46px system-ui, sans-serif'; g.fillText(line2, 384, 140);
  statusTex.needsUpdate = true;
  const el = document.getElementById('status'); if (el) el.textContent = 'Picnic ' + h + '  ·  Bucket' + bk + '/' + BUCKET_CAP + '  ·  ' + line2;
}

// ---------- cursors (one per hand + mouse), sized to the brush ----------
const SRC = [];
function buildCursors() {
  for (let k = 0; k < 3; k++) {
    const col = k === 0 ? 0x6a4a20 : k === 1 ? 0xb8681e : 0x1e6fb8;
    const g = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2), ringMat);
    // an upright cone above the ring so the cursor reads even at the shallow, grazing view angle
    const coneMat = new THREE.MeshBasicMaterial({ color: 0xfff4d6, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.6, 12).rotateX(Math.PI), coneMat); cone.position.y = 0.62;
    g.add(ring, cone); g.visible = false; g.renderOrder = 5; ring.renderOrder = 5; cone.renderOrder = 6; scene.add(g);
    SRC.push({ id: k, down: false, tool: 'pile', hit: { on: false, lx: 0, lz: 0, y: 0, dist: 0 }, last: null, travel: 0, ring: g, mats: [ringMat, coneMat] });
  }
}
function cursorRadius(tl) {
  return tl === 'tower' ? clamp(brush * 1.6, 0.12, 0.6) : CLICK_TOOLS.has(tl) ? 0.06 : tl === 'wall' ? Math.max(brush * 0.35, 0.035) * 1.6 : brush;
}
// which tool a source is using: the menu tool, or what the hand is holding
function toolFor(s) {
  if (s.id === 0 || !kit) return tool;
  const t = kit.heldBy(s.id - 1);
  if (!t) return tool;
  return t.name === 'Spade' ? 'dig' : t.name === 'Bucket' ? 'tower' : null;
}

// ---------- strokes ----------
function beginStroke(s) {
  s.tool = toolFor(s);
  if (!s.tool || !s.hit.on) return;
  if (s.tool !== 'scoop') pushUndo();
  s.down = true; s.last = null; s.travel = 0;
  if (CLICK_TOOLS.has(s.tool)) {
    const { lx, lz } = s.hit;
    if (s.tool === 'tower') stampTower(lx, lz);
    else placeDecoAt(s.tool === 'flag' ? 'flag' : s.tool === 'shell' ? 'shell' : 'star', lx, lz);
    s.down = false;
  }
}
function endStroke(s) { s.down = false; s.last = null; }

function strokeLine(s, fn) {
  const { lx, lz } = s.hit;
  if (s.last) {
    const dx = lx - s.last.x, dz = lz - s.last.z, len = Math.hypot(dx, dz);
    const step = Math.max(CELL, brush * 0.25), n = Math.max(1, Math.ceil(len / step));
    for (let q = 1; q <= n; q++) { s.travel += len / n; fn(s.last.x + dx * q / n, s.last.z + dz * q / n, s.travel, len / n); }
  } else fn(lx, lz, 0, 0);
  s.last = { x: lx, z: lz };
}
function applyStroke(s, dt) {
  const { lx, lz } = s.hit;
  switch (s.tool) {
    case 'pile': brushPile(lx, lz, dt, 1); break;
    case 'dig': brushPile(lx, lz, dt, -1); break;
    case 'smooth': brushSmooth(lx, lz, dt); break;
    case 'wall': strokeLine(s, stampWall); break;
    case 'moat': strokeLine(s, stampMoat); break;
    case 'scoop': fillBucketAt(lx, lz, 4 * dt); break;
    default: break;
  }
}

function selectTool(id) { tool = id; if (menu) menu.refresh(); }
function cycleTool(d) {
  const ids = TOOLS.map((t) => t[1]);
  selectTool(ids[(ids.indexOf(tool) + d + ids.length) % ids.length]);
}
function stepBrush(d) { brushIdx = clamp(brushIdx + d, 0, BRUSHES.length - 1); brush = BRUSHES[brushIdx]; if (menu) menu.refresh(); }

// ---------- zoom: from sand grains to a high overview ----------
function zoomText() {
  const z = renderer && renderer.xr.isPresenting ? 1 / dolly.scale.x : START_DIST / orbit.dist;
  return '×' + (z >= 10 ? z.toFixed(0) : z.toFixed(2).replace(/\.?0+$/, ''));
}
function setDollyScale(s) {
  s = clamp(s, SCALE_MIN, SCALE_MAX);
  camera.getWorldPosition(_a);
  dolly.scale.setScalar(s); dolly.updateMatrixWorld(true);
  camera.getWorldPosition(_b);
  dolly.position.add(_a.sub(_b));         // keep your head where it was; the world grows/shrinks around you
}
function zoomBy(d) {
  if (renderer.xr.isPresenting) { const s0 = dolly.scale.x; comfort.fade(() => setDollyScale(s0 / (d > 0 ? 1.6 : 1 / 1.6)), 0.14, 0.3); }   // stepped zoom through a quick fade — never a slide
  else orbit.dist = clamp(orbit.dist * (d > 0 ? 0.65 : 1 / 0.65), MIN_DIST, MAX_DIST);
  if (menu) menu.refresh();
}
function recenter() {
  if (renderer.xr.isPresenting) { dolly.scale.setScalar(1); recenterRig(dolly, camera, VR_HOME, 0); dolly.position.y = 0; }
  else { orbit.yaw = 0; orbit.pitch = START_PITCH; orbit.dist = START_DIST; orbit.target.set(0, 0.25, TRAY_C.z); }
}
function setBackdrop(visible) {            // passthrough on = hide sky/beach/sea/crate; the sand, picnic and tools stay
  env.visible = visible;
  scene.background = visible ? horizonColor : null;
}

// ============================ hand tools ============================
let crateTools = [], bucketWaterMesh, bucketGauge, gaugeCtx, gaugeTex, cupWaterMesh, gaugeShown = -1;
function buildTools() {
  const spade = RZ.buildSpade();                // working end along −z, origin = grip
  const bucket = RZ.buildBucket();
  // water inside the bucket + a floating gauge so you can always see how much you have
  bucketWaterMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.099, 0.09, 0.01, 20), new THREE.MeshBasicMaterial({ color: 0x3aa8d8, transparent: true, opacity: 0.9, toneMapped: false }));
  bucketWaterMesh.visible = false; bucket.add(bucketWaterMesh);
  const gc = document.createElement('canvas'); gc.width = 256; gc.height = 96; gaugeCtx = gc.getContext('2d');
  gaugeTex = new THREE.CanvasTexture(gc); gaugeTex.colorSpace = THREE.SRGBColorSpace;
  bucketGauge = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.075), new THREE.MeshBasicMaterial({ map: gaugeTex, transparent: true, depthTest: false, toneMapped: false, fog: false }));
  bucketGauge.renderOrder = 960; bucketGauge.position.y = 0.2; bucket.add(bucketGauge);
  // cup: dip it in a pool, then tip it over the bucket
  const cup = RZ.buildCup();
  cupWaterMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.035, 0.008, 18), new THREE.MeshBasicMaterial({ color: 0x3aa8d8, transparent: true, opacity: 0.9, toneMapped: false }));
  cupWaterMesh.visible = false; cup.add(cupWaterMesh);
  // magnifying glass (gets the menu in registerTools so the wrist UI is hidden during its render pass)
  lens = createLens({ renderer, scene, camera, menu: null, radius: 0.1, zoom: 3 });
  crateTools = [spade, bucket, lens.group, cup];
  for (const t of [spade, bucket, cup]) t.traverse((o) => { if (o.isMesh && o !== bucketGauge) o.castShadow = true; });
  scene.add(spade, bucket, lens.group, cup);
}
function registerTools() {
  lens.menu = menu;
  const [spade, bucket, , cup] = crateTools;
  const top = CRATE.top;
  spade.position.set(CRATE.x - 0.2, top + 0.014, CRATE.z + 0.08); spade.rotation.y = 0.35;
  bucket.position.set(CRATE.x + 0.12, top + 0.08, CRATE.z - 0.02);
  cup.position.set(CRATE.x - 0.03, top + 0.035, CRATE.z + 0.12);
  lens.group.position.set(CRATE.x + 0.19, top + 0.016, CRATE.z + 0.13); lens.group.rotation.set(-Math.PI / 2, 0, 0.6);
  const groundAt = (x, z) => (Math.abs(x - CRATE.x) < 0.3 && Math.abs(z - CRATE.z) < 0.24) ? top : surfaceY(x, z);
  const pose = (r) => ({ pos: new THREE.Vector3(0, 0, -0.04), rot: new THREE.Euler(r, 0, 0) });
  kit.add({ name: 'Spade', object: spade, radius: 0.28, grip: pose(-0.35), home: 'ground', groundAt, restY: 0.014, restRot: new THREE.Euler(0, 0.35, 0) });
  kit.add({ name: 'Bucket', object: bucket, radius: 0.28, grip: { pos: new THREE.Vector3(0, 0, -0.16), rot: new THREE.Euler(0, 0, 0) }, home: 'ground', groundAt, restY: 0.08, restRot: new THREE.Euler(0, 0, 0) });
  kit.add({ name: 'Cup', object: cup, radius: 0.26, grip: { pos: new THREE.Vector3(0, 0, -0.1), rot: new THREE.Euler(-0.2, 0, 0) }, home: 'ground', groundAt, restY: 0.035, restRot: new THREE.Euler(0, 0, 0) });
  kit.add({
    name: 'Magnifier', object: lens.group, radius: 0.26, grip: { pos: new THREE.Vector3(0, 0.02, -0.3), rot: new THREE.Euler() },
    home: 'ground', groundAt, restY: 0.016, restRot: new THREE.Euler(-Math.PI / 2, 0, 0.6),
    onGrab: () => lens.setOn(true), onRelease: () => lens.setOn(false), onHeld: () => lens.faceEye(),
  });
}
// ---------- water carrying: dip the cup / bucket in a pool, tip the cup into the bucket ----------
const CUP_UNITS = 1.5;
function drawGauge() {
  const v = Math.round(bucketWater * 10);
  if (v === gaugeShown) return; gaugeShown = v;
  const g = gaugeCtx;
  g.clearRect(0, 0, 256, 96);
  g.fillStyle = 'rgba(12,15,28,0.82)'; g.beginPath(); g.roundRect(3, 3, 250, 90, 22); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.roundRect(16, 58, 224, 22, 10); g.fill();
  g.fillStyle = '#3aa8d8'; g.beginPath(); g.roundRect(16, 58, Math.max(0.001, 224 * bucketWater / BUCKET_CAP), 22, 10); g.fill();
  g.fillStyle = '#e8f6ff'; g.font = '700 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('💧 ' + (bucketWater).toFixed(1) + ' / ' + BUCKET_CAP, 128, 32);
  gaugeTex.needsUpdate = true;
}
const _bp = new THREE.Vector3(), _cp = new THREE.Vector3();
function surfaceWaterY(lx, lz) {            // world y of the water surface at a patch point (or -inf if dry)
  const d = waterDepthAt(lx, lz);
  return d > 0.006 ? TRAY_C.y + heightAt(lx, lz) - BASE + d : -9;
}
function toolsTick(dt) {
  const bt = kit.tools.find((t) => t.name === 'Bucket'), ct = kit.tools.find((t) => t.name === 'Cup');
  const bucket = bt.object, cup = ct.object;
  // bucket dipped straight into a deep-enough pool fills itself (forgiving: mouth anywhere near/below the surface)
  if (bt.state === 'held' && bucketWater < BUCKET_CAP) {
    bucket.localToWorld(_bp.set(0, 0.06, 0));
    const lx = _bp.x - TRAY_C.x, lz = _bp.z - TRAY_C.z;
    if (Math.abs(lx) < HALF && Math.abs(lz) < HALF && waterDepthAt(lx, lz) >= 0.035 && _bp.y <= surfaceWaterY(lx, lz) + 0.08) fillBucketAt(lx, lz, 5 * dt);
  }
  // cup: scoop from a pool…
  if (ct.state === 'held' && cupWater < 1) {
    cup.localToWorld(_cp.set(0, 0.03, 0));
    const lx = _cp.x - TRAY_C.x, lz = _cp.z - TRAY_C.z;
    if (Math.abs(lx) < HALF && Math.abs(lz) < HALF && waterDepthAt(lx, lz) >= 0.02 && _cp.y <= surfaceWaterY(lx, lz) + 0.06) {
      const got = drawWater(lx, lz, CUP_UNITS); if (got > 0.1) cupWater = Math.min(1, got / CUP_UNITS);
    }
  }
  // …and pour it into the bucket when it is held over it (bucket in hand or still on the crate)
  if (ct.state === 'held' && cupWater > 0 && bucketWater < BUCKET_CAP) {
    cup.getWorldPosition(_cp); bucket.getWorldPosition(_bp);
    const sc = Math.max(0.2, dolly.scale.x);
    if (Math.hypot(_cp.x - _bp.x, _cp.z - _bp.z) < 0.24 * Math.max(1, sc) && _cp.y > _bp.y - 0.02 && _cp.y < _bp.y + 0.45 * Math.max(1, sc)) {
      const add = Math.min(cupWater * CUP_UNITS, BUCKET_CAP - bucketWater);
      bucketWater += add; cupWater -= add / CUP_UNITS; if (cupWater < 0.02) cupWater = 0;
      if (menu.hapticPulse) menu.hapticPulse(menu.controllers[ct.holder]);
    }
  }
  // visuals
  bucketWaterMesh.visible = bucketWater > 0.05; bucketWaterMesh.position.y = -0.074 + (bucketWater / BUCKET_CAP) * 0.145;
  cupWaterMesh.visible = cupWater > 0.03; cupWaterMesh.position.y = -0.03 + cupWater * 0.058;
  drawGauge();
  camera.getWorldPosition(_cp); bucketGauge.lookAt(_cp);
}

// desktop loupe: toggled with L / the menu; floats at the mouse
let deskLensOn = false, deskLensHome = null;
function toggleDesktopLens() {
  if (renderer.xr.isPresenting) return;
  if (deskLensOn) endDesktopLens();
  else {
    deskLensOn = true;
    deskLensHome = { p: lens.group.position.clone(), q: lens.group.quaternion.clone(), s: lens.group.scale.clone() };
    lens.setOn(true);
  }
  if (menu) menu.refresh();
}
function endDesktopLens() {
  if (!deskLensOn) return;
  deskLensOn = false; lens.setOn(false);
  lens.group.position.copy(deskLensHome.p); lens.group.quaternion.copy(deskLensHome.q); lens.group.scale.copy(deskLensHome.s);
}
function lensZoomStep(d) {
  const Z = [2, 3, 4, 6, 8, 12];
  lens.zoom = Z[clamp(Z.indexOf(lens.zoom) + d, 0, Z.length - 1)]; if (menu) menu.refresh();
}

// ---------- audio: soft surf + gulls ----------
let actx, started = false, soundOn = true, surfGain = null;
function setSound(v) {
  soundOn = v;
  if (v) startAudio();
  if (actx) (v ? actx.resume() : actx.suspend());
}
function startAudio() {
  if (started) { if (soundOn && actx && actx.state === 'suspended') actx.resume(); return; }
  if (!soundOn) return;
  started = true;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    const src = actx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    const g = actx.createGain(); g.gain.value = 0.11; surfGain = g;
    src.connect(lp).connect(g).connect(actx.destination); src.start();
    const surf = actx.createOscillator(), sg = actx.createGain(); surf.frequency.value = 0.14; sg.gain.value = 0.07;
    surf.connect(sg).connect(g.gain); surf.start();
    gull();
  } catch (e) { /* no audio */ }
}
function whoosh() {                       // a bigger swell of surf as a wave rolls in
  if (!surfGain) return;
  const t = actx.currentTime;
  surfGain.gain.cancelScheduledValues(t);
  surfGain.gain.setValueAtTime(surfGain.gain.value, t);
  surfGain.gain.linearRampToValueAtTime(0.17, t + 4);
  surfGain.gain.linearRampToValueAtTime(0.11, t + 10);
}
function gull() {
  if (!actx) return;
  if (soundOn) {
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; const b = 900 + Math.random() * 500;
    o.frequency.setValueAtTime(b, t); o.frequency.linearRampToValueAtTime(b * 1.4, t + 0.12); o.frequency.linearRampToValueAtTime(b * 1.1, t + 0.25);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.04, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.32);
  }
  setTimeout(gull, 4000 + Math.random() * 9000);
}

// ---------- desktop / touch input ----------
function setMouse(e) { mouseNDC.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); }
function initPointer() {
  const cv = renderer.domElement;
  const ptrs = new Map();
  let orbitDrag = false, panDrag = false, pinchD = 0, pinchC = null;
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    startAudio(); try { cv.setPointerCapture(e.pointerId); } catch (x) { /* synthetic */ }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setMouse(e);
    if (ptrs.size === 2) {
      endStroke(SRC[0]); orbitDrag = false;
      const [p, q] = [...ptrs.values()]; pinchD = Math.hypot(p.x - q.x, p.y - q.y); pinchC = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      return;
    }
    if (e.button === 1) { panDrag = true; return; }
    updateMouseHit();
    if (e.button === 0 && !e.shiftKey && !e.altKey && SRC[0].hit.on) beginStroke(SRC[0]);
    else orbitDrag = true;
  });
  cv.addEventListener('pointermove', (e) => {
    setMouse(e);
    const prev = ptrs.get(e.pointerId); if (!prev) return;
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    prev.x = e.clientX; prev.y = e.clientY;
    if (ptrs.size >= 2) {
      const [p, q] = [...ptrs.values()], d = Math.hypot(p.x - q.x, p.y - q.y), c = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      if (pinchD > 0 && d > 0) orbit.dist = clamp(orbit.dist * pinchD / d, MIN_DIST, MAX_DIST);
      if (pinchC) { orbit.yaw -= (c.x - pinchC.x) * 0.005; orbit.pitch = clamp(orbit.pitch + (c.y - pinchC.y) * 0.005, PMIN, PMAX); }
      pinchD = d; pinchC = c;
    } else if (orbitDrag) {
      orbit.yaw -= dx * 0.005; orbit.pitch = clamp(orbit.pitch + dy * 0.005, PMIN, PMAX);
    } else if (panDrag) panTarget(-dx * orbit.dist * 0.0016, dy * orbit.dist * 0.0016);
  });
  const up = (e) => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) { pinchD = 0; pinchC = null; }
    if (!ptrs.size) { endStroke(SRC[0]); orbitDrag = false; panDrag = false; }
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.shiftKey && lens.on) { lensZoomStep(e.deltaY < 0 ? 1 : -1); return; }
    const f = Math.exp(clamp(e.deltaY, -300, 300) * 0.0016), nd = clamp(orbit.dist * f, MIN_DIST, MAX_DIST);
    if (nd < orbit.dist && SRC[0].hit.on) {                   // zoom toward whatever is under the cursor
      _a.set(SRC[0].hit.lx + TRAY_C.x, SRC[0].hit.y, SRC[0].hit.lz + TRAY_C.z);
      orbit.target.lerp(_a, (1 - nd / orbit.dist) * 0.8);
    }
    orbit.dist = nd;
  }, { passive: false });
}
function panTarget(right, up) {
  const fwd = _a.set(Math.sin(orbit.yaw), 0, Math.cos(orbit.yaw)).negate();    // ground-plane forward
  const rgt = _b.set(Math.cos(orbit.yaw), 0, -Math.sin(orbit.yaw));
  orbit.target.addScaledVector(rgt, right).addScaledVector(fwd, -up);
  orbit.target.x = clamp(orbit.target.x, -12, 12);
  orbit.target.z = clamp(orbit.target.z, TRAY_C.z - 12, TRAY_C.z + 14);
}
function onKeyDown(e) {
  keys[e.code] = true;
  if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
  if (e.code.startsWith('Digit')) { const k = (+e.code.slice(5) + 9) % 10; if (TOOLS[k]) selectTool(TOOLS[k][1]); }
  else if (e.code === 'BracketLeft') stepBrush(-1);
  else if (e.code === 'BracketRight') stepBrush(1);
  else if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey || !e.shiftKey)) { e.preventDefault(); undo(); }
  else if (e.code === 'KeyL') toggleDesktopLens();
  else if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) resetSand();
  else if (e.code === 'Equal' || e.code === 'NumpadAdd') zoomBy(1);
  else if (e.code === 'Minus' || e.code === 'NumpadSubtract') zoomBy(-1);
  if (menu) menu.refresh();
}

function updateMouseHit() {
  const s = SRC[0];
  if (renderer.xr.isPresenting) { s.hit.on = false; return; }
  camera.updateMatrixWorld();
  ray.setFromCamera(mouseNDC, camera);
  s.hit.on = false; raySand(ray.ray.origin, ray.ray.direction, s.hit);
}

// ---------- VR sticks: left = walk, right = turn (snap) + height; both grips on air = zoom the world ----------
let altLatch = false, pinch = null;
const gripDown = [false, false];
const WALK_SPEED = 1.1;                         // m/s, constant, no ramps
function vrLocomotion(dt) {
  const session = renderer.xr.getSession(); if (!session) return { moving: 0, turning: 0 };
  const sc = dolly.scale.x;
  let moving = 0, turning = 0;
  for (const src of session.inputSources) {
    const gp = src.gamepad; if (!gp || gp.axes.length < 4) continue;
    const ax = gp.axes[2], ay = gp.axes[3];
    if (src.handedness === 'left') {
      if (!comfort.settings.teleport && (Math.abs(ax) > 0.15 || Math.abs(ay) > 0.15)) {
        stickVector(camera, ax, ay, _a);                                // stick forward (y<0) = forward; right = forward × up
        dolly.position.addScaledVector(_a, comfort.speed(WALK_SPEED) * sc * dt);
        moving = comfort.speed(WALK_SPEED) * Math.hypot(ax, ay);
      }
    } else if (src.handedness === 'right') {
      const d = comfort.turnDelta(ax, dt);                            // snap 30° (default) or slow smooth turn
      if (d) { rotateRigAboutHead(dolly, camera, d); if (!comfort.settings.snap) turning = Math.abs(d) / Math.max(dt, 1e-3); }
      // height: stepped (through a quick fade), never a smooth lift
      if (Math.abs(ay) > 0.75 && !altLatch) {
        altLatch = true; const dir = -Math.sign(ay);
        comfort.fade(() => { dolly.position.y = clamp(dolly.position.y + dir * 0.3 * sc, -0.4 * sc, 40); }, 0.12, 0.25);
      } else if (Math.abs(ay) < 0.3) altLatch = false;
    }
  }
  // two-handed world zoom: spread / squeeze hands past a threshold → one stepped zoom (with fade)
  if (gripDown[0] && gripDown[1] && !kit.heldBy(0) && !kit.heldBy(1)) {
    const d = Math.max(0.05, menu.controllers[0].position.distanceTo(menu.controllers[1].position));
    if (!pinch) pinch = { d0: d };
    else if (d / pinch.d0 > 1.45) { zoomBy(1); pinch.d0 = d; }
    else if (d / pinch.d0 < 1 / 1.45) { zoomBy(-1); pinch.d0 = d; }
  } else pinch = null;
  return { moving, turning };
}

// where a pointing ray meets the beach (for teleport): flat ground only, not into the sea
function groundHit(origin, dir) {
  if (dir.y > -0.03) return null;
  const t = -origin.y / dir.y; if (t < 0.2 || t > 30) return null;
  const x = origin.x + dir.x * t, z = origin.z + dir.z * t;
  if (Math.abs(x) > 9 || z > 7 || z < TRAY_C.z - HALF - 0.5) return null;
  return new THREE.Vector3(x, 0, z);
}

// phones: a bottom tool bar (tools + undo), big touch targets
function buildToolbar() {
  if (!touch.isTouch) return;
  const st = document.createElement('style');
  st.textContent = `#toolbar{position:fixed;left:0;right:0;bottom:0;z-index:25;display:flex;gap:8px;overflow-x:auto;padding:8px 10px calc(env(safe-area-inset-bottom,0px) + 8px);
      background:linear-gradient(transparent,rgba(12,15,28,.55) 40%);-webkit-overflow-scrolling:touch;scrollbar-width:none}
    #toolbar::-webkit-scrollbar{display:none}
    #toolbar button{flex:0 0 auto;min-width:64px;min-height:48px;padding:6px 12px;border-radius:14px;border:1px solid rgba(255,255,255,.3);background:rgba(28,34,58,.92);color:#f2f4ff;font:600 15px system-ui,sans-serif;touch-action:manipulation}
    #toolbar button.on{background:rgba(255,214,150,.97);color:#1a1407;border-color:#fff}
    #toolbar .sep{flex:0 0 6px}`;
  document.head.appendChild(st);
  const bar = document.createElement('div'); bar.id = 'toolbar'; document.body.appendChild(bar);
  const btns = {};
  const mk = (label, fn, id) => { const b = document.createElement('button'); b.textContent = label; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); for (const t of ['pointerdown', 'pointerup']) b.addEventListener(t, (e) => e.stopPropagation()); bar.appendChild(b); if (id) btns[id] = b; return b; };
  for (const [label, id] of TOOLS) mk(label, () => selectTool(id), id);
  const sep = document.createElement('div'); sep.className = 'sep'; bar.appendChild(sep);
  mk('↶ Undo', undo); mk('− Brush', () => stepBrush(-1)); mk('+ Brush', () => stepBrush(1));
  const upd = () => { for (const id in btns) btns[id].classList.toggle('on', id === tool); };
  menu.onChange(upd); upd();
}

// ---------- frame ----------
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!comfort.paused) wt += dt;
  const t = wt;
  const xr = renderer.xr.isPresenting;
  let vst = { moving: 0, turning: 0 };

  if (!xr) {
    if (keys.ArrowLeft) orbit.yaw += dt * 1.2; if (keys.ArrowRight) orbit.yaw -= dt * 1.2;
    if (keys.ArrowUp) orbit.pitch = clamp(orbit.pitch - dt, PMIN, PMAX); if (keys.ArrowDown) orbit.pitch = clamp(orbit.pitch + dt, PMIN, PMAX);   // up arrow = look up (camera lowers), same as dragging up
    const pr = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), pf = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    if (pr || pf) panTarget(pr * dt * orbit.dist * 0.6, -pf * dt * orbit.dist * 0.6);
    const cp = Math.cos(orbit.pitch);
    camera.position.set(orbit.target.x + Math.sin(orbit.yaw) * cp * orbit.dist, Math.max(0.02, orbit.target.y + Math.sin(orbit.pitch) * orbit.dist),
      orbit.target.z + Math.cos(orbit.yaw) * cp * orbit.dist);
    camera.lookAt(orbit.target);
    camera.near = clamp(orbit.dist * 0.03, 0.01, 0.5); camera.updateProjectionMatrix();
  } else {
    vst = vrLocomotion(dt);
    dolly.updateMatrixWorld(true);
    renderer.xr.updateCamera(camera);          // fresh head pose for rays + tools this frame
  }

  menu.update();
  kit.update(dt);
  toolsTick(dt);

  // sculpt sources: mouse + both controllers
  updateMouseHit();
  if (xr) {
    for (let i = 0; i < 2; i++) {
      const c = menu.controllers[i], s = SRC[1 + i];
      s.hit.on = false;
      if (c.visible && !c.userData.overMenu) {
        c.updateWorldMatrix(true, false);
        _m.identity().extractRotation(c.matrixWorld);
        _a.setFromMatrixPosition(c.matrixWorld); _b.set(0, 0, -1).applyMatrix4(_m).normalize();
        raySand(_a, _b, s.hit);
      }
      if (!c.userData.overMenu) menu.rays[i].setLength(s.hit.on ? s.hit.dist : 4);
    }
  } else { SRC[1].hit.on = false; SRC[2].hit.on = false; }

  for (const s of SRC) {
    if (!s.down) s.tool = toolFor(s);
    if (s.down && s.hit.on && s.tool && !CLICK_TOOLS.has(s.tool)) applyStroke(s, dt);
    s.ring.visible = s.hit.on && !!s.tool;
    if (s.ring.visible) {
      s.ring.position.set(TRAY_C.x + s.hit.lx, s.hit.y + 0.012, TRAY_C.z + s.hit.lz);
      s.ring.scale.setScalar(cursorRadius(s.tool));
      const op = s.down ? 1 : 0.6 + 0.25 * Math.sin(t * 5); for (const m of s.mats) m.opacity = op;
    }
  }
  updateTide(comfort.paused ? 0 : dt);
  updateSandGeo();
  updateWater(t);

  // floating status label faces you and scales so it stays readable from any zoom
  camera.getWorldPosition(_a);
  statusMesh.lookAt(_a);
  statusMesh.visible = !touch.isTouch || xr;           // phones already show this in the HUD line
  statusMesh.scale.setScalar(clamp(_a.distanceTo(statusMesh.position) / 5, 0.5, 12));

  gulls.update(t);
  camera.getWorldPosition(_a); sky.update(t, _a); ocean.update(t); shore.update(t);   // shore: the visible swash (and the game's tide)
  lens.update(mouseNDC);
  touch.tick(dt);
  comfort.update(dt, vst);
  fx.render();
}

function onResize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); }
