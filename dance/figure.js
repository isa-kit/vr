// ============================ dance/figure.js — the dancer (generated geometry, analytic two-bone IK) ============================
//   const fig = createFigure(THREE, { tintL, tintR, basic:false });  scene.add(fig.root);   // root at the dancer's feet, facing +z
//   fig.update(pose, beat, mirror)   // pose = samplePose() output (player-frame hand targets), beat = routine beat (for bounce/sway)
// Flat hierarchy: every limb mesh is positioned from solved joint points, so there is no skinning and no hidden hierarchy maths.
// Dimensions (metres): height ≈ 1.76, arm 0.30 + 0.34, leg 0.44 + 0.43, shoulders ±0.19, hips ±0.095.
// ====================================================================================================================

export function createFigure(THREE, { tintL = 0x3fd8ff, tintR = 0xff6fb0, basic = false, jacket = 0x5a3fd6, pants = 0x232a4d } = {}) {
  const V3 = THREE.Vector3, Q = THREE.Quaternion;
  const root = new THREE.Group();
  const D = { ankleY: 0.075, thigh: 0.44, shin: 0.43, pelvisY: 0.93, hipHalf: 0.095, spine: 0.46, shoulderHalf: 0.19, upper: 0.3, fore: 0.34, H: 1.76 };
  D.armLen = D.upper + D.fore;

  const mk = (color, o = {}) => basic
    ? new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(o.glow ? 1.4 : 0.55), toneMapped: false })
    : new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.55, metalness: o.metal ?? 0.05, emissive: o.glow ? color : 0x000000, emissiveIntensity: o.glow ?? 0 });
  const M = {
    skin: mk(0xd9a07a, { rough: 0.7 }), jacket: mk(jacket, { rough: 0.5 }), jacketDark: mk(0x3a2a9a, { rough: 0.55 }), shirt: mk(0xf2eefc, { rough: 0.6 }),
    pants: mk(pants, { rough: 0.6 }), shoe: mk(0xf6f6fb, { rough: 0.4 }), hair: mk(0x20152e, { rough: 0.45 }), hairHi: mk(0xff5aa5, { rough: 0.5, glow: 0.6 }),
    dark: mk(0x1a1424, { rough: 0.8 }), white: mk(0xffffff, { rough: 0.3 }), mouth: mk(0xb8404f, { rough: 0.6 }),
    glowL: mk(tintL, { glow: 2.2, rough: 0.3 }), glowR: mk(tintR, { glow: 2.2, rough: 0.3 }), sole: mk(0x66e0ff, { glow: 1.6 }), stripe: mk(0xffd24a, { glow: 1.2 }),
  };
  const add = (parent, geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const sph = (r, w = 20, h = 14) => new THREE.SphereGeometry(r, w, h);

  // ---------- torso (a real group: pelvis pivot, tilted by lean / twist; head hangs off it) ----------
  const torso = new THREE.Group(); root.add(torso);
  { const p = add(torso, sph(1, 22, 14), M.pants, 0, -0.02, 0); p.scale.set(0.175, 0.115, 0.12);
    const w = add(torso, new THREE.CylinderGeometry(0.125, 0.15, 0.24, 18), M.jacketDark, 0, 0.14, 0); w.scale.z = 0.78;
    const belt = add(torso, new THREE.TorusGeometry(0.14, 0.014, 8, 28), M.stripe, 0, 0.05, 0); belt.rotation.x = Math.PI / 2; belt.scale.set(1, 0.8, 1);
    const c = add(torso, sph(1, 24, 16), M.jacket, 0, 0.34, 0); c.scale.set(0.225, 0.2, 0.13);
    const zip = add(torso, new THREE.BoxGeometry(0.012, 0.36, 0.01), M.stripe, 0, 0.27, 0.127);
    add(torso, new THREE.CylinderGeometry(0.052, 0.062, 0.1, 12), M.skin, 0, 0.53, 0);
    for (const s of [-1, 1]) add(torso, sph(0.07), M.jacket, s * D.shoulderHalf, D.spine, 0);
    add(torso, new THREE.TorusGeometry(0.075, 0.012, 8, 20), M.shirt, 0, 0.5, 0.012).rotation.x = Math.PI / 2 * 0.9;
  }
  const head = new THREE.Group(); head.position.set(0, 0.69, 0); torso.add(head);
  { const sk = add(head, sph(0.118, 28, 20), M.skin); sk.scale.set(0.95, 1.05, 1);
    const hair = add(head, new THREE.SphereGeometry(0.128, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.56), M.hair, 0, 0.012, -0.012); hair.rotation.x = -0.28;
    add(head, sph(0.05), M.hair, 0, 0.13, -0.09);                                       // bun
    const streak = add(head, new THREE.TorusGeometry(0.128, 0.011, 8, 28, Math.PI * 0.55), M.hairHi, 0, 0.012, 0.0); streak.rotation.set(0.1, Math.PI / 2, 0.45); streak.position.x = 0.03;
    for (const s of [-1, 1]) {
      add(head, sph(0.017, 10, 8), M.dark, s * 0.042, 0.018, 0.108).scale.set(1, 1.3, 0.6);
      add(head, sph(0.005, 6, 6), M.white, s * 0.042 + s * 0.004, 0.026, 0.116);
      add(head, sph(0.03, 10, 8), M.skin, s * 0.118, 0.0, 0).scale.set(0.5, 1, 0.8);   // ears
      const brow = add(head, new THREE.BoxGeometry(0.036, 0.007, 0.006), M.hair, s * 0.044, 0.055, 0.108); brow.rotation.z = -s * 0.15;
    }
    add(head, sph(0.12 * 0.12, 8, 6), M.skin, 0, -0.012, 0.118);                       // nose
    const mouth = add(head, new THREE.TorusGeometry(0.03, 0.005, 6, 14, Math.PI), M.mouth, 0, -0.036, 0.108); mouth.rotation.z = Math.PI; mouth.scale.set(1, 0.7, 1);
    for (const s of [-1, 1]) add(head, sph(0.016, 8, 6), mk(0xe58a8a, {}), s * 0.07, -0.025, 0.1).scale.set(1, 0.6, 0.4);   // cheeks
  }

  // ---------- limbs ----------
  function limb(r0, r1, mat) {              // tapered cylinder, spans y 0..1 (scale.y = length), r0 at the start
    const g = new THREE.CylinderGeometry(r1, r0, 1, 14, 1); g.translate(0, 0.5, 0);
    const m = new THREE.Mesh(g, mat); root.add(m); return m;
  }
  const joint = (r, mat) => { const m = new THREE.Mesh(sph(r, 14, 10), mat); root.add(m); return m; };
  const mkArm = (glow) => ({ upper: limb(0.05, 0.044, M.jacket), fore: limb(0.042, 0.034, M.skin), cuff: limb(0.046, 0.046, glow), elbow: joint(0.046, M.jacket), hand: joint(0.058, glow), palm: joint(0.04, M.skin), shoulderBall: null });
  const mkLeg = () => ({ thigh: limb(0.082, 0.062, M.pants), shin: limb(0.06, 0.044, M.pants), knee: joint(0.062, M.pants), shoe: new THREE.Group() });
  const arms = { L: mkArm(M.glowL), R: mkArm(M.glowR) };
  const legs = [mkLeg(), mkLeg()];
  for (const l of legs) {
    root.add(l.shoe);
    const s = add(l.shoe, new THREE.CapsuleGeometry(0.048, 0.13, 6, 12), M.shoe, 0, -0.026, 0.045); s.rotation.x = Math.PI / 2; s.scale.set(1, 1, 0.82);
    add(l.shoe, new THREE.BoxGeometry(0.1, 0.012, 0.25), M.sole, 0, -0.07, 0.05);
    add(l.shoe, sph(0.04, 10, 8), M.shirt, 0, 0.0, -0.01);
    add(l.shoe, new THREE.CylinderGeometry(0.044, 0.05, 0.06, 12), M.pants, 0, 0.03, -0.01);
  }
  // ---------- contact shadow-ish glow under the figure is handled by the stage; nothing here ----------

  const _q = new Q(), _up = new V3(0, 1, 0), _d = new V3(), _a = new V3(), _b = new V3(), _c = new V3(), _s = new V3(), _t = new V3(), _pole = new V3(), _e = new V3(), _h = new V3(), _qi = new Q();
  const E = new THREE.Euler(0, 0, 0, 'YXZ');
  function place(mesh, p0, p1) {             // mesh spans y 0..1 along its local +y
    _d.subVectors(p1, p0); const len = _d.length() || 1e-4; _d.divideScalar(len);
    mesh.position.copy(p0); mesh.quaternion.setFromUnitVectors(_up, _d); mesh.scale.set(1, len, 1);
  }
  // analytic two-bone IK: returns elbow/knee point
  function ik(S, T, a, b, poleDir, outElbow, outEnd) {
    _t.subVectors(T, S); let d = _t.length(); const max = a + b - 0.003;
    if (d > max) { _t.multiplyScalar(max / d); d = max; }
    if (d < 0.06) { _t.set(0, -1, 0).multiplyScalar(0.06); d = 0.06; }
    const u = _a.copy(_t).divideScalar(d);
    const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(a * a - x * x, 0));
    _b.copy(poleDir).addScaledVector(u, -poleDir.dot(u));                       // pole component perpendicular to the chain
    if (_b.lengthSq() < 1e-6) _b.set(0, 0, 1).addScaledVector(u, -u.z);
    _b.normalize();
    outElbow.copy(S).addScaledVector(u, x).addScaledVector(_b, h);
    outEnd.copy(S).add(_t);
  }

  const P = { pel: new V3(), sh: [new V3(), new V3()], hand: [new V3(), new V3()], el: [new V3(), new V3()], hip: [new V3(), new V3()], knee: [new V3(), new V3()], ank: [new V3(), new V3()] };
  const state = { torsoQ: new Q(), pelvis: new V3(), mirror: true };
  const F = { L: 0, R: 1 };

  function update(pose, beat = 0, mirror = true) {
    const sgn = mirror ? 1 : -1;                           // world x of "player left" = -sgn
    const wx = (side) => (side < 0 ? -sgn : sgn);          // side -1 = player's left, +1 = right → world-x direction (+1 = +x)
    // bounce on the beat (dips on the beat, rises between) + weight shift
    const ph = beat - Math.floor(beat), bob = 0.032 * (0.5 + 0.5 * Math.cos(2 * Math.PI * ph));
    const sway = Math.sin(Math.PI * beat), swayOn = 1;
    // feet (world x/z in root space; z+ = toward the player)
    const f = pose.feet, foot = [];
    for (const side of [-1, 1]) {
      const i = side < 0 ? 0 : 3, out = f[i], fz = f[i + 1], lift = f[i + 2];
      foot.push({ x: wx(side) * out, z: fz, lift });
    }
    // idle weight shift: lift the unloaded foot a hair
    const idle = Math.abs(foot[0].lift) + Math.abs(foot[1].lift) < 0.002;
    if (idle) { const k = sway * 0.012; foot[0].lift += Math.max(0, -k); foot[1].lift += Math.max(0, k); }
    const footCx = (foot[0].x + foot[1].x) / 2;
    const dropM = pose.drop * D.H * 1.0;
    P.pel.set(footCx * 0.7 + sway * 0.028 * swayOn + wx(1) * pose.lx * 0.25, D.pelvisY - dropM - bob, (foot[0].z + foot[1].z) / 4);
    // torso tilt: roll toward lean side, pitch with squat, yaw with twist + sway
    const roll = -wx(1) * pose.lx * 2.6 + (-sway) * 0.025 * sgn, pitch = pose.lz * 2.5 + (pose.drop / 0.18) * 0.28 + 0.03 * (1 - bob / 0.032);
    const yaw = -pose.tw * sgn * 1.0 + sway * 0.06;
    E.set(pitch, yaw, roll); state.torsoQ.setFromEuler(E);
    torso.position.copy(P.pel); torso.quaternion.copy(state.torsoQ);
    head.quaternion.setFromEuler(E.set(-pitch * 0.55 + 0.04 * Math.sin(2 * Math.PI * beat), -yaw * 0.4, -roll * 0.6, 'YXZ'));
    // shoulders
    for (const side of [-1, 1]) {
      const i = side < 0 ? 0 : 1, w = wx(side);
      P.sh[i].set(w * D.shoulderHalf, D.spine, 0).applyQuaternion(state.torsoQ).add(P.pel);
    }
    // arms
    const ghand = [pose.L, pose.R];
    for (const side of [-1, 1]) {
      const i = side < 0 ? 0 : 1, w = wx(side), p = ghand[i], arm = side < 0 ? arms.L : arms.R;
      _h.set(w * p[0] * D.armLen, p[1] * D.armLen, p[2] * D.armLen).add(P.sh[i]);
      // keep hands out of the torso: in torso space, if the hand is inside the body column, push it sideways
      _c.copy(_h).sub(P.pel); _qi.copy(state.torsoQ).invert(); _c.applyQuaternion(_qi);
      if (Math.abs(_c.z) < 0.17 && _c.y > -0.12 && _c.y < 0.6 && Math.abs(_c.x) < 0.27 && _c.x * w >= -0.27) {
        const push = 0.27, sgnx = w; const target = sgnx * push;
        _c.x = Math.abs(_c.x) < push && (_c.x * w > 0 || Math.abs(_c.z) < 0.1) ? target : _c.x;
        _c.applyQuaternion(state.torsoQ).add(P.pel); _h.copy(_c);
      }
      const low = Math.max(0, Math.min(1, (-p[1] - 0.2) / 0.7));
      _pole.set(w * (0.45 + 0.7 * low), -0.8 - 0.3 * Math.max(0, p[1]), -0.5 + 0.7 * Math.max(0, p[2] - 0.4) * 0).normalize();
      if (p[1] > 0.5 && p[2] < 0.4) _pole.set(w * 0.5, -0.9, -0.15).normalize();
      ik(P.sh[i], _h, D.upper, D.fore, _pole, P.el[i], P.hand[i]);
      place(arm.upper, P.sh[i], P.el[i]); place(arm.fore, P.el[i], P.hand[i]);
      arm.elbow.position.copy(P.el[i]); arm.hand.position.copy(P.hand[i]);
      // palm just beyond the glowing hand ball along the forearm; cuff ring near wrist
      _e.subVectors(P.hand[i], P.el[i]).normalize();
      arm.palm.position.copy(P.hand[i]).addScaledVector(_e, 0.045);
      _b.copy(P.hand[i]).addScaledVector(_e, -0.07); place(arm.cuff, _b, _c.copy(_b).addScaledVector(_e, 0.032));
    }
    // legs
    for (const side of [-1, 1]) {
      const i = side < 0 ? 0 : 1, fo = foot[i], lg = legs[i], w = wx(side);
      P.hip[i].set(w * D.hipHalf, -0.03, 0).applyQuaternion(_q.setFromEuler(E.set(pitch * 0.3, yaw * 0.5, roll * 0.5))).add(P.pel);
      P.ank[i].set(fo.x, D.ankleY + fo.lift, fo.z);
      _pole.set(w * 0.28, 0.15, 1).normalize();
      ik(P.hip[i], P.ank[i], D.thigh, D.shin, _pole, P.knee[i], _c);
      place(lg.thigh, P.hip[i], P.knee[i]); place(lg.shin, P.knee[i], _c);
      lg.knee.position.copy(P.knee[i]);
      lg.shoe.position.copy(_c);
      const toe = Math.min(0.9, fo.lift * 7) * (fo.lift > 0.1 ? 0.5 : 1);
      lg.shoe.rotation.set(toe, w * 0.16, 0);
    }
  }

  // ---------- world-space update (couple dancing): figure root stays at the origin, everything is given in world coordinates ----------
  // o = { px, pz, py (pelvis height), yaw (body forward = (sin yaw, cos yaw)), pitch, roll, feet:[R,L] each {x,z,lift,yaw}, hands:[R,L] world [x,y,z] (or null → relaxed) }
  // Local slot 0 (−x when yaw = 0) is the figure's anatomical RIGHT, slot 1 the LEFT.
  const _Y = new V3(0, 1, 0), _lat = new V3(), _fw = new V3();
  function updateWorld(o) {
    E.set(o.pitch || 0, o.yaw, o.roll || 0); state.torsoQ.setFromEuler(E);
    P.pel.set(o.px, o.py, o.pz); torso.position.copy(P.pel); torso.quaternion.copy(state.torsoQ);
    head.quaternion.setFromEuler(E.set(-(o.pitch || 0) * 0.5, 0, -(o.roll || 0) * 0.6, 'YXZ'));
    _lat.set(Math.cos(o.yaw), 0, -Math.sin(o.yaw)); _fw.set(Math.sin(o.yaw), 0, Math.cos(o.yaw));
    for (let i = 0; i < 2; i++) {
      const w = i === 0 ? -1 : 1, arm = i === 0 ? arms.L : arms.R;
      P.sh[i].set(w * D.shoulderHalf, D.spine, 0).applyQuaternion(state.torsoQ).add(P.pel);
      const h = o.hands && o.hands[i];
      if (h) _h.set(h[0], h[1], h[2]); else _h.copy(P.sh[i]).addScaledVector(_lat, w * 0.2).addScaledVector(_fw, 0.18).y -= 0.42;
      _c.copy(_h).sub(P.pel); _qi.copy(state.torsoQ).invert(); _c.applyQuaternion(_qi);
      if (Math.abs(_c.z) < 0.17 && _c.y > -0.12 && _c.y < 0.6 && Math.abs(_c.x) < 0.27 && !h) { _c.x = w * 0.27; _c.applyQuaternion(state.torsoQ).add(P.pel); _h.copy(_c); }
      const dy = _h.y - P.sh[i].y;
      _pole.set(w * (0.5 + (dy < -0.2 ? 0.5 : 0)), -0.85, -0.45).normalize().applyAxisAngle(_Y, o.yaw);
      if (dy > 0.25) _pole.set(w * 0.4, -0.9, -0.2).normalize().applyAxisAngle(_Y, o.yaw);
      ik(P.sh[i], _h, D.upper, D.fore, _pole, P.el[i], P.hand[i]);
      place(arm.upper, P.sh[i], P.el[i]); place(arm.fore, P.el[i], P.hand[i]);
      arm.elbow.position.copy(P.el[i]); arm.hand.position.copy(P.hand[i]);
      _e.subVectors(P.hand[i], P.el[i]).normalize(); arm.palm.position.copy(P.hand[i]).addScaledVector(_e, 0.045);
      _b.copy(P.hand[i]).addScaledVector(_e, -0.07); place(arm.cuff, _b, _c.copy(_b).addScaledVector(_e, 0.032));
    }
    for (let i = 0; i < 2; i++) {
      const w = i === 0 ? -1 : 1, f = o.feet[i], lg = legs[i];
      P.hip[i].set(o.px, o.py, o.pz).addScaledVector(_lat, w * D.hipHalf).y -= 0.03;
      P.ank[i].set(f.x, D.ankleY + f.lift, f.z);
      _pole.set(0, 0.15, 0).addScaledVector(new V3(Math.sin(f.yaw), 0, Math.cos(f.yaw)), 1).addScaledVector(_lat, w * 0.25).normalize();
      ik(P.hip[i], P.ank[i], D.thigh, D.shin, _pole, P.knee[i], _c);
      place(lg.thigh, P.hip[i], P.knee[i]); place(lg.shin, P.knee[i], _c);
      lg.knee.position.copy(P.knee[i]); lg.shoe.position.copy(_c);
      lg.shoe.rotation.order = 'YXZ'; lg.shoe.rotation.set(Math.min(0.9, f.lift * 7) * (f.lift > 0.1 ? 0.5 : 1), f.yaw + w * 0.12, 0);
    }
  }
  const api = { root, update, updateWorld, dims: D, parts: { torso, head }, handPoints: () => P.hand, shoulderPoints: () => P.sh, headWorld: () => head.getWorldPosition(new V3()), joints: P };
  return api;
}
