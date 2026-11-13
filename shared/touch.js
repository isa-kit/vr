// ============================ shared/touch.js — phone / touch controls ============================
//
//   import { createTouch } from '../shared/touch.js';
//
//   const touch = createTouch({
//     canvas: renderer.domElement,
//     look: true,                                   // one-finger drag looks around (calls onLook). false for worlds that handle the canvas themselves
//     onLook: (dxPx, dyPx) => { yaw -= dxPx * 0.004; pitch -= dyPx * 0.004; },
//     stick: true,                                  // on-screen thumb-stick, bottom-left → touch.move.x / touch.move.y in −1..1 (y<0 = forward)
//     buttons: [{ id: 'up', label: '▲' }, { id: 'down', label: '▼' }],   // optional round buttons, bottom-right → touch.buttons.up (bool)
//   });
//   touch.isTouch                  // coarse pointer / touch-capable device (don't use pointer lock there)
//   touch.helpText(touchStr, deskStr)   // returns the right help line for this device
//   touch.pixelRatio(2)            // devicePixelRatio capped for the device (phones ≤ 1.5)
//   touch.rows()                   // menu rows: "Look by moving the phone" toggle (hidden if unsupported) — spread into createXRMenu rows
//   touch.gyro.on / touch.gyro.quat// when on: camera.quaternion = yawQuat(yawFromDrag) · touch.gyro.quat  (gyro.quat is level-referenced, no roll drift)
//   touch.onChange = () => menu.refresh()   // so the Phone-motion label updates after the permission prompt
//   touch.tick(dt)                 // optional per-frame (updates gyro quaternion)
//
// Also: the shared menu (xrmenu.js) already shows a 44px+ "☰ Menu" button on touch screens, and CSS here adds
// safe-area padding helpers: body gets class "is-touch" on touch devices; use env(safe-area-inset-*) in your own CSS.
// Add to <meta viewport>: viewport-fit=cover, and `touch-action: none` to the canvas (done here too).
// ===================================================================================================

import * as THREE from 'three';

