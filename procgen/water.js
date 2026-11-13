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
        { vec2 q = vWp.xz; float e = 0.12;
          float r0 = fbm(q * 1.7 + vec2(uTime * 0.35, uTime * 0.2)), rx = fbm((q + vec2(e, 0.0)) * 1.7 + vec2(uTime * 0.35, uTime * 0.2)), rz = fbm((q + vec2(0.0, e)) * 1.7 + vec2(uTime * 0.35, uTime * 0.2));
          vec3 pn = normalize(vec3((r0 - rx) * uRip * 0.9, e, (r0 - rz) * uRip * 0.9)); normal = normalize(normal + (viewMatrix * vec4(pn.x, 0.0, pn.z, 0.0)).xyz * 0.5); }`)
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
