# Spec: Pedestrians and cows (backlog item 1)

Status: **built** 2026-09-27: P1-P6 done (walk graph, art, src/peds.js, combat, cars vs bodies, sound); P7 integrated except the play test; not play-tested (the user's first look: peds too fast and dodging too much, fixed). Coordinator: main session.
This lifts the "no pedestrians" scope limit (the user, 2026-09-27). Carjacking moving traffic is the **next**
round, not this one. The gang file `mobs.txt` is unfinished: ignore it.

## 1. Decisions (the user, 2026-09-27)

- **Three personalities:**
  - **Scared:** runs away from violence.
  - **Angry:** complains at you (speech bubble, shakes a fist, follows a few steps) but never fights.
  - **Violent:** fights back when you hit them. Mostly fists, sometimes a **pistol**, rarely an **uzi**.
    ("…or steal their cars" arrives with carjacking next round.)
- **Density follows the traffic logic:** dense downtowns, thinner suburbs, few people on farms.
- **Streets:** peds walk the 3-tile sidewalks and cross at the **zebra crossings** on their green light;
  traffic brakes for them. Panicked people run anywhere, into the road too.
- **Loot:** a dead ped sometimes drops a small **wallet** ($10-50). An armed one drops its gun's ammo.
- **Cows are civilians of the farms:** they wander **inside their pasture**, can get **scared** (run) or
  **fight back** (a bull charges), and **die when you hit them with a car**.
- **Gore:** corpses and blood stay on the ground; people killed by fire (molotovs) leave a **burnt corpse**.
- Personalities are hidden: you find out by hitting someone.

## 2. Numbers (coordinator's first guesses, to tune by eye)

### 2.1 Density per zone

Density = peds alive per 100 sidewalk-graph tiles inside the AOV (the same budget method as traffic).
At night (22:00-06:00 on the clock) density is x0.5. Hard cap: 120 peds (raised from 70, 2026-09-27).

| Zone | Density | Scared / Angry / Violent | Violent armed: pistol / uzi |
|---|---|---|---|
| downtown | 16 (raised 2026-09-27 after screenshots; was 6.0) | 50 / 35 / 15 | 20% / 5% |
| suburbs | 2.5 (raised 2026-09-27 after screenshots; was 1.2) | 65 / 25 / 10 | 15% / 2% |
| industrial | 3 (raised 2026-09-27 after screenshots; was 1.5) | 35 / 30 / 35 | 30% / 8% |
| rural (farm towns) | 1.5 (raised 2026-09-27 after screenshots; was 0.8) | 50 / 25 / 25 | 25% / 3% |
| airport | 6 (raised 2026-09-27 after screenshots; was 3.0) | 60 / 30 / 10 | 10% / 0% |
| highway, wild | 0 | - | - |

### 2.2 Bodies and combat

| Thing | Value |
|---|---|
| Ped walk / run speed | 15-21 px/s (varies per ped) / 58 px/s (the player walks at 90); lowered 2026-09-27 after the user said peds were too fast. Dodge: 30% of close calls, only with >= 0.5 s of warning |
| Ped HP | 30 (pistol 9 per round: 4 shots; uzi 5; shotgun kills up close) |
| Player punch (new: fists do nothing today) | 8 dmg, 0.38 s cooldown, 13 px reach, 25% knockdown |
| Ped punch | 5 dmg to the player, 0.6 s cooldown |
| Ped pistol / uzi | the WEAPONS stats, but aim error ±0.12 rad and bursts: pistol 3 rounds, uzi 7, then a 1-1.5 s pause |
| Violent ped gives up | the player > 450 px away, or 25 s without contact |
| Car hits a ped | < 40 px/s: pushed; 40-110: knocked down, dmg = (v − 40) × 0.5; > 110: dead |
| Burning (in a fire patch, or near an explosion edge) | runs in random directions screaming for 3 s, then a burnt corpse |
| Wallet drop | 55% of dead peds, $10-50 (x `G.mult`); pistol ammo 12, uzi ammo 30 |
| Cow HP / speed | 60 / graze 6 px/s, run 70 px/s; 1 in 5 cows is a **bull** |
| Bull charge | 18 dmg + knockback to the player, 12 s then calms down; a car hit > 60 px/s kills any cow |

### 2.3 Reactions ("alarms")

Violence raises an alarm `{ x, y, r, kind, src }`, and peds and cows inside `r` react:

| Alarm | r (px) |
|---|---|
| gunshot (player or ped) | 260 |
| explosion | 420 |
| a ped hit or killed (witnesses) | 160 |
| car crash > 110 px/s, or a car on the sidewalk > 60 px/s | 120 |
| player punches someone | 90 |

- **Scared:** flee away from the alarm at run speed for 6-10 s, then calm down and go back to the nearest
  sidewalk path. Sometimes (20%) cower (crouch, hands on head) instead, when cornered.
- **Angry:** turn, complain in a bubble (`HEY!`, `WATCH IT!`, `ARE YOU NUTS?!`, `JERK!`, `I'M CALLING
  THE COPS!`), follow 2-3 s, then walk off. Gunfire or explosions within 120 px make them flee too, still yelling.
- **Violent:** alarms alone make them look around (a short bubble: `WANNA GO?`). **Only a hit on them**
  (punch, bullet, car knock) turns them hostile: chase the player and attack. Against a car: punch it
  (1 dmg per hit to the car) or shoot it.
- **Cows:** graze by default; an alarm makes cows stampede inside the pen; a bull that's hit charges.

## 3. Behaviour

- **Walking:** peds follow the sidewalk graph (loops around block rings, plus crossings). At each node they
  pick a random next edge (no immediate U-turn). They keep to the right-ish side of the sidewalk with a small
  random lateral offset, and step around each other and props.
- **Crossing:** a crossing edge is tied to a signalised node's axis. Peds wait at the kerb until the cars on that
  road have red, then cross. At unsignalised crossings they wait until no car within 120 px is approaching.
- **Traffic brakes** for peds and cows in its lane ahead (the same scan it uses for cars).
- **Streaming:** `AOV.pool('peds')`, spawning on the graph out of sight. Corpses are dropped outside `keep`.
  Cows are per pen: a pen keeps its herd count; cows only simulate inside `keep`; a killed cow is replaced
  out of sight after 3 minutes of real time.
- **Death:** ragdoll-lite: the body slides with the hit's momentum for 0.3 s, then lies as a corpse. Blood:
  a pool that grows under the corpse over ~2 s, then is painted permanently into the ground (the chunk
  decal system); run-overs leave a smear along the car's path, and the car's tyres print red for ~2 s. Fire
  deaths leave a charred corpse and a scorch mark, no blood. Explosions throw the body. Max 50 corpses:
  the oldest one out of sight goes first.
- **Night:** fewer peds (x0.5).

## 4. Ownership and contracts

| Part | Owner | Where |
|---|---|---|
| Sidewalk graph, crossings, ped zone table, pasture pens | geo-agent | `src/city.js` |
| Art: ped sheet, player punch, corpses, cows, blood look, wallet, speech bubble | pixel-agent | `tools/generate-art.lua`, `art/`, `assets/`, look-only render |
| Ped entity, pool, walking, crossing, alarms, personalities, cows, corpses, loot | coordinator | new `src/peds.js` |
| Player punch, NPC firing, damage to peds and cows from bullets / blasts / fire, burning | weapons-agent | `src/game.js` weapons code |
| Car-vs-ped and car-vs-cow hits, tyre blood, traffic braking for peds and cows | vehicles-agent | `src/entities.js`, `src/traffic.js` |
| Screams, grunts, complaints, punches, splat, scared moo, bull snort | sound-agent | `src/audio.js` + one-line hooks |

**Contracts:**

- **Walk graph (geo):** `c.walks = [{ id, x0, y0, x1, y1, len, zone, from, to, xing? }]` (axis-aligned
  segments along the sidewalk centre line; `xing = { node, axis }` on crossing edges, `node` = the lane-graph
  node id whose `Render.signalFrame(axis)` controls the road being crossed, or `null` when unsignalised);
  `c.walkNodes = [{ id, x, y, edges: [walk ids] }]`; `City.walksIn(x0, y0, x1, y1, out)`, `City.walkAt(x, y, r)`;
  `ZONES[z].peds = { density, mix: { scared, angry, violent }, armed: { pistol, uzi } }` from §2.1;
  `c.pens = [{ id, x0, y0, x1, y1, cows }]` in px, replacing the `cow` props (none left in `c.props`).
- **Ped (coordinator):** `{ x, y, ang, vx, vy, hp, kind: 'ped'|'cow', mood: 'scared'|'angry'|'violent',
  bull, weapon: 'fist'|'pistol'|'uzi', look (outfit index), state, dead, burnt, burning, gone }` in `G.peds`;
  `G.pedGrid` (a `Grid`, rebuilt every tick). API: `Peds.hurt(p, dmg, { kind: 'punch'|'bullet'|'blast'|'fire'|'car',
  src, vx, vy })`, `Peds.alarm(x, y, r, kind, src)`, `Peds.near(x, y, r)`, `Peds.kill(p, how)`.
- **NPC firing (weapons):** `Game.fireWeapon(shooter, weaponId, ang)`, the shared part of `shoot` without the
  player's ammo or input; bullets carry `src` and hurt the player and peds (not their own shooter).
  `Game.punch(attacker, ang)` for the player and peds, which hits peds, cows, the player and cars.
- **Art (pixel):** sheet `peds` (16×16): `N` outfits as separate tags `ped<k>_idle|walk|run|punch|shoot|down|dead`,
  plus `burning` (2-3 frames, shared) and `burnt` (charred corpse, shared); player sheet gets `punch` (2 frames);
  sheet `animals` (cow 16×16 → keep today's look): `cow_idle`, `cow_walk`, `cow_run`, `cow_dead`, `bull_*` (darker,
  horns); `props: wallet`, a speech-bubble style for Font text. Blood pool/splat/smear are painted by
  `Render.blood(x, y, size)`, `Render.smear(x0, y0, x1, y1)`, look owned by pixel-agent.

## 5. Tasks

Each ends with `node tools/check.js`, `node tools/bench.js` (update time must stay < 1.5 ms with a full ped
budget plus traffic), a screenshot looked at, and a report with a **Handoff**.

| # | Task | Owner | Done when |
|---|---|---|---|
| P1 | **Walk graph + pens.** §4 contract; `#demo&walks` draws walks, crossings (green = signalised) and pens; `geo-report --check` validates it; `ZONES[z].peds`. | geo-agent | overlay shots of a downtown junction, a suburb and a farm pasture |
| P2 | **Art.** §4 art contract: at least 8 ped outfits (skin tones, hair, jackets, a few dresses/suits/work overalls), player punch, burning + burnt, cow/bull set, wallet, blood look, bubble. | pixel-agent | gallery shot; the style fits the player sprite |
| P3 | **Peds core.** `src/peds.js`: pool, walking the graph, crossings with lights, drawing, alarms, scared/angry state machines, bubbles, `Peds.hurt/kill`, corpses + blood, wallet loot, cows in pens. Demo hooks `peds`, `ped=scared|angry|violent`, `cows`. | coordinator | shots of a busy downtown by day and by night, a crossing with people waiting, a scattered crowd, a pasture |
| P4 | **Combat.** Player punch, `fireWeapon`, bullets/blasts/fire hurt peds and cows, burning peds, the violent ped's attack (fists, pistol, uzi bursts), bulls charging. | weapons-agent | a scripted fight with each weapon, screenshots |
| P5 | **Cars vs bodies.** Car-vs-ped/cow hits per §2.2, blood smear + red tyre prints, traffic brakes for peds and cows in its lane. | vehicles-agent | a scripted run-over and a traffic car stopping for a crossing ped |
| P6 | **Sound.** Screams, angry grunts, punch hit/whiff, body thud, splat, burning scream, scared moo, bull snort. | sound-agent | the soundboard has them, and the hooks fire |
| P7 | **Integrate.** Traffic B5 (raise downtown density) in the same pass; bench; README (controls: punch), decision log, backlog; the user's play test. | coordinator | the user plays |

Order: P1 and P2 in parallel (different files). P3 after P1 (it can use placeholder dots until P2 lands).
P4 and P5 in parallel after P3 (they call its API). P6 after P4/P5. Then P7.
