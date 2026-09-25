# Pastel City

A conceptual top-down crime game in plain HTML/JS, inspired by GTA 1 and 2 but drawn in a softer
"modern retro" pixel-art style. All sprites are generated as editable Aseprite files.

Scope for now: a 10×10-block island city in four regions, **no traffic and no pedestrians**, no
sound. The focus is on how it plays and how it looks.

## The city: four regions

| Region | Where | What's there |
|---|---|---|
| **Downtown** | NW | glass skyscrapers (up to 16 floors, some with helipads), office clusters, the Pastel Mall on a double block, rows of shops with rooftop signs, a parking garage with cars on the top deck, parks and plazas. Busy curbs: taxis, sedans, police. |
| **Ironworks** | NE | double-length blocks: warehouses with truck yards, container yards with forklifts, a tank farm with pipes, factories with smoking candy-striped chimneys, a truck depot. A **freight train** (a locomotive at each end, plus boxcar, tank car and container flat) shuttles along a railway with level crossings, and shoves anything on the tracks. Mostly trucks, tankers, flatbeds, mixers and garbage trucks. |
| **Maple Hills** | SW | 2×2 super-blocks with curving **cul-de-sacs** (turning circle with a tree island), pitched-roof houses in five colours, lawns, driveways with the family car, pools, picket fences and mailboxes. The streets are nearly empty. |
| **Golden Fields** | SE | big fields (wheat, corn, plowed soil, pasture with cows and hay bales) split by dirt tracks, farmsteads (house, barn, silos, haystack, tractor), an orchard, and two micro towns with a gas station, bar, diner and shop. A **river** runs from a pond to the sea, with bridges on the country roads (dashed centre lines, grass verges, no lamps) and a beach on the coast. Pickups, tractors and harvesters. |

Blocks are merged by removing road segments (the road network is per-segment), which is how
Ironworks gets its long blocks, Maple Hills its super-blocks and the farms their big fields.

## Run

Open `index.html` in a browser. It runs from `file://`, so no server is needed. If your browser
blocks local files, use `python3 -m http.server` and go to <http://localhost:8000>.

| Input | On foot | In a car |
|---|---|---|
| Arrows / WASD | walk (8 directions) | gas, brake/reverse, steer |
| Mouse | aim | the tank turret follows the cursor |
| Left click | shoot | tank: fire the cannon |
| Right click / C | cellphone | cellphone |
| Space | shoot | handbrake (drift); tank: fire |
| E / Enter | get into the nearest car | get out |
| Q / Tab | switch weapon | |
| Z / X | | rotate the tank turret with the keyboard |
| O | toggle day ↔ night (fades through dusk) | |
| N | cycle day, dusk and night | |
| Mouse wheel | zoom (5 steps); scrolls messages over the phone | |
| M / P | city map / pause | |

Gamepads work too: stick/d-pad, RT gas, LT brake, A/X handbrake or shoot, Y enter/exit, right stick turret.

## Gameplay

