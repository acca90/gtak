# Spec: Basic cops (first slice of backlog item 2)

Status: **built** 2026-09-27 (K1-K5 done); not play-tested or listened to. Coordinator: main session.
**No wanted level yet** (the user: "leave the wanted system for later"). This is only cops on foot who fight
you when they see you being violent.

## 1. Decisions (the user, 2026-09-27)

- Cops **see you doing violence** and start fighting you.
- They're **stronger than regular pedestrians** and carry a **pistol or a shotgun**.
- **Foot patrols only:** cops walk the sidewalks as a small share of the pedestrians, more downtown and around the
  police station. Police cars come with the wanted system.
- **They give up when you get away:** ~600 px away, or out of their sight for ~20 s; then they go back to patrolling.
  Driving off works.

## 2. Numbers (coordinator's first guesses)

| Thing | Value |
|---|---|
| Share of the peds budget | downtown 6%, suburbs 3%, industrial 4%, rural 2%, airport 8%; within 500 px of the police station 15% (was 700 px / 30%: the start is next to the station, and it put ~17 cops around you) |
| HP | 70 (a ped has 30): 8 pistol rounds, 2-3 point-blank shotgun blasts |
| Weapon | pistol 65%, shotgun 35% |
| Aim | ±0.07 rad (peds ±0.12); pistol bursts of 2, then 0.8 s; shotgun one blast every 1.1 s |
| Range | pistol: keeps 80-200 px; shotgun: closes to 40-110 px |
| Speed | walk 20 px/s (a beat); run 72 (faster than peds, slower than the player's 90) |
| Sight | 320 px, blocked by buildings (a line-of-sight test through `Physics.buildingAt`) |
| Radio | a cop who engages brings every cop within 260 px (no sight needed) |
| Give up | the player > 600 px away, or not seen for 20 s |
| Loot | the gun's ammo: pistol 12, shotgun 6 |

**What counts as violence** (only the player's, for now; derived in peds.js from the `Peds.alarm` / `Peds.hurt` calls that already carry the player as `src`, so no new hooks elsewhere): firing a gun or throwing a weapon where they can see it
(the shooter in sight), punching anyone, hitting a ped with a car (knockdown or kill), killing anyone or anything,
an explosion the player set off, carjacking. Hurting a cop always counts, sight or not. Crashing cars doesn't count.

Cops are never scared (alarms that don't count as violence just make them look). They don't fight violent peds
(later). A cop who sees the player driving off shoots at the car.

Bubbles: "POLICE! FREEZE!", "DROP IT!", "SHOTS FIRED!", "YOU'RE UNDER ARREST!", "OFFICER DOWN!" (when a cop dies within
sight of another). On giving up: "LOST HIM." The player can't be arrested yet: cops only fight.

## 3. Ownership

| Part | Owner | Where |
|---|---|---|
| `ZONES[z].peds.cops` shares and the police station hotspot (`c.policeStation = { x, y }` if not already there) | geo-agent | src/city.js |
| Cop art: 2-3 uniform outfits `cop<k>_*` with the same tags as `ped<k>_*`, plus `cop<k>_shotgun` (the shoot pose with a long gun) | pixel-agent | art pipeline |
| Cops in `src/peds.js`: spawning, the violence events and sight, radio, fighting, giving up, bubbles | coordinator | src/peds.js |
| Cop shouts, the "officer down" radio blip | sound-agent | audio.js |

## 4. Tasks

| # | Task | Owner | Done when |
|---|---|---|---|
| K1 | Cop shares + station hotspot | geo-agent | the peds table in geography.md |
| K2 | Cop outfits | pixel-agent | gallery |
| K3 | Cops in peds.js + demo hooks `cop=pistol\|shotgun[,n]` | coordinator | headless: a cop engages on a punch in sight, not through a wall; radio; gives up at 600 px |
| K5 | Sounds | sound-agent | soundboard |
| K6 | README, backlog (item 2 partly built), decision log, the user's play test | coordinator | the user gets into a gunfight with cops |
