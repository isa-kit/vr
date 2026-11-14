// ============================ Lantern Glow — a lie-down VR game (Oortia) ============================
// At dusk, dim paper lanterns drift up past you. Rest your aim on one (or pull the trigger / click / tap) to light it;
// it glows and floats away into the sky, which slowly fills with lights. Three of one colour in a row ring a chord.
import * as THREE from 'three';
import { createLieGame } from '../shared/lie.js?v=lie5';

const PAPER = [
  { name: 'amber', paper: 0xf2b45a, glow: new THREE.Color(1.0, 0.62, 0.22) },
  { name: 'rose', paper: 0xe58aa0, glow: new THREE.Color(1.0, 0.42, 0.52) },
  { name: 'jade', paper: 0x8fd0a8, glow: new THREE.Color(0.45, 1.0, 0.62) },
  { name: 'pearl', paper: 0xf4ead8, glow: new THREE.Color(1.0, 0.86, 0.62) },
];
const DWELL = 0.6, GOAL = 30;
const G = { lit: 0, run: [], spawnIn: 0.5, goalShown: false };
let K;

Promise.resolve().then(init).catch((e) => { console.error(e); const s = document.getElementById('status'); if (s) s.textContent = 'Could not start: ' + e.message; });

function lanternGeo() {
  const pts = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12, y = t * 0.62 - 0.31; pts.push(new THREE.Vector2(0.08 + 0.17 * Math.sin(Math.PI * (0.12 + 0.76 * t)), y)); }
  return new THREE.LatheGeometry(pts, 20);
}
function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
}

