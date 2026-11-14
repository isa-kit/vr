// ============================ dance/game.js — calibration, body→pose sampling, scoring (pure maths, no three.js) ============================
// Units: hands are [out, up, fwd] in ARM LENGTHS from the hand's own shoulder (see routines.js); head drop / lean are fractions of height.
// All XR maths happens in TRACKING space (the rig's local space), so recentering the rig never invalidates a calibration.

export const SHOULDER_DROP = 0.118, SHOULDER_HALF = 0.115, EYE_FRAC = 0.936;      // fractions of height

export function defaultCalib(H = 1.75) {
  return { H, eyeH: H * EYE_FRAC, half: SHOULDER_HALF * H, armLen: 0.385 * H, shoulderDrop: SHOULDER_DROP * H, r: [1, 0, 0], f: [0, 0, -1], stand: [0, 0], ok: true };
}

// head: [x,y,z]; hl/hr: left & right hand positions (arms held straight out to the sides). Returns calib or {ok:false, why}.
export function calibrate(head, hl, hr) {
  const span = Math.hypot(hr[0] - hl[0], hr[1] - hl[1], hr[2] - hl[2]);
  const eyeH = head[1], H = eyeH / EYE_FRAC;
  if (eyeH < 0.8 || eyeH > 2.2) return { ok: false, why: 'Stand up straight so the headset can measure your height.' };
  if (span < 0.8 || span > 2.5) return { ok: false, why: 'Hold both controllers out to your sides, arms straight.' };
  const shoulderY = eyeH - SHOULDER_DROP * H;
  if (Math.abs((hl[1] + hr[1]) / 2 - shoulderY) > 0.28 * H) return { ok: false, why: 'Raise your arms to shoulder height.' };
  let rx = hr[0] - hl[0], rz = hr[2] - hl[2]; const n = Math.hypot(rx, rz) || 1; rx /= n; rz /= n;
  const half = SHOULDER_HALF * H, armLen = Math.max(0.45, span / 2 - half);
  return { H, eyeH, half, armLen, shoulderDrop: SHOULDER_DROP * H, r: [rx, 0, rz], f: [rz, 0, -rx], stand: [head[0], head[2]], span, ok: true };
}

// body → normalised pose. Returns {L,R,drop,lx,lz} into `out`.
export function sampleXR(c, head, hl, hr, out = { L: [0, 0, 0], R: [0, 0, 0], drop: 0, lx: 0, lz: 0 }) {
  const sy = head[1] - c.shoulderDrop, [rx, , rz] = c.r, [fx, , fz] = c.f;
  for (const side of [-1, 1]) {
    const h = side < 0 ? hl : hr, o = side < 0 ? out.L : out.R;
    if (!h) { o[0] = 0.2; o[1] = -0.95; o[2] = 0; continue; }                 // missing controller → hand at rest
    const sx = head[0] + rx * side * c.half, sz = head[2] + rz * side * c.half;
    const dx = h[0] - sx, dz = h[2] - sz;
    o[0] = side * (dx * rx + dz * rz) / c.armLen;
    o[1] = (h[1] - sy) / c.armLen;
    o[2] = (dx * fx + dz * fz) / c.armLen;
  }
  const hx = head[0] - c.stand[0], hz = head[2] - c.stand[1];
  out.drop = (c.eyeH - head[1]) / c.H;
  out.lx = (hx * rx + hz * rz) / c.H;
  out.lz = (hx * fx + hz * fz) / c.H;
  return out;
}

// where a target should appear (tracking space) given calibration. t = {L,R,drop,lx,lz}. Returns {L:[x,y,z], R:[...], head:[...]}
export function targetPositions(c, t, out = { L: [0, 0, 0], R: [0, 0, 0], head: [0, 0, 0] }) {
  const [rx, , rz] = c.r, [fx, , fz] = c.f;
  const sy = c.eyeH - c.shoulderDrop - t.drop * c.H;
  const cx = c.stand[0] + (rx * t.lx + fx * t.lz) * c.H, cz = c.stand[1] + (rz * t.lx + fz * t.lz) * c.H;
  for (const side of [-1, 1]) {
    const p = side < 0 ? t.L : t.R, o = side < 0 ? out.L : out.R;
    const lat = side * (c.half + p[0] * c.armLen), fw = p[2] * c.armLen;
    o[0] = cx + rx * lat + fx * fw; o[1] = sy + p[1] * c.armLen; o[2] = cz + rz * lat + fz * fw;
  }
  out.head[0] = cx; out.head[1] = sy + c.shoulderDrop; out.head[2] = cz;
  return out;
}

