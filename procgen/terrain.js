// ============================ procgen/terrain.js — heightfield, blended ground, near-field detail ============================
//
//   import { createHeightfield, createTerrain, createGrass, createFerns, createLogs } from '../procgen/terrain.js';
//
//   const hf = createHeightfield({ seed: 5,
//       base:   { amp: 6,  freq: 0.004, oct: 5 },           // rolling relief
//       detail: { amp: 0.6, freq: 0.09 },                   // small bumps
//       ridge:  { amp: 14, freq: 0.0022, carve: 0.35 },     // ridged noise; carve>0 cuts erosion-like valleys along its creases
//       features: [ { type: 'hill', x, z, h: 62, r: 150 }, { type: 'basin', x, z, h: 8, r: 70 } ],
//       flats: [ { x, z, r0: 3, r1: 24 } ],                 // levelled seats: terrain is blended to the height at (x,z) inside r0, free beyond r1
//       post: (x, z, h) => h                                // optional final shaping (lake basins, …)
//   });
//   hf.height(x, z); hf.slope(x, z) // 0 flat … 1 vertical (1 − normal.y)
//
//   const terrain = createTerrain({ hf, maps: { litter, grass, soil, rock }, radius: 1250, env… });   // polar mesh: dense near the centre
//   terrain.rebuild(cx, cz);       // re-centre the mesh on a viewpoint (fast); terrain.material is a MeshStandardMaterial
//   // ground material = slope/height/noise-blended litter | grass | soil | rock albedo, one shared normal map, anti-tiling
//
//   const grass = createGrass({ hf, count: 6000, radius: 28, height: [0.25, 0.6], colors }); grass.layout(cx, cz, { exclude })
//   const ferns = createFerns({ hf, atlas, count: 300, radius: 40 });                         ferns.layout(cx, cz)
//   const logs  = createLogs({ hf, barkMaps, items: [{ x, z, len, r, yaw }] })
//
// Everything is deterministic from the seed and the numbers above.
// =============================================================================================================

import * as THREE from 'three';
import { rng, makeNoise } from './noise.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

export function createHeightfield({ seed = 1, base = {}, detail = {}, ridge = {}, features = [], flats = [], post = null } = {}) {
  const N = makeNoise(seed * 3 + 1), B = { amp: 6, freq: 0.004, oct: 5, ...base }, D = { amp: 0.6, freq: 0.09, ...detail }, Rg = { amp: 0, freq: 0.002, carve: 0, ...ridge };
  const raw = (x, z) => {
    let h = N.fbm2(x * B.freq + 7, z * B.freq + 2, { oct: B.oct }) * B.amp + N.fbm2(x * D.freq, z * D.freq, { oct: 3 }) * D.amp;
    if (Rg.amp) { const r = N.ridged2(x * Rg.freq + 20, z * Rg.freq + 9, { oct: 4 }); h += (r - 0.5) * Rg.amp; if (Rg.carve) h -= Rg.carve * Rg.amp * Math.pow(1 - r, 3); }
    for (const f of features) { const d = Math.hypot(x - f.x, z - f.z) / f.r; h += (f.type === 'basin' ? -f.h : f.h) * Math.exp(-d * d); }
    return h;
  };
  const fl = flats.map(f => ({ ...f, base: raw(f.x, f.z) }));
  const height = (x, z) => {
    let h = raw(x, z);
    for (const f of fl) { const m = sstep(f.r0, f.r1, Math.hypot(x - f.x, z - f.z)); h = f.base + (h - f.base) * m; }
    return post ? post(x, z, h) : h;
  };
  const slope = (x, z) => { const e = 1.2, dx = height(x + e, z) - height(x - e, z), dz = height(x, z + e) - height(x, z - e); const nx = -dx / (2 * e), nz = -dz / (2 * e); return 1 - 1 / Math.sqrt(nx * nx + 1 + nz * nz); };
  return { height, slope, raw };
}

