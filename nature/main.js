// Nature — Glade & Cliffs.  A walkable "vista": rolling hills with a glade,
// a cliff down to fake-reflective water, low-poly forest, sheep, hazy distant
// mountains, drifting clouds, flapping birds, and synthesized wind + birdsong.
// WebXR (VR) + flat desktop.  All the hard stuff is cheated to stay light.

import * as THREE from 'three';
import { detectXR, standardChrome, recenterRig, choiceGrid, stepperRow, toggleRow, sectionRow } from '../shared/app.js?v=app2';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createToolkit, createLens } from '../shared/xrtools.js?v=20261113c';
import { createComfort, rotateRigAboutHead, stickVector } from '../shared/app.js?v=app2';
import { createTouch } from '../shared/touch.js?v=20261113c';
import { createBirds } from '../shared/birds.js?v=20261113c';
import { createSky } from '../procgen/sky.js?v=20261115a';
import { createWater } from '../procgen/water.js?v=20261115a';
import { makeMaterialMaps, standardMaterial } from '../procgen/textures.js?v=20261115a';
import { createTerrain } from '../procgen/terrain.js?v=20261115a';
import { QUALITY, createTreeLibrary, createTreeField } from '../procgen/trees.js?v=20261115a';
import { createRocks } from '../procgen/rocks.js?v=20261115a';
import { beautify, SHADER_TAIL } from '../shared/beauty.js?v=20261113c';
import { createSkyRise } from '../shared/skyrise.js?v=rise11';

let fx;
const windU = { value: 0 };   // shared wind clock for swaying foliage

