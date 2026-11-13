// Sand Castle — a big seated-or-standing beach sandbox. The "physics" is cheated: the sand is a
// heightfield you sculpt. Piling slumps to a natural slope (angle of repose); bucket towers,
// walls and moats hold their shape. Either hand (or the mouse) can select tools and sculpt.
// Zoom: mouse wheel / pinch on desktop, lean in or scale yourself down in VR, plus a
// hold-it-in-your-hand magnifying glass (render-to-texture lens) in VR and a loupe on desktop.

import * as THREE from 'three';
import { detectXR, createXRMenu, recenterRig, choiceGrid, stepperRow } from '../shared/xrmenu.js';
import { beautify, SHADER_TAIL } from '../shared/beauty.js';

let fx;

// ---------- sand grid ----------
const TRAY = 3.6;                       // tray size (m)
const GN = 224;                         // cells per side → ~1.6 cm cells
const CELL = TRAY / (GN - 1);
const HALF = TRAY / 2;
const MAXH = 0.8;
const BASE = 0.05;                      // untouched sand level; digging below this exposes wet sand
const TRAY_C = new THREE.Vector3(0, 0, -2.0);
const sand = new Float32Array(GN * GN).fill(BASE);
const grain = new Float32Array(GN * GN);
for (let i = 0; i < grain.length; i++) grain[i] = (Math.random() - 0.5) * 0.09;

const BRUSHES = [0.04, 0.06, 0.09, 0.12, 0.16, 0.22, 0.3, 0.4];
let brushIdx = 3, brush = BRUSHES[3];
const TOOLS = [['Pile', 'pile'], ['Dig', 'dig'], ['Smooth', 'smooth'], ['Tower', 'tower'], ['Wall', 'wall'],
               ['Moat', 'moat'], ['Flag', 'flag'], ['Shell', 'shell'], ['Starfish', 'star']];
const CLICK_TOOLS = new Set(['tower', 'flag', 'shell', 'star']);
let tool = 'pile';

let scene, camera, renderer, dolly, env, sandMesh, sandGeo, water, menu, caps, decoGroup, sun;
const clock = new THREE.Clock();
const keys = {};
const ray = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2(0, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Matrix4();
const sunDir = new THREE.Vector3(-0.75, 0.58, -0.32).normalize();   // raking side-light: lit faces, long shadows
const horizonColor = new THREE.Color(0xdcecf5);

// desktop orbit camera
const orbit = { yaw: 0, pitch: 0.66, dist: 4.3, target: new THREE.Vector3(0, 0.05, -2.0) };
const START_DIST = 4.3;

// VR zoom = shrink the rig (the world looks N× bigger); lean-in works too
const VR_ZOOMS = [1, 1.5, 2.25, 3.5, 5.5, 9];
let vrZoomIdx = 0;
const VR_HOME = new THREE.Vector3(0, 0, 0.6);

// ---------- helpers ----------
const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const gi = (i, j) => j * GN + i;

// beach ground height: flat near the tray, sloping down to the sea in front (−z)
function groundH(x, z) {
  if (z > -6.5) return -0.02;
  return -0.02 - 0.55 * smoothstep(-6.5, -12, z);
}

// ---------- boot ----------
Promise.resolve().then(async () => { caps = await detectXR(); init(); });

function init() {
  scene = new THREE.Scene();
  scene.background = horizonColor.clone();
  scene.fog = new THREE.Fog(horizonColor, 16, 100);

  camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.03, 400);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: caps.ar });   // alpha only if passthrough can be toggled
  if (caps.ar) renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.xr.enabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;       // only re-render shadows when the sand actually changes
  renderer.shadowMap.needsUpdate = true;
  document.body.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = 'none';
  fx = beautify(renderer, scene, camera, { tone: 'neutral', exposure: 1.08, bloom: 0.3, radius: 0.4, threshold: 0.97 });

  dolly = new THREE.Group();
  dolly.add(camera);
  scene.add(dolly);

  scene.add(new THREE.HemisphereLight(0xdff0ff, 0xbfa87e, 1.0));
  sun = new THREE.DirectionalLight(0xffe6c0, 1.45);
  sun.position.copy(TRAY_C).addScaledVector(sunDir, 9);
  sun.target.position.copy(TRAY_C);
  scene.add(sun, sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -2.7, right: 2.7, top: 2.7, bottom: -2.7, near: 1, far: 18 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;

  env = new THREE.Group();            // sky, beach, sea, props — hidden when passthrough is on
  scene.add(env);
  buildSky();
  buildBeach();
  buildWater();
  buildProps();
  buildSandTable();
  decoGroup = new THREE.Group(); scene.add(decoGroup);
  buildCursors();
  buildLens();
  starterCastle();

  menu = createXRMenu({
    renderer, camera, dolly, caps,
    title: 'Sand Castle',
    startOpenDesktop: innerWidth > 760,
    hint: 'Drag sand to sculpt · drag empty space or right-drag to orbit · wheel zooms · 1–9 tools · [ ] brush · Ctrl+Z undo · L magnifier',
    rows: [
      choiceGrid(TOOLS, () => tool, selectTool, 3),
      stepperRow('Brush', () => Math.round(brush * 100) + ' cm', () => stepBrush(-1), () => stepBrush(1)),
      { cells: [{ text: '↶  Undo', action: undo }, { text: 'Reset sand', action: resetSand }] },
      stepperRow('Zoom', zoomText, () => zoomBy(-1), () => zoomBy(1)),
      { label: 'Magnifier', cells: [
        { text: () => (lens.on ? 'On' : 'Off'), action: toggleLens, active: () => lens.on, w: 1.5 },
        { text: '–', action: () => lensZoomStep(-1), tone: 'accent' },
        { text: () => '×' + lens.zoom, w: 1.1 },
        { text: '+', action: () => lensZoomStep(1), tone: 'accent' } ] },
    ],
    sound: { get: () => soundOn, set: setSound },
    setBackdrop,
    recenter,
    onBeforeEnter: startAudio,
    onSessionStart: () => {
      dolly.position.copy(VR_HOME); dolly.rotation.set(0, 0, 0); dolly.scale.setScalar(1); vrZoomIdx = 0;
      attachLens();
    },
    onSessionEnd: () => {
      dolly.position.set(0, 0, 0); dolly.rotation.set(0, 0, 0); dolly.scale.setScalar(1); vrZoomIdx = 0;
      attachLens();
    },
  });

  // either hand can pick tools (menu consumes the click) or sculpt (everything else)
  menu.onSelectStart((c, hand, idx) => beginStroke(SRC[1 + idx]));
  menu.onSelectEnd((c, hand, idx) => endStroke(SRC[1 + idx]));
  menu.onButton((hand, b) => {
    if (hand === 'right' && b === 4) cycleTool(1);        // A
    if (hand === 'right' && b === 5) cycleTool(-1);       // B
    if (hand === 'left' && b === 'squeeze') toggleLens(); // left grip: pick up / put down the magnifier
  });

  addEventListener('resize', onResize);
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  initPointer();
  const enter = document.getElementById('enter');
  enter.addEventListener('click', () => { startAudio(); enter.style.opacity = '0'; setTimeout(() => enter.remove(), 500); });
  renderer.xr.addEventListener('sessionstart', startAudio);

  renderer.setAnimationLoop(animate);
}

