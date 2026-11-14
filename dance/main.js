// ============================ Dance — a standing VR dance-along (Oortia) ============================
// A dancer performs a routine on a stage; you copy it with both controllers. Hand and head positions are compared on every
// scored beat. Desktop: watch & learn, plus a mouse/keyboard approximation to test the scoring loop. Phone: watch & learn.
import * as THREE from 'three';
import { detectXR, standardChrome, sectionRow, toggleRow, stepperRow, choiceGrid, inTab } from '../shared/app.js?v=app2';
import { createComfort } from '../shared/app.js?v=app2';
import { createTouch } from '../shared/touch.js?v=20261114f';
import { beautify } from '../shared/beauty.js?v=20261114f';
import { ROUTINES, compileRoutine, samplePose, nextScoredIndex } from './routines.js?v=20261118b';
import * as G from './game.js?v=20261118b';
import { createMusic } from './music.js?v=20261118b';
import { createFigure } from './figure.js?v=20261118b';
import { createStage, createSparkles } from './stage.js?v=20261118b';
import { createUI, createWallHud, createNextStrip } from './ui.js?v=20261118b';
import { createSchool } from './school.js?v=20261118b';
import { createSongLibrary } from './songs.js?v=20261118b';

const KEY = 'oortia-dance-v1';
const TINT = { L: 0x3fd8ff, R: 0xff6fb0 };
const COMP = Object.fromEntries(Object.entries(ROUTINES).map(([k, r]) => [k, compileRoutine(r)]));
const DANCER_Z = -2.5;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const GRADE_COL = { perfect: '#ffd24a', good: '#6fe6ff', ok: '#b9c3ff', miss: '#ff7a8a' };

// ---------- settings ----------
const S = { soloModel: 'female', leadModel: 'male', followModel: 'female', routine: 'easy', mirror: true, speed: 1, volume: 0.7, practice: null, offsetMs: 0, sound: true, view: 3.9 };
try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* private mode */ }
S.practice = null;
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ soloModel: S.soloModel, leadModel: S.leadModel, followModel: S.followModel, routine: S.routine, mirror: S.mirror, speed: S.speed, volume: S.volume, offsetMs: S.offsetMs })); } catch (e) { /* ignore */ } };

// ---------- globals ----------
let renderer, scene, camera, dolly, fx, menu, comfort, touch, caps, music, stage, ui, wallHud, strip, sparkles;
let fig, figM, school, schoolOn = false, lib;
const soloSong = {};
let mode = 'watch';                 // 'watch' | 'play' | 'xr'
let state = 'title';                // title safety calibrate select countdown dance paused resuming results
let calib = G.defaultCalib();
let compiled = COMP.easy, scorer = null, scoring = false, loopInfo = null;
let t = 0, lastBeat = 0, pausedByMenu = false, resumeT = 0, hudPop = { text: '', color: '#fff', t: -9 }, calibState = { prog: 0, why: '', ema: null };
let sampler = null;                 // test hook: (out) => player sample
const clock = new THREE.Clock();
const tmpPos = { L: [0, 0, 0], R: [0, 0, 0], head: [0, 0, 0] };
const sample = { L: [0.2, -0.95, 0], R: [0.2, -0.95, 0], drop: 0, lx: 0, lz: 0 };
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const orbit = { yaw: 0, pitch: 0.12, dist: 3.9 };
const mouse = { x: 0, y: 0, down: false, depth: 0.3, active: 'R', keys: new Set(), drag: null };
const ghosts = [], hands = [], pops = [];
let ghostGroup;

// ---------- boot ----------
Promise.resolve().then(async () => { caps = await detectXR(); await init(); }).catch((e) => { console.error(e); const s = $('status'); if (s) s.textContent = 'Could not start: ' + e.message; });

