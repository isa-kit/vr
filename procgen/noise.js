// ============================ procgen/noise.js — seedable noise ============================
//
//   import { rng, makeNoise } from '../procgen/noise.js';
//
//   const R = rng(1234);                 // deterministic PRNG: R() in [0,1)
//   const N = makeNoise(7);              // deterministic noise field for a seed
//   N.n2(x, y)                           // gradient noise, ≈ [-1, 1]
//   N.n3(x, y, z)                        // 3D gradient noise
//   N.fbm2(x, y, { oct: 5, lac: 2, gain: 0.5 })      // fractal sum, ≈ [-1, 1]
//   N.ridged2(x, y, { oct: 4 })          // ridged multifractal, [0, 1] (sharp creases)
//   N.p2(x, y, px, py)                   // periodic (tileable) noise: repeats every px × py lattice cells
//   N.pfbm2(x, y, px, py, { oct, gain }) // tileable fbm  (px, py are integers; octaves double them)
//   N.worley2(x, y, period?)             // cellular noise → { f1, f2 } distances to the nearest two feature points
//
// Every function is a pure function of (seed, arguments). Nothing here touches THREE or the DOM.
// =============================================================================================

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const G2 = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1]);
const G3 = new Float32Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

export function makeNoise(seed = 1) {
  const R = rng(seed), perm = new Uint8Array(512), p0 = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p0[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = p0[i]; p0[i] = p0[j]; p0[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p0[i & 255];
  const wrap = (i, p) => (p ? ((i % p) + p) % p : i);

  const g2 = (ix, iy, x, y) => { const h = (perm[(perm[ix & 255] + iy) & 255] & 7) * 2; return G2[h] * x + G2[h + 1] * y; };
  function n2(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fade(fx), v = fade(fy);
    return lerp(lerp(g2(ix, iy, fx, fy), g2(ix + 1, iy, fx - 1, fy), u), lerp(g2(ix, iy + 1, fx, fy - 1), g2(ix + 1, iy + 1, fx - 1, fy - 1), u), v) * 1.35;
  }
  function p2(x, y, px, py) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fade(fx), v = fade(fy);
    const x0 = wrap(ix, px), x1 = wrap(ix + 1, px), y0 = wrap(iy, py), y1 = wrap(iy + 1, py);
    return lerp(lerp(g2(x0, y0, fx, fy), g2(x1, y0, fx - 1, fy), u), lerp(g2(x0, y1, fx, fy - 1), g2(x1, y1, fx - 1, fy - 1), u), v) * 1.35;
  }
  const g3 = (ix, iy, iz, x, y, z) => { const h = (perm[(perm[(perm[ix & 255] + iy) & 255] + iz) & 255] % 12) * 3; return G3[h] * x + G3[h + 1] * y + G3[h + 2] * z; };
  function n3(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz, u = fade(fx), v = fade(fy), w = fade(fz);
    return lerp(
      lerp(lerp(g3(ix, iy, iz, fx, fy, fz), g3(ix + 1, iy, iz, fx - 1, fy, fz), u), lerp(g3(ix, iy + 1, iz, fx, fy - 1, fz), g3(ix + 1, iy + 1, iz, fx - 1, fy - 1, fz), u), v),
      lerp(lerp(g3(ix, iy, iz + 1, fx, fy, fz - 1), g3(ix + 1, iy, iz + 1, fx - 1, fy, fz - 1), u), lerp(g3(ix, iy + 1, iz + 1, fx, fy - 1, fz - 1), g3(ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1), u), v), w) * 1.15;
  }
  function fbm2(x, y, { oct = 5, lac = 2, gain = 0.5 } = {}) {
    let s = 0, a = 1, f = 1, t = 0;
    for (let i = 0; i < oct; i++) { s += a * n2(x * f + i * 17.3, y * f - i * 9.1); t += a; a *= gain; f *= lac; }
    return s / t;
  }
  function pfbm2(x, y, px, py, { oct = 5, gain = 0.5 } = {}) {
    let s = 0, a = 1, t = 0, f = 1;
    for (let i = 0; i < oct; i++) { s += a * p2(x * f, y * f, px * f, py * f); t += a; a *= gain; f *= 2; }
    return s / t;
  }
  function ridged2(x, y, { oct = 4, lac = 2, gain = 0.5 } = {}) {
    let s = 0, a = 1, f = 1, t = 0, w = 1;
    for (let i = 0; i < oct; i++) { let n = 1 - Math.abs(n2(x * f + i * 5.7, y * f + i * 3.1)); n *= n; n *= w; w = Math.min(1, Math.max(0, n * 2)); s += a * n; t += a; a *= gain; f *= lac; }
    return s / t;
  }
  const hash2 = (ix, iy) => { const h = perm[(perm[ix & 255] + iy) & 255]; return [h / 255, perm[(h + 91) & 255] / 255]; };
  function worley2(x, y, period = 0) {
    const ix = Math.floor(x), iy = Math.floor(y); let f1 = 9, f2 = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j, [rx, ry] = hash2(wrap(cx, period), wrap(cy, period));
      const dx = cx + rx - x, dy = cy + ry - y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    return { f1, f2 };
  }
  return { n2, p2, n3, fbm2, pfbm2, ridged2, worley2 };
}
