// ============================ procgen/trees.js — real trees grown from numbers ============================
//
//   import { TREE_PRESETS, QUALITY, growTree, buildTreeGeometry, createTreeLibrary, createTreeField } from '../procgen/trees.js';
//
//   // 1) one tree from parameters (deterministic: same params + seed → same tree)
//   const skeleton = growTree(TREE_PRESETS.oak, 42);              // limbs: { pts[], rad[], level, len }  (metres, y up, base at origin)
//   const { bark, leaves, height, width } = buildTreeGeometry(skeleton, TREE_PRESETS.oak, { lod: 0, cards: 1 });
//
//   // 2) a library of species × variants × LODs with materials, wind and baked impostors
//   const lib = await createTreeLibrary({ renderer, scene, quality: QUALITY.high, species: ['oak','birch','pine','fir'],
//                                          sun: { dir: Vector3, color: 0xfff0d8, intensity: 3 }, env: pmremTexture, tick });
//   //   lib.update(t)   → drives wind (call every frame with world time; freeze it to pause)
//
//   // 3) thousands of instances with automatic LOD: full 3D crown → reduced crown → baked impostor billboard
//   const field = createTreeField(lib, items, scene);              // items: [{ x, y, z, s, yaw, species, variant, tint:[r,g,b] }]
//   field.layout({ x, z, lod0: 45, lod1: 170, far: 800 });         // re-select LODs for a viewpoint (cheap; call when the seat changes)
//   field.setShadows(true);                                        // LOD0 trees cast shadows (the sun light's shadow camera decides what lands)
//
//   Preset fields (all plain numbers): height[min,max] trunk{radius,taper,bend,lean} crown{shape,bottom,radius,centerY}
//   levels[{ n | whorls:[count,perWhorl], angle[min,max]°, len[min,max], rad, up, droop, curl, segs, start }]
//   leaf{ atlas, fromLevel, size[min,max], perBranch[min,max] }  or  foliage{ atlas:'needle', levels, sprayW, sprayL, spacing, rolls }
//   bark 'bark:oak'|'bark:pine'|'bark:birch', uTile, vTile.
//
// Crowns are many small cut-out leaf/needle cards oriented around real branches, with soft crown-shaped shading normals,
// so they read as full volumes from above and from the side (never a flat card). Impostors are baked from the generated
// tree itself with a render target (8 views × variants) and chosen per instance from the viewer's azimuth.
// ===============================================================================================================

import * as THREE from 'three';
import { rng, makeNoise } from './noise.js';
import { makeLeafAtlas, makeMaterialMaps, standardMaterial } from './textures.js';

const V3 = THREE.Vector3, TAU = Math.PI * 2, DEG = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const range = (R, r) => (Array.isArray(r) ? lerp(r[0], r[1], R()) : r);

export const QUALITY = {
  high: { name: 'high', tex: 512, atlas: 512, imp: 160, views: 8, variants: 3, cards: 1.0, lod0: 48, lod1: 130, shadowMap: 2048 },
  medium: { name: 'medium', tex: 256, atlas: 512, imp: 128, views: 8, variants: 2, cards: 0.7, lod0: 28, lod1: 90, shadowMap: 1024 },
  light: { name: 'light', tex: 256, atlas: 256, imp: 96, views: 8, variants: 2, cards: 0.45, lod0: 14, lod1: 55, shadowMap: 0 },
};

