'use strict';
// Game state, rules, missions, HUD and the main loop.

const STEP = 1 / 60;
const GOAL = 100000;
const START_MONEY = 10000;   // head start: enough to buy every weapon twice
const G = {
  state: 'title', time: 1, t: 0,
  cars: [], pickups: [], bullets: [], projectiles: [], fires: [],
  money: 0, mult: 1,
  cam: { x: 0, y: 0, cx: 0, cy: 0, w: 480, h: 270, shake: 0 },
  msg: null, banner: null, toast: null,
  showMap: false, paused: false, won: false,
};

// does the atlas have this sprite yet? (guards art that another agent may still be drawing)
// Weapons vs bodies (weapons-agent, spec peds-v1 P4). Hit radii in px (a cow is ~10x28, one circle
// is a rough fit); push = the fraction of a round's velocity given to the body it hits (pellets
// shove harder); gunshot alarms land SHOT_REACT s late; a punch shows the `punch` frame 0 for the first 0.1 s of PUNCH_T; a blast's outer
// half sets a surviving ped alight this often.
const BULLET_R = { ped: 5, cow: 9, player: 5 };
const BULLET_PUSH = { round: 0.06, pellet: 0.16 };
const PUNCH_T = 0.22;
const BLAST_IGNITE = 0.35;
const SHOT_REACT = 0.15;   // s before bystanders react to a gunshot

// Carjacking (vehicles-agent, spec carjack-v1 C1). Times in s, speeds in px/s, distances in px.
// The jacker walks to the driver's door (around the car if needed), yanks at >= YANK s once there,
// and is in the seat IN s after the yank.
const JACK = {
  REACH: 18,        // on foot within this of the car's body (the same test as a parked car)
  MAX_V: 30,        // a traffic car slower than this can be jacked
  BACK_V: 20,       // the player's car must be slower than this for a ped to take it back
  CANCEL_V: 40,     // the car moving faster than this cancels the jack
  YANK: 0.35, IN: 0.35, GIVE_UP: 1.5,   // yank time, yank -> seated, and give up if the door isn't reached by then
  STEP_V: 160,      // jacker's step speed to the door
  DOOR_OUT: 6,      // door point: this far outside the car's side
  THROW_V: 55,      // push on the yanked body (decays to ~14 px of slide)
  DOWN_T: 0.8,      // the player pulled out lies down this long
  HURT: 5,          // and takes this much damage
  FAST_TOAST: 2,    // s between "TOO FAST" toasts
};

// Gang cars (vehicles-agent, spec gangs-v1 §1 / G4). In a mob's turf this share of traffic spawns
// (times the presence share relative to the mob's own: 1 in its turf, 0.5 for Orlov in Ironworks)
// is that mob's car: its model, its paint, `car.gang = id`. It replaces a normal spawn (same budget).
// Parked spots using the region mix get one 1 in GANG_PARKED_ONE_IN (times the same share).
const GANG_CAR_SHARE = 0.1;
const GANG_PARKED_ONE_IN = 15;
// Gang car crews (gangs-v1 §1 "Mob cars carry a crew of two", G7). An AI gang car never flees or
// honks like a civilian: hit by the player (rammed, shot, blasted, burnt, punched, or blocked for
// BLOCK_T s) or in sight of a rival mob (a member on foot or a crewed car within RIVAL_R px), it
// brakes, and below BAIL_V both members (driver + passenger doors) jump out fighting; the empty
// car stays put. Once per car (`crewOut`). A wreck kills the crew inside (no bail).
const GANG_CREW = {
  BAIL_V: 20,       // px/s: the crew jumps out below this
  BLOCK_T: 2,       // s stopped behind the player (car or on foot) before they get out
  RAM_V: 15,        // px/s closing speed of the player's car that counts as a hit
  RIVAL_R: 180,     // px: a rival in clear sight this close makes them bail
  RIVAL_EVERY: 0.25,// s between rival scans
  RIVAL_WAIT: 3,    // s stopped waiting for a braking rival car before giving up and driving on
  HIT_T: 3,         // s: a wreck this soon after the player's hit kills the crew on the player's account
};

function hasSprite(sheet, tag) { const s = Assets.sheets[sheet]; return !!(s && s.tags[tag]); }

