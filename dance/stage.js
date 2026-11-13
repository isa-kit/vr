// ============================ dance/stage.js — the venue: glossy stage, LED wall, truss, beams, lights, sparkles, ghost targets ============================
//   const stage = createStage({ THREE, scene, tier })     // tier: 'high' | 'medium' | 'light'
//   stage.mirror        Group (scale.y = -1) — add reflected copies of things here (the dancer's second figure)
//   stage.update(dt, t, beat, energy, calm)               // gentle colour/intensity pulses, never a strobe
//   stage.setTier(tier)
// All colour changes are smoothed; light intensity swings are capped at ±18 %.
// ====================================================================================================================
import { SHADER_TAIL } from '../shared/beauty.js?v=20261114f';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function createStage({ THREE, scene, renderer, tier = 'high' }) {
  const C = new THREE.Color();
  const S = { tier, hue: 0.6, pulse: 0, root: new THREE.Group(), mirror: new THREE.Group(), lights: {}, beams: [], lamps: [] };
  scene.add(S.root);
  S.root.add(S.mirror); S.mirror.scale.y = -1;

  scene.background = new THREE.Color(0x070918);
  scene.fog = new THREE.Fog(0x0a0d22, 22, 110);

  // ---------- environment (soft studio reflections on the floor and shoes) ----------
  try {
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.28;
  } catch (e) { /* env is a nicety */ }

  // ---------- sky dome: dusk gradient + stars ----------
  {
    const g = new THREE.SphereGeometry(160, 32, 20), pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    const top = new THREE.Color(0x0b0f2e), mid = new THREE.Color(0x2a1b5c), hor = new THREE.Color(0x6a2f7a), tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 160;
      if (y > 0.25) tmp.copy(mid).lerp(top, Math.min(1, (y - 0.25) / 0.6)); else tmp.copy(hor).lerp(mid, Math.max(0, (y + 0.05) / 0.3));
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const dome = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    dome.renderOrder = -10; S.root.add(dome); S.dome = dome;
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const sp = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) { const a = rnd() * Math.PI * 2, e = 0.12 + rnd() * 1.3, r = 150; sp[i * 3] = Math.cos(a) * Math.cos(e) * r; sp[i * 3 + 1] = Math.sin(e) * r; sp[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8, depthWrite: false }));
    stars.renderOrder = -9; S.root.add(stars);
  }
  // ground beyond the stage
  { const m = new THREE.Mesh(new THREE.CircleGeometry(140, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x080a16 })); m.position.y = -0.03; S.root.add(m); }

  // ---------- floor ----------
  function gridTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 1024; const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, 1024, 1024);
    const n = 20, s = 1024 / n;
    for (let i = 0; i <= n; i++) { const p = i * s; x.strokeStyle = 'rgba(110,170,255,0.55)'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(p, 0); x.lineTo(p, 1024); x.moveTo(0, p); x.lineTo(1024, p); x.stroke(); }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if ((i + j) % 2 === 0) { x.fillStyle = 'rgba(70,90,200,0.08)'; x.fillRect(i * s + 3, j * s + 3, s - 6, s - 6); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  }
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x0b0e1c, metalness: 0.55, roughness: 0.2, emissive: 0xffffff, emissiveMap: gridTexture(), emissiveIntensity: 0.32, transparent: true, opacity: 0.82 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(5.4, 64).rotateX(-Math.PI / 2), floorMat); floor.receiveShadow = true; floor.renderOrder = 2; S.root.add(floor); S.floor = floor;
  { const e = new THREE.Mesh(new THREE.TorusGeometry(5.4, 0.045, 8, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x66d8ff })); e.position.y = 0.02; S.root.add(e); S.edge = e; }
  // your spot: soft disc + safe ring + beat pulse ring
  {
    const spot = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.56, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
    spot.position.y = 0.006; spot.renderOrder = 3; S.root.add(spot);
    const safe = new THREE.Mesh(new THREE.RingGeometry(0.98, 1.0, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9fb4ff, transparent: true, opacity: 0.18, depthWrite: false }));
    safe.position.y = 0.005; safe.renderOrder = 3; S.root.add(safe);
    const pulse = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false }));
    pulse.position.y = 0.007; pulse.renderOrder = 3; S.root.add(pulse); S.pulseRing = pulse;
    const dg = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.0 })); S.dancerSpotGlow = dg;
  }
  // soft blob shadow under the dancer (works at every tier)
  {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(0,0,0,0.65)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    blob.position.set(0, 0.008, -2.5); blob.renderOrder = 3; S.root.add(blob); S.blob = blob;
  }

  // ---------- LED wall (curved, gentle animated colour field; a calm shader, not a strobe) ----------
  const wallMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPulse: { value: 0 }, uA: { value: new THREE.Color(0x2a6cff) }, uB: { value: new THREE.Color(0xd24cff) } },
    side: THREE.BackSide, fog: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float uTime, uPulse; uniform vec3 uA, uB;
      void main(){
        vec2 p = vUv * vec2(14.0, 6.0);
        float w = sin(p.x * 1.1 + uTime * 0.35) * 0.5 + sin(p.y * 1.7 - uTime * 0.22 + p.x * 0.4) * 0.5;
        float rings = sin(length(vUv - vec2(0.5, 0.35)) * 26.0 - uTime * 0.9) * 0.5 + 0.5;
        float m = smoothstep(-0.9, 0.9, w) * 0.65 + rings * 0.18;
        vec3 c = mix(uA, uB, m) * (0.16 + 0.22 * uPulse + 0.14 * rings);
        vec2 g = fract(vUv * vec2(260.0, 110.0)) - 0.5;                    // LED dot matrix
        c *= 0.7 + 0.3 * smoothstep(0.55, 0.15, length(g));
        c *= smoothstep(0.0, 0.12, vUv.y) * (0.5 + 0.5 * smoothstep(1.0, 0.7, vUv.y));
        gl_FragColor = vec4(min(c, vec3(0.55)), 1.0);
        ${SHADER_TAIL}
      }`,
  });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(8.2, 8.2, 6.4, 64, 1, true, Math.PI - 0.95, 1.9), wallMat); // arc centred on -z
  wall.position.set(0, 3.45, -1.0); S.root.add(wall); S.wall = wall;
  // frame around the wall top & bottom edge strips
  for (const y of [0.25, 6.65]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(8.18, 8.18, 0.06, 48, 1, true, Math.PI - 0.95, 1.9), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, side: THREE.DoubleSide, fog: false })); r.position.set(0, y, -1.0); S.root.add(r); }

  // ---------- truss arch + lamps + speakers ----------
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1e2c, roughness: 0.5, metalness: 0.7 });
  { const arch = new THREE.Mesh(new THREE.TorusGeometry(5.0, 0.07, 8, 64, Math.PI), darkMat); arch.position.set(0, 0, -5.8); S.root.add(arch);
    const arch2 = new THREE.Mesh(new THREE.TorusGeometry(4.65, 0.04, 6, 64, Math.PI), darkMat); arch2.position.set(0, 0, -5.7); S.root.add(arch2);
    for (let i = 0; i <= 12; i++) { const a = Math.PI * i / 12; const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })); lamp.position.set(Math.cos(a) * 5.0, Math.sin(a) * 5.0, -5.75); S.root.add(lamp); S.lamps.push(lamp); }
    for (const s of [-1, 1]) {
      const stack = new THREE.Group(); stack.position.set(s * 4.5, 0, -4.4); stack.rotation.y = -s * 0.5; S.root.add(stack);
      for (let k = 0; k < 3; k++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.6), darkMat); b.position.y = 0.35 + k * 0.72; stack.add(b);
        const cone = new THREE.Mesh(new THREE.CircleGeometry(0.24, 20), new THREE.MeshBasicMaterial({ color: 0x1f2a4a })); cone.position.set(0, 0.35 + k * 0.72, 0.305); stack.add(cone);
        const rim = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.27, 20), new THREE.MeshBasicMaterial({ color: 0x4aa8ff })); rim.position.set(0, 0.35 + k * 0.72, 0.306); stack.add(rim);
      }
    }
  }
  // ---------- beams (soft additive cones; slow sweep, no flashing) ----------
  {
    const bm = (col) => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.022, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const specs = [[-3.6, 6.6, -4.8, -0.4, 0, -2.5, 0x3fd8ff], [3.6, 6.6, -4.8, 0.4, 0, -2.5, 0xff6fb0], [-1.6, 6.8, -5.4, -0.6, 0, -2.5, 0x8f6bff], [1.6, 6.8, -5.4, 0.6, 0, -2.5, 0xffd24a]];
    for (const [x, y, z, tx, ty, tz, col] of specs) {
      const len = Math.hypot(tx - x, ty - y, tz - z), g = new THREE.CylinderGeometry(0.05, 0.55, len, 24, 1, true); g.translate(0, -len / 2, 0);
      const m = new THREE.Mesh(g, bm(col)); m.position.set(x, y, z); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(tx - x, ty - y, tz - z).normalize());
      m.renderOrder = 5; S.root.add(m); S.beams.push(m);
    }
  }
  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(0x8b9cff, 0x1a1030, 0.55); scene.add(hemi);
  const key = new THREE.SpotLight(0xfff0e0, 2.4, 20, 0.62, 0.55, 1.2); key.position.set(1.5, 6.2, 1.4); key.target.position.set(0, 1.0, -2.5); scene.add(key, key.target);
  key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.camera.near = 2; key.shadow.camera.far = 14;
  const lA = new THREE.SpotLight(0x3fd8ff, 3.0, 18, 0.7, 0.8, 1.3); lA.position.set(-4.5, 4.5, -5.5); lA.target.position.set(0, 1.1, -2.5); scene.add(lA, lA.target);
  const lB = new THREE.SpotLight(0xff6fb0, 3.0, 18, 0.7, 0.8, 1.3); lB.position.set(4.5, 4.5, -5.5); lB.target.position.set(0, 1.1, -2.5); scene.add(lB, lB.target);
  const fillP = new THREE.PointLight(0x9fb4ff, 0.6, 7, 1.6); fillP.position.set(0, 1.6, 0.3); scene.add(fillP);
  Object.assign(S.lights, { hemi, key, lA, lB, fillP });

  S.setTier = (t) => {
    S.tier = t;
    key.castShadow = t === 'high'; renderer.shadowMap.enabled = t === 'high'; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    S.mirror.visible = true;
    S.beams.forEach((b, i) => { b.visible = t !== 'light' || i < 2; });
    if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  };
  S.setTier(tier);

  // ---------- update ----------
  const base1 = new THREE.Color(), base2 = new THREE.Color();
  S.update = function update(dt, t, beat, energy, calm) {
    const ph = beat - Math.floor(beat), kick = Math.exp(-ph * 5) * (beat > 0 ? 1 : 0.3) * (calm ? 0.25 : 1);
    S.pulse += (kick - S.pulse) * Math.min(1, dt * 12);
    S.hue = (S.hue + dt * 0.008) % 1;
    base1.setHSL(S.hue, 0.8, 0.55); base2.setHSL((S.hue + 0.45) % 1, 0.85, 0.58);
    wallMat.uniforms.uTime.value = t; wallMat.uniforms.uPulse.value = S.pulse * energy; wallMat.uniforms.uA.value.copy(base1); wallMat.uniforms.uB.value.copy(base2);
    const k = 1 + 0.18 * S.pulse * energy;
    lA.color.copy(base1); lB.color.copy(base2); lA.intensity = 3.0 * k; lB.intensity = 3.0 * k;
    key.intensity = 2.4 * (1 + 0.06 * S.pulse * energy);
    S.beams.forEach((b, i) => { b.material.color.copy(i % 2 ? base2 : base1); b.material.opacity = 0.02 + 0.012 * S.pulse * energy; b.rotation.z += Math.sin(t * 0.3 + i) * 0.00025; });
    S.lamps.forEach((l, i) => { C.copy(i % 2 ? base2 : base1).lerp(S.white || (S.white = new THREE.Color(1, 1, 1)), 0.45); l.material.color.copy(C).multiplyScalar(0.7 + 0.3 * Math.sin(t * 0.8 + i * 0.7)); });
    S.edge.material.color.copy(base1);
    // beat pulse ring around the player's spot — a soft expanding ring on every beat
    const e = Math.exp(-ph * 4.5), r = 0.55 + (1 - e) * 0.45;
    S.pulseRing.scale.setScalar(r); S.pulseRing.material.opacity = 0.32 * e * (beat > -4 ? 1 : 0);
  };
  S.blobTo = (x, z, s = 1) => { S.blob.position.x = x; S.blob.position.z = z; S.blob.scale.setScalar(s); };
  return S;
}

// ---------- sparkles: additive point burst pool ----------
export function createSparkles(THREE, max = 220) {
  const base = new Float32Array(max * 3), pos = new Float32Array(max * 3), col = new Float32Array(max * 3), vel = new Float32Array(max * 3), life = new Float32Array(max), size = new Float32Array(max);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  const mat = new THREE.PointsMaterial({ size: 0.05, map: new THREE.CanvasTexture(c), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 20;
  let head = 0;
  for (let i = 0; i < max; i++) { pos[i * 3 + 1] = -100; life[i] = 0; }
  return {
    points: pts,
    burst(p, color, n = 24, speed = 1.1) {
      const cc = new THREE.Color(color);
      for (let k = 0; k < n; k++) {
        const i = head; head = (head + 1) % max;
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
        const a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1), s = speed * (0.4 + Math.random() * 0.8);
        vel[i * 3] = Math.sin(b) * Math.cos(a) * s; vel[i * 3 + 1] = Math.cos(b) * s + 0.4; vel[i * 3 + 2] = Math.sin(b) * Math.sin(a) * s;
        base[i * 3] = cc.r; base[i * 3 + 1] = cc.g; base[i * 3 + 2] = cc.b; life[i] = 0.6 + Math.random() * 0.5;
      }
    },
    update(dt) {
      for (let i = 0; i < max; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt; if (life[i] <= 0) { pos[i * 3 + 1] = -100; continue; }
        vel[i * 3 + 1] -= 1.6 * dt;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        const f = Math.min(1, life[i] * 2.2); for (let q = 0; q < 3; q++) col[i * 3 + q] = base[i * 3 + q] * f;
      }
      g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
    },
  };
}