// ---------- sky ----------
function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x4a90d8) }, mid: { value: new THREE.Color(0xcfe7f3) }, bot: { value: new THREE.Color(0xeaf5fb) } },
    vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec3 vP; uniform vec3 top,mid,bot; void main(){ float h=normalize(vP).y;
      vec3 c=h>0.0?mix(mid,top,pow(clamp(h,0.0,1.0),0.7)):mix(mid,bot,clamp(-h*5.0,0.0,1.0)); gl_FragColor=vec4(c,1.0); ${SHADER_TAIL} }`,
  });
  env.add(new THREE.Mesh(new THREE.SphereGeometry(300, 24, 16), mat));
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d'); const rg = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,252,240,1)'); rg.addColorStop(0.3, 'rgba(255,248,224,0.75)'); rg.addColorStop(1, 'rgba(255,248,224,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, fog: false }));
  spr.position.copy(sunDir).multiplyScalar(240); spr.scale.setScalar(55); env.add(spr);
}

// ---------- beach ground ----------
function paintGeo(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3)); return geo;
}
function buildBeach() {
  const geo = new THREE.PlaneGeometry(120, 120, 120, 120); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const dry = new THREE.Color(0xe4d2a2), wet = new THREE.Color(0xb49a68), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = groundH(x, z);
    pos.setY(i, h);
    tmp.copy(dry).lerp(wet, smoothstep(-7, -10, z));
    tmp.offsetHSL(0, 0, (Math.random() - 0.5) * 0.04);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const beach = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  beach.receiveShadow = true; env.add(beach);
}

// ---------- sea (cheated) ----------
function buildWater() {
  const geo = new THREE.PlaneGeometry(600, 600, 1, 1); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      time: { value: 0 }, cam: { value: new THREE.Vector3() }, sun: { value: sunDir },
      deep: { value: new THREE.Color(0x1d6f8f) }, shallow: { value: new THREE.Color(0x58b0c4) }, sky: { value: new THREE.Color(0xcfe7f3) },
      fogColor: { value: scene.fog.color }, fogNear: { value: scene.fog.near }, fogFar: { value: scene.fog.far },
    },
    vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `varying vec3 vW; uniform float time; uniform vec3 cam,sun,deep,shallow,sky;
      uniform vec3 fogColor; uniform float fogNear,fogFar;
      void main(){
        float r=sin(vW.x*0.8+time*1.3)+sin(vW.z*0.7-time)+sin((vW.x+vW.z)*0.5+time*0.7);
        vec3 N=normalize(vec3(0.06*cos(vW.x*0.8+time*1.3),1.0,0.06*cos(vW.z*0.7-time)));
        vec3 V=normalize(cam-vW); float fres=pow(1.0-max(dot(N,V),0.0),3.0);
        vec3 col=mix(mix(deep,shallow,clamp(0.5+0.12*r,0.0,1.0)),sky,fres*0.8);
        vec3 H=normalize(V+normalize(sun)); col+=vec3(1.0,0.97,0.85)*pow(max(dot(N,H),0.0),120.0)*1.2;
        float fog=smoothstep(fogNear,fogFar,length(cam-vW)); col=mix(col,fogColor,fog);
        gl_FragColor=vec4(col,0.94);
        ${SHADER_TAIL}
      }`,
  });
  water = new THREE.Mesh(geo, mat); water.position.y = -0.52; env.add(water);
}

// ---------- props near the player: bucket, spade, shells ----------
function buildProps() {
  const bucket = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.085, 0.16, 16, 1, true), new THREE.MeshLambertMaterial({ color: 0xe7563f, side: THREE.DoubleSide }));
  body.position.y = 0.08; bucket.add(body);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 8, 20), new THREE.MeshLambertMaterial({ color: 0xc8402c }));
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.16; bucket.add(rim);
  bucket.position.set(0.95, -0.02, 0.5); bucket.rotation.y = -0.4; env.add(bucket);
  bucket.traverse((o) => { o.castShadow = true; });
  const spade = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 8), new THREE.MeshLambertMaterial({ color: 0x3f7fd0 }));
  handle.position.y = 0.17; spade.add(handle);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.008), new THREE.MeshLambertMaterial({ color: 0xf4c23a }));
  blade.position.y = 0.02; blade.rotation.x = -0.2; spade.add(blade);
  spade.position.set(-0.95, -0.02, 0.6); spade.rotation.set(0.5, 0.3, 0.2); env.add(spade);
  spade.traverse((o) => { o.castShadow = true; });
  const shellMat = [0xf3d9d0, 0xeabfcb, 0xf0e4d2];
  for (let i = 0; i < 9; i++) {
    const x = (Math.random() - 0.5) * 6, z = 0.5 + Math.random() * 2.2;
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.035, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: shellMat[i % 3] }));
    s.position.set(x, groundH(x, z) + 0.005, z); s.rotation.set(-Math.PI / 2 + Math.random() * 0.4, Math.random(), 0); env.add(s);
  }
}

// ---------- the sand tray (hand-built grid so we can update only the changed rows) ----------
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
  sandGeo.boundingBox = new THREE.Box3(new THREE.Vector3(-HALF, 0, -HALF), new THREE.Vector3(HALF, MAXH, HALF));
  // fine procedural grain in the fragment shader (fades with distance) so close-ups and the magnifier have detail
  const sandMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  sandMat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vSandW;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n vSandW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'varying vec3 vSandW;\nfloat sandHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' +
      sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float sFade = 1.0 - smoothstep(0.5, 3.2, length(vSandW - cameraPosition));
        vec2 sg = vSandW.xz * 230.0;
        float sN = sandHash(floor(sg)) * 0.65 + sandHash(floor(sg * 0.37) + 7.0) * 0.35;
        diffuseColor.rgb *= 1.0 + (sN - 0.5) * 0.34 * sFade;`);
  };
  sandMesh = new THREE.Mesh(sandGeo, sandMat);
  sandMesh.position.copy(TRAY_C);
  sandMesh.frustumCulled = false;
  sandMesh.castShadow = true; sandMesh.receiveShadow = true;
  scene.add(sandMesh);
  markAll();

  // wooden rim around the tray
  const rimMat = new THREE.MeshLambertMaterial({ color: 0x9c6b3a });
  const rG = new THREE.Group();
  for (const [w, d, x, z] of [[TRAY + 0.2, 0.1, 0, HALF + 0.05], [TRAY + 0.2, 0.1, 0, -HALF - 0.05], [0.1, TRAY + 0.2, HALF + 0.05, 0], [0.1, TRAY + 0.2, -HALF - 0.05, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), rimMat); m.position.set(x, 0.02, z); rG.add(m);
  }
  rG.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  rG.position.copy(TRAY_C);
  scene.add(rG);
}

