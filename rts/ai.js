// ============================ rts/ai.js — scripted opponent (gathers, expands, builds an army, attacks in waves) ============================
// Plays through exactly the same command API as the player (S.cmd), once per "think" interval of simulation time.
// It does not read fog of war except for knowing where the enemy base started (like most RTS skirmish AIs).
import { UT, BT, DIFF } from './sim.js?v=rts4';

export function createAI(S, team, diff = 'normal') {
  const D = DIFF[diff] || DIFF.normal, me = S.team[team], foe = 1 - team;
  me.gatherMul = D.gather; me.ore += D.startBonus;
  if (team === 1) S.aiSpeed = diff === 'easy' ? 0.85 : diff === 'hard' ? 1.2 : 1;
  const st = { next: 0, wave: 0, attacking: false, waveStart: 0, mixIdx: 0 };
  const mix = diff === 'easy' ? ['infantry', 'infantry', 'ranged', 'scout'] : ['infantry', 'ranged', 'infantry', 'scout', 'ranged', 'siege'];

  function buildSite(type, around) {
    const sz = BT[type].size, c = S.map.starts[team], dir = team === 0 ? 1 : -1;
    const cands = [];
    for (let r = 4; r <= 11; r++) for (let a = 0; a < 16; a++) {
      const ang = a / 16 * Math.PI * 2, cx = Math.round(around.x + Math.cos(ang) * r - sz / 2), cz = Math.round(around.z + Math.sin(ang) * r - sz / 2);
      if (S.canPlace(team, type, cx, cz)) cands.push({ cx, cz, d: Math.hypot(cx + sz / 2 - c.x - dir * 3, cz + sz / 2 - c.z + dir * 3) + r * 0.3 });
    }
    cands.sort((p, q) => p.d - q.d || p.cx - q.cx || p.cz - q.cz);
    return cands[0] || null;
  }

  const ai = {
    team, diff, state: st,
    think() {
      if (S.time < st.next || S.over) return; st.next = S.time + D.think;
      const hq = S.get(me.hq); if (!hq) return;
      const units = S.units(team), workers = units.filter((u) => u.type === 'worker'), army = units.filter((u) => u.type !== 'worker');
      const blds = S.buildings(team), barracks = blds.filter((b) => b.type === 'barracks'), depots = blds.filter((b) => b.type === 'depot');
      const pop = S.pop(team), cap = S.popCap(team);

      // workers: idle ones mine, spread across the nearest nodes
      const load = new Map();
      for (const w of workers) if (w.order.t === 'gather') load.set(w.order.node, (load.get(w.order.node) || 0) + 1);
      for (const w of workers) if (w.order.t === 'idle') {
        const nodes = S.map.nodes.filter((n) => n.amount > 0).map((n) => ({ n, d: Math.hypot(n.x - hq.x, n.z - hq.z) + (load.get(n.id) || 0) * 3.2 })).sort((a, b) => a.d - b.d);
        if (nodes.length) { S.cmd(team, { t: 'gather', ids: [w.id], node: nodes[0].n.id }); load.set(nodes[0].n.id, (load.get(nodes[0].n.id) || 0) + 1); }
      }
      // unfinished buildings need a builder
      for (const b of blds) if (!b.built && !workers.some((w) => w.order.t === 'build' && w.order.bld === b.id)) {
        const w = workers.filter((q) => q.order.t !== 'build').sort((p, q) => Math.hypot(p.x - b.x, p.z - b.z) - Math.hypot(q.x - b.x, q.z - b.z))[0];
        if (w) S.cmd(team, { t: 'help', ids: [w.id], bld: b.id });
      }
      // economy: keep the Citadel making workers
      if (hq.built && hq.queue.length < 2 && workers.length + hq.queue.length < D.workers) S.train(team, hq.id, 'worker');
      // buildings
      const wantBarracks = barracks.length < (diff === 'hard' ? 2 : 1) || (barracks.length < 2 && army.length >= 7 && me.ore > 350);
      const builderFree = () => workers.filter((w) => w.order.t !== 'build').sort((a, b) => Math.hypot(a.x - hq.x, a.z - hq.z) - Math.hypot(b.x - hq.x, b.z - hq.z))[0];
      if (workers.length >= 4 && wantBarracks && !blds.some((b) => !b.built) && me.ore >= BT.barracks.cost) {
        const site = buildSite('barracks', hq), w = builderFree();
        if (site && w) S.cmd(team, { t: 'build', ids: [w.id], type: 'barracks', cx: site.cx, cz: site.cz });
      } else if (pop + 3 >= cap && depots.length < 6 && !blds.some((b) => !b.built) && me.ore >= BT.depot.cost && barracks.length) {
        const site = buildSite('depot', hq), w = builderFree();
        if (site && w) S.cmd(team, { t: 'build', ids: [w.id], type: 'depot', cx: site.cx, cz: site.cz });
      }
      // army production
      for (const b of barracks) if (b.built && b.queue.length < 2) {
        let type = mix[st.mixIdx % mix.length];
        if (type === 'siege' && army.length < 8) type = 'ranged';
        if (S.train(team, b.id, type)) st.mixIdx++;
        else if (me.ore >= UT.infantry.cost && pop < cap) S.train(team, b.id, 'infantry');
      }
      // defence: enemies near home pull the whole army back
      const intr = S.entsAround(hq.x, hq.z, 13, (e) => e.team === foe && !e.isB && e.type !== 'worker');
      if (intr.length) {
        const t = intr[0];
        for (const u of army) if (u.order.t === 'idle' || (!st.attacking && u.order.t === 'move') || Math.hypot(u.x - hq.x, u.z - hq.z) < 22) S.cmd(team, { t: 'amove', ids: [u.id], x: t.x, z: t.z, form: 'box' });
        return;
      }
      // waves
      const need = Math.max(3, D.wave0 + st.wave * D.waveGrow - Math.floor(Math.max(0, S.time - 420) / 45));   // late game: smaller waves so the match always resolves
      if (!st.attacking) {
        const home = { x: hq.x + (team === 0 ? 5 : -5), z: hq.z + (team === 0 ? -5 : 5) };
        const idle = army.filter((u) => u.order.t === 'idle');
        if (idle.length) S.cmd(team, { t: 'move', ids: idle.filter((u) => Math.hypot(u.x - home.x, u.z - home.z) > 7).map((u) => u.id), x: home.x, z: home.z, form: 'box' });
        if (army.length >= need && S.time >= D.firstWave) { st.attacking = true; st.waveStart = army.length; st.wave++; }
      }
      if (st.attacking) {
        const tgs = S.buildings(foe).sort((a, b) => Math.hypot(a.x - hq.x, a.z - hq.z) - Math.hypot(b.x - hq.x, b.z - hq.z));
        const tgt = tgs.find((b) => b.type === 'hq') || tgs[0], pool = army.filter((u) => u.order.t === 'idle' || u.order.t === 'move');
        if (tgt) {
          const far = pool.filter((u) => Math.hypot(u.x - tgt.x, u.z - tgt.z) > 8);
          if (far.length) S.cmd(team, { t: 'amove', ids: far.map((u) => u.id), x: tgt.x, z: tgt.z, form: 'wedge' });
          for (const u of pool) if (Math.hypot(u.x - tgt.x, u.z - tgt.z) <= 8 && u.order.t === 'idle') S.cmd(team, { t: 'attack', ids: [u.id], target: (S.entsAround(u.x, u.z, 9, (e) => e.team === foe && !e.isB)[0] || tgt).id });
        }
        if (army.length <= Math.max(2, st.waveStart * 0.25)) st.attacking = false;
      }
    },
  };
  S.ai.push(ai);
  return ai;
}
