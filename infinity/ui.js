// In-world 3D control panel for WebXR.
// A DOM HUD is invisible inside a headset, so the panel is real geometry you
// point at — mouse ray on desktop, controller ray in VR. Buttons are plane
// meshes with canvas-texture labels; main.js raycasts against `hitTargets`.

import * as THREE from 'three';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeTextTexture(label, opts = {}) {
  const { active = false, accent = false, plain = false } = opts;
  const cw = 256, ch = 128;
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, cw, ch);

  if (!plain) {
    const bg = active ? 'rgba(255,214,150,0.94)'
             : accent ? 'rgba(104,132,246,0.90)'
             : 'rgba(26,30,46,0.92)';
    ctx.fillStyle = bg;
    roundRect(ctx, 6, 6, cw - 12, ch - 12, 24);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.20)';
    roundRect(ctx, 6, 6, cw - 12, ch - 12, 24);
    ctx.stroke();
  }

  ctx.fillStyle = plain ? '#ffe9c2' : active ? '#1a1407' : '#eef1ff';
  ctx.font = (plain ? '600 40px' : '600 46px') + ' system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cw / 2, ch / 2 + 2);

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function makeButton(label, w, h, opts = {}) {
  const mat = new THREE.MeshBasicMaterial({
    map: makeTextTexture(label, opts),
    transparent: true,
    depthTest: false,   // panel always draws over the additive lights
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.renderOrder = 999;
  mesh.userData = {
    label, opts, w, h,
    redraw: (l, o) => {
      mat.map.dispose();
      mat.map = makeTextTexture(l ?? label, o ?? opts);
      mat.needsUpdate = true;
    },
  };
  return mesh;
}

// handlers: { setPattern(id), bump(param, dir), randomize(), hide() }
export function buildControlPanel(handlers) {
  const group = new THREE.Group();

  // bezel + base lip so it reads as a physical tablet propped on a stand
  const frame = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.78),
    new THREE.MeshBasicMaterial({ color: 0x1b2236, transparent: true, opacity: 0.96, depthTest: false })
  );
  frame.renderOrder = 988; frame.position.z = -0.004; group.add(frame);

  const lip = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.07),
    new THREE.MeshBasicMaterial({ color: 0x2b3454, transparent: true, opacity: 0.96, depthTest: false })
  );
  lip.renderOrder = 989; lip.position.set(0, -0.405, -0.003); group.add(lip);

  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(0.84, 0.68),
    new THREE.MeshBasicMaterial({ color: 0x090c16, transparent: true, opacity: 0.76, depthTest: false })
  );
  bg.renderOrder = 990;
  group.add(bg);

  const hit = [];
  const place = (mesh, x, y) => { mesh.position.set(x, y, 0.002); group.add(mesh); return mesh; };

  place(makeButton('✦  Controls', 0.5, 0.1, { plain: true }), -0.02, 0.28);

  // pattern (type of diagram)
  const patterns = [['Random', 'random'], ['Grid', 'grid'], ['Diagonal', 'diagonal'], ['Jitter', 'jitter']];
  const pBtns = {};
  patterns.forEach(([lab, id], i) => {
    const b = makeButton(lab, 0.19, 0.085);
    b.userData.action = () => handlers.setPattern(id);
    place(b, -0.30 + i * 0.20, 0.135);
    hit.push(b);
    pBtns[id] = b;
  });

  // spacing + depth rows: readout + [-] [+]
  const mkRow = (y, label, param) => {
    const read = makeButton(label, 0.42, 0.09);
    place(read, -0.18, y);
    const minus = makeButton('–', 0.11, 0.09, { accent: true });
    minus.userData.action = () => handlers.bump(param, -1);
    place(minus, 0.18, y); hit.push(minus);
    const plus = makeButton('+', 0.11, 0.09, { accent: true });
    plus.userData.action = () => handlers.bump(param, 1);
    place(plus, 0.32, y); hit.push(plus);
    return read;
  };
  const spRead = mkRow(0.01, 'Spacing  8', 'spacing');
  const dpRead = mkRow(-0.11, 'Depth  120', 'depth');

  const rnd = makeButton('⟳  Randomize', 0.56, 0.1, { accent: true });
  rnd.userData.action = () => handlers.randomize();
  place(rnd, -0.11, -0.25); hit.push(rnd);

  const hide = makeButton('✕', 0.09, 0.09);
  hide.userData.action = () => handlers.hide();
  place(hide, 0.35, 0.28); hit.push(hide);

  group.userData.hitTargets = hit;

  return {
    group,
    hitTargets: hit,
    setReadout: (param, text) => (param === 'spacing' ? spRead : dpRead).userData.redraw(text),
    setActivePattern: (p) =>
      Object.entries(pBtns).forEach(([id, b]) => b.userData.redraw(b.userData.label, { active: id === p })),
  };
}
