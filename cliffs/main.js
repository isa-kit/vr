// Cliffs — Edge of the Sea.  Seated on a grassy clifftop high above a vast
// ocean: long swells rolling in, foam lacing the cliff foot, sea-stacks and
// hazy islands, a lighthouse on a far headland, gulls gliding at eye level, a
// big slowly-turning sky and a very gradual shift from afternoon gold to dusk.

import {
  THREE, SHADER_TAIL, SKY_GLSL, createWorld, makeNoiseTexture, makeSky, swayMaterial,
  paint, fbm, vnoise, smoothstep, rng, hash, makeFlock, sectionRow, choiceGrid,
} from '../seated/common.js?v=20261113b';

const R = rng(7771);
const rr = (a, b) => a + R() * (b - a);
const H = 56;                                 // clifftop height above the sea

const HOR_A = 0xe8dfcf;
let timeMode = 'auto', pCur = 0;
const W = await createWorld({ eye: 1.15,
  rows: [sectionRow('Light'), ...choiceGrid([['Auto', 'auto'], ['Afternoon', 'a'], ['Golden', 'b']], () => timeMode, (v) => { timeMode = v; }, 3)],
  bg: HOR_A, title: 'Cliffs — Edge of the Sea', startPitch: -0.08, startYaw: 0,
  tone: { exposure: 1.0, bloom: 0.28, radius: 0.6, threshold: 0.97 } });
const { scene } = W;
const FOGD = 0.00085;
scene.fog = new THREE.FogExp2(HOR_A, FOGD);

const noise = makeNoiseTexture(256);

// ---------------- time-of-day palettes (A afternoon → B golden dusk) ----------------
const C = (h) => new THREE.Color(h);
const PA = { top: C(0x2b62b4), mid: C(0x80b2e0), hor: C(0xe8dfcf), sun: C(0xfff1d6), lit: C(0xffffff), shade: C(0xaab9d0), deep: C(0x08405e), shallow: C(0x2a8c98), sunLight: C(0xffe9c6), hemiS: C(0xcfe0f2), glow: 0.9, elev: 0.34, hemiI: 0.95, sunI: 1.25 };
const PB = { top: C(0x3b5b9b), mid: C(0xcf9f93), hor: C(0xf6c796), sun: C(0xffb868), lit: C(0xffe0bd), shade: C(0x86729a), deep: C(0x0e3a58), shallow: C(0x3a8a8e), sunLight: C(0xffb36b), hemiS: C(0xd9b6a8), glow: 1.25, elev: 0.075, hemiI: 0.8, sunI: 1.45 };

const sunDir = new THREE.Vector3(0.45, PA.elev, -0.88).normalize();
const sky = makeSky(noise, { top: 0x2b62b4, mid: 0x80b2e0, hor: HOR_A, sunDir, cover: 0.52, cloudScale: 1.0, windX: 0.0035, windY: 0.001, sunSize: 0.03, sunGain: 1.4 });
scene.add(sky.mesh); W.opaque.push(sky.mesh);
const SU = sky.uniforms;

const hemi = new THREE.HemisphereLight(0xcfe0f2, 0x6b7a4a, 0.95); scene.add(hemi);
const sunL = new THREE.DirectionalLight(0xffe9c6, 1.25); sunL.position.copy(sunDir).multiplyScalar(200); scene.add(sunL);

// ---------------- coastline (identical formula lives in the water shader) ----------------
const cz0 = (x) => -1.4 + 0.0016 * x * x + 5 * Math.sin(x * 0.045 + 1.3) + 3 * Math.sin(x * 0.11 + 4.1) + 2 * Math.sin(x * 0.23);
const C0 = cz0(0);
const SEAT_S = 22;      // the seat is 22 m back from the lip, on a broad grassy ledge that slopes gently down to a low wall
const RAMP = 8;         // metres the ledge falls between the seat and the wall
const coastZ = (x) => cz0(x) - C0 - SEAT_S;
const baseZ = (x) => coastZ(x) - 7.5;
const topH = (x, z, s) => H - RAMP * (1 - smoothstep(0, SEAT_S, s)) + 2.4 * (fbm(x * 0.012 + 3, z * 0.012 + 8) - 0.5) + 0.05 * Math.min(Math.max(s, 0), 480) * smoothstep(5, 120, s) + (fbm(x * 0.09, z * 0.09) - 0.5) * 0.5;
const seatY = topH(0, 0, -coastZ(0));

