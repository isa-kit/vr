// Sand Castle — a seated beach sandbox. The "physics" is cheated: the sand is a
// heightfield you sculpt. Piling with your hand slumps to a natural slope (angle
// of repose); a bucket-stamped tower is "molded" and holds its shape. Dig moats,
// smooth, reset. Light enough for any headset. WebXR (VR) + flat desktop.

import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { beautify, SHADER_TAIL } from '../shared/beauty.js';

let fx, grain;

// ---------- sand grid ----------
const GN = 64;                 // cells per side
const TABLE = 1.8;             // sand patch size (m)
const CELL = TABLE / (GN - 1);
const MAXH = 0.6;
const sand = new Float32Array(GN * GN);
const gi = (i, j) => j * GN + i;

let scene, camera, renderer, dolly, water, sandMesh, sandGeo, vmap, cursor;
const clock = new THREE.Clock();
let tool = 'pile', sculpting = false, dirty = true;
let yaw = 0, pitch = -0.42;
const keys = {};
const ray = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2(0, 0);
const tmpM = new THREE.Matrix4();
const hit = { on: false, lx: 0, lz: 0 };     // last sand hit, in table-local coords
const sunDir = new THREE.Vector3(-0.75, 0.58, -0.32).normalize();   // raking side-light from the left: lit faces, shadows stretch right
const panelButtons = [];
let hoverBtn = null;
const controllers = [];

// beach ground height: flat near the player, sloping down to the sea in front (−z)
function groundH(x, z) {
  if (z > -3) return 0;
  return -0.55 * smoothstep(-3, -8, z);
}
function smoothstep(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

init();

async function init() {
  scene = new THREE.Scene();
  const horizon = new THREE.Color(0xdcecf5);
  scene.background = horizon.clone();
  scene.fog = new THREE.Fog(horizon, 14, 90);

  camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.05, 400);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.xr.enabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  document.body.appendChild(VRButton.createButton(renderer));
  fx = beautify(renderer, scene, camera, { tone: 'neutral', exposure: 1.08, bloom: 0.35, radius: 0.5, threshold: 0.96 });

  dolly = new THREE.Group();
  dolly.add(camera);
  scene.add(dolly);
  dolly.position.set(0, 0, 1.15);     // seated just in front of the sand

  scene.add(new THREE.HemisphereLight(0xdff0ff, 0xbfa87e, 1.0));
  const sun = new THREE.DirectionalLight(0xffe6c0, 1.45);
  sun.position.copy(sunDir).multiplyScalar(6); scene.add(sun);
  // tight shadow box around the sand tray only → crisp, cheap shadows
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6, near: 0.5, far: 14 });
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.015; sun.shadow.radius = 3;

  buildSky();
  buildBeach();
  buildWater();
  buildDecor();
  buildSandTable();
  starterCastle();
  buildCursor();
  buildPanel();
  for (let i = 0; i < 2; i++) { const c = renderer.xr.getController(i); c.addEventListener('selectstart', onSelectStart); c.addEventListener('selectend', onSelectEnd); dolly.add(c); controllers.push(c); }

  addEventListener('resize', onResize);
  addEventListener('pointermove', onPointerMove);
  addEventListener('pointerdown', onPointerDown);
  addEventListener('pointerup', () => { sculpting = false; });
  addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'KeyR') resetSand(); });
  addEventListener('keyup', e => { keys[e.code] = false; });
  const enter = document.getElementById('enter');
  enter.addEventListener('click', () => { startAudio(); enter.style.opacity = '0'; setTimeout(() => enter.remove(), 500); });
  renderer.domElement.addEventListener('pointerdown', startAudio);
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
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(300, 24, 16), mat));
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d'); const rg = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,252,240,1)'); rg.addColorStop(0.3, 'rgba(255,248,224,0.75)'); rg.addColorStop(1, 'rgba(255,248,224,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, fog: false }));
  spr.position.copy(sunDir).multiplyScalar(240); spr.scale.setScalar(55); scene.add(spr);
}

