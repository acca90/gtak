# Spec: Living airport and port (side tasks)

Status: **built** 2026-09-27 (X1-X4 done, integrated); not play-tested or listened to. Coordinator: main session. Requested by the user as two side tasks, next to
pedestrians (docs/specs/peds-v1.md): "Airplanes landing and taking off in the airport. Cranes moving over
ships loading it."

## 1. Airport flight ops

Today the seven planes at the airport are static `c.sprites` (sheet `planes`), and one airliner sits lined
up on the runway (x ≈ 46, y 522, heading south).

- **One flight at a time**, a slow loop: **arrival** (in from the south at altitude → descent along the
  runway centre line → touchdown near the south threshold → rollout and braking → turn off onto the taxiway →
  taxi to a free stand → park), then after a while the **departure** of another parked plane (push back →
  taxi down the taxiway to the south end of the runway → line up → take-off roll north → rotate → climb out to the north → gone).
  Arrivals and departures alternate, so the apron keeps the same number of planes.
- **Timing:** one movement every ~2.5 real minutes (a ~40 s landing or take-off plus taxiing). The first one
  starts ~20 s after the game starts, so it gets seen.
- **In the air:** drawn above the roofs with the helicopters' lift, with a ground shadow that shrinks and
  lightens with altitude (`drawAir` style). At night: nav lights and a landing light cone (`weaponLights`-style lights).
- **On the ground:** a moving plane is solid. It **pushes and damages cars** in its way, like the train
  does, and knocks over the player on foot and peds. It never stops for anything on the runway (it's too
  heavy). Parked planes stay the static obstacles they are today; a plane that leaves its stand takes its
  obstacles with it, and the stand gets them when a plane parks there.
- **Out of range:** a flight whose airport is outside the AOV `keep` is simulated on a timeline only (no physics).
- **Sound:** a positional jet: a whine while taxiing, a roar at take-off, reverse thrust on landing (sound-agent,
  replacing the random `jet` ambience near the airport).

## 2. Port cranes loading the ship

Today three gantry cranes (sheet `boats`, tag `crane`, h 150, boom pointing south over the ship) stand at x 280,
296 and 312, y 719.5, over the container ship moored at the main quay.

- Each crane runs a **loading cycle**: the **trolley** runs along the boom to the quay side, the **spreader**
  lowers (it shrinks toward the ground, and its shadow sharpens) onto a container on the quay (or on a truck's
  flatbed), lifts it, runs out over the ship, lowers it into a deck slot, and returns empty. ~25 s per move,
  and the three cranes are out of phase.
- **The ship fills up:** containers land in real deck slots (drawn on top of the ship sprite). When the deck
  is full, the cranes switch to **unloading** onto the quay, so the loop never ends.
- **Gantry travel:** now and then a crane rolls a few tiles along its quay rails to its next bay (its leg
  obstacles move with it, and it pushes cars on the rails away).
- **Sound:** motor hum while moving, a clank when a container locks or lands (sound-agent).
- At night, the booms' warning lights blink (pixel-agent look).

## 3. Ownership

| Part | Owner |
|---|---|
| Route data: `c.airport = { runway: {x0,y0,x1,y1}, taxi: [waypoint paths], stands: [{ x, y, ang, tag, obstacles }] }`, `c.port = { rails, cranes: [{ x, y }], ship: { x, y, slots: [{ x, y }] }, quaySlots }`; parked planes and cranes become entries the systems own (not static `c.sprites`) | geo-agent |
| Crane art split into gantry, trolley, spreader and container sprites (and a boom light), plus plane nav and landing lights | pixel-agent |
| `Flights` and `Cranes` systems (new `src/airport.js`): schedule, motion, drawing through the sprite path, collisions with cars, the player and peds | vehicles-agent |
| Jet and crane sounds | sound-agent |

## 4. Tasks

| # | Task | Owner | Done when |
|---|---|---|---|
| X1 | Route and slot data per §3 (after P1 of peds-v1, same file) | geo-agent | an overlay shot of the airport paths and the port slots |
| X2 | Crane parts art (after P2 of peds-v1, same file) | pixel-agent | gallery shot |
| X3 | `src/airport.js`: flights, then cranes | vehicles-agent | shots: a landing in the air, a plane taxiing, a take-off roll; a crane mid-lift |
| X4 | Sounds | sound-agent | the soundboard has them |
| X5 | Integrate, README, backlog | coordinator | the user watches a landing and the cranes |