const Game = {
  // ------------------------------------------------------------- setup --
  start(seed) {
    G.city = City.build(seed);
    G.R = rng(seed ^ 0x5eed);
    G.obstacleGrid = new Grid(G.city.obstacles);
    Airport.init(G.city);   // takes the planes and cranes out of the static sprites: before Render indexes them
    Render.init(G.city);
    const c = G.city;
    G.cars = [];
    G.money = START_MONEY;
    for (const s of c.parked) this.spawnParked(s);
    G.tank = this.spawnCar('tank', c.tankSpot);
    G.tank.ang = c.tankSpot.ang;
    G.waypoint = null;
    const st = c.starterCar;
    G.cars.push(new Car(st.model, st.x, st.y, st.ang));
    G.player = new Player(c.spawn.x, c.spawn.y);
    G.pickups = [];
    G.sprays = [];
    G.bullets = []; G.projectiles = []; G.fires = [];
    const kinds = ['cash', 'cash', 'health', 'pistol', 'pistol', 'uzi'];
    for (const s of c.crateSpots) if (G.R() < 0.55) G.pickups.push({ kind: pick(G.R, kinds), x: s.x, y: s.y, away: 0 });
    // guarantee a pistol near the start
    G.pickups.push({ kind: 'pistol', x: c.spawn.x - 40, y: c.spawn.y - 2, away: 0 });
    Missions.init();
    Phone.init();
    Clock.init(TITLE_MIN);
    this.setupTraffic();
    if (typeof Gangs !== 'undefined') {   // the mobs (src/gangs.js): respect, turf; the HUD flashes changes
      Gangs.init();
      HUD.gangFx = {}; HUD.gangBand = {};
      if (Array.isArray(Gangs.onChange)) Gangs.onChange.push((id, before, after) => HUD.gangChanged(id, before, after));
    }
    Peds.init();
    G.cam.cx = c.spawn.x; G.cam.cy = c.spawn.y;
    G.district = null;
    Train.init(c.rail);
  },

  spawnCar(model, s) {
    const car = new Car(model, s.x, s.y, s.ang + (G.R() - 0.5) * 0.04);
    if (s.alt) car.alt = s.alt;   // parked on a roof (helipads)
    G.cars.push(car);
    return car;
  },

  // is there room for a vehicle of `len` along the heading at spot s?
  roomFor(s, len) {
    const fx = Math.sin(s.ang), fy = -Math.cos(s.ang);
    return !G.cars.some((c) => {
      const dx = c.x - s.x, dy = c.y - s.y;
      const along = Math.abs(dx * fx + dy * fy), across = Math.abs(dx * fy - dy * fx);
      return across < 30 && along < (len + c.len) / 2 + 8;
    });
  },

  // stalls only fit regular cars; curbs can take trucks and buses when there is room
  // each spot either names its models (yards, driveways, farms) or uses its region's mix
  spawnParked(s) {
    if (Physics.solidAt(s.x, s.y) === 2) return null;   // never park a car in the water
    const weights = s.models ? Object.fromEntries(s.models.map((m) => [m, 1])) : City.regionAt(s.x, s.y).models;
    const maxLen = s.stall || s.driveway ? 58 : 999;
    // spots that use the region mix (not yards, farms, police, hospital) may hold a mob's car
    const mob = s.models ? null : this.gangRoll(s.x, s.y, 1 / GANG_PARKED_ONE_IN);
    let model = mob && MODELS[mob.carModel].len <= maxLen ? mob.carModel : randomModel(G.R, maxLen, weights);
    if (!this.roomFor(s, MODELS[model].len)) model = randomModel(G.R, 58, weights);
    if (!this.roomFor(s, MODELS[model].len)) return null;
    const c = this.spawnCar(model, s);
    if (c) c.home = s;   // untouched parked car: stays put until the player uses it (AOV)
    if (c && mob && model === mob.carModel) this.gangCar(c, mob);
    return c;
  },

  // ------------------------------------------------------ gang cars (G4) --
  // the mob whose car spawns at (x, y) with probability `chance` × its presence share, or null
  gangRoll(x, y, chance) {
    if (typeof Gangs === 'undefined' || !Gangs.presence) return null;
    const pr = Gangs.presence(x, y), mob = pr && this.gangMob(pr.id);
    if (!mob) return null;
    // presence share is the ped share (0.12 in the turf, 0.06 Orlov in Ironworks): relative to the mob's own
    const rel = pr.share == null || !mob.share ? 1 : clamp(pr.share / mob.share, 0, 1);
    return G.R() < chance * rel ? mob : null;
  },
  gangMob(id) {
    const mob = typeof Gangs === 'undefined' ? null : Gangs.get ? Gangs.get(id) : (Gangs.list || []).find((g) => g.id === id);
    return mob && MODELS[mob.carModel] ? mob : null;
  },
  // tag a car as the mob's: its paint (a PAINTS id; null keeps the stock body) and `gang`
  gangCar(car, mob) {
    car.gang = mob.id;
    if (mob.carPaint != null) car.paint = mob.carPaint;
    return car;
  },

  // ------------------------------------------------- gang car crews (G7) --
  // a crewed AI gang car turns on `foe`: G.player, a rival ped, or a rival mob's car. It brakes
  // (Traffic.controls) and its crew bails out once slow enough. The player's hit wins over a rival.
  gangHit(c, foe) {
    if (foe === G.player) c.playerHitT = G.t;
    const d = c.driver;
    if (!c.gang || c.crewOut || c.wreck || c.gone || !d || !d.ai || (G.jack && G.jack.car === c)) return;
    if (d.angry && (d.foe === G.player || foe !== G.player)) return;
    d.angry = true; d.angryT = 0; d.foe = foe;
    c.honking = false; c.hornT = -1;
  },
  gangCanBail(c) {
    return !!(c.gang && !c.crewOut && !c.wreck && !c.gone && c.hp > 0 && c.driver && c.driver.ai && !(G.jack && G.jack.car === c) &&
      c.speed() < GANG_CREW.BAIL_V && typeof Peds !== 'undefined' && typeof Peds.driverOut === 'function');
  },
  // where a crew member lands: outside the door on `side` (-1 driver's, +1 passenger's); a blocked
  // door sends them out the other one, a step further back
  crewSpot(c, side) {
    let door = this.driverDoor(c, side), back = 0;
    if (door.blocked) { door = this.driverDoor(c, -side); back = 14; }
    return { x: door.x + c.fx * (7 - back), y: door.y + c.fy * (7 - back), ang: Math.atan2(door.nx, -door.ny) };
  },
  // both members jump out, on their feet and fighting `foe` (G.player by default; a rival ped, or
  // any placeholder the caller retargets at once); the car is left empty where it stopped, still the mob's
  gangBail(c, foe = G.player) {
    if (!this.gangCanBail(c)) return null;
    c.crewOut = true;
    const pl = foe === G.player, crew = [];
    const o = { gang: c.gang, bail: true, byPlayer: pl, foe: pl ? undefined : foe };
    for (const side of [-1, 1]) {
      const s = this.crewSpot(c, side), ped = Peds.driverOut(c, s.x, s.y, s.ang, o);
      if (!ped) continue;
      Physics.moveWalker(ped, 0, 0);   // out of any overlap
      crew.push(ped);
    }
    if (crew[0] && crew[0].look != null) c.driverLook = crew[0].look;
    c.crew = crew;
    Sound.bail(c, crew);
    c.driver = null; c.traffic = false; AOV.release(c);
    c.honking = false; c.hornT = -1; c.sirenOn = false;
    return crew;
  },
  // two rival crews stopped face to face: both get out and each takes on the other
  gangBailPair(a, b) {
    if (!this.gangCanBail(a) || !this.gangCanBail(b)) return false;
    const ca = this.gangBail(a, b), cb = this.gangBail(b, ca[0] || G.player);
    ca.forEach((p, i) => { if (cb.length) p.foe = cb[i % cb.length]; });
    cb.forEach((p, i) => { if (ca.length) p.foe = ca[i % ca.length]; });
    return true;
  },
  // a gang car changes hands (jacked, or a parked one taken): once per car
  gangStolen(car) {
    if (!car.gang || car.gangStolen) return;
    car.gangStolen = true; car.crewOut = true;   // whoever was in it is out now (jacked, or it was parked)
    if (typeof Gangs !== 'undefined' && Gangs.carStolen) Gangs.carStolen(car.gang);
  },

  // Traffic pool (spec traffic-v1 §B.2/B3): the budget is the zone densities (cars per 100 road
  // tiles) summed over the lanes inside the AOV; cars spawn on a lane out of sight, already moving.
  setupTraffic() {
    const c = G.city;
    G.trafficBudget = 0;
    if (!c.lanes || !c.lanes.length) return;   // no lane graph yet
    const TRAFFIC_CRUISE = 0.35, HIGHWAY_CRUISE = 0.55;
    const list = () => G.cars.filter((k) => k.traffic && !k.gone);
    let near = [], nearAt = -1;
    AOV.pool('traffic', {
      get max() { return G.trafficBudget; },
      list,
      pick() {
        if (G.t >= nearAt) { // lanes touching the AOV, and the budget, refreshed every 2 s
          nearAt = G.t + 2;
          const r = AOV.aov;
          near = City.lanesIn(r.x0, r.y0, r.x1, r.y1, []);
          let budget = 0;
          for (const l of near) {
            const Z = ZONES[l.zone], len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0) / TILE / 2;   // two lanes per road
            if (Z && Z.traffic) budget += (Z.traffic.density * len) / 100;
          }
          G.trafficBudget = Math.round(budget);
        }
        if (!near.length) return null;
        // a point on the part of the lane inside the AOV (lanes are axis-aligned, and can be long),
        // kept away from both ends so cars don't appear inside a junction or at a stop line
        const l = pick(G.R, near), r = AOV.aov;
        const lo = (v0, v1, a, b) => { const d = v1 - v0; if (!d) return [0, 1]; const t0 = (a - v0) / d, t1 = (b - v0) / d; return [Math.min(t0, t1), Math.max(t0, t1)]; };
        const [ax, bx] = lo(l.x0, l.x1, r.x0, r.x1), [ay, by] = lo(l.y0, l.y1, r.y0, r.y1);
        const m = Math.min(0.45, 70 / Math.max(l.len || 1, 1));
        const t0 = Math.max(m, ax, ay), t1 = Math.min(1 - m, bx, by);
        if (t1 <= t0) return null;
        const t = t0 + G.R() * (t1 - t0);
        return { lane: l, t, x: l.x0 + (l.x1 - l.x0) * t, y: l.y0 + (l.y1 - l.y0) * t };
      },
      spawn(s) {
        const l = s.lane, Z = ZONES[l.zone];
        if (!Z || !Z.traffic) return null;
        if (dist(s.x, s.y, G.player.px, G.player.py) < 200) return null;
        const mob = Game.gangRoll(s.x, s.y, GANG_CAR_SHARE);   // replaces a normal car, same budget
        const model = mob ? mob.carModel : randomModel(G.R, 999, Z.traffic.models), M = MODELS[model];
        const v = M.max * (l.profile === 'highway' ? HIGHWAY_CRUISE : TRAFFIC_CRUISE);
        // room to stop: the lane ahead must be clear for the stopping distance (the driver plans
        // with 30% of `brake`), and the front bumper must not start inside a stop line's range
        const need = M.len / 2 + (v * v) / (2 * 0.3 * M.brake) + 20;
        if (l.stop) {
          const toStop = (l.stop.x - s.x) * l.dx + (l.stop.y - s.y) * l.dy - M.len / 2;
          if (toStop > -M.len && toStop < need) return null;
        }
        for (const k of G.cars) {
          const rx = k.x - s.x, ry = k.y - s.y, along = rx * l.dx + ry * l.dy, lat = Math.abs(rx * l.dy - ry * l.dx);
          if (lat < 26 + k.hw && along > -(M.len + k.len) / 2 - 30 && along < need + k.len / 2) return null;
        }
        const car = new Car(model, s.x, s.y, Math.atan2(l.dx, -l.dy));
        car.vx = l.dx * v; car.vy = l.dy * v;
        car.traffic = true; car.managed = true;
        car.driver = { ai: true, lane: l.id, cruise: v };
        if (mob) Game.gangCar(car, mob);
        G.cars.push(car);
        return car;
      },
      removable: (k) => AOV.removable(k),
      remove(k) { k.gone = true; G.cars = G.cars.filter((x) => x !== k); },
    });
  },

  // ----------------------------------------------------------- events --
  impact(c, speed, x, y, other) {
    Sound.impact(c, speed, x, y, other);
    if (c.gang && other && other === G.player.car && speed > GANG_CREW.RAM_V) this.gangHit(c, G.player);   // rammed by the player
    if (speed < 70) return;
    if (speed > 110) Peds.alarm(x, y, PED.ALARM.crash, 'crash', c);
    if (speed > 140) Parts.sparks(x, y, Math.min(14, (speed / 35) | 0));
    if (c.m.tank && !(other && other.m.tank)) return;   // armour: vehicles and walls can't hurt it
    // the heavier the other side, the more it hurts
    const ratio = other ? clamp(other.m.mass / c.m.mass, 0.25, 4) : 0.8 / Math.sqrt(c.m.mass);
    const dmg = (speed - 70) * 0.1 * ratio;
    this.damageCar(c, dmg);
    if (c.driver === G.player) G.cam.shake = Math.max(G.cam.shake, Math.min(6, speed / 70));
  },

  // src (optional): who dealt it (the player, their car, a ped, a car). Only gang cars read it.
  damageCar(c, dmg, src) {
    if (c.wreck) return;
    c.hp -= dmg;
    c.flash = 0.06;
    if (c.gang && src && (src === G.player || src.driver === G.player)) this.gangHit(c, G.player);
  },

  destroyCar(c) {
    c.wreck = true; c.burning = false; c.hp = 0;
    c.sirenOn = false; c.honking = false; c.hornT = -1;
    c.vx *= 0.3; c.vy *= 0.3;
    c.smokeT = 7;
    this.explode(c.x, c.y, c.m.heavy || c.m.tank ? 2 : 1);
    if (c.m.volatile) { // a fuel tanker goes up along its whole length
      for (const f of [-0.35, 0.35]) { const [x, y] = c.toWorld(0, c.len * f); this.explode(x, y, 2); }
    }
    if (c.driver === G.player) this.hurtPlayer(999);
    if (c.gang && !c.crewOut && c.driver && c.driver.ai) {   // the crew dies inside (no bail)
      c.crewOut = true;
      if (typeof Gangs !== 'undefined' && Gangs.memberKilled && c.playerHitT != null && G.t - c.playerHitT < GANG_CREW.HIT_T) {
        Gangs.memberKilled(c.gang, G.player); Gangs.memberKilled(c.gang, G.player);
      }
    }
    this.earn(150, c.x, c.y);
    Missions.onCarDestroyed(c);
  },

  // o (optional): { r: car radius px, car: max car damage, pr: player radius, player: max player
  // damage }. The defaults are the tank shell's; the tank takes 35% (vehicles-agent's armour rule).
  // Peds and cows take the player's numbers (pr / player) and are thrown; `src` = who set it off
  // (the player, their tank; unknown = the player, spec peds-v1 §P4).
  explode(x, y, big = 1, o, src) {
    const R = (o && o.r) || 90, CAR = (o && o.car) || 110, PR = (o && o.pr) || 70, PD = (o && o.player) || 75;
    Sound.explode(x, y, big);
    for (let i = 0; i < 3 + big * 2; i++) {
      Parts.add({ k: 'expl', x, y, vx: 0, vy: 0, life: 0.55 + i * 0.08, ox: (Math.random() - 0.5) * 26 * big, oy: (Math.random() - 0.5) * 26 * big });
    }
    Parts.debris(x, y, 16);
    Parts.sparks(x, y, 14);
    for (let i = 0; i < 6; i++) Parts.smoke(x, y, true);
    Render.scorch(x, y, Math.random);
    G.flashes = (G.flashes || []).concat([{ x, y, t: 0.5 }]);
    const pd = dist(x, y, G.player.px, G.player.py);
    G.cam.shake = Math.max(G.cam.shake, clamp(14 - pd / 25, 2, 10));
    for (const c of G.cars) {
      const d = Math.hypot(dist(x, y, c.x, c.y), c.alt);   // blasts are at street level
      if (d > R || d < 0.01) continue;
      const k = 1 - d / R;
      this.damageCar(c, CAR * k * (c.m.tank ? 0.35 : 1), src || G.player);
      Physics.impulse(c, (c.x - x) / d, (c.y - y) / d, 380 * k * Math.min(c.m.mass, 2), c.x + (Math.random() - 0.5) * 12, c.y);
    }
    if (!G.player.car && pd < PR) this.hurtPlayer(PD * (1 - pd / PR));
    this.blastBodies(x, y, PR, PD, src || G.player);
  },

  // the living take damage and are thrown (the edge can set a ped alight); corpses are tossed too
  blastBodies(x, y, PR, PD, src) {
    if (!G.peds) return;
    for (const p of this.pedGrid().near(x, y, PR * 1.3 * 2)) {
      if (p.gone) continue;
      const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy) || 0.01;
      if (d > PR * 1.3) continue;
      const k = clamp(1 - d / PR, 0, 1), th = 250 * Math.max(k, 0.25), ux = dx / d, uy = dy / d;
      if (p.dead) { p.vx = ux * th * 0.8; p.vy = uy * th * 0.8; p.slide = Math.max(p.slide || 0, 0.35); continue; }
      if (d > PR) continue;
      const lit = p.kind === 'ped' && k < 0.45 && Math.random() < BLAST_IGNITE;
      Peds.hurt(p, PD * k, { kind: 'blast', src, vx: ux * th, vy: uy * th });
      if (lit && !p.dead) Peds.hurt(p, 0, { kind: 'fire', src });
      else if (p.dead && k > 0.7 && p.kind === 'ped' && Render.bloodSplat) {   // close to the centre: a wider spray
        for (let i = 0; i < 3; i++) { const a = Math.random() * Math.PI * 2; Render.bloodSplat(p.x, p.y, Math.cos(a), Math.sin(a)); }
      }
    }
    Peds.alarm(x, y, PED.ALARM.blast, 'blast', src);
  },

  // knock over a lamp post / burst a hydrant / scatter a bin
  breakProp(o, car) {
    G.obstacleGrid.remove(o);
    o.broken = true;
    const sp = Math.max(1, car.speed());
    const dx = car.vx / sp, dy = car.vy / sp;
    Sound.breakProp(o.breakable, o.x, o.y);
    if (o.breakable === 'lamp') {
      o.lamp.broken = true;
      Parts.sparks(o.x, o.y, 10);
      Render.fallenLamp(o.x, o.y, dx, dy);
    } else if (o.breakable === 'hydrant') {
      o.prop.broken = true;
      G.sprays.push({ x: o.x, y: o.y, t: 8 });
      Parts.debris(o.x, o.y, 5);
    } else {
      o.prop.broken = true;
      Parts.debris(o.x, o.y, 12);
      Render.litter(o.x, o.y, dx, dy);
    }
    if (car.driver === G.player) G.cam.shake = Math.max(G.cam.shake, 2);
  },

  hurtPlayer(n) {
    const p = G.player;
    if (p.dead) return;
    p.hp -= n;
    p.hurtT = 0.3;
    if (p.hp <= 0) {
      p.hp = 0; p.dead = true;
      if (p.car) { p.x = p.car.x; p.y = p.car.y; p.car.driver = null; p.car = null; }
      G.banner = { text: 'WASTED', color: PAL.z, t: 3.5 };
      Sound.ui('wasted');
      Missions.fail(null, true);
      G.respawnT = 3.5;
    }
  },

  earn(amount, x, y) {
    const v = amount * G.mult;
    G.money += v;
    if (x !== undefined) Parts.add({ k: 'pop', x, y: y - 8, vx: 0, vy: 0, life: 1.1, text: '$' + v });
    if (x !== undefined) Sound.ui('money');
    if (!G.won && G.money >= GOAL) {
      G.won = true;
      G.banner = { text: 'CITY IS YOURS', sub: 'YOU HIT $' + GOAL + ' - KEEP CRUISING', color: PAL.q, t: 5 };
    }
  },

  toast(text, t = 2.6) { G.toast = { text, t }; },

  // ---------------------------------------------------------- update --
  update(dt) {
    G.t += dt;
    Sound.update(dt);
    if (Input.hit('daynight') && G.state === 'play') this.skipTime();
    if (G.state === 'title') {
      G.cam.cx += 22 * dt; G.cam.cy += 9 * dt;
      if (Input.hit('start') || Input.hit('click')) {
        G.state = 'play'; Clock.init();
        Sound.ui('start');
        this.toast('WAIT FOR A CALL, OR FIND A RINGING PAYPHONE', 4);
      }
      Parts.update(dt);
      return;
    }
    if (Input.hit('volDown') || Input.hit('volUp')) this.toast('VOLUME ' + Sound.step(Input.hit('volUp') ? 1 : -1) + '%', 1.2);
    if (Input.hit('mute')) this.toast(Sound.toggleMute() ? 'SOUND OFF' : 'SOUND ON', 1.2);
    if (Shop.open) { Shop.update(dt); return; }   // the world waits while you shop
    if (Paint.open) { Paint.update(dt); return; }   // and while you pick a colour
    if (Input.hit('pause')) G.paused = !G.paused;
    if (Input.hit('map')) G.showMap = !G.showMap;
    if (G.paused) return;
    Clock.update(dt);

    // cellphone: right click toggles, left clicks on the handset are eaten by it
    if (Input.hit('phone') && !G.player.dead) Phone.toggle();
    const mv = Input.mouseView();
    G.clickUsed = Input.hit('click') && Phone.click(G.cam, mv.x, mv.y);
    G.overPhone = Phone.open && Phone.contains(G.cam, mv.x, mv.y);
    if (Input.mouse.wheel) {
      if (G.overPhone) Phone.wheel(Input.mouse.wheel);
      else Main.zoom(Input.mouse.wheel);
      Input.mouse.wheel = 0;
    }
    Phone.update(dt);

    const p = G.player;
    if (p.dead) {
      G.respawnT -= dt;
      if (G.respawnT <= 0) this.respawn();
    } else if (p.car) this.updateDriving(dt, p);
    else this.updateOnFoot(dt, p);
    if (G.jack) this.updateJack(dt);
    if (!p.dead && !p.car) Shop.check(p);
    if (!p.dead && p.car) Paint.check(p, dt);
    Paint.updateSpray(dt);

    // cars far outside the AOV that nobody drives and that aren't moving sleep (no update, no collisions)
    // (wrecks stay awake so their burn-out timer runs and the AOV can clear them)
    const awake = [];
    for (const c of G.cars) {
      c.asleep = !c.driver && !c.wreck && !c.m.air && c.speed() < 0.5 && !AOV.inKeep(c.x, c.y);
      if (c.asleep) continue;
      awake.push(c);
      c.update(dt, G.jack && G.jack.car === c ? this.jackControls(c) : c.driver === p ? this.carControls() : c.driver && c.driver.ai ? Traffic.controls(c, dt) : null);
    }
    // car vs car through a spatial grid (160 px cells cover the longest reach between two cars);
    // sleeping cars are in the grid so moving cars still hit them, but two sleepers are never tested
    const cell = 160, grid = new Map();
    const test = (a, b) => { if (a.asleep && b.asleep) return; Physics.carVsCar(a, b); pairs++; };
    let pairs = 0;
    for (const c of G.cars) {
      const k = Math.floor(c.x / cell) * 8192 + Math.floor(c.y / cell);
      const b = grid.get(k);
      if (b) b.push(c); else grid.set(k, [c]);
    }
    for (const [k, b] of grid) {
      const gx = Math.floor(k / 8192), gy = k - gx * 8192;
      for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) test(b[i], b[j]);
      // half the neighbours, so each pair of cells is visited once
      for (const [dx, dy] of [[1, -1], [1, 0], [1, 1], [0, 1]]) {
        const o = grid.get((gx + dx) * 8192 + gy + dy);
        if (o) for (const a of b) for (const c of o) test(a, c);
      }
    }
    if (G.perf) { G.perf.cars = G.cars.length; G.perf.updated = awake.length; G.perf.pairs = pairs; G.perf.traffic = G.cars.filter((k) => k.traffic).length; }
    for (const c of awake) {
      if (c.speed() > 0.5 || c.driver) {
        Physics.carVsObstacles(c);
        Physics.carVsWorld(c);
      }
      Physics.carVsBodies(c);
      this.carEffects(c, dt);
    }
    this.updateBullets(dt);
    this.updateProjectiles(dt);
    this.updateFires(dt);
    Peds.update(dt);
    this.updatePickups(dt);
    Parts.update(dt);
    Missions.update(dt);
    AOV.update(dt);
    Train.update(dt);
    Airport.update(dt);
    // factory chimneys smoke
    for (const t of G.city.talls) {
      if (!t.smoke || Math.random() > 0.3) continue;
      if (Math.abs(t.x - G.cam.cx) > G.cam.w || Math.abs(t.y - G.cam.cy) > G.cam.h) continue;
      const ox = (t.x - G.cam.cx) * PARALLAX * t.h, oy = (t.y - G.cam.cy) * PARALLAX * t.h;
      Parts.smoke(t.x + ox, t.y + oy, true);
    }
    for (const s of G.sprays) {
      s.t -= dt;
      const n = s.t > 1 ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 10 + Math.random() * 30;
        Parts.add({ k: 'water', x: s.x, y: s.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, h: 0, vh: 90 + Math.random() * 80, life: 0.9 });
      }
    }
    G.sprays = G.sprays.filter((s) => s.t > 0);
    if (G.flashes) { for (const f of G.flashes) f.t -= dt; G.flashes = G.flashes.filter((f) => f.t > 0); }

    // where am I: neighbourhood toast on change; street shown in the HUD
    const place = City.placeAt ? City.placeAt(p.px, p.py) : { neighborhood: City.regionAt(p.px, p.py).name };
    G.place = place;
    const label = place.neighborhood || place.district || '';
    if (label && label !== G.district) { G.district = label; this.toast(label.toUpperCase()); }
    for (const k of ['banner', 'toast']) if (G[k]) { G[k].t -= dt; if (G[k].t <= 0) G[k] = null; }
    if (G.msg) { G.msg.t += dt; if (G.msg.t > G.msg.life) G.msg = null; }
  },

  carControls() {
    const ctl = { throttle: Input.throttle(), steer: Input.axis('x'), hb: Input.held('fire'), turret: Input.turret(),
      climb: Input.held('fire'), descend: Input.held('descend') };
    if (Input.mouse.active) { const w = this.mouseWorld(); ctl.aim = Math.atan2(w.x - G.player.px, -(w.y - G.player.py)); }
    return ctl;
  },

  mouseWorld() {
    const m = Input.mouseView();
    return { x: G.cam.x + m.x, y: G.cam.y + m.y };
  },

  // O: fast-forward the clock 6 hours
  skipTime() {
    Clock.advance(360, { fast: true });
    Sound.ui('swoosh');
    this.toast('+6H', 1.5);
  },

  wantsShoot() {
    if (G.clickUsed || G.overPhone) return Input.held('fire');
    return Input.held('shoot');
  },

  updateDriving(dt, p) {
    const c = p.car;
    if (G.jack && G.jack.car === c) { c.honking = false; return; }   // being pulled out: no exit, horn or gun
    if (Input.hit('use')) this.exitCar(p);
    if (c.wreck) this.exitCar(p);
    // Horn key (H / pad 10). No siren: honk while held (the tank has no horn). Siren
    // vehicle: a tap released within 0.35 s toggles the siren on release; holding longer
    // honks until release and leaves the siren as it was.
    if (p.car === c) {
      const held = Input.held('horn');
      if (!c.m.siren) c.honking = !!c.m.horn && held;
      else {
        if (Input.hit('horn')) c.hornT = 0;
        if (c.hornT >= 0) {
          if (held) c.hornT += dt;
          else { if (c.hornT < 0.35) c.sirenOn = !c.sirenOn; c.hornT = -1; }
        }
        c.honking = c.hornT >= 0.35;
      }
    }
    if (c.m.tank && this.wantsShoot() && c.reload <= 0) this.fireCannon(c);
  },

  fireCannon(c) {
    c.reload = 1.1;
    c.recoil = 4;
    const a = c.ang + c.turret, fx = Math.sin(a), fy = -Math.cos(a);
    const [px, py] = c.toWorld(0, 2);
    const mx = px + fx * 36, my = py + fy * 36;
    G.bullets.push({ x: mx, y: my, vx: fx * 520 + c.vx, vy: fy * 520 + c.vy, life: 0.9, dmg: 0, shell: true, src: c });
    Parts.add({ k: 'muzzle', big: true, x: mx, y: my, vx: 0, vy: 0, life: 0.08 });
    for (let i = 0; i < 4; i++) Parts.smoke(mx, my, false);
    G.muzzle = { x: mx, y: my, t: 0.1 };
    Sound.play('cannon', mx, my);
    if (G.peds) this.shotAlarm(mx, my, c);
    G.cam.shake = Math.max(G.cam.shake, 4);
    Physics.impulse(c, -fx, -fy, 60 * c.m.mass, mx, my);
  },

  updateOnFoot(dt, p) {
    // knocked down (pulled out of a car), or busy jacking one: no walking, shooting or E
    if (p.downT > 0 || (G.jack && G.jack.by === p)) {
      p.hurtT -= dt; p.cool -= dt; p.shootT -= dt; p.punchT = (p.punchT || 0) - dt;
      if (p.downT > 0) {
        p.downT -= dt; p.moving = false;
        if (p.slideX || p.slideY) {   // the throw out of the door, decaying like a ped's
          Physics.moveWalker(p, p.slideX * dt, p.slideY * dt);
          const k = Math.pow(0.02, dt); p.slideX *= k; p.slideY *= k;
          if (Math.abs(p.slideX) + Math.abs(p.slideY) < 2) p.slideX = p.slideY = 0;
        }
      }
      return;
    }
    let mx = Input.axis('x'), my = Input.axis('y');
    const len = Math.hypot(mx, my);
    p.moving = len > 0.1;
    if (p.moving) {
      if (len > 1) { mx /= len; my /= len; }
      if (!Input.mouse.active) p.ang = Math.atan2(mx, -my);
      Physics.moveWalker(p, mx * 90 * dt, my * 90 * dt);
      p.walkT += dt * Math.min(1, len);
    }
    p.cool -= dt; p.shootT -= dt; p.hurtT -= dt; p.punchT = (p.punchT || 0) - dt;
    const owns = (w) => w === 'fist' || p.ammo[w] > 0;
    if (Input.hit('weapon')) {
      const owned = WEAPON_ORDER.filter(owns);
      this.selectWeapon(p, owned[(owned.indexOf(p.weapon) + 1) % owned.length]);
    }
    // 1..7 pick a slot directly; ignored when that weapon has no ammo
    for (let i = 0; i < WEAPON_ORDER.length; i++) {
      const id = WEAPON_ORDER[i];
      if (Input.hit('slot' + (i + 1)) && owns(id) && id !== p.weapon) this.selectWeapon(p, id);
    }
    if (!owns(p.weapon)) p.weapon = WEAPON_FALLBACK.find(owns) || 'fist';
    const w = WEAPONS[p.weapon];
    if (Input.mouse.active) { const m = this.mouseWorld(); p.ang = Math.atan2(m.x - p.x, -(m.y - p.y)); }
    if (w.cool && this.wantsShoot() && p.cool <= 0) this.shoot(p, w);   // fists: a punch
    if (Input.hit('use')) this.tryEnterCar(p);
  },

  selectWeapon(p, id) {
    p.weapon = id;
    p.cool = Math.max(p.cool, 0.12);   // a beat to bring it up
    Sound.ui('cock');
    this.toast(WEAPONS[id].name, 1.2);
  },

  // the player fires the current weapon once (cooldown and ammo are checked by the caller)
  shoot(p, w) {
    p.cool = w.cool;
    if (w.type === 'fist') { p.punchT = PUNCH_T; this.punch(p, p.ang); return; }
    p.shootT = w.type === 'thrown' ? 0.25 : 0.15;
    p.ammo[p.weapon]--;
    this.fireWeapon(p, p.weapon, p.ang);
  },

  // Shared by the player and armed peds (peds.js fight): the round/pellets/rocket/throw leave the
  // gun tip, with muzzle flash, smoke and sound. No ammo, cooldown or input here. `shooter` is
  // G.player or a ped (both have x, y); every bullet carries it as `src` and never hurts it.
  fireWeapon(shooter, id, ang) {
    const w = WEAPONS[id], pl = shooter === G.player;
    if (!w || !w.type || w.type === 'fist') return;
    const fx0 = Math.sin(ang), fy0 = -Math.cos(ang);
    const mx = shooter.x + fx0 * 9 + Math.cos(ang) * 2.5, my = shooter.y + fy0 * 9 + Math.sin(ang) * 2.5;
    if (w.type === 'thrown') this.throwProjectile(shooter, w, mx, my, ang);
    else if (w.type === 'rocket') {
      G.projectiles.push({ k: 'rocket', x: mx + fx0 * 4, y: my + fy0 * 4, vx: fx0 * w.speed, vy: fy0 * w.speed, ang, life: w.life, w, h: 0, src: shooter });
      // back-blast out of the tube
      for (let i = 0; i < 5; i++) Parts.add({ k: 'smoke', x: shooter.x - fx0 * 10, y: shooter.y - fy0 * 10, vx: -fx0 * (40 + Math.random() * 60) + (Math.random() - 0.5) * 30, vy: -fy0 * (40 + Math.random() * 60) + (Math.random() - 0.5) * 30, life: 0.8 + Math.random() * 0.4 });
      Parts.add({ k: 'muzzle', big: true, x: mx + fx0 * 3, y: my + fy0 * 3, vx: 0, vy: 0, life: 0.07 });
      G.muzzle = { x: mx, y: my, t: 0.1 };
    } else {
      const n = w.pellets || 1;
      for (let i = 0; i < n; i++) {
        // pellets fan evenly across the spread with a little jitter; single rounds are random
        const off = n > 1 ? ((i + 0.5) / n - 0.5) * 2 * w.spread + (Math.random() - 0.5) * w.spread * 0.35 : (Math.random() - 0.5) * w.spread * 2;
        const a = ang + off, fx = Math.sin(a), fy = -Math.cos(a), sp = w.speed * (n > 1 ? 0.9 + Math.random() * 0.2 : 1);
        // fresh: the gun tip is 9 px out, so the first tick also sweeps the barrel (point-blank hits)
        G.bullets.push({ x: mx, y: my, vx: fx * sp, vy: fy * sp, life: w.life * (n > 1 ? 0.85 + Math.random() * 0.3 : 1), dmg: w.dmg, push: w.push || 0, src: shooter, fresh: true, sx: shooter.x, sy: shooter.y });
      }
      Parts.add({ k: 'muzzle', big: n > 1, x: mx + fx0 * 2, y: my + fy0 * 2, vx: 0, vy: 0, life: n > 1 ? 0.07 : 0.05 });
      if (n > 1) { for (let i = 0; i < 2; i++) Parts.smoke(mx + fx0 * 4, my + fy0 * 4, false); Physics.moveWalker(shooter, -fx0 * 2, -fy0 * 2); }
      G.muzzle = { x: mx, y: my, t: n > 1 ? 0.09 : 0.06 };
    }
    if (pl && w.shake) G.cam.shake = Math.max(G.cam.shake, w.shake);
    // guns, bazooka launch, grenade pin + throw, molotov throw; a ped's gun never clicks empty
    Sound.shot(id, mx, my, pl ? G.player.ammo[id] : 99);
    // a gunshot scares the street (thrown things alarm when they go off); the Uzi throttles to 0.3 s
    if (w.type !== 'thrown' && typeof Peds !== 'undefined' && G.peds && !(G.t < (shooter.alarmAt || -9))) {
      shooter.alarmAt = G.t + 0.3;
      this.shotAlarm(mx, my, shooter);
    }
  },

  // people hear a gunshot after a human reaction time, so the target doesn't dodge the round in flight
  shotAlarm(x, y, src) { (G.shotAlarms || (G.shotAlarms = [])).push({ x, y, src, t: G.t + SHOT_REACT }); },

  // A punch (spec peds-v1 §2.2), shared by the player and peds. `attacker` is G.player (on foot) or
  // a ped; it lands on the nearest body in a short cone in front (peds, cows, the player; never the
  // attacker), else on a car the attacker touches. The caller sets its own cooldown/animation.
  punch(attacker, ang) {
    const pl = G.player, isPl = attacker === pl, W = WEAPONS.fist;
    const reach = isPl ? W.reach : PED.FIST.reach, dmg = isPl ? W.dmg : PED.FIST.dmg, carDmg = isPl ? W.car : PED.FIST.car;
    const ax = attacker.x, ay = attacker.y, fx = Math.sin(ang), fy = -Math.cos(ang);
    const inCone = (x, y, r) => {
      const dx = x - ax, dy = y - ay, d = Math.hypot(dx, dy);
      if (d - r > reach) return -1;
      if (d < r + 2) return d;   // overlapping: always in reach
      const c = (dx * fx + dy * fy) / d;   // cos of the angle off the facing
      return c >= Math.cos(W.arc) ? d : -1;
    };
    let best = null, bd = 1e9, kind = null;
    if (G.peds) {
      for (const p of Peds.near(ax + fx * reach * 0.5, ay + fy * reach * 0.5, reach + PED.COW_R + 4)) {
        if (p === attacker) continue;
        const d = inCone(p.x, p.y, p.kind === 'cow' ? PED.COW_R : PED.R);
        if (d >= 0 && d < bd) { best = p; bd = d; kind = 'body'; }
      }
    }
    if (!isPl && !pl.dead && !pl.car) {
      const d = inCone(pl.x, pl.y, 4);
      if (d >= 0 && d < bd) { best = pl; bd = d; kind = 'player'; }
    }
    if (!best) {   // no body in reach: a car the fist touches (the player's own car when a ped attacks it)
      const tx = ax + fx * reach, ty = ay + fy * reach;
      for (const c of G.cars) {
        if (c.alt > 4 || Math.abs(c.x - ax) > c.len + reach || Math.abs(c.y - ay) > c.len + reach) continue;
        const onFoe = !isPl && attacker.foe === pl && c === pl.car && c.contains(ax, ay, reach + 2);
        if (onFoe || c.contains(tx, ty, 3) || c.contains(ax + fx * reach * 0.5, ay + fy * reach * 0.5, 3)) { best = c; kind = 'car'; break; }
      }
    }
    if (!best) Sound.play('whiff', ax, ay);
    if (!best) return false;   // a whiff
    const hx = kind === 'car' ? ax + fx * (reach - 3) : (ax + best.x) / 2, hy = kind === 'car' ? ay + fy * (reach - 3) : (ay + best.y) / 2;
    Sound.punch(kind, hx, hy, best);
    if (kind === 'body') {
      Peds.hurt(best, dmg, { kind: 'punch', src: attacker, vx: fx * W.push, vy: fy * W.push });
    } else if (kind === 'player') {
      this.hurtPlayer(dmg);
      Physics.moveWalker(pl, fx * 3, fy * 3);
      G.cam.shake = Math.max(G.cam.shake, 1.5);
    } else {
      if (!best.m.tank) this.damageCar(best, carDmg, attacker);   // small arms: the tank's armour shrugs it off
      Parts.sparks(hx, hy, 1, PAL.l);
    }
    Parts.add({ k: 'spark', x: hx, y: hy, vx: fx * 20, vy: fy * 20, life: 0.1, color: PAL.x });
    if (isPl) {
      G.cam.shake = Math.max(G.cam.shake, W.shake);
      Peds.alarm(hx, hy, PED.ALARM.punch, 'punch', pl, kind === 'body' ? best : null);
    }
    return true;
  },

  // grenade / molotov: lob toward the crosshair (or straight ahead without a mouse; a ped: its foe)
  throwProjectile(p, w, x, y, a = p.ang) {
    let d = 110;
    if (p === G.player && Input.mouse.active) { const m = this.mouseWorld(); d = dist(p.x, p.y, m.x, m.y); }
    else if (p.foe) { const f = p.foe === G.player ? { x: G.player.px, y: G.player.py } : p.foe; d = dist(p.x, p.y, f.x, f.y); }
    if (p.throwAt) d = p.throwAt;   // #demo
    d = clamp(d, 24, w.range);
    const T = 0.32 + d / 420;          // time in the air to the aim point
    const sp = d / T, g = 520;
    G.projectiles.push({ k: w.proj, w, x, y, h: 8, vx: Math.sin(a) * sp, vy: -Math.cos(a) * sp, vh: g * T / 2 - 8 / T, g,
      fuse: w.fuse || 0, spin: a, vspin: (Math.random() < 0.5 ? -1 : 1) * (9 + Math.random() * 5), bounces: 0, src: p });
  },

  // rockets, grenades and molotov bottles
  updateProjectiles(dt) {
    // cars (and wrecks) are ~14 px tall: a lob passes over them, a flying helicopter is out of reach
    const hitCar = (x, y, h) => G.cars.find((c) => c !== G.player.car && Math.abs((c.alt || 0) - h) < 14 && c.contains(x, y, 1));
    for (const q of G.projectiles) {
      if (q.dead) continue;
      if (q.k === 'rocket') {
        const steps = 4, ox = q.x, oy = q.y;
        for (let s = 0; s < steps; s++) {
          const px = q.x, py = q.y;
          q.x += (q.vx * dt) / steps; q.y += (q.vy * dt) / steps;
          if (Physics.buildingAt(q.x, q.y)) { this.rocketBlast(q, px, py, null); break; }
          const c = hitCar(q.x, q.y, 0);
          if (c) { this.rocketBlast(q, px, py, c); break; }
          if (G.peds && this.pedGrid().near(q.x, q.y, 0).some((b) => !b.dead && !b.gone && b !== q.src && dist(b.x, b.y, q.x, q.y) < (b.kind === 'cow' ? BULLET_R.cow : BULLET_R.ped) + 2)) { this.rocketBlast(q, q.x, q.y, null); break; }   // a body: goes off on it
        }
        if (q.dead) continue;
        q.life -= dt;
        // exhaust: a spark of flame and a puff of light smoke trailing behind
        const bx = q.x - Math.sin(q.ang) * 7, by = q.y + Math.cos(q.ang) * 7;
        Parts.add({ k: 'spark', x: bx, y: by, vx: -q.vx * 0.15 + (Math.random() - 0.5) * 30, vy: -q.vy * 0.15 + (Math.random() - 0.5) * 30, life: 0.12, color: Math.random() < 0.5 ? PAL.j : PAL.O });
        Parts.add({ k: 'smoke', x: (ox + bx) / 2 + (Math.random() - 0.5) * 2, y: (oy + by) / 2 + (Math.random() - 0.5) * 2, vx: (Math.random() - 0.5) * 8, vy: -4 - Math.random() * 6, life: 0.6 + Math.random() * 0.3 });
        if (q.life <= 0) this.rocketBlast(q, q.x, q.y, null);
        continue;
      }
      // thrown: ground position + fake height, gravity on the height
      q.spin += q.vspin * dt;
      if (q.fuse) { q.fuse -= dt; if (q.fuse <= 0) { this.grenadeBlast(q); continue; } }
      const steps = 3;
      for (let s = 0; s < steps && !q.dead; s++) {
        const sdt = dt / steps;
        const nx = q.x + q.vx * sdt, ny = q.y + q.vy * sdt;
        // walls: reflect the axis that hit (thrown things never clear a building)
        const wx = Physics.buildingAt(nx, q.y), wy = Physics.buildingAt(q.x, ny);
        if (wx || wy) {
          if (q.k === 'molotov') { this.shatter(q, q.x, q.y); break; }
          const hit = Math.hypot(wx ? q.vx : 0, wy ? q.vy : 0);
          if (wx) q.vx *= -0.5;
          if (wy) q.vy *= -0.5;
          this.bounced(q, hit);
          continue;
        }
        const c = hitCar(nx, ny, q.h);
        if (c) {
          if (q.k === 'molotov') { this.shatter(q, q.x, q.y); break; }
          // bounce off the hull: reflect about the normal from the nearest point on the car's axis
          const along = clamp(c.toLocal(q.x, q.y)[1], -c.len / 2 + c.hw, c.len / 2 - c.hw);
          const [ax, ay] = c.toWorld(0, along);
          const el = Math.hypot(q.x - ax, q.y - ay) || 1, ex = (q.x - ax) / el, ey = (q.y - ay) / el;
          const vn = q.vx * ex + q.vy * ey;
          if (vn < -30) { q.vx -= 1.5 * vn * ex; q.vy -= 1.5 * vn * ey; q.vx *= 0.6; q.vy *= 0.6; this.bounced(q, -vn); }
          else { q.vx = 0; q.vy = 0; q.x += ex; q.y += ey; }   // slow or resting against the hull: settle, shoved out if the car moves onto it
          continue;
        }
        // low street furniture (lamps, trees, bins) deflects a low grenade
        if (q.h < 10) {
          for (const o of G.obstacleGrid.near(nx, ny)) {
            const dx = nx - o.x, dy = ny - o.y, d = Math.hypot(dx, dy);
            if (d >= o.r + 2 || d === 0) continue;
            if (q.k === 'molotov') { this.shatter(q, q.x, q.y); break; }
            const ex = dx / d, ey = dy / d, vn = q.vx * ex + q.vy * ey;
            if (vn < 0) { q.vx -= 1.5 * vn * ex; q.vy -= 1.5 * vn * ey; }
            this.bounced(q, -vn);
            break;
          }
          if (q.dead) break;
        }
        q.x = nx; q.y = ny;
        q.vh -= q.g * sdt; q.h += q.vh * sdt;
        if (q.h <= 0) {
          q.h = 0;
          if (this.waterAt(q.x, q.y)) { this.sink(q); break; }
          if (q.k === 'molotov') { this.shatter(q, q.x, q.y); break; }
          if (q.vh < -60) { const hit = -q.vh; q.vh *= -0.35; q.vx *= 0.55; q.vy *= 0.55; this.bounced(q, hit); }
          else { q.vh = 0; const f = Math.exp(-6 * sdt); q.vx *= f; q.vy *= f; q.vspin *= f; }   // rolling to a stop
        }
      }
    }
    G.projectiles = G.projectiles.filter((q) => !q.dead);
  },

  waterAt(x, y) {
    const c = G.city, tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return tx < 0 || ty < 0 || tx >= c.W || ty >= c.H || c.kind[ty * c.W + tx] === KIND.WATER;
  },
  // `hit` = impact speed into the surface (px/s); resting contact and jitter below 30 don't count
  bounced(q, hit) {
    if (!(hit > 30)) return;
    q.bounces++;
    if (hit > 60) Parts.sparks(q.x, q.y - q.h, 2, PAL.l);
    Sound.play('tink', q.x, q.y, { v: Math.hypot(q.vx, q.vy) });
  },
  sink(q) {
    q.dead = true;
    Sound.play('plop', q.x, q.y);
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, v = 10 + Math.random() * 25;
      Parts.add({ k: 'water', x: q.x, y: q.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, h: 0, vh: 60 + Math.random() * 60, life: 0.7 });
    }
  },

  // a rocket goes off at (x, y); `car` is the vehicle it struck, which also takes the direct hit
  rocketBlast(q, x, y, car) {
    q.dead = true;
    const w = q.w;
    if (car) this.damageCar(car, w.direct * (car.m.tank ? 0.35 : 1), q.src);   // explosive: tank armour applies
    this.explode(x, y, 1, w.blast, q.src);
  },
  grenadeBlast(q) {
    q.dead = true;
    if (this.waterAt(q.x, q.y)) return this.sink(q);
    this.explode(q.x, q.y, 1, q.w.blast, q.src);
  },
  // molotov bottle breaks: glass, a whoomp of flame, and a fire patch
  shatter(q, x, y) {
    q.dead = true;
    if (this.waterAt(x, y)) return this.sink(q);
    const F = q.w.fire;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, s = 30 + Math.random() * 70;
      Parts.add({ k: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.2, color: Math.random() < 0.5 ? PAL.v : PAL.c });
    }
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * F.r * 0.7;
      Parts.add({ k: 'fire', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: 0, vy: -12, life: 0.45 + Math.random() * 0.3 });
    }
    Render.scorch(x, y, Math.random, F.r * 0.8);
    G.fires.push({ x, y, r: F.r, t: F.t, life: F.t, w: q.w, src: q.src });
    G.flashes = (G.flashes || []).concat([{ x, y, t: 0.3 }]);
    G.cam.shake = Math.max(G.cam.shake, 1.5);
    Sound.play('shatter', x, y);
  },

  // fire patches: flames, burning cars, a hurt player
  updateFires(dt) {
    const p = G.player;
    for (const f of G.fires) {
      f.t -= dt;
      const F = f.w.fire, k = clamp(f.t / 1.2, 0, 1);   // dies down over the last 1.2 s
      if (Math.random() < 22 * dt * (0.3 + 0.7 * k)) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * f.r * 0.85;
        Parts.add({ k: 'fire', x: f.x + Math.cos(a) * d, y: f.y + Math.sin(a) * d * 0.8, vx: 0, vy: -10, life: 0.3 + Math.random() * 0.2 });
      }
      if (Math.random() < 3 * dt) Parts.smoke(f.x + (Math.random() - 0.5) * f.r, f.y + (Math.random() - 0.5) * f.r, true);
      for (const c of G.cars) {
        if (c.wreck || (c.alt || 0) > 4 || !c.contains(f.x, f.y, f.r * 0.8)) continue;
        // heat is dealt in 0.5 s pulses so the hit flash doesn't stay on
        c.heat = (c.heat || 0) + F.car * dt * (c.m.tank ? 0.35 : 1);
        c.fireT = (c.fireT || 0) + dt;
        if (c.fireT % 0.5 < dt) { this.damageCar(c, c.heat, f.src || G.player); c.heat = 0; }
        if (c.fireT > F.ignite && !c.m.tank) c.burning = true;   // the tank's armour doesn't catch
      }
      if (!p.dead && !p.car && dist(p.x, p.y, f.x, f.y) < f.r * 0.85 + 3) this.hurtPlayer(F.player * dt);
      // peds catch fire on the first touch (peds.js runs the burning); cows only get hurt.
      // Like cars, the damage lands in 0.5 s pulses so the hit flash and reactions don't repeat every tick
      if (G.peds) for (const b of Peds.near(f.x, f.y, f.r * 0.85 + PED.COW_R)) {
        if (dist(b.x, b.y, f.x, f.y) > f.r * 0.85 + (b.kind === 'cow' ? PED.COW_R : PED.R)) continue;
        b.heat = (b.heat || 0) + F.player * dt;
        if ((b.kind === 'ped' && !b.burning) || !(G.t - (b.heatAt || -9) < 0.5)) {
          Peds.hurt(b, b.heat, { kind: 'fire', src: f.src || G.player });
          b.heat = 0; b.heatAt = G.t;
        }
      }
    }
    G.fires = G.fires.filter((f) => f.t > 0);
  },

  // under the cars: a glowing bed of embers where a fire patch burns
  drawFires(ctx, cam) {
    for (const f of G.fires) {
      if (f.x < cam.x - 40 || f.x > cam.x + cam.w + 40 || f.y < cam.y - 40 || f.y > cam.y + cam.h + 40) continue;
      const k = clamp(f.t / 1.2, 0, 1);
      for (let i = 0; i < 14 * k; i++) {
        const a = i * 2.39996 + Math.floor(G.t * 8 + i) * 0.7, d = ((i * 7919) % 97) / 97 * f.r * 0.8;
        ctx.fillStyle = (i + Math.floor(G.t * 10)) % 3 ? PAL.O : PAL.j;
        ctx.fillRect(Math.round(f.x + Math.cos(a) * d - cam.x), Math.round(f.y + Math.sin(a) * d * 0.8 - cam.y), 2, 1);
      }
    }
  },

  // rockets, grenades and bottles in flight (with a ground shadow for the thrown ones)
  drawProjectiles(ctx, cam) {
    for (const q of G.projectiles) {
      const x = q.x - cam.x, y = q.y - cam.y;
      if (x < -20 || y < -40 || x > cam.w + 20 || y > cam.h + 20) continue;
      const tag = q.k === 'rocket' ? 'rocket' : q.k === 'grenade' ? 'grenade_proj' : 'molotov_proj';
      const ang = q.k === 'rocket' ? q.ang : q.spin;
      if (q.k !== 'rocket') { ctx.fillStyle = 'rgba(18,20,46,0.35)'; ctx.fillRect(Math.round(x) - 2, Math.round(y) - 1, 4, 2); }
      if (hasSprite('props', tag)) {
        const f = Assets.frame('props', tag, q.k === 'molotov' ? Math.floor(G.t * 10) : 0);
        if (q.k === 'rocket') {
          ctx.globalAlpha = 0.3;
          Assets.drawRot(ctx, 'props', f, x + 3, y + 5, ang, Assets.tinted('props', '#12142e'));
          ctx.globalAlpha = 1;
        }
        Assets.drawRot(ctx, 'props', f, x, y - q.h, ang);
      } else {   // sprite not in the atlas yet: a plain marker so nothing throws
        ctx.fillStyle = q.k === 'rocket' ? PAL.d : q.k === 'grenade' ? PAL.h : PAL.O;
        ctx.fillRect(Math.round(x) - 1, Math.round(y - q.h) - 1, 3, 3);
      }
    }
  },

  weaponLights(L) {
    for (const q of G.projectiles) {
      if (q.k === 'rocket') L.push({ x: q.x, y: q.y, r: 34, color: 'rgba(255,190,110,0.8)' });
      else if (q.k === 'molotov') L.push({ x: q.x, y: q.y - q.h, r: 16, color: 'rgba(255,150,70,0.6)' });
    }
    for (const f of G.fires) L.push({ x: f.x, y: f.y, r: f.r * 2.4, color: `rgba(255,130,50,${0.8 * clamp(f.t / 1.2, 0, 1)})` });
  },

  // Rounds move in 6 sub-steps (no tunnelling through thin walls or a ped). `src` is the shooter:
  // it's never hit, and the player's rounds (or their tank's shells) never hit the player or the
  // car they drive. A ped's rounds hit the player (on foot) or the player's car, and other peds.
  updateBullets(dt) {
    const pl = G.player;
    for (const b of G.bullets) {
      const steps = 6;
      const ox = b.x, oy = b.y;
      const mine = b.src === pl || (b.src && b.src.driver === pl);
      // bodies near this tick's path (a round covers < 10 px per tick; the grid query spans a cell around it)
      const bodies = G.peds ? this.pedGrid().near(b.x, b.y, 0).filter((p) => !p.dead && !p.gone && p !== b.src) : [];
      if (b.fresh) {   // point blank: sweep the barrel from the shooter's centre to the muzzle first
        b.fresh = false;
        for (const t of [0.35, 0.7]) if (this.bulletHits(b, bodies, lerp(b.sx, b.x, t), lerp(b.sy, b.y, t), mine)) break;
      }
      for (let s = 0; s < steps && b.life > 0; s++) {
        b.x += (b.vx * dt) / steps; b.y += (b.vy * dt) / steps;
        if (Physics.buildingAt(b.x, b.y)) {
          if (!b.shell) { Sound.play('ricochet', b.x, b.y); Parts.sparks(b.x, b.y, 4); }
          b.life = 0; b.hit = true; break;
        }
        if (this.bulletHits(b, bodies, b.x, b.y, mine)) break;
        for (const c of G.cars) {
          const L = c.len / 2 + 1;   // cheap box test first: 140+ cars x 6 sub-steps per round
          if (Math.abs(c.x - b.x) > L || Math.abs(c.y - b.y) > L || c === b.src || (mine && c === pl.car) || !c.contains(b.x, b.y)) continue;
          if (!c.m.tank) this.damageCar(c, b.dmg, b.src);
          if (b.push) { const v = Math.hypot(b.vx, b.vy); Physics.impulse(c, b.vx / v, b.vy / v, b.push, b.x, b.y); }   // shotgun shove
          if (!b.shell) Parts.sparks(b.x, b.y, c.m.tank ? 5 : 3, c.m.tank ? PAL.j : PAL.l);
          if (!b.shell) Sound.play(c.m.tank ? 'clang' : 'ping', b.x, b.y);
          b.life = 0; b.hit = true;
          break;
        }
      }
      Parts.add({ k: 'tracer', x: ox, y: oy, x2: b.x, y2: b.y, vx: 0, vy: 0, life: b.shell ? 0.12 : 0.06, w: b.shell ? 2 : 1 });
      b.life -= dt;
      if (b.shell && b.life <= 0) this.explode(b.x, b.y, 1, null, b.src);
    }
    G.bullets = G.bullets.filter((b) => b.life > 0);
    if (G.shotAlarms && G.shotAlarms.length && G.peds) {
      for (const a of G.shotAlarms) if (a.t <= G.t) Peds.alarm(a.x, a.y, PED.ALARM.shot, 'shot', a.src);
      G.shotAlarms = G.shotAlarms.filter((a) => a.t > G.t);
    }
    if (G.muzzle) { G.muzzle.t -= dt; if (G.muzzle.t <= 0) G.muzzle = null; }
  },

  // G.pedGrid, rebuilt if a ped spawned since the last Peds.update (Peds.near does that)
  pedGrid() { if (Peds.dirty) Peds.near(0, 0, 0); return G.pedGrid; },

  // does round b at (x, y) strike a ped, a cow or (a ped's round) the player on foot? Stops it if so.
  bulletHits(b, bodies, x, y, mine) {
    for (const p of bodies) {
      const r = p.kind === 'cow' ? BULLET_R.cow : BULLET_R.ped;
      if (Math.abs(p.x - x) > r || Math.abs(p.y - y) > r || dist(p.x, p.y, x, y) > r || p.dead) continue;
      b.x = x; b.y = y; b.life = 0; b.hit = true;
      if (b.shell) return true;   // a tank shell goes off on the body (explode does the harm)
      const k = b.push ? BULLET_PUSH.pellet : BULLET_PUSH.round;
      Sound.play('thwack', x, y, p.kind === 'cow' ? { cow: true } : undefined);
      Peds.hurt(p, b.dmg, { kind: 'bullet', src: b.src, vx: b.vx * k, vy: b.vy * k });
      return true;
    }
    const pl = G.player;
    if (!mine && !pl.dead && !pl.car && Math.abs(pl.x - x) < BULLET_R.player && Math.abs(pl.y - y) < BULLET_R.player && dist(pl.x, pl.y, x, y) < BULLET_R.player) {
      b.x = x; b.y = y; b.life = 0; b.hit = true;
      Sound.play('thwack', x, y, { player: true });
      this.hurtPlayer(b.dmg);
      const v = Math.hypot(b.vx, b.vy) || 1;
      if (Render.bloodSplat && Math.random() < 0.5) Render.bloodSplat(x, y, b.vx / v, b.vy / v);
      G.cam.shake = Math.max(G.cam.shake, 1.2);
      return true;
    }
    return false;
  },

  carEffects(c, dt) {
    if (c.skid && c.speed() > 30) {
      const ry = -c.len / 2 + Math.min(12, c.len * 0.2);
      const w1 = c.toWorld(-c.hw + 3, ry), w2 = c.toWorld(c.hw - 3, ry);
      const prev = c.wheelPrev;
      for (const [cur, old] of [[w1, prev && prev[0]], [w2, prev && prev[1]]]) {
        if (old && dist(old[0], old[1], cur[0], cur[1]) < 12) {
          const n = Math.ceil(dist(old[0], old[1], cur[0], cur[1]));
          for (let i = 1; i <= n; i++) Render.skid(lerp(old[0], cur[0], i / n), lerp(old[1], cur[1], i / n));
        } else Render.skid(cur[0], cur[1]);
      }
      c.wheelPrev = [w1, w2];
      if (c.slip > 140 && Math.random() < 0.5) Parts.tire(w1[0], w1[1]);
      if (c.slip > 140 && Math.random() < 0.5) Parts.tire(w2[0], w2[1]);
    } else c.wheelPrev = null;

    // red tyre prints after running over a body (Physics.carVsBodies sets bloodT), fading out
    if (c.bloodT > 0) {
      c.bloodT -= dt;
      const a = clamp(c.bloodT / Physics.BODY.PRINT_T, 0, 1), ry = -c.len / 2 + Math.min(12, c.len * 0.2);
      const w = [c.toWorld(-c.hw + 3, ry), c.toWorld(c.hw - 3, ry)], prev = c.bloodPrev;
      for (let k = 0; k < 2; k++) {
        const cur = w[k], old = prev && prev[k], d = old ? dist(old[0], old[1], cur[0], cur[1]) : 0;
        if (old && d < 1.5) w[k] = old;   // barely moved: keep the last print point
        else if (old && d < 24) { const n = Math.floor(d / 1.5); for (let i = 1; i <= n; i++) Render.bloodPrint(lerp(old[0], cur[0], i / n), lerp(old[1], cur[1], i / n), a); }
        else Render.bloodPrint(cur[0], cur[1], a);
      }
      c.bloodPrev = w;
    } else c.bloodPrev = null;
    // a car tearing along the sidewalk scares people off it
    c.walkAlarmT = (c.walkAlarmT || 0) - dt;
    if (c.walkAlarmT <= 0 && !c.alt && c.speed() > 60) {
      const cc = G.city, tx = Math.floor(c.x / TILE), ty = Math.floor(c.y / TILE), kd = cc.kind[ty * cc.W + tx];
      if (kd === KIND.WALK || kd === KIND.PLAZA) { Peds.alarm(c.x, c.y, PED.ALARM.crash, 'crash', c); c.walkAlarmT = 0.5; }
    }

    c.smokeT -= dt;
    const hood = c.toWorld(0, c.len / 2 - 10);
    if (!c.wreck) {
      if (c.hp < c.m.hp * 0.5 && Math.random() < (1 - c.hp / c.m.hp) * 0.35) Parts.smoke(hood[0], hood[1], c.hp < c.m.hp * 0.3);
      if (c.burning && Math.random() < 0.6) {
        Parts.add({ k: 'fire', x: hood[0] + (Math.random() - 0.5) * 6, y: hood[1] + (Math.random() - 0.5) * 6, vx: 0, vy: -10, life: 0.35 });
      }
    } else if (c.smokeT > 0 && Math.random() < 0.25) Parts.smoke(c.x, c.y, true);
  },

  // E on foot: the nearest free car in reach, unless a slow traffic car is nearer (then jack it)
  tryEnterCar(p) {
    if (G.jack || p.downT > 0) return;
    let best = null, bd = 1e9, jack = null, jd = 1e9, fast = false;
    for (const c of G.cars) {
      if (c.wreck || c.gone || c.alt > 2) continue;   // not a helicopter on a roof or in the air
      if (!c.contains(p.x, p.y, JACK.REACH)) continue;
      const d = dist(p.x, p.y, c.x, c.y);
      if (!c.driver) { if (d < bd) { best = c; bd = d; } }
      else if (this.jackable(c)) {
        if (c.speed() < JACK.MAX_V) { if (d < jd) { jack = c; jd = d; } }
        else fast = true;
      }
    }
    if (best && (!jack || bd <= jd)) { this.seat(p, best); return; }
    if (jack) { if (!this.jack(jack, p)) this.toast('DOOR BLOCKED', 1.2); return; }
    if (fast && !(G.t < this.fastToastT)) { this.toast('TOO FAST', 1.2); this.fastToastT = G.t + JACK.FAST_TOAST; }
  },

  // the player takes the wheel of car c (a free car, or one they just jacked)
  seat(p, c) {
    p.car = c;
    c.driver = p;
    c.traffic = false; AOV.release(c);
    Sound.door(c, true);
    this.toast(c.m.name);
    this.gangStolen(c);
    Missions.onEnterCar(c);
  },

  // ---------------------------------------------------------- carjack --
  // spec docs/specs/carjack-v1.md: an AI traffic car (not aircraft, trains or the tank)
  jackable(c) {
    return !!(c.traffic && c.driver && c.driver.ai && !c.wreck && !c.m.air && !c.m.tank && !(c.alt > 2));
  },

  // the point just outside the driver's door (left side: right-hand traffic), or the other side
  // if that's blocked. side: -1 left, +1 right (forces that side). Trucks and buses sit up front.
  driverDoor(car, side) {
    const lf = car.len >= 80 ? car.len / 2 - 16 : car.len * 0.08;
    const at = (s) => {
      const [x, y] = car.toWorld(s * (car.hw + JACK.DOOR_OUT), lf), [x2, y2] = car.toWorld(s * (car.hw + JACK.DOOR_OUT + 4), lf);
      const blocked = !!(Physics.solidAt(x, y) || Physics.solidAt(x2, y2) ||
        G.cars.some((o) => o !== car && !o.gone && !(o.alt > 8) && o.contains(x, y, 3)));
      return { x, y, nx: s * -car.fy, ny: s * car.fx, side: s, lf, blocked };
    };
    if (side) return at(side);
    const L = at(-1);
    if (!L.blocked) return L;
    const R = at(1);
    return R.blocked ? L : R;
  },

  // start a jack: by = G.player (steal an AI car) or a ped (take it back from the player)
  jack(car, by) {
    const p = G.player;
    if (G.jack || !car || car.wreck || car.gone || car.m.air || car.m.tank || car.alt > 2 || p.dead) return false;
    if (by === p) {
      if (p.car || p.downT > 0 || !this.jackable(car) || car.speed() >= JACK.MAX_V || !car.contains(p.x, p.y, JACK.REACH)) return false;
    } else {
      if (!by || by.dead || by.gone || p.car !== car || car.speed() >= JACK.BACK_V) return false;
    }
    const door = this.driverDoor(car);
    if (door.blocked) return false;
    if (by !== p && dist(by.x, by.y, door.x, door.y) > 16) return false;
    G.jack = { car, by, t: 0, phase: 'grab', side: door.side, hp0: by.hp, yankT: -1 };
    if (by === p) { car.driver.why = 'jack'; car.honking = false; }   // traffic behind reads 'jack' as a blocker (B4 honk)
    else { car.honking = false; car.hornT = -1; }
    Sound.jack(car, 'grab', by);
    return true;
  },

  // the car under a jack: brake to a stop, nothing else
  jackControls(c) {
    const vf = c.vf();
    return { throttle: vf > 10 ? -1 : vf < -10 ? 1 : 0, steer: 0, hb: false };
  },

  updateJack(dt) {
    const J = G.jack, c = J.car, p = G.player, by = J.by, mine = by === p;
    J.t += dt;
    const hurt = mine ? p.hp < J.hp0 : by.dead || by.gone || by.hp < J.hp0;
    const seatOk = J.phase !== 'grab' || (mine ? !p.car && c.driver && c.driver.ai : p.car === c);
    if (hurt || !seatOk || p.dead || c.wreck || c.gone || c.speed() > JACK.CANCEL_V || (J.phase === 'grab' && J.t > JACK.GIVE_UP)) {
      G.jack = null;   // cancelled: before the yank nothing changed; after it the car is left empty
      return;
    }
    const door = this.driverDoor(c, J.side);
    if (J.phase === 'grab') {
      // step to the door, round the nearest end of the car if we're on the wrong side
      const [lx, lf] = c.toLocal(by.x, by.y), end = c.len / 2 + 8;
      let tx = J.side * (c.hw + JACK.DOOR_OUT), tf = door.lf;
      if (!(lx * J.side > 0 && Math.abs(lx) > c.hw - 2)) {
        const e = lf >= 0 ? end : -end;
        if (Math.abs(lf) < end - 1) { tx = lx; tf = e; } else { tx = J.side * (c.hw + JACK.DOOR_OUT); tf = e; }
      }
      const [wx, wy] = c.toWorld(tx, tf), d = dist(by.x, by.y, wx, wy), s = Math.min(d, JACK.STEP_V * dt);
      if (d > 0.01) Physics.moveWalker(by, ((wx - by.x) / d) * s, ((wy - by.y) / d) * s);
      if (mine) { p.moving = d > 0.5; if (p.moving) p.walkT += dt; }
      by.ang = Math.atan2(-door.nx, door.ny);   // face the car
      if (J.t >= JACK.YANK && dist(by.x, by.y, door.x, door.y) < 2) this.yank(J, door);
      return;
    }
    if (J.t >= J.yankT + JACK.IN) {
      G.jack = null;
      if (mine) this.seat(p, c);
      else if (p.car !== c && !c.driver) { Traffic.takeOver(c, by); Sound.jack(c, 'off'); }
    }
  },

  // the driver comes out of the door: an AI driver becomes a ped, the player lands on the ground
  yank(J, door) {
    const c = J.car, p = G.player, fx = c.fx, fy = c.fy;
    J.phase = 'yank'; J.yankT = J.t;
    J.by.punchT = 0.2;   // the tug (player: punch frame; ped: its punch frame)
    const ang = Math.atan2(door.nx, -door.ny);   // facing away from the car
    if (J.by === p) {
      p.moving = false;
      let ped = null;
      // a gang car's driver is a mob member: out as that mob's, fighting (not a scared civilian)
      const o = c.gang ? { byPlayer: true, gang: c.gang, mood: 'violent' } : { byPlayer: true };
      if (typeof Peds.driverOut === 'function') ped = Peds.driverOut(c, door.x + fx * 7, door.y + fy * 7, ang, o);
      // a gang car's passenger jumps out the other door, fighting at once (G7)
      let mate = null;
      if (c.gang && !c.crewOut && typeof Peds.driverOut === 'function') {
        const s = this.crewSpot(c, -door.side);
        mate = Peds.driverOut(c, s.x, s.y, s.ang, { gang: c.gang, byPlayer: true, bail: true });
        if (mate) Physics.moveWalker(mate, 0, 0);
        Sound.bail(c, [mate]);
      }
      if (c.gang) c.crew = [ped, mate].filter(Boolean);
      this.gangStolen(c);
      if (ped) {
        ped.vx = door.nx * JACK.THROW_V + fx * 12; ped.vy = door.ny * JACK.THROW_V + fy * 12;
        if (ped.look != null) c.driverLook = ped.look;
      }
      Sound.jack(c, 'steal', ped);
      c.driver = null; c.traffic = false; AOV.release(c);
      c.honking = false;
    } else {
      p.car = null; c.driver = null;
      c.sirenOn = false; c.honking = false; c.hornT = -1;
      p.x = door.x - fx * 7; p.y = door.y - fy * 7; p.ang = ang;
      Physics.moveWalker(p, 0, 0);   // out of any car overlap
      p.downT = JACK.DOWN_T; p.slideX = door.nx * JACK.THROW_V; p.slideY = door.ny * JACK.THROW_V;
      this.hurtPlayer(JACK.HURT);
      Sound.jack(c, 'back', J.by);
    }
  },

  exitCar(p) {
    const c = p.car;
    // helicopters: only once landed, and only on the street (the player can't walk on roofs)
    if (c.m.air && !c.wreck) {
      if (!c.landed) { this.toast('LAND FIRST', 1.2); return; }
      if (c.ground > 0) { this.toast('LAND ON THE STREET TO GET OUT', 1.8); return; }
    }
    for (const [lx, lf] of [[-c.hw - 9, 0], [c.hw + 9, 0], [-c.hw - 9, c.len / 4], [c.hw + 9, -c.len / 4], [0, c.len / 2 + 9], [0, -c.len / 2 - 9]]) {
      const [x, y] = c.toWorld(lx, lf);
      if (!Physics.solidAt(x, y) && !G.cars.some((o) => o !== c && o.contains(x, y, 4))) {
        p.x = x; p.y = y; p.ang = c.ang;
        c.driver = null; p.car = null;
        c.sirenOn = false; c.honking = false; c.hornT = -1;
        Sound.door(c, false);
        return;
      }
    }
  },

  respawn() {
    const p = G.player, s = G.city.spawn;
    G.player = new Player(s.x, s.y);
    G.player.ammo = emptyAmmo();
    G.mult = 1;
    G.cam.cx = s.x; G.cam.cy = s.y;
    this.toast('HOSPITAL: PATCHED UP. WEAPONS LOST.', 3);
    void p;
  },

  updatePickups(dt) {
    const p = G.player;
    for (const k of G.pickups) {
      if (k.away > 0) { k.away -= dt; continue; }
      if (p.dead || dist(p.px, p.py, k.x, k.y) > (p.car ? 26 : 12)) continue;
      k.away = k.once ? Infinity : 45;   // dropped by the dead: taken once
      Sound.pickup(k.kind === 'wallet' ? 'cash' : k.kind);
      if (k.kind === 'cash') this.earn(500, k.x, k.y);
      else if (k.kind === 'wallet') this.earn(k.cash, k.x, k.y);
      else if (k.kind === 'health') { p.hp = Math.min(100, p.hp + 50); this.toast('+HEALTH', 1.2); }
      else {
        const w = WEAPONS[k.kind], n = k.n || w.crate || 0;
        p.ammo[k.kind] = Math.min(w.shop ? w.shop.max : 999, (p.ammo[k.kind] || 0) + n);
        if (!p.car) p.weapon = k.kind;
        this.toast(w.name + ' +' + n, 1.5);
      }
      Parts.sparks(k.x, k.y, 8, PAL.Y);
    }
    if (G.pickups.some((k) => k.away === Infinity)) G.pickups = G.pickups.filter((k) => k.away !== Infinity);
  },

  // ----------------------------------------------------------- camera --
  updateCamera(dt) {
    const p = G.player, cam = G.cam;
    let tx = p.px, ty = p.py;
    if (p.car) {
      const k = p.car.m.air ? 0.55 : 0.35, mx = p.car.m.air ? 260 : 170, my = p.car.m.air ? 170 : 110;
      tx += clamp(p.car.vx * k, -mx, mx); ty += clamp(p.car.vy * k, -my, my);
    }
    if (G.state === 'play' && !G.lockCam) {
      const k = 1 - Math.exp(-5 * dt);
      cam.cx += (tx - cam.cx) * k; cam.cy += (ty - cam.cy) * k;
    }
    const W = G.city.W * TILE, H = G.city.H * TILE;
    cam.cx = clamp(cam.cx, cam.w / 2, W - cam.w / 2);
    cam.cy = clamp(cam.cy, cam.h / 2, H - cam.h / 2);
    if (G.state === 'title' && (cam.cx >= W - cam.w / 2 - 1 || cam.cy >= H - cam.h / 2 - 1)) { cam.cx = 900; cam.cy = 700; }
    cam.shake = Math.max(0, cam.shake - dt * 14);
    const s = cam.shake;
    cam.x = Math.round(cam.cx - cam.w / 2 + (Math.random() - 0.5) * s);
    cam.y = Math.round(cam.cy - cam.h / 2 + (Math.random() - 0.5) * s);
  },

  // ----------------------------------------------------------- render --
  render(ctx) {
    const cam = G.cam, c = G.city;
    ctx.fillStyle = PAL.w;
    ctx.fillRect(0, 0, cam.w, cam.h);

    // animated water under the (transparent) water tiles of the ground canvas
    const wf = Assets.frame('tiles', 'water', Math.floor(G.t * 4));
    const tiles = Assets.sheets.tiles.img;
    const tx0 = Math.max(0, Math.floor(cam.x / TILE)), ty0 = Math.max(0, Math.floor(cam.y / TILE));
    const tx1 = Math.min(c.W - 1, Math.floor((cam.x + cam.w) / TILE)), ty1 = Math.min(c.H - 1, Math.floor((cam.y + cam.h) / TILE));
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
      if (c.kind[y * c.W + x] === KIND.WATER) ctx.drawImage(tiles, wf * 16, 0, 16, 16, x * 16 - cam.x, y * 16 - cam.y, 16, 16);
    }
    Render.drawGround(ctx, cam);

    this.drawGroundLevel(ctx, cam);
    Airport.drawGround(ctx, cam);
    this.drawFires(ctx, cam);
    Peds.draw(ctx, cam);
    this.drawCars(ctx, cam);
    Train.draw(ctx, cam);
    this.drawPlayer(ctx, cam);
    this.drawProjectiles(ctx, cam);
    Render.drawTall(ctx, cam);
    Airport.drawTall(ctx, cam);

    const light = Clock.light();
    if (light.ambient) {
      Render.applyLighting(ctx, cam, light, this.collectLights(cam));
      if (G.time) this.drawEmissive(ctx, cam);
    }
    Render.drawBuildings(ctx, cam, light.s);
    this.drawAir(ctx, cam);
    Airport.drawAir(ctx, cam);
    Parts.draw(ctx, cam);
    Peds.drawOver(ctx, cam);
    this.drawMarkersOver(ctx, cam);
    if (G.showLanes) { // #demo&lanes: the traffic lane graph (City.drawLanes, world coordinates)
      ctx.save(); ctx.translate(-cam.x, -cam.y);
      City.drawLanes(ctx, cam.x, cam.y, cam.x + cam.w, cam.y + cam.h, 1);
      ctx.restore();
    }
    if (G.showWalks) { ctx.save(); ctx.translate(-cam.x, -cam.y); City.drawWalks(ctx, cam.x, cam.y, cam.x + cam.w, cam.y + cam.h, 1); ctx.restore(); } // #demo&walks
    if (G.showRoutes) { ctx.save(); ctx.translate(-cam.x, -cam.y); City.drawRoutes(ctx, 1); ctx.restore(); } // #demo&routes
    if (G.state === 'play') HUD.draw(ctx, cam);
    else HUD.drawTitle(ctx, cam);
    HUD.drawPointer(ctx, cam);
  },

  drawGroundLevel(ctx, cam) {
    const vis = (x, y, m = 24) => x > cam.x - m && x < cam.x + cam.w + m && y > cam.y - m && y < cam.y + cam.h + m;
    for (const p of Render.idx.props.query(cam.x - 40, cam.y - 40, cam.x + cam.w + 40, cam.y + cam.h + 40)) {
      if (p.broken || !vis(p.x, p.y, 40)) continue;
      if (p.big) Assets.draw(ctx, 'big', Assets.frame('big', p.sprite, p.anim ? Math.floor(G.t * 4) : p.frame || 0), p.x - 24 - cam.x, p.y - 24 - cam.y);
      else Assets.draw(ctx, 'props', Assets.frame('props', p.sprite, p.frame || 0), p.x - 8 - cam.x, p.y - 8 - cam.y);
    }
    G.city.phones.forEach((ph, i) => {
      if (!vis(ph.x, ph.y)) return;
      const ringing = Missions.ringing === i;
      Assets.draw(ctx, 'props', Assets.frame('props', 'phone', ringing ? Math.floor(G.t * 6) : 0), ph.x - 8 - cam.x, ph.y - 8 - cam.y);
    });
    for (const k of G.pickups) {
      if (k.away > 0 || !vis(k.x, k.y)) continue;
      const bob = Math.round(Math.sin(G.t * 4 + k.x) * 1);
      // a crate if there's one for it; a gun dropped by the dead (shotgun, ...) shows the weapon's icon
      const W = WEAPONS[k.kind], tag = k.kind === 'wallet' ? (hasSprite('props', 'wallet') ? 'wallet' : 'crate_cash')
        : hasSprite('props', 'crate_' + k.kind) && !k.once ? 'crate_' + k.kind
        : W && hasSprite('props', W.icon) ? W.icon : hasSprite('props', 'crate_' + k.kind) ? 'crate_' + k.kind : 'crate_cash';
      Assets.draw(ctx, 'props', Assets.frame('props', tag), k.x - 8 - cam.x, k.y - 8 - cam.y + (k.once ? 0 : bob));
    }
    Render.drawGroundSprites(ctx, cam);
    Missions.drawGround(ctx, cam);
  },

  drawCars(ctx, cam) {
    for (const c of G.cars) {
      const m = c.len / 2 + 10 + (c.alt || 0) * 0.2;
      if (c.x < cam.x - m || c.x > cam.x + cam.w + m || c.y < cam.y - m || c.y > cam.y + cam.h + m) continue;
      const sh = c.m.sheet;
      const f = Assets.frame(sh, c.tag, c.frame());
      if (c.alt > 2) { // flying: only its shadow down here, the aircraft itself is drawn above the roofs
        ctx.globalAlpha = clamp(0.35 - c.alt / 900, 0.12, 0.35);
        Assets.drawRot(ctx, sh, f, c.x - cam.x + 3 + c.alt * 0.18, c.y - cam.y + 4 + c.alt * 0.14, c.ang, Assets.tinted(sh, '#12142e'));
        ctx.globalAlpha = 1;
        continue;
      }
      const img = c.flash > 0 ? Assets.tinted(sh, '#ffffff') : c.wreck && c.m.air ? Assets.tinted(sh, '#2b2d42')
        : c.paint != null && Assets.painted ? Assets.painted(sh, c.tag, c.paint) : null;   // resprayed (paint shop)
      ctx.globalAlpha = 0.35;
      Assets.drawRot(ctx, sh, f, c.x - cam.x + 3, c.y - cam.y + 4, c.ang, Assets.tinted(sh, '#12142e'));
      ctx.globalAlpha = 1;
      Assets.drawRot(ctx, sh, f, c.x - cam.x, c.y - cam.y, c.ang, img);
      if (c.sirenOn) this.drawLightbar(ctx, cam, c);
      if (c.m.tank) {
        const a = c.ang + c.turret;
        const [tx, ty] = c.toWorld(0, 2);
        const rx = tx - Math.sin(a) * c.recoil, ry = ty + Math.cos(a) * c.recoil;
        const tf = Assets.frame('tank', 'turret', c.wreck ? 1 : 0);
        ctx.globalAlpha = 0.3;
        Assets.drawRot(ctx, 'tank', tf, rx - cam.x + 3, ry - cam.y + 4, a, Assets.tinted('tank', '#12142e'));
        ctx.globalAlpha = 1;
        Assets.drawRot(ctx, 'tank', tf, rx - cam.x, ry - cam.y, a, img);
      }
    }
  },

  // flashing lightbar on police cars / ambulances with the siren on
  sirenColors(c) {
    const on = Math.floor(G.t * 8) % 2;
    return c.m.siren === 'ambulance' ? [on ? PAL.z : PAL.x, on ? PAL.x : PAL.z] : [on ? PAL.z : PAL.B, on ? PAL.C : PAL.z];
  },
  drawLightbar(ctx, cam, c) {
    const [a, b] = this.sirenColors(c);
    const [lx, ly] = c.toWorld(-4, 1), [rx, ry] = c.toWorld(4, 1);
    ctx.fillStyle = a; ctx.fillRect(Math.round(lx - cam.x) - 1, Math.round(ly - cam.y) - 1, 3, 3);
    ctx.fillStyle = b; ctx.fillRect(Math.round(rx - cam.x) - 1, Math.round(ry - cam.y) - 1, 3, 3);
  },

  // aircraft in the air: lifted with the same oblique parallax as roofs, drawn over buildings
  drawAir(ctx, cam) {
    for (const c of G.cars) {
      if (!(c.alt > 2)) continue;
      const [x, y] = Render.lift(cam, c.x, c.y, c.alt);
      if (x < -80 || y < -80 || x > cam.w + 80 || y > cam.h + 80) continue;
      const sh = c.m.sheet, f = Assets.frame(sh, c.tag, c.frame());
      const img = c.flash > 0 ? Assets.tinted(sh, '#ffffff') : c.wreck || c.falling ? Assets.tinted(sh, '#2b2d42') : null;
      Assets.drawRot(ctx, sh, f, x, y, c.ang, img);
      const L = Clock.light();
      if (L.ambient) { // not touched by the light pass, so darken it like the roofs
        ctx.globalAlpha = L.s <= 1 ? 0.25 * L.s : 0.25 + 0.3 * (L.s - 1);
        Assets.drawRot(ctx, sh, f, x, y, c.ang, Assets.tinted(sh, L.ambient));
        ctx.globalAlpha = 1;
      }
      if (Math.floor(G.t * 2) % 2 === 0) { // nav lights: red port, green starboard
        const w = 18, fx = Math.cos(c.ang), fy = Math.sin(c.ang);
        ctx.fillStyle = PAL.z; ctx.fillRect(Math.round(x - fx * w) - 1, Math.round(y - fy * w) - 1, 2, 2);
        ctx.fillStyle = PAL.h; ctx.fillRect(Math.round(x + fx * w) - 1, Math.round(y + fy * w) - 1, 2, 2);
      }
    }
  },

  drawPlayer(ctx, cam) {
    const p = G.player;
    if (p.car) return;
    let tag = 'idle', i = 0;
    if (p.dead) tag = 'dead';
    else if (p.downT > 0) tag = hasSprite('player', 'down') ? 'down' : 'dead';   // pulled out of a car
    else if (p.punchT > 0 && hasSprite('player', 'punch')) { tag = 'punch'; i = p.punchT > PUNCH_T - 0.1 ? 0 : 1; }   // 0: the hit lands, 1: recovery
    else if (p.shootT > 0 || (p.weapon !== 'fist' && this.wantsShoot())) tag = 'shoot';
    else if (p.moving) { tag = 'walk'; i = Math.floor(p.walkT * 9); }
    ctx.globalAlpha = 0.3;
    Assets.drawRot(ctx, 'player', Assets.frame('player', tag, i), p.x - cam.x + 1, p.y - cam.y + 2, p.ang, Assets.tinted('player', '#12142e'));
    ctx.globalAlpha = 1;
    const img = p.hurtT > 0 && Math.floor(G.t * 20) % 2 ? Assets.tinted('player', '#ffffff') : null;
    Assets.drawRot(ctx, 'player', Assets.frame('player', tag, i), p.x - cam.x, p.y - cam.y, p.ang, img);
  },

  collectLights(cam) {
    const L = [];
    Train.lights(L);
    Airport.lights(L, cam);
    Render.worldLights(L, cam);
    for (const c of G.cars) { // siren glow, alternating with the lightbar
      if (!c.sirenOn || Math.abs(c.x - cam.cx) > cam.w || Math.abs(c.y - cam.cy) > cam.h) continue;
      const [a] = this.sirenColors(c);
      L.push({ x: c.x, y: c.y, r: 70, color: a === PAL.z ? 'rgba(255,60,90,0.8)' : a === PAL.x ? 'rgba(255,255,255,0.7)' : 'rgba(70,130,255,0.85)' });
    }
    const on = (x, y, m) => x > cam.x - m && x < cam.x + cam.w + m && y > cam.y - m && y < cam.y + cam.h + m;
    for (const l of Render.idx.lamps.query(cam.x - 70, cam.y - 70, cam.x + cam.w + 70, cam.y + cam.h + 70)) {
      if (l.broken || !on(l.x, l.y, 70)) continue;
      const hx = (l.x - cam.cx) * PARALLAX * 34, hy = (l.y - cam.cy) * PARALLAX * 34;
      L.push({ x: l.x + hx * 0.5, y: l.y + hy * 0.5, r: 52, color: 'rgba(255,214,150,0.85)' });
    }
    for (const c of G.cars) {
      if (!on(c.x, c.y, 140) || c.wreck) continue;
      if (c.m.air) { // searchlight pool under a flying helicopter
        if (c.alt > 2 && c.driver) L.push({ x: c.x + c.alt * 0.1, y: c.y + c.alt * 0.1, r: 60, color: 'rgba(255,245,210,0.6)' });
        continue;
      }
      if (c.driver) {
        const [hx, hy] = c.toWorld(0, c.len / 2);
        L.push({ cone: true, x: hx, y: hy, ang: c.ang });
      }
      const [tx, ty] = c.toWorld(0, -c.len / 2);
      L.push({ x: tx, y: ty, r: c.brake ? 30 : 18, color: 'rgba(255,60,80,0.8)' });
      if (c.burning) L.push({ x: c.x, y: c.y, r: 40, color: 'rgba(255,140,60,0.9)' });
    }
    G.city.phones.forEach((ph, i) => L.push({ x: ph.x, y: ph.y, r: Missions.ringing === i ? 36 : 20, color: 'rgba(84,232,212,0.7)' }));
    for (const k of G.pickups) if (k.away <= 0) L.push({ x: k.x, y: k.y, r: 16, color: 'rgba(255,230,160,0.6)' });
    for (const f of G.flashes || []) L.push({ x: f.x, y: f.y, r: 110, color: `rgba(255,170,80,${f.t * 2})` });
    for (const p of Parts.list) if (p.k === 'fire') L.push({ x: p.x, y: p.y, r: 22, color: 'rgba(255,130,50,0.5)' });
    if (G.muzzle) L.push({ x: G.muzzle.x, y: G.muzzle.y, r: 30, color: 'rgba(255,230,150,0.9)' });
    this.weaponLights(L);
    L.push({ x: G.player.px, y: G.player.py, r: 40, color: 'rgba(140,150,210,0.35)' });
    Missions.lights(L);
    return L;
  },

  drawEmissive(ctx, cam) {
    Render.drawTall(ctx, cam, true);
    Airport.drawEmissive(ctx, cam);
    for (const c of G.cars) {
      if (c.wreck || c.alt > 2 || c.x < cam.x - 30 || c.x > cam.x + cam.w + 30 || c.y < cam.y - 30 || c.y > cam.y + cam.h + 30) continue;
      if (c.sirenOn) this.drawLightbar(ctx, cam, c);
      if (c.m.air) continue;
      ctx.fillStyle = PAL.c;
      for (const lx of [-c.hw + 5, c.hw - 5]) { const [x, y] = c.toWorld(lx, c.len / 2 - 2); ctx.fillRect(Math.round(x - cam.x) - 1, Math.round(y - cam.y), 2, 2); }
      ctx.fillStyle = c.brake ? PAL.z : PAL.R;
      for (const lx of [-c.hw + 5, c.hw - 5]) { const [x, y] = c.toWorld(lx, -c.len / 2 + 2); ctx.fillRect(Math.round(x - cam.x) - 1, Math.round(y - cam.y) - 1, 2, 2); }
    }
    for (const p of Parts.list) {
      if (p.k !== 'fire') continue;
      const f = Assets.frame('fx', 'fire', Math.floor(p.t * 12 + p.x));
      Assets.draw(ctx, 'fx', f, p.x - 24 - cam.x, p.y - 32 - cam.y);
    }
    Missions.drawGround(ctx, cam);
  },

  drawMarkersOver(ctx, cam) {
    if (G.time === 0) {
      for (const p of Parts.list) {
        if (p.k !== 'fire') continue;
        const f = Assets.frame('fx', 'fire', Math.floor(p.t * 12 + p.x));
        Assets.draw(ctx, 'fx', f, p.x - 24 - cam.x, p.y - 32 - cam.y);
      }
    }
    Missions.drawOver(ctx, cam);
  },
};