// ---------- beach ground ----------
function paintGeo(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3)); return geo;
}
function buildBeach() {
  const geo = new THREE.PlaneGeometry(120, 120, 80, 80); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const dry = new THREE.Color(0xe4d2a2), wet = new THREE.Color(0xb49a68), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = groundH(x, z);
    pos.setY(i, h);
    tmp.copy(dry).lerp(wet, smoothstep(-2.5, -5, z));
    tmp.offsetHSL(0, 0, (Math.random() - 0.5) * 0.04);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const beach = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  beach.receiveShadow = true; scene.add(beach);
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
  water = new THREE.Mesh(geo, mat); water.position.y = -0.52; scene.add(water);
}

// ---------- decorations: bucket, spade, shells ----------
function buildDecor() {
  // bucket
  const bucket = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.085, 0.16, 16, 1, true), new THREE.MeshLambertMaterial({ color: 0xe7563f, side: THREE.DoubleSide }));
  body.position.y = 0.08; bucket.add(body);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 8, 20), new THREE.MeshLambertMaterial({ color: 0xc8402c }));
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.16; bucket.add(rim);
  bucket.position.set(0.72, 0, 0.1); bucket.rotation.y = -0.4; scene.add(bucket);
  bucket.traverse(o => { o.castShadow = true; });
  // spade
  const spade = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 8), new THREE.MeshLambertMaterial({ color: 0x3f7fd0 }));
  handle.position.y = 0.17; spade.add(handle);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.008), new THREE.MeshLambertMaterial({ color: 0xf4c23a }));
  blade.position.y = 0.02; blade.rotation.x = -0.2; spade.add(blade);
  spade.position.set(-0.72, 0, 0.18); spade.rotation.set(0.5, 0.3, 0.2); scene.add(spade);
  spade.traverse(o => { o.castShadow = true; });
  // shells + starfish
  const shellMat = [0xf3d9d0, 0xeabfcb, 0xf0e4d2];
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2, r = 1.1 + Math.random() * 1.6;
    const x = Math.cos(a) * r, z = 0.5 + Math.sin(a) * r;
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.035, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: shellMat[i % 3] }));
    s.position.set(x, groundH(x, z) + 0.005, z); s.rotation.set(-Math.PI / 2 + Math.random() * 0.4, Math.random(), 0); scene.add(s);
  }
  const star = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.01, 5), new THREE.MeshLambertMaterial({ color: 0xe98b4a }));
  star.position.set(-0.4, 0.006, -0.1); star.rotation.y = 0.3; scene.add(star);
}

