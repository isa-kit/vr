// ============================ shared/comfort.js — VR comfort kit ============================
//
//   import { createComfort, rotateRigAboutHead } from '../shared/comfort.js';
//
//   const comfort = createComfort({
//     renderer, scene, camera, dolly,               // camera must be a child of dolly, dolly in scene
//     menu: null,                                   // optional; pass later with comfort.attachMenu(menu) if you have it
//     groundHit: (origin, dir) => Vector3 | null,   // OPTIONAL: where a pointing ray meets walkable ground → enables Teleport
//     onQuality: (level 0..3) => {},                // OPTIONAL: frame-time governor asks you to cut load (hide extras, shadows…)
//   });
//
//   // 1) put its rows in your menu (collapsible "Comfort" section: vignette, turning, speed, teleport, pause):
//   createXRMenu({ ..., rows: [ ...yourRows, ...comfort.rows({ movement: true }) ],
//                  fade: comfort.fade })            // lets Quit / Recenter fade through black
//
//   // 2) each frame (AFTER you moved/turned the rig, BEFORE render):
//   comfort.update(dt, { moving: speedMetresPerSecond, turning: radiansPerSecond, zooming: false });
//   //   → drives the vignette (tunnel narrows while the user is artificially moved) + frame-time governor + fades.
//
//   // 3) locomotion helpers
//   const dAngle = comfort.turnDelta(stickX, dt);   // snap (30° steps) or smooth turn per the user's setting
//   rotateRigAboutHead(dolly, camera, dAngle);      // turn the rig around the head (or add dAngle to your own yaw var)
//   const v = comfort.speed(baseMetresPerSecond);   // base × user's speed setting; constant speed, no ramps. Slow by default.
//   comfort.paused                                  // true when the user chose "Pause / calm": freeze ALL ambient world motion
//   comfort.settings.teleport                       // true → don't smooth-walk with the stick; comfort handles point→fade→arrive
//   comfort.fade(() => { …do the jump… })           // out to black, run fn while black, back in. Use for any big jump.
//   comfort.reducedMotion                           // prefers-reduced-motion (desktop): keep ambient motion minimal
//
// Defaults are the comfortable ones: snap turn, medium vignette, slow speed, teleport off (opt-in), fades on.
// Settings persist in localStorage ('oortia-comfort-v1', shared by every world on the domain).
// Also does: renderer.xr.setFoveation(1) when a session starts, fade-in on enter, and `#debug` exposes window.__comfort.
// =============================================================================================

import * as THREE from 'three';

const KEY = 'oortia-comfort-v1';
const VIGNETTE_NAMES = ['Off', 'Low', 'Med', 'High'];
const APERTURE = [9, 0.9, 0.7, 0.52];            // half-angle (rad) of the clear window while moving; 9 = effectively no vignette
const SPEED_NAMES = ['Slow', 'Normal', 'Fast'], SPEED_MUL = [1, 1.6, 2.5];

// Stick → world movement. Gamepad convention: pushing FORWARD gives y < 0, pushing RIGHT gives x > 0.
// Forward = the camera's WORLD direction flattened to the ground (so it already includes any rig yaw — never apply yaw twice);
// right = forward × up. Example: rig yaw 0, stick (0,-1) → (0,0,-1); stick (1,0) → (+1,0,0).
// Rig yaw +90° (view turned left, facing −x): stick (0,-1) → (−1,0,0); stick (1,0) → (0,0,−1).
const _UP = new THREE.Vector3(0, 1, 0), _sf = new THREE.Vector3(), _sr = new THREE.Vector3();
export function stickVector(camera, x, y, out = new THREE.Vector3()) {
  camera.getWorldDirection(_sf); _sf.y = 0;
  if (_sf.lengthSq() < 1e-6) _sf.set(0, 0, -1);
  _sf.normalize();
  _sr.crossVectors(_sf, _UP);
  return out.copy(_sf).multiplyScalar(-y).addScaledVector(_sr, x);
}

// Rotate the rig about the HEAD. Positive angle = counter-clockwise from above = the view turns LEFT;
// so a right-stick push to the right must pass a NEGATIVE angle (turnDelta does).
export function rotateRigAboutHead(dolly, camera, angle) {
  if (!angle) return;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  camera.getWorldPosition(a);
  dolly.rotation.y += angle; dolly.updateMatrixWorld(true);
  camera.getWorldPosition(b);
  dolly.position.add(a.sub(b));
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
}