async function init() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.05, 600);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: caps.ar, powerPreference: 'high-performance' });
  if (caps.ar) renderer.setClearColor(0x000000, 0);
  touch = createTouch({ canvas: renderer.domElement, look: true, onLook: (dx, dy) => { if (mode !== 'xr') { orbit.yaw -= dx * 0.006; orbit.pitch = clamp(orbit.pitch + dy * 0.004, -0.15, 0.9); } } });
  renderer.setPixelRatio(touch.pixelRatio(2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = 'none';
  const tier0 = touch.isTouch ? 'light' : 'high';
  fx = beautify(renderer, scene, camera, { tone: 'aces', exposure: 0.95, bloom: touch.isTouch ? 0.28 : 0.42, radius: 0.5, threshold: 0.78 });

  dolly = new THREE.Group(); dolly.add(camera); scene.add(dolly);
  stage = createStage({ THREE, scene, renderer, tier: tier0 });
  music = createMusic();
  lib = createSongLibrary({ music }); lib.init();
  buildDancers();
  buildGuides();
  ui = createUI(THREE, { onAction });
  scene.add(ui.board);
  wallHud = createWallHud(THREE); scene.add(wallHud.mesh);
  strip = createNextStrip(THREE); scene.add(strip.mesh); strip.mesh.visible = false;
  sparkles = createSparkles(THREE); scene.add(sparkles.points);

  school = createSchool({
    THREE, scene, camera, dolly, music, ui, stage, lib, models: () => ({ lead: S.leadModel, follow: S.followModel }), onModels: (mm) => { S.leadModel = mm.lead; S.followModel = mm.follow; save(); }, isXR: () => !!window.__fakeXR || renderer.xr.isPresenting, menu: () => menu,
    show: (spec) => { ui.show(spec); }, hideScreen: () => ui.hide(),
    hands: () => { const out = [null, null]; for (let i = 0; i < 2; i++) { const h = menu.controllers[i].userData.hand; if (!menu.controllers[i].userData.src) continue; menu.grips[i].getWorldPosition(_w); const p = [_w.x, _w.y, _w.z]; if (h === 'right') out[0] = p; else if (h === 'left') out[1] = p; } return out; },
    handController: (pi) => { for (let i = 0; i < 2; i++) { const h = menu.controllers[i].userData.hand; if ((pi === 0 && h === 'right') || (pi === 1 && h === 'left')) return i; } return 0; },
    buzz: (i, v, ms) => buzz(i, v, ms), onExit: () => { schoolOn = false; stopRun(); mode = renderer.xr.isPresenting ? 'xr' : 'watch'; goto(mode === 'xr' ? 'home' : 'title'); },
  });
  comfort = createComfort({ renderer, scene, camera, dolly, onQuality: (q) => { if (renderer.xr.isPresenting) stage.setTier(q >= 1 ? 'light' : 'medium'); } });
  menu = standardChrome({ comfort, scene, comfortRows: false, compactCommon: false, pause: { get: () => state === 'paused', set: (v) => { if (v) pause(); else resume(); } },   // the app standard: Pause first, then Recenter / Menu style / Quit (STANDARD.md)
    renderer, camera, dolly, caps, title: 'Dance',
    hint: 'Copy the dancer on every beat. Menu: routine, mirror, speed, practice one move, pause or quit. Desktop play: mouse = hands · Space swap hand · Shift/Alt freeze a hand · wheel = depth · arrows, S, Z, X = poses.',
    rows: [
      sectionRow('Routine'),
      { label: 'Solo dancer', cells: [['Man', 'male'], ['Woman', 'female']].map(([t, v]) => ({ text: t, active: () => S.soloModel === v, action: () => { S.soloModel = v; save(); buildDancers(); menu.refresh(); } })) },
      ...choiceGrid([['Easy', 'easy'], ['Medium', 'medium'], ['Hard', 'hard']], () => S.routine, (id) => setRoutine(id), 3),
      toggleRow('Mirror', () => S.mirror, (v) => { S.mirror = v; save(); onSettingChanged(); }),
      { label: 'Speed', cells: [['75 %', 0.75], ['100 %', 1]].map(([tx, v]) => ({ text: tx, active: () => S.speed === v, action: () => { S.speed = v; save(); onSettingChanged(); } })) },
      stepperRow('Song', () => songText(), () => cycleSong(-1), () => cycleSong(1)),
      stepperRow('Volume', () => Math.round(S.volume * 100) + ' %', () => vol(-0.1), () => vol(0.1), { repeat: true }),
      stepperRow('Practice', () => S.practice || 'Off', () => cyclePractice(-1), () => cyclePractice(1)),
      stepperRow('Timing', () => (S.offsetMs > 0 ? '+' : '') + S.offsetMs + ' ms', () => { S.offsetMs -= 10; music.offsetMs(S.offsetMs); save(); }, () => { S.offsetMs += 10; music.offsetMs(S.offsetMs); save(); }, { repeat: true }),
      stepperRow('View', () => S.view.toFixed(1) + ' m', () => { S.view = clamp(S.view - 0.4, 1.8, 9); orbit.dist = S.view; }, () => { S.view = clamp(S.view + 0.4, 1.8, 9); orbit.dist = S.view; }, { repeat: true }),
      { cells: [{ text: () => (state === 'paused' ? 'Resume' : 'Pause'), action: togglePause, tone: 'accent' }, { text: 'Restart', action: () => startRun() }, { text: 'Routines', action: () => { stopRun(); goto('select'); } }] },
      ...school.rows(inTab, choiceGrid, toggleRow),
      ...comfort.rows({ movement: false }),
    ],
    sound: { get: () => S.sound, set: (v) => { S.sound = v; music.setSound(v); } },
    fade: comfort.fade,
    setBackdrop: (v) => { stage.root.visible = v; scene.background = v ? new THREE.Color(0x070918) : null; },
    recenter: recenterBody,
    onBeforeEnter: () => music.ensure(),
    onSessionStart: onXRStart, onSessionEnd: onXREnd,
    quitUrl: '../',
  }).menu;
  music.setVolume(S.volume); music.offsetMs(S.offsetMs);
  menu.onSelectStart((c) => { if (mode === 'xr' && ui.visible()) { const p = pickFrom(c); if (p && p.id) { menu.hapticPulse(c); onAction(p.id); } } });

  addEventListener('resize', onResize);
  initInput();
  document.addEventListener('visibilitychange', () => { if (document.hidden && !window.__noVisPause && (state === 'dance' || state === 'countdown')) pause(); });
  renderer.xr.addEventListener('sessionstart', () => { const ses = renderer.xr.getSession(); ses.addEventListener('visibilitychange', () => { if (ses.visibilityState !== 'visible' && (state === 'dance' || state === 'countdown')) pause(); }); });
  if (location.hash.includes('debug')) exposeDebug();
  onResize(); applyTier();
  goto('title');
  const loading = $('loading'); if (loading) loading.remove();
  renderer.setAnimationLoop(() => animate());
}

// ---------- dancers & guides ----------
function buildDancers() {
  if (fig) { scene.remove(fig.root); stage.mirror.remove(figM.root); }
  fig = createFigure(THREE, { tintL: TINT.L, tintR: TINT.R, body: S.soloModel });
  fig.root.position.set(0, 0, DANCER_Z); scene.add(fig.root);
  fig.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  figM = createFigure(THREE, { tintL: TINT.L, tintR: TINT.R, basic: true, body: S.soloModel });
  figM.root.position.set(0, 0, DANCER_Z); stage.mirror.add(figM.root);
}
function glowTex() { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.45, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); }
function buildGuides() {
  ghostGroup = new THREE.Group(); dolly.add(ghostGroup);
  const gt = glowTex();
  for (let set = 0; set < 2; set++) {
    const arr = [];
    for (const side of ['L', 'R']) {
      const col = TINT[side], g = new THREE.Group();
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.065, 20, 14), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false }));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: gt, color: col, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); halo.scale.setScalar(0.34);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.009, 8, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false }));
      g.add(core, halo, ring); g.userData = { core, halo, ring }; g.visible = false; ghostGroup.add(g); arr.push(g);
    }
    ghosts.push(arr);
  }
  const hh = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.008, 6, 36).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false }));
  hh.visible = false; ghostGroup.add(hh); ghosts.headHalo = hh;
  for (const side of ['L', 'R']) {          // virtual hands for desktop play
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshBasicMaterial({ color: TINT[side], toneMapped: false }));
    m.visible = false; ghostGroup.add(m); hands.push(m);
  }
  for (const g of ['PERFECT', 'GOOD', 'OK', 'MISS']) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 80; const x = c.getContext('2d'); x.font = '800 54px system-ui,sans-serif'; x.textAlign = 'center'; x.lineWidth = 8; x.strokeStyle = 'rgba(0,0,0,0.55)'; x.strokeText(g, 128, 58); x.fillStyle = GRADE_COL[g.toLowerCase()]; x.fillText(g, 128, 58);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
    pops.push({ grade: g.toLowerCase(), tex: tx });
  }
  pops.live = [];
}
const glowOrbs = [];
function attachControllerGlow() {
  for (let i = 0; i < 2; i++) {
    if (!glowOrbs[i]) { glowOrbs[i] = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })); glowOrbs[i].position.set(0, 0, -0.06); menu.grips[i].add(glowOrbs[i]); }
  }
}
function popup(grade, pos) {
  const p = pops.find((q) => q.grade === grade); if (!p) return;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: p.tex, transparent: true, depthTest: false, toneMapped: false })); s.scale.set(0.5, 0.156, 1); s.position.set(pos[0], pos[1] + 0.2, pos[2]); s.renderOrder = 40;
  ghostGroup.add(s); pops.live.push({ s, age: 0 });
}

