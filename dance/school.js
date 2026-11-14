// ============================ dance/school.js — the partner-dance school ============================
// Style → Pattern → lesson steps: Watch · Footwork · Hands · Practice · Dance · Chain.
// Patterns are JSON files in ./patterns (see PATTERNS.md); couple.js turns them into two moving bodies.
// Only head + two hands are tracked, so scoring covers timing, hand path / connection, and body travel / turn. Footwork is taught, not scored.
import { createFigure } from './figure.js?v=20261117c';
import * as CP from './couple.js?v=20261117c';
import * as G from './game.js?v=20261117c';

const STEPS = [['watch', 'Watch'], ['foot', 'Footwork'], ['hands', 'Hands'], ['practice', 'Practice'], ['dance', 'Dance'], ['chain', 'Chain']];
const STEP_HELP = {
  watch: 'Watch the couple dance the pattern. Orbit or pick Front / Side / Top.',
  foot: 'Footprints for your role light up on each count: solid = weight change, faint = touch. Footwork is taught here but is not scored.',
  hands: 'Gold lines are the hand path; the glowing ball is the connection point. Arrows show the lead direction.',
  practice: 'Dance with a virtual partner, looped, at 50 / 75 / 100 %. Scored: timing, hand path / connection, body travel and turn. Footwork is not scored.',
  dance: 'Dance the pattern to music, four times through. Scored on timing, hands and body travel. Footwork is not scored.',
  chain: 'A short social-dance sequence: the style\'s patterns chained together. Scored like Practice. Footwork is not scored.',
};
const COL = { lead: 0x3fd8ff, follow: 0xff6fb0 };
const SPEAK = { '&': 'and', S: 'slow', Q: 'quick', '4-1': 'four one' };

