// ============================ Tabletop Command — a VR-first 3D real-time strategy game (Oortia) ============================
// The battlefield is a living diorama on a table. In VR you reach out and select units, or command them through a
// mini map held on your controller. On desktop it is a classic RTS (box select, right-click orders); on phones it is touch.
// Simulation: rts/sim.js (fixed 20 Hz, deterministic, headless-testable). Rendering: rts/gfx.js. Controller: rts/ctrl.js.
import * as THREE from 'three';
import { detectXR, headFrame, standardChrome, sectionRow, toggleRow, stepperRow, choiceGrid, buttonRow, tabRow, inTab } from '../shared/app.js?v=app3';
import { createComfort } from '../shared/app.js?v=app3';
import { createTouch } from '../shared/touch.js?v=20261114f';
import { beautify } from '../shared/beauty.js?v=20261114f';
import { createSim, DT, UT, BT, N } from './sim.js?v=rts6';
import { createAI } from './ai.js?v=rts6';
import { createView, CELL } from './gfx.js?v=rts6';
import { createMini } from './mini.js?v=rts6';
import { createCtrl } from './ctrl.js?v=rts6';
import { createHud } from './hud.js?v=rts6';
import { createDesk } from './desk.js?v=rts6';
import { createSfx } from './sfx.js?v=rts6';
import { createVR } from './vr.js?v=rts6';
import { createTutorial } from './tutorial.js?v=rts6';

const KEY = 'oortia-rts-v1';
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FEAT = { ai: true, tutorial: true, vr: true };
const SEEDS = [7, 12, 21, 3, 33, 18, 27, 9, 36, 15, 24, 30];

const P = { diff: 'normal', sound: true, selMode: 'box', miniMode: 'send', ...JSON.parse((() => { try { return localStorage.getItem(KEY) || '{}'; } catch (e) { return '{}'; } })()) };
const saveP = () => { try { localStorage.setItem(KEY, JSON.stringify({ diff: P.diff, sound: P.sound, selMode: P.selMode, miniMode: P.miniMode })); } catch (e) { /* private mode */ } };

const G = { S: null, view: null, mini: null, ai: null, phase: 'title', paused: false, tutorial: null, seed: 7, acc: 0, over: false };
let renderer, scene, camera, dolly, fx, menu, comfort, touch, caps, sfx, C, hud, desk, vr, tut, floor, stand, clock = new THREE.Clock(), xr = false;
const T = { x: 0, y: 0.85, z: -2.1, yaw: 0, scale: 1, q: null, A: new THREE.Vector3(0, 0.85, -1.2), base: null, mode: 'level', off: { dist: 0, h: 0 } };          // table placement (world metres); scale steps are faded, never smooth
const SCALE_STEPS = [0.25, 0.5, 1, 1.6, 2.5, 4, 8];
try { Object.assign(T.off, JSON.parse(localStorage.getItem('oortia-rts-table') || '{}')); } catch (e) { /* private mode */ }

Promise.resolve().then(async () => { caps = await detectXR(); await init(); }).catch((e) => { console.error(e); const s = $('status'); if (s) s.textContent = 'Could not start: ' + e.message; });

