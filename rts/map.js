// ============================ rts/map.js — procedural battlefield + pathfinding (no THREE, no DOM) ============================
// A 56x56-cell diorama: hills, a river (deep water blocks, fords are shallow and slow), forests that block movement,
// rocks, and crystal ("ore") nodes. Everything is a pure function of the seed (procgen/noise.js), so the simulation can run
// headless in node and the browser alike. Cell (i,j) covers x in [i,i+1], z in [j,j+1]. Heights live on a (N+1)^2 vertex grid.
import { makeNoise, rng } from '../procgen/noise.js?v=rts3';

export const N = 56;
export const WL = 0.45;                       // water level (cell units)
export const K = { GRASS: 0, FORD: 1, WATER: 2, FOREST: 3, ROCK: 4 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function genMap(seed = 7) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const m = tryGen(seed + attempt * 101);
    if (m) { m.seed = seed; return m; }
  }
  throw new Error('map generation failed for seed ' + seed);
}

function tryGen(seed) {
  const nz = makeNoise(seed), R = rng(seed * 31 + 5);
  const starts = [{ x: 9.5, z: N - 9.5 }, { x: N - 9.5, z: 9.5 }];
  const fords = [0.2 + R() * 0.06, 0.5 + (R() - 0.5) * 0.06, 0.8 - R() * 0.06].map((f) => f * N);   // ford centres along the river (s = (x+z)/2)
  const meander = (s) => 3.2 * nz.fbm2(s * 0.07 + 40, 3.3, { oct: 2 });
  const riverD = (x, z) => Math.abs((x - z) * 0.7071 - meander((x + z) * 0.5));
  const fordF = (x, z) => { const s = (x + z) * 0.5; let f = 0; for (const c of fords) f = Math.max(f, 1 - sstep(2.2, 4.4, Math.abs(s - c))); return f; };

  const V = N + 1, h = new Float32Array(V * V);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    let y = 1.45 + 3.4 * nz.fbm2(i * 0.05, j * 0.05, { oct: 4 }) + 3.0 * Math.max(0, nz.ridged2(i * 0.04 + 9, j * 0.04 - 5, { oct: 3 }) - 0.42);
    y = Math.max(y, 0.55);
    for (const s of starts) { const d = Math.hypot(i - s.x, j - s.z); y = y + (1.35 - y) * (1 - sstep(8, 14, d)); }   // flat base plateaus
    const d = riverD(i, j), w = 1 - sstep(1.6, 4.0, d);
    const bed = WL - 0.95 + fordF(i, j) * 0.8;       // fords: bed just below the surface (wade-able)
    y = y + (bed - y) * w;
    h[j * V + i] = y;
  }
  const hv = (i, j) => h[clamp(j, 0, N) * V + clamp(i, 0, N)];
  const heightAt = (x, z) => {
    x = clamp(x, 0, N - 1e-6); z = clamp(z, 0, N - 1e-6);
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
    return (hv(i, j) * (1 - fx) + hv(i + 1, j) * fx) * (1 - fz) + (hv(i, j + 1) * (1 - fx) + hv(i + 1, j + 1) * fx) * fz;
  };

  const kind = new Uint8Array(N * N), nodes = [], trees = [], rocks = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const c = heightAt(i + 0.5, j + 0.5);
    kind[j * N + i] = c < WL - 0.3 ? K.WATER : c < WL + 0.08 ? K.FORD : K.GRASS;
  }
  const near = (x, z, p, r) => Math.hypot(x - p.x, z - p.z) < r;
  const nearStart = (x, z, r) => starts.some((s) => near(x, z, s, r));
  // resource nodes: 3 behind/beside each base, 2 forward on each side
  const wantNode = [];
  starts.forEach((s, k) => {
    const dir = k === 0 ? { x: 1, z: -1 } : { x: -1, z: 1 }, L = 0.7071, perp = { x: dir.z * L, z: -dir.x * L };
    const back = { x: -dir.x * L, z: -dir.z * L };
    wantNode.push([s.x + back.x * 5 + perp.x * 5, s.z + back.z * 5 + perp.z * 5], [s.x + back.x * 6.5 - perp.x * 3, s.z + back.z * 6.5 - perp.z * 3], [s.x + dir.x * L * 7 + perp.x * 6, s.z + dir.z * L * 7 + perp.z * 6]);
    wantNode.push([s.x + dir.x * L * 17 + perp.x * 8, s.z + dir.z * L * 17 + perp.z * 8], [s.x + dir.x * L * 17 - perp.x * 8, s.z + dir.z * L * 17 - perp.z * 8]);
  });
  for (const [wx, wz] of wantNode) {
    let best = null, bd = 1e9;
    for (let j = 2; j < N - 2; j++) for (let i = 2; i < N - 2; i++) {
      if (kind[j * N + i] !== K.GRASS) continue;
      const cx = i + 0.5, cz = j + 0.5;
      if (heightAt(cx, cz) < WL + 0.5 || nearStart(cx, cz, 5.5) || nodes.some((n) => Math.hypot(n.x - cx, n.z - cz) < 3.2)) continue;
      const d = Math.hypot(cx - wx, cz - wz); if (d < bd) { bd = d; best = { x: cx, z: cz }; }
    }
    if (best) nodes.push({ id: nodes.length, x: best.x, z: best.z, amount: 1400, max: 1400 });
  }
  // forests and rocks
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const idx = j * N + i, cx = i + 0.5, cz = j + 0.5;
    if (kind[idx] !== K.GRASS || nearStart(cx, cz, 11.5) || nodes.some((n) => Math.hypot(n.x - cx, n.z - cz) < 3.2)) continue;
    if (heightAt(cx, cz) < WL + 0.45) continue;
    const f = nz.fbm2(cx * 0.12 + 100, cz * 0.12 - 40, { oct: 3 }), rk = nz.ridged2(cx * 0.1 - 30, cz * 0.1 + 60, { oct: 2 });
    if (f > 0.2) {
      kind[idx] = K.FOREST;
      const n = 1 + (R() < 0.6 ? 1 : 0);
      for (let t = 0; t < n; t++) trees.push({ x: cx + (R() - 0.5) * 0.7, z: cz + (R() - 0.5) * 0.7, s: 0.75 + R() * 0.55, k: R() < 0.55 ? 0 : 1, y: R() * 6.28 });
    } else if (rk > 0.8 && R() < 0.7) { kind[idx] = K.ROCK; rocks.push({ x: cx + (R() - 0.5) * 0.3, z: cz + (R() - 0.5) * 0.3, s: 0.55 + R() * 0.5, sy: 0.9 + R() * 0.5, yaw: R() * 6.28, variant: Math.floor(R() * 3) }); }
  }
  // a few harmless decorative stones and shrubs (do not block)
  const deco = [];
  for (let n = 0; n < 70; n++) {
    const x = 1 + R() * (N - 2), z = 1 + R() * (N - 2);
    if (kind[Math.floor(z) * N + Math.floor(x)] === K.GRASS && !nearStart(x, z, 5)) deco.push({ x, z, s: 0.18 + R() * 0.22, yaw: R() * 6.28 });
  }
  const map = { N, V, h, heightAt, kind, nodes, trees, rocks, deco, starts, fords, riverD, seed };
  // connectivity: both bases and all nodes must be reachable from player start over land/fords; clear obstacles on a line otherwise
  const blocked = (i, j) => kind[j * N + i] === K.WATER || kind[j * N + i] === K.FOREST || kind[j * N + i] === K.ROCK;
  const reach = flood(map, starts[0], blocked, nodes);
  const bad = [starts[1], ...nodes].filter((p) => !reach(p));
  if (bad.length) {
    for (const p of bad) { const a = starts[0], steps = 90; for (let s = 0; s <= steps; s++) { const x = a.x + (p.x - a.x) * s / steps, z = a.z + (p.z - a.z) * s / steps, i = Math.floor(x), j = Math.floor(z); for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const q = (j + dj) * N + i + di; if (kind[q] === K.FOREST || kind[q] === K.ROCK) { kind[q] = K.GRASS; } } } }
    const trees2 = trees.filter((t) => kind[Math.floor(t.z) * N + Math.floor(t.x)] === K.FOREST); trees.length = 0; trees.push(...trees2);
    const rocks2 = rocks.filter((t) => kind[Math.floor(t.z) * N + Math.floor(t.x)] === K.ROCK); rocks.length = 0; rocks.push(...rocks2);
    const reach2 = flood(map, starts[0], blocked, nodes);
    if ([starts[1], ...nodes].some((p) => !reach2(p))) return null;
  }
  return map;
}