// ---------------- cliff + land (ribbon per column) ----------------
{
  const xs = [0]; { let x = 0, d = 2.6; for (let i = 0; i < 70; i++) { x += d; d *= 1.045; xs.push(x); } }
  const cols = []; for (let i = xs.length - 1; i >= 1; i--) cols.push(-xs[i]); for (const x of xs) cols.push(x);
  const landS = [1800, 1150, 760, 500, 330, 215, 140, 90, 60, 42, 30, 22, 17, 12, 8, 5, 3, 1.5, 0.6, 0];
  const NQ = 44, NL = landS.length;
  const verts = [], colors = [], idx = [];
  const pal = [0x8d8272, 0xa89c88, 0x6f675c, 0x9d9078, 0x7c7265].map(h => new THREE.Color(h));
  const g1 = new THREE.Color(0x5f8a3a), g2 = new THREE.Color(0x86a04a), g3 = new THREE.Color(0xb3ae62), dry = new THREE.Color(0xb7a56a), tmp = new THREE.Color();
  for (let ci = 0; ci < cols.length; ci++) {
    const x = cols[ci], zc = coastZ(x);
    for (let l = 0; l < NL; l++) {
      const s = landS[l], z = zc + s;
      const y = topH(x, z, s);
      verts.push(x, y, z);
      const n = fbm(x * 0.05, z * 0.05), m = fbm(x * 0.2 + 9, z * 0.2);
      tmp.copy(g1).lerp(g2, n).lerp(g3, smoothstep(0.55, 0.8, m) * 0.6).lerp(dry, 1 - smoothstep(0, 9, s));
      colors.push(tmp.r, tmp.g, tmp.b);
    }
    const y0 = topH(x, zc, 0);
    for (let q = 1; q <= NQ; q++) {
      const t = q / NQ, n1 = vnoise(x * 0.07, t * 3.0);
      let dz = 1.2 * t + 6.3 * Math.pow(t, 5) + 1.1 * (((t * 8 + n1 * 1.6) % 1) - 0.5) * Math.pow(Math.sin(Math.PI * t), 0.7)
             + 2.4 * (vnoise(x * 0.11 + 5, t * 5) - 0.5) * Math.sin(Math.PI * t);
      const y = y0 * (1 - t) + (t === 1 ? 0 : 0);
      verts.push(x, y, zc - dz);
      const layer = Math.floor(t * 8 + n1 * 1.5), hv = hash(layer, 3.3);
      tmp.copy(pal[Math.floor(hv * pal.length) % pal.length]).multiplyScalar(0.85 + 0.3 * vnoise(x * 0.3, t * 14));
      tmp.lerp(g1, (1 - smoothstep(0, 0.07, t)) * 0.8);
      tmp.lerp(new THREE.Color(0x3d3a36), smoothstep(0.88, 1.0, t) * 0.7);
      colors.push(tmp.r, tmp.g, tmp.b);
    }
    // underwater skirt row
    const lastZ = zc - 7.5; verts.push(x, -5, lastZ - 1.5); colors.push(0.2, 0.2, 0.2);
  }
  const per = NL + NQ + 1;
  for (let ci = 0; ci < cols.length - 1; ci++) for (let r = 0; r < per - 1; r++) {
    const a = ci * per + r, b = (ci + 1) * per + r;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  scene.add(mesh); W.opaque.push(mesh);
}

// ---------------- safety: a low stone wall along the lip, and a flat stone seat under the viewer ----------------
{
  const stone = new THREE.MeshLambertMaterial({ color: 0xffffff }), step = 2.1;
  const xs = []; for (let x = -200; x <= 200; x += step) xs.push(x);
  const wall = new THREE.InstancedMesh(new THREE.BoxGeometry(2.3, 1.1, 0.7), stone, xs.length), d = new THREE.Object3D();
  const cols = [0xb4ad9f, 0xc3bcae, 0xa49e92, 0xcbc4b5].map(h => new THREE.Color(h));
  xs.forEach((x, i) => {
    const z = coastZ(x) + 0.9, z2 = coastZ(x + step) + 0.9, sc = rr(0.92, 1.12);
    d.position.set(x + step / 2, topH(x, z, 0.9) + 0.4, (z + z2) / 2);
    d.rotation.set(0, -Math.atan2(z2 - z, step), 0); d.scale.set(1.02, sc, rr(0.95, 1.25)); d.updateMatrix();
    wall.setMatrixAt(i, d.matrix); wall.setColorAt(i, cols[i % 4]);
  });
  scene.add(wall); W.opaque.push(wall);
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.3, 28), new THREE.MeshLambertMaterial({ color: 0xd9cfb8 }));
  slab.position.set(0, seatY - 0.12, 0); scene.add(slab); W.opaque.push(slab);
}