// ---------- sand table ----------
function buildSandTable() {
  sandGeo = new THREE.PlaneGeometry(TABLE, TABLE, GN - 1, GN - 1); sandGeo.rotateX(-Math.PI / 2);
  const pos = sandGeo.attributes.position;
  vmap = new Int32Array(pos.count);
  for (let v = 0; v < pos.count; v++) {
    const i = Math.round((pos.getX(v) + TABLE / 2) / CELL), j = Math.round((pos.getZ(v) + TABLE / 2) / CELL);
    vmap[v] = gi(Math.min(GN - 1, Math.max(0, i)), Math.min(GN - 1, Math.max(0, j)));
  }
  sandGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
  sandMesh = new THREE.Mesh(sandGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  sandMesh.position.set(0, 0.001, 0); scene.add(sandMesh);
  sandMesh.castShadow = true; sandMesh.receiveShadow = true;   // castles shade the sand around them
  grain = new Float32Array(pos.count);
  for (let v = 0; v < pos.count; v++) grain[v] = (Math.random() - 0.5) * 0.09;   // static sand-grain speckle
  // a little wooden rim around the sand patch
  const rimMat = new THREE.MeshLambertMaterial({ color: 0x9c6b3a });
  const rG = new THREE.Group();
  for (const [w, d, x, z] of [[TABLE + 0.08, 0.04, 0, TABLE / 2 + 0.02], [TABLE + 0.08, 0.04, 0, -TABLE / 2 - 0.02], [0.04, TABLE + 0.08, TABLE / 2 + 0.02, 0], [0.04, TABLE + 0.08, -TABLE / 2 - 0.02, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), rimMat); m.position.set(x, 0.0, z); rG.add(m);
  }
  rG.traverse(o => { o.castShadow = true; o.receiveShadow = true; });
  scene.add(rG);
}

function buildCursor() {
  cursor = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.085, 28), new THREE.MeshBasicMaterial({ color: 0x5a3d18, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  cursor.rotation.x = -Math.PI / 2; cursor.visible = false; cursor.renderOrder = 5; scene.add(cursor);
}

// ---------- sand editing (the cheated physics) ----------
function brush(lx, lz, add) {
  const ci = (lx + TABLE / 2) / CELL, cj = (lz + TABLE / 2) / CELL, rad = 5.5;
  for (let j = Math.max(0, Math.floor(cj - rad)); j <= Math.min(GN - 1, cj + rad); j++)
    for (let i = Math.max(0, Math.floor(ci - rad)); i <= Math.min(GN - 1, ci + rad); i++) {
      const d = Math.hypot(i - ci, j - cj); if (d > rad) continue;
      const f = smoothstep(rad, 0, d);
      if (tool === 'smooth') {
        const avg = (sand[gi(Math.max(0, i - 1), j)] + sand[gi(Math.min(GN - 1, i + 1), j)] + sand[gi(i, Math.max(0, j - 1))] + sand[gi(i, Math.min(GN - 1, j + 1))]) / 4;
        sand[gi(i, j)] += (avg - sand[gi(i, j)]) * f * 0.4;
      } else {
        sand[gi(i, j)] = Math.min(MAXH, Math.max(0, sand[gi(i, j)] + add * f * 0.03));
      }
    }
  if (tool === 'pile' || tool === 'dig') slump(2);
  dirty = true;
}

// angle-of-repose cheat: hand-piled sand slumps to a stable slope; molded towers don't call this
function slump(iter) {
  const maxStep = 0.019;
  for (let k = 0; k < iter; k++)
    for (let j = 0; j < GN; j++)
      for (let i = 0; i < GN; i++) {
        const c = gi(i, j), hc = sand[c];
        const nb = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
        for (const [ni, nj] of nb) {
          if (ni < 0 || nj < 0 || ni >= GN || nj >= GN) continue;
          const n = gi(ni, nj), diff = hc - sand[n];
          if (diff > maxStep) { const m = (diff - maxStep) * 0.25; sand[c] -= m; sand[n] += m; }
        }
      }
}

// bucket-molded tower: a flat-topped, lightly tapered mound with battlements that HOLDS shape
function stampTower(lx, lz) {
  const ci = (lx + TABLE / 2) / CELL, cj = (lz + TABLE / 2) / CELL, R = 7.5, H = 0.42;
  for (let j = Math.max(0, Math.floor(cj - R - 2)); j <= Math.min(GN - 1, cj + R + 2); j++)
    for (let i = Math.max(0, Math.floor(ci - R - 2)); i <= Math.min(GN - 1, ci + R + 2); i++) {
      const d = Math.hypot(i - ci, j - cj); if (d > R + 2) continue;
      let h;
      if (d < R * 0.78) h = H;
      else if (d < R) h = H * (1 - (d - R * 0.78) / (R * 0.22) * 0.5);
      else h = Math.max(0, H * 0.5 * (1 - (d - R) / 2));
      // battlements: a ring of little merlons at the rim
      if (d > R * 0.6 && d < R * 0.82) {
        const ang = Math.atan2(j - cj, i - ci);
        if (Math.cos(ang * 8) > 0.3) h += 0.06;
      }
      sand[gi(i, j)] = Math.max(sand[gi(i, j)], Math.min(MAXH, h));
    }
  dirty = true;
}

function raiseRidge(lx, lz, R, H) {
  const ci = (lx + TABLE / 2) / CELL, cj = (lz + TABLE / 2) / CELL;
  for (let j = Math.max(0, Math.floor(cj - R)); j <= Math.min(GN - 1, cj + R); j++)
    for (let i = Math.max(0, Math.floor(ci - R)); i <= Math.min(GN - 1, ci + R); i++) {
      const d = Math.hypot(i - ci, j - cj); if (d > R) continue;
      const h = H * (d < R * 0.55 ? 1 : 1 - (d - R * 0.55) / (R * 0.45));
      sand[gi(i, j)] = Math.max(sand[gi(i, j)], Math.min(MAXH, h));
    }
}
function wall(x0, z0, x1, z1, H) { const n = 38; for (let k = 0; k <= n; k++) { const t = k / n; raiseRidge(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 2.0, H); } }
function starterCastle() {
  const s = 0.42, zf = -0.15, zb = 0.5;
  stampTower(-s, zf); stampTower(s, zf); stampTower(-s, zb); stampTower(s, zb);
  wall(-s, zf, s, zf, 0.2); wall(-s, zb, s, zb, 0.2); wall(-s, zf, -s, zb, 0.2); wall(s, zf, s, zb, 0.2);
  dirty = true;
}
function resetSand() { sand.fill(0); dirty = true; }

function updateSandGeo() {
  const pos = sandGeo.attributes.position, col = sandGeo.attributes.color;
  const wet = new THREE.Color(0xb49a68), dry = new THREE.Color(0xe8d4a4), tmp = new THREE.Color();
  for (let v = 0; v < pos.count; v++) {
    const h = sand[vmap[v]]; pos.setY(v, h);
    tmp.copy(wet).lerp(dry, smoothstep(0, 0.28, h)).multiplyScalar(1 + grain[v]);
    col.setXYZ(v, tmp.r, tmp.g, tmp.b);
  }
  pos.needsUpdate = true; col.needsUpdate = true; sandGeo.computeVertexNormals();
}

// ---------- tool panel (in-world buttons) ----------
function makeBtnTex(label, active) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96; const x = c.getContext('2d');
  x.fillStyle = active ? 'rgba(255,214,150,0.96)' : 'rgba(28,32,46,0.92)';
  rr(x, 6, 6, 244, 84, 18); x.fill();
  x.lineWidth = 3; x.strokeStyle = active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.22)'; rr(x, 6, 6, 244, 84, 18); x.stroke();
  x.fillStyle = active ? '#1a1407' : '#eef1ff'; x.font = '600 40px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(label, 128, 50);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}
function rr(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
function buildPanel() {
  const group = new THREE.Group();
  const tools = [['Pile', 'pile'], ['Dig', 'dig'], ['Tower', 'tower'], ['Smooth', 'smooth'], ['Reset', 'reset']];
  tools.forEach(([label, id], k) => {
    const mat = new THREE.MeshBasicMaterial({ map: makeBtnTex(label, id === tool), transparent: true, depthTest: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.11), mat); m.renderOrder = 999;
    m.position.set(0, 0.34 - k * 0.135, 0);
    m.userData = { id, label, redraw: a => { mat.map.dispose(); mat.map = makeBtnTex(label, a); mat.needsUpdate = true; } };
    group.add(m); panelButtons.push(m);
  });
  group.position.set(0.42, 0.26, -0.58); group.rotation.set(-0.45, -0.5, 0); group.scale.setScalar(0.62);
  dolly.add(group);
}
function selectTool(id) {
  if (id === 'reset') { resetSand(); return; }
  tool = id; panelButtons.forEach(b => b.userData.redraw(b.userData.id === tool));
}

// ---------- audio: soft surf + gulls ----------
let actx, started = false;
function startAudio() {
  if (started) return; started = true;
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
  } catch (e) {}
}
function gull() {
  if (!actx) return; const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = 'sine'; const b = 900 + Math.random() * 500;
  o.frequency.setValueAtTime(b, t); o.frequency.linearRampToValueAtTime(b * 1.4, t + 0.12); o.frequency.linearRampToValueAtTime(b * 1.1, t + 0.25);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.04, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.32);
  setTimeout(gull, 4000 + Math.random() * 9000);
}

