// ============================ rts/mini.js — 2D mini map (desktop corner, phone corner, and the VR controller panel) ============================
// draw(ctx, x, y, w, h, opts) paints terrain, fog, buildings, unit dots, resource nodes, the view footprint and a drag box.
// toCell(px, py, rect, rot) is the inverse mapping. rot rotates the map so "up" matches the table in front of the player.
import { N, K, WL } from './sim.js?v=rts1';

export function createMini(S) {
  const map = S.map, SZ = 4, base = document.createElement('canvas'); base.width = base.height = N * SZ;
  { // terrain prerender
    const c = base.getContext('2d'), img = c.createImageData(N * SZ, N * SZ);
    for (let j = 0; j < N * SZ; j++) for (let i = 0; i < N * SZ; i++) {
      const x = i / SZ, z = j / SZ, k = map.kind[Math.min(N - 1, Math.floor(z)) * N + Math.min(N - 1, Math.floor(x))], h = map.heightAt(Math.min(N - 1e-3, x), Math.min(N - 1e-3, z));
      let r, g, b;
      if (k === K.WATER) { r = 50; g = 110; b = 175; } else if (k === K.FORD) { r = 150; g = 170; b = 170; }
      else if (k === K.FOREST) { r = 38; g = 88; b = 44; } else if (k === K.ROCK) { r = 120; g = 120; b = 118; }
      else { const l = Math.max(0, Math.min(1, (h - 0.5) / 3)); r = 96 + l * 70; g = 150 + l * 46; b = 66 + l * 30; }
      const o = (j * N * SZ + i) * 4; img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }
  const fogC = document.createElement('canvas'); fogC.width = fogC.height = N; const fctx = fogC.getContext('2d'), fimg = fctx.createImageData(N, N);
  const TEAM = ['#3aa0ff', '#ff6a3a'];
  const api = {
    // map cell -> pixel
    toPx(x, z, rect, rot = 0) {
      let u = x / N - 0.5, v = z / N - 0.5;
      const cs = Math.cos(rot), sn = Math.sin(rot), ru = u * cs - v * sn, rv = u * sn + v * cs;
      return [rect.x + rect.w * (ru + 0.5), rect.y + rect.h * (rv + 0.5)];
    },
    toCell(px, py, rect, rot = 0) {
      const ru = (px - rect.x) / rect.w - 0.5, rv = (py - rect.y) / rect.h - 0.5, cs = Math.cos(rot), sn = Math.sin(rot);
      const u = ru * cs + rv * sn, v = -ru * sn + rv * cs;
      return { x: (u + 0.5) * N, z: (v + 0.5) * N };
    },
    draw(ctx, x, y, w, h, o = {}) {
      const { rot = 0, team = 0, selected = new Set(), viewPoly = null, drag = null, alertAt = null, brightDots = false } = o, rect = { x, y, w, h };
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.fillStyle = '#0a0e14'; ctx.fillRect(x, y, w, h);
      ctx.translate(x + w / 2, y + h / 2); ctx.rotate(rot);
      const ww = w, hh = h; ctx.imageSmoothingEnabled = true;
      ctx.drawImage(base, -ww / 2, -hh / 2, ww, hh);
      // fog overlay
      const vis = S.vis[team];
      for (let q = 0; q < N * N; q++) { const o4 = q * 4, v = !S.fogOn ? 2 : vis[q]; fimg.data[o4] = 4; fimg.data[o4 + 1] = 8; fimg.data[o4 + 2] = 14; fimg.data[o4 + 3] = v === 2 ? 0 : v === 1 ? 110 : 235; }
      fctx.putImageData(fimg, 0, 0); ctx.drawImage(fogC, -ww / 2, -hh / 2, ww, hh);
      const P = (cx, cz) => [(cx / N - 0.5) * ww, (cz / N - 0.5) * hh], unit = w / 150;
      // resource nodes
      ctx.fillStyle = '#7fe8ff';
      for (const n of map.nodes) { if (n.amount <= 0) continue; if (S.fogOn && vis[Math.floor(n.z) * N + Math.floor(n.x)] === 0) continue; const [px, pz] = P(n.x, n.z), r = 2.6 * unit + 1; ctx.beginPath(); ctx.moveTo(px, pz - r); ctx.lineTo(px + r, pz); ctx.lineTo(px, pz + r); ctx.lineTo(px - r, pz); ctx.closePath(); ctx.fill(); }
      for (const b of S.buildings()) {
        if (b.team !== team && S.fogOn && vis[Math.floor(b.z) * N + Math.floor(b.x)] === 0) continue;
        const [px, pz] = P(b.cx, b.cz); ctx.fillStyle = TEAM[b.team]; ctx.globalAlpha = b.built ? 1 : 0.55; ctx.fillRect(px, pz, b.size / N * ww, b.size / N * hh); ctx.globalAlpha = 1;
        if (selected.has(b.id)) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.strokeRect(px - 1, pz - 1, b.size / N * ww + 2, b.size / N * hh + 2); }
      }
      const dot = Math.max(1.6, 2.1 * unit);
      for (const u of S.units()) {
        if (u.team !== team && S.fogOn && vis[Math.floor(u.z) * N + Math.floor(u.x)] !== 2) continue;
        const [px, pz] = P(u.x, u.z); ctx.fillStyle = TEAM[u.team]; const r = u.type === 'siege' ? dot * 1.5 : u.type === 'worker' ? dot * 0.85 : dot;
        ctx.beginPath(); ctx.arc(px, pz, r, 0, 6.283); ctx.fill();
        if (selected.has(u.id)) { ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, unit); ctx.stroke(); }
      }
      if (alertAt) { const [px, pz] = P(alertAt.x, alertAt.z), r = (6 + 4 * Math.sin(performance.now() / 150)) * unit; ctx.strokeStyle = '#ff4a3a'; ctx.lineWidth = 2 * unit + 0.5; ctx.beginPath(); ctx.arc(px, pz, r, 0, 6.283); ctx.stroke(); }
      if (viewPoly && viewPoly.length > 2) { ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.2, 1.4 * unit); ctx.beginPath(); viewPoly.forEach((p, i) => { const [px, pz] = P(p.x, p.z); if (i) ctx.lineTo(px, pz); else ctx.moveTo(px, pz); }); ctx.closePath(); ctx.stroke(); }
      if (drag) { ctx.strokeStyle = '#b4ffc4'; ctx.fillStyle = 'rgba(160,255,190,.18)'; ctx.lineWidth = Math.max(1, unit); const [a, b] = P(drag.x0, drag.z0), [c, d] = P(drag.x1, drag.z1); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, b); ctx.lineTo(c, d); ctx.lineTo(a, d); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      ctx.restore();
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); ctx.restore();
    },
  };
  return api;
}
