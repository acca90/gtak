# Pastel City

A conceptual top-down crime game in plain HTML/JS, inspired by GTA 1 and 2 but drawn in a softer
"modern retro" pixel-art style. All sprites are generated as editable Aseprite files.

Scope for now: three cities, an industrial zone and farmland on one big mainland (see below), with
**no traffic and no pedestrians**. There are synthesised sound effects, but no radio or music yet. The focus is on how it plays and how it looks.

## The world: three cities and the country between them

A 768×768-tile mainland (12,288 px square) in a pastel sea. The full map, with every
neighbourhood, street, landmark and coordinate, is in [docs/geography.md](docs/geography.md).

| District | Where | What's there |
|---|---|---|
| **Major City** | NW | Downtown core of glass towers, offices, shops, the Pastel Mall and a garage, on wide **avenues** with parking bays, meters, ticket machines, parking signs, zebras, stop lines and **traffic lights**. **Central Park** (lake, winding paths, fountains) and the **police station** are in the core, and **Pastel Stadium** (a Beira-Rio style bowl under a white leaf roof, on a paved esplanade by the bay) is in the east suburbs. The suburb ring has cul-de-sacs and houses on quieter tree-lined **streets** with stop signs. You start here, next to the park. |
| **Side City** | E | Same layout. The **PCTV tower** (15 floors, TV mast, dish farm) is downtown, **Shell Beach** (palms, boardwalk, umbrellas, lifeguard huts) runs down the east coast, and **Sunrise Marina** (piers, yachts, sailboats) is in a cove to the south-east. |
| **Main City** | SW | Same layout. **Union Station** is at the end of the railway, **Mercy Hospital** has ambulances and a helipad, and the **port** on the south coast has a container yard, a quay where three gantry cranes work a full-size container ship moored alongside, and a mole sheltering the basin. |
| **Ironworks** | centre | Long industrial blocks on cracked, patched **rough roads**: warehouses, container yards, a tank farm, factories with smoking chimneys, and the **freight yard** where the train starts. The boost garage sits by the bay. |
| **North / West / South-East Farms** | N, W, SE | Big fields, farmsteads, an orchard, a pasture and a farm town (gas, diner, bar, shop) on each grid of **dirt roads** without sidewalks. |
| **Pastel Airport** | SW coast | A wide north-south runway, taxiways, an apron with full-size airliners at the gates, a terminal, two hangars and a control tower. |
| **Nature** | between | **Pastel Bay** cuts in from the north coast, crossed by the **Pastel Gate Bridge** (134-tile deck, two orange towers, sagging cables). There are also the Pinewood forests (NW), Clover Meadows, the Lilac River flowing from Heron Lake to the sea, the Amber Desert (SE: dunes, rocks, cacti, an oasis), Mirror and Willow lakes, rocky capes and five islands. |

**Highways** (two lanes each way with shoulders) link every district. Where they cross water
they become bridges. A **freight train** runs north-south between the Ironworks freight yard and
Union Station, crossing roads at level crossings. The HUD shows the street you're on, and a toast
names each neighbourhood as you enter it.

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
| Q / Tab | cycle the weapons you have | |
| 1–7 | pick a weapon: 1 fists, 2 pistol, 3 Uzi, 4 shotgun, 5 bazooka, 6 grenades, 7 molotovs (only if you have ammo) | |
| Z / X | | rotate the tank turret with the keyboard |
| H | | horn (hold). Police cars and the ambulance: a tap toggles the siren, holding honks |
| Space / Shift | | helicopter: climb / descend (W/S fly forward/back, A/D turn; exit only when landed) |
| - / = / 0 | volume down / up / mute | |
| O | skip 6 hours (the clock fast-forwards) | |
| Mouse wheel | zoom (5 steps); scrolls messages over the phone | |
| M / P | city map / pause | |

Gamepads work too: stick/d-pad, RT gas, LT brake, A/X handbrake or shoot, Y enter/exit, right stick turret, L3 horn. Helicopter: A/X climb, L3 descend.

## Gameplay

- **Time** passes on its own: a day lasts 24 real minutes (the clock is under your money). The light
  moves through dawn, day, sunset and night; **O** skips 6 hours.
