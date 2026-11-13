// Forest — Morning Light.  A large forest landscape with four seated viewpoints:
//   Hilltop overlook (a broad grassy summit above a canopy rolling away into haze),
//   Forest floor (deep among tall trunks and light shafts), Meadow (a sunlit clearing facing the tree line),
//   Lakeside (a grassy bank looking across still water).
// Trees are real 3D crowns (stacked cones / blobs) in three levels of detail, re-chosen whenever the viewpoint
// changes; the switch always goes through black (comfort.fade) and the last viewpoint is remembered.

import {
  THREE, SHADER_TAIL, SKY_GLSL, createWorld, makeNoiseTexture, makeSky, softTexture, swayMaterial,
  paint, fbm, smoothstep, rng, sectionRow, choiceGrid,
} from '../seated/common.js?v=20261113e';
import { createBirds } from '../shared/birds.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const R = rng(20260);
const rr = (a, b) => a + R() * (b - a);

// ---------------- world layout ----------------
const HILL = { x: 250, z: -300, h: 62, r: 150 };
const LAKE = { x: -90, z: -520, rx: 95, rz: 55, level: 0 };
const MEADOW = { x: -235, z: -40, r: 46 };
const FACING = (fromX, fromZ, toX, toZ) => Math.atan2(-(toX - fromX), -(toZ - fromZ));   // camera yaw (+ = left) to face a point

// the hilltop seat sits on the gentle shoulder of a broad rounded hill, facing downslope, so the ground keeps falling away and the canopy below is in view
const HSEAT = (() => { const dx = LAKE.x - HILL.x, dz = LAKE.z - HILL.z, l = Math.hypot(dx, dz); return { x: HILL.x + dx / l * 52, z: HILL.z + dz / l * 52 }; })();
const VPS = [
  { id: 'hill', label: 'Hilltop', x: HSEAT.x, z: HSEAT.z, yaw: FACING(HSEAT.x, HSEAT.z, LAKE.x, LAKE.z), pitch: -0.2, fog: 0.0038, near: [45, 190], far: 760, shafts: false, grass: 1, flat: [4, 12], birds: 'high', moteY: -6, tilt: -0.1 },
  { id: 'floor', label: 'Forest floor', x: 0, z: 0, yaw: 0, pitch: 0.1, fog: 0.0108, near: [115, 200], far: 290, shafts: true, grass: 0, flat: [3, 22], birds: 'low', moteY: 7 },
  { id: 'meadow', label: 'Meadow', x: MEADOW.x, z: MEADOW.z + 30, yaw: 0, pitch: 0.06, fog: 0.0066, near: [90, 230], far: 520, shafts: true, grass: 2, flat: [3, 24], birds: 'low', moteY: 5 },
  { id: 'lake', label: 'Lakeside', x: LAKE.x, z: LAKE.z + LAKE.rz * 1.35, yaw: 0, pitch: 0.03, fog: 0.0055, near: [60, 220], far: 600, shafts: false, grass: 1, flat: [3, 20], birds: 'low', moteY: 5 },
];
let curId = 'hill';
try { const sv = localStorage.getItem('oortia-forest-vp'); if (VPS.some(v => v.id === sv)) curId = sv; } catch (e) { /* ignore */ }
let switchTo = () => {};

const FOG = 0xbccfc4;
const W = await createWorld({
  eye: 1.15, bg: FOG, title: 'Forest — Morning Light', startPitch: 0.1,
  hint: (window.matchMedia && matchMedia('(pointer: coarse)').matches) ? 'Drag to look around · Menu → Viewpoint to change seat' : 'Drag to look around · keys 1–4 or Menu → Viewpoint to change seat',
  rows: [sectionRow('Viewpoint'), ...choiceGrid(VPS.map(v => [v.label, v.id]), () => curId, (id) => switchTo(id), 2)],
  tone: { exposure: 1.0, bloom: 0.25, radius: 0.7, threshold: 0.97 },
});
const { scene, camera } = W;
scene.fog = new THREE.FogExp2(FOG, 0.0108);

const noise = makeNoiseTexture(256);
const sunDir = new THREE.Vector3(-0.36, 0.5, -0.78).normalize();

// ---------------- terrain height ----------------
function baseH(x, z) {
  const d = Math.hypot(x - HILL.x, z - HILL.z);
  return (fbm(x * 0.03 + 5, z * 0.03 + 9) - 0.5) * 5.0 + (fbm(x * 0.11, z * 0.11) - 0.5) * 0.7
    + (fbm(x * 0.0035 + 7, z * 0.0035 + 2) - 0.5) * 18 + HILL.h * Math.exp(-Math.pow(d / HILL.r, 2));
}
for (const v of VPS) v.base = baseH(v.x, v.z);
LAKE.level = baseH(LAKE.x, LAKE.z) - 0.5;
const lakeU = (x, z) => Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
function groundH(x, z) {
  let h = baseH(x, z);
  for (const v of VPS) { const m = smoothstep(v.flat[0], v.flat[1], Math.hypot(x - v.x, z - v.z)); h = v.base + (h - v.base) * m; }
  const dm = Math.hypot(x - MEADOW.x, z - MEADOW.z), mm = smoothstep(MEADOW.r * 0.7, MEADOW.r * 1.6, dm);   // the meadow is a gentle flat bowl
  const mb = VPS[2].base; h = mb + (h - mb) * mm;
  const u = lakeU(x, z);
  h += (LAKE.level + 0.9 - h) * (1 - smoothstep(1.2, 2.6, u));       // flat grassy bank around the lake
  h += (LAKE.level - 2.6 - h) * (1 - smoothstep(0.6, 1.15, u));      // the lake bed
  return h;
}
const gh0 = (v) => groundH(v.x, v.z);

