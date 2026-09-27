# sound-agent — decision log
Format and rules: `.claude/rules/decisions.md`. Newest first.

## 2026-09-27 · Mob crews bailing out (gangs-v1 crew of two / rivals)
- **Decision:** `Sound.bail(car, crew)` fires one `crewDoor` per member at the member's spot (the door side, so the two
  doors pan apart), the second 60-110 ms after the first. `crewDoor` = latch crack + swing + a clang on the stop with a
  short 780 Hz panel ring, then two foot thuds + a scuff about 0.2-0.26 s later. limit 4 (a rival pair bails 4 doors at once).
  Hooks: `Game.gangBail` (whole crew) and `Game.yank` (the passenger only; the driver's door is `jackYank`).
  No voice in it: the first bark is the member's new bubble via `people()`/`mobEvents`.
- **Status:** active (level not measured with Sound.measure yet; vol 0.6 like jackYank)

## 2026-09-27 · Mob voices and the respect sting (gangs-v1 G5)
- **Voices:** peds with `p.gang` go to `mobEvents` (read from state, no hooks in peds.js). `SND_MOB` holds one family per mob:
  Moretti warm and loud (f0 100-128, lp 2.4 kHz, a wide pitch swing, vibrato on the last syllable), Orlov low and clipped (f0 72-90,
  short held syllables with hard stops, flat, rasp), Orchid soft and dry (f0 118-150, g 0.6, breathy, highpass 280, no rasp). Every
  bubble → `mobBark`: the text is turned into syllables by `sndMobSyl` (vowel groups, so new GANG_SAYS lines need no table).
  Barks queue 0.35 s apart and are dropped past 0.7 s (a rally is not a wall of voices). A fight start with no line = `growl`; hp −3 = `ouch`,
  −14 in one tick = a short `scream` yelp. Members never cower-scream. `v.g` scales ouch/scream/growl/hey, so the family carries over.
  A jacked gang driver's "HEY!" is a `mobBark`.
- **Respect sting (ui bus):** subscribed to `Gangs.onChange` in build (and on the first update, guarded). One per mob per 0.4 s;
  stings from the same event (war rule) are staggered 0.3 s and dropped past 0.6 s. Up = a rising 4th (Orchid a 5th), down = a falling minor
  3rd; a timbre per mob (Moretti triangle, Orlov square, Orchid sine bell); crossing up into a better band adds an octave note.
  A fall to kos always plays `respectKos` (low hit + a sour cluster). Only plays in game (`inGame`).
- **Levels:** mob barks peak −8.5…−13 (Moretti loudest), stings −12…−16, kos −8.
- **Status:** active

## 2026-09-27 · Carjack, cops and paint shop sounds (carjack C3, cops K5, paintshop S4)
- **Carjack:** `Sound.jack(car, stage, who)` hooks in game.js: `grab` (Game.jack: `jackGrab`), `steal` (yank: `jackYank`
  + the driver's voice: scared = short scream, angry = `hey`, violent = `hey{rough}`), `back` (`jackYank` + the ped's rough hey
  + the player's `grunt` at +0.4 s; it pushes `gruntT` so playerHurt doesn't grunt twice), `off` (`jackSlam`: slam + tyre chirp
  after `Traffic.takeOver`). A stolen car skips the `crank` in `Sound.door` (its engine is already running; `Sound.jacked` WeakSet).
  The jacked driver's later bubbles ("MY CAR!") use the normal `people()` path (complain → hey, fight → growl, flee → scream).
- **Cops:** voice `sndCopVoice` (f0 86-112 Hz). `copEvents` replaces the civilian path: never a scream or growl; hurt = `ouch`;
  every new bubble = `copBark` (syllable patterns in `SND_COP_SAYS`, highpass 330 Hz + lp 2.8 kHz). OFFICER DOWN! = squelch + chirp
  first; LOST HIM. = quieter + roger beep. At most 2 barks per tick, staggered 0.35 s; one radio call per kind per 2.5 s.
- **Paint shop:** `Paint.open` counts as a shop (world loops stop, `Paint.sel` changes play `move`). `paintSpray` loop (compressor +
  swept hiss) keyed on the `Paint.spray` object; when it goes null, `paintDone` (air puff + bell) at the car.
- **Status:** active

## 2026-09-27 · People, cows, planes and cranes are read from state (peds-v1 P6, ambient-v1 X4)
- **Decision:** voices come from `Sound.people()`, which compares each ped/cow within 1.1 view widths with what it was
  last tick (`Sound.pv` WeakMap: state, bubble, hp, dead). It does not use hooks in peds.js. A body entering earshot resyncs
  silently. Events: → fight = `growl`; → flee/cower = `scream` (an angry ped with a new bubble gets `hey`; otherwise it screams
  when there is a bubble or it is hurt, or 35% of the time); hp −3 = `ouch`; new bubble = `hey` (violent: `low`); death not by a car or fire = `ouch{death}`.
  Cows: → charge = `snort`, → stampede 40% / hurt 60% = `bellow`, and running cows share one `hooves` loop. Burning peds use
  the `burnScream` loop (max 2). Crowd gate: at most one new voice per 60 ms (`vocal()`), plus voice limits (scream 3).
  Each ped gets a random voice {f0 92-140 | 180-245 Hz, formant scale}, and screams stay below 3 kHz.
- **Hooks only where state can't tell:** punch hit/whiff, bullet thwack, car/train vs body (`Sound.body`), bull gore.
  The player's grunt comes from `G.player.hp` drops (≥ 4 hp within about 0.3 s, at most every 0.6 s, on foot only).
- **Planes/cranes:** the `jet`/`prop` loops per moving `Flights.planes` entry (sfx bus, not amb: planes are vehicles, and
  amb ducking during a call would mute a plane taxiing right next to you). Spool follows the phase, `rev` adds roar, altitude divides the gain
  by (1 + alt/150), and distance dulls the whine and the lowpass. The random `jet` one-shot is removed (the sprites it keyed on are gone).
  `craneMotor` (amb) runs while a crane has queued steps; `craneClank` plays when `k.clank` changes (not `=== G.t`:
  Sound.update runs before Airport.update).
- **Levels (Sound.measure):** voices peak −9…−12, punch/splat −2…−4, hooves/engines −13…−15.
- **Status:** active

## 2026-09-26 · Ambience follows the clock (time-v1 T5)
- **Decision:** there are no `G.time` checks in audio. `sndDaytime()` reads `Clock.light().dark`; `night = lin(dark, 0.2, 0.9)`
  (rises about 17:40 to 20:45, falls about 05:00 to 07:00). Crickets = night × green/farm share; city bed × (1 − 0.3·night);
  gull odds × (1 − night). Songbird odds × `birds(hour)`: 0 before 04:45, dawn chorus ×2.2 from 05:30 to 07:00, eases to ×1 by 09:00,
  thins from 16:00, 0 by 19:30. Crickets and dawn birds overlap on purpose between 05:00 and 07:00.
- **Why:** the user wants no hard day/night switch. O fast-forwards 6 h in 1.5 s, so the bed targets can jump by 1.0
  per 1/3 s update. The beds' tau of 1.2 s caps the glide at about 0.8 gain/s, which gives no clicks (a node sim in the scratchpad checked this).
  Don't shorten the bed tau without re-checking.
- **Where:** `sndDaytime`, `ambience()` in src/audio.js. Falls back to full day when there is no `Clock`/`G.clock` (soundboard).
- **Status:** active

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