// ---------- tiers ----------
function applyTier() {
  const xr = renderer.xr.isPresenting;
  stage.setTier(xr ? 'medium' : touch.isTouch ? 'light' : 'high');
  fx.bloomPass.strength = touch.isTouch ? 0.28 : 0.42;
}
function onResize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); if (!renderer.xr.isPresenting) { S.view = innerWidth / innerHeight < 0.8 ? 4.4 : 3.9; orbit.dist = S.view; } }

// ---------- XR lifecycle ----------
function onXRStart() {
  mode = 'xr'; ui.setXR(true); applyTier(); attachControllerGlow(); strip.mesh.visible = false;
  dolly.position.set(0, 0, 0); dolly.rotation.set(0, 0, 0);
  calib = G.defaultCalib(); music.ensure();
  goto('safety');
}
function onXREnd() {
  school.close(); schoolOn = false;
  ui.setXR(false); dolly.position.set(0, 0, 0); dolly.rotation.set(0, 0, 0); applyTier(); strip.mesh.visible = false;
  stopRun(); mode = 'watch'; calib = G.defaultCalib(); for (const r of menu.rays) r.group.visible = true;
  goto('title');
}
function alignRig() {                 // put the calibrated body at the stage's player spot, facing the dancer
  const yawF = Math.atan2(-calib.f[0], -calib.f[2]);
  dolly.rotation.set(0, -yawF, 0);
  const v = new THREE.Vector3(calib.stand[0], 0, calib.stand[1]).applyAxisAngle(new THREE.Vector3(0, 1, 0), dolly.rotation.y);
  dolly.position.set(-v.x, 0, -v.z);
  dolly.updateMatrixWorld(true);
}
function recenterBody() {             // menu "Recenter": the way you now face becomes forward; where you stand becomes the stage spot
  if (!renderer.xr.isPresenting) return;
  const y = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
  calib.f = [-Math.sin(y), 0, -Math.cos(y)]; calib.r = [Math.cos(y), 0, -Math.sin(y)]; calib.stand = [camera.position.x, camera.position.z];
  alignRig();
}

// ---------- screens ----------
const LEVEL_INFO = () => { const r = ROUTINES[S.routine]; return `${r.level} · ${Math.round(r.bpm * S.speed)} BPM · ${Math.round(r.beats * 60 / (r.bpm * S.speed))} s · ${COMP[S.routine].scored.length} moves to hit`; };
function practiceList() { const seen = ['Off']; for (const m of ROUTINES[S.routine].moves) if (m.label !== 'Groove' && !seen.includes(m.label)) seen.push(m.label); return seen; }
function cyclePractice(d) { const l = practiceList(), i = Math.max(0, l.indexOf(S.practice || 'Off')); const n = l[(i + d + l.length) % l.length]; S.practice = n === 'Off' ? null : n; refreshScreen(); if (menu) menu.refresh(); }
function setRoutine(id) { S.routine = id; S.practice = null; save(); onSettingChanged(); }
function soloChoices() { const r = ROUTINES[S.routine], b = r.bpm * S.speed; return lib.eligible({ min: b, max: b, meter: 4, kind: 'solo' }).filter((x) => x.source === 'library' || x.id === lib.builtinFor('solo', S.routine)); }
function songText() { const id = soloSong[S.routine] || lib.builtinFor('solo', S.routine); return lib.fitText(id); }
function cycleSong(d) { const l = soloChoices(), id = soloSong[S.routine] || lib.builtinFor('solo', S.routine), i = Math.max(0, l.findIndex((x) => x.id === id)); soloSong[S.routine] = l[(i + d + l.length) % l.length].id; menu.refresh(); if (['countdown', 'dance', 'paused', 'resuming'].includes(state)) startRun(); }
function vol(d) { S.volume = clamp(Math.round((S.volume + d) * 10) / 10, 0, 1); music.setVolume(S.volume); save(); }
function onSettingChanged() { if (['countdown', 'dance', 'paused', 'resuming'].includes(state)) startRun(); else refreshScreen(); if (menu) menu.refresh(); }

