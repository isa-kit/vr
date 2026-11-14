// ============================ dance/songs.js — the song library (built-in songs + shared-format songs from ./songs/) ============================
// One small interface (see SONG-FORMAT.md): a song is a JSON object; music.startSong(song, opts) schedules it on the beat clock.
//   const lib = createSongLibrary({ music });   await lib.init();          // loads songs/index.json if present (404 is fine)
//   lib.list()                       → [{ id, title, author, bpm, tempoFit:{min,max}, meter, source }]
//   lib.eligible({ min, max, meter }) → songs whose tempo-fit overlaps [min,max] and whose meter matches (built-ins first)
//   await lib.get(id)                → the song object (built-ins are baked from the generators on first use)
export const SOLO = {
  easy: { title: 'Easy Groove (built-in)', bpm: 100, fit: [88, 112], bars: 29 },
  medium: { title: 'Medium Mix (built-in)', bpm: 112, fit: [100, 124], bars: 33 },
  hard: { title: 'Hard Beat (built-in)', bpm: 126, fit: [114, 138], bars: 37 },
};
export const FEELS = {
  swing: { title: 'Swing shuffle (built-in)', meter: 4, fit: [84, 120] }, ecs: { title: 'Jump swing (built-in)', meter: 4, fit: [120, 170] },
  salsa: { title: 'Salsa clave (built-in)', meter: 4, fit: [160, 200] }, bachata: { title: 'Bachata (built-in)', meter: 4, fit: [110, 140] },
  hustle: { title: 'Disco hustle (built-in)', meter: 4, fit: [100, 125] }, twostep: { title: 'Country two-step (built-in)', meter: 4, fit: [120, 170] },
  waltz: { title: 'Waltz (built-in)', meter: 3, fit: [84, 138] }, foxtrot: { title: 'Foxtrot swing (built-in)', meter: 4, fit: [100, 130] },
  chacha: { title: 'Cha-cha (built-in)', meter: 4, fit: [112, 128] }, rumba: { title: 'Rumba (built-in)', meter: 4, fit: [96, 120] }, tango: { title: 'Tango (built-in)', meter: 4, fit: [120, 132] },
};
export function createSongLibrary({ music }) {
  const L = { cache: {}, external: [] };
  const meta = [];
  for (const [k, v] of Object.entries(SOLO)) meta.push({ id: 'builtin:solo-' + k, title: v.title, author: 'built-in', bpm: v.bpm, tempoFit: { min: v.fit[0], max: v.fit[1] }, meter: 4, source: 'builtin', kind: 'solo', key: k });
  for (const [k, v] of Object.entries(FEELS)) meta.push({ id: 'builtin:' + k, title: v.title, author: 'built-in', bpm: Math.round((v.fit[0] + v.fit[1]) / 2), tempoFit: { min: v.fit[0], max: v.fit[1] }, meter: v.meter, source: 'builtin', kind: 'feel', key: k });
  L.init = async () => {
    try {
      const idx = await (await fetch(new URL('./songs/index.json?v=20261118b', import.meta.url))).json();
      for (const f of idx.songs || []) { try { const s = await (await fetch(new URL('./songs/' + f + '.json?v=20261118b', import.meta.url))).json(); if (validate(s)) { L.cache[s.id] = s; L.external.push({ id: s.id, title: s.title, author: s.author || '', bpm: s.bpm, tempoFit: s.tempoFit || { min: s.bpm - 10, max: s.bpm + 10 }, meter: (s.meter || [4, 4])[0], source: 'library', kind: 'song' }); } } catch (e) { /* skip bad file */ } }
    } catch (e) { /* no library yet */ }
  };
  function validate(s) { return s && s.format === 1 && s.id && s.tracks && s.instruments && s.length > 0 && s.bpm > 0; }
  L.validate = validate;
  L.list = () => [...meta, ...L.external];
  L.eligible = ({ min, max, meter, kind }) => L.list().filter((s) => s.meter === meter && s.tempoFit.max >= min && s.tempoFit.min <= max && (!kind || s.source === 'library' || s.kind === kind));
  L.get = async (id) => {
    if (L.cache[id]) return L.cache[id];
    const m = meta.find((x) => x.id === id); if (!m) return null;
    if (m.kind === 'solo') { const v = SOLO[m.key]; L.cache[id] = music.bakeSolo(m.key, v.bars, { id, title: v.title, bpm: v.bpm, tempoFit: m.tempoFit }); }
    else { const v = FEELS[m.key]; L.cache[id] = music.bakeFeel(m.key, v.meter, { id, title: v.title, bpm: m.bpm, tempoFit: m.tempoFit }); }
    return L.cache[id];
  };
  L.builtinFor = (kind, key) => (kind === 'solo' ? 'builtin:solo-' + key : 'builtin:' + key);
  L.fitText = (id) => { const m = L.list().find((x) => x.id === id); return m ? `${m.title} · fits ${m.tempoFit.min}–${m.tempoFit.max} BPM` : 'none'; };
  return L;
}
