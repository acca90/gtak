# coordinator — cross-cutting decisions
Written by the main session (not a subagent). Format: `.claude/rules/decisions.md`. Newest first.

## 2026-09-26 · Traffic phase B: lanes, driver, pool, reactions; all-red light phase
- **Decision:** geo-agent's lane graph (`c.lanes`/`c.nodes`, right-hand traffic) + vehicles-agent's driver in
  `src/traffic.js` (steers via the player's control interface, so model stats apply) + the coordinator's pool in
  `Game.setupTraffic` (zone densities from `ZONES[z].traffic`, spawn clearance = stopping distance, never near a stop
  line). Signals run a 22 s cycle with a 1 s all-red. Reactions: honk + pass when blocked, flee when hit; no
  carjacking, no ramming back, no police in traffic. Demo hooks `lanes`, `warm=N`.
- **Why:** the user's choices of 2026-09-26 (region mixes, 35% cruise, obey lights, honk + flee).
- **Status:** active; not play-tested. Open: downtown density reads thin on screen (budget 12 over the whole AOV).

## 2026-09-26 · Area of view (AOV) and traffic unlocked (spec: docs/specs/traffic-v1.md)
- **Decision:** the user unlocked traffic (pedestrians still later). `src/aov.js` is the shared streaming system:
  AOV = 2.5x the widest-zoom view per axis around the camera centre, `keep` = AOV x1.2, nothing spawns or vanishes
  on screen (+64 px). Untouched parked cars are **not** streamed; a car the player drives, damages or shoves > 24 px
  becomes `managed` and is dropped outside `keep`; its home spot refills out of sight. Never dropped: the player's
  car, the tank, aircraft, mission cars (`c.target`). Cars outside `keep` that are parked and still sleep.
  Car-vs-car uses a 160 px grid. Far fewer parked cars (geo-agent, A4).
- **Why:** the user's plan, so traffic, pedestrians and police don't overload the browser. Measured: update 7.4 -> 0.32 ms/tick.
- **Status:** active; not play-tested

## 2026-09-26 · In-game clock (spec: docs/specs/time-v1.md)
- **Decision:** a real clock in `src/clock.js`: 1 game minute per real second (a day = 24 real min), new game
  at day 1 08:00, stops only when the world stops (pause, title, store). Light is one look value `s` (0 day,
  1 dusk/dawn, 2 night) from `LOOK_KEYS`; buildings cross-fade their cached looks. `G.time` is now derived,
  read-only. O = +6 h fast-forward; N and pad button 8 are freed. Wanted-level decay (item 2) uses
  **real** seconds, not the clock. Spend time with `Clock.advance(min, { fast })`; save `G.clock.min`.
- **Why:** the user's answers of 2026-09-26; backlog item 0, needed by police, brothel and saves.
- **Status:** active; T1-T5 built, not play-tested. Tint overlay (lilac dawn, gold afternoon) proposed by pixel-agent, not built

## 2026-09-26 · Gamepad L3 = horn on the ground, descend in a helicopter
- **Decision:** `PADMAP.descend = [10]`, sharing L3 with `horn`. Helicopters have no horn and only the
  flight code reads `descend`, so the two never clash. Climb stays on A/X (`fire`).
- **Why:** descend was keyboard-only, so a pad player couldn't land; the user asked to finish the copter.
- **Where:** `PADMAP` in src/core.js; README controls.
- **Status:** active

## 2026-09-26 · Weapons v2 + gun stores (spec: docs/specs/weapons-v2.md)
- **Decision:** six buyable weapons (pistol, uzi, shotgun, bazooka, grenades, molotovs); new ones are store-only.
  Five gun stores (`c.gunshops`); walking onto the door mat opens `src/shop.js`, which pauses the world. Keys 1-7 select
  weapons (Digit0 stays mute), Backspace/Esc leave the store. `START_MONEY = 10000`. Tank armour vs fire/rockets is
  ×0.35 in weapons code (`rocketBlast`, `updateFires`); vehicles-agent may move it into a shared helper later.
- **Status:** active; play-tested and approved by the user 2026-09-26

## 2026-09-26 · Big things at world scale; Beira-Rio stadium (spec: docs/specs/scale-stadium-v1.md)
- **Decision:** airliner ≈ 272×256 px and propplane on sheet `planes`, container ship 176×960 on `ships`, boats and cranes on
  `boats`; runway 17 tiles wide, harbour basin 15. The stadium is an oval bowl under a white leaf roof, with lights in the rim
  and no floodlight towers.
- **Why:** the user found ships and planes too small next to cars, and the old stadium "weird".
- **Status:** active

## 2026-09-26 · Sound v1 implemented (synthesised, src/audio.js)
- **Decision:** all spec §5 sounds are Web Audio synthesis in `src/audio.js`, with no samples. Buses: `master → { sfx, ui, music, amb }`.
  Hooks are one-line `Sound.*` calls in game.js and missions.js; phone and vehicle sounds are read from state. `soundboard.html` is the review page.
  Volume and mute persist in localStorage `pastelcity.sound`. Future traffic must set `car.driver` on moving NPC cars to get engine sound.
- **Status:** active; play-tested and approved by the user 2026-09-26

## 2026-09-25 · Sound v1 started; keys H / - / = / 0
- **Decision:** the user unlocked sound (spec docs/specs/sound-v1.md). Keys: H = horn (a tap toggles the
  siren on police/ambulance), - / = volume, 0 mute; pad L3 = horn. Radio stays on hold.
- **Status:** active

## 2026-09-25 · Big-world engine: lazy chunks + spatial indexes
- **Decision:** the ground is baked lazily in 512 px chunks (LRU 64) with per-chunk decal replay; everything
  drawn per frame goes through `Render.idx` spatial indexes. New world data: `sprites`, `trafficLights`, `cables`,
  building `roofProps`/`roofTalls`, the `stadium` roof, talls with `sheet`/`light`, `KIND_COLOR`, `placeAt`, `places`.
- **Why:** World v2 is ~6× the old area; baking it all at once would take ~600 MB and seconds.
- **Status:** active

## 2026-09-25 · World v2: three cities, regional road profiles, landmarks (spec: docs/specs/world-v2.md)
- **Decision:** a 768² tile world laid out like `refs/city.png` (Major City NW, Side City E, Main City SW,
  Ironworks centre, 3 rural zones), with nature filling the gaps (sea and a bay, islands, forest, desert, lakes).
  9-tile road bands with profiles: avenue / street / rough / dirt / highway. 11 landmarks. Named
  neighborhoods and streets, plus `docs/geography.md`.
- **Why:** the user's brief for this iteration; they want to address specific places by name later.
- **Parking:** scenery only (bays, meters, ticket machines, signs); no fines, as the user confirmed.
- **Status:** active

## 2026-09-25 · Project organisation under `.claude/`
- **Decision:** a lean root `CLAUDE.md`; rules in `.claude/rules/` (path-scoped where it makes sense);
  six agents in `.claude/agents/` with `memory: project`; decision logs in `.claude/agent-memory/`;
  the `/commit` skill.
- **Why:** the user wants important files, memory and agents organised inside the repo.
- **Status:** active

## 2026-09-25 · Ownership split between agents
- **Decision:** pixel = art/style, vehicles = vehicle stats and mechanics, weapons = weapons and
  damage dealt, geo = map and placement, sound = SFX engine and hooks, radio = stations (on hold).
  The coordinator keeps shared code (core, main loop, HUD, missions, phone, KEYMAP).
- **Why:** the user's brief: "when a new vehicle is made, pixel wires the art, vehicles wires the
  stats; same logic applies for everything else".
- **Status:** active

## 2026-09-25 · Scope limits
- **Decision:** no traffic or pedestrians yet; radio on hold; sound pending the user's go. Each
  iteration targets gameplay and aesthetics.
- **Status:** active
