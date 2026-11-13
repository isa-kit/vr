// ============================ procgen/rocks.js — faceted-but-natural boulders from numbers ============================
//
//   import { makeRockGeometry, createRocks } from '../procgen/rocks.js';
//
//   const geo = makeRockGeometry({ seed: 3, detail: 3, flatten: 0.7, facets: 7, rough: 0.12, size: 1 });   // → THREE.BufferGeometry
//        // seed     any int; same params → same rock
//        // detail   icosphere subdivision (2 = 320 tris, 3 = 1280, 4 = 5120)
//        // flatten  vertical squash 0.4 (slab) … 1 (round)
//        // facets   number of random cut planes (flat faces); 0 = smooth pebble
//        // rough    amount of fine noise on top of the facets
//        // moss     0..1 how much of the up-facing surface is tinted mossy (vertex colour)
//   const rocks = createRocks({ items: [{ x, y, z, s, yaw, variant }], variants: [params, params, …], material });   // InstancedMeshes in a Group
//
//   UVs are box-projected per face (so one tileable rock texture never stretches). Use with
//   standardMaterial(await makeMaterialMaps('rock', {...}), { vertexColors: true }).
// ==========================================================================================================

import * as THREE from 'three';
import { rng, makeNoise } from './noise.js';

export function makeRockGeometry({ seed = 1, detail = 3, flatten = 0.7, facets = 7, rough = 0.12, size = 1, moss = 0.6, texScale = 0.5, aspect = 1.2 } = {}) {
  const R = rng(seed * 131 + 9), N = makeNoise(seed + 5), g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position, planes = [];
  for (let k = 0; k < facets; k++) { const n = new THREE.Vector3(R() - 0.5, (R() - 0.35), R() - 0.5).normalize(); planes.push({ n, d: 0.62 + R() * 0.28 }); }
  const asp = new THREE.Vector3(aspect * (0.85 + R() * 0.3), flatten, (0.85 + R() * 0.3) / aspect * 1.1), v = new THREE.Vector3(), off = R() * 50;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const r = 1 + 0.3 * N.n3(v.x * 1.2 + off, v.y * 1.2, v.z * 1.2) + 0.12 * N.n3(v.x * 2.6 + off, v.y * 2.6, v.z * 2.6);
    v.multiplyScalar(r);
    for (const pl of planes) { const dd = v.dot(pl.n); if (dd > pl.d) v.addScaledVector(pl.n, -(dd - pl.d) * 0.92); }
    v.addScaledVector(v.clone().normalize(), rough * 0.25 * N.n3(v.x * 7 + 3, v.y * 7, v.z * 7 + off));
    v.multiply(asp).multiplyScalar(size); p.setXYZ(i, v.x, v.y, v.z);
  }
  // flatten the underside so it sits on the ground
  let minY = Infinity; for (let i = 0; i < p.count; i++) minY = Math.min(minY, p.getY(i));
  for (let i = 0; i < p.count; i++) { let y = p.getY(i) - minY - size * 0.12; if (y < 0) y *= 0.15; p.setY(i, y); }
  g.computeVertexNormals();
  // per-face box-projected UVs + moss on up-facing faces
  const n = g.attributes.normal, uv = new Float32Array(p.count * 2), col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i += 3) {
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i), ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const mossAmt = moss * Math.max(0, Math.min(1, (ny - 0.45) * 2.2)) * (0.6 + 0.4 * N.n3(p.getX(i) * 2 + 9, p.getY(i) * 2, p.getZ(i) * 2));
    for (let k = 0; k < 3; k++) {
      const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k);
      if (ay >= ax && ay >= az) { uv[(i + k) * 2] = x * texScale; uv[(i + k) * 2 + 1] = z * texScale; } else if (ax >= az) { uv[(i + k) * 2] = z * texScale; uv[(i + k) * 2 + 1] = y * texScale; } else { uv[(i + k) * 2] = x * texScale; uv[(i + k) * 2 + 1] = y * texScale; }
      const j = 0.9 + 0.2 * N.n3(x * 5, y * 5, z * 5);
      col[(i + k) * 3] = (1 - mossAmt) * j + mossAmt * 0.55; col[(i + k) * 3 + 1] = (1 - mossAmt) * j + mossAmt * 0.78; col[(i + k) * 3 + 2] = (1 - mossAmt) * j + mossAmt * 0.35;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}

export function createRocks({ items, variants, material, castShadow = false }) {
  const group = new THREE.Group(), geos = variants.map(v => makeRockGeometry(v)), o = new THREE.Object3D(), meshes = [];
  geos.forEach((geo, vi) => {
    const list = items.filter(it => (it.variant ?? 0) % variants.length === vi); if (!list.length) return;
    const m = new THREE.InstancedMesh(geo, material, list.length); m.castShadow = castShadow; m.receiveShadow = true; m.frustumCulled = false;
    list.forEach((it, i) => { o.position.set(it.x, it.y, it.z); o.rotation.set(0, it.yaw || 0, 0); o.scale.setScalar(it.s || 1); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    group.add(m); meshes.push(m);
  });
  group.userData.meshes = meshes; return group;
}
