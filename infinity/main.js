// Infinity Lights — fly through an endless field of crisp, glowing lights.
// Fully immersive by default (one Enter VR button; passthrough is an opt-in toggle
// in the options menu). Options menu: left-controller wrist menu in VR, overlay on desktop.

import * as THREE from 'three';
import { detectXR, createXRMenu, recenterRig, choiceGrid, stepperRow, buttonRow, sectionRow, tabRow, inTab, swatchGrid } from '../shared/xrmenu.js?v=20261114h';
import { createToolkit } from '../shared/xrtools.js?v=20261113h';
import { createComfort, rotateRigAboutHead, stickVector } from '../shared/comfort.js?v=20261113h';
import { createTouch } from '../shared/touch.js?v=20261113h';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { beautify, SHADER_TAIL } from '../shared/beauty.js?v=20261113h';
import { createSkyRise } from '../shared/skyrise.js?v=rise8';

let fx, nebula;   // post-processing + nebula backdrop

const bgColor = new THREE.Color(0x03051c);      // follows the theme (set in applyThemeBackdrop)
const nebU = { uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uN: { value: new THREE.Color() }, uM: { value: new THREE.Color() } };

// deep-space backdrop: a small sphere that travels with the player, drawn first; tinted by the colour theme
function buildNebula() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false, uniforms: nebU,
    vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vD; uniform vec3 uA, uB, uN, uM;
      void main(){
        vec3 d = normalize(vD);
        vec3 col = mix(uA, uB, d.y*0.5+0.5);
        float n = sin(d.x*3.1+d.y*1.7)*sin(d.z*2.3-d.y*2.9)*0.5+0.5;
        float m = sin(d.x*5.7-d.z*4.1+1.3)*sin(d.y*3.3+d.x*1.1)*0.5+0.5;
        col += uN*pow(n,3.0) + uM*pow(m,4.0);
        gl_FragColor = vec4(col,1.0);
        ${SHADER_TAIL}
      }`,
  });
  nebula = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), mat);
  nebula.renderOrder = -1;
  nebula.frustumCulled = false;
  dolly.add(nebula);
}

// ---------- colour themes: weighted hue bands (h0..h1, weight, sat range, lightness) + a backdrop hue ----------
const T = (h0, h1, w, s0, s1, l = 0.58) => ({ h0, h1, w, s0, s1, l });
const THEMES = {
  jewel:  { name: 'Jewel',  sw: ['#e9b34e', '#e0607a', '#8a6ae0', '#55c8d8'], bg: 0.70, bands: [T(0.08, 0.13, 0.4, 0.75, 1), T(0.93, 0.98, 0.2, 0.75, 1), T(0.72, 0.78, 0.2, 0.75, 1), T(0.5, 0.55, 0.15, 0.75, 1), T(0.12, 0.12, 0.05, 0.15, 0.15)] },
  gold:   { name: 'Gold', sw: ['#ffcf6b', '#f0a43a', '#ffe9b8', '#d9822b'], bg: 0.07, bands: [T(0.06, 0.12, 0.6, 0.7, 1, 0.6), T(0.1, 0.14, 0.25, 0.5, 0.8, 0.7), T(0.12, 0.12, 0.15, 0.12, 0.2, 0.78)] },
  aurora: { name: 'Aurora', sw: ['#5df0a0', '#3fd6c8', '#8a7cf0', '#c8ffe8'], bg: 0.45, bands: [T(0.33, 0.42, 0.4, 0.7, 1, 0.55), T(0.45, 0.5, 0.3, 0.7, 1, 0.58), T(0.72, 0.8, 0.2, 0.6, 0.9, 0.62), T(0.4, 0.4, 0.1, 0.12, 0.2, 0.8)] },
  ocean:  { name: 'Ocean', sw: ['#3b82f0', '#35c4e0', '#6a6ae0', '#d8f4ff'], bg: 0.60, bands: [T(0.56, 0.62, 0.45, 0.7, 1, 0.58), T(0.47, 0.52, 0.3, 0.7, 1, 0.6), T(0.64, 0.7, 0.15, 0.6, 0.9, 0.6), T(0.55, 0.55, 0.1, 0.1, 0.2, 0.8)] },
  sunset: { name: 'Sunset', sw: ['#ff6f91', '#ff9a4d', '#e04fb5', '#ffcf6b'], bg: 0.93, bands: [T(0.96, 0.99, 0.3, 0.7, 1), T(0.04, 0.08, 0.3, 0.8, 1, 0.6), T(0.86, 0.9, 0.25, 0.6, 0.9, 0.6), T(0.11, 0.13, 0.15, 0.7, 1, 0.65)] },
  candy:  { name: 'Candy', sw: ['#ffb3d1', '#b3e5ff', '#d4ffb3', '#e0c4ff'], bg: 0.80, bands: [T(0, 1, 1, 0.5, 0.65, 0.78)] },
  mono:   { name: 'Mono', sw: ['#ffffff', '#ffe9d0', '#d8e8ff', '#c8c8d0'], bg: 0.62, bands: [T(0.08, 0.1, 0.5, 0.06, 0.1, 0.8), T(0.58, 0.6, 0.5, 0.06, 0.1, 0.8)], bgSat: 0.12 },
  custom: { name: 'Custom', sw: ['#ff4d4d', '#ffd84d', '#4dff88', '#4d88ff'], bg: 0, bands: [] },
};
function bandsFor(id) {
  if (id !== 'custom') return THEMES[id].bands;
  const h = params.hue / 360;
  return [T(h - 0.04, h + 0.04, 0.8, 0.7, 1, 0.58), T(h + 0.45, h + 0.5, 0.08, 0.6, 0.9, 0.62), T(h, h, 0.12, 0.12, 0.2, 0.8)];
}
const bgHueFor = (id) => (id === 'custom' ? params.hue / 360 : THEMES[id].bg);
const _c = new THREE.Color();
function bgTargets(id) {                      // dark, saturated backdrop tints (linear values, like the originals)
  const h = bgHueFor(id), sat = (THEMES[id].bgSat ?? 0.6);
  return {
    a: new THREE.Color().setHSL(h, sat, 0.016), b: new THREE.Color().setHSL((h + 0.03) % 1, sat, 0.022),
    n: new THREE.Color().setHSL((h + 0.1) % 1, sat, 0.030), m: new THREE.Color().setHSL((h + 0.92) % 1, sat, 0.026),
  };
}

// ---------- tunables ----------
const MAX_LIGHTS = 8000;    // buffer capacity; active count follows spacing/depth
const MOVE_SPEED = 14;      // flat screens
const VR_SPEED   = 2.2;     // headset: slow constant drift, no boost
const BOOST      = 2.5;     // flat screens only
const LOOK_SPEED = 0.0025;
const SPEEDS = [0.25, 0.5, 1, 2, 3];

// user-driven params (the menu writes these live; they persist in localStorage)
const DEFAULTS = { pattern: 'random', spacing: 8, depth: 120, density: 1, size: 1, glow: 0.5, bright: 1, twinkle: 0.3,
                   driftSpeed: 0, driftDir: 'toward', theme: 'jewel', hue: 200, still: false, speedIdx: 2, quality: 'auto' };
const params = { ...DEFAULTS, seed: 20261111 };
const STORE = 'oortia-infinity-v1';
function loadSettings() {
  try {
    const o = JSON.parse(localStorage.getItem(STORE) || '{}');
    for (const k of Object.keys(DEFAULTS)) if (typeof o[k] === typeof DEFAULTS[k]) params[k] = o[k];
    if (typeof o.seed === 'number') params.seed = o.seed;
  } catch (e) { /* ignore */ }
  if (!THEMES[params.theme]) params.theme = 'jewel';
  speedIdx = clamp(params.speedIdx, 0, SPEEDS.length - 1); stillMode = !!params.still;
}
function saveSettings() { params.speedIdx = speedIdx; params.still = stillMode; try { localStorage.setItem(STORE, JSON.stringify(params)); } catch (e) { /* private mode */ } }
const PATTERNS = [['Random', 'random'], ['Grid', 'grid'], ['Diagonal', 'diagonal'], ['Jitter', 'jitter'], ['Spiral', 'spiral'], ['Waves', 'waves'], ['Rings', 'rings'], ['Tunnel', 'tunnel']];
const DIRS = { toward: [0, 0, 1], away: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], down: [0, -1, 0], up: [0, 1, 0] };
const DIR_NAMES = [['Toward you', 'toward'], ['Away', 'away'], ['Left', 'left'], ['Right', 'right'], ['Down', 'down'], ['Up', 'up']];
let speedIdx = 2;

// ---------- state ----------
let scene, camera, renderer, dolly, points, geometry, lightMat, menu, caps, kit, wand, gridCount = 0;
let rise = null, lieSpot = { x: 0, y: 0, z: 0 };   // Lying down: lie on the floor and look up into the lights
let comfort, touch, platform, stillMode = false, qualityScale = 1, worldTime = 0, tab = 0;
const drift = new THREE.Vector3();
let basePositions;                 // Float32Array, length MAX_LIGHTS*3
const pickR = new Float32Array(MAX_LIGHTS), jitA = new Float32Array(MAX_LIGHTS), jitB = new Float32Array(MAX_LIGHTS);   // per-light random seeds → colour under any theme
let fromCol = null, toCol = null, themeFade = 1, bgFrom = null, bgTo = null;
let bulbGlass, bulbBase, mirrorPoints, floorMesh, floorRings = [], govLevel = 0, tier = null;
const TIERS = { high: { name: 'High', R: 16, max: 500, maxPx: 150, pr: 2, idx: 0 }, medium: { name: 'Medium', R: 10, max: 220, maxPx: 120, pr: 1.5, idx: 1 }, light: { name: 'Light', R: 7, max: 120, maxPx: 90, pr: 1, idx: 2 } };
const TIER_ORDER = ['high', 'medium', 'light'];
let activeCount = 0;
const keys = {};
let yaw = 0, pitch = 0, pointerLocked = false;
const clock = new THREE.Clock();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();

// Defaults come from the engine-agnostic scene config; built-in values above
// are the fallback if the fetch fails (e.g. opened as a bare file://).
Promise.all([loadConfig(), detectXR()]).then(([, c]) => { caps = c; loadSettings(); init(); });

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
  scene.background = bgColor;

  camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, params.depth * 1.6);

  // Only ask for an alpha canvas when passthrough could actually be toggled on.
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: caps.ar });
  if (caps.ar) renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || matchMedia('(pointer: coarse)').matches ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  // A "dolly" moves the player; the headset controls the camera inside it.
  dolly = new THREE.Group();
  dolly.add(camera);
  scene.add(dolly);

  touch = createTouch({ canvas: renderer.domElement, look: true, stick: true, buttons: [{ id: 'up', label: '▲' }, { id: 'down', label: '▼' }],
    onLook: (dx, dy) => { yaw -= dx * 0.004; pitch = Math.max(-1.4, Math.min(rise && rise.lying ? 1.56 : 1.4, pitch - dy * 0.004)); } });
  { const h = document.getElementById('help'); if (h) h.textContent = touch.helpText('Drag to look · thumb-stick flies · ▲▼ rise & sink · ☰ Menu for options', h.textContent); }
  comfort = createComfort({ renderer, scene, camera, dolly,
    onQuality: (q) => { govLevel = q; qualityScale = [1, 0.8, 0.6, 0.45][q]; applyDraw(); applyTier(); } });
  // crisp points: tight core, small halo → far less bloom needed
  fx = beautify(renderer, scene, camera, { exposure: 1.0, bloom: 0.3, radius: 0.18, threshold: 0.88 });
  buildNebula();
  buildLights();

  const rep10 = { repeat: true };
  const step = (key, d, lo, hi, dec = 2, after) => () => { params[key] = +clamp(params[key] + d, lo, hi).toFixed(dec); if (after) after(); saveSettings(); };
  const regen = () => generatePattern();
  const driftCap = () => 1.0 * [1, 1.6, 2.5][comfort.settings.speed] * (comfort.reducedMotion ? 0.5 : 1);
  rise = createSkyRise({ THREE, renderer, camera, rig: dolly, comfort, getMenu: () => menu, story: 'stars', ceiling: 60, step: 8, home: () => lieSpot,
    onLying: (on) => { if (on) lieSpot = { x: dolly.position.x, y: dolly.position.y, z: dolly.position.z }; pitch = on ? 1.42 : 0; yaw = 0; } });
  menu = createXRMenu({
    renderer, camera, dolly, caps,
    title: 'Infinity Lights',
    compactCommon: true,
    hint: touch.helpText('Drag to look · thumb-stick flies · ▲▼ rise and sink · ☰ for options', 'Click the view to fly · WASD move · Q/E down/up · Shift boost · 1–8 patterns · R randomize · F plant a light · Esc/M menu. In VR: grip the light wand, trigger plants lights.'),
    rows: [
      tabRow(['Pattern', 'Motion', 'Look', 'Theme', 'Comfort'], () => tab, (i) => { tab = i; }),
      // ---- Pattern
      ...inTab([
        ...choiceGrid(PATTERNS, () => params.pattern, setPattern, 4),
        stepperRow('Spacing', () => params.spacing, step('spacing', -2, 4, 30, 0, regen), step('spacing', 2, 4, 30, 0, regen), rep10),
        stepperRow('Depth', () => params.depth, step('depth', -15, 50, 240, 0, () => { camera.far = params.depth * 1.6; camera.updateProjectionMatrix(); regen(); }),
          step('depth', 15, 50, 240, 0, () => { camera.far = params.depth * 1.6; camera.updateProjectionMatrix(); regen(); }), rep10),
        stepperRow('Density', () => Math.round(params.density * 100) + '%', step('density', -0.05, 0.2, 1, 2, regen), step('density', 0.05, 0.2, 1, 2, regen), rep10),
        { cells: [{ text: '⟳ Randomize', action: randomize, tone: 'accent' }, { text: 'Clear wand', action: () => generatePattern() }, { text: 'Reset all', action: resetAll }] },
      ], () => tab === 0),
      // ---- Motion
      ...inTab([
        stepperRow('Drift', () => driftText(), () => { params.driftSpeed = +clamp(params.driftSpeed - 0.1, 0, 2.5).toFixed(1); saveSettings(); },
          () => { params.driftSpeed = +clamp(params.driftSpeed + 0.1, 0, 2.5).toFixed(1); saveSettings(); }, rep10),
        ...choiceGrid(DIR_NAMES, () => params.driftDir, (d) => { params.driftDir = d; saveSettings(); }, 3),
        { label: 'Mode', cells: [
          { text: 'Fly freely', active: () => !stillMode, action: () => { stillMode = false; saveSettings(); } },
          { text: 'Stay still', active: () => stillMode, action: () => { stillMode = true; if (params.driftSpeed === 0) params.driftSpeed = 0.6; saveSettings(); } } ] },
        stepperRow('Fly speed', () => '×' + SPEEDS[speedIdx], () => { speedIdx = Math.max(0, speedIdx - 1); saveSettings(); }, () => { speedIdx = Math.min(SPEEDS.length - 1, speedIdx + 1); saveSettings(); }),
        stepperRow('Twinkle', () => Math.round(params.twinkle * 100) + '%', step('twinkle', -0.1, 0, 1, 1), step('twinkle', 0.1, 0, 1, 1), rep10),
      ], () => tab === 1),
      // ---- Look
      ...inTab([
        stepperRow('Size', () => '×' + params.size.toFixed(1), step('size', -0.1, 0.5, 2, 1), step('size', 0.1, 0.5, 2, 1), rep10),
        stepperRow('Glow', () => Math.round(params.glow * 100) + '%', step('glow', -0.1, 0, 1, 1), step('glow', 0.1, 0, 1, 1), rep10),
        stepperRow('Bright', () => Math.round(params.bright * 100) + '%', step('bright', -0.05, 0.5, 1.25, 2), step('bright', 0.05, 0.5, 1.25, 2), rep10),
        { label: 'Quality', cells: [['Auto', 'auto'], ['High', 'high'], ['Med', 'medium'], ['Light', 'light']].map(([t, id]) => ({ text: t, active: () => params.quality === id, action: () => { params.quality = id; applyTier(); saveSettings(); } })) },
        { cells: [{ text: () => 'Now: ' + tierText() }] },
      ], () => tab === 2),
      // ---- Theme
      ...inTab([
        ...swatchGrid(Object.entries(THEMES).map(([id, t]) => [t.name, id, t.sw]), () => params.theme, setTheme, 4),
        { ...stepperRow('Hue', () => params.hue + '°', () => { params.hue = (params.hue + 350) % 360; if (params.theme === 'custom') applyTheme(); saveSettings(); },
          () => { params.hue = (params.hue + 10) % 360; if (params.theme === 'custom') applyTheme(); saveSettings(); }, rep10), visible: () => params.theme === 'custom' },
      ], () => tab === 3),
      // ---- Comfort
      ...inTab([...rise.rows(), ...comfort.rows({ movement: true, teleport: false, header: false }), ...touch.rows()], () => tab === 4),
    ],
    fade: comfort.fade,
    sound: { get: () => soundOn, set: setSound },
    setBackdrop,
    recenter,
    onBeforeEnter: startAudio,
  });

  comfort.attachMenu(menu); touch.onChange = () => menu.refresh();
  if (/[?&]lie=1/.test(location.search)) rise.setLying(true);   // front-page "Lying down" cards
  kit = createToolkit({ renderer, scene, dolly, camera, menu });
  buildWand();
  buildPlatform();
  generatePattern();
  applyThemeInstant();
  applyLook3();
  applyTier();

  renderer.xr.addEventListener('sessionstart', () => { startAudio(); applyTier(); });
  renderer.xr.addEventListener('sessionend', () => { dolly.rotation.set(0, 0, 0); yaw = 0; pitch = 0; applyTier(); });   // never carry VR rig yaw into flat mode (it would stack on the camera yaw)

  addEventListener('resize', onResize);
  addEventListener('keydown', (e) => { keys[e.code] = true; onKey(e); });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('click', onClick);
  document.addEventListener('pointerlockchange',
    () => { pointerLocked = document.pointerLockElement === renderer.domElement; });

  if (location.hash === '#debug') window.__inf = { dolly, touch, camera, comfort, menu, renderer };
  renderer.setAnimationLoop(animate);
}

// passthrough on = hide the opaque backdrop (lights then float in the room)
function setBackdrop(visible) {
  scene.background = visible ? bgColor : null;
  nebula.visible = visible;
}

function recenter() {
  if (renderer.xr.isPresenting) recenterRig(dolly, camera, new THREE.Vector3(0, dolly.position.y, 0), 0);
  else { dolly.position.set(0, 0, 0); yaw = 0; pitch = 0; camera.rotation.set(0, 0, 0); drift.set(0, 0, 0); }
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
  const U = {
    uHalfH: { value: 500 },    // half the eye-buffer height in px
    uMin: { value: 3.0 }, uMax: { value: 150.0 }, uHalf: { value: params.depth * 0.5 }, uTime: { value: 0 },
    uSize: { value: 1 }, uGlow: { value: 0.5 }, uBright: { value: 1 }, uTw: { value: 0.3 },
    uBulbR: { value: 16 }, uHaze: { value: 1 }, uFloorY: { value: -1.6 }, uFloorR: { value: 6 }, uFloorC: { value: new THREE.Vector2() },
  };
  const vs = `
      attribute vec3 aCol; attribute float aSize;
      uniform float uHalfH, uMin, uMax, uHalf, uTime, uSize, uGlow, uBright, uTw, uBulbR, uHaze, uFloorY, uFloorR;
      uniform vec2 uFloorC;
      varying vec3 vCol; varying float vA; varying float vS; varying float vNear;
      void main(){
        vec3 P = position;
        float vis = 1.0;
        #ifdef MIRROR
          // planar reflection: mirror the light about the floor, and show it only where the reflected ray actually crosses the floor disc
          vis = 0.0;
          if (P.y > uFloorY + 0.05) {
            float h = P.y - uFloorY;
            P.y = 2.0 * uFloorY - P.y;
            float den = P.y - cameraPosition.y;
            if (abs(den) > 1e-4) {
              float t = (uFloorY - cameraPosition.y) / den;
              if (t > 0.0 && t < 1.0) {
                vec3 X = cameraPosition + t * (P - cameraPosition);
                vis = (1.0 - smoothstep(uFloorR * 0.5, uFloorR, length(X.xz - uFloorC))) * 0.5 * (1.0 - smoothstep(8.0, 70.0, h));
              }
            }
          }
        #endif
        vec4 mv = modelViewMatrix * vec4(P, 1.0);
        float dist = max(-mv.z, 0.01);
        float px = aSize * uSize * projectionMatrix[1][1] * uHalfH / dist;
        float s = clamp(px, uMin, uMax);
        vec3 d = abs(position - cameraPosition) / uHalf;
        float edge = max(d.x, max(d.y, d.z));
        float fade = 1.0 - smoothstep(0.7, 1.0, edge);
        // slow, shallow shimmer — rate ≤ ~0.1 Hz and ≤ 12 % depth at the maximum setting, so it can never strobe
        float tw = 1.0 - (0.02 + 0.10 * uTw) * (0.5 + 0.5 * sin(uTime * (0.25 + 0.35 * uTw) + aSize * 41.0 + position.x * 0.31));
        // atmospheric haze: distant lights lose intensity so depth reads
        float haze = mix(1.0, 0.3 + 0.7 * exp(-dist * 0.016), clamp(uHaze, 0.0, 1.0));
        vCol = aCol; vS = s;
        vNear = 1.0 - smoothstep(uBulbR * 0.65, uBulbR, dist);       // near lights are real 3D bulbs: the sprite keeps only its halo
        #ifdef MIRROR
          vNear = 0.0;
        #endif
        vA = fade * tw * haze * vis * clamp(px / uMin, 0.4, 1.0);
        gl_PointSize = s;
        gl_Position = projectionMatrix * mv;
      }`;
  const fs = `
      varying vec3 vCol; varying float vA; varying float vS; varying float vNear;
      uniform float uGlow, uBright;
      void main(){
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float d = length(p);
        float rpx = 0.5 * vS;                       // radius in px
        float coreR = clamp(max(0.17, 1.3 / rpx), 0.0, 1.0);
        float aa = 1.0 / rpx;
        float core = (1.0 - smoothstep(coreR - aa, coreR + aa, d)) * (1.0 - 0.92 * vNear);
        float halo = exp(-d * d * 10.0) * (1.0 - smoothstep(0.8, 1.0, d));
        #ifdef MIRROR
          core *= 0.55; halo *= 1.4;                // a polished (not mirror-perfect) floor: softer, dimmer image
        #endif
        vec3 c = (mix(vCol, vec3(1.0), 0.5) * core * 1.9 + vCol * halo * 0.6 * uGlow) * uBright;
        gl_FragColor = vec4(c, vA);
        ${SHADER_TAIL}
      }`;
  const mk = (defs) => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, uniforms: U, vertexShader: vs, fragmentShader: fs, defines: defs });
  lightMat = mk({});
  const mirrorMat = mk({ MIRROR: 1 });
  mirrorPoints = new THREE.Points(geometry, mirrorMat);
  mirrorPoints.frustumCulled = false; mirrorPoints.renderOrder = 0;
  scene.add(mirrorPoints);
  points = new THREE.Points(geometry, lightMat);
  points.frustumCulled = false;   // positions are rewritten around the camera each frame
  points.renderOrder = 1;
  scene.add(points);
  buildBulbs();
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
  const total = Math.min(n * n * n, MAX_LIGHTS);
  lightMat.uniforms.uHalf.value = depth * 0.5;

  const siz = geometry.getAttribute('aSize');
  const rng = mulberry32(params.seed), rngK = mulberry32(params.seed + 7);
  const TAU = Math.PI * 2;
  let j = 0;

  for (let i = 0; i < total; i++) {
    if (params.density < 0.999 && rngK() > params.density) continue;          // thin the field
    const ix = i % n;
    const iy = Math.floor(i / n) % n;
    const iz = Math.floor(i / (n * n)) % n;
    let x, y, z;

    switch (params.pattern) {
      case 'grid': x = ix * step; y = iy * step; z = iz * step; break;
      case 'diagonal': x = (ix * step + (iy + iz) * step * 0.5) % depth; y = iy * step; z = iz * step; break;
      case 'jitter':
        x = ix * step + (rng() - 0.5) * step * 0.8;
        y = iy * step + (rng() - 0.5) * step * 0.8;
        z = iz * step + (rng() - 0.5) * step * 0.8; break;
      case 'spiral': {                                   // a galaxy: three arms around where you start
        const t = (i + 0.5) / total, arm = i % 3, th = t * 16 + arm * (TAU / 3), r = Math.sqrt(t) * depth * 0.5;
        x = r * Math.cos(th); z = r * Math.sin(th); y = (rng() - 0.5) * depth * 0.28 * (1 - 0.6 * t); break;
      }
      case 'waves':                                      // rippling sheets
        x = ix * step; z = iz * step;
        y = iy * step + Math.sin((x / depth) * Math.PI * 4) * Math.cos((z / depth) * Math.PI * 4) * step * 0.9; break;
      case 'rings': {                                    // concentric rings, stacked in layers
        const r = ((ix + 1) / n) * depth * 0.5, a = (iz / n) * TAU + ix * 0.35;
        x = r * Math.cos(a); z = r * Math.sin(a); y = iy * step; break;
      }
      case 'tunnel': {                                   // twisting rings along the view axis, you start inside
        const r = 3 + (iy % 4) * 1.8, a = (ix / n) * TAU + iz * 0.4;
        x = r * Math.cos(a); y = r * Math.sin(a); z = iz * step; break;
      }
      default: x = rng() * depth; y = rng() * depth; z = rng() * depth;   // random
    }

    basePositions[j * 3] = x;
    basePositions[j * 3 + 1] = y;
    basePositions[j * 3 + 2] = z;
    pickR[j] = rng(); jitA[j] = rng(); jitB[j] = rng();
    siz.array[j] = 0.85 + rng() * 0.75;
    j++;
  }
  activeCount = j;
  gridCount = j;
  applyDraw();
  siz.needsUpdate = true;
  paintTarget(true);                                  // colours for the current theme (no fade on regeneration)
  updatePositions();
}

// colour of light i under the current theme
function themeColor(pick, ja, jb, out) {
  const bands = bandsFor(params.theme);
  let tot = 0; for (const b of bands) tot += b.w;
  let r = pick * tot, band = bands[bands.length - 1];
  for (const b of bands) { if (r < b.w) { band = b; break; } r -= b.w; }
  const h = (((band.h0 + (band.h1 - band.h0) * ja) % 1) + 1) % 1;
  return out.setHSL(h, band.s0 + (band.s1 - band.s0) * jb, band.l);
}
function paintTarget(instant) {
  const col = geometry.getAttribute('aCol');
  if (!toCol || toCol.length !== MAX_LIGHTS * 3) { toCol = new Float32Array(MAX_LIGHTS * 3); fromCol = new Float32Array(MAX_LIGHTS * 3); }
  fromCol.set(col.array);
  for (let i = 0; i < activeCount; i++) {
    themeColor(pickR[i], jitA[i], jitB[i], _c);
    toCol[i * 3] = _c.r; toCol[i * 3 + 1] = _c.g; toCol[i * 3 + 2] = _c.b;
  }
  if (instant) { col.array.set(toCol.subarray(0, activeCount * 3)); col.needsUpdate = true; themeFade = 1; }
  else themeFade = 0;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function tintFloor() { const h = bgHueFor(params.theme); for (const m of floorRings) m.color.setHSL(h, 0.55, 0.62); }
function applyTheme() {                                // short cross-fade of the lights and the backdrop
  tintFloor();
  paintTarget(false);
  const t = bgTargets(params.theme);
  bgFrom = { a: nebU.uA.value.clone(), b: nebU.uB.value.clone(), n: nebU.uN.value.clone(), m: nebU.uM.value.clone() };
  bgTo = t;
}
function applyThemeInstant() {
  tintFloor();
  const t = bgTargets(params.theme);
  nebU.uA.value.copy(t.a); nebU.uB.value.copy(t.b); nebU.uN.value.copy(t.n); nebU.uM.value.copy(t.m);
  bgColor.copy(t.a); bgFrom = bgTo = null; paintTarget(true);
}
function stepTheme(dt) {
  if (themeFade >= 1) return;
  themeFade = Math.min(1, themeFade + dt / 0.9);
  const e = themeFade * themeFade * (3 - 2 * themeFade);
  const col = geometry.getAttribute('aCol'), a = col.array;
  for (let i = 0; i < activeCount * 3; i++) a[i] = fromCol[i] + (toCol[i] - fromCol[i]) * e;
  col.needsUpdate = true;
  if (bgFrom && bgTo) {
    nebU.uA.value.copy(bgFrom.a).lerp(bgTo.a, e); nebU.uB.value.copy(bgFrom.b).lerp(bgTo.b, e);
    nebU.uN.value.copy(bgFrom.n).lerp(bgTo.n, e); nebU.uM.value.copy(bgFrom.m).lerp(bgTo.m, e);
    bgColor.copy(nebU.uA.value);
  }
}
// live look uniforms (size / glow / brightness / twinkle) + bloom strength follows the glow setting
function applyLook3() {
  const u = lightMat.uniforms;
  u.uSize.value = params.size; u.uGlow.value = params.glow; u.uBright.value = Math.min(1.25, params.bright); u.uTw.value = comfort && comfort.reducedMotion ? 0 : params.twinkle;
  if (fx && fx.bloomPass) fx.bloomPass.strength = 0.12 + 0.4 * params.glow;
}
function driftText() {
  const cap = 1.0 * [1, 1.6, 2.5][comfort.settings.speed] * (comfort.reducedMotion ? 0.5 : 1);
  return params.driftSpeed.toFixed(1) + (params.driftSpeed > cap + 1e-6 ? ' (max ' + cap.toFixed(1) + ')' : '');
}
function setTheme(id) { params.theme = id; applyTheme(); saveSettings(); }
function resetAll() {
  const seed = params.seed; Object.assign(params, DEFAULTS); params.seed = seed;
  speedIdx = DEFAULTS.speedIdx; stillMode = false; drift.set(0, 0, 0);
  camera.far = params.depth * 1.6; camera.updateProjectionMatrix();
  generatePattern(); applyThemeInstant(); applyLook3(); applyTier(); saveSettings();
}

// Wrap every light into a depth-sized cube centred on the camera -> feels infinite.
function updatePositions() {
  const pos = geometry.getAttribute('position');
  camera.getWorldPosition(_p);
  const FS = params.depth;
  const h = FS * 0.5;
  const arr = pos.array;
  for (let i = 0; i < activeCount; i++) {
    arr[i * 3]     = _p.x + wrap(basePositions[i * 3]     + drift.x - _p.x + h, FS) - h;
    arr[i * 3 + 1] = _p.y + wrap(basePositions[i * 3 + 1] + drift.y - _p.y + h, FS) - h;
    arr[i * 3 + 2] = _p.z + wrap(basePositions[i * 3 + 2] + drift.z - _p.z + h, FS) - h;
  }
  pos.needsUpdate = true;
}

// ---------- real bulbs: faceted glass, white-hot core, filament rings, metal cap — built from numbers, instanced, only for nearby lights ----------
const MAXB = 500;
let bulbIcol, bulbIfade;
function buildBulbs() {
  const part = (geo, v) => { let g = geo.index ? geo.toNonIndexed() : geo.clone(); g.deleteAttribute('uv'); g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(v), 1)); return g; };
  const glass = part(new THREE.IcosahedronGeometry(0.5, 1), 0);
  const core = part(new THREE.SphereGeometry(0.17, 12, 9), 1);
  const f1 = part(new THREE.TorusGeometry(0.13, 0.014, 5, 20), 2);
  const f2 = part(new THREE.TorusGeometry(0.13, 0.014, 5, 20).rotateX(Math.PI / 2), 2);
  const f3 = part(new THREE.TorusGeometry(0.13, 0.014, 5, 20).rotateY(Math.PI / 2), 2);
  const gGeo = mergeGeometries([glass, core, f1, f2, f3]);
  bulbIcol = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 3), 3); bulbIfade = new THREE.InstancedBufferAttribute(new Float32Array(MAXB), 1);
  bulbIcol.setUsage(THREE.DynamicDrawUsage); bulbIfade.setUsage(THREE.DynamicDrawUsage);
  gGeo.setAttribute('iCol', bulbIcol); gGeo.setAttribute('iFade', bulbIfade);
  const common = `
      attribute vec3 iCol; attribute float iFade;
      varying vec3 vW, vCol, vC; varying float vPart; varying vec3 vN;
      `;
  const vs = (hasPart) => common + (hasPart ? 'attribute float aPart;' : '') + `
      void main(){
        mat4 M = modelMatrix * instanceMatrix;
        vec3 C = (M * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 wp = (M * vec4(position, 1.0)).xyz;
        wp = C + (wp - C) * iFade;                      // bulbs grow in from nothing at the edge of the range — no pop
        vW = wp; vCol = iCol; vC = C; vN = normalize(mat3(M) * normal);
        vPart = ${hasPart ? 'aPart' : '3.0'};
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`;
  const glassMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uBright: U_ref().uBright },
    vertexShader: vs(true),
    fragmentShader: `varying vec3 vW, vCol, vC; varying float vPart; varying vec3 vN; uniform float uBright;
      void main(){
        vec3 fn = normalize(cross(dFdx(vW), dFdy(vW)));           // flat facet normal → each facet catches light on its own
        vec3 V = normalize(cameraPosition - vW);
        float f = 1.0 - abs(dot(fn, V));
        vec3 col;
        if (vPart < 0.5) col = vCol * (0.10 + 1.6 * pow(f, 2.2)) + vCol * 0.10;       // glass: bright rim, faceted
        else if (vPart < 1.5) col = mix(vCol, vec3(1.0), 0.8) * 5.0;                    // hot core (HDR → real bloom)
        else col = mix(vCol, vec3(1.0), 0.55) * 3.2;                                    // filament rings
        gl_FragColor = vec4(col * uBright, 1.0);
        ${SHADER_TAIL}
      }`,
  });
  bulbGlass = new THREE.InstancedMesh(gGeo, glassMat, MAXB);
  bulbGlass.frustumCulled = false; bulbGlass.renderOrder = 2; bulbGlass.count = 0;
  const cap = new THREE.CylinderGeometry(0.1, 0.13, 0.17, 10); cap.translate(0, -0.56, 0);
  const ring = new THREE.CylinderGeometry(0.115, 0.115, 0.02, 10); ring.translate(0, -0.5, 0);
  const bGeo = mergeGeometries([cap.index ? cap.toNonIndexed() : cap, ring.index ? ring.toNonIndexed() : ring]);
  bGeo.setAttribute('iCol', bulbIcol); bGeo.setAttribute('iFade', bulbIfade);
  const baseMat = new THREE.ShaderMaterial({
    vertexShader: vs(false),
    fragmentShader: `varying vec3 vW, vCol, vC; varying float vPart; varying vec3 vN;
      void main(){
        vec3 n = normalize(vN);
        float l = max(dot(n, normalize(vC - vW)), 0.0);
        vec3 col = vec3(0.07, 0.055, 0.04) + vCol * (0.10 + 0.75 * l);        // dark bronze, lit by its own bulb
        gl_FragColor = vec4(col, 1.0);
        ${SHADER_TAIL}
      }`,
  });
  bulbBase = new THREE.InstancedMesh(bGeo, baseMat, MAXB);
  bulbBase.instanceMatrix = bulbGlass.instanceMatrix;                         // same transforms
  bulbBase.frustumCulled = false; bulbBase.renderOrder = 0; bulbBase.count = 0;
  scene.add(bulbBase, bulbGlass);
}
function U_ref() { return lightMat.uniforms; }
const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _e4 = new THREE.Euler(), _s4 = new THREE.Vector3(), _pp = new THREE.Vector3();
function updateBulbs() {
  if (!bulbGlass) return;
  const R = tier.R, R2 = R * R, R07 = R * 0.7;
  const pos = geometry.getAttribute('position').array, col = geometry.getAttribute('aCol').array, siz = geometry.getAttribute('aSize').array;
  const lim = Math.floor(activeCount * qualityScale), cap = Math.min(MAXB, tier.max);
  let n = 0;
  for (let i = 0; i < lim && n < cap; i++) {
    const dx = pos[i * 3] - _p.x, dy = pos[i * 3 + 1] - _p.y, dz = pos[i * 3 + 2] - _p.z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > R2) continue;
    const d = Math.sqrt(d2);
    const t = Math.min(1, Math.max(0, (d - R07) / (R - R07))), fade = (1 - t * t * (3 - 2 * t)) * Math.min(1, d / 0.6);
    _e4.set(pickR[i] * 6.283, jitA[i] * 6.283, jitB[i] * 6.283); _q4.setFromEuler(_e4);
    const sc = siz[i] * params.size * 0.3;
    _m4.compose(_pp.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), _q4, _s4.set(sc, sc, sc));
    bulbGlass.setMatrixAt(n, _m4);
    bulbIcol.setXYZ(n, col[i * 3], col[i * 3 + 1], col[i * 3 + 2]); bulbIfade.setX(n, fade);
    n++;
  }
  bulbGlass.count = bulbBase.count = n;
  bulbGlass.instanceMatrix.needsUpdate = true; bulbIcol.needsUpdate = true; bulbIfade.needsUpdate = true;
}

// ---------- quality tiers: High (desktop) / Medium (phone) / Light (headset); Auto picks one, the governor can step it down ----------
function baseTierName() {
  if (params.quality !== 'auto' && TIERS[params.quality]) return params.quality;
  return renderer && renderer.xr.isPresenting ? 'light' : (touch && touch.isTouch ? 'medium' : 'high');
}
function applyTier() {
  const base = TIERS[baseTierName()], gi = Math.max(base.idx, govLevel >= 2 ? 2 : govLevel >= 1 ? 1 : 0);
  tier = TIERS[TIER_ORDER[gi]];
  if (lightMat) {
    lightMat.uniforms.uBulbR.value = tier.R; lightMat.uniforms.uMax.value = tier.maxPx;
    mirrorPoints.visible = govLevel < 3;
  }
}
function tierText() { return TIERS[baseTierName()].name + (tier && tier.idx !== TIERS[baseTierName()].idx ? ' → ' + tier.name : '') + (params.quality === 'auto' ? ' (auto)' : ''); }

// ---------- a stable 'ground' under you: a faint glowing disc + rings that travel with you at foot level ----------
function buildPlatform() {
  platform = new THREE.Group();
  // a dark, polished surface: soft-edged disc; the reflection of nearby lights is drawn by the mirrored point pass
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d');
  const rg = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  rg.addColorStop(0, 'rgba(6,8,16,0.86)'); rg.addColorStop(0.55, 'rgba(8,10,20,0.78)'); rg.addColorStop(1, 'rgba(8,10,20,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  floorMesh = new THREE.Mesh(new THREE.CircleGeometry(6, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, fog: false }));
  platform.add(floorMesh);
  for (const r of [0.55, 1.1, 1.9, 3.0]) {
    const m = new THREE.MeshBasicMaterial({ color: 0xffe2aa, transparent: true, opacity: 0.5 - r * 0.1, depthWrite: false, toneMapped: false, fog: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.006, r + 0.006, 80).rotateX(-Math.PI / 2), m);
    ring.position.y = 0.002; platform.add(ring); floorRings.push(m);
  }
  platform.traverse((o) => { o.renderOrder = -0.5; });
  dolly.add(platform);
}
function applyDraw() { geometry.setDrawRange(0, Math.max(1, Math.floor(activeCount * qualityScale))); }

// ---------- light wand (grab with grip, trigger plants lights at its tip) ----------
const _tip = new THREE.Vector3();
function jewelColor(c, i) {
  pickR[i] = Math.random(); jitA[i] = Math.random(); jitB[i] = Math.random();
  themeColor(pickR[i], jitA[i], jitB[i], _c); c.array[i * 3] = _c.r; c.array[i * 3 + 1] = _c.g; c.array[i * 3 + 2] = _c.b;
  if (toCol) { toCol[i * 3] = _c.r; toCol[i * 3 + 1] = _c.g; toCol[i * 3 + 2] = _c.b; fromCol[i * 3] = _c.r; fromCol[i * 3 + 1] = _c.g; fromCol[i * 3 + 2] = _c.b; }
}
function plantLight(pos) {
  if (activeCount >= MAX_LIGHTS) return;
  const i = activeCount++;
  basePositions[i * 3] = pos.x - drift.x; basePositions[i * 3 + 1] = pos.y - drift.y; basePositions[i * 3 + 2] = pos.z - drift.z;
  const col = geometry.getAttribute('aCol'), siz = geometry.getAttribute('aSize');
  jewelColor(col, i); siz.array[i] = 1.2 + Math.random() * 0.5;
  col.needsUpdate = true; siz.needsUpdate = true;
  applyDraw();
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
  generatePattern(); saveSettings();
}
function randomize() {
  params.seed = (Math.random() * 1e9) | 0;
  generatePattern(); saveSettings();
}

// ---------- ambient sound (soft evolving pad) ----------
let actx = null, master = null, soundOn = true;
function startAudio() {
  if (actx) { if (soundOn && actx.state === 'suspended') actx.resume(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = 0.28;
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
  const xr = renderer.xr.isPresenting;
  if (!comfort.paused) worldTime += dt;
  const st = handleMovement(dt);
  if (!comfort.paused && params.driftSpeed > 0) {                    // lights drift in the chosen direction; capped by the comfort speed setting
    const cap = [1, 1.6, 2.5][comfort.settings.speed] * (comfort.reducedMotion ? 0.5 : 1), v = Math.min(params.driftSpeed, cap), d = DIRS[params.driftDir];
    drift.x += d[0] * v * dt; drift.y += d[1] * v * dt; drift.z += d[2] * v * dt;
  }
  stepTheme(dt);
  applyLook3();
  if (!xr) applyLook();
  updatePositions();
  platform.position.y = xr ? 0 : -1.6;
  { const u = lightMat.uniforms; u.uFloorY.value = dolly.position.y + platform.position.y; u.uFloorC.value.set(dolly.position.x, dolly.position.z); }
  updateBulbs();
  lightMat.uniforms.uHalfH.value = eyeBufferHalfHeight();
  lightMat.uniforms.uMin.value = xr ? 3.5 : 2.5 * Math.min(renderer.getPixelRatio(), 2);
  lightMat.uniforms.uTime.value = comfort.reducedMotion ? 0 : worldTime;
  menu.update();
  wand.visible = xr;
  kit.update(dt);
  touch.tick(dt);
  comfort.update(dt, st);
  fx.render();
}

function applyLook() {
  if (touch.gyro.on) camera.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ')).multiply(touch.gyro.quat);
  else camera.rotation.set(pitch, yaw, 0, 'YXZ');            // always level: no roll, ever
}

// Returns {moving, turning} for the comfort vignette. Constant speed, instant start/stop, level steering.
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _sv = new THREE.Vector3();
function handleMovement(dt) {
  const xr = renderer.xr.isPresenting;
  camera.position.y = rise && rise.lying && !xr ? -1.3 : 0;            // lying: eye just above the floor (desktop floor is 1.6 below)
  if (rise && rise.lying) return { moving: rise.update(dt), turning: 0 };   // no flying while lying; optional float up / back down
  const move = new THREE.Vector3();
  camera.getWorldDirection(_fwd); _fwd.y = 0;
  if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
  _fwd.normalize();                                                  // steer along the horizon, never up/down with your gaze
  _right.crossVectors(_fwd, WORLD_UP).normalize();
  let turning = 0, vertical = 0, speed;

  if (xr) {
    speed = comfort.speed(VR_SPEED);
    const session = renderer.xr.getSession();
    if (session) {
      for (const src of session.inputSources) {
        const gp = src.gamepad;
        if (!gp || gp.axes.length < 4) continue;
        const ax = gp.axes[2], ay = gp.axes[3];
        if (src.handedness === 'right') {
          const d = comfort.turnDelta(ax, dt);
          if (d) { rotateRigAboutHead(dolly, camera, d); turning = Math.abs(d) > 0.2 ? 0 : Math.abs(d) / Math.max(dt, 1e-3); }
          if (Math.abs(ay) > 0.3) vertical = -Math.sign(ay) * 0.6;           // gentle rise/sink
        } else if (!stillMode && (Math.abs(ax) > 0.15 || Math.abs(ay) > 0.15)) {
          move.add(stickVector(camera, ax, ay, _sv));
        }
      }
    }
  } else {
    speed = touch.isTouch ? comfort.speed(VR_SPEED * 1.4)          // phones: same slow constant drift as VR
      : MOVE_SPEED * SPEEDS[speedIdx] * (comfort.reducedMotion ? 0.5 : 1) * ((keys['ShiftLeft'] || keys['ShiftRight']) ? BOOST : 1);
    if (!stillMode) {
      if (keys['KeyW']) move.add(_fwd);
      if (keys['KeyS']) move.sub(_fwd);
      if (keys['KeyD']) move.add(_right);
      if (keys['KeyA']) move.sub(_right);
      if (touch.move.x || touch.move.y) move.add(stickVector(camera, touch.move.x, touch.move.y, _sv));   // up on the stick = forward
    }
    if (keys['KeyE'] || keys['Space'] || touch.buttons.up) vertical += 1;
    if (keys['KeyQ'] || touch.buttons.down) vertical -= 1;
  }
  let moving = 0;
  if (!stillMode) {
    if (vertical) move.y += vertical;
    if (move.lengthSq() > 0) {
      if (move.length() > 1) move.normalize();                       // analogue stick: proportional, but constant per deflection (no ramp)
      dolly.position.addScaledVector(move, speed * dt);
      moving = speed * move.length();
    }
  }
  return { moving, turning };
}

// ---------- input ----------
function onMouseMove(e) {
  if (!pointerLocked) return;
  yaw -= e.movementX * LOOK_SPEED;
  pitch -= e.movementY * LOOK_SPEED;
  pitch = Math.max(-1.4, Math.min(rise && rise.lying ? 1.56 : 1.4, pitch));
  applyLook();
}

function onClick() {
  if (!renderer.xr.isPresenting) { startAudio(); if (!touch.isTouch) renderer.domElement.requestPointerLock(); menu.close(); }
}

function onKey(e) {
  if (/^Digit[1-8]$/.test(e.code)) setPattern(PATTERNS[+e.code.slice(5) - 1][1]);
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