function screenSpec(name) {
  const xr = mode === 'xr', phone = touch.isTouch;
  switch (name) {
    case 'title': return phone
      ? { title: 'Dance', sub: 'Follow the moves', lines: ['A dancer performs routines to generated music. Watch and learn the moves here, then put on a VR headset to dance along with both controllers.'], buttons: [{ id: 'watch', label: 'Watch & learn', tone: 'accent' }, { id: 'school', label: 'Dance school' }, { id: 'home', label: 'Back' }], note: 'Drag to orbit · ☰ Menu for options' }
      : { title: 'Dance', sub: 'Follow the moves', lines: ['A dancer performs routines to generated music; copy the moves on every beat. In a headset you hold two controllers and are scored on hands, head and body.'], buttons: [{ id: 'watch', label: 'Watch & learn', tone: 'accent' }, { id: 'play', label: 'Play with mouse' }, { id: 'school', label: 'Dance school' }, { id: 'home', label: 'Back' }], note: 'VR headset? Use the Enter VR button at the bottom.' };
    case 'home': return { title: 'Dance', sub: 'What would you like to do?', lines: ['Follow a solo routine, or learn partner dancing in the school (West Coast Swing first).'], buttons: [{ id: 'solo', label: 'Solo routines', tone: 'accent' }, { id: 'school', label: 'Dance school' }, { id: 'quit', label: 'Leave' }] };
    case 'safety': return { title: 'Clear your space', sub: 'You stand in one spot', lines: ['Make sure about 2 m × 2 m around you is free, with nothing near your hands. You never move: you only swing your arms and bend your knees.', 'Pause any time with the menu button (Y or X).'], buttons: [{ id: 'ready', label: 'My space is clear', tone: 'accent' }, { id: 'quit', label: 'Leave' }] };
    case 'calibrate': return { title: 'Calibration', sub: 'Stand tall, arms straight out to the sides', lines: [calibState.why || 'Hold still for a moment…'], bars: [{ label: 'Hold the pose', value: calibState.prog, text: Math.round(calibState.prog * 100) + ' %' }], buttons: [{ id: 'capture', label: 'Capture now' }, { id: 'skip', label: 'Use defaults' }], note: 'This sets your height and arm span so targets fit you.' };
    case 'select': return {
      title: xr ? 'Choose a routine' : mode === 'play' ? 'Play with the mouse' : 'Watch & learn', sub: LEVEL_INFO(),
      lines: mode === 'play' ? ['Mouse = right hand (left mirrors it) · Shift freezes the left hand, Alt the right · wheel = reach depth · arrows, S (squat), Z / X (lean) = quick poses.'] : mode === 'watch' ? ['Orbit with the mouse or your finger. The current and next move names are shown top left.'] : ['Reach for the glowing targets on the beat. Footwork is just for show.'],
      buttons: [{ id: 'r:easy', label: 'Easy', on: S.routine === 'easy' }, { id: 'r:medium', label: 'Medium', on: S.routine === 'medium' }, { id: 'r:hard', label: 'Hard', on: S.routine === 'hard' },
        { id: 'mirror', label: 'Mirror: ' + (S.mirror ? 'On' : 'Off') }, { id: 'speed', label: 'Speed ' + Math.round(S.speed * 100) + ' %' }, { id: 'practice', label: 'Practice: ' + (S.practice || 'Off') },
        { id: 'start', label: S.practice ? 'Practice' : mode === 'watch' ? 'Watch' : 'Start', tone: 'accent' }, { id: 'back', label: 'Back' }] };
    case 'paused': return { title: 'Paused', sub: ROUTINES[S.routine].title, lines: ['Take a breath. The music and the beat are stopped.'], buttons: [{ id: 'resume', label: 'Resume', tone: 'accent' }, { id: 'restart', label: 'Restart' }, { id: 'select', label: 'Routines' }, { id: 'quit', label: xr ? 'Leave' : 'Back' }] };
    case 'results': {
      const sc = scorer;
      if (mode === 'watch' || !sc) return { title: 'Nice, now you know it', sub: ROUTINES[S.routine].title, lines: ['That was the whole routine. Try it in a headset, or play it with the mouse.'], buttons: [{ id: 'retry', label: 'Watch again', tone: 'accent' }, { id: 'select', label: 'Routines' }, { id: 'home', label: 'Back' }] };
      const acc = sc.accuracy(), st = sc.stars();
      const verdict = st >= 5 ? 'Showtime! Flawless' : st >= 4 ? 'Great dancing!' : st >= 3 ? 'Good job!' : st >= 2 ? 'Getting there' : 'Keep practising';
      const ma = sc.moveAccuracy().slice(0, 8);
      return { title: verdict, sub: ROUTINES[S.routine].title + ' · ' + Math.round(S.speed * 100) + ' %', big: '★'.repeat(st) + '☆'.repeat(5 - st),
        stats: [['Score', String(sc.score)], ['Accuracy', Math.round(acc * 100) + ' %'], ['Best streak', String(sc.best)]],
        lines: [`Perfect ${sc.counts.perfect} · Good ${sc.counts.good} · OK ${sc.counts.ok} · Miss ${sc.counts.miss}`],
        bars: ma.map((m) => ({ label: m.name, value: m.acc, text: Math.round(m.acc * 100) + '%' })), buttons: [{ id: 'retry', label: 'Retry', tone: 'accent' }, { id: 'select', label: 'Routines' }, { id: 'quit', label: xr ? 'Leave' : 'Back' }], note: 'Weakest moves first. Pick one with Practice to loop it.' };
    }
    default: return null;
  }
}
function goto(name) { state = name; const s = screenSpec(name); if (s) ui.show(s); else ui.hide(); updateHudVisibility(); }
function refreshScreen() { const s = screenSpec(state); if (s && ui && ui.visible()) ui.show(s); }

