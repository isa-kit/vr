// Headless tests: node rts/test/sim.test.mjs
import { createSim, DT, UT, N, K } from '../sim.js';
import { createAI } from '../ai.js';
import { genMap, createNav } from '../map.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const run = (S, sec, f) => { for (let i = 0; i < sec / DT; i++) { S.step(); S.ev.length = 0; if (f && f(S)) break; } };

// 1. maps: many seeds generate, connected, have fords
let bad = 0, t0 = Date.now();
for (let s = 1; s <= 40; s++) { try { const m = genMap(s), nav = createNav(m); const p = nav.path(m.starts[0].x, m.starts[0].z, m.starts[1].x, m.starts[1].z); if (!p) bad++; } catch (e) { bad++; console.log(e.message); } }
ok(bad === 0, `40 seeds: generated and base-to-base path exists (${Date.now() - t0} ms)`);
{ const m = genMap(7); const k = [0, 0, 0, 0, 0]; m.kind.forEach((v) => k[v]++); console.log('seed7 cells', JSON.stringify(k), 'nodes', m.nodes.length, 'trees', m.trees.length); }

// 2. pathfinding: a group crosses the river via fords, ends spread out, nobody inside obstacles or overlapping
{
  const S = createSim({ seed: 3, mapSeed: 7 }); const hq = S.get(S.team[0].hq);
  const us = []; for (let i = 0; i < 24; i++) us.push(S.spawnUnit(0, i % 3 ? 'infantry' : 'ranged', hq.x + 4 + Math.floor(i / 8) * 0.9, hq.z - 3 + (i % 8) * 0.9));
  const tgt = S.map.starts[1]; const tx = tgt.x - 8, tz = tgt.z + 8;
  S.cmd(0, { t: 'move', ids: us.map((u) => u.id), x: tx, z: tz, form: 'box' });
  let arrived = 0; run(S, 90, () => { arrived = us.filter((u) => Math.hypot(u.x - tx, u.z - tz) < 7).length; return arrived === us.length && us.every((u) => u.order.t === 'idle'); });
  const inBlock = us.filter((u) => S.nav.blockedAt(u.x, u.z)).length;
  let minD = 9; for (const a of us) for (const b of us) if (a !== b) minD = Math.min(minD, Math.hypot(a.x - b.x, a.z - b.z));
  const idle = us.filter((u) => u.order.t === 'idle').length;
  ok(arrived === 24, `24 units reached target zone across the river in ${S.time.toFixed(1)} s (${arrived}/24)`);
  ok(idle === 24, `all units finished their order (stuck-free): ${idle}/24 idle`);
  ok(inBlock === 0, 'no unit inside an obstacle');
  ok(minD > 0.55, `no heavy overlap (closest pair ${minD.toFixed(2)} cells)`);
}
// 3. combat outcomes
{
  const mk = (a, b, na = 5, nb = 5) => { const S = createSim({ seed: 1, noStartBuildings: true }); S.fogOn = false; const bx = S.startPos(0).x + 1, bz = S.startPos(0).z - 4; const A = [], B = []; for (let i = 0; i < na; i++) A.push(S.spawnUnit(0, a, bx + i * 0.9, bz + 3)); for (let i = 0; i < nb; i++) B.push(S.spawnUnit(1, b, bx + i * 0.9, bz - 3)); S.cmd(0, { t: 'amove', ids: A.map((u) => u.id), x: bx + 3, z: bz - 3 }); S.cmd(1, { t: 'amove', ids: B.map((u) => u.id), x: bx + 3, z: bz + 3 }); run(S, 60); return [S.units(0).length, S.units(1).length]; };
  let r = mk('infantry', 'infantry'); ok(r[0] > 0 || r[1] > 0, `even infantry fight resolves (${r})`);
  r = mk('infantry', 'infantry', 8, 4); ok(r[0] > 0 && r[1] === 0, `8 infantry beat 4 (${r})`);
  r = mk('scout', 'ranged', 5, 5); ok(r[0] > 0 && r[1] <= 1, `scouts beat archers (${r})`);
  r = mk('infantry', 'scout', 5, 5); ok(r[0] > 0 && r[1] <= 1, `infantry beat scouts (${r})`);
}
// 4. economy: workers gather and income arrives
{
  const S = createSim({ seed: 2 }); const t = S.team[0]; const o0 = t.ore; S.cmd(0, { t: 'gather', ids: S.units(0).map((u) => u.id), node: S.nearestNode(S.startPos(0).x, S.startPos(0).z).id }); run(S, 90);
  ok(t.mined > 0, `workers mined ${t.mined.toFixed(0)} ore in 90 s (ore ${o0} -> ${t.ore.toFixed(0)})`);
}
// 5. determinism
{
  const go = () => { const S = createSim({ seed: 5 }); createAI(S, 0, 'normal'); createAI(S, 1, 'normal'); run(S, 120); return S.hash(); };
  const a = go(), b = go(); ok(a === b, `deterministic: two 120 s AI-vs-AI runs hash equal (${a})`);
}
// 6. AI vs AI finishes with a winner
for (const diff of ['normal', 'hard']) {
  const S = createSim({ seed: 11 }); createAI(S, 0, diff); createAI(S, 1, diff); const t0 = Date.now(); let ms = 0;
  for (let i = 0; i < 1500 / DT && !S.over; i++) { const a = performance.now(); S.step(); ms = Math.max(ms, performance.now() - a); S.ev.length = 0; }
  ok(S.over && S.winner >= 0, `AI vs AI (${diff}) winner: team ${S.winner} at ${(S.time / 60).toFixed(1)} min; units ${S.units(0).length}/${S.units(1).length}, worst step ${ms.toFixed(1)} ms, wall ${Date.now() - t0} ms`);
}
{ // easy AI loses to a competent player script? at least runs without error
  const S = createSim({ seed: 4 }); createAI(S, 1, 'easy'); run(S, 400); ok(!S.over || S.winner >= 0, 'easy AI alone runs 400 s clean; pop ' + S.pop(1));
}
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
