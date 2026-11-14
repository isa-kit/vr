// ============================ shared/app.js — the ONE bootstrap for every Oortia app ============================
// The binding conventions are in /STANDARD.md. A new app imports ONLY this file (plus three) — copy /template/.
//
//   import { THREE, createOortiaApp, sectionRow, choiceGrid } from '../shared/app.js?v=app2';
//   const app = await createOortiaApp({
//     id: 'myapp', title: 'My App',
//     capabilities: { locomotion: 'none' | 'walk' | 'drift',            // default 'none'
//                     posture: ['seated', 'lying-up'],                  // first = default; 'standing' | 'seated' | 'lying-up'
//                     passthrough: true, tools: false },
//     background: 0x0b1238, fov: 68, far: 1200, tone: { bloom: 0.3 },   // look (all optional)
//     home: { x: 0, y: 0, z: 0, yaw: 0 },                               // where Recenter puts you (null = keep position, reset heading)
//     flatDrag: 'look' | 'act',                                         // flat screens: drag looks (click = press) | drag acts (right-drag / two fingers look)
//     tabs: (app) => [{ name: 'Brush', rows: [...] }],                  // YOUR menu tabs; Motion + Comfort tabs are appended for you
//     sound: { get, set }, hint: 'flat-screen help line',
//     onRecenter: (frame, app) => {}, onPause: (paused) => {}, onPosture: (p) => {}, onXR: (on) => {},
//   });
//   app.world.add(...)            // everything opaque goes in app.world (passthrough hides it in one go)
//   app.tick((dt, t) => {})       // dt is 0 while Paused; pass { always: true } as 2nd arg for real time
//   app.onPress((aim) => {})      // trigger / click / tap not consumed by the menu: aim = { kind, index, controller, ray }
//   app.onRelease((aim) => {})
//   app.start()
//   app.scene / camera / renderer / dolly / menu / comfort / drift / touch / fx / caps / kit (tools) / xr / paused / posture
//   app.recenter() / setPosture(p) / setPaused(v) / headFrame() / placeAlongGaze(group, metres, { minElevationDeg })
//   app.store(key, fallback) / app.save(key, value)   // per-app settings in localStorage 'oortia-<id>-v1'
//
// Existing kits (shared/lie.js, seated/common.js) and hand-wired worlds use the lower-level `standardChrome()` below:
// it is the ONLY place that creates the menu + comfort pair, so the standard top level (Pause, Recenter, Menu style,
// Quit to Worlds, then the app's tabs) and the standard Pause exist everywhere by construction.
// =================================================================================================================
import * as THREE from 'three';
import { detectXR, createXRMenu, recenterRig, sectionRow, buttonRow, toggleRow, stepperRow, choiceGrid, swatchGrid, tabRow, inTab } from './xrmenu.js?v=20261114h';
import { createComfort, rotateRigAboutHead, stickVector } from './comfort.js?v=20261114f';
import { createTouch } from './touch.js?v=20261114f';
import { beautify } from './beauty.js?v=20261114f';

export { THREE, detectXR, recenterRig, sectionRow, buttonRow, toggleRow, stepperRow, choiceGrid, swatchGrid, tabRow, inTab, createComfort, rotateRigAboutHead, stickVector, createTouch, beautify };

// The numbers of the standard, in one place (STANDARD.md quotes these).
export const STANDARD = Object.freeze({
  DRIFT_CAP: 0.45,                 // m/s — hard cap for any artificial drift
  WALK_SPEED: 1.0, WALK_CAP: 1.6,  // m/s — walking base (× the user's comfort speed) and its hard cap
  SNAP_TURN_DEG: 30,
  EYE: Object.freeze({ standing: 1.6, seated: 1.15, 'lying-up': 0.3 }),   // flat-screen eye heights (a headset reports the real one)
  LIE_PITCH: 1.42,                 // flat-screen look-up angle for Lying up (rad)
  POSTURE_NAMES: Object.freeze({ standing: 'Standing', seated: 'Seated', 'lying-up': 'Lying up' }),
  POSTURE_KEY: 'oortia-posture',   // global: the posture you last chose, used by every app that supports it
  RECENTER_ON_ENTER_MS: 450,
});