// ---------- interaction ----------
function onPointerMove(e) {
  if (document.pointerLockElement === renderer.domElement) { yaw -= e.movementX * 0.0025; pitch = Math.max(-1.3, Math.min(0.2, pitch - e.movementY * 0.0025)); return; }
  mouseNDC.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
}
function onPointerDown(e) {
  if (renderer.xr.isPresenting) return;
  mouseNDC.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouseNDC, camera);
  castFrom(ray.ray.origin, ray.ray.direction);
  if (hoverBtn) { selectTool(hoverBtn.userData.id); return; }
  if (hit.on) { sculpting = true; if (tool === 'tower') stampTower(hit.lx, hit.lz); }
}
function onSelectStart() { if (hoverBtn) { selectTool(hoverBtn.userData.id); return; } if (hit.on) { sculpting = true; if (tool === 'tower') stampTower(hit.lx, hit.lz); } }
function onSelectEnd() { sculpting = false; }

function castFrom(origin, dir) {
  ray.set(origin, dir);
  // panel first
  const ph = ray.intersectObjects(panelButtons, false);
  if (ph.length) { if (hoverBtn !== ph[0].object) { hoverBtn && hoverBtn.scale.setScalar(1); hoverBtn = ph[0].object; hoverBtn.scale.setScalar(1.08); } hit.on = false; cursor.visible = false; return; }
  if (hoverBtn) { hoverBtn.scale.setScalar(1); hoverBtn = null; }
  const sh = ray.intersectObject(sandMesh, false);
  if (sh.length) {
    const p = sh[0].point; hit.on = true; hit.lx = p.x - sandMesh.position.x; hit.lz = p.z - sandMesh.position.z;
    cursor.position.set(p.x, p.y + 0.01, p.z); cursor.visible = true;
  } else { hit.on = false; cursor.visible = false; }
}

