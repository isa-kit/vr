// ============================ dance/music.js — generated music, tempo-locked to the beat clock ============================
// Web Audio only: drums, bass, chords, lead and arp from note data. No audio files.
//   const music = createMusic();  music.ensure();                        // inside a user gesture
//   music.start({ track:'easy', bpm:100, speed:1, countIn:4, loop:null|{start,len}, totalBeats:112 });
//   music.beat()  → routine beat now (negative during the count-in). music.tick(dt) each frame. pause()/resume()/stop().
// The beat clock IS the audio clock (ctx.currentTime), so what you see and hear can't drift apart. If audio is unavailable
// (autoplay blocked, no device) the clock falls back to frame time and the game still plays, silently.
// ===============================================================================================================

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const PENT_MAJ = [0, 2, 4, 7, 9], PENT_MIN = [0, 3, 5, 7, 10];
const scaleNote = (root, pent, idx) => root + pent[((idx % 5) + 5) % 5] + 12 * Math.floor(idx / 5);

// Each track: chords per bar (4-bar loop), layers by section, patterns (16 steps/bar).
const TRACKS = {
  easy: {
    root: 60, pent: PENT_MAJ, chords: [[57, 'min'], [53, 'maj'], [60, 'maj'], [55, 'maj']], swing: 0,
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0], bass: [0, null, null, null, null, null, 0, null, 7, null, null, null, 0, null, null, null],
    lead: [[0, 4, 3], [4, 6, 2], [8, 5, 3], [12, 3, 2], [16, 4, 3], [20, 7, 2], [24, 6, 3], [28, 4, 2], [32, 2, 3], [36, 4, 2], [40, 5, 3], [44, 6, 2], [48, 5, 4], [56, 4, 2], [60, 2, 2]],
    leadWave: 'triangle', arp: false,
    sections: [[0, 2, 'chords hat'], [2, 8, 'kick hat bass chords'], [8, 16, 'kick snare hat bass chords lead'], [16, 20, 'chords lead kick'], [20, 99, 'kick snare hat bass chords lead']],
  },
  medium: {
    root: 62, pent: PENT_MIN, chords: [[50, 'min'], [46, 'maj'], [53, 'maj'], [48, 'maj']], swing: 0.08,
    kick: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
    hat: [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0], bass: [0, null, 0, null, null, 0, null, 7, 0, null, 0, null, null, 12, null, 7],
    lead: [[0, 4, 2], [3, 5, 1], [4, 7, 3], [8, 6, 2], [11, 4, 1], [12, 5, 3], [16, 7, 2], [19, 6, 1], [20, 4, 3], [24, 2, 2], [27, 4, 1], [28, 5, 3], [32, 7, 3], [36, 9, 2], [40, 7, 2], [44, 6, 2], [48, 5, 3], [52, 4, 2], [56, 2, 4]],
    leadWave: 'sawtooth', arp: true,
    sections: [[0, 2, 'chords hat'], [2, 8, 'kick hat bass chords arp'], [8, 16, 'kick snare hat bass chords lead arp'], [16, 20, 'chords arp lead'], [20, 99, 'kick snare hat bass chords lead arp']],
  },
  hard: {
    root: 64, pent: PENT_MIN, chords: [[52, 'min'], [48, 'maj'], [55, 'maj'], [50, 'maj']], swing: 0,
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1], bass: [null, 0, null, 0, null, 0, null, 12, null, 0, null, 0, null, 0, 7, null],
    lead: [[0, 7, 2], [2, 9, 2], [4, 7, 2], [6, 6, 2], [8, 4, 4], [12, 6, 2], [14, 7, 2], [16, 9, 2], [18, 7, 2], [20, 6, 2], [22, 4, 2], [24, 7, 4], [28, 6, 2], [30, 4, 2], [32, 2, 4], [36, 4, 2], [38, 6, 2], [40, 7, 4], [44, 9, 4], [48, 7, 2], [50, 6, 2], [52, 4, 4], [56, 2, 4], [60, 4, 4]],
    leadWave: 'sawtooth', arp: true,
    sections: [[0, 2, 'chords hat kick'], [2, 8, 'kick hat bass chords arp'], [8, 16, 'kick snare hat clap bass chords lead arp'], [16, 20, 'chords arp lead kick'], [20, 99, 'kick snare hat clap bass chords lead arp']],
  },
};

