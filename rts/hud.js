// ============================ rts/hud.js — DOM heads-up display for desktop and phone (hidden while in VR) ============================
import { UT, BT } from './sim.js?v=rts4';

const CSS = `
#rts-hud{position:fixed;inset:0;pointer-events:none;z-index:8;font:600 13px/1.25 system-ui,sans-serif;color:#eaf2ff;-webkit-user-select:none;user-select:none}
#rts-hud *{box-sizing:border-box}
#rts-hud .pill{pointer-events:auto;background:rgba(10,16,28,.74);border:1px solid rgba(160,190,255,.25);border-radius:10px;backdrop-filter:blur(6px)}
#rts-top{position:absolute;top:calc(env(safe-area-inset-top,0px) + 8px);left:calc(env(safe-area-inset-left,0px) + 8px);display:flex;gap:6px;max-width:calc(100vw - 118px);flex-wrap:wrap}
#rts-top .pill{padding:7px 10px;white-space:nowrap}
#rts-top b{color:#7fe8ff}
#rts-top .warn{color:#ffd24a}
#rts-toast{position:absolute;top:calc(env(safe-area-inset-top,0px) + 92px);left:50%;transform:translateX(-50%);padding:8px 14px;border-radius:999px;background:rgba(10,16,28,.82);opacity:0;transition:opacity .25s;max-width:92vw;text-align:center}
#rts-toast.bad{background:rgba(120,20,16,.88)} #rts-toast.warn{background:rgba(110,80,10,.88)}
#rts-obj{position:absolute;top:calc(env(safe-area-inset-top,0px) + 50px);left:calc(env(safe-area-inset-left,0px) + 8px);max-width:min(420px,calc(100vw - 118px));padding:8px 12px;display:none}
#rts-skip{margin-top:6px;font:600 11px system-ui,sans-serif;color:#cfe0ff;background:rgba(40,60,100,.8);border:1px solid rgba(160,190,255,.3);border-radius:7px;padding:4px 8px;cursor:pointer}
#rts-obj h4{margin:0 0 3px;font-size:12px;color:#7fe8ff;letter-spacing:.06em;text-transform:uppercase} #rts-obj p{margin:0;font-weight:500}
#rts-dock{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:flex-end;gap:8px;padding:8px calc(env(safe-area-inset-right,0px) + 8px) calc(env(safe-area-inset-bottom,0px) + 8px) calc(env(safe-area-inset-left,0px) + 8px)}
#rts-mini{pointer-events:auto;width:172px;height:172px;border-radius:8px;border:2px solid rgba(160,190,255,.45);background:#0a0e14;touch-action:none;flex:none}
#rts-minibtn{pointer-events:auto;position:absolute;left:calc(env(safe-area-inset-left,0px) + 12px);padding:5px 9px;font-size:11px;border-radius:7px;border:1px solid rgba(160,190,255,.35);background:rgba(10,16,28,.8);color:#cfe0ff}
#rts-card{pointer-events:auto;flex:1;min-width:0;padding:8px;display:flex;flex-direction:column;gap:6px;max-height:172px;overflow:auto}
#rts-card .sum{font-size:13px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#rts-card .row{display:flex;gap:5px;flex-wrap:wrap}
#rts-card button,#rts-screen button{font:600 12px system-ui,sans-serif;color:#eaf2ff;background:rgba(40,60,100,.8);border:1px solid rgba(160,190,255,.3);border-radius:8px;padding:7px 10px;min-height:34px;cursor:pointer}
#rts-card button:hover,#rts-screen button:hover{background:rgba(70,100,170,.9)}
#rts-card button.on{background:#2b78d6;border-color:#9cc8ff} #rts-card button:disabled{opacity:.4}
#rts-card button small{display:block;font-weight:500;opacity:.8;font-size:10px}
#rts-card .bar{height:5px;background:rgba(255,255,255,.15);border-radius:3px;overflow:hidden;min-width:60px;flex:1} #rts-card .bar i{display:block;height:100%;background:#7fe8ff}
#rts-card .hint{opacity:.75;font-weight:500}
#rts-box{position:fixed;border:1.5px solid #b4ffc4;background:rgba(160,255,190,.14);pointer-events:none;display:none;z-index:9}
#rts-screen{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(5,8,16,.62);pointer-events:auto}
#rts-screen .box{width:min(560px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:18px;background:rgba(14,20,36,.96);border:1px solid rgba(160,190,255,.3);border-radius:16px}
#rts-screen h1{margin:0 0 4px;font-size:24px} #rts-screen p{margin:6px 0;font-weight:500;opacity:.9} #rts-screen .row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
#rts-screen button.big{font-size:15px;padding:12px 16px;min-height:46px} #rts-screen button.on{background:#2b78d6}
#rts-screen ul{margin:6px 0 6px 18px;padding:0;font-weight:500;opacity:.9} #rts-screen li{margin:3px 0}
@media (pointer:coarse),(max-width:520px){
  #rts-obj{top:calc(env(safe-area-inset-top,0px) + 92px)} #rts-toast{top:calc(env(safe-area-inset-top,0px) + 150px)}
  #rts-mini{width:112px;height:112px} #rts-card{max-height:150px} #rts-card button{min-height:40px;padding:6px 8px}
  #rts-top .pill{padding:6px 8px;font-size:12px} #rts-card .sum{font-size:12px}
}
body.rts-vr #rts-hud{display:none}
`;

