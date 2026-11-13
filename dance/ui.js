// ============================ dance/ui.js — one screen spec, three renderers (DOM overlay, in-VR board, wall/strip HUD) ============================
// spec: { title, sub?, lines?:[str], big?:str, stats?:[[label,value]], bars?:[{label,value,text}], buttons:[{id,label,tone?}], note? }
export function createUI(THREE, { onAction }) {
  const U = { spec: null, hover: null, rects: [], xr: false };

  // ---------------- DOM overlay (desktop / phone) ----------------
  const css = document.createElement('style');
  css.textContent = `
  #dui{position:fixed;inset:0;z-index:20;display:none;align-items:center;justify-content:center;background:radial-gradient(70% 70% at 50% 50%,rgba(6,8,22,.35),rgba(6,8,22,.72));font:500 16px/1.45 system-ui,-apple-system,sans-serif;color:#eef1ff;padding:max(12px,env(safe-area-inset-top)) 16px max(12px,env(safe-area-inset-bottom))}
  #dui .card{width:min(560px,100%);max-height:100%;overflow:auto;background:rgba(14,18,40,.88);border:1px solid rgba(140,170,255,.28);border-radius:20px;padding:22px 22px 18px;box-shadow:0 20px 60px rgba(0,0,0,.5);backdrop-filter:blur(8px);text-align:center}
  #dui h1{margin:0 0 4px;font-size:28px;font-weight:700;letter-spacing:.01em}#dui .sub{opacity:.75;margin-bottom:10px}
  #dui p{margin:6px 0;opacity:.92}#dui .big{font-size:44px;letter-spacing:.12em;margin:6px 0;color:#ffd24a;text-shadow:0 0 18px rgba(255,210,74,.5)}
  #dui .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:10px 0}#dui .stat{background:rgba(255,255,255,.07);border-radius:12px;padding:8px 6px}
  #dui .stat b{display:block;font-size:22px}#dui .stat span{font-size:12px;opacity:.7;text-transform:uppercase;letter-spacing:.08em}
  #dui .bars{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;text-align:left;margin:10px 0;font-size:13px}
  #dui .bar{display:flex;flex-direction:column;gap:3px}#dui .bar i{display:block;height:7px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden}#dui .bar i u{display:block;height:100%;background:linear-gradient(90deg,#3fd8ff,#ff6fb0)}
  #dui .btns{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:14px}
  #dui button{min-height:46px;min-width:112px;padding:10px 20px;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.1);color:#fff;font:650 16px system-ui,sans-serif;cursor:pointer}
  #dui button.accent{background:linear-gradient(90deg,#3a7bff,#b44cff);border-color:transparent}#dui button.on{outline:2px solid #ffd24a}#dui button:active{transform:scale(.97)}
  #dui .note{font-size:12.5px;opacity:.65;margin-top:10px}
  @media (max-width:420px){#dui h1{font-size:24px}#dui .card{padding:18px 14px}#dui button{min-width:96px;padding:10px 14px}}`;
  document.head.appendChild(css);
  const dom = document.createElement('div'); dom.id = 'dui'; dom.innerHTML = '<div class="card"></div>'; document.body.appendChild(dom);
  const card = dom.firstChild;
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function renderDom(s) {
    card.innerHTML = `<h1>${esc(s.title)}</h1>${s.sub ? `<div class="sub">${esc(s.sub)}</div>` : ''}${(s.lines || []).map((l) => `<p>${esc(l)}</p>`).join('')}${s.big ? `<div class="big">${esc(s.big)}</div>` : ''}` +
      (s.stats ? `<div class="stats">${s.stats.map(([a, b]) => `<div class="stat"><b>${esc(b)}</b><span>${esc(a)}</span></div>`).join('')}</div>` : '') +
      (s.bars ? `<div class="bars">${s.bars.map((b) => `<div class="bar"><div>${esc(b.label)} <span style="opacity:.6">${esc(b.text || '')}</span></div><i><u style="width:${Math.round(b.value * 100)}%"></u></i></div>`).join('')}</div>` : '') +
      `<div class="btns">${(s.buttons || []).map((b) => `<button data-id="${esc(b.id)}" class="${b.tone || ''}${b.on ? ' on' : ''}">${esc(b.label)}</button>`).join('')}</div>${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}`;
  }
  card.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) onAction(b.dataset.id); });

  // ---------------- in-VR board (canvas texture on a plane) ----------------
  const BW = 1536, BH = 960;
  const cv = document.createElement('canvas'); cv.width = BW; cv.height = BH; const cx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.9375), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, side: THREE.DoubleSide, depthTest: true }));
  board.position.set(0, 1.5, -1.3); board.renderOrder = 100; board.visible = false; U.board = board;
  const rr = (x, y, w, h, r) => { cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); };
  const wrap = (txt, maxW) => { const out = []; let line = ''; for (const w of txt.split(' ')) { const t = line ? line + ' ' + w : w; if (cx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out; };
  function drawBoard() {
    const s = U.spec; if (!s) return;
    cx.clearRect(0, 0, BW, BH);
    const g = cx.createLinearGradient(0, 0, 0, BH); g.addColorStop(0, 'rgba(22,26,60,0.94)'); g.addColorStop(1, 'rgba(12,14,34,0.94)');
    rr(10, 10, BW - 20, BH - 20, 48); cx.fillStyle = g; cx.fill(); cx.lineWidth = 4; cx.strokeStyle = 'rgba(140,170,255,0.5)'; cx.stroke();
    cx.textAlign = 'center'; cx.fillStyle = '#fff'; let y = 120;
    cx.font = '700 84px system-ui,sans-serif'; cx.fillText(s.title, BW / 2, y); y += 54;
    if (s.sub) { cx.font = '500 38px system-ui,sans-serif'; cx.fillStyle = 'rgba(220,230,255,0.75)'; cx.fillText(s.sub, BW / 2, y); y += 20; }
    cx.fillStyle = 'rgba(238,241,255,0.95)'; cx.font = '500 42px system-ui,sans-serif';
    for (const l of s.lines || []) for (const w of wrap(l, BW - 220)) { y += 56; cx.fillText(w, BW / 2, y); }
    if (s.big) { y += 120; cx.font = '700 120px system-ui,sans-serif'; cx.fillStyle = '#ffd24a'; cx.fillText(s.big, BW / 2, y); cx.fillStyle = '#fff'; }
    if (s.stats) { y += 40; const n = s.stats.length, w = (BW - 160) / n; s.stats.forEach(([a, b], i) => { const x = 80 + w * (i + 0.5); cx.font = '700 64px system-ui,sans-serif'; cx.fillStyle = '#fff'; cx.fillText(b, x, y + 56); cx.font = '500 28px system-ui,sans-serif'; cx.fillStyle = 'rgba(200,215,255,0.7)'; cx.fillText(a.toUpperCase(), x, y + 96); }); y += 110; }
    if (s.bars) { y += 20; const colW = (BW - 200) / 2; s.bars.slice(0, 8).forEach((b, i) => { const x = 100 + (i % 2) * (colW + 0), yy = y + Math.floor(i / 2) * 62; cx.textAlign = 'left'; cx.font = '500 30px system-ui,sans-serif'; cx.fillStyle = '#fff'; cx.fillText(b.label, x, yy + 20); cx.textAlign = 'right'; cx.fillStyle = 'rgba(200,215,255,0.7)'; cx.fillText(b.text || '', x + colW - 30, yy + 20); rr(x, yy + 30, colW - 30, 14, 7); cx.fillStyle = 'rgba(255,255,255,0.14)'; cx.fill(); const gr = cx.createLinearGradient(x, 0, x + colW, 0); gr.addColorStop(0, '#3fd8ff'); gr.addColorStop(1, '#ff6fb0'); rr(x, yy + 30, Math.max(14, (colW - 30) * b.value), 14, 7); cx.fillStyle = gr; cx.fill(); }); cx.textAlign = 'center'; y += Math.ceil(Math.min(8, s.bars.length) / 2) * 62; }
    if (s.note) { cx.font = '500 30px system-ui,sans-serif'; cx.fillStyle = 'rgba(200,215,255,0.6)'; cx.fillText(s.note, BW / 2, BH - 250); }
    // buttons: bottom area, up to 2 rows
    const btns = s.buttons || []; U.rects = [];
    const perRow = btns.length > 3 ? Math.ceil(btns.length / 2) : btns.length, rows = btns.length > 3 ? 2 : 1, bh = 108, gap = 28;
    const top = BH - 60 - rows * bh - (rows - 1) * gap;
    btns.forEach((b, i) => {
      const row = Math.floor(i / perRow), col = i % perRow, inRow = row === rows - 1 ? btns.length - perRow * (rows - 1) : perRow;
      const bw = Math.min(420, (BW - 160 - gap * (inRow - 1)) / inRow), totalW = bw * inRow + gap * (inRow - 1), x = (BW - totalW) / 2 + col * (bw + gap), yy = top + row * (bh + gap);
      const hov = U.hover === b.id;
      rr(x, yy, bw, bh, bh / 2);
      if (b.tone === 'accent') { const gg = cx.createLinearGradient(x, 0, x + bw, 0); gg.addColorStop(0, hov ? '#6a9bff' : '#3a7bff'); gg.addColorStop(1, hov ? '#d27bff' : '#b44cff'); cx.fillStyle = gg; } else cx.fillStyle = hov ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.12)';
      cx.fill(); cx.lineWidth = b.on ? 8 : 3; cx.strokeStyle = b.on ? '#ffd24a' : hov ? '#fff' : 'rgba(255,255,255,0.4)'; cx.stroke();
      cx.font = '650 44px system-ui,sans-serif'; cx.fillStyle = '#fff'; cx.textAlign = 'center'; cx.fillText(b.label, x + bw / 2, yy + bh / 2 + 15);
      U.rects.push({ id: b.id, x, y: yy, w: bw, h: bh });
    });
    tex.needsUpdate = true;
  }
  const ray = new THREE.Raycaster();
  // pick: world ray origin/direction → button id (or null); also returns hit distance
  U.pick = function pick(origin, dir) {
    if (!board.visible) return null;
    ray.set(origin, dir); const h = ray.intersectObject(board, false)[0];
    if (!h || !h.uv) return null;
    const px = h.uv.x * BW, py = (1 - h.uv.y) * BH;
    const r = U.rects.find((q) => px >= q.x && px <= q.x + q.w && py >= q.y && py <= q.y + q.h);
    return { id: r ? r.id : null, dist: h.distance };
  };
  U.setHover = (id) => { if (id !== U.hover) { U.hover = id; if (board.visible) drawBoard(); } };
  U.setXR = (on) => { U.xr = on; dom.style.display = on ? 'none' : (U.spec ? 'flex' : 'none'); board.visible = on && !!U.spec; if (board.visible) drawBoard(); };
  U.show = (spec) => { U.spec = spec; renderDom(spec); if (U.xr) { board.visible = true; drawBoard(); dom.style.display = 'none'; } else dom.style.display = 'flex'; };
  U.hide = () => { U.spec = null; dom.style.display = 'none'; board.visible = false; };
  U.visible = () => !!U.spec;
  return U;
}