async function init() {
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x8fb2d8);
  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.02, 160);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: caps.ar, powerPreference: 'high-performance' });
  if (caps.ar) renderer.setClearColor(0x000000, 0);
  touch = createTouch({ canvas: renderer.domElement, look: false });
  renderer.setPixelRatio(touch.pixelRatio(2)); renderer.setSize(innerWidth, innerHeight);
  renderer.xr.enabled = true; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement); renderer.domElement.style.touchAction = 'none';
  fx = beautify(renderer, scene, camera, { tone: 'neutral', exposure: 1.0, bloom: touch.isTouch ? 0.12 : 0.2, radius: 0.4, threshold: 0.97 });
  dolly = new THREE.Group(); dolly.add(camera); scene.add(dolly);
  buildRoom();
  sfx = createSfx(); sfx.set(P.sound);
  C = createCtrl({ G, sfx });
  C.selMode = P.selMode; C.miniMode = P.miniMode;
  const miniProxy = new Proxy({}, { get: (_, k) => G.mini[k] });
  hud = createHud({ C, mini: miniProxy, getS: () => G.S, touchDevice: touch.isTouch, onAction: (a) => { if (a === 'pause') togglePause(); else if (a === 'skipStep') tut.skip(); } });
  desk = createDesk({ canvas: renderer.domElement, camera, getView: () => G.view, getS: () => G.S, C, hud, mini: () => G.mini, isActive: () => G.phase === 'play' && !xr && !G.paused, isTouch: touch.isTouch, onMenu: () => menu.toggle(), onPause: togglePause });
  C.onCenter = (x, z) => { if (xr) vrJump(x, z); else desk.center(x, z); };
  C.onToast = (t, k) => { hud.toast(t, k); if (vr) vr.toast(t, k); };

  tut = createTutorial({ G, C, hud, getVR: () => vr, isTouch: touch.isTouch, isXR: () => xr, showScreen, newMatch, showTitle });
  comfort = createComfort({ renderer, scene, camera, dolly, onQuality: (q) => { if (G.view) G.view.setQuality(q); } });
  comfort.paused = false;
  menu = standardChrome({ comfort, scene, comfortRows: false, compactCommon: false, pause: { get: () => !!G.paused, set: (v) => { if (!!G.paused !== v) togglePause(); } },   // the app standard: Pause first, then Recenter / Menu style / Quit (STANDARD.md)
    renderer, camera, dolly, caps, title: 'Tabletop Command',
    hint: 'Desktop: drag to box-select, right-click to command, WASD pan, wheel zoom. Phone: tap to select, drag to box-select, two fingers pan & zoom.',
    rows: menuRows(),
    sound: { get: () => P.sound, set: (v) => { P.sound = v; sfx.set(v); saveP(); } },
    fade: comfort.fade, recenter: () => { if (xr) placeFromHead(); },
    setBackdrop: (v) => { floor.visible = v && !(xr && T.scale >= 4); scene.background = v ? new THREE.Color(0x8fb2d8) : null; },
    onBeforeEnter: () => sfx.ensure(),
    onSessionStart: () => { xr = true; hud.setVR(true); document.body.classList.add('rts-vr'); onXRStart(); },
    onSessionEnd: () => { xr = false; hud.setVR(false); document.body.classList.remove('rts-vr'); onXREnd(); },
    quitUrl: '../',
  }).menu;
  vr = createVR({ renderer, scene, camera, dolly, menu, comfort, sfx, C, getView: () => G.view, getS: () => G.S, getMini: () => G.mini, T, SCALE_STEPS, placeBoard, placeTable: () => placeFromHead(), isXR: () => xr, G, onReady: () => { menu.refresh(); if (G.screenSpec) showScreen(G.screenSpec); } });
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
  addEventListener('pointerdown', () => sfx.ensure(), { once: true });
  addEventListener('keydown', () => sfx.ensure(), { once: true });
  $('loading').style.display = 'none';
  newMatch({ idle: true, diff: P.diff });
  showTitle();
  renderer.setAnimationLoop(frame);
  if (location.hash === '#debug') Object.assign(window, { G, C, THREE, desk, hud, T, tut, __vr: { vr, menu, camera, dolly, renderer, tableStep, setXR: (v) => { xr = v; document.body.classList.toggle('rts-vr', v); v ? onXRStart() : onXREnd(); } } });
}

