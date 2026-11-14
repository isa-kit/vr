// ============================ shared/drift.js — slow straight drift in a user-set, headset-relative direction ============================
//
//   import { createDrift } from '../shared/drift.js?v=drift3';
//   const drift = createDrift({ THREE, scene, camera, rig, comfort, getMenu: () => menu, start: 'still', cap: 0.45 });
//   rows: [...drift.rows()]            // Motion presets + flat-screen setters ("Where I look", "Point to set") + speed
//   each frame: const v = drift.update(dt, { paused });  comfort.update(dt, { moving: v })
//   on a trigger / click: if (drift.capture(null, rayDir)) return;   // consumed while flat-screen "Point to set" is armed
//   drift.dir (unit Vector3, world space), drift.mode ('still' | 'custom' | preset id), drift.moving()
//
// Directions are HEADSET-RELATIVE at the moment you choose them, then fixed in the world as one straight line:
//   Forward = where the headset faces (full 3D — lying on your back, forward is the sky), Up = the top of your head,
//   Down / Left / Right likewise. Nothing steers with your head afterwards; you reset it when you want.
// Right-hand COMPASS (VR, temporary home): a small needle above the right controller always shows the drift direction.
//   Hold A and point the right controller → a faint preview line; release A → that becomes the new direction.
//   B = go / stop along the compass. Dim at rest, bright while aiming. Trigger is left free (Sky Wand draws with it).
// Comfort: stationary by default; constant low speed (hard cap); a direction change while moving goes through a
// short fade (stop-then-start), never a curve.
// ====================================================================================================================
const PRESETS = { still: 'Stationary', forward: 'Forward', up: 'Up', down: 'Down', left: 'Left', right: 'Right' };
const LOCAL = { forward: [0, 0, -1], up: [0, 1, 0], down: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0] };
const SPEEDS = [['Very slow', 0.15], ['Slow', 0.25], ['Gentle', 0.4]];

function dotTexture(THREE) {
  const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c);
}