// ================================================================ HUD ==
const HUD = {
  gangFx: {},
  GANG_BANDS: ['kos', 'hostile', 'neutral', 'friendly', 'trusted'],
  GANG_BAND_NAMES: { kos: 'KILL ON SIGHT', hostile: 'HOSTILE', neutral: 'NEUTRAL', friendly: 'FRIENDLY', trusted: 'TRUSTED' },

  // respect changed (Gangs.onChange): a +/- flash by the badge, and a toast when the band changes
  gangChanged(id, before, after) {
    const d = Math.round(after - before);
    if (!d) return;
    this.gangFx[id] = { d: (this.gangFx[id] && this.gangFx[id].t > 0 ? this.gangFx[id].d : 0) + d, t: 1.6 };
    this.gangBand = this.gangBand || {};
    const b0 = this.gangBand[id] || 'neutral', b1 = Gangs.band(id);
    this.gangBand[id] = b1;
    const g = Gangs.list.find((k) => k.id === id);
    if (b0 !== b1 && g) Game.toast(g.name + ': ' + this.GANG_BAND_NAMES[b1], 2.4);
  },

  // the three mobs under the clock: a badge in the mob's colour and 5 segments (the respect band)
  drawGangs(ctx, W) {
    if (typeof Gangs === 'undefined' || !Gangs.list || !G.gangs) return;
    Gangs.list.forEach((g, i) => {
      const y = 46 + i * 9, band = Gangs.band(g.id), n = this.GANG_BANDS.indexOf(band) + 1;
      const x1 = W - 6, x0 = x1 - 5 * 6 - 9;
      ctx.fillStyle = g.outline || PAL.K; ctx.fillRect(x0 - 1, y - 1, 9, 9);
      ctx.fillStyle = g.color || PAL.m; ctx.fillRect(x0, y, 7, 7);
      const kos = band === 'kos' && Math.floor(G.t * 4) % 2;
      for (let k = 0; k < 5; k++) {
        ctx.fillStyle = PAL.K; ctx.fillRect(x0 + 9 + k * 6, y + 1, 5, 5);
        ctx.fillStyle = k < n ? (n <= 1 ? (kos ? PAL.c : PAL.z) : n === 2 ? PAL.O : n === 3 ? PAL.m : PAL.h) : PAL.a;
        ctx.fillRect(x0 + 10 + k * 6, y + 2, 3, 3);
      }
      const fx = this.gangFx[g.id];
      if (fx && fx.t > 0) {
        fx.t -= 1 / 60;
        Font.draw(ctx, (fx.d > 0 ? '+' : '') + fx.d, x0 - 4, y, { align: 'right', color: fx.d > 0 ? PAL.h : PAL.z });
      }
    });
  },

  draw(ctx, cam) {
    const p = G.player, W = cam.w, H = cam.h;
    // weapon
    const w = WEAPONS[p.weapon];
    if (hasSprite('props', w.icon)) Assets.draw(ctx, 'props', Assets.frame('props', w.icon), 6, 5);
    else Font.draw(ctx, w.name.slice(0, 3), 6, 9, { color: PAL.c });   // icon not drawn yet
    if (p.weapon !== 'fist') Font.draw(ctx, String(p.ammo[p.weapon] || 0), 24, 9, { color: PAL.Y });
    // money + multiplier
    Font.draw(ctx, '$' + G.money, W - 6, 5, { scale: 2, align: 'right', color: PAL.Y, shadow: true });
    Font.draw(ctx, '*' + G.mult, W - 6, 24, { align: 'right', color: PAL.q });
    // clock and day
    Font.draw(ctx, Clock.label(), W - 6, 35, { align: 'right', color: PAL.c });
    Font.draw(ctx, 'DAY ' + Clock.day(), W - 6 - Font.width(Clock.label()) - 6, 35, { align: 'right', color: PAL.m });
    for (let i = 0; i < 5; i++) {
      const full = p.hp > i * 20 + 1;
      Assets.draw(ctx, 'props', Assets.frame('props', full ? 'heart' : 'heart_empty'), W - 28 - 9 * (4 - i) - 16, 24);
    }
    // car health bar
    if (p.car) {
      const c = p.car, f = clamp(c.hp / c.m.hp, 0, 1);
      ctx.fillStyle = PAL.K; ctx.fillRect(6, 24, 42, 5);
      ctx.fillStyle = f > 0.5 ? PAL.h : f > 0.25 ? PAL.L : PAL.z;
      ctx.fillRect(7, 25, Math.round(40 * f), 3);
    }
    this.drawGangs(ctx, W);
    Missions.drawHUD(ctx, cam);
    if (G.perf) { // #demo&perf: tick/render cost (ms, smoothed) and car counts
      const P = G.perf;
      Font.draw(ctx, `UPD ${P.upd.toFixed(2)}MS  DRAW ${P.draw.toFixed(2)}MS  CARS ${P.cars}  TRAFFIC ${P.traffic || 0}/${G.trafficBudget || 0}  UPDATED ${P.updated}  PAIRS ${P.pairs}`, 6, H - 32, { color: PAL.q });
      if (G.peds) Font.draw(ctx, `PEDS ${G.peds.filter((k) => k.kind === 'ped' && !k.dead).length}/${Peds.budget}  COWS ${G.peds.filter((k) => k.kind === 'cow' && !k.dead).length}  DEAD ${G.peds.filter((k) => k.dead).length}`, 6, H - 42, { color: PAL.q });
    }
    // objective arrow around the player
    const tgt = Missions.target();
    if (tgt && !p.dead) {
      const a = Math.atan2(tgt.x - p.px, -(tgt.y - p.py));
      const r = p.car ? Math.min(60, p.car.len / 2 + 14) : 20;
      const x = p.px - cam.x + Math.sin(a) * r, y = p.py - cam.y - Math.cos(a) * r;
      if (dist(tgt.x, tgt.y, p.px, p.py) > r + 10) Assets.drawRot(ctx, 'props', Assets.frame('props', 'arrow'), x, y, a);
    }
    // pager message
    if (G.msg) {
      const bw = Math.min(W - 16, 330), bx = Math.round((W - bw) / 2), by = H - 40;
      ctx.fillStyle = PAL.K; ctx.fillRect(bx - 1, by - 1, bw + 2, 34);
      ctx.fillStyle = PAL.e; ctx.fillRect(bx, by, bw, 32);
      ctx.fillStyle = PAL.E; ctx.fillRect(bx, by, bw, 2);
      ctx.fillStyle = PAL.q; ctx.fillRect(bx + 4, by + 5, 3, 3);
      const shown = Math.floor(G.msg.t * 45);
      let n = shown;
      G.msg.lines.forEach((line, i) => {
        Font.draw(ctx, line.slice(0, Math.max(0, n)), bx + 12, by + 5 + i * 11, { color: PAL.c, outline: null });
        n -= line.length;
      });
    }
    // current street, always on (GTA-style address line)
    const street = G.place && G.place.street;
    if (street && !G.msg) Font.draw(ctx, street, 8, H - 12, { color: PAL.l });
    // toast (district / car / weapon names)
    if (G.toast) {
      const a = clamp(G.toast.t * 3, 0, 1);
      ctx.globalAlpha = a;
      Font.draw(ctx, G.toast.text, 8, H - (G.msg ? 58 : street ? 26 : 18), { color: PAL.p, shadow: true });
      ctx.globalAlpha = 1;
    }
    if (G.banner) {
      const b = G.banner;
      Font.draw(ctx, b.text, W / 2, H / 2 - 40, { scale: 3, align: 'center', color: b.color, shadow: true });
      if (b.sub) Font.draw(ctx, b.sub, W / 2, H / 2 - 10, { align: 'center', color: PAL.c });
    }
    const mv = Input.mouseView();
    Phone.draw(ctx, cam, mv.x, mv.y);
    Phone.drawIndicator(ctx, cam);
    if (G.showMap) this.drawMap(ctx, cam);
    if (Shop.open) Shop.draw(ctx, cam);
    if (Paint.open) Paint.draw(ctx, cam);
    if (G.paused) {
      ctx.fillStyle = 'rgba(26,28,44,0.7)'; ctx.fillRect(0, 0, W, H);
      Font.draw(ctx, 'PAUSED', W / 2, H / 2 - 60, { scale: 3, align: 'center', color: PAL.p, shadow: true });
      this.controls(ctx, W / 2, H / 2 - 20);
    }
  },

  // crosshair in the world, arrow cursor over the phone and menus
  drawPointer(ctx, cam) {
    if (!Input.mouse.active) return;
    const m = Input.mouseView();
    const menu = G.state !== 'play' || G.paused || G.showMap || G.overPhone || Shop.open || Paint.open;
    if (menu) Assets.draw(ctx, 'props', Assets.frame('props', 'cursor'), m.x - 1, m.y - 1);
    else Assets.draw(ctx, 'props', Assets.frame('props', 'crosshair'), m.x - 8, m.y - 8);
  },

  drawMap(ctx, cam) {
    const m = Render.minimap, W = cam.w, H = cam.h;
    const fit = Math.min((W - 20) / m.width, (H - 30) / m.height);
    const s = fit >= 1 ? Math.floor(fit) : fit;
    const mw = Math.round(m.width * s), mh = Math.round(m.height * s);
    const x0 = Math.round((W - mw) / 2), y0 = Math.round((H - mh) / 2) + 4;
    ctx.fillStyle = 'rgba(26,28,44,0.75)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = PAL.K; ctx.fillRect(x0 - 2, y0 - 2, mw + 4, mh + 4);
    ctx.imageSmoothingEnabled = s < 1;
    ctx.drawImage(m, x0, y0, mw, mh);
    ctx.imageSmoothingEnabled = false;
    const dot = (x, y, col, r = 2) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x0 + (x / TILE) * s - r), Math.round(y0 + (y / TILE) * s - r), r * 2 + 1, r * 2 + 1); };
    G.city.phones.forEach((ph, i) => dot(ph.x, ph.y, Missions.ringing === i ? PAL.q : PAL.e));
    (G.city.gunshops || []).forEach((g) => dot(g.x, g.y, PAL.z));
    (G.city.paintshops || []).forEach((s) => dot(s.x, s.y, PAL.q));
    const t = Missions.target();
    if (t && Math.floor(G.t * 3) % 2) dot(t.x, t.y, PAL.L, 3);
    if (Math.floor(G.t * 4) % 2) dot(G.player.px, G.player.py, PAL.z, 2);
    if (G.showAov) AOV.drawOnMap(ctx, x0, y0, s);
    Font.draw(ctx, 'MAP  (M)', W / 2, y0 - 12, { align: 'center', color: PAL.c });
    if (G.place && G.place.neighborhood) Font.draw(ctx, G.place.neighborhood, W / 2, y0 + mh + 6, { align: 'center', color: PAL.p });
    if (Input.mouse.active) this.mapHover(ctx, cam, x0, y0, s, mw, mh);
  },

  // the mouse over the map: what's there (a shop or payphone, a landmark), then city/region,
  // neighbourhood and street, in a tooltip next to the cursor
  mapHover(ctx, cam, x0, y0, s, mw, mh) {
    const m = Input.mouseView();
    if (m.x < x0 || m.y < y0 || m.x >= x0 + mw || m.y >= y0 + mh) return;
    const wx = ((m.x - x0) / s) * TILE, wy = ((m.y - y0) / s) * TILE, c = G.city;
    const near = (x, y) => Math.abs(x0 + (x / TILE) * s - m.x) <= 4 && Math.abs(y0 + (y / TILE) * s - m.y) <= 4;
    let poi = null;
    (c.gunshops || []).forEach((g) => { if (!poi && near(g.x, g.y)) poi = { text: g.name + ' (GUNS)', color: PAL.z, x: g.x, y: g.y }; });
    (c.paintshops || []).forEach((k) => { if (!poi && near(k.x, k.y)) poi = { text: k.name + ' (PAINT)', color: PAL.q, x: k.x, y: k.y }; });
    c.phones.forEach((ph) => { if (!poi && near(ph.x, ph.y)) poi = { text: 'PAYPHONE', color: PAL.e, x: ph.x, y: ph.y }; });
    const tx = wx / TILE, ty = wy / TILE;
    const lm = (c.landmarks || []).find((l) => l.rect && tx >= l.rect.x && tx < l.rect.x + l.rect.w && ty >= l.rect.y && ty < l.rect.y + l.rect.h);
    const pl = City.placeAt(wx, wy);
    const k = c.kind[Math.floor(ty) * c.W + Math.floor(tx)];
    const lines = [];
    const add = (text, color) => { text = String(text || '').toUpperCase(); if (text && !lines.some((l) => l.text === text)) lines.push({ text, color }); };
    if (poi) add(poi.text, poi.color);
    if (lm) add(lm.name, PAL.Y);
    add(pl.district || (k === KIND.WATER ? 'THE SEA' : 'COUNTRYSIDE'), PAL.c);
    add(pl.neighborhood, PAL.p);
    add(pl.street, PAL.m);
    if (poi) { ctx.strokeStyle = poi.color; ctx.lineWidth = 1; ctx.strokeRect(Math.round(x0 + (poi.x / TILE) * s) - 4.5, Math.round(y0 + (poi.y / TILE) * s) - 4.5, 10, 10); }
    // the box: right of the cursor, flipped left/up to stay on screen
    const bw = Math.max(...lines.map((l) => Font.width(l.text))) + 10, bh = lines.length * 10 + 6;
    let bx = m.x + 12, by = m.y + 10;
    if (bx + bw > cam.w - 2) bx = m.x - 8 - bw;
    if (by + bh > cam.h - 2) by = m.y - 6 - bh;
    ctx.fillStyle = PAL.K; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = 'rgba(26,28,44,0.92)'; ctx.fillRect(bx, by, bw, bh);
    lines.forEach((l, i) => Font.draw(ctx, l.text, bx + 5, by + 4 + i * 10, { color: l.color }));
  },

  controls(ctx, x, y) {
    const lines = [
      'ARROWS / WASD   WALK, DRIVE',
      'MOUSE           AIM   LEFT: SHOOT',
      'RIGHT CLICK / C CELLPHONE',
      'E / ENTER       ENTER / EXIT CAR',
      'SPACE           HANDBRAKE / SHOOT',
      'Q / TAB  1-7    SWITCH WEAPON',
      'Z / X           TANK TURRET',
      'O SKIP 6 HOURS   M MAP   P PAUSE',
      'H HORN/SIREN  - = VOLUME  0 MUTE',
      'WHEEL           ZOOM',
    ];
    const x0 = Math.round(x - Math.max(...lines.map((l) => Font.width(l))) / 2);
    lines.forEach((l, i) => Font.draw(ctx, l, x0, y + i * 11, { color: PAL.c }));
  },

  drawTitle(ctx, cam) {
    const W = cam.w, H = cam.h;
    ctx.fillStyle = 'rgba(26,28,44,0.35)'; ctx.fillRect(0, 0, W, H);
    const bob = Math.round(Math.sin(G.t * 2) * 2);
    Font.draw(ctx, 'PASTEL', W / 2, H / 2 - 92 + bob, { scale: 4, align: 'center', color: PAL.p, shadow: true });
    Font.draw(ctx, 'CITY', W / 2, H / 2 - 56 + bob, { scale: 4, align: 'center', color: PAL.q, shadow: true });
    Font.draw(ctx, 'TOP-DOWN CRIME, SOFT COLOURS', W / 2, H / 2 - 14, { align: 'center', color: PAL.Y });
    if (Math.floor(G.t * 2) % 2 === 0) Font.draw(ctx, 'PRESS ENTER', W / 2, H / 2 + 4, { scale: 2, align: 'center', color: PAL.c, shadow: true });
    this.controls(ctx, W / 2, H / 2 + 34);
  },
};