// ---------------------------------------------------------------- terrain mesh + blended PBR ground
export function createTerrain({ hf, maps, radius = 1250, sectors = 176, seed = 1, tile = [0.3, 0.26, 0.28, 0.2], tints = {}, extraWeights = null }) {
  const N = makeNoise(seed * 5 + 2), radii = [0];
  for (let r = 0; r < radius;) { r += 1.6 + 0.045 * r; radii.push(Math.min(r, radius)); }
  const NR = radii.length, K = sectors, count = NR * K;
  const pos = new Float32Array(count * 3), mixA = new Float32Array(count * 4), tint = new Float32Array(count * 3), uv = new Float32Array(count * 2), idx = [];
  for (let i = 0; i < NR - 1; i++) for (let k = 0; k < K; k++) { const a = i * K + k, b = i * K + (k + 1) % K, c = (i + 1) * K + k, d = (i + 1) * K + (k + 1) % K; idx.push(a, b, c, b, d, c); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aMix', new THREE.BufferAttribute(mixA, 4)); geo.setAttribute('color', new THREE.BufferAttribute(tint, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const u = { uA: { value: maps.litter.map }, uB: { value: maps.grass.map }, uC: { value: maps.soil.map }, uD: { value: maps.rock.map }, uTile: { value: new THREE.Vector4(...tile) } };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, normalMap: maps.litter.normalMap, roughnessMap: maps.litter.roughnessMap, roughness: 1, metalness: 0 });
  for (const m of [maps.litter.normalMap, maps.litter.roughnessMap]) m.repeat.set(1, 1);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute vec4 aMix; varying vec4 vMix; varying vec3 vWp;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vMix = aMix; vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = `uniform sampler2D uA, uB, uC, uD; uniform vec4 uTile; varying vec4 vMix; varying vec3 vWp;
      vec3 splat(sampler2D t, float s){ vec2 p = vWp.xz * s; vec3 a = texture2D(t, p).rgb; vec3 b = texture2D(t, mat2(0.8, 0.6, -0.6, 0.8) * p * 0.37 + 0.31).rgb; float c = texture2D(t, p * 3.7 + 0.13).g; return mix(a, b, 0.42) * (0.62 + 0.9 * c) * 1.1; }\n` + sh.fragmentShader.replace('#include <map_fragment>', `
      vec3 gcol = splat(uA, uTile.x) * vMix.x + splat(uB, uTile.y) * vMix.y + splat(uC, uTile.z) * vMix.z + splat(uD, uTile.w) * vMix.w;
      diffuseColor.rgb *= gcol;`);
  };
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.receiveShadow = true;
  const t0 = new THREE.Color(), tb = new THREE.Color();
  function rebuild(cx, cz) {
    for (let i = 0; i < NR; i++) for (let k = 0; k < K; k++) {
      const j = i * K + k, th = (k / K) * Math.PI * 2, x = cx + Math.cos(th) * radii[i], z = cz + Math.sin(th) * radii[i], h = hf.height(x, z);
      pos[j * 3] = x; pos[j * 3 + 1] = h; pos[j * 3 + 2] = z; uv[j * 2] = x * 0.25; uv[j * 2 + 1] = z * 0.25;
      const sl = hf.slope(x, z), n1 = N.fbm2(x * 0.02, z * 0.02, { oct: 3 }), n2 = N.fbm2(x * 0.07 + 30, z * 0.07, { oct: 2 }), n3 = N.fbm2(x * 0.004 + 9, z * 0.004, { oct: 2 });
      let wl = 0.65 + 0.5 * n1, wg = 0.25 + 0.6 * n2 + 0.25 * n3, wsoil = 0.2 + 0.5 * Math.max(0, -n1), wr = sstep(0.28, 0.5, sl + 0.1 * n2);
      const ex = extraWeights ? extraWeights(x, z, h, sl) : null; if (ex) { wl *= ex.litter ?? 1; wg *= ex.grass ?? 1; wsoil *= ex.soil ?? 1; wr *= ex.rock ?? 1; }
      wl = Math.max(0.02, wl); wg = Math.max(0.02, wg); wsoil = Math.max(0.02, wsoil); wr = Math.max(0, wr);   // signed noise can dip below zero: weights must stay positive
      const s = wl + wg + wsoil + wr * 3 + 1e-4; wl /= s; wg /= s; wsoil /= s; wr = wr * 3 / s;
      mixA[j * 4] = wl; mixA[j * 4 + 1] = wg; mixA[j * 4 + 2] = wsoil; mixA[j * 4 + 3] = wr;
      const v = 0.82 + 0.28 * (0.5 + 0.5 * n1 * 1.4); tb.setRGB(v * (tints.r ?? 1), v * (tints.g ?? 1), v * (tints.b ?? 0.95));
      if (tints.fn) tints.fn(x, z, h, sl, tb); tint[j * 3] = tb.r; tint[j * 3 + 1] = tb.g; tint[j * 3 + 2] = tb.b;
    }
    for (const a of ['position', 'aMix', 'color', 'uv']) geo.attributes[a].needsUpdate = true; geo.computeVertexNormals();
  }
  return { mesh, material: mat, rebuild, uniforms: u };
}

