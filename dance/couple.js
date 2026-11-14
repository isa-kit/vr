// ============================ dance/couple.js — partner-dance pattern engine (pure maths, no three.js) ============================
// Pattern JSON (see PATTERNS.md) → continuous lead + follow bodies: feet with weight transfer (no sliding), pelvis travel, facing,
// and hands that really meet (holds). Everything is computed in the SLOT frame (x along the slot / line of dance, y to the left of +x,
// facing in degrees, 0° = +x, counter-clockwise) and mapped to the world by a transform at the end:
//    world x = x, world z = −y (so left/right stay the right way round), body yaw ψ = 90° + facing (figure forward = (sin ψ, cos ψ)).
// ===================================================================================================================

const D2R = Math.PI / 180;
const sm = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
export const FOOT_I = { R: 0, L: 1 };
const FREE = { relaxed: [0.22, 0.22, -0.42], hip: [0.32, 0.04, -0.46], up: [0.2, 0.15, 0.42], out: [0.55, 0.1, -0.05], frame: [0.5, 0.25, -0.02], style: [0.45, 0.3, 0.1] };
const HEIGHT = { low: 1.0, mid: 1.25, frame: 1.35, high: 1.75, over: 1.95 };

// merge patterns (each optionally rotated 180° about the slot centre) into one combined pattern object
export function mergeChain(items) {          // items: [{ json, rot180?:bool }]
  const out = { id: 'chain', name: 'chain', style: items[0].json.style, beats: 0, counts: [], steps: { lead: [], follow: [] }, holds: [], notes: [], free: items[0].json.free || {}, segments: [], tempo: items[0].json.tempo, meter: items[0].json.meter, floor: items[0].json.floor };
  let off = 0;
  for (const it of items) {
    const p = it.json, f = it.rot180 ? -1 : 1, rot = it.rot180 ? 180 : 0;
    const tp = (o) => ({ ...o, x: o.x * f, y: o.y * f, facing: o.facing === undefined ? undefined : o.facing + rot });
    if (!out.start) out.start = { lead: tp(p.start.lead), follow: tp(p.start.follow) };
    for (const c of p.counts) out.counts.push({ beat: c.beat + off, label: c.label });
    for (const role of ['lead', 'follow']) for (const s of p.steps[role]) out.steps[role].push({ ...tp(s), beat: s.beat + off });
    for (const h of p.holds || []) out.holds.push({ ...h, from: h.from + off, to: h.to + off, offset: h.offset ? [h.offset[0], h.offset[1]] : undefined, path: (h.path || []).map(([b, dx, dy, dh]) => [b + off, dx * f, dy * f, dh]) });
    out.segments.push({ id: p.id, name: p.name, from: off, to: off + p.beats });
    off += p.beats;
  }
  out.beats = off;
  return out;
}
// best 180° choice so the next pattern starts where the previous one ended
export function chainPatterns(list) {
  const items = []; let prevEnd = null;
  for (const json of list) {
    let rot = false;
    if (prevEnd) {
      const err = (r) => { let e = 0; for (const role of ['lead', 'follow']) { const s = json.start[role], f = r ? -1 : 1; e += Math.hypot(s.x * f - prevEnd[role].x, s.y * f - prevEnd[role].y); } return e; };
      rot = err(true) < err(false);
    }
    items.push({ json, rot180: rot });
    const f = rot ? -1 : 1, e = {};
    for (const role of ['lead', 'follow']) { const st = json.steps[role].filter((s) => s.weight !== false), l = st[st.length - 1]; e[role] = { x: l.x * f, y: l.y * f }; }
    prevEnd = e;
  }
  return mergeChain(items);
}

