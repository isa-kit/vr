// Shared hand tools for the Oortia worlds: grab-able objects + a magnifier/spyglass lens.
//
//   import { createToolkit, createLens } from '../shared/xrtools.js';
//   const kit = createToolkit({ renderer, scene, dolly, camera, menu });      // menu = createXRMenu(...)
//   kit.add({
//     name: 'Spade', object: groupMadeOfMeshes,   // model: origin = the grip point, working end along −z
//     radius: 0.25,                               // how close / how well-aimed a grip must be to pick it up (m)
//     grip: { pos: new THREE.Vector3(0,0,-0.05), rot: new THREE.Euler(-0.35,0,0) },   // pose in the controller
//     home: 'ground',  groundAt: (x,z) => y,  restY: 0.02,  restRot: new THREE.Euler(0,0.4,0),   // drops, lies there
//     //  — or —  home: 'dolly', homePos: new THREE.Vector3(0.4,-0.3,-0.5)  // floats back to your "belt" (flying worlds)
//     onGrab(i), onRelease(i),                    // i = controller index (0|1)
//     onUseStart(i), onUse(i, dt), onUseEnd(i),   // trigger while holding it
//     onHeld(i, dt),                              // every frame while in hand (orient lenses etc.)
//   });
//   kit.update(dt);          // each frame (after menu.update())
//   kit.heldBy(i)            // the tool controller i is holding, or null
//
// Grip = pick up the nearest tool within reach, or the tool your ray points at (it flies into your hand).
// Release grip = drop it (falls / floats home). Trigger = use it. Rays + wrist menu keep working with the free hand.
//
//   const lens = createLens({ renderer, scene, camera, menu, radius: 0.12, zoom: 3 });
//   scene.add(lens.group)         // or hand lens.group to kit.add({ object: lens.group, ... })
//   lens.setOn(true|false)        // on = shows a live magnified render-to-texture view
//   lens.update(ndc?)             // each frame; on desktop pass the mouse NDC {x,y} to make a loupe follow the mouse
//   lens.zoom = 4

import * as THREE from 'three';

// ---------- magnifier / spyglass lens (render-to-texture) ----------
export function createLens({ renderer, scene, camera, menu, radius = 0.12, zoom = 3, ring = 0xe0ac4a, handle = true }) {
  const lens = { zoom, on: false, radius, menu };
  const rt = new THREE.WebGLRenderTarget(768, 768, { type: THREE.HalfFloatType, samples: 4 });
  const cam = new THREE.PerspectiveCamera(20, 1, 0.02, 800);
  const g = new THREE.Group();
  // drawn last, no depth test, so the glass is never swallowed by the geometry you lean into
  const over = (m, order) => { m.depthTest = false; m.transparent = true; m.fog = false; return order; };
  const view = new THREE.Mesh(new THREE.CircleGeometry(radius, 56), new THREE.MeshBasicMaterial({ map: rt.texture }));
  view.renderOrder = over(view.material, 900); view.visible = false;
  const glass = new THREE.Mesh(new THREE.CircleGeometry(radius, 56), new THREE.MeshBasicMaterial({ color: 0xbfe6f5, opacity: 0.28, toneMapped: false }));
  glass.renderOrder = over(glass.material, 899);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.07, 10, 56), new THREE.MeshBasicMaterial({ color: ring, toneMapped: false }));
  rim.position.z = 0.002; rim.renderOrder = over(rim.material, 901);
  const cross = new THREE.Mesh(new THREE.RingGeometry(0.004, 0.0065, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.7, toneMapped: false }));
  cross.position.z = 0.002; cross.renderOrder = over(cross.material, 902); cross.visible = false;
  g.add(glass, view, rim, cross);
  let handleMesh = null;
  if (handle) {
    handleMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.09, radius * 0.11, radius * 1.4, 10), new THREE.MeshBasicMaterial({ color: 0x7a4f28, toneMapped: false }));
    handleMesh.position.set(0, -radius - radius * 0.6, 0); handleMesh.renderOrder = over(handleMesh.material, 901);
    g.add(handleMesh);
  }
  lens.group = g; lens.handle = handleMesh;
  lens.setOn = (v) => { lens.on = !!v; view.visible = lens.on; glass.visible = !lens.on; cross.visible = lens.on; };
  const _eye = new THREE.Vector3(), _ctr = new THREE.Vector3(), _s = new THREE.Vector3(), _dir = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  // billboard the glass toward the eye (call while held / resting if you want it to face you)
  lens.faceEye = () => { camera.getWorldPosition(_eye); g.lookAt(_eye); };
  lens.update = (ndc) => {
    if (!lens.on || !g.visible) return;
    camera.getWorldPosition(_eye);
    if (!renderer.xr.isPresenting && ndc) {           // desktop loupe: floats in front of the camera at the mouse
      ray.setFromCamera(ndc, camera);
      g.position.copy(_eye).addScaledVector(ray.ray.direction, 0.62);
      g.scale.setScalar(1);
      g.lookAt(_eye);
    }
    g.updateWorldMatrix(true, true);
    g.getWorldPosition(_ctr);
    const R = radius * g.getWorldScale(_s).x, d = _eye.distanceTo(_ctr);
    const half = Math.atan(R / Math.max(d, 0.05));
    cam.position.copy(_eye); cam.lookAt(_ctr);
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) / lens.zoom));
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    const prevRT = renderer.getRenderTarget(), xrEn = renderer.xr.enabled;
    g.visible = false;
    renderer.xr.enabled = false;                       // render with `cam`, not the headset camera
    renderer.setRenderTarget(rt);
    const run = () => { renderer.clear(); renderer.render(scene, cam); };
    if (lens.menu && lens.menu.withoutUI) lens.menu.withoutUI(run); else run();
    renderer.xr.enabled = xrEn;
    renderer.setRenderTarget(prevRT);
    g.visible = true;
  };
  return lens;
}