export function createDrift({ THREE, scene, camera, rig, comfort = null, getMenu = () => null, presets = ['still', 'forward', 'up', 'down', 'left', 'right'], start = 'still', cap = 0.45, onStep = null, move = true, isMoving = null, onGo = null, startDir = [0, 0, -1] }) {
  // move:false → only pick/show the direction (the caller moves the rig); isMoving / onGo let the caller own "moving"
  const D = { mode: start, dir: new THREE.Vector3().fromArray(startDir).normalize(), armed: false, cap, speedIdx: 0 };
  const refresh = () => { const m = getMenu(); if (m) m.refresh(); };
  const fade = (fn) => (comfort && comfort.fade ? comfort.fade(fn, 0.3, 0.4) : fn());
  const _o = new THREE.Vector3(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  const tex = dotTexture(THREE);

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
    const go = () => { D.dir.copy(v).normalize(); D.mode = mode; streak(D.dir); refresh(); };
    if (D.moving() && mode !== 'still') fade(go); else go();      // never curve while moving: change through a short fade
  };
  const keep = () => (D.mode === 'still' ? 'still' : 'custom');   // setting a direction while still does not start moving
  D.resolve = (id) => { camera.getWorldQuaternion(_q); return new THREE.Vector3().fromArray(LOCAL[id]).applyQuaternion(_q).normalize(); };
  D.setPreset = (id) => {
    if (id === 'still') { D.mode = 'still'; refresh(); return; }
    if (id === 'custom') { D.setDir(D.dir.clone(), 'custom'); return; }
    if (LOCAL[id]) D.setDir(D.resolve(id), id);                    // headset-relative at the moment you choose it
  };
  D.fromGaze = () => D.setDir(D.resolve('forward'), keep());
  D.arm = () => { D.armed = !D.armed; refresh(); };
  D.capture = (origin, dir) => {                                   // flat screens: a click while armed sets the direction
    if (!D.armed) return false;
    D.armed = false; D.setDir(dir.clone(), keep()); return true;
  };
  D.captureController = (c) => { if (!D.armed) return false; c.getWorldQuaternion(_q); return D.capture(null, new THREE.Vector3(0, 0, -1).applyQuaternion(_q)); };
  D.toggleGo = () => { if (onGo) { onGo(); return; } if (D.mode === 'still') D.setDir(D.dir.clone(), 'custom'); else { D.mode = 'still'; refresh(); } };
  D.velocity = () => Math.min(D.cap, comfort && comfort.speed ? comfort.speed(SPEEDS[D.speedIdx][1]) : SPEEDS[D.speedIdx][1]);

  D.rows = ({ title = 'Motion: stationary, or a slow straight line' } = {}) => {
    const rows = [{ section: title }];
    for (let i = 0; i < presets.length; i += 3) rows.push({ cells: presets.slice(i, i + 3).map((id) => ({ text: PRESETS[id], action: () => D.setPreset(id), active: () => D.mode === id })) });
    rows.push({ label: 'Set direction', cells: [
      { text: 'Where I look', action: () => D.fromGaze() },
      { text: () => (D.armed ? 'Now point / click…' : 'Point to set'), action: () => D.arm(), active: () => D.armed },
    ] });
    rows.push({ label: 'Speed', visible: () => D.moving(), cells: SPEEDS.map(([t], i) => ({ text: t, action: () => { D.speedIdx = i; refresh(); }, active: () => D.speedIdx === i })) });
    return rows;
  };

  // ---- right-hand compass (self-contained so it can move to a new home later)
  const compass = new THREE.Group(); compass.visible = false;
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xcfd8ff, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.0025, 6, 32), ringMat); compass.add(ring);
  const needle = new THREE.Group(); compass.add(needle);
  const needleMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.45, toneMapped: false });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.045, 10), needleMat); cone.position.y = 0.022; needle.add(cone);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.03, 6), needleMat); tail.position.y = -0.012; needle.add(tail);
  const stillDot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshBasicMaterial({ color: 0x9fb0ff, transparent: true, opacity: 0.6, toneMapped: false })); compass.add(stillDot);
  const lc = document.createElement('canvas'); lc.width = 256; lc.height = 48; const lg = lc.getContext('2d');
  const ltex = new THREE.CanvasTexture(lc); ltex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.015), new THREE.MeshBasicMaterial({ map: ltex, transparent: true, depthWrite: false, toneMapped: false }));
  label.position.set(0, -0.042, 0); compass.add(label);
  let lastLabel = '';
  const setLabel = (t) => { if (t === lastLabel) return; lastLabel = t; lg.clearRect(0, 0, 256, 48); lg.fillStyle = 'rgba(12,15,28,0.6)'; lg.fillRect(0, 0, 256, 48); lg.fillStyle = '#ffe9c2'; lg.font = '600 26px system-ui, sans-serif'; lg.textAlign = 'center'; lg.textBaseline = 'middle'; lg.fillText(t, 128, 25); ltex.needsUpdate = true; };
  let hand = null, aiming = false, prevA = false, prevB = false;

  function updateCompass() {
    const m = getMenu();
    const right = m && m.controllers ? m.controllers.find((c) => c.userData.hand === 'right' && c.userData.src && c.userData.src.gamepad) : null;
    if (!right) { compass.visible = false; aiming = false; return; }
    if (hand !== right) { hand = right; right.add(compass); compass.position.set(0, 0.06, 0.03); }
    compass.visible = true;
    const bt = right.userData.src.gamepad.buttons || [];
    const a = !!(bt[4] && bt[4].pressed), b = !!(bt[5] && bt[5].pressed);
    right.getWorldQuaternion(_q); _v.set(0, 0, -1).applyQuaternion(_q);
    if (a) { aiming = true; streak(_v, true); }
    if (!a && prevA && aiming) { aiming = false; D.setDir(_v.clone(), keep()); }
    if (b && !prevB) D.toggleGo();
    prevA = a; prevB = b;
    // the needle points along the drift direction in WORLD space (counter-rotate the hand)
    compass.getWorldQuaternion(_q).invert();
    needle.quaternion.setFromUnitVectors(_up, _o.copy(aiming ? _v : D.dir).applyQuaternion(_q).normalize());
    camera.getWorldPosition(_o); ring.lookAt(_o); label.lookAt(_o);
    const bright = aiming || arrowT > 0;
    needleMat.opacity = bright ? 1 : D.moving() ? 0.7 : 0.4; ringMat.opacity = bright ? 0.8 : 0.3;
    stillDot.visible = !D.moving() && !aiming;
    setLabel(aiming ? 'release A to set' : D.moving() ? 'B: stop' : 'still · B: go');
  }

  D.update = (dt, { paused = false } = {}) => {
    if (arrowT > 0) { arrowT -= dt; arrow.material.opacity = Math.min(0.75, arrowT / 1.2); arrow.visible = arrowT > 0; }
    updateCompass();
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
