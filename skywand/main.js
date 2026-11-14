// ============================ Sky Wand — draw light in the air while you drift (Oortia) ============================
// Sit or lie back while you drift slowly in ONE straight direction (forward, rising, or floating down), and draw in
// the air with a wand. Lines, ribbons, dots or sparkles stay where you drew them in the world, so they stream past and
// behind you as you drift; they can fade away over time. Constant speed, no turning, vignette from shared/comfort.js.
// Desktop: drag to draw, right-drag / arrow keys to look. Phone: one finger draws, two fingers look.
// Built on the app standard (shared/app.js, STANDARD.md): menu, Pause, comfort, posture, drift + compass all come from there.
import { THREE, createOortiaApp, sectionRow, choiceGrid, swatchGrid } from '../shared/app.js?v=app2';

const KEY = 'oortia-skywand-v2';
const COLORS = [['Gold', '#ffd27a'], ['Rose', '#ff8fb0'], ['Sky', '#8fd3ff'], ['Mint', '#8ff0c0'], ['Violet', '#b9a0ff'], ['White', '#ffffff'], ['Ember', '#ff9a5a'], ['Rainbow', 'rainbow']];
const BRUSHES = [['Line', 'line'], ['Ribbon', 'ribbon'], ['Dots', 'dots'], ['Sparkles', 'sparkle']];
const FADES = [['Never', 0], ['10 s', 10], ['30 s', 30], ['1 min', 60]];
const SIZES = [['Fine', 0.6], ['Medium', 1], ['Bold', 1.8]];
const TOP = 160, BOTTOM = 2.5;
const P = Object.assign({ brush: 'ribbon', color: '#8fd3ff', fade: 30, size: 1 },
  (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } })());
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { /* */ } };

let app, scene, camera, dolly, menu, comfort, drift;
const strokes = [];
let now = 0;

Promise.resolve().then(init).catch((e) => { console.error(e); const s = document.getElementById('status'); if (s) s.textContent = 'Could not start: ' + e.message; });

// ---------- world ----------
function buildWorld() {
  const world = new THREE.Group(); app.world.add(world);   // app.world: hidden in one go by passthrough
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
  app = await createOortiaApp({
    id: 'skywand', title: 'Sky Wand',
    capabilities: { locomotion: 'drift', posture: ['seated', 'lying-up'], passthrough: true },
    background: 0x0b1238, fov: 70, near: 0.03, far: 1200,
    tone: (touch) => ({ tone: 'aces', exposure: 1.0, bloom: touch.isTouch ? 0.25 : 0.4, radius: 0.45, threshold: 0.96 }),
    home: null,                                   // Recenter resets the heading only; you stay where you have drifted to
    flatDrag: 'act',                              // drag draws; right-drag / two fingers / arrow keys look
    hint: matchMedia('(pointer: coarse)').matches ? 'One finger draws · two fingers look · ☰ for brushes, colours and drift' : 'Drag to draw · right-drag or arrow keys to look · Esc/M for brushes, colours and drift',
    tabs: () => [{ name: 'Brush', rows: [
      sectionRow('Brush'),
      ...choiceGrid(BRUSHES, () => P.brush, (v) => { P.brush = v; save(); }, 4),
      ...swatchGrid(COLORS.map(([n, c]) => [n, c, c === 'rainbow' ? ['#ff6b6b', '#ffd166', '#06d6a0', '#5b7cfa'] : [c]]), () => P.color, (v) => { P.color = v; save(); }, 4),
      { label: 'Size', cells: SIZES.map(([t, v]) => ({ text: t, action: () => { P.size = v; save(); }, active: () => P.size === v })) },
      { label: 'Fade', cells: FADES.map(([t, v]) => ({ text: t, action: () => { P.fade = v; save(); }, active: () => P.fade === v })) },
      { cells: [{ text: 'Clear the sky', action: clearAll, tone: 'danger' }] },
    ] }],
  });
  ({ scene, camera, dolly, menu, comfort, drift } = app);
  scene.add(new THREE.HemisphereLight(0xbfc8ff, 0x202030, 0.9));
  const W = buildWorld();
  const startY = () => 40;
  dolly.position.set(0, startY(), 0);

  menu.controllers.forEach((c) => makePen(c));
  const mousePen = makePen(null); mousePen.tip.visible = false;
  const penOf = (aim) => (aim.kind === 'ctrl' ? pens[aim.index] : mousePen);
  app.onPress((aim) => penDown(penOf(aim)));      // trigger / mouse / touch; "Point to set" clicks are consumed by the bootstrap
  app.onRelease((aim) => penUp(penOf(aim)));
  const deskPoint = () => app.pointer.ray.at(1.4, new THREE.Vector3());

  let fadeAcc = 0, fadingBack = false;
  app.tick((dt) => {                              // dt is 0 while Paused: strokes stop ageing, the drift is held by the bootstrap
    now += dt;
    if (dolly.position.y < BOTTOM || dolly.position.y > TOP) {   // reached the ground or the top: fade back to the middle height
      dolly.position.y = THREE.MathUtils.clamp(dolly.position.y, BOTTOM, TOP);
      if (!fadingBack) { fadingBack = true; comfort.fade(() => { dolly.position.y = startY(); fadingBack = false; }); }
    }
    // keep the dome, ground texture and motes around you
    camera.getWorldPosition(_wp);
    W.dome.position.copy(_wp);
    W.ground.position.x = Math.round(_wp.x / 50) * 50; W.ground.position.z = Math.round(_wp.z / 50) * 50;
    const mp = W.motes.geometry.attributes.position.array;
    for (let i = 0; i < mp.length; i += 3) for (let k = 0; k < 3; k++) { const c = [_wp.x, _wp.y, _wp.z][k]; let d = mp[i + k] - c; if (d > 30) mp[i + k] -= 60; else if (d < -30) mp[i + k] += 60; }
    W.motes.geometry.attributes.position.needsUpdate = true;
    // pens
    for (const pen of pens) {
      if (pen.ctrl) {
        const on = app.xr && !!pen.ctrl.userData.src; pen.tip.visible = on; pen.tip.material.color.set(P.color === 'rainbow' ? '#ffffff' : P.color);
        if (pen.down && pen.ctrl.userData.overMenu) penUp(pen);
        if (pen.down && pen.stroke) { pen.tip.getWorldPosition(_wp); _up.set(0, 1, 0).applyQuaternion(pen.ctrl.getWorldQuaternion(_q)); if (!addPoint(pen.stroke, _wp.clone(), _up)) penUp(pen); }
      } else if (pen.down && pen.stroke && !app.xr) { if (!addPoint(pen.stroke, deskPoint(), null)) { penUp(pen); penDown(pen); } }
    }
    fadeAcc += dt; if (fadeAcc > 0.08) { fadeAcc = 0; fadeStrokes(); }
  });
  app.start();
  if (location.hash.includes('debug')) window.__SW = { frame: app._frame, P, strokes, dolly, drift, menu, THREE, scene, app };
}
