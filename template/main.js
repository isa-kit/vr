// ============================ Oortia app template — copy this folder, rename, build ============================
// Everything standard (menu + its Wheel / Dashboard / Wrist style, Pause, Recenter, Quit, comfort, posture incl.
// Lying up, slow straight drift with the right-hand compass, controller rays, mouse + touch) comes from
// shared/app.js. This file only says WHAT THE APP IS. Rules: /STANDARD.md. Checklist: STANDARD.md §9.
import { THREE, createOortiaApp, sectionRow, choiceGrid, buttonRow } from '../shared/app.js?v=app2';

const TINTS = [['Gold', '#ffd27a'], ['Sky', '#8fd3ff'], ['Rose', '#ff8fb0'], ['Mint', '#8ff0c0']];

Promise.resolve().then(init).catch((e) => { console.error(e); const s = document.getElementById('status'); if (s) s.textContent = 'Could not start: ' + e.message; });

async function init() {
  let orbs = [], cluster;
  const app = await createOortiaApp({
    id: 'template', title: 'Template',
    capabilities: { locomotion: 'drift', posture: ['seated', 'lying-up'], passthrough: true, tools: false },
    background: 0x0b1238, tone: { tone: 'aces', bloom: 0.25 },
    home: { x: 0, y: 0, z: 0, yaw: 0 },
    hint: 'Click an orb to ring it · drag to look · Esc / M for the menu',
    // YOUR tabs. Motion and Comfort tabs (and Pause / Recenter / Menu style / Quit) are added by the bootstrap.
    tabs: (app) => [{ name: 'Orbs', rows: [
      sectionRow('Colour'),
      ...choiceGrid(TINTS, () => app.store('tint', TINTS[0][1]), (v) => { app.save('tint', v); paint(); }, 4),
      buttonRow('Gather the orbs in front of me', () => app.recenter(), 'accent'),
    ] }],
    // Recenter (menu, entering VR, posture change): re-place content relative to the headset; it then stays put.
    onRecenter: (frame, app) => app.placeAlongGaze(cluster, 2.2, { minElevationDeg: app.posture === 'lying-up' ? 30 : -10 }),
  });

  // ----- the world: everything opaque goes into app.world so passthrough can hide it -----
  app.world.add(new THREE.HemisphereLight(0xbfc8ff, 0x202030, 1.0));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshStandardMaterial({ color: 0x1d2b3a, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; app.world.add(ground);
  const stars = new THREE.BufferGeometry(), sp = [];
  for (let i = 0; i < 900; i++) { const u = Math.random() * 0.95 + 0.05, th = Math.random() * 6.283, s = Math.sqrt(1 - u * u); sp.push(Math.cos(th) * s * 300, u * 300, Math.sin(th) * s * 300); }
  stars.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  app.world.add(new THREE.Points(stars, new THREE.PointsMaterial({ size: 1.2, color: 0xdfe6ff, transparent: true, opacity: 0.8, fog: false })));

  // ----- content: a small cluster of orbs, placed along your gaze by onRecenter -----
  cluster = new THREE.Group(); app.world.add(cluster);
  const geo = new THREE.SphereGeometry(0.14, 24, 16);
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.4, emissiveIntensity: 0.25 }));
    const a = (i / 7) * Math.PI * 2; m.position.set(Math.cos(a) * 0.75, Math.sin(a) * 0.75, 0);
    m.userData = { ring: 0, phase: i }; cluster.add(m); orbs.push(m);
  }
  function paint() { const c = new THREE.Color(app.store('tint', TINTS[0][1])); for (const m of orbs) { m.material.color.copy(c); m.material.emissive.copy(c); } }
  paint();

  // ----- input: one handler for controller trigger, mouse click and touch tap -----
  const hit = new THREE.Raycaster();
  app.onPress((aim) => {
    hit.ray.copy(aim.ray);
    const h = hit.intersectObjects(orbs, false)[0];
    if (h) { h.object.userData.ring = 1; if (aim.controller) app.menu.hapticPulse(aim.controller); }
  });

  // ----- per-frame: dt is 0 while the user has Paused, so anything driven by dt/t freezes for free -----
  app.tick((dt, t) => {
    for (const m of orbs) {
      m.userData.ring = Math.max(0, m.userData.ring - dt * 1.5);
      m.scale.setScalar(1 + 0.5 * m.userData.ring + 0.04 * Math.sin(t * 1.3 + m.userData.phase));
      m.material.emissiveIntensity = 0.25 + 1.2 * m.userData.ring;
    }
  });
  app.start();
}
