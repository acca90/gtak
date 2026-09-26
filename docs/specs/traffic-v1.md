# Spec: Traffic (backlog item 8)

Status: phase A built; **phase B built** 2026-09-26 (B1-B4 done; B5 open: downtown looks thin, raise its density; the user's play test). Nothing play-tested. Phase B is designed after A is done. Coordinator: main session.
This lifts the "no traffic" scope limit (the user, 2026-09-26). Pedestrians stay out of scope for now.

## Phase A: the area of view (AOV)

The AOV is the region around the player where transient things exist. Traffic uses it first; pedestrians
and police will use the same system later, so it is generic and not car-specific.

### A.1 Decisions (the user, 2026-09-26)

- **Size:** 2.5× the visible area in width and height, measured at the widest zoom (view ~1040×585 px),
  so ~2600×1460 px (~6× the area of the screen).
- **Streamed things** spawn inside the AOV but out of sight, and are removed when they fall outside it.
- **Parked cars:** there will be **far fewer** of them, and untouched parked cars are **not** part of the AOV:
  they stay at their spots. Once the player **interacts** with one it becomes AOV-managed and can
  vanish when far away. "Interacts" = the player entered it, pushed or crashed it off its spot
  (moved > 24 px), or damaged it.
- Traffic (phase B) drives much slower than the player, while respecting each model's stats.

### A.2 Behaviour

- **Centre:** the camera centre (which already leads the player's motion), so things spawn ahead of
  where you're going.
- **Rings** (rectangles, px, around the centre):
  - `view`: the current visible area plus a 64 px margin. Nothing ever spawns or despawns in here.
  - `aov`: 2.5× the widest-zoom view (~2600×1460). Spawns happen in `aov` minus `view`.
  - `keep`: `aov` + 20% on each axis. Managed things are removed only outside `keep`, so things near the
    border don't flicker in and out.
- **Never removed:** the player's car, the tank, aircraft and ships, anything a mission holds, a car with
  the player inside, and anything visible.
- **Wrecks** are managed: they despawn outside `keep` after they stop burning (replaces today's rule in
  `maintainTraffic`).
- **Spot refill:** when a parked car turns managed and later despawns, its home spot can get a fresh
  car, spawned only while the spot is out of sight.
- **Budgets:** each kind of streamed thing registers a target count and a spawn function, e.g.
  `AOV.pool('traffic', { max: 24, spawn, keep })`. Phase A ships the pool machinery; phase B fills it.
- **Sleeping:** cars outside `keep` that aren't managed (untouched parked cars) aren't updated at all.
  Car-vs-car collisions use a spatial grid instead of checking every pair.

### A.3 API (new `src/aov.js`)

- `AOV.update(dt)`: recompute the rings from the camera, run the pools (spawn up to budget, despawn
  outside `keep`), a few spawn attempts per tick at most.
- `AOV.inView(x, y, m)`, `AOV.inAov(x, y)`, `AOV.inKeep(x, y)`, `AOV.spawnable(x, y)`.
- `AOV.pool(name, { max, spawn(x, y) → entity|null, pick() → candidate spot, list() })`.
- `AOV.release(car)`: mark a car managed (the interaction rule calls it).
- Debug: the `aov` demo hook, and the M map, draw the three rings; `perf` shows update ms and car counts.

### A.4 Tasks

| # | Task | Owner | Done when |
|---|---|---|---|
| A0 | Measure first: a `perf` demo hook showing update ms, car count, updated cars and collision pairs; record the baseline | coordinator | the baseline numbers are in this spec |
| A1 | `src/aov.js`: rings, pools, never-remove rules, debug drawing | coordinator | the rings draw correctly at every zoom in a screenshot |
| A2 | Parked cars: `c.home`, `c.managed`; the interaction rule (enter, moved > 24 px, damage) calls `AOV.release`; wrecks managed; spot refill | coordinator | a released car vanishes after driving away, and an untouched one stays |
| A3 | Sleep + spatial grid in the main loop | coordinator (vehicles-agent reviews) | `perf` shows the drop against A0 |
| A4 | Far fewer parked cars: reduce the counts per region | geo-agent | the map check passes; a new count in geography.md |
| A5 | Docs: README hooks, decision log, backlog | coordinator | done |

Baseline (A0, `node tools/bench.js`, 20 s of driving from the spawn, simulation only, no rendering):
**7.4 ms per update tick** (p95 7.7, max 12.7). There are 60 ticks per second, so that's ~44% of a 16.7 ms frame. 391 cars, all 391 updated
every tick, 76,245 car-vs-car pairs checked per tick. A CPU profile puts **76% of the time in
`Physics.carVsCar`** (the all-pairs loop). Headless Firefox rounds `performance.now` too coarsely to time
this, so `tools/bench.js` measures it in Node; the in-game `perf` hook shows the counts.

After A1-A3 (same bench): **0.32 ms per update tick** (was 7.4 ms, ~23x faster), 82 of 391 cars
updated, 186 collision pairs (was 76,245). A behaviour test confirmed: a shoved car and the damaged
starter car vanish once you're ~4000 px away; an untouched parked car and the tank stay; the freed spot
gets a fresh, untouched car while out of sight.

As built: the sleep rule also keeps wrecks awake (so they can burn out and be cleared), and sleeping
cars stay in the collision grid, so a moving car still hits them. Any car the player drives or damages
becomes managed, not only parked ones (the starter car has no home spot).

After A4 (392 -> 129 parked cars): **0.10 ms per update tick**, 18 cars updated, 18 pairs.

## Phase B: traffic

### B.1 Decisions (the user, 2026-09-26)

- **Each region has its own traffic** (density and vehicle mix):
  - **Downtown:** the most intense. Cars, **buses, taxis and ambulances**.
  - **Suburbs:** very low traffic, **cars only**.
  - **Industrial (Ironworks):** mostly **heavy trucks and special vehicles**.
  - **Farms:** light traffic, fewer cars, more **trucks and tractors**.
- **Speed:** traffic cruises at **~35% of each model's own top speed** (highways ~55%), so a sports car
  still outpaces a truck, and the player overtakes everything.
- **Traffic lights are obeyed:** stop at the stop line on red, queue behind each other; at junctions
  without lights, slow down and yield.
- **Reactions:** **honk when blocked** (wait, honk, then steer around after a few seconds) and **flee when
  hit** (speed up to the model's top speed and drive away for a while). No carjacking and no ramming
  back in v1. The player can't enter a car that has a traffic driver.
- No police in traffic: police come with backlog item 2.

### B.2 Traffic per zone (coordinator numbers, first guesses to tune by eye)

Density = cars alive per 100 road tiles inside the AOV. The pool's budget is summed from the road tiles
of each zone in the AOV, so crossing from the suburbs into downtown fills up naturally.

| Zone | Density | Mix (weights) |
|---|---|---|
| downtown | 3.0 | sedan 20, taxi 18, hatch 12, suv 10, bus 8, van 6, sport 4, muscle 3, ambulance 3, truck 2 |
| suburbs | 0.5 | hatch 25, sedan 25, suv 20, pickup 8, muscle 4, sport 3 |
| industrial | 1.2 | truck 16, semi 12, flatbed 8, tanker 6, mixer 6, garbage 5, van 6, pickup 5 |
| rural (farms) | 0.4 | pickup 14, tractor 12, truck 8, flatbed 6, harvester 3, suv 4, hatch 3, sedan 3 |
| highway | 1.2 | sedan 14, suv 10, hatch 8, truck 8, semi 6, tanker 3, bus 2, sport 5, muscle 4, van 5 |
| airport | 1.5 | taxi 16, sedan 10, van 10, bus 4, suv 6 |
| wild | 0.3 | pickup 12, suv 12, hatch 5, sedan 5, van 3 |

### B.3 Tasks

Each ends with `node tools/check.js`, `node tools/bench.js`, a screenshot looked at, and a report.

| # | Task | Owner | Done when |
|---|---|---|---|
| B1 | **Lane graph.** From the road runs and intersection boxes: one lane per direction (right-hand traffic) with centrelines, intersection nodes with their exits (straight / left / right), the stop-line point of each approach and the traffic light that controls it; `City.laneAt(x, y)` for spawning; `ZONES[z].traffic = { density, models }` from B.2. Cul-de-sacs turn around. | geo-agent | a debug overlay (`#demo&lanes`) draws lanes and nodes on a downtown block, a suburb and a highway junction |
| B2 | **Driver.** An AI controller that feeds the car the same controls the player uses (so stats, handling and mass apply): follow the lane at the cruise speed, pick a random exit at each node, brake for the car or obstacle ahead and for the player, stop on red at the stop line, yield at junctions without lights. `c.driver = { ai: true }`, so engine sounds play. | vehicles-agent | a headless run of 60 s: no car leaves its lane, none runs a red light, queues form at a red light |
| B3 | **Traffic pool.** `AOV.pool('traffic')` with the zone budgets from B.2: spawn on a lane out of sight, facing along it, already at cruise speed; drop outside `keep`; E ignores AI-driven cars. | coordinator | `perf` and `bench` with traffic running; a map `aov` shot shows the density rising downtown |
| B4 | **Reactions.** Blocked: wait ~1.5 s, honk, after ~4 s steer around. Hit (by the player or the player's car): flee at top speed for ~10 s, then calm down back into a lane. | vehicles-agent | a scripted block and a scripted ram, both seen in screenshots |
| B5 | **Integrate.** Screenshots of downtown by day and night, the suburbs, Ironworks and a farm road; bench; README, decision log, backlog; the user's play test. | coordinator | the user drives through all four regions |

As built:
- **B1:** 812 lanes, 269 nodes (50 with lights, 11 U-turn loops), 1,837 exits. Highways paint two lanes per direction,
  so traffic uses the outer one (the inner one is free for overtaking later). See geo-agent's log for the contract.
- **B3:** the pool uses `City.lanesIn(AOV)`; the budget refreshes every 2 s; spawn points are clipped to the part
  of the lane inside the AOV and kept away from the ends. Around the spawn (Major City) the budget is 9 cars.
  `#demo&lanes` draws the lane graph.

Order: B1 first (everything needs lanes). Then B2 and B3 in parallel (different files, and the pool can
spawn cars that just sit until the driver lands). B4 after B2 (same code). Then B5.