export function createHud({ S: S0, C, mini, getS, onAction, touchDevice }) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const root = document.createElement('div'); root.id = 'rts-hud';
  root.innerHTML = `<div id="rts-top"></div><div id="rts-toast"></div><div id="rts-obj" class="pill"></div>
    <div id="rts-dock"><canvas id="rts-mini" width="344" height="344"></canvas><div id="rts-card" class="pill"></div></div><div id="rts-screen"></div>`;
  document.body.appendChild(root);
  const boxEl = document.createElement('div'); boxEl.id = 'rts-box'; document.body.appendChild(boxEl);
  const $ = (s) => root.querySelector(s), top = $('#rts-top'), toast = $('#rts-toast'), obj = $('#rts-obj'), card = $('#rts-card'), screen = $('#rts-screen'), miniC = $('#rts-mini');
  const mctx = miniC.getContext('2d');
  let toastT = 0, lastRev = -1, lastCard = 0, lastTop = '';
  const H = { miniCanvas: miniC, root };

  H.showBox = (x0, y0, x1, y1) => { if (x0 == null) { boxEl.style.display = 'none'; return; } Object.assign(boxEl.style, { display: 'block', left: Math.min(x0, x1) + 'px', top: Math.min(y0, y1) + 'px', width: Math.abs(x1 - x0) + 'px', height: Math.abs(y1 - y0) + 'px' }); };
  H.toast = (text, kind = 'info') => { toast.textContent = text; toast.className = kind; toast.style.opacity = 1; toastT = performance.now() + 2600; };
  H.objective = (title, text) => { if (!title) { obj.style.display = 'none'; return; } obj.style.display = 'block'; obj.innerHTML = `<h4>${title}</h4><p>${text}</p><button id="rts-skip">Skip step ▸</button>`; obj.querySelector('#rts-skip').addEventListener('click', () => onAction('skipStep')); };
  H.setVR = (on) => { document.body.classList.toggle('rts-vr', on); };
  H.screen = (spec) => {
    if (!spec) { screen.style.display = 'none'; screen.innerHTML = ''; return; }
    screen.innerHTML = `<div class="box"><h1>${spec.title}</h1>${(spec.lines || []).map((l) => `<p>${l}</p>`).join('')}${spec.html || ''}<div class="row">${(spec.buttons || []).map((b, i) => `<button class="${b.big ? 'big ' : ''}${b.on ? 'on' : ''}" data-i="${i}">${b.text}</button>`).join('')}</div>${spec.foot ? `<p style="opacity:.6;font-size:12px">${spec.foot}</p>` : ''}</div>`;
    screen.style.display = 'flex';
    screen.querySelectorAll('button').forEach((el) => el.addEventListener('click', () => { const b = spec.buttons[+el.dataset.i]; if (b.action) b.action(); if (b.keep !== true && b.action && !b.stay) { /* action decides */ } }));
  };

  function btn(text, sub, fn, { on = false, disabled = false } = {}) {
    const b = document.createElement('button'); b.innerHTML = text + (sub ? `<small>${sub}</small>` : ''); if (on) b.className = 'on'; b.disabled = disabled;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); card_dirty(); }); return b;
  }
  const card_dirty = () => { lastRev = -1; };
  const S = () => getS();
  function drawCard() {
    const s = S(), us = C.units(), bs = C.blds(), t = C.team, ore = s.team[t].ore;
    card.innerHTML = '';
    const row = () => { const r = document.createElement('div'); r.className = 'row'; card.appendChild(r); return r; };
    if (bs.length === 1 && !us.length) {
      const b = bs[0], sum = document.createElement('div'); sum.className = 'sum'; sum.innerHTML = `<b>${BT[b.type].name}</b> ${b.built ? `· ${Math.ceil(b.hp)}/${b.maxhp} hp` : `· building ${Math.round(b.progress * 100)}%`}`; card.appendChild(sum);
      if (b.built) {
        const r = row();
        for (const [type, d] of Object.entries(UT)) if (d.from === b.type) r.appendChild(btn(d.name, `${d.cost} ore`, () => C.trainFrom(b, type), { disabled: ore < d.cost }));
        if (b.queue.length) { const q = document.createElement('div'); q.className = 'sum'; q.innerHTML = b.queue.map((x, i) => `<span>${i === 0 ? '▶ ' : ''}${UT[x.type].name}</span>`).join(' · ') + `<div class="bar"><i style="width:${Math.round((b.queue[0].t / UT[b.queue[0].type].time) * 100)}%"></i></div>`; card.appendChild(q); }
        const h = document.createElement('div'); h.className = 'hint'; h.textContent = touchDevice ? 'Tap the ground to set the rally point' : 'Right-click ground or crystals to set the rally point'; card.appendChild(h);
      }
      return;
    }
    if (us.length) {
      const counts = {}; us.forEach((u) => { counts[u.type] = (counts[u.type] || 0) + 1; });
      const sum = document.createElement('div'); sum.className = 'sum'; sum.innerHTML = Object.entries(counts).map(([k, v]) => `<b>${v}</b> ${UT[k].name}`).join(' · '); card.appendChild(sum);
      const r1 = row();
      r1.appendChild(btn('Stop', 'C', () => C.stop()));
      r1.appendChild(btn('Attack-move', 'X', () => C.armAttackMove(!C.amoveArmed), { on: C.amoveArmed }));
      for (const [id, nm] of [['aggro', 'Aggressive'], ['defend', 'Guard'], ['hold', 'Hold']]) r1.appendChild(btn(nm, '', () => C.setStance(id), { on: C.stance === id }));
      const r2 = row();
      r2.appendChild(btn(C.miniMode === 'send' ? 'Map: send' : 'Map: look', '', () => { C.miniMode = C.miniMode === 'send' ? 'view' : 'send'; }));
      for (const [id, nm] of [['box', 'Box'], ['line', 'Line'], ['wedge', 'Wedge']]) r2.appendChild(btn(nm, '', () => C.setFormation(id), { on: C.formation === id }));
      if (us.some((u) => u.type === 'worker')) for (const type of ['depot', 'barracks']) r2.appendChild(btn('Build ' + BT[type].name, `${BT[type].cost} ore`, () => C.beginBuild(type), { on: C.buildType === type, disabled: ore < BT[type].cost }));
      return;
    }
    const r = row();
    r.appendChild(btn('Army', '.', () => C.selectArmy())); r.appendChild(btn('Idle workers', ',', () => C.selectIdleWorkers())); r.appendChild(btn('Workers', '', () => C.selectAllWorkers()));
    const hq = S().get(s.team[t].hq); if (hq) r.appendChild(btn('Citadel', 'Home', () => C.set([hq.id])));
    const h = document.createElement('div'); h.className = 'hint'; h.textContent = touchDevice ? 'Drag to select · tap to command · two fingers pan & zoom · tap the map to jump' : 'Drag to box-select · right-click to move / attack / gather · WASD pan · wheel zoom · Q/E rotate · X attack-move'; card.appendChild(h);
  }

  H.update = (o) => {
    const s = S(), t = C.team, now = performance.now();
    if (now > toastT) toast.style.opacity = 0;
    const pop = s.pop(t), cap = s.popCap(t), min = Math.floor(s.time / 60), sec = String(Math.floor(s.time % 60)).padStart(2, '0');
    const topHtml = `<div class="pill"><b>◆ ${Math.floor(s.team[t].ore)}</b> ore</div><div class="pill ${pop >= cap ? 'warn' : ''}">Pop <b>${pop}/${cap}</b></div><div class="pill">${min}:${sec}</div>${o.paused ? '<div class="pill warn">Paused</div>' : ''}<div class="pill" data-act="pause" style="cursor:pointer">${o.paused ? '▶ Resume' : '❚❚ Pause'}</div>`;
    if (topHtml !== lastTop) { top.innerHTML = topHtml; lastTop = topHtml; top.querySelector('[data-act=pause]').addEventListener('click', () => onAction('pause')); }
    if (C.rev !== lastRev || now - lastCard > 400) { if (!card.matches(':active')) { drawCard(); lastRev = C.rev; lastCard = now; } }
    const sz = miniC.clientWidth || 172, px = Math.round(sz * Math.min(2, devicePixelRatio || 1));
    if (miniC.width !== px) { miniC.width = miniC.height = px; }
    mini.draw(mctx, 0, 0, px, px, { rot: 0, team: t, selected: C.sel, viewPoly: o.viewPoly, alertAt: C.alert && now - C.alert.t < 6000 ? C.alert : null });
  };
  return H;
}