// ---------------- lights & sky ----------------
const hemi = new THREE.HemisphereLight(0xe6f0e0, 0x4a5c32, 1.15); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe2b5, 1.6); sun.position.copy(sunDir).multiplyScalar(100); scene.add(sun);

const sky = makeSky(noise, {
  top: 0x6f9fc9, mid: 0xc4d9e2, hor: FOG, sunDir, sunCol: 0xfff1cf, glow: 0.8, sunSize: 0.05, sunGain: 1.2,
  cloudLit: 0xffffff, cloudShade: 0xc8d6e0, cover: 0.38, cloudScale: 1.2,
});
scene.add(sky.mesh);
const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color: 0xffe9b8, transparent: true, opacity: 0.85, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
sunGlow.scale.setScalar(380); scene.add(sunGlow);

// ---------------- ground: a polar mesh that is rebuilt around the current seat (fine near, coarse far) ----------------
let groundMat, terrain;
{
  const K = 176, radii = [0]; for (let r = 0; r < 1250;) { r += 1.6 + 0.045 * r; radii.push(Math.min(r, 1250)); }
  const NR = radii.length, count = NR * K;
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), idx = [];
  for (let i = 0; i < NR - 1; i++) for (let k = 0; k < K; k++) {
    const a = i * K + k, b = i * K + (k + 1) % K, c = (i + 1) * K + k, d = (i + 1) * K + (k + 1) % K;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const moss = new THREE.Color(0x3d5a2a), moss2 = new THREE.Color(0x56733a), soil = new THREE.Color(0x4a3a26), litter = new THREE.Color(0x6e5230),
    meadowC = new THREE.Color(0x7aa443), hillC = new THREE.Color(0x6a9a3a), mud = new THREE.Color(0x5a5638), bank = new THREE.Color(0x6b9640), tmp = new THREE.Color();
  terrain = {
    build(cx, cz) {
      for (let i = 0; i < NR; i++) for (let k = 0; k < K; k++) {
        const j = i * K + k, th = (k / K) * Math.PI * 2, x = cx + Math.cos(th) * radii[i], z = cz + Math.sin(th) * radii[i], h = groundH(x, z);
        pos[j * 3] = x; pos[j * 3 + 1] = h; pos[j * 3 + 2] = z;
        const n = fbm(x * 0.09 + 20, z * 0.09), m = fbm(x * 0.23, z * 0.23 + 4);
        tmp.copy(moss).lerp(moss2, n).lerp(soil, smoothstep(0.55, 0.8, m) * 0.7).lerp(litter, smoothstep(0.5, 0.75, fbm(x * 0.05 - 9, z * 0.05)) * 0.55);
        tmp.lerp(meadowC, 1 - smoothstep(MEADOW.r * 0.8, MEADOW.r * 1.3, Math.hypot(x - MEADOW.x, z - MEADOW.z)));
        tmp.lerp(hillC, (1 - smoothstep(30, 62, Math.hypot(x - HILL.x, z - HILL.z))) * 0.9);
        const u = lakeU(x, z); tmp.lerp(bank, (1 - smoothstep(1.25, 1.7, u)) * 0.8).lerp(mud, 1 - smoothstep(1.0, 1.22, u));
        col[j * 3] = tmp.r; col[j * 3 + 1] = tmp.g; col[j * 3 + 2] = tmp.b;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.computeVertexNormals();
    },
  };
  groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  groundMat.userData.u = { uNoise: { value: noise }, uTime: { value: 0 }, uLit: { value: 1 } };
  groundMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, groundMat.userData.u);
    sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform sampler2D uNoise; uniform float uTime, uLit; varying vec3 vWp;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 q = vWp.xz;
      float d1 = texture2D(uNoise, q * 0.035 + vec2(uTime * 0.0035, 0.0)).r;
      float d2 = texture2D(uNoise, q * 0.09 - vec2(0.0, uTime * 0.006)).g;
      float dap = smoothstep(0.5, 0.74, d1 * 0.62 + d2 * 0.38);
      float mott = 0.78 + 0.5 * texture2D(uNoise, q * 0.55).a;
      diffuseColor.rgb *= mott;
      diffuseColor.rgb *= mix(0.6, 1.0, uLit) + dap * uLit * 1.25;
      diffuseColor.rgb += vec3(0.20, 0.14, 0.04) * dap * uLit;`);
  };
  const g = new THREE.Mesh(geo, groundMat); g.frustumCulled = false; scene.add(g);
}

// ---------------- lake ----------------
const waterU = {
  uTime: { value: 0 }, uNoise: { value: noise }, uFogColor: { value: scene.fog.color }, uFogD: { value: 0.005 },
  uC: { value: new THREE.Vector4(LAKE.x, LAKE.z, LAKE.rx, LAKE.rz) }, uDeep: { value: new THREE.Color(0x163f48) },
  uTop: sky.uniforms.uTop, uMid: sky.uniforms.uMid, uHor: sky.uniforms.uHor, uSunDir: sky.uniforms.uSunDir, uSunCol: sky.uniforms.uSunCol, uGlow: sky.uniforms.uGlow, uAzim: sky.uniforms.uAzim,
};
{
  const mat = new THREE.ShaderMaterial({
    uniforms: waterU, fog: false,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying vec3 vW; uniform float uTime, uFogD; uniform vec3 uFogColor, uDeep; uniform vec4 uC; uniform sampler2D uNoise;
      ${SKY_GLSL}
      void main(){
        float u = length((vW.xz - uC.xy) / uC.zw); if (u > 1.12) discard;
        vec3 Vv = cameraPosition - vW; float dist = length(Vv); vec3 V = Vv / dist;
        vec2 n1 = texture2D(uNoise, vW.xz * 0.045 + vec2(uTime * 0.006, uTime * 0.004)).rg - 0.5;
        vec2 n2 = texture2D(uNoise, vW.xz * 0.13 - vec2(uTime * 0.008, 0.0)).gb - 0.5;
        vec2 g = (n1 * 0.09 + n2 * 0.05) / (1.0 + dist * 0.004);
        vec3 N = normalize(vec3(g.x, 1.0, g.y));
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        float fres = 0.03 + 0.97 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
        vec3 col = mix(uDeep, skyGrad(R) * 0.82, clamp(fres, 0.0, 1.0));
        col = mix(col, vec3(0.28, 0.36, 0.26), smoothstep(0.8, 1.1, u) * 0.55);
        float tw = texture2D(uNoise, vW.xz * 0.3 + uTime * 0.02).a;
        col += uSunCol * pow(max(dot(R, uSunDir), 0.0), 220.0) * (0.35 + tw) * 1.6;
        float fg = 1.0 - exp(-uFogD * uFogD * dist * dist);
        gl_FragColor = vec4(mix(col, uFogColor, fg), 1.0);
        ${SHADER_TAIL}
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(LAKE.rx * 2.5, LAKE.rz * 2.5).rotateX(-Math.PI / 2), mat);
  m.position.set(LAKE.x, LAKE.level, LAKE.z); m.frustumCulled = false; scene.add(m);
}

// ---------------- trees: real 3D crowns, three levels of detail ----------------
function trunkGeo(h, rBot, rTop, mossH, sides = 9, segs = 6) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, sides, segs).translate(0, h / 2, 0);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  const bark = new THREE.Color(0x5b3b28), bark2 = new THREE.Color(0x3f2a1d), mo = new THREE.Color(0x45622e), t = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), a = Math.atan2(p.getZ(i), p.getX(i));
    t.copy(bark).lerp(bark2, 0.5 + 0.5 * Math.sin(a * 5 + y * 0.1)).lerp(mo, 1 - smoothstep(0, mossH, y));
    col[i * 3] = t.r; col[i * 3 + 1] = t.g; col[i * 3 + 2] = t.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
}
const merge = (parts) => mergeGeometries(parts.map(p => { p.deleteAttribute('uv'); return p; }), false);
// level 0 (near): many-tiered conifer / five-lobed broadleaf
function conifer0(h, rBot, y0, tiers, rMax, c1, c2) {
  const parts = [trunkGeo(h, rBot, 0.18, 3.5)];
  const a = new THREE.Color(c1), b = new THREE.Color(c2);
  for (let i = 0; i < tiers; i++) {
    const k = i / (tiers - 1), y = y0 + k * (h - y0 - 3), r = rMax * Math.pow(1 - k, 0.9) + 0.7, ch = (h - y0) / tiers * 1.9;
    parts.push(paint(new THREE.ConeGeometry(r, ch, 9, 1, true).translate(0, y + ch * 0.5, 0).rotateY(i * 0.7), a.clone().lerp(b, k * 0.8 + R() * 0.15)));
  }
  parts.push(paint(new THREE.ConeGeometry(0.6, 3.2, 6).translate(0, h - 0.8, 0), b));
  return merge(parts);
}
function broad0(h, c1, c2) {
  const parts = [trunkGeo(h * 0.62, 0.38, 0.12, 2.2)];
  const a = new THREE.Color(c1), b = new THREE.Color(c2);
  for (const [x, yk, z, r] of [[0, 0.72, 0, 3.4], [2.1, 0.62, 0.8, 2.5], [-1.9, 0.66, -0.7, 2.7], [0.6, 0.9, -1.8, 2.3], [-0.5, 0.58, 2.0, 2.4]])
    parts.push(paint(new THREE.SphereGeometry(r, 8, 6).translate(x, h * yk, z), a.clone().lerp(b, R())));
  return merge(parts);
}
// level 1 (mid): three cones / three blobs
function conifer1(h, rBot, y0, rMax, c1, c2) {
  const parts = [trunkGeo(h * 0.7, rBot, 0.2, 3.5, 6, 1)];
  const a = new THREE.Color(c1), b = new THREE.Color(c2);
  for (let i = 0; i < 3; i++) {
    const k = i / 2, ch = (h - y0) * (0.5 - k * 0.1), y = y0 + k * (h - y0) * 0.5, r = rMax * (1 - k * 0.55);
    parts.push(paint(new THREE.ConeGeometry(r, ch, 7).translate(0, y + ch / 2, 0).rotateY(i), a.clone().lerp(b, k)));
  }
  return merge(parts);
}
function broad1(h, c1, c2) {
  const parts = [trunkGeo(h * 0.62, 0.38, 0.14, 2.2, 6, 1)];
  const a = new THREE.Color(c1), b = new THREE.Color(c2);
  for (const [x, yk, z, r] of [[0, 0.74, 0, 3.8], [2.0, 0.6, 0.8, 2.7], [-1.8, 0.64, -0.7, 2.8]]) parts.push(paint(new THREE.SphereGeometry(r, 7, 5).translate(x, h * yk, z), a.clone().lerp(b, R())));
  return merge(parts);
}
// level 2 (far): two cones / one blob — still proper 3D from above and from the side
function conifer2(h, y0, rMax, c1, c2) {
  const a = new THREE.Color(c1), b = new THREE.Color(c2), ch = (h - y0);
  return merge([
    paint(new THREE.ConeGeometry(rMax, ch * 0.62, 6).translate(0, y0 + ch * 0.31, 0), a),
    paint(new THREE.ConeGeometry(rMax * 0.62, ch * 0.55, 6).translate(0, y0 + ch * 0.72, 0).rotateY(0.5), b),
  ]);
}
function broad2(h, c1, c2) {
  const a = new THREE.Color(c1), b = new THREE.Color(c2);
  return merge([
    paint(new THREE.CylinderGeometry(0.3, 0.45, h * 0.5, 5).translate(0, h * 0.25, 0), 0x56402c),
    paint(new THREE.SphereGeometry(6.4, 6, 4).scale(1.1, 0.85, 1.1).translate(0, h * 0.74, 0), a.clone().lerp(b, 0.5)),
  ]);
}
const KINDS = {
  giant: { geo: [conifer0(54, 1.25, 20, 11, 6.2, 0x1c3822, 0x35623a), conifer1(54, 1.25, 20, 6.4, 0x1c3822, 0x35623a), conifer2(54, 20, 12.5, 0x213f27, 0x35623a)], sway: { k: 0.00032 } },
  fir: { geo: [conifer0(26, 0.55, 7, 8, 3.1, 0x244a2c, 0x41763f), conifer1(26, 0.55, 7, 3.3, 0x244a2c, 0x41763f), conifer2(26, 5, 6.6, 0x2a5430, 0x41763f)], sway: { k: 0.0011 } },
  broad: { geo: [broad0(15, 0x4e7a34, 0x83a145), broad1(15, 0x4e7a34, 0x83a145), broad2(15, 0x4e7a34, 0x83a145)], sway: { k: 0.0025 } },
};
// master list of every tree in the landscape (jittered grid, thinned around clearings, shuffled so thinning is spatially even)
const trees = [];
{
  const SP = 10.5, CX = 0, CZ = -250, RAD = 820;
  for (let gx = CX - RAD; gx <= CX + RAD; gx += SP) for (let gz = CZ - RAD; gz <= CZ + RAD; gz += SP) {
    const x = gx + rr(-4.6, 4.6), z = gz + rr(-4.6, 4.6);
    if (Math.hypot(x - CX, z - CZ) > RAD) continue;
    const dh = Math.hypot(x - HILL.x, z - HILL.z);
    if (dh < 30 || Math.hypot(x - HSEAT.x, z - HSEAT.z) < 85 || R() > smoothstep(30, 95, dh) * 0.95 + 0.05 * (dh > 95)) continue;   // grassy hilltop, the slope in front of the seat kept clear
    if (lakeU(x, z) < 1.5) continue;
    if (R() > smoothstep(MEADOW.r * 0.85, MEADOW.r * 1.3, Math.hypot(x - MEADOW.x, z - MEADOW.z))) continue;           // meadow clearing, feathered edge
    if (Math.hypot(x / 9.5, (z + 9) / 17) < 1 || Math.hypot(x, z) < 6) continue;                                        // the forest-floor glade
    if (R() > 0.62 + 0.38 * smoothstep(0.25, 0.5, fbm(x * 0.012 + 3, z * 0.012 + 8))) continue;                          // natural thinner patches
    const pg = 0.07 + 0.22 * (1 - smoothstep(120, 260, Math.hypot(x, z))), roll = R(), kind = roll < pg ? 'giant' : roll < 0.62 ? 'fir' : roll < 0.84 ? 'broad' : 'fir';   // giants crowd the forest floor, only break the canopy elsewhere
    const young = roll >= 0.84, gold = kind === 'broad' && R() < 0.14;
    const s = kind === 'giant' ? rr(0.75, 1.35) : young ? rr(0.45, 0.7) : kind === 'fir' ? rr(0.7, 1.3) : rr(0.75, 1.2);
    const b = rr(0.82, 1.18), patch = fbm(x * 0.008 + 40, z * 0.008 + 11), tr = patch > 0.6 ? 1.25 : patch < 0.38 ? 0.86 : 1, tb = patch > 0.6 ? 0.72 : patch < 0.38 ? 1.12 : 1;   // colour patches: golden stands, cooler dark stands
    trees.push({ x, z, y: groundH(x, z) - 0.2, s, kind, yaw: R() * 6.28, js: rr(0.92, 1.12), cr: (gold ? 1.7 * b : b * rr(0.96, 1.04)) * tr, cg: gold ? 1.3 * b : b, cb: (gold ? 0.55 * b : b * rr(0.9, 1.06)) * tb });
  }
  for (let i = trees.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [trees[i], trees[j]] = [trees[j], trees[i]]; }
}
const treeMeshes = [];
{
  const caps = { giant: 0, fir: 0, broad: 0 }; for (const t of trees) caps[t.kind]++;
  for (const kind of Object.keys(KINDS)) KINDS[kind].meshes = KINDS[kind].geo.map((geo, tier) => {
    const mat = tier === 2 ? new THREE.MeshLambertMaterial({ vertexColors: true }) : swayMaterial({ k: KINDS[kind].sway.k, y0: 0, power: 2 });
    mat.side = THREE.DoubleSide;
    const m = new THREE.InstancedMesh(geo, mat, caps[kind]); m.frustumCulled = false;
    m.setColorAt(0, new THREE.Color(1, 1, 1)); m.userData = { n: 0, tier }; scene.add(m); treeMeshes.push(m); return m;
  });
}
const _o = new THREE.Object3D(), _c = new THREE.Color();
function layoutTrees(vp) {
  for (const m of treeMeshes) m.userData.n = 0;
  for (const t of trees) {
    const d = Math.hypot(t.x - vp.x, t.z - vp.z); if (d > vp.far || d < 9) continue;
    const m = KINDS[t.kind].meshes[d < vp.near[0] ? 0 : d < vp.near[1] ? 1 : 2], i = m.userData.n++;
    _o.position.set(t.x, t.y, t.z); _o.rotation.set(0, t.yaw, 0); _o.scale.set(t.s, t.s * t.js, t.s); _o.updateMatrix();
    m.setMatrixAt(i, _o.matrix); m.setColorAt(i, _c.setRGB(t.cr, t.cg, t.cb));
  }
  for (const m of treeMeshes) { m.count = m.userData.n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
}
W.detailFns.push((f) => { for (const m of treeMeshes) m.count = Math.floor(m.userData.n * (m.userData.tier === 0 ? Math.max(f, 0.6) : f)); });

// ---------------- ground cover ----------------
function fernGeo() {
  const verts = [], cols = [], idx = []; const lo = new THREE.Color(0x3a6e2a), hi = new THREE.Color(0x8cc255), c = new THREE.Color();
  const fronds = 7, seg = 4;
  for (let f = 0; f < fronds; f++) {
    const th = (f / fronds) * Math.PI * 2 + R() * 0.4, len = 0.55 + R() * 0.3, px = -Math.sin(th), pz = Math.cos(th);
    const base = verts.length / 3;
    for (let s = 0; s <= seg; s++) {
      const k = s / seg, r = len * k, y = 0.08 + 0.5 * Math.sin(k * 1.9) * (len / 0.8) * 0.8 - 0.1 * k * k;
      const w = 0.11 * Math.sin(Math.PI * Math.pow(k, 0.7)) + 0.01;
      for (const side of [-1, 1]) { verts.push(Math.cos(th) * r + px * w * side, Math.max(y, 0.02), Math.sin(th) * r + pz * w * side); c.copy(lo).lerp(hi, k); cols.push(c.r, c.g, c.b); }
      if (s > 0) { const a = base + (s - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols), 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

let fernMesh;
{
  const fm = swayMaterial({ k: 0.12, y0: 0.0, power: 1.2 }); fm.side = THREE.DoubleSide;
  const N = 900, mesh = new THREE.InstancedMesh(fernGeo(), fm, N), d = new THREE.Object3D(); let k = 0, tries = 0;
  while (k < N && tries++ < N * 20) {
    const a = R() * 6.28, r = 4.2 + Math.pow(R(), 1.3) * 55, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (fbm(x * 0.12 + 3, z * 0.12) < 0.42 && R() < 0.8) continue;
    d.position.set(x, groundH(x, z), z); d.rotation.set(0, R() * 6.28, 0); d.scale.setScalar(rr(0.8, 1.6)); d.updateMatrix(); mesh.setMatrixAt(k++, d.matrix);
  }
  mesh.count = k; mesh.frustumCulled = false; scene.add(mesh); fernMesh = mesh;
  W.detailFns.push((f) => { mesh.count = Math.floor(k * f); });
}
// grass tufts + wildflowers that follow the seat (hill, meadow, lakeside)
let grassMesh, flowerMesh, grassFull = 0;
{
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.035, 0, 0, 0.035, 0, 0, -0.02, 0.45, 0, 0.02, 0.45, 0, 0, 0.9, 0]), 3));
  bg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  const lo = new THREE.Color(0x628f38), mid = new THREE.Color(0x8fb454), hi = new THREE.Color(0xcfd47e);
  bg.setAttribute('color', new THREE.BufferAttribute(new Float32Array([lo.r, lo.g, lo.b, lo.r, lo.g, lo.b, mid.r, mid.g, mid.b, mid.r, mid.g, mid.b, hi.r, hi.g, hi.b]), 3));
  bg.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  const gm = swayMaterial({ k: 0.25, y0: 0, power: 1.5 }); gm.side = THREE.DoubleSide;
  grassMesh = new THREE.InstancedMesh(bg, gm, 4500); grassMesh.frustumCulled = false; scene.add(grassMesh);
  flowerMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.03, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), 360); flowerMesh.frustumCulled = false; scene.add(flowerMesh);
  W.detailFns.push((f) => { grassMesh.count = Math.floor(grassFull * f); });
}
const flowerCols = [0xf6f0e0, 0xf4d34e, 0xe98fb0, 0xb89af0].map(h => new THREE.Color(h));
function layoutGrass(vp) {
  const d = new THREE.Object3D(); let k = 0, tries = 0;
  const dens = vp.grass; grassMesh.visible = dens > 0; flowerMesh.visible = vp.grass === 2;
  if (!dens) { grassFull = 0; grassMesh.count = 0; return; }
  const N = dens === 2 ? 4500 : 2000;
  while (k < N && tries++ < N * 4) {
    const a = R() * 6.283, r = 0.1 + Math.pow(R(), 1.5) * 30, x = vp.x + Math.cos(a) * r, z = vp.z + Math.sin(a) * r;
    if (lakeU(x, z) < 1.12) continue;
    d.position.set(x, groundH(x, z) - 0.03, z); d.rotation.set(rr(-0.18, 0.18), R() * 6.28, rr(-0.18, 0.18)); d.scale.set(rr(1, 1.8), dens === 2 ? rr(0.5, 1.0) : rr(0.3, 0.7), 1); d.updateMatrix(); grassMesh.setMatrixAt(k++, d.matrix);
  }
  grassFull = k; grassMesh.count = k; grassMesh.instanceMatrix.needsUpdate = true;
  if (vp.grass === 2) {
    let f = 0; tries = 0;
    while (f < 360 && tries++ < 3000) {
      const a = R() * 6.283, r = 1.5 + R() * 34, x = vp.x + Math.cos(a) * r, z = vp.z + Math.sin(a) * r;
      d.position.set(x, groundH(x, z) + rr(0.2, 0.55), z); d.rotation.set(R(), R(), R()); d.scale.setScalar(rr(0.8, 1.7)); d.updateMatrix();
      flowerMesh.setMatrixAt(f, d.matrix); flowerMesh.setColorAt(f, flowerCols[f % 4]); f++;
    }
    flowerMesh.count = f; flowerMesh.instanceMatrix.needsUpdate = true; if (flowerMesh.instanceColor) flowerMesh.instanceColor.needsUpdate = true;
  }
}
// boulders, fallen log, stump, mushrooms (forest floor only)
const propsG = new THREE.Group(); scene.add(propsG);
{
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const rock = paint(new THREE.DodecahedronGeometry(0.8, 1).scale(1, 0.62, 1), 0x6d7566);
  const n = 22, m = new THREE.InstancedMesh(rock, mat, n), d = new THREE.Object3D(); let k = 0, tries = 0;
  while (k < n && tries++ < 400) {
    const a = R() * 6.28, r = 5 + R() * 55, x = Math.cos(a) * r, z = Math.sin(a) * r;
    d.position.set(x, groundH(x, z) + 0.1, z); d.rotation.set(R(), R() * 6, R()); d.scale.setScalar(rr(0.5, 2.2)); d.updateMatrix(); m.setMatrixAt(k++, d.matrix);
  }
  propsG.add(m);
  const log = new THREE.Group();
  log.add(new THREE.Mesh(paint(new THREE.CylinderGeometry(0.42, 0.5, 9, 10).rotateZ(Math.PI / 2), 0x55422f), mat));
  for (let i = 0; i < 4; i++) { const mo = new THREE.Mesh(paint(new THREE.SphereGeometry(0.4, 6, 5).scale(2.2, 0.45, 1), 0x4d7a30), mat); mo.position.set(-3.5 + i * 2.3, 0.38, rr(-0.15, 0.15)); log.add(mo); }
  log.position.set(-2.2, groundH(-2.2, -5.6) + 0.45, -5.6); log.rotation.y = 0.35; propsG.add(log);
  const stump = new THREE.Mesh(paint(new THREE.CylinderGeometry(0.55, 0.75, 0.55, 10).translate(0, 0.27, 0), 0x5a4330), mat);
  stump.position.set(1.9, groundH(1.9, 0.6), 0.6); propsG.add(stump);
  const cap = paint(new THREE.SphereGeometry(0.1, 8, 5, 0, 6.3, 0, 1.4).translate(0, 0.14, 0), 0xc9462f);
  const stem = paint(new THREE.CylinderGeometry(0.025, 0.035, 0.15, 5).translate(0, 0.075, 0), 0xe9e0cc);
  const mg = mergeGeometries([cap, stem], false), mm = new THREE.InstancedMesh(mg, mat, 16);
  for (let i = 0; i < 16; i++) {
    const a = rr(0, 6.28), r = rr(0.1, 0.5), cx = i < 9 ? -3.6 : 1.6, cz = i < 9 ? -5.0 : 0.3;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    d.position.set(x, groundH(x, z) + (i < 9 ? 0.45 : 0.0), z); d.rotation.set(0, 0, 0); d.scale.setScalar(rr(0.8, 2.0)); d.updateMatrix(); mm.setMatrixAt(i, d.matrix);
  }
  propsG.add(mm);
}

// ---------------- light shafts ----------------
const shafts = [], shaftG = new THREE.Group(); scene.add(shaftG);
{
  const toGround = sunDir.clone().negate();                         // direction the light travels
  const shearX = toGround.x / -toGround.y, shearZ = toGround.z / -toGround.y;   // horizontal drift per metre of height lost
  const vs = `varying vec2 vUv; varying vec3 vW, vN; uniform vec2 uShear;
    void main(){ vUv = uv; vec3 p = position; p.xz += -uShear * p.y;
      vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * w; }`;
  const fs = `varying vec2 vUv; varying vec3 vW, vN; uniform float uTime, uPhase, uInt; uniform vec3 uColor; uniform sampler2D uNoise;
    void main(){
      float edge = pow(max(1.0 - abs(vUv.x * 2.0 - 1.0), 0.0), 1.6);
      float vert = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y)) * 0.85 + 0.15 * smoothstep(0.0, 0.2, vUv.y);
      float pulse = 0.55 + 0.45 * sin(uTime * 0.21 + uPhase) * sin(uTime * 0.09 + uPhase * 2.3);
      vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;
      float ang = smoothstep(0.08, 0.6, abs(dot(normalize(vN), V)));
      float nearF = smoothstep(2.5, 11.0, dist) * exp(-dist * 0.011);
      float streak = 0.55 + 0.9 * texture2D(uNoise, vec2(vUv.x * 2.0 + uPhase, vUv.y * 0.25 - uTime * 0.004)).g;
      float a = edge * vert * pulse * ang * nearF * streak * uInt;
      gl_FragColor = vec4(uColor * a, a);
      ${SHADER_TAIL}
    }`;
  const n = 15;
  for (let i = 0; i < n; i++) {
    const w = rr(3.5, 8.5), H = rr(34, 48);
    const x = rr(-30, 30), z = rr(-62, -9);
    const base = new THREE.PlaneGeometry(w, H, 1, 1).translate(0, H / 2, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uTime: { value: 0 }, uPhase: { value: R() * 20 }, uInt: { value: 0.4 }, uColor: { value: new THREE.Color(0xffe7b8) }, uNoise: { value: noise }, uShear: { value: new THREE.Vector2(shearX, shearZ) } },
    });
    const grp = new THREE.Group(); grp.position.set(x, groundH(x, z) - groundH(0, 0) - 1, z); const ry = R() * 3;
    for (let k = 0; k < 2; k++) { const m = new THREE.Mesh(base, mat); m.rotation.y = ry + k * 1.05; m.renderOrder = 5; grp.add(m); }
    shaftG.add(grp); shafts.push(mat);
  }
}


// ---------------- mist (low drifting banks) ----------------
const mist = [], mistG = new THREE.Group(); scene.add(mistG);
{
  const tex = softTexture();
  for (let i = 0; i < 34; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xe3ece6, transparent: true, opacity: rr(0.13, 0.26), depthWrite: false, fog: false }));
    const a = R() * 6.28, r = 12 + R() * 70;
    s.position.set(Math.cos(a) * r, rr(1.5, 7), Math.sin(a) * r - 15);
    s.scale.set(rr(30, 60), rr(8, 14), 1); s.userData = { vx: rr(0.08, 0.3), z0: s.position.z };
    mistG.add(s); mist.push(s);
  }
}


// ---------------- drifting pollen / leaves ----------------
function makeMotes({ count, box, center, size, color, opacity, fall, drift, additive }) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2)); g.setIndex([0, 1, 2, 0, 2, 3]);
  const seed = new Float32Array(count * 4); for (let i = 0; i < seed.length; i++) seed[i] = R();
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4)); g.instanceCount = count;
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uTime: { value: 0 }, uBox: { value: new THREE.Vector3(...box) }, uCenter: { value: new THREE.Vector3(...center) }, uSize: { value: size }, uFall: { value: fall }, uDrift: { value: new THREE.Vector2(...drift) }, uColor: { value: new THREE.Color(color) }, uOp: { value: opacity } },
    vertexShader: `attribute vec4 aSeed; varying vec2 vUv; varying float vT, vDist; uniform float uTime, uSize, uFall; uniform vec3 uBox, uCenter; uniform vec2 uDrift;
      void main(){ vUv = uv; vec3 p = aSeed.xyz * uBox;
        p.x += sin(uTime * 0.17 + aSeed.w * 30.0) * 1.6 + uTime * uDrift.x;
        p.z += cos(uTime * 0.13 + aSeed.w * 21.0) * 1.6 + uTime * uDrift.y;
        p.y += sin(uTime * 0.21 + aSeed.w * 12.0) * 0.5 - uTime * uFall;
        p = mod(p, uBox) - uBox * 0.5 + uCenter;
        vT = aSeed.w; vec4 mv = viewMatrix * vec4(p, 1.0); vDist = length(mv.xyz);
        mv.xy += position.xy * uSize * (0.55 + 0.9 * aSeed.w);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec2 vUv; varying float vT, vDist; uniform float uTime, uOp; uniform vec3 uColor;
      void main(){ float d = length(vUv - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); a *= a;
        a *= (0.78 + 0.22 * sin(uTime * (0.15 + 0.2 * vT) + vT * 40.0)) * uOp * smoothstep(2.5, 7.0, vDist); gl_FragColor = vec4(uColor, a); ${SHADER_TAIL} }`,
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 6; scene.add(mesh); return m;
}
const pollen = makeMotes({ count: 260, box: [44, 18, 44], center: [0, 7, -14], size: 0.055, color: 0xfff1c8, opacity: 1.0, fall: 0.03, drift: [0.12, -0.05], additive: true });
const leaves = makeMotes({ count: 34, box: [40, 26, 40], center: [0, 11, -12], size: 0.07, color: 0xd1a53c, opacity: 0.9, fall: 0.42, drift: [0.35, 0.1], additive: false });


// ---------------- birds: pigeons between the trees (low seats), crows and hawks over the canopy (hilltop) ----------------
const birdsLow = createBirds({ parent: scene, color: 0x8d857a, wingColor: 0x7c766c, tipColor: 0x4a443c, seed: 11, flocks: [
  { n: 3, cx: -10, cz: -70, ra: 38, rb: 22, y: 17, yv: 3, period: 59, size: 0.7 },
  { n: 2, cx: 20, cz: -85, ra: 45, rb: 20, y: 24, yv: 3, period: 54, size: 0.75 },
] });
const birdsHigh = createBirds({ parent: scene, color: 0x3d372f, wingColor: 0x4a4338, tipColor: 0x2a261f, seed: 23, flocks: [
  { n: 3, cx: -15, cz: -140, ra: 95, rb: 45, y: -16, yv: 4, period: 80, size: 1.8 },
  { n: 2, cx: 90, cz: -220, ra: 115, rb: 50, y: -6, yv: 6, period: 92, size: 2.0 },
  { n: 1, cx: -60, cz: -95, ra: 75, rb: 30, y: -24, yv: 3, period: 72, size: 2.4 },
  { n: 3, cx: 40, cz: -60, ra: 70, rb: 28, y: -12, yv: 3, period: 66, size: 1.6 },
] });
W.detailFns.push((f) => { birdsLow.group.visible = birdsLow.on && f > 0.3; birdsHigh.group.visible = birdsHigh.on && f > 0.3; });

// ---------------- viewpoint switching ----------------
function applyViewpoint(id) {
  const vp = VPS.find(v => v.id === id) || VPS[0]; curId = vp.id;
  const gy = gh0(vp);
  W.setSeat({ x: vp.x, y: gy, z: vp.z, yaw: vp.yaw, pitch: vp.pitch, tilt: vp.tilt ?? 0.12 });
  scene.fog.density = vp.fog; waterU.uFogD.value = vp.fog;
  terrain.build(vp.x, vp.z);
  layoutTrees(vp);
  layoutGrass(vp);
  propsG.visible = vp.id === 'floor'; fernMesh.visible = vp.id === 'floor';
  shaftG.visible = vp.shafts; shaftG.position.set(vp.x, gy, vp.z); shaftG.rotation.y = vp.yaw;
  mistG.position.set(vp.x, gy + (vp.id === 'hill' ? -26 : 0), vp.z); mistG.rotation.y = vp.yaw;
  for (const u of [pollen.uniforms, leaves.uniforms]) u.uCenter.value.set(vp.x, gy + vp.moteY + (u === leaves.uniforms ? 4 : 0), vp.z);
  birdsLow.on = vp.birds === 'low'; birdsHigh.on = vp.birds === 'high';
  for (const b of [birdsLow, birdsHigh]) { b.group.visible = b.on; b.group.position.set(vp.x, gy, vp.z); b.group.rotation.y = vp.yaw; }
  try { localStorage.setItem('oortia-forest-vp', vp.id); } catch (e) { /* ignore */ }
}
switchTo = (id) => {
  if (id === curId) return;
  if (W.comfort) W.comfort.fade(() => applyViewpoint(id)); else applyViewpoint(id);   // always through black, never a glide
};
addEventListener('keydown', (e) => {
  const m = /^Digit([1-9])$/.exec(e.code); if (!m || e.ctrlKey || e.metaKey || e.altKey) return;
  const v = VPS[+m[1] - 1]; if (v) switchTo(v.id);
});

// ---------------- animate ----------------
W.onFrame((dt, t) => {
  const cloud = 0.78 + 0.22 * Math.sin(t * 0.045) * Math.sin(t * 0.027 + 1.0);      // slow drifting cloud-shadow
  sun.intensity = 1.3 + 0.4 * cloud;
  for (const m of shafts) { m.uniforms.uTime.value = t; m.uniforms.uInt.value = 0.5 + 0.3 * cloud; }
  groundMat.userData.u.uTime.value = t; groundMat.userData.u.uLit.value = 0.75 + 0.25 * cloud;
  sky.uniforms.uTime.value = t; waterU.uTime.value = t;
  sky.mesh.position.copy(W.rig.position); sunGlow.position.copy(W.rig.position).addScaledVector(sunDir, 520);   // the sky follows the viewer
  pollen.uniforms.uTime.value = t; leaves.uniforms.uTime.value = t;
  for (const s of mist) { s.position.x += s.userData.vx * dt; if (s.position.x > 85) s.position.x = -85; s.position.y += Math.sin(t * 0.1 + s.userData.z0) * 0.0015; }
  if (birdsLow.on) birdsLow.update(t); if (birdsHigh.on) birdsHigh.update(t);
});

// ---------------- audio ----------------
W.buildAudio = (A) => {
  const { ctx, master } = A;
  const rv = A.reverb(3.2, 2.2), wet = A.gain(0.65); rv.connect(wet); wet.connect(master);
  // canopy wind
  const wind = A.noise('pink'); const wg = A.gain(0.08);
  A.chain(wind, A.filter('bandpass', 420, 0.45), wg, master);
  A.lfo(wg.gain, 0.05, 0.035); A.lfo(wg.gain, 0.13, 0.015);
  const rum = A.noise('brown'); const rg = A.gain(0.05); A.chain(rum, A.filter('lowpass', 160), rg, master); A.lfo(rg.gain, 0.04, 0.02);
  // rustling leaves
  const leaf = A.noise('white'); const lg = A.gain(0.006);
  A.chain(leaf, A.filter('highpass', 3200), A.filter('bandpass', 6200, 0.6), lg, master); A.lfo(lg.gain, 0.11, 0.0045); A.lfo(lg.gain, 0.29, 0.002);
  // distant stream, to the left
  const st = A.noise('pink'); const sg = A.gain(0.022);
  A.chain(st, A.filter('bandpass', 1500, 0.9), sg, A.pan(-0.55), master); A.lfo(sg.gain, 7.3, 0.006); A.lfo(sg.gain, 0.2, 0.006);
  const st2 = A.noise('white'); const sg2 = A.gain(0.008); A.chain(st2, A.filter('bandpass', 3000, 1.4), sg2, A.pan(-0.6), master); A.lfo(sg2.gain, 11, 0.004);

  const bus = (pan) => { const p = A.pan(pan), d = A.gain(0.55), s = A.gain(0.75); p.connect(d); d.connect(master); p.connect(s); s.connect(rv); return p; };
  const rp = () => (Math.random() * 2 - 1) * 0.9;
  // songbird: a run of liquid notes
  A.every(() => {
    const dest = bus(rp()), base = 2000 + Math.random() * 1400, n = 4 + Math.floor(Math.random() * 5); let at = 0;
    for (let i = 0; i < n; i++) {
      const f0 = base * (0.8 + Math.random() * 0.7), f1 = f0 * (0.7 + Math.random() * 0.7), d = 0.07 + Math.random() * 0.12;
      A.blip({ f: [[0, f0], [d, f1]], dur: d + 0.03, vol: 0.05, attack: 0.012, dest, at, vib: 25, vibRate: 30 });
      at += d + 0.03 + (Math.random() < 0.25 ? 0.12 : 0.01);
    }
  }, 5, 12);
  // chickadee "fee-bee"
  A.every(() => {
    const dest = bus(rp()), f = 3300 + Math.random() * 300;
    A.blip({ f: [[0, f], [0.4, f]], dur: 0.42, vol: 0.045, attack: 0.03, dest });
    A.blip({ f: [[0, f * 0.88], [0.5, f * 0.86]], dur: 0.52, vol: 0.045, attack: 0.03, dest, at: 0.5 });
  }, 14, 30);
  // tits: bright triplets
  A.every(() => {
    const dest = bus(rp()), f = 4600 + Math.random() * 900, n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) A.blip({ f: [[0, f], [0.05, f * 1.15]], dur: 0.07, vol: 0.035, attack: 0.005, dest, at: i * 0.13 });
  }, 7, 18);
  // wood pigeon: low, soft coo
  A.every(() => {
    const dest = bus(rp() * 0.6);
    [[0, 410], [0.32, 440], [0.62, 420], [0.95, 410], [1.25, 395]].forEach(([at, f], i) =>
      A.blip({ f: [[0, f], [0.25, f * 0.95]], dur: i === 1 ? 0.45 : 0.28, vol: 0.05, attack: 0.05, dest, at, type: 'sine' }));
  }, 24, 50, 6);
  // far woodpecker drum
  A.every(() => {
    const dest = bus(rp()), n = 12 + Math.floor(Math.random() * 8);
    for (let i = 0; i < n; i++) {
      const at = i * 0.085 + Math.random() * 0.01, s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 2205, ctx.sampleRate);
      const d = s.buffer.getChannelData(0); for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / d.length, 6);
      const f = A.filter('bandpass', 1400, 2), g = A.gain(0.035); A.chain(s, f, g, dest); s.start(ctx.currentTime + at);
    }
  }, 50, 100, 12);
};


if (location.hash === '#debug') window.__F = { groundH, VPS, trees, applyViewpoint, switchTo };   // dev aid
applyViewpoint(curId);
W.start();
