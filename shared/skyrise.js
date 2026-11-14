// ============================ shared/skyrise.js — "Lying down" posture + gentle upward travel ============================
//
//   import { createSkyRise } from '../shared/skyrise.js?v=rise1';
//   const rise = createSkyRise({ THREE, renderer, camera, rig, comfort, getMenu: () => menu,
//                                story: 'trees' | 'sky' | 'stars', ceiling: 60, step: 5,
//                                home: () => ({ x, y, z }),            // the ground spot you lie on (rig position)
//                                onLying: (on) => {} });               // world lowers the desktop eye, tilts the view up, etc.
//   rows: [...rise.rows()]                    // menu: Posture (Sitting / Lying down) + Go up / Back to the ground
//   each frame: const speed = rise.update(dt); comfort.update(dt, { moving: speed })   // vignette while floating
//   rise.lying, rise.height, rise.setLying(bool)
//
// The world stays UPRIGHT. Lying down never tilts the horizon into the overhead view; you lie on the real ground and
// look at what is really above you. Going up is opt-in and always vertical-first:
//   • Float up / Float down gently — slow constant speed (comfort speed setting), vignette on, stops at the ceiling or the ground.
//     VR: hold the thumbstick up / down while lying.
//   • Rise a level — one fade-through-black step ("the next branch" in trees, "higher" in sky / stars).
//   • Drift where I look — a slow dreamlike dissolve to a point along your gaze (upward only, stays near home).
//   • Back to the ground — fade home.
// =====================================================================================================================
import { createDrift } from './drift.js?v=drift5';

const WORDS = {
  trees: { float: 'Float up', level: 'Next branch', drift: 'Drift where I look' },
  sky:   { float: 'Float up', level: 'Rise higher', drift: 'Drift where I look' },
  stars: { float: 'Float up', level: 'Drift higher', drift: 'Drift where I look' },
};

// soft cumulus sprites high overhead — a sky-gazing subject for worlds whose zenith is empty (shown while lying down)
function makeClouds(THREE, parent, count = 14, tint = 0xffffff) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 320; const g = c.getContext('2d');
  for (let i = 0; i < 46; i++) {                       // many soft puffs, denser and higher in the middle
    const u = Math.random(), x = 70 + u * 372, mid = 1 - Math.abs(u - 0.5) * 2;
    const y = 200 - mid * 70 + (Math.random() - 0.5) * 50, r = 26 + Math.random() * 40 + mid * 30;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 320);
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const grp = new THREE.Group(); grp.visible = false; parent.add(grp);
  const list = [];
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.62), new THREE.MeshBasicMaterial({ map: tex, color: tint, transparent: true, opacity: 0.8, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    const sc = 50 + Math.random() * 70; m.scale.setScalar(sc); m.rotation.x = Math.PI / 2; m.rotation.z = Math.random() * 6;
    m.position.set((Math.random() * 2 - 1) * 260, 150 + Math.random() * 90, (Math.random() * 2 - 1) * 260);
    grp.add(m); list.push(m);
  }
  return { grp, update(dt, at) { grp.position.set(at.x, 0, at.z); for (const m of list) { m.position.x += 1.6 * dt; if (m.position.x > 280) m.position.x = -280; } } };
}