// rocks at the foot of the cliff
{
  const geo = paint(new THREE.DodecahedronGeometry(1, 0).scale(1, 0.6, 1), 0x4c4843);
  const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), 170), d = new THREE.Object3D();
  for (let i = 0; i < 170; i++) {
    const x = (R() - 0.5) * 2 * (40 + Math.pow(R(), 2) * 320), z = baseZ(x) - rr(-1, 7);
    d.position.set(x, rr(-0.2, 0.4), z); d.rotation.set(R(), R() * 6, R()); d.scale.setScalar(rr(0.8, 3.6)); d.updateMatrix(); m.setMatrixAt(i, d.matrix);
  }
  scene.add(m); W.opaque.push(m);
}

// ---------------- islands, sea-stacks, far headlands ----------------
function makeIsland({ r, h, seed, detail = 4, steep = 0.8, rock = 0x7a746c, grass = 0x6a8a3e, grassMin = 0.18 }) {
  const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = fbm(x * 2.1 + seed, z * 2.1 + seed * 0.7, 3), n2 = fbm(x * 4.3 + seed, z * 4.3 - seed, 2);
    const yy = Math.max(y, -0.12), up = Math.pow(Math.max(yy, 0), steep);
    const rad = (1 + 0.45 * (n - 0.5)) * (1 - 0.25 * up);
    p.setXYZ(i, x * r * rad * (0.85 + 0.3 * n2), up * h * (0.75 + 0.5 * n2) + Math.min(yy, 0) * 4, z * r * rad * (0.85 + 0.3 * (1 - n2)));
  }
  g.computeVertexNormals();
  const col = new Float32Array(p.count * 3), n = g.attributes.normal, cr = new THREE.Color(rock), cg = new THREE.Color(grass), t = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const hf = p.getY(i) / h, grassy = n.getY(i) > 0.72 && hf > grassMin;
    t.copy(grassy ? cg : cr).multiplyScalar(0.86 + 0.28 * hash(i, seed));
    if (hf < 0.06) t.multiplyScalar(0.6);
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = t.r; col[(i + k) * 3 + 1] = t.g; col[(i + k) * 3 + 2] = t.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  return m;
}
const foamList = [];   // [x, z, radius] fed to the water shader
function addIsland(x, z, o) {
  const m = makeIsland(o); m.position.set(x, 0, z); m.rotation.y = R() * 6; scene.add(m); W.opaque.push(m);
  if (o.foam !== false) foamList.push([x, z, o.r * 0.8]);
  return m;
}
addIsland(-70, -185, { r: 7, h: 34, seed: 1.7, detail: 4, steep: 0.5, grassMin: 0.5 });
addIsland(95, -215, { r: 10, h: 36, seed: 4.1, detail: 4, steep: 0.5, grassMin: 0.45 });
addIsland(-170, -255, { r: 13, h: 30, seed: 8.2, detail: 4, steep: 0.55 });
addIsland(205, -290, { r: 44, h: 26, seed: 2.3, detail: 5, steep: 0.65 });
addIsland(-250, -370, { r: 60, h: 36, seed: 5.5, detail: 5, steep: 0.7 });
const lhIsle = addIsland(-175, -470, { r: 40, h: 30, seed: 6.4, detail: 5, steep: 0.7 });
addIsland(130, -560, { r: 90, h: 44, seed: 3.3, detail: 5, steep: 0.8 });
addIsland(560, -950, { r: 230, h: 95, seed: 9.1, detail: 5, steep: 0.85, foam: false });
addIsland(-700, -1150, { r: 280, h: 120, seed: 1.1, detail: 5, steep: 0.9, foam: false });
addIsland(-80, -1500, { r: 360, h: 80, seed: 7.7, detail: 4, steep: 0.9, foam: false });
const isl = []; for (let i = 0; i < 8; i++) isl.push(foamList[i] ? new THREE.Vector4(foamList[i][0], foamList[i][1], foamList[i][2], 0) : new THREE.Vector4(0, 1e5, 0, 0));

