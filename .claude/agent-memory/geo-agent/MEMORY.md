# geo-agent — decision log
Format and rules: `.claude/rules/decisions.md`. Newest first.

## 2026-09-26 · Traffic lane graph: contract and lane offsets
- **Decision:** `City.buildLanes` (last step of `build`, no RNG) fills `c.lanes` / `c.nodes`
  with the B1 contract of docs/specs/traffic-v1.md: lanes `{ id, x0, y0, x1, y1, dx, dy, len,
  zone, profile, from, to, stop, axis, off, street, yield, xings? }`, nodes `{ id, x, y, kind
  'int'|'turn', signal, arms, profile, exits: [{ from, to, turn, path }], loop? }`.
  Right-hand traffic (southbound lanes on the west half, eastbound on the south half, which
  matches the avenue stop lines in `resolveFrames`). One edge per straight run between boxes
  (collinear runs chained: Route 1 + bridge). Offsets from the centre line: avenue 20, street 17,
  rough 20, dirt 16, court 16, highway 44 (outer of the 2 painted lanes; the art has 2 per side,
  not 3). Dead ends and cul-de-sacs get a 'turn' node with a loop (counter-clockwise on
  screen) on the edge's centre line: 56 px (band half-width 72, or bulb r 80 minus the 8-px
  stem/bulb misalignment and a 28-px car); smaller loops made cars run wide (2026-09-26 fix). Signal = avenue box, 3+ arms, lights still standing. `stop` = front-bumper point:
  3 tiles before the box on avenue grid runs (the painted line), else 4 px; null at <3 arms.
  `yield` everywhere at unsignalised 3+ arm nodes except the two arms of a through road that
  outranks the rest. Lanes stop at box edges; exits carry the path through the box.
  Index: 128-px cells; `laneAt(x, y, r=24, dx, dy)`, `lanesIn(rect)`, `drawLanes(ctx, rect)`.
  Street curb spots moved to across 1.5/7.5 (on the verge), rough to 1/8 (gravel shoulder,
  4 px clear of a 32-wide heavy in the lane), so parked cars leave the lanes clear; `curbSpot` accepts VERGE. geo-report `--check` verifies
  the graph.
- **Why:** task B1 (traffic unlocked by the user 2026-09-26); vehicles-agent and the coordinator
  build against the contract, so don't rename fields.
- **Where:** `buildLanes`, `laneAt`, `lanesIn`, `drawLanes` in src/city.js; `ZONES[z].traffic`.
- **Status:** active

## 2026-09-26 · Far fewer parked cars: ~130 at start, a share per district and spot kind
- **Decision:** `c.parked` is thinned after naming (it needs `placeAt`) to ~130 (129 on the game
  seed; was 392). Always kept: police, ambulance and PCTV van spots, helicopters. The rest keep
  `round(n * rate)` per district and spot kind, min 1: curb 0.08, driveway 0.1, stall 0.2,
  yard 0.3, fixed-model spots (farms, depots, airport, taxi ranks) 0.3; x1.25 if most of the group
  is within 900 px of the spawn; picks spaced >= 96 px first. `parkSpots`/`stalls` are unchanged
  (AOV refills and missions use them as candidates).
- **Why:** the user (2026-09-26) asked to highly reduce parked cars; traffic (spec traffic-v1
  phase B) fills the streets instead. Task A4.
- **Where:** block after `mark('names')` in `City.build`, `KEEP` table.
- **Status:** active. Supersedes the "at most about 380 parked cars" part of "Build budget".

## 2026-09-26 · No spawn spot on water or in a wall
- **Decision:** after placement, `parked`, `stalls`, `parkSpots`, `roadSpots`, `crateSpots` and ground
  `heliSpots` are filtered to dry, non-building tiles (roof helipads excepted), and
  `geo-report --check` fails if any slip through. Generators must still place lots on land only.
- **Why:** the user saw an SUV in the sea: the marina car park's stalls were on water, and
  traffic respawns into stalls.
- **Status:** active

## 2026-09-26 · Full-scale ships and planes: port, marina, airport sizes
- **Decision:** sheets `planes` (airliner, propplane) and `boats` (yacht, sailboat, motorboat,
  crane); `ships` only holds `container_ship`. Airport: runway 17 wide (x 38-54), parallel taxiway
  11 wide (x 62-72), apron x 73-121 with an 11-wide taxilane, 3 gates 20 tiles apart (nose east
  to a 10x62 terminal), remote stand, hangars 16x12. Port: yard y 696-710, main quay 711-715 with
  3 cranes (ang PI, boom south) over the ship moored alongside, basin 716-730 (15 tiles), mole
  731-738. Marina: piers x 738/749/760 (pitch 11), boats only where the whole hull is water.
  `Render.buildIndexes` indexes sprites by their sheet cell size.
- **Why:** spec docs/specs/scale-stadium-v1.md §5 (the user wants big things to dwarf cars).
- **Status:** active. Supersedes the 9-wide runway and 11-tile basin of World v2.

## 2026-09-26 · Stadium: Beira-Rio surroundings, no floodlight towers
- **Decision:** the stadium stays on Major (5,2)-(6,3) in Bayview (already on the bay); it sits on
  a paved esplanade (oval paving bands, trees, benches, lamps) with car parks N and S, and a shore
  promenade east of the avenue. No corner `floodlight` talls (the lights are in the roof rim).
- **Why:** spec scale-stadium-v1 §4; moving the block would have restructured the grid.
- **Status:** active