const WET = [0.60, 0.46, 0.28], DRY = [0.97, 0.83, 0.56];
function updateSandGeo() {
  if (!dirty) return;
  const r = { i0: Math.max(0, dirty.i0 - 1), i1: Math.min(GN - 1, dirty.i1 + 1), j0: Math.max(0, dirty.j0 - 1), j1: Math.min(GN - 1, dirty.j1 + 1) };
  dirty = null;
  const pos = sandGeo.attributes.position, nor = sandGeo.attributes.normal, col = sandGeo.attributes.color;
  const P = pos.array, N = nor.array, C = col.array;
  for (let j = r.j0; j <= r.j1; j++) {
    for (let i = r.i0; i <= r.i1; i++) {
      const id = gi(i, j), k = id * 3, h = sand[id];
      P[k + 1] = h;
      const nx = (sand[gi(Math.max(0, i - 1), j)] - sand[gi(Math.min(GN - 1, i + 1), j)]) / (2 * CELL);
      const nz = (sand[gi(i, Math.max(0, j - 1))] - sand[gi(i, Math.min(GN - 1, j + 1))]) / (2 * CELL);
      const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
      N[k] = nx * inv; N[k + 1] = inv; N[k + 2] = nz * inv;
      const dryness = smoothstep(0.0, 0.05, h), slope = 0.86 + 0.14 * inv, g = (1 + grain[id]) * slope;
      C[k] = (WET[0] + (DRY[0] - WET[0]) * dryness) * g;
      C[k + 1] = (WET[1] + (DRY[1] - WET[1]) * dryness) * g;
      C[k + 2] = (WET[2] + (DRY[2] - WET[2]) * dryness) * g;
    }
  }
  for (const a of [pos, nor, col]) {
    if (!firstUpload) { a.clearUpdateRanges(); a.addUpdateRange(r.j0 * GN * 3, (r.j1 - r.j0 + 1) * GN * 3); }
    a.needsUpdate = true;
  }
  firstUpload = false;
  renderer.shadowMap.needsUpdate = true;
  settleDecos();
}

