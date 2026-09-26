# Spec: World v2 — three cities, regional roads, landmarks

Status: **implemented** 2026-09-25 (see docs/geography.md for the result). Coordinator: main session.
Reference layout: `refs/city.png` (local only; it's gitignored).

This spec is the shared contract for pixel-agent (art), vehicles-agent (vehicles, train),
geo-agent (world generator) and the coordinator (engine/render). **Names in `code` are
contracts**: pixel creates exactly these sheets and tags, geo and render use exactly these
names. If something is unworkable, report it; don't rename it.

## 1. The user's brief

1. Roads differ by region:
   - **Downtown:** cleaner, wider streets with traffic lights, parking bays,
     parking meters and ticket machines (**scenery only**, no fines), and signs.
   - **Suburbs:** slightly narrower roads with few signs.
   - **Industrial:** damaged, dirty roads.
   - **Rural:** dirt roads (earth), no sidewalks.
2. Landmarks: football stadium, train station, police station, TV HQ, a very long Golden Gate–like
   bridge, a large Central Park–like park, a beach, an airport, a port, a marina and a hospital.
3. Bigger world laid out like `refs/city.png`: **three cities** (Major City NW, Side City E,
   Main City SW), each a downtown core ringed by suburbs; an **industrial zone** in the middle;
   **three rural zones** (N, W, SE). Everything in between is filled with nature: sea and bays,
   islands, forest/wild areas, desert, lakes ("fill the dark place with random stuff").
4. Scope stays: no traffic, no pedestrians, sound not yet, radio on hold.

## 2. World layout (geo-agent)

- Tile 16 px. World **768 × 768 tiles** (12,288 px). The sea surrounds an irregular mainland
  (noise coastline), with a few islands offshore.
- Approximate district centres (tiles) and sizes. Geo may shift them to make the coast and
  roads work, but must keep the relative arrangement of `refs/city.png`:

  | District | Kind | Centre (x,y) | Grid |
  |---|---|---|---|
  | Major City | city | (255, 175) | 7×7 blocks: 3×3 downtown core, 2-block suburb ring |
  | Side City | city | (630, 320) | 7×7 blocks (same structure) |
  | Main City | city | (285, 590) | 7×7 blocks (same structure) |
  | Ironworks | industrial | (340, 390) | ~4×3 big blocks (long lots) |
  | North Farms | rural | (600, 85) | ~3×3 big lots |
  | West Farms | rural | (75, 420) | ~3×3 big lots |
  | South-East Farms | rural | (520, 540) | ~3×3 big lots |

- A **bay** (sea inlet from the north coast) between Major City and North Farms/Side City. The
  highway Major City → Side City crosses it on the **long bridge** (≥ 120 tiles of deck).
- Nature fill (seeded noise): forest wilds (`forest` ground + `pine`/`tree_a`, dirt trails),
  meadows, lakes, a **desert** (south-east interior and/or south coast: `desert`, `dune`, `rock`,
  `cactus`, `boulder`), rocky coast patches, 3–5 islands (sand + palms; one could host the
  marina's lighthouse… optional).
- **Highways** (axis-aligned, L-shaped allowed) connect every district: Major↔Side (bridge),
  Major↔Ironworks, Ironworks↔Main, Ironworks↔Side, Main↔Airport, Side↔SE Farms,
  Major↔West Farms, Side↔North Farms. Where they cross water: bridges.
- **Railway:** a straight line from Main City's **train station** to an Ironworks freight yard
  (vertical is fine). The train shuttles along it (vehicles-agent).
- City block pitch: road band **9 tiles** + lot 20 (sidewalk ring 3 + interior 14) → `PITCH 29`.
  Industrial and rural can use bigger lots, but their road bands are 9 tiles too.

## 3. Road profiles on a 9-tile band (`across` 0..8)

| Profile | Where | Tiles |
|---|---|---|
| `avenue` | segments touching a downtown block | 0–1 parking bays · 2–3 lane · 4 double yellow (`line_v_c`/`line_h_c`) · 5–6 lane · 7–8 parking bays. Zebra at the block ends (existing `zebra_*`), a **stop line** on the approach lanes just before the zebra, **traffic lights** at every avenue intersection. |
| `street` | suburb segments | 0–1 and 7–8 = `verge` planting strip with street trees · 2–6 asphalt (`street_*`), centre tile 4 = faint dashed line. Stop signs at intersections, no zebras. |
| `rough` | industrial segments | 0 and 8 = `gravel` shoulder · 1–7 damaged asphalt (`rough` variants), centre 4 = `rough_line_*` (faded). |
| `dirt` | rural segments | 0–1 and 7–8 = field edge / `meadow` · 2–6 = `dirtroad_*` (tyre ruts). **Rural lots have no sidewalk ring.** |
| `highway` | between districts | 0 and 8 = shoulder with an edge line (`hwy_*` frames 2/3) · 1–3 lanes, dashed divider between 1 and 2 ... geo decides exact lane lines using `hwy_*` frames · 4 = `line_*_c` median. |

Intersections take the profile of the "biggest" segment meeting there (avenue > highway > rough > street > dirt).
Sidewalk rings: downtown and industrial blocks have them (downtown 3 tiles, industrial 2–3);
suburb blocks have a 2-tile sidewalk inside the verge; rural blocks have none.

Downtown curb furniture (props): `parking_meter` along the bays (every bay), one
`ticket_machine` per block side, `sign_parking` / `sign_noparking` near bays, `traffic_light` at
avenue intersection corners. Suburbs: `stop_sign` at street intersection corners.

## 4. Landmarks (geo places them; the listed art comes from pixel)

| Landmark | Where | Footprint and composition |
|---|---|---|
| Football stadium | Major City, 2×2 merged suburb-ring blocks | building ~26×20 tiles, floors 3, wall `stadium`, roof type **`stadium`** (render composes the `roof_stands` ring + `pitch` field + markings). 4 `floodlight` talls (h 180) at the outer corners. Parking lot around it. |
| Central park | Major City core, 2×2 merged blocks | lake, winding paths, dense trees (`tree_a`/`tree_c`/`pine`), fountains, benches |
| Police station | Major City downtown block | building ~12×10, floors 3, wall `police`, roof `police` + helipad + sign `POLICE`. Yard with `police`/`police_suv` spots |
| TV HQ | Side City downtown block | tower ~10×10, floors 15, wall `glass`, roof `glass`, sign `PCTV`, roof `dish` props, `mast` tall (h 320) |
| Long bridge | bay crossing on the Major↔Side highway | deck = 9-tile highway on `ggbridge` tiles (orange railings). Two **towers** ~40 tiles from each shore: each tower = 2 `pylon` talls (h 260) at the deck edges + a crossbeam (render). **Cables** (render) from tower tops sagging to the deck. |
| Beach | Side City east coast | sand band ≥ 8 tiles, `boardwalk_*`, `umbrella`, `towel`, `palm`, a lifeguard hut (small building or prop) |
| Marina | Side City coast | `pier_*` walkways into the water, moored boats (`ships` sheet: `yacht`, `sailboat`, `motorboat`) |
| Train station | Main City downtown (north edge, on the rail line) | building ~22×8, floors 2, wall `station`, roof `arch`, sign `STATION`; `platform` tiles along the tracks |
| Hospital | Main City downtown | building ~16×10, floors 5, wall `hospital`, roof `hospital` + helipad + sign `HOSPITAL`; `ambulance` spots |
| Port | Main City south coast | `quay` edge, `bollard` props, container stacks (existing), 2–3 `crane` sprites over the water edge, one `container_ship` moored |
| Airport | west, between West Farms and Main City | runway ≥ 180×6 tiles (`runway` frames), `taxiway`, `apron`, terminal ~30×10 (wall `terminal`, roof `metal`), 2 hangars ~14×12 (wall `hangar`, roof `hangar`), control tower (`ctower` tall h 220), parked planes (`air` sheet) |

Anchors that must still exist: `spawn` + `starterCar` + `tankSpot` (the single tank sits next to the
spawn; put the spawn in Major City's downtown), `garage` (boost drop-off, in Ironworks),
`phones` (≥ 1 per city, 1 per other district), `rail`.

## 5. Art (pixel-agent): exact sheets and tags

Keep every existing tag. Style, palette and frame rules as in `.claude/rules/art-pipeline.md`.
Tiles are 16×16; `_v` tiles are for vertical roads, `_h` for horizontal (transpose).

**tiles**
- `ave_v`, `ave_h`: 0 clean lane asphalt · 1 parking-bay surface · 2 bay separator (white line along the tile's top edge for `_v`, left edge for `_h`) · 3 stop line (thick white bar across the tile).
- `street_v`, `street_h`: 0 smooth lighter asphalt · 1 faint dashed centre line.
- `rough`: 4 frames of damaged asphalt (cracks, patches, pothole, oil stain). `rough_line_v`, `rough_line_h`: 1 frame, faded yellow centre line. `gravel`: 2 frames.
- `dirtroad_v`, `dirtroad_h`: 2 frames, packed earth with two tyre ruts along the direction. `dirtroad_x`: 1 frame (junction, no ruts).
- `hwy_v`, `hwy_h`: 0 lane · 1 dashed white divider through the middle of the tile · 2 shoulder with a solid white line on the right edge (`_v`) / bottom edge (`_h`) · 3 same, line on the left / top edge.
- `ggbridge`: 4 frames like `bridge` (north railing, deck, deck with centre line, south railing) with **orange-red** Golden Gate railings. `ggbridge_v`: 4 frames, the transpose (west railing, deck, deck+line, east railing).
- Terrain: `forest` (2), `meadow` (2), `desert` (3, ripples), `dune` (1), `rock` (2).
- Leisure/transport: `boardwalk_v`, `boardwalk_h` (1 each), `pier_v`, `pier_h` (1 each, darker planks with gaps), `quay` (2: 0 plain concrete, 1 edge with a yellow safety stripe along the top), `platform` (2: 0 plain, 1 yellow edge line along the top), `pitch` (2 mowing-stripe frames).
- Airport: `runway` (4: 0 plain dark asphalt, 1 white centre dash, 2 threshold stripes, 3 white edge line along the left edge), `taxiway` (2: 0 plain, 1 yellow centre line vertical), `apron` (2, light concrete).

**roofs** (9-slice + 2 centre variants, the existing 11-frame contract): `roof_stands`
(stadium seating rows, colourful seats), `roof_arch` (station vaulted glass with ribs),
`roof_hospital` (white/light grey), `roof_police` (dark blue-grey), `roof_hangar` (curved
corrugated grey, ribs across).

**walls** (the 8-frame facade contract): `wall_stadium` (concrete with arched entrances),
`wall_police` (navy/white band, blue windows), `wall_hospital` (white, teal windows, red cross on
the ground module), `wall_station` (brick with arched windows), `wall_terminal` (airport glass,
blue frames), `wall_hangar` (big hangar doors on the ground module).

**props** (16×16): `traffic_light` (3 frames: red lit, yellow lit, green lit; top view of the signal
head), `stop_sign`, `sign_parking`, `sign_noparking`, `sign_speed`, `parking_meter`,
`ticket_machine`, `bollard`, `umbrella` (3 colour frames), `towel` (3 colour frames), `cactus`
(2), `rock_s` (2 small rocks), `buoy`.

**big** (48×48): `palm`, `pine`, `boulder`, `dish` (satellite dish), `floodlight` (stadium light
head), `pylon` (bridge tower leg top, red-orange), `ctower` (control tower cab: round glass),
`mast` (antenna mast top with red lights).

**new sheet `air`** (112×112 cells): `airliner` (~96 wingspan, facing up), `propplane` (~44),
`helicopter` (2 frames: rotor positions), all with 1 frame except the helicopter.

**new sheet `ships`** (64×224 cells, facing up): `container_ship` (~60×220, stacked containers),
`yacht` (~24×64), `sailboat` (~20×48), `motorboat` (~18×40), `crane` (gantry crane top view,
legs and a boom ~48×160; the boom points up = toward the water).

**cars**: `ambulance` (28×58, white with red stripes, lightbar; normal/brake/wreck).

## 6. Engine and render (coordinator)

- Lazy **chunked ground** (chunks baked when needed, LRU cache) and **spatial grids** for
  drawing buildings, trees, props, talls and sprites, so a 768² world stays fast.
- New world-data fields render draws (geo fills them; formats are fixed):
  - `c.sprites: [{ sheet, tag, frame?, x, y, ang, h, r? }]`: free sprites (planes, ships,
    boats, cranes). `h = 0` draws at ground level (under cars); `h > 0` draws in the tall pass with
    parallax. If `r` is set, geo also adds an obstacle.
  - `c.talls` gains an optional `sheet` (default `big`) and `light: { color, r }` (a light at night).
  - `c.trafficLights: [{ x, y, axis: 'v' | 'h' }]`: a signal on a pole (parallax h 70). The state
    comes from a global cycle: `'v'` signals are green while `'h'` are red, and vice versa (8 s
    green, 2 s yellow).
  - `c.cables: [{ ax, ay, ah, bx, by, bh, sag }]`: a catenary between two 3D points (height in px),
    drawn with parallax.
  - Building `roof: { type: 'stadium' }`: render composes the stands ring (5 tiles) plus the pitch.
  - `KIND_COLOR` exported from city.js: `{ [KIND.x]: '#hex' }` for the minimap.
  - `c.districts: [{ name, kind: 'city' | 'industrial' | 'rural' | 'wild', rect }]` and
    `City.regionAt(x, y)` returning `{ name, models, ... }` for HUD toasts and vehicle mixes.
- Minimap and GPS scale down to fit (smoothing on for the map image).

## 7. Vehicles (vehicles-agent)

- `MODELS.ambulance` (cars sheet, 28×58, fast-ish van, tough, lightbar): the stats are
  vehicles-agent's call.
- `Train` generalised to run along any straight segment: `c.rail = { x0, y0, x1, y1 }`
  (horizontal or vertical), stopping at both ends, with a station stop optional. Keep the
  current behaviour (shove and damage anything on the track, the tank is immune).

## 8. Names and addresses (geo-agent)

The user wants to be able to talk about specific places ("fix the roads in <neighborhood>").

- **Neighborhoods:** split every district into named neighborhoods (a city ≈ 4–6: e.g. its
  downtown core split in 1–2, suburb ring quarters; industrial ≈ 2–3; rural and wild areas ≈ 1–3
  each, plus named natural features: the bay, lakes, desert, islands, forest). Names fit the pastel
  tone and are unique. Store them in
  `c.neighborhoods: [{ id, name, district, kind, rect: {x,y,w,h} (tiles) }]`, with rects that don't
  overlap within a district. `City.placeAt(x, y)` (world px) returns `{ district, neighborhood, street }`.
- **Streets:** every road line gets a name, and it stays the same along its whole length inside a
  district. Avenues get "… Avenue", suburb streets "… Street/Lane/Drive", cul-de-sacs "… Court",
  industrial "… Road/Way", rural "… Track/Road", highways "Route N" or a named highway, and the
  long bridge gets a proper name. Store them in
  `c.streets: [{ id, name, profile, district, from: {x,y}, to: {x,y} (tiles, centre line), width }]`.
- The coordinator shows the neighborhood (toast on change) and street in the HUD and GPS, using
  `placeAt`.

## 9. Geography document (geo-agent, when the map is done)

Write **`docs/geography.md`**: the complete, structured description of the map, so the user can
point at any part and ask for changes. It includes:
- world overview (size, coastline, sea, bay, islands, terrain zones) and an ASCII/tile-coordinate
  map of the districts;
- per district: kind, bounds (tiles), grid (blocks, pitch), road profiles, look and feel, vehicle
  mix, then **each neighborhood** (name, bounds, what's in it: block types, notable buildings);
- a street index: name, profile, district, from→to, width, notable crossings;
- highways and bridges (including the long bridge: length, towers, where it lands), the railway
  (endpoints, station, crossings);
- landmarks: location (neighborhood + tile coords), footprint, what composes it, `#demo` shortcut;
- natural areas (forest, desert, lakes, islands, beaches) with names and bounds;
- anchors (spawn, tank, garage, payphones) and how to regenerate (seed);
- a "known issues / ideas" section.
Keep it in sync with `city.js`: the coordinator regenerates any numbers from the actual build.

## 10. Done when

Neighborhoods and streets are named, `docs/geography.md` exists, every district and landmark is visible via `#demo` (geo adds `goto=<landmark|district>`
support, listing names in README), the game loads in under ~2 s, `node tools/check.js` passes,
and screenshots of each landmark by day and night have been looked at.
