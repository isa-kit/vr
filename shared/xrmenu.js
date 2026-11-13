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
//   • menu.onButton((hand, buttonIndex|'squeeze', controller) => …)    X/Y/A/B (4,5) and grip-down.
//   • menu.refresh() after you change state from outside the menu; menu.open()/close()/toggle()/isOpen().
//   • menu.withoutUI(fn) hides the wrist menu while fn runs (e.g. render-to-texture passes).
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

const val = (v) => (typeof v === 'function' ? v() : v);

// ---------- row helpers ----------
export const sectionRow = (text) => ({ section: text });
export const buttonRow = (text, action, tone) => ({ cells: [{ text, action, tone }] });
export const toggleRow = (label, get, set) =>
  ({ label, cells: [{ text: () => (get() ? 'On' : 'Off'), action: () => set(!get()), active: get }] });
export const stepperRow = (label, getText, dec, inc) =>
  ({ label, cells: [{ text: '–', action: dec, tone: 'accent' }, { text: getText, w: 2 }, { text: '+', action: inc, tone: 'accent' }] });
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

// ---------- panel layout (canvas) ----------
const PW = 800, PAD = 28, ROW_H = 80, GAP = 12, SEC_H = 50, TITLE_H = 84, LABEL_FRAC = 0.3;
const PANEL_W = 0.36;   // metres

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
      const p = { cell, x, y, w, h: ROW_H - GAP };
      x += w + GAP;
      return p;
    });
    out.push({ label: r.label ? val(r.label) : null, y, h: ROW_H, placed });
    y += ROW_H;
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
                 : (hov ? 'rgba(78,90,134,0.98)' : 'rgba(38,45,72,0.95)');
        ctx.fillStyle = bg; rr(ctx, p.x, p.y, p.w, p.h, 20); ctx.fill();
        ctx.lineWidth = hov ? 5 : 3;
        ctx.strokeStyle = hov ? 'rgba(255,255,255,0.98)' : on ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.18)';
        rr(ctx, p.x, p.y, p.w, p.h, 20); ctx.stroke();
        ctx.fillStyle = on ? '#1a1407' : '#f2f4ff';
      } else {
        ctx.fillStyle = '#ffe9c2';
      }
      ctx.font = '600 36px system-ui, sans-serif'; ctx.textAlign = 'center';
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
  let open = false;
  let passthrough = false;
  let quitArmed = false, quitTimer = 0;
  const selStart = [], selEnd = [], btnDown = [], menuListeners = [];

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

  const commonRows = [
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
        { text: 'Recenter', action: () => { opts.recenter && opts.recenter(); } },
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
    c.addEventListener('squeezestart', () => { for (const f of btnDown) f(c.userData.hand, 'squeeze', c); });
    return c;
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
  let layout = layoutRows(allRows());
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false, side: THREE.DoubleSide }));
  panel.renderOrder = 1000; panel.visible = false; panel.frustumCulled = false;
  let panelH = 0;
  const hint = makeLabelPlane('Press  Y  for menu', 0.2, 0.045);
  hint.visible = false;
  let hintUntil = 0;

  function redrawPanel() {
    layout = layoutRows(allRows());
    if (canvas.height !== Math.ceil(layout.H)) { canvas.height = Math.ceil(layout.H); }
    drawPanel(ctx, layout, title, ctrls.map((c) => c.userData.hover));
    tex.needsUpdate = true;
    if (panelH !== layout.H) {
      panelH = layout.H;
      panel.scale.set(PANEL_W, PANEL_W * (layout.H / PW), 1);
    }
  }

  const rc = new THREE.Raycaster();
  const _m = new THREE.Matrix4(), _eye = new THREE.Vector3();

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

  function onSelect(c, down) {
    if (down) {
      if (open && panel.visible) {
        const h = hitCell(c);
        if (h) {                       // this click belongs to the menu, not the world
          c.userData.swallow = true;
          if (h.cell && h.cell.action) { h.cell.action(); haptic(c); refresh(); }
          return;
        }
      }
      for (const f of selStart) f(c, c.userData.hand, ctrls.indexOf(c));
    } else {
      if (c.userData.swallow) { c.userData.swallow = false; return; }
      for (const f of selEnd) f(c, c.userData.hand, ctrls.indexOf(c));
    }
  }

  const btnPrev = { left: [], right: [], none: [] };

  function update() {
    if (!renderer.xr.isPresenting) return;
    const session = renderer.xr.getSession();
    if (!session) return;

    // controller buttons (edge-detected)
    for (const src of session.inputSources) {
      const gp = src.gamepad; if (!gp) continue;
      const hand = src.handedness || 'none', prev = btnPrev[hand] || (btnPrev[hand] = []);
      for (const idx of [4, 5]) {            // X/Y on the left, A/B on the right
        const p = !!(gp.buttons[idx] && gp.buttons[idx].pressed);
        if (p && !prev[idx]) {
          if (hand === 'left') toggle();
          for (const f of btnDown) f(hand, idx);
        }
        prev[idx] = p;
      }
    }
    // hand tracking (no gamepad on the left source): keep the menu open so it stays reachable
    const lsrc = [...session.inputSources].find((s) => s.handedness === 'left');
    if (lsrc && !lsrc.gamepad && !open) { open = true; refresh(); }

    // wrist panel follows the left controller and faces the head
    const holder = leftCtrl();
    if (panel.parent !== holder) { holder.add(panel); holder.add(hint); }
    panel.visible = open;
    if (open) {
      panel.position.set(0, 0.04 + (PANEL_W * (layout.H / PW)) * 0.5, -0.02);
      camera.getWorldPosition(_eye);
      panel.lookAt(_eye);
    }
    hint.visible = !open && performance.now() < hintUntil;
    if (hint.visible) { hint.position.set(0, 0.11, 0); camera.getWorldPosition(_eye); hint.lookAt(_eye); }

    // ray hover / length
    let changed = false;
    for (const c of ctrls) {
      const h = hitCell(c);
      const cell = h ? h.cell : null;
      c.userData.overMenu = !!h;
      if (cell !== c.userData.hover) { c.userData.hover = cell; changed = true; }
      c.userData.ray.setLength(h ? h.dist : 4);
    }
    if (changed) redrawPanel();
  }

  function toggle() { setOpen(!open); }
  function setOpen(v) {
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
        if (c.action) el.addEventListener('click', () => { c.action(); refresh(); });
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
    if (!document.pointerLockElement && !renderer.xr.isPresenting && opts.openOnUnlock !== false) setOpen(true);
  });

  // ---------- Enter VR button + session lifecycle ----------
  const mode = caps.ar ? 'immersive-ar' : caps.vr ? 'immersive-vr' : null;
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
    open = false; passthrough = false;
    if (opts.setBackdrop) opts.setBackdrop(true);
    if (enterBtn) enterBtn.style.display = '';
    panel.visible = false; hint.visible = false;
    for (const c of ctrls) c.userData.hover = null;
    refresh();
    if (opts.onSessionEnd) opts.onSessionEnd();
  });

  if (opts.startOpenDesktop) setTimeout(() => setOpen(true), 0);
  redrawPanel();

  return {
    update, refresh, toggle,
    open: () => setOpen(true), close: () => setOpen(false), isOpen: () => open,
    controllers: ctrls,
    rays: ctrls.map((c) => c.userData.ray),
    // run fn with the wrist menu / hint hidden (e.g. while rendering a magnifier view)
    withoutUI(fn) {
      const pv = panel.visible, hv = hint.visible;
      panel.visible = false; hint.visible = false;
      try { fn(); } finally { panel.visible = pv; hint.visible = hv; }
    },
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