async function init() {
  K = await createLieGame({
    title: 'Lantern Glow', sky: 'dusk',
    hint: 'Rest the cursor on a lantern (or click it) to light it. Drag to look around. Esc for menu.',
    rows: [{ label: 'Light by', cells: [
      { text: 'Hover or trigger', action: () => setInstant(false), active: () => !G.instant },
      { text: 'Trigger only', action: () => setInstant(true), active: () => G.instant },
    ] }],
  });
  G.instant = localStorage.getItem('oortia-lanterns-trigger') === '1';
  function setInstant(v) { G.instant = v; try { localStorage.setItem('oortia-lanterns-trigger', v ? '1' : '0'); } catch (e) { /* */ } K.menu.refresh(); }
  const { field, FW, FH, sfx } = K;
  const geo = lanternGeo(), capGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.03, 16), gTex = glowTex();
  const capMat = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.9 });

  const hud = K.text({ w: 4.4, h: 0.42, size: 0.6 }); hud.position.set(0, FH + 0.32, 0.05); field.add(hud);
  const intro = K.text({ w: 6, h: 1.1, size: 0.6 }); intro.position.set(0, 0.2, 0.3); field.add(intro);
  intro.set('Lantern Glow\nRest your aim on a lantern to light it.');
  let introT = 9;
  function drawHud() { hud.set(`🏮 ${G.lit} lit` + (G.lit < GOAL ? `   ·   ${GOAL - G.lit} to a full sky` : `   ·   best evening ${K.best('lanterns')}`)); }
  drawHud();

  const lanterns = [];
  function spawn() {
    const p = PAPER[Math.floor(Math.random() * PAPER.length)];
    const mat = new THREE.MeshStandardMaterial({ color: p.paper, roughness: 0.75, emissive: p.glow.clone(), emissiveIntensity: 0.2, side: THREE.DoubleSide, transparent: true, opacity: 0 });
    const g = new THREE.Group();
    const body = new THREE.Mesh(geo, mat); const cap = new THREE.Mesh(capGeo, capMat); cap.position.y = -0.31;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: gTex, color: p.glow, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(1.3);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.42, 40), new THREE.MeshBasicMaterial({ color: 0xfff3d6, transparent: true, opacity: 0, depthWrite: false }));
    ring.position.z = 0.3;
    g.add(glow, body, cap, ring);
    const x = (Math.random() * 2 - 1) * FW * 0.85;
    g.position.set(x, -FH - 0.6, (Math.random() - 0.5) * 0.6); field.add(g);
    lanterns.push({ g, mat, glow, ring, p, x0: x, ph: Math.random() * 6, vy: 0.32 + Math.random() * 0.14, lit: false, dwell: 0, t: 0, litT: 0 });
  }
  function drop(L) {
    field.remove(L.g); L.mat.dispose(); L.glow.material.dispose(); L.ring.material.dispose(); L.ring.geometry.dispose();
    lanterns.splice(lanterns.indexOf(L), 1);
  }
  function light(L, aim) {
    L.lit = true; L.ring.material.opacity = 0; G.lit++; K.best('lanterns', G.lit);
    sfx.bell(3 + Math.floor(Math.random() * 7), { vol: 0.09, dur: 2.4 }); K.buzz(aim);
    G.run.push(L.p.name); if (G.run.length > 3) G.run.shift();
    if (G.run.length === 3 && G.run.every((n) => n === G.run[0])) { sfx.chord([0, 2, 4, 7], { vol: 0.06, spread: 0.12, dur: 3 }); K.toast(`Three ${L.p.name} lanterns ✦`); G.run = []; }
    if (G.lit === GOAL) { K.toast('The sky is full of lights ✦', 4); sfx.chord([0, 4, 7, 9, 12], { vol: 0.07, spread: 0.2, dur: 4 }); }
    drawHud();
  }
  K.onPress((a) => {
    let best = null, bd = a.kind === 'touch' ? 0.65 : 0.48;
    for (const L of lanterns) if (!L.lit) { const d = Math.hypot(a.x - L.g.position.x, a.y - L.g.position.y); if (d < bd) { bd = d; best = L; } }
    if (best) light(best, a);
  });

  K.tick((dt, t) => {
    if (introT > 0) { introT -= dt; intro.material.opacity = Math.min(1, introT / 1.5); if (introT <= 0) intro.visible = false; }
    G.spawnIn -= dt;
    const unlit = lanterns.filter((L) => !L.lit).length;
    if (G.spawnIn <= 0 && unlit < 7) { spawn(); G.spawnIn = 1.3 + Math.random() * 1.2; }
    const sway = K.paused ? 0 : 1;
    for (const L of lanterns.slice()) {
      L.t += dt; const pos = L.g.position;
      if (!L.lit) {
        pos.y += L.vy * dt; pos.x = L.x0 + Math.sin(L.t * 0.5 + L.ph) * 0.25 * sway;
        L.mat.opacity = Math.min(1, L.t / 1.2) * (pos.y > FH ? Math.max(0, 1 - (pos.y - FH) / 0.8) : 1);
        if (!G.instant) {
          const near = K.aims.some((a) => a.onField && a.kind !== 'touch' && Math.hypot(a.x - pos.x, a.y - pos.y) < 0.42);
          L.dwell = near ? L.dwell + dt : Math.max(0, L.dwell - dt * 1.5);
          L.ring.material.opacity = Math.min(0.9, L.dwell / DWELL); L.ring.scale.setScalar(1.35 - 0.35 * Math.min(1, L.dwell / DWELL));
          L.mat.emissiveIntensity = 0.2 + 0.5 * (L.dwell / DWELL);
          if (L.dwell >= DWELL) { light(L, K.aims.find((a) => a.onField)); continue; }
        }
        if (pos.y > FH + 0.8) drop(L);
      } else {
        L.litT += dt; const k = Math.min(1, L.litT / 0.8);
        L.mat.emissiveIntensity = 0.2 + 1.8 * k; L.glow.material.opacity = 0.75 * k;
        pos.y += (L.vy + 0.15 * k) * dt; pos.z -= 0.55 * k * dt; pos.x += Math.sin(L.t * 0.4 + L.ph) * 0.05 * dt * sway;
        if (pos.z < -30) drop(L);
      }
    }
  });
  K.start();
}
