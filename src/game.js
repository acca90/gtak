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
function hasSprite(sheet, tag) { const s = Assets.sheets[sheet]; return !!(s && s.tags[tag]); }

const Game = {
  // ------------------------------------------------------------- setup --
  start(seed) {
    G.city = City.build(seed);
    G.R = rng(seed ^ 0x5eed);
    G.obstacleGrid = new Grid(G.city.obstacles);
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
    let model = randomModel(G.R, maxLen, weights);
    if (!this.roomFor(s, MODELS[model].len)) model = randomModel(G.R, 58, weights);
    if (!this.roomFor(s, MODELS[model].len)) return null;
    return this.spawnCar(model, s);
  },

  // ----------------------------------------------------------- events --
  impact(c, speed, x, y, other) {
    Sound.impact(c, speed, x, y, other);
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
    c.sirenOn = false; c.honking = false; c.hornT = -1;
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

  // o (optional): { r: car radius px, car: max car damage, pr: player radius, player: max player
  // damage }. The defaults are the tank shell's; the tank takes 35% (vehicles-agent's armour rule).
  explode(x, y, big = 1, o) {
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
      this.damageCar(c, CAR * k * (c.m.tank ? 0.35 : 1));
      Physics.impulse(c, (c.x - x) / d, (c.y - y) / d, 380 * k * Math.min(c.m.mass, 2), c.x + (Math.random() - 0.5) * 12, c.y);
    }
    if (!G.player.car && pd < PR) this.hurtPlayer(PD * (1 - pd / PR));
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
        Sound.ui('start');
        this.toast('WAIT FOR A CALL, OR FIND A RINGING PAYPHONE', 4);
      }
      Parts.update(dt);
      return;
    }
    if (Input.hit('volDown') || Input.hit('volUp')) this.toast('VOLUME ' + Sound.step(Input.hit('volUp') ? 1 : -1) + '%', 1.2);
    if (Input.hit('mute')) this.toast(Sound.toggleMute() ? 'SOUND OFF' : 'SOUND ON', 1.2);
    if (Shop.open) { Shop.update(dt); return; }   // the world waits while you shop
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
    if (!p.dead && !p.car) Shop.check(p);

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
    this.updateProjectiles(dt);
    this.updateFires(dt);
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

  // O: day <-> night, passing through dusk
  toggleDayNight() {
    const toNight = G.time === 0 || (G.timeFade && G.timeFade.steps[G.timeFade.steps.length - 1] === 0);
    G.timeFade = { steps: toNight ? [1, 2] : [1, 0], t: 0 };
    Sound.ui('swoosh');
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
    if (w.cool && this.wantsShoot() && p.cool <= 0) this.shoot(p, w);
    if (Input.hit('use')) this.tryEnterCar(p);
  },

  selectWeapon(p, id) {
    p.weapon = id;
    p.cool = Math.max(p.cool, 0.12);   // a beat to bring it up
    Sound.ui('cock');
    this.toast(WEAPONS[id].name, 1.2);
  },

  // fire the current weapon once (cooldown and ammo are checked by the caller)
  shoot(p, w) {
    p.cool = w.cool;
    p.shootT = w.type === 'thrown' ? 0.25 : 0.15;
    p.ammo[p.weapon]--;
    const fx0 = Math.sin(p.ang), fy0 = -Math.cos(p.ang);
    const mx = p.x + fx0 * 9 + Math.cos(p.ang) * 2.5, my = p.y + fy0 * 9 + Math.sin(p.ang) * 2.5;
    if (w.type === 'thrown') this.throwProjectile(p, w, mx, my);
    else if (w.type === 'rocket') {
      G.projectiles.push({ k: 'rocket', x: mx + fx0 * 4, y: my + fy0 * 4, vx: fx0 * w.speed, vy: fy0 * w.speed, ang: p.ang, life: w.life, w, h: 0 });
      // back-blast out of the tube
      for (let i = 0; i < 5; i++) Parts.add({ k: 'smoke', x: p.x - fx0 * 10, y: p.y - fy0 * 10, vx: -fx0 * (40 + Math.random() * 60) + (Math.random() - 0.5) * 30, vy: -fy0 * (40 + Math.random() * 60) + (Math.random() - 0.5) * 30, life: 0.8 + Math.random() * 0.4 });
      Parts.add({ k: 'muzzle', big: true, x: mx + fx0 * 3, y: my + fy0 * 3, vx: 0, vy: 0, life: 0.07 });
      G.muzzle = { x: mx, y: my, t: 0.1 };
    } else {
      const n = w.pellets || 1;
      for (let i = 0; i < n; i++) {
        // pellets fan evenly across the spread with a little jitter; single rounds are random
        const off = n > 1 ? ((i + 0.5) / n - 0.5) * 2 * w.spread + (Math.random() - 0.5) * w.spread * 0.35 : (Math.random() - 0.5) * w.spread * 2;
        const a = p.ang + off, fx = Math.sin(a), fy = -Math.cos(a), sp = w.speed * (n > 1 ? 0.9 + Math.random() * 0.2 : 1);
        G.bullets.push({ x: mx, y: my, vx: fx * sp, vy: fy * sp, life: w.life * (n > 1 ? 0.85 + Math.random() * 0.3 : 1), dmg: w.dmg, push: w.push || 0 });
      }
      Parts.add({ k: 'muzzle', big: n > 1, x: mx + fx0 * 2, y: my + fy0 * 2, vx: 0, vy: 0, life: n > 1 ? 0.07 : 0.05 });
      if (n > 1) { for (let i = 0; i < 2; i++) Parts.smoke(mx + fx0 * 4, my + fy0 * 4, false); Physics.moveWalker(p, -fx0 * 2, -fy0 * 2); }
      G.muzzle = { x: mx, y: my, t: n > 1 ? 0.09 : 0.06 };
    }
    if (w.shake) G.cam.shake = Math.max(G.cam.shake, w.shake);
    Sound.shot(p.weapon, mx, my, p.ammo[p.weapon]);   // guns, bazooka launch, grenade pin + throw, molotov throw
  },

  // grenade / molotov: lob toward the crosshair (or straight ahead without a mouse)
  throwProjectile(p, w, x, y) {
    let d = 110, a = p.ang;
    if (Input.mouse.active) { const m = this.mouseWorld(); d = dist(p.x, p.y, m.x, m.y); }
    if (p.throwAt) d = p.throwAt;   // #demo
    d = clamp(d, 24, w.range);
    const T = 0.32 + d / 420;          // time in the air to the aim point
    const sp = d / T, g = 520;
    G.projectiles.push({ k: w.proj, w, x, y, h: 8, vx: Math.sin(a) * sp, vy: -Math.cos(a) * sp, vh: g * T / 2 - 8 / T, g,
      fuse: w.fuse || 0, spin: a, vspin: (Math.random() < 0.5 ? -1 : 1) * (9 + Math.random() * 5), bounces: 0 });
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
    if (car) this.damageCar(car, w.direct * (car.m.tank ? 0.35 : 1));   // explosive: tank armour applies
    this.explode(x, y, 1, w.blast);
  },
  grenadeBlast(q) {
    q.dead = true;
    if (this.waterAt(q.x, q.y)) return this.sink(q);
    this.explode(q.x, q.y, 1, q.w.blast);
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
    G.fires.push({ x, y, r: F.r, t: F.t, life: F.t, w: q.w });
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
        if (c.fireT % 0.5 < dt) { this.damageCar(c, c.heat); c.heat = 0; }
        if (c.fireT > F.ignite && !c.m.tank) c.burning = true;   // the tank's armour doesn't catch
      }
      if (!p.dead && !p.car && dist(p.x, p.y, f.x, f.y) < f.r * 0.85 + 3) this.hurtPlayer(F.player * dt);
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

  updateBullets(dt) {
    for (const b of G.bullets) {
      const steps = 6;
      const ox = b.x, oy = b.y;
      for (let s = 0; s < steps && b.life > 0; s++) {
        b.x += (b.vx * dt) / steps; b.y += (b.vy * dt) / steps;
        if (!b.shell && Physics.buildingAt(b.x, b.y)) Sound.play('ricochet', b.x, b.y);
        if (Physics.buildingAt(b.x, b.y)) { if (!b.shell) Parts.sparks(b.x, b.y, 4); b.life = 0; b.hit = true; break; }
        for (const c of G.cars) {
          if (c === G.player.car || c === b.src || !c.contains(b.x, b.y)) continue;
          if (!c.m.tank) this.damageCar(c, b.dmg);
          if (b.push) { const v = Math.hypot(b.vx, b.vy); Physics.impulse(c, b.vx / v, b.vy / v, b.push, b.x, b.y); }   // shotgun shove
          if (!b.shell) Parts.sparks(b.x, b.y, c.m.tank ? 5 : 3, c.m.tank ? PAL.j : PAL.l);
          if (!b.shell) Sound.play(c.m.tank ? 'clang' : 'ping', b.x, b.y);
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
      if (c.wreck || c.alt > 2) continue;   // not a helicopter on a roof or in the air
      const d = dist(p.x, p.y, c.x, c.y);
      if (c.contains(p.x, p.y, 18) && d < bd) { best = c; bd = d; }
    }
    if (!best) return;
    p.car = best;
    best.driver = p;
    Sound.door(best, true);
    this.toast(best.m.name);
    Missions.onEnterCar(best);
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
      k.away = 45;
      Sound.pickup(k.kind);
      if (k.kind === 'cash') this.earn(500, k.x, k.y);
      else if (k.kind === 'health') { p.hp = Math.min(100, p.hp + 50); this.toast('+HEALTH', 1.2); }
      else {
        const w = WEAPONS[k.kind], n = w.crate || 0;
        p.ammo[k.kind] = Math.min(w.shop ? w.shop.max : 999, (p.ammo[k.kind] || 0) + n);
        if (!p.car) p.weapon = k.kind;
        this.toast(w.name + ' +' + n, 1.5);
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
    this.drawFires(ctx, cam);
    this.drawCars(ctx, cam);
    Train.draw(ctx, cam);
    this.drawPlayer(ctx, cam);
    this.drawProjectiles(ctx, cam);
    Render.drawTall(ctx, cam);

    const lights = G.time ? this.collectLights(cam) : null;
    if (G.time) {
      Render.applyLighting(ctx, cam, G.time, lights);
      this.drawEmissive(ctx, cam);
    }
    Render.drawBuildings(ctx, cam, G.time);
    this.drawAir(ctx, cam);
    Parts.draw(ctx, cam);
    this.drawMarkersOver(ctx, cam);
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
      Assets.draw(ctx, 'props', Assets.frame('props', 'crate_' + k.kind), k.x - 8 - cam.x, k.y - 8 - cam.y + bob);
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
      const img = c.flash > 0 ? Assets.tinted(sh, '#ffffff') : c.wreck && c.m.air ? Assets.tinted(sh, '#2b2d42') : null;
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
      const T = TIMES[G.time];
      if (T.ambient) { // not touched by the light pass, so darken it like the roofs
        ctx.globalAlpha = G.time === 2 ? 0.55 : 0.25;
        Assets.drawRot(ctx, sh, f, x, y, c.ang, Assets.tinted(sh, T.ambient));
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
    const menu = G.state !== 'play' || G.paused || G.showMap || G.overPhone || Shop.open;
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
    const t = Missions.target();
    if (t && Math.floor(G.t * 3) % 2) dot(t.x, t.y, PAL.L, 3);
    if (Math.floor(G.t * 4) % 2) dot(G.player.px, G.player.py, PAL.z, 2);
    Font.draw(ctx, 'MAP  (M)', W / 2, y0 - 12, { align: 'center', color: PAL.c });
    if (G.place && G.place.neighborhood) Font.draw(ctx, G.place.neighborhood, W / 2, y0 + mh + 6, { align: 'center', color: PAL.p });
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
      'O DAY/NIGHT  N DUSK  M MAP  P PAUSE',
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
    // wfire=<id>,<ang|car>,<n>[,<ticks>]: that weapon with full ammo, facing ang (radians, 0 = up)
    // or the nearest parked car (throws land on it), fire n times at the weapon's rate, and run
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
    const p = G.player;
    if (p.car || p.dead) return;
    const pa = (p.x - ox) * ux + (p.y - oy) * uy, pb = (p.x - ox) * nx + (p.y - oy) * ny;
    if (pa > a0 - 4 && pa < a1 + 4 && Math.abs(pb) < half + 5) {
      const sg = pb >= 0 ? 1 : -1, push = sg * (half + 6) - pb;
      p.x += nx * push; p.y += ny * push;
      if (Math.abs(this.v) > 10) Game.hurtPlayer(40);
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
