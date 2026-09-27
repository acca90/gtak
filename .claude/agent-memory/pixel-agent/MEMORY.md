# pixel-agent — decision log (index)
Format and rules: `.claude/rules/decisions.md`. Newest first. Full entries (why, where, limits) are in
`decisions-log.md` in this folder: read the entry there before changing anything it covers, and add
new entries there AND a line here. Status is active unless marked.

- 2026-09-27 · **Mobs:** `peds:moretti0/1, orlov0/1, orchid0/1` (ped tags + `_shotgun`); read = hair on torso
  colour (Orlov hair ash-platinum, not gold); `PAINTS` 10 NOIR, 11 ORCHID (append only).
- 2026-09-27 · **Paint shop:** respray = `carpaint` shade masks tinted by compositing (no exact-colour swap, no
  getImageData); `PAINTS`/`CAR_BODY`/`Assets.painted` in core.js; wall/roof `paintshop`, `paint` sheet mat.
- 2026-09-27 · **Cops:** `peds:cop0..2_*` (+`_shotgun`, no cower), white-topped cap so heads read; `player:down`.
- 2026-09-27 · **`ships:container_ship_empty`:** the same ship with hatch covers in all 8×6 slots; boxes = `port:container_*` at geo slots.
- 2026-09-27 · **Crane parts** (ambient-v1 X2): `boats:crane_gantry` (0 lamps dark / 1 lit) plus the
  `port` sheet 48×96 (`crane_trolley`, `crane_spreader`, `container_<7 colours>` = ship deck box
  26×71). Lamps are at local (±11.5, −101.5); the trolley runs over y ∈ [−93, +80]; parts are placed
  in the crane's LIFTED frame.
- 2026-09-27 · **Peds v1:** `peds` 16² (`ped0..9` × idle/walk/run/punch/shoot/cower/down/dead,
  `burning`, `burnt`); `animals` 24×32 cow/bull; `player:punch`; `props:wallet`. Blood =
  `Render.BLOOD` deep reds outside the palette. Figure code sits in a `do…end` (Lua 200-locals limit).
- 2026-09-26 · **Tank = M1 Abrams in desert sand** (`sandTone` t→S); hull 36×60, turret pivot at (24,36).
- 2026-09-26 · **Day cycle:** DUSK ambient `#f0b096`, LOOK_KEYS shaped by eye (time-v1 T4).
- 2026-09-26 · **`tiles:runway`** frame 4 = east edge (mirror of 3); the propplane faces up.
- 2026-09-26 · **Ships and planes at world scale:** `planes` 288², `boats` 64×208, `ships` 192×976.
  The committed fx/heavy/wide differ from a fresh generation: never `regenerate` them blindly.
- 2026-09-27 · **Stadium = oval Beira-Rio:** procedural leaf roof + oval wall slices (`stadiumWall`), corners are ground (see coordinator log).
- 2026-09-26 · **Sign neon:** gun stores use pink `PAL.z`; PAL mirrors the full Lua palette.
- 2026-09-26 · **Weapons v2 art:** the gun store kit, `shop` sheet 64×32, icons with the muzzle right.
- 2026-09-25 · **World v2 art:** `_h` road tiles = transpose of `_v` (sheet sizes superseded).
- 2026-09-25 · **roof_stands:** rows run parallel to the nearest edge.
- 2026-09-25 · **Landmark facades** use the `civic` / `hangar` kinds (8-frame contract).
- 2026-09-25 · **Facades** are drawn at a whole-number squash per storey (no window shimmer).
- 2026-09-25 · **Scale:** 16-px tiles, 32-px storeys, sedan 26×52, player ~10 px wide.
- 2026-09-25 · **Style:** pastel modern-retro, top-left light, 1-px `K` outline, dithering only on organic shapes.
- 2026-09-25 · **Pipeline:** procedural Lua seeds editable .aseprite files; tags are the API.
- **Standing rule:** new generator code must not call `R()` (sheets after it must stay byte-identical;
  verify with a forced scratch generation plus `cmp`).
