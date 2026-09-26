# Spec: Ships and planes at world scale, and a Beira-Rio stadium

Status: **implemented** 2026-09-26; play-tested and approved by the user 2026-09-26. Coordinator: main session.
Owners: **pixel-agent** (sprites, the stadium's look in `Render.stadiumRoof`), **geo-agent** (space for
the new sizes, stadium surroundings), **sound-agent** (updates its sheet checks).

## 1. The user's brief

"Ships and planes are too small compared to the world scale; make it more coherent, they should be way
bigger." And: "The stadium is way too weird. Take the Beira-Rio as inspiration and make it cooler."

## 2. Scale reference

A sedan is 26×52 px (about 4.7 m, so ~11 px/m), a storey is 32 px, a tile is 16 px, and the yard containers
are 32×80 px. Big things are compressed (GTA style), but they must clearly dwarf cars, and a ship's
containers must match the yard containers.

## 3. Sheets and tags (contract; all sprites face **up**, centred in the cell)

Tag names don't change. Sheets change as follows:

| sheet | cell (w×h) | tags | drawn size (≈) |
|---|---|---|---|
| `planes` (new) | 288×288 | `airliner` | 272 long × 256 wingspan (≈ 5× a sedan) |
| | | `propplane` | 112 long × 144 wingspan |
| `air` | 112×112 (unchanged) | `helicopter` (2 frames) only; **airliner and propplane move to `planes`** | unchanged (it's a vehicle) |
| `ships` | 192×976 | `container_ship` | 176 beam × 960 long; container bays at yard scale (≈ 28×72 each, 6 across) |
| `boats` (new) | 64×208 | `yacht` | 56 × 192 |
| | | `sailboat` | 40 × 128 (the mast shadow may overhang) |
| | | `motorboat` | 32 × 88 |
| | | `crane` | the port gantry, seen from above: legs on the quay and a boom reaching ~190 px out over a moored ship's full beam |

The old `ships` 64×224 tags move to `boats`, apart from `container_ship`. Keep the art style (1-px dark outline, top-left light,
pastel palette). Redraw them at the new size: never scale up existing pixels.

## 4. Stadium: Beira-Rio inspired (pixel-agent owns the look, geo-agent the surroundings)

Beira-Rio (Porto Alegre) is recognisable by:
- an **oval bowl** of stands in **red** (Internacional red → use the pastel rose/red, `PAL.R`/`PAL.r`), with white accents;
- the iconic **white roof of overlapping "leaf" panels** (a ring of curved white membrane petals on
  a steel frame) that covers **all** the stands, seen from above as a white scalloped oval ring with radial
  ribs, leaving the **pitch open** in the middle;
- floodlights **built into the roof's inner rim**, not on corner towers;
- a wide **esplanade** around it and a **waterfront** setting (it sits on the Guaíba lake shore).

Implementation:
- Keep the building footprint (`b.tw × b.th`, currently 28×22 tiles) and `roof: { type: 'stadium' }`. `Render.stadiumRoof`
  (pixel) draws: the esplanade in the corners outside the oval (light paving with a pattern), the leaf-roof ring,
  a thin visible strip of red seats at the roof's inner edge, and the striped pitch with markings and goals.
  It stays readable at night: the inner rim lights are emissive, and the pitch is lit (see the existing night redraw at render.js ~621).
- `wall_stadium`: the white rib/column facade with red accents under the roof edge (the 8-frame contract).
- Any new art (e.g. a `roof_leaf` tile set) is pixel's choice. Report the tag names.
- geo-agent: remove the 4 corner `floodlight` talls. Make the ground around the stadium read as an esplanade
  (plaza paving, a few trees/benches), keeping the car park. If an **equally central waterfront** 2×2 spot
  exists in Major City (Bayview is by the bay), moving it there is welcome, but don't restructure the grid for it.
  Keep `Pastel Stadium` / `goto=Stadium` and `docs/geography.md` in sync.

## 5. geo-agent: space for the new sizes

- **Airport:** fit parked airliners (≈ 272×256) at the terminal gates and remote stand without the wings
  overlapping each other, buildings or the terminal. Widen the runway and taxiway so an airliner's wings
  fit (runway ≥ 15 tiles, taxiway ≥ 11), and keep the prop planes and the helicopter pad.
- **Port:** the container ship (176×960) moors alongside a quay (the harbour basin must be ≥ 14 tiles
  wide where it lies, or it moors on the mole's outer, sea side). The cranes stand on that quay with their booms over the ship.
- **Marina:** piers long and far enough apart for yachts (56×192), sailboats and motorboats at their new sizes.
- Use `sheet: 'planes'` for airliner/propplane and `sheet: 'boats'` for yacht/sailboat/motorboat/crane. Check that
  `Render` indexes/culling handle a 976 px sprite (a sprite whose centre is off-screen but whose hull is on
  screen must still draw), and fix the index query margin if needed. That margin is coordinator code, and geo is cleared to change it.

## 6. sound-agent

`audio.js` looks for `s.sheet === 'ships'` / `'air'`: update it to `boats` / `planes` as above.

## 7. Done when

Screenshots at `goto=Port`, `goto=Port Cranes`, `goto=Marina`, `goto=Runway`, `goto=Terminal` and `goto=Stadium`
(day and `time=2` night), taken zoomed out enough to see the whole thing (`SHOT_SIZE=2400,1600`), are looked at
and show coherent scale; `gallery.html` shows the new sheets; `node tools/check.js` passes.