// ---------------------------------------------------------------- room: floor, pedestal
function buildRoom() {
  floor = new THREE.Group();
  const f = new THREE.Mesh(new THREE.CircleGeometry(14, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x59655f, roughness: 0.95 }));
  f.receiveShadow = true; floor.add(f);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.62, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.5, toneMapped: false }));
  ring.position.set(0, 0.004, 0); floor.add(ring);                                    // "stand here" marker (the clear-space reminder points at it)
  stand = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 0.8, 16), new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.8 }));
  stand.castShadow = true; floor.add(stand);
  scene.add(floor);
}
function placeBoard() {
  if (!G.view) return;
  G.view.setBoard(new THREE.Vector3(T.x, T.y, T.z), T.yaw, T.scale, T.q);
  floor.visible = !(xr && T.scale >= 4);
  const pillar = !T.q && T.scale <= 1.7 && T.y > 0.6;          // the pedestal only makes sense for a level table well above the floor
  stand.visible = pillar; stand.position.set(T.x, (T.y - 0.5) / 2, T.z); stand.scale.set(1, (T.y - 0.5) / 0.8, 1);
}
const _Y = new THREE.Vector3(0, 1, 0);
T.fullQ = () => { const q = new THREE.Quaternion().setFromAxisAngle(_Y, T.yaw); return T.q ? T.q.clone().multiply(q) : q; };
T.placeSo = (P, A) => {                                          // move the board so map point P (cells) sits at world point A
  const k = CELL * T.scale, h = G.S.map.heightAt(clamp(P.x, 0, N - 0.01), clamp(P.z, 0, N - 0.01));
  const v = new THREE.Vector3((P.x - N / 2) * k, h * k, (P.z - N / 2) * k).applyQuaternion(T.fullQ());
  T.x = A.x - v.x; T.y = A.y - v.y; T.z = A.z - v.z;
};
// Table placement follows the BODY: relative to the headset's current pose (seated, standing or lying), never a fixed floor height.
function placeFromHead() {
  camera.updateMatrixWorld(true);
  const f = headFrame(camera), eye = f.eye.clone(), fl = new THREE.Vector3(f.flat.x, 0, f.flat.z);
  if (fl.lengthSq() < 1e-6) fl.set(0, 0, -1); fl.normalize();
  const over = f.forward.y > 0.57, wasOver = T.mode === 'over';           // looking up past ~35 deg: overhead slab
  if (over) {
    T.mode = 'over'; if (T.scale > 0.5 || !wasOver) T.scale = 0.25;
    const n = f.forward.clone().negate(), u = f.up.clone(), z = u.sub(n.clone().multiplyScalar(u.dot(n))).negate();
    if (z.lengthSq() < 1e-6) z.copy(fl).negate(); z.normalize();
    const x = new THREE.Vector3().crossVectors(n, z).normalize();
    T.q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, n, z)); T.yaw = 0;
    const c = eye.addScaledVector(f.forward, 0.55 + T.off.dist).addScaledVector(f.up, T.off.h);
    T.A.copy(c); T.x = c.x; T.y = c.y; T.z = c.z;
  } else {
    T.mode = 'level'; if (T.scale >= 4 || wasOver) T.scale = 1; T.q = null; T.yaw = f.yaw;
    const near = 0.5 + T.off.dist, y = eye.y - 0.42 + T.off.h, c = eye.clone().addScaledVector(fl, near + 1.8 * T.scale);
    T.x = c.x; T.y = y; T.z = c.z; T.A.copy(eye).addScaledVector(fl, 0.8 + T.off.dist); T.A.y = y;
  }
  T.base = { q: T.q, A: T.A.clone() };
  placeBoard(); if (vr) { vr.scaleIdx = null; vr.placeStrip(); vr.dirty = true; }
}
T.placeFromHead = placeFromHead;

