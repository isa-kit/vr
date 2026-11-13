// ============================ dance/routines.js — poses, moves, routines (all data) ============================
//
// A routine is plain JSON:  { id, title, level, bpm, beats, countIn, poses:{name:{L,R,drop,lx,lz,tw}}, timeline:[{beat,pose,move,score,w}], feet:[[beat,name]] }
//
// Hand targets are [out, up, fwd] in units of ARM LENGTH measured from that hand's own shoulder, in the PLAYER's frame:
//   out = sideways away from the body midline (negative = across the body), up = world up, fwd = toward the dancer (away from the chest).
// drop = how far the head sinks, as a fraction of body height (a squat ≈ 0.18).  lx / lz = head lean sideways (+ = player's right) / forward, fraction of height.
// "L" and "R" are the PLAYER's left and right hand. The dancer figure maps them to its own arms (mirror mode swaps sides).
//
// MOVES are short sequences of [beatOffset, poseName, scored, w?]; routines are lists of move names that the builder lays end to end.
// `w` = fraction of the gap before the key spent moving (small = hold, then snap onto the beat).
// =======================================================================================================================

const P = (L, R, x = {}) => ({ L, R, drop: 0, lx: 0, lz: 0, tw: 0, ...x });
const S = (p, x) => P(p, p, x);
const REST = [0.2, -0.95, 0];

export const POSES = {
  rest: S(REST),
  grooveA: P([0.25, -0.8, 0.2], [0.25, -0.8, 0.02]),
  grooveB: P([0.25, -0.8, 0.02], [0.25, -0.8, 0.2]),
  up: S([0.12, 1.0, 0.0]),
  vUp: S([0.45, 0.95, 0.05]),
  out: S([1.0, 0.0, 0.0]),
  reachFwd: S([0.1, 0.0, 1.0]),
  clapOpen: S([0.75, -0.1, 0.45]),
  clap: S([-0.3, -0.15, 0.65]),
  waveROut: P(REST, [0.78, 0.55, 0.2]),
  waveRIn: P(REST, [0.42, 0.55, 0.2]),
  waveLOut: P([0.78, 0.55, 0.2], REST),
  waveLIn: P([0.42, 0.55, 0.2], REST),
  guard: S([0.05, 0.0, 0.4]),
  punchR: P([0.05, 0.0, 0.4], [0.0, -0.05, 1.0]),
  punchL: P([0.0, -0.05, 1.0], [0.05, 0.0, 0.4]),
  pointUR: P([0.55, -0.6, 0.1], [0.7, 0.75, 0.2]),
  pointUL: P([0.7, 0.75, 0.2], [0.55, -0.6, 0.1]),
  discoA: P([0.55, 0.8, 0.15], [0.65, -0.75, 0.1], { tw: 0.12 }),
  discoB: P([0.65, -0.75, 0.1], [0.55, 0.8, 0.15], { tw: -0.12 }),
  roll0: S([0.6, -0.15, 0.7]),
  roll1: S([0.2, 0.25, 0.7]),
  roll2: S([-0.2, -0.15, 0.7]),
  roll3: S([0.2, -0.55, 0.7]),
  swayL: S([0.85, -0.25, 0.0], { lx: -0.1 }),
  swayR: S([0.85, -0.25, 0.0], { lx: 0.1 }),
  squat: S([0.3, -0.35, 0.7], { drop: 0.18 }),
  leanL: P([0.5, -0.75, 0.0], [-0.15, 0.95, 0.1], { lx: -0.1 }),
  leanR: P([-0.15, 0.95, 0.1], [0.5, -0.75, 0.0], { lx: 0.1 }),
  wmA: P([0.3, 0.9, 0.1], [0.3, -0.9, 0.1]),
  wmB: P([0.3, -0.9, 0.1], [0.3, 0.9, 0.1]),
  wmFwd: S([0.25, 0.05, 0.9]),
  pumpOut: S([0.25, -0.3, 0.8]),
  pumpIn: S([0.4, -0.55, 0.1]),
  xPose: S([0.95, 0.5, 0.0]),
  crossArms: S([-0.45, -0.25, 0.55]),
  headHands: S([-0.05, 0.5, 0.15]),
  sweep: S([0.9, -0.6, 0.25], { lx: 0 }),
};

export const FOOT = {                          // [leftOut, leftFwd, leftLift, rightOut, rightFwd, rightLift]  (player's left / right foot)
  plant: [0.13, 0, 0, 0.13, 0, 0],
  wide: [0.3, 0, 0, 0.3, 0, 0],
  tapL: [0.2, 0.22, 0.03, 0.13, 0, 0], tapR: [0.13, 0, 0, 0.2, 0.22, 0.03],
  stepL: [0.34, 0, 0, 0.1, 0, 0], stepR: [0.1, 0, 0, 0.34, 0, 0],
  kickL: [0.16, 0.3, 0.2, 0.13, 0, 0], kickR: [0.13, 0, 0, 0.16, 0.3, 0.2],
};

