// ============================ rts/vr.js — the VR control layer ============================
//  • Right controller ray: trigger = select / command (move, attack, gather, place), trigger-drag = box or lasso select on the terrain,
//    double-tap a unit = select all of that type in view. A waypoint ring and a path preview show what the click will do.
//  • Hold GRIP and sweep your hand through the diorama = brush-select the units your hand touches.
//  • Left controller carries the MINI MAP PANEL (terrain, fog, units, your view zone). Point the other controller at it:
//    trigger = send selected units there (or jump the table view), drag = box select. Orders page: train/build/formations/stances.
//  • A / B (right) = control groups 1 and 2 (hold to assign, tap to recall, double-tap jumps the view). Groups 3-4 live on the map
//    panel (X/Y are the shared Oortia menu buttons). Nothing here ever moves the player; table changes are faded steps.
// All interaction maths is plain 3D (ray vs plane / sphere / terrain), so it is exercised headlessly in the #debug test hooks.
import * as THREE from 'three';
import { UT, BT, N } from './sim.js?v=rts4';
import { CELL } from './gfx.js?v=rts4';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PW = 512, PH = 760, PANEL_W = 0.2, PANEL_H = PANEL_W * PH / PW;
const FRONT = new THREE.Vector3(0, 0, -1.15);                  // world point (x, y filled in, z) that "view here" brings to the player

