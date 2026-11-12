# Scene-config schema (engine-agnostic)

One world = one JSON file in `scenes/`. The **data** describes the world; a
**renderer** (WebXR now, Unity later) draws it. Same JSON, swappable engine —
so the engine choice stays reversible.

```jsonc
{
  "id": "infinity",            // stable slug, matches filename
  "name": "Infinity Lights",   // shown in the entry menu
  "kind": "field",             // field | sandbox | vista  (picks the renderer)
  "status": "live",            // live | soon
  "blurb": "Fly through an endless field of glowing lights.",

  "environment": {
    "sky":   { "type": "gradient", "top": "#05060d", "bottom": "#0a0a14" },
    "fog":   { "color": "#05060d", "near": 0, "far": 200 },
    "ambientLight": 0.3,
    "audio": null              // or { "src": "...", "volume": 0.5, "loop": true }
  },

  "locomotion": { "type": "fly", "speed": 18, "boost": 4 },  // fly | walk | seated

  // --- one of the following blocks, chosen by "kind" ---

  // kind: "field"  — procedural point/instance field (infinity)
  "field": {
    "pattern": "random",       // random | grid | diagonal | jitter
    "count": 4000,             // active items (renderer may auto-scale down)
    "spacing": 8,
    "depth": 120,              // field extent around the viewer
    "pointSize": 0.6,
    "wrap": "infinite",        // infinite | none
    "palette": ["#ffd27f", "#ff9f6b", "#8a7dff", "#6fe0ff"]
  },

  // kind: "vista"  — look-but-don't-touch landscape (nature)
  "vista": {
    "skybox": "glade-day",
    "ground": { "type": "hills", "color": "#4a6b3a", "roughness": 0.9 },
    "props":  [ { "type": "tree",  "count": 120, "spread": 80 },
                { "type": "sheep", "count": 14,  "spread": 40 } ],
    "water":  { "type": "fake-reflective", "level": -2, "color": "#2f6f8f" },
    "birds":  { "count": 20 },
    "ambient":"forest-wind"
  },

  // kind: "sandbox" — grab + build with cheated physics (sand castle)
  "sandbox": {
    "material": "sand",
    "tools":    ["grab", "cup", "pat"],
    "physics":  "cheated",     // snap-to-grid heaps, no real grain sim
    "goal":     "build"
  },

  // in-VR control panel: which knobs appear (empty = no panel)
  "controls": { "panel": ["pattern", "spacing", "depth", "randomize"] }
}
```

**Renderer contract:** read `kind`, apply `environment` + `locomotion`, then
hand the matching block (`field` / `vista` / `sandbox`) to that kind's renderer.
Unknown fields are ignored, so a richer Unity renderer can read extra keys the
WebXR one skips.