function heightAt(lx, lz) {
  const fx = (lx + HALF) / CELL, fz = (lz + HALF) / CELL;
  const i = clamp(Math.floor(fx), 0, GN - 2), j = clamp(Math.floor(fz), 0, GN - 2);
  const tx = clamp(fx - i, 0, 1), tz = clamp(fz - j, 0, 1);
  return sand[gi(i, j)] * (1 - tx) * (1 - tz) + sand[gi(i + 1, j)] * tx * (1 - tz)
       + sand[gi(i, j + 1)] * (1 - tx) * tz + sand[gi(i + 1, j + 1)] * tx * tz;
}

// analytic heightfield raycast (a triangle raycast against 100k tris per frame would be far too slow)
function raySand(origin, dir, out) {
  let ox = origin.x - TRAY_C.x, oy = origin.y - TRAY_C.y, oz = origin.z - TRAY_C.z;
  const dx = dir.x, dy = dir.y, dz = dir.z;
  let t0 = 0, t1 = 1e9;
  const slab = (o, d, lo, hi) => {
    if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
    let a = (lo - o) / d, b = (hi - o) / d; if (a > b) { const x = a; a = b; b = x; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); return t0 <= t1;
  };
  if (!slab(ox, dx, -HALF, HALF) || !slab(oy, dy, 0, MAXH + 0.02) || !slab(oz, dz, -HALF, HALF)) return false;
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
  out.on = true; out.lx = ox + dx * t; out.lz = oz + dz * t; out.y = oy + dy * t; out.dist = t;
  return true;
}

// ---------- sand editing (the cheated physics) ----------
function cellRect(lx, lz, rm, extra = 0) {
  const ci = (lx + HALF) / CELL, cj = (lz + HALF) / CELL, rc = rm / CELL + extra;
  return { ci, cj, rc, i0: Math.max(0, Math.floor(ci - rc)), i1: Math.min(GN - 1, Math.ceil(ci + rc)), j0: Math.max(0, Math.floor(cj - rc)), j1: Math.min(GN - 1, Math.ceil(cj + rc)) };
}

function brushPile(lx, lz, dt, dir) {
  const r = cellRect(lx, lz, brush);
  const rate = 0.55 * dt * dir;
  for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
    const d = Math.hypot(i - r.ci, j - r.cj) / r.rc; if (d > 1) continue;
    const f = smoothstep(1, 0, d), id = gi(i, j);
    sand[id] = clamp(sand[id] + rate * f, 0, MAXH);
  }
  slumpRect(r, 2); markDirty(r.i0 - 4, r.i1 + 4, r.j0 - 4, r.j1 + 4);
}
function brushSmooth(lx, lz, dt) {
  const r = cellRect(lx, lz, brush);
  const k = Math.min(1, dt * 9);
  for (let j = Math.max(1, r.j0); j <= Math.min(GN - 2, r.j1); j++) for (let i = Math.max(1, r.i0); i <= Math.min(GN - 2, r.i1); i++) {
    const d = Math.hypot(i - r.ci, j - r.cj) / r.rc; if (d > 1) continue;
    const f = smoothstep(1, 0, d), id = gi(i, j);
    const avg = (sand[id - 1] + sand[id + 1] + sand[id - GN] + sand[id + GN] + sand[id]) / 5;
    sand[id] += (avg - sand[id]) * f * k;
  }
  markDirty(r.i0, r.i1, r.j0, r.j1);
}
// angle-of-repose cheat, only around where the hand just worked
function slumpRect(r, iter) {
  const maxStep = 0.75 * CELL;
  const i0 = Math.max(0, r.i0 - 3), i1 = Math.min(GN - 1, r.i1 + 3), j0 = Math.max(0, r.j0 - 3), j1 = Math.min(GN - 1, r.j1 + 3);
  for (let k = 0; k < iter; k++) {
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = gi(i, j), hc = sand[c];
      for (let q = 0; q < 4; q++) {
        const ni = i + (q === 0 ? -1 : q === 1 ? 1 : 0), nj = j + (q === 2 ? -1 : q === 3 ? 1 : 0);
        if (ni < 0 || nj < 0 || ni >= GN || nj >= GN) continue;
        const n = gi(ni, nj), diff = hc - sand[n];
        if (diff > maxStep) { const m = (diff - maxStep) * 0.25; sand[c] -= m; sand[n] += m; }
      }
    }
  }
}