function updateInteraction() {
  if (renderer.xr.isPresenting && controllers[0]) {
    const c = controllers.find(x => true) || controllers[0];
    tmpM.identity().extractRotation(c.matrixWorld);
    const origin = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(tmpM).normalize();
    castFrom(origin, dir);
  } else {
    ray.setFromCamera(mouseNDC, camera);
    castFrom(ray.ray.origin, ray.ray.direction);
  }
  if (sculpting && hit.on && tool !== 'tower') brush(hit.lx, hit.lz, tool === 'dig' ? -1 : 1);
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  if (!renderer.xr.isPresenting) {
    if (keys.ArrowLeft) yaw += dt * 1.1; if (keys.ArrowRight) yaw -= dt * 1.1;
    if (keys.ArrowUp) pitch = Math.min(0.2, pitch + dt * 0.9); if (keys.ArrowDown) pitch = Math.max(-1.3, pitch - dt * 0.9);
    camera.rotation.set(pitch, yaw, 0, 'YXZ'); camera.position.y = 1.15;
  } else camera.position.y = 0;
  updateInteraction();
  if (dirty) { updateSandGeo(); dirty = false; }
  water.material.uniforms.time.value = t;
  camera.getWorldPosition(water.material.uniforms.cam.value);
  if (cursor.visible) cursor.material.opacity = 0.5 + 0.3 * Math.sin(t * 5);
  fx.render();
}

function onResize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); }
