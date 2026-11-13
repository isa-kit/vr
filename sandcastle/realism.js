// Procedural realism kit for the Sand Castle — everything here is generated from numbers (profiles, noise, parameters).
// No downloaded models or textures. Used by main.js; tiers decide how much of it is switched on.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- tileable value noise + canvas → normal map ----------
function tileNoise(size, freq, R) {
  const lat = new Float32Array(freq * freq); for (let i = 0; i < lat.length; i++) lat[i] = R();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = (y / size) * freq, j0 = Math.floor(v), fy = v - j0, sy = fy * fy * (3 - 2 * fy), j1 = (j0 + 1) % freq;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * freq, i0 = Math.floor(u), fx = u - i0, sx = fx * fx * (3 - 2 * fx), i1 = (i0 + 1) % freq;
      const a = lat[j0 * freq + i0], b = lat[j0 * freq + i1], c = lat[j1 * freq + i0], d = lat[j1 * freq + i1];
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}
function normalTexFromHeight(h, size, strength) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data;
  const H = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = (H(x - 1, y) - H(x + 1, y)) * strength, ny = (H(x, y + 1) - H(x, y - 1)) * strength, nz = 1, l = Math.hypot(nx, ny, nz), k = (y * size + x) * 4;
    d[k] = (nx / l * 0.5 + 0.5) * 255; d[k + 1] = (ny / l * 0.5 + 0.5) * 255; d[k + 2] = (nz / l * 0.5 + 0.5) * 255; d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; return t;
}
function heightFromCanvas(canvas) {
  const s = canvas.width, d = canvas.getContext('2d').getImageData(0, 0, s, s).data, h = new Float32Array(s * s);
  for (let i = 0; i < h.length; i++) h[i] = d[i * 4] / 255;
  return h;
}
const sRGB = (t) => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };

