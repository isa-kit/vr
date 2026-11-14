// ============================ USAGE (read me first) ============================
//
//   import { detectXR, createXRMenu, recenterRig,
//            sectionRow, buttonRow, toggleRow, stepperRow, choiceGrid } from '../shared/xrmenu.js';
//
//   const caps = await detectXR();                       // {vr, ar} — call BEFORE making the renderer
//   const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: caps.ar });
//   if (caps.ar) renderer.setClearColor(0x000000, 0);    // alpha only so passthrough can be toggled
//   renderer.xr.enabled = true;                          // camera must be a child of `dolly`, dolly in scene
//
//   const menu = createXRMenu({
//     renderer, camera, dolly, caps,
//     title: 'Forest',                                   // header of the menu
//     rows: [ sectionRow('View'),                        // YOUR items; common ones are appended for you
//             stepperRow('Speed', () => '×' + s, () => s--, () => s++),
//             toggleRow('Fog', () => fog, (v) => (fog = v)),
//             ...choiceGrid([['Day','day'],['Dusk','dusk']], () => mode, (id) => (mode = id), 2),
//             buttonRow('Reset', reset, 'accent') ],
//     sound: { get: () => soundOn, set: setSound },      // optional → adds Sound On/Off
//     setBackdrop: (visible) => { world.visible = visible; scene.background = visible ? sky : null; },
//                                                        // REQUIRED for passthrough: hide/show everything opaque
//     recenter: () => recenterRig(dolly, camera, homeVec3, homeYaw),   // optional
//     onBeforeEnter: startAudio,                         // user-gesture hook (Enter VR click)
//     onSessionStart, onSessionEnd,                      // optional
//     startOpenDesktop: false, hint: 'text shown under the desktop overlay',
//     quitUrl: '../',
//   });
//   // each frame, BEFORE renderer.render():   menu.update();
//
//  What you get for free:
//   • An "Enter VR" button (enters immersive-ar when available — opaque backdrop by default — else immersive-vr).
//   • VR: wrist menu on the LEFT controller (X/Y toggles), clicked with either controller's ray + trigger;
//     visible ray on both controllers; Passthrough (only when AR), Sound, Recenter, Quit(2-tap) rows appended.
//   • Desktop: the same rows as an overlay (☰ button, Esc or M; Esc from pointer-lock opens it).
//   • menu.controllers[0|1]  XR controller groups (already added to dolly); controller.userData.hand
//     ('left'|'right'|'none'), .userData.overMenu (ray is on the menu), .userData.src (XRInputSource).
//   • menu.rays[i].setLength(worldMetres)  shorten a ray to your own hit point — only when !overMenu.
//   • menu.onSelectStart/onSelectEnd((controller, hand, index) => …)   trigger events NOT consumed by the menu.
//   • menu.onSqueeze((controller, hand, index, isDown) => …)           grip down/up (use for pick-up; see xrtools.js).
//   • Controller models are drawn automatically (menu.grips[i]); pass controllerModels:false to disable.
//   • Menu modes: Float / Wrist / Wheel (hold X/Y, point or push the stick, release). Wrist is a capped tablet; taller menus page.
//   • Grip while the ray is on the floating menu (or its top handle bar) carries it; position is remembered per world
//     ('Reset position' in the Menu row). menu.addGrabTarget(mesh,{visible,onGrab,onRelease}) gives any panel plane the same grab.
//   • menu.onButton((hand, buttonIndex|'squeeze', controller) => …)    X/Y/A/B (4,5) and grip-down.
//   • menu.refresh() after you change state from outside the menu; menu.open()/close()/toggle()/isOpen().
//   • menu.withoutUI(fn) hides the wrist menu while fn runs (e.g. render-to-texture passes).
//   • opts.fade: (fn, outSeconds?, inSeconds?) => void — pass comfort.fade (shared/comfort.js) so Quit and Recenter fade through black.
//   • The VR menu is FLOATING by default (≈1.3 m ahead, below the eye line, placed when opened, 2.3× larger text);
//     users can switch to a wrist menu in its Menu row (persisted in localStorage 'oortia-menu-mode').
//   • On phones (pointer: coarse) the ☰ Menu button is 46 px tall with safe-area insets, the overlay uses 44 px targets,
//     and the Enter VR button is hidden when the device has no VR (handheld-AR-only would strand the user).
//   • Companion modules: shared/comfort.js (vignette, snap turn, fades, governor), shared/touch.js (thumb-stick, touch look).
//   • Helpers (all optional, API additive): stepperRow(label, getText, dec, inc, {repeat:true}) — hold ± to repeat (ray+trigger, touch, mouse);
//     tabRow(names, get, set) + inTab(rows, () => tab===i) — group long menus into pages; swatchGrid([[name,id,['#hex',…]],…], get, set, cols) — colour chips.
//   • createXRMenu option compactCommon:true puts Passthrough/Sound/Recenter/Quit on a single row (use with tabbed menus).
//   Rows: { section }, { label?, cells:[{ text, action?, active?, tone?:'accent'|'danger', w?, visible? }], visible? };
//   text/label/active/visible may be functions. Anything with `action` is clickable.
// ===============================================================================

// Shared options menu + XR session helper for every Oortia world.
//
//  • VR:      a wrist menu attached to the LEFT controller. X / Y (left) opens and
//             closes it; click with either controller's ray + trigger. Both
//             controllers get a visible ray.
//  • Desktop: the same rows as an on-screen overlay (Esc / M / the ☰ button).
//  • Passthrough: worlds are fully immersive by default. If the browser supports
//             immersive-ar (Quest 3) we enter that mode but paint an opaque backdrop,
//             and the menu toggles passthrough by hiding / showing it (setBackdrop).
//  • Quit:    ends the XR session and returns to ../ (tap twice to confirm).
//
// Row model (shared by both renderers):
//   { label?, cells:[{ text, action?, active?, tone?:'accent'|'danger', w?, visible? }], visible? }
//   { section: 'Heading' }
//   text/label/active/visible may be values or functions.

import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

const val = (v) => (typeof v === 'function' ? v() : v);

// ---------- row helpers ----------
export const sectionRow = (text) => ({ section: text });
export const buttonRow = (text, action, tone) => ({ cells: [{ text, action, tone }] });
export const toggleRow = (label, get, set) =>
  ({ label, cells: [{ text: () => (get() ? 'On' : 'Off'), action: () => set(!get()), active: get }] });
// opts.repeat: hold the – / + (trigger held on the ray, or finger held on touch/mouse) to repeat
export const stepperRow = (label, getText, dec, inc, opts = {}) =>
  ({ label, cells: [{ text: '–', action: dec, tone: 'accent', repeat: !!opts.repeat }, { text: getText, w: 2 }, { text: '+', action: inc, tone: 'accent', repeat: !!opts.repeat }] });
// Tabs: tabRow(['Pattern','Motion'], () => tab, (i) => (tab = i)) + inTab(rows, () => tab === 0) for each tab's rows
export const tabRow = (names, get, set) =>
  ({ cells: names.map((n, i) => ({ text: n, action: () => set(i), active: () => get() === i, tone: 'tab' })) });
export const inTab = (rows, pred) => flatten([rows]).map((r) => ({ ...r, visible: r.visible ? () => pred() && r.visible() : pred }));
// Swatch grid: options [[name, id, ['#hex', '#hex', …]], …] → cells that show colour chips + the name
export const swatchGrid = (options, get, set, cols = 4) => {
  const rows = [];
  for (let i = 0; i < options.length; i += cols) {
    rows.push({ cells: options.slice(i, i + cols).map(([text, id, swatch]) => ({ text, swatch, action: () => set(id), active: () => get() === id })) });
  }
  return rows;
};
export const choiceGrid = (options, get, set, cols = 2) => {
  const rows = [];
  for (let i = 0; i < options.length; i += cols) {
    rows.push({ cells: options.slice(i, i + cols).map(([text, id]) => ({ text, action: () => set(id), active: () => get() === id })) });
  }
  return rows;
};