export const TREE_PRESETS = {
  oak: {
    kind: 'broadleaf', height: [12.5, 16], refHeight: 14, trunk: { radius: 0.38, taper: 0.8, bend: 0.2, lean: 0.05 },
    crown: { shape: 'round', bottom: 0.3, radius: 0.52, centerY: 0.68 },
    levels: [
      { n: [7, 9], angle: [40, 64], len: [0.5, 0.68], rad: 0.5, up: 0.35, droop: 0.1, curl: 0.35, segs: 6, start: 0 },
      { n: [5, 7], angle: [35, 62], len: [0.45, 0.62], rad: 0.55, up: 0.25, droop: 0.2, curl: 0.4, segs: 5, start: 0.22 },
      { n: [4, 6], angle: [30, 60], len: [0.5, 0.7], rad: 0.6, up: 0.15, droop: 0.3, curl: 0.5, segs: 3, start: 0.25 },
    ],
    leaf: { atlas: 'oak', fromLevel: 2, size: [1.5, 2.2], perBranch: [8, 12] }, bark: 'bark:oak', uTile: 1.6, vTile: 2.2,
  },
  birch: {
    kind: 'broadleaf', height: [10, 13], refHeight: 11, trunk: { radius: 0.13, taper: 0.7, bend: 0.3, lean: 0.08 },
    crown: { shape: 'ovoid', bottom: 0.35, radius: 0.3, centerY: 0.7 },
    levels: [
      { n: [9, 12], angle: [28, 48], len: [0.35, 0.5], rad: 0.45, up: 0.3, droop: 0.25, curl: 0.45, segs: 5, start: 0 },
      { n: [5, 7], angle: [30, 58], len: [0.45, 0.6], rad: 0.5, up: 0.0, droop: 0.55, curl: 0.5, segs: 4, start: 0.25 },
      { n: [4, 5], angle: [25, 55], len: [0.45, 0.6], rad: 0.6, up: 0.0, droop: 0.7, curl: 0.5, segs: 3, start: 0.3 },
    ],
    leaf: { atlas: 'birch', fromLevel: 2, size: [1.0, 1.5], perBranch: [10, 15] }, bark: 'bark:birch', uTile: 1.0, vTile: 2.4,
  },
  pine: {
    kind: 'conifer', height: [16, 22], refHeight: 19, trunk: { radius: 0.3, taper: 0.88, bend: 0.2, lean: 0.05 },
    crown: { shape: 'ovoid', bottom: 0.5, radius: 0.26, centerY: 0.78 },
    levels: [
      { whorls: [9, 3], angle: [62, 95], len: [0.16, 0.3], rad: 0.3, up: 0.35, droop: 0.15, curl: 0.35, segs: 6 },
      { n: [4, 6], angle: [40, 75], len: [0.35, 0.5], rad: 0.5, up: 0.2, droop: 0.3, curl: 0.4, segs: 3, start: 0.4 },
    ],
    foliage: { atlas: 'needle', levels: [1, 2], sprayW: [1.3, 1.9], sprayL: [1.5, 2.2], spacing: 0.6, rolls: 3 }, bark: 'bark:pine', uTile: 1.4, vTile: 2.2,
  },
  fir: {
    kind: 'conifer', height: [22, 30], refHeight: 26, trunk: { radius: 0.34, taper: 0.93, bend: 0.08, lean: 0.02 },
    crown: { shape: 'cone', bottom: 0.1, radius: 0.22, centerY: 0.5 },
    levels: [
      { whorls: [36, 7], angle: [66, 96], len: [0.12, 0.21], rad: 0.22, up: -0.1, droop: 0.55, curl: 0.25, segs: 5 },
      { n: [6, 8], angle: [55, 85], len: [0.35, 0.5], rad: 0.55, up: -0.2, droop: 0.6, curl: 0.3, segs: 3, start: 0.25 },
    ],
    foliage: { atlas: 'needle', levels: [1, 2], sprayW: [1.1, 1.6], sprayL: [1.3, 1.9], spacing: 0.5, rolls: 3 }, bark: 'bark:pine', uTile: 1.4, vTile: 2.2,
  },
  shrub: {
    kind: 'broadleaf', height: [1.1, 1.8], refHeight: 1.5, trunk: { radius: 0.03, taper: 0.5, bend: 0.3, lean: 0.1 },
    crown: { shape: 'round', bottom: 0.1, radius: 0.7, centerY: 0.55 },
    levels: [
      { n: [7, 10], angle: [30, 62], len: [0.6, 0.85], rad: 0.55, up: 0.2, droop: 0.15, curl: 0.4, segs: 4, start: 0 },
      { n: [4, 6], angle: [30, 60], len: [0.5, 0.7], rad: 0.6, up: 0.1, droop: 0.2, curl: 0.5, segs: 3, start: 0.25 },
    ],
    leaf: { atlas: 'oak', fromLevel: 1, size: [0.35, 0.55], perBranch: [5, 8] }, bark: 'bark:oak', uTile: 0.6, vTile: 0.8,
  },
};