export function createTouch({ canvas, look = true, onLook = null, stick = false, buttons = [] } = {}) {
  const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const T = { isTouch, move: { x: 0, y: 0 }, buttons: {}, gyro: { on: false, quat: new THREE.Quaternion(), supported: false } };
  if (isTouch) document.body.classList.add('is-touch');
  if (canvas) canvas.style.touchAction = 'none';
  T.helpText = (touchStr, deskStr) => (isTouch ? touchStr : deskStr);
  T.pixelRatio = (cap = 2) => Math.min(devicePixelRatio || 1, isTouch ? Math.min(cap, 1.5) : cap);

  const style = document.createElement('style');
  style.textContent = `
    .tc-stick{position:fixed;left:calc(env(safe-area-inset-left,0px) + 18px);bottom:calc(env(safe-area-inset-bottom,0px) + 18px);width:132px;height:132px;border-radius:50%;
      background:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.35);z-index:30;touch-action:none;-webkit-tap-highlight-color:transparent;backdrop-filter:blur(3px)}
    .tc-knob{position:absolute;left:50%;top:50%;width:58px;height:58px;margin:-29px 0 0 -29px;border-radius:50%;background:rgba(255,255,255,.55);box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none}
    .tc-btns{position:fixed;right:calc(env(safe-area-inset-right,0px) + 18px);bottom:calc(env(safe-area-inset-bottom,0px) + 18px);display:flex;flex-direction:column;gap:12px;z-index:30}
    .tc-btn{width:60px;height:60px;border-radius:50%;border:2px solid rgba(255,255,255,.4);background:rgba(255,255,255,.18);color:#fff;font:700 22px system-ui,sans-serif;touch-action:none;
      -webkit-tap-highlight-color:transparent;backdrop-filter:blur(3px)}
    .tc-btn.on{background:rgba(255,214,150,.75);color:#1a1407}
    @media (orientation:landscape) and (max-height:480px){.tc-stick{width:108px;height:108px}.tc-knob{width:48px;height:48px;margin:-24px 0 0 -24px}}`;
  document.head.appendChild(style);

  // ---------- thumb-stick ----------
  if (stick) {
    const base = document.createElement('div'); base.className = 'tc-stick';
    const knob = document.createElement('div'); knob.className = 'tc-knob'; base.appendChild(knob);
    document.body.appendChild(base);
    let pid = null;
    const set = (e) => {
      const r = base.getBoundingClientRect(), R = r.width / 2;
      let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
      const d = Math.hypot(dx, dy), k = d > R ? R / d : 1; dx *= k; dy *= k;
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      let x = dx / R, y = dy / R; const m = Math.hypot(x, y);
      if (m < 0.14) { x = 0; y = 0; }
      T.move.x = x; T.move.y = y;
    };
    const end = (e) => { if (e.pointerId !== pid) return; pid = null; knob.style.transform = ''; T.move.x = 0; T.move.y = 0; };
    base.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); pid = e.pointerId; base.setPointerCapture(pid); set(e); });
    base.addEventListener('pointermove', (e) => { if (e.pointerId === pid) { e.preventDefault(); set(e); } });
    base.addEventListener('pointerup', end); base.addEventListener('pointercancel', end);
    base.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---------- round buttons (hold = true) ----------
  if (buttons.length) {
    const wrap = document.createElement('div'); wrap.className = 'tc-btns'; document.body.appendChild(wrap);
    for (const b of buttons) {
      const el = document.createElement('button'); el.className = 'tc-btn'; el.textContent = b.label; el.setAttribute('aria-label', b.id);
      const down = (e) => { e.preventDefault(); e.stopPropagation(); T.buttons[b.id] = true; el.classList.add('on'); try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } };
      const up = () => { T.buttons[b.id] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      wrap.appendChild(el);
    }
  }

  // ---------- one-finger look ----------
  if (look && canvas && onLook) {
    let id = null, lx = 0, ly = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || id !== null) return;
      id = e.pointerId; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(id);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      onLook(e.clientX - lx, e.clientY - ly); lx = e.clientX; ly = e.clientY;
    });
    const up = (e) => { if (e.pointerId === id) id = null; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  }

  // ---------- look by moving the phone (off by default; iOS needs a permission tap) ----------
  const G = T.gyro;
  G.supported = isTouch && 'DeviceOrientationEvent' in window;
  let yaw0 = null;
  const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)), _z = new THREE.Vector3(0, 0, 1);
  let last = null;
  const onOri = (e) => { if (e.alpha !== null) last = e; };
  T.tick = () => {
    if (!G.on || !last) return;
    const orient = (screen.orientation && screen.orientation.angle ? screen.orientation.angle : (window.orientation || 0)) * Math.PI / 180;
    _e.set(THREE.MathUtils.degToRad(last.beta), THREE.MathUtils.degToRad(last.alpha), -THREE.MathUtils.degToRad(last.gamma), 'YXZ');
    _q.setFromEuler(_e).multiply(_q1).multiply(new THREE.Quaternion().setFromAxisAngle(_z, -orient));
    if (yaw0 === null) yaw0 = new THREE.Euler().setFromQuaternion(_q, 'YXZ').y;
    G.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw0).multiply(_q);   // heading relative to where you started
  };
  G.toggle = async () => {
    if (G.on) { G.on = false; removeEventListener('deviceorientation', onOri); return; }
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();        // iOS: must be inside a tap
        if (r !== 'granted') return;
      }
    } catch (e) { return; }
    yaw0 = null; last = null; addEventListener('deviceorientation', onOri); G.on = true;
  };
  T.rows = () => (G.supported ? [{ label: 'Look', cells: [{ text: () => (G.on ? 'Phone motion: On' : 'Phone motion: Off'), action: () => G.toggle().then(() => T.onChange && T.onChange()), active: () => G.on, w: 2 }] }] : []);
  return T;
}