// wall: a ridge with crenellations along the stroke
function stampWall(lx, lz, travel) {
  const w = Math.max(brush * 0.35, 2.2 * CELL), H = clamp(0.1 + brush * 1.2, 0.15, 0.36);
  const crenel = Math.floor(travel / (w * 2.2)) % 2 ? 0.8 : 1;
  const r = cellRect(lx, lz, w * 1.6);
  for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
    const d = Math.hypot(i - r.ci, j - r.cj) * CELL; if (d > w * 1.6) continue;
    const prof = d < w * 0.7 ? 1 : 1 - smoothstep(w * 0.7, w * 1.6, d);
    const id = gi(i, j);
    sand[id] = Math.max(sand[id], Math.min(MAXH, BASE + H * crenel * prof));
  }
  markDirty(r.i0, r.i1, r.j0, r.j1);
}
// moat: a flat-bottomed channel down to the wet sand
function stampMoat(lx, lz) {
  const m = Math.max(brush * 0.8, 3 * CELL);
  const r = cellRect(lx, lz, m * 1.35);
  for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
    const d = Math.hypot(i - r.ci, j - r.cj) * CELL; if (d > m * 1.35) continue;
    const t = d < m * 0.55 ? 1 : 1 - smoothstep(m * 0.55, m * 1.35, d);
    const id = gi(i, j);
    sand[id] = Math.min(sand[id], sand[id] * (1 - t));
  }
  slumpRect(r, 1); markDirty(r.i0 - 3, r.i1 + 3, r.j0 - 3, r.j1 + 3);
}
// bucket-molded tower: flat-topped, lightly tapered, battlements — holds its shape
function stampTower(lx, lz, R, H) {
  R = R ?? clamp(brush * 1.6, 0.12, 0.6); H = H ?? Math.min(MAXH, R * 1.9);
  const r = cellRect(lx, lz, R * 1.15);
  const k = Math.max(6, Math.round(R / 0.035));
  for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
    const d = Math.hypot(i - r.ci, j - r.cj) * CELL; if (d > R * 1.15) continue;
    let h;
    if (d < R * 0.78) h = H;
    else if (d < R) h = H * (1 - ((d - R * 0.78) / (R * 0.22)) * 0.5);
    else h = H * 0.5 * (1 - (d - R) / (R * 0.15));
    if (d > R * 0.6 && d < R * 0.82) {
      const ang = Math.atan2(j - r.cj, i - r.ci);
      if (Math.cos(ang * k) > 0.25) h += 0.05 * (R / 0.2);
    }
    const id = gi(i, j);
    sand[id] = Math.max(sand[id], Math.min(MAXH, BASE + h));
  }
  markDirty(r.i0, r.i1, r.j0, r.j1);
}

function starterCastle() {
  const s = 0.62, zf = -0.5, zb = 0.7;                 // a ~1.3 m square keep with corner towers + inner keep
  const wallH = 0.2;
  const segment = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(len / (CELL * 1.5));
    for (let q = 0; q <= n; q++) {
      const t = q / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      const w = 0.05, r = cellRect(x, z, w * 1.6);
      for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
        const d = Math.hypot(i - r.ci, j - r.cj) * CELL; if (d > w * 1.6) continue;
        const prof = d < w * 0.7 ? 1 : 1 - smoothstep(w * 0.7, w * 1.6, d);
        const cren = Math.floor(len * t / 0.11) % 2 ? 0.82 : 1;
        sand[gi(i, j)] = Math.max(sand[gi(i, j)], BASE + wallH * cren * prof);
      }
    }
  };
  segment(-s, zf, s, zf); segment(-s, zb, s, zb); segment(-s, zf, -s, zb); segment(s, zf, s, zb);
  for (const [x, z] of [[-s, zf], [s, zf], [-s, zb], [s, zb]]) stampTower(x, z, 0.19, 0.4);
  stampTower(0, (zf + zb) / 2, 0.27, 0.62);
  // a moat all the way around, with a causeway in front
  const mo = 0.98, zf2 = zf - (mo - s), zb2 = zb + (mo - s);
  const ditch = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(len / (CELL * 1.5));
    for (let q = 0; q <= n; q++) {
      const t = q / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, m = 0.1, r = cellRect(x, z, m * 1.35);
      for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
        const d = Math.hypot(i - r.ci, j - r.cj) * CELL; if (d > m * 1.35) continue;
        const tt = d < m * 0.55 ? 1 : 1 - smoothstep(m * 0.55, m * 1.35, d);
        sand[gi(i, j)] = Math.min(sand[gi(i, j)], sand[gi(i, j)] * (1 - tt));
      }
    }
  };
  ditch(-mo, zf2, -0.25, zf2); ditch(0.25, zf2, mo, zf2);
  ditch(-mo, zb2, mo, zb2); ditch(-mo, zf2, -mo, zb2); ditch(mo, zf2, mo, zb2);
  slumpRect({ i0: 0, i1: GN - 1, j0: 0, j1: GN - 1 }, 1);
  markAll();
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
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), m);
      body.scale.set(1, 0.4, 0.85); g.add(body);
      for (let q = -3; q <= 3; q++) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.012, 0.055), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
        rib.position.set(Math.sin(q * 0.4) * 0.035, 0.02, Math.cos(q * 0.4) * 0.02 - 0.012); rib.rotation.y = q * 0.4; g.add(rib);
      }
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
  d.mesh.position.set(TRAY_C.x + d.x, TRAY_C.y + heightAt(d.x, d.z) - (d.type === 'flag' ? 0.03 : 0.004), TRAY_C.z + d.z);
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
  undoStack.push({ sand: sand.slice(), decos: decos.map((d) => ({ type: d.type, x: d.x, z: d.z, rot: d.rot, s: d.s, color: d.color })) });
  if (undoStack.length > 24) undoStack.shift();
}
function undo() {
  const u = undoStack.pop(); if (!u) return;
  sand.set(u.sand); clearDecos(); u.decos.forEach((d) => addDeco({ ...d })); markAll();
}
function resetSand() { pushUndo(); sand.fill(BASE); clearDecos(); markAll(); }