// move: label, dur (beats), keys [[offset, pose, scored, w?]], foot? (forced footwork on its first beat)
const M = (label, dur, keys, foot) => ({ label, dur, keys, foot });
export const MOVES = {
  groove: M('Groove', 4, [[0, 'grooveA', 0], [1, 'grooveB', 0], [2, 'grooveA', 0], [3, 'grooveB', 0]]),
  reachUp: M('Reach up', 2, [[0, 'up', 1]]),
  cheer: M('Cheer', 2, [[0, 'vUp', 1]], 'wide'),
  reachOut: M('Arms out', 2, [[0, 'out', 1]]),
  reachFwd: M('Reach forward', 2, [[0, 'reachFwd', 1]]),
  clap: M('Clap', 2, [[0, 'clapOpen', 0], [1, 'clap', 1, 0.5]]),
  waveR: M('Wave right', 4, [[0, 'waveROut', 1], [1, 'waveRIn', 0], [2, 'waveROut', 1], [3, 'waveRIn', 0]]),
  waveL: M('Wave left', 4, [[0, 'waveLOut', 1], [1, 'waveLIn', 0], [2, 'waveLOut', 1], [3, 'waveLIn', 0]]),
  punchR: M('Punch right', 2, [[0, 'guard', 0], [1, 'punchR', 1, 0.4]]),
  punchL: M('Punch left', 2, [[0, 'guard', 0], [1, 'punchL', 1, 0.4]]),
  punchRL: M('Double punch', 2, [[0, 'punchR', 1, 0.45], [1, 'punchL', 1, 0.45]]),
  pointR: M('Point right', 2, [[0, 'pointUR', 1]]),
  pointL: M('Point left', 2, [[0, 'pointUL', 1]]),
  disco: M('Disco', 4, [[0, 'discoA', 1], [2, 'discoB', 1]]),
  discoFast: M('Disco', 2, [[0, 'discoA', 1], [1, 'discoB', 1]]),
  roll: M('Roll', 4, [[0, 'roll0', 1], [1, 'roll1', 0], [2, 'roll2', 1], [3, 'roll3', 0]]),
  rollFast: M('Roll', 4, [[0, 'roll0', 1], [1, 'roll1', 1], [2, 'roll2', 1], [3, 'roll3', 1]]),
  swayL: M('Sway left', 2, [[0, 'swayL', 1]]),
  swayR: M('Sway right', 2, [[0, 'swayR', 1]]),
  squat: M('Squat', 2, [[0, 'squat', 1]], 'wide'),
  leanL: M('Lean left', 2, [[0, 'leanL', 1]]),
  leanR: M('Lean right', 2, [[0, 'leanR', 1]]),
  spin: M('Spin arms', 4, [[0, 'wmA', 1], [1, 'wmFwd', 0], [2, 'wmB', 1], [3, 'wmFwd', 0]]),
  spinFast: M('Spin arms', 4, [[0, 'wmA', 1], [1, 'wmFwd', 1], [2, 'wmB', 1], [3, 'wmFwd', 1]]),
  pump: M('Pump', 2, [[0, 'pumpOut', 1, 0.5], [1, 'pumpIn', 0]]),
  star: M('Star', 2, [[0, 'xPose', 1]], 'wide'),
  crossArms: M('Cross arms', 2, [[0, 'crossArms', 1]]),
  headHands: M('Hands on head', 2, [[0, 'headHands', 1]]),
  sweep: M('Low sweep', 2, [[0, 'sweep', 1]]),
  // one-beat hits for the hard routine
  qUp: M('Reach up', 1, [[0, 'up', 1, 0.85]]),
  qV: M('Cheer', 1, [[0, 'vUp', 1, 0.85]]),
  qOut: M('Arms out', 1, [[0, 'out', 1, 0.85]]),
  qFwd: M('Reach forward', 1, [[0, 'reachFwd', 1, 0.7]]),
  qClap: M('Clap', 1, [[0, 'clap', 1, 0.6]]),
  qPunchR: M('Punch right', 1, [[0, 'punchR', 1, 0.5]]),
  qPunchL: M('Punch left', 1, [[0, 'punchL', 1, 0.5]]),
  qPointR: M('Point right', 1, [[0, 'pointUR', 1, 0.85]]),
  qPointL: M('Point left', 1, [[0, 'pointUL', 1, 0.85]]),
  qSweep: M('Low sweep', 1, [[0, 'sweep', 1, 0.85]]),
  qCross: M('Cross arms', 1, [[0, 'crossArms', 1, 0.85]]),
};