// ============================================================= boot ==
const Main = {
  boot() {
    this.cv = document.getElementById('screen');
    this.ctx = this.cv.getContext('2d');
    Input.init();
    Game.start(20260925);
    this.resize();
    addEventListener('resize', () => this.resize());
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has('demo')) this.demo(params);
    this.last = performance.now();
    this.acc = 0;
    requestAnimationFrame((t) => this.frame(t));
  },

  // The world is drawn into a low-res canvas about VIEW x zoom pixels wide.
  // That is blown up by the largest whole factor with nearest-neighbour, and
  // the browser smooths the last (fractional) bit to the window size. Pixels
  // stay evenly sized at any zoom/window size ("sharp bilinear").
  VIEW: [800, 450],
  ZOOMS: [0.8, 0.9, 1, 1.15, 1.3],
  zoomI: 2,
  zoom(d) {
    const z = clamp(this.zoomI + Math.sign(d), 0, this.ZOOMS.length - 1);
    if (z !== this.zoomI) { this.zoomI = z; this.resize(); }
  },
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const W = innerWidth * dpr, H = innerHeight * dpr;
    const z = this.ZOOMS[this.zoomI];
    const s = Math.min(W / (this.VIEW[0] * z), H / (this.VIEW[1] * z));
    const vw = Math.round(W / s), vh = Math.round(H / s);
    const n = Math.max(1, Math.floor(s));
    if (!this.low || this.low.width !== vw || this.low.height !== vh) this.low = mkCanvas(vw, vh);
    this.cv.width = vw * n; this.cv.height = vh * n;
    this.cv.style.width = innerWidth + 'px';
    this.cv.style.height = innerHeight + 'px';
    this.ctx.imageSmoothingEnabled = false;
    this.low.ctx.imageSmoothingEnabled = false;
    G.cam.w = vw; G.cam.h = vh;
    Input.viewScale = vw / innerWidth;
  },

  frame(now) {
    try { this.step(now); } catch (e) { if (window.showErr) showErr(e); throw e; }
    requestAnimationFrame((t) => this.frame(t));
  },

  step(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;
    Input.poll();
    while (this.acc >= STEP) {
      const t0 = G.perf ? performance.now() : 0;
      Game.update(STEP);
      if (G.perf) G.perf.upd += (performance.now() - t0 - G.perf.upd) * 0.05;
      Input.endTick();
      this.acc -= STEP;
    }
    Game.updateCamera(dt);
    const t1 = G.perf ? performance.now() : 0;
    Game.render(this.low.ctx);
    if (G.perf) G.perf.draw += (performance.now() - t1 - G.perf.draw) * 0.05;
    this.ctx.drawImage(this.low, 0, 0, this.cv.width, this.cv.height);
  },

  // #demo — scripted start for screenshots/tests, e.g. #demo&drive=90&time=2
  demo(params) {
    G.state = 'play';
    Clock.init([12 * 60, 18 * 60 + 30, 23 * 60 + 30][+(params.get('time') || 0)] ?? 12 * 60);
    if (params.has('clock')) { const [hh, mm] = params.get('clock').split(':').map(Number); Clock.set(hh, mm || 0); }
    for (let i = +(params.get('skip') || 0); i > 0; i--) Game.skipTime();
    if (params.has('aov')) G.showAov = true;
    if (params.has('lanes')) G.showLanes = true;
    if (params.has('walks')) G.showWalks = true;
    if (params.has('routes')) G.showRoutes = true;
    // ped=scared|angry|violent[,n]: that many peds of that mood on the sidewalk next to the player
    if (params.has('ped')) { const [mood, n] = params.get('ped').split(','); Peds.demoSpawn(mood, +(n || 1)); }
    // paint=i[,j]: sit in a sedan on paint shop i's bay (the menu opens); j: respray it in colour j right away
    if (params.has('paint') && G.city.paintshops && G.city.paintshops.length) {
      const [i, j] = params.get('paint').split(',').map(Number), s = G.city.paintshops[i || 0];
      const car = new Car('sedan', s.x, s.y, s.ang); G.cars.push(car); car.managed = true;
      const pl = G.player; pl.x = s.x; pl.y = s.y; Game.seat ? Game.seat(pl, car) : (pl.car = car, car.driver = pl);
      G.cam.cx = s.x; G.cam.cy = s.y;
      Paint.check(pl, 0);
      if (j >= 0 && Paint.open) Paint.buy(Paint.colors()[j]);
    }
    // cop=pistol|shotgun[,n]: that many foot cops on the sidewalk next to the player
    if (params.has('cop')) { const [w, n] = params.get('cop').split(','); Peds.demoSpawn('cop', +(n || 1), w || 'pistol'); }
    // respect=<mob>,<n>: set that mob's respect (no war rule), e.g. respect=moretti,-70 (kill on sight)
    if (params.has('respect') && typeof Gangs !== 'undefined') { const [id, n] = params.get('respect').split(','); Gangs.set(id, +n || 0, 'demo'); }
    // pedgun=fist|pistol|uzi: arm the peds `ped=` just spawned; pedat=dx,dy: move them there
    // (px from the player, 12 px apart), e.g. onto open ground (weapons-agent)
    if (params.has('ped') && (params.has('pedgun') || params.has('pedat'))) {
      const n = +(params.get('ped').split(',')[1] || 1), [dx, dy] = (params.get('pedat') || '').split(',').map(Number);
      G.peds.filter((q) => q.kind === 'ped').slice(-n).forEach((q, i) => {
        if (params.has('pedgun')) q.weapon = params.get('pedgun');
        if (params.has('pedat')) { q.x = G.player.x + (dx || 0) + i * 12; q.y = G.player.y + (dy || 0); Peds.dirty = true; }
      });
    }
    // warm=N: run N seconds of simulation first, so screenshots show settled traffic
    for (let i = Math.round(+(params.get('warm') || 0) / STEP); i > 0; i--) { Game.update(STEP); Game.updateCamera(STEP); }
    if (params.has('perf')) G.perf = { upd: 0, draw: 0, cars: 0, updated: 0, pairs: 0 };
    const drive = +(params.get('drive') || 0);
    const p = G.player;
    if (params.has('goto')) {
      const want = params.get('goto').toLowerCase().replace(/[^a-z0-9]/g, '');
      const places = G.city.places || {};
      const key = Object.keys(places).find((k) => k.toLowerCase().replace(/[^a-z0-9]/g, '') === want);
      if (key) {
        const pl = places[key];
        p.x = pl.x; p.y = pl.y; G.cam.cx = pl.x; G.cam.cy = pl.y; G.lockCam = true;
      } else console.warn('goto: unknown place', want, Object.keys(places));
    }
    if (params.has('at')) {
      const [bx, by] = params.get('at').split(',').map(Number);
      const b = G.city.blocks.find((b) => bx >= b.bx0 && bx <= b.bx1 && by >= b.by0 && by <= b.by1);
      p.x = (b.x0 + 8.5) * TILE; p.y = (b.y1 - 1) * TILE + 4;
      G.cam.cx = p.x; G.cam.cy = p.y;
      if (params.has('look')) { const [lx, ly] = params.get('look').split(',').map(Number); G.cam.cx = (b.x0 + lx) * TILE; G.cam.cy = (b.y0 + ly) * TILE; G.lockCam = true; }
    }
    // arsenal: full ammo for every weapon
    // cam=tx,ty: centre the camera on a tile (frames big things goto can't)
    if (params.has('cam')) { const [tx, ty] = params.get('cam').split(',').map(Number); G.cam.cx = tx * TILE; G.cam.cy = ty * TILE; G.lockCam = true; }
    if (params.has('cash')) G.money = +params.get('cash');
    // shop=i: stand on gun store i's door mat with the store open
    if (params.has('shop') && G.city.gunshops) {
      const st = G.city.gunshops[+params.get('shop') || 0];
      p.x = st.x; p.y = st.y; G.cam.cx = st.x; G.cam.cy = st.y; Shop.enter(st);
      if (params.has('sel')) Shop.sel = +params.get('sel');
    }
    if (params.has('arsenal')) for (const id in WEAPONS) if (WEAPONS[id].shop) p.ammo[id] = WEAPONS[id].shop.max;
    // gangcar=<mob id>[,n]: that mob's traffic car (n of them, 70 px apart) on the lane nearest the
    // player, standing, AI-driven (vehicles-agent, gangs-v1 G4). Combine with goto= and jack=.
    if (params.has('gangcar')) {
      const [id, n] = params.get('gangcar').split(','), mob = Game.gangMob(id);
      const lanes = City.lanesIn(p.x - 300, p.y - 300, p.x + 300, p.y + 300, []);
      const onLane = (l, x, y) => { const L = Math.hypot(l.x1 - l.x0, l.y1 - l.y0) || 1, t = clamp(((x - l.x0) * l.dx + (y - l.y0) * l.dy) / L, 0.15, 0.85); return [t, l.x0 + (l.x1 - l.x0) * t, l.y0 + (l.y1 - l.y0) * t]; };
      const lane = lanes.map((l) => { const [, x, y] = onLane(l, p.x, p.y); return { l, d: dist(x, y, p.x, p.y) }; }).sort((a, b) => a.d - b.d)[0];
      if (!mob) console.warn('gangcar: unknown mob (or Gangs not loaded)', id);
      else if (!lane) console.warn('gangcar: no lane near the player');
      else for (let i = 0; i < (+n || 1); i++) {
        const l = lane.l, [, x, y] = onLane(l, p.x + l.dx * (i * 70 - 20), p.y + l.dy * (i * 70 - 20));
        const car = Game.gangCar(new Car(mob.carModel, x, y, Math.atan2(l.dx, -l.dy)), mob);
        car.traffic = true; car.managed = true;
        car.driver = { ai: true, lane: l.id, cruise: car.m.max * (l.profile === 'highway' ? 0.55 : 0.35) };
        G.cars.push(car);
      }
    }
    // gangram=<mob id>[,how[,secs]]: one of that mob's cars, standing AI-driven on the lane nearest the
    // player, is hit, then `secs` s run (vehicles-agent, gangs-v1 G7; the crew should bail and fight).
    // how: ram (default: the player's sedan drives into its tail at 60 px/s), shoot (a pistol round from
    // the player on foot), block (the player's sedan stopped just ahead; default 4 s), civ (a driverless
    // sedan shoved into it at 60 px/s: no bail), rival:<mob> (two of that mob's members on foot 90 px away).
    if (params.has('gangram')) {
      const [id, how0, sx] = params.get('gangram').split(','), how = how0 || 'ram', mob = Game.gangMob(id);
      const lanes = City.lanesIn(p.x - 800, p.y - 800, p.x + 800, p.y + 800, []).filter((l) => Math.hypot(l.x1 - l.x0, l.y1 - l.y0) > 240 && !(l.stop && G.city.nodes[l.to].signal));
      const lane = lanes.sort((u, v) => dist((u.x0 + u.x1) / 2, (u.y0 + u.y1) / 2, p.x, p.y) - dist((v.x0 + v.x1) / 2, (v.y0 + v.y1) / 2, p.x, p.y))[0];
      if (!mob || !lane) console.warn('gangram: unknown mob or no lane', id);
      else {
        const l = lane, x = lerp(l.x0, l.x1, 0.3), y = lerp(l.y0, l.y1, 0.3), ang = Math.atan2(l.dx, -l.dy);
        const car = Game.gangCar(new Car(mob.carModel, x, y, ang), mob);
        car.traffic = true; car.managed = true;
        car.driver = { ai: true, lane: l.id, cruise: car.m.max * 0.35 };
        G.cars.push(car);
        const behind = () => { const o = new Car('sedan', x - l.dx * (car.len / 2 + 36), y - l.dy * (car.len / 2 + 36), ang); o.managed = true; G.cars.push(o); return o; };
        const run = (n, each) => { for (let i = 0; i < n; i++) { if (each) each(i); Game.update(STEP); Game.updateCamera(STEP); } };
        // the gang car waits (as in a queue) until the shoved car touches it
        const shove = (o) => { let hit = false; return () => { hit = hit || (car.x - o.x) * o.fx + (car.y - o.y) * o.fy < (car.len + o.len) / 2 + 1; if (!hit) { o.vx = o.fx * 60; o.vy = o.fy * 60; car.vx = 0; car.vy = 0; } }; };
        if (how === 'ram') { const o = behind(); p.x = o.x; p.y = o.y; Game.seat(p, o); run(60, shove(o)); }
        else if (how === 'civ') { const o = behind(); run(60, shove(o)); }
        else if (how === 'block') {
          const o = new Car('sedan', x + l.dx * (car.len / 2 + 60), y + l.dy * (car.len / 2 + 60), ang); o.managed = true; G.cars.push(o);
          p.x = o.x; p.y = o.y; Game.seat(p, o);
        } else if (how === 'shoot') {
          const [wx, wy] = car.toWorld(car.hw + 50, 0);
          p.x = wx; p.y = wy; p.ammo.pistol = 50; p.weapon = 'pistol'; p.ang = Math.atan2(car.x - wx, -(car.y - wy));
          p.cool = 0; Game.shoot(p, WEAPONS.pistol);
        } else if (how.startsWith('rival:')) {
          const r = how.slice(6);
          for (const side of [1, 1.3]) {
            const [wx, wy] = car.toWorld(car.hw + 90 * side - 60, 20), hit = City.walkAt(wx, wy, 200);
            if (hit) { const q = Peds.spawnPed(hit.walk, wx, wy, ZONES.downtown.peds, 'gang', r); q.x = wx; q.y = wy; }
          }
          Peds.dirty = true;
        }
        G.cam.cx = car.x; G.cam.cy = car.y;
        run(Math.round((+sx || (how === 'block' ? 4 : 2)) * 60));
        G.cam.cx = car.x; G.cam.cy = car.y;
        const crew = (car.crew || []).filter((q) => !q.gone);
        const fight = crew.filter((q) => q.state === 'fight');
        const info = 'GANGRAM ' + how + ': crew ' + crew.length + ' fight ' + fight.length + ' foe ' +
          fight.map((q) => q.foe === p ? 'player' : q.foe && q.foe.gang ? q.foe.gang : '?').join('/') + ' down ' + crew.filter((q) => q.state === 'down').length + ' dead ' + crew.filter((q) => q.dead).length + ' car ' + (car.driver ? 'driven' : 'empty') + (car.driver && car.driver.fleeT > 0 ? ' FLEE' : '');
        Game.toast(info, 30); console.log(info);
      }
    }
    if (params.has('tank')) {
      const t = G.tank;
      p.x = t.x; p.y = t.y + 30;
      G.cam.cx = p.x; G.cam.cy = p.y;
      Game.tryEnterCar(p);
      t.turret = +params.get('tank') || 0;
      Game.fireCannon(t);
      for (let i = 0; i < 20; i++) { Game.update(STEP); Game.updateCamera(STEP); }
    }
    // heli=N: a helicopter next to the player; spin up + climb for 2.5 s, then N ticks forward
    if (params.has('heli')) {
      let spot = null;
      for (const [ox, oy] of [[0, -45], [0, 45], [45, 0], [-45, 0], [60, -60], [-60, 60]]) {
        const x = p.x + ox, y = p.y + oy;
        if (!Physics.solidAt(x, y) && !Physics.solidAt(x - 28, y - 28) && !Physics.solidAt(x + 28, y + 28)) { spot = { x, y, ang: 0 }; break; }
      }
      const h = Game.spawnCar('helicopter', spot || { x: p.x, y: p.y - 45, ang: 0 });
      p.car = h; h.driver = p;
      const held = Input.held, thr = Input.throttle;
      Input.held = (a) => a === 'fire';
      for (let i = 0; i < 150; i++) { Game.update(STEP); Game.updateCamera(STEP); }
      Input.held = held;
      Input.throttle = () => 1;
      for (let i = 0; i < +params.get('heli'); i++) { Game.update(STEP); Game.updateCamera(STEP); }
      Input.throttle = thr;
      Game.toast('ALT ' + Math.round(h.alt) + ' SPD ' + Math.round(h.speed()) + ' ROTOR ' + h.rotor.toFixed(2), 30);
      console.log('heli', { x: h.x, y: h.y, alt: h.alt, speed: h.speed(), rotor: h.rotor });
    }
    if (drive) {
      Game.tryEnterCar(p);
      const car = p.car;
      Input.throttle = () => 1;
      Input.axis = () => 0;
      for (let i = 0; i < drive; i++) { Game.update(STEP); Game.updateCamera(STEP); }
      Input.throttle = () => 0;
      if (params.has('crash')) for (let i = 0; i < 200; i++) { Input.throttle = () => 1; Input.axis = (a) => (a === 'x' ? 0.6 : 0); Game.update(STEP); Game.updateCamera(STEP); }
      void car;
    }
    // runover=ped|cow,speed[,n]: n bodies standing in front of the player's car, which hits them
    // at `speed` px/s, then rolls to a stop (vehicles-agent, peds-v1 P5)
    if (params.has('runover')) {
      const [kind, sv, sn] = params.get('runover').split(',');
      if (!p.car) Game.tryEnterCar(p);
      const c = p.car;
      if (c) {
        const v = +sv || 150, pen = { x0: c.x - 400, y0: c.y - 400, x1: c.x + 400, y1: c.y + 400, live: [], killed: [], cows: 0 };
        for (let i = 0; i < (+sn || 1); i++) {
          const [x, y] = c.toWorld((i % 2 ? 5 : -5), c.len / 2 + 34 + i * 16);
          const b = kind === 'cow' ? Peds.spawnCow(pen) : Peds.spawnPed(G.city.walks[0], x, y, ZONES.downtown.peds, 'scared');
          b.x = x; b.y = y; b.state = kind === 'cow' ? 'graze' : 'look'; b.t = 99; b.dodged = true; b.bull = false;
        }
        Input.throttle = () => 0; Input.axis = () => 0;
        for (let i = 0; i < 150; i++) {
          if (i < 45) { c.vx = c.fx * v; c.vy = c.fy * v; }
          Game.update(STEP); Game.updateCamera(STEP);
        }
      }
    }
    // jack=secs[,drive] | jack=back[,secs]: carjack the nearest traffic car (vehicles-agent,
    // carjack-v1 C1). The car is slowed to a crawl, the player is put by its passenger side (so the
    // walk round the car runs too) and presses E; then `secs` s run (default 0.4 = mid-yank;
    // `drive` holds the gas after the jack). `back`: the driver comes out violent with fists, and
    // the player waits in the car (no gas) until he pulls them out and drives off; secs default 4.
    if (params.has('jack')) {
      const [a, b] = params.get('jack').split(','), back = a === 'back';
      const secs = back ? +(b || 4) : +(a || 0.4), gas = b === 'drive';
      const near = () => G.cars.filter((k) => Game.jackable(k) && !Game.driverDoor(k).blocked)
        .sort((u, v) => dist(u.x, u.y, p.x, p.y) - dist(v.x, v.y, p.x, p.y))[0];
      let car = near();
      for (let i = 0; i < 20 / STEP && (!car || dist(car.x, car.y, p.x, p.y) > 900); i++) { Game.update(STEP); Game.updateCamera(STEP); car = near(); }
      if (car) {
        const pd = Peds.driverOut;
        if (back && typeof pd === 'function') Peds.driverOut = (c, x, y, ang, o) => { const q = pd.call(Peds, c, x, y, ang, { ...o, mood: 'violent' }); q.weapon = 'fist'; return q; };
        car.vx = car.fx * 12; car.vy = car.fy * 12;
        const [x, y] = car.toWorld(car.hw + 8, 0);
        p.x = x; p.y = y; G.cam.cx = x; G.cam.cy = y;
        const hit = Input.hit; Input.hit = (k) => k === 'use'; Game.update(STEP); Input.hit = hit;
        console.log('jack', car.model, !!G.jack);
        const thr = Input.throttle;
        for (let i = Math.round(secs / STEP); i > 0; i--) {
          if (gas && p.car === car) Input.throttle = () => 1;
          Game.update(STEP); Game.updateCamera(STEP);
        }
        Input.throttle = thr;
        Peds.driverOut = pd;
        if (back) Game.toast(p.car ? 'STILL IN THE CAR' : car.traffic ? 'TAKEN BACK: ' + car.m.name : 'NO TAKE-BACK', 30);
      }
    }
    // flight=land|depart|runway[,secs]: start that airport movement now (land: into the remote stand,
    // freed if needed; depart: a gate plane; runway: the lined-up airliner), run secs of it, frame the plane
    if (params.has('flight') && G.city.airport) {
      const [kind, secs] = params.get('flight').split(','), F = Flights, A = G.city.airport;
      let pl = null;
      if (kind === 'land') {
        const s = A.stands.find((st) => st.kind === 'remote');
        const had = F.planes.find((q) => q.stand === s.id);
        if (had) { for (const o of s.obstacles) G.obstacleGrid.remove(o); F.planes = F.planes.filter((q) => q !== had); }
        pl = F.arrive(s);
      } else {
        pl = F.planes.find((q) => q.phase === 'parked' && A.stands[q.stand].kind === (kind === 'runway' ? 'runway' : 'gate'));
        if (pl) F.depart(pl);
      }
      for (let i = Math.round(+(secs || 0) / STEP); i > 0 && pl && !pl.gone; i--) { Game.update(STEP); Game.updateCamera(STEP); }
      if (pl) { G.cam.cx = pl.x; G.cam.cy = pl.y; G.lockCam = true; p.x = pl.x + 200; p.y = pl.y; }
    }
    // crane=secs: run the port cranes for secs and frame the middle crane
    if (params.has('crane') && Cranes.list.length) {
      const k = Cranes.list[1];
      p.x = k.x; p.y = k.y - 120;
      for (let i = Math.round(+params.get('crane') / STEP); i > 0; i--) { Game.update(STEP); Game.updateCamera(STEP); }
      G.cam.cx = k.x; G.cam.cy = k.y - 30; G.lockCam = true;
    }
    // seek=ped: run up to 120 s until a traffic car is stopped for a ped or cow, then frame it
    if (params.get('seek') === 'ped') {
      let hit = null;
      for (let i = 0; i < 120 / STEP && !hit; i++) {
        Game.update(STEP); Game.updateCamera(STEP);
        hit = G.cars.find((c) => c.driver && c.driver.ai && c.driver.why === 'ped' && c.speed() < 3 && c.driver.leadPed && c.driver.leadPed.state === 'walk');
      }
      if (hit) { const q = hit.driver.leadPed; G.cam.cx = (hit.x + q.x) / 2; G.cam.cy = (hit.y + q.y) / 2; G.lockCam = true; }
    }
    if (params.has('boom')) {
      const c = G.cars.find((c) => c !== p.car && dist(c.x, c.y, p.px, p.py) < 250);
      if (c) { c.hp = 0; for (let i = 0; i < 12; i++) { Game.update(STEP); Game.updateCamera(STEP); } }
    }
    if (params.has('rampage')) {
      const [bx, by] = params.get('rampage').split(',').map(Number);
      const b = G.city.blocks.find((b) => b.bx === bx && b.by === by);
      const y1 = (b.y0 + CITY.LOT) * TILE;
      const car = Game.spawnCar('sport', { x: (b.x0 + 19) * TILE, y: y1 - 10, ang: -Math.PI / 2 });
      p.x = car.x; p.y = car.y - 30; Game.tryEnterCar(p);
      if (p.car !== car) { p.car && (p.car.driver = null); p.car = car; car.driver = p; }
      G.cam.cx = car.x - 150; G.cam.cy = car.y;
      Input.throttle = () => 1;
      for (let i = 0; i < +(params.get('ticks') || 70); i++) { Game.update(STEP); Game.updateCamera(STEP); }
      Input.throttle = () => 0;
    }
    if (params.has('mission')) {
      Missions.bag = [params.get('mission')];
      Missions.ringing = 0;
      Missions.begin();
      for (let i = 0; i < 400; i++) { Game.update(STEP); Game.updateCamera(STEP); }
    }
    if (params.has('shoot')) {
      p.ammo.uzi = 90; p.weapon = 'uzi';
      const c = G.cars.filter((c) => !c.driver).sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y))[0];
      p.ang = Math.atan2(c.x - p.x, -(c.y - p.y));
      Input.held = (a) => a === 'fire' || a === 'shoot';
      for (let i = 0; i < +params.get('shoot'); i++) { Game.update(STEP); Game.updateCamera(STEP); }
      Input.held = () => false;
    }
    // wfire=<id>,<ang|car|ped>,<n>[,<ticks>]: that weapon with full ammo, facing ang (radians, 0 = up)
    // or the nearest parked car / living ped (throws land on it), fire n times at the weapon's rate, and run
    // `ticks` after the last shot (default: one cooldown; the demo always adds 30 more)
    if (params.has('wfire')) {
      const [id, aim, n, after] = params.get('wfire').split(',');
      const w = WEAPONS[id];
      if (!w || !w.cool) console.warn('wfire: unknown weapon', id);
      else {
        p.ammo[id] = w.shop ? w.shop.max : 99; p.weapon = id;
        if (aim === 'car') {
          const c = G.cars.filter((c) => !c.driver && !c.wreck && !c.m.air).sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y))[0];
          p.ang = Math.atan2(c.x - p.x, -(c.y - p.y)); p.throwAt = dist(c.x, c.y, p.x, p.y);
        } else if (aim === 'ped') {   // the nearest living ped or cow (throws land on it)
          const c = G.peds.filter((q) => !q.dead && !q.gone).sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y))[0];
          if (c) { p.ang = Math.atan2(c.x - p.x, -(c.y - p.y)); p.throwAt = dist(c.x, c.y, p.x, p.y); }
        } else p.ang = +aim || 0;
        const gap = Math.max(1, Math.ceil(w.cool * 60));
        const shots = +n || 1;
        for (let k = 0; k < shots; k++) {
          p.cool = 0; Game.shoot(p, w);
          const wait = k < shots - 1 || after === undefined ? gap : +after || 0;
          for (let i = 0; i < wait; i++) { Game.update(STEP); Game.updateCamera(STEP); }
        }
        p.throwAt = 0;
      }
    }
    // punch=n[,ticks]: fists; step up to the nearest living ped or cow and punch it n times at the
    // fist's rate, re-facing it each time, then run `ticks` (default one cooldown)
    if (params.has('punch')) {
      const [n, after] = params.get('punch').split(',');
      const w = WEAPONS.fist, gap = Math.ceil(w.cool * 60);
      p.weapon = 'fist';
      for (let k = 0; k < (+n || 1); k++) {
        const t = G.peds.filter((q) => !q.dead && !q.gone).sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y))[0];
        if (t) {
          const d = dist(t.x, t.y, p.x, p.y) || 1, r = t.kind === 'cow' ? 14 : 9;
          if (d > r + 1) { const nx = t.x + (p.x - t.x) / d * r, ny = t.y + (p.y - t.y) / d * r; if (!Physics.solidAt(nx, ny)) { p.x = nx; p.y = ny; } }
          p.ang = Math.atan2(t.x - p.x, -(t.y - p.y));
        }
        p.cool = 0; Game.shoot(p, w);
        const wait = k < (+n || 1) - 1 || after === undefined ? gap : +after || 0;
        for (let i = 0; i < wait; i++) { Game.update(STEP); Game.updateCamera(STEP); }
      }
      G.cam.cx = p.x; G.cam.cy = p.y;
    }
    if (params.has('map')) G.showMap = true;
    if (params.has('mouse')) {
      const [mx, my] = params.get('mouse').split(',').map(Number);
      Input.mouse.active = true; Input.mouse.x = mx; Input.mouse.y = my;
    }
    if (params.has('phone')) {
      const app = params.get('phone');
      if (app === 'incoming') Phone.ring(CONTACTS[1]);
      Phone.open = true; Phone.slide = 1;
      Phone.app = app || 'home';
      if (params.has('call')) { Phone.startCall(CONTACTS[+params.get('call')]); for (let i = 0; i < 120; i++) { Game.update(STEP); } Phone.open = true; }
    }
    // settle=N: ticks run before the picture (default 30; 0 catches a punch or a shot as it lands)
    for (let i = +(params.get('settle') ?? 30); i > 0; i--) { Game.update(STEP); Game.updateCamera(STEP); }
    // focus=dead: frame the newest corpse (weapons-agent: checking gore after a scripted fight)
    if (params.has('focus') && G.peds) {
      const d = G.peds.filter((q) => q.dead && !q.gone).sort((a, b) => b.deadT - a.deadT)[0];
      if (d) { G.cam.cx = d.x; G.cam.cy = d.y; G.lockCam = true; Game.toast((d.burnt ? 'BURNT ' : 'DEAD ') + d.kind.toUpperCase(), 30); }
    }
  },
};