export function compilePattern(P) {
  const C = { P, beats: P.beats, counts: P.counts, holds: (P.holds || []).map((h) => ({ ...h })), roles: {}, segments: P.segments || null };
  for (const role of ['lead', 'follow']) {
    const st0 = P.start[role], th0 = (st0.facing || 0) * D2R, lx = -Math.sin(th0), ly = Math.cos(th0);
    const steps = P.steps[role].slice().sort((a, b) => a.beat - b.beat);
    const feet = [[{ t: -1e9, x: st0.x - lx * 0.1, y: st0.y - ly * 0.1, th: th0, move: 0 }], [{ t: -1e9, x: st0.x + lx * 0.1, y: st0.y + ly * 0.1, th: th0, move: 0 }]];   // [R, L]
    const faces = [{ t: -1e9, th: th0 }], weights = [{ t: -1e9, s: -1e9, foot: st0.weight === 'L' ? 1 : 0, x: st0.x, y: st0.y }];
    let face = th0, prevT = -1;
    steps.forEach((s, i) => {
      const fi = FOOT_I[s.foot], move = i === 0 ? 0.8 : Math.min(0.85, Math.max(0.2, s.beat - steps[i - 1].beat));
      if (s.facing !== undefined) { face = s.facing * D2R; faces.push({ t: s.beat, th: face }); }
      feet[fi].push({ t: s.beat, x: s.x, y: s.y, th: face + (s.footTurn || 0) * D2R, move, pivot: !!s.pivot, rise: s.rise || 0 });
      if (s.weight !== false) weights.push({ t: s.beat, s: s.beat - move, foot: fi, x: s.x, y: s.y, move, rise: s.rise || 0 });
      prevT = s.beat;
    });
    C.roles[role] = { feet, faces, weights, steps, start: st0 };
  }
  // events (for scoring) are built on demand by buildEvents()
  return C;
}

function footAt(track, b, bodyTh, out) {
  let k = track.length - 1;
  while (k > 0 && track[k].t > b) k--;
  const a = track[k], n = track[k + 1];
  if (n && b > n.t - n.move) {
    const u = sm((b - (n.t - n.move)) / n.move), d = Math.hypot(n.x - a.x, n.y - a.y);
    out.x = lerp(a.x, n.x, u); out.y = lerp(a.y, n.y, u); out.th = lerp(a.th, n.th, u);
    out.lift = Math.sin(Math.PI * Math.min(1, ((b - (n.t - n.move)) / n.move))) * Math.min(0.11, 0.035 + d * 0.12);
  } else { out.x = a.x; out.y = a.y; out.th = a.pivot ? bodyTh : a.th; out.lift = 0; }
  return out;
}
function faceAt(faces, b) {
  let k = faces.length - 1;
  while (k > 0 && faces[k].t > b) k--;
  const a = faces[k], n = faces[k + 1];
  if (!n) return a.th;
  const t0 = k === 0 ? Math.max(a.t, n.t - 1.5) : a.t;        // the first turn starts just before it lands
  return lerp(a.th, n.th, sm((b - t0) / (n.t - t0)));
}

// body of one role at beat b, in the slot frame
function bodyAt(C, role, b) {
  const R = C.roles[role], th = faceAt(R.faces, b);
  const fR = footAt(R.feet[0], b, th, {}), fL = footAt(R.feet[1], b, th, {});
  const W = R.weights; let k = W.length - 1;
  while (k > 0 && W[k].s > b) k--;
  const cur = W[k], prev = W[Math.max(0, k - 1)];
  const stancePos = (w, i) => ({ x: i === 0 ? w.x : w.x, y: w.y });
  let wx = cur.x, wy = cur.y, rise = cur.rise || 0;
  if (k > 0 && b < cur.t) { const u = sm((b - cur.s) / cur.move); wx = lerp(prev.x, cur.x, u); wy = lerp(prev.y, cur.y, u); rise = lerp(prev.rise || 0, cur.rise || 0, u); }
  else if (k === 0 && b < cur.t) { /* before any step: over the start weight foot */ }
  const mx = (fR.x + fL.x) / 2, my = (fR.y + fL.y) / 2;
  const x = 0.78 * wx + 0.22 * mx, y = 0.78 * wy + 0.22 * my;
  return { x, y, th, feet: [fR, fL], rise };
}

