# Pastel City

A conceptual top-down crime game in plain HTML/JS, inspired by GTA 1 and 2 but drawn in a softer
"modern retro" pixel-art style. All sprites are generated as editable Aseprite files.

Scope for now: three cities, an industrial zone and farmland on one big mainland (see below), with
traffic, pedestrians and farm animals. There are synthesised sound effects, but no radio or music yet. The focus is on how it plays and how it looks.

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
| Left click | shoot (fists: punch) | tank: fire the cannon |
| Right click / C | cellphone | cellphone |
| Space | shoot (fists: punch) | handbrake (drift); tank: fire |
| E / Enter | get into the nearest car, or pull the driver out of a slow traffic car | get out |
| Q / Tab | cycle the weapons you have | |
| 1–7 | pick a weapon: 1 fists, 2 pistol, 3 Uzi, 4 shotgun, 5 bazooka, 6 grenades, 7 molotovs (only if you have ammo) | |
| Z / X | | rotate the tank turret with the keyboard |
| H | | horn (hold). Police cars and the ambulance: a tap toggles the siren, holding honks |
| Space / Shift | | helicopter: climb / descend (W/S fly forward/back, A/D turn; exit only when landed) |
| - / = / 0 | volume down / up / mute | |
| O | skip 6 hours (the clock fast-forwards) | |
| Mouse wheel | zoom (5 steps); scrolls messages over the phone | |
| M / P | city map (hover the mouse over it to see the city or region, neighbourhood, street, landmarks and shops) / pause | |

Gamepads work too: stick/d-pad, RT gas, LT brake, A/X handbrake or shoot, Y enter/exit, right stick turret, L3 horn. Helicopter: A/X climb, L3 descend.

## Gameplay

- **Time** passes on its own: a day lasts 24 real minutes (the clock is under your money). The light
  moves through dawn, day, sunset and night; **O** skips 6 hours.
- **Traffic** drives on the right, at about a third of each vehicle's top speed, and every region has
  its own mix: buses, taxis and ambulances downtown, a few cars in the suburbs, heavy trucks at
  Ironworks, pickups and tractors on the farms. Cars stop at red lights and give way at junctions.
  Block one and it honks, then drives around you; ram or shoot one and it flees at full speed.
  Traffic only exists around you (the area of view), so the city stays light on the browser.
- **People** walk the sidewalks, busiest downtown and thinnest on the farms (half as many at night),
  and cross at zebras on the red for cars. Each has a hidden temper: **scared** people run from
  violence or cower, **angry** ones follow you shouting ("WATCH IT!", "I'M CALLING THE COPS!") but
  never fight, and **violent** ones size you up, then fight back when you hit them, mostly with fists,
  sometimes a pistol, rarely an Uzi. Cars knock people down (40-110 px/s) or kill them (faster),
  and traffic stops for anyone in the road. The dead stay where they fall in a pool of blood, fire
  leaves a charred corpse, and a body sometimes drops a wallet ($10-50) or its gun's ammo.
- **Cops** walk the beat among the pedestrians (more downtown and around the police station). They
  don't care what the city does, only what **you** do where they can see it: shoot, punch, run someone
  over, blow something up or pull a driver out of a car and every cop in sight (and the ones they radio
  nearby) comes for you with a pistol or a shotgun. They're tougher than civilians (70 hp) and give up
  once you're ~600 px away or out of sight for 20 s. Hurting a cop always counts. No wanted level yet.
- **The mobs** own the three cities: the **Moretti Family** (Side City: red T-shirts, red muscle
  cars), the **Orlov Syndicate** (Major City and Ironworks: blond hair, black clothes, black sedans) and
  the **Orchid Society** (Main City: purple T-shirts, purple sports cars). Their members walk their
  turf, mostly armed, and each mob keeps a **respect** score for you (the three badges under the clock:
  5 segments from kill-on-sight to trusted). Hurting or killing a member, or stealing a mob's car,
  costs respect with that mob; the Morettis and Orlovs are at war, so killing one side's men earns a
  little with the other. At low respect their members come for you on sight. Mob jobs come later.
  Mob cars carry two members and never run from you: ram, shoot, punch or block one and it stops and
  both jump out to fight (a wreck takes them with it). Mob cars keep out of rival turf, and a crew that
  spots a rival mob's member or car gets out and starts shooting.
