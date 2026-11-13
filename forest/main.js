// Forest — Morning Light.  Seated in a mossy glade ringed by towering conifers.
// Sun-shafts through drifting mist, floating pollen, swaying canopy, dappled
// ground light, and a layered synthesized dawn chorus.  Light on Quest: instanced
// trees, no real shadows, everything else is cheap shader tricks.

import {
  THREE, SHADER_TAIL, createWorld, makeNoiseTexture, makeSky, softTexture, swayMaterial,
  paint, fbm, smoothstep, rng,
} from '../seated/common.js?v=20261113d';
import { createBirds } from '../shared/birds.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const R = rng(20260);
const rr = (a, b) => a + R() * (b - a);

const FOG = 0xbccfc4;
const W = await createWorld({ eye: 1.15, bg: FOG, title: 'Forest — Morning Light', startPitch: 0.1,
  tone: { exposure: 1.0, bloom: 0.25, radius: 0.7, threshold: 0.97 } });
const { scene, camera } = W;
scene.fog = new THREE.FogExp2(FOG, 0.0108);

const noise = makeNoiseTexture(256);
const sunDir = new THREE.Vector3(-0.36, 0.5, -0.78).normalize();

// ---------------- terrain ----------------
function groundH(x, z) {
  const d = Math.hypot(x, z);
  const base = (fbm(x * 0.03 + 5, z * 0.03 + 9) - 0.5) * 5.0 + (fbm(x * 0.11, z * 0.11) - 0.5) * 0.7;
  return base * (0.1 + 0.9 * smoothstep(3, 22, d));
}

// ---------------- lights & sky ----------------
const hemi = new THREE.HemisphereLight(0xe6f0e0, 0x4a5c32, 1.15); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe2b5, 1.6); sun.position.copy(sunDir).multiplyScalar(100); scene.add(sun);

const sky = makeSky(noise, {
  top: 0x6f9fc9, mid: 0xc4d9e2, hor: FOG, sunDir, sunCol: 0xfff1cf, glow: 0.8, sunSize: 0.05, sunGain: 1.2,
  cloudLit: 0xffffff, cloudShade: 0xc8d6e0, cover: 0.38, cloudScale: 1.2,
});
scene.add(sky.mesh); W.opaque.push(sky.mesh);

// sun haze glowing through the trees (bloom picks it up on desktop)
{
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color: 0xffe9b8, transparent: true, opacity: 0.85, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  spr.position.copy(sunDir).multiplyScalar(520); spr.scale.setScalar(380); scene.add(spr); W.opaque.push(spr);
}

// ---------------- ground ----------------
let groundMat;
{
  const S = 340, N = 136;
  const geo = new THREE.PlaneGeometry(S, S, N, N); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const moss = new THREE.Color(0x3d5a2a), moss2 = new THREE.Color(0x56733a), soil = new THREE.Color(0x4a3a26), litter = new THREE.Color(0x6e5230), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, groundH(x, z));
    const n = fbm(x * 0.09 + 20, z * 0.09), m = fbm(x * 0.23, z * 0.23 + 4);
    tmp.copy(moss).lerp(moss2, n).lerp(soil, smoothstep(0.55, 0.8, m) * 0.7).lerp(litter, smoothstep(0.5, 0.75, fbm(x * 0.05 - 9, z * 0.05)) * 0.55);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
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
  const g = new THREE.Mesh(geo, groundMat); scene.add(g); W.opaque.push(g);
}

