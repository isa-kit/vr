// ============================ shared/birds.js — calm, believable distant birds ============================
//
//   import { createBirds } from '../shared/birds.js';
//
//   const birds = createBirds({
//     parent: scene,                       // Object3D to add the flock group to
//     flocks: [                            // each flock = a leader on a wide lazy path + loosely trailing members
//       { n: 5, cx: 0, cz: -120, ra: 90, rb: 50, y: 40, yv: 6, period: 110, size: 3.0 },
//       { n: 3, cx: 40, cz: -200, ra: 120, rb: 60, y: 55, yv: 8, period: 140, size: 2.6 },
//     ],                                   // size = wingspan in metres; period = seconds per lap (bigger = calmer)
//     color: 0x2f333b,                     // body/wing colour (gulls: color 0xf4f4ef, wingColor 0xcfd4da, tipColor 0x3a3d44)
//     seed: 7,
//   });
//   birds.update(t);                       // each frame with WORLD time (stop advancing it while paused → birds freeze)
//   birds.group.visible = false;           // hide (quality governor / passthrough)
//
// A bird = body + head + tail + two-segment wings (inner + outer, the tip lags the flap and bends), banks into turns,
// pitches with climbs, faces its direction of travel, flaps in bursts with glides between, and never goes fast.
// ============================================================================================================

import * as THREE from 'three';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- shared geometry (built once) ----
let G = null;
function geoms() {
  if (G) return G;
  const tri = (pts, idx) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; };
  // inner wing: root at the shoulder (x=0) out to the elbow (x=0.36); leading edge forward (+z), trailing edge back
  const inner = tri([0, 0, 0.10, 0.36, 0, 0.07, 0.36, 0, -0.10, 0, 0, -0.20], [0, 1, 2, 0, 2, 3]);
  // outer wing: from the elbow out to a swept, pointed tip
  const outer = tri([0, 0, 0.07, 0.44, 0, -0.10, 0.34, 0, -0.14, 0, 0, -0.10], [0, 1, 2, 0, 2, 3]);
  const body = new THREE.SphereGeometry(0.075, 10, 8); body.scale(1, 0.85, 2.7);
  const head = new THREE.SphereGeometry(0.05, 8, 6); head.translate(0, 0.012, 0.25);
  const beak = new THREE.ConeGeometry(0.014, 0.07, 6); beak.rotateX(Math.PI / 2); beak.translate(0, 0.0, 0.325);
  const tail = tri([0, 0, -0.16, 0.07, 0, -0.40, -0.07, 0, -0.40], [0, 1, 2]);
  G = { inner, outer, body, head, beak, tail };
  return G;
}