// ---------------------------------------------------------------------------------------------------------------
// standardChrome — menu + comfort + Pause, wired the standard way. Used by createOortiaApp and by the older kits.
//   o: { renderer, scene, camera, dolly, caps, title, hint, rows, sound, recenter, setBackdrop,
//        onBeforeEnter, onSessionStart, onSessionEnd, groundHit, onQuality,   (+ any other createXRMenu option)
//        comfort: an existing createComfort() instance (worlds that need comfort before the menu, e.g. for skyrise),
//        comfortRows: { movement, teleport, header } | false,      // comfort rows are appended after `rows`
//        pause: { get, set } (an app with its own game pause),  onPause: (paused) => {},
//        menu: { ...any other createXRMenu option } }
//   → { menu, comfort, paused (getter), setPaused(v), togglePause(), onPause(fn) }      (also reachable as menu.chrome)
// Pause = the comfort "calm" flag (comfort.paused) unless the app supplies its own; it is a session action, so it
// always starts un-paused (except with prefers-reduced-motion, where calm is the default).
export function standardChrome(o) {
  const { renderer, scene, camera, dolly, caps } = o;
  const comfort = o.comfort || createComfort({ renderer, scene, camera, dolly, groundHit: o.groundHit || null, onQuality: o.onQuality || null });
  const listeners = o.onPause ? [o.onPause] : [];
  const custom = o.pause && o.pause.get ? o.pause : null;
  let flag = comfort.reducedMotion ? !!comfort.paused : false, inSet = false;
  let menu = null;
  const fire = () => { for (const f of listeners) { try { f(C.paused); } catch (e) { console.error(e); } } if (menu) menu.refresh(); };
  // the comfort section's own "Pause world motion" row writes comfort.paused directly — route it through the same switch
  Object.defineProperty(comfort, 'paused', { configurable: true, get: () => flag, set: (v) => { v = !!v; if (v === flag) return; flag = v; if (!inSet) fire(); } });
  const C = {
    comfort,
    get paused() { return flag || (custom ? !!custom.get() : false); },
    // an app's own pause is tried first; when it does not apply (e.g. a game sitting on its title screen) the calm flag is used
    setPaused(v) {
      v = !!v; if (v === C.paused) return;
      inSet = true;
      try { if (custom) { custom.set(v); if (!!custom.get() !== v) comfort.paused = v; else if (!v) comfort.paused = false; } else comfort.paused = v; } finally { inSet = false; }
      fire();
    },
    togglePause() { C.setPaused(!C.paused); },
    onPause(f) { listeners.push(f); },
  };
  const rows = o.rows || [];                       // kept BY REFERENCE: callers may push more rows later (then menu.refresh())
  if (o.comfortRows !== false) rows.push(...comfort.rows({ movement: false, ...(o.comfortRows || {}) }));
  menu = createXRMenu({
    compactCommon: true, quitUrl: '../', ...o, ...(o.menu || {}),
    renderer, camera, dolly, caps, title: o.title || 'Oortia', rows, fade: comfort.fade,
    pause: { text: () => (C.paused ? 'Resume' : 'Pause'), active: () => C.paused, action: () => C.togglePause() },
  });
  comfort.attachMenu(menu);
  C.menu = menu; menu.chrome = C;
  return C;
}

