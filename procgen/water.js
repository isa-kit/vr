// ============================ procgen/water.js — lakes and oceans: Gerstner waves, fresnel, glitter, shore ============================
//
//   import { createWater } from '../procgen/water.js';
//
//   const water = createWater({
//       level: 12.4,                                    // world y of the still-water surface
//       bounds: { cx: -90, cz: -520, w: 260, d: 160 },  // rectangle the surface covers
//       segments: 160,                                  // mesh resolution (vertex waves)   (Light tier: 64)
//       depthFn: (x, z) => metresOfWaterAt(x, z),       // optional: depth below the surface (<= 0 on land) — drives shallows tint, transparency, shore foam
//       maxDepth: 8,
//       waves: [ { dir: [1, 0.3], steep: 0.12, len: 24, speed: 1 }, … ],   // Gerstner components (default set is built in)
//       colors: { shallow: 0x3f8f86, deep: 0x0e3a45 },
//       foam: 0.8, ripples: 1,
//       calm: 1,                                        // 0.3 = nearly flat lake … 1 = ocean swell
//   });
//   scene.add(water.mesh);  water.update(t);           // every frame (stop advancing t to pause)
//   water.height(x, z, t)                              // wave height (m) above `level` — for floating things / boats
//
//   const shore = createShoreline({ base: { x, z }, land: [lx, lz], runup: 5, period: 12, groundH: (x, z) => y });   // swash + wet sand (see bottom of file)
//   shore.update(t); shore.patchMaterial(sandMaterial);            // sand material gets the water film, foam line, wet darkening, tide mark
//   shore.front(u, t)  shore.waterY(x, z, t)  shore.wetness(x, z, t)  shore.runup(x, z, t)   // the same numbers the shader draws
//
// A MeshStandardMaterial: reflections come from scene.environment (put sky.env there), sun glints from the DirectionalLight,
// fog from scene.fog. Waves = summed Gerstner in the vertex shader with analytic normals; fine ripples in the fragment shader.
// ================================================================================================================

import * as THREE from 'three';

const DEFAULT_WAVES = [
  { dir: [1, 0.25], steep: 0.1, len: 38, speed: 1 }, { dir: [0.6, 0.8], steep: 0.08, len: 21, speed: 1 },
  { dir: [-0.4, 0.9], steep: 0.06, len: 11, speed: 1 }, { dir: [0.9, -0.5], steep: 0.04, len: 6, speed: 1 },
];