// lighthouse on the far-left headland
let lamp;
{
  const g = new THREE.Group(), mat = new THREE.MeshLambertMaterial({ color: 0xf4efe6 }), red = new THREE.MeshLambertMaterial({ color: 0xb5342a });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.4, 22, 12), mat); tower.position.y = 11; g.add(tower);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.86, 2.0, 5, 12), red); band.position.y = 11; g.add(band);
  const gal = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.0, 0.9, 12), new THREE.MeshLambertMaterial({ color: 0x2a2f36 })); gal.position.y = 22.4; g.add(gal);
  lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 10), new THREE.MeshBasicMaterial({ color: 0xffe8a8, fog: false })); lamp.position.y = 24; g.add(lamp);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.2, 10), red); roof.position.y = 26.2; g.add(roof);
  g.position.set(-175 + 6, lhIsle.geometry.boundingBox ? 0 : 0, -470 + 4);
  lhIsle.geometry.computeBoundingBox(); g.position.y = lhIsle.geometry.boundingBox.max.y * 0.82;
  scene.add(g); W.opaque.push(g);
}

// ---------------- water ----------------
const waterU = {
  uTime: { value: 0 }, uC0: { value: C0 }, uNoise: { value: noise }, uIsl: { value: isl },
  uDeep: { value: PA.deep.clone() }, uShallow: { value: PA.shallow.clone() },
  uFogColor: { value: scene.fog.color }, uFogD: { value: FOGD },
  uTop: SU.uTop, uMid: SU.uMid, uHor: SU.uHor, uSunDir: SU.uSunDir, uSunCol: SU.uSunCol, uGlow: SU.uGlow,
};
{
  const mat = new THREE.ShaderMaterial({
    uniforms: waterU, fog: false,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      varying vec3 vW; uniform float uTime, uC0, uFogD; uniform vec3 uDeep, uShallow, uFogColor; uniform vec4 uIsl[8]; uniform sampler2D uNoise;
      ${SKY_GLSL}
      float coastZ(float x){ return -1.4 + 0.0016*x*x + 5.0*sin(x*0.045+1.3) + 3.0*sin(x*0.11+4.1) + 2.0*sin(x*0.23) - uC0 - 22.0; }
      void wave(vec2 p, vec2 dir, float len, float slope, float dist, inout vec2 g, inout float h){
        float k = 6.2831853 / len; float w = sqrt(9.81 * k);
        float ph = dot(p, dir) * k - w * uTime * 0.6;
        float f = 1.0 / (1.0 + dist * k * 0.05);
        g += dir * slope * f * cos(ph); h += slope / k * f * sin(ph);
      }
      void main(){
        vec3 Vv = cameraPosition - vW; float dist = length(Vv); vec3 V = Vv / dist;
        vec2 p0 = vW.xz; vec2 p = p0 + (texture2D(uNoise, p0 * 0.0035 + 0.31).rg - 0.5) * 70.0; vec2 g = vec2(0.0); float h = 0.0;
        wave(p, normalize(vec2(0.12, 1.0)), 120.0, 0.07, dist, g, h);
        wave(p, normalize(vec2(-0.35, 1.0)), 64.0, 0.055, dist, g, h);
        wave(p, normalize(vec2(0.55, 0.85)), 29.0, 0.045, dist, g, h);
        wave(p, normalize(vec2(-0.7, 0.7)), 13.0, 0.035, dist, g, h);
        wave(p, normalize(vec2(0.2, 1.0)), 5.5, 0.022, dist, g, h);
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        float cosT = clamp(dot(N, V), 0.0, 1.0);
        float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
        float dC = coastZ(p0.x) - 7.5 - p0.y;                      // metres seaward of the cliff foot
        float shallowK = exp(-max(dC, 0.0) * 0.045) * step(0.0, dC);
        vec3 body = mix(uDeep, uShallow, clamp(0.3 + h * 0.16 + (1.0 - cosT) * 0.15, 0.0, 1.0));
        body = mix(body, uShallow * 1.25, shallowK * 0.65);
        vec3 col = mix(body, skyGrad(R), fres);
        float tw = texture2D(uNoise, p * 0.5 + vec2(uTime * 0.05, 0.0)).a;
        col += uSunCol * pow(max(dot(R, uSunDir), 0.0), 260.0) * (0.4 + tw) * 2.2;
        // foam: along the cliff foot, around the islands, and whitecaps on the swell
        float nf = texture2D(uNoise, p * 0.17 + vec2(uTime * 0.025, uTime * 0.01)).g;
        float nf2 = texture2D(uNoise, p * 0.45 - vec2(uTime * 0.02, 0.0)).b;
        float surge = 0.5 + 0.5 * sin(uTime * 0.85 + p.x * 0.06);
        float foam = smoothstep(7.0 + 5.0 * surge, 0.0, dC) * step(-4.0, dC);
        for (int i = 0; i < 8; i++) {
          float d = length(p0 - uIsl[i].xy) - uIsl[i].z;
          foam = max(foam, smoothstep(6.0 + 2.5 * sin(uTime * 0.8 + float(i) * 2.0), 0.0, d) * step(-3.0, d));
        }
        foam = foam * smoothstep(0.22, 0.62, nf * 0.7 + nf2 * 0.4 + foam * 0.45);
        float cap = smoothstep(1.55, 2.1, h + (nf2 - 0.5) * 1.3) * 0.55 * (1.0 - smoothstep(150.0, 600.0, dist));
        col = mix(col, vec3(0.97, 0.97, 0.95) * (0.82 + 0.3 * uSunCol), clamp(foam * 0.85 + cap, 0.0, 1.0));
        float fg = 1.0 - exp(-uFogD * uFogD * dist * dist);
        col = mix(col, uFogColor, fg);
        gl_FragColor = vec4(col, 1.0);
        ${SHADER_TAIL}
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000, 1, 1).rotateX(-Math.PI / 2), mat);
  m.frustumCulled = false; scene.add(m); W.opaque.push(m);
}

// ---------------- grass, flowers, rocks around the seat ----------------
{
  // blade: tapered strip, normals straight up for soft lighting
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.03, 0, 0, 0.03, 0, 0, -0.02, 0.5, 0, 0.02, 0.5, 0, 0, 1, 0]), 3));
  bg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  const lo = new THREE.Color(0x4f7d33), hi = new THREE.Color(0xd6d27c), mid = new THREE.Color(0x8cae56);
  bg.setAttribute('color', new THREE.BufferAttribute(new Float32Array([lo.r, lo.g, lo.b, lo.r, lo.g, lo.b, mid.r, mid.g, mid.b, mid.r, mid.g, mid.b, hi.r, hi.g, hi.b]), 3));
  bg.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  const gm = swayMaterial({ k: 0.22, y0: 0, power: 1.5 }); gm.side = THREE.DoubleSide;
  const N = 7500, m = new THREE.InstancedMesh(bg, gm, N), d = new THREE.Object3D(); let k = 0, tries = 0;
  while (k < N && tries++ < N * 5) {
    const a = R() * 6.283, r = 0.05 + Math.pow(R(), 1.5) * 42, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const s = z - coastZ(x); if (s < 9 || Math.hypot(x, z) < 2.6) continue;
    d.position.set(x, topH(x, z, s) - 0.03, z);
    d.rotation.set(rr(-0.18, 0.18), R() * 6.28, rr(-0.18, 0.18)); d.scale.set(rr(1, 1.7), rr(0.3, 0.8), 1); d.updateMatrix(); m.setMatrixAt(k++, d.matrix);
  }
  m.count = k; m.frustumCulled = false; scene.add(m); W.opaque.push(m);
  const grassFull = k; W.detailFns.push((f) => { m.count = Math.floor(grassFull * f); });

  // thrift & daisies
  const fg = new THREE.OctahedronGeometry(0.028, 0), fm = new THREE.InstancedMesh(fg, new THREE.MeshLambertMaterial({ color: 0xffffff }), 220);
  const cols = [0xf09ab8, 0xf6f2e8, 0xf7d55a, 0xc9a0ee].map(h => new THREE.Color(h));
  k = 0; tries = 0;
  while (k < 220 && tries++ < 3000) {
    const a = R() * 6.283, r = 1 + R() * 20, x = Math.cos(a) * r, z = Math.sin(a) * r, s = z - coastZ(x); if (s < 1.8 || Math.hypot(x, z) < 3.4) continue;
    d.position.set(x, topH(x, z, s) + rr(0.18, 0.4), z); d.rotation.set(R(), R(), R()); d.scale.setScalar(rr(0.8, 1.6)); d.updateMatrix();
    fm.setMatrixAt(k, d.matrix); fm.setColorAt(k, cols[k % 4]); k++;
  }
  fm.count = k; scene.add(fm); W.opaque.push(fm);

  // boulders and a little cairn
  const rock = paint(new THREE.DodecahedronGeometry(0.7, 1).scale(1, 0.7, 1), 0x7d776d), rm = new THREE.InstancedMesh(rock, new THREE.MeshLambertMaterial({ vertexColors: true }), 26);
  for (let i = 0; i < 26; i++) {
    const a = R() * 6.283, r = 3 + R() * 70, x = Math.cos(a) * r, z = Math.sin(a) * r, s = z - coastZ(x);
    if (s < 12 || Math.hypot(x, z) < 12) { d.scale.setScalar(0); d.updateMatrix(); rm.setMatrixAt(i, d.matrix); continue; }
    d.position.set(x, topH(x, z, s) + 0.05, z); d.rotation.set(R(), R() * 6, R()); d.scale.setScalar(rr(0.5, 2.2)); d.updateMatrix(); rm.setMatrixAt(i, d.matrix);
  }
  scene.add(rm); W.opaque.push(rm);
  const cairn = new THREE.Group(), cm = new THREE.MeshLambertMaterial({ color: 0x8b857a });
  [[0.55, 0.28], [0.4, 0.22], [0.28, 0.17], [0.17, 0.12]].reduce((y, [rad, hh]) => { const s = new THREE.Mesh(new THREE.DodecahedronGeometry(rad, 0).scale(1, 0.6, 1), cm); s.position.set(rr(-0.04, 0.04), y + hh * 0.5, rr(-0.04, 0.04)); s.rotation.y = R() * 6; cairn.add(s); return y + hh * 0.9; }, 0);
  const cx = -3.2, cz = 2.2; cairn.position.set(cx, topH(cx, cz, cz - coastZ(cx)), cz); scene.add(cairn); W.opaque.push(cairn);
}

