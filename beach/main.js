// Beach — Sunset Shore.  Seated on warm sand as the surf rolls in: bores break
// and wash up the beach, foam lacing out, the water drains back leaving wet
// mirror-sand.  A big sunset sky slowly deepens toward dusk, gulls cross the
// glitter path, a sailboat drifts past a rocky headland, and the sea sounds
// are timed to the waves you actually see.

import {
  THREE, SHADER_TAIL, SKY_GLSL, createWorld, makeNoiseTexture, makeSky, swayMaterial,
  paint, fbm, smoothstep, rng, hash, makeBird, poseBird, sectionRow, choiceGrid,
} from '../seated/common.js?v=20261113a';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const R = rng(31415);
const rr = (a, b) => a + R() * (b - a);
const ZS = -3.0;            // where the sand dips below the still-water line
const PERIOD = 12.0;         // seconds between waves
const LAMBDA = 30.0;        // wave spacing in metres

const HOR_A = 0xffc58a;
let timeMode = 'auto', pCur = 0;
const W = await createWorld({ eye: 0.95,
  rows: [sectionRow('Light'), ...choiceGrid([['Auto', 'auto'], ['Golden', 'a'], ['Dusk', 'b']], () => timeMode, (v) => { timeMode = v; }, 3)],
  bg: HOR_A, title: 'Beach — Sunset Shore', startPitch: -0.07,
  tone: { exposure: 1.0, bloom: 0.3, radius: 0.65, threshold: 0.97 } });
const { scene } = W;
const FOGD = 0.0011;
scene.fog = new THREE.FogExp2(HOR_A, FOGD);
const noise = makeNoiseTexture(256);

// ---------------- palettes: A golden hour -> B deep dusk ----------------
const C = (h) => new THREE.Color(h);
const PA = { top: C(0x3a5f9f), mid: C(0xe3a283), hor: C(0xffc58a), sun: C(0xffd29a), lit: C(0xffd9b8), shade: C(0x8c6f94), deep: C(0x1b4a6a), shallow: C(0x4aa39b),
  hemi: C(0xa4887a), sandDry: C(0xe4c59a), sandWet: C(0x8a6a50), sunLight: C(0xffbb78), hemiL: C(0xf0c6a8), glow: 1.0, elev: 0.115, stars: 0, sunI: 1.3, hemiI: 0.8 };
const PB = { top: C(0x1b2352), mid: C(0x8c5a88), hor: C(0xf0795a), sun: C(0xff8a52), lit: C(0xff9f84), shade: C(0x3a3468), deep: C(0x0f2744), shallow: C(0x2d6674),
  hemi: C(0x514b72), sandDry: C(0xd4b49a), sandWet: C(0x55455a), sunLight: C(0xff7a48), hemiL: C(0x8f7aa6), glow: 1.4, elev: -0.03, stars: 0.75, sunI: 1.0, hemiI: 0.6 };
const sunDir = new THREE.Vector3(0.26, PA.elev, -0.96).normalize();
const sky = makeSky(noise, { top: 0x3a5f9f, mid: 0xe3a283, hor: HOR_A, sunDir, sunCol: 0xffd29a, glow: 1, cover: 0.5, cloudScale: 1.1, windX: 0.003, windY: 0.0008, sunSize: 0.04, sunGain: 2.2, azim: 1 });
scene.add(sky.mesh); W.opaque.push(sky.mesh);
const SU = sky.uniforms;

const hemiL = new THREE.HemisphereLight(0xf0c6a8, 0x8a7458, 0.8); scene.add(hemiL);
const sunL = new THREE.DirectionalLight(0xffbb78, 1.3); sunL.position.copy(sunDir).multiplyScalar(200); scene.add(sunL);

// ---------------- beach profile ----------------
const sandH1 = (z) => z >= ZS ? (z - ZS) * 0.06 : -9 * (1 - Math.exp(-(ZS - z) * 0.0125));
const duneH = (x, z) => smoothstep(ZS + 30, ZS + 100, z) * (fbm(x * 0.018 + 4, z * 0.018 + 1) - 0.32) * 13 * smoothstep(8, 40, Math.abs(x) + (z - ZS) * 0.35);
const groundH = (x, z) => sandH1(z) + Math.max(duneH(x, z), 0) + (z > ZS ? (fbm(x * 0.3, z * 0.3) - 0.5) * 0.06 : 0);
const SEAT_Z = 7;        // the swash never gets closer than ~7 m
const seatY = groundH(0, SEAT_Z);

