// ============================ rts/ctrl.js — device-independent player controller ============================
// Selection, control groups, commands, build/train, stances and formations. Desktop mouse, phone touch and the VR
// controllers all call into this one object, so every input scheme drives the same rules.
import { UT, BT, N } from './sim.js?v=rts3';

export function createCtrl({ G, sfx, team = 0 }) {
  const S = new Proxy({}, { get: (_, k) => G.S[k] }), view = new Proxy({}, { get: (_, k) => G.view[k] });   // G.S / G.view change per match
  const C = {
    team, sel: new Set(), groups: Array.from({ length: 10 }, () => []), formation: 'box', stance: 'aggro', amoveArmed: false, buildType: null,
    selMode: 'box', miniMode: 'send', hoverId: 0, toast: null, alert: null, lastGroupKey: -1, lastGroupT: 0, onCenter: null, onToast: null, onEvent: null, rev: 0,
  };
  const touch = () => { C.rev++; };
  const alive = (id) => S.get(id);
  C.say = (text, kind = 'info') => { C.toast = { text, kind, t: performance.now() }; if (C.onToast) C.onToast(text, kind); };
  C.units = () => [...C.sel].map(alive).filter((e) => e && !e.isB && e.team === team);
  C.blds = () => [...C.sel].map(alive).filter((e) => e && e.isB && e.team === team);
  C.prune = () => { let ch = false; for (const id of C.sel) if (!alive(id)) { C.sel.delete(id); ch = true; } if (ch) touch(); };
  C.clear = () => { if (C.sel.size) { C.sel.clear(); touch(); } };
  C.set = (ids, { add = false, quiet = false } = {}) => {
    const ents = ids.map(alive).filter((e) => e && e.team === team);
    const units = ents.filter((e) => !e.isB), pick = units.length ? units : ents.slice(0, 1);
    if (!add) C.sel.clear(); else if (pick.length && pick[0].isB) C.sel.clear();
    for (const e of C.units()) if (add && pick.length && pick[0].isB) C.sel.delete(e.id);
    for (const e of pick) C.sel.add(e.id);
    if (add && pick.length && !pick[0].isB) for (const b of C.blds()) C.sel.delete(b.id);
    touch(); if (pick.length && !quiet) sfx.select();
    const u = C.units(); if (u.length) { const st = new Set(u.map((x) => x.stance)); if (st.size === 1) C.stance = [...st][0]; }
    return pick.length;
  };
  C.toggle = (id) => { if (C.sel.has(id)) { C.sel.delete(id); touch(); } else C.set([id], { add: true }); };
  C.selectRect = (x0, z0, x1, z1, add) => {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), az = Math.min(z0, z1), bz = Math.max(z0, z1);
    return C.set(S.units(team).filter((u) => u.x >= ax && u.x <= bx && u.z >= az && u.z <= bz).map((u) => u.id), { add });
  };
  C.selectPoly = (poly, add) => {
    const inside = (x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
    return C.set(S.units(team).filter((u) => inside(u.x, u.z)).map((u) => u.id), { add });
  };
  C.selectType = (type, inView) => C.set(S.units(team).filter((u) => u.type === type && (!inView || inView(u))).map((u) => u.id));
  C.selectArmy = () => C.set(S.units(team).filter((u) => u.type !== 'worker').map((u) => u.id)) || C.say('No army yet — train some units at a Barracks', 'warn');
  C.selectIdleWorkers = () => C.set(S.units(team).filter((u) => u.type === 'worker' && u.order.t === 'idle').map((u) => u.id)) || C.say('No idle workers', 'info');
  C.selectAllWorkers = () => C.set(S.units(team).filter((u) => u.type === 'worker').map((u) => u.id));
  C.hqPos = () => { const b = alive(S.team[team].hq); return b ? { x: b.x, z: b.z } : S.startPos(team); };

  // control groups: hold-assign / tap-recall (double tap recalls and centres the view)
  C.assignGroup = (i) => { const ids = [...C.sel].filter((id) => alive(id) && !alive(id).isB); C.groups[i] = ids; C.say(`Group ${i} = ${ids.length} unit${ids.length === 1 ? '' : 's'}`); sfx.select(); touch(); };
  C.recallGroup = (i) => {
    const ids = C.groups[i].filter((id) => alive(id)); C.groups[i] = ids;
    if (!ids.length) { C.say(`Group ${i} is empty — select units, then hold the group key to assign`, 'warn'); return; }
    C.set(ids);
    const now = performance.now();
    if (C.lastGroupKey === i && now - C.lastGroupT < 450 && C.onCenter) { let x = 0, z = 0; ids.forEach((id) => { x += alive(id).x; z += alive(id).z; }); C.onCenter(x / ids.length, z / ids.length); }
    C.lastGroupKey = i; C.lastGroupT = now;
  };

  // commands --------------------------------------------------------------------------------------------------
  C.setStance = (v) => { C.stance = v; const ids = C.units().map((u) => u.id); if (ids.length) S.cmd(team, { t: 'stance', ids, v }); touch(); };
  C.setFormation = (f) => { C.formation = f; touch(); };
  C.stop = () => { const ids = C.units().map((u) => u.id); if (ids.length) { S.cmd(team, { t: 'stop', ids }); sfx.move(); } };
  C.armAttackMove = (on = true) => { C.amoveArmed = on; if (on) C.say('Attack-move: choose a spot', 'info'); touch(); };
  C.moveTo = (x, z, amove = false) => {
    const us = C.units(); if (!us.length) return false;
    S.cmd(team, { t: amove ? 'amove' : 'move', ids: us.map((u) => u.id), x, z, form: C.formation });
    view.addMarker(x, z, amove ? 'attack' : 'move'); amove ? sfx.attack() : sfx.move(); return true;
  };
  C.attack = (target) => { const us = C.units(); if (!us.length || !target || target.team === team) return false; S.cmd(team, { t: 'attack', ids: us.map((u) => u.id), target: target.id }); view.addMarker(target.x, target.z, 'attack'); sfx.attack(); return true; };
  C.gather = (node) => {
    const us = C.units(), ws = us.filter((u) => u.type === 'worker');
    if (!ws.length) return false; S.cmd(team, { t: 'gather', ids: ws.map((u) => u.id), node: node.id }); view.addMarker(node.x, node.z, 'gather'); sfx.coin();
    const rest = us.filter((u) => u.type !== 'worker'); if (rest.length) S.cmd(team, { t: 'move', ids: rest.map((u) => u.id), x: node.x, z: node.z, form: C.formation });
    return true;
  };
  // the one place that decides what a click/trigger on something means
  C.commandAt = (pick) => {
    if (!pick) return false;
    const us = C.units(), bs = C.blds();
    if (C.buildType && pick.kind === 'ground') return C.placeAt(pick.x, pick.z);
    if (!us.length) {
      if (bs.length === 1 && (pick.kind === 'ground' || pick.kind === 'node')) { S.cmd(team, pick.kind === 'node' ? { t: 'rally', bld: bs[0].id, node: pick.node.id } : { t: 'rally', bld: bs[0].id, x: pick.x, z: pick.z }); view.addMarker(pick.x, pick.z, 'move'); sfx.move(); C.say('Rally point set'); return true; }
      return false;
    }
    if (pick.kind === 'unit' || pick.kind === 'bld') {
      const e = pick.ent;
      if (e.team !== team) return C.attack(e);
      if (e.isB && !e.built && us.some((u) => u.type === 'worker')) { S.cmd(team, { t: 'help', ids: us.filter((u) => u.type === 'worker').map((u) => u.id), bld: e.id }); sfx.move(); return true; }
      return C.moveTo(e.x, e.z, false);
    }
    if (pick.kind === 'node') return C.gather(pick.node);
    const am = C.amoveArmed; C.amoveArmed = false; touch();
    return C.moveTo(pick.x, pick.z, am);
  };

  // economy ---------------------------------------------------------------------------------------------------
  C.trainFrom = (bld, type) => {
    if (!bld) return false;
    const t = UT[type];
    if (S.team[team].ore < t.cost) { C.say(`Need ${t.cost} ore`, 'warn'); sfx.error(); return false; }
    if (S.pop(team) + t.pop > S.popCap(team)) { C.say('Population full — build a Depot', 'warn'); sfx.error(); return false; }
    const ok = S.cmd(team, { t: 'train', bld: bld.id, type }); if (!ok) { C.say(bld.queue.length >= 5 ? 'Queue is full' : 'Cannot train that here', 'warn'); sfx.error(); return false; } sfx.train(); touch(); return true;
  };
  C.train = (type) => {   // from selected building, or the first suitable one
    const need = UT[type].from, sel = C.blds().filter((b) => b.type === need && b.built);
    const cands = sel.length ? sel : S.buildings(team).filter((b) => b.type === need && b.built);
    if (!cands.length) { C.say(need === 'barracks' ? 'Build a Barracks first (select a worker)' : 'No Citadel', 'warn'); sfx.error(); return false; }
    cands.sort((a, b) => a.queue.length - b.queue.length);
    return C.trainFrom(cands[0], type);
  };
  C.beginBuild = (type) => {
    if (!C.units().some((u) => u.type === 'worker')) { C.say('Select a worker to build', 'warn'); sfx.error(); return false; }
    if (S.team[team].ore < BT[type].cost) { C.say(`Need ${BT[type].cost} ore`, 'warn'); sfx.error(); return false; }
    C.buildType = C.buildType === type ? null : type; touch(); if (C.buildType) C.say(`Place the ${BT[type].name}`); return !!C.buildType;
  };
  C.cancelModes = () => { C.buildType = null; C.amoveArmed = false; touch(); view.setGhost(null); };
  C.siteFor = (x, z) => { const s = BT[C.buildType].size; return { cx: Math.round(x - s / 2), cz: Math.round(z - s / 2) }; };
  C.placeAt = (x, z) => {
    const { cx, cz } = C.siteFor(x, z);
    if (!S.canPlace(team, C.buildType, cx, cz)) { C.say('Cannot build there', 'warn'); sfx.error(); return false; }
    const ws = C.units().filter((u) => u.type === 'worker'); const type = C.buildType;
    S.cmd(team, { t: 'build', ids: ws.map((u) => u.id), type, cx, cz }); C.buildType = null; view.setGhost(null); sfx.built(); touch(); return true;
  };

  // events from the sim (sound + alerts)
  C.handleEvents = (evs) => {
    for (const e of evs) {
      if (e.k === 'alert' && e.team === team) { C.alert = { x: e.x, z: e.z, t: performance.now() }; C.say('Your base is under attack!', 'bad'); sfx.alert(); }
      else if (e.k === 'shot') { e.ranged ? sfx.shot() : sfx.hit(); }
      else if (e.k === 'die') { e.b ? sfx.boom() : sfx.die(); }
      else if (e.k === 'train' && e.team === team) { sfx.train(); C.say(`${UT[e.type].name} ready`); touch(); }
      else if (e.k === 'built' && e.team === team) { sfx.built(); C.say('Building complete'); touch(); }
      else if (e.k === 'drop' && e.team === team) sfx.coin();
      if (C.onEvent) C.onEvent(e);
    }
  };
  return C;
}
