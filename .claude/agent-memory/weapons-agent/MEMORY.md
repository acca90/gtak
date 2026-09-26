# weapons-agent — decision log
Format and rules: `.claude/rules/decisions.md`. Newest first.

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
- **Status:** active until pedestrians are introduced