- **Paint shops** (Candy Coat in Major City, Spray Shack in Side City, Pastel Paint & Body in Main
  City, Iron Coat in Ironworks; lilac dots on the map): drive onto the bay, pick one of 10 colours,
  and $400 resprays and repairs the car. Police cars, ambulances and heavy or unusual vehicles are refused.
- **Cows** graze inside the pasture fences, stampede at gunfire or blasts, and die if you hit them
  with a car. One in five is a bull, and a bull you hurt charges.
- **The airport and port work.** Every couple of minutes an airliner or prop plane lands from the
  south and taxis to a free stand, or pushes back, taxis to the runway and takes off north; don't
  park on the runway. At the port three gantry cranes load and unload the container ship.
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
- **Carjacking:** press E next to a traffic car that's stopped or crawling (under ~30 px/s). You
  walk round to the driver's door (left side), yank the driver out and drive off; faster cars say
  TOO FAST. A free parked car nearer to you still wins. Getting hit, or the car moving off, cancels
  it. A driver with a temper may drag you back out if you're still slow: you land on the ground,
  and he drives off fleeing.
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
  | Fists | a punch: 8 damage, 0.38 s, 13 px reach in a cone in front; knocks people down 1 time in 4, dents a car for 1 | always |
  | Pistol | 9 damage, 0.32 s | $200 / 24, 240 |
  | Uzi | 5 damage, 0.085 s (hold to spray) | $500 / 90, 450 |
  | Shotgun | 6 pellets × 7 damage in a ±0.22 rad fan, 0.8 s, ~170 px range, shoves cars | $800 / 12, 60 |
  | Bazooka | rocket at 320 px/s with a smoke trail. It explodes on a car or wall, or after 1.4 s (90 px blast, +50 to the car it hits), 1.2 s | $2000 / 5, 20 |
  | Grenades | thrown up to 160 px in an arc, bounces off walls and cars, 2 s fuse, 75 px blast, 0.6 s | $600 / 5, 20 |
  | Molotovs | thrown up to 150 px, shatters on landing or on a car/wall, leaves a 28 px fire patch for 6 s. Cars in it burn (the tank doesn't catch), and it hurts you, 0.7 s | $400 / 5, 20 |

  Bullets and pellets don't hurt the tank; explosions and fire do 35%. When a weapon runs dry you
  switch to the Uzi, shotgun or pistol (never to an explosive), else to your fists.
- **People and cows** (30 / 60 hp) take every weapon: 4 punches or 4 pistol rounds drop a person,
  a shotgun blast kills up close (to ~35 px), explosions throw bodies (the blast's edge can set someone
  alight), and a molotov patch sets people on fire; they run screaming and end up a burnt corpse.
  Every gunshot scares the street for 260 px, a blast for 420 px. Hit a violent one and they fight
  back with fists (5 per hit, they dent your car too), a pistol or an Uzi, in 3-round bursts.
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
src/paint.js        paint shops: the colour menu and the respray
src/gangs.js        the mobs: respect, the Moretti-Orlov war, turf (screenplay-agent)
src/aov.js          area of view: what exists around the player (streamed traffic, used cars, wrecks)
src/peds.js         pedestrians and cows: sidewalk walking, crossings, tempers, alarms, corpses, loot
src/airport.js      flights (land, taxi, take off) and the port's container cranes
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
| `walks` | draw the pedestrian walk graph (walks cyan, crossings green = signalised / yellow = unsignalised, dead ends red, cow pens orange) |
| `routes` | draw the airport routes (approach, departure, taxi paths) and the port's rail, deck and quay slots |
| `ped=scared\|angry\|violent[,n]` | put n peds of that temper on the sidewalk next to you |
| `respect=<mob>,<n>` | set a mob's respect (moretti, orlov, orchid; -100..100), e.g. `goto=Main%20City&respect=orchid,-70` |
| `ped=gang:<mob>[,n]` | put n members of that mob next to you |
| `cop=pistol\|shotgun[,n]` | put n foot cops with that gun next to you (`&ped=scared&punch=1,60` starts a fight) |
| `paint=i[,j]` | sit in a sedan on paint shop i's bay (0-3) with the menu open; `j` resprays it in colour j (0-9) at once |
| `warm=N` | simulate N seconds before the first frame, so screenshots show settled traffic |
| `perf` | show car counts, cars updated this tick, collision pairs, and peds / cows / corpses (`node tools/bench.js` times the update loop) |
| `drive=N` | enter the starter car and drive for N ticks (`&crash` steers into things) |
| `boom` | blow up a nearby car |
| `mission=delivery\|boost\|torch\|rush` | start that job |
| `shoot=N` | fire the Uzi at the nearest car for N ticks |
| `wfire=<id>,<ang\|car\|ped>,<n>[,<ticks>]` | take weapon `<id>` (`fist pistol uzi shotgun bazooka grenade molotov`) with full ammo, face `ang` radians (0 = up, clockwise), the nearest parked car or the nearest living ped/cow (throws land on it), fire `n` times at the weapon's rate, then run `ticks` more after the last shot (default one cooldown; `-1` = none). E.g. `goto=Airport&wfire=bazooka,4.4,1,-1&settle=0` catches a rocket in flight |
| `punch=n[,ticks]` | fists: step up to the nearest living ped or cow and punch it n times at the fist's rate, then run `ticks` more (default one cooldown). `ped=angry&punch=2,3&settle=0` catches a punch landing |
| `pedgun=fist\|pistol\|uzi` / `pedat=dx,dy` | arm the peds `ped=` just spawned / move them to (dx, dy) px from the player, 12 px apart. `ped=violent&pedgun=pistol&punch=1,40&settle=0` gets shot at |
| `settle=N` | ticks simulated before the picture (default 30; `0` freezes the moment a shot or punch lands) |
| `focus=dead` | frame the newest corpse (the toast says DEAD or BURNT). `ped=scared&pedat=10,-45&wfire=molotov,ped,1,330&settle=0&focus=dead` shows a burnt corpse |
| `arsenal` | full ammo for every weapon |
| `cash=N` | set your money |
| `shop=i[&sel=j]` | stand on gun store i's mat (0-4) with the store open, row j selected |
| `cam=tx,ty` | centre the camera on a tile, e.g. `goto=Stadium&cam=328,158` frames the whole stadium |
| `heli=N` | spawn a helicopter, climb for 2.5 s, fly forward for N ticks (HUD shows altitude/speed/rotor) |
| `tank=a` | get in the tank, turret at angle a, fire once |
| `runover=ped\|cow,v[,n]` | put n bodies in front of the nearest car, get in and hit them at v px/s (40-110 knocks a ped down, > 110 kills; cows die > 60) |
| `jack=secs[,drive]` | carjack the nearest traffic car: it's slowed to a crawl, you stand by its passenger side and press E, then secs s run (default 0.4, mid-yank; ~0.6 s to walk round, 0.35 s more to get in); `drive` holds the gas once you're in. Add `settle=0` to catch a moment |
| `gangcar=id[,n]` | n of mob `id`'s traffic cars (`moretti`, `orlov`, `orchid`) standing on the lane nearest you, 70 px apart, AI-driven. With `goto=Side%20City` etc.; with `jack=` you steal one (its driver gets out as a member, respect -3) |
| `gangram=id[,how[,secs]]` | one of mob `id`'s cars standing AI-driven on a lane near you is hit, then `secs` s run (default 2; `block` 4); a toast reports the crew. `how`: `ram` (your sedan into its tail at 60 px/s), `shoot` (a pistol round), `block` (your sedan stopped ahead), `civ` (a driverless sedan shoved into it: no bail), `rival:<mob>` (two of that mob's members nearby). Use `goto=Side%20City` for Moretti, since the spawn is Orlov turf |
| `jack=back[,secs]` | the same steal, but the driver comes out violent with fists; you wait in the car until he drags you out and drives off (secs default 4) |
| `flight=land\|depart\|runway[,secs]` | start that airport movement now (land: an airliner into the remote stand; depart: a gate plane; runway: the lined-up airliner), run `secs` of it and frame the plane |
| `crane=secs` | run the port cranes for `secs` and frame the middle crane |
| `seek=ped` | run up to 120 s until a traffic car is stopped for a ped (or cow), then frame it |
| `phone=home\|contacts\|messages\|gps\|music\|incoming` | open the cellphone (`&call=i` calls contact i) |
| `mouse=x,y` | fake a mouse position (screen px) |
| `map` | open the map |

```sh
node tools/check.js                        # every script loads cleanly in one scope
tools/shot.sh out.png 'demo&drive=60'      # headless Firefox screenshot of a scenario
tools/shot.sh g.png '' gallery.html        # screenshot of the asset gallery (set SHOT_SIZE=1400,9000)
```

## Later

Radio and music, the wanted level and police cars, gangs, more mission types, saving.
