// ============================ Cloud Pairs — a lie-down VR memory game (Oortia) ============================
// Little clouds hang overhead in a grid. Turn two over (trigger / click / tap, or rest your aim on one in Hover mode);
// if they hide the same sky picture they stay open. Clear the sky in as few turns as you can.
import * as THREE from 'three';
import { createLieGame } from '../shared/lie.js?v=lie4';

const SIZES = [[3, 2], [4, 3], [4, 4], [5, 4]];
const ICONS = ['sun', 'moon', 'star', 'rainbow', 'bird', 'balloon', 'kite', 'drop', 'snow', 'planet'];
const KEY = 'oortia-cloudpairs-v1';
const G = { size: 0, open: [], moves: 0, found: 0, wait: 0, hover: false, done: false };
let K;

Promise.resolve().then(init).catch((e) => { console.error(e); const s = document.getElementById('status'); if (s) s.textContent = 'Could not start: ' + e.message; });

function iconTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, 256); bg.addColorStop(0, '#bfe1fb'); bg.addColorStop(1, '#eef7ff');
  g.fillStyle = bg; g.beginPath(); g.roundRect(8, 8, 240, 240, 40); g.fill();
  g.lineCap = 'round'; g.lineJoin = 'round';
  const C = 128;
  const circle = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  const starPath = (x, y, r1, r2, n) => { g.beginPath(); for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? r2 : r1; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.closePath(); };
  switch (kind) {
    case 'sun': g.strokeStyle = '#ffb703'; g.lineWidth = 12; for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.beginPath(); g.moveTo(C + Math.cos(a) * 62, C + Math.sin(a) * 62); g.lineTo(C + Math.cos(a) * 90, C + Math.sin(a) * 90); g.stroke(); } circle(C, C, 50, '#ffcf3f'); break;
    case 'moon': circle(C, C, 66, '#f4e7a1'); circle(C + 30, C - 18, 58, '#cfe6fa'); break;
    case 'star': g.fillStyle = '#ffd34d'; starPath(C, C + 6, 84, 36, 5); g.fill(); break;
    case 'rainbow': ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#7b5cd6'].forEach((col, i) => { g.strokeStyle = col; g.lineWidth = 14; g.beginPath(); g.arc(C, C + 50, 92 - i * 15, Math.PI, 0); g.stroke(); }); break;
    case 'bird': g.strokeStyle = '#2b3a55'; g.lineWidth = 14; g.beginPath(); g.moveTo(44, 110); g.quadraticCurveTo(86, 70, C, 128); g.quadraticCurveTo(170, 70, 212, 110); g.stroke(); break;
    case 'balloon': g.strokeStyle = '#555'; g.lineWidth = 4; g.beginPath(); g.moveTo(C, 170); g.quadraticCurveTo(C - 14, 200, C + 4, 236); g.stroke(); g.fillStyle = '#ef476f'; g.beginPath(); g.ellipse(C, 108, 56, 66, 0, 0, Math.PI * 2); g.fill(); circle(C - 20, 84, 12, 'rgba(255,255,255,0.6)'); break;
    case 'kite': g.fillStyle = '#06d6a0'; g.beginPath(); g.moveTo(C, 30); g.lineTo(196, 110); g.lineTo(C, 200); g.lineTo(60, 110); g.closePath(); g.fill(); g.strokeStyle = '#2b3a55'; g.lineWidth = 5; g.beginPath(); g.moveTo(C, 30); g.lineTo(C, 200); g.moveTo(60, 110); g.lineTo(196, 110); g.moveTo(C, 200); g.quadraticCurveTo(150, 225, 120, 246); g.stroke(); break;
    case 'drop': g.fillStyle = '#3a86ff'; g.beginPath(); g.moveTo(C, 36); g.bezierCurveTo(C + 20, 80, C + 66, 120, C + 60, 160); g.arc(C, 160, 60, 0, Math.PI); g.bezierCurveTo(C - 66, 120, C - 20, 80, C, 36); g.fill(); break;
    case 'snow': g.strokeStyle = '#5aa9e6'; g.lineWidth = 11; for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3, x = C + Math.cos(a) * 80, y = C + Math.sin(a) * 80; g.beginPath(); g.moveTo(C, C); g.lineTo(x, y); g.moveTo(C + Math.cos(a) * 50 + Math.cos(a + 0.9) * 22, C + Math.sin(a) * 50 + Math.sin(a + 0.9) * 22); g.lineTo(C + Math.cos(a) * 50, C + Math.sin(a) * 50); g.lineTo(C + Math.cos(a) * 50 + Math.cos(a - 0.9) * 22, C + Math.sin(a) * 50 + Math.sin(a - 0.9) * 22); g.stroke(); } break;
    case 'planet': circle(C, C, 52, '#f4a261'); g.strokeStyle = '#7b5cd6'; g.lineWidth = 10; g.beginPath(); g.ellipse(C, C, 92, 26, -0.35, 0, Math.PI * 2); g.stroke(); circle(C, C - 6, 40, '#f4a261'); break;
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function cloudBackTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0)'; g.fillRect(0, 0, 256, 256);
  const blob = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  g.fillStyle = '#ffffff'; g.shadowColor = 'rgba(80,110,160,0.35)'; g.shadowBlur = 14; g.shadowOffsetY = 6;
  blob(80, 150, 56); blob(128, 112, 70); blob(182, 146, 54); g.fillRect(70, 150, 120, 52); blob(70, 176, 30); blob(190, 176, 30);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

