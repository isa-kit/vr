// ============================ shared/drift.js — slow straight drift in a user-set direction ============================
//
//   import { createDrift } from '../shared/drift.js?v=drift4';
//   const drift = createDrift({ THREE, scene, camera, rig, comfort, getMenu: () => menu, start: 'still', cap: 0.45 });
//   rows: [...drift.rows()]            // Motion presets, exact picks, angle snap, flat-screen setters, speed
//   each frame: const v = drift.update(dt, { paused });  comfort.update(dt, { moving: v })
//   on a trigger / click: if (drift.capture(null, rayDir)) return;   // consumed while flat-screen "Point to set" is armed
//   drift.dir (unit Vector3, world), drift.mode, drift.moving(), drift.aiming (compass aim in progress)
//
// Reference frame (decided):
//   • Heading 0° = the direction your headset faces when you choose (level part of it; lying on your back that is the
//     way past the top of your head). 90° = to your right, 180° = behind, 270° = to your left.
//   • Elevation is measured from the level horizon, so "Straight up (sky)" / "Straight down" are true vertical.
//   • Two headset-relative presets stay as well: "Forward (my view)" = exactly where the headset looks (full 3D —
//     lying on your back that is the sky) and "Up (top of my head)".
//   Every choice is resolved once, when made, then stays fixed in the world as one straight line (never steers with
//   your head). Angle snap (optional) rounds to 5° steps and locks exactly onto 0/90/180/270°, level, straight up and
//   straight down when within ~9°.
// Right-hand COMPASS (VR, temporary home): a small level dial with 5° ticks (bold cardinals) above the right controller;
//   the needle shows the drift direction. Hold A + point → preview; while holding A: thumbstick nudges ±5° (left/right
//   = heading, up/down = elevation), thumbstick click cycles the exact picks; release A → set. B = go / stop.
// Comfort: stationary by default; constant low speed (hard cap); a change while moving goes through a short fade.
// ====================================================================================================================
const PRESETS = { still: 'Stationary', forward: 'My view', up: 'Head-top' };   // headset-relative: where I look / toward the top of my head
const LOCAL = { forward: [0, 0, -1], up: [0, 1, 0] };
const PICKS = [['ahead', '0° ahead', 0, 0], ['right90', '90° right', 90, 0], ['behind', '180°', 180, 0], ['left270', '270° left', 270, 0], ['zenith', 'Sky ↑', 0, 90], ['nadir', 'Down ↓', 0, -90]];   // true vertical
const SPEEDS = [['Very slow', 0.15], ['Slow', 0.25], ['Gentle', 0.4]];
const SNAP_KEY = 'oortia-drift-snap';
const DEG = Math.PI / 180;

function dotTexture(THREE) {
  const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c);
}

// heading (deg, clockwise from refYaw) + elevation (deg from horizon) ⇄ world vector
export function toHE(v, refYaw) {
  const e = Math.asin(Math.max(-1, Math.min(1, v.y))) / DEG;
  const yaw = Math.atan2(-v.x, -v.z);
  let h = (refYaw - yaw) / DEG; h = ((h % 360) + 360) % 360;
  return { h, e };
}
export function fromHE(THREE, h, e, refYaw, out = new THREE.Vector3()) {
  const yaw = refYaw - h * DEG, ce = Math.cos(e * DEG);
  return out.set(-Math.sin(yaw) * ce, Math.sin(e * DEG), -Math.cos(yaw) * ce).normalize();
}
export function snapHE({ h, e }) {
  let se = Math.abs(e - 90) < 9 ? 90 : Math.abs(e + 90) < 9 ? -90 : Math.abs(e) < 8 ? 0 : Math.round(e / 5) * 5;
  let sh = h;
  for (const c of [0, 90, 180, 270, 360]) if (Math.abs(h - c) < 9) { sh = c; break; }
  if (sh === h) sh = Math.round(h / 5) * 5;
  sh = sh % 360;
  if (Math.abs(se) === 90) sh = 0;
  return { h: sh, e: se };
}
export function describeHE({ h, e }) {
  if (e >= 89.5) return 'Straight up';
  if (e <= -89.5) return 'Straight down';
  const hr = Math.round(h) % 360, er = Math.round(e);
  const name = { 0: 'ahead', 90: 'right', 180: 'behind', 270: 'left' }[hr];
  return `${hr}°${name ? ' ' + name : ''} · ` + (er === 0 ? 'level' : `${er > 0 ? 'up' : 'down'} ${Math.abs(er)}°`);
}