function onAction(id) {
  music.ensure();
  if (id.startsWith('sc:')) { school.action(id); return; }
  if (id.startsWith('r:')) { setRoutine(id.slice(2)); return; }
  switch (id) {
    case 'solo': goto('select'); break;
    case 'school': schoolOn = true; state = 'school'; ui.hide(); school.open(); break;
    case 'watch': mode = 'watch'; goto('select'); break;
    case 'play': mode = 'play'; goto('select'); break;
    case 'home': location.href = '../'; break;
    case 'quit': if (mode === 'xr') { const s = renderer.xr.getSession(); if (s) s.end(); } else { stopRun(); mode = 'watch'; goto('title'); } break;
    case 'ready': goto('calibrate'); break;
    case 'capture': captureCalibration(); break;
    case 'skip': calib = G.defaultCalib(); finishCalibration(); break;
    case 'mirror': S.mirror = !S.mirror; save(); refreshScreen(); menu.refresh(); break;
    case 'speed': S.speed = S.speed === 1 ? 0.75 : 1; save(); refreshScreen(); menu.refresh(); break;
    case 'practice': cyclePractice(1); break;
    case 'start': case 'retry': case 'restart': startRun(); break;
    case 'select': stopRun(); goto('select'); break;
    case 'back': stopRun(); if (mode === 'xr') goto('home'); else { mode = 'watch'; goto('title'); } break;
    case 'resume': resume(); break;
  }
}

// ---------- calibration (XR) ----------
function handPositions() {
  let hl = null, hr = null;
  for (let i = 0; i < 2; i++) { const c = menu.controllers[i]; if (!c.userData.src) continue; const g = menu.grips[i].position; const p = [g.x, g.y, g.z]; if (c.userData.hand === 'left') hl = p; else if (c.userData.hand === 'right') hr = p; else if (!hl) hl = p; else hr = p; }
  return [hl, hr];
}
function updateCalibration(dt) {
  const head = [camera.position.x, camera.position.y, camera.position.z], [hl, hr] = handPositions();
  if (!hl || !hr) { calibState.why = 'Pick up both controllers.'; calibState.prog = 0; }
  else {
    const c = G.calibrate(head, hl, hr), flat = [...head, ...hl, ...hr];
    const ema = calibState.ema || (calibState.ema = flat.slice());
    let dev = 0; for (let i = 0; i < 9; i++) { dev = Math.max(dev, Math.abs(flat[i] - ema[i])); ema[i] += (flat[i] - ema[i]) * Math.min(1, dt * 4); }
    if (!c.ok) { calibState.why = c.why; calibState.prog = 0; }
    else if (dev > 0.05) { calibState.why = 'Hold still…'; calibState.prog = Math.max(0, calibState.prog - dt); }
    else { calibState.why = 'Great, hold it…'; calibState.prog += dt / 1.6; }
    if (calibState.prog >= 1) { captureCalibration(); return; }
  }
  calibState.acc = (calibState.acc || 0) + dt;
  if (calibState.acc > 0.12) { calibState.acc = 0; refreshScreen(); }
}
function captureCalibration() {
  const head = [camera.position.x, camera.position.y, camera.position.z], [hl, hr] = handPositions();
  const c = hl && hr ? G.calibrate(head, hl, hr) : { ok: false, why: 'Pick up both controllers and hold your arms out.' };
  if (!c.ok) { calibState.why = c.why; calibState.prog = 0; refreshScreen(); return; }
  calib = c; finishCalibration();
}
function finishCalibration() { calibState = { prog: 0, why: '', ema: null }; state = 'home'; ui.hide(); comfort.fade(() => { alignRig(); goto('home'); }, 0.25, 0.4); }

// ---------- run control ----------
async function startRun() {
  music.ensure();
  const ac = music.ctx(); if (ac && ac.state === 'suspended') { try { await Promise.race([ac.resume(), new Promise((r) => setTimeout(r, 400))]); } catch (e) { /* ignore */ } }
  compiled = COMP[S.routine]; const r = ROUTINES[S.routine];
  loopInfo = null;
  if (S.practice) { const occ = r.moves.find((m) => m.label === S.practice); if (occ) { const start = 4 * Math.floor(occ.beat / 4), end = occ.beat + occ.dur + 0.45; loopInfo = { start, len: 4 * Math.max(1, Math.ceil((end - start) / 4)) }; } }
  scorer = G.createScorer(compiled); scoring = mode !== 'watch';
  const song = await lib.get(soloSong[S.routine] || lib.builtinFor('solo', S.routine));
  music.startSong(song, { bpm: r.bpm * S.speed, countIn: r.countIn, loop: loopInfo, wrap: false });
  music.offsetMs(S.offsetMs); lastBeat = -99; pausedByMenu = false;
  ui.hide(); state = 'countdown'; hudPop = { text: '', color: '#fff', t: -9 };
  updateHudVisibility();
}
function stopRun() { music.stop(); loopInfo = null; }
function finishRun() { music.stop(); goto('results'); }
function pause() { if (state !== 'dance' && state !== 'countdown') return; music.pause(); state = 'paused'; if (!menu.isOpen()) goto('paused'); else updateHudVisibility(); }
function togglePause() { if (state === 'paused') resume(); else pause(); }
function resume() { if (state !== 'paused') return; ui.hide(); state = 'resuming'; resumeT = 2.7; updateHudVisibility(); }

