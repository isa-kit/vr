// ============================ rts/sfx.js — gentle synthesized sounds (no samples). Quiet by design: master gain 0.22, soft attacks. ============================
export function createSfx() {
  let ctx = null, master = null, on = true, last = {};
  const ensure = () => { if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; } try { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.22; master.connect(ctx.destination); } catch (e) { ctx = null; } };
  const tone = (f, d, type = 'sine', v = 0.3, f2 = null, at = 0.01) => {
    if (!ctx || !on) return; const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + at); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + d + 0.05);
  };
  const noise = (d, v = 0.15, lp = 900) => {
    if (!ctx || !on) return; const t = ctx.currentTime, n = Math.floor(ctx.sampleRate * d), b = ctx.createBuffer(1, n, ctx.sampleRate), a = b.getChannelData(0);
    for (let i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = b; f.type = 'lowpass'; f.frequency.value = lp; g.gain.value = v;
    s.connect(f); f.connect(g); g.connect(master); s.start(t);
  };
  const gate = (k, ms) => { const n = performance.now(); if (last[k] && n - last[k] < ms) return false; last[k] = n; return true; };
  return {
    ensure, set: (v) => { on = v; }, get on() { return on; },
    select() { if (gate('sel', 60)) tone(620, 0.09, 'sine', 0.16, 780); },
    move() { if (gate('mv', 80)) tone(330, 0.1, 'triangle', 0.16, 300); },
    attack() { if (gate('at', 80)) tone(220, 0.12, 'triangle', 0.18, 170); },
    hit() { if (gate('hit', 70)) noise(0.07, 0.1, 700); },
    shot() { if (gate('shot', 90)) tone(900, 0.07, 'sine', 0.06, 500); },
    boom() { if (gate('boom', 120)) { noise(0.35, 0.18, 380); tone(90, 0.3, 'sine', 0.22, 55); } },
    die() { if (gate('die', 90)) tone(260, 0.2, 'sine', 0.1, 140); },
    coin() { if (gate('coin', 140)) { tone(880, 0.12, 'sine', 0.09); setTimeout(() => tone(1175, 0.14, 'sine', 0.08), 70); } },
    train() { if (gate('tr', 100)) { tone(523, 0.14, 'triangle', 0.14); setTimeout(() => tone(659, 0.18, 'triangle', 0.14), 90); } },
    built() { tone(392, 0.16, 'triangle', 0.14); setTimeout(() => tone(587, 0.22, 'triangle', 0.14), 110); },
    alert() { if (gate('al', 4000)) { tone(300, 0.22, 'sine', 0.2); setTimeout(() => tone(250, 0.28, 'sine', 0.2), 200); } },
    win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.4, 'sine', 0.16), i * 140)); },
    lose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.5, 'sine', 0.16), i * 200)); },
    error() { if (gate('er', 300)) tone(160, 0.14, 'square', 0.06); },
  };
}