// ---------------- in-world HUDs ----------------
export function createWallHud(THREE) {
  const W = 1600, H = 400, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.repeat.x = -1; tex.offset.x = 1; tex.anisotropy = 4;
  const R = 8.05, arc = 8.0 / R;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 2.0, 40, 1, true, Math.PI - arc / 2, arc), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, toneMapped: false, depthWrite: false, fog: false }));
  mesh.position.set(0, 3.9, -1.0); mesh.renderOrder = 10;
  const st = { score: -1, text: '', key: '' };
  function draw(d) {
    const key = JSON.stringify(d); if (key === st.key) return; st.key = key;
    x.clearRect(0, 0, W, H);
    x.textBaseline = 'alphabetic';
    x.fillStyle = 'rgba(255,255,255,0.92)'; x.textAlign = 'left'; x.font = '700 64px system-ui,sans-serif'; x.fillText(d.title || '', 60, 100);
    x.font = '500 38px system-ui,sans-serif'; x.fillStyle = 'rgba(200,220,255,0.8)'; x.fillText(d.sub || '', 60, 160);
    x.textAlign = 'right'; x.fillStyle = '#fff'; x.font = '800 120px system-ui,sans-serif'; x.fillText(String(d.score ?? 0).padStart(6, '0'), W - 60, 130);
    x.font = '600 44px system-ui,sans-serif'; x.fillStyle = '#ffd24a'; x.fillText(d.mult > 1 ? '×' + d.mult + '   ' : '', W - 60, 190);
    x.fillStyle = 'rgba(200,220,255,0.85)'; x.fillText(d.streak ? d.streak + ' streak' : '', d.mult > 1 ? W - 190 : W - 60, 190);
    x.textAlign = 'center';
    if (d.big) { x.font = '800 150px system-ui,sans-serif'; x.fillStyle = d.bigColor || '#fff'; x.globalAlpha = d.bigA ?? 1; x.fillText(d.big, W / 2, 230); x.globalAlpha = 1; }
    if (d.move) { x.font = '700 70px system-ui,sans-serif'; x.fillStyle = '#fff'; x.fillText(d.move, W / 2, 330); }
    x.fillStyle = 'rgba(255,255,255,0.16)'; x.fillRect(60, 372, W - 120, 10); x.fillStyle = '#3fd8ff'; x.fillRect(60, 372, (W - 120) * (d.progress || 0), 10);
    tex.needsUpdate = true;
  }
  return { mesh, draw };
}

