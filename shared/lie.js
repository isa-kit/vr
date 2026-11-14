// ============================ shared/lie.js — kit for games you play LYING DOWN (or reclined / seated) ============================
//
//   import { createLieGame } from '../shared/lie.js?v=lie1';
//   const K = await createLieGame({ title: 'Star Catcher', sky: 'night' | 'dusk' | 'day', rows: [...menuRows],
//                                   hint: 'desktop help line', dragLook: true });
//   K.field          THREE.Group — the overhead play field. Local units are metres; x right, y "up the field"
//                    (toward the top of your head when lying), +z toward the player. Play area: |x| ≤ K.FW, |y| ≤ K.FH.
//   K.aims           [{ id, kind:'ctrl'|'gaze'|'mouse'|'touch', active, onField, x, y, ctrl }] — updated every frame
//   K.onPress(fn)    fn(aim) — trigger / click / tap that did not hit a kit button.   K.onRelease(fn) likewise.
//   K.tick(fn)       fn(dt, t) every frame (dt already 0 while the menu overlay is open on desktop? no — always runs).
//   K.button({ text, x, y, w, h, onPress, tone, visible })   in-field button (text/visible may be functions); .refresh()
//   K.text({ w, h, size, color, bg, weight })                canvas text plane (add to K.field yourself); .set('line\nline')
//   K.toast(text, secs)   K.sfx.bell(step, opts) / .pop() / .chord(steps) / .ensure()   K.buzz(aim)   K.best(key, score)
//   K.mode ('lying'|'seated')   K.recenter()   K.paused (comfort Pause/calm → freeze ambient motion)   K.xr
//
// Comfort: there is NO locomotion. The field is placed along your gaze (Recenter), at Near/Mid/Far, and never moves
// with your head. Lying mode keeps the field's "up" aligned with the top of your head and also re-places the shared
// floating menu along your gaze (the stock placement assumes you look at the horizon).
// ====================================================================================================================
import * as THREE from 'three';
import { standardChrome, STANDARD, detectXR, sectionRow, choiceGrid, stepperRow } from './app.js?v=app1';   // menu + comfort + Pause come from the app standard
import { createTouch } from './touch.js?v=20261114f';
import { beautify } from './beauty.js?v=20261114f';

const KEY = 'oortia-lie-v1';
const DIST = [['Near', 3.6], ['Mid', 5.2], ['Far', 7.5]];
const SKIES = {
  night: { top: 0x03050f, mid: 0x0a1235, low: 0x1b2758, ground: 0x070b14, hill: '#05070d', stars: 2400, hemi: [0x8a96ff, 0x0b0d16, 0.55], bloom: 0.32 },
  dusk:  { top: 0x141a45, mid: 0x5a3f86, low: 0xf09a6a, ground: 0x1c1626, hill: '#120d1a', stars: 420, hemi: [0xffc6a8, 0x201830, 0.7], bloom: 0.28 },
  day:   { top: 0x2f6fc8, mid: 0x7fb4ea, low: 0xd8ebf6, ground: 0x6f9a5c, hill: '#4f7a48', stars: 0, hemi: [0xeaf4ff, 0x506a40, 1.0], bloom: 0.12 },
};
const PENTA = [0, 2, 4, 7, 9];

function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }

function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

// canvas text plane
export function makeText({ w = 2, h = 0.5, size = 0.62, color = '#f4f1ff', bg = null, weight = 600, align = 'center' } = {}) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = Math.max(32, Math.round(1024 * h / w));
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  let last = null;
  m.userData.draw = (text, opt = {}) => {
    const key = text + '|' + (opt.bg || bg) + '|' + (opt.color || color);
    if (key === last) return; last = key;
    g.clearRect(0, 0, c.width, c.height);
    const b = opt.bg !== undefined ? opt.bg : bg;
    if (b) { g.fillStyle = b; rr(g, 6, 6, c.width - 12, c.height - 12, Math.min(c.height / 2.6, 60)); g.fill(); if (opt.ring) { g.lineWidth = 8; g.strokeStyle = opt.ring; g.stroke(); } }
    const lines = String(text).split('\n');
    const fs = Math.round((c.height * size) / Math.max(1, lines.length * 0.95));
    g.font = `${weight} ${fs}px system-ui, -apple-system, sans-serif`; g.fillStyle = opt.color || color;
    g.textAlign = align; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = b ? 0 : 12;
    const x = align === 'center' ? c.width / 2 : 40;
    lines.forEach((ln, i) => g.fillText(ln, x, c.height / 2 + (i - (lines.length - 1) / 2) * fs * 1.12, c.width - 40));
    tex.needsUpdate = true;
  };
  m.userData.set = (t, o) => m.userData.draw(t, o);
  m.set = m.userData.set;
  m.renderOrder = 10;
  return m;
}

