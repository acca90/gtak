# sound-agent — decision log
Format and rules: `.claude/rules/decisions.md`. Newest first.

## 2026-09-26 · Weapons v2 + gun store sounds
- **Decision:** `SND_SHOT` maps weapon id → firing sound (shotgun blast + pump, bazooka launch, grenade `throwPin`,
  molotov `throw`). No empty click for thrown weapons. Rockets are a state-driven `rocket` loop per `G.projectiles` item
  with `k === 'rocket'` (max 4). Molotov fire patches reuse the `fire` loop per `G.fires` entry (max 3, fading over the last 1.2 s).
  One-shot hooks: `tink` (bounce), `shatter`, `plop`.
- **Tinks are gated in audio:** they are skipped below 35 px/s and when less than 70 ms has passed since the last one. `bounced()` fires every step
  while a grenade rests against a car (548 calls for 2 grenades in a test).
- **Shop:** while `Shop.open`, the world is treated as paused. sfx loops stop; `amb` stays at ×0.3, so the street is faintly
  audible through the door. A change of `Shop.sel` is read from state and plays `move`. Hooks in `enter`/`leave`/`buy` play `buzz` when blocked.
- **Sprite sheets:** the scans accept `boats`|`ships` and `planes`|`air` (the sheets are being renamed; drop the old names later).
- **Status:** active

## 2026-09-26 · Level check by offline render; test harness lives outside the repo
- **Decision:** `Sound.measure(item)` renders a catalog item in an OfflineAudioContext and reports its peak/RMS in dBFS
  (soundboard "measure levels", or `soundboard.html#measure` → `window.measured`). Use it to balance levels, not guesses.
  Reference peaks (the item's own vol, before the bus): engines about −10…−16, horns/sirens about −12…−15, gunshots/impacts about −1…−5,
  explosions about +3 (the limiter catches them), UI blips −13…−18, footsteps about −20.
- **Why:** nobody can listen from the agent environment, and headless `--screenshot` can't wait for async renders.
  A WebDriver BiDi runner (node + firefox `--remote-debugging-port`) in the scratchpad did the in-game tests. A Proxy over
  `Sound.ctx` gave a fake `currentTime`, because the headless context is suspended and its clock doesn't move.
- **Status:** active

## 2026-09-26 · Sound v1 architecture (src/audio.js)
- **Buses:** `master (vol² · !muted) → limiter → out`; `sfx 0.9`, `amb 0.55`, `ui 0.7`, `music 0.8` (music = radio-agent only).
  Ducking: phone call (incoming or dialling) → sfx ×0.6, amb ×0.45, music ×0.4. Explosions/cannon build `boom` (decays about 1 s) →
  sfx −30%, amb and music −65%. Paused or title → sfx and amb go to 0, all loops are released; music goes to 0 only while paused.
- **Loops are state-driven:** `Sound.update(dt)` runs once per game tick (first line of `Game.update`) and calls `want(type, key, x, y)`
  for everything that should sound. Anything not wanted this tick is faded out and stopped (`sweep`). No hooks are needed for
  engines, skid, horn, siren, fire, spray, scrape, servo, train, payphone, ringtone/ringback, beds, or phone UI transitions.
- **Engine classes:** small=hatch; car=sedan/taxi/van/pickup/suv/ambulance/police_suv; sport=sport/police; muscle; diesel=semi/bus/
  truck/tanker/flatbed/mixer/garbage; tractor; electric=forklift; harvester; tank (+tracks); rotor=helicopter. The fallback goes by flags
  (air→rotor, tank, heavy→diesel, else car). Only the player's vehicle, vehicles with a `driver`, and spinning rotors run an engine;
  parked or pushed cars are silent.
- **Voice limits:** loops engine 5, skid 3, horn 3, siren 3, fire 3, scrape 2, spray 2 (nearest first, player first). One-shots have a
  per-sound `limit`, and the oldest voice is cut: pistol 4, uzi 5, explosion 4, impact 4, most others 2 to 3.
- **Positional:** R = max(360, cam.w) × range; gain k(0.3+0.7k) with k = 1 − d/R; pan = dx/(0.55·cam.w) × 0.8. Ranges: siren 1.5,
  train 1.5, explosion/cannon 1.8, train horn 2.5, ship horn 3.
- **Volume:** 10% steps, default 70%, a volume key also unmutes. Stored in localStorage `pastelcity.sound` {vol, muted} (try/catch).
- **Ambience:** a 7×5 tile-kind sample around the camera every 20 ticks + `City.regionAt(cam)` zone → beds city/suburb/industrial/
  wind/desert/sea/crickets (night). Critters: gulls (coast), songbirds (green, day), clanks (industrial), cows from
  `Render.idx.props`, ships and airliners from `Render.idx.sprites`. Nothing scans the whole world per frame.
- **Status:** active

## 2026-09-25 · Sound is synthesized with the Web Audio API by default
- **Decision:** no `fetch` (the game runs from `file://`). Default to runtime synthesis; authored samples
  only as base64 in `assets/sounds.js`, with a licence noted per sample. `AudioContext` is started on the
  first user gesture. Buses: `master → { sfx, ui, music }`, and `music` belongs to radio-agent.
- **Why:** project runtime constraints plus the retro style.
- **Status:** active (Sound v1 implemented 2026-09-26; `amb` bus added)