// ---------- capability probe (call BEFORE creating the renderer) ----------
export async function detectXR() {
  const out = { vr: false, ar: false };
  try {
    if (navigator.xr) {
      out.vr = await navigator.xr.isSessionSupported('immersive-vr');
      // ?ar=0 forces plain immersive-vr (no passthrough option) as an escape hatch
      if (new URLSearchParams(location.search).get('ar') !== '0') {
        out.ar = await navigator.xr.isSessionSupported('immersive-ar');
      }
    }
  } catch (e) { /* no WebXR */ }
  return out;
}

// Put the headset's current position/heading at (homePos, homeYaw) by moving the rig.
export function recenterRig(dolly, camera, homePos, homeYaw = 0) {
  camera.updateWorldMatrix(true, false);
  const headYaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
  dolly.rotation.y = homeYaw - headYaw;
  dolly.updateMatrixWorld(true);
  const w = new THREE.Vector3();
  camera.getWorldPosition(w);
  dolly.position.x += homePos.x - w.x;
  dolly.position.z += homePos.z - w.z;
  dolly.updateMatrixWorld(true);
}

// ---------- grab handle (bar above a floating panel, "Grip to move") ----------
const HANDLE_W = 0.6, HANDLE_ASPECT = 8, HANDLE_GAP = 0.012;
function makeGrabHandle() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.96)';
  g.beginPath(); g.roundRect ? g.roundRect(2, 2, 508, 60, 30) : g.rect(2, 2, 508, 60); g.fill();
  g.fillStyle = '#1a1407'; g.font = '700 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('\u2630  Grip to move', 256, 34);
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tx, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.renderOrder = 1001; m.frustumCulled = false;
  return m;
}

// ---------- panel layout (canvas) ----------
const PW = 800, PAD = 28, ROW_H = 80, TILE_H = 160, GAP = 12, SEC_H = 50, TITLE_H = 84, LABEL_FRAC = 0.3;
const PANEL_W = 0.36;   // metres (wrist); the floating menu is drawn 2.3× larger at ~1.3 m

function flatten(rows) { return rows.flat(Infinity).filter(Boolean); }

function layoutRows(rows) {
  let y = TITLE_H;
  const out = [];
  for (const r of rows) {
    if (r.visible && !r.visible()) continue;
    if (r.section) { out.push({ section: val(r.section), y, h: SEC_H }); y += SEC_H; continue; }
    const cells = r.cells.filter((c) => !c.visible || c.visible());
    if (!cells.length) continue;
    const x0 = PAD + (r.label ? Math.round((PW - 2 * PAD) * LABEL_FRAC) : 0);
    const totalW = PW - PAD - x0;
    const wsum = cells.reduce((a, c) => a + (c.w || 1), 0);
    let x = x0;
    const placed = cells.map((cell) => {
      const w = ((totalW - GAP * (cells.length - 1)) * (cell.w || 1)) / wsum;
      const p = { cell, x, y, w, h: (r.h || ROW_H) - GAP };
      x += w + GAP;
      return p;
    });
    out.push({ label: r.label ? val(r.label) : null, y, h: r.h || ROW_H, placed });
    y += r.h || ROW_H;
  }
  return { rows: out, H: y + PAD - GAP };
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPanel(ctx, layout, title, hovered) {
  const { rows, H } = layout;
  ctx.clearRect(0, 0, PW, H);
  ctx.fillStyle = 'rgba(12,15,28,0.95)';
  rr(ctx, 0, 0, PW, H, 36); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  rr(ctx, 1.5, 1.5, PW - 3, H - 3, 35); ctx.stroke();

  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffe9c2'; ctx.font = '700 40px system-ui, -apple-system, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(title, PAD, 44);

  for (const row of rows) {
    if (row.section) {
      ctx.fillStyle = 'rgba(255,233,194,0.7)'; ctx.font = '600 28px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(row.section.toUpperCase(), PAD, row.y + SEC_H / 2 + 6);
      continue;
    }
    if (row.label) {
      ctx.fillStyle = 'rgba(238,241,255,0.85)'; ctx.font = '600 32px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(row.label, PAD, row.y + (ROW_H - GAP) / 2);
    }
    for (const p of row.placed) {
      const c = p.cell, text = String(val(c.text));
      const on = c.active ? !!val(c.active) : false;
      const hov = hovered.includes(c);
      if (c.action) {
        const bg = on ? 'rgba(255,214,150,0.96)'
                 : c.tone === 'danger' ? (hov ? 'rgba(225,80,80,0.98)' : 'rgba(170,48,56,0.92)')
                 : c.tone === 'accent' ? (hov ? 'rgba(132,160,255,0.98)' : 'rgba(86,112,214,0.92)')
                 : c.tone === 'tab' ? (hov ? 'rgba(96,108,150,0.98)' : 'rgba(30,36,60,0.95)')
                 : (hov ? 'rgba(78,90,134,0.98)' : 'rgba(38,45,72,0.95)');
        ctx.fillStyle = bg; rr(ctx, p.x, p.y, p.w, p.h, 20); ctx.fill();
        ctx.lineWidth = hov ? 5 : 3;
        ctx.strokeStyle = hov ? 'rgba(255,255,255,0.98)' : on ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.18)';
        rr(ctx, p.x, p.y, p.w, p.h, 20); ctx.stroke();
        ctx.fillStyle = on ? '#1a1407' : '#f2f4ff';
        if (c.swatch) {                                   // colour chips on top, name underneath
          const n = c.swatch.length, bx = p.x + 14, bw = p.w - 28, by = p.y + 9, bh = p.h * 0.42;
          ctx.save(); rr(ctx, bx, by, bw, bh, 9); ctx.clip();
          c.swatch.forEach((col, k) => { ctx.fillStyle = col; ctx.fillRect(bx + (bw * k) / n, by, bw / n + 1, bh); });
          ctx.restore();
          ctx.font = '600 28px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = on ? '#1a1407' : '#f2f4ff';
          ctx.fillText(text, p.x + p.w / 2, p.y + p.h * 0.76, p.w - 10);
          continue;
        }
      } else {
        ctx.fillStyle = '#ffe9c2';
      }
      ctx.font = (p.h > 110 ? '700 46px' : '600 36px') + ' system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(text, p.x + p.w / 2, p.y + p.h / 2 + 2, p.w - 14);
    }
  }
}

