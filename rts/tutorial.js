// ============================ rts/tutorial.js — a short guided match: select, move, gather, train, mini map, attack, destroy ============================
// Runs on a small sandbox sim (your base, a ready Barracks, one red outpost). Each step watches real commands/events, so it
// completes when you actually do the thing. Text adapts to the device (desktop, phone, VR). A Skip button prevents soft-locks.
import { BT } from './sim.js?v=rts4';

export function createTutorial({ G, C, hud, getVR, isTouch, isXR, showScreen, newMatch, showTitle }) {
  const TU = { on: false, step: 0, steps: [], flags: {}, doneAt: 0 };
  const how = (d, t, v) => (isXR() ? v : isTouch ? t : d);

  TU.steps = [
    { id: 'select', title: 'Step 1 · Select', text: () => how('Drag a box around your four workers (or click one).', 'Drag a box around your workers.', 'Point at a worker and pull the trigger, or hold grip and sweep your hand over them.'), done: () => C.units().filter((u) => u.type === 'worker').length >= 2 },
    { id: 'move', title: 'Step 2 · Move', text: () => how('Right-click the ground: they walk there. A ring marks the waypoint.', 'Tap the ground: they walk there.', 'Point at the ground and pull the trigger. A ring and a path line show where they go.'), done: () => TU.flags.move },
    { id: 'gather', title: 'Step 3 · Gather', text: () => how('Right-click a blue crystal: workers mine it and carry ore to the Citadel.', 'Tap a blue crystal with workers selected.', 'Point at a blue crystal and pull the trigger. Workers mine it and carry ore home.'), done: () => TU.flags.drop },
    { id: 'train', title: 'Step 4 · Train', text: () => how('Click the Barracks, then press Infantry or Archer in the card below.', 'Tap the Barracks, then Infantry or Archer.', 'Trigger the Barracks, then Orders ▸ on your left-hand map: Train.'), done: () => TU.flags.trained },
    { id: 'mini', title: 'Step 5 · Mini map', text: () => how('Select units, then right-click on the mini map (bottom left) to send them there.', 'Select units, then tap the mini map to look there (or use Send).', 'Point your other controller at the map above your left controller and pull the trigger: it sends selected units there. Drag on it to box-select.'), done: () => (C.miniUsed || 0) > 0 },
    { id: 'attack', title: 'Step 6 · Attack', text: () => how('Select your soldiers (Army button), then right-click a red unit near the red barracks.', 'Select soldiers, then tap a red unit.', 'Select your soldiers, then point at a red unit and pull the trigger.'), done: () => TU.flags.kill },
    { id: 'destroy', title: 'Step 7 · Destroy', text: () => 'Destroy the red Barracks. Catapults are best against buildings. Keep training units!', done: () => G.S.buildings(1).length === 0 },
  ];

  TU.start = () => {
    const S = G.S; TU.on = true; TU.step = 0; TU.flags = {}; C.miniUsed = 0;
    const hq = S.get(S.team[0].hq);
    const site = (type, cx0, cz0, team) => { for (let r = 0; r < 14; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; if (S.canPlace(team, type, cx0 + dx, cz0 + dz)) return { cx: cx0 + dx, cz: cz0 + dz }; } return null; };
    const bs = site('barracks', hq.cx + 6, hq.cz - 1, 0); if (bs) S.spawnBuilding(0, 'barracks', bs.cx, bs.cz, true);
    const os = site('barracks', 33, 22, 1);
    if (os) { const ob = S.spawnBuilding(1, 'barracks', os.cx, os.cz, true); TU.outpost = ob; [['infantry', -2, 3.5], ['infantry', 0, 4], ['ranged', 2, 3.5]].forEach(([t, dx, dz]) => { const u = S.spawnUnit(1, t, ob.x + dx, ob.z + dz); u.stance = 'defend'; }); }
    S.team[0].ore = 420;
    // the sandbox shows the whole outpost region so the player can find it
    for (let dz = -9; dz <= 9; dz++) for (let dx = -9; dx <= 9; dx++) { const i = Math.floor(33 + dx), j = Math.floor(22 + dz); if (i >= 0 && j >= 0 && i < 56 && j < 56 && S.vis[0][j * 56 + i] === 0) S.vis[0][j * 56 + i] = 1; }
    const orig = S.cmd.bind(S);
    S.cmd = (team, c) => {
      if (team === 0 && TU.on) {
        if ((c.t === 'move' || c.t === 'amove') && (c.ids || []).length) TU.flags.move = true;
        if (c.t === 'attack') TU.flags.attacked = true;
      }
      return orig(team, c);
    };
    C.onEvent = (e) => {
      if (!TU.on) return;
      if (e.k === 'drop' && e.team === 0) TU.flags.drop = true;
      if (e.k === 'train' && e.team === 0 && e.type !== 'worker') TU.flags.trained = true;
      if (e.k === 'die' && e.team === 1 && !e.b) TU.flags.kill = true;
    };
    TU.show();
  };
  TU.show = () => { const st = TU.steps[TU.step]; if (!st) return; hud.objective(st.title, st.text()); const vr = getVR && getVR(); if (vr) vr.objective(st.title, st.text()); };
  TU.skip = () => { if (TU.on) { TU.advance(true); } };
  TU.advance = () => {
    TU.step++; C.say('Nice — step complete', 'info');
    if (TU.step >= TU.steps.length) { TU.finish(); return; }
    TU.show();
  };
  TU.finish = () => {
    TU.on = false; hud.objective(null); { const vr = getVR && getVR(); if (vr) vr.objective(null); }
    showScreen({ title: 'Tutorial complete', lines: ['You can select, command, gather, train, use the mini map and fight. Now play a real match against the AI.'], buttons: [{ text: 'Play a match', big: true, action: () => newMatch({}) }, { text: 'Replay tutorial', action: () => newMatch({ tutorial: true }) }, { text: 'Main menu', action: () => { newMatch({ idle: true }); showTitle(); } }] });
  };
  TU.stop = () => { TU.on = false; hud.objective(null); const vr = getVR && getVR(); if (vr) vr.objective(null); C.onEvent = null; };
  let last = 0;
  TU.update = (dt) => {
    if (!TU.on || G.phase !== 'play') return;
    const now = performance.now(); if (now - last < 250) return; last = now;
    const st = TU.steps[TU.step]; if (st && st.done()) TU.advance();
    else if (st) { const t = st.text(); if (t !== TU.last) { TU.last = t; TU.show(); } }
  };
  return TU;
}
