# screenplay-agent — decision log
Format and rules: `.claude/rules/decisions.md`. Newest first.

## 2026-09-27 · src/gangs.js built (G1, mechanics only; numbers provisional)
- **Decision:** the user: "Forget the story for now, lets just wire the pieces". `Gangs` per gangs-v1 §2 plus
  `Gangs.get(id)`, `Gangs.set(id, n, why)` (no war rule; load/demo) and `Gangs.NUM` (the one balance table).
  Numbers: ±100, start 0, war ratio 0.5 (gains only; `Math.round(n*0.5)`), bands kos ≤−60 / hostile ≤−20 /
  friendly ≥20 / trusted ≥60; memberHurt −1 (caller counts once per ped), memberKilled −6 own +2 rival (set
  directly, no war rule on the +2), carStolen −3 (no `by`, always the player). Only `by === G.player` (or `true`)
  moves respect. Turf districts are mixed case as City returns them: 'Side City' → moretti, 'Major City' +
  'Ironworks' → orlov (Ironworks share 0.06 via `shareIn`), 'Main City' → orchid; share 0.12. Presence = turf
  owner only (the 1% strays / bridge 3% from mechanics.md §2 not in this slice). carPaint is a getter resolving
  ramp names at read time: CHERRY; NOIR else SLATE; ORCHID else LILAC. HUD colours #d04a5e / #2c2a36 (outline
  #7a849e) / #8a4fc0. State in `G.gangs = {respect, quiet}`; save = `{v:1, respect}`. Demo hook `respect=id,n`.
  Supersedes mechanics.md's kill −4 (spec says −6).
- **Why:** task G1 of docs/specs/gangs-v1.md.
- **Where:** `src/gangs.js`, index.html (before peds.js), `respect=` in Main.demo (src/game.js).
- **Status:** active (numbers provisional until the user reviews them)

## 2026-09-27 · Starter mission slice: 6 missions on the 4 existing types, data-driven
- **Decision:** v1 missions are mor1 Hot Basil (delivery → Sunrise Marina), mor2 Parking Violation (torch an
  Orlov sedan in Bridgeview), orl1 Four Minutes (delivery → Freight Yard, time bonus), orl2 Loud Red Car (boost a
  red muscle car from Side City → Boost Garage), orc1 Brakes Are a Suggestion (rush in Main City, quiet), orc2
  Breaking News (torch a news van by Union Station, quiet). They reuse delivery/boost/torch/rush through optional
  `params` (goal, area, model, paint, timer, drop, texts); a `MISSIONS` data table (planned `src/story.js`);
  random payphone jobs unchanged when params are absent. New types deferred: pickup, hit, chase, defend.
  WASTED on a mob job = fail (−3). The boost text "harbor garage" is stale (garage is in Ironworks).
- **Why:** the task asked for a first slice using only systems that exist; data, not new systems.
- **Where:** `docs/story/missions.md`; code not written yet.
- **Status:** active (draft, awaiting the user's reaction)

## 2026-09-27 · Respect model and the quiet-mission contract (proposal)
- **Decision:** respect per mob −100..+100, start 0; bands kill-on-sight (≤−60) / hostile (−59..−20) / neutral /
  friendly (≥20) / trusted (≥60). War rule: gains with Moretti or Orlov lower the other by **half** (user may prefer
  1:1); Orchids outside the war. Tier 1 jobs: +8 own / −4 rival, fail −3; kill a member −4 (rival +2). Turf = district
  in v1 (`City.placeAt().district`), no decay. Payphones ring only for the mob whose turf they're in. Quiet missions
  (all Orchid): `Gangs.quiet()` → cops don't engage on seen violence ("I SAW NOTHING."), attacking a cop still counts;
  later no stars during quiet missions except for cop kills. Pay tables per mob in mechanics.md §7.
- **Why:** GTA2-style design for backlog 3, keeping mobs.txt's rules.
- **Where:** `docs/story/mechanics.md` (contract with peds.js in §4).
- **Status:** active (proposal; HUD style, band numbers and the 1:2 ratio await the user)

## 2026-09-27 · Canon v1: mob names, lieutenants, love-interest stakes (proposals on top of mobs.txt)
- **Decision:** Italians = **Moretti Family** ("the Bruisers"), Big Tony Moretti, Mama Rosa (his mother, trattoria
  HQ, the existing MAMA ROSA contact), Sal "the Captain" Bruno (Sunrise Marina boats), Francesca = Tony's daughter,
  bookkeeper, wants to run the family. Russians = **Orlov Syndicate** ("the Undertakers"), Dimitri Orlov (ex-chess
  champion, obsessed with time), Yuri "Crane" Volkov (Ironworks, crane "Natasha"), the Professor Lev Sokolov
  (university, W6), Katherine = Dimitri's half-sister and lawyer, wants out with a case file as insurance.
  Chinese = **Orchid Society**, Han (landlord, golfs with Dick), Madame Mei (Orchid Club, off-screen), Lee = best
  driver, her brother held by Dick, wants the Society free of Dick (gender defaulted to "she", user to confirm).
  Commissaire Dick = on Han's payroll, running for mayor. BIG TONY contact = Moretti; ZED, LUCKY LOU = freelancers.
  Pot via Sunrise Marina; cocaine via the port (Ironworks after W3); Orchid business off-screen; the backlog-6
  brothel proposed as an Orchid business. Gang cars = existing muscle/sedan/sport models recoloured via `car.paint`.
- **Why:** first story bible; mobs.txt lines are canon and quoted verbatim, everything else is a proposal.
- **Where:** `docs/story/factions.md`, `docs/story/characters.md`, `docs/story/plot.md` (3 spines, none picked).
- **Status:** active (draft, awaiting the user's reaction)

## 2026-09-27 · Agent created; owns story, characters, missions, mob mechanics
- **Decision:** the user created screenplay-agent to own the story, characters, missions (`src/missions.js`,
  moved from the coordinator) and the mob mechanics (`src/gangs.js`). The source material is the user's
  `mobs.txt` (read-only): Italian mob (Big Tony, pot, at war with the Russians), Russian mob (Dimitri,
  cocaine, at war with the Italians), Chinese mob (Han, prostitution, allied with corrupt cops, their
  missions don't alert the cops); love interests Katherine (Russian side), Francesca (Italian), Lee
  (Chinese); Commissaire Dick, chief of police. Working for one side of the war lowers respect with the other.
  Looks, cars and bases (mobs.txt as updated 2026-09-27): Italians drive **red muscle cars**, members have black
  hair and red T-shirts, based in **Side City**; Russians drive **black sedans**, blonde, black clothes, based in
  **Major City** and present in **Ironworks**; Chinese drive **purple sports cars**, black hair and purple T-shirts,
  based in **Main City**.
- **Why:** the user, 2026-09-27: "we are ready to start to work in the mobs".
- **Status:** active
