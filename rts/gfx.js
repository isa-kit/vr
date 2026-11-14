// ============================ rts/gfx.js — the diorama: terrain, water, forests, units, buildings, effects ============================
// Everything is generated from numbers. Units are instanced part-meshes (body, legs, arms, ...) animated by matrices, so a
// whole army costs a couple of dozen draw calls. A fog-of-war texture darkens every world material via onBeforeCompile.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise, rng } from '../procgen/noise.js?v=rts2';
import { createRocks } from '../procgen/rocks.js?v=rts2';
import { UT, BT, N, K, WL } from './sim.js?v=rts2';

export const TEAM_COL = [0x2f94ff, 0xff5a2a];
export const CELL = 3.6 / N;                       // metres per map cell at table scale 1
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- tiny geometry kit (vertex colours + team flag)
function prim(g, o = {}) {
  g = g.index ? g.toNonIndexed() : g;
  _e.set(o.rx || 0, o.ry || 0, o.rz || 0); _q.setFromEuler(_e);
  g.applyMatrix4(_m.compose(_p.set(o.x || 0, o.y || 0, o.z || 0), _q, _s.set(o.sx || 1, o.sy || 1, o.sz || 1)));
  const n = g.attributes.position.count, col = new Float32Array(n * 3), tm = new Float32Array(n);
  _c.set(o.team ? 0xffffff : (o.c ?? 0xcccccc));
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; tm[i] = o.team ? 1 : 0; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aTeam', new THREE.BufferAttribute(tm, 1));
  g.deleteAttribute('uv'); _s.set(1, 1, 1);
  return g;
}
const box = (w, h, d, o) => prim(new THREE.BoxGeometry(w, h, d), o);
const cyl = (rt, rb, h, seg, o) => prim(new THREE.CylinderGeometry(rt, rb, h, seg), o);
const sph = (r, o) => prim(new THREE.SphereGeometry(r, 8, 6), o);
const cone = (r, h, seg, o) => prim(new THREE.ConeGeometry(r, h, seg), o);
const merge = (arr) => mergeGeometries(arr, false);

const STEEL = 0xc2c9d4, SKIN = 0xeab792, WOOD = 0x8b5a2b, LEATHER = 0x5d4126, DARK = 0x2e2f38, CLOTH = 0xd8d2bf, HORSE = 0x8a5a38, GOLD = 0xe4b43c;