// ---------- scoring ----------
export const GRADES = ['miss', 'ok', 'good', 'perfect'];
export const POINTS = { perfect: 300, good: 200, ok: 100, miss: 0 };
export const WEIGHT = { perfect: 1, good: 0.7, ok: 0.4, miss: 0 };
export const T_PERFECT = 0.3, T_GOOD = 0.48, T_OK = 0.7;                // error thresholds (arm lengths)
export const WIN_BEFORE = 0.3, WIN_AFTER = 0.4;                          // scoring window around a key, in beats

export function poseError(t, p, bodyW) {
  const dl = Math.hypot(t.L[0] - p.L[0], t.L[1] - p.L[1], t.L[2] - p.L[2]);
  const dr = Math.hypot(t.R[0] - p.R[0], t.R[1] - p.R[1], t.R[2] - p.R[2]);
  const hands = (dl + dr) / 2;
  if (!bodyW) return hands;
  const body = Math.hypot((t.drop - p.drop) / 0.13, (t.lx - p.lx) / 0.08, (t.lz - p.lz) / 0.1) * 0.4;
  return (hands + bodyW * body) / (1 + bodyW);
}
export function gradeFor(err, off) {
  let g = err < T_PERFECT ? 3 : err < T_GOOD ? 2 : err < T_OK ? 1 : 0;
  const a = Math.abs(off);
  if (g > 0) { if (a > 0.3) g = Math.min(g, 1); else if (a > 0.18) g = Math.min(g, 2); }
  return GRADES[g];
}

export function createScorer(compiled) {
  const keys = compiled.scored;
  const S = { score: 0, streak: 0, best: 0, mult: 1, counts: { perfect: 0, good: 0, ok: 0, miss: 0 }, results: [], byMove: new Map(), last: null, finalized: 0 };
  let cursor = 0;                         // first key whose window hasn't closed
  const best = new Map();                 // key index → {err, off, sample}
  const snap = (p) => (p.L ? { L: p.L.slice(), R: p.R.slice(), drop: p.drop, lx: p.lx, lz: p.lz } : null);
  S.reset = () => { S.score = S.streak = S.best = S.finalized = 0; S.mult = 1; S.counts = { perfect: 0, good: 0, ok: 0, miss: 0 }; S.results = []; S.byMove = new Map(); S.last = null; cursor = 0; best.clear(); };
  S.rewind = () => { cursor = 0; best.clear(); };          // practice loop: windows start over (results are kept)
  // beat = current routine beat; p = player sample. Returns array of finished events.
  S.update = function update(beat, p, live = true) {
    const ev = [];
    for (let i = cursor; i < keys.length; i++) {
      const k = keys[i];
      if (k.b - WIN_BEFORE > beat) break;
      if (beat > k.b + WIN_AFTER) {
        const b = best.get(i);
        if (i === cursor) { cursor++; }
        if (live && !b?.done) {
          const e = b || { err: 9, off: 1 };
          const grade = b ? gradeFor(b.err, b.off) : 'miss';
          finalize(i, k, grade, e); ev.push(S.last);
          if (b) b.done = true; else best.set(i, { done: true });
        }
        continue;
      }
      if (!live) continue;
      const err = k.errFn ? k.errFn(p) : poseError(k, p, k.bodyW), off = beat - k.b;
      const cost = err + 0.5 * Math.max(0, Math.abs(off) - 0.1);
      const cur = best.get(i);
      if (!cur || cost < cur.cost) best.set(i, { err, off, cost, sample: snap(p) });
    }
    return ev;
  };
  function finalize(i, k, grade, e) {
    S.counts[grade]++; S.finalized++;
    if (grade === 'miss') S.streak = 0; else { S.streak++; if (S.streak > S.best) S.best = S.streak; }
    S.mult = Math.min(4, 1 + Math.floor(S.streak / 8));
    const pts = POINTS[grade] * S.mult; S.score += pts;
    let m = S.byMove.get(k.move); if (!m) S.byMove.set(k.move, (m = { n: 0, w: 0 }));
    m.n++; m.w += WEIGHT[grade];
    S.last = { index: i, key: k, grade, err: e.err, off: e.off, pts, sample: e.sample };
    S.results.push(S.last);
  }
  S.accuracy = () => (S.finalized ? S.results.reduce((a, r) => a + WEIGHT[r.grade], 0) / S.finalized : 0);
  S.stars = () => { const a = S.accuracy(); return a >= 0.9 ? 5 : a >= 0.78 ? 4 : a >= 0.62 ? 3 : a >= 0.42 ? 2 : a >= 0.2 ? 1 : 0; };
  S.moveAccuracy = () => [...S.byMove.entries()].map(([name, m]) => ({ name, n: m.n, acc: m.w / m.n })).sort((a, b) => a.acc - b.acc);
  return S;
}