function createSfx() {
  let ctx = null, master = null, wet = null, on = true;
  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    master = ctx.createGain(); master.gain.value = on ? 0.9 : 0; master.connect(ctx.destination);
    const d = ctx.createDelay(1); d.delayTime.value = 0.31; const fb = ctx.createGain(); fb.gain.value = 0.38;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    wet = ctx.createGain(); wet.gain.value = 0.35;
    wet.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(master);
  }
  function tone(freq, { dur = 1.4, type = 'sine', vol = 0.12, at = 0, attack = 0.008, partial = 2.76 } = {}) {
    if (!ctx || !on) return;
    const t0 = ctx.currentTime + at;
    for (const [mul, v] of [[1, 1], [partial, 0.22], [2, 0.12]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq * mul;
      const gn = ctx.createGain(); gn.gain.setValueAtTime(0, t0); gn.gain.linearRampToValueAtTime(vol * v, t0 + attack);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * (mul === 1 ? 1 : 0.5));
      o.connect(gn); gn.connect(master); gn.connect(wet); o.start(t0); o.stop(t0 + dur + 0.05);
    }
  }
  const stepFreq = (s, base = 392) => base * Math.pow(2, (PENTA[((s % 5) + 5) % 5] + 12 * Math.floor(s / 5)) / 12);
  return {
    ensure, tone, stepFreq,
    set(v) { on = v; if (master) master.gain.value = v ? 0.9 : 0; }, get: () => on,
    bell: (s, o = {}) => tone(stepFreq(s, o.base), o),
    chord: (steps, o = {}) => steps.forEach((s, i) => tone(stepFreq(s, o.base), { ...o, at: (o.at || 0) + i * (o.spread ?? 0.09) })),
    pop: () => tone(620, { dur: 0.25, vol: 0.06, type: 'triangle', partial: 1.5 }),
    soft: () => tone(196, { dur: 0.6, vol: 0.05, type: 'sine', partial: 1.5 }),
  };
}

function buildSky(scene, pal) {
  const world = new THREE.Group(); scene.add(world);
  const geo = new THREE.SphereGeometry(90, 48, 24); const col = []; const p = geo.attributes.position;
  const cT = new THREE.Color(pal.top), cM = new THREE.Color(pal.mid), cL = new THREE.Color(pal.low), cG = new THREE.Color(pal.ground), tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 90;
    if (y < 0) tmp.copy(cL).lerp(cG, Math.min(1, -y * 6));
    else if (y < 0.28) tmp.copy(cL).lerp(cM, y / 0.28);
    else tmp.copy(cM).lerp(cT, Math.pow((y - 0.28) / 0.72, 0.8));
    col.push(tmp.r, tmp.g, tmp.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false }));
  dome.renderOrder = -10; world.add(dome);
  if (pal.stars) {
    const sc = document.createElement('canvas'); sc.width = sc.height = 64; const sg = sc.getContext('2d');
    const gr = sg.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    sg.fillStyle = gr; sg.fillRect(0, 0, 64, 64); const st = new THREE.CanvasTexture(sc);
    let seed = 7; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const [frac, size] of [[0.7, 0.45], [0.24, 0.8], [0.06, 1.35]]) {
      const n = Math.round(pal.stars * frac), pos = [], cc = [];
      for (let i = 0; i < n; i++) {
        const u = r() * 2 - 1, th = r() * Math.PI * 2; let y = Math.abs(u) * 0.98 + 0.02;
        if (r() < 0.12) y = r() * 0.15;
        const s = Math.sqrt(1 - y * y);
        pos.push(Math.cos(th) * s * 84, y * 84, Math.sin(th) * s * 84);
        const w = r(); tmp.setRGB(0.8 + 0.2 * w, 0.82 + 0.1 * r(), 1 - 0.25 * w * r()); cc.push(tmp.r, tmp.g, tmp.b);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
      world.add(new THREE.Points(g, new THREE.PointsMaterial({ size, map: st, vertexColors: true, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, toneMapped: false })));
    }
  }
  // distant hill silhouette ring (seen when seated / reclined)
  const hc = document.createElement('canvas'); hc.width = 2048; hc.height = 128; const hg = hc.getContext('2d');
  hg.fillStyle = pal.hill; hg.beginPath(); hg.moveTo(0, 128);
  for (let x = 0; x <= 2048; x += 8) { const a = x / 2048 * Math.PI * 2; hg.lineTo(x, 128 - (40 + 22 * Math.sin(a * 3 + 1) + 14 * Math.sin(a * 7 + 2) + 6 * Math.sin(a * 17))); }
  hg.lineTo(2048, 128); hg.fill();
  const ht = new THREE.CanvasTexture(hc); ht.colorSpace = THREE.SRGBColorSpace; ht.wrapS = THREE.RepeatWrapping;
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(70, 70, 9, 96, 1, true), new THREE.MeshBasicMaterial({ map: ht, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false }));
  ring.position.y = 4.5; ring.renderOrder = -9; world.add(ring);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(72, 48), new THREE.MeshBasicMaterial({ color: pal.ground }));
  ground.rotation.x = -Math.PI / 2; world.add(ground);
  return world;
}

