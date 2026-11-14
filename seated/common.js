// Seated-scene toolkit shared by forest/, cliffs/ and beach/.
// Renderer + desktop look-around + VR rig (controller models, rays, wrist menu,
// quit, passthrough) + procedural sky + noise texture + synth-audio kit + birds.
// Everything is procedural: no textures or audio files, no build step.

import * as THREE from 'three';
import { beautify, SHADER_TAIL } from '../shared/beauty.js?v=20261114f';
import { standardChrome, STANDARD, detectXR, recenterRig, sectionRow, toggleRow, choiceGrid } from '../shared/app.js?v=app1';   // menu + comfort + Pause: the app standard (STANDARD.md)
import { createSkyRise } from '../shared/skyrise.js?v=rise11';
import { createTouch } from '../shared/touch.js?v=20261114f';

export { THREE, SHADER_TAIL, sectionRow, toggleRow, choiceGrid };

// ---------------------------------------------------------------- math
export function hash(x, z) { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); }
export function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z, oct = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f); f *= 2; a *= 0.5; } return s; }
export function smoothstep(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
export function rnd(a, b) { return a + Math.random() * (b - a); }
// seeded rng (mulberry32) so layouts are stable between loads
export function rng(seed) { let s = seed >>> 0; return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function paint(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// ---------------------------------------------------------------- textures
// Tileable fbm value-noise, four independent channels (R,G low freq; B mid; A fine).
export function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const R = rng(1234);
  function lattice(n) { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = R(); return a; }
  function pn(lat, n, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % n) + n) % n, x1 = (x0 + 1) % n, y0 = ((yi % n) + n) % n, y1 = (y0 + 1) % n;
    const a = lat[y0 * n + x0], b = lat[y0 * n + x1], c = lat[y1 * n + x0], d = lat[y1 * n + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const bases = [4, 4, 8, 16];
  for (let ch = 0; ch < 4; ch++) {
    const lats = [];
    for (let o = 0; o < 5; o++) lats.push(lattice(bases[ch] << o));
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let s = 0, amp = 0.5, tot = 0;
      for (let o = 0; o < 5; o++) {
        const n = bases[ch] << o;
        s += amp * pn(lats[o], n, (x / size) * n, (y / size) * n); tot += amp; amp *= 0.5;
      }
      let v = s / tot;
      v = Math.min(1, Math.max(0, (v - 0.5) * 2.3 + 0.5));
      data[(y * size + x) * 4 + ch] = v * 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}

export function softTexture(inner = 0.0, size = 128) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d'), h = size / 2;
  const rg = g.createRadialGradient(h, h, size * inner * 0.5, h, h, h);
  rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.35, 'rgba(255,255,255,0.45)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- sky
// GLSL shared by the sky dome and by water shaders (reflections).
export const SKY_GLSL = `
  uniform vec3 uTop, uMid, uHor, uSunDir, uSunCol;
  uniform float uGlow, uAzim;
  vec3 skyGrad(vec3 d) {
    float h = d.y;
    float az = dot(normalize(d.xz + vec2(1e-4)), normalize(uSunDir.xz + vec2(1e-4)));
    float side = (1.0 - smoothstep(-0.25, 0.85, az)) * uAzim;
    vec3 horC = mix(uHor, mix(uHor, uMid, 0.6) * 0.78, side);
    vec3 c = mix(horC, uMid, smoothstep(-0.02, 0.28, h));
    c = mix(c, uTop, smoothstep(0.18, 0.95, h));
    float s = max(dot(d, uSunDir), 0.0);
    c += uSunCol * (pow(s, 5.0) * 0.16 + pow(s, 40.0) * 0.28 + pow(s, 400.0) * 0.5) * uGlow;
    return c;
  }
`;

export function skyUniforms(noiseTex, p = {}) {
  const C = (v) => new THREE.Color(v);
  return {
    uTop: { value: C(p.top ?? 0x2f68b4) }, uMid: { value: C(p.mid ?? 0x8fb6dc) }, uHor: { value: C(p.hor ?? 0xe6dccb) },
    uSunDir: { value: (p.sunDir || new THREE.Vector3(0, 0.3, -1)).clone().normalize() },
    uSunCol: { value: C(p.sunCol ?? 0xfff0d0) }, uGlow: { value: p.glow ?? 1 },
    uSunSize: { value: p.sunSize ?? 0.028 }, uSunGain: { value: p.sunGain ?? 1.6 },
    uCloudLit: { value: C(p.cloudLit ?? 0xffffff) }, uCloudShade: { value: C(p.cloudShade ?? 0xb8c3d4) },
    uCover: { value: p.cover ?? 0.5 }, uCloudScale: { value: p.cloudScale ?? 1.0 },
    uWind: { value: new THREE.Vector2(p.windX ?? 0.004, p.windY ?? 0.0015) },
    uTime: { value: 0 }, uNoise: { value: noiseTex },
    uStars: { value: p.stars ?? 0 }, uAzim: { value: p.azim ?? 0 },
  };
}

export function makeSky(noiseTex, p = {}) {
  const uniforms = skyUniforms(noiseTex, p);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms,
    vertexShader: `varying vec3 vP; void main(){ vP = position; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `
      varying vec3 vP;
      uniform float uSunSize, uSunGain, uCover, uCloudScale, uTime, uStars;
      uniform vec3 uCloudLit, uCloudShade; uniform vec2 uWind; uniform sampler2D uNoise;
      ${SKY_GLSL}
      float cloudDens(vec2 uv){
        float a = texture2D(uNoise, uv * 0.22).r;
        float b = texture2D(uNoise, uv * 0.63 + 3.7).g;
        float c = texture2D(uNoise, uv * 1.9 - 1.3).b;
        return a * 0.56 + b * 0.30 + c * 0.14;
      }
      void main(){
        vec3 d = normalize(vP);
        vec3 col = skyGrad(d);
        float sc = dot(d, uSunDir);
        // sun disc (HDR so desktop bloom catches it)
        col += uSunCol * smoothstep(cos(uSunSize * 1.3), cos(uSunSize), sc) * uSunGain;
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y * 0.9 + 0.1) * 0.5 * uCloudScale + uWind * uTime;
          float dn = cloudDens(uv);
          float cov = smoothstep(1.0 - uCover, 1.0 - uCover + 0.2, dn);
          vec2 sdir = normalize(uSunDir.xz + vec2(1e-4)) * 0.05;
          float dS = cloudDens(uv + sdir);
          float lit = clamp(0.5 + (dn - dS) * 5.5, 0.0, 1.0);
          vec3 cc = mix(uCloudShade, uCloudLit, lit);
          float rim = pow(max(sc, 0.0), 6.0);
          cc += uSunCol * rim * 0.45 * (1.0 - dn * 0.6);
          float fade = smoothstep(0.0, 0.2, d.y);
          col = mix(col, cc, cov * 0.94 * fade);
          if (uStars > 0.001) {
            vec2 su = d.xz / (d.y + 0.3) * 40.0;
            float st = texture2D(uNoise, su * 0.07).a;
            col += vec3(0.8, 0.85, 1.0) * smoothstep(0.95, 1.0, st) * uStars * 0.5 * smoothstep(0.1, 0.5, d.y) * (1.0 - cov);
          }
        }
        gl_FragColor = vec4(col, 1.0);
        ${SHADER_TAIL}
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), mat);
  mesh.renderOrder = -10; mesh.frustumCulled = false;
  return { mesh, uniforms };
}

