'use strict';
// Game state, rules, missions, HUD and the main loop.

const STEP = 1 / 60;
const GOAL = 100000;
const G = {
  state: 'title', time: 1, t: 0,
  cars: [], pickups: [], bullets: [],
  money: 0, mult: 1,
  cam: { x: 0, y: 0, cx: 0, cy: 0, w: 480, h: 270, shake: 0 },
  msg: null, banner: null, toast: null,
  showMap: false, paused: false, won: false,
};

const Game = {
  // ------------------------------------------------------------- setup --
  start(seed) {
    G.city = City.build(seed);
    G.R = rng(seed ^ 0x5eed);
    G.obstacleGrid = new Grid(G.city.obstacles);
    Render.init(G.city);
    const c = G.city;
    G.cars = [];
    for (const s of c.parked) this.spawnParked(s);
    G.tank = this.spawnCar('tank', c.tankSpot);
    G.tank.ang = c.tankSpot.ang;
    G.waypoint = null;
    const st = c.starterCar;
    G.cars.push(new Car(st.model, st.x, st.y, st.ang));
    G.player = new Player(c.spawn.x, c.spawn.y);
    G.pickups = [];
    G.sprays = [];
    const kinds = ['cash', 'cash', 'health', 'pistol', 'pistol', 'uzi'];
    for (const s of c.crateSpots) if (G.R() < 0.55) G.pickups.push({ kind: pick(G.R, kinds), x: s.x, y: s.y, away: 0 });
    // guarantee a pistol near the start
    G.pickups.push({ kind: 'pistol', x: c.spawn.x - 40, y: c.spawn.y - 2, away: 0 });
    Missions.init();
    Phone.init();
    G.cam.cx = c.spawn.x; G.cam.cy = c.spawn.y;
    G.district = null;
    Train.init(c.rail);
  },

  spawnCar(model, s) {
    const car = new Car(model, s.x, s.y, s.ang + (G.R() - 0.5) * 0.04);
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
    const weights = s.models ? Object.fromEntries(s.models.map((m) => [m, 1])) : City.regionAt(s.x, s.y).models;
    const maxLen = s.stall || s.driveway ? 58 : 999;
    let model = randomModel(G.R, maxLen, weights);
    if (!this.roomFor(s, MODELS[model].len)) model = randomModel(G.R, 58, weights);
    if (!this.roomFor(s, MODELS[model].len)) return null;
    return this.spawnCar(model, s);
  },

  // ----------------------------------------------------------- events --
  impact(c, speed, x, y, other) {
    if (speed < 70) return;
    if (speed > 140) Parts.sparks(x, y, Math.min(14, (speed / 35) | 0));
    if (c.m.tank && !(other && other.m.tank)) return;   // armour: vehicles and walls can't hurt it
    // the heavier the other side, the more it hurts
    const ratio = other ? clamp(other.m.mass / c.m.mass, 0.25, 4) : 0.8 / Math.sqrt(c.m.mass);
    const dmg = (speed - 70) * 0.1 * ratio;
    this.damageCar(c, dmg);
    if (c.driver === G.player) G.cam.shake = Math.max(G.cam.shake, Math.min(6, speed / 70));
  },

  damageCar(c, dmg) {
    if (c.wreck) return;
    c.hp -= dmg;
    c.flash = 0.06;
  },

  destroyCar(c) {
    c.wreck = true; c.burning = false; c.hp = 0;
    c.vx *= 0.3; c.vy *= 0.3;
    c.smokeT = 7;
    this.explode(c.x, c.y, c.m.heavy || c.m.tank ? 2 : 1);
    if (c.m.volatile) { // a fuel tanker goes up along its whole length
      for (const f of [-0.35, 0.35]) { const [x, y] = c.toWorld(0, c.len * f); this.explode(x, y, 2); }
    }
    if (c.driver === G.player) this.hurtPlayer(999);
    this.earn(150, c.x, c.y);
    Missions.onCarDestroyed(c);
  },

  explode(x, y, big = 1) {
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
      const d = dist(x, y, c.x, c.y);
      if (d > 90 || d < 0.01) continue;
      const k = 1 - d / 90;
      this.damageCar(c, 110 * k * (c.m.tank ? 0.35 : 1));
      Physics.impulse(c, (c.x - x) / d, (c.y - y) / d, 380 * k * Math.min(c.m.mass, 2), c.x + (Math.random() - 0.5) * 12, c.y);
    }
    if (!G.player.car && pd < 70) this.hurtPlayer(75 * (1 - pd / 70));
  },

  // knock over a lamp post / burst a hydrant / scatter a bin
  breakProp(o, car) {
    G.obstacleGrid.remove(o);
    o.broken = true;
    const sp = Math.max(1, car.speed());
    const dx = car.vx / sp, dy = car.vy / sp;
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
      Missions.fail(null, true);
      G.respawnT = 3.5;
    }
  },

  earn(amount, x, y) {
    const v = amount * G.mult;
    G.money += v;
    if (x !== undefined) Parts.add({ k: 'pop', x, y: y - 8, vx: 0, vy: 0, life: 1.1, text: '$' + v });
    if (!G.won && G.money >= GOAL) {
      G.won = true;
      G.banner = { text: 'CITY IS YOURS', sub: 'YOU HIT $' + GOAL + ' - KEEP CRUISING', color: PAL.q, t: 5 };
    }
  },

  toast(text, t = 2.6) { G.toast = { text, t }; },

  // ---------------------------------------------------------- update --
  update(dt) {
    G.t += dt;
    if (Input.hit('time')) { G.time = (G.time + 1) % TIMES.length; G.timeFade = null; this.toast(TIMES[G.time].name); }
    if (Input.hit('daynight')) this.toggleDayNight();
    if (G.timeFade) {
      G.timeFade.t -= dt;
      if (G.timeFade.t <= 0) {
        G.time = G.timeFade.steps.shift();
        G.timeFade = G.timeFade.steps.length ? { steps: G.timeFade.steps, t: 0.6 } : null;
      }
    }
    if (G.state === 'title') {
      G.cam.cx += 22 * dt; G.cam.cy += 9 * dt;
      if (Input.hit('start') || Input.hit('click')) {
        G.state = 'play'; G.time = 0; G.timeFade = null;
        this.toast('WAIT FOR A CALL, OR FIND A RINGING PAYPHONE', 4);
      }
      Parts.update(dt);
      return;
    }
    if (Input.hit('pause')) G.paused = !G.paused;
    if (Input.hit('map')) G.showMap = !G.showMap;
    if (G.paused) return;

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

    for (const c of G.cars) c.update(dt, c.driver === p ? this.carControls() : null);
    for (let i = 0; i < G.cars.length; i++) {
      const a = G.cars[i];
      for (let j = i + 1; j < G.cars.length; j++) Physics.carVsCar(a, G.cars[j]);
    }
    for (const c of G.cars) {
      if (c.speed() > 0.5 || c.driver) {
        Physics.carVsObstacles(c);
        Physics.carVsWorld(c);
      }
      this.carEffects(c, dt);
    }
    this.updateBullets(dt);
    this.updatePickups(dt);
    Parts.update(dt);
    Missions.update(dt);
    this.maintainTraffic(dt);
    Train.update(dt);
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

    const d = City.regionAt(p.px, p.py);
    if (d !== G.district) { G.district = d; this.toast(d.name); }
    for (const k of ['banner', 'toast']) if (G[k]) { G[k].t -= dt; if (G[k].t <= 0) G[k] = null; }
    if (G.msg) { G.msg.t += dt; if (G.msg.t > G.msg.life) G.msg = null; }
  },

  carControls() {
    const ctl = { throttle: Input.throttle(), steer: Input.axis('x'), hb: Input.held('fire'), turret: Input.turret() };
    if (Input.mouse.active) { const w = this.mouseWorld(); ctl.aim = Math.atan2(w.x - G.player.px, -(w.y - G.player.py)); }
    return ctl;
  },

  mouseWorld() {
    const m = Input.mouseView();
    return { x: G.cam.x + m.x, y: G.cam.y + m.y };
  },

  // O: day <-> night, passing through dusk
  toggleDayNight() {
    const toNight = G.time === 0 || (G.timeFade && G.timeFade.steps[G.timeFade.steps.length - 1] === 0);
    G.timeFade = { steps: toNight ? [1, 2] : [1, 0], t: 0 };
    this.toast(toNight ? 'NIGHT FALLS' : 'SUNRISE', 1.8);
  },

  wantsShoot() {
    if (G.clickUsed || G.overPhone) return Input.held('fire');
    return Input.held('shoot');
  },

  updateDriving(dt, p) {
    const c = p.car;
    if (Input.hit('use')) this.exitCar(p);
    if (c.wreck) this.exitCar(p);
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
    G.cam.shake = Math.max(G.cam.shake, 4);
    Physics.impulse(c, -fx, -fy, 60 * c.m.mass, mx, my);
  },

  updateOnFoot(dt, p) {
    let mx = Input.axis('x'), my = Input.axis('y');
    const len = Math.hypot(mx, my);
    p.moving = len > 0.1;
    if (p.moving) {
      if (len > 1) { mx /= len; my /= len; }
      if (!Input.mouse.active) p.ang = Math.atan2(mx, -my);
      Physics.moveWalker(p, mx * 90 * dt, my * 90 * dt);
      p.walkT += dt * Math.min(1, len);
    }
    p.cool -= dt; p.shootT -= dt; p.hurtT -= dt;
    if (Input.hit('weapon')) {
      const owned = WEAPON_ORDER.filter((w) => w === 'fist' || p.ammo[w] > 0);
      p.weapon = owned[(owned.indexOf(p.weapon) + 1) % owned.length];
      this.toast(WEAPONS[p.weapon].name, 1.2);
    }
    if (p.weapon !== 'fist' && p.ammo[p.weapon] <= 0) p.weapon = p.ammo.uzi > 0 ? 'uzi' : p.ammo.pistol > 0 ? 'pistol' : 'fist';
    const w = WEAPONS[p.weapon];
    if (Input.mouse.active) { const m = this.mouseWorld(); p.ang = Math.atan2(m.x - p.x, -(m.y - p.y)); }
    if (w.cool && this.wantsShoot() && p.cool <= 0) this.shoot(p, w);
    if (Input.hit('use')) this.tryEnterCar(p);
  },

  shoot(p, w) {
    p.cool = w.cool;
    p.shootT = 0.15;
    p.ammo[p.weapon]--;
    const a = p.ang + (Math.random() - 0.5) * w.spread * 2;
    const fx = Math.sin(a), fy = -Math.cos(a);
    const mx = p.x + Math.sin(p.ang) * 9 + Math.cos(p.ang) * 2.5, my = p.y - Math.cos(p.ang) * 9 + Math.sin(p.ang) * 2.5;
    G.bullets.push({ x: mx, y: my, vx: fx * 560, vy: fy * 560, life: 0.55, dmg: w.dmg });
    Parts.add({ k: 'muzzle', x: mx + fx * 2, y: my + fy * 2, vx: 0, vy: 0, life: 0.05 });
    G.muzzle = { x: mx, y: my, t: 0.06 };
  },

  updateBullets(dt) {
    for (const b of G.bullets) {
      const steps = 6;
      const ox = b.x, oy = b.y;
      for (let s = 0; s < steps && b.life > 0; s++) {
        b.x += (b.vx * dt) / steps; b.y += (b.vy * dt) / steps;
        if (Physics.buildingAt(b.x, b.y)) { if (!b.shell) Parts.sparks(b.x, b.y, 4); b.life = 0; b.hit = true; break; }
        for (const c of G.cars) {
          if (c === G.player.car || c === b.src || !c.contains(b.x, b.y)) continue;
          if (!c.m.tank) this.damageCar(c, b.dmg);
          if (!b.shell) Parts.sparks(b.x, b.y, c.m.tank ? 5 : 3, c.m.tank ? PAL.j : PAL.l);
          b.life = 0; b.hit = true;
          break;
        }
      }
      Parts.add({ k: 'tracer', x: ox, y: oy, x2: b.x, y2: b.y, vx: 0, vy: 0, life: b.shell ? 0.12 : 0.06, w: b.shell ? 2 : 1 });
      b.life -= dt;
      if (b.shell && b.life <= 0) this.explode(b.x, b.y);
    }
    G.bullets = G.bullets.filter((b) => b.life > 0);
    if (G.muzzle) { G.muzzle.t -= dt; if (G.muzzle.t <= 0) G.muzzle = null; }
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

    c.smokeT -= dt;
    const hood = c.toWorld(0, c.len / 2 - 10);
    if (!c.wreck) {
      if (c.hp < c.m.hp * 0.5 && Math.random() < (1 - c.hp / c.m.hp) * 0.35) Parts.smoke(hood[0], hood[1], c.hp < c.m.hp * 0.3);
      if (c.burning && Math.random() < 0.6) {
        Parts.add({ k: 'fire', x: hood[0] + (Math.random() - 0.5) * 6, y: hood[1] + (Math.random() - 0.5) * 6, vx: 0, vy: -10, life: 0.35 });
      }
    } else if (c.smokeT > 0 && Math.random() < 0.25) Parts.smoke(c.x, c.y, true);
  },

  tryEnterCar(p) {
    let best = null, bd = 1e9;
    for (const c of G.cars) {
      if (c.wreck) continue;
      const d = dist(p.x, p.y, c.x, c.y);
      if (c.contains(p.x, p.y, 18) && d < bd) { best = c; bd = d; }
    }
    if (!best) return;
    p.car = best;
    best.driver = p;
    this.toast(best.m.name);
    Missions.onEnterCar(best);
  },

  exitCar(p) {
    const c = p.car;
    for (const [lx, lf] of [[-c.hw - 9, 0], [c.hw + 9, 0], [-c.hw - 9, c.len / 4], [c.hw + 9, -c.len / 4], [0, c.len / 2 + 9], [0, -c.len / 2 - 9]]) {
      const [x, y] = c.toWorld(lx, lf);
      if (!Physics.solidAt(x, y) && !G.cars.some((o) => o !== c && o.contains(x, y, 4))) {
        p.x = x; p.y = y; p.ang = c.ang;
        c.driver = null; p.car = null;
        return;
      }
    }
  },

  respawn() {
    const p = G.player, s = G.city.spawn;
    G.player = new Player(s.x, s.y);
    G.player.ammo = { pistol: 0, uzi: 0 };
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
      k.away = 45;
      if (k.kind === 'cash') this.earn(500, k.x, k.y);
      else if (k.kind === 'health') { p.hp = Math.min(100, p.hp + 50); this.toast('+HEALTH', 1.2); }
      else {
        p.ammo[k.kind] += k.kind === 'uzi' ? 90 : 24;
        if (!p.car) p.weapon = k.kind;
        this.toast(WEAPONS[k.kind].name + ' +' + (k.kind === 'uzi' ? 90 : 24), 1.5);
      }
      Parts.sparks(k.x, k.y, 8, PAL.Y);
    }
  },

  // keep ~50 intact parked cars around by quietly respawning off-screen
  maintainTraffic(dt) {
    G.trafficT = (G.trafficT || 0) - dt;
    if (G.trafficT > 0) return;
    G.trafficT = 2;
    const intact = G.cars.filter((c) => !c.wreck).length;
    if (intact >= 90) return;
    const spots = G.city.parkSpots.concat(G.city.stalls);
    for (let tries = 0; tries < 10; tries++) {
      const s = pick(G.R, spots);
      if (Math.abs(s.x - G.cam.cx) < G.cam.w / 2 + 120 && Math.abs(s.y - G.cam.cy) < G.cam.h / 2 + 120) continue;
      if (this.spawnParked(s)) break;
    }
    // drop far-away wrecks so the list does not grow forever
    G.cars = G.cars.filter((c) => !(c.wreck && c.smokeT < -60 && dist(c.x, c.y, G.cam.cx, G.cam.cy) > 700));
  },

  // ----------------------------------------------------------- camera --
  updateCamera(dt) {
    const p = G.player, cam = G.cam;
    let tx = p.px, ty = p.py;
    if (p.car) { tx += clamp(p.car.vx * 0.35, -170, 170); ty += clamp(p.car.vy * 0.35, -110, 110); }
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
    this.drawCars(ctx, cam);
    Train.draw(ctx, cam);
    this.drawPlayer(ctx, cam);
    Render.drawTall(ctx, cam);

    const lights = G.time ? this.collectLights(cam) : null;
    if (G.time) {
      Render.applyLighting(ctx, cam, G.time, lights);
      this.drawEmissive(ctx, cam);
    }
    Render.drawBuildings(ctx, cam, G.time);
    Parts.draw(ctx, cam);
    this.drawMarkersOver(ctx, cam);
    if (G.state === 'play') HUD.draw(ctx, cam);
    else HUD.drawTitle(ctx, cam);
    HUD.drawPointer(ctx, cam);
  },

  drawGroundLevel(ctx, cam) {
    const vis = (x, y, m = 24) => x > cam.x - m && x < cam.x + cam.w + m && y > cam.y - m && y < cam.y + cam.h + m;
    for (const p of G.city.props) {
      if (p.sprite === 'bench' || p.broken || !vis(p.x, p.y, 40)) continue;
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
      Assets.draw(ctx, 'props', Assets.frame('props', 'crate_' + k.kind), k.x - 8 - cam.x, k.y - 8 - cam.y + bob);
    }
    Missions.drawGround(ctx, cam);
  },

  drawCars(ctx, cam) {
    for (const c of G.cars) {
      const m = c.len / 2 + 10;
      if (c.x < cam.x - m || c.x > cam.x + cam.w + m || c.y < cam.y - m || c.y > cam.y + cam.h + m) continue;
      const sh = c.m.sheet;
      const f = Assets.frame(sh, c.tag, c.frame());
      const img = c.flash > 0 ? Assets.tinted(sh, '#ffffff') : null;
      ctx.globalAlpha = 0.35;
      Assets.drawRot(ctx, sh, f, c.x - cam.x + 3, c.y - cam.y + 4, c.ang, Assets.tinted(sh, '#12142e'));
      ctx.globalAlpha = 1;
      Assets.drawRot(ctx, sh, f, c.x - cam.x, c.y - cam.y, c.ang, img);
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

  drawPlayer(ctx, cam) {
    const p = G.player;
    if (p.car) return;
    let tag = 'idle', i = 0;
    if (p.dead) tag = 'dead';
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
    const on = (x, y, m) => x > cam.x - m && x < cam.x + cam.w + m && y > cam.y - m && y < cam.y + cam.h + m;
    for (const l of G.city.lamps) {
      if (l.broken || !on(l.x, l.y, 70)) continue;
      const hx = (l.x - cam.cx) * PARALLAX * 34, hy = (l.y - cam.cy) * PARALLAX * 34;
      L.push({ x: l.x + hx * 0.5, y: l.y + hy * 0.5, r: 52, color: 'rgba(255,214,150,0.85)' });
    }
    for (const c of G.cars) {
      if (!on(c.x, c.y, 140) || c.wreck) continue;
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
    L.push({ x: G.player.px, y: G.player.py, r: 40, color: 'rgba(140,150,210,0.35)' });
    Missions.lights(L);
    return L;
  },

  drawEmissive(ctx, cam) {
    Render.drawTall(ctx, cam, true);
    for (const c of G.cars) {
      if (c.wreck || c.x < cam.x - 30 || c.x > cam.x + cam.w + 30 || c.y < cam.y - 30 || c.y > cam.y + cam.h + 30) continue;
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
  draw(ctx, cam) {
    const p = G.player, W = cam.w, H = cam.h;
    // weapon
    const w = WEAPONS[p.weapon];
    Assets.draw(ctx, 'props', Assets.frame('props', w.icon), 6, 5);
    if (p.weapon !== 'fist') Font.draw(ctx, String(p.ammo[p.weapon]), 24, 9, { color: PAL.Y });
    // money + multiplier
    Font.draw(ctx, '$' + G.money, W - 6, 5, { scale: 2, align: 'right', color: PAL.Y, shadow: true });
    Font.draw(ctx, '*' + G.mult, W - 6, 24, { align: 'right', color: PAL.q });
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
    Missions.drawHUD(ctx, cam);
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
    // toast (district / car / weapon names)
    if (G.toast) {
      const a = clamp(G.toast.t * 3, 0, 1);
      ctx.globalAlpha = a;
      Font.draw(ctx, G.toast.text, 8, H - (G.msg ? 58 : 18), { color: PAL.p, shadow: true });
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
    const menu = G.state !== 'play' || G.paused || G.showMap || G.overPhone;
    if (menu) Assets.draw(ctx, 'props', Assets.frame('props', 'cursor'), m.x - 1, m.y - 1);
    else Assets.draw(ctx, 'props', Assets.frame('props', 'crosshair'), m.x - 8, m.y - 8);
  },

  drawMap(ctx, cam) {
    const m = Render.minimap, W = cam.w, H = cam.h;
    const s = Math.max(1, Math.floor(Math.min((W - 20) / m.width, (H - 30) / m.height)));
    const mw = m.width * s, mh = m.height * s;
    const x0 = Math.round((W - mw) / 2), y0 = Math.round((H - mh) / 2) + 4;
    ctx.fillStyle = 'rgba(26,28,44,0.75)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = PAL.K; ctx.fillRect(x0 - 2, y0 - 2, mw + 4, mh + 4);
    ctx.drawImage(m, x0, y0, mw, mh);
    const dot = (x, y, col, r = 2) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x0 + (x / TILE) * s - r), Math.round(y0 + (y / TILE) * s - r), r * 2 + 1, r * 2 + 1); };
    G.city.phones.forEach((ph, i) => dot(ph.x, ph.y, Missions.ringing === i ? PAL.q : PAL.e));
    const t = Missions.target();
    if (t && Math.floor(G.t * 3) % 2) dot(t.x, t.y, PAL.L, 3);
    if (Math.floor(G.t * 4) % 2) dot(G.player.px, G.player.py, PAL.z, 2);
    Font.draw(ctx, 'CITY MAP  (M)', W / 2, y0 - 12, { align: 'center', color: PAL.c });
  },

  controls(ctx, x, y) {
    const lines = [
      'ARROWS / WASD   WALK, DRIVE',
      'MOUSE           AIM   LEFT: SHOOT',
      'RIGHT CLICK / C CELLPHONE',
      'E / ENTER       ENTER / EXIT CAR',
      'SPACE           HANDBRAKE / SHOOT',
      'Q / TAB         SWITCH WEAPON',
      'Z / X           TANK TURRET',
      'O DAY/NIGHT  N DUSK  M MAP  P PAUSE',
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
      Game.update(STEP);
      Input.endTick();
      this.acc -= STEP;
    }
    Game.updateCamera(dt);
    Game.render(this.low.ctx);
    this.ctx.drawImage(this.low, 0, 0, this.cv.width, this.cv.height);
  },

  // #demo — scripted start for screenshots/tests, e.g. #demo&drive=90&time=2
  demo(params) {
    G.state = 'play';
    G.time = +(params.get('time') || 0);
    const drive = +(params.get('drive') || 0);
    const p = G.player;
    if (params.has('at')) {
      const [bx, by] = params.get('at').split(',').map(Number);
      const b = G.city.blocks.find((b) => bx >= b.bx0 && bx <= b.bx1 && by >= b.by0 && by <= b.by1);
      p.x = (b.x0 + 8.5) * TILE; p.y = (b.y1 - 1) * TILE + 4;
      G.cam.cx = p.x; G.cam.cy = p.y;
      if (params.has('look')) { const [lx, ly] = params.get('look').split(',').map(Number); G.cam.cx = (b.x0 + lx) * TILE; G.cam.cy = (b.y0 + ly) * TILE; G.lockCam = true; }
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
    for (let i = 0; i < 30; i++) { Game.update(STEP); Game.updateCamera(STEP); }
  },
};

// =========================================================== freight train ==
// Shuttles along the Ironworks railway between two buffer stops, with a
// locomotive at each end. It can't be stopped: whatever sits on the track is
// shoved aside and damaged (the tank only gets shoved).
const Train = {
  init(rail) {
    this.rail = rail;
    this.cars = [
      { tag: 'loco', len: 112, ang: Math.PI / 2 }, { tag: 'boxcar', len: 104 }, { tag: 'tankcar', len: 104 },
      { tag: 'flatcar', len: 104 }, { tag: 'boxcar', len: 104 }, { tag: 'loco', len: 112, ang: -Math.PI / 2 },
    ];
    this.gap = 6;
    this.len = this.cars.reduce((a, c) => a + c.len, 0) + this.gap * (this.cars.length - 1);
    this.x = rail.x0 + this.len / 2 + 4;
    this.v = 0; this.dir = 1; this.wait = 3;
    this.vmax = 150; this.acc = 45;
  },
  segments() {
    const out = [];
    let east = this.x + this.len / 2;
    for (const c of this.cars) { out.push({ c, x0: east - c.len, x1: east, cx: east - c.len / 2 }); east -= c.len + this.gap; }
    return out;
  },
  update(dt) {
    const r = this.rail;
    const lo = r.x0 + this.len / 2 + 4, hi = r.x1 - this.len / 2 - 4;
    if (this.wait > 0) { this.wait -= dt; this.v = 0; return this.collide(dt); }
    const toEnd = this.dir > 0 ? hi - this.x : this.x - lo;
    const stopDist = (this.v * this.v) / (2 * this.acc);
    const speed = Math.abs(this.v);
    const want = toEnd <= stopDist + 2 ? Math.max(0, speed - this.acc * dt) : Math.min(this.vmax, speed + this.acc * dt);
    this.v = want * this.dir;
    this.x = clamp(this.x + this.v * dt, lo, hi);
    if ((this.dir > 0 && this.x >= hi - 0.5) || (this.dir < 0 && this.x <= lo + 0.5)) { this.dir *= -1; this.wait = 7; this.v = 0; }
    this.collide(dt);
  },
  collide(dt) {
    const y = this.rail.y, half = 17;
    const x0 = this.x - this.len / 2, x1 = this.x + this.len / 2;
    for (const c of G.cars) {
      if (Math.abs(c.y - y) > half + c.len / 2 + 4 || c.x < x0 - c.len || c.x > x1 + c.len) continue;
      for (const [px, py] of c.circles()) {
        if (px < x0 - c.hw || px > x1 + c.hw) continue;
        const dy = py - y, over = half + c.hw - Math.abs(dy);
        if (over <= 0) continue;
        const s = dy >= 0 ? 1 : -1;
        c.y += s * over;
        c.vy = s * Math.max(Math.abs(c.vy), 90 + Math.abs(this.v) * 0.6);
        c.vx += this.v * 0.5;
        c.spin += (Math.random() - 0.5) * 3;
        if (!c.m.tank && Math.abs(this.v) > 20 && !(c.trainHit > 0)) { Game.damageCar(c, 18 + Math.abs(this.v) * 0.25); c.trainHit = 0.5; Parts.sparks(px, y + s * half, 8); }
        break;
      }
      if (c.trainHit > 0) c.trainHit -= dt;
    }
    const p = G.player;
    if (!p.car && !p.dead && p.x > x0 - 4 && p.x < x1 + 4 && Math.abs(p.y - y) < half + 5) {
      const s = p.y >= y ? 1 : -1;
      p.y = y + s * (half + 6);
      if (Math.abs(this.v) > 10) Game.hurtPlayer(40);
    }
  },
  draw(ctx, cam) {
    const y = this.rail.y;
    if (y < cam.y - 40 || y > cam.y + cam.h + 40) return;
    for (const s of this.segments()) {
      if (s.x1 < cam.x - 20 || s.x0 > cam.x + cam.w + 20) continue;
      const f = Assets.frame('rail', s.c.tag);
      const ang = s.c.ang || Math.PI / 2;
      ctx.globalAlpha = 0.35;
      Assets.drawRot(ctx, 'rail', f, s.cx - cam.x + 3, y - cam.y + 4, ang, Assets.tinted('rail', '#12142e'));
      ctx.globalAlpha = 1;
      Assets.drawRot(ctx, 'rail', f, s.cx - cam.x, y - cam.y, ang);
    }
  },
  lights(L) {
    const segs = this.segments();
    const front = this.dir > 0 ? segs[0] : segs[segs.length - 1];
    L.push({ cone: true, x: this.dir > 0 ? front.x1 : front.x0, y: this.rail.y, ang: this.dir > 0 ? Math.PI / 2 : -Math.PI / 2 });
  },
};