// part tables: role -> merged geometry, with an optional pivot for the swinging parts
function unitParts(type) {
  const P = {};
  const add = (role, arr, pivot = [0, 0, 0]) => { P[role] = { geo: merge(arr), pivot }; };
  if (type === 'infantry') {
    add('body', [box(0.44, 0.5, 0.3, { y: 0.8, team: 1 }), box(0.46, 0.1, 0.32, { y: 0.55, c: LEATHER }), sph(0.17, { y: 1.22, c: STEEL, sy: 1.1 }), box(0.3, 0.07, 0.3, { y: 1.34, c: STEEL }), cone(0.07, 0.3, 5, { y: 1.5, team: 1 }), sph(0.02, { y: 1.2, z: 0.16, c: DARK })]);
    add('legA', [box(0.17, 0.52, 0.2, { x: -0.12, y: 0.26, c: DARK })], [0, 0.52, 0]); add('legB', [box(0.17, 0.52, 0.2, { x: 0.12, y: 0.26, c: DARK })], [0, 0.52, 0]);
    add('arm', [box(0.12, 0.4, 0.14, { x: 0.28, y: 0.86, c: SKIN }), box(0.06, 0.06, 0.62, { x: 0.28, y: 0.84, z: 0.38, c: STEEL }), box(0.16, 0.05, 0.05, { x: 0.28, y: 0.84, z: 0.1, c: GOLD })], [0.28, 1.02, 0]);
    add('off', [box(0.1, 0.4, 0.14, { x: -0.28, y: 0.86, c: SKIN }), box(0.07, 0.55, 0.42, { x: -0.36, y: 0.84, z: 0.1, team: 1 }), box(0.09, 0.14, 0.14, { x: -0.38, y: 0.84, z: 0.1, c: STEEL })], [-0.28, 1.02, 0]);
  } else if (type === 'ranged') {
    add('body', [cone(0.3, 0.78, 7, { y: 0.55, team: 1, sz: 0.8 }), cone(0.25, 0.8, 7, { y: 0.35, c: LEATHER, sz: 0.8, sx: 0.8 }), sph(0.15, { y: 1.1, c: SKIN }), cone(0.2, 0.34, 7, { y: 1.28, team: 1 }), box(0.1, 0.4, 0.1, { y: 0.9, z: -0.22, c: WOOD, rx: 0.3 })]);
    add('legA', [box(0.13, 0.4, 0.15, { x: -0.1, y: 0.2, c: DARK })], [0, 0.4, 0]); add('legB', [box(0.13, 0.4, 0.15, { x: 0.1, y: 0.2, c: DARK })], [0, 0.4, 0]);
    add('arm', [box(0.1, 0.38, 0.12, { x: 0.24, y: 0.82, z: 0.05, c: SKIN }), box(0.025, 0.025, 0.55, { x: 0.24, y: 0.84, z: 0.35, c: WOOD }), cone(0.04, 0.1, 4, { x: 0.24, y: 0.84, z: 0.66, rx: Math.PI / 2, c: STEEL })], [0.24, 0.98, 0]);
    add('off', [box(0.1, 0.38, 0.12, { x: -0.24, y: 0.82, z: 0.1, c: SKIN }), prim(new THREE.TorusGeometry(0.42, 0.028, 5, 12, Math.PI), { x: -0.24, y: 0.84, z: 0.42, rz: Math.PI / 2, ry: 0, c: WOOD })], [-0.24, 0.98, 0]);
  } else if (type === 'worker') {
    add('body', [box(0.42, 0.42, 0.3, { y: 0.66, c: 0x9a7a4e }), box(0.44, 0.12, 0.32, { y: 0.78, team: 1 }), sph(0.16, { y: 1.04, c: SKIN }), cone(0.3, 0.14, 8, { y: 1.2, c: 0xe3c068 }), cyl(0.15, 0.15, 0.04, 8, { y: 1.15, c: 0xe3c068 })]);
    add('legA', [box(0.16, 0.4, 0.18, { x: -0.1, y: 0.2, c: LEATHER })], [0, 0.4, 0]); add('legB', [box(0.16, 0.4, 0.18, { x: 0.1, y: 0.2, c: LEATHER })], [0, 0.4, 0]);
    add('arm', [box(0.11, 0.34, 0.13, { x: 0.26, y: 0.7, c: SKIN }), box(0.05, 0.05, 0.5, { x: 0.26, y: 0.72, z: 0.25, c: WOOD }), box(0.28, 0.05, 0.07, { x: 0.26, y: 0.72, z: 0.5, c: STEEL })], [0.26, 0.86, 0]);
    add('off', [box(0.11, 0.34, 0.13, { x: -0.26, y: 0.7, c: SKIN })], [-0.26, 0.86, 0]);
    add('cargo', [cone(0.1, 0.24, 5, { x: -0.06, y: 0.82, z: -0.28, c: 0x66e8ff }), cone(0.08, 0.2, 5, { x: 0.07, y: 0.78, z: -0.26, rz: 0.3, c: 0x8af0ff })]);
  } else if (type === 'scout') {
    add('body', [box(0.38, 0.4, 1.0, { y: 0.8, c: HORSE }), box(0.2, 0.26, 0.4, { y: 1.12, z: 0.55, c: HORSE, rx: -0.5 }), box(0.16, 0.16, 0.26, { y: 1.28, z: 0.78, c: HORSE }), box(0.4, 0.06, 0.6, { y: 1.02, z: -0.05, team: 1 }), box(0.34, 0.4, 0.24, { y: 1.28, z: -0.05, team: 1 }), sph(0.15, { y: 1.62, z: -0.03, c: STEEL }), cone(0.07, 0.24, 4, { y: 1.82, z: -0.03, team: 1 }), box(0.08, 0.1, 0.4, { y: 0.8, z: -0.7, c: DARK, rx: 0.4 })]);
    add('legA', [box(0.1, 0.62, 0.12, { x: -0.13, y: 0.31, z: 0.36, c: HORSE }), box(0.1, 0.62, 0.12, { x: 0.13, y: 0.31, z: -0.36, c: HORSE })], [0, 0.62, 0]); add('legB', [box(0.1, 0.62, 0.12, { x: 0.13, y: 0.31, z: 0.36, c: HORSE }), box(0.1, 0.62, 0.12, { x: -0.13, y: 0.31, z: -0.36, c: HORSE })], [0, 0.62, 0]);
    add('arm', [box(0.1, 0.34, 0.12, { x: 0.25, y: 1.3, z: 0.05, c: SKIN }), box(0.04, 0.04, 1.2, { x: 0.28, y: 1.28, z: 0.55, c: WOOD }), box(0.02, 0.2, 0.3, { x: 0.28, y: 1.4, z: 1.0, team: 1 })], [0.25, 1.4, 0]);
  } else if (type === 'siege') {
    add('body', [box(1.0, 0.18, 1.4, { y: 0.5, c: WOOD }), box(0.12, 0.7, 0.12, { x: -0.38, y: 0.85, z: 0.05, c: LEATHER }), box(0.12, 0.7, 0.12, { x: 0.38, y: 0.85, z: 0.05, c: LEATHER }), box(0.9, 0.1, 0.1, { y: 1.2, z: 0.05, c: LEATHER }), box(0.06, 0.55, 0.9, { x: -0.52, y: 0.72, z: 0.1, team: 1 }), box(0.06, 0.55, 0.9, { x: 0.52, y: 0.72, z: 0.1, team: 1 }), box(0.3, 0.3, 0.3, { y: 0.78, z: -0.5, c: 0x7a7f88 })]);
    add('spin', [cyl(0.34, 0.34, 0.1, 10, { x: -0.62, y: 0.34, z: 0.5, rz: Math.PI / 2, c: LEATHER }), cyl(0.34, 0.34, 0.1, 10, { x: 0.62, y: 0.34, z: 0.5, rz: Math.PI / 2, c: LEATHER }), cyl(0.34, 0.34, 0.1, 10, { x: -0.62, y: 0.34, z: -0.5, rz: Math.PI / 2, c: LEATHER }), cyl(0.34, 0.34, 0.1, 10, { x: 0.62, y: 0.34, z: -0.5, rz: Math.PI / 2, c: LEATHER }), box(0.14, 0.14, 0.52, { x: -0.62, y: 0.34, z: 0.5, c: DARK }), box(0.14, 0.14, 0.52, { x: 0.62, y: 0.34, z: -0.5, c: DARK })], [0, 0.34, 0]);
    add('arm', [box(0.16, 0.16, 1.7, { y: 1.2, z: -0.5, c: WOOD }), box(0.5, 0.12, 0.4, { y: 1.18, z: 0.4, c: LEATHER }), sph(0.2, { y: 1.34, z: 0.4, c: 0x7a7f88 }), box(0.36, 0.3, 0.3, { y: 1.1, z: -1.3, c: 0x6b6f78 })], [0, 1.2, 0.05]);
  }
  return P;
}