- **Traffic** drives on the right, at about a third of each vehicle's top speed, and every region has
  its own mix: buses, taxis and ambulances downtown, a few cars in the suburbs, heavy trucks at
  Ironworks, pickups and tractors on the farms. Cars stop at red lights and give way at junctions.
  Block one and it honks, then drives around you; ram or shoot one and it flees at full speed.
  Traffic only exists around you (the area of view), so the city stays light on the browser.
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
- **Ambulance** (MEDIC ONE): a fast, tough emergency van. It's parked only at Mercy Hospital.
- **Tank:** there's one M-9 Rhino, waiting on the sidewalk next to where you start. It's the
  strongest vehicle: collisions and small arms can't damage it, and explosions do only 35%. It
  pivots on the spot, the turret follows your mouse, and its cannon fires explosive shells. It
  doesn't respawn.
- **Street furniture breaks.** Lamp posts every 11 tiles keep the sidewalks drivable. A car
  hitting a lamp post, hydrant or bin at speed (or the tank at any speed) knocks it over: lamps
  fall in the direction you hit them and go dark at night, hydrants burst into a water spray, and
  bins scatter rubbish. At walking pace they still block you. Trees are always solid.
- Crates respawn every 45 s: cash, health, pistol (+24), Uzi (+90). The other weapons are sold
  only in gun stores.