// ---------------- shared swash timing (GLSL mirrors this) ----------------
const TSHIFT = `float tShift(float x){ return 1.4*sin(x*0.05+0.7) + 0.9*sin(x*0.131+2.0) + 0.5*sin(x*0.37); }`;

// ---------------- sand (custom shader: wet sand, swash film, foam lace) ----------------
const sandU = {
  uTime: { value: 0 }, uZs: { value: ZS }, uNoise: { value: noise }, uFogD: { value: FOGD }, uFogColor: { value: scene.fog.color },
  uHemi: { value: PA.hemi.clone() }, uSandDry: { value: PA.sandDry.clone() }, uSandWet: { value: PA.sandWet.clone() }, uShallow: { value: PA.shallow.clone() },
  uTop: SU.uTop, uMid: SU.uMid, uHor: SU.uHor, uSunDir: SU.uSunDir, uSunCol: SU.uSunCol, uGlow: SU.uGlow, uAzim: SU.uAzim,
};
{
  const geo = new THREE.PlaneGeometry(1000, 520, 140, 90); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, 130);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, groundH(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    uniforms: sandU, fog: false,
    vertexShader: `varying vec3 vW, vN; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      varying vec3 vW, vN; uniform float uTime, uZs, uFogD; uniform vec3 uHemi, uSandDry, uSandWet, uShallow, uFogColor; uniform sampler2D uNoise;
      ${SKY_GLSL}
      float hash1(float n){ return fract(sin(n * 127.1) * 43758.5453); }
      ${TSHIFT}
      void main(){
        vec2 p = vW.xz; vec3 Vv = cameraPosition - vW; float dist = length(Vv); vec3 V = Vv / dist;
        // swash front for this column
        float lt = (uTime - tShift(p.x)) / ${PERIOD.toFixed(1)}; float n = floor(lt), tau = fract(lt);
        float amp = 0.55 + 0.45 * hash1(n * 3.17 + 1.3), smax = 3.0 * amp;
        float surge = 1.0 - pow(1.0 - clamp(tau / 0.3, 0.0, 1.0), 2.0);
        float retreat = 1.0 - smoothstep(0.3, 0.99, tau);
        float s = smax * (tau < 0.3 ? surge : retreat);
        float d = uZs + s - p.y;                         // metres of water film behind the front (<0: dry)
        float zmax = uZs + smax;
        // micro relief
        vec2 q = p * 0.78;
        float n0 = texture2D(uNoise, q).r, nx = texture2D(uNoise, q + vec2(0.01, 0.0)).r, nz = texture2D(uNoise, q + vec2(0.0, 0.01)).r;
        float ripple = sin(p.y * 9.0 + n0 * 6.0) * 0.5 + 0.5;
        vec3 N = normalize(vN + vec3(n0 - nx, 0.0, n0 - nz) * 2.5);
        // wetness: long-term wet band + freshly soaked
        float wetZ = uZs + 3.0 + (texture2D(uNoise, vec2(p.x * 0.02, 0.3)).r - 0.5) * 2.4;
        float wet = smoothstep(wetZ + 0.9, wetZ - 0.5, p.y);
        wet = max(wet, smoothstep(zmax + 0.3, zmax - 1.0, p.y) * (1.0 - smoothstep(0.5, 1.0, tau)) * 0.85);
        vec3 sand = mix(uSandDry, uSandWet, wet);
        sand *= 0.95 + 0.1 * texture2D(uNoise, p * 0.9).a;
        sand *= 1.0 - 0.07 * ripple * (1.0 - wet * 0.4);
        float ndl = max(dot(N, uSunDir), 0.0);
        vec3 col = sand * (uHemi * 1.15 + uSunCol * ndl * 1.5);
        vec3 Rr = vec3(-V.x, abs(V.y), -V.z);
        float graze = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
        vec3 skyR = skyGrad(Rr);
        col += skyR * (0.06 + 0.7 * graze) * wet * 0.85;
        // water film
        float mask = smoothstep(uZs - 0.4, uZs + 0.4, p.y) * step(0.0, d);
        float film = smoothstep(0.0, 0.6, d) * mask;
        vec3 filmCol = mix(col * 0.55 + uShallow * 0.3, skyR, 0.25 + 0.6 * graze);
        col = mix(col, filmCol, film * 0.72);
        // foam: leading edge + lace behind it, and a lacy high-water line as it drains
        float lace = texture2D(uNoise, p * 1.9 + vec2(0.0, -uTime * 0.04)).g, lace2 = texture2D(uNoise, p * 3.4 + 7.1).b;
        float lc = lace * 0.55 + lace2 * 0.5;
        float lead = mask * exp(-max(d, 0.0) * 1.6) * smoothstep(0.38, 0.62, lc + 0.4 * exp(-d * 3.0));
        float line = smoothstep(0.7, 0.0, abs(p.y - zmax + 0.3)) * smoothstep(0.32, 0.42, tau) * (1.0 - smoothstep(0.45, 0.95, tau)) * smoothstep(0.42, 0.66, lc);
        float foam = clamp(max(lead, line * 0.8), 0.0, 1.0);
        vec3 foamC = vec3(1.0, 0.97, 0.93) * (uHemi * 0.9 + uSunCol * 0.45) * 1.45;
        col = mix(col, foamC, foam * 0.9);
        float fg = 1.0 - exp(-uFogD * uFogD * dist * dist);
        col = mix(col, uFogColor, fg);
        gl_FragColor = vec4(col, 1.0);
        ${SHADER_TAIL}
      }`,
  });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; scene.add(m); W.opaque.push(m);
}

