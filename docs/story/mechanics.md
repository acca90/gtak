# Mob mechanics (backlog item 3)

Status: **v1 draft** 2026-09-27, design only, nothing built. Owner: screenplay-agent (`src/gangs.js`,
`src/missions.js`). Gang members are peds, spawned and driven by the coordinator's `src/peds.js` through
the contract in §4. Numbers are first guesses to tune by play.

Tags: **[today]** works with systems that exist now · **[later: X]** waits for system X.

## 1. Respect

- **One value per mob**, `-100 .. +100`, start **0** for all three (see Questions: the Orchids could start
  a bit positive). Stored in `Gangs.state.respect = { moretti, orlov, orchid }`.
- **Five bands** (the number drives everything else):

| Band | Range | Members in their turf | Jobs |
|---|---|---|---|
| **Kill on sight** | -100 .. -60 | armed members attack as soon as they see you; gang cars chase you **[later: gang drivers]** | none |
| **Hostile** | -59 .. -20 | members fight if you come within ~60 px or hit anyone near them | none |
| **Neutral** | -19 .. +19 | like angry peds: complain, fight back only if hit | tier 1 (starter) |
| **Friendly** | +20 .. +59 | never start a fight; ignore a stray punch | tiers 1-2, lieutenants call you |
| **Trusted** | +60 .. +100 | help you: shoot at rival members and at cops (not Orchids at cops) near you | tiers 1-3, story missions, love-interest arc |