// ---------------------------------------------------------------- near-field grass blades (instanced, curved, wind)
export function createGrass({ hf, count = 6000, radius = 28, height = [0.25, 0.6], seed = 1, colors = { lo: 0x3f6a22, mid: 0x7fa645, hi: 0xc3cc72 }, windU = null }) {
  const R = rng(seed * 11 + 3), bg = new THREE.BufferGeometry(), seg = 4, w = 0.03, pos = [], nor = [], col = [], idx = [], sway = [];
  const lo = new THREE.Color(colors.lo), mid = new THREE.Color(colors.mid), hi = new THREE.Color(colors.hi), c = new THREE.Color();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, y = t, z = t * t * 0.35, half = w * (1 - t * 0.92) * 0.5;
    c.copy(t < 0.5 ? lo.clone().lerp(mid, t * 2) : mid.clone().lerp(hi, (t - 0.5) * 2));
    for (const s of [-1, 1]) { pos.push(s * half, y, z); nor.push(0, 0.85, 0.5); col.push(c.r, c.g, c.b); sway.push(t); }
    if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); bg.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1)); bg.setIndex(idx);
  const uTime = windU?.uTime || { value: 0 }, mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = 'uniform float uTime; attribute float aSway;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float ph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.5; float gs = 0.55 + 0.45 * sin(uTime * 0.27 + ph * 0.1);
      float sw = aSway * aSway * 0.22 * gs * (sin(uTime * 1.3 + ph) * 0.7 + sin(uTime * 2.3 + ph * 2.0) * 0.3);
      transformed.x += sw; transformed.z += sw * 0.5;`);
    sh.fragmentShader = sh.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
  };
  const mesh = new THREE.InstancedMesh(bg, mat, count); mesh.frustumCulled = false; mesh.receiveShadow = true; const o = new THREE.Object3D(); let full = 0;
  return {
    mesh, material: mat,
    layout(cx, cz, { exclude = null, minR = 0.15 } = {}) {
      let k = 0, tries = 0; const r2 = rng(seed + Math.floor(cx * 3 + cz * 7));
      while (k < count && tries++ < count * 4) {
        const a = r2() * 6.283, r = minR + Math.pow(r2(), 1.4) * radius, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (exclude && exclude(x, z)) continue;
        o.position.set(x, hf.height(x, z) - 0.02, z); o.rotation.set((r2() - 0.5) * 0.3, r2() * 6.28, 0); const hh = lerp(height[0], height[1], r2()); o.scale.set(0.8 + r2() * 1.1, hh, hh); o.updateMatrix(); mesh.setMatrixAt(k++, o.matrix);
      }
      full = k; mesh.count = k; mesh.instanceMatrix.needsUpdate = true;
    },
    thin(f) { mesh.count = Math.floor(full * f); },
  };
}

// ---------------------------------------------------------------- ferns / undergrowth cards
export function createFerns({ hf, atlas, count = 300, radius = 40, seed = 1, size = [0.9, 1.5], windU = null }) {
  const g = new THREE.BufferGeometry(), pos = [], uvs = [], nor = [], idx = [], sway = [], fronds = 7;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2, tilt = 0.7, ca = Math.cos(a), sa = Math.sin(a), len = 1, wid = 0.55;
    const dir = new THREE.Vector3(ca * Math.cos(tilt), Math.sin(tilt), sa * Math.cos(tilt)), side = new THREE.Vector3(-sa, 0, ca), cell = (f % 4), cx = cell % 2, cy = Math.floor(cell / 2), e = 0.008;
    const u0 = cx * 0.5 + e, u1 = (cx + 1) * 0.5 - e, v0 = 1 - (cy + 1) * 0.5 + e, v1 = 1 - cy * 0.5 - e, base = pos.length / 3;
    for (const [s, t, uu, vv] of [[-1, 0, u0, v0], [1, 0, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]]) {
      const p = side.clone().multiplyScalar(s * wid / 2).addScaledVector(dir, t * len); p.y -= t * t * 0.12; pos.push(p.x, p.y, p.z); uvs.push(uu, vv); nor.push(0, 1, 0); sway.push(t);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1)); g.setIndex(idx);
  const uTime = windU?.uTime || { value: 0 }, mat = new THREE.MeshStandardMaterial({ map: atlas.map, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = 'uniform float uTime; attribute float aSway;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n float ph = instanceMatrix[3].x * 0.9 + instanceMatrix[3].z * 0.7; transformed.y += aSway * 0.035 * sin(uTime * 1.6 + ph + position.x * 3.0);');
    sh.fragmentShader = sh.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
  };
  const mesh = new THREE.InstancedMesh(g, mat, count); mesh.frustumCulled = false; mesh.receiveShadow = true; const o = new THREE.Object3D(); let full = 0;
  return {
    mesh,
    layout(cx, cz, { exclude = null, minR = 3.5, density = null } = {}) {
      const R = rng(seed * 7 + Math.floor(cx + cz * 3)), N = makeNoise(seed); let k = 0, tries = 0;
      while (k < count && tries++ < count * 20) {
        const a = R() * 6.283, r = minR + Math.pow(R(), 1.3) * radius, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (exclude && exclude(x, z)) continue; if (N.fbm2(x * 0.1 + 3, z * 0.1) < -0.15 && R() < 0.8) continue; if (density && R() > density(x, z)) continue;
        o.position.set(x, hf.height(x, z), z); o.rotation.set(0, R() * 6.28, 0); o.scale.setScalar(lerp(size[0], size[1], R())); o.updateMatrix(); mesh.setMatrixAt(k++, o.matrix);
      }
      full = k; mesh.count = k; mesh.instanceMatrix.needsUpdate = true;
    },
    thin(f) { mesh.count = Math.floor(full * f); },
  };
}

// ---------------------------------------------------------------- fallen logs
export function createLogs({ hf, barkMat, items, mossMat = null }) {
  const group = new THREE.Group(); const R = rng(3);
  for (const it of items) {
    const len = it.len || 6, r = it.r || 0.35, geo = new THREE.CylinderGeometry(r * 0.88, r, len, 12, 6, false).rotateZ(Math.PI / 2);
    const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i); const j = 1 + 0.07 * Math.sin(x * 3 + it.x) + 0.03 * Math.sin(x * 9); p.setY(i, p.getY(i) * j); p.setZ(i, p.getZ(i) * j); }
    geo.computeVertexNormals(); const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3.5, uv.getY(i) * 2.2);
    const m = new THREE.Mesh(geo, barkMat); m.castShadow = true; m.receiveShadow = true;
    const x0 = it.x + Math.cos(it.yaw) * len / 2, z0 = it.z - Math.sin(it.yaw) * len / 2, x1 = it.x - Math.cos(it.yaw) * len / 2, z1 = it.z + Math.sin(it.yaw) * len / 2;
    m.position.set(it.x, Math.max(hf.height(x0, z0), hf.height(x1, z1), hf.height(it.x, it.z)) + r * 0.55, it.z); m.rotation.y = it.yaw; m.rotation.z = (hf.height(x0, z0) - hf.height(x1, z1)) / len * 0.6;
    group.add(m);
    if (mossMat) { const mo = new THREE.Mesh(new THREE.SphereGeometry(r * 0.9, 8, 5).scale(len * 0.28 / r, 0.3, 1), mossMat); mo.position.copy(m.position).add(new THREE.Vector3(R() * 0.8 - 0.4, r * 0.7, 0)); mo.rotation.y = it.yaw; group.add(mo); }
  }
  return group;
}