// ---------------------------------------------------------------------------------------------------------------
// Head frame: the headset's position and directions in WORLD space, resolved NOW.
//   eye, forward (full 3D), up (top of the head), flat (level "ahead": when you look steeply up — lying on your back —
//   it is the way past the top of your head; steeply down, the opposite), yaw (of `flat`, 0 = −z, + = left).
const _q = new THREE.Quaternion();
export function headFrame(camera) {
  camera.updateWorldMatrix(true, false);
  const eye = camera.getWorldPosition(new THREE.Vector3());
  camera.getWorldQuaternion(_q);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(_q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(_q);
  const flat = forward.y > 0.7 ? up.clone() : forward.y < -0.7 ? up.clone().negate() : forward.clone();
  flat.y = 0; if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1); flat.normalize();
  return { eye, forward, up, flat, yaw: Math.atan2(-flat.x, -flat.z) };
}

export async function createOortiaApp(o = {}) {
  const id = o.id || 'app', title = o.title || 'Oortia';
  const cap = Object.assign({ locomotion: 'none', posture: ['seated'], passthrough: true, tools: false }, o.capabilities || {});
  const postures = cap.posture.filter((p) => STANDARD.EYE[p] !== undefined); if (!postures.length) postures.push('seated');
  const KEY = 'oortia-' + id + '-v1';
  let settings = {}; try { settings = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { /* private mode */ }

  const caps = await detectXR(); if (!cap.passthrough) caps.ar = false;
  const bg = new THREE.Color(o.background !== undefined ? o.background : 0x0b1238);
  const scene = new THREE.Scene(); scene.background = bg;
  const camera = new THREE.PerspectiveCamera(o.fov || 68, innerWidth / innerHeight, o.near || 0.05, o.far || 1200);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: caps.ar, powerPreference: 'high-performance' });
  if (caps.ar) renderer.setClearColor(0x000000, 0);
  const touch = createTouch({ canvas: renderer.domElement, look: false, stick: cap.locomotion === 'walk' });
  renderer.setPixelRatio(touch.pixelRatio(2)); renderer.setSize(innerWidth, innerHeight); renderer.xr.enabled = true;
  try { renderer.xr.setReferenceSpaceType('local-floor'); } catch (e) { /* older runtime */ }
  document.body.appendChild(renderer.domElement); renderer.domElement.style.touchAction = 'none';
  const fx = beautify(renderer, scene, camera, { tone: 'neutral', exposure: 1.0, bloom: touch.isTouch ? 0.18 : 0.3, radius: 0.45, threshold: 0.96, ...((typeof o.tone === 'function' ? o.tone(touch) : o.tone) || {}) });
  const dolly = new THREE.Group(); dolly.add(camera); scene.add(dolly);
  const world = new THREE.Group(); scene.add(world);
  const home = o.home === null ? null : Object.assign({ x: 0, y: 0, z: 0, yaw: 0 }, o.home || {});
  if (home) { dolly.position.set(home.x, home.y, home.z); dolly.rotation.y = home.yaw; }

  // ---------- posture ----------
  let posture = postures[0];
  try { const g = localStorage.getItem(STANDARD.POSTURE_KEY); if (postures.includes(g)) posture = g; } catch (e) { /* */ }
  if (/[?&]lie=1/.test(location.search) && postures.includes('lying-up')) posture = 'lying-up';
  const look = { yaw: 0, pitch: 0 };
  const flatPose = () => { look.yaw = 0; look.pitch = posture === 'lying-up' ? STANDARD.LIE_PITCH : (o.startPitch || 0); camera.position.set(0, STANDARD.EYE[posture], 0); };
  flatPose();

  const presses = [], releases = [], ticks = [], recenters = o.onRecenter ? [o.onRecenter] : [];
  const app = {
    THREE, id, title, scene, camera, renderer, dolly, world, touch, fx, caps, home, capabilities: cap, xr: false,
    menu: null, comfort: null, drift: null, kit: null, look,
    get posture() { return posture; }, get paused() { return chrome.paused; },
    store: (k, d) => (settings[k] !== undefined ? settings[k] : d),
    save: (k, v) => { settings[k] = v; try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* */ } },
    tick: (f, opt = {}) => ticks.push({ f, always: !!opt.always }),
    onPress: (f) => presses.push(f), onRelease: (f) => releases.push(f), onRecenter: (f) => recenters.push(f),
    headFrame: () => headFrame(camera),
  };

  // Place a group along the gaze (content for Lying up / reclined play): it faces you, its "up" follows the top of
  // your head when lying, and it then STAYS there — it never follows the head.
  app.placeAlongGaze = (group, metres = 2, { minElevationDeg = null } = {}) => {
    const f = headFrame(camera), dir = f.forward.clone();
    if (minElevationDeg !== null) {
      const el = THREE.MathUtils.degToRad(minElevationDeg);
      if (Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) < el) dir.copy(f.flat).multiplyScalar(Math.cos(el)).setY(Math.sin(el));
    }
    group.position.copy(f.eye).addScaledVector(dir, metres);
    group.up.copy(posture === 'lying-up' || Math.abs(dir.y) > 0.97 ? f.up : new THREE.Vector3(0, 1, 0));
    group.lookAt(f.eye); group.up.set(0, 1, 0); group.updateMatrixWorld(true);
  };

  // Recenter: the WORLD stays upright; the rig turns so that your level "ahead" is the home heading (and, with a home,
  // your head is back over it). Then apps re-place their content relative to the headset in onRecenter.
  app.recenter = () => {
    if (app.xr) {
      const f = headFrame(camera), to = home || f.eye;                 // no home: the head stays exactly where it is, only the heading resets
      dolly.rotation.y += (home ? home.yaw : 0) - f.yaw; dolly.updateMatrixWorld(true);
      const w = camera.getWorldPosition(new THREE.Vector3()); dolly.position.x += to.x - w.x; dolly.position.z += to.z - w.z; dolly.updateMatrixWorld(true);
    } else { flatPose(); applyLook(); }
    const f = headFrame(camera);
    for (const fn of recenters) fn(f, app);
  };
  app.setPosture = (p) => {
    if (!postures.includes(p)) return;
    posture = p; try { localStorage.setItem(STANDARD.POSTURE_KEY, p); } catch (e) { /* */ }
    if (!app.xr) flatPose();
    if (o.onPosture) o.onPosture(p);
    app.recenter(); if (app.menu) app.menu.refresh();
  };
  function applyLook() { if (!app.xr) { camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ'); camera.updateMatrixWorld(true); } }

  // ---------- drift (opt-in; starts stationary) ----------
  let drift = null;
  if (cap.locomotion === 'drift') {
    const { createDrift } = await import('./drift.js?v=drift5');
    // comfort is created just below; drift only reads it lazily through this proxy
    const lazyComfort = { fade: (...a) => app.comfort.fade(...a), speed: (b) => app.comfort.speed(b) };
    drift = app.drift = createDrift({ THREE, scene, camera, rig: dolly, comfort: lazyComfort, getMenu: () => app.menu, start: 'still', cap: STANDARD.DRIFT_CAP, ...(o.drift || {}) });
  }

  // ---------- menu: the app's tabs, then Motion (if any), then Comfort ----------
  const appTabs = (typeof o.tabs === 'function' ? o.tabs(app) : o.tabs) || [];
  const tabs = appTabs.map((t) => ({ name: t.name, rows: t.rows || [] }));
  if (drift) tabs.push({ name: 'Motion', rows: drift.rows() });
  const comfortTab = { name: 'Comfort', rows: [] }; tabs.push(comfortTab);
  if (postures.length > 1) comfortTab.rows.push({ label: 'Posture', cells: postures.map((p) => ({ text: STANDARD.POSTURE_NAMES[p], action: () => app.setPosture(p), active: () => posture === p })) });
  comfortTab.rows.push(...touch.rows());
  let tab = 0;
  const chrome = standardChrome({
    renderer, scene, camera, dolly, caps, title, hint: o.hint, sound: o.sound, groundHit: o.groundHit, onQuality: o.onQuality, onPause: o.onPause, pause: o.pause,
    comfortRows: false, ...(o.menu || {}),
    recenter: () => app.recenter(),
    setBackdrop: (v) => { world.visible = v; scene.background = v ? bg : null; },
    onBeforeEnter: o.onBeforeEnter,
    onSessionStart: () => { app.xr = true; camera.position.set(0, 0, 0); setTimeout(() => app.recenter(), STANDARD.RECENTER_ON_ENTER_MS); if (o.onXR) o.onXR(true); },
    onSessionEnd: () => { app.xr = false; flatPose(); app.recenter(); if (o.onXR) o.onXR(false); },
    rows: (app.menuRows = []),
  });
  // rows are filled after the chrome exists because the Comfort tab needs comfort.rows(); xrmenu keeps the array by reference
  const comfort = app.comfort = chrome.comfort, menu = app.menu = chrome.menu;
  comfortTab.rows.push(...comfort.rows({ movement: cap.locomotion !== 'none', teleport: !!o.groundHit, header: false }));
  app.menuRows.push(tabRow(tabs.map((t) => t.name), () => tab, (i) => { tab = i; }), ...tabs.flatMap((t, i) => inTab(t.rows, () => tab === i)));
  menu.refresh();
  app.setPaused = chrome.setPaused; app.togglePause = chrome.togglePause; app.onPause = chrome.onPause;
  touch.onChange = () => menu.refresh();

  if (cap.tools) { const { createToolkit } = await import('./xrtools.js?v=20261114f'); app.kit = createToolkit({ renderer, scene, dolly, camera, menu }); }

  // ---------- unified press / release: controller trigger, mouse, touch ----------
  const ndc = new THREE.Vector2(), raycaster = new THREE.Raycaster(), cv = renderer.domElement;
  const ctrlAims = menu.controllers.map((c, i) => ({ kind: 'ctrl', index: i, controller: c, ray: new THREE.Ray(), down: false }));
  const ptr = app.pointer = { kind: 'mouse', index: -1, controller: null, ray: new THREE.Ray(), down: false, inside: false, ndc };
  app.aims = [...ctrlAims, ptr];
  const ctrlRay = (a) => { a.controller.getWorldPosition(a.ray.origin); a.ray.direction.set(0, 0, -1).applyQuaternion(a.controller.getWorldQuaternion(_q)); };
  const ptrRay = () => { raycaster.setFromCamera(ndc, camera); ptr.ray.copy(raycaster.ray); };
  const press = (a) => { a.down = true; for (const f of presses) f(a); };
  const release = (a) => { if (!a.down) return; a.down = false; for (const f of releases) f(a); };
  menu.onSelectStart((c, hand, i) => { if (drift && drift.captureController(c)) return; ctrlRay(ctrlAims[i]); press(ctrlAims[i]); });
  menu.onSelectEnd((c, hand, i) => release(ctrlAims[i]));

  const dragActs = o.flatDrag === 'act';
  const fingers = new Map(); let lookFrom = null, dragged = false, downAt = null;
  const setNdc = (e) => ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    if (app.xr) return;
    if (o.onBeforeEnter) o.onBeforeEnter();                       // first gesture: let audio start
    fingers.set(e.pointerId, 1); try { cv.setPointerCapture(e.pointerId); } catch (er) { /* */ }
    ptr.kind = e.pointerType === 'touch' ? 'touch' : 'mouse'; ptr.inside = true; setNdc(e); dragged = false;
    downAt = { x: e.clientX, y: e.clientY };
    const wantLook = !dragActs || e.button === 2 || fingers.size >= 2;
    if (wantLook) { release(ptr); lookFrom = { x: e.clientX, y: e.clientY, yaw: look.yaw, pitch: look.pitch }; return; }
    ptrRay();
    if (drift && drift.armed) { drift.capture(null, ptr.ray.direction); return; }   // "Point to set": click where to go
    press(ptr);
  });
  cv.addEventListener('pointermove', (e) => {
    ptr.inside = true;
    if (lookFrom) {
      const dx = e.clientX - lookFrom.x, dy = e.clientY - lookFrom.y;
      if (!dragged && Math.hypot(dx, dy) > 8) dragged = true;
      if (dragged) { look.yaw = lookFrom.yaw + dx * 0.004; look.pitch = THREE.MathUtils.clamp(lookFrom.pitch + dy * 0.004, -1.3, 1.56); applyLook(); }
      return;
    }
    setNdc(e);
  });
  cv.addEventListener('pointerleave', () => { ptr.inside = false; });
  const end = (e) => {
    fingers.delete(e.pointerId);
    if (lookFrom && !dragActs && !dragged && downAt && !app.xr) {           // a click / tap without a drag = press + release
      ptrRay();
      if (drift && drift.armed) drift.capture(null, ptr.ray.direction); else { press(ptr); release(ptr); }
    }
    if (!fingers.size) lookFrom = null;
    release(ptr); downAt = null;
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  const keys = {}; addEventListener('keydown', (e) => { keys[e.code] = true; }); addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  // ---------- walk (opt-in): slow constant speed on the level, 30° snap turn ----------
  const _mv = new THREE.Vector3();
  function walk(dt) {
    let mx = 0, my = 0, tx = 0;
    if (app.xr) {
      for (const c of menu.controllers) {
        const gp = c.userData.src && c.userData.src.gamepad; if (!gp || gp.axes.length < 4 || c.userData.overMenu) continue;
        if (c.userData.hand === 'right') tx = gp.axes[2]; else { mx = gp.axes[2]; my = gp.axes[3]; }
      }
    } else {
      mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + touch.move.x; my = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0) + touch.move.y;
    }
    const turn = comfort.turnDelta(tx, dt); if (turn) rotateRigAboutHead(dolly, camera, turn);
    const mag = Math.hypot(mx, my); if (mag < 0.2 || comfort.settings.teleport) return 0;
    const sp = Math.min(STANDARD.WALK_CAP, comfort.speed(STANDARD.WALK_SPEED));       // constant: no ramps, no analog creep
    stickVector(camera, mx / mag, my / mag, _mv); dolly.position.addScaledVector(_mv, sp * dt);
    const lim = o.walk && o.walk.radius; if (lim) { const r = Math.hypot(dolly.position.x, dolly.position.z); if (r > lim) { dolly.position.x *= lim / r; dolly.position.z *= lim / r; } }
    if (o.walk && o.walk.groundAt) dolly.position.y = o.walk.groundAt(dolly.position.x, dolly.position.z);
    return sp;
  }

  // ---------- loop ----------
  const clock = new THREE.Clock(); let t = 0;
  app.start = () => {
    const ld = document.getElementById('loading'); if (ld) ld.style.display = 'none';
    app.recenter();
    const frame = (force) => {
      const rdt = force || Math.min(clock.getDelta(), 0.05), paused = chrome.paused, dt = paused ? 0 : rdt; t += dt;
      if (!app.xr) {
        const k = rdt * 1.2;
        if (keys.ArrowLeft) look.yaw += k; if (keys.ArrowRight) look.yaw -= k;
        if (keys.ArrowUp) look.pitch = Math.min(1.56, look.pitch + k); if (keys.ArrowDown) look.pitch = Math.max(-1.3, look.pitch - k);
        applyLook();
      }
      let moving = 0;
      if (cap.locomotion === 'walk' && !paused) moving = walk(rdt);
      if (drift) moving = drift.update(rdt, { paused }) || 0;
      menu.update();
      for (const a of ctrlAims) if (app.xr && a.controller.userData.src) ctrlRay(a);
      if (!app.xr) ptrRay();
      if (app.kit) app.kit.update(dt);
      for (const k of ticks) k.f(k.always ? rdt : dt, t);
      comfort.update(rdt, { moving });
      fx.render();
    };
    app._frame = frame;                                   // #debug: step frames by hand (the preview pane throttles rAF)
    renderer.setAnimationLoop(() => frame());
  };
  if (location.hash.includes('debug')) window.__app = app;
  return app;
}
