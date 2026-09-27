# Spec: Carjacking (follows backlog items 1 and 8)

Status: **built** 2026-09-27 (C1-C3 done); not play-tested or listened to. Coordinator: main session.
The user asked for it after pedestrians: "wire the pedestrians, so after it we can steal traffic moving cars",
and "violent people fight back if you hit them **or steal their cars**". The user's earlier answer: press E next
to a stopped or slow traffic car; the driver gets out as a pedestrian with a temper.

## 1. Rules (coordinator's defaults; the user can overrule them after the play test)

- **Who can be jacked:** traffic cars (`c.traffic`, `c.driver.ai`) moving **< 30 px/s** (stopped at a light,
  queuing, crawling, or a car you blocked). Faster ones can't be opened: E does nothing (a toast "TOO FAST" at
  most once every 2 s when you're touching one). Aircraft, trains and the tank are out; parked cars work as today.
- **Reach:** the player on foot within 18 px of the car's body (the same test as entering a parked car); the
  nearest free parked car still wins if it's closer.
- **The jack (~0.7 s):** the car brakes to a stop the moment you grab the door; the player steps to the
  **driver's door** (left side, right-hand traffic); the driver is **yanked out** (thrown ~14 px sideways, lies
  `down` for a beat), then the player gets in and drives. During the jack the player can't move or shoot,
  and a hit on the player (or the car starting to move > 40 px/s) cancels it.
- **The driver** becomes a ped at the door with a temper drawn from the car's zone mix (`ZONES[z].peds.mix`,
  and highway / wild use the downtown mix), a random outfit, and an armed roll like any violent ped:
  - **Scared:** scrambles up and runs.
  - **Angry:** gets up yelling ("MY CAR!", "THIEF!", "HEY, THAT'S MINE!"), chases a few seconds, gives up.
  - **Violent:** fights for the car. Fists: runs after it and, if the car is still slow (< 20 px/s) when he
    reaches the driver's door, **drags the player back out** (the same 0.7 s jack in reverse; the player lands
    `down` on foot for 0.8 s and takes 5 damage) and drives off fleeing at the model's top speed. Armed: shoots at
    the car (and the player once they're out). Gives up by the usual rules (450 px, 25 s).
- **Witnesses:** a jack raises `Peds.alarm(x, y, 120, 'jack', G.player)` (scared flee, angry complain, violent
  look), and the traffic behind honks as for a blocked car.
- **After:** the stolen car is an ordinary managed car (`traffic = false`), the player's until they leave it.
  A car a violent ped took back is a traffic car again in **flee** mode (it re-acquires a lane).
- **Rewards:** none yet; the wanted level (item 2) will make jacks cost a star later.

## 2. Ownership and contracts

| Part | Owner | Where |
|---|---|---|
| Jack mechanics: E on a traffic car, brake, door position, yank, enter, cancel, the reverse jack, handing a car back to an AI driver in flee mode | vehicles-agent | `tryEnterCar`/`exitCar` in game.js, a `Jack` section (game.js or entities.js), `Traffic.takeOver(car)` in traffic.js |
| The driver ped: spawn with a temper, the chase and pull-back decision, bubbles, the `jack` alarm | coordinator | src/peds.js |
| Door yank, "hey!" and scuffle sounds | sound-agent | audio.js + one-line hooks |

Contracts:
- `Game.jack(car, by)` starts a jack: `by` is `G.player` (stealing from an AI driver) or a ped (taking it back
  from the player). It returns false if not allowed. The state lives in `G.jack = { car, by, t, phase }`;
  while it runs, the driver's controls are off and the car brakes.
- When the driver is out: `Peds.driverOut(car, x, y, ang, { byPlayer: true })` (coordinator) makes the ped and
  returns it; the jack knocks it down with a push away from the door.
- When a ped takes the car back: `Traffic.takeOver(car, ped)` makes it an AI car in flee mode; the ped is
  removed from `G.peds` (it's the driver now), and the car remembers the look (`car.driverLook`) so the same
  person gets out if it's jacked again.
- `Game.driverDoor(car)` gives the world point outside the driver's door (and whether it's blocked).

## 3. Tasks

| # | Task | Owner | Done when |
|---|---|---|---|
| C1 | Jack mechanics and the reverse jack, `Traffic.takeOver`, demo hook `jack` (walk to the nearest slow traffic car and jack it), `jack=back` (a violent fists driver takes it back) | vehicles-agent | screenshots: mid-yank, the driver on the ground, the player driving off; the reverse jack |
| C2 | `Peds.driverOut`, tempers, the chase and pull-back logic, bubbles, alarm | coordinator | a headless run of each temper |
| C3 | Sounds | sound-agent | soundboard + hooks fire |
| C4 | README (controls: E jacks a slow car), backlog, decision log, the user's play test | coordinator | the user steals a few cars |

C1 and C2 in parallel (C2 codes against the contract), then C3, then C4.
