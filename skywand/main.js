// ============================ Sky Wand — draw light in the air while you drift (Oortia) ============================
// Sit or lie back while you drift slowly in ONE straight direction (forward, rising, or floating down), and draw in
// the air with a wand. Lines, ribbons, dots or sparkles stay where you drew them in the world, so they stream past and
// behind you as you drift; they can fade away over time. Constant speed, no turning, vignette from shared/comfort.js.
// Desktop: drag to draw, right-drag / arrow keys to look. Phone: one finger draws, two fingers look.
import * as THREE from 'three';
import { detectXR, createXRMenu, sectionRow, choiceGrid, swatchGrid } from '../shared/xrmenu.js?v=20261114g';
import { createComfort } from '../shared/comfort.js?v=20261114f';
import { createTouch } from '../shared/touch.js?v=20261114f';
import { beautify } from '../shared/beauty.js?v=20261114f';

const KEY = 'oortia-skywand-v1';
const COLORS = [['Gold', '#ffd27a'], ['Rose', '#ff8fb0'], ['Sky', '#8fd3ff'], ['Mint', '#8ff0c0'], ['Violet', '#b9a0ff'], ['White', '#ffffff'], ['Ember', '#ff9a5a'], ['Rainbow', 'rainbow']];
const BRUSHES = [['Line', 'line'], ['Ribbon', 'ribbon'], ['Dots', 'dots'], ['Sparkles', 'sparkle']];
const DRIFTS = [['Still', 'still'], ['Forward', 'forward'], ['Rise', 'rise'], ['Float down', 'down']];
const SPEEDS = [['Slow', 0.35], ['Gentle', 0.7], ['Brisk', 1.2]];
const FADES = [['Never', 0], ['10 s', 10], ['30 s', 30], ['1 min', 60]];
const SIZES = [['Fine', 0.6], ['Medium', 1], ['Bold', 1.8]];
const TOP = 160, BOTTOM = 2.5;
const P = Object.assign({ brush: 'ribbon', color: '#8fd3ff', drift: 'forward', speed: 0, fade: 30, size: 1, posture: 'seated' },
  (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } })());
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { /* */ } };

let renderer, scene, camera, dolly, menu, comfort, touch, fx, caps, xr = false;
const strokes = [], clock = new THREE.Clock();
let now = 0, yaw = 0, pitch = 0;

Promise.resolve().then(init).catch((e) => { console.error(e); const s = document.getElementById('status'); if (s) s.textContent = 'Could not start: ' + e.message; });

