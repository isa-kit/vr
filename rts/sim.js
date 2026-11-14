// ============================ rts/sim.js — deterministic fixed-step RTS simulation (no THREE, no DOM) ============================
// 20 Hz fixed step (DT = 0.05 s) decoupled from rendering; same seed + same commands => identical match.
// Entities (units and buildings) share one id space. Teams are 0 (player) and 1 (opponent). All positions are in map cells.
import { genMap, createNav, N, K, WL } from './map.js?v=rts4';
import { rng } from '../procgen/noise.js?v=rts4';

export { N, K, WL };
export const DT = 0.05;
export const UT = {
  worker:   { name: 'Worker',   hp: 45,  spd: 2.7, r: 0.38, dmg: 4,  rng: 1.1, cd: 1.2, cost: 50,  time: 8,  vis: 7,  armor: 0, pop: 1, from: 'hq' },
  infantry: { name: 'Infantry', hp: 100, spd: 2.6, r: 0.42, dmg: 10, rng: 1.3, cd: 0.9, cost: 60,  time: 9,  vis: 8,  armor: 2, pop: 1, from: 'barracks' },
  ranged:   { name: 'Archer',   hp: 58,  spd: 2.5, r: 0.38, dmg: 9,  rng: 6.2, cd: 1.3, cost: 70,  time: 10, vis: 9,  armor: 0, pop: 1, from: 'barracks' },
  scout:    { name: 'Rider',    hp: 70,  spd: 4.6, r: 0.45, dmg: 6,  rng: 1.4, cd: 0.8, cost: 80,  time: 10, vis: 13, armor: 1, pop: 2, from: 'barracks' },
  siege:    { name: 'Catapult', hp: 170, spd: 1.5, r: 0.62, dmg: 42, rng: 7.5, cd: 3.2, cost: 200, time: 20, vis: 8,  armor: 4, pop: 4, from: 'barracks' },
};
export const BT = {
  hq:       { name: 'Citadel',  size: 4, hp: 1500, cost: 0,   time: 0,  vis: 11, armor: 5, pop: 20 },
  barracks: { name: 'Barracks', size: 3, hp: 700,  cost: 150, time: 25, vis: 8,  armor: 3, pop: 0 },
  depot:    { name: 'Depot',    size: 2, hp: 400,  cost: 100, time: 15, vis: 6,  armor: 2, pop: 10 },
};
const VS = { ranged: { infantry: 1.25 }, infantry: { scout: 1.4 }, scout: { ranged: 1.5 } };    // damage multipliers (attacker -> defender)
const POP_MAX = 80, ORE_TRIP = 10, GATHER_T = 2.2, STAND = 1;
export const DIFF = {
  easy:   { gather: 0.75, workers: 7,  wave0: 7,  waveGrow: 2, think: 1.2, startBonus: 0,   firstWave: 200 },
  normal: { gather: 1.0,  workers: 11, wave0: 9,  waveGrow: 3, think: 0.7, startBonus: 0,   firstWave: 150 },
  hard:   { gather: 1.25, workers: 15, wave0: 8,  waveGrow: 3, think: 0.4, startBonus: 150, firstWave: 110 },
};