async function init() {
  try { Object.assign(G, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* */ }
  const saveG = () => { try { localStorage.setItem(KEY, JSON.stringify({ size: G.size, hover: G.hover })); } catch (e) { /* */ } };
  K = await createLieGame({
    title: 'Cloud Pairs', sky: 'day',
    hint: 'Click two clouds to turn them over and find matching pairs. Drag to look around. Esc for menu.',
    rows: [
      { label: 'Turn by', cells: [{ text: 'Trigger / click', action: () => { G.hover = false; saveG(); }, active: () => !G.hover }, { text: 'Hover', action: () => { G.hover = true; saveG(); }, active: () => G.hover }] },
      { label: 'Grid', cells: SIZES.map(([c, r], i) => ({ text: `${c}×${r}`, action: () => { G.size = i; saveG(); deal(); }, active: () => G.size === i })) },
      { cells: [{ text: '↻ Shuffle this sky', action: () => deal(), tone: 'accent' }] },
    ],
  });
  const { field, FW, FH, sfx } = K;
  const hud = K.text({ w: 4.6, h: 0.42, size: 0.58, color: '#ffffff' }); hud.position.set(0, FH + 0.32, 0.05); field.add(hud);
  const doneT = K.text({ w: 5.4, h: 0.9, size: 0.56, bg: 'rgba(30,60,110,0.78)' }); doneT.position.set(0, 0.3, 0.6); field.add(doneT); doneT.visible = false;
  K.button({ text: 'Next sky ▶', x: 0, y: -0.55, w: 1.8, h: 0.46, tone: 'accent', onPress: () => { G.size = (G.size + 1) % SIZES.length; saveG(); deal(); }, visible: () => G.done });
  K.button({ text: '↻ Shuffle', x: 2.95, y: -FH - 0.55, w: 1.1, onPress: () => deal() });
  const backTex = cloudBackTexture(), icons = Object.fromEntries(ICONS.map((k) => [k, iconTexture(k)]));
  const tileGeo = new THREE.PlaneGeometry(1, 1);
  const board = new THREE.Group(); field.add(board);
  let tiles = [];
  const drawHud = () => hud.set(`${G.found} / ${tiles.length / 2} pairs   ·   ${G.moves} turns`);

  function deal() {
    board.clear(); doneT.visible = false; G.done = false; G.open = []; G.moves = 0; G.found = 0; G.wait = 0;
    const [cols, rows] = SIZES[G.size]; const n = cols * rows / 2;
    const kinds = ICONS.slice().sort(() => Math.random() - 0.5).slice(0, n);
    const deck = [...kinds, ...kinds].sort(() => Math.random() - 0.5);
    const cell = Math.min((FW * 2) / cols, (FH * 2) / rows), s = cell * 0.86;
    tiles = deck.map((kind, i) => {
      const cx = (i % cols - (cols - 1) / 2) * cell, cy = ((rows - 1) / 2 - Math.floor(i / cols)) * cell;
      const g = new THREE.Group(); g.position.set(cx, cy, 0.1);
      const back = new THREE.Mesh(tileGeo, new THREE.MeshBasicMaterial({ map: backTex, transparent: true, depthWrite: false }));
      const face = new THREE.Mesh(tileGeo, new THREE.MeshBasicMaterial({ map: icons[kind], transparent: true }));
      face.rotation.y = Math.PI; face.position.z = -0.005; back.scale.setScalar(s * 1.08); face.scale.setScalar(s * 0.92);
      const glow = new THREE.Mesh(tileGeo, new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0, depthWrite: false }));
      glow.scale.setScalar(s * 1.12); glow.position.z = 0.01; glow.rotation.y = Math.PI;   // behind the face once flipped
      g.add(back, face, glow); board.add(g);
      return { g, kind, x: cx, y: cy, half: s / 2, flip: 0, want: 0, matched: false, dwell: 0, glow, ph: Math.random() * 6 };
    });
    drawHud(); K.refreshButtons(); K.menu.refresh();
  }
  function pick(a) { return tiles.find((t) => Math.abs(a.x - t.x) < t.half && Math.abs(a.y - t.y) < t.half) || null; }
  function turn(t, aim) {
    if (!t || t.matched || t.want === 1 || G.wait > 0 || G.done) return;
    t.want = 1; G.open.push(t); sfx.bell(ICONS.indexOf(t.kind), { vol: 0.05, dur: 0.9 }); K.buzz(aim);
    if (G.open.length === 2) {
      G.moves++;
      const [a, b] = G.open;
      if (a.kind === b.kind) {
        a.matched = b.matched = true; G.open = []; G.found++;
        setTimeout(() => sfx.chord([2, 4, 7], { vol: 0.07, spread: 0.08, dur: 2 }), 250);
        if (G.found === tiles.length / 2) setTimeout(win, 700);
      } else G.wait = 1.1;
      drawHud();
    }
  }
  function win() {
    G.done = true; const key = 'cloudpairs-' + G.size; const prev = K.best(key);
    const score = Math.max(1, 100 - G.moves); K.best(key, score);
    doneT.set(`Clear sky! ${G.moves} turns\n` + (score > prev && prev ? 'A new best for this grid ✦' : 'Turn the next sky, or shuffle'));
    doneT.visible = true; sfx.chord([0, 2, 4, 7, 9, 12], { vol: 0.07, spread: 0.14, dur: 3 }); K.refreshButtons();
  }
  K.onPress((a) => { if (!G.hover) turn(pick(a), a); });

  K.tick((dt, t) => {
    if (G.wait > 0) { G.wait -= dt; if (G.wait <= 0) { G.open.forEach((o) => (o.want = 0)); G.open = []; sfx.soft(); } }
    const aim = K.aims.find((a) => a.onField);
    const hov = aim ? pick(aim) : null;
    for (const tl of tiles) {
      tl.flip += (tl.want - tl.flip) * Math.min(1, dt * 7);
      tl.g.rotation.y = tl.flip * Math.PI;
      const lift = (hov === tl && !tl.matched ? 0.12 : 0) + (K.paused ? 0 : Math.sin(t * 0.8 + tl.ph) * 0.02);
      tl.g.position.z += (0.1 + lift - tl.g.position.z) * Math.min(1, dt * 8);
      tl.glow.material.opacity = tl.matched ? 0.55 + 0.2 * Math.sin(t * 2 + tl.ph) : 0;
      if (G.hover) {
        tl.dwell = hov === tl && tl.want === 0 ? tl.dwell + dt : 0;
        tl.g.scale.setScalar(1 + 0.08 * Math.min(1, tl.dwell / 0.7));
        if (tl.dwell >= 0.7) { tl.dwell = 0; turn(tl, aim); }
      } else tl.g.scale.setScalar(hov === tl && !tl.matched ? 1.05 : 1);
    }
  });
  deal();
  K.toast('Find the matching pairs', 3);
  K.start();
}