// ---------- world ----------
function buildWorld() {
  const world = new THREE.Group(); scene.add(world);
  const geo = new THREE.SphereGeometry(400, 48, 24), col = [], p = geo.attributes.position, c = new THREE.Color();
  const top = new THREE.Color(0x0b1238), mid = new THREE.Color(0x3a3474), low = new THREE.Color(0xe39a7a), under = new THREE.Color(0x10142a);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 400;
    if (y < 0) c.copy(low).lerp(under, Math.min(1, -y * 4)); else if (y < 0.25) c.copy(low).lerp(mid, y / 0.25); else c.copy(mid).lerp(top, (y - 0.25) / 0.75);
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false }));
  dome.renderOrder = -10; world.add(dome);
  // stars on the dome
  const sp = []; for (let i = 0; i < 1400; i++) { const u = Math.random() * 0.95 + 0.05, th = Math.random() * 6.283, s = Math.sqrt(1 - u * u); sp.push(Math.cos(th) * s * 380, u * 380, Math.sin(th) * s * 380); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  dome.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.4, color: 0xdfe6ff, transparent: true, opacity: 0.8, depthWrite: false, fog: false })));
  // ground far below (a soft patterned plain so floating down has somewhere to arrive)
  const gc = document.createElement('canvas'); gc.width = gc.height = 256; const gg = gc.getContext('2d');
  gg.fillStyle = '#1d2b3a'; gg.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) { gg.fillStyle = `rgba(${90 + Math.random() * 60},${120 + Math.random() * 60},${150 + Math.random() * 60},${0.05 + Math.random() * 0.12})`; gg.beginPath(); gg.arc(Math.random() * 256, Math.random() * 256, 4 + Math.random() * 18, 0, 6.283); gg.fill(); }
  const gt = new THREE.CanvasTexture(gc); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(60, 60); gt.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshBasicMaterial({ map: gt }));
  ground.rotation.x = -Math.PI / 2; world.add(ground);
  // drifting motes around you: they give the straight motion a calm sense of speed (wrap around the rig)
  const N = 500, mp = new Float32Array(N * 3); for (let i = 0; i < N * 3; i++) mp[i] = (Math.random() * 2 - 1) * 30;
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const motes = new THREE.Points(mg, new THREE.PointsMaterial({ size: 0.07, color: 0xfff1d8, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  motes.frustumCulled = false; world.add(motes);
  return { world, dome, ground, motes };
}

// ---------- strokes ----------
const MAXS = 1500;
const dotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
function newStroke(brush) {
  const pts = brush === 'dots' || brush === 'sparkle';
  const per = pts ? 1 : 2, geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAXS * per * 3), col = new Float32Array(MAXS * per * 4);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  let mesh;
  if (pts) {
    mesh = new THREE.Points(geo, new THREE.PointsMaterial({ size: (brush === 'dots' ? 0.035 : 0.045) * P.size, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: brush === 'sparkle' ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false }));
  } else {
    const idx = []; for (let i = 0; i < MAXS - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending }));
  }
  mesh.frustumCulled = false; geo.setDrawRange(0, 0); scene.add(mesh);
  const s = { brush, mesh, geo, pos, col, per, n: 0, births: new Float32Array(MAXS), last: null, hue: Math.random(), rgb: new THREE.Color(), dead: false, lastSample: 0 };
  strokes.push(s); return s;
}
const _side = new THREE.Vector3(), _d = new THREE.Vector3(), _toCam = new THREE.Vector3(), _c = new THREE.Color();
function addPoint(s, p, up) {
  if (s.n >= MAXS) return false;
  const gap = s.brush === 'dots' ? 0.03 * P.size : s.brush === 'sparkle' ? 0.012 : 0.008;
  if (s.last && s.last.distanceTo(p) < gap) return true;
  if (P.color === 'rainbow') { s.hue = (s.hue + 0.004) % 1; _c.setHSL(s.hue, 0.85, 0.65); } else _c.set(P.color);
  const boost = s.brush === 'line' || s.brush === 'ribbon' ? 1.25 : 1.4;   // a touch over 1 so the bloom glows
  const i = s.n;
  if (s.per === 1) {
    let q = p; if (s.brush === 'sparkle') q = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04).multiplyScalar(P.size));
    s.pos.set([q.x, q.y, q.z], i * 3); s.col.set([_c.r * boost, _c.g * boost, _c.b * boost, 1], i * 4);
  } else {
    const w = (s.brush === 'line' ? 0.006 : 0.035) * P.size;
    if (s.brush === 'ribbon' && up) _side.copy(up);
    else { _d.copy(p).sub(s.last || p); camera.getWorldPosition(_toCam).sub(p); _side.crossVectors(_d, _toCam); if (_side.lengthSq() < 1e-10) _side.set(0, 1, 0); }
    _side.normalize().multiplyScalar(w / 2);
    s.pos.set([p.x + _side.x, p.y + _side.y, p.z + _side.z, p.x - _side.x, p.y - _side.y, p.z - _side.z], i * 6);
    s.col.set([_c.r * boost, _c.g * boost, _c.b * boost, 1, _c.r * boost, _c.g * boost, _c.b * boost, 1], i * 8);
  }
  s.births[i] = now; s.n++; s.last = (s.last || new THREE.Vector3()).copy(p);
  s.geo.attributes.position.needsUpdate = true; s.geo.attributes.color.needsUpdate = true;
  s.geo.setDrawRange(0, s.per === 1 ? s.n : Math.max(0, (s.n - 1) * 6));
  return true;
}
function fadeStrokes() {
  for (const s of strokes) {
    if (!P.fade && s.brush !== 'sparkle') continue;
    let alive = false;
    for (let i = 0; i < s.n; i++) {
      let a = 1;
      if (P.fade) { const age = now - s.births[i]; a = age < P.fade ? 1 : Math.max(0, 1 - (age - P.fade) / 3); }
      if (s.brush === 'sparkle') a *= 0.55 + 0.45 * Math.sin(now * 7 + i * 2.3);
      if (a > 0.001) alive = true;
      for (let k = 0; k < s.per; k++) s.col[(i * s.per + k) * 4 + 3] = a;
    }
    s.geo.attributes.color.needsUpdate = true;
    if (P.fade && !alive && !s.drawing) s.dead = true;
  }
  for (const s of strokes.slice()) if (s.dead) { scene.remove(s.mesh); s.geo.dispose(); s.mesh.material.dispose(); strokes.splice(strokes.indexOf(s), 1); }
}
function clearAll() { for (const s of strokes) { scene.remove(s.mesh); s.geo.dispose(); s.mesh.material.dispose(); } strokes.length = 0; }

