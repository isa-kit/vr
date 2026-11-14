# Tabletop Command (Oortia RTS)

A VR-first 3D real-time strategy game. Static site, no build step, no downloaded assets: terrain, units and sounds are generated from numbers and a seed.

| File | Job |
|---|---|
| `map.js` | Procedural 56x56 battlefield (hills, river with fords, forests, rocks, crystal nodes) + A* grid pathfinding. Pure functions of the seed. |
| `sim.js` | Deterministic 20 Hz fixed-step simulation: units, buildings, orders, formations, combat, economy, separation, fog of war. No THREE, no DOM. |
| `ai.js` | Opponent (Easy / Normal / Hard): gathers, builds depots and barracks, trains a mix, attacks in waves, defends. Uses the same `S.cmd` API as the player. |
| `gfx.js` | Rendering: terrain, water, trees, rocks (procgen/rocks.js), instanced animated units, buildings, effects, fog shader, picking. |
| `ctrl.js` | Device-independent player controller (selection, groups, commands, build/train). Desktop, phone and VR all drive this. |
| `desk.js` | Mouse / keyboard / touch input and RTS camera. |
| `vr.js` | VR layer: ray select, box/lasso, grip brush, controller mini map panel, groups on A/B, stepped table controls. |
| `hud.js`, `mini.js`, `sfx.js`, `tutorial.js` | DOM HUD, 2D mini map, synthesized sounds, guided tutorial. |
| `test/sim.test.mjs` | Headless tests: `node rts/test/sim.test.mjs` (maps, pathing, combat, economy, determinism, AI-vs-AI). |

## Controls
- **Desktop**: left-drag box select, click / double-click (all of that type in view), right-click move / attack / gather, WASD or screen edge pan, Q/E rotate, wheel zoom, `X` attack-move, `C` stop, `H` hold, `G` guard, `F` formation, `1`-`9` groups (Ctrl+N or hold to assign), `Space` jump to alert, `P` pause, `Esc` cancel / menu.
- **Phone**: tap own unit to select, tap ground / enemy / crystal to command, drag for a box, two fingers pan + pinch + twist, tap the mini map.
- **VR**: right trigger = select / command; trigger-drag = box or lasso; hold grip and sweep your hand = brush-select; double-tap trigger on a unit = all of its type in view. Left controller carries the mini map: point the other controller at it (trigger sends units or jumps the view, drag box-selects); *Orders* page trains and builds. A / B (right) = groups 1 / 2 (hold to assign); groups 3 / 4 on the map panel. The table can be rotated, raised and scaled from the menu (faded steps, never smooth motion).

## Needs a headset check
See the report in the commit history / session notes: ray + panel alignment on real controller poses, grip brush reach, A/B group buttons, performance with 80+ units on Quest, comfort of the fade steps.
