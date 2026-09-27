# Missions

Status: **v1 draft** 2026-09-27: the first slice, two starter missions per mob, specs only (no code yet).
Owner: screenplay-agent (`src/missions.js`). Respect and pay follow the tier 1 rows in `mechanics.md` §7.

## How the slice is built (the plan for `missions.js`)

All six missions **reuse the four existing types** (`delivery`, `boost`, `torch`, `rush`). What's new is
data, not systems:

1. A `MISSIONS` table (in `src/story.js`, added to `index.html`): one entry per scripted mission with
   `id, mob, giver, title, type, params, brief, lines, pay, respect, quiet, next`.
2. The four types read optional `params` instead of their hard-coded picks and texts:
   `goal` (a `G.city.places` name), `area` (a district: spots are picked inside it), `model`, `paint`
   (a `PAINTS` id, so the car looks like a mob's car), `timer`, `drop` (a place, default the Boost Garage).
   Without params they behave exactly as today, so the random payphone jobs don't change.
3. `Missions.complete` / `fail` call `Gangs.add` with the mission's respect (and apply the war rule);
   a WASTED during a mob job counts as a fail (−3), not a silent one.
4. The existing `boost` line "take it to the harbor garage" is wrong since World v2 (the Boost Garage is in
   Ironworks, Dockside Works): the text becomes a parameter.
5. Demo hooks: `mission=<id>` also accepts the scripted ids (`mor1` … `orc2`).

Places used below all exist today as `goto` names: Sunrise Marina, Freight Yard, Boost Garage, Union Station.

---

## Moretti Family (Side City)

### mor1 · Hot Basil
- **Giver:** Mama Rosa (Side City payphone, or her phone contact). **Type:** `delivery`.
- **Briefing:** "My son says you drive. A crate of fresh basil for Sal at the marina. It's already wrapped.
  Get any car and go, before it wilts."
- **Objectives:** 1. get into any car; 2. reach the drop at **Sunrise Marina** before the timer ends
  (timer: the existing formula, distance / 220 + 16 s).
- **Fail:** out of time; WASTED.
- **Complete line (Sal):** "She arrived! Tell Mama the basil smells... like basil."
- **Reward:** $1,500. **Respect:** Moretti +8, Orlov −4.
- **Next:** unlocks mor2 (Big Tony calls).

### mor2 · Parking Violation
- **Giver:** Big Tony (phone call). **Type:** `torch`.
- **Briefing:** "One of Dimitri's hearses is parked in Bridgeview. On MY side of the bridge. Like a
  flag. Burn it, and make it look like an accident. Or don't. I don't care."
- **Params:** model `sedan`, paint black (the Orlov car; needs pixel-agent's black ramp, SLATE until
  then), area **Side City**, near the bridge (Bridgeview), timer 90 s. The existing "take this piece"
  (24 pistol rounds when low on ammo) stays.
- **Objectives:** destroy the marked sedan.
- **Fail:** out of time; WASTED.
- **Complete line (Tony):** "Beautiful. Like a birthday candle. Welcome to the war, kid."
- **Reward:** $2,500. **Respect:** Moretti +8, Orlov −4.
- **Story note:** this is the job that makes the player part of the war.

## Orlov Syndicate (Major City, Ironworks)

### orl1 · Four Minutes
- **Giver:** Dimitri (a phone handed through a black sedan's window; in v1 simply his call or a Major City
  payphone). **Type:** `delivery`.
- **Briefing:** "A briefcase is in your car. Do not open it. Deliver it to the freight yard in Ironworks.
  You have the time on the screen, and not one second more."
- **Params:** goal **Freight Yard**, timer: the existing formula minus 4 s ("four seconds late"), time
  bonus $20 per second left.
- **Objectives:** reach the Freight Yard in a car before the timer ends.
- **Fail:** out of time; WASTED.
- **Complete line (Dimitri):** "Arrived with 11 seconds to spare. Adequate." (the real number is shown)
- **Reward:** $2,000 + time bonus. **Respect:** Orlov +8, Moretti −4.
- **Next:** unlocks orl2 (Yuri calls).

### orl2 · Loud Red Car
- **Giver:** Yuri "Crane" Volkov (phone call). **Type:** `boost`.
- **Briefing:** "The tomato people park their red cars in front of our yard to annoy me. Bring me one.
  Quietly. The garage by the bay, in one piece. Natasha wants to lift it."
- **Params:** model `muscle`, paint CHERRY (the Moretti car), area **Side City** (the player has to go
  into Moretti turf to take it), drop **Boost Garage**.
- **Objectives:** 1. get in the marked red muscle car; 2. bring it to the Boost Garage and stop.
- **Fail:** the car is destroyed; WASTED.
- **Complete line (Yuri):** "It is so loud. Natasha likes it."
- **Reward:** the existing formula, $1,000 + $2,500 x car health (so $1,000-3,500).
  **Respect:** Orlov +8, Moretti −4.

## Orchid Society (Main City) · both quiet (cops look away)

### orc1 · Brakes Are a Suggestion
- **Giver:** Lee (a Main City payphone rings; she's on the line). **Type:** `rush`. **Quiet.**
- **Briefing:** "Han says you can drive. Han says a lot of things. Five marks around Main City. Beat my
  time and we talk. Lose and you walk home."
- **Params:** area **Main City** (all five checkpoints inside it).
- **Objectives:** hit the five checkpoints in order; each adds 12 s (existing rules).
- **Fail:** out of time; WASTED.
- **Complete line (Lee):** "Not bad. The old man will want to meet you. Don't slurp the tea."
- **Reward:** $1,200 + $60 per second left (existing formula). **Respect:** Orchid +8.
- **Next:** unlocks orc2 (Han calls).

### orc2 · Breaking News
- **Giver:** Han (phone call). **Type:** `torch`. **Quiet.**
- **Briefing:** "A news van is parked by Union Station. It holds a video of our friend the Commissaire
  at a party he would prefer to forget. Please turn the van into a small bonfire. The police will be
  looking at something else."
- **Params:** model `van` (a PCTV livery later, optional), area **Main City**, near **Union Station**,
  timer 90 s.
- **Objectives:** destroy the marked van. Cops who see it say "I SAW NOTHING." and don't engage
  (the quiet rule, `mechanics.md` §6).
- **Fail:** out of time; WASTED.
- **Complete line (Han):** "The Commissaire sends his thanks. He doesn't know he does, but he does."
- **Reward:** $2,000. **Respect:** Orchid +8.

---

## Mission types

| Type | Status | Used by |
|---|---|---|
| `delivery` | exists; needs `goal`, `timer`, time-bonus params | mor1, orl1 |
| `boost` | exists; needs `model`, `paint`, `area`, `drop`, text params | orl2 |
| `torch` | exists; needs `model`, `paint`, `area`/`near` params | mor2, orc2 |
| `rush` | exists; needs `area` | orc1 |
| `pickup` | **new, later**: collect at A (on foot or by car), then deliver to B | tier 2 smuggling (the marina, the port) |
| `hit` | **new, later**: kill a marked ped who walks or flees (uses `Peds.spawnPed`) | tier 2: a rival lieutenant, a witness |
| `chase` | **new, later**: destroy a moving gang car (needs a scripted traffic driver) | tier 2-3: the war |
| `defend` | **new, later**: survive waves of rival members at a place | tier 3: HQ attacks (needs ped-vs-ped and gang members) |