const _tmp = {};
export function sampleCouple(C, b, out = {}) {
  const bodies = { lead: bodyAt(C, 'lead', b), follow: bodyAt(C, 'follow', b) };
  const pts = {};                                   // shoulders etc in slot frame: [x, y, h]
  for (const role of ['lead', 'follow']) {
    const B = bodies[role], lx = -Math.sin(B.th), ly = Math.cos(B.th), fx = Math.cos(B.th), fy = Math.sin(B.th), ph = 0.93 - 0.03 + B.rise * 0.6;
    B.py = ph; B.l = [lx, ly]; B.f = [fx, fy];
    B.sh = [[B.x - lx * 0.19, B.y - ly * 0.19, ph + 0.46], [B.x + lx * 0.19, B.y + ly * 0.19, ph + 0.46]];     // [R, L]
    B.hand = [0, 1].map((i) => {
      const g = (C.P.free && C.P.free[role]) || 'relaxed', fr = FREE[g] || FREE.relaxed, sg = i === 0 ? -1 : 1, s = B.sh[i];
      return [s[0] + lx * sg * fr[0] + fx * fr[1], s[1] + ly * sg * fr[0] + fy * fr[1], s[2] + fr[2]];
    });
  }
  const holds = [];
  for (const H of C.holds) {
    const w = sm((b - (H.from - 0.45)) / 0.4) * (1 - sm((b - H.to) / 0.4));
    if (w <= 0.001) continue;
    const L = bodies.lead, F = bodies.follow;
    let pa, pb, P;
    if (H.kind === 'on') {                           // one hand resting on the partner's body
      const me = bodies[H.role], other = bodies[H.role === 'lead' ? 'follow' : 'lead'];
      let tgt;
      if (H.on === 'back') tgt = [other.x - other.f[0] * 0.07, other.y - other.f[1] * 0.07, other.py + 0.42];
      else if (H.on === 'shoulderL' || H.on === 'shoulderR' || H.on === 'armL' || H.on === 'armR') { const s = other.sh[H.on.endsWith('L') ? 1 : 0]; tgt = [s[0] + (H.on.startsWith('arm') ? -other.f[0] * 0.0 : 0), s[1], s[2] - (H.on.startsWith('arm') ? 0.08 : 0.02)]; }
      else tgt = [other.x, other.y, other.py + 0.42];
      const hi = FOOT_I[H.hand];
      me.hand[hi] = [lerp(me.hand[hi][0], tgt[0], w), lerp(me.hand[hi][1], tgt[1], w), lerp(me.hand[hi][2], tgt[2], w)];
      holds.push({ kind: 'on', role: H.role, hand: hi, w, p: tgt });
      continue;
    }
    const li = FOOT_I[H.lead], fi = FOOT_I[H.follow], sa = L.sh[li], sb = F.sh[fi];
    let px = (sa[0] + sb[0]) / 2, py = (sa[1] + sb[1]) / 2, ph = HEIGHT[H.height] || H.height || HEIGHT.mid;
    if (H.offset) { px += L.l[0] * H.offset[0] + L.f[0] * H.offset[1]; py += L.l[1] * H.offset[0] + L.f[1] * H.offset[1]; }
    const path = H.path;
    if (path && path.length) {
      let k = 0; while (k < path.length - 1 && path[k + 1][0] <= b) k++;
      const a = path[k], n = path[Math.min(path.length - 1, k + 1)];
      const u = n === a ? 0 : sm((b - a[0]) / (n[0] - a[0]));
      const clampU = b < path[0][0] ? 0 : u;
      px += lerp(a[1], n[1], clampU); py += lerp(a[2], n[2], clampU); ph += lerp(a[3], n[3], clampU);
    }
    P = [px, py, ph];
    for (const [me, hi] of [[L, li], [F, fi]]) me.hand[hi] = [lerp(me.hand[hi][0], P[0], w), lerp(me.hand[hi][1], P[1], w), lerp(me.hand[hi][2], P[2], w)];
    holds.push({ kind: 'join', li, fi, w, p: P, cue: H.cue || 'none' });
  }
  out.lead = bodies.lead; out.follow = bodies.follow; out.holds = holds; out.beat = b;
  return out;
}