export function createWater({ level = 0, bounds, segments = 128, depthFn = null, maxDepth = 8, waves = DEFAULT_WAVES, colors = {}, foam = 0.8, ripples = 1, calm = 1, depthRes = 192 } = {}) {
  const C = { shallow: 0x3f8f86, deep: 0x0e3a45, ...colors }, g = new THREE.PlaneGeometry(bounds.w, bounds.d, segments, Math.max(2, Math.round(segments * bounds.d / bounds.w)));
  g.rotateX(-Math.PI / 2);
  // depth map: R = depth / maxDepth (0 on land)
  let depthTex = null;
  if (depthFn) {
    const d8 = new Uint8Array(depthRes * depthRes * 4);
    for (let j = 0; j < depthRes; j++) for (let i = 0; i < depthRes; i++) {
      const x = bounds.cx + (i / (depthRes - 1) - 0.5) * bounds.w, z = bounds.cz + (j / (depthRes - 1) - 0.5) * bounds.d, dd = Math.max(0, Math.min(1, depthFn(x, z) / maxDepth));
      const o = (j * depthRes + i) * 4; d8[o] = dd * 255; d8[o + 1] = dd * 255; d8[o + 2] = dd * 255; d8[o + 3] = 255;
    }
    depthTex = new THREE.DataTexture(d8, depthRes, depthRes, THREE.RGBAFormat); depthTex.magFilter = depthTex.minFilter = THREE.LinearFilter; depthTex.needsUpdate = true;
  }
  const wv = waves.slice(0, 6).map(w => { const l = Math.hypot(w.dir[0], w.dir[1]); const k = 2 * Math.PI / w.len; return new THREE.Vector4(w.dir[0] / l, w.dir[1] / l, Math.min(0.5, w.steep * calm) / k, k); });   // dirx, dirz, amplitude, k
  const wsp = waves.slice(0, 6).map(w => Math.sqrt(9.81 * 2 * Math.PI / w.len) * (w.speed || 1));
  while (wv.length < 6) { wv.push(new THREE.Vector4(1, 0, 0, 1)); wsp.push(0); }
  const u = {
    uTime: { value: 0 }, uWaves: { value: wv }, uSpeed: { value: wsp }, uShallow: { value: new THREE.Color(C.shallow) }, uDeep: { value: new THREE.Color(C.deep) },
    uDepth: { value: depthTex }, uHasDepth: { value: depthTex ? 1 : 0 }, uB: { value: new THREE.Vector4(bounds.cx, bounds.cz, bounds.w, bounds.d) }, uFoam: { value: foam }, uRip: { value: ripples * (0.4 + 0.6 * calm) },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.06, metalness: 0, transparent: true, envMapIntensity: 1.1 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = `uniform float uTime; uniform vec4 uWaves[6]; uniform float uSpeed[6]; varying vec3 vWp; varying float vH;
      vec3 gerst(vec2 p, out vec3 nrm){ vec3 off = vec3(0.0); vec2 slope = vec2(0.0);
        for (int i = 0; i < 6; i++){ vec4 w = uWaves[i]; if (w.z <= 0.0) continue; float ph = dot(w.xy, p) * w.w - uSpeed[i] * uTime; float c = cos(ph), s = sin(ph);
          off.xz += w.xy * w.z * w.w * 0.9 * c; off.y += w.z * s; slope += w.xy * w.z * w.w * c; }
        nrm = normalize(vec3(-slope.x, 1.0, -slope.y)); return off; }\n` + sh.vertexShader
      .replace('#include <beginnormal_vertex>', 'vec3 nW; vec3 goff = gerst((modelMatrix * vec4(position, 1.0)).xz, nW); vec3 objectNormal = nW;')
      .replace('#include <begin_vertex>', 'vec3 transformed = position + goff; vWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vH = goff.y;');
    sh.fragmentShader = `uniform float uTime, uFoam, uRip; uniform vec3 uShallow, uDeep; uniform sampler2D uDepth; uniform float uHasDepth; uniform vec4 uB; varying vec3 vWp; varying float vH;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ return vn(p) * 0.5 + vn(p * 2.1 + 3.1) * 0.3 + vn(p * 4.3 + 7.7) * 0.2; }\n` + sh.fragmentShader
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec2 q = vWp.xz; float e = 0.2, fd = 1.0 / (1.0 + length(vViewPosition) * 0.05);
          float r0 = fbm(q * 0.55 + vec2(uTime * 0.2, uTime * 0.12)), rx = fbm((q + vec2(e, 0.0)) * 0.55 + vec2(uTime * 0.2, uTime * 0.12)), rz = fbm((q + vec2(0.0, e)) * 0.55 + vec2(uTime * 0.2, uTime * 0.12));
          vec3 pn = normalize(vec3((r0 - rx) * uRip * 0.5 * fd, e, (r0 - rz) * uRip * 0.5 * fd)); normal = normalize(normal + (viewMatrix * vec4(pn.x, 0.0, pn.z, 0.0)).xyz * 0.5); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float depthN = 1.0, shore = 0.0;
        if (uHasDepth > 0.5) { vec2 duv = (vWp.xz - uB.xy) / uB.zw + 0.5; depthN = texture2D(uDepth, clamp(duv, 0.0, 1.0)).r; shore = 1.0 - smoothstep(0.0, 0.1, depthN); }
        float dtint = smoothstep(0.0, 0.6, depthN);
        diffuseColor.rgb = mix(uShallow, uDeep, dtint);
        float crest = smoothstep(0.55, 1.0, vH * 0.0 + fbm(vWp.xz * 0.45 + uTime * 0.05) + vH * 0.9 - 0.15);
        float edgeFoam = shore * (0.45 + 0.55 * fbm(vWp.xz * 3.0 + vec2(uTime * 0.4, 0.0))) * smoothstep(0.35, 0.8, fbm(vWp.xz * 1.4 - uTime * 0.12) + 0.35);
        float foamAmt = clamp((crest * 0.5 + edgeFoam * 1.2) * uFoam, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.94), foamAmt);
        diffuseColor.a = (uHasDepth > 0.5 ? smoothstep(0.0, 0.05, depthN) * 0.85 + 0.15 * smoothstep(0.0, 0.3, depthN) : 1.0) * (1.0 - 0.0) ; diffuseColor.a = max(diffuseColor.a, foamAmt * 0.9) * smoothstep(0.0, 0.02, depthN + (1.0 - uHasDepth));`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(0.05, 0.6, clamp(foamAmt, 0.0, 1.0));');
  };
  const mesh = new THREE.Mesh(g, mat); mesh.position.set(bounds.cx, level, bounds.cz); mesh.frustumCulled = false; mesh.renderOrder = 2; mesh.receiveShadow = false;
  const height = (x, z, t) => { let h = 0; for (let i = 0; i < wv.length; i++) { const w = wv[i]; if (w.z <= 0) continue; h += w.z * Math.sin((w.x * x + w.y * z) * w.w - wsp[i] * t); } return h; };
  return { mesh, uniforms: u, update(t) { u.uTime.value = t; }, height, level };
}

// ======================================================================================================
// Shoreline: waves that run up a sloped beach and retreat, leaving a foam line and a wet-sand tide mark
// ======================================================================================================
//   createShoreline({
//       base:   { x, z },          // a point on the still-water line (where the sand just meets the sea level)
//       land:   [lx, lz],          // unit vector pointing from the sea toward the land (the beach's "up-slope" direction)
//       runup:  5,                 // metres the largest swash reaches up the beach (horizontal distance)
//       period: 12,                // seconds between waves
//       surge:  0.3,               // fraction of the period spent rushing up (the rest is the slow retreat)
//       dry:    28,                // seconds for a wet patch to dry back to sand
//       groundH: (x, z) => y,      // ground height (used to turn a run-up distance into a water-surface height)
//   })
//   u = lateral coordinate along the shore (metres); d = distance landward of the base line (metres)
//   shore.coords(x, z)            → { u, d }
//   shore.front(u, t)             → { s, tau, smax, surging }   s = how far up the beach the water front is NOW at lateral u
//   shore.waterY(x, z, t)         → world y of the swash water surface at (x,z), or -Infinity when that spot is dry. Use it to fill dug holes.
//   shore.depth(x, z, t)          → water depth over the ground at (x,z) right now (0 if dry)
//   shore.wetness(x, z, t)        → 0 dry … 1 soaked (also high where the swash passed recently, fading as it dries)
//   shore.tideMark(x, z, t)       → 0..1 strength of the faint foam / high-water line left at each wave's furthest reach
//   shore.runup(x, z, t)          → { front: {x,z,y}, phase: 'surge'|'retreat', tau }  front position of the swash at that lateral position
//   shore.patchMaterial(mat, { wetDark: 0.5 })   patches a MeshStandardMaterial so the sand draws all of the above
// All of it is a pure function of (parameters, x, z, t): JS and shader use identical formulas, so queries match what you see.

const SHORE_GLSL = `
  uniform vec4 uShoreBase; uniform vec4 uShoreP; uniform float uShoreT;
  float shT(float u){ return 1.4 * sin(u * 0.05 + 0.7) + 0.9 * sin(u * 0.131 + 2.0) + 0.5 * sin(u * 0.37); }
  float shAmp(float n){ return 0.55 + 0.45 * (0.5 + 0.5 * sin(n * 2.399 + 1.3) * cos(n * 0.713)); }
  float shS(float tau, float smax, float sg){ float a = 1.0 - pow(1.0 - clamp(tau / sg, 0.0, 1.0), 2.0); float b = 1.0 - smoothstep(sg, 0.99, tau); return smax * (tau < sg ? a : b); }
  void shFront(float u, out float s, out float tau, out float smax){ float lt = (uShoreT - shT(u)) / uShoreP.x; float n = floor(lt); tau = lt - n; smax = uShoreP.y * shAmp(n); s = shS(tau, smax, uShoreP.z); }
  float shExtent(float u, float k, out float f, out float s){            // furthest reach of wave k waves ago, and how dried-out it is
    float lt = (uShoreT - shT(u)) / uShoreP.x; float n = floor(lt) - k; float tau = lt - floor(lt) + k;
    float smax = uShoreP.y * shAmp(n); float age = tau * uShoreP.x; float cur = shS(tau, smax, uShoreP.z);
    s = k < 0.5 && tau < uShoreP.z ? cur : smax; f = exp(-max(0.0, age - uShoreP.x * 0.9) / uShoreP.w); return s; }
  float shWet(float u, float d){ float w = 0.0; for (int k = 0; k < 3; k++){ float f, s; float e = shExtent(u, float(k), f, s); w = max(w, smoothstep(e + 0.45, e - 0.5, d) * f); } return w; }
  float shMark(float u, float d){ float m = 0.0; for (int k = 0; k < 3; k++){ float f, s; float e = shExtent(u, float(k), f, s); float ageF = k == 0 ? 0.55 : 1.0; m = max(m, smoothstep(0.42, 0.0, abs(d - e + 0.15)) * f * f * ageF); } return m; }
`;

export function createShoreline({ base, land, runup = 5, period = 12, surge = 0.3, dry = 28, groundH = () => 0 } = {}) {
  const L = Math.hypot(land[0], land[1]), lx = land[0] / L, lz = land[1] / L, B = { x: base.x, z: base.z };
  const uni = { uShoreBase: { value: new THREE.Vector4(B.x, B.z, lx, lz) }, uShoreP: { value: new THREE.Vector4(period, runup, surge, dry) }, uShoreT: { value: 0 } };
  const sstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const tShift = (u) => 1.4 * Math.sin(u * 0.05 + 0.7) + 0.9 * Math.sin(u * 0.131 + 2.0) + 0.5 * Math.sin(u * 0.37);
  const amp = (n) => 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(n * 2.399 + 1.3) * Math.cos(n * 0.713));
  const prof = (tau, smax) => { const a = 1 - Math.pow(1 - Math.min(1, Math.max(0, tau / surge)), 2), b = 1 - sstep(surge, 0.99, tau); return smax * (tau < surge ? a : b); };
  const coords = (x, z) => ({ u: -(x - B.x) * lz + (z - B.z) * lx, d: (x - B.x) * lx + (z - B.z) * lz });
  const front = (u, t) => { const lt = (t - tShift(u)) / period, n = Math.floor(lt), tau = lt - n, smax = runup * amp(n); return { s: prof(tau, smax), tau, smax, surging: tau < surge }; };
  const extent = (u, k, t) => { const lt = (t - tShift(u)) / period, n = Math.floor(lt) - k, tau = lt - Math.floor(lt) + k, smax = runup * amp(n), age = tau * period; return { e: k === 0 && tau < surge ? prof(tau, smax) : smax, f: Math.exp(-Math.max(0, age - period * 0.9) / dry) }; };
  const pointAt = (u, d) => ({ x: B.x - lz * u + lx * d, z: B.z + lx * u + lz * d });
  const api = {
    uniforms: uni, coords, front,
    update(t) { uni.uShoreT.value = t; },
    runup(x, z, t) { const { u } = coords(x, z), f = front(u, t), p = pointAt(u, f.s); return { front: { x: p.x, z: p.z, y: groundH(p.x, p.z) }, phase: f.surging ? 'surge' : 'retreat', tau: f.tau, s: f.s }; },
    waterY(x, z, t) { const { u, d } = coords(x, z), f = front(u, t); if (d > f.s) return -Infinity; const p = pointAt(u, f.s); return groundH(p.x, p.z); },
    depth(x, z, t) { const y = api.waterY(x, z, t); return y === -Infinity ? 0 : Math.max(0, y - groundH(x, z)); },
    wetness(x, z, t) { const { u, d } = coords(x, z); let w = 0; for (let k = 0; k < 3; k++) { const { e, f } = extent(u, k, t); w = Math.max(w, sstep(e + 0.45, e - 0.5, d) * f); } return w; },
    tideMark(x, z, t) { const { u, d } = coords(x, z); let m = 0; for (let k = 0; k < 3; k++) { const { e, f } = extent(u, k, t); m = Math.max(m, sstep(0.42, 0, Math.abs(d - e + 0.15)) * f * f * (k === 0 ? 0.55 : 1)); } return m; },
    patchMaterial(mat, { wetDark = 0.5, foamColor = [0.96, 0.96, 0.93], filmColor = [0.34, 0.48, 0.46] } = {}) {
      const prev = mat.onBeforeCompile;
      mat.onBeforeCompile = (sh, r) => {
        if (prev) prev(sh, r);
        Object.assign(sh.uniforms, uni, { uWetDark: { value: wetDark }, uFoamC: { value: new THREE.Vector3(...foamColor) }, uFilmC: { value: new THREE.Vector3(...filmColor) } });
        sh.vertexShader = 'varying vec3 vShoreWp;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vShoreWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = `varying vec3 vShoreWp; uniform float uWetDark; uniform vec3 uFoamC, uFilmC;
          ${SHORE_GLSL}
          float shH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float shN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(shH(i), shH(i + vec2(1.0, 0.0)), f.x), mix(shH(i + vec2(0.0, 1.0)), shH(i + vec2(1.0, 1.0)), f.x), f.y); }
          float shF(vec2 p){ return shN(p) * 0.55 + shN(p * 2.3 + 4.1) * 0.3 + shN(p * 5.1 + 9.7) * 0.15; }
          float sU, sD, sWet, sFilm, sFoam;\n` + sh.fragmentShader
          .replace('#include <color_fragment>', `#include <color_fragment>
            { vec2 wp = vShoreWp.xz - uShoreBase.xy; sU = -wp.x * uShoreBase.w + wp.y * uShoreBase.z; sD = wp.x * uShoreBase.z + wp.y * uShoreBase.w;
              float s, tau, smax; shFront(sU, s, tau, smax);
              sWet = max(shWet(sU, sD), step(sD, s)); sFilm = step(sD, s) * smoothstep(0.0, 0.5, s - sD);
              float lace = shF(vShoreWp.xz * 1.6 + vec2(0.0, -uShoreT * 0.05)), lace2 = shF(vShoreWp.xz * 3.7 + 7.1);
              float lead = step(sD, s) * exp(-max(s - sD, 0.0) * 1.7) * smoothstep(0.38, 0.64, lace * 0.55 + lace2 * 0.5 + 0.4 * exp(-(s - sD) * 3.0));
              float mark = shMark(sU, sD) * smoothstep(0.4, 0.7, lace2 + lace * 0.4);
              sFoam = clamp(max(lead, mark * 0.7), 0.0, 1.0);
              diffuseColor.rgb *= mix(1.0, uWetDark, clamp(sWet, 0.0, 1.0));
              diffuseColor.rgb = mix(diffuseColor.rgb, uFilmC * 0.7 + diffuseColor.rgb * 0.35, sFilm * 0.6);
              diffuseColor.rgb = mix(diffuseColor.rgb, uFoamC, sFoam * 0.9); }`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, mix(0.28, 0.06, sFilm), clamp(sWet, 0.0, 1.0) * (1.0 - sFoam));');
      };
      mat.needsUpdate = true; return mat;
    },
  };
  return api;
}