export function createSkyRise({ THREE, renderer, camera, rig, comfort, getMenu = () => null, story = 'sky', ceiling = 60, step = 5, home, onLying = null, base = 0.3, clouds = false, parent = null, isPaused = () => false }) {
  const w = WORDS[story] || WORDS.sky;
  const R = { lying: false, height: 0, floating: 0, shift: new THREE.Vector2() };
  const _d = new THREE.Vector3(), _p = new THREE.Vector3();
  const MAX = 0.45;                                     // hard cap (m/s): slow straight vertical drift only
  const spd = () => Math.min(MAX, comfort && comfort.speed ? comfort.speed(base) : base);
  const refresh = () => { const m = getMenu(); if (m) m.refresh(); };
  const sky = clouds && parent ? makeClouds(THREE, parent, 22, clouds === true ? 0xffffff : clouds) : null;
  // the float direction is user-definable (straight up by default): "Where I look" or "Point to set" (controller / click)
  const D = R.dirPicker = createDrift({ THREE, scene: parent || rig.parent, camera, rig, comfort, getMenu, start: 'custom', startDir: [0, 1, 0], cap: MAX, move: false,
    isMoving: () => R.floating !== 0, onGo: () => { if (R.lying) R.toggleFloat(1); } });   // right-hand compass: hold A + point, B = go / stop
  D.speedIdx = 1;
  const _v = new THREE.Vector3();
  let hooked = false;
  renderer.domElement.addEventListener('pointerdown', (e) => {          // flat screens: "Point to set" takes the next click
    if (!D.armed || renderer.xr.isPresenting) return;
    const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    D.capture(null, rc.ray.direction);
  }, true);

  function place() {
    const h = home();
    rig.position.set(h.x + R.shift.x, h.y + R.height, h.z + R.shift.y);
  }
  R.setLying = (on) => {
    const go = () => { R.lying = on; R.height = 0; R.floating = 0; R.shift.set(0, 0); if (onLying) onLying(on); place(); if (sky) sky.grp.visible = on; refresh(); };
    if (comfort && on !== R.lying) comfort.fade(go); else go();
  };
  R.toGround = () => { R.floating = 0; const go = () => { R.height = 0; R.shift.set(0, 0); place(); refresh(); }; comfort ? comfort.fade(go, 0.5, 0.6) : go(); };
  R.level = () => {
    R.floating = 0;
    const go = () => { R.height = Math.min(ceiling, R.height + step); place(); refresh(); };
    if (R.height >= ceiling) return; comfort ? comfort.fade(go, 0.35, 0.45) : go();
  };
  R.drift = () => {                                     // the "visual trip": a slow dissolve to where you are looking
    R.floating = 0;
    camera.getWorldDirection(_d);
    if (_d.y < 0.25) _d.y = 0.25;                       // always upward
    _d.normalize();
    const dist = Math.min(18, (ceiling - R.height) / _d.y);
    if (dist < 1) return;
    const go = () => {
      R.height = Math.min(ceiling, R.height + _d.y * dist);
      R.shift.x += _d.x * dist; R.shift.y += _d.z * dist;
      const L = R.shift.length(); if (L > 25) R.shift.multiplyScalar(25 / L);   // stay near your spot
      place(); refresh();
    };
    comfort ? comfort.fade(go, 0.9, 1.3) : go();
  };
  R.toggleFloat = (dir = 1) => { R.floating = R.floating === dir ? 0 : dir; refresh(); };

  R.rows = () => [
    { section: 'Posture' },
    { label: 'Posture', cells: [
      { text: 'Sitting', action: () => R.setLying(false), active: () => !R.lying },
      { text: 'Lying up', action: () => R.setLying(true), active: () => R.lying },
    ] },
    { label: 'Float', visible: () => R.lying, cells: [
      { text: () => (R.floating === 1 ? '■ Stop' : (D.dir.y > 0.98 ? '▲ ' + w.float : '▶ Float my way')), action: () => R.toggleFloat(1), active: () => R.floating === 1, w: 1.3 },
      { text: () => (R.floating === -1 ? '■ Stop' : '▼ Float down gently'), action: () => R.toggleFloat(-1), active: () => R.floating === -1, visible: () => R.height > 0.05 },
      { text: w.level, action: () => R.level() },
    ] },
    { label: 'Direction', visible: () => R.lying, cells: [
      { text: 'Forward', action: () => D.setPreset('forward'), active: () => D.mode === 'forward' },
      { text: 'Up', action: () => D.setPreset('up'), active: () => D.mode === 'up' },
      { text: () => (D.armed ? 'Point + trigger…' : 'Point to set'), action: () => D.arm(), active: () => D.armed },
    ] },
    { label: 'Speed', visible: () => R.lying && R.floating !== 0, cells: [['Very slow', 0], ['Slow', 1], ['Gentle', 2]].map(([t, i]) => ({ text: t, action: () => { D.speedIdx = i; refresh(); }, active: () => D.speedIdx === i })) },
    { label: () => (R.height > 0.3 ? `Up ${Math.round(R.height)} m` : 'On the ground'), visible: () => R.lying, cells: [
      { text: w.drift, action: () => R.drift(), w: 1.4 },
      { text: 'Back to the ground', action: () => R.toGround(), visible: () => R.height > 0.05 || R.shift.lengthSq() > 0, tone: 'accent' },
    ] },
  ];

  // desktop keys: PageUp / E float up, PageDown / Q float down (held)
  const keys = {};
  addEventListener('keydown', (e) => { if (R.lying && /PageUp|PageDown|KeyE|KeyQ/.test(e.code)) keys[e.code] = true; });
  addEventListener('keyup', (e) => { keys[e.code] = false; });

  R.update = (dt) => {
    if (!hooked && getMenu() && getMenu().onSelectStart) { hooked = true; getMenu().onSelectStart((c) => { if (R.lying) D.captureController(c); }); }
    D.update(dt);
    if (!R.lying) return 0;
    if (sky && !isPaused()) { const h = home(); sky.update(dt, h); }
    let dir = R.floating;
    if (keys.PageUp || keys.KeyE) dir = 1; else if (keys.PageDown || keys.KeyQ) dir = -1;
    const m = getMenu();
    if (renderer.xr.isPresenting && m && m.controllers && !D.aiming) {   // hold the thumbstick up / down (not while aiming the compass)
      for (const c of m.controllers) {
        const g = c.userData.src && c.userData.src.gamepad; if (!g || !g.axes) continue;
        const y = g.axes.length > 3 ? g.axes[3] : g.axes[1] || 0;
        if (y < -0.6) dir = 1; else if (y > 0.6) dir = -1;
      }
    }
    if (!dir) return 0;
    if (dir > 0) _v.copy(D.dir); else _v.set(0, -1, 0);               // one straight line: along your direction, or straight down
    const v = D.velocity(), before = R.height, bx = R.shift.x, bz = R.shift.y;
    R.height = Math.max(0, Math.min(ceiling, R.height + _v.y * v * dt));
    R.shift.x += _v.x * v * dt; R.shift.y += _v.z * v * dt;
    const L = R.shift.length(); if (L > 25) R.shift.multiplyScalar(25 / L);   // stay near your spot
    if (Math.abs(R.height - before) + Math.abs(R.shift.x - bx) + Math.abs(R.shift.y - bz) < 1e-5) { if (R.floating) { R.floating = 0; refresh(); } return 0; }
    place();
    if (Math.floor(before) !== Math.floor(R.height)) refresh();
    return v;
  };
  R.place = place;
  return R;
}