// ---------- cursors (one per hand + mouse), sized to the brush ----------
const SRC = [];
function buildCursors() {
  for (let k = 0; k < 3; k++) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48),
      new THREE.MeshBasicMaterial({ color: k === 0 ? 0x5a3d18 : k === 1 ? 0xb8681e : 0x1e6fb8, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.visible = false; ring.renderOrder = 5; scene.add(ring);
    SRC.push({ id: k, down: false, hit: { on: false, lx: 0, lz: 0, y: 0, dist: 0 }, last: null, travel: 0, ring });
  }
}
function cursorRadius() {
  return tool === 'tower' ? clamp(brush * 1.6, 0.12, 0.6) : CLICK_TOOLS.has(tool) ? 0.06 : tool === 'wall' ? Math.max(brush * 0.35, 0.035) * 1.6 : brush;
}

// ---------- strokes ----------
function beginStroke(s) {
  if (!s.hit.on) return;
  pushUndo();
  s.down = true; s.last = null; s.travel = 0;
  if (CLICK_TOOLS.has(tool)) {
    const { lx, lz } = s.hit;
    if (tool === 'tower') stampTower(lx, lz);
    else placeDecoAt(tool === 'flag' ? 'flag' : tool === 'shell' ? 'shell' : 'star', lx, lz);
    s.down = false;
  }
}
function endStroke(s) { s.down = false; s.last = null; }

function strokeLine(s, fn) {
  const { lx, lz } = s.hit;
  if (s.last) {
    const dx = lx - s.last.x, dz = lz - s.last.z, len = Math.hypot(dx, dz);
    const step = Math.max(CELL, brush * 0.25), n = Math.max(1, Math.ceil(len / step));
    for (let q = 1; q <= n; q++) { s.travel += len / n; fn(s.last.x + dx * q / n, s.last.z + dz * q / n, s.travel); }
  } else fn(lx, lz, 0);
  s.last = { x: lx, z: lz };
}
function applyStroke(s, dt) {
  const { lx, lz } = s.hit;
  switch (tool) {
    case 'pile': brushPile(lx, lz, dt, 1); break;
    case 'dig': brushPile(lx, lz, dt, -1); break;
    case 'smooth': brushSmooth(lx, lz, dt); break;
    case 'wall': strokeLine(s, stampWall); break;
    case 'moat': strokeLine(s, stampMoat); break;
    default: break;
  }
}

function selectTool(id) { tool = id; if (menu) menu.refresh(); }
function cycleTool(d) {
  const ids = TOOLS.map((t) => t[1]);
  selectTool(ids[(ids.indexOf(tool) + d + ids.length) % ids.length]);
}
function stepBrush(d) { brushIdx = clamp(brushIdx + d, 0, BRUSHES.length - 1); brush = BRUSHES[brushIdx]; if (menu) menu.refresh(); }

// ---------- zoom ----------
function zoomText() {
  return '×' + (renderer && renderer.xr.isPresenting ? VR_ZOOMS[vrZoomIdx] : (START_DIST / orbit.dist).toFixed(1));
}
function zoomBy(d) {
  if (renderer.xr.isPresenting) {
    vrZoomIdx = clamp(vrZoomIdx + d, 0, VR_ZOOMS.length - 1);
    camera.getWorldPosition(_a);
    dolly.scale.setScalar(1 / VR_ZOOMS[vrZoomIdx]); dolly.updateMatrixWorld(true);
    camera.getWorldPosition(_b);
    dolly.position.add(_a.sub(_b));         // keep your head where it was; the world grows around you
  } else orbit.dist = clamp(orbit.dist * (d > 0 ? 0.7 : 1 / 0.7), 0.45, 14);
}
function recenter() {
  if (renderer.xr.isPresenting) {
    recenterRig(dolly, camera, VR_HOME, 0);
    dolly.position.y = 0;
  } else { orbit.yaw = 0; orbit.pitch = 0.66; orbit.dist = START_DIST; orbit.target.set(0, 0.05, -2.0); }
}
function setBackdrop(visible) {            // passthrough on = hide sky/beach/sea/props; the tray stays
  env.visible = visible;
  scene.background = visible ? horizonColor : null;
}