// ---------------- seabirds: loose flocks on long lazy arcs, gliding on the updraft with slow bursts of flapping ----------------
const flocks = [
  makeFlock(scene, { n: 4, c: [15, seatY - 2, -62], r: [55, 22], speed: 3.6, dir: 1, span: 2.0, flapEvery: [9, 16], flapFrac: 0.26, flapHz: 2.2, spread: [9, 4, 9] }),
  makeFlock(scene, { n: 3, c: [-45, seatY + 3, -100], r: [75, 28], speed: 4.4, dir: -1, span: 2.1, flapEvery: [10, 18], flapFrac: 0.24, flapHz: 2.0, spread: [10, 5, 10] }),
  makeFlock(scene, { n: 2, c: [25, seatY - 6, -78], r: [60, 22], speed: 3.9, dir: -1, span: 1.9, flapEvery: [12, 20], flapFrac: 0.18, flapHz: 1.9, spread: [8, 3, 5] }),
  makeFlock(scene, { n: 1, c: [-10, seatY - 8, -110], r: [95, 30], speed: 5.5, dir: 1, span: 3.0, birdOpts: { body: 0xf4f1ea, wing: 0xe9ecef, tip: 0x1e1f24, beak: 0xd9c9a0 }, flapEvery: [20, 30], flapFrac: 0.1, flapHz: 1.5, spread: [0, 0, 8] }),   // a big soaring bird
];