// ---------------- trees ----------------
function trunkGeo(h, rBot, rTop, mossH) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, 9, 6).translate(0, h / 2, 0);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  const bark = new THREE.Color(0x5b3b28), bark2 = new THREE.Color(0x3f2a1d), mo = new THREE.Color(0x45622e), t = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), a = Math.atan2(p.getZ(i), p.getX(i));
    t.copy(bark).lerp(bark2, 0.5 + 0.5 * Math.sin(a * 5 + y * 0.1)).lerp(mo, 1 - smoothstep(0, mossH, y));
    col[i * 3] = t.r; col[i * 3 + 1] = t.g; col[i * 3 + 2] = t.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
}
function conifer(h, rBot, y0, tiers, rMax, c1, c2) {
  const parts = [trunkGeo(h, rBot, 0.18, 3.5)];
  const a = new THREE.Color(c1), b = new THREE.Color(c2);
  for (let i = 0; i < tiers; i++) {
    const k = i / (tiers - 1), y = y0 + k * (h - y0 - 3), r = rMax * Math.pow(1 - k, 0.9) + 0.7, ch = (h - y0) / tiers * 1.9;
    parts.push(paint(new THREE.ConeGeometry(r, ch, 9, 1, true).translate(0, y + ch * 0.5, 0).rotateY(i * 0.7), a.clone().lerp(b, k * 0.8 + R() * 0.15)));
  }
  parts.push(paint(new THREE.ConeGeometry(0.6, 3.2, 6).translate(0, h - 0.8, 0), b));
  return mergeGeometries(parts, false);
}
function broadleaf(h, c1, c2) {
  const parts = [trunkGeo(h * 0.62, 0.38, 0.12, 2.2)];
  const a = new THREE.Color(c1), b = new THREE.Color(c2);
  const blobs = [[0, 0.72, 0, 3.4], [2.1, 0.62, 0.8, 2.5], [-1.9, 0.66, -0.7, 2.7], [0.6, 0.9, -1.8, 2.3], [-0.5, 0.58, 2.0, 2.4]];
  for (const [x, yk, z, r] of blobs) parts.push(paint(new THREE.SphereGeometry(r, 8, 6).translate(x, h * yk, z), a.clone().lerp(b, R())));
  return mergeGeometries(parts, false);
}
const mats = {
  giant: swayMaterial({ k: 0.00032, y0: 0, power: 2 }),
  fir: swayMaterial({ k: 0.0011, y0: 0, power: 2 }),
  broad: swayMaterial({ k: 0.0025, y0: 0, power: 2 }),
};
mats.giant.side = mats.fir.side = THREE.DoubleSide;
const placed = [], thin = [];   // thin: [mesh, fullCount] — foliage the frame-rate governor can thin out
W.detailFns.push((f) => thin.forEach(([m, n]) => { m.count = Math.floor(n * f); }));
function scatter(geo, mat, n, rMin, rMax, scaleR, spacing, extra) {
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const d = new THREE.Object3D(); let k = 0, tries = 0;
  while (k < n && tries++ < n * 80) {
    const a = R() * Math.PI * 2, r = rMin + Math.pow(R(), 0.8) * (rMax - rMin);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x / 9.5, (z + 9) / 17) < 1) continue;           // keep the glade in front open
    if (Math.hypot(x, z) < 6) continue;
    if (placed.some(p => Math.hypot(p[0] - x, p[1] - z) < spacing + p[2])) continue;
    const s = rr(scaleR[0], scaleR[1]);
    placed.push([x, z, s * extra]);
    d.position.set(x, groundH(x, z) - 0.2, z); d.rotation.set(0, R() * 6.28, 0); d.scale.set(s, s * rr(0.92, 1.12), s);
    d.updateMatrix(); mesh.setMatrixAt(k++, d.matrix);
  }
  mesh.count = k; mesh.frustumCulled = false; scene.add(mesh); thin.push([mesh, k]); return mesh;
}
scatter(conifer(54, 1.25, 20, 11, 6.2, 0x1c3822, 0x35623a), mats.giant, 120, 9, 170, [0.75, 1.35], 5.0, 1.2);
scatter(conifer(26, 0.55, 7, 8, 3.1, 0x244a2c, 0x41763f), mats.fir, 140, 8, 150, [0.7, 1.3], 2.8, 0.8);
scatter(broadleaf(15, 0x4e7a34, 0x83a145), mats.broad, 28, 12, 100, [0.75, 1.2], 4.5, 1.8);
scatter(broadleaf(13, 0x9a8a35, 0xc99a3c), mats.broad, 8, 14, 95, [0.8, 1.15], 4.5, 1.8);   // a few golden ones

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
{
  const fm = swayMaterial({ k: 0.12, y0: 0.0, power: 1.2 }); fm.side = THREE.DoubleSide;
  const N = 900, mesh = new THREE.InstancedMesh(fernGeo(), fm, N), d = new THREE.Object3D(); let k = 0, tries = 0;
  while (k < N && tries++ < N * 20) {
    const a = R() * 6.28, r = 4.2 + Math.pow(R(), 1.3) * 55, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (fbm(x * 0.12 + 3, z * 0.12) < 0.42 && R() < 0.8) continue;
    d.position.set(x, groundH(x, z), z); d.rotation.set(0, R() * 6.28, 0); d.scale.setScalar(rr(0.8, 1.6)); d.updateMatrix(); mesh.setMatrixAt(k++, d.matrix);
  }
  mesh.count = k; mesh.frustumCulled = false; scene.add(mesh); thin.push([mesh, k]);
}
// boulders, fallen log, stump, mushrooms
{
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const rock = paint(new THREE.DodecahedronGeometry(0.8, 1).scale(1, 0.62, 1), 0x6d7566);
  const n = 22, m = new THREE.InstancedMesh(rock, mat, n), d = new THREE.Object3D(); let k = 0, tries = 0;
  while (k < n && tries++ < 400) {
    const a = R() * 6.28, r = 5 + R() * 55, x = Math.cos(a) * r, z = Math.sin(a) * r;
    d.position.set(x, groundH(x, z) + 0.1, z); d.rotation.set(R(), R() * 6, R()); d.scale.setScalar(rr(0.5, 2.2)); d.updateMatrix(); m.setMatrixAt(k++, d.matrix);
  }
  scene.add(m);
  // fallen log in the middle distance
  const log = new THREE.Group();
  log.add(new THREE.Mesh(paint(new THREE.CylinderGeometry(0.42, 0.5, 9, 10).rotateZ(Math.PI / 2), 0x55422f), mat));
  for (let i = 0; i < 4; i++) { const mo = new THREE.Mesh(paint(new THREE.SphereGeometry(0.4, 6, 5).scale(2.2, 0.45, 1), 0x4d7a30), mat); mo.position.set(-3.5 + i * 2.3, 0.38, rr(-0.15, 0.15)); log.add(mo); }
  log.position.set(-2.2, groundH(-2.2, -5.6) + 0.45, -5.6); log.rotation.y = 0.35; scene.add(log);
  // stump beside the viewer
  const stump = new THREE.Mesh(paint(new THREE.CylinderGeometry(0.55, 0.75, 0.55, 10).translate(0, 0.27, 0), 0x5a4330), mat);
  stump.position.set(1.9, groundH(1.9, 0.6), 0.6); scene.add(stump);
  // mushrooms
  const cap = paint(new THREE.SphereGeometry(0.1, 8, 5, 0, 6.3, 0, 1.4).translate(0, 0.14, 0), 0xc9462f);
  const stem = paint(new THREE.CylinderGeometry(0.025, 0.035, 0.15, 5).translate(0, 0.075, 0), 0xe9e0cc);
  const mg = mergeGeometries([cap, stem], false), mm = new THREE.InstancedMesh(mg, mat, 16);
  for (let i = 0; i < 16; i++) {
    const a = rr(0, 6.28), r = rr(0.1, 0.5), cx = i < 9 ? -3.6 : 1.6, cz = i < 9 ? -5.0 : 0.3;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    d.position.set(x, groundH(x, z) + (i < 9 ? 0.45 : 0.0), z); d.rotation.set(0, 0, 0); d.scale.setScalar(rr(0.8, 2.0)); d.updateMatrix(); mm.setMatrixAt(i, d.matrix);
  }
  scene.add(mm);
}

