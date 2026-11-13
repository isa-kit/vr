// Infinity Lights — fly through an endless field of crisp, glowing lights.
// Fully immersive by default (one Enter VR button; passthrough is an opt-in toggle
// in the options menu). Options menu: left-controller wrist menu in VR, overlay on desktop.

import * as THREE from 'three';
import { detectXR, createXRMenu, recenterRig, choiceGrid, stepperRow, buttonRow, sectionRow } from '../shared/xrmenu.js';
import { createToolkit } from '../shared/xrtools.js';
import { beautify, SHADER_TAIL } from '../shared/beauty.js';

let fx, nebula;   // post-processing + nebula backdrop

const BG = 0x000006;

// deep-space backdrop: a small sphere that travels with the player, drawn first
function buildNebula() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vD;
      void main(){
        vec3 d = normalize(vD);
        vec3 col = mix(vec3(0.0015,0.001,0.005), vec3(0.003,0.004,0.014), d.y*0.5+0.5);
        float n = sin(d.x*3.1+d.y*1.7)*sin(d.z*2.3-d.y*2.9)*0.5+0.5;
        float m = sin(d.x*5.7-d.z*4.1+1.3)*sin(d.y*3.3+d.x*1.1)*0.5+0.5;
        col += vec3(0.022,0.005,0.03)*pow(n,3.0) + vec3(0.004,0.012,0.028)*pow(m,4.0);
        gl_FragColor = vec4(col,1.0);
        ${SHADER_TAIL}
      }`,
  });
  nebula = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), mat);
  nebula.renderOrder = -1;
  nebula.frustumCulled = false;
  dolly.add(nebula);
}

// ---------- tunables ----------
const MAX_LIGHTS = 8000;    // buffer capacity; active count follows spacing/depth
const MOVE_SPEED = 18;
const BOOST      = 4;
const LOOK_SPEED = 0.0025;
const SPEEDS = [0.25, 0.5, 1, 2, 3];

// user-driven params (menu writes these, then regenerates)
const params = {
  pattern: 'random',   // random | grid | diagonal | jitter
  spacing: 8,          // world units between lattice points  (4..30)
  depth:   120,        // size of the field cube / draw distance (50..240)
  seed:    20261111,
};
let speedIdx = 2;

// ---------- state ----------
let scene, camera, renderer, dolly, points, geometry, lightMat, menu, caps, kit, wand, gridCount = 0;
let basePositions;                 // Float32Array, length MAX_LIGHTS*3
let activeCount = 0;
const keys = {};
let yaw = 0, pitch = 0, pointerLocked = false;
const clock = new THREE.Clock();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();

// Defaults come from the engine-agnostic scene config; built-in values above
// are the fallback if the fetch fails (e.g. opened as a bare file://).
Promise.all([loadConfig(), detectXR()]).then(([, c]) => { caps = c; init(); });

async function loadConfig() {
  try {
    const cfg = await (await fetch('../scenes/infinity.json', { cache: 'no-store' })).json();
    const f = cfg.field || {};
    if (f.pattern) params.pattern = f.pattern;
    if (f.spacing) params.spacing = f.spacing;
    if (f.depth)   params.depth   = f.depth;
  } catch (e) { /* keep built-in defaults */ }
}

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);

  camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, params.depth * 1.6);

  // Only ask for an alpha canvas when passthrough could actually be toggled on.
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: caps.ar });
  if (caps.ar) renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  // A "dolly" moves the player; the headset controls the camera inside it.
  dolly = new THREE.Group();
  dolly.add(camera);
  scene.add(dolly);

  // crisp points: tight core, small halo → far less bloom needed
  fx = beautify(renderer, scene, camera, { exposure: 1.0, bloom: 0.3, radius: 0.18, threshold: 0.88 });
  buildNebula();
  buildLights();

  menu = createXRMenu({
    renderer, camera, dolly, caps,
    title: 'Infinity Lights',
    hint: 'Click the view to fly · WASD move · Q/E down/up · Shift boost · 1–4 patterns · R randomize · F plant a light · Esc/M menu. In VR: grip the light wand, trigger plants lights.',
    rows: [
      sectionRow('Pattern'),
      choiceGrid([['Random', 'random'], ['Grid', 'grid'], ['Diagonal', 'diagonal'], ['Jitter', 'jitter']],
        () => params.pattern, setPattern, 2),
      stepperRow('Spacing', () => params.spacing, () => bump('spacing', -1), () => bump('spacing', 1)),
      stepperRow('Depth', () => params.depth, () => bump('depth', -1), () => bump('depth', 1)),
      stepperRow('Speed', () => '×' + SPEEDS[speedIdx], () => { speedIdx = Math.max(0, speedIdx - 1); }, () => { speedIdx = Math.min(SPEEDS.length - 1, speedIdx + 1); }),
      buttonRow('⟳  Randomize', randomize, 'accent'),
      buttonRow('Clear wand lights', () => generatePattern()),
    ],
    sound: { get: () => soundOn, set: setSound },
    setBackdrop,
    recenter,
    onBeforeEnter: startAudio,
  });

  kit = createToolkit({ renderer, scene, dolly, camera, menu });
  buildWand();
  generatePattern();

  renderer.xr.addEventListener('sessionstart', startAudio);

  addEventListener('resize', onResize);
  addEventListener('keydown', (e) => { keys[e.code] = true; onKey(e); });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('click', onClick);
  document.addEventListener('pointerlockchange',
    () => { pointerLocked = document.pointerLockElement === renderer.domElement; });

  renderer.setAnimationLoop(animate);
}

// passthrough on = hide the opaque backdrop (lights then float in the room)
function setBackdrop(visible) {
  scene.background = visible ? new THREE.Color(BG) : null;
  nebula.visible = visible;
}

function recenter() {
  if (renderer.xr.isPresenting) recenterRig(dolly, camera, new THREE.Vector3(0, dolly.position.y, 0), 0);
  else { dolly.position.set(0, 0, 0); yaw = 0; pitch = 0; camera.rotation.set(0, 0, 0); }
}

// ---------- lights ----------
function buildLights() {
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_LIGHTS * 3), 3));
  geometry.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(MAX_LIGHTS * 3), 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAX_LIGHTS), 1));
  basePositions = new Float32Array(MAX_LIGHTS * 3);

  // Procedural point: a hard-edged bright core + a small soft halo. Point size is
  // angular (world size / distance) with a pixel floor so far lights stay crisp dots.
  lightMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uHalfH: { value: 500 },    // half the eye-buffer height in px
      uMin: { value: 3.0 },
      uMax: { value: 150.0 },
      uHalf: { value: params.depth * 0.5 },
      uTime: { value: 0 },
    },
    vertexShader: `
      attribute vec3 aCol; attribute float aSize;
      uniform float uHalfH, uMin, uMax, uHalf, uTime;
      varying vec3 vCol; varying float vA; varying float vS;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float dist = max(-mv.z, 0.01);
        float px = aSize * projectionMatrix[1][1] * uHalfH / dist;
        float s = clamp(px, uMin, uMax);
        vec3 d = abs(position - cameraPosition) / uHalf;
        float edge = max(d.x, max(d.y, d.z));
        float fade = 1.0 - smoothstep(0.7, 1.0, edge);
        float tw = 0.9 + 0.1 * sin(uTime * 1.4 + aSize * 41.0 + position.x * 0.7);
        vCol = aCol; vS = s;
        vA = fade * tw * clamp(px / uMin, 0.4, 1.0);
        gl_PointSize = s;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vCol; varying float vA; varying float vS;
      void main(){
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float d = length(p);
        float rpx = 0.5 * vS;                       // radius in px
        float coreR = clamp(max(0.17, 1.3 / rpx), 0.0, 1.0);
        float aa = 1.0 / rpx;
        float core = 1.0 - smoothstep(coreR - aa, coreR + aa, d);
        float halo = exp(-d * d * 10.0) * (1.0 - smoothstep(0.8, 1.0, d));
        vec3 c = mix(vCol, vec3(1.0), 0.5) * core * 1.9 + vCol * halo * 0.3;
        gl_FragColor = vec4(c, vA);
        ${SHADER_TAIL}
      }`,
  });

  points = new THREE.Points(geometry, lightMat);
  points.frustumCulled = false;   // positions are rewritten around the camera each frame
  scene.add(points);
}

function eyeBufferHalfHeight() {
  if (renderer.xr.isPresenting) {
    try {
      const l = renderer.xr.getBaseLayer();
      const h = l && (l.framebufferHeight || l.textureHeight);
      if (h) return h * 0.5;
    } catch (e) { /* fall through */ }
    return 800;
  }
  return renderer.getDrawingBufferSize(new THREE.Vector2()).y * 0.5;
}

function generatePattern() {
  const depth = params.depth;
  const S = params.spacing;
  let n = Math.round(depth / S);
  n = Math.max(3, Math.min(20, n));
  const step = depth / n;                    // keeps lattice period == wrap period (seamless)
  activeCount = Math.min(n * n * n, MAX_LIGHTS);
  gridCount = activeCount;
  geometry.setDrawRange(0, activeCount);
  lightMat.uniforms.uHalf.value = depth * 0.5;

  const col = geometry.getAttribute('aCol');
  const siz = geometry.getAttribute('aSize');
  const rng = mulberry32(params.seed);
  const tint = new THREE.Color();

  for (let i = 0; i < activeCount; i++) {
    const ix = i % n;
    const iy = Math.floor(i / n) % n;
    const iz = Math.floor(i / (n * n)) % n;
    let x, y, z;

    if (params.pattern === 'grid') {
      x = ix * step; y = iy * step; z = iz * step;
    } else if (params.pattern === 'diagonal') {
      x = (ix * step + (iy + iz) * step * 0.5) % depth; y = iy * step; z = iz * step;
    } else if (params.pattern === 'jitter') {
      x = ix * step + (rng() - 0.5) * step * 0.8;
      y = iy * step + (rng() - 0.5) * step * 0.8;
      z = iz * step + (rng() - 0.5) * step * 0.8;
    } else { // random
      x = rng() * depth; y = rng() * depth; z = rng() * depth;
    }

    basePositions[i * 3] = x;
    basePositions[i * 3 + 1] = y;
    basePositions[i * 3 + 2] = z;

    // jewel-tone palette: mostly gold/amber, with rose, violet, cyan and a few white stars
    const pick = rng();
    const hue = pick < 0.4 ? 0.08 + rng() * 0.05
              : pick < 0.6 ? 0.93 + rng() * 0.05
              : pick < 0.8 ? 0.72 + rng() * 0.06
              : pick < 0.95 ? 0.50 + rng() * 0.05
              : 0.12;
    const sat = pick < 0.95 ? 0.75 + rng() * 0.25 : 0.15;
    tint.setHSL(hue % 1, sat, 0.58);
    col.array[i * 3] = tint.r;
    col.array[i * 3 + 1] = tint.g;
    col.array[i * 3 + 2] = tint.b;
    siz.array[i] = 0.85 + rng() * 0.75;
  }
  col.needsUpdate = true;
  siz.needsUpdate = true;
  updatePositions();
}

// Wrap every light into a depth-sized cube centred on the camera -> feels infinite.
function updatePositions() {
  const pos = geometry.getAttribute('position');
  camera.getWorldPosition(_p);
  const FS = params.depth;
  const h = FS * 0.5;
  const arr = pos.array;
  for (let i = 0; i < activeCount; i++) {
    arr[i * 3]     = _p.x + wrap(basePositions[i * 3]     - _p.x + h, FS) - h;
    arr[i * 3 + 1] = _p.y + wrap(basePositions[i * 3 + 1] - _p.y + h, FS) - h;
    arr[i * 3 + 2] = _p.z + wrap(basePositions[i * 3 + 2] - _p.z + h, FS) - h;
  }
  pos.needsUpdate = true;
}

// ---------- light wand (grab with grip, trigger plants lights at its tip) ----------
const _tip = new THREE.Vector3();
function jewelColor(c, i) {
  const hues = [0.09, 0.95, 0.74, 0.52, 0.12], h = hues[(Math.random() * hues.length) | 0];
  const t = new THREE.Color().setHSL(h, 0.8, 0.6); c.array[i * 3] = t.r; c.array[i * 3 + 1] = t.g; c.array[i * 3 + 2] = t.b;
}
function plantLight(pos) {
  if (activeCount >= MAX_LIGHTS) return;
  const i = activeCount++;
  basePositions[i * 3] = pos.x; basePositions[i * 3 + 1] = pos.y; basePositions[i * 3 + 2] = pos.z;
  const col = geometry.getAttribute('aCol'), siz = geometry.getAttribute('aSize');
  jewelColor(col, i); siz.array[i] = 1.2 + Math.random() * 0.5;
  col.needsUpdate = true; siz.needsUpdate = true;
  geometry.setDrawRange(0, activeCount);
}
function buildWand() {
  wand = new THREE.Group();
  const dark = new THREE.MeshBasicMaterial({ color: 0x2c2548, toneMapped: false }), gold = new THREE.MeshBasicMaterial({ color: 0xe0ac4a, toneMapped: false });
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.013, 0.36, 10).rotateX(Math.PI / 2), dark); stick.position.z = -0.18; wand.add(stick);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.004, 6, 14), gold); band.position.z = -0.34; wand.add(band);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.022, 14, 10), new THREE.MeshBasicMaterial({ color: 0xfff1c8, toneMapped: false })); tip.position.z = -0.38; wand.add(tip);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); glow.position.z = -0.38; wand.add(glow);
  const home = new THREE.Vector3(0.34, -0.5, -0.45);
  wand.position.copy(home); wand.rotation.set(0.5, 0, -0.3);
  dolly.add(wand);
  let acc = 0;
  kit.add({
    name: 'Light wand', object: wand, radius: 0.22,
    grip: { pos: new THREE.Vector3(0, 0, -0.04), rot: new THREE.Euler(-0.4, 0, 0) },
    home: 'dolly', homePos: home, homeRot: new THREE.Euler(0.5, 0, -0.3),
    onUse: (i, dt) => { acc += dt; while (acc > 0.1) { acc -= 0.1; wand.localToWorld(_tip.set(0, 0, -0.38)); plantLight(_tip); } if (menu.hapticPulse) menu.hapticPulse(menu.controllers[i]); },
  });
}

// ---------- menu handlers ----------
function setPattern(p) {
  params.pattern = p;
  generatePattern();
}
function bump(which, dir) {
  if (which === 'spacing') {
    params.spacing = clamp(params.spacing + dir * 2, 4, 30);
  } else {
    params.depth = clamp(params.depth + dir * 15, 50, 240);
    camera.far = params.depth * 1.6;
    camera.updateProjectionMatrix();
  }
  generatePattern();
}
function randomize() {
  params.seed = (Math.random() * 1e9) | 0;
  generatePattern();
}

// ---------- ambient sound (soft evolving pad) ----------
let actx = null, master = null, soundOn = true;
function startAudio() {
  if (actx) { if (soundOn && actx.state === 'suspended') actx.resume(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = 0.5;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.4;
    lp.connect(master).connect(actx.destination);
    const lfoF = actx.createOscillator(), lfoG = actx.createGain();
    lfoF.frequency.value = 0.045; lfoG.gain.value = 350; lfoF.connect(lfoG).connect(lp.frequency); lfoF.start();
    [110, 164.81, 220, 277.18, 329.63, 440].forEach((f, k) => {
      for (const det of [-4, 5]) {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = k % 2 ? 'sine' : 'triangle'; o.frequency.value = f; o.detune.value = det;
        g.gain.value = 0.035 / (1 + k * 0.35);
        const t = actx.createOscillator(), tg = actx.createGain();       // slow breathing per voice
        t.frequency.value = 0.03 + Math.random() * 0.06; tg.gain.value = g.gain.value * 0.7;
        t.connect(tg).connect(g.gain); t.start();
        o.connect(g).connect(lp); o.start();
      }
    });
    if (!soundOn) actx.suspend();
  } catch (e) { /* no audio */ }
}
function setSound(v) {
  soundOn = v;
  if (v) startAudio();
  if (actx) (v ? actx.resume() : actx.suspend());
}

// ---------- loop ----------
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  handleMovement(dt);
  updatePositions();
  lightMat.uniforms.uHalfH.value = eyeBufferHalfHeight();
  lightMat.uniforms.uMin.value = renderer.xr.isPresenting ? 3.5 : 2.5 * Math.min(devicePixelRatio, 2);
  lightMat.uniforms.uTime.value = clock.elapsedTime;
  menu.update();
  wand.visible = renderer.xr.isPresenting;
  kit.update(dt);
  fx.render();
}

function handleMovement(dt) {
  const speed = MOVE_SPEED * SPEEDS[speedIdx] * ((keys['ShiftLeft'] || keys['ShiftRight']) ? BOOST : 1);
  const move = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  const right = new THREE.Vector3().crossVectors(fwd, WORLD_UP).normalize();

  if (renderer.xr.isPresenting) {
    const session = renderer.xr.getSession();
    if (session) {
      for (const src of session.inputSources) {
        const gp = src.gamepad;
        if (gp && gp.axes.length >= 4) {
          const ax = gp.axes[2], ay = gp.axes[3];
          if (Math.abs(ax) > 0.15 || Math.abs(ay) > 0.15) {
            move.addScaledVector(fwd, -ay).addScaledVector(right, ax);
          }
        }
      }
    }
  } else {
    if (keys['KeyW']) move.add(fwd);
    if (keys['KeyS']) move.sub(fwd);
    if (keys['KeyD']) move.add(right);
    if (keys['KeyA']) move.sub(right);
    if (keys['KeyE'] || keys['Space']) move.y += 1;
    if (keys['KeyQ']) move.y -= 1;
  }

  if (move.lengthSq() > 0) {
    move.normalize();
    dolly.position.addScaledVector(move, speed * dt);
  }
}

// ---------- input ----------
function onMouseMove(e) {
  if (!pointerLocked) return;
  yaw -= e.movementX * LOOK_SPEED;
  pitch -= e.movementY * LOOK_SPEED;
  pitch = Math.max(-1.4, Math.min(1.4, pitch));
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}

function onClick() {
  if (!renderer.xr.isPresenting) { startAudio(); renderer.domElement.requestPointerLock(); menu.close(); }
}

function onKey(e) {
  if (e.code === 'Digit1') setPattern('random');
  if (e.code === 'Digit2') setPattern('grid');
  if (e.code === 'Digit3') setPattern('diagonal');
  if (e.code === 'Digit4') setPattern('jitter');
  if (e.code === 'KeyR') randomize();
  if (e.code === 'KeyF' && !renderer.xr.isPresenting) { camera.getWorldDirection(_p); camera.getWorldPosition(_tip); plantLight(_tip.addScaledVector(_p, 6)); }
  menu.refresh();
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

// ---------- helpers ----------
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function wrap(v, m) { return ((v % m) + m) % m; }
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