// ---------------------------------------------------------------- the view
export function createView({ scene, S, renderer, quality = 'high' }) {
  const V = { S, quality, hpOn: true };
  const root = new THREE.Group(); root.name = 'board'; scene.add(root);          // world placement: position (center), yaw, scale
  const content = new THREE.Group(); content.position.set(-N / 2, 0, -N / 2); root.add(content);
  V.root = root; V.content = content;
  const map = S.map;
  const noise = makeNoise(map.seed * 3 + 1);

  // fog texture + shared shader uniforms
  const fogData = new Uint8Array(N * N), fogTex = new THREE.DataTexture(fogData, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  fogTex.magFilter = THREE.LinearFilter; fogTex.minFilter = THREE.LinearFilter; fogTex.wrapS = fogTex.wrapT = THREE.ClampToEdgeWrapping; fogTex.needsUpdate = true;
  const fogF = new Float32Array(N * N).fill(0);
  const FU = { uFog: { value: fogTex }, uInv: { value: new THREE.Matrix4() }, uN: { value: N } };
  function fogify(mat) {
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, FU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFW;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 fwp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          fwp = instanceMatrix * fwp;
          #endif
          vFW = (modelMatrix * fwp).xyz;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFW; uniform sampler2D uFog; uniform mat4 uInv; uniform float uN;')
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
          { vec3 lp = (uInv * vec4(vFW, 1.0)).xyz; float f = texture2D(uFog, lp.xz / uN).r;
            float lum = dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11));
            vec3 dim = mix(vec3(lum), gl_FragColor.rgb, 0.5) * 0.55;
            gl_FragColor.rgb = mix(vec3(0.02, 0.03, 0.05), mix(dim, gl_FragColor.rgb, smoothstep(0.55, 1.0, f)), smoothstep(0.0, 0.4, f)); }`);
    };
    mat.customProgramCacheKey = () => 'fog1';
    return mat;
  }
  V.fogify = fogify;

  // ---------------- lights
  const hemi = new THREE.HemisphereLight(0xdfeaff, 0x6b5a46, 1.05); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.2); sun.position.set(2.2, 4, 1.6);
  sun.castShadow = quality !== 'low'; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.004;
  const sc = sun.shadow.camera; sc.left = -3; sc.right = 3; sc.top = 3; sc.bottom = -3; sc.near = 0.5; sc.far = 14;
  scene.add(sun, sun.target); V.sun = sun;

  // ---------------- terrain
  const R = 2, VX = N * R + 1, geo = new THREE.BufferGeometry();
  const pos = new Float32Array(VX * VX * 3), col = new Float32Array(VX * VX * 3), idx = [];
  const cA = new THREE.Color(0x5f9a3c), cB = new THREE.Color(0x8cb04a), cDirt = new THREE.Color(0x8d6b47), cSand = new THREE.Color(0xcfbf8a), cRock = new THREE.Color(0x80807f), cForest = new THREE.Color(0x3f7330), cFord = new THREE.Color(0xb7a97e), cHigh = new THREE.Color(0xb7c46a);
  for (let j = 0; j < VX; j++) for (let i = 0; i < VX; i++) {
    const x = i / R, z = j / R, h = map.heightAt(Math.min(x, N - 1e-6), Math.min(z, N - 1e-6)), k = (j * VX + i) * 3;
    pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
    const hx = map.heightAt(clamp(x + 0.5, 0, N - 1e-6), z) - map.heightAt(clamp(x - 0.5, 0, N - 1e-6), z), hz = map.heightAt(x, clamp(z + 0.5, 0, N - 1e-6)) - map.heightAt(x, clamp(z - 0.5, 0, N - 1e-6));
    const slope = Math.hypot(hx, hz), n = noise.fbm2(x * 0.5, z * 0.5, { oct: 3 }) * 0.5 + 0.5;
    const cell = map.kind[clamp(Math.floor(z), 0, N - 1) * N + clamp(Math.floor(x), 0, N - 1)];
    _c.copy(cA).lerp(cB, n * 0.9).lerp(cHigh, clamp((h - 2.4) * 0.5, 0, 0.8));
    if (cell === K.FOREST) _c.lerp(cForest, 0.7);
    _c.lerp(cDirt, clamp((slope - 0.45) * 1.4, 0, 0.8));
    if (slope > 1.1) _c.lerp(cRock, 0.5);
    _c.lerp(cSand, clamp(1 - Math.abs(h - WL - 0.12) * 2.4, 0, 0.9) * (h < WL + 0.9 ? 1 : 0));
    if (cell === K.FORD) _c.lerp(cFord, 0.7);
    for (const s of map.starts) { const d = Math.hypot(x - s.x, z - s.z); if (d < 6.5) _c.lerp(new THREE.Color(0xa59468), (1 - d / 6.5) * 0.55); }
    col[k] = _c.r; col[k + 1] = _c.g; col[k + 2] = _c.b;
  }
  for (let j = 0; j < VX - 1; j++) for (let i = 0; i < VX - 1; i++) { const a = j * VX + i; idx.push(a, a + VX, a + 1, a + 1, a + VX, a + VX + 1); }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, fogify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })));
  terrain.receiveShadow = true; terrain.frustumCulled = false; content.add(terrain); V.terrain = terrain;
  // skirt + plinth so the board reads as a slab on a table
  {
    const sk = [], L = [[0, 0, 1, 0], [1, 0, 1, 1], [1, 1, 0, 1], [0, 1, 0, 0]];
    const soil = new THREE.Color(0x6a4b30), soil2 = new THREE.Color(0x4a3524);
    const sp = [], sc2 = [];
    for (const [ax, az, bx, bz] of L) for (let s = 0; s < N * R; s++) {
      const t0 = s / (N * R), t1 = (s + 1) / (N * R), x0 = (ax + (bx - ax) * t0) * N, z0 = (az + (bz - az) * t0) * N, x1 = (ax + (bx - ax) * t1) * N, z1 = (az + (bz - az) * t1) * N;
      const h0 = map.heightAt(Math.min(x0, N - 1e-6), Math.min(z0, N - 1e-6)), h1 = map.heightAt(Math.min(x1, N - 1e-6), Math.min(z1, N - 1e-6)), b = -1.4;
      sp.push(x0, h0, z0, x1, h1, z1, x0, b, z0, x1, h1, z1, x1, b, z1, x0, b, z0);
      for (const hh of [h0, h1, b, h1, b, b]) { const c = hh > 0 ? soil : soil2; _c.copy(soil).lerp(soil2, clamp((0.8 - hh) / 2.2, 0, 1)); sc2.push(_c.r, _c.g, _c.b); }
    }
    const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); g2.setAttribute('color', new THREE.Float32BufferAttribute(sc2, 3)); g2.computeVertexNormals();
    const skirt = new THREE.Mesh(g2, fogify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }))); skirt.receiveShadow = true; skirt.frustumCulled = false; content.add(skirt);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(N + 5, 1.1, N + 5), new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 0.8 }));
    slab.position.set(N / 2, -1.4 - 0.55, N / 2); slab.receiveShadow = true; slab.castShadow = true; content.add(slab); V.slab = slab;
    const rim = new THREE.Mesh(new THREE.BoxGeometry(N + 5, 0.25, N + 5), new THREE.MeshStandardMaterial({ color: 0x6d4b30, roughness: 0.7 })); rim.position.set(N / 2, -1.4 + 0.125 - 0.0, N / 2); rim.visible = false; content.add(rim);
  }

  // ---------------- water
  {
    const seg = 40, wg = new THREE.PlaneGeometry(N, N, seg, seg).rotateX(-Math.PI / 2); wg.translate(N / 2, WL, N / 2);
    const wm = fogify(new THREE.MeshStandardMaterial({ color: 0x3f8fd0, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.72, depthWrite: false }));
    const water = new THREE.Mesh(wg, wm); water.renderOrder = 2; water.receiveShadow = false; content.add(water); V.water = water;
    const wp = wg.attributes.position, base = wp.array.slice();
    V.animWater = (t) => { for (let i = 0; i < wp.count; i++) { const x = base[i * 3], z = base[i * 3 + 2]; wp.array[i * 3 + 1] = WL + Math.sin(x * 0.9 + t * 1.3) * 0.025 + Math.sin(z * 1.1 - t * 1.1) * 0.02; } wp.needsUpdate = true; };
  }

  // ---------------- trees (instanced), rocks (procgen/rocks.js), shrubs
  {
    const pine = merge([cyl(0.06, 0.1, 0.5, 5, { y: 0.25, c: 0x5a3d22 }), cone(0.5, 0.8, 7, { y: 0.9, c: 0xffffff }), cone(0.4, 0.7, 7, { y: 1.35, c: 0xffffff }), cone(0.28, 0.6, 7, { y: 1.8, c: 0xffffff })]);
    const round = merge([cyl(0.07, 0.1, 0.5, 5, { y: 0.25, c: 0x5a3d22 }), sph(0.48, { y: 0.95, c: 0xffffff, sy: 0.9 }), sph(0.33, { y: 1.35, x: 0.12, c: 0xffffff })]);
    const mat = fogify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    const mk = (g, list, tints) => {
      const im = new THREE.InstancedMesh(g, mat, Math.max(1, list.length)); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      list.forEach((t, i) => { _e.set(0, t.y, 0); _q.setFromEuler(_e); _m.compose(_p.set(t.x, map.heightAt(t.x, t.z) - 0.05, t.z), _q, _s.set(t.s, t.s * (0.9 + (i % 5) * 0.06), t.s)); im.setMatrixAt(i, _m); _c.setHex(tints[i % tints.length]); im.setColorAt(i, _c); });
      im.count = list.length; content.add(im); return im;
    };
    mk(pine, map.trees.filter((t) => t.k === 0), [0x2f6b36, 0x3a7a3a, 0x285c35, 0x447f3c]);
    mk(round, map.trees.filter((t) => t.k === 1), [0x5c9a3a, 0x6fa842, 0x4f8a35, 0x86b04a]);
    const rockMat = fogify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, color: 0xb8b5ae }));
    const rg = createRocks({ items: map.rocks.map((r) => ({ ...r, y: map.heightAt(r.x, r.z) - 0.15 })), variants: [{ seed: 3, detail: 2, flatten: 0.8, facets: 6, size: 0.7 }, { seed: 8, detail: 2, flatten: 0.65, facets: 7, size: 0.7 }, { seed: 12, detail: 2, flatten: 0.9, facets: 5, size: 0.7 }], material: rockMat, castShadow: true });
    content.add(rg);
    const pebble = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), fogify(new THREE.MeshStandardMaterial({ color: 0x8c8a84, roughness: 1, flatShading: true })), Math.max(1, map.deco.length));
    map.deco.forEach((d, i) => { _e.set(0, d.yaw, 0); _q.setFromEuler(_e); _m.compose(_p.set(d.x, map.heightAt(d.x, d.z), d.z), _q, _s.set(d.s, d.s * 0.6, d.s)); pebble.setMatrixAt(i, _m); }); pebble.count = map.deco.length; pebble.frustumCulled = false; content.add(pebble);
  }

  // ---------------- crystal nodes
  const crystalGeo = merge([cone(0.34, 1.5, 5, { y: 0.75, c: 0xffffff, rz: 0.1 }), cone(0.26, 1.1, 5, { x: 0.45, y: 0.5, z: 0.1, c: 0xffffff, rz: -0.35 }), cone(0.24, 0.9, 5, { x: -0.4, y: 0.42, z: -0.2, c: 0xffffff, rz: 0.4 }), cone(0.2, 0.7, 5, { x: 0.1, y: 0.35, z: 0.5, c: 0xffffff, rx: 0.4 }), cyl(0.7, 0.8, 0.2, 7, { y: 0.1, c: 0x707078 })]);
  const crystals = new THREE.InstancedMesh(crystalGeo, fogify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.1, emissive: 0x2a9fd6, emissiveIntensity: 0.55, color: 0xffffff })), map.nodes.length);
  crystals.frustumCulled = false; crystals.castShadow = true; content.add(crystals); V.crystals = crystals;
  const nodeCol = new THREE.Color(0x75ddff);
  V.updateNodes = () => { map.nodes.forEach((n, i) => { const f = clamp(n.amount / n.max, 0, 1); _e.set(0, n.id * 1.7, 0); _q.setFromEuler(_e); const s = n.amount <= 0 ? 0.0001 : 0.55 + 0.5 * f; _m.compose(_p.set(n.x, map.heightAt(n.x, n.z) - 0.05, n.z), _q, _s.set(s, s, s)); crystals.setMatrixAt(i, _m); crystals.setColorAt(i, nodeCol); }); crystals.instanceMatrix.needsUpdate = true; crystals.instanceColor.needsUpdate = true; };
  V.updateNodes(); _s.set(1, 1, 1);

  // ---------------- units: instanced parts
  const unitMeshes = {}, MAXU = 130;
  const unitMat = (shared) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05 });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, FU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aTeam;')
        .replace('vColor.xyz *= instanceColor.xyz;', 'vColor.xyz *= mix(vec3(1.0), instanceColor.xyz, aTeam);');
    };
    m.customProgramCacheKey = () => 'unit1';
    return m;
  };
  const uMat = unitMat();
  for (const type of Object.keys(UT)) {
    const parts = unitParts(type), meshes = {};
    for (const [role, p] of Object.entries(parts)) {
      const im = new THREE.InstancedMesh(p.geo, uMat, MAXU); im.count = 0; im.castShadow = quality !== 'low'; im.frustumCulled = false;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXU * 3).fill(1), 3);
      content.add(im); meshes[role] = { im, pivot: p.pivot };
    }
    unitMeshes[type] = meshes;
  }
  // markers under units: team disc + selection ring + hp bars (all instanced)
  const discGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), ringGeo = new THREE.RingGeometry(0.78, 1, 28).rotateX(-Math.PI / 2);
  const basicMat = (o) => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, ...o });
  const mkInst = (g, mat, n) => { const im = new THREE.InstancedMesh(g, mat, n); im.count = 0; im.frustumCulled = false; im.renderOrder = 3; im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3); content.add(im); return im; };
  const discs = mkInst(discGeo, basicMat({ opacity: 0.38 }), MAXU * 2), rings = mkInst(ringGeo, basicMat({ opacity: 0.95 }), MAXU * 2);
  const barGeo = new THREE.PlaneGeometry(1, 1), bars0 = mkInst(barGeo, basicMat({ opacity: 0.85, side: THREE.DoubleSide, depthTest: false }), MAXU * 2), bars1 = mkInst(barGeo, basicMat({ opacity: 1, side: THREE.DoubleSide, depthTest: false }), MAXU * 2);
  bars0.renderOrder = 8; bars1.renderOrder = 9;
  [discs, rings, bars0, bars1].forEach((m) => m.material.fog = false);

  // ---------------- buildings
  const bMeshes = new Map();
  function buildBuilding(b) {
    const g = new THREE.Group(), tc = new THREE.Color(TEAM_COL[b.team]);
    const tmat = new THREE.MeshStandardMaterial({ color: tc, roughness: 0.6 }), mat = (c, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
    const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.rotation.set(rx, ry, rz); me.castShadow = true; me.receiveShadow = true; g.add(me); return me; };
    const stone = mat(0xb9b4a6), dark = mat(0x6e6a62), wood = mat(0x8b5a2b), roof = tmat;
    const s = b.size;
    add(new THREE.BoxGeometry(s, 0.9, s), dark, 0, -0.2, 0);                       // plinth that hides terrain unevenness
    if (b.type === 'hq') {
      add(new THREE.BoxGeometry(s * 0.72, 1.6, s * 0.72), stone, 0, 1.05, 0);
      for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { add(new THREE.CylinderGeometry(0.42, 0.5, 2.3, 8), stone, cx * s * 0.42, 1.0, cz * s * 0.42); add(new THREE.ConeGeometry(0.6, 0.9, 8), roof, cx * s * 0.42, 2.6, cz * s * 0.42); }
      add(new THREE.BoxGeometry(s * 0.5, 0.5, s * 0.5), dark, 0, 2.1, 0);
      for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.28, 0.3, 0.28), stone, (i % 2 - 0.5) * s * 0.46, 2.5, (Math.floor(i / 2) - 0.5) * s * 0.46);
      add(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 5), mat(0x444444), 0, 3.3, 0); add(new THREE.BoxGeometry(0.9, 0.5, 0.05), tmat, 0.46, 3.85, 0);
      add(new THREE.BoxGeometry(0.8, 1.0, 0.1), mat(0x3a2a1c), 0, 0.5, s * 0.36 * (b.team === 0 ? 1 : -1));
    } else if (b.type === 'barracks') {
      add(new THREE.BoxGeometry(s * 0.88, 1.2, s * 0.8), mat(0xc9bda0), 0, 0.65, 0);
      add(new THREE.CylinderGeometry(s * 0.58, s * 0.58, s * 0.95, 3), roof, 0, 1.55, 0, 0, 0, Math.PI / 2).rotation.set(Math.PI / 2, 0, Math.PI / 2);
      add(new THREE.BoxGeometry(0.7, 0.9, 0.1), mat(0x3a2a1c), 0, 0.45, s * 0.41 * (b.team === 0 ? 1 : -1));
      add(new THREE.BoxGeometry(0.1, 0.8, 0.1), wood, s * 0.5, 0.5, 0.4); add(new THREE.BoxGeometry(0.05, 0.8, 0.5), mat(0xaab0bb), s * 0.5, 1.0, 0.4);
      add(new THREE.BoxGeometry(0.05, 0.3, 0.4), tmat, s * 0.46, 1.4, -0.4);
    } else {
      add(new THREE.BoxGeometry(s * 0.7, 0.9, s * 0.7), wood, 0, 0.6, 0); add(new THREE.BoxGeometry(s * 0.45, 0.6, s * 0.45), mat(0xa6753a), 0.1, 1.35, -0.1);
      add(new THREE.BoxGeometry(s * 0.76, 0.1, s * 0.76), tmat, 0, 1.08, 0);
      add(new THREE.ConeGeometry(0.22, 0.7, 5), new THREE.MeshStandardMaterial({ color: 0x75ddff, emissive: 0x2a9fd6, emissiveIntensity: 0.5, roughness: 0.2 }), 0, 1.95, -0.1);
    }
    g.traverse((o) => { if (o.material && !o.material.userData.fog) { o.material.userData.fog = 1; fogify(o.material); } });
    g.position.set(b.x, b.y - 0.2, b.z); g.userData.b = b; content.add(g); return g;
  }

  // ---------------- effects: projectiles, sparks, puffs, markers, path lines
  const fx = { proj: [], puffs: [], marks: [], flash: [] };
  const projGeo = new THREE.SphereGeometry(0.12, 6, 4), projMesh = new THREE.InstancedMesh(projGeo, basicMat({ opacity: 1, color: 0xfff1c0 }), 48); projMesh.count = 0; projMesh.frustumCulled = false; projMesh.renderOrder = 6; content.add(projMesh);
  const puffMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), basicMat({ opacity: 0.38, color: 0xd8d0c0 }), 80); puffMesh.count = 0; puffMesh.frustumCulled = false; puffMesh.renderOrder = 5; content.add(puffMesh);
  const spark = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), basicMat({ opacity: 0.8, color: 0xffd9a0 }), 80); spark.count = 0; spark.frustumCulled = false; spark.renderOrder = 6; content.add(spark);
  const markGeo = new THREE.RingGeometry(0.55, 0.75, 24).rotateX(-Math.PI / 2), markMesh = new THREE.InstancedMesh(markGeo, basicMat({ opacity: 0.9 }), 12); markMesh.count = 0; markMesh.frustumCulled = false; markMesh.renderOrder = 6;
  markMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(12 * 3).fill(1), 3); content.add(markMesh);
  const flagGeo = new THREE.ConeGeometry(0.25, 1.1, 4), flagMesh = new THREE.InstancedMesh(flagGeo, basicMat({ opacity: 0.9 }), 12); flagMesh.count = 0; flagMesh.frustumCulled = false; flagMesh.renderOrder = 6;
  flagMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(12 * 3).fill(1), 3); content.add(flagMesh);
  const lineGeo = new THREE.BufferGeometry(), linePos = new Float32Array(3 * 2 * 1500); lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3)); lineGeo.setDrawRange(0, 0);
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x9dffb0, transparent: true, opacity: 0.8, depthTest: false, toneMapped: false })); lines.frustumCulled = false; lines.renderOrder = 7; content.add(lines);
  // generic overlay slot for the input layer (drag box / lasso / build ghost / brush)
  const overlayGroup = new THREE.Group(); content.add(overlayGroup); V.overlay = overlayGroup;
  const dragLine = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false })); dragLine.frustumCulled = false; dragLine.renderOrder = 10; dragLine.visible = false; overlayGroup.add(dragLine);
  V.setDragShape = (pts) => {                                // pts: [{x,z}] ground polygon, or null
    if (!pts || pts.length < 2) { dragLine.visible = false; return; }
    const a = new Float32Array(pts.length * 3); pts.forEach((p, i) => { a[i * 3] = p.x; a[i * 3 + 1] = map.heightAt(p.x, p.z) + 0.15; a[i * 3 + 2] = p.z; });
    dragLine.geometry.dispose(); dragLine.geometry = new THREE.BufferGeometry(); dragLine.geometry.setAttribute('position', new THREE.BufferAttribute(a, 3)); dragLine.visible = true;
  };
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false })); ghost.visible = false; ghost.renderOrder = 9; overlayGroup.add(ghost);
  V.setGhost = (type, cx, cz, ok) => { if (!type) { ghost.visible = false; return; } const s = BT[type].size; ghost.visible = true; ghost.scale.set(s, 1.6, s); ghost.position.set(cx + s / 2, map.heightAt(cx + s / 2, cz + s / 2) + 0.8, cz + s / 2); ghost.material.color.setHex(ok ? 0x66ff88 : 0xff6666); };
  const hand = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: 0x9dffb0, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false })); hand.visible = false; hand.renderOrder = 9; overlayGroup.add(hand);
  V.setBrush = (p, r) => { if (!p) { hand.visible = false; return; } hand.visible = true; hand.position.set(p.x, p.y, p.z); hand.scale.setScalar(r); };

  V.addMarker = (x, z, kind) => { fx.marks.push({ x, z, t: 0, kind }); if (fx.marks.length > 12) fx.marks.shift(); };
  V.pathUnits = [];                                                          // units whose paths are previewed
  const shake = { t: 0 };
  V.handleEvents = (evs, opts = {}) => {
    for (const e of evs) {
      if (e.k === 'shot') {
        if (e.ranged && fx.proj.length < 48) fx.proj.push({ x0: e.x, z0: e.z, x1: e.tx, z1: e.tz, t: 0, d: e.type === 'siege' ? 0.7 : 0.25, arc: e.type === 'siege' ? 1.8 : 0.4, big: e.type === 'siege' });
        else if (!e.ranged && fx.flash.length < 24) fx.flash.push({ x: e.tx, z: e.tz, t: 0 });
      } else if (e.k === 'hit') { if (fx.flash.length < 30 && !opts.calm) fx.flash.push({ x: e.x, z: e.z, t: 0, s: 1 }); }
      else if (e.k === 'die') {
        const n = e.b ? 8 : 2;
        for (let i = 0; i < n && fx.puffs.length < 76; i++) fx.puffs.push({ x: e.x + (Math.random() - 0.5) * (e.b ? e.size : 0.6), z: e.z + (Math.random() - 0.5) * (e.b ? e.size : 0.6), y: 0.3, t: 0, d: e.b ? 1.4 : 0.8, r: e.b ? 0.9 : 0.4 });
        V.dying.push({ type: e.type, team: e.team, x: e.x, z: e.z, t: 0, b: e.b, size: e.size, id: e.id });
      }
    }
  };
  V.dying = [];

  // ---------------- per-frame update
  const camQ = new THREE.Quaternion(), invRoot = new THREE.Quaternion();
  const sel = new Set();
  V.sel = sel; V.hover = 0;
  V.tmp = { alertPulse: 0 };
  const hpColor = new THREE.Color();
  V.update = (dt, time, camera, opts = {}) => {
    const { selected = sel, team = 0, calm = false, hoverId = 0 } = opts;
    root.updateMatrixWorld(true); FU.uInv.value.copy(content.matrixWorld).invert();
    camera.getWorldQuaternion(camQ); root.getWorldQuaternion(invRoot); invRoot.invert(); camQ.premultiply(invRoot);    // camera orientation in board space
    // fog texture, eased
    const vis = S.vis[team];
    for (let q = 0; q < N * N; q++) { const target = !S.fogOn ? 1 : vis[q] === 2 ? 1 : vis[q] === 1 ? 0.5 : 0; fogF[q] += (target - fogF[q]) * Math.min(1, dt * 6); fogData[q] = Math.round(fogF[q] * 255); }
    fogTex.needsUpdate = true;
    if (!calm) V.animWater(time);
    // buildings
    for (const [id, g] of bMeshes) if (!S.get(id)) { content.remove(g); bMeshes.delete(id); }
    let bi = 0, ui = 0, ri = 0, di = 0, hb = 0;
    const setBar = (x, y, z, w, f, fillCol) => {
      if (hb >= MAXU * 2) return;
      _p.set(x, y, z); _s.set(w, 0.13, 1); _m.compose(_p, camQ, _s); bars0.setMatrixAt(hb, _m); _c.setHex(0x101418); bars0.setColorAt(hb, _c);
      _p.set(x - (w * (1 - f)) / 2, y, z); _s.set(Math.max(0.001, w * f), 0.09, 1); _m.compose(_p, camQ, _s); bars1.setMatrixAt(hb, _m); bars1.setColorAt(hb, fillCol); hb++;
    };
    for (const b of S.buildings()) {
      let g = bMeshes.get(b.id); if (!g) { g = buildBuilding(b); bMeshes.set(b.id, g); }
      const seen = b.team === team || vis[Math.floor(b.z) * N + Math.floor(b.x)] >= 1 || !S.fogOn;
      g.visible = seen; g.scale.y = b.built ? 1 : 0.2 + 0.8 * b.progress; g.position.y = b.y - 0.2;
      if (b.hitT > 0) g.position.x = b.x + Math.sin(time * 90) * 0.012; else g.position.x = b.x;
      if (seen && (selected.has(b.id) || b.hp < b.maxhp || !b.built)) {
        const f = b.built ? b.hp / b.maxhp : b.progress; hpColor.setHex(!b.built ? 0xffd24a : b.team === team ? 0x58e06a : 0xff5a4a);
        setBar(b.x, b.y + 3.2 * (b.type === 'hq' ? 1.35 : 0.7), b.z, b.size * 0.9, clamp(f, 0.001, 1), hpColor);
        if (selected.has(b.id)) { _p.set(b.x, b.y + 0.08, b.z); _s.set(b.size * 0.78, 1, b.size * 0.78); _q.identity(); _m.compose(_p, _q, _s); if (ri < rings.instanceMatrix.count) { rings.setMatrixAt(ri, _m); _c.setHex(0x7dffb0); rings.setColorAt(ri, _c); ri++; } }
      }
    }
    // units -> instance slots
    const counts = {};
    for (const type of Object.keys(UT)) counts[type] = 0;
    const pulse = 0.85 + 0.15 * Math.sin(time * 5);
    for (const u of S.units()) {
      const seen = u.team === team || !S.fogOn || vis[Math.floor(u.z) * N + Math.floor(u.x)] === 2;
      if (!seen) continue;
      const k = counts[u.type]++; if (k >= MAXU) continue;
      const y = map.heightAt(u.x, u.z), parts = unitMeshes[u.type], atk = u.atkT > 0, moving = u.moving, ph = u.at * 3.1, idleB = Math.sin(time * 2 + u.id) * 0.012;
      const selected_ = selected.has(u.id), hover = hoverId === u.id;
      const swing = moving ? Math.sin(ph) : 0, bob = moving ? Math.abs(Math.sin(ph)) * 0.07 : idleB, lunge = atk ? Math.sin((1 - u.atkT / 0.35) * Math.PI) : 0;
      const sinkY = 0;
      _e.set(lunge * 0.18 * (u.type === 'siege' ? 0 : 1), u.face, 0, 'YXZ'); _q.setFromEuler(_e);
      const base = _m2.compose(_p.set(u.x, y + bob + sinkY, u.z), _q, _s.set(1, 1, 1));
      const hitMix = u.hitT > 0 ? clamp(u.hitT / 0.25, 0, 1) * 0.5 : 0;
      const tint = _c.setHex(TEAM_COL[u.team]); if (selected_) tint.multiplyScalar(1.9 * pulse); else if (hover) tint.multiplyScalar(1.4); if (hitMix) tint.lerp(new THREE.Color(1.4, 1.4, 1.4), hitMix);
      for (const [role, pm] of Object.entries(parts)) {
        let ang = 0, show = true;
        if (role === 'legA') ang = swing * 0.8; else if (role === 'legB') ang = -swing * 0.8;
        else if (role === 'arm') ang = atk ? -1.6 * Math.sin((1 - u.atkT / 0.35) * Math.PI) + 0.2 : moving ? -swing * 0.5 : Math.sin(time * 1.5 + u.id) * 0.04;
        else if (role === 'off') ang = moving ? swing * 0.5 : 0;
        else if (role === 'spin') ang = u.at * 2.6;
        else if (role === 'cargo') show = u.carry > 0;
        if (u.type === 'siege' && role === 'arm') ang = atk ? 1.9 * Math.sin((1 - u.atkT / 0.35) * Math.PI) - 0.5 : -0.5;
        if (u.type === 'worker' && role === 'arm' && u.order.t === 'gather' && u.order.ph === 'mine') ang = -0.9 * Math.abs(Math.sin(time * 5 + u.id));
        if (u.type === 'worker' && role === 'arm' && u.order.t === 'build') ang = -0.9 * Math.abs(Math.sin(time * 6 + u.id));
        const piv = pm.pivot;
        if (ang !== 0) { _e.set(ang, 0, 0); _q.setFromEuler(_e); _m.compose(_p.set(piv[0], piv[1], piv[2]), _q, _s.set(1, 1, 1)); _m.multiply(_m2.clone().identity().makeTranslation(-piv[0], -piv[1], -piv[2])); _m.premultiply(base); }
        else _m.copy(base);
        if (!show) _m.scale(_s.set(0.0001, 0.0001, 0.0001));
        pm.im.setMatrixAt(k, _m); pm.im.setColorAt(k, tint);
      }
      // disc + ring + bars
      if (di < MAXU * 2) { _q.identity(); _m.compose(_p.set(u.x, y + 0.04, u.z), _q, _s.set(u.r * 1.15, 1, u.r * 1.15)); discs.setMatrixAt(di, _m); _c.setHex(TEAM_COL[u.team]); discs.setColorAt(di, _c); di++; }
      if ((selected_ || hover) && ri < MAXU * 2) { _q.identity(); const rs = u.r * 1.55 * (selected_ ? 1 : 1.2); _m.compose(_p.set(u.x, y + 0.07, u.z), _q, _s.set(rs, 1, rs)); rings.setMatrixAt(ri, _m); _c.setHex(selected_ ? 0x7dffb0 : 0xffffff); if (selected_) _c.multiplyScalar(pulse * 1.4); rings.setColorAt(ri, _c); ri++; }
      if (u.hp < u.maxhp || selected_ || hover) { hpColor.setHex(u.team === team ? 0x58e06a : 0xff5a4a); if (u.hp / u.maxhp < 0.35) hpColor.setHex(0xffc23a); setBar(u.x, y + (u.type === 'scout' ? 2.2 : u.type === 'siege' ? 1.9 : 1.75), u.z, 0.95, clamp(u.hp / u.maxhp, 0.001, 1), hpColor); }
    }
    for (const type of Object.keys(UT)) for (const pm of Object.values(unitMeshes[type])) { const n = Math.min(MAXU, counts[type]); pm.im.count = n; pm.im.instanceMatrix.needsUpdate = true; if (pm.im.instanceColor) pm.im.instanceColor.needsUpdate = true; }
    for (const [im, n] of [[discs, di], [rings, ri], [bars0, hb], [bars1, hb]]) { im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    V.updateNodes();
    // dying units fade as puffs only (kept simple); projectiles
    let pn = 0;
    for (let i = fx.proj.length - 1; i >= 0; i--) { const p = fx.proj[i]; p.t += dt; if (p.t >= p.d) fx.proj.splice(i, 1); }
    for (const p of fx.proj) { const f = p.t / p.d, x = lerp(p.x0, p.x1, f), z = lerp(p.z0, p.z1, f), y = lerp(map.heightAt(p.x0, p.z0), map.heightAt(p.x1, p.z1), f) + 1.0 + Math.sin(f * Math.PI) * p.arc; _q.identity(); _m.compose(_p.set(x, y, z), _q, _s.set(p.big ? 1.7 : 1, p.big ? 1.7 : 1, p.big ? 1.7 : 1)); projMesh.setMatrixAt(pn++, _m); }
    projMesh.count = pn; projMesh.instanceMatrix.needsUpdate = true;
    let sn = 0;
    for (let i = fx.flash.length - 1; i >= 0; i--) { const f = fx.flash[i]; f.t += dt; if (f.t > 0.22) fx.flash.splice(i, 1); }
    for (const f of fx.flash) { const k = 1 - f.t / 0.22; _q.setFromEuler(_e.set(f.t * 9, f.t * 7, 0)); _m.compose(_p.set(f.x, map.heightAt(f.x, f.z) + 0.9, f.z), _q, _s.set(0.13 * k + 0.02, 0.13 * k + 0.02, 0.13 * k + 0.02)); spark.setMatrixAt(sn++, _m); }
    spark.count = sn; spark.instanceMatrix.needsUpdate = true;
    let pu = 0;
    for (let i = fx.puffs.length - 1; i >= 0; i--) { const p = fx.puffs[i]; p.t += dt; if (p.t >= p.d) fx.puffs.splice(i, 1); }
    for (const p of fx.puffs) { const f = p.t / p.d, r = p.r * (0.4 + f), y = map.heightAt(p.x, p.z) + 0.3 + f * 0.9; _q.identity(); _m.compose(_p.set(p.x, y, p.z), _q, _s.set(r, r * 0.8, r)); puffMesh.setMatrixAt(pu++, _m); }
    puffMesh.count = pu; puffMesh.instanceMatrix.needsUpdate = true; puffMesh.material.opacity = 0.34;
    // markers
    let mn = 0;
    for (let i = fx.marks.length - 1; i >= 0; i--) { fx.marks[i].t += dt; if (fx.marks[i].t > 1.6) fx.marks.splice(i, 1); }
    for (const m of fx.marks) {
      const f = m.t / 1.6, s = (1.1 - f * 0.5 + (m.t < 0.25 ? (0.25 - m.t) * 2 : 0)) * (m.kind === 'attack' ? 1.2 : 1), y = map.heightAt(m.x, m.z);
      _q.identity(); _m.compose(_p.set(m.x, y + 0.08, m.z), _q, _s.set(s, 1, s)); markMesh.setMatrixAt(mn, _m);
      _c.setHex(m.kind === 'attack' ? 0xff6a5a : m.kind === 'gather' ? 0x6fe8ff : 0x7dffb0).multiplyScalar(1 - f * 0.6); markMesh.setColorAt(mn, _c);
      _q.setFromEuler(_e.set(Math.PI, 0, 0)); _m.compose(_p.set(m.x, y + 1.2 + Math.sin(m.t * 6) * 0.1, m.z), _q, _s.set(0.5, 0.5, 0.5)); flagMesh.setMatrixAt(mn, _m); flagMesh.setColorAt(mn, _c); mn++;
    }
    markMesh.count = mn; flagMesh.count = mn; [markMesh, flagMesh].forEach((m) => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    // path preview for selected units
    let ln = 0;
    for (const id of selected) {
      const u = S.get(id); if (!u || u.isB || !u.path || u.team !== team) continue;
      let px = u.x, pz = u.z;
      for (let i = u.pi; i < u.path.length && ln < 1490; i++) { const w = u.path[i]; linePos.set([px, map.heightAt(px, pz) + 0.2, pz, w.x, map.heightAt(w.x, w.z) + 0.2, w.z], ln * 6); ln++; px = w.x; pz = w.z; }
    }
    lineGeo.setDrawRange(0, ln * 2); lineGeo.attributes.position.needsUpdate = true; lines.visible = ln > 0;
  };

  // ---------------- board placement + picking
  V.setBoard = (pos, yaw, s) => {
    root.position.copy(pos); root.rotation.y = yaw; root.scale.setScalar(CELL * s); root.updateMatrixWorld(true);
    const k = Math.max(1, s * 0.8);
    sun.target.position.copy(pos); sun.position.set(pos.x + 2.2 * k, pos.y + 4.2 * k, pos.z + 1.6 * k);
    const ext = Math.min(30, 2.4 * s + 0.8); sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 0.5; sc.far = 14 * k + 6; sc.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
  };
  const _inv = new THREE.Matrix4(), _o = new THREE.Vector3(), _d = new THREE.Vector3();
  V.toLocal = (v) => { _inv.copy(content.matrixWorld).invert(); return v.clone().applyMatrix4(_inv); };
  V.toWorld = (v) => v.clone().applyMatrix4(content.matrixWorld);
  V.localRay = (origin, dir) => { _inv.copy(content.matrixWorld).invert(); const o = origin.clone().applyMatrix4(_inv), d = dir.clone().transformDirection(_inv); return { o, d }; };   // d normalized (uniform scale only)
  function groundT(o, d, maxT = 400) {
    let t = 0, prevAbove = true;
    for (; t < maxT; t += 0.2) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (x < 0 || z < 0 || x > N || z > N) { if (d.y >= 0 && y > 12) return null; continue; }
      if (y <= map.heightAt(x, z)) {
        let a = Math.max(0, t - 0.2), b = t;
        for (let i = 0; i < 7; i++) { const m = (a + b) / 2, h = map.heightAt(o.x + d.x * m, o.z + d.z * m); if (o.y + d.y * m <= h) b = m; else a = m; }
        return b;
      }
    }
    return null;
  }
  const sphereT = (o, d, c, r) => { const mx = o.x - c.x, my = o.y - c.y, mz = o.z - c.z, b = mx * d.x + my * d.y + mz * d.z, cc = mx * mx + my * my + mz * mz - r * r; if (cc > 0 && b > 0) return null; const disc = b * b - cc; if (disc < 0) return null; const t = -b - Math.sqrt(disc); return t < 0 ? 0 : t; };
  // pick(o, d, {team, pad}) in BOARD-LOCAL space -> {kind, t, x, z, y, ent?, node?}
  V.pick = (o, d, { team = 0, pad = 0, units = true } = {}) => {
    let best = null;
    const consider = (t, kind, ent, node) => { if (t != null && (!best || t < best.t)) best = { t, kind, ent, node }; };
    if (units) for (const u of S.units()) {
      if (u.team !== team && S.fogOn && S.vis[team][Math.floor(u.z) * N + Math.floor(u.x)] !== 2) continue;
      consider(sphereT(o, d, { x: u.x, y: map.heightAt(u.x, u.z) + 0.75, z: u.z }, Math.max(0.78, u.r + 0.32) + pad), 'unit', u);
    }
    for (const b of S.buildings()) {
      if (b.team !== team && S.fogOn && S.vis[team][Math.floor(b.z) * N + Math.floor(b.x)] < 1) continue;
      consider(sphereT(o, d, { x: b.x, y: b.y + 1.0, z: b.z }, b.size * 0.62 + pad), 'bld', b);
    }
    for (const n of map.nodes) if (n.amount > 0 && (!S.fogOn || S.vis[team][Math.floor(n.z) * N + Math.floor(n.x)] >= 1)) consider(sphereT(o, d, { x: n.x, y: map.heightAt(n.x, n.z) + 0.6, z: n.z }, 0.95 + pad), 'node', null, n);
    const gt = groundT(o, d);
    if (best && (gt == null || best.t <= gt + 0.8)) { const x = o.x + d.x * best.t, z = o.z + d.z * best.t; return { ...best, x: best.ent ? best.ent.x : best.node ? best.node.x : x, z: best.ent ? best.ent.z : best.node ? best.node.z : z, gx: gt != null ? o.x + d.x * gt : null, gz: gt != null ? o.z + d.z * gt : null }; }
    if (gt == null) return null;
    const x = o.x + d.x * gt, z = o.z + d.z * gt;
    return { kind: 'ground', t: gt, x: clamp(x, 0.5, N - 0.5), z: clamp(z, 0.5, N - 0.5), gx: x, gz: z };
  };
  V.ground = (o, d) => { const t = groundT(o, d); if (t == null) return null; return { x: o.x + d.x * t, z: o.z + d.z * t, t }; };
  V.setQuality = (q) => { sun.castShadow = q < 1; };
  V.dispose = () => { scene.remove(root, hemi, sun, sun.target); root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); };
  return V;
}