- **Weapons** (on foot only; aim with the mouse, fire with left click or Space). Thrown weapons land
  at the crosshair (or 110 px ahead without a mouse). Explosions hurt you too if you're close.

  | Weapon | Fire | Store: price / pack, max carried |
  |---|---|---|
  | Pistol | 9 damage, 0.32 s | $200 / 24, 240 |
  | Uzi | 5 damage, 0.085 s (hold to spray) | $500 / 90, 450 |
  | Shotgun | 6 pellets × 7 damage in a ±0.22 rad fan, 0.8 s, ~170 px range, shoves cars | $800 / 12, 60 |
  | Bazooka | rocket at 320 px/s with a smoke trail. It explodes on a car or wall, or after 1.4 s (90 px blast, +50 to the car it hits), 1.2 s | $2000 / 5, 20 |
  | Grenades | thrown up to 160 px in an arc, bounces off walls and cars, 2 s fuse, 75 px blast, 0.6 s | $600 / 5, 20 |
  | Molotovs | thrown up to 150 px, shatters on landing or on a car/wall, leaves a 28 px fire patch for 6 s. Cars in it burn (the tank doesn't catch), and it hurts you, 0.7 s | $400 / 5, 20 |

  Bullets and pellets don't hurt the tank; explosions and fire do 35%. When a weapon runs dry you
  switch to the Uzi, shotgun or pistol (never to an explosive), else to your fists.
- **Gun stores:** five, one per region: Pastel Arms (Major City, a short walk from the start),
  Seabreeze Ammo (Side City), Union Firearms (Main City), Anvil Surplus (Ironworks) and Dusty Barrel
  (Route 6, by the South-East Farms). Walk onto the glowing mat at the door to go in; the world
  pauses while you shop. **W/S** or the mouse picks a weapon, **E / Enter** or a click on BUY buys a
  pack, **Esc / Backspace** leaves. The card shows price, pack size, stat bars and what you carry;
  BUY greys out with NOT ENOUGH CASH or FULL. Stores are red dots on the **M** map and in the GPS.
- You start with **$10,000**, enough to buy every weapon twice.
- Die and you're **WASTED**: you respawn at the park with your weapons lost and the multiplier
  reset to ×1.

## Sound

Every sound is synthesised live with the Web Audio API (`src/audio.js`), so there are no audio
files and it still runs from `file://`. Audio starts on your first key press or click, because
browsers block it before that.

| Key | Effect |
|---|---|
| `-` / `=` | volume down / up in 10% steps (also unmutes) |
| `0` | mute / unmute |
| `H` | horn (hold). Police cars and the ambulance: a tap toggles the siren |

Volume and mute are saved in the browser. Sounds are positional, so they pan left and right
and fade with distance from the centre of the screen. They go silent while paused, and inside a
gun store only the street outside stays faintly audible.
`soundboard.html` lists every sound with play and start/stop buttons, plus engine speed and
throttle sliders, and **measure levels** shows each sound's peak and RMS.

## How it's built

```
index.html          boot + script order
src/core.js         math, RNG, sprite atlas, bitmap font, keyboard/gamepad input
src/clock.js        in-game clock (1 game minute per second) and the day/night light curve
src/traffic.js      traffic driver AI: lane following, lights, yielding, honk, pass, flee
src/aov.js          area of view: what exists around the player (streamed traffic, used cars, wrecks)
src/city.js         world generator: terrain, grids, road profiles, highways, landmarks, names
src/render.js       baked ground, oblique pseudo-3D buildings, trees/lamps, lighting
src/entities.js     cars (arcade drift physics), player, collisions, particles
src/phone.js        cellphone: contacts, calls, messages, GPS
src/missions.js     jobs (payphone or cellphone)
src/game.js         rules, camera, HUD, main loop, #demo hook
art/*.aseprite      sprite sources (edit these in Aseprite)
assets/             exported sheets + atlas.js (generated — don't edit)
tools/              Aseprite Lua generator/exporter, art.sh wrapper, check.js, shot.sh
CLAUDE.md           Claude Code entry point: code map + how .claude/ is organised
.claude/rules/      project rules (scope, runtime, testing, art pipeline, rendering, agents, decisions, git)
.claude/agents/     subagents: pixel, vehicles, weapons, geo, sound, radio (radio on hold)
.claude/agent-memory/  each agent's decision log (+ coordinator's cross-cutting decisions)
.claude/skills/     /commit
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
| air | 112×112 | airliner, prop plane, helicopter (2) |
| ships | 64×224 | container ship, yacht, sailboat, motorboat, gantry crane |
| ui | 112×176 | the cellphone; the screen rect and button hit areas are listed in `PHONE` in src/phone.js |
| fx | 48×48 | explosion (8), smoke (4), fire (4) |
| font | 6×8 | bitmap font (order in `FONT_CHARS`) |

## Testing hook

`index.html#demo&...` skips the title and runs a scripted scenario, which is handy for headless
screenshots. Parameters combine with `&`:

| Param | Effect |
|---|---|
| `goto=<place>` | jump there and lock the camera. Any landmark, district, neighbourhood, street, lake or island name works (case and spaces ignored), e.g. `goto=Pastel Gate Bridge`, `goto=Stadium`, `goto=PCTV Tower`, `goto=Hospital`, `goto=Union Station`, `goto=Airport`, `goto=Port`, `goto=Marina`, `goto=Beach`, `goto=Central Park`, `goto=Police Station`, `goto=Freight Yard`, `goto=Spawn`. The full list is in `G.city.places` / docs/geography.md. |
| `time=1` / `time=2` | dusk / night (the clock at 18:30 / 23:30; `time=0` is 12:00) |
| `clock=HH:MM` | set the clock, e.g. `clock=06:15` for dawn |
| `skip=N` | press O N times (fast-forward 6 h each) |
| `aov` | with `map`: draw the area of view (cyan screen, yellow AOV, pink keep line) and every car |
| `lanes` | draw the traffic lane graph (lanes, stop lines, junction paths) |
| `warm=N` | simulate N seconds before the first frame, so screenshots show settled traffic |
| `perf` | show car counts, cars updated this tick and collision pairs (`node tools/bench.js` times the update loop) |
| `drive=N` | enter the starter car and drive for N ticks (`&crash` steers into things) |
| `boom` | blow up a nearby car |
| `mission=delivery\|boost\|torch\|rush` | start that job |
| `shoot=N` | fire the Uzi at the nearest car for N ticks |
| `wfire=<id>,<ang\|car>,<n>[,<ticks>]` | take weapon `<id>` (`pistol uzi shotgun bazooka grenade molotov`) with full ammo, face `ang` radians (0 = up, clockwise) or the nearest parked car (throws land on it), fire `n` times at the weapon's rate, then run `ticks` more after the last shot (default one cooldown; `-1` = none). E.g. `goto=Airport&wfire=bazooka,4.4,1,-1` catches a rocket in flight |
| `arsenal` | full ammo for every weapon |
| `cash=N` | set your money |
| `shop=i[&sel=j]` | stand on gun store i's mat (0-4) with the store open, row j selected |
| `cam=tx,ty` | centre the camera on a tile, e.g. `goto=Stadium&cam=328,158` frames the whole stadium |
| `heli=N` | spawn a helicopter, climb for 2.5 s, fly forward for N ticks (HUD shows altitude/speed/rotor) |
| `tank=a` | get in the tank, turret at angle a, fire once |
| `phone=home\|contacts\|messages\|gps\|music\|incoming` | open the cellphone (`&call=i` calls contact i) |
| `mouse=x,y` | fake a mouse position (screen px) |
| `map` | open the map |

```sh
node tools/check.js                        # every script loads cleanly in one scope
tools/shot.sh out.png 'demo&drive=60'      # headless Firefox screenshot of a scenario
tools/shot.sh g.png '' gallery.html        # screenshot of the asset gallery (set SHOT_SIZE=1400,9000)
```

## Later

Radio and music, traffic and pedestrians, police and wanted levels, more mission types, saving.
