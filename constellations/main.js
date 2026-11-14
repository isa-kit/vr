// ============================ Star Stories — a lie-down VR constellation puzzle (Oortia) ============================
// The stars of a real constellation hang overhead among fainter ones. Select a star, then a neighbour, to draw each
// link of the figure. Faint guides can show the way. Finish the figure to hear its chord and read its short story.
import * as THREE from 'three';
import { createLieGame } from '../shared/lie.js?v=lie3';

// star positions are hand-placed approximations (x right, y up, about −1..1); links are index pairs
const SKY = [
  { name: 'Cassiopeia', tag: 'the Queen on her throne', story: 'A bright W that circles the pole star all night.',
    s: [[-1, 0.3], [-0.5, -0.25], [0, 0.1], [0.45, -0.35], [1, 0.15]], l: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  { name: 'The Big Dipper', tag: 'part of the Great Bear', story: 'Follow the two end stars of the bowl to find the North Star.',
    s: [[-1, 0.35], [-0.62, 0.42], [-0.28, 0.36], [0.02, 0.28], [0.06, -0.14], [0.6, -0.2], [0.62, 0.3]], l: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]] },
  { name: 'Lyra', tag: 'the Lyre', story: 'Vega, at its top, is one of the brightest stars of summer nights.',
    s: [[-0.25, 0.85], [0.02, 0.35], [0.42, 0.28], [0.3, -0.35], [-0.08, -0.28]], l: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 1]] },
  { name: 'Cygnus', tag: 'the Swan, or Northern Cross', story: 'A swan flying down the Milky Way, its tail marked by bright Deneb.',
    s: [[0, 1], [0, 0.28], [0, -0.35], [0, -0.95], [-0.45, 0.32], [-0.9, 0.08], [0.45, 0.38], [0.88, 0.6]], l: [[0, 1], [1, 2], [2, 3], [1, 4], [4, 5], [1, 6], [6, 7]] },
  { name: 'Orion', tag: 'the Hunter', story: 'Three stars in a row make his belt; red Betelgeuse marks a shoulder.',
    s: [[-0.5, 0.65], [0.42, 0.58], [-0.05, 0.95], [-0.17, 0], [0, -0.06], [0.17, -0.12], [-0.42, -0.78], [0.5, -0.72]], l: [[0, 2], [2, 1], [0, 3], [1, 5], [3, 4], [4, 5], [3, 6], [5, 7]] },
  { name: 'Leo', tag: 'the Lion', story: 'A backwards question mark forms the lion’s mane, with Regulus at its heart.',
    s: [[-0.6, -0.42], [-0.55, 0.0], [-0.45, 0.35], [-0.6, 0.66], [-0.86, 0.76], [-1.0, 0.55], [0.4, 0.25], [1, 0.0], [0.45, -0.32]], l: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [6, 7], [7, 8], [8, 0]] },
  { name: 'Scorpius', tag: 'the Scorpion', story: 'Red Antares glows at its heart; the tail curls low toward the south.',
    s: [[-0.95, 0.95], [-0.85, 0.55], [-0.62, 0.36], [-0.38, 0.16], [-0.16, -0.24], [0, -0.6], [0.35, -0.82], [0.7, -0.66], [0.82, -0.36], [-1.05, 0.25]], l: [[0, 1], [9, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]] },
  { name: 'Crux', tag: 'the Southern Cross', story: 'The smallest constellation, a guide to south for sailors.',
    s: [[0, 0.9], [0, -0.9], [-0.62, 0.08], [0.55, 0.26], [0.22, -0.2]], l: [[0, 1], [2, 3]] },
];
const KEY = 'oortia-constellations-v1';
const G = { lvl: 0, sel: -1, done: new Set(), complete: false, hover: false, guides: true };
let K;

Promise.resolve().then(init).catch((e) => { console.error(e); const s = document.getElementById('status'); if (s) s.textContent = 'Could not start: ' + e.message; });

