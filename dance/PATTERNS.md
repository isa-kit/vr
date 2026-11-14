# Partner-dance pattern files

One JSON file per pattern in `dance/patterns/`. To add one: drop `my-pattern.json` there and list its id under a style in
`patterns/index.json` (`styles[].patterns`). No code changes. Every file ships with `"reviewed": false` until a dancer confirms it;
the app shows "Draft choreography" for those. Set `"reviewed": true` to remove the note.

## Floor frame
Positions are metres in the **slot frame**: `x` along the slot / line of dance, `y` to the left of +x. `facing` is in degrees,
0° = +x, counter-clockwise (so 90° = +y, 180° = −x). Facing values are cumulative: use 0 → 180 → 360 for a full turn the same way round,
or 0 → −180 for the other way. Lead and follow each have their own list of steps.

## Top level
```json
{
  "format": 1, "id": "wcs-sugar-push", "style": "wcs", "name": "Sugar Push", "level": "beginner", "reviewed": false,
  "tempo": { "min": 84, "max": 120, "default": 96 },          // beats per minute
  "meter": "4/4",                                             // "3/4" for waltz
  "beats": 6,                                                 // pattern length in beats (the loop length)
  "counts": [ { "beat": 0, "label": "1" }, { "beat": 2.5, "label": "&" } ],   // what is shown and spoken
  "floor": { "kind": "slot|line|box", "x0": -1.5, "x1": 1.5, "width": 0.9 }, // drawn on the floor
  "start": { "lead": {"x":-0.55,"y":0,"facing":0,"weight":"R"}, "follow": {"x":0.55,"y":0,"facing":180,"weight":"L"} },
  "steps": { "lead": [ ... ], "follow": [ ... ] },
  "holds": [ ... ], "free": { "lead": "relaxed", "follow": "relaxed" }, "notes": [ "teaching text" ],
  "travels": true                                             // optional: the couple ends somewhere else (resets each loop)
}
```
`start.x/y` is the body centre. Feet start 0.1 m either side of it. `weight` is the foot that carries the weight at the start.

## Steps (per role, sorted by beat)
```json
{ "beat": 2.5, "foot": "R", "x": -0.68, "y": 0.0, "facing": 0, "label": "&", "tip": "shown while this count is current",
  "weight": true, "rise": 0.04, "pivot": false }
```
* `beat`: when the foot lands (beats from the pattern start; `.5` = the "and"). `foot`: `"L"` or `"R"`. `x`,`y`: **foot** position.
* `facing`: body facing from this count on (the body turns smoothly to it). `weight:false` = a touch / tap (no weight change).
* `rise`: body rise in metres (waltz). `pivot:true`: the planted foot turns with the body until the next step.
* The stepping foot travels in the beat(s) before it lands, so a step on count 3 arrives on count 3. Planted feet never slide.

## Holds
```json
{ "from": 0, "to": 3, "kind": "join", "lead": "L", "follow": "R", "height": "mid",
  "offset": [0.34, 0], "cue": "push", "path": [[1.8, 0, 0, 0.5], [2.8, 0, 0, 0.5], [3.4, 0, 0, 0]] }
{ "from": 0, "to": 6, "kind": "on", "role": "lead", "hand": "R", "on": "back" }
```
* `join`: lead's `lead` hand meets follow's `follow` hand (`"L"`/`"R"` = anatomical hand) at the midpoint of the two shoulders.
  `height`: `low | mid | frame | high | over` or metres. `offset`: [toward the lead's left, forward] in metres.
  `path`: `[beat, dx, dy, dheight]` keyframes added to the connection point: the hand path / lead direction. `cue`: label for the direction arrow.
* `on`: one hand rests on the partner (`back`, `shoulderL`, `shoulderR`, `armL`, `armR`).
* A hold fades in about half a beat before `from` and out after `to`. Free hands use `free` (`relaxed | hip | up | out | frame | style`).
* Keep connected hands within about 1.2 m of each other (arm reach); the app's checks assume this.

## What is scored (VR only: head and two hands are tracked)
From the file, automatically, for the role you dance: **Connect / Hold** (your controller at the connection point, on the count),
**Travel** (your head over where your body should be after a step), **Turn** (your head facing within about 30° of the body facing after a 40°+ turn).
Timing comes from the count window (±0.3 beats). Footwork is taught and shown, never scored.