function makeBird(color, wingColor, tipColor) {
  const g = geoms();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const wingMat = new THREE.MeshLambertMaterial({ color: wingColor, side: THREE.DoubleSide });
  const tipMat = new THREE.MeshLambertMaterial({ color: tipColor, side: THREE.DoubleSide });
  const root = new THREE.Group();          // position + heading + bank + pitch
  const model = new THREE.Group();         // scaled to the wingspan
  root.add(model);
  model.add(new THREE.Mesh(g.body, bodyMat), new THREE.Mesh(g.head, bodyMat), new THREE.Mesh(g.beak, new THREE.MeshLambertMaterial({ color: 0xd9a441 })));
  model.add(new THREE.Mesh(g.tail, wingMat));
  const wings = [];
  for (const side of [1, -1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(0.045 * side, 0.015, 0.04); shoulder.scale.x = side;
    shoulder.add(new THREE.Mesh(g.inner, wingMat));
    const elbow = new THREE.Group(); elbow.position.set(0.36, 0, 0); elbow.add(new THREE.Mesh(g.outer, tipMat));
    shoulder.add(elbow); model.add(shoulder);
    wings.push({ shoulder, elbow });
  }
  return { root, model, wings };
}

export function createBirds({ parent, flocks = [], color = 0x2f333b, wingColor = null, tipColor = null, seed = 1 }) {
  const R = rng(seed);
  const group = new THREE.Group();
  parent.add(group);
  const all = [], leaders = [];
  const wc = wingColor ?? color, tc = tipColor ?? wingColor ?? color;

  for (const f of flocks) {
    const L = {
      cx: f.cx, cz: f.cz, ra: f.ra, rb: f.rb ?? f.ra * 0.6, y: f.y ?? 40, yv: f.yv ?? 6,
      w: (Math.PI * 2) / (f.period ?? 120), ph: R() * 6.28, rot: R() * 6.28, k: 0.7 + R() * 0.3, members: [],
    };
    leaders.push(L);
    for (let i = 0; i < (f.n ?? 3); i++) {
      const b = makeBird(color, wc, tc);
      const scale = ((f.size ?? 2.5) * (0.85 + R() * 0.3)) / 1.5;     // 1.5 ≈ model wingspan
      b.model.scale.setScalar(scale);
      Object.assign(b, {
        lag: i * (0.9 + R() * 0.7), lat: i === 0 ? 0 : (i % 2 ? 1 : -1) * (0.9 + i * 0.55) * scale * 1.2, dy: (R() - 0.5) * 6 * (i ? 1 : 0),
        rate: 1.7 + R() * 0.7, ph: R() * 6.28, cyc: 8 + R() * 6, cph: R() * 6.28, bank: 0, pitch: 0, yaw: 0, init: false,
      });
      L.members.push(b); all.push(b); group.add(b.root);
    }
  }

  const _p = new THREE.Vector3(), _q = new THREE.Vector3();
  function path(L, t, out) {            // wide, lazy, slightly irregular loop
    const a = t * L.w + L.ph;
    const x = Math.cos(a) * L.ra + Math.sin(a * 2.3 + 1.1) * L.ra * 0.12;
    const z = Math.sin(a * 0.9 + 0.7) * L.rb;
    const c = Math.cos(L.rot), s = Math.sin(L.rot);
    return out.set(L.cx + x * c - z * s, L.y + Math.sin(a * 1.7 + L.ph) * L.yv, L.cz + x * s + z * c);
  }
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  let lastT = null;
  function update(t) {
    const dt = lastT === null ? 0.016 : Math.min(0.1, Math.abs(t - lastT)); lastT = t;
    for (const L of leaders) {
      for (const b of L.members) {
        const tt = t - b.lag;
        path(L, tt, _p); path(L, tt + 0.5, _q);
        const vx = _q.x - _p.x, vz = _q.z - _p.z, vy = _q.y - _p.y;
        const hs = Math.hypot(vx, vz) || 1e-4;
        const yawT = Math.atan2(vx, vz);
        // sideways offset (trailing members fly alongside, not in a line)
        _p.x += Math.cos(yawT) * b.lat; _p.z -= Math.sin(yawT) * b.lat; _p.y += b.dy;
        b.root.position.copy(_p);
        // face the direction of travel; bank into turns; pitch with climbs
        let dyaw = yawT - b.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
        const turn = b.init ? dyaw / Math.max(dt, 1e-3) : 0;
        b.yaw = b.init ? b.yaw + dyaw * Math.min(1, dt * 3) : yawT; b.init = true;
        const bankT = Math.max(-0.55, Math.min(0.55, -turn * 4.5)), pitchT = Math.atan2(vy, hs) * 0.9;
        b.bank += (bankT - b.bank) * Math.min(1, dt * 1.5);
        b.pitch += (pitchT - b.pitch) * Math.min(1, dt * 1.5);
        b.root.rotation.set(0, 0, 0);
        b.root.rotation.order = 'YXZ';
        b.root.rotation.y = b.yaw; b.root.rotation.x = -b.pitch; b.root.rotation.z = b.bank;
        // flap in bursts with long glides between
        const amp = sstep(-0.15, 0.35, Math.sin((t / b.cyc) * Math.PI * 2 + b.cph));
        const ph = t * b.rate * Math.PI * 2 + b.ph;
        const inner = 0.16 + amp * 0.5 * Math.sin(ph), outer = 0.06 + amp * 0.75 * Math.sin(ph - 0.95) - (1 - amp) * 0.04;
        for (const w of b.wings) { w.shoulder.rotation.z = inner; w.elbow.rotation.z = outer; }
      }
    }
  }
  return { group, update, birds: all };
}