// ---------------------------------------------------------------- growth
const basis = (T) => { const up = Math.abs(T.y) < 0.95 ? new V3(0, 1, 0) : new V3(1, 0, 0); const U = new V3().crossVectors(T, up).normalize(); return [U, new V3().crossVectors(T, U).normalize()]; };
function makePath(R, N, start, dir, length, r0, r1, { segs, curl = 0, up = 0, droop = 0 }) {
  const pts = [start.clone()], rad = [r0], d = dir.clone().normalize(), step = length / segs, ph = R() * 100;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    d.x += N.n2(ph + i * 0.7, 0.3) * curl * 0.5; d.z += N.n2(ph + i * 0.7, 7.1) * curl * 0.5; d.y += up * 0.12 - droop * 0.2 * t; d.normalize();
    pts.push(pts[i - 1].clone().addScaledVector(d, step)); rad.push(lerp(r0, r1, Math.pow(t, 0.9)));
  }
  return { pts, rad, len: length, level: 0 };
}
function pathAt(b, t) {
  const n = b.pts.length - 1, f = clamp(t) * n, i = Math.min(n - 1, Math.floor(f)), k = f - i;
  const p = b.pts[i].clone().lerp(b.pts[i + 1], k), T = b.pts[i + 1].clone().sub(b.pts[i]).normalize();
  return { p, T, r: lerp(b.rad[i], b.rad[i + 1], k) };
}
function profile(shape, tn) {
  if (shape === 'cone') return 1 - 0.9 * tn;
  if (shape === 'ovoid') return Math.sin(Math.PI * Math.pow(clamp(tn * 0.9 + 0.08), 0.8));
  return Math.sin(Math.PI * Math.pow(clamp(tn * 0.92 + 0.05), 0.75));
}
export function growTree(P, seed, { lod = 0 } = {}) {
  const R = rng(seed), N = makeNoise(seed + 11), H = range(R, P.height), r0 = P.trunk.radius * H / (P.refHeight || 14);
  const lean = new V3((R() - 0.5) * 2 * P.trunk.lean, 1, (R() - 0.5) * 2 * P.trunk.lean);
  const trunk = makePath(R, N, new V3(), lean, H, r0, r0 * (1 - P.trunk.taper), { segs: 12, curl: P.trunk.bend, up: 0.05 });
  trunk.level = 0;
  const all = [trunk], nLevels = Math.max(1, P.levels.length - (lod >= 1 ? 1 : 0));
  let parents = [trunk]; const bottom = P.crown.bottom;
  for (let L = 0; L < nLevels; L++) {
    const spec = P.levels[L], next = [], reduce = lod >= 1 && L > 0 ? 0.65 : 1;
    for (const par of parents) {
      let slots = [];
      if (L === 0 && spec.whorls) {
        const [wc, per] = spec.whorls, W = Math.max(3, Math.round(wc * (lod >= 1 ? 0.9 : 1)));
        for (let w = 0; w < W; w++) for (let j = 0; j < per; j++) slots.push({ t: bottom + (1 - bottom) * 0.97 * Math.pow(w / (W - 1 || 1), 0.92), az: w * 2.399 + (j / per) * TAU + R() * 0.4 });
      } else {
        const n = Math.max(1, Math.round(range(R, spec.n) * reduce * (L === 0 ? 1 : 1)));
        const t0 = L === 0 ? bottom : (spec.start || 0.2);
        for (let k = 0; k < n; k++) slots.push({ t: lerp(t0, 0.98, (k + 0.5 * R()) / n), az: k * 2.399 + R() * 0.6 });
      }
      for (const s of slots) {
        const at = pathAt(par, s.t), tn = L === 0 ? clamp((s.t - bottom) / (1 - bottom)) : s.t;
        const len = (L === 0 ? H * range(R, spec.len) * profile(P.crown.shape, tn) : par.len * range(R, spec.len) * (1 - 0.45 * s.t));
        if (len < 0.15) continue;
        const [U, Vv] = basis(at.T), a = range(R, spec.angle) * DEG, dir = at.T.clone().multiplyScalar(Math.cos(a)).addScaledVector(U, Math.cos(s.az) * Math.sin(a)).addScaledVector(Vv, Math.sin(s.az) * Math.sin(a));
        const rb = at.r * spec.rad, segs = Math.max(2, spec.segs - (lod >= 1 ? 1 : 0));
        const b = makePath(R, N, at.p, dir, len, rb, Math.max(rb * 0.08, 0.004), { segs, curl: spec.curl, up: spec.up, droop: spec.droop });
        b.level = L + 1; b.parentT = s.t; all.push(b); next.push(b);
      }
    }
    parents = next;
  }
  return { branches: all, height: H, P };
}