// ---------------------------------------------------------------- match lifecycle
function newMatch({ idle = false, diff = P.diff, tutorial = false, seed = null } = {}) {
  if (G.view) G.view.dispose();
  G.seed = tutorial ? 7 : (seed || SEEDS[Math.floor(Math.random() * SEEDS.length)]);
  if (tut) tut.stop();
  const S = createSim({ seed: G.seed * 13 + 1, mapSeed: G.seed, startOre: tutorial ? 200 : 250, teams: tutorial ? 1 : 2 });
  G.S = S; G.diff = diff; G.over = false; G.acc = 0; G.paused = false;
  G.ai = (FEAT.ai && !tutorial && !idle) ? createAI(S, 1, diff) : null;
  if (!G.ai && !tutorial) skirmishSquad(S);
  G.view = createView({ scene, S, renderer, quality: touch.isTouch ? 'low' : 'high' });
  G.mini = createMini(S);
  C.onEvent = null; C.sel.clear(); C.groups.forEach((g) => (g.length = 0)); C.cancelModes(); C.alert = null; C.rev++;
  placeBoard();
  desk.frame(0); desk.apply();
  G.phase = idle ? 'title' : 'play';
  if (!idle) showScreen(null);
  if (!idle && !tutorial) { const n = S.nearestNode(S.startPos(0).x, S.startPos(0).z); if (n) S.cmd(0, { t: 'gather', ids: S.units(0).map((u) => u.id), node: n.id }); }
  if (tutorial && !idle) tut.start();
  S.updateVision();
}
function skirmishSquad(S) {          // used while no AI: a defending enemy squad so there is something to fight
  const h = S.get(S.team[1].hq);
  [['infantry', -4, 5], ['infantry', -2.8, 5.4], ['infantry', -1.5, 5.6], ['ranged', -3.4, 6.6], ['ranged', -2, 6.8], ['scout', 0, 6]].forEach(([t, dx, dz]) => S.spawnUnit(1, t, h.x + dx, h.z + dz));
}
function togglePause() { if (G.phase !== 'play') return; G.paused = !G.paused; if (G.paused) showPause(); else showScreen(null); menu.refresh(); }
function showTitle() {
  G.phase = 'title';
  showScreen({
    title: 'Tabletop Command', lines: ['A real-time strategy game played on a table. In VR you reach into the diorama; on desktop and phone it is a classic RTS.', 'Gather crystals, build an army, destroy the red Citadel.'],
    html: `<div class="row">${['easy', 'normal', 'hard'].map((d) => `<button data-diff="${d}" class="${P.diff === d ? 'on' : ''}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('')}</div>
      <ul><li><b>Desktop</b>: left-drag box select · right-click move / attack / gather · WASD pan · wheel zoom · Q/E rotate · 1-9 groups</li>
      <li><b>Phone</b>: tap to select &amp; command · drag a box · two fingers pan, pinch, twist · tap the mini map</li>
      <li><b>VR</b>: Enter VR (top right), clear about 2 m of floor, stand at the table edge</li></ul>`,
    buttons: [{ text: 'Start match', big: true, action: () => newMatch({ diff: P.diff }) }].concat(FEAT.tutorial ? [{ text: 'Tutorial', big: true, action: () => startTutorial() }] : []),
    vrRows: [['easy', 'normal', 'hard'].map((d) => ({ text: d[0].toUpperCase() + d.slice(1), on: P.diff === d, action: () => { P.diff = d; saveP(); showTitle(); } })), [{ text: 'Start match', big: true, action: () => newMatch({ diff: P.diff }) }].concat(FEAT.tutorial ? [{ text: 'Tutorial', action: () => startTutorial() }] : [])],
    foot: 'Menu (☰) has pause, difficulty, formations, table controls and comfort settings.',
  });
  document.querySelectorAll('#rts-screen [data-diff]').forEach((b) => b.addEventListener('click', () => { P.diff = b.dataset.diff; saveP(); showTitle(); menu.refresh(); }));
}
function showPause() {
  showScreen({ title: 'Paused', lines: ['Everything is frozen.'], buttons: [{ text: 'Resume', big: true, action: togglePause }, { text: 'Restart', action: () => newMatch({ diff: P.diff }) }, { text: 'Main menu', action: () => { newMatch({ idle: true }); showTitle(); } }] });
}
function showOver() {
  const S = G.S, won = S.winner === 0, t = S.team[0], m = Math.floor(S.time / 60), s = String(Math.floor(S.time % 60)).padStart(2, '0');
  won ? sfx.win() : sfx.lose();
  showScreen({ title: won ? 'Victory' : 'Defeat', lines: [won ? 'The red Citadel has fallen.' : 'Your Citadel has fallen.', `Time ${m}:${s} · Enemy units defeated ${t.kills} · Units lost ${t.lost} · Ore gathered ${Math.floor(t.mined)}`], buttons: [{ text: 'Play again', big: true, action: () => newMatch({ diff: P.diff }) }, { text: 'Main menu', action: () => { newMatch({ idle: true }); showTitle(); } }] });
}
function showScreen(spec) { G.screenSpec = spec; hud.screen(spec); if (vr) vr.showSpec(spec); }
function startTutorial() { newMatch({ tutorial: true }); }

// ---------------------------------------------------------------- menu rows
function menuRows() {
  const inXR = () => renderer.xr.isPresenting;
  const sel = () => C.units().length > 0;
  return [
    sectionRow('Match'),
    { visible: () => tut.on, cells: [{ text: 'Tutorial: skip step', action: () => tut.skip() }] },
    { cells: [{ text: () => (G.paused ? 'Resume' : 'Pause'), action: togglePause, tone: 'accent', active: () => G.paused }, { text: 'New match', action: () => newMatch({ diff: P.diff }) }, { text: 'Tutorial', action: startTutorial, visible: () => FEAT.tutorial }] },
    { label: 'Difficulty', cells: ['easy', 'normal', 'hard'].map((d) => ({ text: d[0].toUpperCase() + d.slice(1), active: () => P.diff === d, action: () => { P.diff = d; saveP(); } })) },
    sectionRow('Orders'),
    { label: 'Formation', cells: [['Box', 'box'], ['Line', 'line'], ['Wedge', 'wedge']].map(([t, v]) => ({ text: t, active: () => C.formation === v, action: () => C.setFormation(v) })) },
    { label: 'Stance', cells: [['Aggressive', 'aggro'], ['Guard', 'defend'], ['Hold', 'hold']].map(([t, v]) => ({ text: t, active: () => C.stance === v, action: () => C.setStance(v) })) },
    { cells: [{ text: 'Stop', action: () => C.stop() }, { text: () => (C.amoveArmed ? 'Attack-move ✓' : 'Attack-move'), action: () => C.armAttackMove(!C.amoveArmed), active: () => C.amoveArmed }, { text: 'Select army', action: () => C.selectArmy() }, { text: 'Idle workers', action: () => C.selectIdleWorkers() }] },
    sectionRow('Train and build'),
    { cells: [{ text: 'Worker', action: () => C.train('worker') }, { text: 'Infantry', action: () => C.train('infantry') }, { text: 'Archer', action: () => C.train('ranged') }] },
    { cells: [{ text: 'Rider', action: () => C.train('scout') }, { text: 'Catapult', action: () => C.train('siege') }] },
    { cells: [{ text: 'Build Depot', action: () => C.beginBuild('depot') }, { text: 'Build Barracks', action: () => C.beginBuild('barracks') }] },
    { label: 'Select (VR)', visible: inXR, cells: [['Box', 'box'], ['Lasso', 'lasso']].map(([t, v]) => ({ text: t, active: () => C.selMode === v, action: () => { C.selMode = v; P.selMode = v; saveP(); } })) },
    { label: 'Map hand (VR)', visible: inXR, cells: [['Left', 'left'], ['Right', 'right']].map(([t, v]) => ({ text: t, active: () => vr.hand === v, action: () => { vr.hand = v; } })) },
    { label: 'Map click (VR)', visible: inXR, cells: [['Send units', 'send'], ['Jump view', 'view']].map(([t, v]) => ({ text: t, active: () => C.miniMode === v, action: () => { C.miniMode = v; P.miniMode = v; saveP(); } })) },
    sectionRow('Table'),
    { label: 'Rotate', visible: inXR, cells: [{ text: '◀ 45°', action: () => tableStep('rot', -1) }, { text: '45° ▶', action: () => tableStep('rot', 1) }] },
    { label: 'Distance', visible: inXR, cells: [{ text: 'Closer', action: () => tableStep('dist', -1) }, { text: 'Farther', action: () => tableStep('dist', 1) }] },
    { label: 'Height', visible: inXR, cells: [{ text: 'Lower', action: () => tableStep('h', -1) }, { text: 'Higher', action: () => tableStep('h', 1) }] },
    { label: 'Scale', visible: inXR, cells: [{ text: 'Smaller', action: () => tableStep('s', -1) }, { text: () => '×' + T.scale, active: () => false }, { text: 'Larger', action: () => tableStep('s', 1) }] },
    { visible: inXR, cells: [{ text: 'Re-place table to my pose (or hold right stick-click)', action: () => tableStep('home', 0), tone: 'accent', w: 2 }] },
    ...comfort.rows({ movement: false }),
  ];
}

// ---------------------------------------------------------------- VR table handling (all changes are stepped + faded)
function tableStep(kind, dir) {
  if (kind === 's') { vr.scaleStep(dir); return; }
  const apply = () => {
    if (kind === 'rot') T.yaw += dir * Math.PI / 4;
    else if (kind === 'home') { placeFromHead(); return; }
    else {
      if (kind === 'dist') T.off.dist = clamp(T.off.dist + dir * 0.05, -0.3, 0.7); else if (kind === 'h') T.off.h = clamp(T.off.h + dir * 0.05, -0.3, 0.4);
      try { localStorage.setItem('oortia-rts-table', JSON.stringify(T.off)); } catch (e) { /* private mode */ }
      placeFromHead(); return;
    }
    placeBoard(); vr.placeStrip();
  };
  if (renderer.xr.isPresenting) comfort.fade(apply); else apply();
}
function vrJump(x, z) { vr.jumpTo(x, z); }
function resetTable() { T.x = 0; T.z = -2.1; T.y = 0.85; T.scale = 1; T.yaw = 0; T.q = null; T.mode = 'level'; T.base = null; T.A.set(0, 0.85, -1.2); }
function onXRStart() { sfx.ensure(); resetTable(); placeBoard(); vr.enter(); }          // vr.enter() auto-places the table from the headset pose a few frames later
function onXREnd() { vr.exit(); resetTable(); placeBoard(); if (G.screenSpec) hud.screen(G.screenSpec); }

// ---------------------------------------------------------------- frame
const evBuf = [];
function frame() {
  const dt = Math.min(0.1, clock.getDelta()), S = G.S;
  if (!S) return;
  const running = G.phase === 'play' && !G.paused && !comfort.paused && (!xr || vr.ready);
  if (running) {
    G.acc += dt;
    let steps = 0;
    while (G.acc >= DT && steps < 4) { S.step(); steps++; G.acc -= DT; for (const e of S.ev) evBuf.push(e); S.ev.length = 0; }
    if (steps === 4) G.acc = 0;
  } else { S.ev.length = 0; }
  if (evBuf.length) { C.handleEvents(evBuf); G.view.handleEvents(evBuf, { calm: comfort.reducedMotion }); evBuf.length = 0; }
  if (S.over && G.phase === 'play') { G.phase = 'over'; showOver(); }
  C.prune();
  tut.update(dt);
  if (!xr) { desk.update(dt); desk.apply(); } else { if (menu) menu.update(); vr.update(dt); }   // menu first: it resets ray lengths and flags rays on the menu
  G.view.update(dt, performance.now() / 1000, camera, { selected: C.sel, team: 0, calm: G.paused || comfort.paused || comfort.reducedMotion, hoverId: C.hoverId });
  if (!xr) hud.update({ paused: G.paused, viewPoly: G.phase === 'play' ? desk.viewPoly() : null });
  if (menu && !xr) menu.update();
  comfort.update(dt, { moving: 0 });
  fx.render();
}