// =========================================================== freight train ==
// Shuttles along a straight, axis-aligned railway between two buffer stops, with
// a locomotive at each end, dwelling at the ends and at any station stops. It
// can't be stopped: whatever sits on the track is shoved aside and damaged (the
// tank only gets shoved), and it hurts the player on foot.
//
// Rail format (world px): { x0, y0, x1, y1, stops?, dwell? }, horizontal or vertical.
//   stops: [at | { at, dwell }] — `at` is the world x (horizontal) or y (vertical)
//          where the train's centre dwells, e.g. a station platform.
//   dwell: default seconds at a stop (6). The ends always wait 7 s.
// Legacy { y, x0, x1 } (horizontal) is still accepted.
const Train = {
  init(rail) {
    let { x0, y0, x1, y1 } = rail;
    if (y0 === undefined) { y0 = y1 = rail.y; }                 // legacy { y, x0, x1 }
    const vertical = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    if (vertical) x1 = x0; else y1 = y0;                        // snap to the axis
    if (x1 < x0 || y1 < y0) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; }
    this.rail = { x0, y0, x1, y1 };
    this.vertical = vertical;
    this.ux = vertical ? 0 : 1; this.uy = vertical ? 1 : 0;     // along the track (x0,y0 → x1,y1)
    this.nx = -this.uy; this.ny = this.ux;                       // across the track
    this.heading = Math.atan2(this.ux, -this.uy);                // sprite angle facing +u
    this.length = vertical ? y1 - y0 : x1 - x0;
    this.cars = [
      { tag: 'loco', len: 112 }, { tag: 'boxcar', len: 104 }, { tag: 'tankcar', len: 104 },
      { tag: 'flatcar', len: 104 }, { tag: 'boxcar', len: 104 }, { tag: 'loco', len: 112, flip: true },
    ];
    this.gap = 6; this.half = 17;
    this.len = this.cars.reduce((a, c) => a + c.len, 0) + this.gap * (this.cars.length - 1);
    this.lo = this.len / 2 + 4;
    this.hi = Math.max(this.lo, this.length - this.len / 2 - 4);
    const base = vertical ? y0 : x0, dwell = rail.dwell ?? 6;
    this.stops = (rail.stops || [])
      .map((st) => (typeof st === 'number' ? { s: st - base, dwell } : { s: st.at - base, dwell: st.dwell ?? dwell }))
      .filter((st) => st.s > this.lo + 1 && st.s < this.hi - 1)
      .sort((a, b) => a.s - b.s);
    this.s = this.lo;                                            // centre, distance from (x0,y0)
    this.v = 0; this.dir = 1; this.wait = 3;
    this.vmax = 150; this.acc = 45;
    this.place();
  },
  // world centre of the train (for other systems, e.g. sound)
  place() { this.x = this.rail.x0 + this.ux * this.s; this.y = this.rail.y0 + this.uy * this.s; },
  at(s) { return [this.rail.x0 + this.ux * s, this.rail.y0 + this.uy * s]; },
  // cars from the +u end backwards; s0/s1/cs are distances along the track
  segments() {
    const out = [];
    let head = this.s + this.len / 2;
    for (const c of this.cars) { out.push({ c, s0: head - c.len, s1: head, cs: head - c.len / 2 }); head -= c.len + this.gap; }
    return out;
  },
  update(dt) {
    if (this.wait > 0) { this.wait -= dt; this.v = 0; return this.collide(dt); }
    // next target ahead: the nearest stop in the direction of travel, else the buffers
    let target = this.dir > 0 ? this.hi : this.lo, stop = null;
    for (const st of this.stops) {
      if ((st.s - this.s) * this.dir > 1e-6 && (st.s - target) * this.dir < 0) { target = st.s; stop = st; }
    }
    const toGo = (target - this.s) * this.dir;
    const speed = Math.abs(this.v);
    const stopDist = (speed * speed) / (2 * this.acc);
    // brake into the target, but creep the last pixels so it can't stall short of it
    const want = toGo <= stopDist + 2 ? Math.max(Math.min(12, toGo / dt), speed - this.acc * dt) : Math.min(this.vmax, speed + this.acc * dt);
    this.v = want * this.dir;
    const step = Math.min(want * dt, toGo);
    this.s += step * this.dir;
    if (toGo - step <= 0.5) {
      this.s = target; this.v = 0;
      if (stop) this.wait = stop.dwell; else { this.dir *= -1; this.wait = 7; }
    }
    this.place();
    this.collide(dt);
  },
  collide(dt) {
    const { x0: ox, y0: oy } = this.rail, { ux, uy, nx, ny, half } = this;
    const a0 = this.s - this.len / 2, a1 = this.s + this.len / 2;
    for (const c of G.cars) {
      if (c.trainHit > 0) c.trainHit -= dt;
      if (c.airborne) continue;
      const ca = (c.x - ox) * ux + (c.y - oy) * uy, cb = (c.x - ox) * nx + (c.y - oy) * ny;
      if (Math.abs(cb) > half + c.len / 2 + 4 || ca < a0 - c.len || ca > a1 + c.len) continue;
      for (const [px, py] of c.circles()) {
        const pa = (px - ox) * ux + (py - oy) * uy, pb = (px - ox) * nx + (py - oy) * ny;
        if (pa < a0 - c.hw || pa > a1 + c.hw) continue;
        const over = half + c.hw - Math.abs(pb);
        if (over <= 0) continue;
        const sg = pb >= 0 ? 1 : -1;
        c.x += nx * sg * over; c.y += ny * sg * over;
        const vAcross = c.vx * nx + c.vy * ny;
        const dv = sg * Math.max(Math.abs(vAcross), 90 + Math.abs(this.v) * 0.6) - vAcross;
        c.vx += nx * dv + ux * this.v * 0.5;
        c.vy += ny * dv + uy * this.v * 0.5;
        c.spin += (Math.random() - 0.5) * 3;
        if (!c.m.tank && Math.abs(this.v) > 20 && !(c.trainHit > 0)) {
          Game.damageCar(c, 18 + Math.abs(this.v) * 0.25); c.trainHit = 0.5;
          const [sx, sy] = this.at(pa);
          Parts.sparks(sx + nx * sg * half, sy + ny * sg * half, 8);
        }
        break;
      }
    }
    this.bodies(a0, a1);
    const p = G.player;
    if (p.car || p.dead) return;
    const pa = (p.x - ox) * ux + (p.y - oy) * uy, pb = (p.x - ox) * nx + (p.y - oy) * ny;
    if (pa > a0 - 4 && pa < a1 + 4 && Math.abs(pb) < half + 5) {
      const sg = pb >= 0 ? 1 : -1, push = sg * (half + 6) - pb;
      p.x += nx * push; p.y += ny * push;
      if (Math.abs(this.v) > 10) Game.hurtPlayer(40);
    }
  },
  // peds and cows on the track: a moving train kills them (thrown aside, blood along the rail),
  // a standing one is a wall they get pushed out of; corpses on the line are smeared once
  bodies(a0, a1) {
    if (!G.peds || !G.peds.length || !Number.isFinite(this.v) || !Number.isFinite(a0)) return;
    const { x0: ox, y0: oy } = this.rail, { ux, uy, nx, ny, half } = this, v = this.v, moving = Math.abs(v) > 10;
    for (const p of G.peds) {
      if (p.gone || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;   // never push NaN into a body
      const r = p.kind === 'cow' ? PED.COW_R : PED.R;
      const pa = (p.x - ox) * ux + (p.y - oy) * uy, pb = (p.x - ox) * nx + (p.y - oy) * ny;
      if (pa < a0 - r || pa > a1 + r || Math.abs(pb) > half + r) continue;
      const sg = pb >= 0 ? 1 : -1, dir = v >= 0 ? 1 : -1;
      if (p.dead) {
        if (moving && !(p.runBy && p.runBy.includes(this))) {
          (p.runBy || (p.runBy = [])).push(this);
          if (!p.burnt) Render.smear(p.x, p.y, p.x + ux * dir * 22, p.y + uy * dir * 22, 5);
        }
        continue;
      }
      if (!moving) { p.x += nx * (sg * (half + r + 1) - pb); p.y += ny * (sg * (half + r + 1) - pb); continue; }
      (p.runBy || (p.runBy = [])).push(this);
      Sound.body(p, Math.abs(v), 'kill');
      Peds.hurt(p, p.hp + 1, { kind: 'car', src: this, vx: ux * v * 0.7 + nx * sg * 110, vy: uy * v * 0.7 + ny * sg * 110 });
      Render.smear(p.x, p.y, p.x + ux * dir * 30, p.y + uy * dir * 30, p.kind === 'cow' ? 7 : 5);
    }
  },
  draw(ctx, cam) {
    const shadow = Assets.tinted('rail', '#12142e');
    for (const sg of this.segments()) {
      const [x, y] = this.at(sg.cs), r = sg.c.len / 2 + 20;
      if (x < cam.x - r || x > cam.x + cam.w + r || y < cam.y - r || y > cam.y + cam.h + r) continue;
      const f = Assets.frame('rail', sg.c.tag);
      const ang = this.heading + (sg.c.flip ? Math.PI : 0);
      ctx.globalAlpha = 0.35;
      Assets.drawRot(ctx, 'rail', f, x - cam.x + 3, y - cam.y + 4, ang, shadow);
      ctx.globalAlpha = 1;
      Assets.drawRot(ctx, 'rail', f, x - cam.x, y - cam.y, ang);
    }
  },
  lights(L) {
    const [x, y] = this.at(this.s + this.dir * this.len / 2);
    L.push({ cone: true, x, y, ang: this.heading + (this.dir > 0 ? 0 : Math.PI) });
  },
};
