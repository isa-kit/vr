# The Oortia app standard

Binding conventions for every Oortia VR app, so a new app never re-invents the
menu, navigation, comfort or "which way is up". The standard is **code first**:
`shared/app.js` implements it, and an app that is built on it conforms by
construction. This document says, in plain language, what that code guarantees
and what an app may and may not do on top.

Comfort comes first. When a rule here conflicts with a feature idea, the rule
wins: **slow, straight, opt-in.**

Start a new app by copying `template/` (see §9).

---

## 1. One bootstrap

```js
import { THREE, createOortiaApp, sectionRow, choiceGrid } from '../shared/app.js?v=app2';

const app = await createOortiaApp({
  id: 'myapp', title: 'My App',
  capabilities: { locomotion: 'none' | 'walk' | 'drift',
                  posture: ['seated', 'lying-up'],      // first = default
                  passthrough: true, tools: false },
  tabs: (app) => [{ name: 'Brush', rows: [...] }],      // the app's own menu tabs
  onRecenter: (frame, app) => { /* re-place content relative to the headset */ },
});
app.world.add(...);  app.tick((dt, t) => {...});  app.onPress((aim) => {...});  app.start();
```

That one call gives the app: renderer / scene / camera / rig (`dolly`), the
menu in the user's global style, Pause, Recenter, Quit, the comfort kit
(vignette, fades, snap turn, frame-time governor), the posture switch including
Lying up, slow straight drift with the right-hand compass, controller models
and rays, and mouse + touch fallbacks.

- An app imports **only** `shared/app.js` (and `three`). It re-exports the menu
  row helpers. Importing `xrmenu.js` / `comfort.js` directly from an app is
  non-conforming: version strings drift and the browser loads two copies.
- Older kits (`shared/lie.js`, `seated/common.js`) and hand-wired worlds go
  through `standardChrome()` in the same file — the single place that creates
  the menu. Nobody calls `createXRMenu` anywhere else, and every shared helper
  (`createComfort`, row helpers, `recenterRig`) is imported from `app.js`.

Two levels of conformance, used in the table in §10:

- **Full** — built on `createOortiaApp`. Everything in this document holds by
  construction. Required for every new app.
- **Chrome** — an older world keeps its own renderer, loop, movement and
  recenter code but gets its menu, Pause and comfort from `standardChrome`.
  The menu, buttons and Pause are standard; movement and posture are the
  world's own and are listed as exceptions.

## 2. Buttons

| Control | Standard meaning | May an app change it? |
|---|---|---|
| **X or Y** (left hand), tap | Open / close the menu panel | No |
| **X or Y**, hold | Radial wheel: point or push the stick, release to choose | No |
| **Trigger** | Select: click the menu, or the app's main action (`app.onPress`) | Action only — never rebind menu clicking |
| **Grip** | Grab: carry the menu panel, pick up a tool or object | Only for grabbing things |
| **Grip, both hands on the panel** | Pull apart / push together to resize it | No |
| **Thumbstick on the panel** | Grow / shrink the panel | No |
| **Right stick, left / right** | Turn: 30° snap (default) or slow smooth, the user's choice | No (walking apps only) |
| **Left stick** | Walk at one constant speed (walking apps only) | No |
| **A**, hold (right hand) | Drift apps: aim the compass, release to set the direction | Free in apps without drift |
| **B** (right hand) | Drift apps: go / stop | Free in apps without drift |
| **Thumbstick click** | Drift apps: cycle exact directions while holding A | Free otherwise |

Apps may claim **A, B and thumbstick click** (when the app has no drift) and the
**trigger while not pointing at the menu**. Everything else is reserved. An app
never needs a button for menu, pause, recenter or quit — they are in the menu.

Flat screens: click / tap = trigger. Drag looks around (or, with
`flatDrag: 'act'`, drag acts and right-drag / two fingers look). Arrow keys
look. `Esc` or `M` opens the menu. Phones get a 46 px Menu button.

## 3. The menu

One menu, one style for the whole site. The user picks **Wheel**, **Dashboard**
(floating panel) or **Wrist** once; the choice (`oortia-menu-style`), the panel's
place relative to the head and its size (`oortia-menu-pose`) are remembered
across every app.

Top level — always this order, as big tiles (160 px tall on the 800 px panel,
two per row; ordinary rows are 80 px):

1. **Pause** / Resume
2. **Recenter**
3. **Menu style**
4. **Quit to Worlds** (tap twice)
5. the app's own **tabs**, in the app's order
6. **Motion** (only if the app can move you)
7. **Comfort** (posture, vignette, turning, phone look)
8. Sound and Passthrough, when the app or headset has them

