# Worlds — vr.devisant.com

Calm, immersive WebXR worlds. One static site, no build step, no install.
Opens flat in any browser, **Enter VR** on a Quest, **Start AR** on Android.

- `index.html` — the entry menu (data-driven from `scenes/`).
- `infinity/` — the Infinity Lights world (live).
- `scenes/` — engine-agnostic world configs + `SCHEMA.md` (the contract).

Each world is described by JSON in `scenes/`; a renderer draws it. The same
config can drive a future high-end (Unity) renderer — so the engine stays
swappable. See `scenes/SCHEMA.md`.

Served via GitHub Pages at **https://vr.devisant.com**.