// ---------- routine definitions: lists of move names laid end to end ----------
const rep = (n, arr) => Array.from({ length: n }, () => arr).flat();
const DEFS = {
  easy: {
    title: 'Easy Groove', level: 'Easy', bpm: 100, beats: 112, track: 'easy', footStyle: 'easy',
    seq: [
      'groove',
      'reachUp', 'clap', 'waveR', 'waveL', 'punchR', 'punchL', 'pointR', 'pointL', 'roll', 'swayL', 'swayR',
      'reachUp', 'clap', 'squat', 'cheer', 'punchR', 'punchL', 'waveR', 'roll', 'disco', 'swayL', 'swayR', 'pointR', 'pointL',
      'clap', 'cheer', 'spin', 'squat', 'reachUp', 'punchR', 'punchL', 'roll', 'leanL', 'leanR', 'waveL', 'crossArms', 'headHands',
      'disco', 'waveR', 'clap', 'reachUp', 'cheer', 'cheer',
    ],
  },
  medium: {
    title: 'Medium Mix', level: 'Medium', bpm: 112, beats: 128, track: 'medium', footStyle: 'medium',
    seq: [
      'groove',
      'reachUp', 'clap', 'punchRL', 'pointR', 'pointL', 'waveR', 'waveL', 'squat', 'cheer', 'swayL', 'swayR', 'roll', 'sweep', 'reachOut',
      'clap', 'pump', 'punchRL', 'discoFast', 'disco', 'leanL', 'leanR', 'spin', 'squat', 'reachUp',
      'crossArms', 'headHands', 'punchRL', 'pointR', 'pointL', 'rollFast', 'swayL', 'swayR', 'squat', 'star', 'waveR', 'waveL',
      'rollFast', 'disco', 'pointR', 'pointL', 'sweep',
      'clap', 'punchRL', 'discoFast', 'leanL', 'leanR', 'spin', 'pump', 'reachFwd', 'cheer', 'star',
    ],
  },
  hard: {
    title: 'Hard Beat', level: 'Hard', bpm: 126, beats: 144, track: 'hard', footStyle: 'hard',
    seq: [
      'groove',
      'qUp', 'qClap', 'qPunchR', 'qPunchL', 'qPointR', 'qPointL', 'qV', 'qClap', 'rollFast', 'discoFast', 'punchRL', 'squat', 'cheer', 'leanL', 'leanR',
      'qUp', 'qOut', 'qFwd', 'qClap', 'spinFast', 'swayL', 'swayR', 'squat', 'squat', 'punchRL', 'qPointR', 'qPointL', 'qSweep', 'qCross', 'discoFast', 'pump',
      'rollFast', 'leanL', 'leanR', 'qPunchR', 'qPunchL', 'qPunchR', 'qPunchL', 'qUp', 'qV', 'qOut', 'qClap', 'squat', 'star', 'discoFast', 'spinFast',
      'qPointR', 'qPointL', 'qCross', 'qClap', 'rollFast', 'punchRL', 'discoFast', 'leanL', 'leanR', 'swayL', 'swayR', 'squat', 'cheer',
      'rollFast', 'spinFast', 'discoFast', 'discoFast', 'punchRL', 'punchRL', 'leanL', 'leanR', 'squat', 'qPointR', 'qPointL', 'qSweep', 'qCross', 'qPunchR', 'qPunchL', 'qPunchR', 'qPunchL', 'qUp', 'qOut', 'qClap',
      'qUp', 'qClap', 'qV', 'star', 'cheer',
    ],
  },
};

function footTrack(style, beats, forced) {
  const out = [[0, 'plant']];
  const pat = { easy: [[2, ['stepL', 'plant', 'stepR', 'plant']]], medium: [[2, ['stepL', 'tapR', 'stepR', 'tapL']]], hard: [[1, ['stepL', 'tapR', 'stepR', 'tapL']]] }[style][0];
  const [every, names] = pat;
  for (let b = 0, i = 0; b < beats; b += every, i++) {
    if (forced.has(b)) { out.push([b, forced.get(b)]); out.push([b + every, 'plant']); continue; }
    if (forced.has(b - every) || out.length && out[out.length - 1][0] === b) continue;
    let n = names[i % 4];
    if (style !== 'easy' && b % 16 === 15) n = 'kickL';
    if (style === 'hard' && b % 16 === 7) n = 'kickR';
    out.push([b, n]);
  }
  return out.sort((a, b) => a[0] - b[0]).filter((e, i, a) => i === 0 || e[0] > a[i - 1][0]);
}

