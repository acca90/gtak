# Pastel City — project instructions

A top-down crime game in plain HTML5 canvas + JavaScript, inspired by GTA 1 and 2 but with a
softer "modern retro" pixel-art look. All art is generated as editable Aseprite files.
README.md is the player/developer guide; this file and `.claude/` are how to work on it.

## Backlog

`docs/backlog.md` lists the user's planned features. Take them one at a time: design, split into
small tasks, spec, build. Keep its status column current.

## Running

- Open `index.html` directly (it works from `file://`). `gallery.html` shows every sprite.
- `node tools/check.js` runs the smoke check, `node tools/bench.js` times the update loop, and `tools/shot.sh out.png 'demo&...'` takes a headless screenshot.

## Code map

```
src/core.js      math, RNG, sprite atlas, bitmap font, keyboard/mouse/gamepad input (KEYMAP)
src/clock.js     in-game clock, day counter, light curve (Clock.light / advance)
src/traffic.js   traffic driver AI (vehicles-agent): lanes, lights, honk/pass/flee
src/aov.js       area of view: streaming pools, used-car release, sleep ring (traffic/peds/police use it)
src/city.js      city generator: road segments, block merges, regions, river, railway
src/render.js    chunked ground, oblique buildings, roofs, tall props, lighting
src/entities.js  vehicle models (MODELS), weapons (WEAPONS), car physics, player, particles
src/phone.js     cellphone UI (contacts, calls, messages, GPS, RADIO placeholder)
src/missions.js  jobs from payphones and phone calls
src/game.js      rules, HUD, camera, main loop, Train, #demo test hook
art/*.aseprite   sprite SOURCES (tags name the sprites)
assets/          GENERATED sheets + atlas.js (never hand-edit)
tools/           generate-art.lua, export-art.lua, art.sh, check.js, shot.sh
```

## `.claude/` — how the project is organised

| Folder | What's in it |
|---|---|
| `.claude/rules/` | Project rules, loaded automatically. `scope`, `runtime`, `testing`, `agents`, `decisions` and `git` always apply; `art-pipeline` and `rendering` load when you touch those files. **Read them before changing code.** |
| `.claude/agents/` | Six specialists (pixel, vehicles, weapons, geo, sound, radio). Ownership and the feature flow are in `rules/agents.md`. |
| `.claude/agent-memory/` | Each agent's decision log (`<agent>/MEMORY.md`, auto-loaded into that agent) plus `coordinator/` for cross-cutting decisions. Format in `rules/decisions.md`. |
| `.claude/skills/` | `/commit`: verify, then commit (and push when asked). |

The main session is the **coordinator**: it splits work between agents, writes the shared
specs, integrates the results and records cross-cutting decisions in
`.claude/agent-memory/coordinator/MEMORY.md`.
