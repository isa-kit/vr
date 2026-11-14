// ============================ rts/desk.js — desktop mouse/keyboard and phone touch input + RTS camera ============================
// Left-drag box select · right-click move/attack/gather · WASD/edge pan · Q/E rotate · wheel zoom · 1-9 groups (Ctrl/hold to assign)
// Touch: tap = select / command, drag = box select, two fingers = pan + pinch zoom + twist, mini map tap = jump.
import * as THREE from 'three';
import { N } from './sim.js?v=rts4';
import { CELL } from './gfx.js?v=rts4';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function createDesk({ canvas, camera, getView, getS, C, hud, mini, isActive, isTouch, onMenu, onPause }) {
  const D = { cam: { x: 14, z: 40, yaw: 0.7, pitch: 0.95, dist: 1.9 }, edgePan: true };
  const keys = new Set(), ptr = new Map();
  let drag = null, lastClick = { t: 0, id: 0 }, mouseIn = false, mx = 0, my = 0, holdKey = null, miniDrag = false, pinch = null;
  const _v = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3(), ray = new THREE.Raycaster();

  D.center = (x, z) => { D.cam.x = clamp(x, 0, N); D.cam.z = clamp(z, 0, N); };
  D.frame = (team) => { const s = C.hqPos(); const dir = team === 0 ? 1 : -1; D.cam.x = s.x + dir * 4; D.cam.z = s.z - dir * 3; D.cam.yaw = team === 0 ? 0.6 : 0.6 + Math.PI; D.cam.dist = 1.55; D.cam.pitch = 0.95; };
  D.apply = () => {
    const V = getView(); if (!V) return;
    const c = D.cam, h = getS().map.heightAt(clamp(c.x, 0, N - 0.01), clamp(c.z, 0, N - 0.01));
    const T = V.toWorld(_v.set(c.x, h, c.z)), s = V.root.scale.x / CELL, k = c.dist;
    camera.position.set(T.x + Math.sin(c.yaw) * Math.cos(c.pitch) * k, T.y + Math.sin(c.pitch) * k, T.z + Math.cos(c.yaw) * Math.cos(c.pitch) * k);
    camera.lookAt(T); camera.near = 0.02; camera.far = 120; camera.updateProjectionMatrix();
  };
  const screenRay = (cx, cy) => {
    const V = getView(), r = canvas.getBoundingClientRect();
    ray.setFromCamera({ x: ((cx - r.left) / r.width) * 2 - 1, y: -((cy - r.top) / r.height) * 2 + 1 }, camera);
    return V.localRay(ray.ray.origin, ray.ray.direction);
  };
  D.pickAt = (cx, cy, opts = {}) => { const V = getView(); camera.updateMatrixWorld(); const { o, d } = screenRay(cx, cy); return V.pick(o, d, { team: C.team, pad: isTouch ? 0.3 : 0, ...opts }); };
  D.viewPoly = () => {
    const V = getView(), r = canvas.getBoundingClientRect(), out = []; camera.updateMatrixWorld();
    for (const [sx, sy] of [[0.04, 0.12], [0.96, 0.12], [0.96, 0.9], [0.04, 0.9]]) {
      ray.setFromCamera({ x: sx * 2 - 1, y: -(sy * 2 - 1) }, camera); const { o, d } = V.localRay(ray.ray.origin, ray.ray.direction); const g = V.ground(o, d);
      if (g) out.push({ x: clamp(g.x, 0, N), z: clamp(g.z, 0, N) }); else { const far = 70; out.push({ x: clamp(o.x + d.x * far, 0, N), z: clamp(o.z + d.z * far, 0, N) }); }
    }
    return out;
  };
  const inView = (u) => { const V = getView(); camera.updateMatrixWorld(); const p = V.toWorld(_v.set(u.x, getS().map.heightAt(u.x, u.z) + 0.5, u.z)).project(camera); return p.z < 1 && Math.abs(p.x) <= 1.02 && Math.abs(p.y) <= 1.02; };
  const screenBoxSelect = (x0, y0, x1, y1, add) => {
    const V = getView(), r = canvas.getBoundingClientRect(); camera.updateMatrixWorld();
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1), ids = [];
    for (const u of getS().units(C.team)) {
      const p = V.toWorld(_v.set(u.x, getS().map.heightAt(u.x, u.z) + 0.6, u.z)).project(camera);
      const sx = r.left + (p.x * 0.5 + 0.5) * r.width, sy = r.top + (-p.y * 0.5 + 0.5) * r.height;
      if (p.z < 1 && sx >= ax && sx <= bx && sy >= ay && sy <= by) ids.push(u.id);
    }
    if (!ids.length) { const b = getS().buildings(C.team); /* a tiny box over a building selects it */ if (Math.abs(bx - ax) < 14 && Math.abs(by - ay) < 14) return false; }
    if (!ids.length) { if (!add) C.clear(); return true; }
    C.set(ids, { add }); return true;
  };

  const rect = () => canvas.getBoundingClientRect();
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (!isActive()) return; canvas.setPointerCapture(e.pointerId);
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), type: e.pointerType, btn: e.button });
    if (e.pointerType === 'touch') {
      if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; drag = null; hud.showBox(null); }
      else drag = { x0: e.clientX, y0: e.clientY, on: false, touch: true };
      return;
    }
    if (e.button === 0) { drag = { x0: e.clientX, y0: e.clientY, on: false, shift: e.shiftKey || e.ctrlKey }; }
    else if (e.button === 2) { const pk = D.pickAt(e.clientX, e.clientY); C.amoveArmed = C.amoveArmed; if (C.buildType) { C.cancelModes(); return; } C.commandAt(pk); }
    else if (e.button === 1) { drag = { rotate: true, x: e.clientX, y: e.clientY }; e.preventDefault(); }
  });
  canvas.addEventListener('pointermove', (e) => {
    mx = e.clientX; my = e.clientY; mouseIn = true;
    if (C.buildType && e.pointerType !== 'touch' && !drag) { const pk = D.pickAt(e.clientX, e.clientY, { units: false }); const V = getView(); if (pk) { const g = pk.kind === 'ground' ? pk : { x: pk.gx ?? pk.x, z: pk.gz ?? pk.z }; const { cx, cz } = C.siteFor(g.x, g.z); V.setGhost(C.buildType, cx, cz, getS().canPlace(C.team, C.buildType, cx, cz)); } }
    else if (!C.buildType && getView() && e.pointerType !== 'touch') { const pk = (!drag) ? D.pickAt(e.clientX, e.clientY) : null; C.hoverId = pk && pk.ent ? pk.ent.id : 0; }
    const p = ptr.get(e.pointerId);
    if (p) { p.x = e.clientX; p.y = e.clientY; }
    if (e.pointerType === 'touch') {
      if (pinch && ptr.size >= 2) {
        const [a, b] = [...ptr.values()], d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        D.cam.dist = clamp(D.cam.dist * (pinch.d / Math.max(20, d)), 0.45, 5.5);
        D.cam.yaw -= (ang - pinch.ang) * 0.9; panScreen(cx - pinch.cx, cy - pinch.cy);
        pinch = { d, ang, cx, cy }; return;
      }
    }
    if (!drag) return;
    if (drag.rotate) { D.cam.yaw -= (e.clientX - drag.x) * 0.006; D.cam.pitch = clamp(D.cam.pitch + (e.clientY - drag.y) * 0.004, 0.35, 1.45); drag.x = e.clientX; drag.y = e.clientY; return; }
    if (!drag.on && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > (drag.touch ? 12 : 6)) drag.on = true;
    if (drag.on) { drag.x1 = e.clientX; drag.y1 = e.clientY; hud.showBox(drag.x0, drag.y0, drag.x1, drag.y1); }
  });
  const end = (e) => {
    const p = ptr.get(e.pointerId); ptr.delete(e.pointerId);
    if (e.pointerType === 'touch' && pinch) { if (ptr.size < 2) pinch = null; drag = null; return; }
    if (!drag) return;
    if (drag.rotate) { drag = null; return; }
    const d = drag; drag = null; hud.showBox(null);
    if (e.type === 'pointercancel') return;
    if (d.on) { screenBoxSelect(d.x0, d.y0, e.clientX, e.clientY, d.shift); return; }
    clickAt(e.clientX, e.clientY, d, e.pointerType === 'touch');
  };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { mouseIn = false; });
  canvas.addEventListener('wheel', (e) => { if (!isActive()) return; e.preventDefault(); D.cam.dist = clamp(D.cam.dist * Math.exp(e.deltaY * 0.0012), 0.45, 5.5); }, { passive: false });

  function clickAt(x, y, d, touch) {
    const pk = D.pickAt(x, y); if (!pk) return;
    if (C.buildType) { if (pk.kind === 'ground' || pk.gx != null) { C.placeAt(pk.kind === 'ground' ? pk.x : pk.gx, pk.kind === 'ground' ? pk.z : pk.gz); } return; }
    if (C.amoveArmed && pk.kind === 'ground') { C.commandAt(pk); return; }
    const own = pk.ent && pk.ent.team === C.team;
    if (own) {
      const now = performance.now();
      if (!pk.ent.isB && lastClick.id === pk.ent.id && now - lastClick.t < 380) { C.selectType(pk.ent.type, inView); lastClick = { t: 0, id: 0 }; return; }
      lastClick = { t: now, id: pk.ent.id };
      if (d.shift) C.toggle(pk.ent.id); else C.set([pk.ent.id]);
      return;
    }
    if (touch && C.units().length) { C.commandAt(pk); return; }                 // phone: tap = command when something is selected
    if (pk.kind === 'unit' || pk.kind === 'bld') { /* enemy click on desktop: inspect only */ return; }
    if (!d.shift && !touch) C.clear();
  }
  function panScreen(dx, dy) {                                                   // drag the ground under the fingers
    const k = D.cam.dist * 1.3 / Math.max(300, innerHeight) / CELL, c = Math.cos(D.cam.yaw), s = Math.sin(D.cam.yaw);
    D.cam.x += (-s * dy - c * dx) * k; D.cam.z += (-c * dy + s * dx) * k; D.center(D.cam.x, D.cam.z);
  }

  // mini map (DOM canvas)
  const mc = hud.miniCanvas;
  const miniCell = (e) => { const r = mc.getBoundingClientRect(); return mini().toCell(e.clientX - r.left, e.clientY - r.top, { x: 0, y: 0, w: r.width, h: r.height }, 0); };
  mc.addEventListener('contextmenu', (e) => e.preventDefault());
  mc.addEventListener('pointerdown', (e) => {
    mc.setPointerCapture(e.pointerId); const c = miniCell(e);
    C.miniUsed = (C.miniUsed || 0) + 1;
    if (e.button === 2 || (isTouch && C.miniMode === 'send' && C.units().length)) { C.moveTo(clamp(c.x, 1, N - 1), clamp(c.z, 1, N - 1), e.shiftKey || C.amoveArmed); C.amoveArmed = false; return; }
    miniDrag = true; D.center(c.x, c.z);
  });
  mc.addEventListener('pointermove', (e) => { if (miniDrag) { const c = miniCell(e); D.center(c.x, c.z); } });
  mc.addEventListener('pointerup', () => { miniDrag = false; }); mc.addEventListener('pointercancel', () => { miniDrag = false; });

  // keyboard
  addEventListener('keydown', (e) => {
    if (!isActive() || e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (e.repeat && /[0-9]/.test(k)) return;
    if (/^[0-9]$/.test(k)) { const i = +k; if (e.ctrlKey || e.metaKey) { C.assignGroup(i); e.preventDefault(); } else if (!holdKey) { holdKey = { i, t: performance.now() }; } return; }
    keys.add(k);
    if (k === 'x') C.armAttackMove(!C.amoveArmed);
    else if (k === 'c' && C.units().length) C.stop();
    else if (k === 'h') C.setStance('hold');
    else if (k === 'g') C.setStance('defend');
    else if (k === 'escape') { if (C.buildType || C.amoveArmed) C.cancelModes(); else onMenu(); }
    else if (k === 'p') onPause();
    else if (k === ' ') { e.preventDefault(); const a = C.alert; if (a) D.center(a.x, a.z); else { const u = C.units(); if (u.length) D.center(u[0].x, u[0].z); } }
    else if (k === '.') C.selectArmy(); else if (k === ',') C.selectIdleWorkers();
    else if (k === 'f') { const f = ['box', 'line', 'wedge']; C.setFormation(f[(f.indexOf(C.formation) + 1) % 3]); C.say('Formation: ' + C.formation); }
    else if (k === 'b' && C.units().some((u) => u.type === 'worker')) C.beginBuild('barracks');
    else if (k === 'v' && C.units().some((u) => u.type === 'worker')) C.beginBuild('depot');
  });
  addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (/^[0-9]$/.test(k) && holdKey && holdKey.i === +k) { if (performance.now() - holdKey.t > 600) C.assignGroup(holdKey.i); else C.recallGroup(holdKey.i); holdKey = null; return; }
    keys.delete(k);
  });
  addEventListener('blur', () => keys.clear());

  D.update = (dt) => {
    if (!isActive()) return;
    const c = D.cam, sp = (c.dist * 17 + 4) * dt, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    let fx = 0, fz = 0;
    if (keys.has('w') || keys.has('arrowup')) fz -= 1; if (keys.has('s') || keys.has('arrowdown')) fz += 1;
    if (keys.has('a') || keys.has('arrowleft')) fx -= 1; if (keys.has('d') || keys.has('arrowright')) fx += 1;
    if (mouseIn && D.edgePan && !drag && !isTouch) { const r = rect(); if (mx < r.left + 5) fx -= 1; if (mx > r.right - 5) fx += 1; if (my < r.top + 5) fz -= 1; if (my > r.bottom - 5) fz += 1; }
    if (keys.has('q')) c.yaw += dt * 1.6; if (keys.has('e')) c.yaw -= dt * 1.6;
    if (keys.has('+') || keys.has('=')) c.dist = clamp(c.dist * (1 - dt * 1.4), 0.45, 5.5); if (keys.has('-')) c.dist = clamp(c.dist * (1 + dt * 1.4), 0.45, 5.5);
    if (fx || fz) { c.x += (fx * cs + fz * sn) * sp; c.z += (-fx * sn + fz * cs) * sp; D.center(c.x, c.z); }
    if (holdKey && performance.now() - holdKey.t > 600 && !holdKey.done) { C.assignGroup(holdKey.i); holdKey.done = true; }
  };
  return D;
}
