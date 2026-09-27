---
name: vehicles-decision-log
description: Full vehicles-agent decision entries (gang cars, carjack, airport, cars vs peds, traffic AI B2/B4, heli, horns, train, ambulance, tank, speed ladder, tankers)
metadata:
  type: project
---

## 2026-09-27 · Gang car crews and rival mobs (gangs-v1 G7)
- **Decision:** a crewed AI gang car (`c.gang`, not `c.crewOut`) never flees, honks at or passes the
  player. Triggers → `Game.gangHit(c, foe)` → `d.angry`: rammed by the player's car (closing speed
  > 15 px/s in `impact`, or the B4 ram test), damage whose source is the player (`damageCar(c, dmg,
  src)`: bullets `b.src`, punches, rockets `q.src`, blasts `src || player`, fire `f.src || player`),
  stopped behind the player 2 s (`blockedBy` = player car / walker, not at a red light), or a rival
  (a member of another mob on foot, else a crewed rival car) within 180 px in clear sight (`Peds.sees`,
  scan every 0.25 s). The player's hit overrides a rival. Angry: full brake; below 20 px/s `gangBail`
  puts both members out (driver door −1, passenger +1; a blocked door → other side 14 px back) with
  `Peds.driverOut(..., { gang, bail: true, byPlayer | foe })`, car empty, `c.crew` kept, `gang` kept.
  Rival car: both stopped → `gangBailPair` (crews target each other); its crew already out → the
  nearest of them; gave up after 3 s or foe gone → drive on. Damage/rams by anyone else: ignored.
  Jack: driver out down (as G4) + passenger out the other door fighting. Wreck with crew inside: dies
  inside (no bail, no bodies); if the player hit it in the last 3 s → `Gangs.memberKilled` ×2.
  `gangStolen` sets `crewOut` (parked cars have no crew). Routes: `pickExit` weights exits into
  another mob's turf ×0.001 (`lane._turf` cached); spawns were already turf-only (`Gangs.presence`).
