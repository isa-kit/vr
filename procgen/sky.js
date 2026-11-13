// ============================ procgen/sky.js — physically based sky + clouds + matching haze ============================
//
//   import { createSky } from '../procgen/sky.js';
//
//   const sky = createSky({ renderer, scene, sun: { elevation: 30, azimuth: -20 },   // degrees; azimuth 0 = toward −z, + = toward the viewer's left
//                           turbidity: 3, rayleigh: 1.3, mie: 0.004, mieG: 0.82,     // atmosphere
//                           clouds: { cover: 0.42, scale: 1, wind: [0.003, 0.001] }, seed: 4 });
//   sky.sunDir, sky.sunColor (THREE.Color), sky.sunIntensity    // feed these to your DirectionalLight
//   sky.haze                                                    // THREE.Color sampled from the sky at the horizon → use as scene.fog colour,
//                                                               //   so distant trees / terrain fade into exactly the sky behind them
//   sky.env                                                     // PMREM environment texture of the sky → scene.environment (image-based ambient light)
//   sky.update(t, cameraPosition)                               // drift the clouds, keep the dome around the viewer (call every frame)
//   sky.setSun(elevationDeg, azimuthDeg)                        // re-derive sun, haze, env (cheap enough to call occasionally)
//
// The sky is three's `Sky` shader (Preetham model — code, not an asset); the cloud layer is a soft procedural noise dome
// with sun-side lighting and horizon fade. No images are loaded.
// ===========================================================================================================

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { makeNoise } from './noise.js';

function cloudTexture(seed, S = 256) {
  const N = makeNoise(seed * 3 + 1), d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, o = (y * S + x) * 4;
    const a = 0.5 + 0.5 * N.pfbm2(u * 4, v * 4, 4, 4, { oct: 5 }), b = 0.5 + 0.5 * N.pfbm2(u * 8 + 3, v * 8, 8, 8, { oct: 4 }), c = 0.5 + 0.5 * N.pfbm2(u * 16, v * 16 + 5, 16, 16, { oct: 3 });
    d[o] = a * 255; d[o + 1] = b * 255; d[o + 2] = c * 255; d[o + 3] = 255;
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
}

