# coordinator — cross-cutting decisions
Written by the main session (not a subagent). Format: `.claude/rules/decisions.md`. Newest first.

## 2026-09-26 · Weapons v2 + gun stores (spec: docs/specs/weapons-v2.md)
- **Decision:** six buyable weapons (pistol, uzi, shotgun, bazooka, grenades, molotovs); new ones are store-only.
  Five gun stores (`c.gunshops`); walking onto the door mat opens `src/shop.js`, which pauses the world. Keys 1-7 select
  weapons (Digit0 stays mute), Backspace/Esc leave the store. `START_MONEY = 10000`. Tank armour vs fire/rockets is
  ×0.35 in weapons code (`rocketBlast`, `updateFires`); vehicles-agent may move it into a shared helper later.
- **Status:** active; not play-tested

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
- **Status:** active; not yet listened to by the user

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