// ---------------------------------------------------------------- geometry
class Buf {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.sway = []; this.flut = []; this.idx = []; }
  vert(p, n, u, v, c, sw, fl) { this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(u, v); if (c) this.col.push(c[0], c[1], c[2]); this.sway.push(sw); this.flut.push(fl); return this.pos.length / 3 - 1; }
  geometry(withColor) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (withColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1)); g.setAttribute('aFlut', new THREE.Float32BufferAttribute(this.flut, 1));
    g.setIndex(this.idx); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
}
function addTube(B, b, rs, uTile, vTile, swayAt) {
  const n = b.pts.length, rings = []; let acc = 0, Nn = null;
  for (let i = 0; i < n; i++) {
    const T = (i === 0 ? b.pts[1].clone().sub(b.pts[0]) : i === n - 1 ? b.pts[i].clone().sub(b.pts[i - 1]) : b.pts[i + 1].clone().sub(b.pts[i - 1])).normalize();
    if (!Nn) Nn = basis(T)[0]; else { Nn = Nn.clone().addScaledVector(T, -Nn.dot(T)); if (Nn.lengthSq() < 1e-6) Nn = basis(T)[0]; Nn.normalize(); }
    const Bn = new V3().crossVectors(T, Nn).normalize(); if (i > 0) acc += b.pts[i].distanceTo(b.pts[i - 1]);
    const first = B.pos.length / 3, flare = i === 0 ? 1.18 : 1, r = b.rad[i] * flare, sw = swayAt(b.pts[i], b.level);
    for (let j = 0; j <= rs; j++) { const a = (j / rs) * TAU, nr = Nn.clone().multiplyScalar(Math.cos(a)).addScaledVector(Bn, Math.sin(a)); B.vert(b.pts[i].clone().addScaledVector(nr, r), nr, (j / rs) * uTile * Math.max(0.35, Math.min(1, r * 2.6)) * 2, acc / vTile, null, sw, 0); }
    rings.push(first);
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < rs; j++) { const a = rings[i] + j, b2 = rings[i + 1] + j; B.idx.push(a, b2, a + 1, a + 1, b2, b2 + 1); }
}
function cell(R, atlasCells = 2) { const cx = Math.floor(R() * atlasCells), cy = Math.floor(R() * atlasCells), e = 0.008, s = 1 / atlasCells; return [cx * s + e, (cx + 1) * s - e, 1 - (cy + 1) * s + e, 1 - cy * s - e]; }
function addCard(B, c, v, u, w, h, nrm, uvr, col, sw) {
  const p0 = c.clone().addScaledVector(u, -w / 2), p1 = c.clone().addScaledVector(u, w / 2), p2 = p1.clone().addScaledVector(v, h), p3 = p0.clone().addScaledVector(v, h);
  const i0 = B.vert(p0, nrm, uvr[0], uvr[2], col, sw, 0.6), i1 = B.vert(p1, nrm, uvr[1], uvr[2], col, sw, 0.6), i2 = B.vert(p2, nrm, uvr[1], uvr[3], col, sw, 1), i3 = B.vert(p3, nrm, uvr[0], uvr[3], col, sw, 1);
  B.idx.push(i0, i1, i2, i0, i2, i3);
}
export function buildTreeGeometry(sk, P, { lod = 0, cards = 1, seed = 1 } = {}) {
  const R = rng(seed * 977 + 5), H = sk.height, Rc = Math.max(0.5, P.crown.radius * H), center = new V3(0, H * P.crown.centerY, 0);
  const bark = new Buf(), leaves = new Buf();
  const swayAt = (p) => clamp(p.y / H) ** 1.8 * 0.5 + clamp(Math.hypot(p.x, p.z) / Rc) ** 1.3 * 0.5;
  for (const b of sk.branches) {
    const rs = b.level === 0 ? (lod ? 6 : 9) : b.level === 1 ? (lod ? 4 : 5) : (lod ? 3 : 4);
    if (b.level >= 3 && lod >= 1 && b.rad[0] < 0.012) continue;
    addTube(bark, b, rs, P.uTile || 1, P.vTile || 2, swayAt);
  }
  const shade = (p) => { const rel = clamp(Math.hypot(p.x, p.z) / Rc), hh = clamp((p.y - H * P.crown.bottom) / (H * (1 - P.crown.bottom))); return [lerp(0.55, 1.08, sstep(0.0, 0.9, rel)) * lerp(0.82, 1.06, hh), 0, 0]; };
  const cardScale = lod >= 1 ? 1.75 : 1, cardCount = (lod >= 1 ? 0.38 : 1) * cards;
  if (P.leaf) {
    const L = P.leaf;
    for (const b of sk.branches) {
      if (b.level < L.fromLevel) continue;
      const n = Math.max(1, Math.round(range(R, L.perBranch) * cardCount * (0.6 + 0.4 * Math.min(1, b.len / 2))));
      for (let k = 0; k < n; k++) {
        const t = lerp(0.3, 1.0, (k + R()) / n), at = pathAt(b, t), outward = at.p.clone().sub(center).normalize();
        const size = range(R, L.size) * cardScale * (0.75 + 0.5 * R()), tip = at.T.clone().multiplyScalar(0.5).add(outward.clone().multiplyScalar(0.5)).add(new V3(0, 0.35 + 0.3 * (R() - 0.5), 0)).normalize();
        const rnd = new V3(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(0.9), v = tip.clone().add(rnd).normalize(), roll = R() * TAU;
        const [U0, V0] = basis(v), u = U0.clone().multiplyScalar(Math.cos(roll)).addScaledVector(V0, Math.sin(roll)), cn = new V3().crossVectors(u, v).normalize();
        const nrm = cn.multiplyScalar(0.3).addScaledVector(outward, 0.62).add(new V3(0, 0.2, 0)).normalize(), s0 = shade(at.p)[0], j = 0.9 + 0.2 * R();
        addCard(leaves, at.p, v, u, size * 0.95, size, nrm, cell(R), [s0 * j * (0.97 + 0.1 * R()), s0 * j, s0 * j * (0.9 + 0.12 * R())], swayAt(at.p));
      }
    }
  }
  if (P.foliage) {
    const F = P.foliage, up = new V3(0, 1, 0);
    for (const b of sk.branches) {
      if (!F.levels.includes(b.level)) continue;
      if (lod >= 1) {              // reduced crown: one big bough card pair per branch (reads as layered tiers from a distance)
        const at = pathAt(b, 0.1), T = b.pts[b.pts.length - 1].clone().sub(b.pts[0]).normalize(); T.y -= 0.12; T.normalize();
        const outward = new V3(at.p.x, 0, at.p.z).normalize().add(new V3(0, 0.35, 0)).normalize(), [U0, V0] = basis(T), shd = shade(at.p)[0];
        for (let rr = 0; rr < 2; rr++) {
          const roll = rr * 1.25 + R() * 0.4, u = U0.clone().multiplyScalar(Math.cos(roll)).addScaledVector(V0, Math.sin(roll)), j = 0.9 + 0.2 * R();
          const nrm = outward.clone().multiplyScalar(0.75).addScaledVector(new V3().crossVectors(u, T).normalize(), 0.2).add(new V3(0, 0.15, 0)).normalize();
          addCard(leaves, at.p, T, u, Math.max(1.5, b.len * 0.78), Math.max(1.6, b.len * 1.12), nrm, cell(R), [shd * j, shd * j, shd * j * 0.95], swayAt(at.p));
        }
        continue;
      }
      const stepLen = F.spacing * (b.level === 1 ? 1 : 1.5) / Math.max(0.35, cards), n = Math.max(1, Math.floor(b.len / stepLen));
      for (let k = 0; k < n; k++) {
        const t = lerp(0.12, 1, (k + 0.5 * R()) / n), at = pathAt(b, t), sc = 0.55 + 0.6 * (1 - t * 0.6);
        const T = at.T.clone().applyAxisAngle(up, (R() - 0.5) * 0.8); T.y -= 0.2 * (b.level === 1 ? 1 : 0.5); T.normalize();
        const outward = new V3(at.p.x, 0, at.p.z).normalize().add(new V3(0, 0.35, 0)).normalize(), [U0, V0] = basis(T), shd = shade(at.p)[0];
        for (let rr = 0; rr < F.rolls; rr++) {
          const roll = (rr / F.rolls) * Math.PI + R() * 0.7, u = U0.clone().multiplyScalar(Math.cos(roll)).addScaledVector(V0, Math.sin(roll));
          const nrm = outward.clone().multiplyScalar(0.7).addScaledVector(new V3().crossVectors(u, T).normalize(), 0.25).add(new V3(0, 0.15, 0)).normalize(), j = 0.9 + 0.2 * R();
          addCard(leaves, at.p, T, u, range(R, F.sprayW) * sc, range(R, F.sprayL) * sc, nrm, cell(R), [shd * j, shd * j * (0.98 + 0.06 * R()), shd * j * 0.95], swayAt(at.p));
        }
      }
    }
  }
  let maxR = 0, maxY = 0;
  for (const B of [bark, leaves]) for (let i = 0; i < B.pos.length; i += 3) { maxR = Math.max(maxR, Math.hypot(B.pos[i], B.pos[i + 2])); maxY = Math.max(maxY, B.pos[i + 1]); }
  return { bark: bark.geometry(false), leaves: leaves.geometry(true), height: Math.max(H, maxY), width: Math.max(Rc * 2, maxR * 2) };   // true extents (cards stick out past the nominal crown)
}

// ---------------------------------------------------------------- materials (wind + soft leaf shading)
function windPatch(shader, u, leaf) {
  shader.uniforms.uTime = u.uTime; shader.uniforms.uAmp = u.uAmp; shader.uniforms.uAmpScale = u.uAmpScale;
  shader.vertexShader = `uniform float uTime, uAmp, uAmpScale; attribute float aSway; attribute float aFlut;\n` + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    #ifdef USE_INSTANCING
      float ph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.11;
    #else
      float ph = 0.0;
    #endif
    float gust = 0.6 + 0.4 * sin(uTime * 0.23 + ph);
    float sw = aSway * uAmp * uAmpScale * (0.7 * sin(uTime * 0.9 + ph) + 0.3 * sin(uTime * 1.7 + ph * 1.7)) * gust;
    transformed.x += sw; transformed.z += sw * 0.4;
    transformed += normal * aFlut * 0.035 * uAmpScale * sin(uTime * 3.1 + position.x * 4.0 + position.y * 3.0 + position.z * 5.0 + ph);`);
  if (leaf) shader.fragmentShader = shader.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');   // keep the smooth crown normals on both card faces
}
export function treeMaterials(maps, atlas, wind, { alphaTest = 0.45 } = {}) {
  const bark = standardMaterial(maps.bark, { roughness: 1, normalScale: 1 }); bark.userData.wind = wind;
  bark.onBeforeCompile = (sh) => windPatch(sh, wind, false);
  const leaf = new THREE.MeshStandardMaterial({ map: atlas.map, alphaTest, side: THREE.DoubleSide, vertexColors: true, roughness: 0.92, metalness: 0 });
  leaf.onBeforeCompile = (sh) => windPatch(sh, wind, true);
  return { bark, leaf };
}

// ---------------------------------------------------------------- impostors
const IMP_VERT = `
  attribute vec3 iPos; attribute vec2 iScale; attribute float iVar; attribute vec3 iTint;
  uniform float uViews, uVars, uCellW, uCellH, uYC; varying vec2 vUv; varying vec3 vTint; varying float vFog; varying float vV;
  uniform float uFogD;
  void main(){
    vec3 toCam = cameraPosition - iPos; float dist = length(toCam);
    float th = atan(toCam.x, toCam.z); float fi = mod(floor(th / 6.2831853 * uViews + 0.5), uViews);
    vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
    vec3 w = iPos + right * position.x * uCellW * iScale.x + vec3(0.0, 1.0, 0.0) * (position.y * uCellH + uYC) * iScale.y;
    vUv = (vec2(fi, iVar) + uv * 0.97 + 0.015) / vec2(uViews, uVars); vV = uv.y; vTint = iTint; vFog = 1.0 - exp(-uFogD * uFogD * dist * dist);
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }`;
const IMP_FRAG = `
  uniform sampler2D uAtlas; uniform vec3 uFogColor; uniform float uBright; varying vec2 vUv; varying vec3 vTint; varying float vFog; varying float vV;
  void main(){
    vec4 t = texture2D(uAtlas, vUv); if (t.a < 0.5) discard;
    vec3 c = t.rgb * vTint * uBright * mix(0.72, 1.0, smoothstep(0.0, 0.4, vV));
    c = mix(c, uFogColor, vFog); gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function bakeImpostor(renderer, scene, entry, mats, cfg, sun, env) {
  const V = cfg.views, VAR = entry.variants.length, e = 10 * DEG;
  let W = 0, H = 0; for (const v of entry.variants) { W = Math.max(W, v.width); H = Math.max(H, v.height); }
  const Wc = W * 1.12, Hc = (H * Math.cos(e) + W * Math.sin(e)) * 1.06, cw = cfg.imp, ch = Math.max(32, Math.round(cw * Hc / Wc));
  let type = THREE.HalfFloatType; try { if (!renderer.extensions.has('EXT_color_buffer_half_float') && !renderer.extensions.has('EXT_color_buffer_float')) type = THREE.UnsignedByteType; } catch (_) { /* default */ }
  const rt = new THREE.WebGLRenderTarget(cw * V, ch * VAR, { type, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, samples: 0 });
  const bs = new THREE.Scene(), lightDir = new THREE.DirectionalLight(sun.color, sun.intensity); bs.add(lightDir, lightDir.target); bs.environment = env || null; bs.environmentIntensity = 1;
  const cam = new THREE.OrthographicCamera(-Wc / 2, Wc / 2, Hc / 2, -Hc / 2, 0.1, 200); const dist = 60, mid = H * 0.5;
  cam.position.set(0, mid + dist * Math.sin(e), dist * Math.cos(e)); cam.lookAt(0, mid, 0);
  const saveTarget = renderer.getRenderTarget(), saveAuto = renderer.autoClear, saveTM = renderer.toneMapping, saveClear = renderer.getClearColor(new THREE.Color()), saveA = renderer.getClearAlpha(), saveShadow = renderer.shadowMap.enabled;
  renderer.toneMapping = THREE.NoToneMapping; renderer.shadowMap.enabled = false; renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.autoClear = true;
  mats.wind.uAmpScale.value = 0; rt.scissorTest = true;
  entry.variants.forEach((v, vi) => {
    const g = new THREE.Group(); g.add(new THREE.Mesh(v.lod1.bark, mats.bark), new THREE.Mesh(v.lod1.leaves, mats.leaf)); bs.add(g);
    for (let i = 0; i < V; i++) {
      const th = (i / V) * TAU; g.rotation.y = -th;
      lightDir.position.copy(sun.dir).applyAxisAngle(new V3(0, 1, 0), -th).multiplyScalar(50); lightDir.target.position.set(0, 0, 0);
      rt.viewport.set(i * cw, vi * ch, cw, ch); rt.scissor.set(i * cw, vi * ch, cw, ch); renderer.setRenderTarget(rt); renderer.render(bs, cam);   // re-bind so the new viewport/scissor take effect
    }
    bs.remove(g);
  });
  mats.wind.uAmpScale.value = 1; rt.scissorTest = false; rt.viewport.set(0, 0, cw * V, ch * VAR); renderer.setRenderTarget(saveTarget); renderer.autoClear = saveAuto; renderer.toneMapping = saveTM; renderer.setClearColor(saveClear, saveA); renderer.shadowMap.enabled = saveShadow;
  return { texture: rt.texture, rt, views: V, vars: VAR, cellW: Wc, cellH: Hc, yc: mid };
}

// ---------------------------------------------------------------- library + field
export async function createTreeLibrary({ renderer, scene, quality = QUALITY.high, species = ['oak', 'birch', 'pine', 'fir'], sun, env = null, tick = null, seed = 1 }) {
  const wind = { uTime: { value: 0 }, uAmp: { value: 0.5 }, uAmpScale: { value: 1 } };
  const lib = { quality, wind, species: {}, scene, renderer, shadows: false, fogUniforms: { uFogColor: { value: scene.fog ? scene.fog.color : new THREE.Color(0xbbbbbb) }, uFogD: { value: scene.fog ? scene.fog.density : 0 } } };
  const barkKinds = [...new Set(species.map(s => TREE_PRESETS[s].bark))], barkMaps = {};
  for (const k of barkKinds) { barkMaps[k] = await makeMaterialMaps(k, { size: quality.tex, seed: seed + 1 }); if (tick) await tick('bark ' + k); }
  const atlasCache = {};
  for (const name of species) {
    const P = TREE_PRESETS[name], aName = (P.leaf || P.foliage).atlas;
    if (!atlasCache[aName]) { atlasCache[aName] = makeLeafAtlas(aName, { size: quality.atlas, seed: seed + 3 }); if (tick) await tick('leaves ' + aName); }
    const mats = treeMaterials({ bark: barkMaps[P.bark] }, atlasCache[aName], wind); mats.wind = wind;
    const entry = { name, P, mats, variants: [] };
    for (let v = 0; v < quality.variants; v++) {
      const sd = seed * 100 + name.length * 13 + v * 7, sk0 = growTree(P, sd, { lod: 0 }), sk1 = growTree(P, sd, { lod: 1 });
      const g0 = buildTreeGeometry(sk0, P, { lod: 0, cards: quality.cards, seed: sd }), g1 = buildTreeGeometry(sk1, P, { lod: 1, cards: quality.cards, seed: sd });
      entry.variants.push({ lod0: g0, lod1: g1, height: Math.max(g0.height, g1.height), width: Math.max(g0.width, g1.width) });
    }
    if (tick) await tick('trees ' + name);
    if (sun) entry.imp = bakeImpostor(renderer, scene, entry, mats, quality, sun, env);
    lib.species[name] = entry; if (tick) await tick('billboards ' + name);
  }
  lib.barkMaps = barkMaps; lib.atlases = atlasCache;
  lib.update = (t) => { wind.uTime.value = t; if (scene.fog) lib.fogUniforms.uFogD.value = scene.fog.density; };
  return lib;
}

export function createTreeField(lib, items, scene) {
  const field = { meshes: [], lib };
  const bySp = {}; items.forEach((it, i) => { (bySp[it.species] ||= {}); (bySp[it.species][it.variant] ||= []).push(it); });
  const entries = [];
  for (const [name, variants] of Object.entries(bySp)) {
    const entry = lib.species[name], impItems = Object.values(variants).flat();
    const imp = entry.imp; let impMesh = null, impAttr = null;
    if (imp) {
      const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); g.setIndex([0, 1, 2, 0, 2, 3]);
      const cap = impItems.length;
      impAttr = { pos: new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3), scl: new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2), vr: new THREE.InstancedBufferAttribute(new Float32Array(cap), 1), tint: new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3) };
      g.setAttribute('iPos', impAttr.pos); g.setAttribute('iScale', impAttr.scl); g.setAttribute('iVar', impAttr.vr); g.setAttribute('iTint', impAttr.tint); g.instanceCount = 0;
      const mat = new THREE.ShaderMaterial({ vertexShader: IMP_VERT, fragmentShader: IMP_FRAG, uniforms: { uAtlas: { value: imp.texture }, uViews: { value: imp.views }, uVars: { value: imp.vars }, uCellW: { value: imp.cellW }, uCellH: { value: imp.cellH }, uYC: { value: 0 }, uBright: { value: 1 }, uFogColor: lib.fogUniforms.uFogColor, uFogD: lib.fogUniforms.uFogD }, side: THREE.DoubleSide });
      // quad spans y 0..1 → shift so the baked image sits on the ground: centre of the cell is at height yc
      mat.uniforms.uYC.value = imp.yc - 0.5 * imp.cellH;
      impMesh = new THREE.Mesh(g, mat); impMesh.frustumCulled = false; scene.add(impMesh); field.meshes.push(impMesh);
    }
    for (const [vi, list] of Object.entries(variants)) {
      const v = entry.variants[+vi], mk = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, list.length); m.frustumCulled = false; m.count = 0; m.setColorAt(0, new THREE.Color(1, 1, 1)); m.receiveShadow = true; scene.add(m); field.meshes.push(m); return m; };
      entries.push({ list, impMesh, impAttr, entry, v, m0b: mk(v.lod0.bark, entry.mats.bark), m0l: mk(v.lod0.leaves, entry.mats.leaf), m1b: mk(v.lod1.bark, entry.mats.bark), m1l: mk(v.lod1.leaves, entry.mats.leaf) });
    }
  }
  const o = new THREE.Object3D(), c = new THREE.Color();
  field.setShadows = (on) => { for (const e of entries) { e.m0b.castShadow = e.m0l.castShadow = on; e.m1b.castShadow = e.m1l.castShadow = false; } };
  field.layout = ({ x, z, lod0, lod1, far, impostors = true, minDist = 6 }) => {
    const impCounts = new Map();
    for (const e of entries) {
      let n0 = 0, n1 = 0;
      for (const it of e.list) {
        const d = Math.hypot(it.x - x, it.z - z); if (d > far || d < minDist) continue;
        if (d < lod0 || d < lod1 || !impostors) {
          const hi = d < lod0, bm = hi ? e.m0b : e.m1b, lm = hi ? e.m0l : e.m1l, i = hi ? n0++ : n1++;
          o.position.set(it.x, it.y, it.z); o.rotation.set(0, it.yaw, 0); o.scale.setScalar(it.s); o.updateMatrix(); bm.setMatrixAt(i, o.matrix); lm.setMatrixAt(i, o.matrix);
          c.setRGB(it.tint[0], it.tint[1], it.tint[2]); bm.setColorAt(i, c.setRGB(1, 1, 1)); lm.setColorAt(i, c.setRGB(it.tint[0], it.tint[1], it.tint[2]));
        } else {
          const a = e.impAttr, k = impCounts.get(e.impMesh) || 0; impCounts.set(e.impMesh, k + 1);
          a.pos.setXYZ(k, it.x, it.y, it.z); a.scl.setXY(k, it.s, it.s); a.vr.setX(k, it.variant); a.tint.setXYZ(k, it.tint[0], it.tint[1], it.tint[2]);
        }
      }
      for (const [m, n] of [[e.m0b, n0], [e.m0l, n0], [e.m1b, n1], [e.m1l, n1]]) { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    }
    for (const e of entries) if (e.impMesh) { const k = impCounts.get(e.impMesh) || 0; e.impMesh.geometry.instanceCount = k; for (const a of Object.values(e.impAttr)) a.needsUpdate = true; }
  };
  return field;
}