// ---------- input: desktop play + watch camera ----------
function initInput() {
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') return; mouse.down = true; mouse.drag = { x: e.clientX, y: e.clientY }; try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } });
  el.addEventListener('pointerup', () => { mouse.down = false; mouse.drag = null; });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    mouse.x = (e.clientX / innerWidth) * 2 - 1; mouse.y = -((e.clientY / innerHeight) * 2 - 1);
    if (mode === 'watch' && mouse.drag) { orbit.yaw -= (e.clientX - mouse.drag.x) * 0.006; orbit.pitch = clamp(orbit.pitch + (e.clientY - mouse.drag.y) * 0.004, -0.15, 0.9); mouse.drag = { x: e.clientX, y: e.clientY }; }
  });
  el.addEventListener('wheel', (e) => { e.preventDefault(); if (mode === 'watch') { orbit.dist = S.view = clamp(orbit.dist * (e.deltaY > 0 ? 1.08 : 0.92), 1.8, 9); } else mouse.depth = clamp(mouse.depth - e.deltaY * 0.0006, 0, 0.62); }, { passive: false });
  addEventListener('keydown', (e) => {
    if (renderer.xr.isPresenting) return;
    if (e.code === 'Space' && mode === 'play') { e.preventDefault(); mouse.active = mouse.active === 'R' ? 'L' : 'R'; }
    if (e.code.startsWith('Arrow') && mode === 'play') e.preventDefault();
    mouse.keys.add(e.code);
  });
  addEventListener('keyup', (e) => mouse.keys.delete(e.code));
}
const POSE_KEYS = { ArrowUp: { L: [0.12, 1, 0], R: [0.12, 1, 0] }, ArrowDown: { L: [0.9, -0.6, 0.25], R: [0.9, -0.6, 0.25] }, ArrowLeft: { L: [0.85, -0.25, 0], R: [0.85, -0.25, 0], lx: -0.1 }, ArrowRight: { L: [0.85, -0.25, 0], R: [0.85, -0.25, 0], lx: 0.1 } };
const frozen = { L: [0.2, -0.95, 0], R: [0.2, -0.95, 0] };
function desktopSample(out) {
  const c = calib, k = mouse.keys;
  const hx = mouse.x * 0.95, hy = mouse.y * 0.95, depth = mouse.down ? Math.max(mouse.depth, 0.58) : mouse.depth;
  let R = [(hx - c.half) / c.armLen, hy / c.armLen, depth / c.armLen], L = [(-hx - c.half) / c.armLen, hy / c.armLen, depth / c.armLen];
  if (mouse.active === 'L') R = frozen.R;
  const sh = k.has('ShiftLeft') || k.has('ShiftRight'), al = k.has('AltLeft') || k.has('AltRight');
  if (sh) L = frozen.L; if (al) R = frozen.R;
  if (!sh) frozen.L = L; if (!al) frozen.R = R;
  let drop = 0, lx = 0;
  for (const key of Object.keys(POSE_KEYS)) if (k.has(key)) { const p = POSE_KEYS[key]; L = p.L; R = p.R; lx = p.lx || 0; }
  if (k.has('KeyS')) drop = 0.18; if (k.has('KeyZ')) lx = -0.1; if (k.has('KeyX')) lx = 0.1;
  for (let i = 0; i < 3; i++) { out.L[i] = L[i]; out.R[i] = R[i]; }
  out.drop = drop; out.lx = lx; out.lz = 0; return out;
}
function currentSample() {
  if (sampler) return sampler(sample);
  if (mode === 'xr') { const head = [camera.position.x, camera.position.y, camera.position.z], [hl, hr] = handPositions(); return G.sampleXR(calib, head, hl, hr, sample); }
  if (mode === 'play') return desktopSample(sample);
  sample.L[0] = sample.R[0] = 0.2; sample.L[1] = sample.R[1] = -0.95; sample.L[2] = sample.R[2] = 0; sample.drop = sample.lx = sample.lz = 0; return sample;
}

// ---------- HUD (DOM, non-XR) ----------
let hudEl = null;
function updateHudVisibility() {
  if (!hudEl) hudEl = $('hud');
  if (hudEl) hudEl.style.display = mode !== 'xr' && ['countdown', 'dance', 'resuming', 'paused'].includes(state) ? 'block' : 'none';
}
function updateDomHud(beat, pose) {
  if (!hudEl || hudEl.style.display === 'none') return;
  const cur = pose.key ? pose.key.move : '', idx = nextScoredIndex(compiled, beat, 0.1);
  let nxt = ''; for (let i = idx; i < compiled.scored.length; i++) { if (compiled.scored[i].move !== cur) { nxt = compiled.scored[i].move; break; } }
  const sc = scorer;
  $('hudMove').textContent = beat < 0 ? 'Get ready…' : cur;
  $('hudNext').textContent = nxt ? 'Next: ' + nxt : '';
  $('hudScore').textContent = scoring && sc ? `${sc.score}  ·  ×${sc.mult}  ·  streak ${sc.streak}` : (S.practice ? 'Practice: ' + S.practice : 'Watching');
  $('hudBar').style.width = (clamp(beat / compiled.beats, 0, 1) * 100).toFixed(1) + '%';
  const j = $('hudJudge'); if (t - hudPop.t < 0.8) { j.textContent = hudPop.text; j.style.color = hudPop.color; j.style.opacity = String(1 - (t - hudPop.t) / 0.8); } else j.style.opacity = '0';
}