export function createNextStrip(THREE) {
  const W = 1024, H = 240, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.28125), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }));
  mesh.position.set(0, 2.08, -1.8); mesh.renderOrder = 30;
  let last = '';
  function draw(d) {                      // d: { names:[{label,in}], beatFrac, beatIdx }
    const key = JSON.stringify([d.names, d.beatIdx, Math.floor(d.beatFrac * 6)]); if (key === last) return; last = key;
    x.clearRect(0, 0, W, H);
    x.fillStyle = 'rgba(10,12,32,0.72)'; x.beginPath(); x.roundRect(4, 4, W - 8, H - 8, 40); x.fill(); x.strokeStyle = 'rgba(150,180,255,0.5)'; x.lineWidth = 3; x.stroke();
    x.textAlign = 'left'; x.fillStyle = 'rgba(180,200,255,0.8)'; x.font = '600 30px system-ui,sans-serif'; x.fillText('NEXT', 36, 58);
    d.names.slice(0, 3).forEach((n, i) => { x.font = (i === 0 ? '800 62px' : '600 38px') + ' system-ui,sans-serif'; x.fillStyle = i === 0 ? '#fff' : 'rgba(220,230,255,0.7)'; if (i === 0) x.fillText(n.label, 36, 130); else x.fillText(n.label, 36 + (i === 1 ? 0 : 420), 190); });
    for (let i = 0; i < 4; i++) { const on = i === d.beatIdx; x.beginPath(); x.arc(W - 200 + i * 44, 70, on ? 16 - d.beatFrac * 4 : 9, 0, 7); x.fillStyle = on ? '#ffd24a' : 'rgba(255,255,255,0.3)'; x.fill(); }
    tex.needsUpdate = true;
  }
  return { mesh, draw };
}
