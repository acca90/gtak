---
name: graph-contracts
description: Full field-level contracts of the traffic lane graph (c.lanes/c.nodes) and the pedestrian walk graph (c.walks/c.walkNodes/c.pens) built in src/city.js
metadata:
  type: project
---

Full text of the two graph-contract decisions; the short entries live in MEMORY.md.

### 2026-09-27 · Pedestrian walk graph, cow pens and ped zones (peds-v1 P1)
- **Decision:** `City.buildWalks` (after `buildLanes`, no RNG) fills `c.walks` `{ id, x0, y0, x1,
  y1, len, zone, from, to, xing? }` (axis-aligned, x0<=x1, y0<=y1) and `c.walkNodes` `{ id, x, y,
  edges }`. Walks run on the sidewalk ring's centre line (ring*8 px in from the block edge).
  Crossing edges are **only the road stretch** (kerb node to kerb node); `xing.axis` = the axis of the
  road crossed (a horizontal edge crosses a 'v' road); `xing.node` = the lane node id when the
  junction is signalised (cross while `Render.signalFrame(axis) === 0`), else null. Crossing sites:
  both zebras of every avenue grid run (at 24 px into the zebra), one corner per street/rough grid run
  (the end at the busier junction), court mouths, and Marina Drive on the boardwalk. Extras through
  `c.walkLines` (deleted after build): plaza fountain loops, the boardwalk plus connectors, the
  terminal kerb, farm-track pluses and farm-town loops. Lines are split at T-junctions, cut at
  WATER/BUILDING/BRIDGE/highway/level-crossing tiles; RAIL on a ring is allowed (a sidewalk level crossing).
  Crossings or connectors left hanging are pruned, as are islands under 64 px.
  Queries: `walksIn(x0,y0,x1,y1,out)` (16-px margin, 128-px cells), `walkAt(x,y,r=24)` returns `{ walk, x, y, t, d }`.
  `c.pens` `{ id, x0, y0, x1, y1, cows, spots }` replace the cow props (16-px margin inside the fence;
  pasture farms start below the barn at A.y+7); `spots` keep the old R() draws so nothing moves.
  `ZONES[z].peds` from spec §2.1 (highway and wild: density 0). Street furniture was moved off the walk
  lines: downtown ticket machines and bins to 40 px inset, the avenue's far lamp from l=18 to l=17
  (no-parking sign to l=16), suburb corner hydrants 5 px from the kerb, payphones at T(y1-ring)+4.
- **Why:** task P1 of docs/specs/peds-v1.md; the coordinator's src/peds.js and traffic build on it.
  Don't rename fields. geo-report `--check` validates the graph and pens.
- **Where:** `buildWalks`, `walksIn`, `walkAt`, `drawWalks`, `pen`, `walkLine` in src/city.js; `#demo&walks`.
- **Status:** active

### 2026-09-26 · Traffic lane graph: contract and lane offsets
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

### 2026-09-27 · Airport and port route data (ambient-v1 X1), full shapes
All px; angles 0 = north, clockwise (sprite convention).
- `c.airport.runway = { x0, y0, x1, y1, cx, heading: 0 }` (cx = centre line x 744).
- `approach = { from, touchdown, rollEnd }` along x = cx going north (from off the south coast;
  touchdown 248 px in from the south end; rollEnd 106 px short of the mid exit link).
- `depart = { lineup (548 px in from the south end), rotate, climb (800 px north of the runway) }`.
- `stands[i] = { id, kind: 'gate'|'remote'|'prop'|'runway', x, y, ang, tag: 'airliner'|'propplane', sprite, obstacles }`,
  ids in c._planes order: 0-2 gates (nose east), 3 remote (nose north), 4 prop (nose west), 5 prop (nose north), 6 runway.
- `taxi.in[id]`: rollEnd -> mid link -> parallel taxiway -> stand (none for 'runway').
  `taxi.push[id]`: reversing path from the stand ([] = none). `taxi.out[id]`: push end (or the stand) ->
  taxiway -> south link -> lineup.
- `c.port.rail = { y: 11416 (the legs), x0: T(268), x1: T(332) }`; `cranes[i] = { id, x, y (sprite), bays: [x],
  bayMin, bayMax, sprite, legs }` (bays split 3/3/2 over the ship's 8; ranges >= 52 px apart);
  `ship = { x, y, ang: PI/2, slots: [{ x, y, ang, bay, row }] }` (48); `quaySlots` = { x, y: T(716)-18, ang }
  midway between the bollards inside the rail span (9).
