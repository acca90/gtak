# vehicles-agent — decision log (index)
Format and rules: `.claude/rules/decisions.md`. Newest first. Full entries (Decision / Why / Where /
Status) are in [decisions-log.md](decisions-log.md): read the entry before changing its area, and add
new entries at the top of that file plus one line here.

- 2026-09-27 · Gang car crews (G7): no civilian reactions; hit/block/rival → brake, 2 members bail and fight; turf-avoiding routes · active
- 2026-09-27 · Gang cars (G4): 10% of turf traffic × presence/mob share, parked 1/15 on region-mix spots, `c.gang`, stolen once → `Gangs.carStolen` · active (its B4 flee superseded by G7)
- 2026-09-27 · Carjacking (C1): `Game.jack`, door rules, 0.35 s yank/in, reverse jack by peds, witness honks · active
- 2026-09-27 · Airport flights and port cranes (X3): src/airport.js schedule, speeds, plane collisions · active
- 2026-09-27 · Cars vs peds/cows (P5): push < 40, knock 40-110, kill > 110; smears; traffic brakes for bodies · active
- 2026-09-26 · Traffic reactions (B4): honk double taps, pass on the left, flee 10 s at max · active
- 2026-09-26 · Traffic driver AI (B2): pure pursuit, cruise 35%/55%, gaps, lights, yields, arcs ≥ 1.15 × 120/steer · active
- 2026-09-25 · Helicopter: flight model, altitude levels, exit only landed on the street · active
- 2026-09-25 · Horn classes (small/car/truck), siren flag, tap toggles siren / hold honks · active
- 2026-09-25 · Train on any axis-aligned rail with optional station stops · active
- 2026-09-25 · Ambulance: max 340, mass 2.0, hp 240, no region weight · active
- 2026-09-25 · One tank, strongest, immune to collisions and small arms, 35% from explosions · active
- 2026-09-25 · Speed/toughness ladder: tank 165 · heavies 205-230 · everyday 255-320 · muscle 370 · police SUV 375 · police 400 · sport 430 · active
- 2026-09-25 · Freight train: 150 px/s, unstoppable, shoves and damages · active
- 2026-09-25 · Fuel tankers (`volatile`) explode along their length · active