export function createSim({ seed = 7, mapSeed = seed, startOre = 250, startWorkers = 4, teams = 2, noStartBuildings = false } = {}) {
  const map = genMap(mapSeed), nav = createNav(map), R = rng(seed * 977 + 3);
  const S = {
    map, nav, DT, tick: 0, time: 0, ents: new Map(), nextId: 1, ev: [], winner: -1, over: false, seed,
    team: [0, 1].map((t) => ({ id: t, ore: startOre, mined: 0, built: 0, lost: 0, kills: 0, gatherMul: 1 })),
    vis: [new Uint8Array(N * N), new Uint8Array(N * N)], fogOn: true,
  };
  const isB = (e) => e && e.isB;
  const alive = (id) => { const e = S.ents.get(id); return e && e.hp > 0 ? e : null; };
  S.get = alive;
  const hash = new Map();                                                  // spatial hash, 4-cell buckets
  const bucketKey = (x, z) => (Math.floor(z / 4) << 8) | Math.floor(x / 4);

  // ---------------------------------------------------------------- spawning
  S.spawnUnit = (team, type, x, z, opts = {}) => {
    const t = UT[type], free = nav.nearestFree(x, z, 6) || { x, z };
    const u = { id: S.nextId++, isB: false, team, type, x: free.x, z: free.z, r: t.r, hp: t.hp, maxhp: t.hp, face: team === 0 ? -0.8 : 2.3,
      order: { t: 'idle' }, path: null, pi: 0, navV: 0, cd: 0, stance: 'aggro', at: 0, moving: false, hitT: 0, atkT: 0, carry: 0, gT: 0, stuck: 0, lx: free.x, lz: free.z, home: null, want: null, ownerTarget: 0, born: S.tick };
    S.ents.set(u.id, u); if (opts.order) giveOrder(u, opts.order); return u;
  };
  S.spawnBuilding = (team, type, cx, cz, built = true) => {
    const t = BT[type], b = { id: S.nextId++, isB: true, team, type, cx, cz, size: t.size, x: cx + t.size / 2, z: cz + t.size / 2, hp: built ? t.hp : 1, maxhp: t.hp, built, progress: built ? 1 : 0, queue: [], rally: null, hitT: 0, r: t.size / 2, y: map.heightAt(cx + t.size / 2, cz + t.size / 2) };
    nav.occupy(cx, cz, t.size, true); S.ents.set(b.id, b);
    for (const e of S.ents.values()) if (!e.isB && cellInRect(e.x, e.z, b)) { const f = nav.nearestFree(e.x, e.z, 8); if (f) { e.x = f.x; e.z = f.z; } }
    if (type === 'hq' || type === 'depot') S.dirtyDrop = true;
    return b;
  };
  const cellInRect = (x, z, b) => x >= b.cx && x < b.cx + b.size && z >= b.cz && z < b.cz + b.size;

  S.startPos = (team) => map.starts[team];
  S.setupTeams = () => {
    for (let t = 0; t < teams; t++) {
      const s = map.starts[t], hq = S.spawnBuilding(t, 'hq', Math.round(s.x - 2), Math.round(s.z - 2));
      S.team[t].hq = hq.id;
      for (let k = 0; k < startWorkers; k++) S.spawnUnit(t, 'worker', hq.x + (k - 1.5) * 1.1, hq.z + (t === 0 ? 3.2 : -3.2));
    }
  };
  if (!noStartBuildings) S.setupTeams();

  // ---------------------------------------------------------------- queries
  S.units = (team) => { const o = []; for (const e of S.ents.values()) if (!e.isB && e.hp > 0 && (team === undefined || e.team === team)) o.push(e); return o; };
  S.buildings = (team) => { const o = []; for (const e of S.ents.values()) if (e.isB && e.hp > 0 && (team === undefined || e.team === team)) o.push(e); return o; };
  S.pop = (team) => { let p = 0; for (const e of S.ents.values()) if (e.team === team && e.hp > 0) { if (!e.isB) p += UT[e.type].pop; else for (const q of e.queue) p += UT[q.type].pop; } return p; };
  S.popCap = (team) => { let c = 0; for (const e of S.ents.values()) if (e.isB && e.team === team && e.hp > 0 && e.built) c += BT[e.type].pop; return Math.min(POP_MAX, c); };
  S.visibleTo = (team, e) => e.team === team || !S.fogOn || S.vis[team][Math.floor(e.z) * N + Math.floor(e.x)] === 2;
  S.cellVis = (team, x, z) => S.vis[team][Math.floor(z) * N + Math.floor(x)];
  S.distToEnt = (x, z, e) => {
    if (!e.isB) return Math.hypot(e.x - x, e.z - z) - e.r;
    const dx = Math.max(e.cx - x, 0, x - (e.cx + e.size)), dz = Math.max(e.cz - z, 0, z - (e.cz + e.size));
    return Math.hypot(dx, dz);
  };
  S.entsAround = (x, z, rad, pred) => {
    const o = [], r4 = Math.ceil(rad / 4) + 1, cx = Math.floor(x / 4), cz = Math.floor(z / 4);
    for (let j = cz - r4; j <= cz + r4; j++) for (let i = cx - r4; i <= cx + r4; i++) {
      const l = hash.get((j << 8) | i); if (!l) continue;
      for (const e of l) if (e.hp > 0 && Math.hypot(e.x - x, e.z - z) <= rad && (!pred || pred(e))) o.push(e);
    }
    return o;
  };
  const rebuildHash = () => { hash.clear(); for (const e of S.ents.values()) { if (e.hp <= 0) continue; const k = bucketKey(e.x, e.z), l = hash.get(k); if (l) l.push(e); else hash.set(k, [e]); } };

  // ---------------------------------------------------------------- orders
  function giveOrder(u, o) { u.order = o; u.path = null; u.pi = 0; u.stuck = 0; u.apK = null; if (o.t === 'move' || o.t === 'amove') { u.want = { x: o.x, z: o.z }; } }
  const dropoff = (u) => { let best = null, bd = 1e9; for (const b of S.ents.values()) if (b.isB && b.team === u.team && b.built && b.hp > 0 && (b.type === 'hq' || b.type === 'depot')) { const d = Math.hypot(b.x - u.x, b.z - u.z); if (d < bd) { bd = d; best = b; } } return best; };
  const nearestNode = (x, z, maxD = 99) => { let best = null, bd = maxD; for (const n of map.nodes) if (n.amount > 0) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = n; } } return best; };
  S.nearestNode = nearestNode;

  // formation slots around a destination
  function formationSlots(units, tx, tz, form) {
    const k = units.length; if (k === 0) return [];
    let cx = 0, cz = 0; for (const u of units) { cx += u.x; cz += u.z; } cx /= k; cz /= k;
    let fx = tx - cx, fz = tz - cz; const fl = Math.hypot(fx, fz); if (fl < 0.5) { fx = 0; fz = -1; } else { fx /= fl; fz /= fl; }
    const rx = -fz, rz = fx, sp = 1.15, rows = [];
    if (form === 'line') { const per = Math.min(k, 14); for (let a = 0; a < k; a += per) rows.push(Math.min(per, k - a)); }
    else if (form === 'wedge') { let n = 1, left = k; while (left > 0) { rows.push(Math.min(n, left)); left -= n; n++; } }
    else { const cols = Math.max(1, Math.ceil(Math.sqrt(k * 1.3))); for (let a = 0; a < k; a += cols) rows.push(Math.min(cols, k - a)); }
    const slots = [];
    rows.forEach((cnt, ri) => {
      const row = [];
      for (let c = 0; c < cnt; c++) {
        const lx = (c - (cnt - 1) / 2) * sp, ly = -ri * sp * (form === 'wedge' ? 0.95 : 1);
        let sx = tx + rx * lx + fx * ly, sz = tz + rz * lx + fz * ly;
        sx = Math.min(N - 0.6, Math.max(0.6, sx)); sz = Math.min(N - 0.6, Math.max(0.6, sz));
        const fr = nav.nearestFree(sx, sz, 5); row.push({ x: fr ? fr.x : tx, z: fr ? fr.z : tz, lx });
      }
      slots.push(row);
    });
    const sorted = units.slice().sort((a, b) => ((b.x - cx) * fx + (b.z - cz) * fz) - ((a.x - cx) * fx + (a.z - cz) * fz) || a.id - b.id);
    const out = []; let p = 0;
    for (const row of slots) {
      const chunk = sorted.slice(p, p + row.length).sort((a, b) => ((a.x - cx) * rx + (a.z - cz) * rz) - ((b.x - cx) * rx + (b.z - cz) * rz) || a.id - b.id);
      row.sort((a, b) => a.lx - b.lx);
      chunk.forEach((u, i) => out.push([u, row[i]])); p += row.length;
    }
    return out;
  }
  S.formationSlots = formationSlots;

  S.cmd = (team, c) => {
    const mine = (c.ids || []).map((id) => alive(id)).filter((e) => e && e.team === team && !e.isB);
    switch (c.t) {
      case 'move': case 'amove': {
        const movers = mine.filter((u) => u.type !== 'siege' || true);
        const assigned = formationSlots(movers, c.x, c.z, c.form || 'box');
        for (const [u, s] of assigned) giveOrder(u, { t: c.t, x: s.x, z: s.z, fx: c.x, fz: c.z });
        break;
      }
      case 'attack': { const tg = alive(c.target); if (tg && tg.team !== team) for (const u of mine) giveOrder(u, { t: 'attack', target: tg.id }); break; }
      case 'gather': { const n = map.nodes[c.node]; if (n && n.amount > 0) for (const u of mine) if (u.type === 'worker') giveOrder(u, { t: 'gather', node: n.id, ph: 'go' }); break; }
      case 'stop': for (const u of mine) giveOrder(u, { t: 'idle' }); break;
      case 'stance': for (const u of mine) u.stance = c.v; break;
      case 'build': {
        const ws = mine.filter((u) => u.type === 'worker'); if (!ws.length) break;
        const b = S.placeBuilding(team, c.type, c.cx, c.cz); if (!b) break;
        for (const u of ws) giveOrder(u, { t: 'build', bld: b.id });
        break;
      }
      case 'help': { const b = alive(c.bld); if (b && b.team === team && !b.built) for (const u of mine) if (u.type === 'worker') giveOrder(u, { t: 'build', bld: b.id }); break; }
      case 'train': return S.train(team, c.bld, c.type);
      case 'cancel': { const b = alive(c.bld); if (b && b.team === team && b.queue.length > (c.i | 0)) { const q = b.queue.splice(c.i | 0, 1)[0]; S.team[team].ore += UT[q.type].cost; } break; }
      case 'rally': { const b = alive(c.bld); if (b && b.team === team) b.rally = c.node != null ? { node: c.node } : { x: c.x, z: c.z }; break; }
    }
    return true;
  };

  S.canPlace = (team, type, cx, cz) => {
    const sz = BT[type].size; if (cx < 1 || cz < 1 || cx + sz > N - 1 || cz + sz > N - 1) return false;
    let lo = 1e9, hi = -1e9;
    for (let j = cz; j < cz + sz; j++) for (let i = cx; i < cx + sz; i++) { if (map.kind[j * N + i] !== K.GRASS || nav.stat[j * N + i] || nav.occ[j * N + i]) return false; }
    for (let j = cz; j <= cz + sz; j++) for (let i = cx; i <= cx + sz; i++) { const h = map.h[j * map.V + i]; lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (hi - lo > 0.9) return false;
    for (const n of map.nodes) if (n.amount > 0 && Math.hypot(n.x - (cx + sz / 2), n.z - (cz + sz / 2)) < sz / 2 + 1.6) return false;
    return true;
  };
  S.placeBuilding = (team, type, cx, cz) => {
    const cost = BT[type].cost; if (S.team[team].ore < cost || !S.canPlace(team, type, cx, cz)) return null;
    S.team[team].ore -= cost; return S.spawnBuilding(team, type, cx, cz, false);
  };
  S.train = (team, bid, type) => {
    const b = alive(bid), t = UT[type];
    if (!b || b.team !== team || !b.built || !t || t.from !== b.type || b.queue.length >= 5) return false;
    if (S.team[team].ore < t.cost || S.pop(team) + t.pop > S.popCap(team)) return false;
    S.team[team].ore -= t.cost; b.queue.push({ type, t: 0 }); return true;
  };

  // ---------------------------------------------------------------- per-unit logic
  let pathBudget = 0;
  const requestPath = (u, gx, gz) => {
    if (pathBudget <= 0) return false;
    pathBudget--; const p = nav.path(u.x, u.z, gx, gz);
    u.path = p; u.pi = 0; u.navV = nav.version; u.pathGoal = { x: gx, z: gz }; u.pathT = S.time;
    return true;
  };
  const dmgOf = (a, d) => {
    const at = UT[a.type]; let m = 1;
    if (d.isB) m = a.type === 'siege' ? 2.5 : 0.55; else { m = (VS[a.type] && VS[a.type][d.type]) || 1; if (a.type === 'siege') m *= 0.6; }
    const armor = d.isB ? BT[d.type].armor : UT[d.type].armor;
    return Math.max(1, at.dmg * m - armor * 0.8);
  };
  S.damage = (a, d, amt) => {
    if (d.hp <= 0) return;
    d.hp -= amt; d.hitT = 0.25;
    S.ev.push({ k: 'hit', id: d.id, x: d.x, z: d.z, b: d.isB });
    if (d.isB && d.team !== a.team && !d.alertT || (d.isB && S.time - (d.alertT || -99) > 12)) { d.alertT = S.time; S.ev.push({ k: 'alert', team: d.team, x: d.x, z: d.z }); }
    if (!d.isB && d.order.t === 'idle' && d.stance !== 'hold' && d.type !== 'worker') giveOrder(d, { t: 'attack', target: a.id });   // fight back
    if (d.hp <= 0) kill(d, a);
  };
  function kill(d, killer) {
    d.hp = 0; S.team[d.team].lost++; if (killer) S.team[killer.team].kills++;
    S.ev.push({ k: 'die', id: d.id, x: d.x, z: d.z, b: d.isB, type: d.type, team: d.team, size: d.size });
    if (d.isB) { nav.occupy(d.cx, d.cz, d.size, false); S.dirtyDrop = true; }
    S.ents.delete(d.id);
    if (d.isB && d.type === 'hq' && !S.over) { S.over = true; S.winner = 1 - d.team; S.ev.push({ k: 'win', team: S.winner }); }
  }

  function moveAlong(u, dt) {
    u.moving = false;
    if (!u.path || u.pi >= u.path.length) return true;
    if (u.navV !== nav.version) { u.repath = true; }
    let rem = UT[u.type].spd * nav.speedMul(u.x, u.z) * dt;
    while (rem > 1e-6 && u.pi < u.path.length) {
      const w = u.path[u.pi], dx = w.x - u.x, dz = w.z - u.z, d = Math.hypot(dx, dz);
      if (d <= rem) { u.x = w.x; u.z = w.z; rem -= d; u.pi++; }
      else { u.x += dx / d * rem; u.z += dz / d * rem; rem = 0; u.moving = true; const a = Math.atan2(dx, dz); let da = a - u.face; da = Math.atan2(Math.sin(da), Math.cos(da)); u.face += da * 0.35; }
    }
    if (u.pi >= u.path.length) { u.path = null; return true; }
    u.moving = true; return false;
  }
  function stepTo(u, gx, gz, dt, key) {                                       // walk to a point (re-pathing as needed); true when there
    if (!u.path || u.apK !== key || u.repath) {
      if (u.apK === key && u.path && !u.repath) { /* keep */ }
      else if (u.apK !== key || u.repath || !u.path) {
        if (!requestPath(u, gx, gz)) return false;
        u.apK = key; u.repath = false;
        if (!u.path) { const o = u.order; if (o.fx != null && (o.x !== o.fx || o.z !== o.fz)) { o.x = o.fx; o.z = o.fz; u.apK = null; return false; } u.noPath = true; return true; }
      }
    }
    const done = moveAlong(u, dt);
    // stuck detection
    if (u.moving) {
      if (Math.hypot(u.x - u.lx, u.z - u.lz) < 0.012) u.stuck += dt; else { u.stuck = 0; u.lx = u.x; u.lz = u.z; }
      if (u.stuck > 0.9) { u.stuck = 0; u.stuckN = (u.stuckN || 0) + 1; u.repath = true; if (u.stuckN > 2 && Math.hypot(gx - u.x, gz - u.z) < 3.5) { u.path = null; u.stuckN = 0; return true; } }
    }
    return done;
  }

  function acquire(u, range) {
    let best = null, bd = 1e9;
    for (const e of S.entsAround(u.x, u.z, range + 3, (q) => q.team !== u.team)) {
      if (S.fogOn) { if (S.vis[u.team][Math.floor(e.z) * N + Math.floor(e.x)] !== 2) continue; }
      const d = S.distToEnt(u.x, u.z, e) - (e.isB ? 3 : 0) + (e.type === 'worker' ? 0.5 : 0);   // prefer fighters over buildings
      if (d <= range && d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function tryAttack(u, tg, dt) {                                             // attack/chase one target; returns false if target invalid
    if (!tg || tg.hp <= 0) return false;
    const t = UT[u.type], d = S.distToEnt(u.x, u.z, tg);
    if (d <= t.rng) {
      u.path = null; u.moving = false;
      const a = Math.atan2(tg.x - u.x, tg.z - u.z); let da = a - u.face; da = Math.atan2(Math.sin(da), Math.cos(da)); u.face += da * 0.4;
      if (u.cd <= 0) {
        u.cd = t.cd; u.atkT = 0.35;
        S.ev.push({ k: 'shot', id: u.id, type: u.type, x: u.x, z: u.z, tx: tg.x, tz: tg.z, ranged: t.rng > 2 });
        S.damage(u, tg, dmgOf(u, tg));
      }
      return true;
    }
    if (u.stance === 'hold' && u.order.t !== 'attack') return false;
    const gx = tg.isB ? nav.nearestFree(tg.x < u.x ? tg.cx - 0.5 : tg.cx + tg.size + 0.5, Math.min(tg.cz + tg.size - 0.5, Math.max(tg.cz + 0.5, u.z))) : { x: tg.x, z: tg.z };
    const key = 'a' + tg.id;
    if (u.apK === key && u.pathGoal && !tg.isB && Math.hypot(u.pathGoal.x - tg.x, u.pathGoal.z - tg.z) > 1.8) u.repath = true;
    if (u.apK === key && S.time - (u.pathT || 0) > 1.2) u.repath = true;
    if (gx) stepTo(u, gx.x, gx.z, dt, key);
    return true;
  }

  function updateUnit(u, dt) {
    if (u.cd > 0) u.cd -= dt; if (u.hitT > 0) u.hitT -= dt; if (u.atkT > 0) u.atkT -= dt;
    const o = u.order, t = UT[u.type];
    switch (o.t) {
      case 'idle': {
        u.moving = false;
        if (u.type === 'worker') break;
        if (u.stance !== 'hold' || true) {
          if (((S.tick + u.id) & 3) === 0) {
            const rng_ = u.stance === 'aggro' ? t.vis - 1 : u.stance === 'defend' ? t.rng + 2.5 : t.rng;
            const tg = acquire(u, rng_);
            if (tg) { u.engage = tg.id; u.eFrom = { x: u.x, z: u.z }; }
          }
          const tg = u.engage && alive(u.engage);
          if (tg) {
            if (u.stance === 'defend' && u.eFrom && Math.hypot(u.x - u.eFrom.x, u.z - u.eFrom.z) > 7) { u.engage = 0; giveOrder(u, { t: 'move', x: u.eFrom.x, z: u.eFrom.z }); break; }
            if (!tryAttack(u, tg, dt)) u.engage = 0;
          } else u.engage = 0;
        }
        break;
      }
      case 'move': {
        if (stepTo(u, o.x, o.z, dt, 'm')) { o.t = 'idle'; u.engage = 0; u.stuckN = 0; }
        break;
      }
      case 'amove': {
        if (((S.tick + u.id) & 3) === 0 && !(u.engage && alive(u.engage))) { const tg = acquire(u, t.vis - 1); u.engage = tg ? tg.id : 0; }
        const tg = u.engage && alive(u.engage);
        if (tg) { tryAttack(u, tg, dt); break; }
        if (stepTo(u, o.x, o.z, dt, 'm')) { o.t = 'idle'; u.stuckN = 0; }
        break;
      }
      case 'attack': {
        const tg = alive(o.target);
        if (!tg) { o.t = 'idle'; u.moving = false; break; }
        tryAttack(u, tg, dt);
        break;
      }
      case 'gather': gatherStep(u, o, dt); break;
      case 'build': {
        const b = alive(o.bld);
        if (!b || b.built) { o.t = 'idle'; u.moving = false; break; }
        const d = S.distToEnt(u.x, u.z, b);
        if (d > 1.9) { stepTo(u, ...adjacentPoint(u, b), dt, 'b' + b.id); }
        else { u.path = null; u.moving = false; u.atkT = 0.2; u.face = Math.atan2(b.x - u.x, b.z - u.z); b.workers = (b.workers || 0) + 1; }
        break;
      }
    }
  }
  function adjacentPoint(u, b) {
    const px = u.x < b.cx ? b.cx - 0.6 : u.x > b.cx + b.size ? b.cx + b.size + 0.6 : u.x, pz = u.z < b.cz ? b.cz - 0.6 : u.z > b.cz + b.size ? b.cz + b.size + 0.6 : u.z;
    const f = nav.nearestFree(px, pz, 4) || { x: px, z: pz }; return [f.x, f.z];
  }
  function gatherStep(u, o, dt) {
    const n = map.nodes[o.node];
    if (o.ph === 'go') {
      if (!n || n.amount <= 0) { const nn = nearestNode(u.x, u.z, 14); if (nn) { o.node = nn.id; return; } o.t = 'idle'; return; }
      if (Math.hypot(n.x - u.x, n.z - u.z) <= 1.75) { o.ph = 'mine'; o.tt = 0; u.path = null; u.moving = false; return; }
      const ang = (u.id * 2.399) % 6.283, gx = n.x + Math.cos(ang) * 1.5, gz = n.z + Math.sin(ang) * 1.5;
      stepTo(u, gx, gz, dt, 'g' + n.id);
      if (u.noPath) { u.noPath = false; o.t = 'idle'; }
    } else if (o.ph === 'mine') {
      u.moving = false; u.atkT = 0.2; if (n) u.face = Math.atan2(n.x - u.x, n.z - u.z);
      if (!n || n.amount <= 0) { o.ph = u.carry > 0 ? 'ret' : 'go'; return; }
      o.tt += dt;
      if (o.tt >= GATHER_T) { const take = Math.min(ORE_TRIP, n.amount); n.amount -= take; u.carry = take; if (n.amount <= 0) { nav.setNode(n, false); S.ev.push({ k: 'depleted', node: n.id }); } o.ph = 'ret'; }
    } else if (o.ph === 'ret') {
      const b = dropoff(u); if (!b) { o.t = 'idle'; return; }
      if (S.distToEnt(u.x, u.z, b) <= 1.9) {
        const m = S.team[u.team].gatherMul * 1; const g = u.carry * m; S.team[u.team].ore += g; S.team[u.team].mined += g; u.carry = 0; S.ev.push({ k: 'drop', team: u.team, x: u.x, z: u.z, amt: g });
        u.path = null; o.ph = 'go'; return;
      }
      stepTo(u, ...adjacentPoint(u, b), dt, 'r' + b.id);
    }
  }

  // separation: soft push apart; moving units push idle ones harder than the other way round
  function separate() {
    const push = new Map();
    for (const l of hash.values()) for (const a of l) {
      if (a.isB) continue;
      for (const b of S.entsAround(a.x, a.z, 1.4, (q) => !q.isB && q.id > a.id)) {
        let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz); const need = a.r + b.r;
        if (d >= need) continue;
        if (d < 1e-4) { dx = ((a.id * 13) % 7) - 3; dz = ((b.id * 7) % 5) - 2; d = Math.hypot(dx, dz) || 1; }
        const over = need - d, wa = a.moving ? 1 : 3, wb = b.moving ? 1 : 3, ta = wb / (wa + wb), tb = wa / (wa + wb), nx = dx / d, nz = dz / d;
        const pa = push.get(a) || (push.set(a, [0, 0]), push.get(a)), pb = push.get(b) || (push.set(b, [0, 0]), push.get(b));
        pa[0] -= nx * over * ta * 0.6; pa[1] -= nz * over * ta * 0.6; pb[0] += nx * over * tb * 0.6; pb[1] += nz * over * tb * 0.6;
      }
    }
    for (const [u, p] of push) {
      const L = Math.hypot(p[0], p[1]); if (L > 0.12) { p[0] *= 0.12 / L; p[1] *= 0.12 / L; }
      const nx = u.x + p[0], nz = u.z + p[1];
      if (!nav.blockedAt(nx, u.z)) u.x = nx; if (!nav.blockedAt(u.x, nz)) u.z = nz;
    }
  }

  function updateBuilding(b, dt) {
    if (b.hitT > 0) b.hitT -= dt;
    if (!b.built) {
      const w = b.workers || 0; b.workers = 0;
      if (w > 0) { b.progress = Math.min(1, b.progress + dt * Math.pow(w, 0.7) / BT[b.type].time); b.hp = Math.max(b.hp, Math.floor(b.maxhp * b.progress)); if (b.progress >= 1) { b.built = true; b.hp = b.maxhp; S.dirtyDrop = true; S.ev.push({ k: 'built', id: b.id, team: b.team }); S.team[b.team].built++; } }
      return;
    }
    const q = b.queue[0];
    if (q) {
      const spd = b.team === 1 ? S.aiSpeed || 1 : 1;
      q.t += dt * spd;
      if (q.t >= UT[q.type].time) {
        b.queue.shift();
        const sp = spawnPoint(b), u = S.spawnUnit(b.team, q.type, sp.x, sp.z);
        S.ev.push({ k: 'train', id: u.id, team: b.team, type: q.type });
        if (b.rally && b.rally.node != null && q.type === 'worker') giveOrder(u, { t: 'gather', node: b.rally.node, ph: 'go' });
        else if (b.rally && b.rally.x != null) giveOrder(u, { t: 'move', x: b.rally.x, z: b.rally.z });
        else if (q.type === 'worker') { const n = nearestNode(b.x, b.z, 20); if (n) giveOrder(u, { t: 'gather', node: n.id, ph: 'go' }); }
      }
    }
  }
  function spawnPoint(b) {
    const side = b.team === 0 ? 1 : -1;
    return nav.nearestFree(b.x + (((S.tick >> 2) % 5) - 2) * 0.8, b.cz + (side > 0 ? b.size + 1.0 : -1.0), 6) || { x: b.x, z: b.z };
  }

  // ---------------------------------------------------------------- fog of war
  function updateVision() {
    for (let t = 0; t < 2; t++) {
      const v = S.vis[t]; for (let q = 0; q < v.length; q++) if (v[q] === 2) v[q] = 1;
      for (const e of S.ents.values()) {
        if (e.team !== t || e.hp <= 0) continue;
        const r = e.isB ? BT[e.type].vis : UT[e.type].vis, i0 = Math.max(0, Math.floor(e.x - r)), i1 = Math.min(N - 1, Math.floor(e.x + r)), j0 = Math.max(0, Math.floor(e.z - r)), j1 = Math.min(N - 1, Math.floor(e.z + r)), r2 = r * r;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const dx = i + 0.5 - e.x, dz = j + 0.5 - e.z; if (dx * dx + dz * dz <= r2) v[j * N + i] = 2; }
      }
    }
  }

  // ---------------------------------------------------------------- step
  S.ai = [];                                                                   // AI controllers register here ({think(sim)})
  S.step = () => {
    if (S.over) return;
    rebuildHash(); pathBudget = 14;
    S.tick++; S.time = S.tick * DT;
    for (const a of S.ai) a.think(S);
    const list = [...S.ents.values()];
    for (const e of list) { if (e.hp <= 0) continue; if (e.isB) updateBuilding(e, DT); else updateUnit(e, DT); }
    rebuildHash(); separate();
    if ((S.tick & 3) === 0) updateVision();
    for (const u of S.ents.values()) if (!u.isB) { if (u.moving) u.at += DT * UT[u.type].spd * 0.9; }
  };
  S.updateVision = updateVision;
  S.hash = () => { let h = 2166136261 >>> 0; for (const e of S.ents.values()) { h = Math.imul(h ^ (Math.round(e.x * 100) + e.id * 7), 16777619) >>> 0; h = Math.imul(h ^ (Math.round(e.z * 100) + e.hp | 0), 16777619) >>> 0; } return h; };
  S.R = R;
  return S;
}
