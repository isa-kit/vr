// ============================ Kite Ribbons — a lie-down VR game (Oortia) ============================
// A kite flies overhead and follows wherever you point (controller, head, mouse, or a finger on the screen).
// Ribbons of rings drift across the sky: fly the kite through them. Nothing ever moves you — only the kite moves.
import * as THREE from 'three';
import { createLieGame } from '../shared/lie.js?v=lie3';

const G = { rings: 0, ribbons: 0, spawnIn: 1.5, ribbonId: 0 };
let K;

Promise.resolve().then(init).catch((e) => { console.error(e); const s = document.getElementById('status'); if (s) s.textContent = 'Could not start: ' + e.message; });

function kiteTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  // the plane is turned 45°, so each edge triangle becomes one quarter of the diamond and the diagonals are the spars
  const q = [['#ff6b6b', 0, 0, 256, 0], ['#ffd166', 256, 0, 256, 256], ['#5b7cfa', 256, 256, 0, 256], ['#4ecdc4', 0, 256, 0, 0]];
  for (const [col, x1, y1, x2, y2] of q) { g.fillStyle = col; g.beginPath(); g.moveTo(128, 128); g.lineTo(x1, y1); g.lineTo(x2, y2); g.closePath(); g.fill(); }
  g.strokeStyle = 'rgba(60,40,30,0.9)'; g.lineWidth = 6; g.beginPath(); g.moveTo(0, 0); g.lineTo(256, 256); g.moveTo(256, 0); g.lineTo(0, 256); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function cloudTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const x = 50 + Math.random() * 156, y = 60 + Math.random() * 30, r = 22 + Math.random() * 30;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
  }
  return new THREE.CanvasTexture(c);
}

