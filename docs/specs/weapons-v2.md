# Spec: Weapons v2 — classic arsenal and gun stores

Status: **implemented** 2026-09-26, awaiting a play test. Coordinator: main session.
Owners: **weapons-agent** (weapons and projectiles), **pixel-agent** (art), **geo-agent** (the five
stores), **sound-agent** (sounds), and the coordinator (shop UI, keys, start money, integration).

## 1. The user's brief

"Weapons and gunshop. Include classic weapons from the game: pistol, uzi, shotgun, bazooka, also
grenades and molotov. To buy those, include 5 gun stores in different regions. The character enters
the gun store building and the HUD shows the weapons' availability, price, stats, etc. Give me a nice
head-start cash to test every weapon."

## 2. The arsenal (weapons-agent owns the numbers; these are the starting point)

All weapons are used **on foot** only, as today. They aim with the mouse, fire with left click
(or Space), and the damage contract is unchanged (weapons set damage dealt, vehicles set damage taken).
There are still no people to target.

| id | name | type | fire | shop price / pack | max carried |
|---|---|---|---|---|---|
| `pistol` | PISTOL | bullet | `cool` 0.32, dmg 9 (as now) | $200 / 24 | 240 |
| `uzi` | UZI | bullet | `cool` 0.085, dmg 5 (as now) | $500 / 90 | 450 |
| `shotgun` | SHOTGUN | pellets | 6 pellets, spread ±0.22 rad, dmg 7 each, `cool` 0.8, short range (~170 px), a small shove on cars | $800 / 12 | 60 |
| `bazooka` | BAZOOKA | rocket | rocket at ~320 px/s with a smoke trail. It explodes on a car or wall, or after ~1.4 s. The blast is `Game.explode` (the tank shell's), so it hurts the player too if too close. `cool` 1.2 | $2000 / 5 | 20 |
| `grenade` | GRENADES | thrown | lands at the crosshair (max ~160 px; 110 px ahead without a mouse), draws an arc (fake height), bounces off walls and cars, 2.0 s fuse from the throw, then `explode` with a slightly smaller radius. `cool` 0.6 | $600 / 5 | 20 |
| `molotov` | MOLOTOVS | thrown | lands at the crosshair (max ~150 px), shatters on landing or hitting a car/wall, and leaves a fire patch (~28 px radius, ~6 s): cars inside take fire damage and catch fire (`burning`), the player inside is hurt, and it leaves a scorch decal. `cool` 0.7 | $400 / 5 | 20 |

`WEAPONS[id]` gains `shop: { price, pack, max, stats: { damage, rate, range, area }, blurb }`.
The stats are 0–5 bars for the shop card, and `blurb` is one line in capital letters that fits the bitmap font.
`WEAPON_ORDER = ['fist', 'pistol', 'uzi', 'shotgun', 'bazooka', 'grenade', 'molotov']`.
Weapons are still lost at the hospital. The existing pistol/Uzi crates stay; the new weapons are
**store-only**.

Projectiles are a new list `G.projectiles` (rockets, grenades, molotov bottles), updated and drawn
by weapons-agent. Fire patches are `G.fires`. The ground and sprites are drawn through `Render`
indexes only when that makes sense; both lists are small, so looping over them is fine.

## 3. Controls (approved by the coordinator)

| Action | Key | Notes |
|---|---|---|
| `weapon` | Q / Tab (as now) | cycles through the weapons you have |
| `slot1`…`slot7` (new) | **1–7** | 1 = fists, 2 pistol, 3 uzi, 4 shotgun, 5 bazooka, 6 grenades, 7 molotovs (ignored if you have no ammo) |
| in the shop | W/S or ↑/↓ or mouse hover: select · Enter / E / left click: buy · Esc / Backspace / clicking LEAVE: leave | |

`0` stays mute. The number keys go into `KEYMAP` (coordinator).

## 4. Gun stores (geo-agent)

- Five stores, one each in: **Major City**, **Side City**, **Main City**, **Ironworks**, and one
  **roadside store in the countryside** (e.g., on a highway or rural road near a farm zone).
  One of them should be within an easy walk (≲ 40 tiles) of `c.spawn`, so testing is quick.
- Building: `addBuilding(..., 'gunshop', flat('gunshop'), rg, { sign: 'GUNS', gunshop: i })`,
  1–2 floors, about 6–8 × 5 tiles, the front on a sidewalk.
- `c.gunshops = [{ id: i, name: 'PASTEL ARMS', area: 'MAJOR CITY', x, y, ang, b }]`. `x, y` are the world
  px of the **door mat** on the sidewalk right in front of the door, `ang` faces out of the store, and `b` is
  the building. `name` is the store's own name (each store has its own; short, capital letters, ≤ 16 chars, no real brands).
- Place a `gunshop_door` sprite at each door mat (props sheet). It's a floor decal: not solid, not breakable.
- Add each store to the GPS / goto places (`c.places` or however GPS destinations are listed) as
  "GUN STORE: <area>", and to landmarks/`docs/geography.md` (`node tools/geo-report.js`).

## 5. Art (pixel-agent)

- Facade `wall_gunshop` (the 8-frame facade contract) and roof `roof_gunshop`: dark steel/olive
  with a pastel accent, barred windows and a shop door with a lit transom. It should read as "the gun store"
  at a glance, but softly, in the pastel style.
- `props:gunshop_door`: 16×16, 2 frames (a glowing entry mat/chevron, slow pulse).
- `props:icon_shotgun`, `icon_bazooka`, `icon_grenade`, `icon_molotov` (same style and size as `icon_pistol`).
- A new sheet **`shop`**, 64×32 frames, one tag per weapon: `shop_pistol`, `shop_uzi`, `shop_shotgun`,
  `shop_bazooka`, `shop_grenade`, `shop_molotov`. These are side-view "catalogue" pictures for the shop card.
- Projectiles on props (16×16): `rocket` (pointing up; the code rotates it), `grenade_proj`, `molotov_proj`
  (a bottle with a lit rag, 2 frames).
- `fx:scorch` isn't needed; a scorch is painted with `Render.paint`. Fire patches reuse `fx:fire`.
- Player: if the player sprite has per-weapon frames, add shotgun/bazooka poses; otherwise say so, and the
  current "holding" pose is used for everything.
- Everything shows up in `gallery.html`.

## 6. Sound (sound-agent, after weapons-agent)

Shotgun blast (plus a pump), bazooka launch plus a rocket whoosh loop, grenade throw (a whoosh), bounce
tink, the pin; molotov throw, glass shatter plus a fire-whoosh loop on the patch. The explosions use the
existing `Sound.explode`. Shop: door chime on entering, UI move, buy cha-ching, a "can't afford / full"
buzz, and leaving. All as one-line hooks or read from state.

## 7. Shop UI and integration (coordinator, `src/shop.js`)

- Walking onto a door mat (on foot, ~10 px) opens the store. The world is paused while you shop
  (like the pause screen). You leave by the keys above, and you're placed 14 px out from the mat.
- The panel shows the store name and area, and your money. On the left, the list: icon, name, price, and your ammo
  (or `OWNED 24/240`). On the right, a card: the `shop_<id>` picture, stat bars (DAMAGE / RATE /
  RANGE / AREA), pack size, the blurb, and a BUY button with the price. It greys out and explains
  "NOT ENOUGH CASH" or "FULL".
- Buying adds `pack` ammo (clamped to `max`), subtracts the price, and selects that weapon.
- Head start: `START_MONEY = 10000` in game.js (enough to buy every weapon twice). Respawning
  keeps your money, as now. The `$100,000` goal still counts `G.money`.
- Demo hooks: `cash=N`, `shop=i` (open store i), `arsenal` (full ammo for everything),
  plus weapons-agent's own test hook (below).

## 8. Done when

`node tools/check.js` passes. Screenshots are looked at: each store's exterior, the shop panel, and each weapon in
action (the weapons-agent hook `wfire=<id>,<ang>,<n>` or similar, documented in README). Sounds are wired,
README is updated (controls, weapons table, gun stores), and decisions are logged. Nobody can test the feel
or sound from here: the user plays it.
