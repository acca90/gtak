# Spec: Flyable helicopters

Status: **implemented** 2026-09-25, awaiting a play test. The user asked: "make the copters work".

## 1. Behaviour (vehicles-agent)

- `MODELS.helicopter`: sheet `air`, tag `helicopter` (2 frames = rotor positions; there is no
  brake/wreck frame, so draw the wreck as frame 0 tinted dark, or add a wreck frame later via
  pixel-agent). Footprint for collisions when on the ground: about w 40, len 56 (the body; the rotor
  disc is visual only). Flags: `air: true`, `siren: undefined`, `horn: undefined`.
- New per-car state: `alt` (altitude in px, 0 = on the ground or a roof), `rotor` (0..1 spin-up),
  plus a `ground` height under the aircraft (0, or the building height when over a roof).
- Controls while flying (all in `KEYMAP` already or approved here):
  - **W/S (up/down):** pitch forward/back (move along the heading). **A/D:** yaw (turn in place).
  - **Space (`fire`):** climb. **Shift (`descend`, new key):** descend. With neither held, it holds altitude.
  - The rotor must spin up (~1.5 s) before it can lift off, and spins down after landing with no input.
  - Max altitude ~260 px. Max speed ~300 px/s, with drifty inertia (slow to start and to stop).
- Collisions: when `alt > groundHeight + 8`, ignore world tiles, obstacles and cars entirely. At
  low altitude it collides as a normal vehicle. It lands on the ground **or on roofs**: the minimum
  altitude over a building tile is that building's `height`, so it can land on helipads. Water:
  it can't land (it hovers at 8 px minimum, or ditch = wreck, your call).
- Exit only when landed (`alt <= ground + 2`); pressing E in the air does nothing (show a toast
  `LAND FIRST`). Exiting on a roof puts the player on the roof, and walking there is fine for now.
  Walking off the roof edge drops the player to the street; the simplest option is to only allow exit
  onto the ground or a helipad roof and keep the player on that roof. Document what you chose.
- Damage: bullets and explosions hit it as usual (explosions only if within range, altitude
  included). At hp 0 it falls (alt → ground quickly) and explodes.
- The camera looks further ahead while flying (a coordinator tweak).

## 2. Placement (geo-agent)

- Replace the static `helicopter` sprites with parked helicopters: spots with
  `models: ['helicopter']` on the helipads (towers with `tower: true`, police, hospital) and at the
  airport. A spot on a roof carries `alt` = that building's `height` (so it spawns landed on the roof).
- The single tank is unchanged.

## 3. Rendering (coordinator)

- Airborne helicopters are drawn **after buildings**, lifted with the same oblique parallax as
  roofs (`Render.lift(cam, x, y, alt)`), with a soft shadow on the ground at the true position.
- The rotor frame follows `rotor` × time. A red/green nav-light blink at night.

## 4. Sound (sound-agent)

- A rotor loop (thwop-thwop whose rate follows `rotor`, pitch/gain with climb), a turbine whine,
  positional, part of Sound v1.
