// procgen demo / inspection page (not linked from the site).  ?m=textures | trees | rocks | terrain | water | sky
import * as THREE from 'three';
import { makeMaterialMaps, makeLeafAtlas, standardMaterial } from './textures.js';
import { TREE_PRESETS, QUALITY, createTreeLibrary, createTreeField } from './trees.js';
import { createSky } from './sky.js';
import { createWater, createShoreline } from './water.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const mode = new URLSearchParams(location.search).get('m') || 'textures';
const msg = document.getElementById('msg');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8fa7b8);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 2000);
scene.add(new THREE.HemisphereLight(0xdfeaff, 0x556644, 1.2));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.6); sun.position.set(-3, 5, 4); scene.add(sun);
window.__demo = { THREE, renderer, scene, camera, msg };

async function textures() {
  const kinds = ['bark:oak', 'bark:pine', 'bark:birch', 'litter', 'soil', 'rock', 'sand', 'sand:wet', 'grass', 'moss'];
  camera.position.set(0, 0, 11.5); let i = 0;
  for (const k of kinds) {
    msg.textContent = 'maps: ' + k; await new Promise(r => setTimeout(r, 0));
    const maps = await makeMaterialMaps(k, { size: 256, seed: 3 });
    const mat = standardMaterial(maps, { repeat: [2, 2] });
    const col = i % 5, row = Math.floor(i / 5);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); plane.position.set((col - 2) * 2.2, (0.5 - row) * 2.4 + 0.9, 0); plane.rotation.y = 0.25; scene.add(plane);
    i++;
  }
  const atlases = ['oak', 'birch', 'needle', 'fern'];
  atlases.forEach((s, j) => {
    const a = makeLeafAtlas(s, { size: 512, seed: 5 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: a.map, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
    m.position.set((j - 1.5) * 2.2, -3.6, 0); scene.add(m);
  });
  msg.textContent = 'textures ok';
}
async function trees() {
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environment.mapping = THREE.CubeUVReflectionMapping;
  scene.fog = new THREE.FogExp2(0xbfd0dc, 0.004); scene.background = new THREE.Color(0xbfd0dc);
  const q = QUALITY[new URLSearchParams(location.search).get('q') || 'high'];
  const sunDir = new THREE.Vector3(-0.36, 0.5, -0.78).normalize();
  const lib = await createTreeLibrary({ renderer, scene, quality: q, species: ['oak', 'birch', 'pine', 'fir'], sun: { dir: sunDir, color: new THREE.Color(0xfff0d8), intensity: 3 }, env: scene.environment, tick: async (l) => { msg.textContent = 'building ' + l; await new Promise(r => setTimeout(r, 0)); } });
  const items = []; const names = ['oak', 'birch', 'pine', 'fir'];
  names.forEach((n, i) => { for (let v = 0; v < q.variants; v++) items.push({ x: (i - 1.5) * 14, y: 0, z: -v * 9, s: 1, yaw: v, species: n, variant: v, tint: [1, 1, 1] }); });
  for (let k = 0; k < 600; k++) { const n = names[k % 4]; items.push({ x: (Math.random() - 0.5) * 900, y: 0, z: -80 - Math.random() * 700, s: 0.8 + Math.random() * 0.5, yaw: Math.random() * 6, species: n, variant: k % q.variants, tint: [1, 1, 1] }); }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4d6a38, roughness: 1 })); scene.add(ground);
  const field = createTreeField(lib, items, scene); field.layout({ x: 0, z: 20, lod0: 60, lod1: 140, far: 900 });
  const sl = new THREE.DirectionalLight(0xfff0d8, 3); sl.position.copy(sunDir).multiplyScalar(60); scene.add(sl);
  const p = new URLSearchParams(location.search); camera.position.set(+(p.get('cx') || 0), +(p.get('cy') || 6), +(p.get('cz') || 28)); camera.lookAt(+(p.get('tx') || 0), +(p.get('ty') || 8), +(p.get('tz') || -20));
  window.__demo.lib = lib; window.__demo.field = field; msg.textContent = 'trees ok';
  renderer.setAnimationLoop(() => { lib.update(performance.now() / 1000); renderer.render(scene, camera); });
}
async function shore() {
  const sky = createSky({ renderer, scene, sun: { elevation: 14, azimuth: 20 } }); scene.environment = sky.env; scene.fog = new THREE.FogExp2(sky.haze, 0.0015); scene.background = null;
  sun.color.copy(sky.sunColor); sun.position.copy(sky.sunDir).multiplyScalar(50);
  const slope = 0.07, H = (x, z) => z >= 0 ? z * slope : -9 * (1 - Math.exp(-(-z) * 0.02));   // z = 0 is the still-water line, land is +z
  const maps = await makeMaterialMaps('sand', { size: 512, seed: 2 });
  const sandMat = standardMaterial(maps, { repeat: [1, 1] });
  const geo = new THREE.PlaneGeometry(300, 300, 150, 150).rotateX(-Math.PI / 2); const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, H(p.getX(i), p.getZ(i))); geo.computeVertexNormals();
  const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) * 0.4, p.getZ(i) * 0.4);
  const sand = new THREE.Mesh(geo, sandMat); scene.add(sand);
  const shore = createShoreline({ base: { x: 0, z: 0 }, land: [0, 1], runup: 6, period: 12, groundH: (x, z) => H(x, z) });
  shore.patchMaterial(sandMat);
  const water = createWater({ level: 0, bounds: { cx: 0, cz: -60, w: 300, d: 130 }, segments: 160, depthFn: (x, z) => -H(x, z), maxDepth: 8, calm: 0.6, colors: { shallow: 0x58a39a, deep: 0x0f3f4c } });
  scene.add(water.mesh);
  camera.position.set(0, 1.7, 14); camera.lookAt(0, 0.5, -10);
  window.__demo.shore = shore; window.__demo.sky = sky;
  renderer.setAnimationLoop(() => { const t = performance.now() / 1000; shore.update(t); water.update(t); sky.update(t, camera.position); renderer.render(scene, camera); });
  msg.textContent = 'shore ok';
}
const modes = { textures, trees, shore };
await modes[mode]?.();
renderer.setAnimationLoop(() => renderer.render(scene, camera));
