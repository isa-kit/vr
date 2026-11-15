// ============================ Sky Chimes — a lie-down VR rhythm game (Oortia) ============================
// Seven chimes hang in the dusk sky above you. Soft rings of light close in on them, one at a time, in a slow tune;
// ring a chime as its ring arrives (trigger / click / tap — or just rest your aim on it). Nothing is ever lost: a
// chime you miss still sounds, quietly, so the tune carries on. Free play lets you simply play the chimes.
// Built on the app standard: shared/lie.js (the Lying up kit) → shared/app.js (menu, Pause, comfort). STANDARD.md.
import * as THREE from 'three';
import { createLieGame } from '../shared/lie.js?v=lie5';

const TINT = [0xffb86b, 0xff8fa8, 0xd59bff, 0x8fb4ff, 0x7fe0d4, 0xa8e88a, 0xffe07a];
const TEMPI = [['Slow', 46], ['Calm', 60], ['Lively', 78]];
const LEAD_BEATS = 2, WINDOW = 0.3, N = 7;
const KEY = 'oortia-chimes-v1';
const P = Object.assign({ mode: 'follow', ring: 'tap', tempo: 1 }, (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } })());
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { /* */ } };
const G = { inTime: 0, streak: 0, beatIn: 2, last: 3, beat: 0 };
let K;

Promise.resolve().then(init).catch((e) => { console.error(e); const s = document.getElementById('status'); if (s) s.textContent = 'Could not start: ' + e.message; });

function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
}