// ---------- the frame ----------
let _idleBeat = 0;
function animate(dtIn, noRender) {
  const dt = dtIn || Math.min(0.1, clock.getDelta()); t += dt;
  music.tick(dt);
  menu.update();
  const xr = renderer.xr.isPresenting;
  if (xr) mode = 'xr';
  if (schoolOn) {
    fig.root.visible = false; figM.root.visible = false; wallHud.mesh.visible = false; strip.mesh.visible = false; hideGuides();
    if (xr) driveBoard();
    school.update(dt, xr);
    stage.update(dt, t, 0, 0.8, comfort.paused); sparkles.update(dt);
    if (!xr) { updateCamera(); }
    comfort.update(dt, { moving: 0, turning: 0 }); if (!noRender) fx.render(); return;
  }
  fig.root.visible = true; figM.root.visible = true; wallHud.mesh.visible = true;
  const running = state === 'countdown' || state === 'dance';
  if (running && menu.isOpen()) { pause(); pausedByMenu = true; }
  else if (pausedByMenu && !menu.isOpen() && state === 'paused') { pausedByMenu = false; resume(); }

  let beat;
  const inRun = running || state === 'paused' || state === 'resuming';
  if (inRun) beat = music.beat(); else { _idleBeat += dt * 100 / 60; beat = _idleBeat % 4; }
  if (state === 'resuming') { resumeT -= dt; if (resumeT <= 0) { music.resume(); state = 'dance'; updateHudVisibility(); } }
  const c = inRun ? compiled : COMP.easy;
  const pose = samplePose(c, beat);
  fig.update(pose, beat, S.mirror); figM.update(pose, beat, S.mirror);
  stage.blobTo(0, DANCER_Z, 1 - pose.drop * 0.2);

  if (state === 'calibrate' && xr) updateCalibration(dt);
  if (xr) driveBoard();

  if (inRun) {
    const ps = running ? currentSample() : sample;
    if (state === 'countdown' && beat >= 0) { state = 'dance'; hudPop = { text: 'GO!', color: '#ffd24a', t }; updateHudVisibility(); }
    if (state === 'dance' || state === 'countdown') {
      if (loopInfo && beat < lastBeat - 0.5) scorer.rewind();
      const ev = scorer.update(beat, ps, scoring && state === 'dance');
      for (const e of ev) onHit(e);
      if (!loopInfo && beat > c.beats + 0.6) finishRun();
    }
    lastBeat = beat;
    if (inRun && state !== 'results') drawGuides(beat, ps, c);
  } else hideGuides();

  updateHuds(beat, pose, c, !inRun);
  stage.update(dt, t, beat, inRun ? 1 : 0.7, comfort.paused);
  sparkles.update(dt);
  for (let i = pops.live.length - 1; i >= 0; i--) { const p = pops.live[i]; p.age += dt; p.s.position.y += dt * 0.35; p.s.material.opacity = Math.max(0, 1 - p.age / 0.9); if (p.age > 0.9) { ghostGroup.remove(p.s); p.s.material.dispose(); pops.live.splice(i, 1); } }
  for (let i = 0; i < glowOrbs.length; i++) if (glowOrbs[i]) glowOrbs[i].material.color.setHex(menu.controllers[i].userData.hand === 'left' ? TINT.L : TINT.R);
  if (!xr) updateCamera();
  comfort.update(dt, { moving: 0, turning: 0 });
  if (!noRender) fx.render();
}

function updateCamera() {
  if (schoolOn && school.applyCamera(camera, orbit)) return;
  const play = mode === 'play' && state !== 'title' && state !== 'select';
  if (play) { camera.position.set(0, 2.05, 1.25); camera.lookAt(0, 1.3, -1.4); }
  else {
    const tgt = _v.set(0, 1.0, DANCER_Z);
    camera.position.set(tgt.x + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * orbit.dist, tgt.y + 0.45 + Math.sin(orbit.pitch) * orbit.dist, tgt.z + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * orbit.dist);
    camera.lookAt(tgt.x, tgt.y + 0.3, tgt.z);
  }
}

function updateHuds(beat, pose, c, demo) {
  const sc = scorer, run = !demo;
  const pop = t - hudPop.t < 0.9 ? hudPop : null;
  let big = '', bigColor = '#fff', bigA = 1;
  if (state === 'countdown' && beat < 0) { big = String(Math.ceil(-beat)); bigA = 0.6 + 0.4 * (1 - (Math.ceil(-beat) + beat)); }
  else if (state === 'resuming') big = String(Math.max(1, Math.ceil(resumeT)));
  else if (pop) { big = pop.text; bigColor = pop.color; bigA = 1 - (t - pop.t) / 0.9; }
  const r = ROUTINES[S.routine];
  wallHud.draw({ title: demo ? 'DANCE' : r.title, sub: demo ? 'Oortia' : (S.practice ? 'Practice · ' + S.practice : r.level + ' · ' + Math.round(r.bpm * S.speed) + ' BPM'),
    score: scoring && sc ? sc.score : 0, mult: scoring && sc ? sc.mult : 1, streak: scoring && sc ? sc.streak : 0,
    big, bigColor, bigA: Math.round(bigA * 10) / 10, move: run && beat >= 0 && pose.key ? pose.key.move : '', progress: run ? Math.round(clamp(beat / c.beats, 0, 1) * 200) / 200 : 0 });
  strip.mesh.visible = (mode === 'xr' || mode === 'play') && run && state !== 'paused' && state !== 'results';
  if (strip.mesh.visible) {
    const idx = nextScoredIndex(c, beat, 0.1), names = []; let lastL = '';
    for (let i = idx; i < c.scored.length && names.length < 3; i++) { const k = c.scored[i]; if (k.move !== lastL) { names.push({ label: k.move, in: Math.max(0, Math.round(k.b - beat)) }); lastL = k.move; } }
    strip.draw({ names, beatIdx: ((Math.floor(beat) % 4) + 4) % 4, beatFrac: beat - Math.floor(beat) });
  }
  updateDomHud(beat, pose);
}

