// ============================ procgen/textures.js — procedural PBR material maps ============================
//
//   import { makeMaterialMaps, makeLeafAtlas, standardMaterial } from '../procgen/textures.js';
//
//   const bark = await makeMaterialMaps('bark:oak', { size: 512, seed: 3 });   // → { map, normalMap, roughnessMap }
//   const mat  = standardMaterial(bark, { repeat: [2, 2] });                    // MeshStandardMaterial using all three
//   const leaf = makeLeafAtlas('oak', { size: 512, seed: 5 });                  // → { map (RGBA, alpha-cut), cells: 2 }  (2×2 clusters)
//
//   kinds:  'bark:oak' 'bark:pine' 'bark:birch' 'litter' 'soil' 'rock' 'sand' 'sand:wet' 'grass' 'moss'
//   leaf atlases: 'oak' 'birch' 'needle' (conifer sprays) 'fern'
//
//   • Every map is generated at load from numbers (kind, size, seed) — no files, no downloads. Same inputs → same pixels.
//   • Material maps are TILEABLE (noise wraps, canvas shapes are drawn with wrap-around copies).
//   • Colour = sRGB, normal map = tangent space (+Y up), roughness = G channel (what MeshStandardMaterial reads).
//   • size 256 is fine for phones / headsets, 512 for desktop. Generation is synchronous per map but `tick` (an async
//     callback) is awaited between rows of work so a loading screen can repaint: await makeMaterialMaps(k, { tick }).
// ==============================================================================================================

import * as THREE from 'three';
import { makeNoise, rng } from './noise.js';

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function dataTex(u8, S, srgb) {
  const t = new THREE.DataTexture(u8, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t;
}
// colour (Float32 rgb 0..1 sRGB), height (0..1), roughness (0..1) → three textures. Normals come from the height field (wrap-around Sobel).
function pack(S, col, h, rough, normalStrength = 3) {
  const c8 = new Uint8Array(S * S * 4), n8 = new Uint8Array(S * S * 4), r8 = new Uint8Array(S * S * 4);
  const H = (x, y) => h[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, o = i * 4;
    c8[o] = clamp(col[i * 3]) * 255; c8[o + 1] = clamp(col[i * 3 + 1]) * 255; c8[o + 2] = clamp(col[i * 3 + 2]) * 255; c8[o + 3] = 255;
    const dx = (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1)) - (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1));
    const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
    let nx = dx * normalStrength * 0.25, ny = dy * normalStrength * 0.25, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    n8[o] = (nx * 0.5 + 0.5) * 255; n8[o + 1] = (ny * 0.5 + 0.5) * 255; n8[o + 2] = (nz * 0.5 + 0.5) * 255; n8[o + 3] = 255;
    const r = clamp(rough[i]) * 255; r8[o] = r; r8[o + 1] = r; r8[o + 2] = r; r8[o + 3] = 255;
  }
  return { map: dataTex(c8, S, true), normalMap: dataTex(n8, S, false), roughnessMap: dataTex(r8, S, false) };
}
function fromCanvas(cv, hCv, S, roughBase, roughVar, normalStrength) {
  const cd = cv.getContext('2d').getImageData(0, 0, S, S).data, hd = hCv.getContext('2d').getImageData(0, 0, S, S).data;
  const col = new Float32Array(S * S * 3), h = new Float32Array(S * S), rough = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) { col[i * 3] = cd[i * 4] / 255; col[i * 3 + 1] = cd[i * 4 + 1] / 255; col[i * 3 + 2] = cd[i * 4 + 2] / 255; h[i] = hd[i * 4] / 255; rough[i] = roughBase + roughVar * (1 - h[i]); }
  return pack(S, col, h, rough, normalStrength);
}
const rgb = (c, a = 1) => `rgba(${Math.round(clamp(c[0]) * 255)},${Math.round(clamp(c[1]) * 255)},${Math.round(clamp(c[2]) * 255)},${a})`;
function canvas(S) { const c = document.createElement('canvas'); c.width = c.height = S; return c; }
// draw fn at (x,y) and at wrapped copies so the canvas tiles
function wrapped(S, x, y, r, fn) {
  for (const ox of [0, S, -S]) for (const oy of [0, S, -S]) {
    const px = x + ox, py = y + oy;
    if (px < -r || px > S + r || py < -r || py > S + r) continue;
    fn(px, py);
  }
}