Rules: an app adds **tabs**, never top-level tiles of its own. Short labels
(one or two words). No in-world buttons that duplicate Pause / Recenter / Quit,
except kit-provided ones inside a play field (the Lying up field has Menu /
Recenter / posture buttons because the panel can be out of view overhead).
Extra standalone panels get grip-to-move through `menu.addGrabTarget`.

## 4. Pause

Every app has Pause, first on the menu. Paused means: **nothing in the world
moves and game time stops**, the menu still works, the picture stays live.

- With the bootstrap, `app.tick((dt, t) => …)` receives `dt = 0` while paused,
  drift and walking stop, so an app that animates from `dt` / `t` pauses for free.
  Ask for real time with `app.tick(fn, { always: true })` only for UI.
- `app.paused`, `app.setPaused(v)`, `onPause(paused)` for things like audio.
- Pause is a session action: an app always opens un-paused (people who set
  "reduce motion" on their device open in calm mode instead).
- A game with its own pause screen passes `pause: { get, set }` so the standard
  tile drives it — one pause, not two.

## 5. Motion

The user is either **stationary** or moving in **one slow straight line**.

- Every app opens **stationary**. Motion is always something the user starts.
- **Constant speed, hard cap.** Drift: 0.15 / 0.25 / 0.4 m/s, never above
  **0.45 m/s**. Walking: 1.0 m/s × the user's speed setting, never above 1.6 m/s.
  No acceleration ramps, no easing, no analog "a bit faster".
- **No curves.** Nothing steers with the head or the hand while moving. To
  change direction you stop, choose, and start again; a change made while
  moving goes through a short fade to black, never a swing.
- **Turning** is 30° snap by default; slow smooth turning is the user's opt-in.
- **Jumps** (recenter, seat change, teleport, reaching a boundary) fade through
  black. The camera is never moved by an animation.
- The **vignette** narrows while the user is being moved; apps report motion and
  never switch it off themselves.
- No camera shake, no forced roll or pitch, no objects rushing at the face, no
  full-field flashing. Ambient motion (sway, drifting particles) stops on Pause.
- Arriving at an edge (ground, ceiling, boundary): stop, then fade back.

Apps that need a different kind of movement do not get an exception; they get
`locomotion: 'none'` and move the *content* instead (a field that scrolls, a
board you grab), which is always comfortable.

## 6. Frames of reference

"Forward" and "up" mean different things when you lie on your back, so each
word has one fixed meaning:

- **The world is always upright.** Gravity is down in every posture. Nothing
  tilts the world to suit the user's pose; content is re-placed instead.
- **Straight up / Straight down** = true vertical, in every posture.
- **Heading** (0° ahead, 90° right, 180° behind, 270° left) is measured on the
  level from where the headset faces **at the moment you choose**. Looking
  steeply up (lying on your back), "ahead" is the way past the top of your head.
- **My view** = exactly where the headset looks, full 3D. **Head-top** = toward
  the top of your head.
- Every direction is **resolved once, when chosen, then fixed in the world**. It
  never follows the head afterwards.
- Optional **angle snap**: 5° steps, locking exactly onto 0 / 90 / 180 / 270°,
  level, and straight up / down when within about 9°.
- **Recenter** turns the rig so your level "ahead" is the app's home heading
  (and puts you back over the home spot if the app has one), then lets the app
  re-place its content along your gaze (`onRecenter`, `app.placeAlongGaze`).
  Content placed this way stays where it was put.
- Recenter runs by itself 0.45 s after entering VR and on every posture change.

`app.headFrame()` returns `{ eye, forward, up, flat, yaw }` so apps never work
this out themselves.

## 7. Posture

Three postures, same names everywhere: **Standing**, **Seated**, **Lying up**
(on your back, looking up). An app lists the ones it supports; the first is its
default. The user's last choice is global (`oortia-posture`) and is used by
every app that supports it. `?lie=1` opens an app in Lying up.

- Switching posture never moves or tilts the world; it recenters.
- In Lying up, panels and play fields are placed along the gaze, with their
  "up" toward the top of the head, at least 30° above the horizon.
- An app that supports Lying up must be fully playable without sitting up:
  nothing essential below the horizon, nothing that needs you to turn around.
- On a flat screen posture only sets the eye height (1.6 / 1.15 / 0.3 m) and,
  for Lying up, an upward look.

## 8. Versions and caching

There is no build step; browsers cache modules for about ten minutes, and a
module URL with a different `?v=` is a different module.