async function init() {
  K = await createLieGame({
    title: 'Kite Ribbons', sky: 'day', dragLook: false,
    hint: 'Move the mouse (or drag a finger) to fly the kite through the rings. Esc for menu.',
    rows: [{ label: 'Kite speed', cells: [
      { text: 'Gentle', action: () => (G.fast = false), active: () => !G.fast },
      { text: 'Brisk', action: () => (G.fast = true), active: () => !!G.fast },
    ] }],
  });
  const { field, FW, FH, sfx } = K;

  const hud = K.text({ w: 4.6, h: 0.42, size: 0.58, color: '#ffffff' }); hud.position.set(0, FH + 0.32, 0.05); field.add(hud);
  const drawHud = () => hud.set(`◎ ${G.rings} rings   ·   ${G.ribbons} ribbons   ·   best ${K.best('kitesky')}`);
  drawHud();

  // clouds behind the field
  const cTex = cloudTexture(), clouds = [];
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cTex, transparent: true, opacity: 0.6, depthWrite: false }));
    const sc = 3 + Math.random() * 3; s.scale.set(sc * 2, sc, 1);
    s.position.set((Math.random() * 2 - 1) * (FW + 4), (Math.random() * 2 - 1) * (FH + 2), -3 - Math.random() * 6); field.add(s); clouds.push(s);
  }

  // kite
  const kite = new THREE.Group(); field.add(kite);
  const body = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: kiteTexture(), side: THREE.DoubleSide }));
  body.rotation.z = Math.PI / 4; body.scale.set(1, 1.35, 1); kite.add(body);
  kite.position.set(0, -0.6, 0.2);
  const vel = new THREE.Vector2(), target = new THREE.Vector2(0, -0.6);
  const segGeo = new THREE.PlaneGeometry(1, 1);
  const stringM = new THREE.Mesh(segGeo, new THREE.MeshBasicMaterial({ color: 0xf6f2e8, transparent: true, opacity: 0.7, depthWrite: false })); field.add(stringM);
  const anchor = new THREE.Vector2(0, -FH - 1.4);
  const tail = [], hist = [];
  const bowCols = [0xff6b6b, 0xffd166, 0x4ecdc4, 0x5b7cfa];
  for (let i = 0; i < 9; i++) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.11), new THREE.MeshBasicMaterial({ color: bowCols[i % 4], side: THREE.DoubleSide }));
    field.add(b); tail.push(b);
  }
  for (let i = 0; i < 60; i++) hist.push(kite.position.clone());

  // rings
  const ringGeo = new THREE.TorusGeometry(0.42, 0.045, 10, 40);
  const rings = [];
  function spawnRibbon() {
    const fromLeft = Math.random() < 0.5, n = 3 + Math.floor(Math.random() * 3), y0 = (Math.random() * 1.4 - 0.7) * FH;
    const amp = 0.4 + Math.random() * 0.7, ph = Math.random() * 6, speed = 0.42 + Math.random() * 0.18, id = ++G.ribbonId;
    const hue = Math.random();
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.65, 0.62), emissive: new THREE.Color().setHSL(hue, 0.7, 0.4), emissiveIntensity: 0.35, roughness: 0.4, transparent: true, opacity: 0 }));
      const x = (fromLeft ? -1 : 1) * (FW + 0.8 + i * 1.25);
      m.position.set(x, y0, 0.2); field.add(m);
      rings.push({ m, id, i, n, dir: fromLeft ? 1 : -1, y0, amp, ph, speed, t: 0, got: false, gotT: 0 });
    }
  }
  const ribbonHits = new Map();
  function collect(r) {
    r.got = true; G.rings++; K.best('kitesky', G.rings);
    const c = (ribbonHits.get(r.id) || 0) + 1; ribbonHits.set(r.id, c);
    sfx.bell(c + 1, { vol: 0.09, dur: 1.6 });
    const aim = K.aims.find((a) => a.onField); K.buzz(aim);
    if (c === r.n) { G.ribbons++; sfx.chord([0, 2, 4, 7], { vol: 0.06, spread: 0.11, dur: 2.6 }); K.toast('Whole ribbon ✦', 1.6); }
    drawHud();
  }

  const _a = new THREE.Vector2();
  K.tick((dt, t) => {
    // steer: first aim on the field sets the kite's target
    const aim = K.aims.find((a) => a.onField && (a.kind !== 'touch' || a.down));
    if (aim) target.set(THREE.MathUtils.clamp(aim.x, -FW, FW), THREE.MathUtils.clamp(aim.y, -FH, FH));
    const bob = Math.sin(t * 1.1) * 0.06;
    _a.set(target.x - kite.position.x, target.y + bob - kite.position.y);
    const maxV = G.fast ? 3.4 : 2.2;
    vel.lerp(_a.multiplyScalar(3.2), Math.min(1, dt * 3));
    if (vel.length() > maxV) vel.setLength(maxV);
    kite.position.x += vel.x * dt; kite.position.y += vel.y * dt;
    kite.rotation.z += (-vel.x * 0.18 - kite.rotation.z) * Math.min(1, dt * 4);
    kite.rotation.x = Math.sin(t * 2.3) * 0.08;
    // string + tail
    const kp = kite.position, dx = kp.x - anchor.x, dy = kp.y - anchor.y;
    stringM.position.set((kp.x + anchor.x) / 2, (kp.y + anchor.y) / 2, 0.15); stringM.scale.set(Math.hypot(dx, dy), 0.012, 1); stringM.rotation.z = Math.atan2(dy, dx);
    hist.pop(); hist.unshift(kp.clone().add(new THREE.Vector3(Math.sin(kite.rotation.z) * 0.3, -Math.cos(kite.rotation.z) * 0.3, 0)));
    tail.forEach((b, i) => { const h = hist[(i + 1) * 4]; b.position.set(h.x + Math.sin(t * 3 + i) * 0.03, h.y - i * 0.05, 0.18); b.rotation.z = Math.sin(t * 4 + i * 0.8) * 0.6; });
    // clouds
    if (!K.paused) for (const c of clouds) { c.position.x += 0.08 * dt; if (c.position.x > FW + 7) c.position.x = -FW - 7; }
    // rings
    G.spawnIn -= dt;
    if (G.spawnIn <= 0 && rings.length < 12) { spawnRibbon(); G.spawnIn = 5 + Math.random() * 3; }
    for (const r of rings.slice()) {
      r.t += dt; const p = r.m.position;
      p.x += r.dir * r.speed * dt; p.y = r.y0 + Math.sin(p.x * 0.6 + r.ph) * r.amp;
      r.m.rotation.y = Math.sin(t * 0.7 + r.i) * 0.25;
      if (!r.got) {
        r.m.material.opacity = Math.min(1, r.t / 1.2);
        if (Math.hypot(kp.x - p.x, kp.y - p.y) < 0.36) collect(r);
      } else {
        r.gotT += dt; r.m.scale.setScalar(1 + r.gotT * 1.5); r.m.material.opacity = Math.max(0, 1 - r.gotT / 0.6); r.m.material.emissiveIntensity = 1.5;
      }
      if ((r.got && r.gotT > 0.6) || r.dir * p.x > FW + 1.5) {
        field.remove(r.m); r.m.material.dispose(); rings.splice(rings.indexOf(r), 1);
      }
    }
  });
  K.toast('Point to fly the kite through the rings', 4);
  K.start();
}