- **Jobs** come in two ways. Either a payphone rings (GTA1 style, and the yellow arrow points to
  it), or someone calls your **cellphone** (right click → Answer / Nope). You can also call a
  contact yourself: Mama Rosa (deliveries), Big Tony (boosts), Zed (torch jobs) or Lucky Lou
  (races). The phone also has **Messages** (every briefing is kept) and a **GPS**: click the map
  to set a waypoint and the arrow will point to it. Radio is a placeholder for when sound arrives.
  The jobs are:
  - *Delivery*: reach the drop point in any car before the timer runs out.
  - *Boost*: steal the marked car and bring it to the harbor garage. You're paid by how much of
    the car is left undamaged.
  - *Torch*: destroy the marked car (if you're low on ammo, you get a pistol).
  - *Checkpoint rush*: five checkpoints in a row, and each one adds time.
- Each completed mission raises the **multiplier** (×1 to ×9), which scales all money you earn.
  Reaching $100,000 "wins" the city.
- Cars take damage: they smoke, then catch fire, then **explode**. Explosions set off chain
  reactions and hurt you if you're close. Wrecks can't be driven.
- **Vehicles**, from slowest and toughest to fastest: semi, bus, box truck, van, pickup, SUV,
  hatchback, sedan, taxi, muscle, police SUV, police cruiser, sports car.
  Parked vehicles follow each region's mix; farms, yards and driveways have their own. Collision damage scales
  with the other vehicle's mass, so trucks and buses win fights. Parking-lot stalls only fit
  regular cars; trucks and buses park at the curb.
- **Region vehicles:** tractors, forklifts and a combine harvester are drivable too. Fuel tankers
  go up in a chain of explosions along their whole length.
- **Tank:** there's one M-9 Rhino, waiting on the sidewalk next to where you start. It's the
  strongest vehicle: collisions and small arms can't damage it, and explosions do only 35%. It
  pivots on the spot, the turret follows your mouse, and its cannon fires explosive shells. It
  doesn't respawn.
- **Street furniture breaks.** Lamp posts every 11 tiles keep the sidewalks drivable. A car
  hitting a lamp post, hydrant or bin at speed (or the tank at any speed) knocks it over: lamps
  fall in the direction you hit them and go dark at night, hydrants burst into a water spray, and
  bins scatter rubbish. At walking pace they still block you. Trees are always solid.
- Crates respawn every 45 s: cash, health, pistol, Uzi.
- Die and you're **WASTED**: you respawn at the park with your weapons lost and the multiplier
  reset to ×1.

## How it's built

```
index.html          boot + script order
src/core.js         math, RNG, sprite atlas, bitmap font, keyboard/gamepad input
src/city.js         city generator: districts, block types (city/park/plaza/lot/tower), props
src/render.js       baked ground, oblique pseudo-3D buildings, trees/lamps, lighting
src/entities.js     cars (arcade drift physics), player, collisions, particles
src/phone.js        cellphone: contacts, calls, messages, GPS
src/missions.js     jobs (payphone or cellphone)
src/game.js         rules, camera, HUD, main loop, #demo hook
art/*.aseprite      sprite sources (edit these in Aseprite)
assets/             exported sheets + atlas.js (generated — don't edit)
tools/              Aseprite Lua generator/exporter + art.sh wrapper
refs/               style references
```

**Scale:** 16 px tiles. Roads are 7 tiles wide (one 3.5-tile lane each way, with the double line in the middle tile), sidewalks are 3 tiles
wide (room for pedestrians later), and each block has a 14×14-tile interior. A sedan is 26×52 px,
next to a player about 10 px wide. The world is 301×301 tiles (4,816 px), and the ground is baked
into 1024 px chunks.

**Buildings** use GTA1's parallax trick without scaling the pixel art. Each roof is the building's
footprint shifted away from the camera by `(centre − camera) × height / 470`. The walls facing
the camera are drawn one pixel row (or column) at a time from a pre-baked facade texture, so they
shear between the base and the roof. Walls don't sample a full-height texture, which made
windows flicker as the wall height changed every frame. Instead, every storey is drawn exactly
`k = floor(visibleHeight / floors)` rows tall, from a copy of the 32 px facade modules squashed
once per `k`. The leftover rows become a cornice band. Windows only change when `k` steps, and
the whole building changes at once. At night the facades are re-tinted and their lit windows
(taken from the `*lit` wall frames) shine through.

**Buildings** have a facade style (`wall`) and a roof, which is one of: `flat` (a 9-slice style with
rooftop clutter), `pitched` (a gable roof built from tiles and rotated for north–south ridges), or
`sprite` (a shipping container). Roofs can carry a sign (`BAR`, `DINER`, `PASTEL MALL`…) that
glows at night. Gas-station canopies are overhangs: they aren't solid, and you drive under them.
Silos, fuel tanks and chimneys are "tall props" drawn as parallax cylinders.

The view is about 800×450 world pixels at the default zoom (the wheel changes it from 0.8× to 1.3×).
The low-res frame is scaled up by the largest whole factor with nearest-neighbour, and the browser
smooths only the last fractional step to the window size, so pixels stay evenly sized at any
window size.

## Asset gallery

Open **`gallery.html`** to review every sprite: sheet by sheet and tag by tag, with frame
numbers, a zoom slider and animated previews. Use it after `tools/art.sh` to check new or
repainted art before looking for it in the city.

## Art pipeline (Aseprite)

```sh
tools/art.sh             # export art/*.aseprite -> assets/*.png + assets/atlas.js
tools/art.sh generate    # create missing .aseprite files from the procedural seed, then export
tools/art.sh regenerate  # OVERWRITE every .aseprite with the seed (loses hand edits)
```

The script finds Aseprite on `PATH` or at the Steam install location. Set `ASEPRITE=/path` to
override it.

Each `.aseprite` file is a sheet: frames are sprites, and **tags name them** (for example `cars`
has tags `hatch`, `sedan`, `sport`, `muscle`, `suv`, `taxi`, `police`, `police_suv`, `pickup` and
`van`, each with the frames normal/brake/wreck). You can repaint any frame, add layers, or add frames to a tag, then run
`tools/art.sh` and reload. The code looks sprites up by tag name, so keep the names and the
per-tag frame order. The palette is at `art/pastel-city.gpl`.

| Sheet | Cell | Contents |
|---|---|---|
| tiles | 16×16 | asphalt, centre lines (solid, dashed country), crossings, 16 curb variants, grass, paths, water (4-frame), plaza, parking, railway + level crossings + ballast, wheat/corn/soil/pasture, dirt, verge, lawn, concrete, sand, bridge |
| roofs | 16×16 | 9-slice flat roofs × 12 styles (incl. metal, rust, glass, mall skylights, parking deck, canopy) |
| pitched | 16×16 | gable roofs: 18 tiles × 6 materials (red, slate, green, brown, teal, barn) |
| walls | 32×32 | one storey per module × 21 styles: city, glass curtain wall, industrial shed, stores, mall, parking deck, 5 houses, barn |
| cars | 32×64 | 12 models (incl. tractor, forklift) × normal/brake/wreck |
| heavy | 36×168 | bus, truck, semi, fuel tanker, flatbed, cement mixer, garbage truck × normal/brake/wreck |
| wide | 48×96 | combine harvester; 4 shipping containers |
| rail | 40×128 | locomotive, boxcar, tank car, container flat |
| tank | 48×72 | `hull` (normal, tracks moved, wreck), `turret` (normal, wreck); the turret pivots at the cell centre |
| player | 16×16 | idle, walk (4), shoot, dead |
| props | 16×16 | phone, lamp, crates, roof clutter, markers, HUD icons, cursor/crosshair, phone app icons, hay bale, mailbox, pallet, barrel, fuel pump, buffer stop, cow |
| big | 48×48 | three tree types, fountain, water tank, helipad, mission marker, shrubs, silo, fuel tank, pool, smokestack, haystack |
| ui | 112×176 | the cellphone; the screen rect and button hit areas are listed in `PHONE` in src/phone.js |
| fx | 48×48 | explosion (8), smoke (4), fire (4) |
| font | 6×8 | bitmap font (order in `FONT_CHARS`) |

## Testing hook

`index.html#demo&drive=60&time=2&boom&mission=torch&shoot=100&map&at=7,2&tank=0.6&phone=gps&mouse=900,200&rampage=6,4&look=24,10`
(`at=bx,by` jumps to a block, `look=tx,ty` locks the camera on a tile of that block) skips the title and runs a
scripted scenario, which is handy for headless screenshots:

```sh
firefox --headless --screenshot out.png --window-size=1280,720 "file://$PWD/index.html#demo&drive=60"
```

## Later

Sound and music, traffic and pedestrians, police and wanted levels, more mission types, saving.
