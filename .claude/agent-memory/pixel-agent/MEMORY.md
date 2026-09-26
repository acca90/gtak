# pixel-agent — decision log
Format and rules: `.claude/rules/decisions.md`. Newest first.

## 2026-09-26 · `tiles:runway` frame 4 = east edge (frame 3 mirrored); propplane faces up
- **Decision:** runway frames are 0 plain, 1 centre dash, 2 threshold, 3 west edge (line on the
  tile's left), 4 east edge (line on the right, the exact mirror of 3). Frame 4 is appended, so
  0–3 are unchanged. `planes:propplane` faces up like every sprite (checked in game: `ang 0`
  points north); a report that it faced east was a misreading, so the art was not rotated.
- **Status:** active

## 2026-09-26 · Ships and planes at world scale: `planes` 288², `boats` 64×208, `ships` 192×976
- **Decision:** docs/specs/scale-stadium-v1.md §3. `planes`: airliner (272 long × 256 span),
  propplane (112 × 144). `air` = `helicopter` only (112², a vehicle, unchanged). `ships` =
  `container_ship` only (176 × 960, 8 bays × 6 boxes of 27×72, yard container style).
  `boats`: yacht 56×192, sailboat 40×128, motorboat 32×88, crane. All face up, centred.
  Crane: boom up (toward the water); waterside legs at cell y 188 (+84 from the centre),
  landside at y 200; boom tip at y 2, so the outreach is about 186 px.
- **Rule:** the new sections don't call `R()`. The ship section replays the old ship's
  `math.randomseed(314)` draws so the sheets after it (fx, font) regenerate byte-identical (verified).
- **Note:** the committed `fx`, `heavy`, `wide` and `tank` differ from a fresh generation, so
  never `regenerate` them blindly.
- **Status:** active

## 2026-09-26 · Stadium look = Beira-Rio: oval leaf roof drawn in code, esplanade on the plinth
- **Decision:** `Render.stadiumRoof(b)` is fully procedural (no roof tiles): a white scalloped
  leaf ring (N ≈ perimeter/20 leaves, steel ribs, overlap shadows), a steel inner rim with one
  lamp per leaf, red tiered seats with white aisles and a tier walkway, a pitch with ad boards,
  and argyle cream paving in the footprint corners with a pink curb. `stadiumGeom(b)` is shared
  by the glow (floodlight spill 0.3 on the roof, the opening at 0.85, rim lamps `j`) and by the
  sign (on the south roof ring). `wall_stadium` = civic `tex="ribs"`, red band, arched openings
  showing red seats (`seats=true`). `roof.ring` is no longer used. `roof_stands` stays (unused).
- **Why:** the user's brief: "take the Beira-Rio as inspiration".
- **Status:** active

## 2026-09-26 · Rooftop sign neon: gun stores pink (`PAL.z`); PAL gains `s S i`
- **Decision:** `drawSign` uses `z` for `wall === 'gunshop'`. PAL now mirrors the Lua palette
  fully (`s`, `S`, `i` were missing).
- **Status:** active

## 2026-09-26 · Weapons v2 art: gun store kit, new `shop` sheet 64×32, icons muzzle-right
- **Decision:** docs/specs/weapons-v2.md §5 tags exist: `wall_gunshop` (kind `gunshop`: riveted
  steel `A/b/a`, green band + `p` stripe, barred windows, target decal, steel door under a warm
  transom), `roof_gunshop` (tread plate `pat="plate"`, pink cap, frame 10 = hatch via `alt=3`),
  props `gunshop_door` (2 frames, 500 ms, chevrons point **up = into the store**), `icon_*`,
  `rocket` (nose up), `grenade_proj`, `molotov_proj` (2 frames). Sheet `shop` = side-view
  catalogue art, muzzle right, transparent bg. No olive colour added: `g/G/h` stands in.
- **Why:** tags are contracts for weapons/geo/coordinator code.
- **Rule:** new art is written without `R()` so it doesn't shift the RNG stream of sheets
  generated later (regenerating an old sheet must reproduce it byte-for-byte; verified).
- **Player:** only `idle/walk/shoot/dead`, no per-weapon poses; `shoot` is used for every gun.
- **Status:** active

## 2026-09-25 · World v2 art: new sheets `air` 112×112 and `ships` 64×224; tag set from world-v2 §5
- **Decision:** all docs/specs/world-v2.md §5 tags exist with the spec'd frame counts. `air` and
  `ships` sprites face up and are centred in the cell (the anchor is the cell centre). `_h` road
  tiles are always the exact transpose of `_v`. The crane's boom points up (toward the water),
  with the portal legs in the lower half of the cell.
- **Why:** geo-agent and render code against these names and orientations.
- **Where:** tools/generate-art.lua ("world v2" sections, `addVH`, `shape`, `hullMask`).
- **Status:** superseded by 2026-09-26 · Ships and planes at world scale (the sheet sizes and which tags live where changed; `_h` = transpose rule still active)

## 2026-09-25 · roof_stands rows run parallel to the nearest edge
- **Decision:** in `roof_stands`, seat rows follow the nearest roof edge (the corners get L-shaped
  rows). Centre frames (4, 9, 10) all have horizontal rows, with no drain or patch variants.
  Each 4-px row cycles colour, and the rim is only 2 px, so an edge frame repeated inward stays
  continuous. The stadium ring should repeat edge frames inward, not use centre frames on the
  E/W sides.
- **Why:** the 9-slice has no orientation for centre tiles; the render composes a 5-tile ring.
- **Status:** active

## 2026-09-25 · Landmark facades use the `civic` / `hangar` kinds
- **Decision:** stadium, police, hospital and station use `civicFrames` (options: tex, band,
  tint, arch, open, ground). Hangar is the shed plus teal sliding doors on the ground module.
  Terminal is the `glass` kind with blue frames. All follow the 8-frame contract.
- **Status:** active

## 2026-09-25 · Facades are drawn at a whole-number squash per storey
- **Decision:** walls are composed from 32-px storey modules squashed to `k = floor(visible/floors)`
  rows; leftover rows become a cornice. Don't sample a full-height texture per row.
- **Why:** row sampling made windows and doors blink as the camera moved (the user reported it).
- **Where:** `Render.squashed/facade/drawBuilding` in src/render.js.
- **Status:** active

## 2026-09-25 · Scale: 16-px tiles, 32-px storeys, sedan 26×52, player ~10 px wide
- **Decision:** everything is drawn at this scale. Vehicle sheets are `cars` 32×64, `heavy` 36×168,
  `wide` 48×96, `tank` 48×72, `rail` 40×128; big props are 48×48.
- **Why:** the user asked for bigger objects and wider walkways (room for pedestrians later).
- **Status:** active

## 2026-09-25 · Style: pastel modern-retro, top-left light, 1-px dark outline
- **Decision:** a fixed palette (generate-art.lua `PALETTE` = `PAL` in core.js); light from the
  top-left; `K` outline on all sprites; ordered dithering only on organic shapes; the reference
  mood is the images in `refs/` (cozy pixel cityscapes, pastel teal/pink/cream).
- **Why:** the user's references and the brief: "modern retro", not muddy GTA1 greys.
- **Status:** active

## 2026-09-25 · All art is procedural Lua seeding editable .aseprite files
- **Decision:** `tools/generate-art.lua` seeds `art/*.aseprite`, which are the sources the user can
  repaint in Aseprite; `tools/art.sh` exports. Tags are the API and are never renamed.
- **Why:** the user wants Aseprite as the art tool while still getting art generated automatically.
- **Status:** active