export function createSchool(env) {
  const { THREE, scene, camera, dolly, music, ui, stage } = env;
  const H = { active: false, styles: null, styleId: null, pattern: null, pageNo: 0, step: 'watch', role: 'lead', tempo: 1, view: 'front', spoken: true, clickOnly: false, playing: false, paused: false,
    pausedByMenu: false, C: null, xf: { rot: 0, ox: 0, oz: -1.6 }, base: null, swap: false, events: null, scorer: null, sampler: null, lastCount: -1, lastK: 0, chainList: [], runs: 0, hit: [false, false], total: 4, results: null, hudPop: { t: -9 } };
  const cache = {};
  const V = new THREE.Vector3(), V2 = new THREE.Vector3();

  // ---------- data ----------
  async function loadIndex() { if (!H.styles) { const r = await fetch(new URL('./patterns/index.json?v=20261117c', import.meta.url)); H.styles = (await r.json()).styles; } return H.styles; }
  async function loadPattern(id) { if (!cache[id]) { const r = await fetch(new URL('./patterns/' + id + '.json?v=20261117c', import.meta.url)); cache[id] = await r.json(); } return cache[id]; }

  // ---------- scene objects ----------
  const root = new THREE.Group(); root.visible = false; scene.add(root);
  const slot = new THREE.Group(); root.add(slot);                       // pattern-frame group (floor marks, footprints, trails): world = R(rot)·(x, −y) + o
  const mkFig = (role, basic) => createFigure(THREE, { tintL: COL[role], tintR: COL[role], basic, jacket: role === 'lead' ? 0x5a3fd6 : 0xd9546e, pants: role === 'lead' ? 0x232a4d : 0x1f4a52 });
  const figs = { lead: mkFig('lead', false), follow: mkFig('follow', false) }, mfigs = { lead: mkFig('lead', true), follow: mkFig('follow', true) };
  for (const r of ['lead', 'follow']) { root.add(figs[r].root); stage.mirror.add(mfigs[r].root); mfigs[r].root.visible = false; }
  const fp = { params: { lead: {}, follow: {} } };
  const marks = new THREE.Group(); slot.add(marks);
  const trails = new THREE.Group(); slot.add(trails);
  const prints = new THREE.Group(); slot.add(prints);
  const cuePoint = new THREE.Group(); root.add(cuePoint);
  const orb = (c, r) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false })); return m; };
  const joinOrbs = [orb(0xffd24a, 0.05), orb(0xffd24a, 0.05)]; joinOrbs.forEach((o) => { o.visible = false; root.add(o); });
  const cueArrows = [0, 1].map(() => { const c = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 12), new THREE.MeshBasicMaterial({ color: 0xffe9a0, toneMapped: false })); c.visible = false; root.add(c); return c; });
  const ghostHands = [orb(0xffffff, 0.06), orb(0xffffff, 0.06)]; ghostHands.forEach((o) => { o.visible = false; root.add(o); });
  const bodyMark = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.18, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, toneMapped: false, depthWrite: false })); bodyMark.visible = false; root.add(bodyMark);

  // floor markings: slot / line / box in the pattern frame
  function drawFloor() {
    marks.clear(); const f = H.pattern.floor || { kind: 'slot', x0: -1.5, x1: 1.5, width: 0.9 };
    const mat = new THREE.LineBasicMaterial({ color: 0x66d8ff, transparent: true, opacity: 0.85 });
    const rect = (x0, x1, w) => { const g = new THREE.BufferGeometry().setFromPoints([[x0, w], [x1, w], [x1, -w], [x0, -w], [x0, w]].map(([x, y]) => new THREE.Vector3(x, 0.014, -y))); return new THREE.Line(g, mat); };
    marks.add(rect(f.x0, f.x1, f.width / 2));
    const c = new THREE.Mesh(new THREE.PlaneGeometry(f.x1 - f.x0, 0.01).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x66d8ff, transparent: true, opacity: 0.35, toneMapped: false })); c.position.y = 0.012; marks.add(c);
    const fillM = new THREE.Mesh(new THREE.PlaneGeometry(f.x1 - f.x0, f.width).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2a6cff, transparent: true, opacity: 0.12, toneMapped: false, depthWrite: false })); fillM.position.y = 0.01; marks.add(fillM);
    for (let x = f.x0 + 0.3; x < f.x1 - 0.2; x += 0.6) { const a = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 3).rotateX(Math.PI / 2).rotateY(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x66d8ff, transparent: true, opacity: 0.4, toneMapped: false })); a.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); a.position.set(x, 0.013, 0); marks.add(a); }
  }
  // footprints
  const labelTex = {};
  function labelSprite(txt, color) {
    const key = txt + color; if (!labelTex[key]) { const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d'); x.font = '800 62px system-ui,sans-serif'; x.textAlign = 'center'; x.lineWidth = 9; x.strokeStyle = 'rgba(0,0,0,.6)'; x.strokeText(txt, 48, 66); x.fillStyle = '#' + color.toString(16).padStart(6, '0'); x.fillText(txt, 48, 66); labelTex[key] = new THREE.CanvasTexture(c); labelTex[key].colorSpace = THREE.SRGBColorSpace; }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex[key], transparent: true, depthTest: false, toneMapped: false })); s.scale.set(0.16, 0.16, 1); s.renderOrder = 30; return s;
  }
  const footShape = (() => { const s = new THREE.Shape(); s.moveTo(0, -0.12); s.bezierCurveTo(0.06, -0.12, 0.065, -0.02, 0.055, 0.04); s.bezierCurveTo(0.05, 0.1, 0.03, 0.14, 0, 0.14); s.bezierCurveTo(-0.04, 0.14, -0.05, 0.08, -0.045, 0.03); s.bezierCurveTo(-0.04, -0.06, -0.05, -0.12, 0, -0.12); return new THREE.ShapeGeometry(s).rotateX(Math.PI / 2); })();
  let printObjs = [];
  function buildPrints() {
    prints.clear(); printObjs = []; const P = H.pattern; if (!P) return;
    for (const role of ['lead', 'follow']) {
      const mine = role === H.role, col = COL[role]; let prevByFoot = {};
      const st0 = P.start[role], th0 = (st0.facing || 0) * Math.PI / 180, lx = -Math.sin(th0), ly = Math.cos(th0);
      prevByFoot = { R: [st0.x - lx * 0.1, st0.y - ly * 0.1], L: [st0.x + lx * 0.1, st0.y + ly * 0.1] };
      for (const s of P.steps[role]) {
        const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.2, toneMapped: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
        const m = new THREE.Mesh(footGeoFor(s.foot), mat); m.renderOrder = 25; m.scale.setScalar(1.25); g.add(m);
        g.position.set(s.x, 0.02, -s.y); g.rotation.y = Math.PI / 2 + (s.facing || 0) * Math.PI / 180;
        prints.add(g);
        const sprite = labelSprite(s.label || '', col); sprite.position.set(s.x, 0.28, -s.y); prints.add(sprite);
        // arrow from the previous spot of this foot
        const pv = prevByFoot[s.foot]; const dx = s.x - pv[0], dy = s.y - pv[1], len = Math.hypot(dx, dy);
        let line = null, cone = null;
        if (len > 0.04) {
          line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(pv[0], 0.022, -pv[1]), new THREE.Vector3(s.x, 0.022, -s.y)]), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.35, depthTest: false }));
          cone = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 10), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, toneMapped: false }));
          cone.position.set(s.x - dx / len * 0.1, 0.03, -(s.y - dy / len * 0.1)); cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, 0, -dy).normalize());
          prints.add(line, cone);
        }
        prevByFoot[s.foot] = [s.x, s.y];
        printObjs.push({ t: s.beat, role, mine, mat, g, sprite, line, cone, weight: s.weight !== false });
      }
    }
  }
  const footGeoCache = {}; function footGeoFor(foot) { if (!footGeoCache[foot]) { const g = footShape.clone(); if (foot === 'L') g.scale(-1, 1, 1); footGeoCache[foot] = g; } return footGeoCache[foot]; }
  function buildTrails() {
    trails.clear(); const C = H.CP1; if (!C) return;
    for (const h of C.holds) {
      if (h.kind !== 'join') continue;
      const pts = []; for (let b = h.from; b <= h.to + 1e-6; b += 0.1) { const S = CP.sampleCouple(C, b, {}); const hand = S.lead.hand[CP.FOOT_I[h.lead]]; pts.push(new THREE.Vector3(hand[0], hand[2], -hand[1])); }
      if (pts.length > 1) { trails.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.8 }))); const a = orb(0x66ff99, 0.03); a.position.copy(pts[0]); const z = orb(0xff7a8a, 0.03); z.position.copy(pts[pts.length - 1]); trails.add(a, z); }
    }
  }


  // ---------- in-world lesson HUD (VR) ----------
  const hc = document.createElement('canvas'); hc.width = 1024; hc.height = 300; const hx = hc.getContext('2d');
  const htex = new THREE.CanvasTexture(hc); htex.colorSpace = THREE.SRGBColorSpace;
  const hudMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.44), new THREE.MeshBasicMaterial({ map: htex, transparent: true, toneMapped: false, depthWrite: false }));
  hudMesh.position.set(0, 2.15, -2.0); hudMesh.renderOrder = 30; hudMesh.visible = false; scene.add(hudMesh);
  let hudKey = '';
  function wrapText(t, w) { const out = []; let line = ''; for (const wd of t.split(' ')) { const x = line ? line + ' ' + wd : wd; if (hx.measureText(x).width > w && line) { out.push(line); line = wd; } else line = x; } if (line) out.push(line); return out; }
  function drawHud(d) {
    const key = JSON.stringify(d); if (key === hudKey) return; hudKey = key;
    hx.clearRect(0, 0, 1024, 300); hx.fillStyle = 'rgba(10,12,32,0.78)'; hx.beginPath(); hx.roundRect(4, 4, 1016, 292, 36); hx.fill(); hx.strokeStyle = 'rgba(150,180,255,.5)'; hx.lineWidth = 3; hx.stroke();
    hx.textAlign = 'center'; hx.font = '800 130px system-ui,sans-serif'; hx.fillStyle = '#ffd24a'; hx.fillText(d.label, 150, 175);
    hx.textAlign = 'left'; hx.font = '700 42px system-ui,sans-serif'; hx.fillStyle = '#fff'; hx.fillText(d.title, 300, 70);
    hx.font = '500 30px system-ui,sans-serif'; hx.fillStyle = 'rgba(200,215,255,.85)'; wrapText(d.tip || '', 690).slice(0, 3).forEach((l, i) => hx.fillText(l, 300, 118 + i * 38));
    hx.font = '600 26px system-ui,sans-serif'; hx.fillStyle = d.draft ? '#ffd890' : 'rgba(200,215,255,.7)'; hx.fillText((d.draft ? 'Draft choreography · ' : '') + d.foot, 300, 270);
    if (d.score !== undefined) { hx.textAlign = 'right'; hx.font = '800 54px system-ui,sans-serif'; hx.fillStyle = '#fff'; hx.fillText(String(d.score), 1000, 270); }
    if (d.pop) { hx.textAlign = 'right'; hx.font = '800 48px system-ui,sans-serif'; hx.fillStyle = d.popColor; hx.fillText(d.pop, 1000, 70); }
    htex.needsUpdate = true;
  }

  // ---------- lesson DOM bar (desktop / phone) ----------
  const css = document.createElement('style');
  css.textContent = `#lsn{position:fixed;left:0;right:0;bottom:0;z-index:15;display:none;font:500 14px/1.35 system-ui,sans-serif;color:#eef1ff;padding:8px 10px max(8px,env(safe-area-inset-bottom));background:linear-gradient(0deg,rgba(6,8,22,.92),rgba(6,8,22,.55) 80%,transparent);pointer-events:none}
  #lsn>*{pointer-events:auto}#lsn .top{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}#lsn .ttl{font-size:17px;font-weight:750}#lsn .draft{font-size:11px;padding:2px 8px;border-radius:99px;background:rgba(255,190,70,.18);color:#ffd890;border:1px solid rgba(255,190,70,.4)}
  #lsn .cnt{font-size:34px;font-weight:800;min-width:2.2em;text-align:center;color:#ffd24a;text-shadow:0 0 14px rgba(255,210,74,.5)}#lsn .tip{flex:1;min-width:180px;opacity:.95}
  #lsn .row{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center}#lsn button{min-height:38px;padding:6px 12px;border-radius:99px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.1);color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer}
  #lsn button.on{background:linear-gradient(90deg,#3a7bff,#b44cff);border-color:transparent}#lsn button[disabled]{opacity:.4}#lsn .sep{width:1px;height:22px;background:rgba(255,255,255,.2)}#lsn .help{font-size:12.5px;opacity:.75;margin-top:4px}
  @media (max-width:520px){#lsn .row{flex-wrap:nowrap;overflow-x:auto}#lsn button{flex:none}#lsn .cnt{font-size:28px}}`;
  document.head.appendChild(css);
  const bar = document.createElement('div'); bar.id = 'lsn'; document.body.appendChild(bar);
  const btn = (id, label, on, dis) => `<button data-a="${id}" class="${on ? 'on' : ''}"${dis ? ' disabled' : ''}>${label}</button>`;
  function renderBar() {
    if (!H.active || !H.pattern || env.isXR()) { bar.style.display = 'none'; return; }
    const xr = false, P = H.pattern, vrOnly = (s) => ['practice', 'dance', 'chain'].includes(s);
    bar.style.display = 'block';
    bar.innerHTML = `<div class="top"><span class="ttl">${P.name}</span>${P.reviewed ? '' : '<span class="draft">Draft choreography · not yet reviewed</span>'}<span class="cnt" id="lcnt">–</span><span class="tip" id="ltip"></span></div>
      <div class="row">${STEPS.map(([id, nm]) => btn('step:' + id, nm + (vrOnly(id) ? ' · VR' : ''), H.step === id, vrOnly(id) && !env.isXR())).join('')}</div>
      <div class="row">${btn('role:lead', 'Lead', H.role === 'lead')}${btn('role:follow', 'Follow', H.role === 'follow')}<span class="sep"></span>${[0.5, 0.75, 1].map((t) => btn('tempo:' + t, t * 100 + '%', H.tempo === t)).join('')}<span class="sep"></span>
        ${['front', 'side', 'top', 'orbit'].map((v) => btn('view:' + v, v[0].toUpperCase() + v.slice(1), H.view === v)).join('')}<span class="sep"></span>
        ${btn('play', H.paused ? '▶ Play' : '❚❚ Pause', false)}${btn('spoken', 'Say counts', H.spoken)}${btn('click', 'Metronome only', H.clickOnly)}${btn('back', '‹ Patterns', false)}</div>
      <div class="help">${STEP_HELP[H.step]}</div>`;
  }
  bar.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && !b.disabled) action(b.dataset.a); });

  // ---------- screens ----------
  function styleScreen() {
    const per = 6, list = H.styles, pages = Math.ceil(list.length / per), p = H.pageNo % pages, sub = list.slice(p * per, p * per + per);
    return { title: 'Dance school', sub: 'Pick a style' + (pages > 1 ? ` (page ${p + 1} of ${pages})` : ''), lines: ['Learn partner-dance patterns step by step. Choreography is draft until reviewed.'],
      buttons: [...sub.map((s) => ({ id: 'sc:style:' + s.id, label: s.name, tone: s.id === 'wcs' ? 'accent' : '' })), ...(pages > 1 ? [{ id: 'sc:page', label: 'More ▸' }] : []), { id: 'sc:exit', label: 'Back' }] };
  }
  function patternScreen() {
    const st = H.styles.find((s) => s.id === H.styleId);
    return { title: st.name, sub: st.blurb, lines: ['Choose a pattern. Every pattern here is draft choreography.'], buttons: [...st.patterns.map((id) => ({ id: 'sc:pat:' + id, label: id.replace(/^[a-z0-9]+-/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) })), { id: 'sc:styles', label: 'Back' }] };
  }
  function resultsScreen() {
    const sc = H.scorer; if (!sc) return { title: 'Done', buttons: [{ id: 'sc:again', label: 'Again', tone: 'accent' }, { id: 'sc:patterns', label: 'Patterns' }] };
    const st = sc.stars(), ma = sc.moveAccuracy().slice(0, 8);
    return { title: st >= 4 ? 'Lovely dancing!' : st >= 2 ? 'Good work' : 'Keep practising', sub: (H.step === 'chain' ? 'Social sequence · ' : H.pattern.name + ' · ') + Math.round(H.tempo * 100) + ' %', big: '★'.repeat(st) + '☆'.repeat(5 - st),
      stats: [['Score', String(sc.score)], ['Accuracy', Math.round(sc.accuracy() * 100) + ' %'], ['Best streak', String(sc.best)]], lines: ['Footwork is taught but not scored.'],
      bars: ma.map((m) => ({ label: m.name, value: m.acc, text: Math.round(m.acc * 100) + '%' })), buttons: [{ id: 'sc:again', label: 'Again', tone: 'accent' }, { id: 'sc:patterns', label: 'Patterns' }, { id: 'sc:exit', label: 'Leave' }] };
  }

  // ---------- lesson control ----------
  async function open() { H.active = true; await loadIndex(); H.pageNo = 0; env.show(styleScreen()); }
  function close() { H.active = false; stopPlay(); root.visible = false; hudMesh.visible = false; for (const r of Object.keys(mfigs)) mfigs[r].root.visible = false; bar.style.display = 'none'; speechSynthesis && speechSynthesis.cancel && speechSynthesis.cancel(); }
  async function startPattern(id) {
    H.pattern = await loadPattern(id); H.step = 'watch'; env.hideScreen(); begin();
  }
  function patternList() { const st = H.styles.find((s) => s.id === H.styleId); return st.patterns; }
  async function begin() {
    const P = H.pattern; stopPlay();
    const chainIds = H.step === 'chain' ? patternList().filter((id) => !cache[id] || !cache[id].travels) : null;
    let list;
    if (H.step === 'chain') { list = []; for (const id of chainIds) list.push(await loadPattern(id)); H.chainList = list; }
    const three = H.step === 'chain' ? list : [P, P, P];
    const merged = CP.chainPatterns(three); H.C = CP.compilePattern(merged);
    H.CP1 = CP.compilePattern(P);
    H.swap = H.step !== 'chain' && merged.segments && three.length === 3 && (() => { const it = CP.chainPatterns([P, P]); return Math.hypot(it.steps.lead[0].x - P.steps.lead[0].x * 1, it.steps.lead[0].y - P.steps.lead[0].y) > 0.05; })();
    H.beats = H.step === 'chain' ? merged.beats : P.beats; H.chainLen = merged.beats;
    H.base = H.step === 'chain' || ['practice', 'dance'].includes(H.step) ? (env.isXR() ? CP.playerTransform(P, H.role) : CP.stageTransform(P)) : CP.stageTransform(P);
    H.xf = { ...H.base }; H.lastCount = -1; H.runs = 0; H.total = H.step === 'dance' ? 4 : 0;
    const scoring = env.isXR() && ['practice', 'dance', 'chain'].includes(H.step);
    H.scorer = null; H.events = null;
    if (scoring) { H.evXf = H.xf; const evAll = CP.buildEvents(H.C, H.role, H.evXf); const lo = H.step === 'chain' ? 0 : P.beats, hi = H.step === 'chain' ? merged.beats : 2 * P.beats; H.events = evAll.filter((e) => e.b >= lo && e.b < hi).map((e) => ({ ...e, b: e.b - lo })); H.scorer = G.createScorer({ scored: H.events }); }
    drawFloor(); buildPrints(); buildTrails(); root.visible = true; renderBar();
    H.hitLog = [];
    const feel = (H.styles.find((s) => s.id === H.styleId) || {}).feel || 'swing', meter = parseInt(P.meter) || 4, bpm = (P.tempo.default || 100) * (H.step === 'dance' || H.step === 'chain' ? Math.max(H.tempo, 0.5) : H.tempo);
    music.timeScale = 1;
    await music.ensure();
    const loopLen = H.step === 'chain' ? merged.beats : P.beats;
    music.startStyle({ feel, bpm, meter, beats: loopLen, countIn: meter, click: H.clickOnly, countOnly: H.clickOnly });
    H.playing = true; H.paused = false; H.cnt = H.step === 'chain' ? 0 : P.beats;
  }
  function stopPlay() { music.stop(); H.playing = false; }
  function pause() { if (!H.playing || H.paused) return; music.pause(); H.paused = true; renderBar(); }
  function resume() { if (!H.paused) return; music.resume(); H.paused = false; renderBar(); }
  function finishRun() { stopPlay(); env.show(resultsScreen()); }

  function action(id) {
    if (id.startsWith('sc:')) {
      const a = id.slice(3);
      if (a.startsWith('style:')) { H.styleId = a.slice(6); env.show(patternScreen()); }
      else if (a.startsWith('pat:')) startPattern(a.slice(4));
      else if (a === 'page') { H.pageNo++; env.show(styleScreen()); }
      else if (a === 'styles') env.show(styleScreen());
      else if (a === 'patterns') { stopPlay(); env.show(patternScreen()); }
      else if (a === 'again') { env.hideScreen(); begin(); }
      else if (a === 'exit') { close(); env.onExit(); }
      return;
    }
    if (id.startsWith('step:')) { H.step = id.slice(5); env.hideScreen(); begin(); }
    else if (id.startsWith('role:')) { H.role = id.slice(5); begin(); }
    else if (id.startsWith('tempo:')) { H.tempo = parseFloat(id.slice(6)); begin(); }
    else if (id.startsWith('view:')) { H.view = id.slice(5); renderBar(); }
    else if (id === 'play') { H.paused ? resume() : pause(); }
    else if (id === 'spoken') { H.spoken = !H.spoken; renderBar(); }
    else if (id === 'click') { H.clickOnly = !H.clickOnly; begin(); }
    else if (id === 'back') { stopPlay(); root.visible = false; bar.style.display = 'none'; env.show(patternScreen()); }
  }

  // ---------- per-frame ----------
  const tmp = {}, S = {};
  const _hw = [new THREE.Vector3(), new THREE.Vector3()];
  function playerSample() {
    if (H.sampler) return H.sampler(H);
    const out = { head: [0, 1.6, 0], yaw: Math.PI, hands: [[0, 1, 0], [0, 1, 0]] };
    camera.getWorldPosition(V); out.head = [V.x, V.y, V.z];
    V2.set(0, 0, -1).transformDirection(camera.matrixWorld); out.yaw = Math.atan2(V2.x, V2.z);
    const hs = env.hands(); out.hands = [hs[0] || [0, 1, 0], hs[1] || [0, 1, 0]];
    return out;
  }
  function update(dt, xr) {
    if (!H.active || !H.pattern) { root.visible = false; hudMesh.visible = false; return; }
    const menu = env.menu();
    if (H.playing && menu && menu.isOpen() && !H.paused) { pause(); H.pausedByMenu = true; }
    else if (H.pausedByMenu && menu && !menu.isOpen()) { H.pausedByMenu = false; resume(); }
    if (!H.playing) { root.visible = true; return; }
    const vb = (() => { music.beat(); return music.virtualBeat(); })();
    const P = H.pattern, len = H.beats, local = vb >= 0 ? vb % len : vb, k = vb >= 0 ? Math.floor(vb / len) : 0;
    // frame for this loop (swap patterns trade places each loop)
    const flipFrame = H.swap ? ((k % 2) * Math.PI) : 0, extra = H.swap ? Math.PI : 0;
    H.xf.rot = H.base.rot + flipFrame + extra; H.xf.ox = H.base.ox; H.xf.oz = H.base.oz;
    const slotRot = H.base.rot + flipFrame;
    slot.rotation.y = slotRot; slot.position.set(H.base.ox, 0, H.base.oz);
    if (k !== H.lastK) { H.lastK = k; if (H.scorer) H.scorer.rewind(); if (H.step === 'practice' || H.step === 'dance') { /* loops */ } if (H.total && k >= H.total) { finishRun(); return; } }
    if (H.step === 'chain' && vb > len + 0.5) { finishRun(); return; }
    const L = (H.step === 'chain' ? 0 : P.beats) + local; H.L = L;
    CP.sampleCouple(H.C, L, S);
    const mine = env.isXR() && ['practice', 'dance', 'chain'].includes(H.step) ? H.role : null;
    const partner = mine ? (mine === 'lead' ? 'follow' : 'lead') : null;
    // hand attach: the partner's connected hand meets the player's controller
    const ps = mine ? playerSample() : null;
    for (const r of ['lead', 'follow']) {
      const params = CP.figureParams(S[r], H.xf, fp.params[r]);
      if (mine && r === partner) for (const hd of S.holds) {
        if (hd.kind !== 'join') continue;
        const pi = mine === 'lead' ? hd.li : hd.fi, qi = mine === 'lead' ? hd.fi : hd.li;
        const Pw = CP.toWorld(H.xf, hd.p[0], hd.p[1], hd.p[2]), ph = ps.hands[pi], d = Math.hypot(ph[0] - Pw[0], ph[1] - Pw[1], ph[2] - Pw[2]);
        if (hd.w > 0.5 && d < 0.28) { params.hands[qi] = [lerp(Pw[0], ph[0], 0.7), lerp(Pw[1], ph[1], 0.7), lerp(Pw[2], ph[2], 0.7)]; }
        if (hd.w > 0.5 && d < 0.12 && !H.hit[pi]) { H.hit[pi] = true; env.buzz(env.handController(pi), 0.6, 40); } else if (d > 0.2) H.hit[pi] = false;
      }
      figs[r].updateWorld(params); mfigs[r].updateWorld(params);
      const vis = r !== mine; figs[r].root.visible = vis; mfigs[r].root.visible = vis;
    }
    // overlays
    const showHands = H.step === 'hands' || mine, pcs = S.holds.filter((h) => h.kind === 'join');
    joinOrbs.forEach((o, i) => { const h = pcs[i]; if (h && showHands && h.w > 0.1) { const w = CP.toWorld(H.xf, h.p[0], h.p[1], h.p[2]); o.position.set(w[0], w[1], w[2]); o.visible = true; o.scale.setScalar(0.8 + 0.6 * h.w); } else o.visible = false; });
    cueArrows.forEach((c, i) => { const h = pcs[i]; c.visible = false; if (!h || !showHands || h.w < 0.3) return; const S2 = CP.sampleCouple(H.C, L + 0.25, {}); const hh = S2.holds.filter((q) => q.kind === 'join')[i]; if (!hh) return; const a = CP.toWorld(H.xf, h.p[0], h.p[1], h.p[2]), b = CP.toWorld(H.xf, hh.p[0], hh.p[1], hh.p[2]); V.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const m = V.length(); if (m < 0.03) return; V.divideScalar(m); c.position.set(a[0] + V.x * 0.1, a[1] + V.y * 0.1 + 0.05, a[2] + V.z * 0.1); c.quaternion.setFromUnitVectors(V2.set(0, 1, 0), V); c.visible = true; });
    trails.visible = H.step === 'hands'; prints.visible = H.step === 'foot' || !!mine;
    // footprints pulse with the counts (local beat, wrapped)
    const lb = vb >= 0 ? (vb % P.beats) : vb;
    for (const o of printObjs) {
      let d = lb - o.t; if (d < -P.beats / 2) d += P.beats; if (d > P.beats / 2) d -= P.beats;
      const on = d >= 0 ? Math.max(0, 1 - d / 0.9) : Math.max(0, 1 + d / 0.5) * 0.4;
      const base = (o.mine ? 0.28 : 0.1) * (o.weight ? 1 : 0.5), vis = o.role === (mine || H.role) || H.step === 'foot' && !mine;
      o.g.visible = o.sprite.visible = vis || H.step === 'foot'; if (o.line) o.line.visible = o.cone.visible = o.mine;
      o.mat.opacity = Math.min(1, base + on * 0.8 * (o.mine ? 1 : 0.3)); o.g.scale.setScalar(1 + on * 0.18); o.sprite.material.opacity = o.mine ? 1 : 0.35;
      if (!o.weight) o.mat.opacity *= 0.7;
    }
    // player's targets
    if (mine) {
      const me = S[mine], mp = CP.toWorld(H.xf, me.x, me.y, 0.02); bodyMark.position.set(mp[0], 0.03, mp[2]); bodyMark.visible = true;
      for (let i = 0; i < 2; i++) { const hw = CP.toWorld(H.xf, me.hand[i][0], me.hand[i][1], me.hand[i][2]), act = pcs.some((h) => (mine === 'lead' ? h.li : h.fi) === i) || S.holds.some((h) => h.kind === 'on' && h.role === mine && h.hand === i); ghostHands[i].position.set(hw[0], hw[1], hw[2]); ghostHands[i].material.color.setHex(COL[mine]); ghostHands[i].visible = act; }
      if (H.scorer && !H.paused) { const ev = H.scorer.update(local, ps, vb >= 0); for (const e of ev) { H.hudPop = { t: performance.now() / 1000, g: e.grade, pts: e.pts }; if (e.grade !== 'miss') { music.chime(e.grade); env.buzz(0, 0.4, 25); env.buzz(1, 0.4, 25); } } }
    } else { bodyMark.visible = false; ghostHands.forEach((o) => { o.visible = false; }); }
    // counts: label, spoken
    const ci = CP.countAt(H.C, L), cur = ci >= 0 ? H.C.counts[ci] : null;
    if (ci !== H.lastCount) { H.lastCount = ci; if (cur && H.spoken && !H.clickOnly && vb >= 0) say(cur.label); }
    const step = cur ? stepTip(L) : '';
    H.hud = { label: cur ? cur.label : '–', tip: step };
    hudMesh.visible = xr;
    if (xr) { const sc = H.scorer, pop = (performance.now() / 1000 - H.hudPop.t) < 0.9 ? H.hudPop : null, cl = { perfect: '#ffd24a', good: '#6fe6ff', ok: '#b9c3ff', miss: '#ff7a8a' };
      drawHud({ label: H.hud.label, title: P.name + ' · ' + (STEPS.find((q) => q[0] === H.step) || [0, ''])[1], tip: H.hud.tip, draft: !P.reviewed, foot: (H.role === 'lead' ? 'You lead' : 'You follow') + ' · ' + Math.round(H.tempo * 100) + ' %', score: sc ? sc.score : undefined, pop: pop ? pop.g.toUpperCase() : '', popColor: pop ? cl[pop.g] : '#fff' }); }
    if (!xr) { const c = document.getElementById('lcnt'); if (c) c.textContent = H.hud.label; const t = document.getElementById('ltip'); if (t) t.textContent = H.hud.tip; }
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  function stepTip(L) { const r = H.role; let best = null; for (const role of ['lead', 'follow']) for (const s of H.C.P.steps[role]) { if (s.tip && s.beat <= L + 0.05 && (role === r || H.step === 'watch') && (!best || s.beat > best.beat || (s.beat === best.beat && role === r))) best = { ...s, role }; } return best ? (best.role === 'lead' ? 'Lead: ' : 'Follow: ') + best.tip : ''; }
  let lastSay = 0;
  function say(label) {
    if (!('speechSynthesis' in window)) return; const w = SPEAK[label] || label; if (/^\(/.test(label)) return;
    const now = performance.now(); if (now - lastSay < 120) return; lastSay = now;
    try { const u = new SpeechSynthesisUtterance(w); u.rate = 1.7; u.volume = 0.8; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { /* no speech */ }
  }

  // ---------- camera views (desktop / phone) ----------
  const cam = { orbit: { yaw: 0, pitch: 0.4, dist: 4.2 } };
  function applyCamera(c, orbitState) {
    if (!H.active || !H.pattern || !root.visible) return false;
    const tgt = V.set(H.base ? H.base.ox : 0, 0.85, H.base ? H.base.oz : -1.6), asp = innerWidth / innerHeight, dist = asp < 0.8 ? 6.2 : 4.4;
    c.up.set(0, 1, 0);
    if (H.view === 'front') { c.position.set(tgt.x, 1.7, tgt.z + dist); c.lookAt(tgt.x, 0.9, tgt.z); }
    else if (H.view === 'side') { c.position.set(tgt.x + dist, 1.5, tgt.z + 0.01); c.lookAt(tgt.x, 0.9, tgt.z); }
    else if (H.view === 'top') { c.position.set(tgt.x, asp < 0.8 ? 5.6 : 3.6, tgt.z + 0.01); c.up.set(0, 0, -1); c.lookAt(tgt.x, 0, tgt.z); }
    else { const o = orbitState; c.position.set(tgt.x + Math.sin(o.yaw) * Math.cos(o.pitch) * dist, 0.9 + Math.sin(o.pitch) * dist, tgt.z + Math.cos(o.yaw) * Math.cos(o.pitch) * dist); c.lookAt(tgt.x, 0.9, tgt.z); }
    return true;
  }

  // ---------- XR menu rows ----------
  function rows(inTab, choiceGrid, toggleRow, buttonRow) {
    const on = () => H.active && !!H.pattern;
    return inTab([
      { section: 'Dance school' },
      ...choiceGrid(STEPS.map(([id, nm]) => [nm, id]), () => H.step, (id) => { H.step = id; begin(); }, 3),
      ...choiceGrid([['Lead', 'lead'], ['Follow', 'follow']], () => H.role, (id) => { H.role = id; begin(); }, 2),
      ...choiceGrid([['50 %', 0.5], ['75 %', 0.75], ['100 %', 1]], () => H.tempo, (v) => { H.tempo = v; begin(); }, 3),
      toggleRow('Say counts', () => H.spoken, (v) => { H.spoken = v; }),
      toggleRow('Metronome only', () => H.clickOnly, (v) => { H.clickOnly = v; begin(); }),
      { cells: [{ text: 'Patterns', action: () => { stopPlay(); env.show(patternScreen()); }, tone: 'accent' }] },
    ], on);
  }

  return { H, open, close, action, update, applyCamera, rows, hud: () => H.hud, active: () => H.active, setSampler: (f) => { H.sampler = f; }, renderBar, root, figs, scorerOf: () => H.scorer, begin, hudPop: () => H.hudPop };
}
