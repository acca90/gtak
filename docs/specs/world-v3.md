# Plan: World v3, city organisation (the user's ideas, 2026-09-27)

Status: **plan** 2026-09-27. Coordinator: main session. Built in baby steps, the overall changes first
(the user: "lets wire them in baby steps according with overall improvements"). Each step gets its own short
spec section here before it's built, and geo-agent keeps `docs/geography.md` in sync.

## The user's ideas, as written

**Side City**
1. Side City becomes the fun city: beach, football stadium, brothels, marina, casinos.
2. Bigger suburbs.

**Main City**
1. Biggest city (biggest downtown).
2. Airport, police HQ, townhall, biggest hospital.
3. The port moves to Ironworks, and Main City gets a pier, kind of San Francisco style.

**Major City**
1. Gets a university.
2. Bigger downtown: the current one is too small and almost entirely filled with the park.

**Ironworks**
1. The port (now on Main City) moves to the bay and becomes part of the Ironworks site.

**Overall**
1. The Pastel Gate Bridge moves north, to give space to the new port location.
2. All three cities are connected by a subway.
3. The railway from Ironworks connects to a train station close to the airport, so the railway gets bigger.
   Include train stop signals, and more damage if the train hits you.

## Where things are today (docs/geography.md)

- Railway: one vertical line (x 284-285) from the Ironworks freight yard, through Main City's north avenue
  (two level crossings), to Union Station's buffer (y 566). Union Station is in Main City's core.
- Pastel Gate Bridge: Route 1 across the bay (y 243-251, deck x 366-499) between Major City and Side City.
- Port: south of Main City (yard y 696-710, quay 711-715, basin 716-730), 3 cranes and the container ship.
- Pastel Stadium: Major City's east suburbs (Bayview). Mercy Hospital and Union Station: Main City. The police
  station: Major City's core, next to the spawn.

## Steps (in order)

| # | Step | Owners | Notes |
|---|---|---|---|
| W1 | **Railway to the airport**: extend the line from Union Station to a new **Airport station** near the terminal; railway **signals** the train obeys (it stops at stations and at red signals) and **level-crossing lights and barriers** that warn traffic and peds; the train hits much harder | geo (route, station, signals placement), vehicles (Train: stops, signals, damage), pixel (station, signals, barriers), sound | self-contained; first |
| W2 | **Pastel Gate Bridge moves north** across the bay | geo, pixel (if the span length changes) | frees the bay's south shore for W3 |
| W3 | **Port moves to the bay** as part of Ironworks (yard, quay, cranes, ship; the X1 airport/port data follows); **Main City's old port becomes an SF-style pier** (a long pier with shops and restaurants, promenade, sea lions optional) | geo, vehicles (Cranes data), pixel | |
| W4 | **Subway** linking the three cities | geo (stations), coordinator (how you ride it), pixel, sound | needs a design question first: how the player rides it |
| W5 | **Main City becomes the biggest**: the biggest downtown; police HQ (moves from Major City), town hall, the biggest hospital (Mercy grows) | geo, pixel | the spawn is next to the police station today: decide the new spawn |
| W6 | **Major City**: a bigger downtown (the park takes less of it) and a **university** campus | geo, pixel | |
| W7 | **Side City, the fun city**: the stadium moves here, casinos, brothels (backlog item 6's building), bigger suburbs; beach and marina stay | geo, pixel | backlog 6 (brothel) mechanics are separate |

Every step re-checks what depends on the map: lanes and traffic, the walk graph and crossings, pens, paint and
gun shops, payphones, the airport/port route data, missions' places, `goto` names, and the bench.

## W1: Railway to the airport (spec)

Status: **spec** 2026-09-27. The user chose **both kinds of signals**: line signals the train obeys, and lights +
barriers at level crossings.

**Route.** The line keeps its Ironworks freight-yard end and runs through Union Station (Main City), which becomes
a **through station** instead of a buffer. South of Union Station the line continues to a new **Airport station**
next to the terminal (Pastel Airport, x 30-176, y 495-725), following the Airport Expressway corridor (y 629) or
another clean path geo-agent picks: no buildings demolished in city cores, crossings only where needed, and it
must not cut the runway, taxiways or the airport's taxi routes (`c.airport`). The track may bend: 90° curves
with a generous radius (>= 12 tiles), drawn with curve tiles.

**Stations.** Three stops: Ironworks yard (the line's north end), Union Station, Airport station. A station has
platforms on both sides, a hall with a sign, a taxi rank or kerb, and walk-graph links (peds wait on platforms).
The train stops at each station for ~8 s, and reverses at the two ends. Airport station also gets a `goto` name.

**Line signals** (the train obeys them): a signal at each end of every platform and before every level crossing
(~20 tiles before it, both directions). A platform's exit signal turns green when the dwell ends; a crossing's
approach signal is red until that crossing's barriers are fully down, then green. The train brakes to stop at a
red signal and pulls away when it clears (`Train` uses its own acceleration and braking).

**Level crossings.** Flashing red lights (both sides of the road) start ~6 s before the train arrives, barrier arms
come down over 2 s, and they rise after the train has fully cleared. Traffic stops at the lights (the driver's
existing train check reads the crossing state instead of guessing); peds wait on the kerb. A car stuck on the
tracks when the train comes is hit: the train never stops for it.

**Damage.** A train hit kills the player on foot outright (WASTED) and deals huge damage to a car
(`300 + 2 × speed`, so most cars are wrecked, and the tank takes 35%) with a big shove. Peds and cows: killed
(already). The locomotive's horn sounds when it approaches a crossing (sound-agent).

**Contracts** (geo-agent writes, vehicles-agent reads):
- `c.rail.path = [[x, y], ...]`: the track's centre polyline, px, from the Ironworks end to the Airport end,
  with curves as points every ~16 px; `c.rail.len` px; `City.railAt(s)` → `{ x, y, ang }` at distance s along it.
- `c.rail.stations = [{ name, s, platforms: [...rects], signalOut: [s0, s1] }]`, `c.rail.signals = [{ id, s, dir,
  x, y, ang, kind: 'platform'|'approach', crossing? }]`, `c.rail.crossings = [{ id, s, x, y, road, lights: [...],
  barriers: [...] }]`.
- The old straight `c.rail {x0, y0, x1, y1}` stays for anything that still reads it, until vehicles-agent moves
  `Train` to the path.

**Tasks.**

| # | Task | Owner | Done when |
|---|---|---|---|
| W1.1 | Route, curve tiles' placement, Airport station, Union Station as a through station, signal and crossing data, walk links, `goto` names | geo-agent | overlay shots (`#demo&routes` or `rail`) of the route, both stations and a crossing |
| W1.2 | Art: rail curve tiles, Airport station hall and platforms, line signals (red/green), crossing lights (flashing) and barrier arms (up/down frames or a rotating arm) | pixel-agent | gallery + in-game shots |
| W1.3 | `Train` on the path: wagons follow the curve (each wagon positioned by its two bogies on the path), station stops, signals, crossing timing, the barrier state for traffic and peds, train damage | vehicles-agent | headless: a full round trip, stops at 3 stations, waits at a red signal, barriers down before it crosses; shots of the train on the curve and at Airport station |
| W1.4 | Horn at crossings, crossing bell, brakes squeal at stations | sound-agent | soundboard |
| W1.5 | Peds wait at closed crossings (read the crossing state), README, geography, the user's play test | coordinator | the user watches a train reach the airport |
