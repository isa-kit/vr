// Infinity Lights — fly through an endless field of glowing lights.
// Works flat (desktop), in VR (Quest browser) and AR (Android Chrome) via WebXR.
// In-world control panel: pattern (type), spacing, depth, randomize.

import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { buildControlPanel } from './ui.js';
import { beautify, SHADER_TAIL } from '../shared/beauty.js';

let fx, nebula;   // post-processing + nebula backdrop

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

// user-driven params (panel writes these, then regenerates)
const params = {
  pattern: 'random',   // random | grid | diagonal | jitter
  spacing: 8,          // world units between lattice points  (4..30)
  depth:   120,        // size of the field cube / draw distance (50..240)
  seed:    20261111,
};

// ---------- state ----------
let scene, camera, renderer, dolly, points, geometry;
let basePositions;                 // Float32Array, length MAX_LIGHTS*3
let activeCount = 0;
let panel, panelGroup;
const controllers = [];
let hovered = null;
const keys = {};
let yaw = 0, pitch = 0, pointerLocked = false;
const clock = new THREE.Clock();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const raycaster = new THREE.Raycaster();
const tempMatrix = new THREE.Matrix4();
const _p = new THREE.Vector3();
const mouseNDC = new THREE.Vector2(0, 0);
const CENTER = new THREE.Vector2(0, 0);

// Defaults come from the engine-agnostic scene config; built-in values above
// are the fallback if the fetch fails (e.g. opened as a bare file://).
loadConfig().then(init);

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
  scene.background = new THREE.Color(0x000006);

  camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, params.depth * 1.6);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  // A "dolly" moves the player; the headset controls the camera inside it.
  dolly = new THREE.Group();
  dolly.add(camera);
  scene.add(dolly);

  fx = beautify(renderer, scene, camera, { exposure: 1.0, bloom: 0.75, radius: 0.5, threshold: 0.76 });
  buildNebula();
  buildLights();

  // control panel floats in front of the view (child of camera so it's always reachable)
  panel = buildControlPanel({ setPattern, bump, randomize, hide: hidePanel });
  panelGroup = panel.group;
  panelGroup.scale.setScalar(0.9);
  dolly.add(panelGroup);          // world-anchored (not head-locked): a desk you glance at
  recenterPanel();
  panel.setActivePattern(params.pattern);
  panel.setReadout('spacing', 'Spacing  ' + params.spacing);
  panel.setReadout('depth', 'Depth  ' + params.depth);

  generatePattern();

  // VR controllers: a ray to point at the panel, trigger to click, grip to toggle.
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    c.addEventListener('selectstart', activateHover);
    c.addEventListener('squeezestart', togglePanel);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0xffd6a0, transparent: true, opacity: 0.7 })
    );
    line.scale.z = 3;
    c.add(line);
    dolly.add(c);
    controllers.push(c);
  }

  document.body.appendChild(VRButton.createButton(renderer));
  const arBtn = ARButton.createButton(renderer);
  arBtn.style.transform = 'translateY(-44px)';
  document.body.appendChild(arBtn);

  renderer.xr.addEventListener('sessionstart', onSessionStart);
  renderer.xr.addEventListener('sessionend', onSessionEnd);

  addEventListener('resize', onResize);
  addEventListener('keydown', (e) => { keys[e.code] = true; onKey(e); });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('click', onClick);
  document.addEventListener('pointerlockchange',
    () => { pointerLocked = document.pointerLockElement === renderer.domElement; });

  renderer.setAnimationLoop(animate);
}

// ---------- lights ----------
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,241,214,0.9)');
  g.addColorStop(1.0, 'rgba(255,220,180,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function buildLights() {
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_LIGHTS * 3), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_LIGHTS * 3), 3));
  basePositions = new Float32Array(MAX_LIGHTS * 3);

  const material = new THREE.PointsMaterial({
    size: 1.7,
    map: makeGlowTexture(),
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });

  points = new THREE.Points(geometry, material);
  points.frustumCulled = false;   // positions are rewritten around the camera each frame
  scene.add(points);
}