// Lambert material whose upper vertices sway in the wind (trunks stay planted).
function swayMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windU;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 0.21 + instanceMatrix[3].z * 0.17;
      #else
        float ph = 0.0;
      #endif
      float sway = max(0.0, position.y - 1.2) * 0.05;
      transformed.x += sin(uTime * 1.4 + ph) * sway;
      transformed.z += cos(uTime * 1.1 + ph) * sway * 0.6;`);
  };
  return m;
}

// ---------- config (overridable from scenes/nature-glade.json) ----------
const cfg = { trees: 150, sheep: 14, birds: 16, mountains: 18 };
const WL = -1.5;            // water level
const EYE = 1.6;           // desktop eye height
const WALK = 5.5, RUN = 2.3;

let scene, camera, renderer, dolly, world, menu, caps, horizonColor, kit, spy;
let soundOn = true, comfort, touch, wt = 0, fenceBuilt = false;
let rise = null, lieSpot = { x: 0, y: 0, z: 20 };   // Lying down: you lie where you stand and look up; the world stays upright
const VR_WALK = 1.6;          // m/s in a headset / on a phone: slow, constant, no ramps
const EDGE_Z = -34;           // hard stop well back from the cliff; speed eases off over the last 8 m
let ocean, sky, terrain, treeLib, treeField, hemiL, flockBirds, clouds = [], sheepMesh, treeLodK = 1, lastLayout = { x: 1e9, z: 1e9 };
const clock = new THREE.Clock();
const keys = {};
let yaw = 0, pitch = 0, pointerLocked = false;
const fwd = new THREE.Vector3(), right = new THREE.Vector3();
const camWorld = new THREE.Vector3();
const sunDir = new THREE.Vector3(0.33, 0.28, -1).normalize();  // low, golden-hour

// ---------- value-noise terrain ----------
function hash(x, z) { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, z * f); f *= 2; a *= 0.5; } return s; }
function smoothstep(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

// height of the land at (x,z): rolling hills, flattened glade at origin,
// dropping off a cliff into the sea on the north (−z) side.
function terrainH(x, z) {
  let hills = (fbm(x * 0.012 + 11, z * 0.012 + 7) - 0.5) * 12
            + (fbm(x * 0.006 + 3, z * 0.006 + 9) - 0.5) * 11;   // detail + gentle rolling swells
  const d = Math.hypot(x, z);
  hills *= (0.18 + 0.82 * smoothstep(4, 34, d));   // flatten the glade
  const land = smoothstep(-74, -44, z);             // 1 = land, 0 = sea
  const seabed = -12;
  let h = seabed + (hills - seabed) * land;
  // a distant mountain range far across the sea (beyond z = −300): ridged noise, so it reads as real ranges
  const mk = smoothstep(-280, -380, z);
  if (mk > 0) { const r = 1 - Math.abs(2 * fbm(x * 0.0042 + 40, z * 0.0042 + 13) - 1); h += mk * (Math.pow(r, 2.2) * 150 + fbm(x * 0.02, z * 0.02) * 12); }
  return h;
}

const hf = { height: (x, z) => terrainH(x, z), slope: (x, z) => { const e = 1.5, dx = (terrainH(x + e, z) - terrainH(x - e, z)) / (2 * e), dz = (terrainH(x, z + e) - terrainH(x, z - e)) / (2 * e); return 1 - 1 / Math.hypot(dx, 1, dz); } };
let qpref = 'auto'; try { qpref = localStorage.getItem('oortia-nature-quality') || 'auto'; } catch (e) { /* ignore */ }
function pickTier() {
  if (qpref !== 'auto' && QUALITY[qpref]) return qpref;
  if (/OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent)) return 'light';
  return touch && touch.isTouch ? 'medium' : 'high';
}
const loadMsg = (m) => { const g = document.querySelector('#enter .go'); if (g) g.textContent = m; };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

init();

async function init() {
  try {
    const c = await (await fetch('../scenes/nature-glade.json', { cache: 'no-store' })).json();
    const p = {}; (c.vista?.props || []).forEach(x => p[x.type] = x.count);
    if (p.tree) cfg.trees = p.tree; if (p.sheep) cfg.sheep = p.sheep;
    if (p.mountain) cfg.mountains = p.mountain; if (c.vista?.birds?.count) cfg.birds = c.vista.birds.count;
  } catch (e) {}

  caps = await detectXR();
  scene = new THREE.Scene();
  const horizon = new THREE.Color(0xdfe6ea);
  horizonColor = horizon;
  scene.background = horizon.clone();
  scene.fog = new THREE.FogExp2(horizon, 0.0034);        // exponential haze: far trees and mountains melt into the sky colour

  camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 1200);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: caps.ar });   // alpha only if passthrough can be toggled
  if (caps.ar) renderer.setClearColor(0x000000, 0);
  renderer.setSize(innerWidth, innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);
  touch = createTouch({ canvas: renderer.domElement, look: true, stick: true,
    buttons: [{ id: 'zoom', label: '🔭' }],
    onLook: (dx, dy) => { yaw -= dx * 0.004; pitch = Math.max(-1.2, Math.min(rise && rise.lying ? 1.56 : 1.2, pitch - dy * 0.004)); } });
  renderer.setPixelRatio(touch.pixelRatio(2));
  { const h = document.getElementById('help'); if (h) h.textContent = touch.helpText('Drag to look · thumb-stick walks · hold 🔭 for binoculars · ☰ Menu for options', h.textContent); }
  fx = beautify(renderer, scene, camera, { tone: 'neutral', exposure: 1.0, bloom: 0.12, radius: 0.4, threshold: 2.2 });

  dolly = new THREE.Group();
  dolly.add(camera);
  scene.add(dolly);
  dolly.position.set(0, 0, 20);   // start in the glade, facing the sea (−z)
  yaw = 0;                          // default camera faces −z (toward the cliff & sea)

  // ---- everything below is generated from numbers by procgen/ (no downloads) ----
  loadMsg('Growing the glade…'); await nextFrame();
  const tierName = pickTier(), T = QUALITY[tierName];
  sky = createSky({ renderer, scene, sun: { elevation: 16, azimuth: -17 }, clouds: { cover: 0.38 }, seed: 5 });
  sunDir.copy(sky.sunDir);
  sky.mesh.scale.setScalar(500); sky.dome.scale.setScalar(0.38);
  scene.fog.color.copy(sky.haze); scene.background = sky.haze.clone();
  scene.environment = sky.env; scene.environmentIntensity = 0.7;
  hemiL = new THREE.HemisphereLight(0xe9f0e2, 0x55663c, 0.35); scene.add(hemiL);
  const sun = new THREE.DirectionalLight(sky.sunColor, 1.6 * sky.sunIntensity / 3.2);
  sun.position.copy(sunDir).multiplyScalar(100);
  scene.add(sun);

  const maps = {};
  for (const k of ['litter', 'grass', 'soil', 'rock']) { maps[k] = await makeMaterialMaps(k, { size: T.tex, seed: 4 }); await nextFrame(); }
  const sandM = await makeMaterialMaps('sand', { size: T.tex, seed: 6 }); maps.soil = sandM;                  // the 'soil' slot becomes shoreline sand
  terrain = createTerrain({ hf, maps, radius: 760, seed: 2,
    extraWeights: (x, z, h) => {
      if (z < -26 && h < WL + 0.9) return { litter: 0.04, grass: 0.04, soil: 8 };                         // shoreline sand
      const g = 1 - smoothstep(22, 70, Math.hypot(x, z - 10));                                  // the glade is meadow; litter lives under the trees
      return { litter: 1 - 0.9 * g, grass: 1 + 6 * g, soil: 0.02 };
    } });
  terrain.rebuild(0, 20); terrain.cx = 0; terrain.cz = 20; scene.add(terrain.mesh);
  ocean = createWater({
    level: WL, bounds: { cx: 0, cz: -420, w: 1500, d: 740 }, segments: tierName === 'light' ? 90 : tierName === 'medium' ? 140 : 220, maxDepth: 10,
    depthFn: (x, z) => Math.max(0, WL - terrainH(x, z)),
    waves: [{ dir: [0.1, 1], steep: 0.08, len: 60, speed: 0.8 }, { dir: [-0.3, 1], steep: 0.06, len: 30, speed: 0.9 }, { dir: [0.4, 0.9], steep: 0.04, len: 14, speed: 1 }],
    colors: { shallow: 0x4a9db2, deep: 0x154f66 }, calm: 0.5, foam: 0.9,
  });
  scene.add(ocean.mesh);
  loadMsg('Growing trees…'); await nextFrame();
  treeLib = await createTreeLibrary({ renderer, scene, quality: T, species: ['oak', 'birch', 'pine', 'fir'], seed: 3,
    sun: { dir: sunDir, color: sky.sunColor.getHex(), intensity: sky.sunIntensity }, env: sky.env, tick: async (m) => { loadMsg(m + '…'); await nextFrame(); } });
  {
    const items = [], R = (() => { let a = 12345; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
    const want = Math.round((cfg.trees + 55) * (tierName === 'light' ? 0.6 : 1)); let tries = 0;
    while (items.length < want && tries++ < want * 40) {
      const a = R() * Math.PI * 2, r = 22 + Math.pow(R(), 0.8) * 170, x = Math.cos(a) * r, z = Math.sin(a) * r + 0;
      if (z < -40) continue;
      const h = terrainH(x, z); if (h < WL + 0.8 || h > 9) continue;
      const conif = R() < 0.62, sp = conif ? (R() < 0.6 ? 'pine' : 'fir') : (R() < 0.62 ? 'oak' : 'birch');
      items.push({ x, y: h - 0.1, z, s: 0.5 + R() * 0.4, yaw: R() * 6.28, species: sp, variant: items.length % T.variants, tint: [0.9 + R() * 0.2, 0.9 + R() * 0.2, 0.88 + R() * 0.16] });
    }
    treeField = createTreeField(treeLib, items, scene);
  }
  {
    const R = (() => { let a = 777; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
    const items = []; let tries = 0;
    while (items.length < 70 && tries++ < 2500) {
      const a = R() * Math.PI * 2, r = 10 + R() * 160, x = Math.cos(a) * r, z = Math.sin(a) * r; if (z < -42) continue;
      const h = terrainH(x, z); if (h < WL + 0.1 || h > 9) continue;
      items.push({ x, y: h - 0.05, z, s: 0.35 + Math.pow(R(), 2) * 1.5, yaw: R() * 6.28, variant: items.length });
    }
    const rockMat = standardMaterial(await makeMaterialMaps('rock', { size: T.tex, seed: 2 }), { vertexColors: true });
    scene.add(createRocks({ items, variants: [1, 2, 3, 4, 5].map((sd) => ({ seed: sd, detail: tierName === 'light' ? 2 : 3, flatten: 0.55 + sd * 0.05, facets: 6 + sd, rough: 0.1 })), material: rockMat }));
  }
  buildFlowers();
  buildSheep();
  buildDeer();
  buildBirds();

  // everything but the rig lives in `world` so the menu can hide it for passthrough
  world = new THREE.Group();
  for (const o of [...scene.children]) if (o !== dolly) world.add(o);
  scene.add(world);

  buildFence();
  comfort = createComfort({ renderer, scene, camera, dolly, groundHit,
    onQuality: (q) => { treeLodK = [1, 0.75, 0.55, 0.4][q]; lastLayout.x = 1e9; flockBirds.group.visible = q < 1; } });

  rise = createSkyRise({ THREE, renderer, camera, rig: dolly, comfort, getMenu: () => menu, story: 'trees', ceiling: 50, step: 6, home: () => lieSpot, clouds: true, parent: world, isPaused: () => comfort.paused,
    onLying: (on) => { if (on) lieSpot = { x: dolly.position.x, y: terrainH(dolly.position.x, dolly.position.z), z: dolly.position.z }; pitch = on ? 1.42 : 0; } });
  menu = standardChrome({ comfort, scene, comfortRows: false, compactCommon: false,   // the app standard: Pause first, then Recenter / Menu style / Quit (STANDARD.md)
    renderer, camera, dolly, caps,
    title: 'Nature — Glade & Cliffs',
    hint: touch.helpText('Drag to look · thumb-stick walks · hold 🔭 for binoculars · Pause world motion in Comfort', 'WASD walk · mouse look · Shift run · hold Z for binoculars · click the view to look around · Esc/M menu. In VR: grip the spyglass at your side and raise it to your eye.'),
    rows: [
      { label: 'Quality', cells: [['Auto', 'auto'], ['High', 'high'], ['Med', 'medium'], ['Light', 'light']].map(([t, id]) => ({ text: t, active: () => qpref === id, action: () => { try { localStorage.setItem('oortia-nature-quality', id); } catch (e) { /* ignore */ } location.reload(); } })) },
      { cells: [{ text: () => 'Tier: ' + pickTier() + ' (change reloads)' }] },
      ...rise.rows(),
      ...comfort.rows({ movement: true, teleport: true }),
      ...touch.rows(),
    ],
    fade: comfort.fade,
    sound: { get: () => soundOn, set: setSound },
    setBackdrop,
    recenter,
    onBeforeEnter: startAudio,
    onSessionEnd: () => { dolly.rotation.set(0, 0, 0); yaw = 0; pitch = 0; },   // don't carry VR rig yaw into flat mode
  }).menu;
  touch.onChange = () => menu.refresh();
  if (/[?&]lie=1/.test(location.search)) rise.setLying(true);   // front-page "Lying down" cards
  // spyglass: a hand-held lens (render-to-texture, ×6) floating at your left hip; grip to grab, look through it
  kit = createToolkit({ renderer, scene, dolly, camera, menu });
  spy = createLens({ renderer, scene, camera, menu, radius: 0.085, zoom: 6, ring: 0xc9a24a });
  dolly.add(spy.group);
  const spyHome = new THREE.Vector3(-0.34, -0.5, -0.4);
  spy.group.position.copy(spyHome);
  kit.add({
    name: 'Spyglass', object: spy.group, radius: 0.22,
    grip: { pos: new THREE.Vector3(0, 0.0, -0.3), rot: new THREE.Euler() },
    home: 'dolly', homePos: spyHome, homeRot: new THREE.Euler(),
    onGrab: () => spy.setOn(true), onRelease: () => spy.setOn(false), onHeld: () => spy.faceEye(),
    onTick: () => { if (!spy.on) spy.faceEye(); },
  });

  addEventListener('resize', onResize);
  addEventListener('mousemove', onMouseMove);
  addEventListener('keydown', e => { keys[e.code] = true; });
  addEventListener('keyup', e => { keys[e.code] = false; });
  const enter = document.getElementById('enter');
  renderer.domElement.addEventListener('click', () => {
    startAudio();
    if (!pointerLocked && !renderer.xr.isPresenting) { if (!touch.isTouch) lockPointer(); menu.close(); }
  });
  enter.addEventListener('click', () => { startAudio(); enter.style.opacity = '0'; setTimeout(() => enter.remove(), 500); if (!touch.isTouch) lockPointer(); menu.close(); });
  document.addEventListener('pointerlockchange', () => { pointerLocked = document.pointerLockElement === renderer.domElement; });
  renderer.xr.addEventListener('sessionstart', startAudio);

  if (location.hash === '#debug') window.__nat = { dolly, comfort, touch, camera };
  loadMsg('Enter →');
  renderer.setAnimationLoop(animate);
}

// ---------- sky + sun ----------
function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x2f68b4) }, mid: { value: new THREE.Color(0xf0d2a6) }, bot: { value: new THREE.Color(0xf4e3c6) } },
    vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP; uniform vec3 top,mid,bot;
      void main(){ float h=normalize(vP).y;
        vec3 c = h>0.0 ? mix(mid,top,pow(clamp(h,0.0,1.0),0.7)) : mix(mid,bot,clamp(-h*5.0,0.0,1.0));
        gl_FragColor=vec4(c,1.0); ${SHADER_TAIL} }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(700, 24, 16), mat));

  // soft sun disc
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d'); const rg = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,250,235,1)'); rg.addColorStop(0.3, 'rgba(255,244,214,0.8)'); rg.addColorStop(1, 'rgba(255,244,214,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, fog: false }));
  spr.position.copy(sunDir).multiplyScalar(600); spr.scale.setScalar(120);
  scene.add(spr);
}

// ---------- terrain ----------
function paint(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
function buildTerrain() {
  const S = 720, N = 190;
  const geo = new THREE.PlaneGeometry(S, S, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0xd8c89c), grass = new THREE.Color(0x579139),
        grass2 = new THREE.Color(0x3f6f33), rock = new THREE.Color(0x6f7363), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = terrainH(x, z);
    pos.setY(i, h);
    if (h < WL + 0.5) tmp.copy(sand);
    else if (h < 5) tmp.copy(grass).lerp(grass2, Math.random() * 0.5);
    else if (h < 10) tmp.copy(grass2).lerp(rock, smoothstep(5, 13, h) * 0.6);
    else tmp.copy(rock);
    tmp.offsetHSL(0, 0, (Math.random() - 0.5) * 0.05);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));
}

// ---------- water (cheated: fresnel + ripple + sun glint, no real reflection) ----------
function buildWater() {
  const geo = new THREE.PlaneGeometry(2400, 2400, 1, 1); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, fog: true,
    uniforms: {
      time: { value: 0 }, cam: { value: new THREE.Vector3() }, sun: { value: sunDir },
      deep: { value: new THREE.Color(0x154f66) }, shallow: { value: new THREE.Color(0x4a9db2) }, sky: { value: new THREE.Color(0xf0dcb8) },
      fogColor: { value: scene.fog.color }, fogNear: { value: scene.fog.near }, fogFar: { value: scene.fog.far },
    },
    vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; vec4 mv=viewMatrix*w; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `
      varying vec3 vW; uniform float time; uniform vec3 cam,sun,deep,shallow,sky;
      uniform vec3 fogColor; uniform float fogNear,fogFar;
      void main(){
        float r = sin(vW.x*0.22+time*1.1)+sin(vW.z*0.19-time*0.85)+sin((vW.x+vW.z)*0.12+time*0.6);
        vec3 N = normalize(vec3(0.05*cos(vW.x*0.22+time*1.1), 1.0, 0.05*cos(vW.z*0.19-time*0.85)));
        vec3 V = normalize(cam - vW);
        float fres = pow(1.0 - max(dot(N,V),0.0), 3.0);
        vec3 base = mix(deep, shallow, clamp(0.5+0.12*r,0.0,1.0));
        vec3 col = mix(base, sky, fres*0.85);
        vec3 H = normalize(V + normalize(sun));
        col += vec3(1.0,0.96,0.82) * pow(max(dot(N,H),0.0), 140.0) * 1.3;
        float fog = smoothstep(fogNear, fogFar, length(cam - vW));
        col = mix(col, fogColor, fog);
        gl_FragColor = vec4(col, 0.93);
        ${SHADER_TAIL}
      }`,
  });
  water = new THREE.Mesh(geo, mat); water.position.y = WL; scene.add(water);
}

// ---------- trees ----------
function makeTreeGeo() {
  const trunk = paint(new THREE.CylinderGeometry(0.16, 0.26, 1.7, 6).translate(0, 0.85, 0), 0x6a4a2b);
  const c1 = paint(new THREE.ConeGeometry(1.15, 2.1, 7).translate(0, 2.25, 0), 0x3f6b35);
  const c2 = paint(new THREE.ConeGeometry(0.9, 1.7, 7).translate(0, 3.15, 0), 0x4e7d3e);
  const c3 = paint(new THREE.ConeGeometry(0.58, 1.3, 7).translate(0, 3.95, 0), 0x5c8a48);
  return mergeGeometries([trunk, c1, c2, c3], false);
}
function buildTrees() {
  const geo = makeTreeGeo();
  const mesh = new THREE.InstancedMesh(geo, swayMaterial(), cfg.trees);
  const d = new THREE.Object3D(); let n = 0, tries = 0;
  while (n < cfg.trees && tries++ < cfg.trees * 40) {
    const a = Math.random() * Math.PI * 2, r = 26 + Math.random() * 150;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z < -40) continue;                      // keep trees off the sea side
    const h = terrainH(x, z); if (h < WL + 0.5 || h > 8) continue;
    d.position.set(x, h - 0.1, z); d.rotation.set(0, Math.random() * Math.PI * 2, 0);
    d.scale.setScalar(0.8 + Math.random() * 1.3); d.updateMatrix();
    mesh.setMatrixAt(n++, d.matrix);
  }
  mesh.count = n; scene.add(mesh);
}

// ---------- broadleaf trees (mixed into the forest for variety) ----------
function makeBroadleafGeo() {
  const trunk = paint(new THREE.CylinderGeometry(0.17, 0.3, 2.0, 6).translate(0, 1.0, 0), 0x6a4a2b);
  const c1 = paint(new THREE.SphereGeometry(1.35, 7, 6).translate(0, 2.7, 0), 0x567f3d);
  const c2 = paint(new THREE.SphereGeometry(1.0, 7, 6).translate(0.75, 3.2, 0.3), 0x6a9a4c);
  const c3 = paint(new THREE.SphereGeometry(0.95, 7, 6).translate(-0.7, 3.05, -0.25), 0x4c7338);
  return mergeGeometries([trunk, c1, c2, c3], false);
}
function buildBroadleaf() {
  const mesh = new THREE.InstancedMesh(makeBroadleafGeo(), swayMaterial(), 55);
  const d = new THREE.Object3D(); let n = 0, tries = 0;
  while (n < 55 && tries++ < 3000) {
    const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * 150;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z < -40) continue;
    const h = terrainH(x, z); if (h < WL + 0.6 || h > 7) continue;
    d.position.set(x, h - 0.1, z); d.rotation.set(0, Math.random() * Math.PI * 2, 0);
    d.scale.setScalar(0.75 + Math.random() * 1.1); d.updateMatrix(); mesh.setMatrixAt(n++, d.matrix);
  }
  mesh.count = n; scene.add(mesh);
}

// ---------- rocks ----------
function buildRocks() {
  const geo = paint(new THREE.DodecahedronGeometry(0.6, 0).scale(1, 0.68, 1), 0x7c766a);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), 46);
  const d = new THREE.Object3D(); let n = 0, tries = 0;
  while (n < 46 && tries++ < 2500) {
    const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 150;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z < -42) continue;
    const h = terrainH(x, z); if (h < WL + 0.2 || h > 8) continue;
    d.position.set(x, h + 0.1, z); d.rotation.set(Math.random(), Math.random() * 6, Math.random());
    d.scale.setScalar(0.35 + Math.random() * 1.5); d.updateMatrix(); mesh.setMatrixAt(n++, d.matrix);
  }
  mesh.count = n; scene.add(mesh);
}

// ---------- wildflower patches (camera-facing sprites) ----------
function buildFlowers() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
  const cols = ['#f6d64a', '#ef6f8b', '#f4f6f8', '#b98ef0', '#f29b4a'];
  for (let i = 0; i < 20; i++) { g.fillStyle = cols[i % cols.length]; g.beginPath(); g.arc(8 + Math.random() * 48, 10 + Math.random() * 48, 3 + Math.random() * 3, 0, 7); g.fill(); }
  const tex = new THREE.CanvasTexture(cv);
  let placed = 0, tries = 0;
  while (placed < 38 && tries++ < 2500) {
    const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 120;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z < -40) continue;
    const h = terrainH(x, z); if (h < WL + 0.5 || h > 6) continue;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: true }));
    s.position.set(x, h + 0.35, z); s.scale.setScalar(0.55 + Math.random() * 0.5); scene.add(s); placed++;
  }
}

// ---------- distant deer ----------
function makeDeerGeo() {
  const body = paint(new THREE.SphereGeometry(0.5, 7, 6).scale(1.5, 0.85, 0.7).translate(0, 1.15, 0), 0x8a6a46);
  const neck = paint(new THREE.CylinderGeometry(0.12, 0.17, 0.75, 5).rotateZ(-0.55).translate(0.62, 1.55, 0), 0x8a6a46);
  const head = paint(new THREE.SphereGeometry(0.22, 6, 5).scale(1.3, 0.8, 0.8).translate(1.0, 1.85, 0), 0x7a5a3a);
  const legs = [[-0.42, 0.28], [0.42, 0.28], [-0.42, -0.28], [0.42, -0.28]].map(([lx, lz]) =>
    paint(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 4).translate(lx, 0.55, lz), 0x5a4228));
  return mergeGeometries([body, neck, head, ...legs], false);
}
function buildDeer() {
  const mesh = new THREE.InstancedMesh(makeDeerGeo(), new THREE.MeshLambertMaterial({ vertexColors: true }), 6);
  const d = new THREE.Object3D(); let n = 0, tries = 0;
  while (n < 6 && tries++ < 500) {
    const x = (Math.random() - 0.5) * 170, z = 45 + Math.random() * 95;
    const h = terrainH(x, z); if (h < WL + 0.6 || h > 7) continue;
    d.position.set(x, h, z); d.rotation.set(0, Math.random() * 6, 0); d.scale.setScalar(0.9 + Math.random() * 0.3);
    d.updateMatrix(); mesh.setMatrixAt(n++, d.matrix);
  }
  mesh.count = n; scene.add(mesh);
}

// ---------- sheep ----------
function makeSheepGeo() {
  const body = paint(new THREE.SphereGeometry(0.5, 8, 6).scale(1.35, 0.95, 0.95).translate(0, 0.78, 0), 0xf1ede4);
  const head = paint(new THREE.SphereGeometry(0.25, 8, 6).translate(0.72, 0.92, 0), 0x3b332e);
  const legs = [[-0.3, 0.32], [0.3, 0.32], [-0.3, -0.32], [0.3, -0.32]].map(([lx, lz]) =>
    paint(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 5).translate(lx, 0.25, lz), 0x4a3f36));
  return mergeGeometries([body, head, ...legs], false);
}
function buildSheep() {
  sheepMesh = new THREE.InstancedMesh(makeSheepGeo(), new THREE.MeshLambertMaterial({ vertexColors: true }), cfg.sheep);
  const d = new THREE.Object3D(); let n = 0, tries = 0;
  while (n < cfg.sheep && tries++ < cfg.sheep * 60) {
    const x = (Math.random() - 0.5) * 165, z = 6 + Math.random() * 130;   // spread across the rolling hills behind the glade
    const h = terrainH(x, z); if (h < WL + 0.6 || h > 7) continue;
    d.position.set(x, h, z); d.rotation.set(0, Math.random() * Math.PI * 2, 0); d.scale.setScalar(0.85 + Math.random() * 0.4);
    d.updateMatrix(); sheepMesh.setMatrixAt(n++, d.matrix);
  }
  sheepMesh.count = n; scene.add(sheepMesh);
}

// ---------- distant mountains ----------
function makeMountainGeo() {
  const base = paint(new THREE.ConeGeometry(1, 1.6, 5).translate(0, 0.8, 0), 0x9aaecb);
  const cap = paint(new THREE.ConeGeometry(0.42, 0.5, 5).translate(0, 1.42, 0), 0xf1f4f9);
  return mergeGeometries([base, cap], false);
}
function buildMountains() {
  // own cool "atmospheric blue" instead of the warm ground fog → layered distant peaks
  const mesh = new THREE.InstancedMesh(makeMountainGeo(), new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }), cfg.mountains);
  const d = new THREE.Object3D();
  for (let i = 0; i < cfg.mountains; i++) {
    const a = -Math.PI / 2 + (i / cfg.mountains - 0.5) * 1.7 + (Math.random() - 0.5) * 0.16;  // across the sea (north, −z)
    const r = 215 + Math.random() * 70;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, s = 48 + Math.random() * 52;
    d.position.set(x, -9, z); d.rotation.set(0, Math.random() * Math.PI, 0);
    d.scale.set(s * (1.0 + Math.random() * 0.6), s * 0.52, s * (1.0 + Math.random() * 0.6)); d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  }
  scene.add(mesh);
}

// ---------- clouds ----------
function buildClouds() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const x = 60 + Math.random() * 136, y = 90 + Math.random() * 76, r = 30 + Math.random() * 50;
    const rg = g.createRadialGradient(x, y, 2, x, y, r);
    rg.addColorStop(0, 'rgba(255,255,255,0.9)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  for (let i = 0; i < 12; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xece6df, transparent: true, opacity: 0.75, depthWrite: false, fog: true }));
    s.position.set((Math.random() - 0.5) * 600, 70 + Math.random() * 60, (Math.random() - 0.5) * 600);
    s.scale.set(60 + Math.random() * 70, 34 + Math.random() * 30, 1);
    s.userData.sp = 1.5 + Math.random() * 2.5; clouds.push(s); scene.add(s);
  }
}

// ---------- birds: a few loose flocks on wide lazy loops, far out over the sea ----------
function buildBirds() {
  const sizes = [5, 4, 4, 3, 2];
  const flocks = []; let left = cfg.birds;
  sizes.forEach((n, k) => {
    if (left <= 0) return; n = Math.min(n, left); left -= n;
    flocks.push({ n, cx: (k - 2) * 38 + (Math.random() - 0.5) * 30, cz: -110 - k * 28, ra: 70 + Math.random() * 40, rb: 40 + Math.random() * 30,
                  y: 30 + k * 7 + Math.random() * 8, yv: 3 + Math.random() * 4, period: 105 + Math.random() * 60, size: 2.6 + Math.random() * 0.8 });
  });
  flockBirds = createBirds({ parent: scene, flocks, color: 0x353a44, seed: 11 });
}
// ---------- menu hooks ----------
// passthrough on = hide the whole world so the room shows through
function setBackdrop(visible) {
  world.visible = visible;
  scene.background = visible ? horizonColor : null;
}
function recenter() {
  if (renderer.xr.isPresenting) { recenterRig(dolly, camera, new THREE.Vector3(0, 0, 20), 0); yaw = dolly.rotation.y; }
  else { dolly.position.set(0, 0, 20); yaw = 0; pitch = 0; }
}

// ---------- synthesized ambient audio (wind + occasional birdsong) ----------
let actx, started = false;
function setSound(v) {
  soundOn = v;
  if (v) startAudio();
  if (actx) (v ? actx.resume() : actx.suspend());
}
function startAudio() {
  if (started) { if (soundOn && actx && actx.state === 'suspended') actx.resume(); return; }
  if (!soundOn) return;
  started = true;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    const src = actx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 480;
    const gain = actx.createGain(); gain.gain.value = 0.11;
    src.connect(lp).connect(gain).connect(actx.destination); src.start();
    // slow swell
    const lfo = actx.createOscillator(), lg = actx.createGain();
    lfo.frequency.value = 0.07; lg.gain.value = 0.05; lfo.connect(lg).connect(gain.gain); lfo.start();
    // distant sea lapping: a second, deeper noise layer with a slow tide swell
    const sea = actx.createBufferSource(); sea.buffer = buf; sea.loop = true;
    const lp2 = actx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 190;
    const sg = actx.createGain(); sg.gain.value = 0.05;
    sea.connect(lp2).connect(sg).connect(actx.destination); sea.start();
    const tide = actx.createOscillator(), tg = actx.createGain();
    tide.frequency.value = 0.16; tg.gain.value = 0.035; tide.connect(tg).connect(sg.gain); tide.start();
    chirp();
  } catch (e) {}
}
function chirp() {
  if (!actx) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = 'sine'; const base = 1500 + Math.random() * 1800;
  o.frequency.setValueAtTime(base, t); o.frequency.linearRampToValueAtTime(base * (1 + Math.random() * 0.2), t + 0.08);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.26);
  setTimeout(chirp, 2200 + Math.random() * 6500);
}

// ---------- input / movement ----------
function onMouseMove(e) {
  if (!pointerLocked || renderer.xr.isPresenting) return;
  yaw -= e.movementX * 0.0025; pitch -= e.movementY * 0.0025;
  pitch = Math.max(-1.2, Math.min(rise && rise.lying ? 1.56 : 1.2, pitch));
}

// where a pointing ray meets walkable ground (for teleport); null if it lands somewhere we don't let you stand
function groundHit(origin, dir) {
  if (dir.y > -0.02) return null;
  let t = 0.3, prev = 0;
  for (; t < 40; t += 0.4) {
    const x = origin.x + dir.x * t, z = origin.z + dir.z * t;
    if (origin.y + dir.y * t <= terrainH(x, z)) {
      let lo = prev, hi = t;
      for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (origin.y + dir.y * m <= terrainH(origin.x + dir.x * m, origin.z + dir.z * m)) hi = m; else lo = m; }
      const px = origin.x + dir.x * hi, pz = origin.z + dir.z * hi;
      if (pz < EDGE_Z + 1 || Math.hypot(px, pz) > 140 || terrainH(px, pz) < WL + 0.3) return null;   // not near the cliff, not into the sea
      return new THREE.Vector3(px, terrainH(px, pz), pz);
    }
    prev = t;
  }
  return null;
}

// a low timber rail well back from the cliff edge: a visible, solid-looking boundary
function buildFence() {
  const z = EDGE_Z - 1.5, step = 2.5, n = 56;
  const wood = new THREE.MeshLambertMaterial({ color: 0x8a6238 });
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.0, 0.12).translate(0, 0.5, 0), wood, n + 1);
  const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(step, 0.07, 0.07).translate(step / 2, 0, 0), wood, n * 2);
  const d = new THREE.Object3D();
  for (let i = 0; i <= n; i++) {
    const x = -70 + i * step; d.position.set(x, terrainH(x, z), z); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix(); posts.setMatrixAt(i, d.matrix);
    if (i < n) for (let r = 0; r < 2; r++) {
      const x2 = x + step, y0 = terrainH(x, z) + 0.55 + r * 0.3, y1 = terrainH(x2, z) + 0.55 + r * 0.3;
      d.position.set(x, y0, z); d.rotation.set(0, 0, Math.atan2(y1 - y0, step)); d.updateMatrix(); rails.setMatrixAt(i * 2 + r, d.matrix);
    }
  }
  world.add(posts, rails);
}

const _wp = new THREE.Vector3();
// Returns {moving, turning} for the comfort vignette.
function handleMovement(dt) {
  const pres = renderer.xr.isPresenting;
  if (rise && rise.lying) {                                             // lying down: no walking; optional float up / back down
    if (!pres) { camera.rotation.set(pitch, yaw, 0, 'YXZ'); camera.position.y = 0.3; } else camera.position.y = 0;
    return { moving: rise.update(dt), turning: 0 };
  }
  let mx = 0, mz = 0, turning = 0, deskRun = false;
  if (!pres) {
    if (touch.gyro.on) camera.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ')).multiply(touch.gyro.quat);
    else camera.rotation.set(pitch, yaw, 0, 'YXZ');                     // always level — no roll
    if (keys.KeyW) mz -= 1; if (keys.KeyS) mz += 1; if (keys.KeyA) mx -= 1; if (keys.KeyD) mx += 1;
    if (touch.move.x || touch.move.y) { mx += touch.move.x; mz += touch.move.y; }
    deskRun = keys.ShiftLeft || keys.ShiftRight;
  } else {
    const s = renderer.xr.getSession();
    for (const src of s.inputSources) {
      if (!src.gamepad) continue; const ax = src.gamepad.axes;
      const hx = ax[2] ?? ax[0] ?? 0, hy = ax[3] ?? ax[1] ?? 0;
      if (src.handedness === 'right') {
        const d = comfort.turnDelta(hx, dt);                           // snap 30° by default, slow smooth turn as an option
        if (d) { rotateRigAboutHead(dolly, camera, d); yaw = dolly.rotation.y; if (!comfort.settings.snap) turning = Math.abs(d) / Math.max(dt, 1e-3); }
      } else if (!comfort.settings.teleport) { mx += Math.abs(hx) > 0.15 ? hx : 0; mz += Math.abs(hy) > 0.15 ? hy : 0; }
    }
  }
  let moving = 0;
  if (mx || mz) {
    const m = Math.hypot(mx, mz), k = m > 1 ? 1 / m : 1;
    // constant speed (no ramp): slow in a headset or on a phone; normal walk on desktop
    let speed = (pres || touch.isTouch) ? comfort.speed(VR_WALK) : (deskRun ? WALK * RUN : WALK) * (comfort.reducedMotion ? 0.6 : 1);
    stickVector(camera, mx, mz, _wp);                                     // forward × up = right; stick y<0 = forward
    const vx = _wp.x * k, vz = _wp.z * k;
    // ease off over the last 8 m before the boundary when heading toward the cliff
    if (vz < 0) speed *= Math.min(1, Math.max(0.12, (dolly.position.z - EDGE_Z) / 8));
    dolly.position.x += vx * speed * dt; dolly.position.z += vz * speed * dt;
    moving = speed * m;
  }
  // clamp inside the world, and keep well away from the cliff
  const R = 150; const d = Math.hypot(dolly.position.x, dolly.position.z);
  if (d > R) { dolly.position.x *= R / d; dolly.position.z *= R / d; }
  if (dolly.position.z < EDGE_Z) dolly.position.z = EDGE_Z;
  // follow the ground gently: the view eases over rises instead of bobbing with every bump
  const gy = terrainH(dolly.position.x, dolly.position.z);
  dolly.position.y += (gy - dolly.position.y) * Math.min(1, dt * 3);
  if (Math.abs(gy - dolly.position.y) > 3) dolly.position.y = gy;
  camera.position.y = pres ? 0 : EYE;
  return { moving, turning };
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!comfort.paused) wt += dt;
  const t = wt;
  const st = handleMovement(dt);
  camera.getWorldPosition(camWorld);
  sky.update(t, camWorld); ocean.update(t); treeLib.update(t);
  if (Math.hypot(camWorld.x - lastLayout.x, camWorld.z - lastLayout.z) > 6) {            // re-pick tree LODs and re-centre the terrain mesh when you have moved
    lastLayout.x = camWorld.x; lastLayout.z = camWorld.z;
    const Q = treeLib.quality; treeField.layout({ x: camWorld.x, z: camWorld.z, lod0: Q.lod0 * treeLodK, lod1: Q.lod1 * treeLodK, far: 800 });
  }
  if (Math.hypot(camWorld.x - terrain.cx, camWorld.z - terrain.cz) > 40) { terrain.cx = camWorld.x; terrain.cz = camWorld.z; terrain.rebuild(camWorld.x, camWorld.z); }   // rare: a rebuild costs a few ms
  flockBirds.update(t);
  windU.value = t;
  menu.update();
  kit.update(dt);
  spy.group.visible = renderer.xr.isPresenting;
  if (!renderer.xr.isPresenting) {                 // desktop / phone: hold Z (or 🔭) for binoculars — an eased zoom, never a snap
    const f = (keys.KeyZ || touch.buttons.zoom) ? 20 : 70;
    if (Math.abs(camera.fov - f) > 0.1) { camera.fov += (f - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }
  }
  spy.update();
  touch.tick(dt);
  comfort.update(dt, st);
  fx.render();
}

function lockPointer() {
  try { const p = renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
}

function onResize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
