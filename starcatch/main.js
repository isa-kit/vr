// ============================ Star Catcher — a lie-down VR game (Oortia) ============================
// Lie back and catch slow shooting stars as they cross the night sky overhead. Point (controller, head or mouse)
// and pull the trigger / click / tap — or switch to Hover mode and just rest your aim on a star.
import * as THREE from 'three';
import { createLieGame } from '../shared/lie.js?v=lie1';

const ROUND = 90;
const G = { state: 'title', time: 0, score: 0, combo: 0, caught: 0, spawnIn: 1, hover: false };
let K;

Promise.resolve().then(init).catch((e) => { console.error(e); const s = document.getElementById('status'); if (s) s.textContent = 'Could not start: ' + e.message; });

function trailTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 32; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 256, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.75, 'rgba(255,240,210,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = gr; g.beginPath(); g.moveTo(0, 16); g.lineTo(256, 4); g.lineTo(256, 28); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); return t;
}

async function init() {
  G.hover = localStorage.getItem('oortia-starcatch-hover') === '1';
  K = await createLieGame({
    title: 'Star Catcher', sky: 'night',
    hint: 'Click a falling star to catch it (or turn on Hover). Drag to look around. Esc for menu.',
    rows: [{ label: 'Catch by', cells: [
      { text: 'Trigger / click', action: () => setHover(false), active: () => !G.hover },
      { text: 'Hover', action: () => setHover(true), active: () => G.hover },
    ] }],
  });
  const { field, FW, FH, sfx } = K;
  const trailTex = trailTexture();

  // ---------- HUD + title ----------
  const hud = K.text({ w: 4, h: 0.42, size: 0.62 }); hud.position.set(0, FH + 0.32, 0.05); field.add(hud);
  const title = K.text({ w: 6, h: 1.5, size: 0.66 }); title.position.set(0, 0.55, 0.05); field.add(title);
  const startB = K.button({ text: () => (G.state === 'done' ? 'Play again' : 'Start'), x: -0.8, y: -0.75, w: 1.5, h: 0.48, tone: 'accent', onPress: start, visible: () => G.state !== 'play' });
  const modeB = K.button({ text: () => (G.hover ? 'Catch: Hover' : 'Catch: Trigger'), x: 0.9, y: -0.75, w: 1.7, h: 0.48, onPress: () => setHover(!G.hover), visible: () => G.state !== 'play' });
  function setHover(v) { G.hover = v; try { localStorage.setItem('oortia-starcatch-hover', v ? '1' : '0'); } catch (e) { /* */ } K.refreshButtons(); K.menu.refresh(); }
  function showTitle() {
    title.visible = true;
    if (G.state === 'title') title.set('Star Catcher\nCatch the stars as they fall.\nBest: ' + K.best('starcatch'));
    else title.set(`You caught ${G.caught} stars\nScore ${G.score}   ·   Best ${K.best('starcatch', G.score)}`);
    hud.set(''); K.refreshButtons();
  }

  // ---------- stars ----------
  const stars = [];
  const headGeo = new THREE.SphereGeometry(0.09, 16, 12);
  const dwellGeo = new THREE.RingGeometry(0.2, 0.26, 40, 1, 0, Math.PI * 2);
  function spawn() {
    const gold = Math.random() < 0.12;
    const fromLeft = Math.random() < 0.5;
    const x0 = (fromLeft ? -1 : 1) * (FW * (0.4 + Math.random() * 0.7)), y0 = FH * (0.6 + Math.random() * 0.5);
    const ang = (fromLeft ? -1 : 1) * (0.35 + Math.random() * 0.45);
    const speed = 0.75 + Math.random() * 0.6 + Math.min(0.5, G.time / ROUND * 0.5);
    const v = new THREE.Vector2(fromLeft ? Math.cos(ang) : -Math.cos(ang), -Math.abs(Math.sin(ang)) - 0.25).normalize().multiplyScalar(speed);
    const col = gold ? new THREE.Color(2.4, 1.7, 0.55) : new THREE.Color(1.7, 1.75, 2.2);
    const g = new THREE.Group();
    const head = new THREE.Mesh(headGeo, new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
    const halo = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), new THREE.MeshBasicMaterial({ color: gold ? 0xffc870 : 0xaac4ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
    const trail = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.16), new THREE.MeshBasicMaterial({ map: trailTex, color: gold ? 0xffd890 : 0xd8e4ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    trail.position.x = -0.7; const tg = new THREE.Group(); tg.add(trail); tg.rotation.z = Math.atan2(v.y, v.x);
    const dwell = new THREE.Mesh(dwellGeo, new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.9, depthWrite: false }));
    dwell.visible = false;
    g.add(tg, halo, head, dwell); g.position.set(x0, y0, 0); field.add(g);
    stars.push({ g, v, gold, dwell, dwellT: 0, life: 0, alpha: 0, halo, trail, head });
  }
  function remove(s) { field.remove(s.g); s.g.traverse((o) => { if (o.material) o.material.dispose(); if (o.geometry && o.geometry !== headGeo && o.geometry !== dwellGeo) o.geometry.dispose(); }); stars.splice(stars.indexOf(s), 1); }

  // ---------- bursts ----------
  const bursts = [];
  function burst(x, y, gold) {
    const n = 26, pos = new Float32Array(n * 3), vel = [];
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.4; vel.push(Math.cos(a) * sp, Math.sin(a) * sp); pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = 0.04; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.09, color: gold ? 0xffd080 : 0xe0eaff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    field.add(pts); bursts.push({ pts, vel, t: 0 });
  }

  function catchStar(s, aim) {
    const pts = s.gold ? 3 : 1; G.score += pts + Math.min(4, Math.floor(G.combo / 5)); G.caught++; G.combo++;
    sfx.bell(Math.min(14, G.combo + 3), { vol: 0.11, dur: 1.8 }); if (s.gold) sfx.bell(Math.min(16, G.combo + 6), { vol: 0.07, at: 0.08, dur: 2 });
    K.buzz(aim); burst(s.g.position.x, s.g.position.y, s.gold); remove(s);
    if (G.combo > 0 && G.combo % 10 === 0) K.toast(`${G.combo} in a row ✦`);
  }
  K.onPress((a) => {
    if (G.state !== 'play' || G.hover) return;
    let best = null, bd = a.kind === 'touch' ? 0.7 : 0.5;
    for (const s of stars) { const d = Math.hypot(a.x - s.g.position.x, a.y - s.g.position.y); if (d < bd) { bd = d; best = s; } }
    if (best) catchStar(best, a); else sfx.soft();
  });

  function start() {
    for (const s of stars.slice()) remove(s);
    G.state = 'play'; G.time = 0; G.score = 0; G.combo = 0; G.caught = 0; G.spawnIn = 0.6;
    title.visible = false; K.refreshButtons(); sfx.chord([0, 2, 4], { vol: 0.07 });
  }
  function finish() { G.state = 'done'; sfx.chord([4, 2, 0, 5], { vol: 0.07, spread: 0.18 }); showTitle(); }

  // ambient: a few slow stars even on the title screen
  K.tick((dt) => {
    if (G.state === 'play') {
      G.time += dt; if (G.time >= ROUND) finish();
      hud.set(`★ ${G.score}     ${Math.max(0, Math.ceil(ROUND - G.time))}s`);
    }
    G.spawnIn -= dt;
    if (G.spawnIn <= 0) {
      if (G.state === 'play') { spawn(); G.spawnIn = 1.15 + Math.random() * 1.0 - Math.min(0.45, G.time / ROUND * 0.45); }
      else { if (stars.length < 2 && !K.paused) spawn(); G.spawnIn = 3.5; }
    }
    for (const s of stars.slice()) {
      const slow = G.state === 'play' ? 1 : 0.6;
      s.g.position.x += s.v.x * dt * slow; s.g.position.y += s.v.y * dt * slow; s.life += dt;
      s.alpha = Math.min(1, s.life / 0.5);
      s.trail.material.opacity = s.alpha; s.head.scale.setScalar(0.8 + 0.2 * Math.sin(s.life * 9));
      if (G.state === 'play' && G.hover) {
        const near = K.aims.some((a) => a.onField && Math.hypot(a.x - s.g.position.x, a.y - s.g.position.y) < 0.42);
        s.dwellT = near ? s.dwellT + dt : Math.max(0, s.dwellT - dt * 2);
        s.dwell.visible = s.dwellT > 0.02; s.dwell.scale.setScalar(1.6 - Math.min(1, s.dwellT / 0.45) * 0.6);
        s.dwell.material.opacity = 0.35 + 0.6 * Math.min(1, s.dwellT / 0.45);
        if (s.dwellT >= 0.45) { catchStar(s, K.aims.find((a) => a.onField)); continue; }
      }
      const p = s.g.position;
      if (p.y < -FH - 0.4 || Math.abs(p.x) > FW + 0.8) { if (G.state === 'play') G.combo = 0; remove(s); }
    }
    for (const b of bursts.slice()) {
      b.t += dt; const a = b.pts.geometry.attributes.position;
      for (let i = 0; i < b.vel.length / 2; i++) { a.array[i * 3] += b.vel[i * 2] * dt; a.array[i * 3 + 1] += b.vel[i * 2 + 1] * dt; b.vel[i * 2 + 1] -= 0.4 * dt; }
      a.needsUpdate = true; b.pts.material.opacity = Math.max(0, 1 - b.t / 0.9);
      if (b.t > 0.9) { field.remove(b.pts); b.pts.geometry.dispose(); b.pts.material.dispose(); bursts.splice(bursts.indexOf(b), 1); }
    }
  });

  showTitle();
  K.start();
}