function flood(map, s, blocked, nodes) {
  const seen = new Uint8Array(N * N), q = [Math.floor(s.z) * N + Math.floor(s.x)]; seen[q[0]] = 1;
  while (q.length) {
    const c = q.pop(), ci = c % N, cj = (c / N) | 0;
    for (let d = 0; d < 4; d++) {
      const ni = ci + (d === 0) - (d === 1), nj = cj + (d === 2) - (d === 3);
      if (ni < 0 || nj < 0 || ni >= N || nj >= N || seen[nj * N + ni] || blocked(ni, nj)) continue;
      seen[nj * N + ni] = 1; q.push(nj * N + ni);
    }
  }
  return (p) => { // reachable if the cell or any 8-neighbour is flooded (resource cells themselves are blocked for walking)
    const i = Math.floor(p.x), j = Math.floor(p.z);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < N && b < N && seen[b * N + a]) return true; }
    return false;
  };
}

// ---------------------------------------------------------------- navigation grid + A*
export function createNav(map) {
  const stat = new Uint8Array(N * N);                // static blockers: water, forest, rock, resource nodes
  const occ = new Uint8Array(N * N);                 // buildings
  for (let q = 0; q < N * N; q++) { const k = map.kind[q]; stat[q] = k === K.WATER || k === K.FOREST || k === K.ROCK ? 1 : 0; }
  for (const n of map.nodes) stat[Math.floor(n.z) * N + Math.floor(n.x)] = 1;
  const nav = { version: 1, stat, occ };
  const isBlockedCell = (i, j) => i < 0 || j < 0 || i >= N || j >= N || stat[j * N + i] || occ[j * N + i];
  nav.blockedCell = isBlockedCell;
  nav.blockedAt = (x, z) => isBlockedCell(Math.floor(x), Math.floor(z));
  nav.setNode = (n, on) => { stat[Math.floor(n.z) * N + Math.floor(n.x)] = on ? 1 : 0; nav.version++; };
  nav.occupy = (cx, cz, size, on) => { for (let j = cz; j < cz + size; j++) for (let i = cx; i < cx + size; i++) if (i >= 0 && j >= 0 && i < N && j < N) occ[j * N + i] += on ? 1 : -1; nav.version++; };
  nav.speedMul = (x, z) => (map.kind[clamp(Math.floor(z), 0, N - 1) * N + clamp(Math.floor(x), 0, N - 1)] === K.FORD ? 0.6 : 1);

  // nearest free cell centre to (x,z) by expanding rings; returns {x,z} or null
  nav.nearestFree = (x, z, maxR = 9) => {
    const ci = clamp(Math.floor(x), 0, N - 1), cj = clamp(Math.floor(z), 0, N - 1);
    if (!isBlockedCell(ci, cj)) return { x, z };
    let best = null, bd = 1e9;
    for (let r = 1; r <= maxR; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r || isBlockedCell(ci + di, cj + dj)) continue;
        const d = Math.hypot(ci + di + 0.5 - x, cj + dj + 0.5 - z); if (d < bd) { bd = d; best = { x: ci + di + 0.5, z: cj + dj + 0.5 }; }
      }
      if (best) return best;
    }
    return null;
  };

  // can a body of radius r walk the straight segment? (samples every 0.3 cells, 3 lateral offsets)
  nav.los = (x0, z0, x1, z1, r = 0.34) => {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(L / 0.3));
    const px = L > 1e-6 ? -dz / L : 0, pz = L > 1e-6 ? dx / L : 0;
    for (let s = 0; s <= n; s++) {
      const x = x0 + dx * s / n, z = z0 + dz * s / n;
      if (nav.blockedAt(x, z) || nav.blockedAt(x + px * r, z + pz * r) || nav.blockedAt(x - px * r, z - pz * r)) return false;
    }
    return true;
  };

  // A* on the 8-connected grid. Returns smoothed waypoints [{x,z}...] ending at the goal (or null).
  const G = new Float32Array(N * N), F = new Float32Array(N * N), from = new Int32Array(N * N), state = new Uint8Array(N * N);
  const heap = [];
  const push = (n) => { heap.push(n); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (F[heap[p]] <= F[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, s = i; if (l < heap.length && F[heap[l]] < F[heap[s]]) s = l; if (r < heap.length && F[heap[r]] < F[heap[s]]) s = r; if (s === i) break; [heap[s], heap[i]] = [heap[i], heap[s]]; i = s; } } return top; };
  nav.path = (sx, sz, gx, gz) => {
    const si = clamp(Math.floor(sx), 0, N - 1), sj = clamp(Math.floor(sz), 0, N - 1);
    const goal = nav.nearestFree(gx, gz); if (!goal) return null;
    const gi = Math.floor(goal.x), gj = Math.floor(goal.z), start = sj * N + si, end = gj * N + gi;
    if (start === end || nav.los(sx, sz, goal.x, goal.z)) return [{ x: goal.x, z: goal.z }];
    state.fill(0); heap.length = 0; G[start] = 0; F[start] = 0; from[start] = -1; state[start] = 1; push(start);
    let found = false, guard = 0;
    while (heap.length && guard++ < 6000) {
      const c = pop(); if (state[c] === 2) continue; state[c] = 2;
      if (c === end) { found = true; break; }
      const ci = c % N, cj = (c / N) | 0;
      for (let d = 0; d < 8; d++) {
        const di = DX[d], dj = DZ[d], ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nq = nj * N + ni; if (state[nq] === 2) continue;
        if (isBlockedCell(ni, nj) && nq !== end) continue;
        if (di && dj && (isBlockedCell(ci + di, cj) || isBlockedCell(ci, cj + dj))) continue;    // no corner cutting
        const k = map.kind[nq], step = (di && dj ? 1.414 : 1) * (k === K.FORD ? 2.2 : 1) + Math.abs(map.heightAt(ni + 0.5, nj + 0.5) - map.heightAt(ci + 0.5, cj + 0.5)) * 0.4;
        const g = G[c] + step;
        if (state[nq] === 0 || g < G[nq]) {
          G[nq] = g; from[nq] = c; state[nq] = 1;
          const ex = Math.abs(ni - gi), ez = Math.abs(nj - gj); F[nq] = g + (ex + ez) + (1.414 - 2) * Math.min(ex, ez);
          push(nq);
        }
      }
    }
    if (!found) return null;
    const pts = [{ x: goal.x, z: goal.z }];
    for (let c = from[end]; c !== -1 && c !== start; c = from[c]) pts.push({ x: (c % N) + 0.5, z: ((c / N) | 0) + 0.5 });
    pts.push({ x: sx, z: sz }); pts.reverse();
    // string-pull smoothing with line of sight
    const out = []; let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !nav.los(pts[a].x, pts[a].z, pts[b].x, pts[b].z)) b--;
      out.push({ x: pts[b].x, z: pts[b].z }); a = b;
    }
    return out;
  };
  return nav;
}
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DZ = [0, 0, 1, -1, 1, -1, 1, -1];
