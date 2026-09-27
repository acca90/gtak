# pixel-agent — full decision entries
Format: `.claude/rules/decisions.md`. Newest first. The index with one line per entry is MEMORY.md.

## 2026-09-27 · Mob outfits (gangs-v1 G2) and paints NOIR (10) / ORCHID (11)
- **Decision:** `peds` gains `moretti0/1`, `orlov0/1`, `orchid0/1` (appended after `cop2_shotgun`),
  16 frames each: ped<k>'s 8 tags (incl. `_cower`) + `_shotgun` (the cops' long-gun pose). The read is
  **head colour on torso colour**, since the head hides most of the torso from above:
  Moretti = black hair on red tee `{r,R,R}` (no `p` highlight, so it's deeper than the farmer's and
  blouse's `{r,R,p}`); 0 = slicked hair (comb line + `b` sheen) + 2-px gold chain + bare forearms
  (`cuff`), 1 = dark waistcoat panels on the shoulders (`vest`, 1 px each side at cx-4/cx+3;
  2-px panels plus a hem turned the torso black). Orlov = **ash-platinum** hair `{s,S,Y,c}` on black
  `{K,k,a,d}` (the `HAIRS.blond` gold matched the yellow hard hats of ped3/ped7); 0 = tracksuit with a white
  `x` stripe down each sleeve (`track`), 1 = leather jacket with a `d` collar. Orchid = black hair on purple
  `{u,U,U}` (`{K,u,U}` read black; lilac `{u,U,P}` is the ped2 dress); 0 = short cut + bare forearms,
  1 = ponytail + bomber with a `K` rib hem (`hem`). New fig/details options (`slick`, `chain`, `vest`,
  `hem`, `track`, `cuff`) are nil for every older outfit: old frames verified pixel-identical.
- **Paints:** `PAINTS[10] NOIR ['#767c9a','#3c3f58','#1c1e2c']` (the light tone is kept high so the
  roof/rim still reads under the NIGHT multiply), `PAINTS[11] ORCHID ['#c77fe6','#8b3cb8','#4f1a78']`
  (clearly apart from LILAC). Ids are stored on cars: append only.
- **Status:** active

## 2026-09-27 · Paint shop (paintshop-v1 S2): mask-sheet respray, PAINTS in core.js
- **Decision:** a respray is NOT an exact-colour swap. Sheet `carpaint` (32×64) holds, per
  paintable tag (hatch sedan sport muscle suv taxi pickup van), the body-ramp pixels split into
  3 frames **light, mid, shadow** (in the stock body colours). `Assets.painted(sheet, tag, id)`
  (core.js, `PAINT_MASKS = { cars: 'carpaint' }`) tints each mask frame to `PAINTS[id].ramp[j]`
  with `source-in` and draws it over every frame of the tag except the wreck. Masks come from
  redrawing `carImage` with sentinel body colours (C["#1..3"], removed afterwards).
- **Why:** exact matching recolours the wrong pixels: muscle body = glass colours (k/B/C),
  suv body d = trim/rails, sport body r/R/p = tail lights. And `getImageData` on file:// images
  throws (tainted canvas), so the recolour must be compositing only.
- **Colours:** `PAINTS` (10: CANDY PINK, MINT, SKY, LILAC, LEMON, PEACH, CREAM, TEAL, CHERRY,
  SLATE) are runtime hex ramps [light, mid, shadow], not palette chars (like `Render.BLOOD`).
  `CAR_BODY[tag]` = the Lua `body` reversed, built from `PAL`; keep it in sync with CAR_SPECS.
- **Look:** `wall_paintshop` (kind `paintshop`, a `KIND_FRAMES` field to spare a local),
  `roof_paintshop` (hribs, frame 10 = extraction fan, variant 4), `paint` sheet 16²: `bay_mat`
  9-slice + `bay_icon` 2×2 spray-gun stencil, baked as a `paintbay` paint op from
  `c.paintshops[].bay` in `buildIndexes`. `paintshopFaces` puts the door on the module nearest
  the bay. PAINT sign = one neon colour per letter. `Parts.spray(x, y, ang, ramp)` = tinted fx
  smoke puffs + 2-px flecks. Gallery: `gallery.html#paints` (every model × every paint, day/dusk/night).
- **Status:** active

## 2026-09-27 · Cops (cops-v1 K2) and `player:down`
- **Decision:** `peds` gains `cop0..cop2` (appended after `burnt`): `_idle` 1, `_walk` 4, `_run` 4,
  `_punch` 2, `_shoot` 1, `_down` 1, `_dead` 1, `_shotgun` 1 (no cower). Navy `k/w/B/W` jacket,
  navy trousers, **white-topped** peaked cap (`m/l/x`, navy band, black peak, gold `L` badge),
  gold shoulder glint. cop1 = female (ginger ponytail), cop2 = light-blue shirt sleeves, deep skin.
  A navy cap was tried first and vanished into the navy torso; the white crown is what makes the
  head (and "cop") read at 1×. The cap lies beside down/dead bodies. `player:down` (1 frame) =
  `lying(PLAYER_FIG, "down")`, appended after `punch`.
- **Status:** active

## 2026-09-27 · `ships:container_ship_empty`: same ship, closed hatch covers in all 48 slots
- **Decision:** `ships` gains `container_ship_empty` (appended). It is drawn by `shipImage(empty)`,
  the same code as `container_ship` (which stays pixel-identical). Every slot is a slate `A` hatch
  cover (26×71, K gap), with `a` ribs along the long axis, `d` twistlock sockets at the box corners
  and a light seam after rows 2 and 5. Loaded boxes are `port:container_*`, drawn at `c.port.ship.slots`
  (x, y, ang); verified flush in a composite.
- **Status:** active

## 2026-09-27 · Crane parts (ambient-v1 X2): `boats:crane_gantry` + new `port` sheet 48×96
- **Decision:** `boats:crane` is unchanged (static fallback). `boats:crane_gantry` (2 frames:
  0 = lamps dark, 1 = lit) is the same crane minus the trolley, spreader and cab, with the same
  64×208 cell and centre anchor. Both are drawn by one `craneImage(part, lamp)`. Sheet `port`
  (48×96, centred): `crane_trolley` (the cab rides with it), `crane_spreader` (an open I-frame,
  long axis up, drawn OVER the box), and `container_red|teal|blue|yellow|purple|grey|brown`, the
  ship's deck box exactly (26×71 plus outline), long axis up. The spreader and the box are drawn
  at the ship's angle, not the crane's.
- **Contract:** crane-local, boom up. The warning lamps are at (±11.5, −101.5) from the centre.
  The trolley centre travels over local y ∈ [−93, +80]. Parts must be placed in the crane's
  LIFTED frame, `lift(craneCentre, 150) + rotate(localOffset)`, not with `lift()` per world point
  (that is off by up to ~18 px at the boom tip). A hanging load sits at the lerp from its ground
  point to the trolley's screen point by h/150.
- **Status:** active

## 2026-09-27 · Peds v1 art: `peds` 16², `animals` 24×32, blood is deep red outside the palette
- **Decision:** `peds` has 10 outfits `ped0..ped9` (teal jacket, suit, lilac dress + long hair,
  hi-vis + white hard hat, farmer + straw hat + overalls, mint hoodie, blouse + skirt + ponytail,
  grey coveralls + yellow hard hat, bald biker in black leather, old lady + bun). Each has
  `_idle` 1, `_walk` 4, `_run` 4, `_punch` 2 (0 = arm out, 1 = guard), `_shoot` 1, `_cower` 1,
  `_down` 1 (on its back), `_dead` 1 (face down, sprawled, NO blood); shared `burning` 3, `burnt` 1.
  Standing peds are built by `fig()`, which copies `person()` (head at the cell centre), so they
  match the player. Lying bodies are 14 px long, head up. Peds get a 2-px skin "face" sliver at
  the front of the head; the player doesn't. No ped wears orange (that's the player's colour).
  `animals` cells are 24×32 (a cow is ~10×28 at sedan scale; 16² was toy-sized) and keep the
  props:cow look: `cow_/bull_` `idle` 2, `walk` 4, `run` 4, `dead` 1 (on its side, legs right).
  `props:cow` stays. Player `punch` (2 frames) is appended after `dead`.
- **Blood:** `Render.BLOOD = ['#650d1b','#8f1b29','#bf3f4b']` (body, rim, sheen) are NOT palette
  colours: the palette reds (`r`, `R`) read pink/plum. Opaque, whole-pixel runs, painted with
  `Render.paint`. Pool shapes come from a seed (`bloodShape`), so a growing pool and the committed
  one match.
- **Rule:** the figure/peds/animals code is in one `do … end` block (the main chunk hit Lua's
  200-locals limit) and uses no `R()`; every other sheet still generates byte-identical (verified).
- **Status:** active

## 2026-09-26 · Tank look = M1 Abrams in desert sand (mid tone `S`, not `t`)
- **Decision:** `tank:hull`/`turret` are an Abrams: slab skirts over the tracks (7 panels,
  track ends show front/rear for the moved frame), a sloped glacis, a driver hatch with 3
  periscopes, 2 louvred engine grilles plus a rear exhaust grille. The turret is a wide, flat
  30-px slab with a shallow front chevron and a mantlet slot, a 2-px gun with a bore evacuator,
  the GPS doghouse front right, a commander's cupola with a .50 cal on the right, the loader's
  hatch and MG on the left, the CITV, and a bustle rack with olive bags. Colours are sand
  `T/S/s`, and the hull deck is one step darker than the turret. `sandTone()` shifts `t→S`
  and `S→s`, because the lighter `t` mid disappeared on the cream spawn paving.
- **Contract kept:** hull 36×60 centred; turret pivot at cell (24,36); gun tip on row 0
  (= the 36-px muzzle in `fireCannon`). No footprint change.
- **Rule:** the new wrecks use `wreckify(im, localRnd(seed))`. `burnOldWreck(2276 / 605)`
  replays the old tank's `R()` draws, so the sheets after `tank` regenerate byte-identical
  (verified with a full forced run into a scratch root).
- **Status:** active

## 2026-09-26 · Day cycle: DUSK ambient `#f0b096`, LOOK_KEYS shaped by eye (time-v1 T4)
- **Decision:** `TIMES[1].ambient` warmed from `#e8aaa0` (salmon) to `#f0b096` (peach-rose) so
  golden afternoon and sunset read warm, not pink-grey. NIGHT unchanged (`#2f3572`). `LOOK_KEYS`
  (src/clock.js, the only part of that file I own): full day 08:30-16:00; golden afternoon stays
  light (17:30 s 0.2, 17:45 about 0.28); sunset s 0.9 at 18:30; 19:00-22:00 spaced evenly
  (1.2, 1.4, 1.58, 1.82, 2); dawn is 1.75 at 05:15, 1.4 at 06:00, 0.8 at 06:30, day by 08:30.
- **Why:** multiply-only ambient dims everything, so s above ~0.3 in the afternoon looks grey.
  The blue end of DUSK to NIGHT darkens fast, so the evening keys are packed tighter near night.
- **Limit:** with 3 looks, dawn can't be truly lilac. It uses the DUSK to NIGHT blend (s 1.1-1.4
  reads mauve-rose), then briefly peach. A real lilac dawn or gold needs the §4 `tint` overlay
  (proposed to the coordinator, not built).
- **Status:** active

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
