# Spec: Sound v1 — the whole game makes noise

Status: **implemented** 2026-09-26; play-tested and approved by the user 2026-09-26. Coordinator: main session.
Owners: **sound-agent** (everything audio), **vehicles-agent** (siren/horn state), the coordinator
(keys, lightbar visuals, integration). Radio stays **on hold** (radio-agent); leave the `music`
bus empty.

## 1. The user's brief

"Wire sound in the game: vehicles, weapons, collisions, trains, ships, cows, cop cars,
ambulances, etc., cellphone, etc."

## 2. Controls (approved by the coordinator; already in `KEYMAP`)

| Action | Key | Pad |
|---|---|---|
| `horn` | **H**: hold to honk. In a vehicle with `siren`, a tap toggles the siren on/off | L3 (button 10) |
| `volDown` / `volUp` | **-** / **=** (numpad too) | — |
| `mute` | **0** | — |

Show a short toast on volume change or mute (e.g. `VOLUME 70%`, `SOUND OFF`). Persist the volume
and mute state in `localStorage` (wrapped in try/catch).

## 3. Vehicle state (vehicles-agent, before sound starts)

- `MODELS` gains `siren: 'police' | 'ambulance'` on `police`, `police_suv` (police) and
  `ambulance`, and `horn: 'small' | 'car' | 'truck' | 'train'` on every model (a sensible default is
  fine). The tank gets no horn.
- `Car` gains `sirenOn` (toggled by a `horn` tap while the player drives a siren vehicle; switched off
  when the player leaves or the car is wrecked) and `honking` (true while `horn` is held, for vehicles
  without a siren, or with the siren off).
- Nothing else changes in driving behaviour.

## 4. Lightbars (coordinator)

When `car.sirenOn`, the lightbar flashes red/blue (police) or red/white (ambulance). There's a
flashing glow at night and flashing pixels by day.

## 5. Sounds (sound-agent)

Synthesised with Web Audio by default. Positional unless marked **UI** (gain and pan from the
distance to the camera centre; culled beyond about one view width).

**Vehicles**
- Engine loop per class, pitch and gain driven by speed/throttle:
  - small car
  - sports car (rev-happy)
  - muscle (rumbly V8)
  - heavy diesel: trucks, bus, semi, tanker, mixer, garbage
  - tractor (thumping)
  - forklift (electric whine)
  - harvester (drone)
  - tank (engine + track clatter)
  - Only the player's vehicle, plus any other *moving* vehicle near the camera, runs an engine loop. Parked cars are silent.
- Tyre skid loop (tied to `car.skid` / `slip`), gear-less revving on handbrake.
- Horn (`honking`) by horn class; the train horn is separate.
- Sirens: police (wail/yelp alternation) and ambulance (hi-lo), looped while `sirenOn`, positional.
- Door open/close on enter/exit.
- Collisions: thud/crunch scaled by impact speed, metallic for heavies, a little glass for big hits.
  Scraping when grinding along walls.
- Car fire loop (burning), explosion (bigger for `heavy`, a chained rumble for `volatile`).
- The tank cannon: a big boom, plus a turret servo whine while rotating.

**World**
- Train: rumble loop scaled by speed, the horn on departure and when approaching level crossings,
  brake squeal at stops, crossing bells near the level crossings while the train is close.
- Ships and boats: an occasional deep container-ship horn near the port, small boat idle putter near
  the marina, water lapping along the coast (ambient, from the tile kinds near the camera).
- Aircraft: the helicopter rotor loop (if any are animated nearby), a distant jet rumble at the airport.
- Cows: an occasional moo when a cow is near the camera (randomised timing and pitch).
- Birds and gulls: gulls at the beach and port, songbirds in parks and forests.
- Breakables: a lamp post (metal clang + glass), a hydrant burst plus a spray loop while it sprays, a bin
  clatter.
- Ambience beds per area type (from `City.regionAt` / `placeAt`), low volume, crossfaded: downtown
  hum, suburb calm, industrial clanks, farm wind, desert wind, sea near the coast.
- Payphone ring (positional) while a payphone rings.

**Weapons**
- Pistol, Uzi (tight, fast), empty click, weapon switch, bullet impacts (metal ping on cars, wall
  ricochet), tank shell impact = explosion.

**Player and UI** (UI = non-positional, `ui` bus)
- Footsteps while walking (soft, pitch varied).
- Crate pickup (cash cha-ching, health, weapon cock).
- Money pop, multiplier up, mission start/complete jingle, mission failed, WASTED sting.
- Cellphone: ringtone (loops while there's an incoming call, until answered/declined/missed),
  phone open/close, UI click on app rows and buttons, answer/hang-up tones, calling tone, message ping.
- Title-screen start sound; the `O` day/night transition swoosh (optional).

## 6. Engine rules

- `src/audio.js` with a global `Sound` (add it to `index.html` before `game.js`; `tools/check.js`
  reads the list from there). Every call is a safe no-op when audio is unavailable or not yet started.
- `AudioContext` starts or resumes on the first key/mouse gesture.
- Buses: `master → { sfx, ui, music, amb }`. Duck `sfx` + `amb` a little during phone calls, and
  duck everything briefly for big explosions.
- Voice limits per sound, looping-source lifecycle tied to state, everything silent while paused
  (suspend the context or ramp master to 0).
- Performance: no allocation per frame for idle sources. The world is 768² tiles, so find nearby
  cows, water, crossings and parks via existing indexes / a coarse per-frame sample, not full scans.
- Hooks in other agents' code are **one-line** `Sound.*` calls that don't change behaviour. List them all.

## 7. Soundboard

`soundboard.html` (like `gallery.html`): a page that loads `src/audio.js` and lists every sound with
a play button (loops get start/stop), grouped as above, with sliders to preview engine pitch/speed.
It's how the user reviews and tunes sounds without hunting for them in the game.

## 8. Done when

`node tools/check.js` passes, the game runs without errors (headless screenshots still work with
audio unavailable), `soundboard.html` plays every sound, README documents the controls, and the
report lists everything the user should listen for. Nobody can hear from here: the user does the
listening test.
