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
  let REC = null, useCtx = false, fb = 0, run = null, timer = null, paused = false, offsetMs = 0;
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
  function kick(t, v = 1) { if (REC) { REC.push(['kick', t, 0.3, 0, v]); return; }
    const g = ctx.createGain(); g.connect(bus); const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    env(g, t, 0.002, 0.95 * v, 0.28); o.connect(g); o.start(t); o.stop(t + 0.32);
  }
  function snare(t, v = 1) { if (REC) { REC.push(['snare', t, 0.2, 0, v]); return; }
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7; const g = ctx.createGain(); g.connect(bus); f.connect(g);
    env(g, t, 0.002, 0.34 * v, 0.17); noise(t, 0.22, f);
    const g2 = ctx.createGain(); g2.connect(bus); env(g2, t, 0.002, 0.2 * v, 0.1); osc('triangle', 185, t, 0.14, g2);
  }
  function hat(t, v = 1, open = false) { if (REC) { REC.push(['hat', t, open ? 0.25 : 0.08, 0, v, open ? 'open' : 'closed']); return; }
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7200; const g = ctx.createGain(); g.connect(bus); f.connect(g);
    env(g, t, 0.001, 0.07 * v, open ? 0.2 : 0.045); noise(t, open ? 0.25 : 0.08, f);
  }
  function clap(t, v = 1) { if (REC) { REC.push(['clap', t, 0.2, 0, v]); return; }
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 1.2; const g = ctx.createGain(); g.connect(bus); f.connect(g);
    for (let i = 0; i < 3; i++) { g.gain.setValueAtTime(0.0001, t + i * 0.011); g.gain.exponentialRampToValueAtTime(0.22 * v, t + i * 0.011 + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.011 + 0.05); }
    g.gain.setValueAtTime(0.0001, t + 0.033); g.gain.exponentialRampToValueAtTime(0.2 * v, t + 0.036); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    noise(t, 0.22, f);
  }
  function bass(t, midi, dur, v = 1) { if (REC) { REC.push(['bass', t, dur, midi, v]); return; }
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(260, t + dur);
    const g = ctx.createGain(); f.connect(g); g.connect(bus); env(g, t, 0.006, 0.42 * v, dur);
    osc('sawtooth', mtof(midi), t, dur + 0.05, f); osc('sine', mtof(midi - 12), t, dur + 0.05, f);
  }
  function chord(t, midis, dur, type, v = 1) { if (REC) { REC.push(['chord', t, dur, midis, v, type]); return; }
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = type === 'hard' ? 1900 : 1300; const g = ctx.createGain(); f.connect(g); g.connect(bus);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.085 * v, t + 0.04); g.gain.setValueAtTime(0.085 * v, t + dur * 0.8); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    for (const m of midis) for (const det of [-6, 6]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + dur + 0.05); }
  }
  function pluck(t, midi, v = 1) { if (REC) { REC.push(['pluck', t, 0.2, midi, v]); return; }
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3600, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.16); const g = ctx.createGain(); f.connect(g); g.connect(bus);
    env(g, t, 0.003, 0.09 * v, 0.17); osc('square', mtof(midi), t, 0.2, f);
  }
  function lead(t, midi, dur, wave, v = 1) { if (REC) { REC.push(['lead', t, dur, midi, v, wave]); return; }
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


  // ---------- songs: one small interface (see SONG-FORMAT.md) ----------
  // song = { format:1, id, title, bpm, meter:[3|4,4], tempoFit:{min,max}, length (beats), instruments:{id:{preset|synth|drum}}, sections:[{name,from,to}], tracks:[{instrument, events:[[beat,dur,pitch,vel,param?]]}] }
  const TPB = 48;                                                      // ticks per beat for scheduled events (quantisation 1/48 beat)
  function bakeWith(fn, ticks) { REC = []; try { fn(); } finally { var ev = REC; REC = null; } return ev; }
  function toSong(ev, meta) {
    const by = {};
    for (const [inst, t, dur, pitch, vel, p] of ev) (by[inst] = by[inst] || []).push([Math.round(t * 1000) / 1000, Math.round(dur * 1000) / 1000, pitch, Math.round(vel * 100) / 100, ...(p === undefined ? [] : [p])]);
    const instruments = {}, tracks = [];
    for (const k of Object.keys(by)) { instruments[k] = { preset: k }; tracks.push({ instrument: k, events: by[k].sort((a, b) => a[0] - b[0]) }); }
    return { format: 1, author: 'built-in', ...meta, instruments, tracks };
  }
  // built-in solo track → song object
  M.bakeSolo = function bakeSolo(trackId, bars, meta) {
    const tr = TRACKS[trackId]; tr.leadNotes = tr.leadNotes || new Map(tr.lead.map(([s, n, d]) => [s, [n, d]]));
    const R = { id: trackId, track: tr, bpm: 60, stepDur: 0.25, totalBeats: (bars - 1) * 4 };
    const ev = bakeWith(() => { for (let s = 0; s <= bars * 16; s++) playStep(R, s, s * 0.25); });
    const sections = tr.sections.map(([a, b, l]) => ({ name: l.split(' ').length > 5 ? 'full' : l.split(' ').includes('lead') ? 'lead' : 'groove', from: a * 4, to: Math.min(b, bars) * 4, layers: l.split(' ') })).filter((x) => x.to > x.from);
    return toSong(ev, { ...meta, bpm: meta.bpm, meter: [4, 4], length: bars * 4, loop: false, sections });
  };
  // built-in style feel → song object (8 bars so the 4-bar chord loop repeats)
  M.bakeFeel = function bakeFeel(feel, meter, meta) {
    const R = { feel, bpm: 60, meter, click: false, vol: 1 }, bars = 8;
    const ev = bakeWith(() => { for (let s = 0; s < bars * meter * 12; s++) playFeel(R, s, s / 12); });
    return toSong(ev, { ...meta, meter: [meter, 4], length: bars * meter, loop: true, sections: [{ name: 'groove', from: 0, to: bars * meter }] });
  };
  // generic synth instrument from numbers
  function synthVoice(t, inst, midi, dur, v) {
    const S = inst.synth, e = S.env || { a: 0.01, d: 0.1, s: 0.6, r: 0.1 }, g = ctx.createGain(); g.connect(bus);
    const peak = (S.gain ?? 0.15) * v, f = ctx.createBiquadFilter(); f.type = (S.filter && S.filter.type) || 'lowpass'; f.Q.value = (S.filter && S.filter.q) || 0.7;
    const base = (S.filter && S.filter.freq) || 3000, amt = (S.filter && S.filter.envAmt) || 0;
    f.frequency.setValueAtTime(base * (1 + amt), t); f.frequency.exponentialRampToValueAtTime(Math.max(60, base), t + e.a + e.d + 0.001); f.connect(g);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + e.a); g.gain.linearRampToValueAtTime(peak * e.s, t + e.a + e.d); g.gain.setValueAtTime(peak * e.s, t + Math.max(e.a + e.d, dur)); g.gain.linearRampToValueAtTime(0.0001, t + Math.max(e.a + e.d, dur) + e.r);
    for (const o of S.osc || [{ type: 'sawtooth' }]) { const os = ctx.createOscillator(); os.type = o.type || 'sawtooth'; os.frequency.value = mtof(midi + (o.semi || 0)); os.detune.value = o.detune || 0; const og = ctx.createGain(); og.gain.value = o.gain ?? 1; os.connect(og); og.connect(f); os.start(t); os.stop(t + Math.max(e.a + e.d, dur) + e.r + 0.05); }
    if (S.noise) { const n = ctx.createGain(); n.gain.value = S.noise; n.connect(f); noise(t, dur + e.r, n); }
  }
  function fireEvent(inst, ev, t, bd) {            // ev = [beat, dur, pitch, vel, param?]; durations are in beats
    const [, dur, pitch, vel, p] = ev, d = dur * bd, v = vel ?? 1;
    if (inst.synth) { for (const n of Array.isArray(pitch) ? pitch : [pitch]) synthVoice(t, inst, n, d, v); return; }
    switch (inst.preset) {
      case 'kick': return kick(t, v); case 'snare': return snare(t, v); case 'hat': return hat(t, v, p === 'open'); case 'clap': return clap(t, v);
      case 'bass': return bass(t, pitch, d, v); case 'chord': return chord(t, pitch, d, p, v); case 'pluck': return pluck(t, pitch, v);
      case 'lead': return lead(t, pitch, d, p || 'triangle', v); case 'perc': return perc(t, pitch, v, d, p || 'square');
    }
  }
  // load a song object and schedule it on the beat clock. opts: { bpm, countIn, loop:{start,len}|null (beats; practice loops), wrap, beatLoop (len of the game's beat loop) }
  M.startSong = function startSong(song, opts = {}) {
    M.stop();
    const bpm = opts.bpm || song.bpm || 100, L = song.length || 16, ok = !M.forceFallback && M.ensure() && ctx.state === 'running'; useCtx = !!ok;
    const buckets = new Map();
    for (const tr of song.tracks) { const inst = song.instruments[tr.instrument]; if (!inst) continue; for (const ev of tr.events) { const k = Math.round(ev[0] * TPB); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push([inst, ev]); } }
    const countIn = opts.countIn ?? (song.meter ? song.meter[0] : 4), lead = 0.25, per = TPB * 1;
    const loop = opts.loop || (opts.beatLoop ? { start: 0, len: opts.beatLoop } : null);
    run = { song, buckets, L, stepDur: 60 / bpm / TPB, bpm, countIn, step: -countIn * TPB, loop, wrap: !opts.loop && !!opts.wrap, gameLoop: opts.loop, meter: song.meter ? song.meter[0] : 4, click: !!opts.click, countOnly: !!opts.countOnly, style: false, id: song.id, t0: 0, nextT: 0 };
    if (useCtx) { run.nextT = ctx.currentTime + lead; run.t0 = run.nextT + countIn * 60 / bpm; } else { fb = -lead; run.t0 = countIn * 60 / bpm; }
    paused = false; if (useCtx) { schedule(); timer = setInterval(schedule, 40); }
    return run;
  };
  M.section = function section() { if (!run || !run.song) return null; const b = ((M._virtual || 0) % run.L + run.L) % run.L; return (run.song.sections || []).find((x) => b >= x.from && b < x.to) || null; };
  M.songInfo = () => (run && run.song ? { id: run.song.id, title: run.song.title, bpm: run.bpm, length: run.L } : null);

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
      if (R.song) {
        if (s < 0) { if (s % TPB === 0) click(t, s === -R.countIn * TPB || (-s / TPB) % R.meter === 0); }
        else {
          if (R.click && s % TPB === 0) click(t, (s / TPB) % R.meter === 0);
          if (!R.countOnly) {
            let k = s; if (R.gameLoop) k = R.gameLoop.start * TPB + (s % (R.gameLoop.len * TPB)); else if (R.wrap) k = s % (R.L * TPB);
            const list = R.buckets.get(k); if (list) { const bd = 60 / R.bpm; for (const [inst, ev] of list) fireEvent(inst, ev, t, bd); }
          }
        }
        R.step++; R.nextT += R.stepDur; continue;
      }
      if (s < 0) { const per = R.style ? 12 : 4; if (s % per === 0) click(t, s === -R.countIn * per || (R.style && (-s / 12) % R.meter === 0)); }
      else if (R.style) playFeel(R, s, t);
      else if (!R.style && !R.loop && R.totalBeats && s > R.totalBeats * 4) { /* finished */ }
      else playStep(R, mapStep(R, s), t);
      R.step++; R.nextT += R.stepDur;
    }
  }


  // ---------- style loops for the dance school (12 ticks per beat; feel templates) ----------
  function perc(t, f, v = 1, d = 0.05, type = 'square') { if (REC) { REC.push(['perc', t, d, f, v, type]); return; } const g = ctx.createGain(); g.connect(bus); env(g, t, 0.001, 0.12 * v, d); osc(type, f, t, d + 0.02, g); }
  const PROG = {
    swing: [[45, 'min'], [45, 'min'], [50, 'min'], [45, 'min']], ecs: [[48, 'maj'], [48, 'maj'], [53, 'maj'], [55, 'maj']],
    salsa: [[50, 'min'], [43, 'maj'], [48, 'maj'], [45, 'maj']], bachata: [[45, 'min'], [41, 'maj'], [48, 'maj'], [43, 'maj']],
    hustle: [[45, 'min'], [50, 'min'], [43, 'maj'], [48, 'maj']], twostep: [[43, 'maj'], [43, 'maj'], [48, 'maj'], [50, 'maj']],
    waltz: [[48, 'maj'], [43, 'maj'], [45, 'min'], [50, 'maj']], foxtrot: [[46, 'maj'], [51, 'maj'], [46, 'maj'], [53, 'maj']],
    chacha: [[45, 'min'], [50, 'min'], [52, 'maj'], [45, 'min']], rumba: [[45, 'min'], [41, 'maj'], [43, 'maj'], [45, 'min']], tango: [[45, 'min'], [45, 'min'], [52, 'maj'], [45, 'min']],
  };
  const CLAVE = [0, 3, 6, 10, 12];                                 // son clave 3-2 on an 8th-note grid over two bars
  function playFeel(R, s, t) {
    const f = R.feel, tpb = 12, beat = Math.floor(s / tpb), tk = s % tpb, M3 = R.meter === 3, bib = beat % R.meter, bar = Math.floor(beat / R.meter);
    const [root, kind] = (PROG[f] || PROG.swing)[bar % 4], tri = kind === 'min' ? [0, 3, 7] : [0, 4, 7], bd = 60 / R.bpm, e8 = tk % 6 === 0, idx8 = (beat * 2 + (tk >= 6 ? 1 : 0)) % 16;
    const V = R.vol;
    if (R.click) { if (tk === 0) click(t, bib === 0); if (R.countOnly) return; }
    if (f === 'swing' || f === 'ecs' || f === 'foxtrot') {
      const sw = tk === 8 ? 1 : 0;
      if (tk === 0 || sw) hat(t, bib % 2 ? 0.8 : 1, false);
      if (tk === 0 && !M3 && (bib === 0 || bib === 2) && f !== 'foxtrot') kick(t, 0.8);
      if (tk === 0 && !M3 && (bib === 1 || bib === 3)) { if (f === 'foxtrot') hat(t, 1.2, true); else snare(t, 0.7); }
      if (tk === 0) { const walk = [0, 4, 7, 9][bib % 4]; bass(t, root - 12 + (kind === 'min' && walk === 4 ? 3 : walk), bd * 0.9, 1); }
      if (tk === 8 && (bib === 1 || bib === 3)) chord(t, tri.map((x) => root + 12 + x), bd * 0.4, 'swing', 0.7);
      return;
    }
    if (f === 'salsa' || f === 'chacha' || f === 'rumba') {
      const CL = f === 'rumba' ? [0, 3, 7, 10, 12] : CLAVE;
      if (e8 && CL.includes(idx8)) perc(t, 1900, 1, 0.05);
      if (e8) hat(t, 0.6);
      if (tk === 0 && (bib === 0 || bib === 2) && f !== 'rumba') kick(t, 0.6);
      if (tk === 6 && bib === 1 || tk === 0 && bib === 3) bass(t, root - 12 + (bib === 3 ? 7 : 0), bd * 0.8, 1);
      if (e8 && (idx8 % 8 === 1 || idx8 % 8 === 4 || idx8 % 8 === 7)) pluck(t, root + 12 + tri[(idx8 + bar) % 3], 1);
      if (f === 'chacha' && ((bib === 3 && (tk === 0 || tk === 6)) || (bib === 0 && tk === 0))) perc(t, 900, 1.3, 0.06, 'triangle');
      return;
    }
    if (f === 'bachata') {
      if (e8) { hat(t, 0.6); pluck(t, root + 12 + tri[(beat * 2 + (tk >= 6 ? 1 : 0)) % 3] + 12 * ((idx8 % 4) > 1 ? 1 : 0), 1); }
      if (tk === 0 && (bib === 0 || bib === 2)) bass(t, root - 12, bd * 0.7, 1);
      if (tk === 0 && bib === 3) perc(t, 1500, 1, 0.04);
      if (tk === 0 && (bib === 1 || bib === 3)) perc(t, 500, 1, 0.07, 'triangle');
      return;
    }
    if (f === 'hustle') {
      if (tk === 0) kick(t, 1); if (tk === 6) hat(t, 1, true);
      if (tk === 0 && (bib === 1 || bib === 3)) clap(t, 0.8);
      if (e8) bass(t, root - 12 + (tk === 6 ? 12 : 0), bd * 0.45, 0.9);
      if (tk === 6 && (bib === 1 || bib === 3)) chord(t, tri.map((x) => root + 12 + x), bd * 0.3, 'hard', 0.8);
      return;
    }
    if (f === 'twostep') {
      if (tk === 0 && (bib === 0 || bib === 2)) bass(t, root - 12 + (bib === 2 ? 7 : 0), bd * 0.8, 1);
      if (tk === 0 && (bib === 1 || bib === 3)) { snare(t, 0.5); chord(t, tri.map((x) => root + 12 + x), bd * 0.3, 'twang', 0.8); }
      if (tk === 6) hat(t, 0.5);
      return;
    }
    if (f === 'waltz') {
      if (tk === 0 && bib === 0) { bass(t, root - 12, bd * 1.6, 1); kick(t, 0.35); }
      if (tk === 0 && bib > 0) chord(t, tri.map((x) => root + 12 + x), bd * 0.7, 'waltz', 0.9);
      if (tk === 6 && bib === 2) pluck(t, root + 24 + tri[bar % 3], 1);
      return;
    }
    if (f === 'tango') {
      if (tk === 0) { chord(t, tri.map((x) => root + 12 + x), bd * (bib % 2 ? 0.3 : 0.6), 'hard', 0.9); bass(t, root - 12 + (bib % 2 ? 7 : 0), bd * 0.5, 1); }
      if (tk === 0 && bib === 0) kick(t, 0.5);
      if (tk === 6 && bib === 3) pluck(t, root + 24 + tri[bar % 3], 1);
      if (tk === 0 && bib === 2) snare(t, 0.5);
      return;
    }
  }
  // style loop: M.startStyle({ feel, bpm, meter, beats, countIn, click, countOnly, speed })  → beat() is pattern-relative, looping every `beats`
  M.startStyle = function startStyle({ feel = 'swing', bpm = 100, meter = 4, beats = 6, countIn = 4, click = false, countOnly = false, repeats = 1 } = {}) {
    M.stop();
    const ok = !M.forceFallback && M.ensure() && ctx.state === 'running'; useCtx = !!ok;
    const sd = 60 / bpm / 12, lead = 0.25;
    run = { style: true, feel, meter, bpm, stepDur: sd, countIn, step: -countIn * 12, loop: { start: 0, len: beats * repeats }, totalBeats: 0, click, countOnly, vol: 1, t0: 0, nextT: 0, id: feel };
    if (useCtx) { run.nextT = ctx.currentTime + lead; run.t0 = run.nextT + countIn * 60 / bpm; } else { fb = -lead; run.t0 = countIn * 60 / bpm; }
    paused = false; if (useCtx) { schedule(); timer = setInterval(schedule, 40); }
    return run;
  };

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
  M.stop = function stop() { M._virtual = 0; if (timer) { clearInterval(timer); timer = null; } run = null; paused = false; if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); };
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