export function createComfort({ renderer, scene, camera, dolly, menu = null, groundHit = null, onQuality = null }) {
  const reducedMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const saved = load();
  const settings = Object.assign({ vignette: 2, snap: true, speed: 0, teleport: false, vignetteDesktop: false }, saved);
  const C = {
    settings, reducedMotion, paused: reducedMotion && saved.paused === undefined ? true : !!saved.paused,
    level: 0, menu,
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ ...settings, paused: C.paused })); } catch (e) { /* private mode */ } };

  // ---------- vignette + fade: one head-locked inside-out sphere, drawn last, hidden from magnifier passes ----------
  const uni = { uAp: { value: 9 }, uFade: { value: 0 }, uSoft: { value: 0.3 } };
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 28, 18), new THREE.ShaderMaterial({
    uniforms: uni, side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP; uniform float uAp, uFade, uSoft;
      void main(){
        float ang = acos(clamp(-normalize(vP).z, -1.0, 1.0));
        float a = max(smoothstep(uAp, uAp + uSoft, ang), uFade);
        if (a < 0.002) discard;
        gl_FragColor = vec4(0.0, 0.0, 0.0, a);
      }`,
  }));
  mesh.renderOrder = 100000; mesh.frustumCulled = false;
  mesh.layers.set(3); camera.layers.enable(3);          // own layer → the magnifier camera (layer 0 only) never sees it
  camera.add(mesh);

  // ---------- fades ----------
  let fadeTarget = 0, fadeSpeed = 4, fadeJob = null;
  function fade(fn, outT = 0.18, inT = 0.3) {
    if (fadeJob) { fadeJob.fn && fadeJob.fn(); }       // never lose a queued jump
    fadeTarget = 1; fadeSpeed = 1 / Math.max(0.05, reducedMotion ? 0.05 : outT);
    fadeJob = { fn, inT, ran: false };
    if (!renderer.xr.isPresenting && !fn) { fadeJob = null; }
  }
  C.fade = fade;

  // ---------- vignette driving ----------
  let ap = 9, pulse = 0;
  C.update = (dt, st = {}) => {
    const xr = renderer.xr.isPresenting;
    const moving = (st.moving || 0) > 0.05 || Math.abs(st.turning || 0) > 0.05 || !!st.zooming;
    if (st.pulse) pulse = Math.max(pulse, st.pulse);
    pulse = Math.max(0, pulse - dt);
    const active = (xr || settings.vignetteDesktop) && settings.vignette > 0 && (moving || pulse > 0);
    const goal = active ? APERTURE[settings.vignette] : 9;
    // narrow quickly, relax slowly (relaxing slowly avoids a pop when you stop)
    ap += (goal - ap) * Math.min(1, dt * (goal < ap ? 9 : 2.2));
    if (ap > 8.5 && goal > 8.5) ap = 9;
    uni.uAp.value = Math.min(9, ap);
    // fade state machine
    const cur = uni.uFade.value;
    if (fadeJob) {
      if (!fadeJob.ran && cur >= 0.999) { fadeJob.ran = true; if (fadeJob.fn) fadeJob.fn(); fadeTarget = 0; fadeSpeed = 1 / fadeJob.inT; }
      if (fadeJob.ran && cur <= 0.001) fadeJob = null;
    }
    if (cur !== fadeTarget) {
      const d = fadeSpeed * dt;
      uni.uFade.value = cur < fadeTarget ? Math.min(fadeTarget, cur + d) : Math.max(fadeTarget, cur - d);
    }
    mesh.visible = uni.uAp.value < 8.5 || uni.uFade.value > 0.001;
    governor(dt);
    teleportUpdate(dt);
  };
  C.fadeIn = (t = 0.9) => { uni.uFade.value = 1; fadeTarget = 0; fadeSpeed = 1 / t; fadeJob = null; };

  // ---------- turning / speed ----------
  let latch = false;
  // stick right (x>0) → view turns right → rig yaw DEcreases (negative angle); snap = −30° per flick, smooth ≈ −45°/s at full deflection
  C.turnDelta = (x, dt) => {
    if (Math.abs(x) < 0.3) latch = false;
    if (Math.abs(x) < 0.15) return 0;
    if (settings.snap) {
      if (Math.abs(x) > 0.7 && !latch) { latch = true; C.update(0, { pulse: 0.35 }); return -Math.sign(x) * Math.PI / 6; }
      return 0;
    }
    return -x * dt * 0.8;                              // smooth: slow (≈45°/s at full deflection)
  };
  C.speed = (base) => base * SPEED_MUL[settings.speed];

  // ---------- frame-time governor ----------
  let ema = 16, slowFor = 0, base = renderer.getPixelRatio();
  function governor(dt) {
    if (dt <= 0 || dt > 0.25) return;
    ema += (dt * 1000 - ema) * 0.05;
    const s = renderer.xr.getSession && renderer.xr.getSession();
    const budget = 1000 / (s && s.frameRate ? s.frameRate : (renderer.xr.isPresenting ? 72 : 60));
    slowFor = ema > budget * 1.35 ? slowFor + dt : Math.max(0, slowFor - dt * 2);
    if (slowFor > 2 && C.level < 3) {
      C.level++; slowFor = 0;
      if (!renderer.xr.isPresenting) { renderer.setPixelRatio(Math.max(0.6, base * (1 - 0.2 * C.level))); renderer.setSize(innerWidth, innerHeight); }
      if (onQuality) onQuality(C.level);
    }
  }
  renderer.xr.addEventListener('sessionstart', () => {
    try { renderer.xr.setFoveation(1); } catch (e) { /* older runtime */ }
    C.fadeIn(0.9);                                      // always arrive from black, never pop in
    base = renderer.getPixelRatio();
  });
  renderer.xr.addEventListener('sessionend', () => { uni.uFade.value = 0; });

  // ---------- teleport: point (stick forward) → marker → release → fade → arrive ----------
  const marker = new THREE.Group();
  marker.add(new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false })));
  marker.add(new THREE.Mesh(new THREE.CircleGeometry(0.22, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false })));
  marker.visible = false; marker.renderOrder = 50; scene.add(marker);
  const tp = { aiming: -1, target: new THREE.Vector3() };
  const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Matrix4(), _h = new THREE.Vector3();
  function teleportUpdate() {
    if (!settings.teleport || !groundHit || !menu || !renderer.xr.isPresenting) { marker.visible = false; tp.aiming = -1; return; }
    const session = renderer.xr.getSession(); if (!session) return;
    let aimIdx = -1, released = false;
    menu.controllers.forEach((c, i) => {
      const gp = c.userData.src && c.userData.src.gamepad;
      if (!gp || gp.axes.length < 4) return;
      const y = gp.axes[3];
      if (y < -0.6 && !c.userData.overMenu) aimIdx = i;
      else if (tp.aiming === i && y > -0.3) released = true;
    });
    if (aimIdx >= 0) {
      tp.aiming = aimIdx;
      const c = menu.controllers[aimIdx];
      c.updateWorldMatrix(true, false);
      _m.identity().extractRotation(c.matrixWorld);
      _o.setFromMatrixPosition(c.matrixWorld); _d.set(0, 0, -1).applyMatrix4(_m).normalize();
      const hit = groundHit(_o, _d);
      if (hit) { tp.target.copy(hit); marker.position.copy(hit); marker.position.y += 0.02; marker.visible = true; tp.valid = true; }
      else { marker.visible = false; tp.valid = false; }
    } else if (released) {
      const go = tp.valid; tp.aiming = -1; marker.visible = false;
      if (go) {
        const dest = tp.target.clone();
        fade(() => {                                    // fade out → move so the HEAD lands on the marker → fade in
          camera.getWorldPosition(_h);
          dolly.position.x += dest.x - _h.x; dolly.position.z += dest.z - _h.z;
          dolly.position.y = dest.y;
        }, 0.14, 0.25);
      }
      tp.valid = false;
    }
  }
  C.attachMenu = (m) => { menu = m; C.menu = m; };

  // ---------- menu rows (collapsible) ----------
  let open = false;
  // header:false → rows are always visible (use inside your own tab); header:true → one collapsible 'Comfort ▸' block
  C.rows = ({ movement = true, teleport = !!groundHit, header = true } = {}) => {
    const shown = () => !header || open;
    const row = (label, names, get, set) => ({ label, visible: shown, cells: names.map((n, i) => ({ text: n, action: () => { set(i); save(); }, active: () => get() === i })) });
    const rows = header ? [{ cells: [{ text: () => 'Comfort ' + (open ? '▾' : '▸'), action: () => { open = !open; }, tone: 'accent' }] }] : [];
    rows.push(row('Vignette', VIGNETTE_NAMES, () => settings.vignette, (i) => { settings.vignette = i; C.update(0, { pulse: 0.8 }); }));
    rows.push(row('Turning', ['Snap', 'Smooth'], () => (settings.snap ? 0 : 1), (i) => { settings.snap = i === 0; }));
    if (movement) rows.push(row('Speed', SPEED_NAMES, () => settings.speed, (i) => { settings.speed = i; }));
    if (movement && teleport) rows.push(row('Move by', ['Walk', 'Teleport'], () => (settings.teleport ? 1 : 0), (i) => { settings.teleport = i === 1; }));
    rows.push({ label: 'Calm', visible: shown, cells: [{ text: () => (C.paused ? 'Paused — tap to resume' : 'Pause world motion'), action: () => { C.paused = !C.paused; save(); }, active: () => C.paused, w: 2 }] });
    return rows;
  };

  if (location.hash === '#debug') window.__comfort = C;
  return C;
}