export function createMusic() {
  let ctx = null, master = null, bus = null, delay = null, noiseBuf = null, volume = 0.7, sound = true;
  let useCtx = false, fb = 0, run = null, timer = null, paused = false, offsetMs = 0;
  const M = { forceFallback: false, timeScale: 1, ctx: () => ctx, offsetMs: (v) => { if (v !== undefined) offsetMs = v; return offsetMs; }, playing: () => !!run };

  M.ensure = function ensure() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
        ctx = new AC({ latencyHint: 'interactive' });
        master = ctx.createGain();
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 6; comp.attack.value = 0.005; comp.release.value = 0.2;
        const limit = ctx.createGain(); limit.gain.value = 0.7;                 // hard cap: master never exceeds ~0.7 of full scale
        bus = ctx.createGain(); bus.connect(comp); comp.connect(master); master.connect(limit); limit.connect(ctx.destination);
        delay = ctx.createDelay(1); const fbg = ctx.createGain(); fbg.gain.value = 0.28; const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2400;
        delay.connect(dl); dl.connect(fbg); fbg.connect(delay); dl.connect(bus);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        applyVolume();
      }
      if (ctx.state === 'suspended' && !paused) ctx.resume().catch(() => {});
      return true;
    } catch (e) { ctx = null; return false; }
  };
  function applyVolume() { if (master) master.gain.value = sound ? 0.55 * Math.pow(Math.max(0, Math.min(1, volume)), 1.5) : 0; }
  M.setVolume = (v) => { volume = v; applyVolume(); };
  M.getVolume = () => volume;
  M.setSound = (on) => { sound = on; applyVolume(); };

  // ---------- voices ----------
  const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  function osc(type, f, t, dur, g) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.connect(g); o.start(t); o.stop(t + dur); return o; }
  function noise(t, dur, g) { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.connect(g); s.start(t, Math.random() * 0.5, dur); }
  function kick(t, v = 1) {
    const g = ctx.createGain(); g.connect(bus); const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    env(g, t, 0.002, 0.95 * v, 0.28); o.connect(g); o.start(t); o.stop(t + 0.32);
  }
  function snare(t, v = 1) {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7; const g = ctx.createGain(); g.connect(bus); f.connect(g);
    env(g, t, 0.002, 0.34 * v, 0.17); noise(t, 0.22, f);
    const g2 = ctx.createGain(); g2.connect(bus); env(g2, t, 0.002, 0.2 * v, 0.1); osc('triangle', 185, t, 0.14, g2);
  }
  function hat(t, v = 1, open = false) {
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7200; const g = ctx.createGain(); g.connect(bus); f.connect(g);
    env(g, t, 0.001, 0.07 * v, open ? 0.2 : 0.045); noise(t, open ? 0.25 : 0.08, f);
  }
  function clap(t, v = 1) {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 1.2; const g = ctx.createGain(); g.connect(bus); f.connect(g);
    for (let i = 0; i < 3; i++) { g.gain.setValueAtTime(0.0001, t + i * 0.011); g.gain.exponentialRampToValueAtTime(0.22 * v, t + i * 0.011 + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.011 + 0.05); }
    g.gain.setValueAtTime(0.0001, t + 0.033); g.gain.exponentialRampToValueAtTime(0.2 * v, t + 0.036); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    noise(t, 0.22, f);
  }
  function bass(t, midi, dur, v = 1) {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(260, t + dur);
    const g = ctx.createGain(); f.connect(g); g.connect(bus); env(g, t, 0.006, 0.42 * v, dur);
    osc('sawtooth', mtof(midi), t, dur + 0.05, f); osc('sine', mtof(midi - 12), t, dur + 0.05, f);
  }
  function chord(t, midis, dur, type, v = 1) {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = type === 'hard' ? 1900 : 1300; const g = ctx.createGain(); f.connect(g); g.connect(bus);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.085 * v, t + 0.04); g.gain.setValueAtTime(0.085 * v, t + dur * 0.8); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    for (const m of midis) for (const det of [-6, 6]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + dur + 0.05); }
  }
  function pluck(t, midi, v = 1) {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3600, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.16); const g = ctx.createGain(); f.connect(g); g.connect(bus);
    env(g, t, 0.003, 0.09 * v, 0.17); osc('square', mtof(midi), t, 0.2, f);
  }
  function lead(t, midi, dur, wave, v = 1) {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = wave === 'sawtooth' ? 2800 : 3600; const g = ctx.createGain(); f.connect(g); g.connect(bus);
    const send = ctx.createGain(); send.gain.value = 0.32; g.connect(send); send.connect(delay);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13 * v, t + 0.015); g.gain.setValueAtTime(0.1 * v, t + Math.max(0.02, dur - 0.06)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    const o = osc(wave, mtof(midi), t, dur + 0.08, f);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5.2; lg.gain.value = 7; lfo.connect(lg); lg.connect(o.detune); lfo.start(t); lfo.stop(t + dur + 0.08);
    if (wave === 'sawtooth') osc('square', mtof(midi) * 1.004, t, dur + 0.08, f);
  }
  // little reward chime (also used for hit feedback): grade 'perfect'|'good'|'ok'
  M.chime = function chime(grade) {
    if (!ctx || ctx.state !== 'running' || !sound) return;
    const t = ctx.currentTime + 0.01, base = grade === 'perfect' ? 84 : grade === 'good' ? 79 : 74;
    const g = ctx.createGain(); g.connect(bus); env(g, t, 0.004, grade === 'ok' ? 0.05 : 0.09, 0.22); osc('sine', mtof(base), t, 0.3, g);
    if (grade === 'perfect') { const g2 = ctx.createGain(); g2.connect(bus); env(g2, t + 0.05, 0.004, 0.06, 0.25); osc('sine', mtof(base + 7), t + 0.05, 0.3, g2); }
  };
  function click(t, strong) { const g = ctx.createGain(); g.connect(bus); env(g, t, 0.001, strong ? 0.25 : 0.14, 0.06); osc('square', strong ? 1500 : 1000, t, 0.08, g); }

  // ---------- scheduler ----------
  function sectionLayers(track, bar) { for (const [a, b, l] of track.sections) if (bar >= a && bar < b) return l.split(' '); return []; }
  function playStep(R, s, t) {                    // s = song step index (16ths) from beat 0; already loop-mapped
    const tr = R.track, bar = Math.floor(s / 16), st = s % 16, layers = sectionLayers(tr, bar), sd = R.stepDur;
    const cc = tr.chords[bar % 4], root = cc[0], tri = cc[1] === 'min' ? [0, 3, 7] : [0, 4, 7];
    if (R.totalBeats && s >= R.totalBeats * 4) {  // outro: a final chord + hit on the downbeat, nothing after
      if (s === R.totalBeats * 4) { chord(t, tri.map((x) => root + 12 + x), sd * 12, R.id, 1); kick(t); bass(t, root, sd * 8); }
      return;
    }
    const sw = (st % 2 === 1 ? tr.swing * sd : 0), tt = t + sw;
    if (layers.includes('kick') && tr.kick[st]) kick(t);
    if (layers.includes('snare') && tr.snare[st]) snare(t);
    if (layers.includes('clap') && tr.snare[st]) clap(t, 0.8);
    if (layers.includes('hat') && tr.hat[st]) hat(tt, st % 4 === 2 ? 1 : 0.7, R.id === 'hard' && st === 14);
    if (layers.includes('bass') && tr.bass[st] !== null && tr.bass[st] !== undefined) bass(t, root - 12 + tr.bass[st], sd * 2.4);
    if (layers.includes('chords') && st === 0) chord(t, tri.map((x) => root + 12 + x), sd * 15, R.id, R.id === 'easy' ? 1 : 0.85);
    if (layers.includes('arp') && st % 2 === 0) pluck(tt, root + 24 + tri[(st / 2) % 3] + (st % 8 >= 4 ? 12 : 0), 0.9);
    if (layers.includes('lead')) { const L = tr.leadNotes.get(s % 64); if (L) lead(t, scaleNote(tr.root + 12, tr.pent, L[0]), L[1] * sd * 0.92, tr.leadWave); }
  }
  function mapStep(R, s) { return R.loop ? R.loop.start * 4 + (s % (R.loop.len * 4)) : s; }
  function schedule() {
    if (!run || paused || !ctx || ctx.state !== 'running') return;
    const R = run, horizon = ctx.currentTime + 0.25;
    while (R.nextT < horizon) {
      const s = R.step, t = Math.max(R.nextT, ctx.currentTime + 0.005);
      if (s < 0) { if (s % 4 === 0) click(t, s === -R.countIn * 4); }
      else if (!R.loop && R.totalBeats && s > R.totalBeats * 4) { /* finished */ }
      else playStep(R, mapStep(R, s), t);
      R.step++; R.nextT += R.stepDur;
    }
  }

  M.start = function start({ track = 'easy', bpm = 100, speed = 1, countIn = 4, loop = null, totalBeats = 0 } = {}) {
    M.stop();
    const tr = TRACKS[track]; tr.leadNotes = tr.leadNotes || new Map(tr.lead.map(([s, n, d]) => [s, [n, d]]));
    const bpmEff = bpm * speed, ok = !M.forceFallback && M.ensure() && ctx.state === 'running';
    useCtx = !!ok;
    const lead = 0.25;                                              // seconds from now to the first count-in click
    run = { id: track, track: tr, bpm: bpmEff, stepDur: 60 / bpmEff / 4, countIn, step: -countIn * 4, loop, totalBeats, t0: 0, nextT: 0 };
    if (useCtx) { run.nextT = ctx.currentTime + lead; run.t0 = run.nextT + countIn * 60 / bpmEff; }
    else { fb = -lead; run.t0 = countIn * 60 / bpmEff; }           // frame-clock fallback (in seconds, starting a hair before the first click)
    paused = false;
    if (useCtx) { schedule(); timer = setInterval(schedule, 40); }
    return run;
  };
  M.stop = function stop() { if (timer) { clearInterval(timer); timer = null; } run = null; paused = false; if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); };
  M.pause = function pause() { if (!run || paused) return; paused = true; if (useCtx && ctx) ctx.suspend().catch(() => {}); };
  M.resume = function resume() { if (!run || !paused) return; paused = false; if (useCtx && ctx) ctx.resume().then(schedule).catch(() => {}); };
  M.paused = () => paused;
  M.tick = function tick(dt) { if (run && !useCtx && !paused) fb += dt * M.timeScale; };
  M.usingAudio = () => useCtx;
  // routine beat now (negative in the count-in); loop-mapped in practice mode
  M.beat = function beat() {
    if (!run) return 0;
    let T;
    if (useCtx) { let lat = 0; try { lat = ctx.outputLatency || ctx.baseLatency || 0; } catch (e) { /* ignore */ } T = ctx.currentTime - lat; }
    else T = fb;
    const vb = (T - run.t0) * run.bpm / 60 - offsetMs / 1000 * run.bpm / 60;
    M._virtual = vb;
    if (run.loop && vb >= 0) return run.loop.start + (vb % run.loop.len);
    return vb;
  };
  M.virtualBeat = () => M._virtual || 0;
  M.bpm = () => (run ? run.bpm : 100);
  M.setBeat = (b) => {                                              // test hook: shift the frame-clock fallback so beat() == b
    if (useCtx || !run) return; fb = b * 60 / run.bpm + run.t0;
  };
  return M;
}
