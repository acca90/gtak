# vehicles-agent — decision log
Format and rules: `.claude/rules/decisions.md`. Newest first.

## 2026-09-25 · Helicopter flight model, levels and exit policy
- **Decision:** `MODELS.helicopter` (air sheet, 40×56, `air`, `climb` 90, `ceiling` 260, max 300,
  acc 170, yaw 2.2 rad/s, mass 2.4, hp 200, no horn/siren). Rotor spins up in 1.5 s before lift,
  spins down after 3 s landed idle. Drift: linear drag k = acc/max (0.57/s forward, 0.9/s lateral).
  Ceiling = max(260, roof under + 48); above it the heli sinks. Levels: every Car has `alt` (0 on
  wheels); car-vs-car only within 8 px of altitude; props, walker and train only when `alt <= 8`;
  world tiles are solid for aircraft only if a building is taller than `alt + 2` (so it hits towers
  above its altitude and lands on lower roofs). Water: a flown heli hovers at 8 px (can't land),
  an empty one sinks and ditches. hp 0 in the air → falls (420 px/s²) and explodes on impact.
  Exit: only landed, and only on the street (`LAND FIRST` / `LAND ON THE STREET TO GET OUT`),
  because the player has no altitude; roof helis can't be boarded from the street.
  Explosions use 3D distance (altitude included).
- **Why:** helicopter-v1 spec §1 ("make the copters work").
- **Where:** `Car.fly`/`health`/`frame`, `Physics.heights`/`airSolidTile`/`carVsWorld` etc. (src/entities.js);
  `carControls`, `exitCar`, `tryEnterCar`, `spawnCar` (s.alt), `explode`, `Train.collide`, `#demo&heli=N` (src/game.js).
- **Status:** active

## 2026-09-25 · Horn classes, siren flag, and the horn key's tap/hold
- **Decision:** every model has `horn: 'small'|'car'|'truck'` (small = hatch, tractor, forklift;
  truck = all `heavy` sheet vehicles + harvester; car = the rest). The tank has no horn and never honks.
  `siren: 'police'` on police/police_suv, `'ambulance'` on ambulance. `Car.sirenOn`/`honking`/`hornT`.
  No siren: `honking = held`. With a siren: a tap released within 0.35 s toggles `sirenOn` on release;
  a hold past 0.35 s honks until release and does not toggle. Both are cleared in `exitCar` (on a
  successful exit) and `destroyCar`. Handling is unchanged.
- **Why:** sound-v1 spec §3; sound-agent and the lightbar render read these fields.
- **Where:** `MODELS`, `Car` constructor (src/entities.js); `updateDriving`, `exitCar`, `destroyCar` (src/game.js).
- **Status:** active

## 2026-09-25 · Train runs on any axis-aligned rail, with optional station stops
- **Decision:** `c.rail = { x0, y0, x1, y1, stops?, dwell? }` in world px, horizontal or vertical
  (snapped to the dominant axis; ends may be given in either order). `stops` = world x (or y for
  vertical) where the train's *centre* dwells, as numbers or `{ at, dwell }`; default dwell 6 s,
  the ends still wait 7 s. Stops too close to the ends to fit the train are dropped. Legacy
  `{ y, x0, x1 }` is still accepted. Cars are drawn along `heading`; the tail loco is flipped.
  Train keeps 150 px/s, 45 px/s², 670 px long, shove/damage rules unchanged.
- **Why:** world-v2 spec §2/§7: a station-to-freight-yard line that may be vertical.
- **Where:** `Train` in src/game.js.
- **Status:** active (supersedes nothing; extends "Freight train shuttles…")

## 2026-09-25 · Ambulance: fast-ish, tough emergency van
- **Decision:** `MODELS.ambulance` (cars, 28×58): max 340, acc 250, brake 640, steer 2.3,
  grip 1300, mass 2.0, hp 240. Sits above taxi (320) and below muscle (370) in speed, and is the
  toughest car-sheet vehicle (hp above police SUV 220, mass above van 1.9). No region weight:
  it appears only where geo-agent places it (hospital). No lightbar flag yet (nothing reads one).
- **Why:** world-v2 spec §7 asked for a "fast-ish van, tough, lightbar".
- **Status:** active

## 2026-09-25 · One tank only, the strongest vehicle, immune to collisions and small arms
- **Decision:** a single tank parked next to the spawn and never respawned. It takes no damage from
  vehicle impacts, walls or bullets, and explosions deal 35%. Mass 14, hp 900, max 165. The turret
  follows the mouse (or Z/X) and the cannon fires shells.
- **Why:** the user asked for "one single tank at the starting point" that "must not take damage
  from regular vehicles".
- **Where:** `MODELS.tank`, `impact`, `updateBullets`, `explode`, `Car.update` turret.
- **Status:** active

## 2026-09-25 · Speed and toughness ladder
- **Decision:** slowest/toughest → fastest: tank · semi/bus/tanker (205–215) · truck/mixer/garbage/
  flatbed (210–230) · van/pickup/SUV (255–300) · hatch/sedan/taxi (290–320) · muscle 370 ·
  police SUV 375 · police 400 · sport 430. Farm/yard machines are 110–150. Collision damage
  scales with the other vehicle's mass (clamped 0.25–4).
- **Why:** the user asked for cars slightly slower overall, big vehicles slower and stronger, and
  expensive sports and police cars slightly faster.
- **Status:** active

## 2026-09-25 · Freight train shuttles on the Ironworks line and can't be stopped
- **Decision:** 6 cars (a locomotive at each end), 150 px/s, 7 s stops at the buffers. It shoves
  and damages anything on the track (the tank is only shoved) and hurts the player on foot.
- **Where:** `Train` in src/game.js.
- **Status:** active

## 2026-09-25 · Fuel tankers explode along their length
- **Decision:** `volatile: true` gives three explosions spaced along the vehicle.
- **Status:** active