export function buildRoutine(id) {
  const d = DEFS[id];
  const timeline = [], used = new Set(['rest']), forced = new Map(), moves = [];
  let b = 0;
  for (const name of d.seq) {
    const m = MOVES[name];
    if (!m) throw new Error('unknown move ' + name);
    moves.push({ beat: b, move: name, label: m.label, dur: m.dur });
    for (const [off, pose, score, w] of m.keys) {
      timeline.push({ beat: b + off, pose, move: m.label, score: score ? 1 : 0, ...(w ? { w } : {}) });
      used.add(pose);
    }
    if (m.foot) forced.set(b, m.foot);
    b += m.dur;
  }
  if (b !== d.beats) throw new Error(id + ': sequence is ' + b + ' beats, expected ' + d.beats);
  const poses = {}; for (const n of used) poses[n] = JSON.parse(JSON.stringify(POSES[n]));
  const feet = footTrack(d.footStyle, d.beats, forced);
  return { id, title: d.title, level: d.level, bpm: d.bpm, beats: d.beats, countIn: 4, track: d.track, poses, timeline, feet, moves };
}

export const ROUTINES = { easy: buildRoutine('easy'), medium: buildRoutine('medium'), hard: buildRoutine('hard') };

// ---------- runtime: compile + sample ----------
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

export function compileRoutine(json) {
  const keys = json.timeline.map((k) => {
    const p = json.poses[k.pose];
    return { b: k.beat, L: p.L, R: p.R, drop: p.drop, lx: p.lx, lz: p.lz, tw: p.tw, w: k.w || 0.8, score: !!k.score, move: k.move, pose: k.pose,
      bodyW: (p.drop > 0.08 || Math.abs(p.lx) > 0.05) ? 0.7 : 0 };
  });
  const feet = json.feet.map(([b, n]) => ({ b, f: FOOT[n], name: n }));
  return { json, keys, feet, scored: keys.filter((k) => k.score), beats: json.beats, bpm: json.bpm, countIn: json.countIn };
}

const _o = { L: [0, 0, 0], R: [0, 0, 0], drop: 0, lx: 0, lz: 0, tw: 0, feet: [0, 0, 0, 0, 0, 0], key: null, next: null };
function findSeg(arr, beat) {            // last index with arr[i].b <= beat
  let lo = 0, hi = arr.length - 1;
  if (beat < arr[0].b) return -1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m].b <= beat) lo = m; else hi = m - 1; }
  return lo;
}
export function samplePose(c, beat, out = _o) {
  const keys = c.keys, i = findSeg(keys, beat);
  const a = keys[Math.max(0, i)], bk = keys[Math.min(keys.length - 1, i + 1)];
  let e = 1;
  if (i >= 0 && bk !== a) {
    const u = clamp01((beat - a.b) / (bk.b - a.b));
    e = smooth(clamp01((u - (1 - bk.w)) / bk.w));
  } else if (i < 0) { e = 0; }
  const src = i < 0 ? a : a, dst = i < 0 ? a : bk;
  for (let j = 0; j < 3; j++) { out.L[j] = src.L[j] + (dst.L[j] - src.L[j]) * e; out.R[j] = src.R[j] + (dst.R[j] - src.R[j]) * e; }
  out.drop = src.drop + (dst.drop - src.drop) * e; out.lx = src.lx + (dst.lx - src.lx) * e;
  out.lz = src.lz + (dst.lz - src.lz) * e; out.tw = src.tw + (dst.tw - src.tw) * e;
  out.key = a; out.next = bk;
  // feet
  const fe = c.feet, fi = findSeg(fe, beat), fa = fe[Math.max(0, fi)], fb = fe[Math.min(fe.length - 1, fi + 1)];
  let u = 0;
  if (fi >= 0 && fb !== fa) u = smooth(clamp01((beat - fa.b) / (fb.b - fa.b) * 2 - 1));      // move in the second half of the gap
  for (let j = 0; j < 6; j++) out.feet[j] = fa.f[j] + (fb.f[j] - fa.f[j]) * u;
  const arc = Math.sin(Math.PI * u);                                                          // lift the foot that is travelling
  if (Math.abs(fb.f[0] - fa.f[0]) + Math.abs(fb.f[1] - fa.f[1]) > 0.03) out.feet[2] += 0.09 * arc;
  if (Math.abs(fb.f[3] - fa.f[3]) + Math.abs(fb.f[4] - fa.f[4]) > 0.03) out.feet[5] += 0.09 * arc;
  return out;
}

// the next scored key strictly after `beat - grace` (for guidance); index into c.scored
export function nextScoredIndex(c, beat, grace = 0.3) {
  const s = c.scored; let lo = 0, hi = s.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (s[m].b < beat - grace) lo = m + 1; else hi = m; }
  return lo;
}