// ---------------- light shafts ----------------
const shafts = [];
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
    const grp = new THREE.Group(); grp.position.set(x, groundH(x, z) - 1, z); const ry = R() * 3;
    for (let k = 0; k < 2; k++) { const m = new THREE.Mesh(base, mat); m.rotation.y = ry + k * 1.05; m.renderOrder = 5; grp.add(m); }
    scene.add(grp); shafts.push(mat);
  }
}

// ---------------- mist (low drifting banks) ----------------
const mist = [];
{
  const tex = softTexture();
  for (let i = 0; i < 34; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xe3ece6, transparent: true, opacity: rr(0.13, 0.26), depthWrite: false, fog: false }));
    const a = R() * 6.28, r = 12 + R() * 70;
    s.position.set(Math.cos(a) * r, rr(1.5, 7), Math.sin(a) * r - 15);
    s.scale.set(rr(30, 60), rr(8, 14), 1); s.userData = { vx: rr(0.08, 0.3), z0: s.position.z };
    scene.add(s); mist.push(s);
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

// ---------------- woodland pigeons, drifting between the trees far off (shared calm-bird module) ----------------
const birds = createBirds({ parent: scene, color: 0x8d857a, wingColor: 0x7c766c, tipColor: 0x4a443c, seed: 11, flocks: [
  { n: 3, cx: -10, cz: -70, ra: 38, rb: 22, y: 17, yv: 3, period: 59, size: 0.7 },
  { n: 2, cx: 20, cz: -85, ra: 45, rb: 20, y: 24, yv: 3, period: 54, size: 0.75 },
] });
W.detailFns.push((f) => { birds.group.visible = f > 0.3; });

// ---------------- animate ----------------
const tmpA = new THREE.Vector3();
W.onFrame((dt, t) => {
  const cloud = 0.78 + 0.22 * Math.sin(t * 0.045) * Math.sin(t * 0.027 + 1.0);      // slow drifting cloud-shadow
  sun.intensity = 1.3 + 0.4 * cloud;
  for (const m of shafts) { m.uniforms.uTime.value = t; m.uniforms.uInt.value = 0.5 + 0.3 * cloud; }
  groundMat.userData.u.uTime.value = t; groundMat.userData.u.uLit.value = 0.75 + 0.25 * cloud;
  sky.uniforms.uTime.value = t;
  pollen.uniforms.uTime.value = t; leaves.uniforms.uTime.value = t;
  for (const s of mist) { s.position.x += s.userData.vx * dt; if (s.position.x > 85) s.position.x = -85; s.position.y += Math.sin(t * 0.1 + s.userData.z0) * 0.0015; }
  birds.update(t);
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

W.rig.position.set(0, groundH(0, 0), 0);
W.start();
