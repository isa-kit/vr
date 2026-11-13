// Nature — Glade & Cliffs.  A walkable "vista": rolling hills with a glade,
// a cliff down to fake-reflective water, low-poly forest, sheep, hazy distant
// mountains, drifting clouds, flapping birds, and synthesized wind + birdsong.
// WebXR (VR) + flat desktop.  All the hard stuff is cheated to stay light.

import * as THREE from 'three';
import { detectXR, createXRMenu, recenterRig, choiceGrid, stepperRow, toggleRow, sectionRow } from '../shared/xrmenu.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createToolkit, createLens } from '../shared/xrtools.js';
import { beautify, SHADER_TAIL } from '../shared/beauty.js';

let fx;
const windU = { value: 0 };   // shared wind clock for swaying foliage

// Lambert material whose upper vertices sway in the wind (trunks stay planted).
function swayMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windU;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 0.21 + instanceMatrix[3].z * 0.17;
      #else
        float ph = 0.0;
      #endif
      float sway = max(0.0, position.y - 1.2) * 0.05;
      transformed.x += sin(uTime * 1.4 + ph) * sway;
      transformed.z += cos(uTime * 1.1 + ph) * sway * 0.6;`);
  };
  return m;
}

// ---------- config (overridable from scenes/nature-glade.json) ----------
const cfg = { trees: 150, sheep: 14, birds: 16, mountains: 18 };
const WL = -1.5;            // water level
const EYE = 1.6;           // desktop eye height
const WALK = 5.5, RUN = 2.3;

let scene, camera, renderer, dolly, world, menu, caps, horizonColor, kit, spy;
let speedMul = 1, snapTurn = false, snapLatch = false, soundOn = true;
const SPEED_STEPS = [0.5, 1, 1.5, 2.5];
let water, birds = [], clouds = [], sheepMesh;
const clock = new THREE.Clock();
const keys = {};
let yaw = 0, pitch = 0, pointerLocked = false;
const fwd = new THREE.Vector3(), right = new THREE.Vector3();
const camWorld = new THREE.Vector3();
const sunDir = new THREE.Vector3(0.33, 0.28, -1).normalize();  // low, golden-hour

// ---------- value-noise terrain ----------
function hash(x, z) { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, z * f); f *= 2; a *= 0.5; } return s; }
function smoothstep(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

// height of the land at (x,z): rolling hills, flattened glade at origin,
// dropping off a cliff into the sea on the north (−z) side.
function terrainH(x, z) {
  let hills = (fbm(x * 0.012 + 11, z * 0.012 + 7) - 0.5) * 12
            + (fbm(x * 0.006 + 3, z * 0.006 + 9) - 0.5) * 11;   // detail + gentle rolling swells
  const d = Math.hypot(x, z);
  hills *= (0.18 + 0.82 * smoothstep(4, 34, d));   // flatten the glade
  const land = smoothstep(-74, -44, z);             // 1 = land, 0 = sea
  const seabed = -12;
  return seabed + (hills - seabed) * land;
}

init();

async function init() {
  try {
    const c = await (await fetch('../scenes/nature-glade.json', { cache: 'no-store' })).json();
    const p = {}; (c.vista?.props || []).forEach(x => p[x.type] = x.count);
    if (p.tree) cfg.trees = p.tree; if (p.sheep) cfg.sheep = p.sheep;
    if (p.mountain) cfg.mountains = p.mountain; if (c.vista?.birds?.count) cfg.birds = c.vista.birds.count;
  } catch (e) {}

  caps = await detectXR();
  scene = new THREE.Scene();
  const horizon = new THREE.Color(0xeadcc0);   // warm hazy horizon
  horizonColor = horizon;
  scene.background = horizon.clone();
  scene.fog = new THREE.Fog(horizon, 60, 300);

  camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 1200);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: caps.ar });   // alpha only if passthrough can be toggled
  if (caps.ar) renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);
  fx = beautify(renderer, scene, camera, { tone: 'neutral', exposure: 1.0, bloom: 0.45, radius: 0.6, threshold: 0.96 });

  dolly = new THREE.Group();
  dolly.add(camera);
  scene.add(dolly);
  dolly.position.set(0, 0, 20);   // start in the glade, facing the sea (−z)
  yaw = 0;                          // default camera faces −z (toward the cliff & sea)

  // lights
  scene.add(new THREE.HemisphereLight(0xe9f0e2, 0x55663c, 0.92));
  const sun = new THREE.DirectionalLight(0xffe6bf, 1.2);
  sun.position.copy(sunDir).multiplyScalar(100);
  scene.add(sun);

  buildSky();
  buildTerrain();
  buildWater();
  buildTrees();
  buildBroadleaf();
  buildRocks();
  buildFlowers();
  buildSheep();
  buildDeer();
  buildMountains();
  buildClouds();
  buildBirds();

  // everything but the rig lives in `world` so the menu can hide it for passthrough
  world = new THREE.Group();
  for (const o of [...scene.children]) if (o !== dolly) world.add(o);
  scene.add(world);

  menu = createXRMenu({
    renderer, camera, dolly, caps,
    title: 'Nature — Glade & Cliffs',
    hint: 'WASD walk · mouse look · Shift run · hold Z for binoculars · click the view to look around · Esc/M menu. In VR: grip the spyglass at your side and raise it to your eye.',
    rows: [
      sectionRow('Walking'),
      stepperRow('Speed', () => '×' + SPEED_STEPS[speedIdx()], () => stepSpeed(-1), () => stepSpeed(1)),
      { label: 'Turning', cells: [
        { text: 'Smooth', action: () => { snapTurn = false; }, active: () => !snapTurn },
        { text: 'Snap', action: () => { snapTurn = true; }, active: () => snapTurn } ] },
    ],
    sound: { get: () => soundOn, set: setSound },
    setBackdrop,
    recenter,
    onBeforeEnter: startAudio,
  });

  // spyglass: a hand-held lens (render-to-texture, ×6) floating at your left hip; grip to grab, look through it
  kit = createToolkit({ renderer, scene, dolly, camera, menu });
  spy = createLens({ renderer, scene, camera, menu, radius: 0.085, zoom: 6, ring: 0xc9a24a });
  dolly.add(spy.group);
  const spyHome = new THREE.Vector3(-0.34, -0.5, -0.4);
  spy.group.position.copy(spyHome);
  kit.add({
    name: 'Spyglass', object: spy.group, radius: 0.22,
    grip: { pos: new THREE.Vector3(0, 0.0, -0.3), rot: new THREE.Euler() },
    home: 'dolly', homePos: spyHome, homeRot: new THREE.Euler(),
    onGrab: () => spy.setOn(true), onRelease: () => spy.setOn(false), onHeld: () => spy.faceEye(),
    onTick: () => { if (!spy.on) spy.faceEye(); },
  });

  addEventListener('resize', onResize);
  addEventListener('mousemove', onMouseMove);
  addEventListener('keydown', e => { keys[e.code] = true; });
  addEventListener('keyup', e => { keys[e.code] = false; });
  const enter = document.getElementById('enter');
  renderer.domElement.addEventListener('click', () => {
    startAudio();
    if (!pointerLocked && !renderer.xr.isPresenting) { lockPointer(); menu.close(); }
  });
  enter.addEventListener('click', () => { startAudio(); enter.style.opacity = '0'; setTimeout(() => enter.remove(), 500); lockPointer(); menu.close(); });
  document.addEventListener('pointerlockchange', () => { pointerLocked = document.pointerLockElement === renderer.domElement; });
  renderer.xr.addEventListener('sessionstart', startAudio);

  renderer.setAnimationLoop(animate);
}

// ---------- sky + sun ----------
function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x2f68b4) }, mid: { value: new THREE.Color(0xf0d2a6) }, bot: { value: new THREE.Color(0xf4e3c6) } },
    vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP; uniform vec3 top,mid,bot;
      void main(){ float h=normalize(vP).y;
        vec3 c = h>0.0 ? mix(mid,top,pow(clamp(h,0.0,1.0),0.7)) : mix(mid,bot,clamp(-h*5.0,0.0,1.0));
        gl_FragColor=vec4(c,1.0); ${SHADER_TAIL} }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(700, 24, 16), mat));

  // soft sun disc
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d'); const rg = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,250,235,1)'); rg.addColorStop(0.3, 'rgba(255,244,214,0.8)'); rg.addColorStop(1, 'rgba(255,244,214,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, fog: false }));
  spr.position.copy(sunDir).multiplyScalar(600); spr.scale.setScalar(120);
  scene.add(spr);
}

// ---------- terrain ----------
function paint(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
function buildTerrain() {
  const S = 720, N = 190;
  const geo = new THREE.PlaneGeometry(S, S, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0xd8c89c), grass = new THREE.Color(0x579139),
        grass2 = new THREE.Color(0x3f6f33), rock = new THREE.Color(0x6f7363), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = terrainH(x, z);
    pos.setY(i, h);
    if (h < WL + 0.5) tmp.copy(sand);
    else if (h < 5) tmp.copy(grass).lerp(grass2, Math.random() * 0.5);
    else if (h < 10) tmp.copy(grass2).lerp(rock, smoothstep(5, 13, h) * 0.6);
    else tmp.copy(rock);
    tmp.offsetHSL(0, 0, (Math.random() - 0.5) * 0.05);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));
}

// ---------- water (cheated: fresnel + ripple + sun glint, no real reflection) ----------
function buildWater() {
  const geo = new THREE.PlaneGeometry(2400, 2400, 1, 1); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, fog: true,
    uniforms: {
      time: { value: 0 }, cam: { value: new THREE.Vector3() }, sun: { value: sunDir },
      deep: { value: new THREE.Color(0x154f66) }, shallow: { value: new THREE.Color(0x4a9db2) }, sky: { value: new THREE.Color(0xf0dcb8) },
      fogColor: { value: scene.fog.color }, fogNear: { value: scene.fog.near }, fogFar: { value: scene.fog.far },
    },
    vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; vec4 mv=viewMatrix*w; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `
      varying vec3 vW; uniform float time; uniform vec3 cam,sun,deep,shallow,sky;
      uniform vec3 fogColor; uniform float fogNear,fogFar;
      void main(){
        float r = sin(vW.x*0.22+time*1.1)+sin(vW.z*0.19-time*0.85)+sin((vW.x+vW.z)*0.12+time*0.6);
        vec3 N = normalize(vec3(0.05*cos(vW.x*0.22+time*1.1), 1.0, 0.05*cos(vW.z*0.19-time*0.85)));
        vec3 V = normalize(cam - vW);
        float fres = pow(1.0 - max(dot(N,V),0.0), 3.0);
        vec3 base = mix(deep, shallow, clamp(0.5+0.12*r,0.0,1.0));
        vec3 col = mix(base, sky, fres*0.85);
        vec3 H = normalize(V + normalize(sun));
        col += vec3(1.0,0.96,0.82) * pow(max(dot(N,H),0.0), 140.0) * 1.3;
        float fog = smoothstep(fogNear, fogFar, length(cam - vW));
        col = mix(col, fogColor, fog);
        gl_FragColor = vec4(col, 0.93);
        ${SHADER_TAIL}
      }`,
  });
  water = new THREE.Mesh(geo, mat); water.position.y = WL; scene.add(water);
}

// ---------- trees ----------
function makeTreeGeo() {
  const trunk = paint(new THREE.CylinderGeometry(0.16, 0.26, 1.7, 6).translate(0, 0.85, 0), 0x6a4a2b);
  const c1 = paint(new THREE.ConeGeometry(1.15, 2.1, 7).translate(0, 2.25, 0), 0x3f6b35);
  const c2 = paint(new THREE.ConeGeometry(0.9, 1.7, 7).translate(0, 3.15, 0), 0x4e7d3e);
  const c3 = paint(new THREE.ConeGeometry(0.58, 1.3, 7).translate(0, 3.95, 0), 0x5c8a48);
  return mergeGeometries([trunk, c1, c2, c3], false);
}
function buildTrees() {
  const geo = makeTreeGeo();
  const mesh = new THREE.InstancedMesh(geo, swayMaterial(), cfg.trees);
  const d = new THREE.Object3D(); let n = 0, tries = 0;
  while (n < cfg.trees && tries++ < cfg.trees * 40) {
    const a = Math.random() * Math.PI * 2, r = 26 + Math.random() * 150;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z < -40) continue;                      // keep trees off the sea side
    const h = terrainH(x, z); if (h < WL + 0.5 || h > 8) continue;
    d.position.set(x, h - 0.1, z); d.rotation.set(0, Math.random() * Math.PI * 2, 0);
    d.scale.setScalar(0.8 + Math.random() * 1.3); d.updateMatrix();
    mesh.setMatrixAt(n++, d.matrix);
  }
  mesh.count = n; scene.add(mesh);
}

// ---------- broadleaf trees (mixed into the forest for variety) ----------
function makeBroadleafGeo() {
  const trunk = paint(new THREE.CylinderGeometry(0.17, 0.3, 2.0, 6).translate(0, 1.0, 0), 0x6a4a2b);
  const c1 = paint(new THREE.SphereGeometry(1.35, 7, 6).translate(0, 2.7, 0), 0x567f3d);
  const c2 = paint(new THREE.SphereGeometry(1.0, 7, 6).translate(0.75, 3.2, 0.3), 0x6a9a4c);
  const c3 = paint(new THREE.SphereGeometry(0.95, 7, 6).translate(-0.7, 3.05, -0.25), 0x4c7338);
  return mergeGeometries([trunk, c1, c2, c3], false);
}
function buildBroadleaf() {
  const mesh = new THREE.InstancedMesh(makeBroadleafGeo(), swayMaterial(), 55);
  const d = new THREE.Object3D(); let n = 0, tries = 0;
  while (n < 55 && tries++ < 3000) {
    const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * 150;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z < -40) continue;
    const h = terrainH(x, z); if (h < WL + 0.6 || h > 7) continue;
    d.position.set(x, h - 0.1, z); d.rotation.set(0, Math.random() * Math.PI * 2, 0);
    d.scale.setScalar(0.75 + Math.random() * 1.1); d.updateMatrix(); mesh.setMatrixAt(n++, d.matrix);
  }
  mesh.count = n; scene.add(mesh);
}

// ---------- rocks ----------
function buildRocks() {
  const geo = paint(new THREE.DodecahedronGeometry(0.6, 0).scale(1, 0.68, 1), 0x7c766a);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), 46);
  const d = new THREE.Object3D(); let n = 0, tries = 0;
  while (n < 46 && tries++ < 2500) {
    const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 150;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z < -42) continue;
    const h = terrainH(x, z); if (h < WL + 0.2 || h > 8) continue;
    d.position.set(x, h + 0.1, z); d.rotation.set(Math.random(), Math.random() * 6, Math.random());
    d.scale.setScalar(0.35 + Math.random() * 1.5); d.updateMatrix(); mesh.setMatrixAt(n++, d.matrix);
  }
  mesh.count = n; scene.add(mesh);
}

// ---------- wildflower patches (camera-facing sprites) ----------
function buildFlowers() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
  const cols = ['#f6d64a', '#ef6f8b', '#f4f6f8', '#b98ef0', '#f29b4a'];
  for (let i = 0; i < 20; i++) { g.fillStyle = cols[i % cols.length]; g.beginPath(); g.arc(8 + Math.random() * 48, 10 + Math.random() * 48, 3 + Math.random() * 3, 0, 7); g.fill(); }
  const tex = new THREE.CanvasTexture(cv);
  let placed = 0, tries = 0;
  while (placed < 38 && tries++ < 2500) {
    const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 120;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z < -40) continue;
    const h = terrainH(x, z); if (h < WL + 0.5 || h > 6) continue;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: true }));
    s.position.set(x, h + 0.35, z); s.scale.setScalar(0.55 + Math.random() * 0.5); scene.add(s); placed++;
  }
}

// ---------- distant deer ----------
function makeDeerGeo() {
  const body = paint(new THREE.SphereGeometry(0.5, 7, 6).scale(1.5, 0.85, 0.7).translate(0, 1.15, 0), 0x8a6a46);
  const neck = paint(new THREE.CylinderGeometry(0.12, 0.17, 0.75, 5).rotateZ(-0.55).translate(0.62, 1.55, 0), 0x8a6a46);
  const head = paint(new THREE.SphereGeometry(0.22, 6, 5).scale(1.3, 0.8, 0.8).translate(1.0, 1.85, 0), 0x7a5a3a);
  const legs = [[-0.42, 0.28], [0.42, 0.28], [-0.42, -0.28], [0.42, -0.28]].map(([lx, lz]) =>
    paint(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 4).translate(lx, 0.55, lz), 0x5a4228));
  return mergeGeometries([body, neck, head, ...legs], false);
}
function buildDeer() {
  const mesh = new THREE.InstancedMesh(makeDeerGeo(), new THREE.MeshLambertMaterial({ vertexColors: true }), 6);
  const d = new THREE.Object3D(); let n = 0, tries = 0;
  while (n < 6 && tries++ < 500) {
    const x = (Math.random() - 0.5) * 170, z = 45 + Math.random() * 95;
    const h = terrainH(x, z); if (h < WL + 0.6 || h > 7) continue;
    d.position.set(x, h, z); d.rotation.set(0, Math.random() * 6, 0); d.scale.setScalar(0.9 + Math.random() * 0.3);
    d.updateMatrix(); mesh.setMatrixAt(n++, d.matrix);
  }
  mesh.count = n; scene.add(mesh);
}

// ---------- sheep ----------
function makeSheepGeo() {
  const body = paint(new THREE.SphereGeometry(0.5, 8, 6).scale(1.35, 0.95, 0.95).translate(0, 0.78, 0), 0xf1ede4);
  const head = paint(new THREE.SphereGeometry(0.25, 8, 6).translate(0.72, 0.92, 0), 0x3b332e);
  const legs = [[-0.3, 0.32], [0.3, 0.32], [-0.3, -0.32], [0.3, -0.32]].map(([lx, lz]) =>
    paint(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 5).translate(lx, 0.25, lz), 0x4a3f36));
  return mergeGeometries([body, head, ...legs], false);
}
function buildSheep() {
  sheepMesh = new THREE.InstancedMesh(makeSheepGeo(), new THREE.MeshLambertMaterial({ vertexColors: true }), cfg.sheep);
  const d = new THREE.Object3D(); let n = 0, tries = 0;
  while (n < cfg.sheep && tries++ < cfg.sheep * 60) {
    const x = (Math.random() - 0.5) * 165, z = 6 + Math.random() * 130;   // spread across the rolling hills behind the glade
    const h = terrainH(x, z); if (h < WL + 0.6 || h > 7) continue;
    d.position.set(x, h, z); d.rotation.set(0, Math.random() * Math.PI * 2, 0); d.scale.setScalar(0.85 + Math.random() * 0.4);
    d.updateMatrix(); sheepMesh.setMatrixAt(n++, d.matrix);
  }
  sheepMesh.count = n; scene.add(sheepMesh);
}

// ---------- distant mountains ----------
function makeMountainGeo() {
  const base = paint(new THREE.ConeGeometry(1, 1.6, 5).translate(0, 0.8, 0), 0x9aaecb);
  const cap = paint(new THREE.ConeGeometry(0.42, 0.5, 5).translate(0, 1.42, 0), 0xf1f4f9);
  return mergeGeometries([base, cap], false);
}
function buildMountains() {
  // own cool "atmospheric blue" instead of the warm ground fog → layered distant peaks
  const mesh = new THREE.InstancedMesh(makeMountainGeo(), new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }), cfg.mountains);
  const d = new THREE.Object3D();
  for (let i = 0; i < cfg.mountains; i++) {
    const a = -Math.PI / 2 + (i / cfg.mountains - 0.5) * 1.7 + (Math.random() - 0.5) * 0.16;  // across the sea (north, −z)
    const r = 215 + Math.random() * 70;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, s = 48 + Math.random() * 52;
    d.position.set(x, -9, z); d.rotation.set(0, Math.random() * Math.PI, 0);
    d.scale.set(s * (1.0 + Math.random() * 0.6), s * 0.52, s * (1.0 + Math.random() * 0.6)); d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  }
  scene.add(mesh);
}

// ---------- clouds ----------
function buildClouds() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const x = 60 + Math.random() * 136, y = 90 + Math.random() * 76, r = 30 + Math.random() * 50;
    const rg = g.createRadialGradient(x, y, 2, x, y, r);
    rg.addColorStop(0, 'rgba(255,255,255,0.9)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  for (let i = 0; i < 12; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xece6df, transparent: true, opacity: 0.75, depthWrite: false, fog: true }));
    s.position.set((Math.random() - 0.5) * 600, 70 + Math.random() * 60, (Math.random() - 0.5) * 600);
    s.scale.set(60 + Math.random() * 70, 34 + Math.random() * 30, 1);
    s.userData.sp = 1.5 + Math.random() * 2.5; clouds.push(s); scene.add(s);
  }
}

// ---------- birds ----------
function makeBird() {
  const g = new THREE.Group();
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1.4, 0, 0.45, 1.4, 0, -0.45]), 3));
  wingGeo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ color: 0x33373f, side: THREE.DoubleSide, fog: true });
  const l = new THREE.Mesh(wingGeo, mat); const r = new THREE.Mesh(wingGeo, mat); r.scale.x = -1;
  g.add(l); g.add(r); g.userData = { l, r };
  return g;
}
function buildBirds() {
  for (let i = 0; i < cfg.birds; i++) {
    const b = makeBird();
    b.userData.cx = (Math.random() - 0.5) * 120; b.userData.cz = -60 - Math.random() * 140;
    b.userData.ra = 20 + Math.random() * 60; b.userData.rb = 14 + Math.random() * 40;
    b.userData.y = 24 + Math.random() * 34; b.userData.sp = 0.1 + Math.random() * 0.18;
    b.userData.ph = Math.random() * Math.PI * 2; b.userData.flap = 6 + Math.random() * 4;
    b.scale.setScalar(0.8 + Math.random() * 0.9); birds.push(b); scene.add(b);
  }
}

// ---------- menu hooks ----------
const speedIdx = () => SPEED_STEPS.indexOf(speedMul);
function stepSpeed(d) { speedMul = SPEED_STEPS[Math.max(0, Math.min(SPEED_STEPS.length - 1, speedIdx() + d))]; }
// passthrough on = hide the whole world so the room shows through
function setBackdrop(visible) {
  world.visible = visible;
  scene.background = visible ? horizonColor : null;
}
function recenter() {
  if (renderer.xr.isPresenting) { recenterRig(dolly, camera, new THREE.Vector3(0, 0, 20), 0); yaw = dolly.rotation.y; }
  else { dolly.position.set(0, 0, 20); yaw = 0; pitch = 0; }
}

// ---------- synthesized ambient audio (wind + occasional birdsong) ----------
let actx, started = false;
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
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 480;
    const gain = actx.createGain(); gain.gain.value = 0.11;
    src.connect(lp).connect(gain).connect(actx.destination); src.start();
    // slow swell
    const lfo = actx.createOscillator(), lg = actx.createGain();
    lfo.frequency.value = 0.07; lg.gain.value = 0.05; lfo.connect(lg).connect(gain.gain); lfo.start();
    // distant sea lapping: a second, deeper noise layer with a slow tide swell
    const sea = actx.createBufferSource(); sea.buffer = buf; sea.loop = true;
    const lp2 = actx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 190;
    const sg = actx.createGain(); sg.gain.value = 0.05;
    sea.connect(lp2).connect(sg).connect(actx.destination); sea.start();
    const tide = actx.createOscillator(), tg = actx.createGain();
    tide.frequency.value = 0.16; tg.gain.value = 0.035; tide.connect(tg).connect(sg.gain); tide.start();
    chirp();
  } catch (e) {}
}
function chirp() {
  if (!actx) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = 'sine'; const base = 1500 + Math.random() * 1800;
  o.frequency.setValueAtTime(base, t); o.frequency.linearRampToValueAtTime(base * (1 + Math.random() * 0.2), t + 0.08);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.26);
  setTimeout(chirp, 2200 + Math.random() * 6500);
}

// ---------- input / movement ----------
function onMouseMove(e) {
  if (!pointerLocked || renderer.xr.isPresenting) return;
  yaw -= e.movementX * 0.0025; pitch -= e.movementY * 0.0025;
  pitch = Math.max(-1.2, Math.min(1.2, pitch));
}
function handleMovement(dt) {
  const pres = renderer.xr.isPresenting;
  let mx = 0, mz = 0, turn = 0;
  if (!pres) {
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    if (keys.KeyW) mz -= 1; if (keys.KeyS) mz += 1; if (keys.KeyA) mx -= 1; if (keys.KeyD) mx += 1;
  } else {
    const s = renderer.xr.getSession();
    for (const src of s.inputSources) {
      if (!src.gamepad) continue; const ax = src.gamepad.axes;
      const hx = ax[2] ?? ax[0] ?? 0, hy = ax[3] ?? ax[1] ?? 0;
      if (src.handedness === 'right') {
        if (snapTurn) {
          if (Math.abs(hx) > 0.7 && !snapLatch) { snapLatch = true; yaw -= Math.sign(hx) * Math.PI / 6; }
          else if (Math.abs(hx) < 0.3) snapLatch = false;
        } else if (Math.abs(hx) > 0.6) turn = -Math.sign(hx);
      }
      else { mx += Math.abs(hx) > 0.15 ? hx : 0; mz += Math.abs(hy) > 0.15 ? hy : 0; }
    }
    yaw -= turn * dt * 2.2;
    dolly.rotation.y = yaw;
  }
  if (mx || mz) {
    const speed = (keys.ShiftLeft || keys.ShiftRight ? WALK * RUN : WALK) * speedMul * dt;
    const h = pres ? yaw : yaw;   // face dir
    camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    right.crossVectors(fwd, camera.up).normalize();
    dolly.position.addScaledVector(fwd, -mz * speed);
    dolly.position.addScaledVector(right, mx * speed);
  }
  // clamp inside the world, and don't walk off the cliff
  const R = 150; const d = Math.hypot(dolly.position.x, dolly.position.z);
  if (d > R) { dolly.position.x *= R / d; dolly.position.z *= R / d; }
  if (dolly.position.z < -38) dolly.position.z = -38;
  dolly.position.y = terrainH(dolly.position.x, dolly.position.z);
  camera.position.y = pres ? 0 : EYE;
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  handleMovement(dt);
  camera.getWorldPosition(camWorld);
  water.material.uniforms.time.value = t;
  water.material.uniforms.cam.value.copy(camWorld);
  for (const c of clouds) { c.position.x += c.userData.sp * dt; if (c.position.x > 320) c.position.x = -320; }
  for (const b of birds) {
    const u = b.userData, a = t * u.sp + u.ph;
    const x = u.cx + Math.cos(a) * u.ra, z = u.cz + Math.sin(a) * u.rb;
    b.position.set(x, u.y + Math.sin(a * 2) * 1.5, z);
    b.rotation.y = -a + Math.PI / 2;
    const f = Math.sin(t * u.flap + u.ph) * 0.6;
    u.l.rotation.z = f; u.r.rotation.z = f;
  }
  windU.value = t;
  menu.update();
  kit.update(dt);
  spy.group.visible = renderer.xr.isPresenting;
  if (!renderer.xr.isPresenting) {                 // desktop: hold Z for binoculars
    const f = keys.KeyZ ? 20 : 70;
    if (Math.abs(camera.fov - f) > 0.1) { camera.fov += (f - camera.fov) * Math.min(1, dt * 10); camera.updateProjectionMatrix(); }
  }
  spy.update();
  fx.render();
}

function lockPointer() {
  try { const p = renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
}

function onResize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