function makeLabelPlane(text, w, h) {
  const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w);
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(12,15,28,0.85)'; rr(g, 4, 4, c.width - 8, c.height - 8, c.height / 2.4); g.fill();
  g.fillStyle = '#ffe9c2'; g.font = `600 ${Math.round(c.height * 0.46)}px system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
  m.renderOrder = 1001;
  return m;
}

// ---------- the menu ----------
export function createXRMenu(opts) {
  const { renderer, camera, dolly, caps = { vr: false, ar: false } } = opts;
  const title = opts.title || 'Menu';
  const quitUrl = opts.quitUrl || '../';
  const appRows = opts.rows || [];
  const isCoarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  let open = false;
  let passthrough = false;
  let menuMode = 'float';
  // ONE global style for every world: 'wheel' | 'float' (shown as Dashboard) | 'wrist'
  try { const st = localStorage.getItem('oortia-menu-style') || localStorage.getItem('oortia-menu-mode'); menuMode = st === 'wrist' ? 'wrist' : st === 'wheel' ? 'wheel' : 'float'; } catch (e) { /* ignore */ }
  // remembered pose, GLOBAL (same spot in every world): offset in the HEAD frame (x right, y up, z back; pitch included) + size
  const clampS = (v) => Math.min(2.5, Math.max(0.5, v));
  let savedOff = null, menuScale = 1;
  try { const j = JSON.parse(localStorage.getItem('oortia-menu-pose') || 'null');
    if (j) { if ([j.x, j.y, j.z].every(Number.isFinite)) savedOff = { x: j.x, y: j.y, z: j.z }; if (Number.isFinite(j.s)) menuScale = clampS(j.s); } } catch (e) { /* ignore */ }
  const savePose = () => { try { localStorage.setItem('oortia-menu-pose', JSON.stringify({ ...(savedOff || {}), s: menuScale })); } catch (e) { /* ignore */ } };
  let pageNo = 0, pageCount = 1;
  const MAX_PX = { wrist: 660, float: 1000 };
  const pagerRow = { cells: [
    { text: '\u25C0', tone: 'accent', action: () => { pageNo = (pageNo + pageCount - 1) % pageCount; } },
    { text: () => 'Page ' + (pageNo + 1) + ' / ' + pageCount, w: 2 },
    { text: '\u25B6', tone: 'accent', action: () => { pageNo = (pageNo + 1) % pageCount; } }] };
  const panelW = () => (menuMode === 'wrist' ? PANEL_W : PANEL_W * 2.0 * menuScale);
  const setMenuMode = (m) => { menuMode = m; try { localStorage.setItem('oortia-menu-style', m); } catch (e) { /* ignore */ } panelH = 0; placed = false; if (m === 'wheel') open = false; refresh(); };
  let view = 'top', viewName = '', keepView = false;
  let placed = false;
  let quitArmed = false, quitTimer = 0;
  const selStart = [], selEnd = [], btnDown = [], sqzList = [], menuListeners = [];

  const inAR = () => {
    const s = renderer.xr.getSession();
    return !!s && !!s.environmentBlendMode && s.environmentBlendMode !== 'opaque';
  };

  function setPassthrough(v) {
    passthrough = v;
    if (opts.setBackdrop) opts.setBackdrop(!v);
    refresh();
  }

  function doQuit() {
    if (opts.fade && renderer.xr.isPresenting) { opts.fade(realQuit, 0.35, 0.1); return; }   // fade through black first
    realQuit();
  }
  function realQuit() {
    const s = renderer.xr.getSession();
    let gone = false;
    const go = () => { if (gone) return; gone = true; location.href = quitUrl; };
    if (s) {
      s.addEventListener('end', go);
      s.end().catch(go);
      setTimeout(go, 900);
    } else go();
  }

  const quitCell = {
    text: () => (quitArmed ? 'Tap again to quit' : 'Quit'),
    tone: 'danger',
    action: () => {
      if (!quitArmed) {
        quitArmed = true; clearTimeout(quitTimer);
        quitTimer = setTimeout(() => { quitArmed = false; refresh(); }, 3000);
      } else doQuit();
    },
  };

  const inVR = () => renderer.xr.isPresenting;
  const styleTile = (text, m) => ({ text, active: () => menuMode === m, action: () => setMenuMode(m) });
  const styleRows = () => [
    { h: TILE_H, cells: [styleTile('Wheel', 'wheel'), styleTile('Dashboard', 'float')] },
    { h: TILE_H, cells: [styleTile('Wrist', 'wrist')] },
    { ...stepperRow('Size', () => Math.round(menuScale * 100) + '%',
        () => { menuScale = clampS(menuScale / 1.15); applyScale(); savePose(); },
        () => { menuScale = clampS(menuScale * 1.15); applyScale(); savePose(); }, { repeat: true }),
      visible: () => menuMode !== 'wrist' },
    { visible: () => menuMode !== 'wrist', cells: [{ text: 'Reset position', action: () => resetPanelPos() }] },
  ];
  const compact = !!opts.compactCommon;                // Passthrough / Sound / Recenter / Quit on ONE row (saves height in tall menus)
  const commonRows = compact ? [{ cells: [
    { text: () => 'Passthrough ' + (passthrough ? 'On' : 'Off'), active: () => passthrough, action: () => setPassthrough(!passthrough), visible: () => caps.ar && renderer.xr.isPresenting && inAR() },
    { text: () => 'Sound ' + (opts.sound && opts.sound.get() ? 'On' : 'Off'), active: () => !!(opts.sound && opts.sound.get()), action: () => opts.sound.set(!opts.sound.get()), visible: () => !!opts.sound },
    { text: 'Recenter', action: () => { if (!opts.recenter) return; if (opts.fade && renderer.xr.isPresenting) opts.fade(opts.recenter); else opts.recenter(); } },
    quitCell ] },
    ] : [
    { section: 'Options' },
    {
      cells: [
        { text: () => 'Passthrough ' + (passthrough ? 'On' : 'Off'), active: () => passthrough,
          action: () => setPassthrough(!passthrough),
          visible: () => caps.ar && renderer.xr.isPresenting && inAR() },
        { text: () => 'Sound ' + (opts.sound && opts.sound.get() ? 'On' : 'Off'), active: () => !!(opts.sound && opts.sound.get()),
          action: () => opts.sound.set(!opts.sound.get()), visible: () => !!opts.sound },
      ],
    },
    {
      cells: [
        { text: 'Recenter', action: () => { if (!opts.recenter) return; if (opts.fade && renderer.xr.isPresenting) opts.fade(opts.recenter); else opts.recenter(); } },
        quitCell,
      ],
    },
  ];

  const allRows = () => flatten([appRows, commonRows]);

  // ---------- XR: controllers + rays ----------
  const ctrls = [0, 1].map((i) => {
    const c = renderer.xr.getController(i);
    c.userData.hand = 'none'; c.userData.src = null; c.userData.hover = null; c.userData.swallow = false;
    const ray = makeRay(i === 0 ? 0xffd27f : 0x7fd4ff);
    c.userData.ray = ray; c.add(ray.group);
    dolly.add(c);
    c.addEventListener('connected', (e) => {
      c.userData.hand = e.data.handedness || 'none'; c.userData.src = e.data;
      ray.setColor(c.userData.hand === 'left' ? 0x7fd4ff : 0xffd27f);
    });
    c.addEventListener('disconnected', () => { c.userData.hand = 'none'; c.userData.src = null; });
    c.addEventListener('selectstart', () => onSelect(c, true));
    c.addEventListener('selectend', () => onSelect(c, false));
    c.addEventListener('squeezestart', () => {
      if (tryGrab(c)) { c.userData.grabSwallow = true; return; }       // this grip picked up a panel: the world never sees it
      for (const f of btnDown) f(c.userData.hand, 'squeeze', c);
      for (const f of sqzList) f(c, c.userData.hand, i, true);
    });
    c.addEventListener('squeezeend', () => {
      if (c.userData.grabSwallow) { c.userData.grabSwallow = false; releaseGrab(c); return; }
      for (const f of sqzList) f(c, c.userData.hand, i, false); });
    return c;
  });

  // visible controller models (real Quest/Touch/etc. meshes via the WebXR input-profiles asset CDN),
  // with a simple fallback body that hides once the real model has loaded
  const modelFactory = new XRControllerModelFactory();
  const grips = [0, 1].map((i) => {
    const grip = renderer.xr.getControllerGrip(i);
    const fallback = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.11, 12).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x2a3146, toneMapped: false }));
    fallback.position.z = 0.03;
    grip.add(fallback);
    if (opts.controllerModels !== false) {
      const model = modelFactory.createControllerModel(grip);
      grip.add(model);
      grip.userData.model = model; grip.userData.fallback = fallback;
    }
    dolly.add(grip);
    return grip;
  });

  function makeRay(color) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, fog: false });
    const geo = new THREE.CylinderGeometry(0.0035, 0.0035, 1, 6, 1, true);
    geo.rotateX(-Math.PI / 2); geo.translate(0, 0, -0.5);        // spans z: 0 → -1
    const beam = new THREE.Mesh(geo, mat); beam.renderOrder = 998;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), mat); tip.renderOrder = 998;
    group.add(beam, tip);
    const api = {
      group,
      setLength(worldLen) {
        const s = dolly.scale.x || 1, L = Math.max(0.05, worldLen / s);
        beam.scale.z = L; tip.position.z = -L; tip.scale.setScalar(1);
      },
      setColor(hex) { mat.color.setHex(hex); },
    };
    api.setLength(4);
    return api;
  }

  const leftCtrl = () => ctrls.find((c) => c.userData.hand === 'left') || ctrls.find((c) => c.userData.hand === 'none') || ctrls[0];

  // ---------- XR: wrist panel ----------
  const canvas = document.createElement('canvas');
  canvas.width = PW; canvas.height = 700;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  let layout = { rows: [], H: 200 };       // real layout is built by redrawPanel() at the end
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false, side: THREE.DoubleSide }));
  panel.renderOrder = 1000; panel.visible = false; panel.frustumCulled = false;
  let panelH = 0;
  const hint = makeLabelPlane('Press  Y  for menu', 0.2, 0.045);
  hint.visible = false;
  let hintUntil = 0;

  // never a tall pole: rows beyond the height cap spill onto pages (wrist ≈ 0.30 m, floating ≈ 1.0 k px)
  // ---- the ONE standard top level (same options, same order, in Wheel / Dashboard / Wrist) ----
  const isTabRow = (r) => r.cells && r.cells.length > 1 && r.cells.every((c) => c.tone === 'tab');
  function topItems() {
    const it = [];
    if (opts.pause) it.push({ text: opts.pause.text || 'Pause', run: opts.pause.action, active: opts.pause.active });
    it.push({ text: 'Recenter', run: () => recenterAct() });
    it.push({ text: 'Menu style', panel: true, run: () => { view = 'style'; viewName = 'Menu style'; pageNo = 0; } });
    it.push({ text: quitCell.text, tone: 'danger', run: quitCell.action });
    const flat = flatten([appRows]); let tabs = 0;
    for (const r of flat) if (isTabRow(r) && !(r.visible && !r.visible())) for (const c of r.cells) {
      tabs++; it.push({ text: c.text, active: c.active, panel: true, run: () => { c.action(); view = 'tab'; viewName = String(val(c.text)); pageNo = 0; } });
    }
    if (!tabs && flat.some((r) => !(r.visible && !r.visible()))) it.push({ text: 'Settings', panel: true, run: () => { view = 'tab'; viewName = 'Settings'; pageNo = 0; } });
    if (opts.sound) it.push({ text: () => 'Sound ' + (opts.sound.get() ? 'On' : 'Off'), active: () => !!opts.sound.get(), run: () => opts.sound.set(!opts.sound.get()) });
    if (caps.ar && renderer.xr.isPresenting && inAR()) it.push({ text: () => 'Passthrough ' + (passthrough ? 'On' : 'Off'), active: () => passthrough, run: () => setPassthrough(!passthrough) });
    return it;
  }
  const backRow = { h: 100, cells: [{ text: '\u25C0  Back', tone: 'accent', action: () => { view = 'top'; pageNo = 0; } }] };
  function vrContent() {
    if (view === 'style') return { pin: [backRow], rows: styleRows() };
    if (view === 'tab') return { pin: [backRow], rows: flatten([appRows]).filter((r) => !isTabRow(r)) };
    const tiles = topItems().map((i) => ({ text: i.text, tone: i.tone, active: i.active, action: () => i.run() }));
    const rows = [];
    for (let k = 0; k < tiles.length; k += 2) rows.push({ h: TILE_H, cells: tiles.slice(k, k + 2) });
    return { pin: [], rows };
  }
  const panelTitle = () => (view === 'top' ? title : viewName);
  function pagedRows() {
    const { pin, rows } = vrContent();
    const hOf = (r) => (r.section ? SEC_H : (r.h || ROW_H));
    const vis = rows.filter((r) => !(r.visible && !r.visible()) && (r.section || r.cells.some((c) => !c.visible || c.visible())));
    const pinH = pin.reduce((a, r) => a + hOf(r), 0);
    const budget = (menuMode === 'wrist' ? MAX_PX.wrist : MAX_PX.float) - TITLE_H - PAD + GAP - pinH;
    if (vis.reduce((a, r) => a + hOf(r), 0) <= budget) { pageCount = 1; pageNo = 0; return [...pin, ...vis]; }
    const pages = [[]]; let used = 0; const pb = budget - ROW_H;
    for (const r of vis) {
      const h = hOf(r);
      if (used + h > pb && pages[pages.length - 1].length) {
        const last = pages[pages.length - 1], moved = [];
        while (last.length > 1 && last[last.length - 1].section) moved.unshift(last.pop());   // never strand a header
        pages.push(moved); used = moved.reduce((a, m) => a + hOf(m), 0);
      }
      pages[pages.length - 1].push(r); used += h;
    }
    pageCount = pages.length; pageNo = Math.min(pageNo, pageCount - 1);
    return [...pin, ...pages[pageNo], pagerRow];
  }

  function redrawPanel() {
    layout = layoutRows(pagedRows());
    if (canvas.height !== Math.ceil(layout.H)) { canvas.height = Math.ceil(layout.H); }
    drawPanel(ctx, layout, panelTitle(), ctrls.map((c) => c.userData.hover));
    tex.needsUpdate = true;
    if (panelH !== layout.H) {
      panelH = layout.H;
      panel.scale.set(panelW(), panelW() * (layout.H / PW), 1);
    }
  }

  const rc = new THREE.Raycaster();
  const _m = new THREE.Matrix4(), _eye = new THREE.Vector3(), _fwd = new THREE.Vector3(), _pw = new THREE.Vector3(), _q = new THREE.Quaternion();

  function hitCell(c) {
    if (!panel.visible) return null;
    panel.updateWorldMatrix(true, false);
    c.updateWorldMatrix(true, false);
    _m.identity().extractRotation(c.matrixWorld);
    rc.ray.origin.setFromMatrixPosition(c.matrixWorld);
    rc.ray.direction.set(0, 0, -1).applyMatrix4(_m).normalize();
    const hits = rc.intersectObject(panel, false);
    if (!hits.length) return null;
    const uv = hits[0].uv, px = uv.x * PW, py = (1 - uv.y) * layout.H;
    for (const row of layout.rows) {
      if (!row.placed) continue;
      for (const p of row.placed) {
        if (p.cell.action && px >= p.x && px <= p.x + p.w && py >= p.y && py <= p.y + p.h) {
          return { cell: p.cell, dist: hits[0].distance };
        }
      }
    }
    return { cell: null, dist: hits[0].distance };
  }

  function haptic(c) {
    try { const g = c.userData.src && c.userData.src.gamepad; if (g && g.hapticActuators && g.hapticActuators[0]) g.hapticActuators[0].pulse(0.4, 30); } catch (e) { /* ignore */ }
  }

  // ---------- grabbable panels: grip while the ray is on a panel (or its handle bar) to carry it ----------
  const grabTargets = [], _rl = { x: 0, y: 0 };
  const _gi = new THREE.Matrix4(), _go = new THREE.Vector3(), _gd = new THREE.Vector3(), _glo = new THREE.Vector3(), _gz = new THREE.Vector3(), _gp = new THREE.Vector3();
  const _hq = new THREE.Quaternion(), _hp = new THREE.Vector3(), _he = new THREE.Euler(), _hup = new THREE.Vector3();
  function headFrame() {                       // head position + yaw/pitch frame (roll removed)
    camera.updateWorldMatrix(true, false); camera.getWorldPosition(_hp); camera.getWorldQuaternion(_hq);
    _he.setFromQuaternion(_hq, 'YXZ'); _he.z = 0; _hq.setFromEuler(_he);
  }
  function faceHead(m) {                       // upright yaw-facing normally; billboard to the head when looking steeply up/down
    headFrame(); m.getWorldPosition(_pw); _eye.copy(_hp);
    if (Math.abs(_he.x) > 0.85) m.up.copy(_hup.set(0, 1, 0).applyQuaternion(_hq)); else { m.up.set(0, 1, 0); _eye.y = _pw.y; }
    m.updateWorldMatrix(true, false); m.lookAt(_eye); m.up.set(0, 1, 0);
  }
  let _lastGT = 0;
  // mesh: a unit plane scaled to size. opts: visible(), onGrab(), onRelease(). Returns the target record.
  function addGrabTarget(mesh, o = {}) {
    const t = { mesh, visible: o.visible || (() => mesh.visible), onGrab: o.onGrab, onRelease: o.onRelease, main: !!o.main, scalable: !!o.scalable, handle: makeGrabHandle() };
    mesh.add(t.handle); grabTargets.push(t);
    return t;
  }
  function layoutHandle(t) {
    const sx = Math.max(1e-4, t.mesh.scale.x), sy = Math.max(1e-4, t.mesh.scale.y);
    const hm = (HANDLE_W * sx) / HANDLE_ASPECT;            // world-ish height in metres, keeps the label undistorted
    t.handle.scale.set(HANDLE_W, hm / sy, 1);
    t.handle.position.set(0, 0.5 + HANDLE_GAP / sy + hm / sy / 2, 0.002);
    t.top = 0.5 + (HANDLE_GAP + hm) / sy + 0.01;            // local y of the handle's top edge
  }
  // ray vs the panel quad extended up over its handle -> distance or null
  function grabHit(t, c) {
    if (!t.visible()) return null;
    layoutHandle(t);
    const d = grabHitMesh(t.mesh, c, t.top);
    return d;
  }
  function grabHitMesh(m, c, top = 0.5) {
    m.updateWorldMatrix(true, false); c.updateWorldMatrix(true, false);
    _gi.copy(m.matrixWorld).invert();
    _m.identity().extractRotation(c.matrixWorld);
    _go.setFromMatrixPosition(c.matrixWorld); _gd.set(0, 0, -1).applyMatrix4(_m).normalize();
    _glo.copy(_go).applyMatrix4(_gi); _gz.copy(_gd).applyMatrix4(_gi); _gd.set(0, 0, 0).applyMatrix4(_gi); _gz.sub(_gd);
    if (Math.abs(_gz.z) < 1e-6) return null;
    const d = -_glo.z / _gz.z; if (d <= 0.02) return null;
    const x = _glo.x + _gz.x * d, y = _glo.y + _gz.y * d;
    if (Math.abs(x) > 0.5 || y < -0.5 || y > top) return null;
    _rl.x = x; _rl.y = y;
    return d;
  }
  function tryGrab(c) {
    if (!renderer.xr.isPresenting || c.userData.grab) return false;
    let best = null, bd = 1e9;
    for (const t of grabTargets) { const d = grabHit(t, c); if (d !== null && d < bd) { best = t; bd = d; } }
    if (!best) return false;
    const m = best.mesh;
    if (best.main && menuMode === 'wrist') {              // detach the wrist panel into float mode where it is
      m.getWorldPosition(_gp); const wp = _gp.clone();
      setMenuMode('float'); placed = true;
      dolly.add(m); dolly.updateMatrixWorld(true); m.position.copy(dolly.worldToLocal(wp));
    }
    c.updateWorldMatrix(true, false); m.updateWorldMatrix(true, false);
    m.getWorldPosition(_gp);
    c.userData.grab = { t: best, off: _gp.clone().sub(_go.setFromMatrixPosition(c.matrixWorld)) };   // world offset hand -> panel: no lever-arm swing
    haptic(c);
    if (best.onGrab) best.onGrab();
    return true;
  }
  function releaseGrab(c) {
    const g = c.userData.grab; if (!g) return;
    c.userData.grab = null;
    // keep a remaining second hand continuous
    const other = ctrls.find((o) => o.userData.grab && o.userData.grab.t === g.t);
    if (other) { g.t.mesh.getWorldPosition(_gp); other.updateWorldMatrix(true, false); other.userData.grab.off = _gp.clone().sub(_go.setFromMatrixPosition(other.matrixWorld)); g.t.pair = null; }
    else if (g.t.main && menuMode !== 'wrist') {                      // remember the pose relative to the head, pitch included
      headFrame(); g.t.mesh.getWorldPosition(_gp); _gp.sub(_hp).applyQuaternion(_q.copy(_hq).invert());
      const L = _gp.length(); if (L > 3) _gp.multiplyScalar(3 / L); else if (L < 0.35) _gp.multiplyScalar(0.35 / Math.max(L, 1e-4));
      savedOff = { x: _gp.x, y: _gp.y, z: _gp.z }; savePose();
    }
    if (g.t.onRelease) g.t.onRelease();
  }
  function updateGrabs() {
    const now = performance.now(), dt = Math.min(0.1, (now - (_lastGT || now)) / 1000); _lastGT = now;
    for (const t of grabTargets) {
      const gs = ctrls.filter((c) => c.userData.grab && c.userData.grab.t === t);
      if (!gs.length) { t.pair = null; continue; }
      if (!t.visible()) { for (const c of gs) releaseGrab(c); continue; }
      _gp.set(0, 0, 0);
      for (const c of gs) { c.updateWorldMatrix(true, false); _go.setFromMatrixPosition(c.matrixWorld); _gp.add(_go).add(c.userData.grab.off); }
      _gp.multiplyScalar(1 / gs.length);                            // direct hand follow (midpoint when two-handed), no smoothing
      if (t.scalable) {
        if (gs.length === 2) {                                      // pull apart / together
          const d = new THREE.Vector3().setFromMatrixPosition(gs[0].matrixWorld).distanceTo(new THREE.Vector3().setFromMatrixPosition(gs[1].matrixWorld));
          if (!t.pair) t.pair = { d0: Math.max(d, 0.05), s0: menuScale };
          menuScale = clampS(t.pair.s0 * d / t.pair.d0); applyScale();
        } else {
          t.pair = null;
          const gp = gs[0].userData.src && gs[0].userData.src.gamepad, y = gp ? (gp.axes[3] !== undefined ? gp.axes[3] : gp.axes[1]) : 0;
          if (Math.abs(y) > 0.15) { menuScale = clampS(menuScale * Math.exp(-y * dt * 1.2)); applyScale(); }   // stick up = bigger
        }
      }
      const m = t.mesh; m.parent.updateWorldMatrix(true, false);
      m.position.copy(m.parent.worldToLocal(_gp));
      faceHead(m);
      for (const c of gs) c.userData.grabHover = t;
    }
    for (const c of ctrls) {
      if (c.userData.grab) continue;
      let best = null, bd = 1e9;
      for (const t of grabTargets) { const d = grabHit(t, c); if (d !== null && d < bd) { best = t; bd = d; } }
      c.userData.grabHover = best; c.userData.grabDist = bd;
    }
    for (const t of grabTargets) {
      let hov = false, grabbed = false;
      for (const c of ctrls) { if (c.userData.grabHover === t) hov = true; if (c.userData.grab && c.userData.grab.t === t) grabbed = true; }
      layoutHandle(t);
      t.handle.visible = t.visible();
      t.handle.material.opacity = grabbed ? 1 : hov ? 0.95 : 0.35;
      t.handle.material.color.setHex(grabbed ? 0xffd27f : 0xffffff);
    }
  }
  const mainTarget = addGrabTarget(panel, { main: true, scalable: true, visible: () => open && panel.visible });
  function resetPanelPos() { savedOff = null; menuScale = 1; savePose(); applyScale(); if (menuMode !== 'wrist') placed = false; refresh(); }
  function applyScale() { panel.scale.set(panelW(), panelW() * (layout.H / PW), 1); }

  function onSelect(c, down) {
    if (down) {
      if (open && panel.visible) {
        const h = hitCell(c);
        if (h) {                       // this click belongs to the menu, not the world
          c.userData.swallow = true;
          if (h.cell && h.cell.action) {
            h.cell.action(); haptic(c); refresh();
            if (h.cell.repeat) c.userData.hold = { cell: h.cell, next: performance.now() + 420 };
          }
          return;
        }
      }
      for (const f of selStart) f(c, c.userData.hand, ctrls.indexOf(c));
    } else {
      c.userData.hold = null;
      if (c.userData.swallow) { c.userData.swallow = false; return; }
      for (const f of selEnd) f(c, c.userData.hand, ctrls.indexOf(c));
    }
  }

  const btnPrev = { left: [], right: [], none: [] };

  function update() {
    if (!renderer.xr.isPresenting) return;
    for (const g of grips) {                    // swap the fallback body for the real model once it arrives
      const m = g.userData.model;
      if (m && g.userData.fallback && m.children.length) { g.userData.fallback.visible = false; g.userData.fallback = null; }
    }
    const session = renderer.xr.getSession();
    if (!session) return;

    // controller buttons (edge-detected)
    for (const src of session.inputSources) {
      const gp = src.gamepad; if (!gp) continue;
      const hand = src.handedness || 'none', prev = btnPrev[hand] || (btnPrev[hand] = []);
      for (const idx of [4, 5]) {            // X/Y on the left, A/B on the right
        const p = !!(gp.buttons[idx] && gp.buttons[idx].pressed);
        if (p && !prev[idx]) {
          if (hand === 'left') { if (menuMode === 'wheel' && !open) wheelHold = { idx, t0: performance.now(), shown: false }; else toggle(); }
          for (const f of btnDown) f(hand, idx);
        } else if (!p && prev[idx] && hand === 'left' && wheelHold && wheelHold.idx === idx) endWheel();
        prev[idx] = p;
      }
    }
    if (wheelHold) updateWheel();
    // hand tracking (no gamepad on the left source): keep the menu open so it stays reachable
    const lsrc = [...session.inputSources].find((s) => s.handedness === 'left');
    if (lsrc && !lsrc.gamepad && !open) { open = true; refresh(); }

    const holder = leftCtrl();
    if (hint.parent !== holder) holder.add(hint);
    panel.visible = open;
    if (menuMode === 'wrist') {                       // wrist panel follows the left controller and faces the head
      if (panel.parent !== holder) holder.add(panel);
      if (open) {
        panel.position.set(0, 0.03 + (panelW() * (layout.H / PW)) * 0.42, -0.09);   // tablet held in front of the hand, tilted to the eyes
        camera.getWorldPosition(_eye);
        panel.lookAt(_eye);
      }
    } else {                                          // floating: placed ~1.3 m ahead, below the eye line, then left alone (never head-locked)
      if (panel.parent !== dolly) dolly.add(panel);
      if (open && !placed) placeFloating();
      if (!open) placed = false;
    }
    updateGrabs();
    hint.visible = !open && performance.now() < hintUntil;
    if (hint.visible) { hint.position.set(0, 0.11, 0); camera.getWorldPosition(_eye); hint.lookAt(_eye); }

    // ray hover / length
    let changed = false;
    for (const c of ctrls) {
      const h = hitCell(c);
      const hold = c.userData.hold;                       // hold-to-repeat on ±steppers while the trigger stays down over the cell
      if (hold && h && h.cell === hold.cell && performance.now() >= hold.next) { hold.cell.action(); hold.next = performance.now() + 110; haptic(c); refresh(); }
      const cell = h ? h.cell : null;
      const gh = !h && c.userData.grabHover;               // ray on a panel's handle bar / grabbed panel
      c.userData.overMenu = !!h || !!gh;
      if (cell !== c.userData.hover) { c.userData.hover = cell; changed = true; }
      c.userData.ray.setLength(h ? h.dist : gh ? (c.userData.grab ? 0.3 : c.userData.grabDist) : 4);
    }
    if (changed) redrawPanel();
  }

  function placeFloating() {                   // at the remembered HEAD-relative spot (or just below the gaze), from the CURRENT head pose
    placed = true; headFrame();
    const o = savedOff || { x: 0, y: -0.2, z: -1.2 };
    _gp.set(o.x, o.y, o.z).applyQuaternion(_hq).add(_hp);
    dolly.updateMatrixWorld(true);
    panel.position.copy(dolly.worldToLocal(_gp));
    applyScale(); faceHead(panel);
  }
  // ---------- wheel (radial) quick menu: hold X/Y, point or push the stick, release to choose; a short tap still toggles the panel ----------
  const WHEEL_M = 0.34, WCV = 512;
  const wcv = document.createElement('canvas'); wcv.width = wcv.height = WCV;
  const wctx = wcv.getContext('2d'), wtex = new THREE.CanvasTexture(wcv); wtex.colorSpace = THREE.SRGBColorSpace;
  const wheel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: wtex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  wheel.renderOrder = 1002; wheel.visible = false; wheel.frustumCulled = false; wheel.scale.setScalar(WHEEL_M);
  let wheelHold = null, wheelSel = -1, wheelItems = [];
  const recenterAct = () => { if (!opts.recenter) return; if (opts.fade && renderer.xr.isPresenting) opts.fade(opts.recenter); else opts.recenter(); };
  function buildWheel() {
    let it = topItems();
    if (it.length > 8) it = [...it.slice(0, 7), { text: 'More\u2026', panel: true, run: () => { view = 'top'; pageNo = 0; } }];
    return it;
  }
  function openAtView() { keepView = true; setOpen(true); keepView = false; }
  function drawWheel() {
    const g = wctx, N = wheelItems.length, C = WCV / 2, R = C - 4, r0 = 70;
    g.clearRect(0, 0, WCV, WCV);
    for (let i = 0; i < N; i++) {
      const th = -Math.PI / 2 + (i * 2 * Math.PI) / N, h = Math.PI / N - 0.02, it = wheelItems[i];
      g.beginPath(); g.arc(C, C, R, th - h, th + h); g.arc(C, C, r0, th + h, th - h, true); g.closePath();
      g.fillStyle = i === wheelSel ? 'rgba(255,214,150,0.97)' : it.tone === 'danger' ? 'rgba(120,36,44,0.92)' : it.active && val(it.active) ? 'rgba(86,112,214,0.92)' : 'rgba(18,22,40,0.9)'; g.fill();
      g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.35)'; g.stroke();
      g.fillStyle = i === wheelSel ? '#1a1407' : '#f2f4ff'; g.font = '700 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(val(it.text)), C + Math.cos(th) * (R + r0) / 2, C + Math.sin(th) * (R + r0) / 2, 120);
    }
    g.beginPath(); g.arc(C, C, r0 - 8, 0, 7); g.fillStyle = 'rgba(12,15,28,0.9)'; g.fill();
    g.fillStyle = '#ffe9c2'; g.font = '600 22px system-ui, sans-serif'; g.fillText(wheelSel >= 0 ? 'Release' : 'Point', C, C);
    wtex.needsUpdate = true;
  }
  function wheelPick(c) {
    const N = wheelItems.length, gp = c.userData.src && c.userData.src.gamepad;
    let ang = null;
    if (gp) {
      const a = gp.axes, p2 = Math.hypot(a[2] || 0, a[3] || 0), p0 = Math.hypot(a[0] || 0, a[1] || 0);
      const sx = p2 >= p0 ? a[2] || 0 : a[0] || 0, sy = p2 >= p0 ? a[3] || 0 : a[1] || 0;
      if (Math.hypot(sx, sy) > 0.5) ang = Math.atan2(sx, -sy);
    }
    if (ang === null) {
      wheel.visible = true; const d = grabHitMesh(wheel, c);
      if (d === null || Math.hypot(_rl.x, _rl.y) < 0.14) return -1;
      ang = Math.atan2(_rl.x, _rl.y);
    }
    return (((Math.round(ang / (2 * Math.PI / N)) % N) + N) % N);
  }
  function showWheel() {
    const c = leftCtrl(); wheelItems = buildWheel(); wheelSel = -1;
    c.updateWorldMatrix(true, false); _m.identity().extractRotation(c.matrixWorld);
    _gd.set(0, 0, -1).applyMatrix4(_m).normalize();
    _gp.setFromMatrixPosition(c.matrixWorld).addScaledVector(_gd, 0.3);
    dolly.updateMatrixWorld(true); wheel.position.copy(dolly.worldToLocal(_gp));
    if (wheel.parent !== dolly) dolly.add(wheel);
    wheel.visible = true; faceHead(wheel); drawWheel(); haptic(c); wheelHold.shown = true;
  }
  function updateWheel() {
    if (!wheelHold.shown) { if (performance.now() - wheelHold.t0 > 250) showWheel(); return; }
    const s = wheelPick(leftCtrl());
    if (s !== wheelSel) { wheelSel = s; drawWheel(); if (s >= 0) haptic(leftCtrl()); }
  }
  function endWheel() {
    const h = wheelHold; wheelHold = null;
    if (!h.shown) { toggle(); return; }                // short tap: the normal panel
    const it = wheelItems[wheelSel]; wheel.visible = false; wheelSel = -1;
    if (it && it.run) { it.run(); if (it.panel) openAtView(); refresh(); }
  }
  function toggle() { setOpen(!open); }
  function setOpen(v) {
    if (v && !open && !keepView) { view = 'top'; pageNo = 0; }
    open = !!v;
    if (open && !renderer.xr.isPresenting && document.pointerLockElement) document.exitPointerLock();
    refresh();
  }

  function refresh() {
    if (renderer.xr.isPresenting) redrawPanel();
    if (!renderer.xr.isPresenting && dom) renderDom();
    for (const f of menuListeners) f();
  }

  // ---------- desktop / phone overlay ----------
  let dom = null, domPanel, domBody, domBtn, lastLockChange = 0;
  function buildDom() {
    const style = document.createElement('style');
    style.textContent = `
      #xm-btn{position:fixed;top:40px;right:14px;z-index:40;font:600 13px system-ui,sans-serif;color:#ffe9c2;background:rgba(14,18,32,.78);
        border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:6px 13px;cursor:pointer;backdrop-filter:blur(6px)}
      #xm-btn:hover{background:rgba(40,50,86,.9)}
      @media (pointer:coarse){
        #xm-btn{top:calc(env(safe-area-inset-top,0px) + 50px);right:calc(env(safe-area-inset-right,0px) + 12px);min-height:46px;padding:10px 18px;font-size:16px}
        #xm-panel{top:calc(env(safe-area-inset-top,0px) + 104px);right:calc(env(safe-area-inset-right,0px) + 10px);width:min(94vw,380px);max-height:calc(100vh - 120px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));-webkit-overflow-scrolling:touch;overscroll-behavior:contain;font-size:15px}
        .xm-cells button,.xm-cells span{min-height:44px;font-size:15px;padding:10px 4px;display:flex;align-items:center;justify-content:center}
        .xm-lab{flex:0 0 84px;font-size:14px}
        .xm-x{font-size:22px;padding:8px 12px;min-width:44px;min-height:44px}
      }
      #xm-panel{position:fixed;top:80px;right:14px;z-index:40;width:292px;max-height:calc(100vh - 96px);overflow:auto;box-sizing:border-box;
        background:rgba(12,15,28,.93);color:#eef1ff;border:1px solid rgba(255,255,255,.2);border-radius:16px;padding:12px 12px 10px;
        font:13px/1.35 system-ui,sans-serif;backdrop-filter:blur(8px);box-shadow:0 10px 40px rgba(0,0,0,.45)}
      #xm-panel[hidden]{display:none}
      .xm-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;color:#ffe9c2;font-weight:700;font-size:15px}
      .xm-x{background:none;border:0;color:#aab;font-size:16px;cursor:pointer;padding:2px 6px}
      .xm-sec{margin:10px 0 4px;font:600 11px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,233,194,.7)}
      .xm-row{display:flex;align-items:center;gap:6px;margin:5px 0}
      .xm-lab{flex:0 0 76px;color:rgba(238,241,255,.85);font-weight:600}
      .xm-cells{flex:1;display:flex;gap:6px}
      .xm-cells button,.xm-cells span{flex:1;min-width:0;font:600 13px system-ui,sans-serif;border-radius:9px;padding:7px 4px;text-align:center;
        color:#f2f4ff;background:rgba(38,45,72,.95);border:1px solid rgba(255,255,255,.18);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .xm-cells button:hover{background:rgba(78,90,134,.98);border-color:rgba(255,255,255,.7)}
      .xm-cells .xm-on{background:rgba(255,214,150,.96);color:#1a1407;border-color:#fff}
      .xm-cells .xm-accent{background:rgba(86,112,214,.92)}
      .xm-cells .xm-danger{background:rgba(170,48,56,.92)}
      .xm-cells span{background:none;border:0;color:#ffe9c2;cursor:default}
      .xm-cells .xm-tab{background:rgba(30,36,60,.95);font-size:11px;padding:7px 2px}
      .xm-cells .xm-tab.xm-on{background:rgba(255,214,150,.96);color:#1a1407}
      .xm-cells .xm-sw{display:flex;flex-direction:column;gap:4px;align-items:stretch;padding:5px}
      .xm-cells .xm-sw i{display:block;height:16px;border-radius:6px}
      .xm-cells .xm-sw b{font:600 12px system-ui,sans-serif}
      .xm-foot{margin-top:10px;font-size:11.5px;color:rgba(238,241,255,.6)}
    `;
    document.head.appendChild(style);
    domBtn = document.createElement('button'); domBtn.id = 'xm-btn'; domBtn.textContent = '☰ Menu';
    domBtn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    domPanel = document.createElement('div'); domPanel.id = 'xm-panel'; domPanel.hidden = true;
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'click', 'wheel', 'contextmenu']) {
      domPanel.addEventListener(t, (e) => e.stopPropagation());
      domBtn.addEventListener(t, (e) => e.stopPropagation());
    }
    document.body.append(domBtn, domPanel);
    dom = true;
  }

  function renderDom() {
    domPanel.hidden = !open || renderer.xr.isPresenting;
    domBtn.style.display = renderer.xr.isPresenting ? 'none' : '';
    if (domPanel.hidden) return;
    domPanel.textContent = '';
    const head = document.createElement('div'); head.className = 'xm-head';
    head.innerHTML = `<span></span>`; head.firstChild.textContent = title;
    const x = document.createElement('button'); x.className = 'xm-x'; x.textContent = '✕'; x.title = 'Close (Esc)';
    x.addEventListener('click', () => setOpen(false)); head.appendChild(x);
    domPanel.appendChild(head);
    for (const r of allRows()) {
      if (r.visible && !r.visible()) continue;
      if (r.section) { const s = document.createElement('div'); s.className = 'xm-sec'; s.textContent = val(r.section); domPanel.appendChild(s); continue; }
      const cells = r.cells.filter((c) => !c.visible || c.visible());
      if (!cells.length) continue;
      const row = document.createElement('div'); row.className = 'xm-row';
      if (r.label) { const l = document.createElement('div'); l.className = 'xm-lab'; l.textContent = val(r.label); row.appendChild(l); }
      const wrap = document.createElement('div'); wrap.className = 'xm-cells';
      for (const c of cells) {
        const el = document.createElement(c.action ? 'button' : 'span');
        el.textContent = String(val(c.text));
        if (c.w) el.style.flex = String(c.w);
        if (c.active && val(c.active)) el.classList.add('xm-on');
        if (c.tone) el.classList.add('xm-' + c.tone);
        if (c.swatch) {
          el.classList.add('xm-sw'); el.textContent = '';
          const band = document.createElement('i'); band.style.background = 'linear-gradient(90deg,' + c.swatch.map((col, k) => col + ' ' + (k * 100 / c.swatch.length) + '%,' + col + ' ' + ((k + 1) * 100 / c.swatch.length) + '%').join(',') + ')';
          const nm = document.createElement('b'); nm.textContent = String(val(c.text)); el.append(band, nm);
        }
        if (c.action && c.repeat) {                     // hold to repeat (mouse / touch)
          el.addEventListener('pointerdown', (e) => {
            e.preventDefault(); el._pd = performance.now(); c.action(); refresh();
            let tm = setTimeout(() => { tm = setInterval(() => { c.action(); refresh(); }, 110); }, 420);
            const stop = () => { clearTimeout(tm); clearInterval(tm); removeEventListener('pointerup', stop); removeEventListener('pointercancel', stop); };
            addEventListener('pointerup', stop); addEventListener('pointercancel', stop);
          });
          el.addEventListener('click', () => { if (performance.now() - (el._pd || -1e9) > 600) { c.action(); refresh(); } });   // keyboard / synthetic click
        } else if (c.action) el.addEventListener('click', () => { c.action(); refresh(); });
        wrap.appendChild(el);
      }
      row.appendChild(wrap); domPanel.appendChild(row);
    }
    if (opts.hint) { const f = document.createElement('div'); f.className = 'xm-foot'; f.textContent = opts.hint; domPanel.appendChild(f); }
  }

  buildDom();

  addEventListener('keydown', (e) => {
    if (renderer.xr.isPresenting) return;
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.code === 'KeyM' || (e.code === 'Escape' && performance.now() - lastLockChange > 250)) { e.preventDefault(); toggle(); }
  });
  // Esc frees the mouse — show the menu so there is always something to click
  document.addEventListener('pointerlockchange', () => {
    lastLockChange = performance.now();
    if (!document.pointerLockElement && !renderer.xr.isPresenting && opts.openOnUnlock !== false && !isCoarse) setOpen(true);
  });

  // ---------- Enter VR button + session lifecycle ----------
  // a phone with only handheld AR (no VR, no controllers) would strand the user in a camera-feed session: hide the button there
  const mode = (isCoarse && !caps.vr) ? null : caps.ar ? 'immersive-ar' : caps.vr ? 'immersive-vr' : null;
  let enterBtn = null;
  if (mode) {
    enterBtn = document.createElement('button');
    enterBtn.textContent = 'Enter VR';
    Object.assign(enterBtn.style, {
      position: 'fixed', left: '50%', bottom: '22px', transform: 'translateX(-50%)', zIndex: 35,
      padding: '12px 26px', border: '1px solid rgba(255,255,255,.55)', borderRadius: '999px',
      background: 'rgba(12,15,28,.82)', color: '#fff', font: '700 15px system-ui,sans-serif',
      letterSpacing: '.04em', cursor: 'pointer', backdropFilter: 'blur(6px)',
    });
    enterBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (opts.onBeforeEnter) opts.onBeforeEnter();
      const init = { optionalFeatures: ['local-floor', 'bounded-floor'] };
      renderer.xr.setReferenceSpaceType('local-floor');
      try {
        await renderer.xr.setSession(await navigator.xr.requestSession(mode, init));
      } catch (err) {
        if (mode === 'immersive-ar' && caps.vr) {          // AR refused → plain VR
          try { await renderer.xr.setSession(await navigator.xr.requestSession('immersive-vr', init)); } catch (e2) { console.warn(e2); }
        } else console.warn(err);
      }
    });
    for (const t of ['pointerdown', 'pointerup', 'mousedown']) enterBtn.addEventListener(t, (e) => e.stopPropagation());
    document.body.appendChild(enterBtn);
  }

  renderer.xr.addEventListener('sessionstart', () => {
    open = false; passthrough = false;
    if (opts.setBackdrop) opts.setBackdrop(true);        // always start fully immersive
    if (enterBtn) enterBtn.style.display = 'none';
    hintUntil = performance.now() + 25000;
    refresh();
    if (opts.onSessionStart) opts.onSessionStart();
  });
  renderer.xr.addEventListener('sessionend', () => {
    open = false; passthrough = false; wheelHold = null; wheel.visible = false;
    if (opts.setBackdrop) opts.setBackdrop(true);
    if (enterBtn) enterBtn.style.display = '';
    panel.visible = false; hint.visible = false;
    for (const c of ctrls) { c.userData.hover = null; c.userData.grab = null; c.userData.grabSwallow = false; c.userData.grabHover = null; }
    refresh();
    if (opts.onSessionEnd) opts.onSessionEnd();
  });

  if (opts.startOpenDesktop) setTimeout(() => setOpen(true), 0);
  redrawPanel();

  return {
    update, refresh, toggle,
    openView: (v) => { view = v === 'style' ? 'style' : v === 'settings' ? 'tab' : 'top'; viewName = v === 'style' ? 'Menu style' : 'Settings'; pageNo = 0; keepView = true; setOpen(true); keepView = false; refresh(); },
    open: () => setOpen(true), close: () => setOpen(false), isOpen: () => open,
    controllers: ctrls,
    rays: ctrls.map((c) => c.userData.ray),
    // run fn with the wrist menu / hint hidden (e.g. while rendering a magnifier view)
    withoutUI(fn) {
      const pv = panel.visible, hv = hint.visible;
      panel.visible = false; hint.visible = false;
      try { fn(); } finally { panel.visible = pv; hint.visible = hv; }
    },
    addGrabTarget,                          // (mesh, {visible, onGrab, onRelease}) — grip-to-move for any standalone panel plane
    onSqueeze: (f) => sqzList.push(f),       // (controller, hand, index, isDown)
    grips,
    onSelectStart: (f) => selStart.push(f),
    onSelectEnd: (f) => selEnd.push(f),
    onButton: (f) => btnDown.push(f),       // (hand, index|'squeeze', controller)
    onChange: (f) => menuListeners.push(f),
    panelCanvas: canvas,
    hapticPulse: haptic,
    isPassthrough: () => passthrough,
    enterButton: enterBtn,
  };
}
