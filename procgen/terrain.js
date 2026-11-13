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

// Slope/height-blended PBR ground material. Geometry needs attributes: aMix (vec4 weights: litter, grass, soil, rock), color (tint), uv (for the normal map).
// The rock layer is sampled triplanar (world space + world normal), so vertical cliff faces never stretch.
export function createSplatMaterial({ maps, tile = [0.3, 0.26, 0.28, 0.2], normalFrom = null }) {
  const nf = normalFrom || maps.litter;
  const u = { uA: { value: maps.litter.map }, uB: { value: maps.grass.map }, uC: { value: maps.soil.map }, uD: { value: maps.rock.map }, uTile: { value: new THREE.Vector4(...tile) } };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, normalMap: nf.normalMap, roughnessMap: nf.roughnessMap, roughness: 1, metalness: 0 });
  for (const m of [nf.normalMap, nf.roughnessMap]) m.repeat.set(1, 1);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute vec4 aMix; varying vec4 vMix; varying vec3 vWp; varying vec3 vWn;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vMix = aMix; vWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vWn = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = `uniform sampler2D uA, uB, uC, uD; uniform vec4 uTile; varying vec4 vMix; varying vec3 vWp; varying vec3 vWn;
      vec3 splat(sampler2D t, float s){ vec2 p = vWp.xz * s; vec3 a = texture2D(t, p).rgb; vec3 b = texture2D(t, mat2(0.8, 0.6, -0.6, 0.8) * p * 0.37 + 0.31).rgb; float c = texture2D(t, p * 3.7 + 0.13).g, f = texture2D(t, p * 11.3 + 0.71).g; return mix(a, b, 0.42) * (0.62 + 0.9 * c) * (0.78 + 0.5 * f) * 1.22; }
      vec3 tri(sampler2D t, float s){ vec3 n = abs(normalize(vWn)); n = pow(n, vec3(4.0)); n /= (n.x + n.y + n.z + 1e-4);
        vec3 a = texture2D(t, vWp.zy * s).rgb * n.x + texture2D(t, vWp.xz * s).rgb * n.y + texture2D(t, vWp.xy * s).rgb * n.z;
        float c = (texture2D(t, vWp.zy * s * 3.1).g * n.x + texture2D(t, vWp.xz * s * 3.1).g * n.y + texture2D(t, vWp.xy * s * 3.1).g * n.z); return a * (0.62 + 0.9 * c) * 1.1; }\n` + sh.fragmentShader.replace('#include <map_fragment>', `
      vec3 gcol = splat(uA, uTile.x) * vMix.x + splat(uB, uTile.y) * vMix.y + splat(uC, uTile.z) * vMix.z + tri(uD, uTile.w) * vMix.w;
      diffuseColor.rgb *= gcol;`).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { float dd = length(vViewPosition), fade = 1.0 - smoothstep(5.0, 26.0, dd); vec2 pp = vWp.xz * 8.5;
        float hd = texture2D(uB, pp).g * 0.55 + texture2D(uA, pp * 2.9 + 0.4).g * 0.3 + texture2D(uC, pp * 5.7).g * 0.15;
        vec2 dH = vec2(dFdx(hd), dFdy(hd)) * 1.0 * fade * (1.0 - vMix.w);
        vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition), R1 = cross(q1, normal), R2 = cross(normal, q0); float fDet = dot(q0, R1);
        normal = normalize(abs(fDet) * normal - sign(fDet) * (dH.x * R1 + dH.y * R2)); }`);
  };
  return { material: mat, uniforms: u };
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
  const { material: mat, uniforms: u } = createSplatMaterial({ maps, tile, normalFrom: maps.litter });
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

// ---------------------------------------------------------------- near-field grass (instanced tufts of curved, tapered blades; wind)
//   tuft: blades per instance (1 = single blade; 5–7 = a fine clump). width: blade base width in metres. clump: 0..1 patchiness of the density.
//   falloff: >1 packs the instances toward the seat (r = radius * u^falloff) so it thins with distance. dry: 0..1 share of straw-coloured blades.
const wind_chunk = `#include <begin_vertex>
      float ph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.5; float gs = 0.55 + 0.45 * sin(uTime * 0.27 + ph * 0.1);
      float sw = aSway * aSway * 0.22 * gs * (sin(uTime * 1.3 + ph + position.x * 9.0) * 0.7 + sin(uTime * 2.3 + ph * 2.0) * 0.3);
      transformed.x += sw; transformed.z += sw * 0.5;`;
export function createGrass({ hf, count = 6000, radius = 28, height = [0.25, 0.6], seed = 1, colors = { lo: 0x3f6a22, mid: 0x7fa645, hi: 0xc3cc72 }, windU = null, tuft = 1, width = 0.03, spread = 0.1, clump = 0, falloff = 1.4, dry = 0.12 }) {
  const R = rng(seed * 11 + 3), bg = new THREE.BufferGeometry(), seg = tuft > 1 ? 3 : 4, pos = [], nor = [], col = [], idx = [], sway = [];
  const lo = new THREE.Color(colors.lo), mid = new THREE.Color(colors.mid), hi = new THREE.Color(colors.hi), c = new THREE.Color(), straw = new THREE.Color(0xb7a45a);
  for (let bI = 0; bI < tuft; bI++) {
    const ang = R() * 6.283, ox = tuft > 1 ? Math.cos(ang) * Math.sqrt(R()) * spread : 0, oz = tuft > 1 ? Math.sin(ang) * Math.sqrt(R()) * spread : 0;
    const yaw = R() * 6.283, hF = tuft > 1 ? 0.5 + 0.9 * R() * R() + 0.25 * R() : 1, wF = tuft > 1 ? 0.6 + 0.8 * R() : 1, lean = tuft > 1 ? 0.1 + 0.55 * R() : 0.35, v = 0.82 + 0.34 * R(), isDry = R() < dry ? 0.35 + 0.5 * R() : 0;
    const dx = Math.cos(yaw), dz = Math.sin(yaw), px = -dz, pz = dx, base = pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg, h = t * hF, off = lean * t * t * hF, half = width * wF * (1 - Math.pow(t, 1.4) * 0.97) * 0.5;
      c.copy(t < 0.5 ? lo.clone().lerp(mid, t * 2) : mid.clone().lerp(hi, (t - 0.5) * 2)); c.lerp(straw, isDry * (0.3 + 0.7 * t)); c.multiplyScalar(v * (0.7 + 0.3 * Math.min(1, t * 3)));
      for (const sd of (i === seg ? [0] : [-1, 1])) { pos.push(ox + dx * off + px * sd * half, h, oz + dz * off + pz * sd * half); nor.push(dx * 0.35, 0.9, dz * 0.35); col.push(c.r, c.g, c.b); sway.push(t * (0.6 + 0.5 * hF)); }
    }
    for (let i = 0; i < seg; i++) {
      const r0 = base + (i === 0 ? 0 : 2 * i), r1 = base + 2 * (i + 1);
      if (i < seg - 1) { idx.push(r0, r0 + 1, r1, r0 + 1, r1 + 1, r1); } else { idx.push(r0, r0 + 1, r1); }
    }
  }
  bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); bg.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1)); bg.setIndex(idx);
  const uTime = windU?.uTime || { value: 0 }, mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = 'uniform float uTime; attribute float aSway;\n' + sh.vertexShader.replace('#include <begin_vertex>', wind_chunk);
    sh.fragmentShader = sh.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
  };
  const mesh = new THREE.InstancedMesh(bg, mat, count); mesh.frustumCulled = false; mesh.receiveShadow = true; const o = new THREE.Object3D(), tint = new THREE.Color(); let full = 0;
  const N = makeNoise(seed * 7 + 1);
  return {
    mesh, material: mat,
    layout(cx, cz, { exclude = null, minR = 0.15 } = {}) {
      let k = 0, tries = 0; const r2 = rng(seed + Math.floor(cx * 3 + cz * 7));
      while (k < count && tries++ < count * 6) {
        const a = r2() * 6.283, r = minR + Math.pow(r2(), falloff) * radius, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (exclude && exclude(x, z)) continue;
        const patch = clump > 0 ? 0.5 + 0.5 * N.n2(x * 0.9, z * 0.9) : 1; if (clump > 0 && r2() > (1 - clump) + clump * patch * patch * 1.6) continue;
        o.position.set(x, hf.height(x, z) - 0.02, z); o.rotation.set((r2() - 0.5) * 0.25, r2() * 6.28, 0); const hh = lerp(height[0], height[1], r2() * r2() * 0.6 + r2() * 0.4); o.scale.set(0.85 + r2() * 0.5, hh, 0.85 + r2() * 0.5); o.updateMatrix(); mesh.setMatrixAt(k, o.matrix);
        const g = 0.82 + 0.3 * r2() + 0.1 * (N.n2(x * 0.25, z * 0.25)); tint.setRGB(g * (0.95 + 0.1 * r2()), g, g * (0.88 + 0.16 * r2())); mesh.setColorAt(k, tint); k++;
      }
      full = k; mesh.count = k; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    thin(f) { mesh.count = Math.floor(full * f); },
  };
}

// ---------------------------------------------------------------- wildflowers (clustered drifts; stem + 5–7 petals + centre)
export function createFlowers({ hf, count = 400, radius = 22, seed = 1, colors = [0xf2f0e6, 0xf5d24a, 0xb99be0, 0xf2a3c0], height = [0.14, 0.34], size = 0.045, windU = null, falloff = 1.3 }) {
  const group = new THREE.Group(), N = makeNoise(seed * 13 + 5), meshes = [], per = Math.max(1, Math.floor(count / colors.length));
  const uTime = windU?.uTime || { value: 0 };
  colors.forEach((hex, ci) => {
    const R = rng(seed * 17 + ci), pos = [], col = [], nor = [], sway = [], idx = [], petal = new THREE.Color(hex), ctr = new THREE.Color(hex === 0xf5d24a ? 0xc2701a : 0xf1b81a), stem = new THREE.Color(0x4a7a2a);
    // stem: a thin 3-segment strip, bent
    for (let i = 0; i <= 3; i++) { const t = i / 3; for (const sd of [-1, 1]) { pos.push(sd * 0.004 * (1 - t * 0.4), t, t * t * 0.12); col.push(stem.r, stem.g, stem.b); nor.push(0, 0.8, 0.6); sway.push(t); } if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    // head: a fan of petals around a centre, tilted toward the viewer-ish
    const cy = 1.0, cz = 0.12, petals = 6 + Math.floor(R() * 3), base = pos.length / 3, tilt = 0.5 + R() * 0.5;
    pos.push(0, cy, cz); col.push(ctr.r, ctr.g, ctr.b); nor.push(0, 0.7, 0.7); sway.push(1);
    for (let k = 0; k < petals; k++) {
      const a0 = (k / petals) * 6.283, a1 = ((k + 0.5) / petals) * 6.283, a2 = ((k + 1) / petals) * 6.283, rin = size * 0.28, rout = size * 0.62;
      const pt = (ang, rr) => [Math.cos(ang) * rr * Math.cos(tilt) * 0.0 + Math.cos(ang) * rr, cy + Math.sin(ang) * rr * Math.sin(tilt), cz + Math.sin(ang) * rr * Math.cos(tilt)];
      for (const [ang, rr, cc] of [[a0, rin, petal], [a1, rout * 1.6, petal], [a2, rin, petal]]) { const q = pt(ang, rr); pos.push(...q); col.push(cc.r, cc.g, cc.b); nor.push(0, 0.7, 0.7); sway.push(1); }
      const b0 = base + 1 + k * 3; idx.push(base, b0, b0 + 1, base, b0 + 1, b0 + 2);
    }
    // sepals of the centre ring
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1)); g.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
    mat.onBeforeCompile = (sh) => { sh.uniforms.uTime = uTime; sh.vertexShader = 'uniform float uTime; attribute float aSway;\n' + sh.vertexShader.replace('#include <begin_vertex>', wind_chunk); sh.fragmentShader = sh.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'); };
    const m = new THREE.InstancedMesh(g, mat, per); m.frustumCulled = false; m.receiveShadow = false; m.count = 0; group.add(m); meshes.push({ m, R });
  });
  const o = new THREE.Object3D();
  return {
    mesh: group,
    layout(cx, cz, { exclude = null } = {}) {
      meshes.forEach(({ m }, ci) => {
        const r2 = rng(seed * 5 + ci + Math.floor(cx * 3 + cz * 7)); let k = 0, tries = 0;
        while (k < per && tries++ < per * 12) {
          const a = r2() * 6.283, r = 0.6 + Math.pow(r2(), falloff) * radius, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; if (exclude && exclude(x, z)) continue;
          const drift = 0.5 + 0.5 * N.n2(x * 0.16 + ci * 11, z * 0.16); if (r2() > drift * drift * 1.5) continue;
          o.position.set(x, hf.height(x, z) - 0.01, z); o.rotation.set(0, r2() * 6.28, 0); const h = lerp(height[0], height[1], r2()); o.scale.set(h, h, h); o.updateMatrix(); m.setMatrixAt(k++, o.matrix);
        }
        m.count = k; m.instanceMatrix.needsUpdate = true;
      });
    },
  };
}

// ---------------------------------------------------------------- ground litter: fallen leaves + twigs scattered near the seat
export function createLitter({ hf, count = 1400, radius = 14, seed = 1, palette = [0x8a5a2a, 0xb07a34, 0x6b4a22, 0x9a8a3a, 0x7a3e22, 0x5d5a2a], twigs = 260 }) {
  const group = new THREE.Group(), leafG = new THREE.CircleGeometry(0.5, 6); leafG.scale(0.05, 0.095, 1); leafG.rotateX(-Math.PI / 2);
  const leaf = new THREE.InstancedMesh(leafG, new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }), count); leaf.frustumCulled = false; leaf.receiveShadow = true;
  const twigG = new THREE.CylinderGeometry(0.005, 0.008, 1, 4); twigG.rotateZ(Math.PI / 2);
  const twig = new THREE.InstancedMesh(twigG, new THREE.MeshStandardMaterial({ color: 0x4d3a26, roughness: 1 }), twigs); twig.frustumCulled = false; twig.receiveShadow = true;
  group.add(leaf, twig); const o = new THREE.Object3D(), c = new THREE.Color(), pal = palette.map(h => new THREE.Color(h));
  return {
    mesh: group,
    layout(cx, cz, { exclude = null } = {}) {
      const r2 = rng(seed * 3 + Math.floor(cx * 3 + cz * 7)); let k = 0, tries = 0;
      while (k < count && tries++ < count * 4) { const a = r2() * 6.283, r = 0.3 + Math.pow(r2(), 1.5) * radius, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; if (exclude && exclude(x, z)) continue;
        o.position.set(x, hf.height(x, z) + 0.012, z); o.rotation.set((r2() - 0.5) * 0.5, r2() * 6.28, (r2() - 0.5) * 0.5); const sc = 0.7 + r2() * 0.9; o.scale.set(sc, 1, sc); o.updateMatrix(); leaf.setMatrixAt(k, o.matrix);
        c.copy(pal[Math.floor(r2() * pal.length)]).multiplyScalar(0.75 + r2() * 0.5); leaf.setColorAt(k, c); k++; }
      leaf.count = k; leaf.instanceMatrix.needsUpdate = true; if (leaf.instanceColor) leaf.instanceColor.needsUpdate = true;
      k = 0; tries = 0;
      while (k < twigs && tries++ < twigs * 4) { const a = r2() * 6.283, r = 0.4 + Math.pow(r2(), 1.4) * radius, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; if (exclude && exclude(x, z)) continue;
        o.position.set(x, hf.height(x, z) + 0.01, z); o.rotation.set((r2() - 0.5) * 0.15, r2() * 6.28, (r2() - 0.5) * 0.15); const L = 0.12 + r2() * 0.35; o.scale.set(L, 1 + r2(), 1); o.updateMatrix(); twig.setMatrixAt(k++, o.matrix); }
      twig.count = k; twig.instanceMatrix.needsUpdate = true;
    },
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
