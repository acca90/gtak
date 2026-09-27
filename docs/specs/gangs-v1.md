# Spec: Mob pieces (backlog item 3, systems only)

Status: **built** 2026-09-27 (G1-G5 and G7 done: crews, rivals); not play-tested or listened to. Mob paints NOIR and ORCHID are gang-only (not sold in paint shops). Coordinator: main session.
The user: "Forget the story for now, lets just wire the pieces, later we connect everything." So this builds the
**mechanics only**: no story, no missions, no named characters in play. The story bible (`docs/story/`) stays a
parked proposal. Numbers are the screenplay-agent's recommended defaults and are **provisional** until the user
reviews them.

## 1. What goes in (from `mobs.txt` + `docs/story/mechanics.md`)

| Mob | Id | Based in (turf) | Members look | Cars |
|---|---|---|---|---|
| Italian (Big Tony) | `moretti` | Side City | black hair, red T-shirt | red muscle cars |
| Russian (Dimitri) | `orlov` | Major City, also present in Ironworks (fewer members) | blonde, black clothes | black sedans |
| Chinese (Han) | `orchid` | Main City | black hair, purple T-shirt | purple sports cars |

- **Respect:** one value per mob, -100..+100, starts at 0, no decay. Bands: kill on sight (<= -60), hostile
  (-59..-20), neutral, friendly (>= 20), trusted (>= 60).
- **War rule** (mobs.txt): respect gained with the Italians or Russians lowers the other by **half** (default;
  the user hasn't picked the ratio). The Chinese mob is outside the war.
- **Turf** = the district (`City.placeAt(x, y).district`); Ironworks counts as Orlov turf at a lower share.
- **What moves respect in this slice** (no missions yet): killing a member -6 with that mob (and +2 with its war
  rival for Moretti/Orlov kills), hurting one -1, stealing a gang car -3. (Missions add respect later.)
- **Gang members** are peds in their turf: ~12% of the ped budget there (Ironworks 6%), in the mob's outfit, armed
  more often than civilians (fists 40%, pistol 45%, uzi 10%, shotgun 5%). Behaviour by band: neutral or better:
  like a violent ped (fight back only when hurt); hostile: attack the player on sight within ~160 px;
  kill on sight: attack within ~260 px and chase. Members of the same mob help each other (a member attacked
  brings members within 200 px). **Rival mobs fight each other** when they meet (Moretti vs Orlov) — later
  (not in this slice).
- **Gang cars:** ~10% of traffic in a mob's turf is that mob's car (model + paint + a `gang` tag); its driver,
  if jacked, gets out as that mob's member (and counts as stealing a gang car).
- **Friendly fire and other attackers** (the user, 2026-09-27): a member hurt by his own mob (or a cop by a cop)
  doesn't retaliate; the damage still counts. A member hurt or killed by a civilian or a cop fights that attacker and
  the crew within 200 px rallies against them. Cops fight back against any non-cop ped who hurts them. A ped already
  fighting someone else keeps its target.
- **Mob cars carry a crew of two** (the user, 2026-09-27: "a mob car should always have two mob members that get
  angry with you if you hit them"). A gang car never flees or honks like a civilian: when the player hits it (rams it,
  shoots it, punches it, or blocks it), it brakes and **both members (driver + passenger) jump out and fight** the
  player; the empty car stays where it stopped. Jacking a gang car brings out both too: the yanked driver (down) and
  the passenger (fighting at once). Contract: `Peds.driverOut(car, x, y, ang, { gang, byPlayer: true, bail: true })`
  for a member on their feet and fighting; without `bail` it's the jacked-driver version (down first).
- **Rivals** (the user, 2026-09-27: "make the mobs avoid each other region, and shoot each other on sight if they
  meet"): members on foot don't choose walks into another mob's turf (x0.001 weight, only if there's no other way),
  gang cars don't choose lanes into it; members of different mobs (all three, not only the two at war) open fire on
  sight within 220 px with a clear line, and the crews rally; a gang car that sees a rival member or rival car bails
  its crew against them. None of it moves the player's respect.
- **Quiet flag:** `Gangs.quiet()` exists (false for now); missions set it later and cops honour it.
- **HUD:** three small mob badges with a 5-segment respect bar in a corner, a toast when respect changes band,
  and a short "+/-" flash on change (default; the user hasn't picked a style).

## 2. Ownership and contracts

| Part | Owner | Where |
|---|---|---|
| `src/gangs.js`: factions table, respect store, war rule, bands, turf, presence share, the API below | screenplay-agent | new file |
| Gang member outfits (2 variants per mob), two paint ramps (a pastel-world black, a deep purple) | pixel-agent | art pipeline |
| Gang members in `src/peds.js` (spawn share, looks, weapons, band behaviour, calling `Gangs`), the respect HUD | coordinator | peds.js, game.js HUD |
| Gang cars in traffic (spawn share per turf, `gang` field, paint) and the jacked driver's faction | vehicles-agent | `setupTraffic` / traffic spawn, `Game.jack` |

`Gangs` API (screenplay-agent writes; others read):
- `Gangs.list` → `[{ id, name, color, rival, turf: [districts], share, carModel, carPaint, outfit }]`
- `Gangs.respect(id)`, `Gangs.add(id, n, why)` (applies the war rule; raises `Gangs.onChange`)
- `Gangs.band(id)` → `'kos'|'hostile'|'neutral'|'friendly'|'trusted'`
- `Gangs.turfAt(x, y)` → mob id or null; `Gangs.presence(x, y)` → `{ id, share }` or null
- `Gangs.memberHurt(id, by)`, `Gangs.memberKilled(id, by)`, `Gangs.carStolen(id)` (by = G.player or not)
- `Gangs.quiet()` → bool
- `Gangs.save()` / `Gangs.load(o)` (for backlog 9 later)

## 3. Tasks

| # | Task | Owner | Done when |
|---|---|---|---|
| G1 | `src/gangs.js` per §2 (+ index.html tag), a `#demo&respect=moretti,-70` hook | screenplay-agent | check.js, a headless test of the war rule and bands |
| G2 | Outfits `moretti<k>_* / orlov<k>_* / orchid<k>_*` (k 0-1, same tags as `ped<k>_*`), `PAINTS` ramps for the Orlov black and Orchid purple | pixel-agent | gallery shot |
| G3 | Gang members in peds.js, respect HUD | coordinator | headless: members spawn in each turf; hostile ones attack; respect moves on kills; HUD screenshot |
| G4 | Gang cars in traffic + jacked gang drivers | vehicles-agent | a screenshot of each mob's car in its turf |
| G5 | Sounds (mob voice blips, respect sting) | sound-agent | soundboard |
| G6 | README, backlog, decision log, the user's play test | coordinator | the user drives into a hostile turf |
