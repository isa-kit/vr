// ============================ shared/drift.js — slow straight drift in a user-set direction ============================
//
//   import { createDrift } from '../shared/drift.js?v=drift1';
//   const drift = createDrift({ THREE, scene, camera, rig, comfort, getMenu: () => menu,
//                               presets: ['still', 'forward', 'rise', 'down'], start: 'still', cap: 0.45 });
//   rows: [...drift.rows()]            // Motion: Stationary / Forward / Rise / Float down / Custom + "Where I look" / "Point to set"
//   each frame: const v = drift.update(dt);  comfort.update(dt, { moving: v })
//   on a trigger / click: if (drift.capture(rayOriginVec3, rayDirVec3)) return;   // consumed while "Point to set" is armed
//   drift.dir (unit Vector3), drift.mode, drift.moving(), drift.setDir(vec3), drift.onStep(fn)
//
// Rules (comfort): stationary by default; when moving it is ONE straight line at a constant, low speed (hard cap);
// a new direction never curves the path — it changes through a short fade; a faint arrow shows the new direction.
// The direction may be anything the user points at: ahead, sideways, diagonal, up or down.
// ====================================================================================================================
const PRESET = {
  still: ['Stationary', null],
  forward: ['Forward', [0, 0, -1]],
  rise: ['Rise', [0, 1, 0]],
  down: ['Float down', [0, -1, 0]],
};
const SPEEDS = [['Very slow', 0.15], ['Slow', 0.25], ['Gentle', 0.4]];

export function createDrift({ THREE, scene, camera, rig, comfort = null, getMenu = () => null, presets = ['still', 'forward', 'rise', 'down'], start = 'still', cap = 0.45, speed = 1, onStep = null, move = true, isMoving = null }) {
  // move:false → only pick/show the direction (the caller moves the rig itself); isMoving overrides "am I moving" for fades
  const D = { mode: start, dir: new THREE.Vector3(0, 0, -1), armed: false, speed, cap };
  if (PRESET[start] && PRESET[start][1]) D.dir.fromArray(PRESET[start][1]);
  const refresh = () => { const m = getMenu(); if (m) m.refresh(); };
  const fade = (fn) => (comfort && comfort.fade ? comfort.fade(fn, 0.3, 0.4) : fn());

  // faint arrow: a streak of dots from just ahead of you along the direction, fading out after ~2.5 s
  const N = 24, ap = new Float32Array(N * 3);
  const ag = new THREE.BufferGeometry(); ag.setAttribute('position', new THREE.BufferAttribute(ap, 3));
  const dc = document.createElement('canvas'); dc.width = dc.height = 32; const dg = dc.getContext('2d');
  const gr = dg.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  dg.fillStyle = gr; dg.fillRect(0, 0, 32, 32);
  const arrow = new THREE.Points(ag, new THREE.PointsMaterial({ size: 0.03, map: new THREE.CanvasTexture(dc), color: 0xfff0c8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  arrow.frustumCulled = false; scene.add(arrow);
  let arrowT = 0;
  const _o = new THREE.Vector3(), _q = new THREE.Quaternion();
  function showArrow() {
    camera.getWorldPosition(_o);
    for (let i = 0; i < N; i++) { const d = 0.9 + i * 0.12; ap[i * 3] = _o.x + D.dir.x * d; ap[i * 3 + 1] = _o.y - 0.15 + D.dir.y * d; ap[i * 3 + 2] = _o.z + D.dir.z * d; }
    ag.attributes.position.needsUpdate = true; arrowT = 2.6;
  }

  D.setDir = (v, mode = 'custom') => {
    const go = () => { D.dir.copy(v).normalize(); D.mode = mode; showArrow(); refresh(); };
    if (D.moving()) fade(go); else go();                // never curve while moving: change through a short fade
  };
  D.setPreset = (id) => {
    if (id === 'custom') { D.setDir(D.dir, 'custom'); return; }
    const p = PRESET[id]; if (!p) return;
    const go = () => { D.mode = id; if (p[1]) { D.dir.fromArray(p[1]); if (id === 'forward') { camera.getWorldDirection(_o); _o.y = 0; if (_o.lengthSq() > 1e-4) D.dir.copy(_o.normalize()); } showArrow(); } refresh(); };
    if (D.moving() && id !== 'still') fade(go); else go();
  };
  D.fromGaze = () => { camera.getWorldDirection(_o); D.setDir(_o.clone()); };
  D.arm = () => { D.armed = !D.armed; refresh(); };
  D.capture = (origin, dir) => {                       // a trigger / click while armed sets the direction
    if (!D.armed) return false;
    D.armed = false; D.setDir(dir.clone()); return true;
  };
  D.captureController = (c) => { c.getWorldQuaternion(_q); return D.capture(null, new THREE.Vector3(0, 0, -1).applyQuaternion(_q)); };
  D.moving = () => (isMoving ? isMoving() : D.mode !== 'still');
  D.velocity = () => Math.min(D.cap,  comfort && comfort.speed ? comfort.speed(SPEEDS[D.speedIdx || 0][1]) : SPEEDS[D.speedIdx || 0][1]);
  D.speedIdx = 0;

  D.rows = ({ title = 'Motion: stationary, or a slow straight line' } = {}) => [
    { section: title },
    { cells: [...presets, 'custom'].map((id) => ({ text: id === 'custom' ? 'My direction' : PRESET[id][0], action: () => D.setPreset(id), active: () => D.mode === id })) },
    { label: 'Set direction', cells: [
      { text: 'Where I look', action: () => D.fromGaze() },
      { text: () => (D.armed ? 'Now point + trigger…' : 'Point to set'), action: () => D.arm(), active: () => D.armed },
    ] },
    { label: 'Speed', visible: () => D.moving(), cells: SPEEDS.map(([t], i) => ({ text: t, action: () => { D.speedIdx = i; refresh(); }, active: () => D.speedIdx === i })) },
  ];

  D.update = (dt, { paused = false } = {}) => {
    if (arrowT > 0) { arrowT -= dt; arrow.material.opacity = Math.min(0.75, arrowT / 1.2); arrow.visible = arrowT > 0; }
    if (!move || !D.moving() || paused) return 0;
    const v = D.velocity();
    rig.position.addScaledVector(D.dir, v * dt);
    if (onStep) onStep(v);
    return v;
  };
  D.showArrow = showArrow;
  return D;
}