// ---------------- headland rocks + stacks ----------------
function makeIsland({ r, h, seed, detail = 4, steep = 0.7, rock = 0x6e6760, grass = 0x5f7a3a }) {
  const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = fbm(x * 2.1 + seed, z * 2.1 + seed * 0.7, 3), n2 = fbm(x * 4.3 + seed, z * 4.3 - seed, 2);
    const yy = Math.max(y, -0.12), up = Math.pow(Math.max(yy, 0), steep), rad = (1 + 0.45 * (n - 0.5)) * (1 - 0.25 * up);
    p.setXYZ(i, x * r * rad * (0.85 + 0.3 * n2), up * h * (0.75 + 0.5 * n2) + Math.min(yy, 0) * 4, z * r * rad * (0.85 + 0.3 * (1 - n2)));
  }
  g.computeVertexNormals();
  const col = new Float32Array(p.count * 3), nn = g.attributes.normal, cr = new THREE.Color(rock), cg = new THREE.Color(grass), t = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const hf = p.getY(i) / h, grassy = nn.getY(i) > 0.75 && hf > 0.35;
    t.copy(grassy ? cg : cr).multiplyScalar(0.86 + 0.28 * hash(i, seed)); if (hf < 0.06) t.multiplyScalar(0.55);
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = t.r; col[(i + k) * 3 + 1] = t.g; col[(i + k) * 3 + 2] = t.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}
const foamList = [];
function addRock(x, z, o, foam = true) {
  const m = makeIsland(o); m.position.set(x, 0, z); m.rotation.y = R() * 6; scene.add(m); W.opaque.push(m);
  if (foam) foamList.push(new THREE.Vector4(x, z, o.r * 0.78, 0));
}
addRock(-175, -40, { r: 70, h: 28, seed: 2.2, detail: 5, steep: 0.6 });
addRock(-120, -85, { r: 22, h: 16, seed: 6.1, detail: 4, steep: 0.55 });
addRock(-250, -110, { r: 58, h: 38, seed: 8.4, detail: 5, steep: 0.7 });
addRock(-60, -60, { r: 5.5, h: 12, seed: 1.3, detail: 4, steep: 0.45 });
addRock(110, -150, { r: 7, h: 20, seed: 4.8, detail: 4, steep: 0.45 });
addRock(380, -420, { r: 140, h: 60, seed: 5.9, detail: 5, steep: 0.8 }, false);
addRock(-600, -520, { r: 200, h: 80, seed: 3.7, detail: 5, steep: 0.85 }, false);
while (foamList.length < 5) foamList.push(new THREE.Vector4(0, 1e5, 0, 0));