- Every import of a local module carries `?v=<string>`; **change the string
  whenever the file changes**, in every file that imports it.
- `index.html` loads `./main.js?v=…` — bump it with each change to the app.
- Apps import `shared/app.js?v=appN`; only `app.js` pins the versions of the
  other shared modules. A change to a shared module = bump its string inside
  `app.js` (and the kits), then bump `appN` everywhere `app.js` is imported.
- Check a deploy with a fresh query string (`/myapp/?c=123`), never a plain reload.
- Per-app settings live in `localStorage` under `oortia-<id>-v1` (`app.store` /
  `app.save`). Site-wide keys (`oortia-menu-style`, `oortia-menu-pose`,
  `oortia-comfort-v1`, `oortia-posture`, `oortia-drift-snap`) belong to the
  shared modules; apps never write them.

## 9. New-app checklist

1. Copy `template/` to `<id>/`; set `id`, `title`, the page title and colours.
2. Declare capabilities honestly: `locomotion` (`none` unless the app is about
   moving), supported `posture`s, `tools` if things are picked up.
3. Put everything opaque in `app.world` (passthrough hides it in one go).
4. Menu: only tabs. No own Pause / Recenter / Quit / style controls.
5. Input: `app.onPress` / `app.onRelease` for trigger, click and tap together.
   Claim A / B only if the app has no drift.
6. Animate from the `dt` / `t` given to `app.tick`, so Pause works.
7. Place content in `onRecenter`; test Seated and Lying up.
8. Any jump goes through `app.comfort.fade(fn)`.
9. All assets procedural; no external files beyond the three.js CDN import map.
10. Add `scenes/<id>.json` (copy `scenes/_template.json`) and list the id in
    `scenes/index.json` when it is ready for the front page.
11. Check on a flat screen with `#debug` (`window.__app`, step frames with
    `__app._frame(1/30)`), on a phone, then in the headset.
12. Bump `?v=` strings, push, and load the live page with a fresh query string.

## 10. Conformance today

| World | Level | What is standard | Exceptions (and why) |
|---|---|---|---|
| `template/` | Full | Everything | — |
| Sky Wand | Full | Everything: menu tabs, Pause, posture, drift + compass, press / release | — |
| Star Catcher, Lantern Glow, Star Stories, Kite Ribbons, Cloud Pairs | Chrome (kit) | Menu, Pause (game time stops), comfort, site-wide posture, no locomotion | `shared/lie.js` keeps its own renderer, loop and overhead-field placement (it predates the bootstrap and is its model for Lying up); its flat settings list shows as one "Settings" tile instead of tabs. |
| Forest, Cliffs, Beach | Chrome (kit) | Menu, Pause, comfort, Lying up via `?lie=1` | `seated/common.js` keeps its own loop, drag-look with inertia and seat system. The front-page card decides the posture, not the last-used one, because each world has a separate Lying up card. |
| Infinity Lights | Chrome | Menu (tabbed), Pause, comfort, snap turn | Own flying movement at the comfort speed setting — faster than the 0.45 m/s drift cap, steered by the stick. Predates §5; needs a design decision before changing. |
| Nature — Glade & Cliffs | Chrome | Menu, Pause, comfort, snap turn, teleport | Own walking (with run on desktop), terrain following, binoculars. Walking speed follows the comfort setting but was not re-checked against the 1.6 m/s cap. |
| Sand Castle | Chrome | Menu, Pause, comfort, snap turn | Claims A / B for tool cycling (allowed: no drift); own walking, scale change and sculpt input. Too input-heavy to move safely without a headset. |
| Dance | Chrome | Menu, Pause tile drives the game's own pause, comfort | Own body tracking, recenter (`recenterBody`) and in-world screens. The countdown on resume is the game's. |
| Tabletop Command (RTS) | Chrome | Menu (tabbed), Pause tile drives the match pause, comfort | Own table grab / zoom navigation and desk controls. |

Site-wide gaps still open:

- The desktop / phone overlay menu lists rows directly; the standard top-level
  tiles (and so the Pause tile) are the VR views. On flat screens Pause is the
  "Pause world motion" row under Comfort, or the game's own button.
- `shared/lie.js` still nudges the floating menu into view itself when lying;
  this belongs in `xrmenu.js`.
- None of the migrations has been checked in a headset yet.

## 11. Godot

The Godot exports in `godot/` are outside this standard for now. When they are
brought in they mirror the same conventions — button map (§2), menu order (§3),
Pause (§4), motion rules and caps (§5), frames of reference (§6), posture names
(§7) — implemented as one shared autoload, the counterpart of `shared/app.js`.
