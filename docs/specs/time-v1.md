# Spec: In-game time (backlog item 0)

Status: **built** 2026-09-26 (T1-T5 done), awaiting the user's play test (T6). Optional follow-up: the §4 tint overlay (lilac dawn, gold afternoon), not built. Coordinator: main session.

## 1. Goal

A real clock replaces the three fixed looks (DAY / DUSK / NIGHT). Time passes on its own, the light
changes smoothly through dawn, day, sunset, dusk and night, and other systems can read the clock or
spend time (brothel, item 6), run timers off it (police, item 2), or save it (item 9).

## 2. Decisions (the user, 2026-09-26)

| Question | Answer |
|---|---|
| Day length | **24 real minutes.** 1 game minute = 1 real second. |
| Wanted-level decay "5 minutes" | **Real minutes** (5 real min). Police timers use real seconds, not the clock. |
| Lighting | **Smooth blend** across the day; lamps and windows switch on at dusk, off at dawn. |
| O / N keys | **O skips 6 hours** with a fast-forward; **N is removed.** |

Coordinator defaults (can be changed on request): a new game starts on **day 1 at 08:00**. The clock
**stops** while paused, on the title screen (frozen at 18:40) and in a store; it keeps running while
the phone or the map is open, because the world keeps running then too. No weekdays or dates, just `DAY 1`, `DAY 2`…

Out of scope for v1: gameplay by hour (shops closing, night-only missions, traffic density),
weather, and seasons. The clock exposes what those need later.

## 3. The clock (coordinator, `src/core.js` or a new `src/clock.js`)

- State: `G.clock = { min }`, where `min` counts game minutes since day 1 00:00 (a float).
  Derived: `day = floor(min / 1440) + 1`, `hh`, `mm`.
- Rate: `RATE = 1` game minute per real second, advanced in the main loop with `dt` only while the
  world runs (see §2).
- API: `Clock.hour()` (float 0–24), `Clock.label()` → `'21:05'`, `Clock.day()`,
  `Clock.advance(minutes, { fast })` (instant, or fast-forwarded over ~1.5 s for O and the brothel),
  and `Clock.light()` → the current lighting values (§4).
- Compatibility: `G.time` (0 day / 1 dusk / 2 night) stays as a **derived** value so old checks
  keep working: 2 when `dark ≥ 0.6`, 1 when `dark ≥ 0.15`, else 0. New code reads `Clock.light()`.
- Serialisable as one number (`G.clock.min`) for the save system later.
- Demo hooks: `clock=HH:MM` sets the start time. `time=0|1|2` still works and maps to 12:00 / 18:30 /
  23:30 (the exact old looks). `skip=N` presses O N times.

## 4. Lighting curve (pixel-agent colours, coordinator plumbing)

`Clock.light()` returns `{ s, dark, ambient, lights, glow }`, interpolated between keyframes by hour (planned table; T4 tunes it):

| Hour | Look | `dark` | Lamps / windows |
|---|---|---|---|
| 05:00 | night fading, deep blue | 0.8 | on |
| 06:00 | dawn: pink and lilac | 0.35 | switch off at 06:30 |
| 07:30 | early day: soft warm | 0.05 | off |
| 12:00 | full day | 0 | off |
| 17:30 | golden afternoon | 0.05 | off |
| 18:30 | sunset: orange and pink (today's DUSK look) | 0.35 | switch on at 18:30 |
| 20:00 | dusk into night | 0.75 | on |
| 22:00 – 04:00 | night (today's NIGHT look) | 1 | on |

- pixel-agent owns the keyframe colours (`ambient`, a warm/cool `tint` for sunrise and sunset) and
  keeps the style: pastel, never muddy. Today's DUSK and NIGHT colours are the anchors.
- **As built (T3):** the curve is one "look" value `s` (0 day, 1 dusk/dawn, 2 night) per hour, in
  `LOOK_KEYS` (src/clock.js). The light pass blends the three `TIMES` colours by `s`. Buildings keep
  their three cached looks and draw look `floor(s)`, then `ceil(s)` over it at alpha `frac(s)`: the same
  multiply, so walls and ground always match, and only two draws per face during transitions. There's
  no separate tint overlay: dawn and sunset both pass through the DUSK look. Lamps and windows fade in
  once `s > 0.6` (about 18:00 and until about 06:40).
- Every existing `G.time` check is replaced or kept with a reason. Known ones: `applyLighting`,
  `facade`, `roof`, `drawBuildings` and the signal glow in `render.js`; the car darken in the light pass,
  `drawMarkersOver` and `collectLights` in `game.js`; smoke particles in `entities.js`; the phone's
  `CLOCK` table.

## 5. HUD, phone and keys (coordinator)

- HUD: a small clock under the money, e.g. `21:05`, and `DAY 3` next to it in a smaller colour.
- Phone: the status bar shows the real clock (the `CLOCK` table goes). The home-screen hint
  `O: DAY/NIGHT` becomes `O: SKIP 6H`.
- Keys: **O** calls `Clock.advance(360, { fast: true })` with a toast `+6H`. **N** (`time` action) is
  removed from `KEYMAP`, `PADMAP` (pad 8 is freed), the title/pause control lists and the README.

## 6. Sound (sound-agent)

- Ambience reads `Clock.light().dark` and the hour instead of `G.time === 2`: a smooth crossfade
  between day and night beds, songbirds at dawn and in the morning (a dawn chorus peak around 06:00),
  crickets from dusk. Sound hooks only; no change in behaviour outside audio.
- `sound: none new required` beyond the crossfade; a soft "fast-forward" whoosh on O can reuse `ui('swoosh')`.

## 7. Tasks, in order

Each task ends with `node tools/check.js`, a screenshot looked at, and a short report.

| # | Task | Owner | Size | Done when |
|---|---|---|---|---|
| T1 | Clock core: state, rate, pause rules, `Clock` API, derived `G.time`, demo hooks `clock=` and `ff` | coordinator | S | the clock advances in the headless run; `time=0/1/2` still give the same pictures as today |
| T2 | HUD clock and day, phone status bar, keys: O = +6 h fast-forward, N removed; README and control lists | coordinator | S | screenshots of the HUD at 08:00 and 21:05, the phone, the title controls list |
| T3 | Lighting plumbing: `Clock.light()` curve, day/night crossfade of facades and roofs, the tint overlay, lights fading with `lights`; replace every `G.time` check listed in §4 | coordinator | M | screenshots at 05:30, 06:30, 12:00, 18:30, 19:30, 23:00 look continuous, with no popping |
| T4 | Keyframe colours for dawn, golden afternoon and sunset | pixel-agent | S | the same six screenshots, judged for style |
| T5 | Ambience follows the clock: day/night crossfade, dawn chorus, crickets | sound-agent | S | soundboard or offline render check; the user listens |
| T6 | Integrate: README, decision log, backlog status, the user's play test | coordinator | S | the user plays through a sunset and a sunrise |

T1 → T2 → T3 run in sequence (same files). T4 can start once T3's curve exists; T5 once T1 exists,
in parallel with T3/T4 (it only touches `src/audio.js`).