// slot → world transform: { rot (radians about y), ox, oz }
export function toWorld(xf, x, y, h, out = [0, 0, 0]) {
  const wx = x, wz = -y, c = Math.cos(xf.rot), s = Math.sin(xf.rot);
  out[0] = wx * c + wz * s + xf.ox; out[1] = h; out[2] = -wx * s + wz * c + xf.oz; return out;
}
export const yawToWorld = (xf, th) => Math.PI / 2 + th + xf.rot;
// transform that puts `role`'s start spot at the world origin with its start facing along world −z (where a standing player looks)
export function playerTransform(P, role) {
  const s = P.start[role], th = (s.facing || 0) * D2R, yaw = Math.PI / 2 + th;      // body yaw without rot; want final yaw = π (forward −z)
  const rot = Math.PI - yaw, c = Math.cos(rot), sn = Math.sin(rot), wx = s.x, wz = -s.y;
  return { rot, ox: -(wx * c + wz * sn), oz: -(-wx * sn + wz * c) };
}
// neutral viewing transform: slot centred on the stage, slot running left-right as seen from the front
export function stageTransform(P, cz = -1.6) { return { rot: 0, ox: 0, oz: cz }; }

// convert a sampled slot-frame state to figure.updateWorld() parameters
export function figureParams(B, xf, params = {}) {
  const w = toWorld(xf, B.x, B.y, 0);
  params.px = w[0]; params.pz = w[2]; params.py = B.py - 0.0; params.yaw = yawToWorld(xf, B.th);
  params.pitch = 0.04; params.roll = 0;
  params.feet = B.feet.map((f) => { const q = toWorld(xf, f.x, f.y, 0); return { x: q[0], z: q[2], lift: f.lift, yaw: yawToWorld(xf, f.th) }; });
  params.hands = B.hand.map((h) => toWorld(xf, h[0], h[1], h[2]));
  return params;
}

// ---------- scoring events for one role (only head + two hands are tracked) ----------
// sample = { head:[x,y,z], yaw (world, figure convention), hands:[R,L] world positions (controller handedness) }
export function buildEvents(C, role, xf) {
  const ev = [], R = C.roles[role], me = role;
  const at = (b) => sampleCouple(C, b, {});
  const wp = (p) => toWorld(xf, p[0], p[1], p[2]);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (const H of C.holds) {
    const myHand = H.kind === 'on' ? (H.role === me ? FOOT_I[H.hand] : -1) : FOOT_I[me === 'lead' ? H.lead : H.follow];
    if (myHand < 0) continue;
    const pts = [H.from]; for (let b = Math.ceil(H.from + 0.01); b <= H.to - 0.01; b += 1) pts.push(b);
    pts.forEach((b, i) => {
      ev.push({ b, move: i === 0 ? 'Connect' : 'Hold', kind: 'hand', errFn: (s) => { const S = at(b), B = S[me]; const hd = wp(B.hand[myHand]); return dist(s.hands[myHand], hd) / 0.33; } });
    });
  }
  let prev = { x: R.start.x, y: R.start.y }, prevTh = (R.start.facing || 0);
  for (const s of R.steps) {
    if (s.weight === false) continue;
    const moved = Math.hypot(s.x - prev.x, s.y - prev.y);
    if (moved > 0.14) { const b = s.beat; ev.push({ b, move: 'Travel', kind: 'body', errFn: (m) => { const B = at(b)[me], q = toWorld(xf, B.x, B.y, 0); return Math.hypot(m.head[0] - q[0], m.head[2] - q[2]) / 0.67; } }); }
    if (s.facing !== undefined && Math.abs(s.facing - prevTh) >= 40) { const b = s.beat, th = s.facing * D2R; ev.push({ b, move: 'Turn', kind: 'turn', errFn: (m) => { let d = (m.yaw - yawToWorld(xf, th)) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d) / D2R / 100; } }); }
    if (s.facing !== undefined) prevTh = s.facing;
    prev = { x: s.x, y: s.y };
  }
  ev.sort((a, b) => a.b - b.b);
  return ev;
}
// which count label is "now"
export function countAt(C, b) { let k = -1; for (let i = 0; i < C.counts.length; i++) { if (C.counts[i].beat <= b + 1e-6) k = i; else break; } return k; }
