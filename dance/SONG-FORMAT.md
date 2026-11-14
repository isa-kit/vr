# Song format (proposal v1) — for the Dance app and the planned music-making app

**Status: proposal.** The Dance app plays this format today (built-in songs are baked into it by `music.bakeSolo` / `music.bakeFeel`).
The music-app session may adopt or adjust it. Change `format` when it changes.

A song is one JSON object. **Time is in beats** (not seconds), so the game can play any song at any tempo inside its fit range.
One file per song in `dance/songs/<id>.json`, listed in `dance/songs/index.json` as `{ "songs": ["<id>", ...] }`.

```json
{
  "format": 1,
  "id": "my-swing-01", "title": "Blue Slot", "author": "name",
  "bpm": 100,                                  // the tempo the song was written at
  "tempoFit": { "min": 88, "max": 112 },       // tempos it still sounds right at; shown in the lesson / routine picker
  "meter": [4, 4],                             // [beats per bar, note value]; the game matches 3/4 vs 4/4 patterns on this
  "length": 64,                                // beats (16 bars of 4/4); the song loops if "loop": true, else it ends
  "loop": true,
  "key": { "root": 57, "scale": "minor" },     // optional, informational (MIDI note of the tonic)
  "sections": [ { "name": "intro", "from": 0, "to": 8 }, { "name": "verse", "from": 8, "to": 32 } ],   // markers, in beats
  "instruments": {
    "kick":  { "preset": "kick" },
    "pad":   { "synth": { "osc": [ { "type": "sawtooth", "detune": -6 }, { "type": "sawtooth", "detune": 6 } ],
                          "env": { "a": 0.02, "d": 0.2, "s": 0.6, "r": 0.15 },
                          "filter": { "type": "lowpass", "freq": 1400, "q": 0.7, "envAmt": 0.5 },
                          "gain": 0.12, "noise": 0 } }
  },
  "tracks": [
    { "instrument": "kick", "events": [ [0, 0.3, 0, 1], [1, 0.3, 0, 0.8] ] },
    { "instrument": "pad",  "events": [ [0, 4, [57, 60, 64], 0.9] ] }
  ]
}
```

## Events
`[beat, duration, pitch, velocity, param?]` — `beat` and `duration` in beats (fractions allowed, quantised to 1/48 beat),
`pitch` a MIDI note, **or an array of notes for a chord**, or `0` for unpitched drums; `velocity` 0–1.
Events may be in any order inside a track; tracks play together.

## Instruments (synth numbers)
* `{ "synth": { osc[], env{a,d,s,r}, filter{type,freq,q,envAmt}, gain, noise } }` — a subtractive voice. `osc[]` = `{type: sine|square|sawtooth|triangle, detune (cents), semi (semitones), gain}`.
  Envelope times are seconds; `envAmt` is how far the filter opens above `freq` at the attack (0 = static).
* `{ "preset": "kick|snare|hat|clap|bass|chord|pluck|lead|perc" }` — the Dance app's built-in voices (used by the built-in songs).
  `param`: hat `"open"|"closed"`; chord flavour `"swing|hard|waltz|twang|easy"`; lead waveform; perc `"square|triangle"` (pitch = frequency in Hz).
* Planned, not implemented: `{ "drum": { kind, f0, f1, decay } }` numeric drum synths; sample-free only (no audio files, ever).

## What the Dance app does with it
`music.startSong(song, { bpm, countIn, loop, wrap })` schedules the events on the Web Audio clock and returns control of the beat clock:
`music.beat()` is the routine/pattern beat (negative during the count-in), `music.section()` the current section marker,
`music.songInfo()` → `{ id, title, bpm, length }`. The game chooses the playback tempo from the routine/pattern (× the 50/75/100 % speed);
a song is offered for a routine or lesson only when **its `tempoFit` overlaps the pattern's tempo range and the meter matches**.
The picker shows `title · fits min–max BPM`.

## Open questions for the music-app session
* Swing feel: today it is baked into event times (swung eighths land at 2/3 of the beat). Alternative: a `swing` field applied by the player.
* Automation (filter sweeps, volume): not in v1.
* Multiple patterns per song (a pattern bank + arrangement) vs. flat event lists: v1 is flat for simplicity; the app can expand patterns on export.