export function createVR({ renderer, scene, camera, dolly, menu, comfort, sfx, C, getView, getS, getMini, T, SCALE_STEPS, placeBoard, isXR, G, showSpec, onReady }) {
  const VR = { page: 'map', hand: 'left', brush: false, ready: false, hover: [null, null], dirty: true };
  const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4();

  // ---------------------------------------------------------------- canvas panels
  function makePanel(w, h, pw, ph, depthTest = true) {
    const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthTest, depthWrite: false, side: THREE.DoubleSide }));
    mesh.scale.set(w, h, 1); mesh.renderOrder = 1200; mesh.frustumCulled = false; mesh.visible = false;
    return { cv, ctx: cv.getContext('2d'), tex, mesh, w, h, pw, ph, regions: [] };
  }
  // ray vs panel -> {t, px, py} (pixels in the canvas) or null
  const _inv = new THREE.Matrix4(), _z = new THREE.Vector3(), _lo = new THREE.Vector3(), _ld = new THREE.Vector3();
  function hitPanel(P, o, d) {
    if (!P.mesh.visible) return null;
    P.mesh.updateWorldMatrix(true, false); _inv.copy(P.mesh.matrixWorld).invert();
    _lo.copy(o).applyMatrix4(_inv); _z.set(0, 0, 0).applyMatrix4(_inv); _ld.copy(d).applyMatrix4(_inv).sub(_z);
    if (Math.abs(_ld.z) < 1e-6) return null;
    const t = -_lo.z / _ld.z; if (t <= 0.02) return null;
    const x = _lo.x + _ld.x * t, y = _lo.y + _ld.y * t;
    if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) return null;
    return { t, px: (x + 0.5) * P.pw, py: (0.5 - y) * P.ph };
  }
  VR.hitPanel = hitPanel;
  const rr = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  function button(P, b, hoverId) {
    const c = P.ctx, hv = hoverId === b.id && !b.disabled;
    rr(c, b.x, b.y, b.w, b.h, 12);
    c.fillStyle = b.disabled ? 'rgba(30,40,60,.7)' : b.active ? '#2b78d6' : b.tone === 'danger' ? '#8a2a24' : b.tone === 'accent' ? '#1f6a62' : hv ? '#4a6bb0' : 'rgba(44,64,108,.92)'; c.fill();
    c.lineWidth = hv ? 4 : 2; c.strokeStyle = hv ? '#ffffff' : 'rgba(170,200,255,.4)'; c.stroke();
    c.fillStyle = b.disabled ? 'rgba(255,255,255,.4)' : '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `600 ${b.fs || 26}px system-ui, sans-serif`;
    if (b.sub) { c.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 - 11); c.font = `500 ${Math.round((b.fs || 26) * 0.72)}px system-ui, sans-serif`; c.fillStyle = 'rgba(255,255,255,.75)'; c.fillText(b.sub, b.x + b.w / 2, b.y + b.h / 2 + 15); }
    else c.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    P.regions.push(b);
  }

  // ---------------------------------------------------------------- the controller panel (map + orders)
  const mapP = makePanel(PANEL_W, PANEL_H, PW, PH);
  let mapRect = { x: 16, y: 62, w: 480, h: 480 }, redrawAt = 0, miniDrag = null;
  const rot = () => 0;                                          // map orientation follows the board: see viewZone()
  function mapRot() { return -T.yaw; }
  VR.mapRot = mapRot;
  function drawMapPanel(now) {
    const S = getS(), P = mapP, c = P.ctx, mini = getMini(), t = C.team, hov = VR.hoverBtn;
    P.regions = []; c.clearRect(0, 0, PW, PH);
    rr(c, 0, 0, PW, PH, 26); c.fillStyle = 'rgba(8,12,22,.9)'; c.fill(); c.lineWidth = 3; c.strokeStyle = 'rgba(160,190,255,.45)'; c.stroke();
    // header: economy + tabs
    c.fillStyle = '#7fe8ff'; c.font = '700 30px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
    const pop = S.pop(t), cap = S.popCap(t); c.fillText(`◆ ${Math.floor(S.team[t].ore)}`, 20, 30);
    c.fillStyle = pop >= cap ? '#ffd24a' : '#eaf2ff'; c.fillText(`Pop ${pop}/${cap}`, 150, 30);
    c.fillStyle = '#eaf2ff'; c.fillText(`${Math.floor(S.time / 60)}:${String(Math.floor(S.time % 60)).padStart(2, '0')}`, 296, 30);
    button(P, { id: 'tab', x: 388, y: 6, w: 112, h: 48, label: VR.page === 'map' ? 'Orders ▸' : '◂ Map', fs: 22, act: () => { VR.page = VR.page === 'map' ? 'orders' : 'map'; } }, hov);
    if (VR.page === 'map') {
      mini.draw(c, mapRect.x, mapRect.y, mapRect.w, mapRect.h, { rot: mapRot(), team: t, selected: C.sel, viewPoly: viewZone(), drag: miniDrag && miniDrag.on ? miniDrag : null, alertAt: C.alert && performance.now() - C.alert.t < 6000 ? C.alert : null });
      P.regions.push({ id: 'map', x: mapRect.x, y: mapRect.y, w: mapRect.w, h: mapRect.h, map: true });
      let y = 552; const bw = 114, gap = 8;
      const row = (items, yy, h = 52) => items.forEach((b, i) => button(P, { fs: 22, ...b, x: 16 + i * (480 / items.length) + 2, y: yy, w: 480 / items.length - gap + 4, h }, hov));
      row([{ id: 'mSend', label: 'Send', active: C.miniMode === 'send', act: () => { C.miniMode = 'send'; } }, { id: 'mView', label: 'Look', active: C.miniMode === 'view', act: () => { C.miniMode = 'view'; } },
        { id: 'sBox', label: 'Box', active: C.selMode === 'box', act: () => { C.selMode = 'box'; } }, { id: 'sLasso', label: 'Lasso', active: C.selMode === 'lasso', act: () => { C.selMode = 'lasso'; } }], y);
      row([1, 2, 3, 4].map((g) => ({ id: 'g' + g, label: `${g}`, sub: C.groups[g].filter((id) => S.get(id)).length ? String(C.groups[g].filter((id) => S.get(id)).length) : '', act: () => C.recallGroup(g), hold: () => C.assignGroup(g), tone: C.groups[g].length ? 'accent' : undefined })).concat([{ id: 'army', label: 'Army', act: () => C.selectArmy() }, { id: 'idle', label: 'Idle', act: () => C.selectIdleWorkers() }]), y + 60);
      row([{ id: 'stop', label: 'Stop', act: () => C.stop() }, { id: 'amove', label: 'Attack-move', active: C.amoveArmed, act: () => C.armAttackMove(!C.amoveArmed) }, { id: 'cancel', label: 'Cancel', tone: C.buildType || C.amoveArmed ? 'danger' : undefined, act: () => C.cancelModes() }], y + 120);
      c.fillStyle = 'rgba(220,235,255,.85)'; c.font = '500 22px system-ui, sans-serif'; c.textAlign = 'left';
      c.fillText(hintLine(), 20, PH - 28);
    } else {
      const ore = S.team[t].ore; let y = 70;
      const row = (items, yy, h = 66) => items.forEach((b, i) => button(P, { fs: 22, ...b, x: 12 + i * (488 / items.length) + 2, y: yy, w: 488 / items.length - 6, h }, hov));
      c.fillStyle = '#9db6e8'; c.font = '600 20px system-ui, sans-serif'; c.fillText('TRAIN', 20, y); y += 16;
      row([['worker', 'Worker'], ['infantry', 'Infantry'], ['ranged', 'Archer'], ['scout', 'Rider'], ['siege', 'Catapult']].map(([k, n]) => ({ id: 't' + k, label: n, sub: String(UT[k].cost), fs: 18, disabled: ore < UT[k].cost, act: () => C.train(k) })), y); y += 82;
      c.fillStyle = '#9db6e8'; c.fillText('BUILD (select a worker first)', 20, y); y += 16;
      row([{ id: 'bDepot', label: 'Depot', sub: String(BT.depot.cost), active: C.buildType === 'depot', disabled: ore < BT.depot.cost, act: () => C.beginBuild('depot') }, { id: 'bBar', label: 'Barracks', sub: String(BT.barracks.cost), active: C.buildType === 'barracks', disabled: ore < BT.barracks.cost, act: () => C.beginBuild('barracks') }, { id: 'cancel2', label: 'Cancel', act: () => C.cancelModes() }], y); y += 82;
      c.fillStyle = '#9db6e8'; c.fillText('FORMATION', 20, y); y += 16;
      row([['box', 'Box'], ['line', 'Line'], ['wedge', 'Wedge']].map(([k, n]) => ({ id: 'f' + k, label: n, active: C.formation === k, act: () => C.setFormation(k) })), y); y += 82;
      c.fillStyle = '#9db6e8'; c.fillText('STANCE', 20, y); y += 16;
      row([['aggro', 'Aggressive'], ['defend', 'Guard'], ['hold', 'Hold']].map(([k, n]) => ({ id: 'st' + k, label: n, active: C.stance === k, act: () => C.setStance(k) })), y); y += 82;
      c.fillStyle = '#9db6e8'; c.fillText('ASSIGN GROUP (selected units)', 20, y); y += 16;
      row([1, 2, 3, 4].map((g) => ({ id: 'a' + g, label: 'Set ' + g, act: () => C.assignGroup(g) })), y, 58);
    }
    P.tex.needsUpdate = true;
  }
  function hintLine() {
    if (C.buildType) return 'Point at flat ground and pull trigger to place';
    if (C.amoveArmed) return 'Point at a spot: units attack along the way';
    const n = C.units().length;
    if (!n) return 'Trigger a unit · hold grip to sweep-select';
    return `${n} selected · ${C.miniMode === 'send' ? 'map click sends them' : 'map click moves the view'}`;
  }
  // the zone of the table you can comfortably reach/see (drawn as the "current view" on the map)
  function viewZone() {
    const V = getView(); if (!V) return null;
    const tb = V.toLocal(_v.set(0, T.y, FRONT.z)), rad = clamp(0.85 / (CELL * T.scale), 2.5, 40), pts = [];
    for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; pts.push({ x: clamp(tb.x + Math.cos(a) * rad, 0, N), z: clamp(tb.z + Math.sin(a) * rad, 0, N) }); }
    return pts;
  }
  VR.viewCentre = () => { const V = getView(); const l = V.toLocal(_v.set(0, T.y, T.scale >= 4 ? -0.5 : FRONT.z)); return { x: l.x, z: l.z }; };

  // ---------------------------------------------------------------- world panel (clear-space reminder, title, pause, victory, tutorial)
  const wP = makePanel(0.95, 0.6, 1024, 648, false);
  let wSpec = null;
  function drawWorld(spec, hov) {
    const P = wP, c = P.ctx; P.regions = []; c.clearRect(0, 0, 1024, 648);
    rr(c, 0, 0, 1024, 648, 36); c.fillStyle = 'rgba(10,15,28,.95)'; c.fill(); c.lineWidth = 4; c.strokeStyle = 'rgba(160,190,255,.5)'; c.stroke();
    c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.font = '800 54px system-ui, sans-serif'; c.fillText(spec.title, 48, 88);
    c.font = '500 32px system-ui, sans-serif'; c.fillStyle = 'rgba(230,240,255,.92)';
    let y = 144; for (const line of spec.lines || []) { y = wrap(c, line.replace(/<[^>]+>/g, ''), 48, y, 930, 42) + 8; }
    const rows = spec.vrRows || [spec.buttons || []]; let by = 648 - 36 - rows.length * 96 + 8;
    rows.forEach((r, ri) => { r.forEach((b, i) => { const n = r.length, w = (1024 - 96 - (n - 1) * 16) / n; button(P, { id: 'w' + ri + '_' + i, x: 48 + i * (w + 16), y: by + ri * 96, w, h: 80, label: b.text, active: b.on, fs: 32, act: b.action, big: b.big }, hov); }); });
    P.tex.needsUpdate = true;
  }
  function wrap(c, text, x, y, mw, lh) { const words = text.split(' '); let line = ''; for (const w of words) { const t = line ? line + ' ' + w : w; if (c.measureText(t).width > mw && line) { c.fillText(line, x, y); line = w; y += lh; } else line = t; } c.fillText(line, x, y); return y + lh - 8; }
  VR.showSpec = (spec) => {
    wSpec = spec; wP.mesh.visible = !!spec && isXR();
    if (spec && isXR()) { VR.needPlace = 3; VR.dirty = true; }
  };
  function placeFloating(mesh, dist, dy) {          // in front of the head once, then left alone (never head-locked)
    camera.getWorldPosition(_o); camera.getWorldDirection(_d); _d.y = 0; if (_d.lengthSq() < 1e-4) _d.set(0, 0, -1); _d.normalize();
    mesh.position.set(_o.x + _d.x * dist, Math.max(0.8, _o.y - 0.08 + dy), _o.z + _d.z * dist);
    dolly.updateWorldMatrix(true, false); if (mesh.parent !== scene) scene.add(mesh);
    mesh.lookAt(_o.x, mesh.position.y + 0.02, _o.z);
  }

  // status strip (ore / pop / toast) floating beyond the table, always readable, world-fixed
  const sP = makePanel(1.6, 0.32, 1024, 205, true); sP.mesh.visible = false; scene.add(sP.mesh);
  let toastText = '', toastUntil = 0, toastKind = 'info', objective = null;
  VR.toast = (t, k) => { toastText = t; toastKind = k || 'info'; toastUntil = performance.now() + 3500; VR.sDirty = true; };
  VR.objective = (title, text) => { objective = title ? { title, text } : null; VR.sDirty = true; };
  function drawStrip() {
    const c = sP.ctx, S = getS(), t = C.team; c.clearRect(0, 0, 1024, 205);
    rr(c, 0, 0, 1024, 205, 32); c.fillStyle = 'rgba(8,12,22,.82)'; c.fill();
    c.textBaseline = 'middle'; c.textAlign = 'left'; c.font = '700 48px system-ui, sans-serif'; c.fillStyle = '#7fe8ff'; c.fillText(`◆ ${Math.floor(S.team[t].ore)}`, 36, 56);
    const pop = S.pop(t), cap = S.popCap(t); c.fillStyle = pop >= cap ? '#ffd24a' : '#eaf2ff'; c.fillText(`Pop ${pop}/${cap}`, 280, 56); c.fillStyle = '#eaf2ff'; c.fillText(`${Math.floor(S.time / 60)}:${String(Math.floor(S.time % 60)).padStart(2, '0')}`, 600, 56);
    const showToast = performance.now() < toastUntil;
    c.font = '600 38px system-ui, sans-serif'; c.fillStyle = showToast ? (toastKind === 'bad' ? '#ff8a7a' : toastKind === 'warn' ? '#ffd24a' : '#ffffff') : '#b9d4ff';
    const line = showToast ? toastText : objective ? objective.title.toUpperCase() + ' — ' + objective.text : G.paused ? 'Paused' : '';
    let fs = 38; c.font = `600 ${fs}px system-ui, sans-serif`; while (c.measureText(line).width > 950 && fs > 22) { fs -= 2; c.font = `600 ${fs}px system-ui, sans-serif`; }
    c.fillText(line, 36, 142); sP.tex.needsUpdate = true;
  }
  function placeStrip() {
    const far = T.scale <= 1.6, z = far ? Math.min(-3.1, T.z - 1.75 * T.scale) : -2.7, yy = far ? T.y + 0.55 : 1.4;
    sP.mesh.position.set(0, yy, z); sP.mesh.lookAt(0, yy - 0.15, 0.6);
  }
  VR.placeStrip = placeStrip;

  // ---------------------------------------------------------------- aim (waypoint + path preview), brush, drag shapes
  const press = [null, null];
  let aim = { key: '', path: null, t: 0 };
  VR.aimOn = (pick, idx) => {
    const V = getView(), S = getS(); if (!V.setAim) return;
    const us = C.units();
    if (C.buildType && pick && (pick.kind === 'ground' || pick.gx != null)) {
      const g = pick.kind === 'ground' ? pick : { x: pick.gx, z: pick.gz }, { cx, cz } = C.siteFor(g.x, g.z);
      V.setGhost(C.buildType, cx, cz, S.canPlace(C.team, C.buildType, cx, cz)); V.setAim(null); return;
    } else V.setGhost(null);
    if (!us.length || !pick) { V.setAim(null); return; }
    const kind = pick.kind === 'unit' || pick.kind === 'bld' ? (pick.ent.team !== C.team ? 'attack' : 'move') : pick.kind === 'node' ? 'gather' : C.amoveArmed ? 'attack' : 'move';
    const key = kind + Math.round(pick.x * 2) + ',' + Math.round(pick.z * 2); let path = aim.path;
    if (key !== aim.key && performance.now() - aim.t > 160) { aim = { key, t: performance.now(), path: null }; const u = us[0]; const p = S.nav.path(u.x, u.z, pick.x, pick.z); aim.path = p ? [{ x: u.x, z: u.z }, ...p] : null; path = aim.path; }
    V.setAim({ x: pick.x, z: pick.z, kind, path });
  };

  const brushR = 0.055;                                   // metres: radius of the "hand" you sweep through the diorama
  function brushUpdate(idx) {
    const V = getView(), S = getS(), g = menu.grips[idx]; if (!g) return;
    g.getWorldPosition(_w); const L = V.toLocal(_w), rl = brushR / (CELL * T.scale);
    V.setBrush({ x: L.x, y: L.y, z: L.z }, rl);
    const ids = [];
    for (const u of S.units(C.team)) { const dy = S.map.heightAt(u.x, u.z) + 0.6 - L.y; if (Math.hypot(u.x - L.x, dy, u.z - L.z) < rl + u.r + 0.2 && !C.sel.has(u.id)) ids.push(u.id); }
    if (ids.length) { C.set(ids, { add: true, quiet: true }); sfx.select(); menu.hapticPulse(menu.controllers[idx]); }
  }

  // ---------------------------------------------------------------- hover / pointing, per controller
  const target = [null, null];                            // what each controller points at this frame
  function pointer(i) {
    const c = menu.controllers[i]; c.updateWorldMatrix(true, false); c.matrixWorld.decompose(_o, _q, _s); _d.set(0, 0, -1).applyQuaternion(_q).normalize();
    return { o: _o.clone(), d: _d.clone() };
  }
  const mapHand = () => menu.controllers.findIndex((c) => c.userData.hand === VR.hand);
  VR.pointAt = (i) => {
    const V = getView(), r = pointer(i), out = { i, r, kind: 'none', t: 1e9 };
    // panels first (nearest wins against the board)
    const hw = hitPanel(wP, r.o, r.d); if (hw) { out.kind = 'wpanel'; out.t = hw.t; out.panel = hw; }
    const mh = mapHand();
    if (i !== mh && mapP.mesh.visible) { const hm = hitPanel(mapP, r.o, r.d); if (hm && hm.t < out.t) { out.kind = 'mpanel'; out.t = hm.t; out.panel = hm; } }
    if (!wSpec || !wP.mesh.visible) {
      const { o, d } = V.localRay(r.o, r.d), pk = V.pick(o, d, { team: C.team, pad: 0.22 });
      if (pk) { const wt = pk.t * T.scale * CELL; if (wt < out.t) { out.kind = 'board'; out.t = wt; out.pick = pk; out.local = { o, d }; } }
    }
    return out;
  };
  const regionAt = (P, px, py) => P.regions.find((b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h && !b.disabled);

  // ---------------------------------------------------------------- trigger / grip / buttons
  const lastTap = { id: 0, t: 0 };
  function inFrustum(u) { const fr = new THREE.Frustum(), m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); fr.setFromProjectionMatrix(m); return (uu) => { const V = getView(); return fr.containsPoint(V.toWorld(_v.set(uu.x, getS().map.heightAt(uu.x, uu.z) + 0.5, uu.z))); }; }
  VR.triggerDown = (i) => {
    const tg = VR.pointAt(i); press[i] = { t0: performance.now(), tg, pts: [], dragging: false, region: null, mapStart: null };
    const p = press[i];
    if (tg.kind === 'mpanel') { const rg = regionAt(mapP, tg.panel.px, tg.panel.py); p.region = rg; if (rg && rg.map) { const cell = getMini().toCell(tg.panel.px, tg.panel.py, mapRect, mapRot()); p.mapStart = cell; miniDrag = { x0: cell.x, z0: cell.z, x1: cell.x, z1: cell.z, on: false }; } }
    else if (tg.kind === 'wpanel') p.region = regionAt(wP, tg.panel.px, tg.panel.py);
    else if (tg.kind === 'board') { const g = tg.pick.kind === 'ground' ? tg.pick : tg.pick.gx != null ? { x: tg.pick.gx, z: tg.pick.gz } : null; if (g) p.start = { x: g.x, z: g.z }; p.startPick = tg.pick; }
    VR.dirty = true;
  };
  VR.triggerUp = (i) => {
    const p = press[i]; press[i] = null; if (!p) return;
    const V = getView(), S = getS(), tg = VR.pointAt(i), dur = performance.now() - p.t0;
    getView().setDragShape(null);
    if (p.mapStart) {                                                     // mini map: drag = box select, click = send / jump
      const dg = miniDrag; miniDrag = null; VR.dirty = true; C.miniUsed = (C.miniUsed || 0) + 1;
      if (dg && dg.on) { C.selectRect(dg.x0, dg.z0, dg.x1, dg.z1, false); menu.hapticPulse(menu.controllers[i]); return; }
      const cell = p.mapStart, x = clamp(cell.x, 0.8, N - 0.8), z = clamp(cell.z, 0.8, N - 0.8);
      if (C.miniMode === 'view' || (!C.units().length && !C.buildType)) { VR.jumpTo(x, z); menu.hapticPulse(menu.controllers[i]); return; }
      const near = (list, rad) => list.map((e) => ({ e, d: Math.hypot(e.x - x, e.z - z) })).filter((q) => q.d < rad).sort((a, b) => a.d - b.d)[0];
      const foe = near(S.units(1 - C.team).filter((u) => S.visibleTo(C.team, u)).concat(S.buildings(1 - C.team).filter((b) => S.cellVis(C.team, b.x, b.z) >= 1)), 2.2);
      const node = near(S.map.nodes.filter((n) => n.amount > 0 && S.cellVis(C.team, n.x, n.z) >= 1), 1.6);
      const pk = foe ? { kind: foe.e.isB ? 'bld' : 'unit', ent: foe.e, x: foe.e.x, z: foe.e.z } : node ? { kind: 'node', node: node.e, x: node.e.x, z: node.e.z } : { kind: 'ground', x, z };
      C.commandAt(pk); menu.hapticPulse(menu.controllers[i]); return;
    }
    if (tg.kind === 'mpanel' || p.tg.kind === 'mpanel') { const rg = tg.panel ? regionAt(mapP, tg.panel.px, tg.panel.py) : null; if (rg && rg === p.region && rg.act) { if (rg.hold && dur > 600) rg.hold(); else rg.act(); menu.hapticPulse(menu.controllers[i]); VR.dirty = true; } return; }
    if (p.tg.kind === 'wpanel') { const rg = tg.panel ? regionAt(wP, tg.panel.px, tg.panel.py) : null; if (rg && rg === p.region && rg.act) { menu.hapticPulse(menu.controllers[i]); rg.act(); } return; }
    if (p.tg.kind !== 'board') return;
    if (p.dragging) {                                                      // finished a terrain drag: box or lasso select
      if (p.shape === 'lasso' && p.pts.length > 3) C.selectPoly(p.pts, false); else if (p.start) { const e = p.pts[p.pts.length - 1] || p.start; C.selectRect(p.start.x, p.start.z, e.x, e.z, false); }
      menu.hapticPulse(menu.controllers[i]); return;
    }
    const pk = tg.kind === 'board' ? tg.pick : p.startPick; if (!pk) return;
    const own = pk.ent && pk.ent.team === C.team;
    if (own) {
      const now = performance.now();
      if (!pk.ent.isB && lastTap.id === pk.ent.id && now - lastTap.t < 450) { C.selectType(pk.ent.type, inFrustum()); lastTap.id = 0; menu.hapticPulse(menu.controllers[i]); return; }
      lastTap.id = pk.ent.id; lastTap.t = now; C.set([pk.ent.id]); menu.hapticPulse(menu.controllers[i]); return;
    }
    if (C.units().length || C.blds().length || C.buildType) { C.commandAt(pk.kind === 'ground' || pk.kind === 'node' || pk.ent ? pk : { kind: 'ground', x: pk.gx ?? pk.x, z: pk.gz ?? pk.z }); menu.hapticPulse(menu.controllers[i]); }
    else if (pk.kind === 'ground') C.clear();
  };
  VR.squeeze = (i, down) => {
    VR.brush = down ? i : (VR.brush === i ? false : VR.brush);
    if (down) { if (menu.controllers.some((c, j) => j !== i && false)) { /* reserved */ } C.clear(); }
    else { getView().setBrush(null); if (C.sel.size) menu.hapticPulse(menu.controllers[i]); }
  };

  // control groups on the right controller's A / B (hold to assign, tap to recall); left stick flick = groups 3 / 4
  const btn = { a: { down: 0, held: false }, b: { down: 0, held: false } }, stickLatch = { l: false, r: false };
  function pollButtons(now) {
    const session = renderer.xr.getSession && renderer.xr.getSession(); if (!session) return;
    for (const src of session.inputSources) {
      const gp = src.gamepad; if (!gp) continue;
      if (src.handedness === 'right') for (const [k, idx, g] of [['a', 4, 1], ['b', 5, 2]]) {
        const p = !!(gp.buttons[idx] && gp.buttons[idx].pressed), s = btn[k];
        if (p && !s.down) { s.down = now; s.held = false; }
        else if (p && s.down && !s.held && now - s.down > 600) { s.held = true; C.assignGroup(g); const c = menu.controllers.find((q) => q.userData.hand === 'right'); if (c) menu.hapticPulse(c); }
        else if (!p && s.down) { if (!s.held) C.recallGroup(g); s.down = 0; }
      }
      if (src.handedness === 'left' && gp.axes.length >= 4) {
        const x = gp.axes[2];
        if (Math.abs(x) < 0.3) { stickLatch.l = stickLatch.r = false; }
        else if (x < -0.75 && !stickLatch.l) { stickLatch.l = true; C.recallGroup(3); } else if (x > 0.75 && !stickLatch.r) { stickLatch.r = true; C.recallGroup(4); }
      }
    }
  }

  // ---------------------------------------------------------------- view jump (stepped + faded; the player never moves)
  VR.jumpTo = (x, z) => {
    const apply = () => {
      const R = T.yaw, c = Math.cos(R), s = Math.sin(R), k = CELL * T.scale, dx = (x - N / 2) * k, dz = (z - N / 2) * k;
      // root.pos + Ry(yaw) * (P - centre) * k  must equal FRONT point
      const rx = c * dx + s * dz, rz = -s * dx + c * dz;
      T.x = 0 - rx; T.z = FRONT.z - rz; placeBoard(); VR.placeStrip();
    };
    comfort.fade(apply);
  };
  VR.scaleStep = (dir) => {
    const i = VR.scaleIdx ?? SCALE_STEPS.indexOf(T.scale), j = clamp((i < 0 ? 1 : i) + dir, 0, SCALE_STEPS.length - 1); if (j === i) return;
    VR.scaleIdx = j;
    const apply = () => {
      const V = getView(), P = VR.viewCentre(), prev = T.scale; T.scale = SCALE_STEPS[j];
      T.y = T.scale >= 4 ? 0.0 : 0.85;                                           // ground view: stand IN the world
      const R = T.yaw, c = Math.cos(R), s = Math.sin(R), k = CELL * T.scale, dx = (P.x - N / 2) * k, dz = (P.z - N / 2) * k;
      const fz = T.scale >= 4 ? -0.5 : FRONT.z;
      T.x = -(c * dx + s * dz); T.z = fz - (-s * dx + c * dz); placeBoard(); VR.placeStrip();
    };
    comfort.fade(apply);
  };

  // ---------------------------------------------------------------- per frame
  let strip = 0;
  VR.enter = () => {
    VR.ready = false; VR.scaleIdx = null; mapP.mesh.visible = true; sP.mesh.visible = true; scene.add(sP.mesh);
    VR.placeStrip(); VR.dirty = true; VR.sDirty = true;
    VR.showSpec({ title: 'Before you start', lines: ['Clear about 2 metres of floor around you and stand at the ring on the floor, at the edge of the table.', 'You are never moved by the game: walk around the table, or use the menu to rotate, raise and scale it.', 'Pull a trigger to select; hold grip and sweep your hand to brush-select; the map on your left controller shows everything.'], buttons: [{ text: "I'm ready", action: () => { VR.ready = true; VR.showSpec(null); if (onReady) onReady(); }, big: true }] });
  };
  VR.exit = () => { VR.scaleIdx = null; mapP.mesh.visible = false; sP.mesh.visible = false; wP.mesh.visible = false; getView() && (getView().setBrush(null), getView().setDragShape(null), getView().setAim && getView().setAim(null), getView().setGhost(null)); press[0] = press[1] = null; };
  menu.onSelectStart((c, hand, idx) => { if (isXR()) VR.triggerDown(idx); });
  menu.onSelectEnd((c, hand, idx) => { if (isXR()) VR.triggerUp(idx); });
  menu.onSqueeze((c, hand, idx, down) => { if (isXR() && VR.ready) VR.squeeze(idx, down); });
  VR.sceneAdd = () => { mapP.mesh.userData.vr = 1; };

  VR.update = (dt) => {
    if (!isXR()) return;
    const now = performance.now(), V = getView(); if (!V) return;
    // attach the map panel to the left controller, tilted toward the eyes
    const mi = mapHand(), holder = mi >= 0 ? menu.controllers[mi] : menu.controllers[1];
    if (mapP.mesh.parent !== holder) holder.add(mapP.mesh);
    mapP.mesh.position.set(0, PANEL_H * 0.5 + 0.03, -0.02);
    camera.getWorldPosition(_o); mapP.mesh.lookAt(_o);                          // faces the head; stays with the hand
    mapP.mesh.visible = true;
    if (VR.needPlace > 0 && --VR.needPlace === 0) placeFloating(wP.mesh, 1.15, 0.0);
    pollButtons(now);
    // pointing
    const ptr = menu.controllers.map((c, i) => (c.userData.overMenu ? null : VR.pointAt(i)));
    VR.hoverBtn = null;
    ptr.forEach((tg, i) => {
      const ray = menu.rays[i];
      if (!tg) { target[i] = null; return; }
      target[i] = tg;
      if (tg.kind === 'board' || tg.kind === 'mpanel' || tg.kind === 'wpanel') ray.setLength(clamp(tg.t, 0.1, 6)); else ray.setLength(2.5);
      if (tg.kind === 'mpanel') { const rg = regionAt(mapP, tg.panel.px, tg.panel.py); if (rg && rg.id) VR.hoverBtn = rg.id; }
      if (tg.kind === 'wpanel') { const rg = regionAt(wP, tg.panel.px, tg.panel.py); if (rg) VR.hoverBtn = rg.id; }
    });
    // hover glow + aim preview come from the pointing (non-map) controller
    let aimIdx = ptr.findIndex((tg, i) => tg && tg.kind === 'board' && i !== mapHand());
    if (aimIdx < 0) aimIdx = ptr.findIndex((tg) => tg && tg.kind === 'board');
    C.hoverId = aimIdx >= 0 && ptr[aimIdx].pick && ptr[aimIdx].pick.ent ? ptr[aimIdx].pick.ent.id : 0;
    if (VR.ready && !wP.mesh.visible) VR.aimOn(aimIdx >= 0 ? ptr[aimIdx].pick : null, aimIdx); else { V.setAim && V.setAim(null); }
    // drags in progress
    press.forEach((p, i) => {
      if (!p) return; const tg = target[i]; if (!tg) return;
      if (p.mapStart && miniDrag && tg.kind === 'mpanel') {
        const cell = getMini().toCell(tg.panel.px, tg.panel.py, mapRect, mapRot()); miniDrag.x1 = cell.x; miniDrag.z1 = cell.z;
        if (Math.hypot(cell.x - miniDrag.x0, cell.z - miniDrag.z0) > 2.2) miniDrag.on = true; VR.dirty = true;
      } else if (p.tg.kind === 'board' && p.start) {
        const g = tg.kind === 'board' ? (tg.pick.kind === 'ground' ? tg.pick : tg.pick.gx != null ? { x: tg.pick.gx, z: tg.pick.gz } : null) : null;
        if (g) {
          p.pts.push({ x: g.x, z: g.z }); if (p.pts.length > 120) p.pts.shift();
          if (!p.dragging && Math.hypot(g.x - p.start.x, g.z - p.start.z) > 1.4) { p.dragging = true; p.shape = C.selMode; if (p.shape === 'lasso') p.pts = [p.start, ...p.pts.slice(-3)]; }
          if (p.dragging) {
            if (p.shape === 'lasso') V.setDragShape(p.pts); else { const e = g; V.setDragShape([{ x: p.start.x, z: p.start.z }, { x: e.x, z: p.start.z }, { x: e.x, z: e.z }, { x: p.start.x, z: e.z }]); }
          }
        }
      }
    });
    if (VR.brush !== false && VR.ready) brushUpdate(VR.brush);
    // redraw throttled
    if (VR.dirty || now > redrawAt || VR.hoverBtn !== VR._hb) { redrawAt = now + 110; VR._hb = VR.hoverBtn; VR.dirty = false; drawMapPanel(now); }
    if (wP.mesh.visible && wSpec) drawWorld(wSpec, VR.hoverBtn);
    if (VR.sDirty || now > strip) { strip = now + 500; VR.sDirty = false; drawStrip(); }
    // regions' act: tab/page clicks are handled via act on the regions list
  };
  // map panel buttons: tab + generic act are dispatched in triggerUp via region.act; the tab button toggles the page
  const baseDraw = drawMapPanel;
  Object.defineProperty(VR, 'mapPanel', { get: () => mapP });
  VR.wPanel = wP; VR.sPanel = sP; VR.press = press;
  scene.add(wP.mesh);
  return VR;
}