// ---------------------------------------------------------------- bark
function bark(S, N, kind) {
  const col = new Float32Array(S * S * 3), h = new Float32Array(S * S), rough = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x; let c, hh;
    if (kind === 'birch') {
      const base = 0.5 + 0.5 * N.pfbm2(u * 4 + 3, v * 3, 4, 3, { oct: 3 });
      const mark = N.p2(u * 3, v * 34, 3, 34) + 0.45 * N.p2(u * 9 + 1, v * 8, 9, 8) + 0.2 * N.p2(u * 24, v * 70, 24, 70);
      const m = sstep(0.28, 0.6, mark), peel = sstep(0.5, 0.9, N.p2(u * 6, v * 90, 6, 90));
      c = mixc([0.86, 0.84, 0.78], [0.72, 0.68, 0.6], base * 0.6);
      c = mixc(c, [0.14, 0.12, 0.11], m * 0.95); c = mixc(c, [0.93, 0.9, 0.84], peel * 0.25 * (1 - m));
      hh = 0.5 + 0.25 * m + 0.1 * peel; rough[i] = 0.62 + 0.25 * m;
    } else {
      const pine = kind === 'pine', px = pine ? 5 : 8, py = 1;
      const n = N.p2(u * px, v * py, px, py) + 0.35 * N.p2(u * px * 2 + 5, v * py * 2, px * 2, py * 2);
      const plate = Math.pow(clamp(Math.abs(n) * 2.8), 0.5);
      const fine = N.pfbm2(u * 24, v * 7, 24, 7, { oct: 3 }), cross = N.pfbm2(u * 3, v * 18, 3, 18, { oct: 2 });
      hh = clamp(0.78 * plate + 0.14 * (0.5 + fine) + 0.1 * (0.5 + cross) * plate);
      const crev = pine ? [0.13, 0.075, 0.055] : [0.095, 0.075, 0.06], top = pine ? [0.52, 0.33, 0.22] : [0.46, 0.38, 0.31];
      c = mixc(crev, top, Math.pow(hh, 1.35));
      const lich = sstep(0.42, 0.75, N.pfbm2(u * 4 + 10, v * 4, 4, 4, { oct: 3 }) * 0.5 + 0.5 + 0.2 * fine) * hh * (pine ? 0.1 : 0.28);
      c = mixc(c, [0.46, 0.52, 0.34], lich);
      const g = (N.n2(x * 0.9, y * 0.9) * 0.02); c = [c[0] + g, c[1] + g, c[2] + g]; rough[i] = 0.82 + 0.15 * (1 - hh);
    }
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; h[i] = hh;
  }
  return pack(S, col, h, rough, kind === 'birch' ? 1.2 : 3.6);
}
// ---------------------------------------------------------------- soil / rock / sand / moss
function soil(S, N) {
  const col = new Float32Array(S * S * 3), h = new Float32Array(S * S), rough = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const big = 0.5 + 0.5 * N.pfbm2(u * 5, v * 5, 5, 5, { oct: 4 }), fine = N.pfbm2(u * 48, v * 48, 48, 48, { oct: 2 });
    const peb = sstep(0.55, 0.8, N.p2(u * 60, v * 60, 60, 60) * 0.5 + 0.5 + 0.2 * fine);
    let c = mixc([0.19, 0.125, 0.08], [0.36, 0.26, 0.17], big); c = mixc(c, [0.5, 0.45, 0.38], peb * 0.7); const g = fine * 0.04; c = [c[0] + g, c[1] + g, c[2] + g];
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; h[i] = clamp(0.35 + 0.35 * big + 0.25 * peb + fine * 0.1); rough[i] = 0.92;
  }
  return pack(S, col, h, rough, 3);
}
function rock(S, N) {
  const col = new Float32Array(S * S * 3), h = new Float32Array(S * S), rough = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const w = N.worley2(u * 6, v * 6, 6), crack = sstep(0.0, 0.05, w.f2 - w.f1), strata = 0.5 + 0.5 * N.p2(u * 3, v * 22 + N.p2(u * 6, v * 4, 6, 4) * 1.4, 3, 22);
    const fine = N.pfbm2(u * 32, v * 32, 32, 32, { oct: 4 }), big = 0.5 + 0.5 * N.pfbm2(u * 4, v * 4, 4, 4, { oct: 3 });
    let c = mixc([0.34, 0.33, 0.31], [0.58, 0.55, 0.5], clamp(0.35 * strata + 0.4 * big + 0.3 * (fine + 0.5)));
    c = mixc(c, [0.2, 0.19, 0.17], (1 - crack) * 0.5);
    const lich = sstep(0.55, 0.8, N.pfbm2(u * 7 + 4, v * 7, 7, 7, { oct: 3 }) * 0.5 + 0.5); c = mixc(c, [0.55, 0.6, 0.38], lich * 0.35);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; h[i] = clamp(0.3 + 0.32 * crack + 0.3 * (fine + 0.5) + 0.1 * strata); rough[i] = 0.8 + 0.15 * (1 - crack);
  }
  return pack(S, col, h, rough, 4.5);
}
function sand(S, N, wet) {
  const col = new Float32Array(S * S * 3), h = new Float32Array(S * S), rough = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const warp = N.pfbm2(u * 3, v * 3, 3, 3, { oct: 3 }) * 0.9, rip = 0.5 + 0.5 * Math.sin((v * 9 + warp) * TAU), grain = N.n2(x * 1.3, y * 1.3);
    const big = 0.5 + 0.5 * N.pfbm2(u * 4 + 2, v * 4, 4, 4, { oct: 4 }), speck = sstep(0.62, 0.75, N.n2(x * 0.7 + 40, y * 0.7) * 0.5 + 0.5);
    let c = mixc([0.82, 0.68, 0.48], [0.92, 0.8, 0.6], big); c = mixc(c, [0.55, 0.42, 0.3], speck * 0.5); const g = grain * 0.035 - rip * 0.03; c = [c[0] + g, c[1] + g, c[2] + g];
    if (wet) c = [c[0] * 0.58, c[1] * 0.56, c[2] * 0.55];
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; h[i] = clamp(0.4 + rip * 0.25 + grain * 0.06 + big * 0.1); rough[i] = wet ? 0.28 + 0.1 * speck : 0.93;
  }
  return pack(S, col, h, rough, wet ? 1.6 : 2.4);
}
function moss(S, N) {
  const col = new Float32Array(S * S * 3), h = new Float32Array(S * S), rough = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const a = 0.5 + 0.5 * N.pfbm2(u * 10, v * 10, 10, 10, { oct: 4 }), b = N.pfbm2(u * 60, v * 60, 60, 60, { oct: 2 });
    let c = mixc([0.1, 0.2, 0.06], [0.34, 0.5, 0.16], a); c = mixc(c, [0.52, 0.6, 0.25], sstep(0.55, 0.9, a + b * 0.3) * 0.4);
    col[i * 3] = c[0] + b * 0.03; col[i * 3 + 1] = c[1] + b * 0.04; col[i * 3 + 2] = c[2]; h[i] = clamp(0.4 + 0.4 * a + b * 0.2); rough[i] = 0.95;
  }
  return pack(S, col, h, rough, 3.5);
}
// ---------------------------------------------------------------- canvas-drawn: forest litter, grass
function litter(S, seed) {
  const R = rng(seed), cv = canvas(S), hc = canvas(S), g = cv.getContext('2d'), hg = hc.getContext('2d');
  g.fillStyle = rgb([0.17, 0.12, 0.08]); g.fillRect(0, 0, S, S); hg.fillStyle = '#303030'; hg.fillRect(0, 0, S, S);
  const pal = [[0.55, 0.4, 0.17], [0.42, 0.27, 0.12], [0.5, 0.25, 0.12], [0.34, 0.36, 0.14], [0.2, 0.13, 0.08], [0.62, 0.5, 0.25], [0.3, 0.2, 0.1]];
  const leafShape = (c, len, wid) => { c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(wid, -len * 0.25, wid * 0.8, -len * 0.75, 0, -len); c.bezierCurveTo(-wid * 0.8, -len * 0.75, -wid, -len * 0.25, 0, 0); c.closePath(); };
  const n = Math.round(S * S / 280), scale = S / 512;
  for (let i = 0; i < n; i++) {
    const x = R() * S, y = R() * S, a = R() * TAU, len = (9 + R() * 16) * scale, wid = len * (0.28 + R() * 0.16), c = pal[Math.floor(R() * pal.length)], z = 0.3 + R() * 0.7, jit = 0.85 + R() * 0.3;
    wrapped(S, x, y, len, (px, py) => {
      for (const [ctx, col, isH] of [[g, [c[0] * jit, c[1] * jit, c[2] * jit], false], [hg, [z, z, z], true]]) {
        ctx.save(); ctx.translate(px, py); ctx.rotate(a); leafShape(ctx, len, wid); ctx.fillStyle = rgb(col); ctx.fill();
        if (!isH) { ctx.strokeStyle = rgb([col[0] * 0.6, col[1] * 0.6, col[2] * 0.6], 0.6); ctx.lineWidth = 0.7 * scale; ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -len * 0.92); ctx.strokeStyle = rgb([col[0] * 1.25, col[1] * 1.2, col[2] * 1.1], 0.7); ctx.lineWidth = 0.9 * scale; ctx.stroke(); }
        ctx.restore();
      }
    });
  }
  const nn = Math.round(S * S / 150);
  for (let i = 0; i < nn; i++) {
    const x = R() * S, y = R() * S, a = R() * TAU, len = (7 + R() * 12) * scale, c = [0.4 + R() * 0.12, 0.28 + R() * 0.08, 0.13 + R() * 0.05];
    wrapped(S, x, y, len, (px, py) => { for (const [ctx, col] of [[g, c], [hg, [0.55, 0.55, 0.55]]]) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); ctx.strokeStyle = rgb(col); ctx.lineWidth = 1.2 * scale; ctx.stroke(); } });
  }
  return fromCanvas(cv, hc, S, 0.82, 0.15, 3.2);
}
function grass(S, seed) {
  const R = rng(seed), cv = canvas(S), hc = canvas(S), g = cv.getContext('2d'), hg = hc.getContext('2d');
  g.fillStyle = rgb([0.09, 0.19, 0.05]); g.fillRect(0, 0, S, S); hg.fillStyle = '#202020'; hg.fillRect(0, 0, S, S);
  const pal = [[0.2, 0.42, 0.1], [0.3, 0.52, 0.14], [0.4, 0.58, 0.16], [0.5, 0.62, 0.2], [0.26, 0.4, 0.1], [0.55, 0.55, 0.22]], scale = S / 512, n = Math.round(S * S / 22);
  for (let i = 0; i < n; i++) {
    const x = R() * S, y = R() * S, a = -Math.PI / 2 + (R() - 0.5) * 1.5, len = (8 + R() * 18) * scale, c = pal[Math.floor(R() * pal.length)], z = 0.25 + R() * 0.75, bend = (R() - 0.5) * len * 0.5;
    wrapped(S, x, y, len, (px, py) => {
      for (const [ctx, col] of [[g, c], [hg, [z, z, z]]]) {
        ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + Math.cos(a) * len * 0.5 + bend, py + Math.sin(a) * len * 0.5, px + Math.cos(a) * len, py + Math.sin(a) * len);
        ctx.strokeStyle = rgb(col); ctx.lineWidth = (1.1 + R() * 0.9) * scale; ctx.stroke();
      }
    });
  }
  return fromCanvas(cv, hc, S, 0.78, 0.2, 2.6);
}