// ---------------------------------------------------------------- foliage sway
export const windU = { value: 0 };
export function swayMaterial({ k = 0.05, y0 = 1.2, power = 1, lambert = true } = {}) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windU;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 0.21 + instanceMatrix[3].z * 0.17;
      #else
        float ph = 0.0;
      #endif
      float gust = 0.65 + 0.35 * sin(uTime * 0.31 + ph * 0.4);
      float sway = pow(max(0.0, position.y - ${y0.toFixed(2)}), ${power.toFixed(2)}) * ${k.toFixed(5)} * gust;
      transformed.x += sin(uTime * 1.3 + ph) * sway;
      transformed.z += cos(uTime * 1.0 + ph * 1.3) * sway * 0.6;`);
  };
  return m;
}

// ---------------------------------------------------------------- audio kit
export function createAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const master = ctx.createGain(); master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3.5; comp.attack.value = 0.02; comp.release.value = 0.4;
  master.connect(comp); comp.connect(ctx.destination);
  master.gain.setValueAtTime(0, ctx.currentTime); master.gain.linearRampToValueAtTime(0.7, ctx.currentTime + 6);
  const sr = ctx.sampleRate, bufs = {};
  function noiseBuf(kind) {
    if (bufs[kind]) return bufs[kind];
    const len = sr * 4, b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    if (kind === 'white') for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    else if (kind === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
    } else { let l = 0; for (let i = 0; i < len; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; } }
    // crossfade the loop seam
    const f = Math.floor(sr * 0.05);
    for (let i = 0; i < f; i++) { const a = i / f; d[i] = d[i] * a + d[len - f + i] * (1 - a); }
    return (bufs[kind] = b);
  }
  const A = {
    ctx, master,
    noise(kind = 'pink') { const s = ctx.createBufferSource(); s.buffer = noiseBuf(kind); s.loop = true; s.start(0, Math.random() * 3); return s; },
    filter(type, f, q = 0.7) { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; },
    gain(v = 1) { const g = ctx.createGain(); g.gain.value = v; return g; },
    pan(p = 0) { const n = ctx.createStereoPanner(); n.pan.value = p; return n; },
    chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; },
    lfo(param, freq, depth, type = 'sine') {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
      const g = ctx.createGain(); g.gain.value = depth; o.connect(g); g.connect(param); o.start(); return o;
    },
    reverb(sec = 2.6, decay = 2.4) {
      const len = Math.floor(sr * sec), ir = ctx.createBuffer(2, len, sr);
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
      const cv = ctx.createConvolver(); cv.buffer = ir; return cv;
    },
    // schedule fn() at random intervals (seconds); returns nothing, runs for the page lifetime
    every(fn, minS, maxS, firstS = 0.5) {
      const loop = () => { try { fn(); } catch (e) { console.warn('audio event', e); } setTimeout(loop, (minS + Math.random() * (maxS - minS)) * 1000); };
      setTimeout(loop, (firstS + Math.random() * minS * 0.5) * 1000);
    },
    // one-shot synth note.  f = [[tSec, hz], ...] glide points; env: attack/decay
    blip({ f, dur = 0.2, type = 'sine', vol = 0.1, attack = 0.01, dest, pan = 0, vib = 0, vibRate = 40, at = 0 }) {
      const t0 = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f[0][1], t0);
      for (let i = 1; i < f.length; i++) o.frequency.linearRampToValueAtTime(f[i][1], t0 + f[i][0]);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      let last = o.connect(g);
      if (vib) { const v = ctx.createOscillator(), vg = ctx.createGain(); v.frequency.value = vibRate; vg.gain.value = vib; v.connect(vg); vg.connect(o.frequency); v.start(t0); v.stop(t0 + dur + 0.05); }
      if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; last.connect(p); last = p; }
      last.connect(dest || master);
      o.start(t0); o.stop(t0 + dur + 0.05);
    },
    resume() { if (ctx.state === 'suspended') ctx.resume(); },
  };
  return A;
}

// ---------------------------------------------------------------- world / renderer / controls
// Seated worlds: the viewer stays put and looks around.  Desktop: drag / arrow keys.
// VR: headset.  VR chrome (Enter VR button, controller models, rays, wrist menu,
// passthrough toggle, sound, recenter, quit) all comes from ../shared/xrmenu.js.
export async function createWorld(o = {}) {
  const {
    eye = 1.15, fov = 68, far = 2400, startYaw = 0, startPitch = 0,
    pitchMin = -1.35, pitchMax = 1.35, bg = 0x999999, tone = {}, title = 'World',
    maxPixelRatio = 2, rows = [], loading = false,
    lie = {},             // Lying down posture: { story: 'trees'|'sky'|'stars', ceiling, step } — world stays upright, you look up
  } = o;
  const LIE_EYE = 0.3, LIE_PITCH = 1.42;

  // ----- device class: phones get touch UI, no VR/AR button (a phone has no controllers, so entering would strand the user)
  const isHeadsetUA = /OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent);
  const isTouch = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches) && !isHeadsetUA;
  const hint = o.hint || (isTouch ? 'Drag to look around · use Menu for sound, light and quit' : 'Drag to look around · arrow keys also turn · Esc / M opens the menu');
  const helpEl = document.getElementById('help'); if (helpEl) helpEl.textContent = hint;
  const caps = isTouch ? { vr: false, ar: false } : await detectXR();
  const vfovFor = () => {                      // portrait: widen the vertical FOV so the composition still reads
    const a = innerWidth / innerHeight;
    return a >= 1 ? fov : Math.min(100, 2 * Math.atan(Math.tan(56 * Math.PI / 360) / a) * 180 / Math.PI);
  };
  const scene = new THREE.Scene();
  const bgColor = new THREE.Color(bg);
  scene.background = bgColor;
  const camera = new THREE.PerspectiveCamera(vfovFor(), innerWidth / innerHeight, 0.08, far);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: caps.ar, powerPreference: 'high-performance' });
  if (caps.ar) renderer.setClearColor(0x000000, 0);
  let pixelRatio = Math.min(devicePixelRatio, isTouch ? 1.5 : maxPixelRatio);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.xr.enabled = true;
  try { renderer.xr.setReferenceSpaceType('local-floor'); } catch (e) {}   // real-world scale, floor at y = 0
  try { renderer.xr.setFoveation(1); } catch (e) {}
  document.body.appendChild(renderer.domElement);
  const fx = beautify(renderer, scene, camera, { tone: 'neutral', exposure: 1.0, bloom: 0.25, radius: 0.55, threshold: 0.97, ...tone });

  const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
  camera.position.y = eye;

  const W = {
    THREE, scene, camera, renderer, rig, fx, eye, title, caps, bgColor,
    audio: null, startAudio: null, frameFns: [], opaque: [], soundOn: true, world: null, loading,
    // all ambient motion runs on simT, which can be slowed (reduced motion) or frozen (pause / calm)
    reducedMotion: false, timeScale: 1, paused: false, simT: 0,
    onFrame(fn) { W.frameFns.push(fn); },
    yaw: 0, pitch: startPitch + (innerWidth < innerHeight ? 0.12 : 0), startYaw, startPitch, portraitTilt: 0.12, home: new THREE.Vector3(),   // yaw/pitch are the user's look offsets from the seat's facing; portrait tilts up a touch
  };

  // ----- desktop look: drag (mouse / touch / pen), arrow keys, gentle inertia
  const _e = new THREE.Euler();
  let vy = 0, vp = 0, dragging = false, lx = 0, ly = 0;
  const el = renderer.domElement;
  el.style.touchAction = 'none'; el.style.cursor = 'grab';
  el.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; W.startAudio(); if (W.menu) W.menu.close(); });
  el.addEventListener('pointerup', (e) => { dragging = false; el.style.cursor = 'grab'; try { el.releasePointerCapture(e.pointerId); } catch (_) {} });
  el.addEventListener('pointermove', (e) => {
    if (!dragging || renderer.xr.isPresenting) return;
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    const k = e.pointerType === 'touch' ? (camera.fov * Math.PI / 180 / innerHeight) * 1.35 : (camera.fov / 68) * 0.0042;
    // same convention as Nature / Infinity / touch.js: the view follows the finger or mouse (drag right -> look right, drag down -> look down)
    W.yaw -= dx * k; W.pitch -= dy * k; vy = -dx * k * 0.25; vp = -dy * k * 0.25;
  });
  const rmq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  W.reducedMotion = !!(rmq && rmq.matches); if (W.reducedMotion) W.timeScale = 0.3;
  if (rmq && rmq.addEventListener) rmq.addEventListener('change', (e) => { W.reducedMotion = e.matches; W.timeScale = e.matches ? 0.3 : 1; });
  const touch = createTouch({ canvas: renderer.domElement, look: false });   // phone gyro toggle + helpers (touch drag is handled below)
  touch.onChange = () => { if (W.menu) W.menu.refresh(); };
  const keys = {};
  addEventListener('keydown', (e) => { keys[e.code] = true; });
  addEventListener('keyup', (e) => { keys[e.code] = false; });

  // ----- audio (scene provides W.buildAudio(audio)); the menu's Sound row suspends / resumes it
  let audioStarted = false;
  W.startAudio = () => {
    if (!W.soundOn) return;
    if (audioStarted) { W.audio && W.audio.resume(); return; }
    audioStarted = true;
    try { W.audio = createAudio(); W.buildAudio && W.buildAudio(W.audio); } catch (e) { console.warn('audio', e); }
  };
  W.setSound = (v) => {
    W.soundOn = v;
    if (v) W.startAudio();
    if (W.audio) { if (v) W.audio.ctx.resume(); else W.audio.ctx.suspend(); }
  };

  // ----- enter overlay
  const enter = document.getElementById('enter');
  if (enter) enter.addEventListener('click', () => { if (W.loading) return; W.startAudio(); enter.style.opacity = '0'; setTimeout(() => enter.remove(), 600); if (W.menu) W.menu.close(); });

  // ----- recenter / passthrough hooks for the shared menu
  W.recenter = () => {
    if (renderer.xr.isPresenting) recenterRig(rig, camera, new THREE.Vector3(W.home.x, 0, W.home.z), W.startYaw);
    else { W.yaw = 0; W.pitch = W.lying ? LIE_PITCH : W.startPitch + (innerWidth < innerHeight ? W.portraitTilt : 0); vy = vp = 0; }   // yaw is relative to the seat's facing
  };
  // Move the viewer to a new seat (instant; callers wrap it in comfort.fade so it always goes through black, never a glide).
  // yaw: facing in radians (0 = toward -z, + = turn left).  In VR the head is re-aligned to the seat and facing.
  W.setSeat = ({ x, y, z, yaw = 0, pitch = 0, tilt = 0.12 }) => {   // tilt: extra pitch applied in portrait only
    rig.position.set(x, y, z); W.home.copy(rig.position);
    W.startYaw = yaw; W.startPitch = pitch; W.portraitTilt = tilt; vy = vp = 0;
    W.yaw = 0; W.pitch = W.lying ? LIE_PITCH : pitch + (innerWidth < innerHeight ? tilt : 0);
    if (W.rise) { W.rise.height = 0; W.rise.floating = 0; W.rise.shift.set(0, 0); }
    if (renderer.xr.isPresenting) W.recenter();
  };
  const setBackdrop = (visible) => {          // passthrough ON = hide the whole world so the room shows through
    if (W.world) W.world.visible = visible;
    scene.background = visible ? bgColor : null;
  };

  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.fov = vfovFor(); camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  // ----- loop
  const clock = new THREE.Clock();
  let centered = false, direct = false;
  const DETAIL = [1, 0.6, 0.35, 0.2];
  W.detailFns = [];
  W.start = () => {
    // everything except the rig goes into `world` so passthrough can hide it in one go
    W.home.copy(rig.position);
    W.world = new THREE.Group();
    for (const c of [...scene.children]) if (c !== rig) W.world.add(c);
    scene.add(W.world);
    const menuRows = [...rows];
    const chrome = W.chrome = standardChrome({
      renderer, scene, camera, dolly: rig, caps, title, hint, rows: menuRows, comfortRows: false,
      onQuality: (lv) => {                                           // frame-time governor asks us to cut load
        if (lv >= 1) direct = true;                                  // skip post-processing (bloom) first
        for (const fn of W.detailFns) fn(DETAIL[Math.min(lv, 3)]);   // then thin foliage
      },
      sound: { get: () => W.soundOn, set: W.setSound },
      setBackdrop, recenter: W.recenter, onBeforeEnter: () => W.startAudio(),
    });
    const comfort = W.comfort = chrome.comfort; W.menu = chrome.menu;
    const rise = W.rise = createSkyRise({ THREE, renderer, camera, rig, comfort, getMenu: () => W.menu, parent: W.world, isPaused: () => W.paused, ...lie, home: () => W.home,
      onLying: (on) => { W.lying = on; W.yaw = 0; vy = vp = 0; W.pitch = on ? LIE_PITCH : W.startPitch; if (o.onLying) o.onLying(on);
        try { localStorage.setItem(STANDARD.POSTURE_KEY, on ? 'lying-up' : 'seated'); } catch (e) { /* */ } } });
    menuRows.push(...rise.rows(), ...touch.rows(), ...comfort.rows({ movement: false }));   // standard order: the world's rows, posture / float, phone look, comfort
    W.menu.refresh();
    if (W.wantLie) rise.setLying(true);
    renderer.setAnimationLoop(() => {
      const rdt = Math.min(clock.getDelta(), 0.05);
      W.paused = !!W.comfort.paused;                     // "Pause / calm" from the comfort section of the menu
      const dt = W.paused ? 0 : rdt * W.timeScale; W.simT += dt; const t = W.simT;
      windU.value = t;
      if (!renderer.xr.isPresenting) {
        centered = false;
        const kk = 1.4 * rdt;
        if (keys.ArrowLeft || keys.KeyA) W.yaw += kk; if (keys.ArrowRight || keys.KeyD) W.yaw -= kk;
        if (keys.ArrowUp || keys.KeyW) W.pitch += kk; if (keys.ArrowDown || keys.KeyS) W.pitch -= kk;
        if (!dragging && !W.reducedMotion) { W.yaw += vy; W.pitch += vp; vy *= 0.88; vp *= 0.88; } else if (!dragging) { vy = vp = 0; }
        W.pitch = Math.max(W.lying ? -0.3 : pitchMin, Math.min(W.lying ? 1.56 : pitchMax, W.pitch));
        if (touch.gyro.on) {
          touch.tick(rdt); _e.setFromQuaternion(touch.gyro.quat, 'YXZ');
          // phone gives pitch + heading; dragging still turns the heading. Roll is dropped so the horizon stays level.
          camera.rotation.set(Math.max(W.lying ? -0.3 : pitchMin, Math.min(W.lying ? 1.56 : pitchMax, _e.x)), _e.y + W.yaw + W.startYaw, 0, 'YXZ');
        } else {
          // camera yaw is +left: drag right lowers yaw (look right); drag down lowers pitch (look down); arrow keys: left/up raise them
          camera.rotation.set(W.pitch, W.yaw + W.startYaw, 0, 'YXZ');   // horizon always level; the camera never moves by itself
        }
        camera.position.y = W.lying ? LIE_EYE : eye;
      } else if (!centered) { centered = true; W.recenter(); }  // face the scene on entering VR
      W.menu.update();
      for (const fn of W.frameFns) fn(dt, t);
      W.comfort.update(rdt, { moving: rise.update(rdt), turning: 0 });   // fades, vignette (idle for seated worlds) and the frame-time governor
      if (direct && !renderer.xr.isPresenting) renderer.render(scene, camera); else fx.render();
    });
  };
  W.wantLie = /[?&]lie=1/.test(location.search);   // front-page "Lying up" cards open worlds with ?lie=1 (the card decides, not the last-used posture)
  if (location.hash === '#debug') window.__W = W;   // dev aid: inspect the world from the console
  return W;
}