// ---------------- frame ----------------
const tmpC = new THREE.Color();
let tOffset = 0;
function applyTime(p) {
  const mix = (a, b, out) => out.copy(a).lerp(b, p);
  mix(PA.top, PB.top, SU.uTop.value); mix(PA.mid, PB.mid, SU.uMid.value); mix(PA.hor, PB.hor, SU.uHor.value);
  mix(PA.sun, PB.sun, SU.uSunCol.value); mix(PA.lit, PB.lit, SU.uCloudLit.value); mix(PA.shade, PB.shade, SU.uCloudShade.value);
  mix(PA.deep, PB.deep, waterU.uDeep.value); mix(PA.shallow, PB.shallow, waterU.uShallow.value);
  scene.fog.color.copy(SU.uHor.value); W.bgColor.copy(SU.uHor.value);
  SU.uGlow.value = PA.glow + (PB.glow - PA.glow) * p;
  const el = PA.elev + (PB.elev - PA.elev) * p;
  SU.uSunDir.value.set(0.45, el, -0.88).normalize(); sunL.position.copy(SU.uSunDir.value).multiplyScalar(200);
  mix(PA.sunLight, PB.sunLight, sunL.color); sunL.intensity = PA.sunI + (PB.sunI - PA.sunI) * p;
  mix(PA.hemiS, PB.hemiS, hemi.color); hemi.intensity = PA.hemiI + (PB.hemiI - PA.hemiI) * p;
}
W.onFrame((dt, t) => {
  const target = timeMode === 'auto' ? 0.5 - 0.5 * Math.cos(t * 0.0125) : timeMode === 'a' ? 0 : 1;   // auto: ~8 min round trip
  pCur += (target - pCur) * Math.min(1, dt * 0.7);
  const p = pCur;
  applyTime(p * 0.9);
  SU.uTime.value = t; waterU.uTime.value = t;
  lamp.material.color.setRGB(1.3, 1.15, 0.7).multiplyScalar(0.85 + 0.15 * Math.sin(t * 0.35) + 0.3 * p);
  for (const f of flocks) f.update(dt, t);
});

