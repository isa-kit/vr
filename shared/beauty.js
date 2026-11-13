// Shared "make it beautiful" layer: filmic tone mapping + bloom glow.
// On desktop/phone we render through a post-processing composer (bloom).
// Inside a headset we render directly (post-processing doesn't run in WebXR
// and would cost frames) — tone mapping still applies there.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function beautify(renderer, scene, camera, opts = {}) {
  // tone: 'aces' (filmic, punchy — great for glowing night scenes) or
  //       'neutral' (keeps hues/saturation — better for bright stylized daylight)
  const { exposure = 1.0, bloom = 0.4, radius = 0.5, threshold = 0.85, tone = 'aces' } = opts;
  renderer.toneMapping = tone === 'neutral' ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), bloom, radius, threshold);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  addEventListener('resize', () => composer.setSize(innerWidth, innerHeight));

  return {
    bloomPass,
    render() {
      if (renderer.xr.isPresenting) renderer.render(scene, camera);
      else composer.render();
    },
  };
}

// Append to custom ShaderMaterial fragment shaders so they tone-map and
// colour-encode exactly like built-in materials in both render paths.
export const SHADER_TAIL = `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;