- **Why:** user play-test 2026-09-27 ("mob cars behave like civilians… should always have two mob
  members that get angry with you if you hit them"; "mobs avoid each other's region, shoot on sight").
- **Where:** `GANG_CREW`, `gangHit/gangCanBail/crewSpot/gangBail/gangBailPair`, `damageCar` src,
  `impact`, `destroyCar`, `yank`, `#demo&gangram=` (src/game.js); `rivalNear`, `angry`, `checkHit`,
  `honk`, blocked hook, `pickExit`, `initDriver` (src/traffic.js).
- **Status:** active

## 2026-09-27 · Gang cars in traffic and parking (gangs-v1 G4)
- **Decision:** a traffic spawn in a mob's turf is that mob's car with p = `GANG_CAR_SHARE` 0.1 ×
  (presence share / the mob's own share), so 10% in the turf, 5% Orlov in Ironworks; it replaces a
  normal spawn (same budget). Parked: only spots using the region mix (no `s.models`: not yards,
  farms, police, hospital) get one 1 in `GANG_PARKED_ONE_IN` 15 × the same ratio, initial and AOV refills.
  Car = `Gangs.get(id).carModel` (stats unchanged: no gang tuning), `c.paint = carPaint` (null keeps
  stock), `c.gang = id`. Stealing counts once per car (`c.gangStolen`): on the yank of a jack and on
  seating in a parked gang car → `Gangs.carStolen(id)`. Jacked driver: `Peds.driverOut(..., { byPlayer,
  gang, mood: 'violent' })`. ~~The AI gang car keeps the plain B4 flee~~ (superseded by G7 crews, 2026-09-27).
- **Why:** gangs-v1 §1 "Gang cars" / G4.
- **Where:** `GANG_*`, `gangRoll/gangMob/gangCar/gangStolen`, `spawnParked`, `setupTraffic` spawn,
  `seat`, `yank`, `#demo&gangcar=` (src/game.js).
- **Status:** active

## 2026-09-27 · Carjacking mechanics (carjack-v1 C1)
- **Decision:** `Game.jack(car, by)` / `G.jack = { car, by, t, phase 'grab'|'yank', side, hp0, yankT }`.
  Steal: E on foot within 18 px of a `jackable` car (traffic, AI driver, not air/tank) < 30 px/s;
  a free parked car wins only if nearer; faster: "TOO FAST" toast, ≥ 2 s apart; both doors
  blocked: "DOOR BLOCKED". Door = `driverDoor(car)`: left side (hw + 6 px out, lf = 0.08·len, or
  len/2 − 16 for len ≥ 80), the right side if blocked. The jacker walks there at 160 px/s, round
  the nearest end if on the passenger side (the usual case: sidewalks are on the right), yanks at
  ≥ 0.35 s once there (gives up at 1.5 s), is seated 0.35 s later (≈ 0.7 s on the driver's side,
  ≈ 0.95 s from the passenger side). The car brakes (`jackControls`), AI and player controls off;
  cancel on a hit (hp drop), car > 40 px/s, wreck. Stealing: `Peds.driverOut` at the door + 7 px
  forward, pushed 55 px/s outward (~14 px); `traffic = false`, released; `car.driverLook` kept.
  Reverse (a ped, player's car < 20 px/s, ped ≤ 16 px from the door): the player lands at the door,
  `p.downT` 0.8 s (input blocked, 'dead' frame until pixel draws `player:down`), 5 dmg, slides
  ~14 px; then `Traffic.takeOver(car, ped)`: ped gone, AI driver on the nearest lane (400 px, else
  'lost'), `flee` 10 s. Witness honks: `d.why = 'jack'` on the jacked AI (not a TR_WAITS reason),
  then the player's stopped car counts as a blocker unless it's at a red light (B4 as is).
- **Why:** carjack-v1 §1/§2 (the user asked to steal moving traffic).
- **Where:** `JACK`, `tryEnterCar`, `seat`, `jackable`, `driverDoor`, `jack`, `jackControls`,
  `updateJack`, `yank`, updateOnFoot/updateDriving freezes, `#demo&jack=` (src/game.js);
  `Traffic.initDriver/takeOver` (src/traffic.js).
- **Status:** active

## 2026-09-27 · Airport flights and port cranes (ambient-v1 X3)
- **Decision:** `src/airport.js` (Flights, Cranes, Airport hooks). One movement at a time; first at
  20 s of play (runway airliner, stand 6, never reused), then start-to-start 150 s (≥ 10 s after the
  last ended); after a departure comes an arrival into a free stand (prop stands get propplanes).
  Airliner: approach 170 px/s gliding 220 → 0 px, rollout decel to taxi 40 (×2 on long straights),
  pushback 24, take-off acc 20 to rotate at 230, climb 45 px/s, max 330; propplane 115/34/20/16/120/38/230.
  Planes follow geo's paths exactly (no physics); on the ground they're solid circles from the
  stand obstacles: shove cars (≥ plane speed + 30 along the normal), damage 10 + 0.3·v per 0.5 s when
  > 12 px/s (tank shoved only), kill peds/cows, hurt the player on foot 30. Collisions only inside AOV keep.
  Cranes: each works its own bays; quay stacks are permanent (one box each, solid: 3 circles r 15);
  load until its bays are full, then unload; gantry 18, trolley 45, hoist 40 px/s, latch 1 s,
  deck starts ~half full (seeded). Hanging load is drawn UNDER the gantry and trolley (the boom is
  above it), not in the gantry → trolley → load order the coordinator listed.
- **Why:** ambient-v1 §1/§2 and geo X1 / pixel X2 contracts.
- **Where:** src/airport.js; hooks in Game.start/update/render/collectLights/drawEmissive; `Grid.add`.
- **Status:** active

## 2026-09-27 · Cars vs peds and cows (P5); traffic brakes for bodies
- **Decision:** speed = car velocity at the contact point (spin included) *into* the body.
  Peds: < 40 push (moveWalker, no damage; the player's car makes them react), 40-110 knock down
  with (v − 40) × 0.5, > 110 kill; a ped lying in the road is rolled over once per car (≥ 0.35 s
  after the knock, (v − 40) × 0.25). Net: 40-80 knocked down and survives, ~80-100 dies of knock +
  roll, ≥ 100 the knock alone is fatal (the spec formula), > 110 instant. Cows: > 60 kill, slower = inelastic push with the cow
  at 0.4 sedan mass (the car loses a little speed) and the herd reacts. Tank kills anything > 20.
  One hit per contact (0.3 s gap). A body is never a wall. Corpses: one smear per corpse per car.
  Kill/knock: `Render.smear` 12 + 0.2·v px along the car's path, `c.bloodT` 2 s (corpse 1.2 s) of
  rear-wheel `Render.bloodPrint` every 1.5 px, fading. Alarms (crash radius): impacts > 110 and a
  car > 60 px/s on WALK/PLAZA tiles (per car every 0.5 s). Train: moving (> 10) kills and smears,
  standing pushes bodies off the track. Traffic: live bodies within car hw + radius + 1 px of the
  route stop the car 8 px short (lead 'ped', `d.leadPed`); never passed; honked only if standing
  (not walk/wait/flee/return); fleeing drivers ignore them. A walking ped that hasn't moved for
  1.5 s in front of a stopped car makes it reverse 0.6 s (zebra deadlock: peds.js waits for any car
  across the zebra).
- **Why:** peds-v1 §2.2 / P5; the user's play test said cars didn't kill peds (before P5 landed).
- **Where:** `Physics.carVsBodies/bodyBlood/BODY` (src/entities.js); `carEffects`, `impact`,
  `Train.bodies`, `#demo&runover=`, `seek=ped` (src/game.js); `TR.PED_*`, `pgrid`, `scan` (src/traffic.js).
- **Status:** active

## 2026-09-26 · Traffic reactions (B4): honk, pass, flee
- **Decision:** a car is "really blocked" only if the head of its queue isn't waiting for a
  light/right of way: a parked, wrecked or player car (not one at a red light), the walker, or
  a driver stuck > 8 s. Then: honk in double taps (0.2 s on, 0.18 off, 0.2 on, repeat every
  2.4 s) from 1.5 s; pass on the left from 4 s if the shifted corridor is on the road, the lane
  has room before its end, and nothing oncoming/parked is in it for 2·len/70 + 2 s. Pass at
  ≤ 70 px/s, pull out at 35 px/s sideways; back up first if the gap is under
  0.8·√(2·(120/steer)·need); cars stop `d.room` (that same gap) behind static non-AI blockers.
  Give up if something oncoming appears before we're 60% out; head-on pairs never use the
  "older id goes" rule. Flee: the player's car moving > 25 px/s *toward* us and touching us with
  a > 40 px/s velocity jump, or hp lost with the player within 700 px and no car hitting us
  (not while burning) → `fleeT` 10 s at `m.max`, lights/yields/left-turn waits ignored (trains
  and cars ahead still obeyed), turns at 200 px/s² lateral, exits weighted away from the player,
  honk after 0.5 s blocked, pass anything standing after 1.5 s; afterwards speed eases down at
  70 px/s². No ramming back, no carjacking (the user didn't pick them). Long vehicles never
  enter dead ends (the 56-px loops are too tight).
- **Why:** traffic-v1 B4 (the user's choices in §B.1).
- **Where:** `checkHit`, `flee`, `blockedBy`, `honk`, `passing`, `passClear`, `room` in src/traffic.js.
- **Status:** active

## 2026-09-26 · Traffic driver AI (B2): steering, speeds, gaps, right of way
- **Decision:** `Traffic.controls` only returns controls (throttle/steer, never hb) fed to
  `Car.update`, so model stats apply. Pure pursuit, look-ahead 16 + 0.25·v + 0.1·len px (×0.8 in
  a turn). Speed = min of: `driver.cruise` (pool sets it; `fleeT` > 0 → `m.max`), turns
  min(√(120·R), 0.8·cruise, 45 for len ≥ 80), U-turn loops ≤ 50, stops planned at 30% of `m.brake`.
  Following: stop gap 10 px + 0.6 s × lead speed. Red: stop the front bumper at `lane.stop`;
  amber: go only if 60% of full brake can't stop before it (then committed); past the line by
  6 px = committed. Fresh green: wait while a car crosses the box (the signal has no all-red).
  Yield: stop, wait ≥ 0.4 s, go when the box and priority approaches are clear. Left turns wait
  for oncoming straight/right traffic (left vs left doesn't conflict). Crossing cars are also
  tested at +0.4/+0.8 s. Two cars blocking each other: the older driver id goes.
  Turns are circular arcs of radius ≥ 1.15 × 120/steer (the Car's tightest circle below 120 px/s),
  so vans/trucks don't swing into oncoming lanes. Keep right up to 4 px when oncoming traffic is
  within 3 px. Exit weights s 3 · r 1.5 · l 1.2 (u only at dead ends), ×0.4 into a dead end,
  straight ×3 for len ≥ 80, ×0.05 into street/court lanes for w ≥ 30. Knocked off: re-acquire
  the nearest lane heading our way (90 → 220 → 400 px while lost); route behind us or stuck
  1.5 s → reverse 0.9 s with opposite lock. Obstacle lateral test uses collision-circle extents
  with 1.5 px tolerance (parked heavies sit exactly touching on rough roads).
- **Why:** traffic-v1 B2 (user unlocked traffic 2026-09-26; cruise 35%/55% is the user's call).
  Headless 90-120 s runs: 0 red runs, 0 stuck, 0-1 AI crashes per run, ~8 µs per car per tick.
- **Where:** `src/traffic.js` (`TR` holds every number). B4 hooks: `blockedT`, `fleeT`, `stuckT`.
- **Status:** active

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