export function createSky({ renderer, scene, sun = { elevation: 30, azimuth: -20 }, turbidity = 3, rayleigh = 1.3, mie = 0.004, mieG = 0.82, exposure = 1, clouds = {}, seed = 1 } = {}) {
  const C = { cover: 0.42, scale: 1, wind: [0.003, 0.001], ...clouds };
  const S = { sunDir: new THREE.Vector3(), sunColor: new THREE.Color(), sunIntensity: 3, haze: new THREE.Color(0.7, 0.78, 0.85), env: null };
  const mkSky = (killSun) => {
    const s = new Sky(); s.scale.setScalar(450000); const u = s.material.uniforms;
    u.turbidity.value = turbidity; u.rayleigh.value = rayleigh; u.mieCoefficient.value = mie; u.mieDirectionalG.value = mieG;
    s.material.fragmentShader = s.material.fragmentShader.replace(/L0 \+= \( vSunE \* 19000\.0 \* Fex \) \* sundisk;/, killSun ? '' : 'L0 += ( vSunE * 2600.0 * Fex ) * sundisk;');
    return s;
  };
  const skyMesh = mkSky(false); scene.add(skyMesh);
  const envScene = new THREE.Scene(), envSky = mkSky(true); envScene.add(envSky);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(40000, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.2, 0.12) })); ground.position.y = -2; envScene.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);

  // cloud dome
  const noiseTex = cloudTexture(seed), cu = {
    uNoise: { value: noiseTex }, uTime: { value: 0 }, uSun: { value: S.sunDir }, uLit: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.6, 0.66, 0.76) }, uHaze: { value: S.haze },
    uCover: { value: C.cover }, uScale: { value: C.scale }, uWind: { value: new THREE.Vector2(...C.wind) },
  };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1900, 32, 20), new THREE.ShaderMaterial({
    uniforms: cu, side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP; uniform sampler2D uNoise; uniform float uTime, uCover, uScale; uniform vec3 uSun, uLit, uShade, uHaze; uniform vec2 uWind;
      float dens(vec2 uv){ return texture2D(uNoise, uv * 0.2).r * 0.55 + texture2D(uNoise, uv * 0.55 + 3.7).g * 0.3 + texture2D(uNoise, uv * 1.7 - 1.3).b * 0.15; }
      void main(){
        vec3 d = normalize(vP); if (d.y < 0.01) discard;
        vec2 uv = d.xz / (d.y * 0.9 + 0.12) * 0.55 * uScale + uWind * uTime;
        float n = dens(uv), cov = smoothstep(1.0 - uCover, 1.0 - uCover + 0.22, n);
        float nS = dens(uv + normalize(uSun.xz + 1e-4) * 0.05), lit = clamp(0.55 + (n - nS) * 5.0, 0.0, 1.0);
        vec3 col = mix(uShade, uLit, lit); float rim = pow(max(dot(d, normalize(uSun)), 0.0), 8.0); col += uLit * rim * 0.5 * (1.0 - n * 0.5);
        float hz = 1.0 - smoothstep(0.0, 0.3, d.y); col = mix(col, uHaze, hz * 0.75);
        float a = cov * 0.92 * smoothstep(0.01, 0.14, d.y);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  dome.renderOrder = -5; scene.add(dome);

  const rt = new THREE.WebGLRenderTarget(4, 4), cam = new THREE.PerspectiveCamera(50, 1, 0.1, 1e6), px = new Uint8Array(4 * 4 * 4);
  function sampleHaze() {
    const acc = new THREE.Vector3(); const saveRT = renderer.getRenderTarget(), saveTM = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
    for (let k = 0; k < 8; k++) {
      const az = (k / 8) * Math.PI * 2, e = 0.04; cam.position.set(0, 0, 0); cam.lookAt(Math.sin(az) * Math.cos(e), Math.sin(e), -Math.cos(az) * Math.cos(e));
      renderer.setRenderTarget(rt); renderer.render(envScene, cam); renderer.readRenderTargetPixels(rt, 0, 0, 4, 4, px);
      let r = 0, g = 0, b = 0; for (let i = 0; i < 16; i++) { r += px[i * 4]; g += px[i * 4 + 1]; b += px[i * 4 + 2]; } acc.x += r / 16 / 255; acc.y += g / 16 / 255; acc.z += b / 16 / 255;
    }
    renderer.setRenderTarget(saveRT); renderer.toneMapping = saveTM; acc.multiplyScalar(1 / 8); S.haze.setRGB(acc.x, acc.y, acc.z);
  }
  S.setSun = (elevation, azimuth) => {
    const el = elevation * Math.PI / 180, az = azimuth * Math.PI / 180;
    S.sunDir.set(-Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    for (const m of [skyMesh, envSky]) m.material.uniforms.sunPosition.value.copy(S.sunDir);
    const h = Math.sin(el), warm = 1 - Math.min(1, Math.max(0, (h - 0.04) / 0.38));
    S.sunColor.setRGB(1.0, 0.93 - 0.28 * warm, 0.84 - 0.5 * warm); S.sunIntensity = 1.2 + 2.6 * Math.min(1, h * 1.6);
    cu.uLit.value.copy(S.sunColor).lerp(new THREE.Color(1, 1, 1), 0.35); cu.uSun.value = S.sunDir;
    sampleHaze(); cu.uShade.value.copy(S.haze).multiplyScalar(0.62).lerp(new THREE.Color(0.5, 0.58, 0.72), 0.3);
    if (S.env) S.env.dispose(); S.env = pmrem.fromScene(envScene, 0.02, 0.1, 1e6).texture;
  };
  S.update = (t, camPos) => { cu.uTime.value = t; dome.position.copy(camPos); skyMesh.position.copy(camPos); };
  S.mesh = skyMesh; S.dome = dome; S.setSun(sun.elevation, sun.azimuth);
  return S;
}