export function createDrift({ THREE, scene, camera, rig, comfort = null, getMenu = () => null, presets = ['still', 'forward', 'up'], start = 'still', cap = 0.45, onStep = null, move = true, isMoving = null, onGo = null, startDir = [0, 0, -1] }) {
  // move:false → only pick/show the direction (the caller moves the rig); isMoving / onGo let the caller own "moving"
  const D = { mode: start, dir: new THREE.Vector3().fromArray(startDir).normalize(), armed: false, cap, speedIdx: 0, aiming: false, refYaw: 0, label: '' };
  try { D.snap = localStorage.getItem(SNAP_KEY) === '1'; } catch (e) { D.snap = false; }
  const refresh = () => { const m = getMenu(); if (m) m.refresh(); };
  const fade = (fn) => (comfort && comfort.fade ? comfort.fade(fn, 0.3, 0.4) : fn());
  const _o = new THREE.Vector3(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _f = new THREE.Vector3();
  const tex = dotTexture(THREE);

  // headset heading: the level part of where it faces; looking straight up (lying), the way past the top of the head
  D.headYaw = () => {
    camera.getWorldDirection(_f); _f.y = 0;
    if (_f.lengthSq() < 0.09) { camera.getWorldQuaternion(_q); _f.set(0, 1, 0).applyQuaternion(_q); _f.y = 0; }
    if (_f.lengthSq() < 1e-6) _f.set(0, 0, -1);
    return Math.atan2(-_f.x, -_f.z);
  };
  const shape = (v) => (D.snap ? fromHE(THREE, ...Object.values(snapHE(toHE(v, D.refYaw))), D.refYaw) : v.clone().normalize());

  // ---- faint preview / confirmation streak
  const N = 24, ap = new Float32Array(N * 3);
  const ag = new THREE.BufferGeometry(); ag.setAttribute('position', new THREE.BufferAttribute(ap, 3));
  const arrow = new THREE.Points(ag, new THREE.PointsMaterial({ size: 0.03, map: tex, color: 0xfff0c8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  arrow.frustumCulled = false; scene.add(arrow);
  let arrowT = 0;
  function streak(dir, hold = false) {
    camera.getWorldPosition(_o);
    for (let i = 0; i < N; i++) { const d = 0.9 + i * 0.12; ap[i * 3] = _o.x + dir.x * d; ap[i * 3 + 1] = _o.y - 0.15 + dir.y * d; ap[i * 3 + 2] = _o.z + dir.z * d; }
    ag.attributes.position.needsUpdate = true; arrowT = hold ? Math.max(arrowT, 0.3) : 2.6;
  }

  D.moving = () => (isMoving ? isMoving() : D.mode !== 'still');
  D.setDir = (v, mode = 'custom') => {
    const go = () => { D.dir.copy(v).normalize(); D.mode = mode; D.label = describeHE(toHE(D.dir, D.refYaw)); streak(D.dir); refresh(); };
    if (D.moving() && mode !== 'still') fade(go); else go();      // never curve while moving: change through a short fade
  };
  const keep = () => (D.mode === 'still' ? 'still' : 'custom');   // setting a direction while still does not start moving
  D.resolve = (id) => { camera.getWorldQuaternion(_q); return new THREE.Vector3().fromArray(LOCAL[id]).applyQuaternion(_q).normalize(); };
  D.setPreset = (id) => {
    if (id === 'still') { D.mode = 'still'; refresh(); return; }
    if (id === 'custom') { D.setDir(D.dir.clone(), 'custom'); return; }
    D.refYaw = D.headYaw();
    if (LOCAL[id]) D.setDir(shape(D.resolve(id)), id);              // headset-relative at the moment you choose it
  };
  D.pick = (id) => {                                               // exact picks: heading from your facing now, true vertical
    const p = PICKS.find((q) => q[0] === id); if (!p) return;
    D.refYaw = D.headYaw(); D.setDir(fromHE(THREE, p[2], p[3], D.refYaw), D.mode === 'still' ? 'still' : id);
  };
  D.fromGaze = () => { D.refYaw = D.headYaw(); D.setDir(shape(D.resolve('forward')), keep()); };
  D.arm = () => { D.armed = !D.armed; refresh(); };
  D.capture = (origin, dir) => {                                   // flat screens: a click while armed sets the direction
    if (!D.armed) return false;
    D.armed = false; D.refYaw = D.headYaw(); D.setDir(shape(dir), keep()); return true;
  };
  D.captureController = (c) => { if (!D.armed) return false; c.getWorldQuaternion(_q); return D.capture(null, new THREE.Vector3(0, 0, -1).applyQuaternion(_q)); };
  D.toggleGo = () => { if (onGo) { onGo(); return; } if (D.mode === 'still') D.setDir(D.dir.clone(), 'custom'); else { D.mode = 'still'; refresh(); } };
  D.setSnap = (v) => { D.snap = v; try { localStorage.setItem(SNAP_KEY, v ? '1' : '0'); } catch (e) { /* */ } refresh(); };
  D.velocity = () => Math.min(D.cap, comfort && comfort.speed ? comfort.speed(SPEEDS[D.speedIdx][1]) : SPEEDS[D.speedIdx][1]);

  D.rows = ({ title = 'Motion: stationary, or a slow straight line' } = {}) => {
    const rows = [{ section: title }];
    rows.push({ cells: presets.map((id) => ({ text: PRESETS[id], action: () => D.setPreset(id), active: () => D.mode === id })) });
    rows.push({ cells: PICKS.slice(0, 3).map(([id, t]) => ({ text: t, action: () => D.pick(id), active: () => D.mode === id })) });
    rows.push({ cells: PICKS.slice(3).map(([id, t]) => ({ text: t, action: () => D.pick(id), active: () => D.mode === id })) });
    rows.push({ label: 'Angle snap', cells: [{ text: 'Free', action: () => D.setSnap(false), active: () => !D.snap }, { text: '5° + lock', action: () => D.setSnap(true), active: () => D.snap }] });
    rows.push({ label: 'Set direction', cells: [
      { text: 'Where I look', action: () => D.fromGaze() },
      { text: () => (D.armed ? 'Now point / click…' : 'Point to set'), action: () => D.arm(), active: () => D.armed },
    ] });
    rows.push({ cells: [{ text: () => 'Now: ' + (D.label || describeHE(toHE(D.dir, D.refYaw))) + (D.moving() ? '' : ' (stationary)') }] });
    rows.push({ label: 'Speed', visible: () => D.moving(), cells: SPEEDS.map(([t], i) => ({ text: t, action: () => { D.speedIdx = i; refresh(); }, active: () => D.speedIdx === i })) });
    return rows;
  };

  // ---- right-hand compass (self-contained so it can move to a new home later)
  const compass = new THREE.Group(); compass.visible = false;
  const level = new THREE.Group(); compass.add(level);                 // world-level dial, 0° toward the reference heading
  const tp = [];
  for (let i = 0; i < 72; i++) {
    const a = i * 5 * DEG, card = i % 18 === 0, r1 = 0.03, r0 = card ? 0.021 : i % 2 === 0 ? 0.026 : 0.028;
    tp.push(Math.sin(a) * r0, 0, -Math.cos(a) * r0, Math.sin(a) * r1, 0, -Math.cos(a) * r1);
  }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
  const tickMat = new THREE.LineBasicMaterial({ color: 0xcfd8ff, transparent: true, opacity: 0.35, toneMapped: false });
  level.add(new THREE.LineSegments(tg, tickMat));
  const cardMat = new THREE.MeshBasicMaterial({ color: 0xffe9c2, transparent: true, opacity: 0.5, toneMapped: false });
  for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.003, 0.011), cardMat); const a = i * 90 * DEG; m.position.set(Math.sin(a) * 0.0255, 0, -Math.cos(a) * 0.0255); m.rotation.y = -a; level.add(m); }
  const needle = new THREE.Group(); compass.add(needle);
  const needleMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.45, toneMapped: false });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.04, 10), needleMat); cone.position.y = 0.02; needle.add(cone);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.025, 6), needleMat); tail.position.y = -0.01; needle.add(tail);
  const stillDot = new THREE.Mesh(new THREE.SphereGeometry(0.005, 10, 8), new THREE.MeshBasicMaterial({ color: 0x9fb0ff, transparent: true, opacity: 0.6, toneMapped: false })); compass.add(stillDot);
  const lc = document.createElement('canvas'); lc.width = 384; lc.height = 48; const lg = lc.getContext('2d');
  const ltex = new THREE.CanvasTexture(lc); ltex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.015), new THREE.MeshBasicMaterial({ map: ltex, transparent: true, depthWrite: false, toneMapped: false }));
  label.position.set(0, -0.045, 0); compass.add(label);
  let lastLabel = '';
  const setLabel = (t) => { if (t === lastLabel) return; lastLabel = t; lg.clearRect(0, 0, 384, 48); lg.fillStyle = 'rgba(12,15,28,0.62)'; lg.fillRect(0, 0, 384, 48); lg.fillStyle = '#ffe9c2'; lg.font = '600 24px system-ui, sans-serif'; lg.textAlign = 'center'; lg.textBaseline = 'middle'; lg.fillText(t, 192, 25, 376); ltex.needsUpdate = true; };
  let hand = null, prevA = false, prevB = false, prevS = false, manual = null, nudgeT = 0, pickIdx = -1;
  const aimV = new THREE.Vector3();

  function updateCompass(dt) {
    const m = getMenu();
    const right = m && m.controllers ? m.controllers.find((c) => c.userData.hand === 'right' && c.userData.src && c.userData.src.gamepad) : null;
    if (!right) { compass.visible = false; D.aiming = false; return; }
    if (hand !== right) { hand = right; right.add(compass); compass.position.set(0, 0.06, 0.03); }
    compass.visible = true;
    const gp = right.userData.src.gamepad, bt = gp.buttons || [], ax = gp.axes || [];
    const a = !!(bt[4] && bt[4].pressed), b = !!(bt[5] && bt[5].pressed), sc = !!(bt[3] && bt[3].pressed);
    const sx = ax.length > 3 ? ax[2] : 0, sy = ax.length > 3 ? ax[3] : 0;
    if (a && !prevA) { D.aiming = true; D.refYaw = D.headYaw(); manual = null; pickIdx = -1; nudgeT = 0; }
    if (D.aiming) {
      if (sc && !prevS) { pickIdx = (pickIdx + 1) % PICKS.length; manual = { h: PICKS[pickIdx][2], e: PICKS[pickIdx][3] }; }
      nudgeT -= dt;
      if ((Math.abs(sx) > 0.6 || Math.abs(sy) > 0.6) && nudgeT <= 0) {   // 5° nudges (repeat while held)
        if (!manual) { right.getWorldQuaternion(_q); manual = snapHE(toHE(_v.set(0, 0, -1).applyQuaternion(_q), D.refYaw)); }
        if (Math.abs(sx) > Math.abs(sy)) manual.h = (((manual.h + Math.sign(sx) * 5) % 360) + 360) % 360;
        else manual.e = Math.max(-90, Math.min(90, manual.e - Math.sign(sy) * 5));
        nudgeT = 0.28;
      }
      if (Math.abs(sx) < 0.3 && Math.abs(sy) < 0.3) nudgeT = 0;
      if (manual) fromHE(THREE, manual.h, manual.e, D.refYaw, aimV);
      else { right.getWorldQuaternion(_q); aimV.copy(shape(_v.set(0, 0, -1).applyQuaternion(_q))); }
      streak(aimV, true);
      if (!a && prevA) { D.aiming = false; D.setDir(aimV.clone(), keep()); }
    }
    if (b && !prevB && !D.aiming) D.toggleGo();
    prevA = a; prevB = b; prevS = sc;
    // dial stays level with 0° toward the reference heading; the needle points along the direction in world space
    compass.getWorldQuaternion(_q).invert();
    level.quaternion.copy(_q).multiply(new THREE.Quaternion().setFromAxisAngle(_up, D.refYaw));
    needle.quaternion.setFromUnitVectors(_up, _o.copy(D.aiming ? aimV : D.dir).applyQuaternion(_q).normalize());
    camera.getWorldPosition(_o); label.lookAt(_o);
    const bright = D.aiming || arrowT > 0;
    needleMat.opacity = bright ? 1 : D.moving() ? 0.7 : 0.4; tickMat.opacity = bright ? 0.85 : 0.3; cardMat.opacity = bright ? 1 : 0.5;
    stillDot.visible = !D.moving() && !D.aiming;
    setLabel(D.aiming ? describeHE(toHE(aimV, D.refYaw)) + ' — release A' : (D.moving() ? 'B: stop' : 'still · B: go'));
  }

  D.update = (dt, { paused = false } = {}) => {
    if (arrowT > 0) { arrowT -= dt; arrow.material.opacity = Math.min(0.75, arrowT / 1.2); arrow.visible = arrowT > 0; }
    updateCompass(dt);
    if (!move || !D.moving() || paused) return 0;
    const v = D.velocity();
    rig.position.addScaledVector(D.dir, v * dt);
    if (onStep) onStep(v);
    return v;
  };
  D.showArrow = () => streak(D.dir);
  D.compass = compass;
  return D;
}