// ---------- pens: one per controller + one for mouse/touch ----------
const pens = [];
function makePen(ctrl) {
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  const pen = { ctrl, tip, stroke: null, down: false };
  if (ctrl) { tip.position.set(0, 0, -0.09); ctrl.add(tip); const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.12, 8), new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.6 })); rod.rotation.x = Math.PI / 2; rod.position.z = -0.03; ctrl.add(rod); }
  pens.push(pen); return pen;
}
const _wp = new THREE.Vector3(), _up = new THREE.Vector3(), _q = new THREE.Quaternion();
function penDown(pen) { if (!pen.down) { pen.down = true; pen.stroke = newStroke(P.brush); pen.stroke.drawing = true; } }
function penUp(pen) { pen.down = false; if (pen.stroke) pen.stroke.drawing = false; pen.stroke = null; }

async function init() {
  caps = await detectXR();
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b1238);
  camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.03, 1200);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: caps.ar, powerPreference: 'high-performance' });
  if (caps.ar) renderer.setClearColor(0x000000, 0);
  touch = createTouch({ canvas: renderer.domElement, look: false });
  renderer.setPixelRatio(touch.pixelRatio(2)); renderer.setSize(innerWidth, innerHeight); renderer.xr.enabled = true;
  try { renderer.xr.setReferenceSpaceType('local-floor'); } catch (e) { /* */ }
  document.body.appendChild(renderer.domElement); renderer.domElement.style.touchAction = 'none';
  fx = beautify(renderer, scene, camera, { tone: 'aces', exposure: 1.0, bloom: touch.isTouch ? 0.25 : 0.4, radius: 0.45, threshold: 0.96 });
  dolly = new THREE.Group(); dolly.add(camera); scene.add(dolly);
  camera.position.y = 1.15;
  scene.add(new THREE.HemisphereLight(0xbfc8ff, 0x202030, 0.9));
  const W = buildWorld();
  const startY = () => (P.drift === 'down' ? TOP * 0.6 : P.drift === 'rise' ? BOTTOM + 2 : 40);
  dolly.position.set(0, startY(), 0);
  setPosture(P.posture);

  comfort = createComfort({ renderer, scene, camera, dolly });
  const rows = [
    sectionRow('Brush'),
    ...choiceGrid(BRUSHES, () => P.brush, (v) => { P.brush = v; save(); }, 4),
    ...swatchGrid(COLORS.map(([n, c]) => [n, c, c === 'rainbow' ? ['#ff6b6b', '#ffd166', '#06d6a0', '#5b7cfa'] : [c]]), () => P.color, (v) => { P.color = v; save(); }, 4),
    { label: 'Size', cells: SIZES.map(([t, v]) => ({ text: t, action: () => { P.size = v; save(); }, active: () => P.size === v })) },
    { label: 'Fade', cells: FADES.map(([t, v]) => ({ text: t, action: () => { P.fade = v; save(); }, active: () => P.fade === v })) },
    { cells: [{ text: 'Clear the sky', action: clearAll, tone: 'danger' }] },
    sectionRow('Drift (one straight direction)'),
    ...choiceGrid(DRIFTS, () => P.drift, (v) => setDrift(v), 4),
    { label: 'Speed', cells: SPEEDS.map(([t], i) => ({ text: t, action: () => { P.speed = i; save(); }, active: () => P.speed === i })) },
    { label: 'Posture', cells: [{ text: 'Sitting', action: () => setPosture('seated'), active: () => P.posture === 'seated' }, { text: 'Lying up', action: () => setPosture('lying'), active: () => P.posture === 'lying' }] },
    ...comfort.rows({ movement: false }),
  ];
  menu = createXRMenu({
    renderer, camera, dolly, caps, title: 'Sky Wand', rows, compactCommon: true,
    hint: touch.isTouch ? 'One finger draws · two fingers look · ☰ for brushes, colours and drift' : 'Drag to draw · right-drag or arrow keys to look · Esc/M for brushes, colours and drift',
    fade: comfort.fade,
    recenter: () => { yaw = 0; },
    setBackdrop: (v) => { W.world.visible = v; scene.background = v ? new THREE.Color(0x0b1238) : null; },
    onSessionStart: () => { xr = true; camera.position.y = 0; },
    onSessionEnd: () => { xr = false; camera.position.y = 1.15; },
    quitUrl: '../',
  });
  comfort.attachMenu(menu);
  menu.controllers.forEach((c) => makePen(c));
  const mousePen = makePen(null); mousePen.tip.visible = false;
  menu.onSelectStart((c, hand, i) => penDown(pens[i]));
  menu.onSelectEnd((c, hand, i) => penUp(pens[i]));

  function setDrift(v) { const go = () => { P.drift = v; save(); dolly.position.y = startY(); }; comfort.fade(go); menu.refresh(); }
  function setPosture(v) { P.posture = v; save(); pitch = v === 'lying' ? 1.4 : 0; yaw = 0; }

  // flat-screen drawing + look
  const cv = renderer.domElement, ndc = new THREE.Vector2(), ray = new THREE.Raycaster();
  let look = null; const touches = new Map();
  const deskPoint = () => { ray.setFromCamera(ndc, camera); return ray.ray.at(1.4, new THREE.Vector3()); };
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { cv.setPointerCapture(e.pointerId); } catch (er) { /* */ }
    if (e.button === 2 || touches.size >= 2) { penUp(mousePen); look = { x: e.clientX, y: e.clientY, yaw, pitch }; return; }
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); penDown(mousePen);
  });
  cv.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (look) { yaw = look.yaw + (e.clientX - look.x) * 0.004; pitch = THREE.MathUtils.clamp(look.pitch + (e.clientY - look.y) * 0.004, -1.2, 1.56); return; }
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  });
  const end = (e) => { touches.delete(e.pointerId); if (!touches.size) look = null; penUp(mousePen); };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  const keys = {}; addEventListener('keydown', (e) => { keys[e.code] = true; }); addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  const ld = document.getElementById('loading'); if (ld) ld.style.display = 'none';
  let fadeAcc = 0;
  const frame = (force) => {
    const dt = force || Math.min(clock.getDelta(), 0.05); now += dt;
    if (!xr) {
      if (keys.ArrowLeft) yaw += dt * 1.2; if (keys.ArrowRight) yaw -= dt * 1.2;
      if (keys.ArrowUp) pitch = Math.min(1.56, pitch + dt * 1.2); if (keys.ArrowDown) pitch = Math.max(-1.2, pitch - dt * 1.2);
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
    }
    // drift: one straight direction at constant speed (frozen by Pause / calm)
    let v = 0;
    if (P.drift !== 'still' && !comfort.paused) {
      v = comfort.speed ? comfort.speed(SPEEDS[P.speed][1]) : SPEEDS[P.speed][1];
      if (P.drift === 'forward') dolly.position.z -= v * dt;
      else if (P.drift === 'rise') dolly.position.y += v * dt;
      else dolly.position.y -= v * dt;
      if (dolly.position.y < BOTTOM || dolly.position.y > TOP) { const y = startY(); v = 0; comfort.fade(() => { dolly.position.y = y; }); dolly.position.y = THREE.MathUtils.clamp(dolly.position.y, BOTTOM, TOP); }
    }
    // keep the dome, ground texture and motes around you
    camera.getWorldPosition(_wp);
    W.dome.position.copy(_wp);
    W.ground.position.x = Math.round(_wp.x / 50) * 50; W.ground.position.z = Math.round(_wp.z / 50) * 50;
    const mp = W.motes.geometry.attributes.position.array;
    for (let i = 0; i < mp.length; i += 3) for (let k = 0; k < 3; k++) { const c = [_wp.x, _wp.y, _wp.z][k]; let d = mp[i + k] - c; if (d > 30) mp[i + k] -= 60; else if (d < -30) mp[i + k] += 60; }
    W.motes.geometry.attributes.position.needsUpdate = true;
    menu.update();
    // pens
    for (const pen of pens) {
      if (pen.ctrl) {
        const on = xr && !!pen.ctrl.userData.src; pen.tip.visible = on; pen.tip.material.color.set(P.color === 'rainbow' ? '#ffffff' : P.color);
        if (pen.down && pen.ctrl.userData.overMenu) penUp(pen);
        if (pen.down && pen.stroke) { pen.tip.getWorldPosition(_wp); _up.set(0, 1, 0).applyQuaternion(pen.ctrl.getWorldQuaternion(_q)); if (!addPoint(pen.stroke, _wp.clone(), _up)) penUp(pen); }
      } else if (pen.down && pen.stroke && !xr) { if (!addPoint(pen.stroke, deskPoint(), null)) { penUp(pen); penDown(pen); } }
    }
    fadeAcc += dt; if (fadeAcc > 0.08) { fadeAcc = 0; fadeStrokes(); }
    comfort.update(dt, { moving: v });
    fx.render();
  };
  if (location.hash.includes('debug')) window.__SW = { frame, P, strokes, dolly };
  renderer.setAnimationLoop(() => frame());
}
