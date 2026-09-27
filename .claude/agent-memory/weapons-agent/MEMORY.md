# weapons-agent — decision log
Format and rules: `.claude/rules/decisions.md`. Newest first.

## 2026-09-27 · Weapons vs bodies (spec docs/specs/peds-v1.md P4)
- **Decision:** player punch `WEAPONS.fist` = 8 dmg, 0.38 s, 13 px reach, ±1.0 rad cone, push
  60 px/s, 1 dmg to cars (the tank ignores fists), anim `PUNCH_T` 0.22 s (frame 0 for the first
  0.1 s). Peds punch with `PED.FIST` (coordinator's numbers). Body hit radii `BULLET_R` ped 5 / cow 9 /
  player 5; a rocket goes off on a body at +2 px. Round push = `BULLET_PUSH` 0.06 × velocity
  (pellets 0.16). Blasts hurt peds/cows with the blast's `pr`/`player` numbers, throw them
  250 × max(k, 0.25) px/s, toss corpses within 1.3 × pr, and set a survivor in the outer half
  alight 35% of the time (`BLAST_IGNITE`). Fire hurts bodies at `fire.player`/s in 0.5 s pulses
  (a ped catches fire on first touch; cows never burn). Gunshot alarm: 260 px, at most 1 per
  shooter per 0.3 s, delivered `SHOT_REACT` 0.15 s late.
- **Why:** the reaction delay stops the target fleeing before the round arrives: shotgun kills at
  35 px went from 3/30 to 22/30. The 0.3 s throttle keeps Uzi fire from running an alarm every tick.
- **Where:** `shoot`, `fireWeapon`, `punch`, `shotAlarm`, `updateBullets`/`bulletHits`,
  `blastBodies`, `updateFires` in src/game.js.
- **Status:** active

## 2026-09-27 · Firing contract: `Game.fireWeapon(shooter, id, ang)` and `Game.punch(attacker, ang)`
- **Decision:** `fireWeapon` spawns rounds, rockets and throws with muzzle, sound and alarm, but
  no ammo, cooldown or input. Camera shake only for the player, and a ped's gun never clicks
  empty. Every projectile carries `src`. A round never hits its `src`. The player's rounds (and
  their tank's shells, `src.driver === player`) never hit the player or their car. A ped's rounds
  hit the player on foot, the player's car, and other peds. `punch` picks the nearest body in the
  cone (peds, cows, the player; never the attacker), else a car the fist touches (a ped fighting
  the driver always reaches the player's car). Blasts take the owner as `explode(..., src)`, and an
  unknown owner defaults to the player.
- **Why:** peds.js (coordinator) calls both, and the player's `shoot` wraps `fireWeapon`.
- **Status:** active

## 2026-09-27 · Rejected: rebalancing the shotgun for peds
- **Decision:** kept the v2 shotgun (6 × 7, ±0.22 rad) against 30 hp peds. It kills reliably up to
  ~35 px and takes 2 blasts at 50–70 px. That matches "kills up close".
- **Status:** active

## 2026-09-26 · A grenade bounce counts only above 30 px/s of impact
- **Decision:** `bounced(q, hit)` gets the impact speed into the surface. Below 30 px/s it does
  nothing (no count, no sparks, no tink); sparks only above 60 px/s. A grenade hitting a car
  slower than 30 px/s settles: velocity goes to 0, and it's nudged 1 px out if the car moves
  onto it.
- **Why:** resting contact against the tank fired `bounced` every sub-step (548 calls in ~3 s),
  which spammed sparks and the tink sound.
- **Status:** active

## 2026-09-26 · Weapons v2 numbers (spec docs/specs/weapons-v2.md §2)
- **Decision:** `WEAPONS` in src/entities.js holds every number, plus `shop: { price, pack, max,
  stats, blurb }` on each buyable weapon. Pistol 0.32 s / 9, $200 / 24, max 240. Uzi 0.085 s / 5,
  $500 / 90, max 450. Shotgun 0.8 s, 6 pellets × 7, ±0.22 rad, 520 px/s × 0.33 s (~170 px), push 14
  per pellet, $800 / 12, max 60. Bazooka 1.2 s, rocket 320 px/s × 1.4 s, `direct` +50 to the car
  it hits, then the default blast (90 px / 110 car / 70 px / 75 player), $2000 / 5, max 20.
  Grenade 0.6 s, range 160 px, fuse 2.0 s from the throw, blast 75 px / 95 car / 60 px / 65 player,
  $600 / 5, max 20. Molotov 0.7 s, range 150 px, fire patch r 28 px for 6 s, 12 car dmg/s (in
  0.5 s pulses), 22 player dmg/s, ignites a car after 0.5 s inside, $400 / 5, max 20.
  Crates: pistol +24, Uzi +90 (`WEAPONS[id].crate`), clamped to `shop.max`.
- **Why:** the user asked for the classic GTA arsenal and gun stores; the coordinator's shop UI
  and start money ($10,000) rely on these prices.
- **Where:** `WEAPONS` (entities.js); `shoot`, `throwProjectile`, `updateProjectiles`,
  `updateFires`, `explode(x, y, big, o)` in game.js.
- **Status:** active

## 2026-09-26 · Tank vs fire: 35% heat, never catches fire from a molotov
- **Decision:** molotov fire and rocket direct hits use the same 35% tank factor as `explode`.
  A fire patch never sets `burning` on the tank. Pellets are small arms, so the tank is immune
  (they still shove it).
- **Why:** it keeps the tank rule (only explosions hurt it) consistent. Tank armour belongs to
  vehicles-agent, and it was told.
- **Status:** active

## 2026-09-26 · Auto-fallback never picks an explosive
- **Decision:** when the current weapon runs dry, switch to the first owned weapon of
  `WEAPON_FALLBACK = ['uzi', 'shotgun', 'pistol']`, else fists. Slot keys 1–7 are ignored for a
  weapon without ammo, and Q/Tab cycles the owned weapons in `WEAPON_ORDER`.
- **Why:** holding fire as an Uzi runs dry must not launch a rocket at point-blank range.
- **Status:** active

## 2026-09-26 · Demo hooks `wfire` and `arsenal`
- **Decision:** `wfire=<id>,<ang|car>,<n>[,<ticks>]` (ticks = the wait after the last shot,
  `-1` = none) and `arsenal` (full ammo). Use `goto=Airport` for open ground, because the spawn
  car is only ~30 px from the player and point-blank explosives kill you.
- **Status:** active

## 2026-09-25 · Mouse aims and fires; Space is an alternative fire on foot
- **Decision:** on foot the player faces the crosshair, and left-click fires (held for auto). In
  the tank, left-click or Space fires the cannon. Right-click is the cellphone, not a weapon.
- **Why:** the user asked for the mouse to fire weapons and the right button to be the phone.
- **Status:** active

## 2026-09-25 · Current weapon numbers
- **Decision:** fists (no attack), pistol `cool` 0.32 s / `dmg` 9 / 24 ammo per crate, Uzi
  0.085 s / 5 / 90 per crate. Tank shell → `explode`: 90 px radius, up to 110 damage to cars and
  75 to a player within 70 px. Bullets use 6 sub-steps.
- **Status:** superseded by 2026-09-26 · Weapons v2 numbers (pistol, Uzi and tank-shell values
  unchanged; they are now the `explode` defaults)

## 2026-09-25 · No weapons target people
- **Decision:** there are no pedestrians (a project rule), so weapons affect only vehicles, props and the player.
- **Status:** superseded by 2026-09-27 · Weapons vs bodies (pedestrians and cows now exist; the user lifted the rule)