async function init() {
  try { Object.assign(G, JSON.parse(localStorage.getItem(KEY) || '{}'), { sel: -1, done: new Set(), complete: false }); } catch (e) { /* */ }
  const saveG = () => { try { localStorage.setItem(KEY, JSON.stringify({ lvl: G.lvl, hover: G.hover, guides: G.guides, solved: G.solved || [] })); } catch (e) { /* */ } };
  G.solved = G.solved || [];
  K = await createLieGame({
    title: 'Star Stories', sky: 'night',
    hint: 'Click a star, then a neighbouring star, to draw each link. Drag to look around. Esc for menu.',
    rows: [
      { label: 'Select by', cells: [{ text: 'Trigger / click', action: () => { G.hover = false; saveG(); }, active: () => !G.hover }, { text: 'Hover', action: () => { G.hover = true; saveG(); }, active: () => G.hover }] },
      { label: 'Guides', cells: [{ text: 'Show', action: () => setGuides(true), active: () => G.guides }, { text: 'Hide', action: () => setGuides(false), active: () => !G.guides }] },
      { label: 'Figure', cells: [{ text: '◀', action: () => go(G.lvl - 1), tone: 'accent' }, { text: () => SKY[G.lvl].name, w: 2 }, { text: '▶', action: () => go(G.lvl + 1), tone: 'accent' }] },
    ],
  });
  const { field, FW, FH, sfx } = K;
  const SX = FW * 0.82, SY = FH * 0.82;

  const hud = K.text({ w: 5, h: 0.42, size: 0.58 }); hud.position.set(0, FH + 0.32, 0.05); field.add(hud);
  const story = K.text({ w: 6.4, h: 0.95, size: 0.56, bg: 'rgba(10,14,34,0.72)' }); story.position.set(0, -FH + 0.6, 0.08); field.add(story); story.visible = false;
  K.button({ text: 'Next figure ▶', x: 0, y: -FH - 0.12, w: 2.0, h: 0.42, tone: 'accent', onPress: () => go(G.lvl + 1), visible: () => G.complete });

  // faint background stars in the field (decor only)
  {
    const pos = []; for (let i = 0; i < 70; i++) pos.push((Math.random() * 2 - 1) * (FW + 0.6), (Math.random() * 2 - 1) * (FH + 0.4), -0.4 - Math.random());
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    field.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.05, color: 0x9fb0e0, transparent: true, opacity: 0.6, depthWrite: false })));
  }

  const group = new THREE.Group(); field.add(group);
  const starGeo = new THREE.SphereGeometry(0.075, 16, 12), haloGeo = new THREE.CircleGeometry(0.2, 24), selGeo = new THREE.RingGeometry(0.2, 0.25, 36);
  const segGeo = new THREE.PlaneGeometry(1, 1);
  function seg(a, b, w, mat) {
    const m = new THREE.Mesh(segGeo, mat); const dx = b.x - a.x, dy = b.y - a.y;
    m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0); m.scale.set(Math.hypot(dx, dy), w, 1); m.rotation.z = Math.atan2(dy, dx);
    return m;
  }
  const guideMat = new THREE.MeshBasicMaterial({ color: 0x8a9fe0, transparent: true, opacity: 0.16, depthWrite: false });
  const lineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 1.05, 0.85), transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
  const rubberMat = new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.35, depthWrite: false });
  let stars = [], guides = [], lines = [], rubber = null, glowT = 0;

  function build() {
    group.clear(); const C = SKY[G.lvl];
    stars = C.s.map(([x, y], i) => {
      const p = new THREE.Vector2(x * SX, y * SY);
      const big = i % 3 === 0;
      const m = new THREE.Mesh(starGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.9), toneMapped: false }));
      const h = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: 0xb8c8ff, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }));
      const r = new THREE.Mesh(selGeo, new THREE.MeshBasicMaterial({ color: 0xffe7b0, transparent: true, opacity: 0, depthWrite: false }));
      m.scale.setScalar(big ? 1.25 : 1); h.position.z = -0.01; r.position.z = 0.02;
      const g = new THREE.Group(); g.add(h, m, r); g.position.set(p.x, p.y, 0.05); group.add(g);
      return { p, g, m, h, r, dwell: 0 };
    });
    guides = C.l.map(([a, b]) => { const m = seg(stars[a].p, stars[b].p, 0.025, guideMat); m.position.z = 0.01; group.add(m); return m; });
    lines = C.l.map(() => null);
    rubber = new THREE.Mesh(segGeo, rubberMat); rubber.visible = false; group.add(rubber);
    G.sel = -1; G.done = new Set(); G.complete = false; story.visible = false; glowT = 0;
    setGuides(G.guides); drawHud(); K.refreshButtons(); K.menu.refresh();
  }
  function setGuides(v) { G.guides = v; saveG(); guides.forEach((m, i) => { m.visible = v && !lines[i]; }); }
  function drawHud() {
    const C = SKY[G.lvl];
    hud.set(G.complete ? `${C.name} — ${C.tag}` : `${C.name}   ·   ${G.done.size} / ${C.l.length} links`);
  }
  function go(i) { G.lvl = (i + SKY.length) % SKY.length; saveG(); build(); K.toast(SKY[G.lvl].name, 1.6); }

  function pick(a) {
    let best = -1, bd = a.kind === 'touch' ? 0.55 : 0.38;
    stars.forEach((s, i) => { const d = Math.hypot(a.x - s.p.x, a.y - s.p.y); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function choose(i, aim) {
    if (G.complete || i < 0) return;
    if (G.sel === i) { G.sel = -1; sfx.soft(); return; }
    if (G.sel < 0) { G.sel = i; sfx.bell(i, { vol: 0.06, dur: 1 }); K.buzz(aim); return; }
    const C = SKY[G.lvl]; const li = C.l.findIndex(([a, b]) => (a === G.sel && b === i) || (b === G.sel && a === i));
    if (li >= 0 && !G.done.has(li)) {
      G.done.add(li); const m = seg(stars[G.sel].p, stars[i].p, 0.045, lineMat); m.position.z = 0.03; group.add(m); lines[li] = m; guides[li].visible = false;
      sfx.bell(G.done.size + 2, { vol: 0.09, dur: 1.8 }); K.buzz(aim);
      if (G.done.size === C.l.length) win();
      else G.sel = i;
    } else { sfx.soft(); G.sel = i; }
    drawHud();
  }
  function win() {
    G.complete = true; G.sel = -1; glowT = 0.001;
    if (!G.solved.includes(G.lvl)) G.solved.push(G.lvl); saveG();
    const C = SKY[G.lvl]; story.set(`${C.name} — ${C.tag}\n${C.story}`); story.visible = true;
    sfx.chord([0, 2, 4, 7, 9, 12], { vol: 0.06, spread: 0.16, dur: 3.5 });
    K.toast(`${G.solved.length} of ${SKY.length} figures found`, 3); drawHud(); K.refreshButtons();
  }
  K.onPress((a) => { if (!G.hover) choose(pick(a), a); });

  K.tick((dt, t) => {
    const aim = K.aims.find((a) => a.onField);
    stars.forEach((s, i) => {
      const hov = aim && pick(aim) === i;
      const selected = G.sel === i;
      s.r.material.opacity += ((selected ? 0.95 : hov ? 0.45 : 0) - s.r.material.opacity) * Math.min(1, dt * 10);
      s.h.material.opacity = 0.2 + (hov ? 0.15 : 0) + (glowT > 0 ? 0.25 * Math.min(1, glowT) : 0);
      if (!K.paused) s.m.scale.setScalar((i % 3 === 0 ? 1.25 : 1) * (1 + 0.06 * Math.sin(t * 1.3 + i * 1.7)));
      if (G.hover && !G.complete) {
        s.dwell = hov && !selected ? s.dwell + dt : 0;
        s.r.scale.setScalar(selected ? 1 : 1.4 - 0.4 * Math.min(1, s.dwell / 0.7));
        if (s.dwell >= 0.7) { s.dwell = -99; choose(i, aim); }
      } else s.r.scale.setScalar(1);
    });
    if (G.sel >= 0 && aim && !G.complete) {
      const a = stars[G.sel].p, dx = aim.x - a.x, dy = aim.y - a.y;
      rubber.visible = true; rubber.position.set((a.x + aim.x) / 2, (a.y + aim.y) / 2, 0.02); rubber.scale.set(Math.hypot(dx, dy), 0.02, 1); rubber.rotation.z = Math.atan2(dy, dx);
    } else rubber.visible = false;
    if (glowT > 0) { glowT += dt; lineMat.opacity = 0.85 + 0.15 * Math.sin(glowT * 2); } else lineMat.opacity = 0.85;
  });

  build();
  K.toast(`${SKY[G.lvl].name} — click a star to begin`, 3.5);
  K.start();
}
