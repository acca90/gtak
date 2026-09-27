# Backlog

The user's feature list (from `todo.txt`, 2026-09-26). The numbers are only IDs, in the order the user
remembered them, **not** a priority. We take one item at a time: design it, split it into small
achievable tasks, write a spec in `docs/specs/`, and build it. Update the status here as items move.

Status: `idea` → `designing` → `spec` (spec written, tasks split) → `building` → `done`.
Size is a first guess made before any design, not a measurement.

| # | Item | Size (guess) | Status | Depends on / touches |
|---|---|---|---|---|
| 0 | In-game time system | small–medium | built, awaiting play test (`docs/specs/time-v1.md`) | Replaces the O/N day-night toggle with a clock. Needed by 2 (decay timers), 6 (skip 30 min), 9 (save the clock). |
| 1 | Pedestrians / citizens | large | built, awaiting play test (`docs/specs/peds-v1.md`); cows as farm civilians; carjacking next round | Lifts the "no pedestrians" scope limit. Needs walkable sidewalk paths. Base for 2, 3 and 8's crossings. |
| 2 | Police and a 5-star wanted level | large | first slice built, awaiting play test (`docs/specs/cops-v1.md`: foot cops only); wanted level, police cars, SWAT, helicopter still to do | Needs NPC drivers (8) and cops on foot (1), plus new vehicles (SWAT van, police helicopter). |
| 3 | Three gangs, like GTA2 | massive | mob systems built (`docs/specs/gangs-v1.md`: respect, turf, members, gang cars), awaiting play test; story/missions parked (`docs/story/`) | Needs 1 (gang members), territory from geo-agent, and ties into 7. |
| 4 | Main character's home | small–medium | idea | Natural save point for 9. Geo-agent places it. |
| 5 | Car paint shop | small | built, awaiting play test (`docs/specs/paintshop-v1.md`); clearing stars waits for item 2's wanted level | Similar to the gun stores. Recolours sprites and clears wanted level? (to decide) |
| 6 | Brothel | small | idea | Needs 0 (skip 30 min) and 2 (removes 2 stars). |
| 7 | Story and missions | massive, later | owner: screenplay-agent; story bible first | Needs most of the others. The user flagged it as a long job for later. |
| 8 | Traffic | large | built (A + B1-B4; B5 density raised 2026-09-27), awaiting play test (`docs/specs/traffic-v1.md`) | Lifts the "no traffic" scope limit. Lane layouts and traffic lights already exist. |
| 9 | Save game, 3 slots | medium | idea | Must capture 0, 2, 3 and 4 state; localStorage (works on `file://`). |

**Side tasks** (2026-09-27): planes landing and taking off at the airport, cranes loading the ship at the port.
Status: built, awaiting play test (`docs/specs/ambient-v1.md`).

Carjacking (follows 1 and 8): built, awaiting play test (`docs/specs/carjack-v1.md`).

**World v3** (2026-09-27): the user's city-organisation ideas (fun Side City, biggest Main City, Major City
university, port to Ironworks, bridge north, subway, railway to the airport). Plan and steps W1-W7:
`docs/specs/world-v3.md`. Status: plan; W1 (railway to the airport) first.

## The user's notes, as written

**0. In-game time system.**

**1. Pedestrians / citizens**
- Some may fight back.

**2. Police and a five-star wanted level**
- One star: chased by one cop. Decays in 5 minutes without chaos and violence.
- Two stars: chased by a police car with two cops in it. Decays in 5 minutes without chaos or violence.
- Three stars: chased by two cars and four cops. Never decays.
- Four stars: chased by two police cars AND a SWAT police van. Never decays.
- Five stars: all of the above, plus a police helicopter. Police cars and cops respawn faster, and
  the game truly wants you dead.

**3. Three-faction system, like GTA2.**

**4. Main character's home.**

**5. Car paint shop.** Doesn't work for police cars or unusual vehicles.

**6. Brothel.** Spends money, restores health, removes 2 stars from the wanted level, and passes 30
minutes.

**7. Story and missions.** A long job for later.

**8. Traffic.**

**9. Save game system,** with 3 save slots.
