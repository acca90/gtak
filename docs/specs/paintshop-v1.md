# Spec: Car paint shop (backlog item 5)

Status: **built** 2026-09-27 (S1-S4 done); not play-tested or listened to. Coordinator: main session.

## 1. Decisions (the user, 2026-09-27)

- **Drive in and pick a colour:** drive onto the shop's bay mat; the world pauses and a menu like the gun
  store (`src/shop.js`) lists **10 colours**; pick one, pay, and the car comes out resprayed.
- **Four shops:** one in each city (Major, Side, Main) and one in Ironworks.
- **Refused:** police cars, ambulances, the tank, buses, trucks and every heavy vehicle, aircraft, boats, and
  wrecks. The menu doesn't open; a toast says "WE DON'T PAINT THAT" (police: "NICE TRY").
- The wanted level doesn't exist yet: later, a respray will also clear stars (backlog item 2).

## 2. Numbers and behaviour (coordinator)

- **Price:** $400 per respray. The current colour is marked and costs nothing (leaving is free).
- **Allowed models:** hatch, sedan, sport, muscle, suv, taxi, pickup, van (the `cars` sheet minus police and
  police_suv). A resprayed taxi keeps its roof sign.
- **Colours:** 10 named pastel ramps (3 shades each, matching the models' `body` ramps: light, mid, shadow):
  e.g. CANDY PINK, MINT, SKY, LILAC, LEMON, PEACH, CREAM, TEAL, CHERRY, SLATE (pixel-agent picks the exact ramps
  from PAL or new pastel colours that fit).
- **The respray:** the menu closes, a 1.2 s "spray" beat (a cloud of paint particles in the new colour over the
  car, the screen doesn't pause), then drive out. The car's `paint` field holds the colour id; the drawing
  recolours the model's body ramp.
- **Other damage:** a respray also repairs the car to full hp (GTA does). The price covers it.
- Stepping off the bay closes nothing (the menu pauses the world); Backspace / Esc leaves, as in the gun store.

## 3. Ownership and contracts

| Part | Owner | Where |
|---|---|---|
| Four shop placements: a garage building with a street-facing door and a bay mat on the road side, a sign (`PAINT`), a name per shop, `c.paintshops = [{ id, name, x, y, ang, bay: { x0, y0, x1, y1 } }]`, map markers | geo-agent | src/city.js |
| Colour ramps, the recolour helper, the shop's facade and sign, the bay mat, a spray FX | pixel-agent | art pipeline + look-only render |
| `src/paint.js`: bay detection, the menu, paying, the respray beat, `car.paint` | coordinator | new file |
| Spray hiss, menu beeps | sound-agent | audio.js |

Contracts:
- `PAINTS = [{ id, name, ramp: ['#light', '#mid', '#shadow'] }]` (a global from pixel-agent, in render.js or a
  generated asset) and each allowed model's body ramp: `CAR_BODY[tag] = ['#light', '#mid', '#shadow']`.
- `Assets.painted(sheet, tag, paintId)` returns a sheet canvas where that tag's body-ramp pixels are swapped
  to the paint's ramp (cached per sheet + tag + paint). `drawCars` uses it when `c.paint` is set (the flash and
  wreck tints still apply on top).

## 4. Tasks

| # | Task | Owner | Done when |
|---|---|---|---|
| S1 | Shop placement + markers | geo-agent | shots of each shop's bay |
| S2 | Ramps, `Assets.painted`, facade, mat, spray FX | pixel-agent | gallery shot of every allowed model in every colour |
| S3 | `src/paint.js` + `drawCars` hook + demo hook `paint=i[&color=j]` | coordinator | shots: the menu, the spray, the resprayed car driving out |
| S4 | Sounds | sound-agent | soundboard |
| S5 | README, backlog, decision log, the user's play test | coordinator | the user resprays a car |