- **The war rule** (the user's): respect **gained** with the Morettis lowers the Orlovs by **half** that
  amount, and the other way round. The Orchids are outside the war: working for either side doesn't move
  them, and working for them doesn't move the others. (The half is a proposal; the user may want 1:1.)
- **What moves respect** (per event; the per-mob tables below override the job numbers):

| Event | Own mob | Its war rival | Notes |
|---|---|---|---|
| Complete a job | + job's value | − half (war only) | [today] |
| Fail a job | −3 | 0 | [today] |
| Kill one of its members | −4 | +2 (war only) | [needs gang peds] |
| Punch / hurt one of its members | −1 | 0 | once per ped |
| Destroy one of its cars (with or without a driver) | −3 | +1 (war only) | [needs gang cars] |
| Kill a cop | Orchids −1 | | the partners don't like dead customers (proposal) |

- **No decay** in v1 (GTA2 doesn't decay either). Respect is capped at ±100.
- **How it shows** (the user's choice, see Questions). Recommended: three small **faction badges** in a
  HUD corner, each with a 5-segment bar in the mob's colour, flashing for 2 s when it changes, plus a toast
  ("MORETTI RESPECT +10 · ORLOV −5"). The phone could also get a **MOBS** app later.

## 2. Turf

- **Turf = district** in v1, from the user's bases: Side City → Morettis; Major City and Ironworks →
  Orlovs; Main City → Orchids. Farms, the airport and the wilds are nobody's.
- `Gangs.turfAt(x, y)` reads `City.placeAt(x, y).district` and a table `TURF = { 'SIDE CITY': 'moretti',
  ... }` (no new geo data needed for v1). Contested edges come later (see Questions: the bridge, the
  SE Farms).
- **Presence per district** (share of the district's ped budget that spawns as gang members):

| District | Moretti | Orlov | Orchid |
|---|---|---|---|
| Side City downtown / suburbs | 14% / 7% | 1% | 1% |
| Major City downtown / suburbs | 1% | 12% / 6% | 1% |
| Ironworks | 0 | 8% | 0 |
| Main City downtown / suburbs | 1% | 1% | 12% / 6% |
| Pastel Gate Bridge sidewalks, Route 1 | 3% | 3% | 0 |
| Farms, airport, wild | 0 | 0 | 0 |

The 1% "strays" in rival turf make the war visible on the street: a stray meeting locals starts a
gunfight between them **[later: ped-vs-ped fights; peds.js today only fights the player]**.

## 3. Gang members (the looks are the user's)

| Mob | Look (the user's) | Weapons | HP | Bubbles |
|---|---|---|---|---|
| Moretti | black hair, **red T-shirt** | fists 40%, pistol 40%, shotgun 20% | 45 | "HEY! THIS IS MORETTI STREET!", "YOU LOOKING AT MY CAR?", "MAMA'S GONNA HEAR ABOUT THIS" |
| Orlov | **blonde, black clothes** | fists 25%, pistol 35%, uzi 40% | 45 | "YOU ARE LATE.", "WRONG DISTRICT.", "DIMITRI SENDS REGARDS." |
| Orchid | black hair, **purple T-shirt** | fists 35%, pistol 50%, uzi 15% | 45 | "THIS IS A MISUNDERSTANDING.", "MOVE ALONG.", "WE'LL SEND AN INVOICE." |

- A member is a ped with `gang: 'moretti'|'orlov'|'orchid'` and a gang look (§4). They walk the same
  sidewalks. Their hostility is not a hidden mood: it comes from the player's respect band (§1).
- Friendly and Trusted members greet the player: "HEY, IT'S YOU!" (Moretti), "ON TIME, GOOD." (Orlov),
  "HAN SPEAKS WELL OF YOU." (Orchid).
- Killing a member drops their gun's ammo, like violent peds.
- **Gang cars** (the user's): red muscle cars, black sedans, purple sports cars. They appear as parked cars
  and traffic in their turf (~10% of the turf's cars), using the paint shop's recolour (`car.paint`) on the
  existing `muscle`, `sedan`, `sport` models; a car gets `gang` so destroying it counts. **[today: parked and
  traffic cars; later: gang drivers who chase and do drive-bys]**
- Idea for later: driving a mob's car in their turf when you're Hostile keeps members from noticing you
  (GTA2 did something similar with gang cars).

## 4. The contract with `peds.js` (proposal for the coordinator)

```
// gangs.js (screenplay-agent)
GANGS = { moretti: { name, color, look: 'moretti', weapons: {fist, pistol, shotgun}, hp, says: [...] }, orlov: {...}, orchid: {...} }
Gangs.turfAt(x, y)            -> 'moretti' | 'orlov' | 'orchid' | null
Gangs.presence(x, y, zone)    -> { moretti: 0.14, orlov: 0.01, orchid: 0.01 }   // share of the ped budget
Gangs.respect(id)             -> -100..100
Gangs.band(id)                -> 'kill' | 'hostile' | 'neutral' | 'friendly' | 'trusted'
Gangs.hostile(id)             -> true when members should attack the player on sight (band 'kill')
Gangs.touchy(id)              -> radius (px) within which a Hostile member attacks (60, else 0)
Gangs.add(id, n, why)         -> applies n, the war rule, the toast; returns the new value
Gangs.onKill(ped, by) / Gangs.onHurt(ped, by) / Gangs.onCarDestroyed(car, by)   // respect events
Gangs.quiet()                 -> true while cops must look away (§6)
Gangs.save() / Gangs.load(o)  // §8

// peds.js (coordinator)
- spawnAt(): roll Gangs.presence() before the cop roll; a gang ped gets p.gang = id, weapon from
  GANGS[id].weapons, hp = GANGS[id].hp, look from the gang's outfits, mood 'gang'.
- the 'gang' mood: walks like any ped; each tick near the player, attacks when Gangs.hostile(id) and it
  sees the player, or when within Gangs.touchy(id); otherwise reacts to alarms like a violent ped.
- Peds.kill / Peds.hurt call Gangs.onKill / Gangs.onHurt when the source is the player.
- the art tags follow the ped sheet: moretti<k>_*, orlov<k>_*, orchid<k>_* (same animations as ped<k>_*).
```

## 5. How jobs are offered

- **Payphones by turf [today]**: the eight payphones already have a `district`. A payphone in a mob's turf
  only rings with **that mob's** jobs, and "RING!" is drawn in the mob's colour. Phones outside any turf
  (farms, airport) ring for freelancers. The existing random ring timer stays.
- **Cellphone contacts [today]**: `MAMA ROSA` and `BIG TONY` become Moretti contacts, `ZED` and
  `LUCKY LOU` stay freelancers. New contacts appear in the phone when unlocked (Friendly: a lieutenant;
  Trusted: the leader and the love interest). A contact calls when it has a job.
- **Job tiers** per mob: tier 1 (starter, Neutral), tier 2 (Friendly), tier 3 (Trusted). v1 builds tier 1
  only (`missions.md`). Missions run in order within a mob (a chain), with the random jobs as filler.
- **Blocked**: a mob at Hostile or worse doesn't call and its payphones stay silent; its leader sends
  one message when you cross the line ("WE'RE DONE, YOU AND ME." / "YOU ARE NO LONGER ON THE SCHEDULE." /
  "HAN IS DISAPPOINTED.").

## 6. "Chinese missions do not warn the cops" (the user's rule, a contract with the police code)

- A mission can be **quiet** (`quiet: true` in its data). All Orchid missions are quiet.
- `Gangs.quiet()` is true while a quiet mission is active.
- **Today (cops-v1):** while `Gangs.quiet()`, `Peds.crime()` doesn't make cops engage: cops who see the
  violence look away with a bubble ("I SAW NOTHING.", "NOT MY SHIFT."). Hurting or shooting a cop still
  counts: a cop you attack fights back.
- **Later (backlog 2, wanted level):** during a quiet mission, crimes add **no stars** (killing a cop
  still adds them). When a quiet mission ends, the wanted level returns to what it was when it started,
  unless you killed a cop.
- **Later, a proposal:** at Orchid **Trusted**, one star decays in half the time anywhere in Main City
  (the cops there are "friends").

## 7. Rewards: respect and money per mob

Money is paid through `Game.earn`, which applies the GTA1 multiplier (`G.mult`) as the existing jobs do.
The rival column is the war rule (half, rounded down).

**Moretti Family**

| Tier | Unlocked at | Pay | Moretti | Orlov |
|---|---|---|---|---|
| 1 | Neutral (≥ −19) | $1,500 – 3,000 | +8 | −4 |
| 2 | Friendly (≥ 20) | $4,000 – 6,000 | +12 | −6 |
| 3 | Trusted (≥ 60) | $8,000 – 12,000 | +20 | −10 |
| Fail | | 0 | −3 | 0 |

**Orlov Syndicate** (Dimitri pays a bonus for spare time: +$20 per second left on the timer)

| Tier | Unlocked at | Pay | Orlov | Moretti |
|---|---|---|---|---|
| 1 | Neutral | $1,500 – 3,000 (+time bonus) | +8 | −4 |
| 2 | Friendly | $4,000 – 6,000 (+time bonus) | +12 | −6 |
| 3 | Trusted | $8,000 – 12,000 (+time bonus) | +20 | −10 |
| Fail | | 0 | −3 | 0 |

**Orchid Society** (pays less, because the cops look away)

| Tier | Unlocked at | Pay | Orchid | Others |
|---|---|---|---|---|
| 1 | Neutral | $1,200 – 2,500 | +8 | 0 |
| 2 | Friendly | $3,000 – 5,000 | +12 | 0 |
| 3 | Trusted | $6,000 – 10,000 | +20 | 0 |
| Fail | | 0 | −3 | 0 |

Freelancer jobs (Zed, Lucky Lou, unowned payphones) keep today's pay and move no respect.

## 8. Saving (backlog 9) [later: save system]

`Gangs.save()` returns a small object for the save slot: `{ respect: { moretti, orlov, orchid },
done: ['mor1', ...], flags: { ... }, unlocked: ['SAL', ...] }` (completed mission ids, story flags and
unlocked contacts). `Gangs.load(o)` restores it. Nothing else in gangs.js needs saving (members are
streamed).

## 9. What waits for other systems

| Feature | Waits for |
|---|---|
| Gang members on the sidewalks, respect from kills | peds.js `gang` mood + outfits (coordinator, pixel-agent) |
| Gang cars recoloured in traffic | a black and a deeper purple paint ramp (pixel-agent), traffic spawn hook (vehicles-agent) |
| Gang drivers who chase, drive-bys | the wanted-level's police drivers (backlog 2) or a gang driver mode in traffic.js |
| Members fighting rival members | ped-vs-ped combat in peds.js |
| Quiet missions and stars | the wanted level (backlog 2) |
| HQs, contested turf, named mission places | geo-agent data (`c.gangs`) |
| Respect HUD | coordinator (HUD) after the user picks the style |
| Saving | backlog 9 |
