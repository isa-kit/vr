// Nature — Glade & Cliffs.  A walkable "vista": rolling hills with a glade,
// a cliff down to fake-reflective water, low-poly forest, sheep, hazy distant
// mountains, drifting clouds, flapping birds, and synthesized wind + birdsong.
// WebXR (VR) + flat desktop.  All the hard stuff is cheated to stay light.

import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- config (overridable from scenes/nature-glade.json) ----------
const cfg = { trees: 150, sheep: 14, birds: 16, mountains: 18 };
const WL = -1.5;            // water level
const EYE = 1.6;           // desktop eye height
const WALK = 5.5, RUN = 2.3;

let scene, camera, renderer, dolly;
let water, birds = [], clouds = [], sheepMesh;
const clock = new THREE.Clock();
const keys = {};
let yaw = 0, pitch = 0, pointerLocked = false;
const fwd = new THREE.Vector3(), right = new THREE.Vector3();
const camWorld = new THREE.Vector3();
const sunDir = new THREE.Vector3(0.25, 0.5, -1).normalize();

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
  let hills = (fbm(x * 0.012 + 11, z * 0.012 + 7) - 0.5) * 15;
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

  scene = new THREE.Scene();
  const horizon = new THREE.Color(0xcfe6f2);
  scene.background = horizon.clone();
  scene.fog = new THREE.Fog(horizon, 60, 300);

  camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 1200);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);
  document.body.appendChild(VRButton.createButton(renderer));

  dolly = new THREE.Group();
  dolly.add(camera);
  scene.add(dolly);
  dolly.position.set(0, 0, 20);   // start in the glade, facing the sea (−z)
  yaw = 0;                          // default camera faces −z (toward the cliff & sea)

  // lights
  scene.add(new THREE.HemisphereLight(0xdcecff, 0x5a6b45, 1.0));
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.15);
  sun.position.copy(sunDir).multiplyScalar(100);
  scene.add(sun);

  buildSky();
  buildTerrain();
  buildWater();
  buildTrees();
  buildSheep();
  buildMountains();
  buildClouds();
  buildBirds();
  buildVRControllers();

  addEventListener('resize', onResize);
  addEventListener('mousemove', onMouseMove);
  addEventListener('keydown', e => { keys[e.code] = true; });
  addEventListener('keyup', e => { keys[e.code] = false; });
  const enter = document.getElementById('enter');
  renderer.domElement.addEventListener('click', () => {
    startAudio();
    if (!pointerLocked && !renderer.xr.isPresenting) lockPointer();
  });
  enter.addEventListener('click', () => { startAudio(); enter.style.opacity = '0'; setTimeout(() => enter.remove(), 500); lockPointer(); });
  document.addEventListener('pointerlockchange', () => { pointerLocked = document.pointerLockElement === renderer.domElement; });
  renderer.xr.addEventListener('sessionstart', startAudio);

  renderer.setAnimationLoop(animate);
}

// ---------- sky + sun ----------
function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x4f93d8) }, mid: { value: new THREE.Color(0xcfe6f2) }, bot: { value: new THREE.Color(0xdfeede) } },
    vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP; uniform vec3 top,mid,bot;
      void main(){ float h=normalize(vP).y;
        vec3 c = h>0.0 ? mix(mid,top,pow(clamp(h,0.0,1.0),0.7)) : mix(mid,bot,clamp(-h*5.0,0.0,1.0));
        gl_FragColor=vec4(c,1.0); }`,
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
  const sand = new THREE.Color(0xd8c89c), grass = new THREE.Color(0x4f7a3e),
        grass2 = new THREE.Color(0x3c6233), rock = new THREE.Color(0x6f7363), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = terrainH(x, z);
    pos.setY(i, h);
    if (h < WL + 0.6) tmp.copy(sand);
    else if (h < 3) tmp.copy(grass).lerp(grass2, Math.random() * 0.5);
    else if (h < 7) tmp.copy(grass2).lerp(rock, smoothstep(3, 9, h) * 0.7);
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
      deep: { value: new THREE.Color(0x12506b) }, shallow: { value: new THREE.Color(0x3f93b0) }, sky: { value: new THREE.Color(0xcfe6f2) },
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
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), cfg.trees);
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
    const x = (Math.random() - 0.5) * 120, z = 6 + Math.random() * 95;   // on the hills behind the glade
    const h = terrainH(x, z); if (h < WL + 0.6 || h > 7) continue;
    d.position.set(x, h, z); d.rotation.set(0, Math.random() * Math.PI * 2, 0); d.scale.setScalar(0.85 + Math.random() * 0.4);
    d.updateMatrix(); sheepMesh.setMatrixAt(n++, d.matrix);
  }
  sheepMesh.count = n; scene.add(sheepMesh);
}

// ---------- distant mountains ----------
function makeMountainGeo() {
  const base = paint(new THREE.ConeGeometry(1, 1.6, 5).translate(0, 0.8, 0), 0x47586f);
  const cap = paint(new THREE.ConeGeometry(0.42, 0.5, 5).translate(0, 1.42, 0), 0x6b7d96);
  return mergeGeometries([base, cap], false);
}
function buildMountains() {
  const mesh = new THREE.InstancedMesh(makeMountainGeo(), new THREE.MeshLambertMaterial({ vertexColors: true }), cfg.mountains);
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
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.8, depthWrite: false, fog: true }));
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

// ---------- VR controllers ----------
function buildVRControllers() {
  for (let i = 0; i < 2; i++) { const c = renderer.xr.getController(i); dolly.add(c); }
}

// ---------- synthesized ambient audio (wind + occasional birdsong) ----------
let actx, started = false;
function startAudio() {
  if (started) return; started = true;
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
      if (src.handedness === 'right') { if (Math.abs(hx) > 0.6) turn = -Math.sign(hx); }
      else { mx += Math.abs(hx) > 0.15 ? hx : 0; mz += Math.abs(hy) > 0.15 ? hy : 0; }
    }
    yaw -= turn * dt * 2.2;
    dolly.rotation.y = yaw;
  }
  if (mx || mz) {
    const speed = (keys.ShiftLeft || keys.ShiftRight ? WALK * RUN : WALK) * dt;
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
  renderer.render(scene, camera);
}

function lockPointer() {
  try { const p = renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
}

function onResize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