// ---------- grab-able tools ----------
export function createToolkit({ renderer, scene, dolly, camera, menu }) {
  const tools = [];
  const held = [null, null];
  const _p = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

  function add(t) {
    t.baseScale = t.object.scale.clone();
    t.radius = t.radius || 0.25;
    t.grip = t.grip || { pos: new THREE.Vector3(), rot: new THREE.Euler() };
    t.gripQuat = new THREE.Quaternion().setFromEuler(t.grip.rot);
    t.restQuat = new THREE.Quaternion().setFromEuler(t.restRot || new THREE.Euler());
    t.state = 'rest'; t.vy = 0; t.pull = 1; t.holder = -1;
    if (t.home === 'dolly') t.homeQuat = new THREE.Quaternion().setFromEuler(t.homeRot || new THREE.Euler());
    tools.push(t);
    return t;
  }

  function grab(i) {
    if (held[i]) return;
    const c = menu.controllers[i];
    c.updateWorldMatrix(true, false);
    _p.setFromMatrixPosition(c.matrixWorld);
    _d.set(0, 0, -1).transformDirection(c.matrixWorld);
    const sc = dolly.scale.x;
    let best = null, bs = 1e9;
    for (const t of tools) {                           // 1) within arm's reach
      if (t.state === 'held') continue;
      t.object.getWorldPosition(_w);
      const dist = _p.distanceTo(_w), reach = t.radius + 0.12 * sc;
      if (dist < reach && dist < bs) { best = t; bs = dist; }
    }
    if (!best) {                                       // 2) the one your ray points at
      bs = 1e9;
      for (const t of tools) {
        if (t.state === 'held') continue;
        t.object.getWorldPosition(_w); _w.sub(_p);
        const along = _w.dot(_d);
        if (along < 0 || along > 6) continue;
        const perp = _w.addScaledVector(_d, -along).length();
        if (perp < t.radius * 1.3 && perp < bs) { best = t; bs = perp; }
      }
    }
    if (!best) return;
    best.state = 'held'; best.holder = i; best.pull = 0; held[i] = best;
    c.attach(best.object);
    if (menu.hapticPulse) menu.hapticPulse(c);
    if (best.onGrab) best.onGrab(i);
  }

  function release(i) {
    const t = held[i]; if (!t) return;
    held[i] = null; t.holder = -1;
    if (t.home === 'dolly') { dolly.attach(t.object); t.state = 'return'; }
    else { scene.attach(t.object); t.object.scale.copy(t.baseScale); t.state = 'fall'; t.vy = 0; }
    if (t.onRelease) t.onRelease(i);
  }

  menu.onSqueeze((c, hand, i, down) => (down ? grab(i) : release(i)));
  menu.onSelectStart((c, hand, i) => { const t = held[i]; if (t && t.onUseStart) t.onUseStart(i); if (t) t.using = true; });
  menu.onSelectEnd((c, hand, i) => { const t = held[i]; if (t) { if (t.onUseEnd) t.onUseEnd(i); t.using = false; } });

  function update(dt) {
    for (const t of tools) {
      const o = t.object;
      if (t.state === 'held') {
        t.pull = Math.min(1, t.pull + dt * 6);
        const k = 1 - Math.pow(1 - t.pull, 3);
        o.position.lerp(t.grip.pos, k);
        o.quaternion.slerp(t.gripQuat, k);
        o.scale.lerp(t.baseScale, k);
        if (t.onHeld) t.onHeld(t.holder, dt);
        if (t.using && t.onUse) t.onUse(t.holder, dt);
      } else if (t.state === 'fall') {
        t.vy -= 9.8 * dt;
        o.position.y += t.vy * dt;
        const gy = (t.groundAt ? t.groundAt(o.position.x, o.position.z) : 0) + (t.restY || 0);
        o.quaternion.slerp(t.restQuat, Math.min(1, dt * 6));
        if (o.position.y <= gy) { o.position.y = gy; o.quaternion.copy(t.restQuat); t.state = 'rest'; if (t.onLand) t.onLand(); }
      } else if (t.state === 'return') {
        o.position.lerp(t.homePos, Math.min(1, dt * 6));
        o.quaternion.slerp(t.homeQuat, Math.min(1, dt * 6));
        o.scale.lerp(t.baseScale, Math.min(1, dt * 6));
        if (o.position.distanceTo(t.homePos) < 0.003) { o.position.copy(t.homePos); t.state = 'rest'; }
      }
      if (t.onTick) t.onTick(dt);
    }
  }

  return { tools, add, update, heldBy: (i) => held[i], grab, release };
}