// Fine sand: grain-scale albedo variation + a micro-normal map (grains, tiny ripples) — one 512² tile
export function makeSandTextures() {
  const S = 512, R = rng(77);
  const n1 = tileNoise(S, 24, R), n2 = tileNoise(S, 64, R), n3 = tileNoise(S, 128, R), n4 = tileNoise(S, 256, R);
  const h = new Float32Array(S * S), a = document.createElement('canvas'); a.width = a.height = S;
  const g = a.getContext('2d'), img = g.createImageData(S, S);
  for (let i = 0; i < h.length; i++) {
    const grain = R();
    h[i] = 0.05 * n1[i] + 0.10 * n2[i] + 0.25 * n3[i] + 0.32 * n4[i] + 0.28 * grain;          // mostly grain-scale relief; very little blotchiness
    const v = 0.92 + 0.16 * (0.25 * n2[i] + 0.45 * n3[i] + 0.3 * grain) + (grain > 0.985 ? 0.12 : 0) - (grain < 0.01 ? 0.14 : 0);   // a few bright quartz / dark mineral grains
    const k = i * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.max(0, Math.min(255, v * 232)); img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { albedo: sRGB(new THREE.CanvasTexture(a)), normal: normalTexFromHeight(h, S, 3.2) };
}

// ---------- environment: a procedural sky + sand ground + HDR sun, prefiltered, for believable reflections / ambient ----------
export function makeEnvironment(renderer, sunDir) {
  const s = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(0x3f86d6) }, mid: { value: new THREE.Color(0xcfe3ee) }, bot: { value: new THREE.Color(0xc9b080) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top, mid, bot;
      void main(){ float h = normalize(vP).y;
        vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h, 0.0, 1.0), 0.6)) : mix(mid, bot, smoothstep(0.0, -0.25, h));
        gl_FragColor = vec4(c, 1.0); }`,
  });
  s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(7.5, 6.6, 5.2) }));
  sun.position.copy(sunDir).multiplyScalar(44); s.add(sun);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.02, 0.1, 200).texture;
  pm.dispose();
  return tex;
}

// ---------- lathe helper: profile given as [[radius, y], …] ----------
export const lathe = (pts, seg = 24) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
function vcolor(geo, fn) {
  const p = geo.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) { fn(p.getX(i), p.getY(i), p.getZ(i), col); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo;
}
const M = (o) => new THREE.MeshStandardMaterial(o);

// ---------- woven fabrics ----------
function weaveCanvases(size, drawPattern) {
  const col = document.createElement('canvas'); col.width = col.height = size; drawPattern(col.getContext('2d'), size);
  const hc = document.createElement('canvas'); hc.width = hc.height = size; const g = hc.getContext('2d');
  const step = 4;                                                    // thread pitch in px
  for (let y = 0; y < size; y += step) for (let x = 0; x < size; x += step) {
    const over = ((x / step) + (y / step)) % 2 === 0, v = over ? 0.85 : 0.3;
    g.fillStyle = `rgba(${v * 255},${v * 255},${v * 255},1)`; g.fillRect(x, y, step, step);
    g.fillStyle = 'rgba(255,255,255,0.18)'; if (over) g.fillRect(x, y + 1, step, 1); else g.fillRect(x + 1, y, 1, step);
  }
  const col2 = col.getContext('2d'); col2.globalCompositeOperation = 'multiply'; col2.globalAlpha = 0.28; col2.drawImage(hc, 0, 0); col2.globalAlpha = 1; col2.globalCompositeOperation = 'source-over';
  return { color: col, height: hc };
}
export function makeBlanketTextures() {
  const R = rng(5);
  const { color, height } = weaveCanvases(512, (g, S) => {
    g.fillStyle = '#f6efe4'; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(206,44,52,0.78)'; const sq = S / 8;
    for (let k = 0; k < 8; k += 2) { g.fillRect(k * sq, 0, sq, S); g.fillRect(0, k * sq, S, sq); }
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '90,50,40'},${0.03 + R() * 0.05})`; g.fillRect(R() * S, R() * S, 1 + R() * 3, 1); }   // loose fibres
  });
  const t = sRGB(new THREE.CanvasTexture(color)); t.repeat.set(3.4, 2.7);
  const n = normalTexFromHeight(heightFromCanvas(height), 512, 2.2); n.repeat.copy(t.repeat);
  return { map: t, normalMap: n };
}
function wickerTextures() {
  const S = 256, R = rng(9);
  const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), hc = document.createElement('canvas'); hc.width = hc.height = S; const hg = hc.getContext('2d');
  hg.fillStyle = '#000'; hg.fillRect(0, 0, S, S); g.fillStyle = '#5c3d1e'; g.fillRect(0, 0, S, S);
  const cell = 16;
  for (let r = 0; r < S / cell; r++) for (let q = 0; q < S / cell; q++) {
    const horiz = (r + q) % 2 === 0, x = q * cell, y = r * cell, tone = 150 + R() * 50;
    const grad = horiz ? g.createLinearGradient(0, y, 0, y + cell) : g.createLinearGradient(x, 0, x + cell, 0);
    grad.addColorStop(0, `rgb(${tone + 25},${tone - 20},${tone - 85})`); grad.addColorStop(0.5, `rgb(${tone + 8},${tone - 38},${tone - 100})`); grad.addColorStop(1, `rgb(${tone - 30},${tone - 66},${tone - 120})`);
    g.fillStyle = grad; g.beginPath(); g.roundRect(horiz ? x : x + 2, horiz ? y + 2 : y, horiz ? cell : cell - 4, horiz ? cell - 4 : cell, 4); g.fill();
    const hh = hg.createLinearGradient(horiz ? 0 : x, horiz ? y : 0, horiz ? 0 : x + cell, horiz ? y + cell : 0);
    hh.addColorStop(0, '#444'); hh.addColorStop(0.5, '#fff'); hh.addColorStop(1, '#444'); hg.fillStyle = hh;
    hg.beginPath(); hg.roundRect(horiz ? x : x + 2, horiz ? y + 2 : y, horiz ? cell : cell - 4, horiz ? cell - 4 : cell, 4); hg.fill();
  }
  return { map: sRGB(new THREE.CanvasTexture(c)), normalMap: normalTexFromHeight(heightFromCanvas(hc), S, 4) };
}
// plastic with scuffs, scratches and sand dust → used for the bucket / spade / cup (slight wear)
function wearTexture(baseHex, seed) {
  const S = 256, R = rng(seed), c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 160; i++) { g.strokeStyle = `rgba(${R() < 0.5 ? '255,255,255' : '90,70,50'},${0.10 + R() * 0.25})`; g.lineWidth = 0.5 + R() * 1.2; g.beginPath(); const x = R() * S, y = R() * S, a = R() * 6.28, l = 6 + R() * 26; g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(150,125,85,${0.03 + R() * 0.09})`; g.beginPath(); g.arc(R() * S, R() * S, 0.5 + R() * 2.5, 0, 7); g.fill(); }   // dust
  const t = sRGB(new THREE.CanvasTexture(c)); return t;
}

// ---------- picnic objects (each returns a Group; origin on the surface it rests on) ----------
export function buildBlanket() {
  const tex = makeBlanketTextures();
  const g = new THREE.PlaneGeometry(1.4, 1.1, 70, 55); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, R = rng(3);
  for (let i = 0; i < p.count; i++) {                               // soft folds and a lifted, slightly rumpled edge
    const x = p.getX(i), z = p.getZ(i), e = Math.max(Math.abs(x) / 0.7, Math.abs(z) / 0.55);
    p.setY(i, 0.0085 + Math.sin(x * 9 + z * 4) * 0.0022 + Math.sin(x * 3.1 - z * 7.3) * 0.0026 + Math.pow(e, 6) * 0.004 + R() * 0.0003);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, M({ ...tex, roughness: 0.96, metalness: 0, normalScale: new THREE.Vector2(0.7, 0.7) }));
  m.receiveShadow = true; return m;
}

export function buildBasket() {
  const w = wickerTextures(); for (const t of [w.map, w.normalMap]) t.repeat.set(2.2, 1.1);
  const mat = M({ map: w.map, normalMap: w.normalMap, roughness: 0.85, metalness: 0, normalScale: new THREE.Vector2(1.1, 1.1) });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.17, 0.23, 4, 0.024), mat); body.position.y = 0.085; g.add(body);
  const rim = new THREE.Mesh(new RoundedBoxGeometry(0.352, 0.022, 0.244, 3, 0.011), mat); rim.position.y = 0.176; g.add(rim);
  // two lids, one propped open, with the gingham cloth peeking out
  const lid1 = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.016, 0.232, 3, 0.008), mat); lid1.position.set(-0.088, 0.19, 0); lid1.rotation.z = 0.05; g.add(lid1);
  const lid2 = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.016, 0.232, 3, 0.008), mat); lid2.position.set(0.1, 0.24, 0); lid2.rotation.z = 1.05; g.add(lid2);
  const hand = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.0085, 8, 28, Math.PI), mat); hand.position.set(0, 0.18, 0); hand.rotation.z = 0; hand.scale.set(1, 1.05, 1); hand.rotation.y = Math.PI / 2; g.add(hand);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.15, 12, 8).rotateX(-Math.PI / 2), M({ ...makeBlanketTextures(), roughness: 0.95, side: THREE.DoubleSide }));
  cloth.position.set(-0.02, 0.172, 0); const cp = cloth.geometry.attributes.position; for (let i = 0; i < cp.count; i++) cp.setY(i, Math.sin(cp.getX(i) * 40) * 0.006 + Math.cos(cp.getZ(i) * 30) * 0.005); cloth.geometry.computeVertexNormals(); g.add(cloth);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  return g;
}

export function buildApple(R = Math.random) {
  const g = new THREE.Group();
  const geo = lathe([[0, -0.0345], [0.016, -0.0335], [0.031, -0.023], [0.039, -0.004], [0.039, 0.014], [0.031, 0.030], [0.017, 0.038], [0.006, 0.033], [0.003, 0.027], [0, 0.026]], 20);
  const hue = R();
  vcolor(geo, (x, y, z, c) => { const f = Math.min(1, Math.max(0, (y + 0.034) / 0.07)), side = (Math.atan2(z, x) / 6.283 + 0.5); c.setRGB(0.55 + 0.25 * (1 - f) + 0.2 * hue * side, 0.05 + 0.32 * (1 - f) * side + 0.1 * f, 0.05 + 0.05 * hue); });
  const a = new THREE.Mesh(geo, M({ vertexColors: true, roughness: 0.38, metalness: 0 })); a.position.y = 0.034; g.add(a);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0035, 0.018, 6), M({ color: 0x5a3b1e, roughness: 0.9 })); stem.position.set(0.001, 0.07, 0); stem.rotation.z = 0.2; g.add(stem);
  const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.quadraticCurveTo(0.012, 0.01, 0.03, 0.004); sh.quadraticCurveTo(0.012, -0.008, 0, 0);
  const leaf = new THREE.Mesh(new THREE.ShapeGeometry(sh, 6), M({ color: 0x4a8a34, roughness: 0.6, side: THREE.DoubleSide })); leaf.position.set(0.003, 0.074, 0); leaf.rotation.set(-1.2, 0.5, 0.3); g.add(leaf);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function buildBread() {
  const S = 256, c = document.createElement('canvas'); c.width = S; c.height = S; const g2 = c.getContext('2d'), R = rng(21);
  const gr = g2.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, '#d49a4c'); gr.addColorStop(0.5, '#b97a32'); gr.addColorStop(1, '#8e5a22'); g2.fillStyle = gr; g2.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) { g2.fillStyle = `rgba(${R() < 0.5 ? '255,230,170' : '80,40,10'},${0.05 + R() * 0.1})`; g2.fillRect(R() * S, R() * S, 1 + R() * 3, 1 + R() * 2); }
  for (let k = 0; k < 5; k++) { g2.fillStyle = 'rgba(244,214,150,0.85)'; g2.beginPath(); g2.ellipse(S * (0.12 + k * 0.19), S * 0.3, 14, 40, -0.9, 0, 7); g2.fill(); g2.strokeStyle = 'rgba(100,55,15,0.5)'; g2.lineWidth = 2; g2.stroke(); }
  const t = sRGB(new THREE.CanvasTexture(c));
  const geo = new THREE.CapsuleGeometry(0.034, 0.27, 8, 16); geo.rotateZ(Math.PI / 2); geo.scale(1, 0.8, 0.85);
  const m = new THREE.Mesh(geo, M({ map: t, roughness: 0.82, metalness: 0 })); m.castShadow = true; m.position.y = 0.028;
  const grp = new THREE.Group(); grp.add(m); return grp;
}

export function buildCheese() {
  const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.11, 0); sh.lineTo(0.02, 0.055); sh.lineTo(0, 0.055); sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2 }); geo.translate(-0.05, 0, -0.035);
  const mat = M({ color: 0xf0c64a, roughness: 0.55 });
  const g = new THREE.Group(); const m = new THREE.Mesh(geo, mat); g.add(m);
  const R = rng(4); for (let i = 0; i < 5; i++) { const h = new THREE.Mesh(new THREE.SphereGeometry(0.006 + R() * 0.006, 8, 6), M({ color: 0xc9992a, roughness: 0.7 })); h.position.set(-0.035 + R() * 0.07, 0.008 + R() * 0.03, 0.036 + R() * 0.002); h.scale.z = 0.4; g.add(h); }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return g;
}

export function buildBottle() {
  const g = new THREE.Group();
  const prof = [[0, 0], [0.034, 0], [0.036, 0.008], [0.036, 0.13], [0.03, 0.17], [0.017, 0.205], [0.013, 0.25], [0.0145, 0.262], [0.0145, 0.268], [0.0, 0.268]];
  const glass = new THREE.Mesh(lathe(prof, 28), M({ color: 0x2c6a3c, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.55, envMapIntensity: 1.6, side: THREE.DoubleSide }));
  const liq = new THREE.Mesh(lathe([[0, 0.006], [0.0315, 0.006], [0.0315, 0.12], [0.0, 0.12]], 24), M({ color: 0xe6c64a, roughness: 0.12, transparent: true, opacity: 0.85 }));
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0368, 0.0368, 0.07, 28, 1, true), M({ color: 0xf2ead6, roughness: 0.8 })); label.position.y = 0.065;
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0105, 0.026, 12), M({ color: 0xc89a62, roughness: 0.95 })); cork.position.y = 0.272;
  g.add(glass, liq, label, cork); g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return g;
}

export function buildEnamelCup(tint = 0x2f6fb5) {
  const geo = lathe([[0, 0.003], [0.03, 0.003], [0.034, 0.0], [0.043, 0.082], [0.0445, 0.086], [0.0415, 0.086], [0.0335, 0.01], [0, 0.009]], 24);
  const g = new THREE.Group();
  const body = new THREE.Mesh(geo, M({ color: 0xf4f6f8, roughness: 0.28, metalness: 0.1, side: THREE.DoubleSide }));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0430, 0.0017, 6, 28), M({ color: tint, roughness: 0.3 })); rim.rotation.x = Math.PI / 2; rim.position.y = 0.0855;
  const hdl = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.0045, 6, 14, Math.PI), M({ color: 0xf4f6f8, roughness: 0.28 })); hdl.position.set(0.039, 0.045, 0); hdl.rotation.z = -Math.PI / 2;
  g.add(body, rim, hdl); g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return g;
}

export function buildPlate() {
  const geo = lathe([[0, 0.002], [0.07, 0.002], [0.082, 0.01], [0.1, 0.022], [0.104, 0.021], [0.1, 0.0185], [0.083, 0.007], [0.07, 0], [0, 0]], 40);
  const m = new THREE.Mesh(geo, M({ color: 0xf8f6f0, roughness: 0.25, side: THREE.DoubleSide })); m.castShadow = m.receiveShadow = true; const g = new THREE.Group(); g.add(m); return g;
}

export function buildCupcake() {
  const g = new THREE.Group();
  const paper = new THREE.Mesh(lathe([[0.0, 0], [0.019, 0], [0.03, 0.04], [0.032, 0.042], [0.0, 0.04]], 16), M({ color: 0xe7a1b8, roughness: 0.8, side: THREE.DoubleSide })); g.add(paper);
  for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.026 - i * 0.0065, 0.0095, 8, 18), M({ color: 0xfff1de, roughness: 0.5 })); t.rotation.x = Math.PI / 2; t.position.y = 0.045 + i * 0.011; g.add(t); }
  const cherry = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 10, 8), M({ color: 0xb3162b, roughness: 0.25 })); cherry.position.y = 0.082; g.add(cherry);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return g;
}

export function buildWatermelonSlice() {
  const g = new THREE.Group(), R = rng(8);
  const geo = new THREE.CylinderGeometry(0.11, 0.11, 0.036, 32, 1, false, 0, Math.PI);
  vcolor(geo, (x, y, z, c) => { const r = Math.hypot(x, z) / 0.11; c.setRGB(0.88 - 0.1 * r * r, 0.20 + 0.45 * Math.pow(Math.max(0, r - 0.8) * 5, 1) * 0.3 + 0.1 * r, 0.26 + 0.16 * r); });
  const flesh = new THREE.Mesh(geo, M({ vertexColors: true, roughness: 0.4 }));
  const rind = new THREE.Mesh(new THREE.CylinderGeometry(0.1205, 0.1205, 0.0355, 32, 1, true, 0, Math.PI), M({ color: 0x2f7d3b, roughness: 0.5, side: THREE.DoubleSide }));
  const white = new THREE.Mesh(new THREE.CylinderGeometry(0.1135, 0.1135, 0.0358, 32, 1, true, 0, Math.PI), M({ color: 0xeaf2c8, roughness: 0.6, side: THREE.DoubleSide }));
  g.add(flesh, rind, white);
  for (let i = 0; i < 14; i++) { const a = R() * Math.PI, r = 0.02 + R() * 0.065; const s = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 6, 5), M({ color: 0x1b1410, roughness: 0.4 })); s.scale.set(1, 0.5, 1.8); s.position.set(Math.cos(a) * r, 0.0185, Math.sin(a) * r); s.rotation.y = a; g.add(s); }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return g;
}

export function buildUmbrella() {
  const g = new THREE.Group(), PANELS = 12;
  const profile = []; for (let i = 0; i <= 14; i++) { const t = i / 14; profile.push([0.64 * t + 0.001, 0.30 * (1 - t * t) - 0.02 * t]); }
  let geo = lathe(profile, PANELS * 2).toNonIndexed();
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const panel = Math.floor(((Math.atan2(cz, cx) / (Math.PI * 2) + 1) % 1) * PANELS);
    c.set(panel % 2 ? 0xf7f1e6 : 0xd8362c);
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = c.r; col[(i + k) * 3 + 1] = c.g; col[(i + k) * 3 + 2] = c.b; }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const canopy = new THREE.Mesh(geo, M({ vertexColors: true, roughness: 0.78, side: THREE.DoubleSide })); canopy.position.y = 1.2; g.add(canopy);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 1.32, 10), M({ color: 0xe9e2d2, roughness: 0.5, metalness: 0.3 })); pole.position.y = 0.66; g.add(pole);
  const fin = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), M({ color: 0xd8362c, roughness: 0.4 })); fin.position.y = 1.52; g.add(fin);
  for (let i = 0; i < PANELS; i++) {                              // ribs along the dish
    const a = (i / PANELS) * Math.PI * 2, pts = profile.filter((_, k) => k % 2 === 0).map(([r, y]) => new THREE.Vector3(Math.cos(a) * r, 1.2 + y - 0.004, Math.sin(a) * r));
    const rib = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.0035, 4), M({ color: 0xe9e2d2, roughness: 0.5, metalness: 0.3 })); g.add(rib);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return g;
}

// ---------- hand tools (slight wear: scuffs, scratches, dust) ----------
export function buildBucket() {
  const g = new THREE.Group(), wear = wearTexture(0xe7563f, 31);
  const body = new THREE.Mesh(lathe([[0.0, -0.08], [0.082, -0.08], [0.086, -0.074], [0.1, 0.07], [0.104, 0.078], [0.108, 0.082], [0.104, 0.086], [0.1, 0.081], [0.094, 0.078], [0.078, -0.066], [0.0, -0.066]], 36),
    M({ color: 0xe5493a, map: wear, roughness: 0.42, metalness: 0, side: THREE.DoubleSide }));
  vcolor(body.geometry, (x, y, z, c) => { const dirt = Math.max(0, (-0.02 - y) / 0.06); c.setRGB(1 - 0.18 * dirt, 1 - 0.28 * dirt, 1 - 0.42 * dirt); });
  body.material.vertexColors = true;
  const bead = new THREE.Mesh(new THREE.TorusGeometry(0.106, 0.0055, 8, 40), M({ color: 0xc83c2e, roughness: 0.4 })); bead.rotation.x = Math.PI / 2; bead.position.y = 0.083;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.0065, 8, 32, Math.PI), M({ color: 0xf2eee4, roughness: 0.5 })); handle.position.y = 0.075;
  g.add(body, bead, handle); g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return g;
}
export function buildSpade() {
  const g = new THREE.Group(), wear = wearTexture(0x3f7fd0, 32);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.0125, 0.34, 12).rotateX(Math.PI / 2), M({ color: 0x3a78c6, map: wear, roughness: 0.4 })); shaft.position.z = -0.17; g.add(shaft);
  const grip = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.0095, 8, 20), M({ color: 0x3a78c6, map: wear, roughness: 0.4 })); grip.position.z = 0.012; g.add(grip);
  const sh = new THREE.Shape(); sh.moveTo(-0.032, 0); sh.lineTo(0.032, 0); sh.quadraticCurveTo(0.058, 0.07, 0.04, 0.12); sh.quadraticCurveTo(0, 0.14, -0.04, 0.12); sh.quadraticCurveTo(-0.058, 0.07, -0.032, 0);
  const bg = new THREE.ExtrudeGeometry(sh, { depth: 0.007, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.002, bevelSegments: 2 }); bg.rotateX(Math.PI / 2); bg.translate(0, 0.0035, -0.34);
  vcolor(bg, (x, y, z, c) => { const dirt = Math.max(0, Math.min(1, (z + 0.34) / -0.14)); c.setRGB(1 - 0.25 * dirt, 1 - 0.38 * dirt, 1 - 0.55 * dirt); });
  const blade = new THREE.Mesh(bg, M({ vertexColors: true, color: 0xf0bd35, map: wear, roughness: 0.38 })); g.add(blade);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return g;
}
export function buildCup() {
  const g = new THREE.Group(), wear = wearTexture(0xf4c23a, 33);
  const body = new THREE.Mesh(lathe([[0, -0.034], [0.034, -0.034], [0.038, -0.03], [0.049, 0.034], [0.051, 0.037], [0.0475, 0.037], [0.0455, 0.033], [0.034, -0.026], [0, -0.026]], 28), M({ color: 0xf4c23a, map: wear, roughness: 0.4, side: THREE.DoubleSide }));
  const hdl = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0055, 8, 16, Math.PI), M({ color: 0xf4c23a, roughness: 0.4 })); hdl.position.set(0.049, 0.004, 0); hdl.rotation.z = -Math.PI / 2;
  g.add(body, hdl); g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return g;
}

// ---------- shells + pebbles ----------
export function scallopGeometry() {
  const g = new THREE.SphereGeometry(0.06, 36, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.attributes.position, ribs = 11;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ang = Math.atan2(z, x), k = 1 + 0.07 * Math.cos(ang * ribs) * (y / 0.06 > 0.05 ? 1 : 0);
    p.setXYZ(i, x * k, y * 0.42 * k, z * k * 0.88);
  }
  g.computeVertexNormals(); return g;
}
export function pebbleGeometry() {
  const g = new THREE.IcosahedronGeometry(0.5, 2), p = g.attributes.position, R = rng(14);
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = 1 + 0.13 * Math.sin(x * 7.1 + y * 3.3) * Math.cos(z * 6.2 - y * 2.1) + (R() - 0.5) * 0.02; p.setXYZ(i, x * n, y * n * 0.62, z * n); }
  g.computeVertexNormals(); return g;
}
// instanced pebbles + shells scattered by a placement callback place(x,z) → y or null
export function scatterSmall(parent, { pebbles = 300, shells = 60, area, groundY, avoid }) {
  const R = rng(99), out = new THREE.Group(); parent.add(out);
  const pm = new THREE.InstancedMesh(pebbleGeometry(), M({ roughness: 0.55, color: 0xffffff }), pebbles), sm = new THREE.InstancedMesh(scallopGeometry(), M({ roughness: 0.4, color: 0xffffff }), shells);
  const d = new THREE.Object3D(), c = new THREE.Color();
  const cols = [0x8b857a, 0xa39a8a, 0x6f6a62, 0xb7a98d, 0x7c6f60, 0x9a9ea0, 0xc4b79a];
  let n = 0, tries = 0;
  while (n < pebbles && tries++ < pebbles * 20) {
    const x = area.x0 + R() * (area.x1 - area.x0), z = area.z0 + R() * (area.z1 - area.z0); if (avoid(x, z)) continue;
    const s = 0.018 + Math.pow(R(), 2.2) * 0.07; d.position.set(x, groundY(x, z) + s * 0.18, z); d.rotation.set(R() * 0.5, R() * 6.28, R() * 0.5); d.scale.set(s * (1 + R() * 0.5), s, s * (1 + R() * 0.4)); d.updateMatrix();
    pm.setMatrixAt(n, d.matrix); pm.setColorAt(n, c.set(cols[(R() * cols.length) | 0]).offsetHSL(0, 0, (R() - 0.5) * 0.08)); n++;
  }
  pm.count = n; n = 0; tries = 0; const shellCols = [0xf3d9d0, 0xeabfcb, 0xf0e4d2, 0xf7e7b4, 0xe8c9b0];
  while (n < shells && tries++ < shells * 20) {
    const x = area.x0 + R() * (area.x1 - area.x0), z = area.z0 + R() * (area.z1 - area.z0); if (avoid(x, z)) continue;
    const s = 0.5 + R() * 0.9; d.position.set(x, groundY(x, z) + 0.004, z); d.rotation.set(R() * 0.3 - 0.15, R() * 6.28, R() * 0.3 - 0.15); d.scale.setScalar(s); d.updateMatrix();
    sm.setMatrixAt(n, d.matrix); sm.setColorAt(n, c.set(shellCols[(R() * shellCols.length) | 0])); n++;
  }
  sm.count = n; pm.castShadow = sm.castShadow = true; pm.receiveShadow = true; out.add(pm, sm); return out;
}

// ---------- weathered plank crate + striped towel ----------
export function buildCrate(w, h, d) {
  const S = 256, R = rng(55), c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), hc = document.createElement('canvas'); hc.width = hc.height = S; const hg = hc.getContext('2d');
  hg.fillStyle = '#9a9a9a'; hg.fillRect(0, 0, S, S);
  const planks = 5, ph = S / planks;
  for (let i = 0; i < planks; i++) {
    const tone = 98 + R() * 34; g.fillStyle = `rgb(${tone + 38},${tone + 4},${tone - 34})`; g.fillRect(0, i * ph, S, ph);
    for (let k = 0; k < 70; k++) { g.strokeStyle = `rgba(${R() < 0.5 ? '50,30,14' : '210,170,120'},${0.05 + R() * 0.12})`; g.lineWidth = 0.6 + R(); const y = i * ph + R() * ph; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(S * 0.3, y + (R() - 0.5) * 3, S * 0.6, y + (R() - 0.5) * 3, S, y + (R() - 0.5) * 2); g.stroke(); hg.strokeStyle = `rgba(${R() < 0.5 ? 60 : 200},${R() < 0.5 ? 60 : 200},${R() < 0.5 ? 60 : 200},0.25)`; hg.lineWidth = 1; hg.beginPath(); hg.moveTo(0, y); hg.lineTo(S, y + (R() - 0.5) * 2); hg.stroke(); }
    if (R() < 0.7) { const kx = 30 + R() * (S - 60), ky = i * ph + ph / 2; g.fillStyle = 'rgba(60,35,16,0.55)'; g.beginPath(); g.ellipse(kx, ky, 6, 3.5, 0, 0, 7); g.fill(); hg.fillStyle = 'rgba(40,40,40,0.8)'; hg.beginPath(); hg.ellipse(kx, ky, 6, 3.5, 0, 0, 7); hg.fill(); }
    g.fillStyle = 'rgba(25,14,6,0.85)'; g.fillRect(0, i * ph, S, 2); hg.fillStyle = '#101010'; hg.fillRect(0, i * ph, S, 3);   // gap between boards
    for (const nx of [8, S - 8]) { g.fillStyle = 'rgba(70,70,76,0.9)'; g.beginPath(); g.arc(nx, i * ph + ph / 2, 2.2, 0, 7); g.fill(); }
  }
  const map = sRGB(new THREE.CanvasTexture(c)), nrm = normalTexFromHeight(heightFromCanvas(hc), S, 3.5);
  const mat = M({ map, normalMap: nrm, roughness: 0.88, metalness: 0 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.castShadow = m.receiveShadow = true; return m;
}
export function makeTowelTextures() {
  const { color, height } = weaveCanvases(512, (g, S) => {
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, S, S); const bands = [0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.92]; g.fillStyle = '#2f6fb5';
    bands.forEach((b, i) => { g.fillRect(0, b * S - (i % 2 ? 9 : 16), S, i % 2 ? 18 : 32); });
  });
  const t = sRGB(new THREE.CanvasTexture(color)); t.repeat.set(1, 1);
  const n = normalTexFromHeight(heightFromCanvas(height), 512, 2.2);
  return { map: t, normalMap: n };
}