export async function createLieGame(opts = {}) {
  const pal = SKIES[opts.sky || 'night'];
  const caps = await detectXR();
  const S = Object.assign({ mode: 'lying', dist: 1, aim: 'ctrl' }, load());
  // posture is the site-wide one (STANDARD.md §7): 'lying-up' | 'seated'; ?lie=1 forces Lying up
  try { const g = localStorage.getItem(STANDARD.POSTURE_KEY); if (g === 'lying-up') S.mode = 'lying'; else if (g === 'seated' || g === 'standing') S.mode = 'seated'; } catch (e) { /* */ }
  if (/[?&]lie=1/.test(location.search)) S.mode = 'lying';
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private */ } };
  const FW = opts.FW || 3.6, FH = opts.FH || 2.4;

  const scene = new THREE.Scene(); scene.background = new THREE.Color(pal.top);
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: caps.ar, powerPreference: 'high-performance' });
  if (caps.ar) renderer.setClearColor(0x000000, 0);
  const touch = createTouch({ canvas: renderer.domElement, look: false });
  renderer.setPixelRatio(touch.pixelRatio(2)); renderer.setSize(innerWidth, innerHeight); renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement); renderer.domElement.style.touchAction = 'none';
  const fx = beautify(renderer, scene, camera, { tone: opts.sky === 'night' ? 'aces' : 'neutral', exposure: 1.0, bloom: touch.isTouch ? pal.bloom * 0.6 : pal.bloom, radius: 0.45, threshold: 0.96 });
  const dolly = new THREE.Group(); dolly.add(camera); scene.add(dolly);
  camera.position.set(0, 1.15, 0);
  const world = buildSky(scene, pal);
  const hemi = new THREE.HemisphereLight(pal.hemi[0], pal.hemi[1], pal.hemi[2]); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, opts.sky === 'day' ? 1.6 : 0.6); sun.position.set(-3, -2, 10); scene.add(sun);
  const field = new THREE.Group(); scene.add(field); sun.target = field;
  sun.position.set(0, 0, 0); field.add(sun); sun.position.set(-2, 3, 8);   // light from the player's side of the field

  const sfx = createSfx(); sfx.set(S.sound !== false);
  const K = {
    THREE, scene, camera, renderer, dolly, field, world, FW, FH, sfx, touch, caps,
    aims: [], xr: false, get mode() { return S.mode; }, get paused() { return chrome.paused; }, settings: S, save,
  };
  const press = [], release = [], ticks = [], buttons = [];
  K.onPress = (f) => press.push(f); K.onRelease = (f) => release.push(f); K.tick = (f) => ticks.push(f);
  K.text = makeText;

  // ---------- placement ----------
  const _eye = new THREE.Vector3(), _dir = new THREE.Vector3(), _up = new THREE.Vector3(), _v = new THREE.Vector3();
  let look = { yaw: 0, pitch: 0 };
  function deskPose() { look.yaw = 0; look.pitch = S.mode === 'lying' ? 1.52 : 0.85; applyLook(); }
  function applyLook() { if (!K.xr) { camera.quaternion.setFromEuler(new THREE.Euler(look.pitch, look.yaw, 0, 'YXZ')); camera.updateMatrixWorld(true); } }
  function fitDist() {
    const vt = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const hw = camera.aspect < 0.85 ? Math.max(FW * 0.72, 2.6) : FW + 0.35;   // portrait phones: crop the field's edges a little
    return Math.max((FH + 1.0) / vt, hw / (vt * camera.aspect));
  }
  K.recenter = () => {
    if (!K.xr) deskPose();
    camera.updateMatrixWorld(true); camera.getWorldPosition(_eye); camera.getWorldDirection(_dir);
    const minEl = THREE.MathUtils.degToRad(S.mode === 'lying' ? 30 : 22);
    if (Math.asin(THREE.MathUtils.clamp(_dir.y, -1, 1)) < minEl) {
      _v.set(_dir.x, 0, _dir.z); if (_v.lengthSq() < 1e-6) _v.set(0, 0, -1); _v.normalize();
      _dir.copy(_v).multiplyScalar(Math.cos(minEl)); _dir.y = Math.sin(minEl);
    }
    const d = K.xr ? DIST[S.dist][1] : fitDist();
    field.position.copy(_eye).addScaledVector(_dir, d);
    _up.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    if (S.mode === 'seated' && Math.abs(_dir.y) < 0.97) _up.set(0, 1, 0);
    field.up.copy(_up); field.lookAt(_eye); field.updateMatrixWorld(true);
    if (K.onRecenter) K.onRecenter();
  };
  K.setMode = (m) => { S.mode = m; save(); try { localStorage.setItem(STANDARD.POSTURE_KEY, m === 'lying' ? 'lying-up' : 'seated'); } catch (e) { /* */ } K.recenter(); refreshButtons(); menu && menu.refresh(); };

  // ---------- comfort + menu ----------
  const chrome = standardChrome({
    renderer, scene, camera, dolly, caps, title: opts.title || 'Oortia', onPause: opts.onPause,
    hint: opts.hint || 'Click to play. Drag to look around. Esc for menu.',
    rows: [
      sectionRow('Play position'),
      ...choiceGrid([['Lying up', 'lying'], ['Seated', 'seated']], () => S.mode, (m) => K.setMode(m), 2),
      stepperRow('Distance', () => DIST[S.dist][0], () => { S.dist = Math.max(0, S.dist - 1); save(); K.recenter(); }, () => { S.dist = Math.min(2, S.dist + 1); save(); K.recenter(); }),
      ...choiceGrid([['Aim: controllers', 'ctrl'], ['Aim: head', 'head']], () => S.aim, (a) => { S.aim = a; save(); }, 2),
      ...(opts.rows || []),
    ],
    sound: { get: () => sfx.get(), set: (v) => { sfx.set(v); S.sound = v; save(); } },
    recenter: () => K.recenter(),
    setBackdrop: (v) => { world.visible = v; scene.background = v ? new THREE.Color(pal.top) : null; },
    onBeforeEnter: () => sfx.ensure(),
    onSessionStart: () => { K.xr = true; setTimeout(() => K.recenter(), 450); if (opts.onXR) opts.onXR(true); },
    onSessionEnd: () => { K.xr = false; camera.position.set(0, 1.15, 0); K.recenter(); if (opts.onXR) opts.onXR(false); },
  });
  const comfort = chrome.comfort, menu = chrome.menu;
  K.menu = menu; K.comfort = comfort; K.setPaused = chrome.setPaused;
  K.buzz = (aim) => { if (aim && aim.ctrl) menu.hapticPulse(aim.ctrl); };
  K.best = (key, score) => {
    const k = 'oortia-lie-best-' + key; let b = 0; try { b = +localStorage.getItem(k) || 0; } catch (e) { /* */ }
    if (score !== undefined && score > b) { b = score; try { localStorage.setItem(k, String(b)); } catch (e) { /* */ } }
    return b;
  };

  // lying: re-place the floating menu along the gaze when it opens out of view
  let wasOpen = false, panelMesh = null;
  function fixMenu() {
    const o = menu.isOpen();
    if (o && !wasOpen && K.xr) {
      if (!panelMesh) panelMesh = dolly.children.find((m) => m.isMesh && m.material && m.material.map && m.material.map.image === menu.panelCanvas) || null;
      if (panelMesh && panelMesh.parent === dolly) {
        camera.getWorldPosition(_eye); camera.getWorldDirection(_dir);
        panelMesh.getWorldPosition(_v); _v.sub(_eye).normalize();
        if (_v.dot(_dir) < Math.cos(THREE.MathUtils.degToRad(38))) {
          const q = camera.quaternion; _v.set(0, -0.12, -1).normalize().applyQuaternion(q);
          panelMesh.position.copy(camera.position).addScaledVector(_v, 1.1);
          _up.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
          dolly.updateMatrixWorld(true);
          panelMesh.up.copy(_up); panelMesh.lookAt(_eye); panelMesh.up.set(0, 1, 0);
        }
      }
    }
    wasOpen = o;
  }

  // ---------- in-field buttons ----------
  K.button = ({ text, x, y, w = 1.3, h = 0.38, onPress, tone = 'plain', visible = null }) => {
    const m = makeText({ w, h, size: 0.56, bg: 'rgba(20,24,46,0.78)' });
    m.position.set(x, y, 0.03); field.add(m);
    const b = { m, x, y, w, h, onPress, tone, visible, hover: false, text };
    b.refresh = () => {
      const show = b.visible ? !!b.visible() : true; m.visible = show;
      const t = typeof b.text === 'function' ? b.text() : b.text;
      const bg = b.hover ? (b.tone === 'accent' ? 'rgba(128,150,255,0.95)' : 'rgba(84,96,140,0.95)') : (b.tone === 'accent' ? 'rgba(72,96,200,0.88)' : 'rgba(20,24,46,0.78)');
      m.set(t, { bg, ring: b.hover ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.25)' });
    };
    b.hit = (ax, ay) => m.visible && Math.abs(ax - b.x) < b.w / 2 && Math.abs(ay - b.y) < b.h / 2;
    b.refresh(); buttons.push(b); return b;
  };
  function refreshButtons() { buttons.forEach((b) => b.refresh()); }
  K.refreshButtons = refreshButtons;
  const by = -FH - 0.55;
  K.button({ text: '☰ Menu', x: -1.45, y: by, w: 1.2, onPress: () => menu.open() });
  K.button({ text: '⟳ Recenter', x: -0.05, y: by, w: 1.4, onPress: () => (K.xr ? comfort.fade(() => K.recenter()) : K.recenter()) });
  K.button({ text: () => (S.mode === 'lying' ? '◒ Lying up' : '◓ Seated'), x: 1.55, y: by, w: 1.5, onPress: () => K.setMode(S.mode === 'lying' ? 'seated' : 'lying') });

  // toast
  const toastM = makeText({ w: 5.4, h: 0.6, size: 0.56, bg: 'rgba(12,16,36,0.55)' }); toastM.position.set(0, FH * 0.55, 0.05); toastM.visible = false; field.add(toastM);
  let toastT = 0;
  K.toast = (t, secs = 2.2) => { toastM.set(t); toastM.visible = true; toastT = secs; toastM.material.opacity = 1; };

  // ---------- aims ----------
  const cursors = [];
  function cursorMesh() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.1, 32), new THREE.MeshBasicMaterial({ color: 0xfff1d0, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.025, 16), ring.material);
    g.add(ring, dot); g.renderOrder = 20; field.add(g); return g;
  }
  const mk = (id, kind, ctrl = null) => ({ id, kind, ctrl, active: false, onField: false, x: 0, y: 0, ray: new THREE.Ray(), down: false });
  const ctrlAims = menu.controllers.map((c, i) => mk('c' + i, 'ctrl', c));
  const gazeAim = mk('gaze', 'gaze'); const ptrAim = mk('ptr', 'mouse');
  K.aims = [...ctrlAims, gazeAim, ptrAim];
  K.aims.forEach(() => cursors.push(cursorMesh()));
  const plane = new THREE.Plane(), _n = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion();
  const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let ptrInside = false, ptrDown = false;

  function updateAims() {
    field.updateMatrixWorld(true);
    _n.set(0, 0, 1).applyQuaternion(field.getWorldQuaternion(_q)); plane.setFromNormalAndCoplanarPoint(_n, field.position);
    const xr = K.xr;
    ctrlAims.forEach((a) => {
      const c = a.ctrl; a.active = xr && S.aim === 'ctrl' && !!c.userData.src && !c.userData.overMenu;
      if (a.active) { c.getWorldPosition(a.ray.origin); a.ray.direction.set(0, 0, -1).applyQuaternion(c.getWorldQuaternion(_q)); }
    });
    gazeAim.active = xr && S.aim === 'head';
    if (gazeAim.active) { camera.getWorldPosition(gazeAim.ray.origin); camera.getWorldDirection(gazeAim.ray.direction); }
    ptrAim.active = !xr && (ptrInside || ptrDown) && !(touch.isTouch && !ptrDown) && !menu.isOpen();
    ptrAim.kind = touch.isTouch ? 'touch' : 'mouse';
    if (ptrAim.active) { raycaster.setFromCamera(ndc, camera); ptrAim.ray.copy(raycaster.ray); }
    K.aims.forEach((a, i) => {
      a.onField = false;
      if (a.active && a.ray.intersectPlane(plane, _p)) {
        const dist = _p.distanceTo(a.ray.origin); field.worldToLocal(_p);
        a.x = _p.x; a.y = _p.y; a.onField = Math.abs(a.x) < FW + 1.2 && Math.abs(a.y) < FH + 1.2;
        if (a.ctrl && a.onField) a.ctrl.userData.ray.setLength(dist);
      }
      const cu = cursors[i]; cu.visible = a.onField && a.kind !== 'touch'; if (cu.visible) cu.position.set(a.x, a.y, 0.06);
    });
    let changed = false;
    for (const b of buttons) { const h = K.aims.some((a) => a.onField && a.kind !== 'touch' && b.hit(a.x, a.y)); if (h !== b.hover) { b.hover = h; changed = true; b.refresh(); } }
    return changed;
  }
  function doPress(a) {
    sfx.ensure();
    if (!a.onField) return;
    for (const b of buttons) if (b.hit(a.x, a.y)) { sfx.pop(); K.buzz(a); b.onPress && b.onPress(); refreshButtons(); return; }
    a.down = true; press.forEach((f) => f(a));
  }
  function doRelease(a) { if (!a.down) return; a.down = false; release.forEach((f) => f(a)); }
  menu.onSelectStart((c, hand, i) => { const a = S.aim === 'head' ? gazeAim : ctrlAims[i]; if (S.aim === 'head') a.ctrl = c; updateAims(); doPress(a); });
  menu.onSelectEnd((c, hand, i) => { const a = S.aim === 'head' ? gazeAim : ctrlAims[i]; doRelease(a); });

  // pointer (mouse / touch): drag looks (if allowed), click / tap presses
  const cv = renderer.domElement; const dragLook = opts.dragLook !== false;
  let start = null, dragged = false;
  const setNdc = (e) => { ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); };
  cv.addEventListener('pointermove', (e) => {
    ptrInside = true; setNdc(e);
    if (start && dragLook) {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!dragged && Math.hypot(dx, dy) > 8) dragged = true;
      if (dragged) { look.yaw = start.yaw + dx * 0.004; look.pitch = THREE.MathUtils.clamp(start.pitch + dy * 0.004, 0.1, 1.56); applyLook(); }
    }
  });
  cv.addEventListener('pointerleave', () => { ptrInside = false; });
  cv.addEventListener('pointerdown', (e) => {
    sfx.ensure(); setNdc(e); ptrInside = true; ptrDown = true; dragged = false;
    start = { x: e.clientX, y: e.clientY, yaw: look.yaw, pitch: look.pitch };
    try { cv.setPointerCapture(e.pointerId); } catch (er) { /* */ }
    if (!dragLook) { updateAims(); doPress(ptrAim); }
  });
  const up = () => {
    if (!start) return;
    if (dragLook && !dragged) { updateAims(); doPress(ptrAim); }
    ptrDown = false; start = null; doRelease(ptrAim);
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);

  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); if (!K.xr) K.recenter(); });
  deskPose(); K.recenter();

  // ---------- loop ----------
  const clock = new THREE.Clock(); let t = 0;
  K.start = () => {
    const ld = document.getElementById('loading'); if (ld) ld.style.display = 'none';
    const frame = (force) => {
      const rdt = force || Math.min(clock.getDelta(), 0.05), dt = chrome.paused ? 0 : rdt; t += dt;
      menu.update();
      updateAims();
      fixMenu();
      for (const f of ticks) f(dt, t);                    // dt is 0 while Paused (standard Pause: game time stops)
      if (toastT > 0) { toastT -= rdt; toastM.material.opacity = Math.min(1, toastT / 0.6); if (toastT <= 0) toastM.visible = false; }
      world.position.copy(camera.getWorldPosition(_v)).setY(0);
      comfort.update(rdt, {});
      fx.render();
    };
    K._frame = frame;                                   // #debug: step frames by hand
    renderer.setAnimationLoop(() => frame());
  };
  if (location.hash.includes('debug')) window.__K = K;
  return K;
}