// ---------------- water ----------------
const waterU = {
  uTime: { value: 0 }, uZs: { value: ZS }, uNoise: { value: noise }, uIsl: { value: foamList.slice(0, 5) }, uFogD: { value: FOGD }, uFogColor: { value: scene.fog.color },
  uDeep: { value: PA.deep.clone() }, uShallow: { value: PA.shallow.clone() }, uHemi: sandU.uHemi.value ? sandU.uHemi : { value: PA.hemi.clone() },
  uTop: SU.uTop, uMid: SU.uMid, uHor: SU.uHor, uSunDir: SU.uSunDir, uSunCol: SU.uSunCol, uGlow: SU.uGlow, uAzim: SU.uAzim,
};
{
  const mat = new THREE.ShaderMaterial({
    uniforms: waterU, fog: false, transparent: true, depthWrite: false,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      varying vec3 vW; uniform float uTime, uZs, uFogD; uniform vec3 uDeep, uShallow, uFogColor, uHemi; uniform vec4 uIsl[5]; uniform sampler2D uNoise;
      ${SKY_GLSL}
      ${TSHIFT}
      float sandH(float z){ return z >= uZs ? (z - uZs) * 0.06 : -9.0 * (1.0 - exp(-(uZs - z) * 0.0125)); }
      float prof(float u){ float a = smoothstep(0.08, 0.96, u); a *= a; return a * (1.0 - smoothstep(0.965, 1.0, u)); }
      void wave(vec2 p, vec2 dir, float len, float slope, float dist, inout vec2 g){
        float k = 6.2831853 / len, w = sqrt(9.81 * k);
        g += dir * slope * cos(dot(p, dir) * k - w * uTime * 0.45) / (1.0 + dist * k * 0.03);
      }
      void main(){
        vec2 p = vW.xz; float depth = -sandH(p.y);
        if (depth < 0.0) discard;
        vec3 Vv = cameraPosition - vW; float dist = length(Vv); vec3 V = Vv / dist;
        vec2 g = vec2(0.0); vec2 pw = p + (texture2D(uNoise, p * 0.004 + 0.31).rg - 0.5) * 40.0;
        wave(pw, normalize(vec2(0.1, 1.0)), 70.0, 0.09, dist, g);
        wave(pw, normalize(vec2(-0.3, 1.0)), 31.0, 0.1, dist, g);
        wave(pw, normalize(vec2(0.5, 0.85)), 14.0, 0.1, dist, g);
        wave(pw, normalize(vec2(-0.6, 0.8)), 6.5, 0.08, dist, g);
        wave(pw, normalize(vec2(0.3, 1.0)), 2.8, 0.06, dist, g);
        // breaking bores: sawtooth swell trains whose crests reach the shoreline on the same clock as the swash
        float u = fract((p.y - uZs) / ${LAMBDA.toFixed(1)} - (uTime - tShift(p.x)) / ${PERIOD.toFixed(1)});
        float bz = smoothstep(uZs - 110.0, uZs - 22.0, p.y), edgeF = 1.0 - smoothstep(uZs - 3.0, uZs, p.y);
        float f0 = prof(u), f1 = prof(fract(u + 0.012));
        g.y += clamp(0.85 * bz * edgeF * (f1 - f0) / (0.012 * ${LAMBDA.toFixed(1)}), -1.6, 1.6);
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
        vec3 body = mix(uDeep, uShallow, 1.0 - smoothstep(0.0, 3.8, depth));
        vec3 col = mix(body, skyGrad(R) * 0.66, clamp(fres, 0.0, 1.0));
        float tw = texture2D(uNoise, p * 0.7 + vec2(uTime * 0.06, 0.0)).a;
        float glit = pow(max(dot(R, uSunDir), 0.0), 500.0) * (0.35 + tw) * 5.0;
        // foam: crest + trailing foam in the surf zone, rings around the rocks
        float nf = texture2D(uNoise, p * 0.45 + vec2(uTime * 0.02, 0.0)).g, nf2 = texture2D(uNoise, p * 1.5 + 3.3).b;
        float foam = bz * edgeF * smoothstep(0.52, 0.97, u) * smoothstep(0.2, 0.6, nf * 0.55 + nf2 * 0.55 + (u - 0.5) * 0.9);
        foam += bz * edgeF * smoothstep(0.92, 0.985, u) * (1.0 - smoothstep(0.992, 1.0, u)) * 0.9;
        foam += bz * edgeF * 0.35 * smoothstep(0.55, 0.85, texture2D(uNoise, p * 0.9 + vec2(0.0, -uTime * 0.03)).r * 0.7 + nf2 * 0.4) * (1.0 - smoothstep(0.0, 0.7, u));
        for (int i = 0; i < 5; i++) {
          float d = length(p - uIsl[i].xy) - uIsl[i].z;
          foam = max(foam, smoothstep(6.0 + 2.0 * sin(uTime * 0.8 + float(i) * 2.0), 0.0, d) * step(-3.0, d) * smoothstep(0.2, 0.6, nf + nf2 * 0.3));
        }
        foam = clamp(foam, 0.0, 1.0);
        vec3 foamC = vec3(1.0, 0.97, 0.93) * (uHemi * 0.9 + uSunCol * 0.45) * 1.45;
        col = mix(col, foamC, foam * 0.92);
        float fg = 1.0 - exp(-uFogD * uFogD * dist * dist);
        col = mix(col, skyGrad(normalize(vec3(-Vv.x, 0.0, -Vv.z))), fg);
        col += uSunCol * glit * (1.0 - 0.5 * fg) * (1.0 - foam);
        float a = smoothstep(0.0, 0.16, depth) * (0.3 + 0.7 * smoothstep(0.0, 1.9, depth));
        gl_FragColor = vec4(col, max(a, foam * 0.95));
        ${SHADER_TAIL}
      }`,
  });
  waterU.uHemi = sandU.uHemi;
  mat.uniforms.uHemi = sandU.uHemi;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000, 1, 1).rotateX(-Math.PI / 2), mat);
  m.position.y = 0.0; m.renderOrder = 2; m.frustumCulled = false; scene.add(m); W.opaque.push(m);
}

// ---------------- palms on the dunes, beach grass, driftwood, shells ----------------
function palmGeo() {
  const H = 8.5, trunk = new THREE.CylinderGeometry(0.1, 0.24, H, 6, 8).translate(0, H / 2, 0), tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); tp.setX(i, tp.getX(i) + 0.012 * y * y); }
  trunk.computeVertexNormals(); paint(trunk, 0x6a5339);
  const verts = [], cols = [], idx = [], nrm = [], uvs = [], lo = new THREE.Color(0x24401e), hi = new THREE.Color(0x4d7a2f), c = new THREE.Color();
  const topX = 0.012 * H * H;
  for (let f = 0; f < 9; f++) {
    const th = (f / 9) * Math.PI * 2 + R() * 0.3, len = 3.4 + R() * 0.9, px = -Math.sin(th), pz = Math.cos(th), base = verts.length / 3, seg = 5;
    for (let s = 0; s <= seg; s++) {
      const k = s / seg, r = len * k, y = H + 0.6 * Math.sin(k * 2.4) - 1.9 * k * k, w = 0.5 * Math.sin(Math.PI * Math.pow(k, 0.65)) + 0.02;
      for (const side of [-1, 1]) { verts.push(topX + Math.cos(th) * r + px * w * side, y - w * 0.25, Math.sin(th) * r + pz * w * side); c.copy(lo).lerp(hi, k); cols.push(c.r, c.g, c.b); nrm.push(0, 1, 0); uvs.push(0, 0); }
      if (s > 0) { const a = base + (s - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  }
  const fr = new THREE.BufferGeometry();
  fr.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3)); fr.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  fr.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2)); fr.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols), 3)); fr.setIndex(idx);
  return mergeGeometries([trunk, fr], false);
}
{
  const pm = swayMaterial({ k: 0.0035, y0: 0, power: 2 }); pm.side = THREE.DoubleSide;
  const n = 16, m = new THREE.InstancedMesh(palmGeo(), pm, n), d = new THREE.Object3D(); let k = 0, tries = 0;
  while (k < n && tries++ < 400) {
    const x = rr(55, 330), z = rr(ZS + 32, ZS + 120), h = groundH(x, z); if (h < 1.5) continue;
    d.position.set(x, h - 0.2, z); d.rotation.set(0, R() * 6.28, 0); d.scale.setScalar(rr(0.8, 1.35)); d.updateMatrix(); m.setMatrixAt(k++, d.matrix);
  }
  m.count = k; m.frustumCulled = false; scene.add(m); W.opaque.push(m);

  // dune grass tufts
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.04, 0, 0, 0.04, 0, 0, -0.02, 0.6, 0, 0.02, 0.6, 0, 0, 1.2, 0]), 3));
  bg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  const lo = new THREE.Color(0x6b7a3c), mid = new THREE.Color(0xa6a45a), hi = new THREE.Color(0xe2d49a);
  bg.setAttribute('color', new THREE.BufferAttribute(new Float32Array([lo.r, lo.g, lo.b, lo.r, lo.g, lo.b, mid.r, mid.g, mid.b, mid.r, mid.g, mid.b, hi.r, hi.g, hi.b]), 3));
  bg.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  const gm = swayMaterial({ k: 0.3, y0: 0, power: 1.4 }); gm.side = THREE.DoubleSide;
  const N = 5500, gmesh = new THREE.InstancedMesh(bg, gm, N); k = 0; tries = 0;
  while (k < N && tries++ < N * 6) {
    const x = rr(-110, 110), z = ZS + 18 + Math.pow(R(), 1.2) * 90, h = groundH(x, z);
    if (fbm(x * 0.07 + 2, z * 0.07) < 0.46 + 0.1 * (1 - smoothstep(ZS + 18, ZS + 60, z))) continue;
    d.position.set(x, h - 0.03, z); d.rotation.set(rr(-0.25, 0.25), R() * 6.28, rr(-0.25, 0.25)); d.scale.set(rr(0.8, 1.6), rr(0.5, 1.6), 1); d.updateMatrix(); gmesh.setMatrixAt(k++, d.matrix);
  }
  gmesh.count = k; gmesh.frustumCulled = false; scene.add(gmesh); W.opaque.push(gmesh);
  const grassFull = k; W.detailFns.push((f) => { gmesh.count = Math.floor(grassFull * f); });

  // driftwood + shells + pebbles
  const wood = new THREE.MeshLambertMaterial({ color: 0xa79480 });
  const log = new THREE.Group();
  log.add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 3.4, 8).rotateZ(Math.PI / 2), wood));
  const br = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.07, 0.8, 5).rotateZ(0.9), wood); br.position.set(0.5, 0.3, 0); log.add(br);
  const br2 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.06, 0.6, 5).rotateZ(-0.7), wood); br2.position.set(-0.8, 0.22, 0.05); log.add(br2);
  log.position.set(-2.9, groundH(-2.9, SEAT_Z + 1.8) + 0.12, SEAT_Z + 1.8); log.rotation.y = 0.5; scene.add(log); W.opaque.push(log);
  const sh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 6, 4).scale(1, 0.45, 0.8), new THREE.MeshLambertMaterial({ color: 0xffffff }), 70);
  const shc = [0xf3d9d0, 0xe9c6a8, 0xfaf1e4, 0xc9b79c, 0xe9b3ab].map(h => new THREE.Color(h));
  for (let i = 0; i < 70; i++) {
    const x = rr(-9, 9), z = rr(ZS + 4, SEAT_Z + 6); d.position.set(x, groundH(x, z) + 0.01, z); d.rotation.set(0, R() * 6, 0); d.scale.setScalar(rr(0.6, 1.8)); d.updateMatrix(); sh.setMatrixAt(i, d.matrix); sh.setColorAt(i, shc[i % 5]);
  }
  scene.add(sh); W.opaque.push(sh);
}

// ---------------- sailboat ----------------
const boat = new THREE.Group();
{
  const hull = new THREE.Mesh(new THREE.BoxGeometry(5.5, 1.1, 1.6), new THREE.MeshBasicMaterial({ color: 0x2a2220 })); hull.position.y = 0.2; boat.add(hull);
  const sailGeo = (pts) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3)); g.computeVertexNormals(); return g; };
  const sm = new THREE.MeshBasicMaterial({ color: 0xf3dfc8, side: THREE.DoubleSide });
  boat.add(new THREE.Mesh(sailGeo([-0.3, 0.8, 0, -0.3, 7.5, 0, 2.8, 0.8, 0]), sm));
  boat.add(new THREE.Mesh(sailGeo([-0.7, 0.8, 0, -0.7, 6.2, 0, -2.6, 0.8, 0]), sm));
  boat.position.set(-120, 0, -330); scene.add(boat); W.opaque.push(boat);
}

// ---------------- gulls ----------------
const gulls = [];
for (let i = 0; i < 11; i++) {
  const hero = i < 3;
  const b = makeBird({ wingSpan: hero ? 1.1 : rr(0.8, 1.2), tip: 0x2b2a30 });
  b.userData.p = { cx: rr(-60, 60), cz: hero ? rr(-30, -14) : rr(-45, -170), cy: hero ? rr(4, 8) : rr(7, 26), ax: hero ? rr(14, 26) : rr(40, 110), az: hero ? rr(6, 10) : rr(14, 40), ay: rr(1, 4), w: rr(0.06, 0.12) * (R() < 0.5 ? 1 : -1), ph: R() * 6.28, ph2: R() * 6.28, fl: rr(3.5, 5) };
  scene.add(b); gulls.push(b);
}
const gp = (p, t, o) => { const a = t * p.w + p.ph; return o.set(p.cx + Math.sin(a) * p.ax, p.cy + Math.sin(a * 0.8 + p.ph2) * p.ay, p.cz + Math.sin(a * 2 + 1) * p.az); };
const gA = new THREE.Vector3(), gB = new THREE.Vector3(), gC = new THREE.Vector3();

// ---------------- frame ----------------
let sceneT = 0;
function applyTime(p) {
  const mix = (a, b, out) => out.copy(a).lerp(b, p);
  mix(PA.top, PB.top, SU.uTop.value); mix(PA.mid, PB.mid, SU.uMid.value); mix(PA.hor, PB.hor, SU.uHor.value);
  mix(PA.sun, PB.sun, SU.uSunCol.value); mix(PA.lit, PB.lit, SU.uCloudLit.value); mix(PA.shade, PB.shade, SU.uCloudShade.value);
  mix(PA.deep, PB.deep, waterU.uDeep.value); mix(PA.shallow, PB.shallow, waterU.uShallow.value); mix(PA.shallow, PB.shallow, sandU.uShallow.value);
  mix(PA.hemi, PB.hemi, sandU.uHemi.value); mix(PA.sandDry, PB.sandDry, sandU.uSandDry.value); mix(PA.sandWet, PB.sandWet, sandU.uSandWet.value);
  scene.fog.color.copy(SU.uHor.value); W.bgColor.copy(SU.uHor.value);
  SU.uGlow.value = PA.glow + (PB.glow - PA.glow) * p; SU.uStars.value = PB.stars * smoothstep(0.55, 1.0, p);
  const el = PA.elev + (PB.elev - PA.elev) * p; SU.uSunDir.value.set(0.26, el, -0.96).normalize(); sunL.position.copy(SU.uSunDir.value).multiplyScalar(200);
  mix(PA.sunLight, PB.sunLight, sunL.color); sunL.intensity = PA.sunI + (PB.sunI - PA.sunI) * p * p;
  mix(PA.hemiL, PB.hemiL, hemiL.color); hemiL.intensity = PA.hemiI + (PB.hemiI - PA.hemiI) * p;
}
W.onFrame((dt, t) => {
  sceneT = t;
  const target = timeMode === 'auto' ? 0.5 - 0.5 * Math.cos(t * 0.0105) : timeMode === 'a' ? 0 : 1;   // auto: ~10 min golden hour -> dusk -> back
  pCur += (target - pCur) * Math.min(1, dt * 0.7);
  const p = pCur;
  applyTime(p);
  SU.uTime.value = t; sandU.uTime.value = t; waterU.uTime.value = t;
  boat.position.x = -120 + ((t * 0.55) % 520); boat.position.y = Math.sin(t * 0.7) * 0.12; boat.rotation.z = Math.sin(t * 0.55) * 0.035;
  for (const b of gulls) {
    const pr = b.userData.p;
    gp(pr, t, gA); gp(pr, t + 0.35, gB); gp(pr, t + 0.7, gC); b.position.copy(gA); b.lookAt(gB);
    let turn = Math.atan2(gC.x - gB.x, gC.z - gB.z) - Math.atan2(gB.x - gA.x, gB.z - gA.z); turn = Math.atan2(Math.sin(turn), Math.cos(turn)) * 4;
    const env = smoothstep(0.3, 0.75, Math.sin(t * 0.23 + pr.ph) * Math.sin(t * 0.14 + pr.ph2) + 0.25);
    poseBird(b, env, t * pr.fl + pr.ph, Math.max(-0.7, Math.min(0.7, -turn)));
  }
});

// ---------------- audio (waves are cued to the visible wave clock) ----------------
W.buildAudio = (A) => {
  const { ctx, master } = A;
  const rv = A.reverb(2.4, 2.4), wet = A.gain(0.45); rv.connect(wet); wet.connect(master);
  // distant surf bed
  const bed = A.noise('brown'), bg = A.gain(0.075); A.chain(bed, A.filter('lowpass', 260), bg, master); A.lfo(bg.gain, 0.11, 0.03);
  const mid = A.noise('pink'), mg = A.gain(0.03), mbp = A.filter('bandpass', 700, 0.5); A.chain(mid, mbp, mg, master); A.lfo(mg.gain, 0.11, 0.015); A.lfo(mbp.frequency, 0.09, 200);
  // light sea breeze
  const wind = A.noise('pink'), wbp = A.filter('bandpass', 380, 0.5), wg = A.gain(0.035); A.chain(wind, wbp, wg, master); A.lfo(wg.gain, 0.05, 0.02);
  // each wave: rising roar -> crash -> fizzing wash up the sand -> drain
  let lastN = -1;
  setInterval(() => {
    const n = Math.floor((sceneT + 1.1) / PERIOD);
    if (n === lastN || ctx.state !== 'running') return; lastN = n;
    const hh = Math.sin((n * 3.17 + 1.3) * 127.1) * 43758.5453, amp = 0.55 + 0.45 * (hh - Math.floor(hh));
    const t0 = ctx.currentTime, pan = (Math.random() - 0.5) * 0.5;
    const nz = A.noise('pink'), lp = A.filter('lowpass', 300, 0.6), g = A.gain(0.0001), pn = A.pan(pan);
    A.chain(nz, lp, g, pn, master); pn.connect(rv);
    lp.frequency.setValueAtTime(260, t0); lp.frequency.linearRampToValueAtTime(1800, t0 + 1.7); lp.frequency.exponentialRampToValueAtTime(420, t0 + 6.5);
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.1 * amp, t0 + 2.4); g.gain.exponentialRampToValueAtTime(0.0008, t0 + 7);
    const wsh = A.noise('white'), hp = A.filter('highpass', 3400, 0.7), wg2 = A.gain(0.0001), bub = A.gain(1);
    A.chain(wsh, hp, bub, wg2, pn); A.lfo(bub.gain, 38 + Math.random() * 20, 0.5); 
    wg2.gain.setValueAtTime(0.0001, t0 + 1.5); wg2.gain.linearRampToValueAtTime(0.03 * amp, t0 + 2.6); wg2.gain.linearRampToValueAtTime(0.02 * amp, t0 + 4.6); wg2.gain.exponentialRampToValueAtTime(0.0006, t0 + 8.2);
    const sz = A.noise('white'), sbp = A.filter('bandpass', 1500, 0.6), sg = A.gain(0.0001); A.chain(sz, sbp, sg, pn);
    sg.gain.setValueAtTime(0.0001, t0 + 1.2); sg.gain.linearRampToValueAtTime(0.03 * amp, t0 + 2.3); sg.gain.exponentialRampToValueAtTime(0.0006, t0 + 3.6);
    setTimeout(() => { for (const s of [nz, wsh, sz]) { try { s.stop(); } catch (e) {} } }, 9500);
  }, 400);
  // gulls
  const bus = (pan) => { const pn = A.pan(pan), lp = A.filter('lowpass', 5200), d = A.gain(0.6), s = A.gain(0.55); A.chain(pn, lp); lp.connect(d); d.connect(master); lp.connect(s); s.connect(rv); return pn; };
  A.every(() => {
    const dest = bus((Math.random() - 0.5) * 1.8), base = 1500 + Math.random() * 500, n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) A.blip({ f: [[0, base], [0.09, base * 1.55], [0.32 - i * 0.02, base]], dur: 0.38, vol: 0.03, attack: 0.03, type: 'triangle', dest, at: i * 0.42, vib: 70, vibRate: 55 });
  }, 10, 24, 4);
  // distant bell buoy
  A.every(() => {
    const dest = bus((Math.random() - 0.5) * 1.2);
    A.blip({ f: [[0, 523], [3, 520]], dur: 3.2, vol: 0.02, attack: 0.004, dest });
    A.blip({ f: [[0, 1319], [2, 1315]], dur: 1.8, vol: 0.006, attack: 0.004, dest });
  }, 22, 42, 10);
};

W.rig.position.set(0, seatY, SEAT_Z);
W.start();