// ---------- magnifying glass (render-to-texture lens) ----------
const lens = { on: false, zoom: 3, group: null, rt: null, cam: null, disc: null, handle: null };
const LENS_R = 0.12;
const LENS_ZOOMS = [2, 3, 4, 6, 8];
function buildLens() {
  lens.rt = new THREE.WebGLRenderTarget(768, 768, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
  lens.cam = new THREE.PerspectiveCamera(20, 1, 0.02, 400);
  const g = new THREE.Group();
  // drawn last and without depth test so the glass is never swallowed by the castle you are leaning into
  const over = (m, order) => { m.depthTest = false; m.transparent = true; m.fog = false; return order; };
  const disc = new THREE.Mesh(new THREE.CircleGeometry(LENS_R, 56), new THREE.MeshBasicMaterial({ map: lens.rt.texture }));
  disc.renderOrder = over(disc.material, 900);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(LENS_R, 0.008, 10, 56), new THREE.MeshBasicMaterial({ color: 0xe0ac4a, toneMapped: false }));
  ring.position.z = 0.002; ring.renderOrder = over(ring.material, 901);
  const cross = new THREE.Mesh(new THREE.RingGeometry(0.004, 0.0065, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.7, toneMapped: false }));
  cross.position.z = 0.002; cross.renderOrder = over(cross.material, 902);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.16, 10), new THREE.MeshBasicMaterial({ color: 0x7a4f28, toneMapped: false }));
  handle.position.set(0, -LENS_R - 0.07, 0); handle.renderOrder = over(handle.material, 901);
  g.add(disc, ring, cross, handle);
  g.visible = false;
  lens.group = g; lens.disc = disc; lens.handle = handle;
  scene.add(g);
}
function attachLens() {
  const parent = renderer.xr.isPresenting ? (menu.controllers.find((c) => c.userData.hand === 'left') || menu.controllers[0]) : scene;
  if (lens.group.parent !== parent) parent.add(lens.group);
  lens.handle.visible = !renderer.xr.isPresenting;
  if (renderer.xr.isPresenting) lens.group.position.set(0, 0.02, -0.3); else lens.group.position.set(0, 0, 0);
}
function toggleLens() { lens.on = !lens.on; lens.group.visible = lens.on; if (menu) menu.refresh(); }
function lensZoomStep(d) {
  lens.zoom = LENS_ZOOMS[clamp(LENS_ZOOMS.indexOf(lens.zoom) + d, 0, LENS_ZOOMS.length - 1)]; if (menu) menu.refresh();
}
function updateLens() {
  if (!lens.on) return;
  camera.getWorldPosition(_a);                                  // eye
  if (!renderer.xr.isPresenting) {                              // desktop loupe follows the mouse, floating in front of the camera
    ray.setFromCamera(mouseNDC, camera);
    lens.group.position.copy(_a).addScaledVector(ray.ray.direction, 0.62);
    lens.group.scale.setScalar(1);
  }
  lens.group.lookAt(_a);
  lens.group.updateWorldMatrix(true, true);
  lens.group.getWorldPosition(_b);                              // lens centre
  const R = LENS_R * lens.group.getWorldScale(_c).x, d = _a.distanceTo(_b);
  const half = Math.atan(R / Math.max(d, 0.05));
  lens.cam.position.copy(_a); lens.cam.lookAt(_b);
  lens.cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) / lens.zoom));
  lens.cam.updateProjectionMatrix(); lens.cam.updateMatrixWorld();

  const prevRT = renderer.getRenderTarget(), xrEn = renderer.xr.enabled;
  lens.group.visible = false;
  renderer.xr.enabled = false;               // render with lens.cam, not the headset camera
  renderer.setRenderTarget(lens.rt);
  menu.withoutUI(() => { renderer.clear(); renderer.render(scene, lens.cam); });
  renderer.xr.enabled = xrEn;
  renderer.setRenderTarget(prevRT);
  lens.group.visible = true;
}