## 2026-09-26 · Five gun stores
- **Decision:** `c.gunshops` ids 0-4: Pastel Arms (Major (2,5) shops strip, 11 tiles from the
  spawn), Seabreeze Ammo (Side (4,4) stores row), Union Firearms (Main (5,2) shops), Anvil Surplus
  (Ironworks (2,3)-(3,3) warehouse gate), Dusty Barrel (roadside on Route 6's south verge, x 466-491).
  All 8x5, door on the north side flush with the sidewalk; mat one tile out, ang 0; props and
  cars cleared within 20 px of the mat. goto: `Gun Store N` and `GUN STORE: <AREA>`.
- **Why:** spec docs/specs/weapons-v2.md §4.
- **Status:** active

## 2026-09-25 · World v2 layout: fixed grid origins so connections run straight
- **Decision:** 768x768 tiles. Grid origins (tiles): Major (150,69), Side (505,214), Main (179,484),
  all 7x7 at pitch 29. Ironworks (237,301) 6x5 at pitch 29. North Farms (534,30), West Farms
  (24,345) and SE Farms (494,480), all 3x3 at pitch 40. Airport x 30-176, y 495-725. The origins are
  chosen so the grid lines line up: Ironworks' vertical lines = Main's lines + 2, Major's line 5 =
  Ironworks' line 2, Major's line 6 = Side's line 1 (the bridge row, y 243), Side's line 1 = the NF
  and SE farm line at x 534. City corner blocks (0,0), (6,0), (0,6) and (6,6) are left wild.
- **Why:** follows `refs/city.png` and docs/specs/world-v2.md. Aligned lines give straight
  highways that join existing intersection boxes.
- **Where:** `G` in `City.build`. The full map is in docs/geography.md (`node tools/geo-report.js`).
- **Status:** active. Moving an origin breaks the highway alignment and the railway (RAIL_X 283
  must sit in Main's column 3 and Ironworks' column 1).

## 2026-09-25 · Road profiles on a 9-tile band; the network is stamped per tile
- **Decision:** every road is 9 tiles wide. The profile comes from the blocks each side
  (downtown → avenue, suburb → street, industrial → rough, rural → dirt), and highways join
  districts. Intersections take the biggest profile (avenue > highway > rough > street > dirt).
  Segments, boxes, highways and the railway are stamped into `net.v`/`net.h`/`net.box`/`net.rail`,
  and `roadAt()` reads them back. It is still the single source of truth.
  Sidewalks: 3 tiles downtown, 2 in suburbs and Ironworks, none on farms.
- **Why:** spec section 3, and the user's brief of cleaner and wider downtown streets, quieter suburbs,
  damaged industrial roads, dirt rural roads without sidewalks.
- **Status:** active. Supersedes "Street geometry: 7-tile roads" and "Four regions by quadrant".

## 2026-09-25 · Names: per-tile address maps, painted rects then BFS fill
- **Decision:** 15 districts and 54 neighbourhoods. Each city's core is split into row 2 and rows
  3-4, and its ring into N, E, S and W quarters. Neighbourhood rects don't overlap within a district
  (checked by geo-report). Natural features either get their own band rect or sit in another
  district (islands belong to Pastel Sea or Pastel Bay). Leftover tiles take the nearest
  neighbourhood by BFS. Every grid line has one street name across its whole length (the suffix
  follows its biggest profile). Name roots are drawn without replacement, so full names are
  unique. Highways are "Route N", the bridge is "Pastel Gate Bridge", and cul-de-sacs are "… Court".
- **Why:** spec section 8. The user wants to name places when asking for changes.
- **Status:** active

## 2026-09-25 · Build budget and prop counts
- **Decision:** `City.build` stays around 1 s in node, with a 1.5 s target. The noise is a seeded
  256x256 lattice (hashing per sample was about 5x slower), sampled only where it can change the
  result (the coast band, the desert corner). Keep about 8k trees, 2.5k props (the parked-car count is now set by "Far fewer parked cars").
- **Why:** car-vs-car collisions are O(n²) and game.js loops over all props every frame.
- **Status:** active

## 2026-09-25 · Fewer lamps, and street furniture is breakable
- **Decision:** lamps every 11 tiles on sidewalk rings (none on country roads); lamps, hydrants
  and bins break when hit at speed; trees stay solid. World v2 adds breakable parking meters,
  ticket machines, parking, speed and stop signs, cacti and mailboxes. Traffic-light poles and
  bollards are solid.
- **Why:** the user said lamps were too many for driving on the sidewalk.
- **Status:** active

## 2026-09-25 · Anchors (World v2)
- **Decision:** spawn = Central Park's south sidewalk (Major City, Parkside, Vanilla Avenue). The
  starter car is in the bay below it and the tank on the sidewalk 100 px east. Boost garage = the
  Dockside Works car park by the bay (Ironworks block 5,0). 8 payphones: one downtown in each
  city, one in Ironworks, one in each farm town, one at the airport. The railway is vertical at
  x 283-286 from the freight yard (y 372) to Union Station (y 567), with the station stop at y 540.
- **Status:** active. Supersedes "Fixed anchors" (block 4,4 / 9,1).

## 2026-09-25 · Four regions by quadrant, blocks merged by removing road segments
- **Decision:** NW Downtown, NE Ironworks, SW Maple Hills, SE Golden Fields on a 10x10 island.
- **Status:** superseded by 2026-09-25 "World v2 layout" (the segment-merge technique is kept per grid).

## 2026-09-25 · Street geometry: 7-tile roads, 3-tile sidewalks, 16-px tiles
- **Decision:** 7-tile roads, pitch 27, 10x10 grid, 3-tile promenade.
- **Status:** superseded by 2026-09-25 "Road profiles on a 9-tile band".

## 2026-09-25 · Fixed anchors
- **Decision:** spawn at block 4,4, garage at Ironworks block 9,1.
- **Status:** superseded by 2026-09-25 "Anchors (World v2)".