async function init() {
  const set = (k, v) => { P[k] = v; save(); K.menu.refresh(); drawHud(); };
  K = await createLieGame({
    title: 'Sky Chimes', sky: 'dusk',
    hint: 'Click a chime as its ring of light closes on it. Drag to look around. Esc for menu.',
    rows: [
      { label: 'Play', cells: [{ text: 'Follow the rings', action: () => set('mode', 'follow'), active: () => P.mode === 'follow' }, { text: 'Free play', action: () => set('mode', 'free'), active: () => P.mode === 'free' }] },
      { label: 'Ring by', cells: [{ text: 'Tap / trigger', action: () => set('ring', 'tap'), active: () => P.ring === 'tap' }, { text: 'Resting on it', action: () => set('ring', 'rest'), active: () => P.ring === 'rest' }] },
      { label: 'Tempo', cells: TEMPI.map(([t], i) => ({ text: t, action: () => set('tempo', i), active: () => P.tempo === i })) },
    ],
  });
  const { field, FW, FH, sfx } = K;
  const gTex = glowTex();

  const hud = K.text({ w: 4.6, h: 0.42, size: 0.6 }); hud.position.set(0, FH + 0.32, 0.05); field.add(hud);
  const intro = K.text({ w: 6, h: 1.1, size: 0.6 }); intro.position.set(0, -FH * 0.55, 0.3); field.add(intro);
  intro.set('Sky Chimes\nRing a chime as its ring of light arrives.');
  let introT = 9;
  function drawHud() {
    hud.set(P.mode === 'free' ? '♪ Free play — ring any chime' : `♪ ${G.inTime} in time` + (G.streak > 1 ? `   ·   ${G.streak} in a row` : '') + `   ·   best ${K.best('chimes')}`);
  }
  drawHud();

  // ---------- the chimes: a gentle arc across the sky, low notes on the left ----------
  const chimes = [];
  const tubeGeo = new THREE.CylinderGeometry(0.045, 0.045, 1, 14), bobGeo = new THREE.SphereGeometry(0.075, 16, 12), ringGeo = new THREE.RingGeometry(0.93, 1, 56);
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1), col = new THREE.Color(TINT[i]);
    const x = (u * 2 - 1) * FW * 0.82, y = FH * (0.42 - 0.5 * Math.pow(u * 2 - 1, 2));
    const g = new THREE.Group(); g.position.set(x, y, 0); field.add(g);
    const len = 0.95 - 0.07 * i;                                    // longer tube = lower note
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.4, emissive: col, emissiveIntensity: 0.25 });
    const tube = new THREE.Mesh(tubeGeo, mat); tube.scale.y = len; tube.position.y = -len / 2 + 0.25;
    const bob = new THREE.Mesh(bobGeo, mat); bob.position.y = -len + 0.18;
    const cord = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.5), new THREE.MeshBasicMaterial({ color: 0xcfd8ff, transparent: true, opacity: 0.35 })); cord.position.y = 0.5;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: gTex, color: col, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending })); glow.scale.setScalar(1.3); glow.position.y = -0.15;
    const swing = new THREE.Group(); swing.position.y = 0.75; tube.position.y -= 0.75; bob.position.y -= 0.75; cord.position.y -= 0.75; glow.position.y -= 0.75;
    swing.add(cord, tube, bob, glow); g.add(swing);
    chimes.push({ i, g, swing, mat, glow, x, y: y - 0.15, flash: 0, kick: 0, ph: i * 1.7 });
  }

  // ---------- pulses: a ring of light that closes on a chime; it "arrives" when it reaches the chime ----------
  const pulses = [];
  function addPulse(ci, lead) {
    const c = chimes[ci];
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: TINT[ci], transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    m.position.set(c.x, c.y, 0.08); field.add(m);
    pulses.push({ c, m, left: lead, lead });
  }
  function dropPulse(p) { field.remove(p.m); p.m.material.dispose(); pulses.splice(pulses.indexOf(p), 1); }
  function ring(c, vol, aim) {
    sfx.bell(c.i, { vol, dur: 2.6, base: 294 }); c.flash = 1; c.kick = 1; if (aim) K.buzz(aim);
  }
  function hit(p, aim) {
    ring(p.c, 0.11, aim); dropPulse(p);
    G.inTime++; G.streak++; K.best('chimes', G.inTime);
    if (G.streak > 0 && G.streak % 8 === 0) { sfx.chord([0, 2, 4, 7], { vol: 0.05, spread: 0.14, dur: 3, base: 294, at: 0.25 }); K.toast(`${G.streak} in a row ✦`); }
    drawHud();
  }
  const near = (a, c, r) => Math.hypot(a.x - c.x, a.y - c.y) < r;

  K.onPress((a) => {
    let best = null, bd = a.kind === 'touch' ? 0.7 : 0.5;
    for (const c of chimes) { const d = Math.hypot(a.x - c.x, a.y - c.y); if (d < bd) { bd = d; best = c; } }
    if (!best) return;
    const p = pulses.find((q) => q.c === best && Math.abs(q.left) < WINDOW);
    if (p) hit(p, a); else ring(best, 0.075, a);                    // out of time is fine: it simply rings
  });

  K.tick((dt, t) => {
    if (introT > 0) { introT -= dt; intro.material.opacity = Math.min(1, introT / 1.5); if (introT <= 0) intro.visible = false; }
    const beat = 60 / TEMPI[P.tempo][1];
    // the tune: a slow random walk over the seven notes, with rests
    if (P.mode === 'follow') {
      G.beatIn -= dt;
      if (G.beatIn <= 0) {
        G.beatIn += beat; G.beat++;
        if (G.beat % 8 !== 0 && Math.random() < 0.78) {
          G.last = Math.max(0, Math.min(N - 1, G.last + [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)]));
          addPulse(G.last, beat * LEAD_BEATS);
        }
      }
    } else if (pulses.length) { for (const p of pulses.slice()) dropPulse(p); }
    for (const p of pulses.slice()) {
      p.left -= dt;
      const k = Math.max(0, p.left / p.lead);                       // 1 → 0 as it closes in
      p.m.scale.setScalar(0.34 + 1.5 * k); p.m.material.opacity = 0.15 + 0.75 * (1 - k);
      if (P.ring === 'rest' && p.left <= 0 && K.aims.some((a) => a.onField && near(a, p.c, 0.5))) { hit(p, K.aims.find((a) => a.onField && near(a, p.c, 0.5))); continue; }
      if (p.left < -WINDOW) {                                       // missed: the note still sounds, softly, so the tune carries on
        sfx.bell(p.c.i, { vol: 0.03, dur: 1.8, base: 294 }); p.c.flash = 0.35; dropPulse(p);
        if (G.streak) { G.streak = 0; drawHud(); }
      }
    }
    for (const c of chimes) {
      c.flash = Math.max(0, c.flash - dt * 1.4); c.kick = Math.max(0, c.kick - dt * 0.7);
      c.mat.emissiveIntensity = 0.25 + 1.9 * c.flash; c.glow.material.opacity = 0.18 + 0.6 * c.flash;
      c.swing.rotation.z = Math.sin(t * 0.6 + c.ph) * 0.035 + Math.sin(t * 7 + c.ph) * 0.09 * c.kick * c.kick;
    }
  });
  K.start();
}