function generatePattern() {
  const depth = params.depth;
  const S = params.spacing;
  let n = Math.round(depth / S);
  n = Math.max(3, Math.min(20, n));
  const step = depth / n;                    // keeps lattice period == wrap period (seamless)
  activeCount = Math.min(n * n * n, MAX_LIGHTS);
  geometry.setDrawRange(0, activeCount);

  const col = geometry.getAttribute('color');
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
    const sat = pick < 0.95 ? 0.7 + rng() * 0.25 : 0.15;
    tint.setHSL(hue % 1, sat, 0.6);
    col.array[i * 3] = tint.r;
    col.array[i * 3 + 1] = tint.g;
    col.array[i * 3 + 2] = tint.b;
  }
  col.needsUpdate = true;
  updatePositions();
  document.getElementById('pat').textContent = params.pattern;
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

// ---------- panel handlers ----------
function setPattern(p) {
  params.pattern = p;
  panel.setActivePattern(p);
  generatePattern();
}
function bump(which, dir) {
  if (which === 'spacing') {
    params.spacing = clamp(params.spacing + dir * 2, 4, 30);
    panel.setReadout('spacing', 'Spacing  ' + params.spacing);
  } else {
    params.depth = clamp(params.depth + dir * 15, 50, 240);
    panel.setReadout('depth', 'Depth  ' + params.depth);
    camera.far = params.depth * 1.6;
    camera.updateProjectionMatrix();
  }
  generatePattern();
}
function randomize() {
  params.seed = (Math.random() * 1e9) | 0;
  generatePattern();
}
function hidePanel() { panelGroup.visible = false; }
function recenterPanel() {
  const eye = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  camera.updateWorldMatrix(true, false);
  camera.getWorldPosition(eye);
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  const desk = eye.clone().addScaledVector(fwd, 0.62);
  desk.y -= 0.5;                          // standing-desk height, below the eyeline
  panelGroup.position.copy(desk).sub(dolly.position);
  panelGroup.updateMatrixWorld();
  panelGroup.lookAt(eye);                 // tilt the face up toward you, like a propped tablet
}
function togglePanel() {
  panelGroup.visible = !panelGroup.visible;
  if (panelGroup.visible) recenterPanel();
}

// ---------- interaction (raycast the panel) ----------
function updateInteraction() {
  if (!panelGroup.visible) { setHover(null); return; }

  if (renderer.xr.isPresenting) {
    let best = null;
    for (const c of controllers) {
      tempMatrix.identity().extractRotation(c.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
      const hits = raycaster.intersectObjects(panel.hitTargets, false);
      if (hits.length) { best = hits[0].object; break; }
    }
    setHover(best);
  } else {
    raycaster.setFromCamera(pointerLocked ? CENTER : mouseNDC, camera);
    const hits = raycaster.intersectObjects(panel.hitTargets, false);
    setHover(hits.length ? hits[0].object : null);
  }
}
function setHover(mesh) {
  if (hovered === mesh) return;
  if (hovered) hovered.scale.setScalar(1);
  hovered = mesh;
  if (hovered) hovered.scale.setScalar(1.07);
}
function activateHover() {
  if (hovered && hovered.userData.action) hovered.userData.action();
}

// ---------- loop ----------
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  handleMovement(dt);
  updatePositions();
  updateInteraction();
  fx.render();
}

function handleMovement(dt) {
  const speed = MOVE_SPEED * ((keys['ShiftLeft'] || keys['ShiftRight']) ? BOOST : 1);
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
  if (!pointerLocked) {
    mouseNDC.x = (e.clientX / innerWidth) * 2 - 1;
    mouseNDC.y = -(e.clientY / innerHeight) * 2 + 1;
    return;
  }
  yaw -= e.movementX * LOOK_SPEED;
  pitch -= e.movementY * LOOK_SPEED;
  pitch = Math.max(-1.4, Math.min(1.4, pitch));
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}

function onClick() {
  if (hovered) { activateHover(); return; }         // clicked a panel button
  if (!renderer.xr.isPresenting) renderer.domElement.requestPointerLock();
}

function onKey(e) {
  if (e.code === 'Digit1') setPattern('random');
  if (e.code === 'Digit2') setPattern('grid');
  if (e.code === 'Digit3') setPattern('diagonal');
  if (e.code === 'Digit4') setPattern('jitter');
  if (e.code === 'KeyC') togglePanel();
  if (e.code === 'KeyR') randomize();
}

function onSessionStart() {
  const s = renderer.xr.getSession();
  const isAR = s && s.environmentBlendMode && s.environmentBlendMode !== 'opaque';
  if (isAR) { scene.background = null; nebula.visible = false; }   // let camera passthrough show in AR
}
function onSessionEnd() {
  scene.background = new THREE.Color(0x000006);
  nebula.visible = true;
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