// ---------- guidance ----------
function hideGuides() { for (const s of ghosts) for (const g of s) g.visible = false; ghosts.headHalo.visible = false; hands[0].visible = hands[1].visible = false; }
const _inv = new THREE.Quaternion();
function drawGuides(beat, ps, c) {
  if (mode === 'watch') { hideGuides(); return; }
  const idx = nextScoredIndex(c, beat, G.WIN_AFTER * 0.5);
  const showVirtual = mode !== 'xr';
  _inv.copy(dolly.quaternion).invert().multiply(camera.quaternion);
  ghosts.headHalo.visible = false;
  for (let set = 0; set < 2; set++) {
    const k = c.scored[idx + set];
    for (const g of ghosts[set]) g.visible = false;
    if (!k || state === 'resuming' || state === 'paused') continue;
    const lead = k.b - beat;
    if (lead > 2.2) continue;
    const a = clamp((2.2 - lead) / 0.7, 0, 1) * (set ? 0.45 : 1), pos = G.targetPositions(calib, k, tmpPos);
    ghosts[set].forEach((g, i) => {
      const p = i === 0 ? pos.L : pos.R, u = g.userData, hit = lead < 0.15 && lead > -0.25;
      g.position.set(p[0], p[1], p[2]); g.visible = true;
      u.core.material.opacity = 0.5 * a + (hit ? 0.3 : 0); u.halo.material.opacity = 0.7 * a; u.core.scale.setScalar(hit ? 1.25 : 1);
      u.ring.visible = set === 0; u.ring.scale.setScalar(1 + clamp(lead, 0, 2) * 0.8); u.ring.material.opacity = 0.9 * a; u.ring.quaternion.copy(_inv);
    });
    if (set === 0 && k.bodyW > 0) { ghosts.headHalo.visible = true; ghosts.headHalo.position.set(pos.head[0], pos.head[1] + 0.05, pos.head[2]); ghosts.headHalo.material.opacity = 0.6 * a; }
  }
  if (showVirtual) {
    const pp = G.targetPositions(calib, ps, { L: [0, 0, 0], R: [0, 0, 0], head: [0, 0, 0] });
    hands[0].position.set(...pp.L); hands[1].position.set(...pp.R); hands[0].visible = hands[1].visible = mode === 'play' || !!sampler;
  } else hands[0].visible = hands[1].visible = false;
}
function onHit(e) {
  const g = e.grade;
  hudPop = { text: g.toUpperCase() + (e.pts ? '  +' + e.pts : ''), color: GRADE_COL[g], t };
  const pos = G.targetPositions(calib, e.key, { L: [0, 0, 0], R: [0, 0, 0], head: [0, 0, 0] });
  if (g !== 'miss') {
    dolly.updateMatrixWorld(true);
    for (const [side, p] of [['L', pos.L], ['R', pos.R]]) { _w.set(p[0], p[1], p[2]); dolly.localToWorld(_w); sparkles.burst(_w, TINT[side], g === 'perfect' ? 34 : g === 'good' ? 20 : 10); }
    music.chime(g);
    for (let i = 0; i < 2; i++) buzz(i, g === 'perfect' ? 0.7 : g === 'good' ? 0.45 : 0.25, g === 'perfect' ? 45 : 30);
  }
  popup(g, [(pos.L[0] + pos.R[0]) / 2, Math.max(pos.L[1], pos.R[1]), (pos.L[2] + pos.R[2]) / 2]);
}
function buzz(i, v, ms) {
  try { const src = menu.controllers[i].userData.src, gp = src && src.gamepad; if (!gp) return; const a = gp.hapticActuators && gp.hapticActuators[0]; if (a && a.pulse) { a.pulse(v, ms); return; } if (gp.vibrationActuator) gp.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: v, weakMagnitude: v }); } catch (e) { /* no haptics */ }
}

// ---------- XR board interaction ----------
const _o = new THREE.Vector3(), _dir = new THREE.Vector3();
function pickFrom(ctrl) { ctrl.updateMatrixWorld(true); _o.setFromMatrixPosition(ctrl.matrixWorld); _dir.set(0, 0, -1).transformDirection(ctrl.matrixWorld); return ui.pick(_o, _dir); }
function driveBoard() {
  const show = ui.visible() || menu.isOpen();
  let hover = null;
  for (let i = 0; i < 2; i++) {
    const c = menu.controllers[i]; menu.rays[i].group.visible = show;
    if (!ui.visible()) continue;
    const p = pickFrom(c);
    if (p) { if (!c.userData.overMenu) menu.rays[i].setLength(p.dist); if (p.id) hover = p.id; }
  }
  ui.setHover(hover);
}

// ---------- debug / test hook (#debug) ----------
function exposeDebug() {
  window.__dance = {
    lib, school, G, ROUTINES, COMP, S, THREE, scene, camera, music, stage, fig, calib: () => calib, setCalib: (c) => { calib = c; },
    state: () => state, mode: () => mode, beat: () => music.beat(), scorer: () => scorer, orbit, onAction, goto, setMode: (m) => { mode = m; },
    setSampler: (f) => { sampler = f; }, target: () => samplePose(compiled, music.beat()), seek: (b) => music.setBeat(b),
    advance: (dt, n = 1) => { for (let i = 0; i < n; i++) animate(dt, i < n - 1); }, usingAudio: () => music.usingAudio(), pop: () => hudPop, sample: () => sample, dolly, ui, menu,
  };
}