export async function makeMaterialMaps(kind, { size = 256, seed = 1, tick } = {}) {
  const N = makeNoise(seed * 7 + 3);
  if (tick) await tick();
  const [k, v] = kind.split(':');
  switch (k) {
    case 'bark': return bark(size, N, v || 'oak');
    case 'soil': return soil(size, N);
    case 'rock': return rock(size, N);
    case 'sand': return sand(size, N, v === 'wet');
    case 'moss': return moss(size, N);
    case 'litter': return litter(size, seed);
    case 'grass': return grass(size, seed);
    default: throw new Error('procgen/textures: unknown kind ' + kind);
  }
}
export function standardMaterial(maps, { repeat = [1, 1], normalScale = 1, color = 0xffffff, roughness = 1, metalness = 0, ...rest } = {}) {
  for (const t of [maps.map, maps.normalMap, maps.roughnessMap]) if (t) t.repeat.set(repeat[0], repeat[1]);
  return new THREE.MeshStandardMaterial({ map: maps.map, normalMap: maps.normalMap, normalScale: new THREE.Vector2(normalScale, normalScale), roughnessMap: maps.roughnessMap, roughness, metalness, color, ...rest });
}

// ---------------------------------------------------------------- leaf / needle / fern atlases (RGBA, 2×2 clusters, cut-out)
function leafOutline(c, len, wid, kind, R) {
  const n = 26, lobes = kind === 'oak' ? 3 + Math.floor(R() * 2) : 0, ph = R() * TAU;
  c.beginPath();
  for (const side of [1, -1]) for (let i = 0; i <= n; i++) {
    const t = side === 1 ? i / n : 1 - i / n;
    let w = wid * Math.pow(Math.sin(Math.PI * Math.pow(t, kind === 'birch' ? 0.7 : 0.85)), 0.9);
    if (kind === 'oak') w *= 0.7 + 0.3 * Math.cos(t * lobes * TAU + ph) * (0.6 + 0.4 * Math.sin(Math.PI * t));
    if (kind === 'birch') w *= 1 + 0.07 * (Math.sin(t * 46) > 0 ? 1 : -1);
    const px = side * w, py = -len * t;
    if (side === 1 && i === 0) c.moveTo(px, py); else c.lineTo(px, py);
  }
  c.closePath();
}
function drawLeaf(g, x, y, ang, len, wid, kind, R, tintBias) {
  g.save(); g.translate(x, y); g.rotate(ang);
  const base = kind === 'birch' ? [0.3, 0.5, 0.14] : kind === 'oak' ? [0.17, 0.33, 0.09] : [0.2, 0.38, 0.12], j = 0.8 + R() * 0.4, sh = (R() - 0.5) * 0.06 + tintBias;
  const a = [(base[0] + sh) * j * 0.8, base[1] * j * 0.8, base[2] * j * 0.8], b = [(base[0] + sh * 1.5) * j * 1.25, base[1] * j * 1.2, base[2] * j * 1.15];
  const gr = g.createLinearGradient(0, 0, 0, -len); gr.addColorStop(0, rgb(a)); gr.addColorStop(1, rgb(b));
  leafOutline(g, len, wid, kind, R); g.fillStyle = gr; g.fill();
  g.strokeStyle = rgb([a[0] * 0.55, a[1] * 0.6, a[2] * 0.5], 0.7); g.lineWidth = Math.max(0.8, len / 30); g.stroke();
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -len * 0.94); g.strokeStyle = rgb([b[0] * 1.3, b[1] * 1.25, b[2] * 1.1], 0.75); g.lineWidth = Math.max(0.8, len / 26); g.stroke();
  g.strokeStyle = rgb([b[0] * 1.15, b[1] * 1.15, b[2] * 1.05], 0.35); g.lineWidth = Math.max(0.6, len / 40);
  for (let i = 1; i <= 5; i++) { const t = i / 6.4; for (const s of [1, -1]) { g.beginPath(); g.moveTo(0, -len * t); g.lineTo(s * wid * 0.8 * Math.sin(Math.PI * t), -len * (t + 0.14)); g.stroke(); } }
  g.restore();
}
export function makeLeafAtlas(species, { size = 512, seed = 1 } = {}) {
  const R = rng(seed * 31 + 7), cv = canvas(size), g = cv.getContext('2d'), cell = size / 2;
  for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) {
    g.save(); g.beginPath(); g.rect(cx * cell, cy * cell, cell, cell); g.clip();
    const ox = cx * cell + cell / 2, oy = (cy + 1) * cell - cell * 0.08;
    const tint = (R() - 0.5) * 0.04;
    if (species === 'oak' || species === 'birch') {
      const n = species === 'oak' ? 9 : 15, L = cell * (species === 'oak' ? 0.46 : 0.3), W = L * (species === 'oak' ? 0.5 : 0.52);
      g.strokeStyle = rgb([0.28, 0.2, 0.1]); g.lineWidth = cell / 70;
      const leaves = [];
      for (let i = 0; i < n; i++) { const r = 0.12 + R() * 0.78, ang = (R() - 0.5) * 2.6, bx = ox + Math.sin(ang) * r * cell * 0.36, by = oy - Math.cos(ang) * r * cell * 0.6; leaves.push({ bx, by, ang, r }); }
      leaves.sort((a, b) => a.r - b.r);
      for (const l of leaves) { g.beginPath(); g.moveTo(ox, oy); g.lineTo(l.bx, l.by); g.strokeStyle = rgb([0.3, 0.22, 0.12]); g.lineWidth = cell / 90; g.stroke(); drawLeaf(g, l.bx, l.by, l.ang + (R() - 0.5) * 0.5, L * (0.7 + 0.4 * R()), W * (0.8 + 0.3 * R()), species, R, tint); }
    } else if (species === 'needle') {
      const top = oy - cell * 0.9; g.lineCap = 'round';
      g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox, top); g.strokeStyle = rgb([0.32, 0.21, 0.12]); g.lineWidth = cell / 38; g.stroke();
      const frond = (x0, y0, ang, len, nn, w) => {
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len); g.strokeStyle = rgb([0.3, 0.2, 0.11]); g.lineWidth = cell / 90; g.stroke();
        for (let i = 0; i < nn; i++) {
          const s = (i + 0.4 + R() * 0.4) / nn, px = x0 + Math.cos(ang) * len * s, py = y0 + Math.sin(ang) * len * s;
          for (const side of [-1, 1]) {
            const na = ang + side * (1.15 - 0.35 * s + (R() - 0.5) * 0.3), nl = cell * (0.075 + 0.05 * (1 - s)) * (0.8 + R() * 0.4), base = [0.08 + R() * 0.07, 0.24 + R() * 0.12, 0.1 + R() * 0.06];
            g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl); g.strokeStyle = rgb(base); g.lineWidth = cell / 80 * w; g.stroke();
          }
        }
      };
      for (let k = 0; k < 11; k++) { const s = (k + 0.5) / 11, sy = oy - (oy - top) * s, len = cell * (0.46 - 0.3 * s) * (0.85 + R() * 0.3); for (const side of [-1, 1]) frond(ox, sy, -Math.PI / 2 + side * (1.0 - 0.28 * s + (R() - 0.5) * 0.25), len, Math.round(13 - 6 * s), 1 + R() * 0.4); }
      frond(ox, oy - cell * 0.02, -Math.PI / 2, cell * 0.88, 16, 1.1);
    } else if (species === 'fern') {
      g.lineCap = 'round'; const top = oy - cell * 0.86; g.beginPath(); g.moveTo(ox, oy); g.quadraticCurveTo(ox + cell * 0.04, (oy + top) / 2, ox + cell * 0.02, top); g.strokeStyle = rgb([0.22, 0.34, 0.1]); g.lineWidth = cell / 50; g.stroke();
      for (let i = 0; i < 22; i++) {
        const s = (i + 1) / 23, sy = oy - (oy - top) * s, len = cell * 0.42 * Math.sin(Math.PI * (0.12 + s * 0.88)) * 0.9 + 4;
        for (const side of [-1, 1]) { const ang = -Math.PI / 2 + side * (1.15 - s * 0.35); const col = [0.18 + R() * 0.08, 0.38 + R() * 0.1, 0.1 + R() * 0.04]; g.beginPath(); g.moveTo(ox, sy); g.lineTo(ox + Math.cos(ang) * len, sy + Math.sin(ang) * len); g.strokeStyle = rgb(col); g.lineWidth = cell / 24 * (1 - s * 0.6); g.stroke(); }
      }
    }
    g.restore();
  }
  // bleed leaf colour into fully transparent texels so mip-mapping never leaves dark fringes
  const id = g.getImageData(0, 0, size, size), d = id.data;
  const bg = species === 'needle' ? [28, 66, 32] : species === 'birch' ? [80, 125, 40] : [44, 84, 24];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] < 6) { d[i] = bg[0]; d[i + 1] = bg[1]; d[i + 2] = bg[2]; }
  g.putImageData(id, 0, 0);
  const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; map.generateMipmaps = true; map.minFilter = THREE.LinearMipmapLinearFilter; map.needsUpdate = true;
  return { map, cells: 2 };
}