// ---------------- audio ----------------
W.buildAudio = (A) => {
  const { ctx, master } = A;
  const rv = A.reverb(2.2, 2.4), wet = A.gain(0.5); rv.connect(wet); wet.connect(master);
  // wind: broad, with slow gusts that also sweep the filter
  const wind = A.noise('pink'), wbp = A.filter('bandpass', 520, 0.5), wg = A.gain(0.10);
  A.chain(wind, wbp, wg, master); A.lfo(wg.gain, 0.045, 0.05); A.lfo(wg.gain, 0.11, 0.025); A.lfo(wbp.frequency, 0.06, 220);
  const hi = A.noise('white'), hbp = A.filter('bandpass', 2400, 0.7), hg = A.gain(0.012);
  A.chain(hi, A.filter('highpass', 1800), hbp, hg, master); A.lfo(hg.gain, 0.09, 0.008); A.lfo(hbp.frequency, 0.05, 700);
  // grass hiss at the feet
  const gr = A.noise('white'), gg = A.gain(0.006); A.chain(gr, A.filter('highpass', 5000), gg, master); A.lfo(gg.gain, 0.14, 0.004);
  // ocean bed rumble
  const bed = A.noise('brown'), bg = A.gain(0.07); A.chain(bed, A.filter('lowpass', 220), bg, master); A.lfo(bg.gain, 0.07, 0.03);
  // surf: a swell arrives, booms against the cliff, hisses back
  A.every(() => {
    const t0 = ctx.currentTime, pan = (Math.random() - 0.5) * 1.2, amp = 0.6 + Math.random() * 0.7;
    const n = A.noise('pink'), lp = A.filter('lowpass', 300, 0.7), g = A.gain(0.0001), p = A.pan(pan);
    A.chain(n, lp, g, p, master); p.connect(rv);
    lp.frequency.setValueAtTime(280, t0); lp.frequency.linearRampToValueAtTime(1100, t0 + 2.8); lp.frequency.exponentialRampToValueAtTime(260, t0 + 8);
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.11 * amp, t0 + 3.4); g.gain.exponentialRampToValueAtTime(0.0008, t0 + 9);
    setTimeout(() => { try { n.stop(); } catch (e) {} }, 9000);
    const h = A.noise('white'), hb = A.filter('bandpass', 3000, 0.8), hg2 = A.gain(0.0001); A.chain(h, hb, hg2, p);
    hg2.gain.setValueAtTime(0.0001, t0 + 2.4); hg2.gain.linearRampToValueAtTime(0.03 * amp, t0 + 3.0); hg2.gain.exponentialRampToValueAtTime(0.0005, t0 + 8);
    setTimeout(() => { try { h.stop(); } catch (e) {} }, 9000);
    A.blip({ f: [[0, 62], [1.2, 38]], dur: 1.4, type: 'sine', vol: 0.06 * amp, attack: 0.05, at: 2.7, pan: pan * 0.5 });
  }, 7, 11, 0.3);
  // gulls
  const bus = (pan) => { const pn = A.pan(pan), lp = A.filter('lowpass', 5200), d = A.gain(0.6), s = A.gain(0.5); A.chain(pn, lp); lp.connect(d); d.connect(master); lp.connect(s); s.connect(rv); return pn; };
  A.every(() => {
    const dest = bus((Math.random() - 0.5) * 1.8), base = 1500 + Math.random() * 500, near = 0.5 + Math.random() * 0.6, n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) A.blip({ f: [[0, base], [0.09, base * 1.55], [0.32 - i * 0.02, base * 1.0]], dur: 0.38, vol: 0.035 * near, attack: 0.03, type: 'triangle', dest, at: i * 0.42, vib: 70, vibRate: 55 });
  }, 8, 20, 3);
  A.every(() => {   // short mewing calls
    const dest = bus((Math.random() - 0.5) * 1.6), base = 1900 + Math.random() * 400;
    for (let i = 0; i < 3; i++) A.blip({ f: [[0, base * 0.9], [0.1, base * 1.2], [0.2, base]], dur: 0.22, vol: 0.022, attack: 0.02, type: 'triangle', dest, at: i * 0.26, vib: 50, vibRate: 40 });
  }, 14, 30, 8);
};

W.flocks = flocks;
W.rig.position.set(0, seatY, 0);
W.start();