// ---------- audio: soft surf + gulls ----------
let actx, started = false, soundOn = true;
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
    const g = actx.createGain(); g.gain.value = 0.11;
    src.connect(lp).connect(g).connect(actx.destination); src.start();
    const surf = actx.createOscillator(), sg = actx.createGain(); surf.frequency.value = 0.14; sg.gain.value = 0.07;
    surf.connect(sg).connect(g.gain); surf.start();
    gull();
  } catch (e) { /* no audio */ }
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
    startAudio(); cv.setPointerCapture(e.pointerId);
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
      if (pinchD > 0 && d > 0) orbit.dist = clamp(orbit.dist * pinchD / d, 0.45, 14);
      if (pinchC) { orbit.yaw -= (c.x - pinchC.x) * 0.005; orbit.pitch = clamp(orbit.pitch + (c.y - pinchC.y) * 0.005, 0.06, 1.5); }
      pinchD = d; pinchC = c;
    } else if (orbitDrag) {
      orbit.yaw -= dx * 0.005; orbit.pitch = clamp(orbit.pitch + dy * 0.005, 0.06, 1.5);
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
    const f = Math.exp(clamp(e.deltaY, -300, 300) * 0.0013), nd = clamp(orbit.dist * f, 0.45, 14);
    if (nd < orbit.dist && SRC[0].hit.on) {                   // zoom toward whatever is under the cursor
      _a.set(TRAY_C.x + SRC[0].hit.lx, SRC[0].hit.y, TRAY_C.z + SRC[0].hit.lz);
      orbit.target.lerp(_a, (1 - nd / orbit.dist) * 0.7);
    }
    orbit.dist = nd;
  }, { passive: false });
}
function panTarget(right, up) {
  const fwd = _a.set(Math.sin(orbit.yaw), 0, Math.cos(orbit.yaw)).negate();    // ground-plane forward
  const rgt = _b.set(Math.cos(orbit.yaw), 0, -Math.sin(orbit.yaw));
  orbit.target.addScaledVector(rgt, right).addScaledVector(fwd, -up);
  orbit.target.x = clamp(orbit.target.x, -HALF + TRAY_C.x, HALF + TRAY_C.x);
  orbit.target.z = clamp(orbit.target.z, -HALF + TRAY_C.z, HALF + TRAY_C.z);
}
function onKeyDown(e) {
  keys[e.code] = true;
  if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
  if (e.code.startsWith('Digit')) { const k = +e.code.slice(5) - 1; if (TOOLS[k]) selectTool(TOOLS[k][1]); }
  else if (e.code === 'BracketLeft') stepBrush(-1);
  else if (e.code === 'BracketRight') stepBrush(1);
  else if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey || !e.shiftKey)) { e.preventDefault(); undo(); }
  else if (e.code === 'KeyL') toggleLens();
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

// ---------- VR sticks: left = walk, right = turn (snap) + height ----------
let snapLatch = false;
function vrLocomotion(dt) {
  const session = renderer.xr.getSession(); if (!session) return;
  const sc = dolly.scale.x;
  for (const src of session.inputSources) {
    const gp = src.gamepad; if (!gp || gp.axes.length < 4) continue;
    const ax = gp.axes[2], ay = gp.axes[3];
    if (src.handedness === 'left') {
      if (Math.abs(ax) > 0.15 || Math.abs(ay) > 0.15) {
        camera.getWorldDirection(_a); _a.y = 0; _a.normalize();
        _b.crossVectors(_a, camera.up).normalize();
        dolly.position.addScaledVector(_a, -ay * 1.4 * sc * dt).addScaledVector(_b, ax * 1.4 * sc * dt);
      }
    } else if (src.handedness === 'right') {
      if (Math.abs(ax) > 0.7 && !snapLatch) {
        snapLatch = true;
        camera.getWorldPosition(_a);
        dolly.rotation.y -= Math.sign(ax) * Math.PI / 6; dolly.updateMatrixWorld(true);
        camera.getWorldPosition(_b); dolly.position.add(_a.sub(_b));
      } else if (Math.abs(ax) < 0.3) snapLatch = false;
      if (Math.abs(ay) > 0.2) dolly.position.y = clamp(dolly.position.y - ay * 0.9 * sc * dt, -0.5, 3);
    }
  }
}

// ---------- frame ----------
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  const xr = renderer.xr.isPresenting;

  if (!xr) {
    if (keys.ArrowLeft) orbit.yaw += dt * 1.2; if (keys.ArrowRight) orbit.yaw -= dt * 1.2;
    if (keys.ArrowUp) orbit.pitch = clamp(orbit.pitch + dt, 0.06, 1.5); if (keys.ArrowDown) orbit.pitch = clamp(orbit.pitch - dt, 0.06, 1.5);
    const pr = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), pf = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    if (pr || pf) panTarget(pr * dt * orbit.dist * 0.6, -pf * dt * orbit.dist * 0.6);
    const cp = Math.cos(orbit.pitch);
    camera.position.set(orbit.target.x + Math.sin(orbit.yaw) * cp * orbit.dist, orbit.target.y + Math.sin(orbit.pitch) * orbit.dist,
      orbit.target.z + Math.cos(orbit.yaw) * cp * orbit.dist);
    camera.lookAt(orbit.target);
  } else {
    vrLocomotion(dt);
    dolly.updateMatrixWorld(true);
    renderer.xr.updateCamera(camera);          // fresh head pose for rays + lens this frame
  }

  menu.update();

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

  const rad = cursorRadius();
  for (const s of SRC) {
    if (s.down && s.hit.on && !CLICK_TOOLS.has(tool)) applyStroke(s, dt);
    s.ring.visible = s.hit.on;
    if (s.hit.on) {
      s.ring.position.set(TRAY_C.x + s.hit.lx, s.hit.y + 0.012, TRAY_C.z + s.hit.lz);
      s.ring.scale.setScalar(rad);
      s.ring.material.opacity = s.down ? 1 : 0.55 + 0.25 * Math.sin(t * 5);
    }
  }
  updateSandGeo();

  water.material.uniforms.time.value = t;
  camera.getWorldPosition(water.material.uniforms.cam.value);
  updateLens();
  fx.render();
}

function onResize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); }
