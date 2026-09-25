'use strict';
// Vehicles, the player, particles — and the physics between them.

// w/len in pixels; speeds in px/s. `sheet` is the Aseprite sheet, the tag is the model name
// (the tank's hull tag is "hull").
// Ranked from slow/heavy/tough to fast/light. Collision damage scales with the
// other vehicle's mass, so trucks and buses win fights. The tank is immune to
// collisions and small arms; only explosions hurt it.
const MODELS = {
  //           name              sheet    w   len   max  acc  brake steer grip  mass  hp
  semi:       { name: 'ROADKING RIG', sheet: 'heavy', w: 32, len: 164, max: 215, acc: 110, brake: 420, steer: 1.35, grip: 1000, mass: 7.0, hp: 480, weight: 2, heavy: true },
  bus:        { name: 'CITY LINER',   sheet: 'heavy', w: 34, len: 120, max: 205, acc: 105, brake: 430, steer: 1.45, grip: 1000, mass: 5.0, hp: 420, weight: 2, heavy: true },
  truck:      { name: 'HAULMARK BOX', sheet: 'heavy', w: 32, len: 84,  max: 230, acc: 125, brake: 460, steer: 1.7,  grip: 1050, mass: 3.5, hp: 340, weight: 4, heavy: true },
  van:        { name: 'MULE VAN',     sheet: 'cars',  w: 28, len: 58,  max: 255, acc: 160, brake: 540, steer: 2.1,  grip: 1150, mass: 1.9, hp: 190, weight: 7 },
  pickup:     { name: 'RANCHERO',     sheet: 'cars',  w: 28, len: 58,  max: 290, acc: 200, brake: 560, steer: 2.3,  grip: 1200, mass: 1.7, hp: 180, weight: 10 },
  suv:        { name: 'TRAILMASTER',  sheet: 'cars',  w: 28, len: 56,  max: 300, acc: 210, brake: 580, steer: 2.3,  grip: 1250, mass: 1.6, hp: 170, weight: 14 },
  hatch:      { name: 'PIPPA HATCH',  sheet: 'cars',  w: 24, len: 44,  max: 290, acc: 215, brake: 600, steer: 2.9,  grip: 1400, mass: 0.85, hp: 85, weight: 18 },
  sedan:      { name: 'LUMEN SEDAN',  sheet: 'cars',  w: 26, len: 52,  max: 310, acc: 220, brake: 620, steer: 2.7,  grip: 1400, mass: 1.0, hp: 110, weight: 20 },
  taxi:       { name: 'CAB-O-MATIC',  sheet: 'cars',  w: 26, len: 52,  max: 320, acc: 230, brake: 620, steer: 2.75, grip: 1400, mass: 1.0, hp: 115, weight: 8 },
  muscle:     { name: 'BRUISER',      sheet: 'cars',  w: 26, len: 54,  max: 370, acc: 330, brake: 640, steer: 2.5,  grip: 1100, mass: 1.25, hp: 130, weight: 6 },
  police_suv: { name: 'RANGER UNIT',  sheet: 'cars',  w: 28, len: 56,  max: 375, acc: 300, brake: 700, steer: 2.6,  grip: 1450, mass: 1.8, hp: 220, weight: 2 },
  police:     { name: 'INTERCEPTOR',  sheet: 'cars',  w: 26, len: 52,  max: 400, acc: 330, brake: 740, steer: 2.9,  grip: 1550, mass: 1.2, hp: 150, weight: 3 },
  sport:      { name: 'VELOCE GT',    sheet: 'cars',  w: 26, len: 50,  max: 430, acc: 380, brake: 780, steer: 3.0,  grip: 1650, mass: 0.95, hp: 100, weight: 5 },
  tanker:     { name: 'FUELMASTER',   sheet: 'heavy', w: 32, len: 164, max: 205, acc: 100, brake: 420, steer: 1.35, grip: 1000, mass: 7.5, hp: 380, heavy: true, volatile: true },
  flatbed:    { name: 'TIMBERLINE',   sheet: 'heavy', w: 32, len: 96,  max: 225, acc: 120, brake: 460, steer: 1.6,  grip: 1050, mass: 3.8, hp: 330, heavy: true },
  mixer:      { name: 'ROTOMIX',      sheet: 'heavy', w: 32, len: 84,  max: 215, acc: 110, brake: 460, steer: 1.7,  grip: 1050, mass: 4.5, hp: 380, heavy: true },
  garbage:    { name: 'CURBSIDE 9',   sheet: 'heavy', w: 32, len: 80,  max: 210, acc: 110, brake: 460, steer: 1.75, grip: 1050, mass: 4.0, hp: 360, heavy: true },
  tractor:    { name: 'FIELDHAND',    sheet: 'cars',  w: 26, len: 40,  max: 150, acc: 130, brake: 500, steer: 2.3,  grip: 1500, mass: 2.2, hp: 200 },
  forklift:   { name: 'LIFTMATE',     sheet: 'cars',  w: 20, len: 34,  max: 120, acc: 140, brake: 520, steer: 3.3,  grip: 1600, mass: 1.8, hp: 150 },
  harvester:  { name: 'REAPER 5000',  sheet: 'wide',  w: 44, len: 72,  max: 110, acc: 80,  brake: 400, steer: 1.4,  grip: 1400, mass: 6.0, hp: 400, heavy: true },
  tank:       { name: 'M-9 RHINO',    sheet: 'tank',  w: 36, len: 60,  max: 165, acc: 170, brake: 600, steer: 1.8,  grip: 3000, mass: 14,  hp: 900, weight: 0, tank: true, tag: 'hull' },
};
const MODEL_NAMES = Object.keys(MODELS);
// weights: { model: weight } (per region, see REGIONS in city.js)
function randomModel(R, maxLen = 999, weights) {
  const names = Object.keys(weights).filter((n) => MODELS[n].len <= maxLen);
  let r = R() * names.reduce((a, n) => a + weights[n], 0);
  for (const n of names) { r -= weights[n]; if (r <= 0) return n; }
  return 'sedan';
}

const WEAPONS = {
  fist:   { name: 'FISTS', icon: 'icon_fist' },
  pistol: { name: 'PISTOL', icon: 'icon_pistol', cool: 0.32, dmg: 9, spread: 0.03 },
  uzi:    { name: 'UZI', icon: 'icon_uzi', cool: 0.085, dmg: 5, spread: 0.09 },
};
const WEAPON_ORDER = ['fist', 'pistol', 'uzi'];

class Car {
  constructor(model, x, y, ang) {
    this.model = model;
    this.m = MODELS[model];
    this.len = this.m.len;
    this.hw = this.m.w / 2;
    this.tag = this.m.tag || model;
    this.x = x; this.y = y; this.ang = ang;
    this.vx = 0; this.vy = 0; this.spin = 0;
    this.hp = this.m.hp;
    this.wreck = false;
    this.burning = false;
    this.driver = null;
    this.brake = false;
    this.skid = false;
    this.smokeT = 0;
    this.flash = 0;
    this.wheelPrev = null;
    this.odo = 0;
    if (this.m.tank) { this.turret = 0; this.reload = 0; this.recoil = 0; }
    // collision circles along the axis, radius = half width
    const r = this.hw, span = this.len / 2 - r;
    const n = Math.max(2, Math.ceil((span * 2) / r) + 1);
    this.circleOffs = [];
    for (let i = 0; i < n; i++) this.circleOffs.push(-span + (2 * span * i) / (n - 1));
    // hull sample points for world collision: corners, sides every ~12px, ends
    this.points = [];
    const hl = this.len / 2 - 0.5, hw = this.hw - 0.5;
    const ns = Math.max(1, Math.round(this.len / 12));
    for (let i = 0; i <= ns; i++) { const f = -hl + (2 * hl * i) / ns; this.points.push([-hw, f], [hw, f]); }
    for (const lx of [-hw / 2, 0, hw / 2]) this.points.push([lx, hl], [lx, -hl]);
  }
  get fx() { return Math.sin(this.ang); }
  get fy() { return -Math.cos(this.ang); }
  speed() { return Math.hypot(this.vx, this.vy); }
  vf() { return this.vx * this.fx + this.vy * this.fy; }
  toWorld(lx, lf) {
    const fx = this.fx, fy = this.fy;
    return [this.x - fy * lx + fx * lf, this.y + fx * lx + fy * lf];
  }
  toLocal(wx, wy) {
    const dx = wx - this.x, dy = wy - this.y, fx = this.fx, fy = this.fy;
    return [-fy * dx + fx * dy, fx * dx + fy * dy];
  }
  contains(wx, wy, pad = 0) {
    const [lx, lf] = this.toLocal(wx, wy);
    return Math.abs(lx) < this.hw + pad && Math.abs(lf) < this.len / 2 + pad;
  }
  circles() {
    const fx = this.fx, fy = this.fy;
    return this.circleOffs.map((o) => [this.x + fx * o, this.y + fy * o]);
  }

  update(dt, ctl) {
    this.px = this.x; this.py = this.y; this.pang = this.ang;
    const m = this.m;
    const fx = this.fx, fy = this.fy, rx = -fy, ry = fx;
    let vf = this.vx * fx + this.vy * fy;
    let vr = this.vx * rx + this.vy * ry;
    let thr = 0, steer = 0, hb = false;
    const driven = ctl && !this.wreck;
    if (driven) { thr = ctl.throttle; steer = ctl.steer; hb = ctl.hb && !m.tank; }
    if (this.burning) thr *= 0.6;

    this.brake = false;
    if (thr > 0) {
      if (vf < -10) { vf = Math.min(0, vf + m.brake * dt); this.brake = true; }
      else if (vf < m.max) vf += m.acc * thr * dt * (1 - 0.55 * Math.max(0, vf) / m.max);
    } else if (thr < 0) {
      if (vf > 10) { vf = Math.max(0, vf - m.brake * dt * -thr); this.brake = true; }
      else if (vf > -m.max * 0.4) vf -= m.acc * 0.6 * -thr * dt;
    } else {
      const drag = driven ? 110 : 450;
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), drag * dt);
    }
    if (hb) { vf -= Math.sign(vf) * Math.min(Math.abs(vf), 240 * dt); this.brake = true; }
    vf *= 1 - 0.12 * dt;

    const grip = (hb ? m.grip * 0.17 : m.grip) * (driven ? 1 : 2.5);
    vr -= Math.sign(vr) * Math.min(Math.abs(vr), grip * dt);

    // tanks pivot on the spot; everything else needs to be rolling to turn
    const sp = m.tank ? (vf < -5 ? -1 : 1) : clamp(Math.abs(vf) / 120, 0, 1) * Math.sign(vf);
    const rate = m.steer * (1 - 0.3 * clamp(Math.abs(vf) / m.max, 0, 1)) * (hb ? 1.45 : 1);
    this.ang += steer * rate * sp * dt + this.spin * dt;
    this.spin *= Math.exp(-4.5 * dt);

    this.vx = fx * vf + rx * vr;
    this.vy = fy * vf + ry * vr;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.odo += Math.abs(vf) * dt + (m.tank ? Math.abs(steer) * 20 * dt : 0);
    this.skid = !m.tank && (Math.abs(vr) > 85 || (hb && Math.abs(vf) > 80) || (this.brake && Math.abs(vf) > 220));
    this.slip = Math.abs(vr);

    if (m.tank) {
      this.reload -= dt;
      this.recoil = Math.max(0, this.recoil - dt * 20);
      if (driven && ctl.turret) this.turret += ctl.turret * 2.4 * dt;
      else if (driven && ctl.aim !== undefined) {
        const d = angDiff(this.ang + this.turret, ctl.aim);
        this.turret += clamp(d, -2.8 * dt, 2.8 * dt);
      }
    }

    if (!this.wreck) {
      if (this.hp < this.m.hp * 0.25) this.burning = true;
      if (this.burning) this.hp -= Math.max(5, this.m.hp * 0.05) * dt;
      if (this.hp <= 0) Game.destroyCar(this);
    }
    if (this.flash > 0) this.flash -= dt;
  }

  // sprite frame within the model's tag
  frame() {
    if (this.wreck) return 2;
    if (this.m.tank) return Math.floor(this.odo / 6) % 2;
    return this.brake ? 1 : 0;
  }
}

class Player {
  constructor(x, y) {
    this.x = x; this.y = y; this.ang = 0;
    this.hp = 100;
    this.car = null;
    this.ammo = { pistol: 0, uzi: 0 };
    this.weapon = 'fist';
    this.walkT = 0; this.moving = false;
    this.cool = 0; this.shootT = 0;
    this.dead = false;
    this.hurtT = 0;
  }
  get px() { return this.car ? this.car.x : this.x; }
  get py() { return this.car ? this.car.y : this.y; }
}

// ------------------------------------------------------------- physics --
const Physics = {
  solidTile(tx, ty) {
    const c = G.city;
    if (tx < 0 || ty < 0 || tx >= c.W || ty >= c.H) return 2;
    return c.solid[ty * c.W + tx];
  },
  solidAt(x, y) { return this.solidTile(Math.floor(x / TILE), Math.floor(y / TILE)); },
  buildingAt(x, y) { return this.solidAt(x, y) === 1; },

  // shortest way out of the solid tile containing (x, y), toward an open neighbour
  pushOut(x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    let best = null;
    for (const [nx, ny, d] of [[-1, 0, x - tx * TILE], [1, 0, (tx + 1) * TILE - x], [0, -1, y - ty * TILE], [0, 1, (ty + 1) * TILE - y]]) {
      if (this.solidTile(tx + nx, ty + ny)) continue;
      if (!best || d < best[2]) best = [nx, ny, d];
    }
    return best;
  },

  impulse(c, nx, ny, j, wx, wy) {
    c.vx += (nx * j) / c.m.mass;
    c.vy += (ny * j) / c.m.mass;
    const rx = wx - c.x, ry = wy - c.y;
    const torque = rx * ny * j - ry * nx * j;
    const inertia = c.m.mass * (c.len * c.len) / 700;
    c.spin = clamp(c.spin + (torque * 0.006) / inertia, -7, 7);
  },

  carVsWorld(c) {
    for (let it = 0; it < 3; it++) {
      let any = false;
      for (const [lx, lf] of c.points) {
        const [wx, wy] = c.toWorld(lx, lf);
        if (!this.solidAt(wx, wy)) continue;
        const p = this.pushOut(wx, wy);
        if (!p) { c.x = c.px; c.y = c.py; c.ang = c.pang; c.vx *= -0.3; c.vy *= -0.3; return; }
        const [nx, ny, d] = p;
        c.x += nx * (d + 0.05); c.y += ny * (d + 0.05);
        any = true;
        const vn = c.vx * nx + c.vy * ny;
        if (vn < 0) {
          this.impulse(c, nx, ny, -1.3 * vn * c.m.mass, wx, wy);
          c.vx *= 0.96; c.vy *= 0.96;
          Game.impact(c, -vn, wx, wy);
        }
      }
      if (!any) break;
    }
  },

  carVsCar(a, b) {
    const reach = (a.len + b.len) / 2 + 4;
    if (Math.abs(a.x - b.x) > reach || Math.abs(a.y - b.y) > reach) return;
    const ca = a.circles(), cb = b.circles();
    const rr = a.hw + b.hw;
    let hit = false;
    for (const p of ca) {
      for (const q of cb) {
        const dx = q[0] - p[0], dy = q[1] - p[1];
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 === 0) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, over = rr - d;
        const ma = a.m.mass * (a.wreck ? 1.6 : 1), mb = b.m.mass * (b.wreck ? 1.6 : 1);
        const ta = mb / (ma + mb), tb = ma / (ma + mb);
        a.x -= nx * over * ta; a.y -= ny * over * ta;
        b.x += nx * over * tb; b.y += ny * over * tb;
        if (hit) continue;
        const vrel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vrel < 0) {
          hit = true;
          const j = (-(1 + 0.3) * vrel) / (1 / ma + 1 / mb);
          const cx = (p[0] + q[0]) / 2, cy = (p[1] + q[1]) / 2;
          this.impulse(a, -nx, -ny, j * a.m.mass / ma, cx, cy);
          this.impulse(b, nx, ny, j * b.m.mass / mb, cx, cy);
          Game.impact(a, -vrel, cx, cy, b);
          Game.impact(b, -vrel, cx, cy, a);
        }
      }
    }
  },

  carVsObstacles(c) {
    const r = c.hw;
    for (const o of G.obstacleGrid.near(c.x, c.y, c.len)) {
      for (const p of c.circles()) {
        const dx = p[0] - o.x, dy = p[1] - o.y, rr = o.r + r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 === 0) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
        const vn = c.vx * nx + c.vy * ny;
        // street furniture gives way to a fast car (and to the tank at any speed)
        if (o.breakable && (-vn > 90 || (c.m.tank && -vn > 5))) {
          Game.breakProp(o, c);
          c.vx *= c.m.tank ? 0.98 : 0.88; c.vy *= c.m.tank ? 0.98 : 0.88;
          break;
        }
        c.x += nx * (rr - d); c.y += ny * (rr - d);
        if (vn < 0) { this.impulse(c, nx, ny, -1.3 * vn * c.m.mass, o.x + nx * o.r, o.y + ny * o.r); Game.impact(c, -vn, o.x + nx * o.r, o.y + ny * o.r); }
      }
    }
  },

  // circle-shaped walker vs everything
  moveWalker(p, dx, dy, r = 4) {
    const blocked = (x, y) =>
      this.solidAt(x - r, y - r) || this.solidAt(x + r, y - r) || this.solidAt(x - r, y + r) || this.solidAt(x + r, y + r);
    if (!blocked(p.x + dx, p.y)) p.x += dx;
    if (!blocked(p.x, p.y + dy)) p.y += dy;
    for (const o of G.obstacleGrid.near(p.x, p.y)) {
      const ddx = p.x - o.x, ddy = p.y - o.y, rr = o.r + r, d = Math.hypot(ddx, ddy);
      if (d < rr && d > 0) { p.x = o.x + (ddx / d) * rr; p.y = o.y + (ddy / d) * rr; }
    }
    for (const c of G.cars) {
      const reach = c.len / 2 + 10;
      if (Math.abs(c.x - p.x) > reach || Math.abs(c.y - p.y) > reach) continue;
      for (const q of c.circles()) {
        const ddx = p.x - q[0], ddy = p.y - q[1], rr = c.hw + r, d = Math.hypot(ddx, ddy);
        if (d < rr && d > 0) {
          const nx = q[0] + (ddx / d) * rr, ny = q[1] + (ddy / d) * rr;
          if (!blocked(nx, ny)) { p.x = nx; p.y = ny; }
        }
      }
    }
  },
};

// bucketed obstacle lookup (trees, lamps, hydrants, fountains...)
class Grid {
  constructor(items, cell = 64) {
    this.cell = cell; this.map = new Map();
    for (const it of items) {
      const k = Math.floor(it.x / cell) + ',' + Math.floor(it.y / cell);
      if (!this.map.has(k)) this.map.set(k, []);
      this.map.get(k).push(it);
    }
  }
  remove(it) {
    const a = this.map.get(Math.floor(it.x / this.cell) + ',' + Math.floor(it.y / this.cell));
    if (a && a.includes(it)) a.splice(a.indexOf(it), 1);
  }
  near(x, y, reach = 0) {
    const out = [], cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    const n = 1 + Math.ceil(reach / 2 / this.cell);
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      const a = this.map.get(cx + i + ',' + (cy + j));
      if (a) for (const o of a) out.push(o);
    }
    return out;
  }
}

// ----------------------------------------------------------- particles --
const Parts = {
  list: [],
  add(p) { p.t = 0; this.list.push(p); if (this.list.length > 1200) this.list.shift(); return p; },
  smoke(x, y, dark) {
    this.add({ k: 'smoke', x: x + (Math.random() - 0.5) * 6, y: y + (Math.random() - 0.5) * 6,
      vx: 10 + Math.random() * 12, vy: -8 - Math.random() * 12, life: 1.2 + Math.random() * 0.6, dark });
  },
  tire(x, y) {
    this.add({ k: 'tire', x, y, vx: (Math.random() - 0.5) * 16, vy: (Math.random() - 0.5) * 16, life: 0.6 });
  },
  sparks(x, y, n = 6, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 50 + Math.random() * 140;
      this.add({ k: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.2 + Math.random() * 0.25, color: color || (Math.random() < 0.5 ? PAL.j : PAL.O) });
    }
  },
  debris(x, y, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 80 + Math.random() * 200;
      this.add({ k: 'debris', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.6 + Math.random() * 0.6, color: Math.random() < 0.5 ? PAL.K : PAL.d });
    }
  },
  update(dt) {
    for (const p of this.list) {
      p.t += dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.k === 'water') { p.vh -= 260 * dt; p.h = Math.max(0, (p.h || 0) + p.vh * dt); }
      const drag = p.k === 'debris' || p.k === 'spark' ? 4 : 1.2;
      p.vx *= Math.exp(-drag * dt); p.vy *= Math.exp(-drag * dt);
    }
    this.list = this.list.filter((p) => p.t < p.life);
  },
  draw(ctx, cam) {
    const fx = Assets.sheets.fx, S = fx.w;
    for (const p of this.list) {
      const x = Math.round(p.x - cam.x), y = Math.round(p.y - cam.y);
      if (x < -50 || y < -50 || x > cam.w + 50 || y > cam.h + 50) continue;
      const u = p.t / p.life;
      if (p.k === 'smoke' || p.k === 'tire') {
        const n = Assets.count('fx', 'smoke');
        const f = Assets.frame('fx', 'smoke', Math.min(n - 1, Math.floor(u * n * (p.k === 'tire' ? 0.5 : 1))));
        ctx.globalAlpha = (p.k === 'tire' ? 0.45 : p.dark ? 0.75 : 0.55) * (1 - u) * (G.time === 2 ? 0.6 : 1);
        ctx.drawImage(p.dark ? Assets.tinted('fx', '#2b2d42') : fx.img, f * S, 0, S, S, x - S / 2, y - S / 2, S, S);
        ctx.globalAlpha = 1;
      } else if (p.k === 'expl') {
        const f = Assets.frame('fx', 'explode', Math.min(7, Math.floor(u * 8)));
        ctx.drawImage(fx.img, f * S, 0, S, S, x - S / 2 + p.ox, y - S / 2 + p.oy, S, S);
      } else if (p.k === 'spark' || p.k === 'debris') {
        ctx.fillStyle = p.color;
        const s = p.k === 'debris' ? 2 : 1;
        ctx.fillRect(x, y, s, s);
      } else if (p.k === 'muzzle') {
        const s = p.big ? 3 : 1;
        ctx.fillStyle = PAL.j;
        ctx.fillRect(x - 1 - s, y - 1 - s, 3 + s * 2, 3 + s * 2);
        ctx.fillStyle = PAL.c;
        ctx.fillRect(x - s + 1, y - s + 1, s * 2 - 1 || 1, s * 2 - 1 || 1);
      } else if (p.k === 'tracer') {
        ctx.strokeStyle = PAL.j;
        ctx.lineWidth = p.w || 1;
        ctx.globalAlpha = 1 - u;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y + 0.5);
        ctx.lineTo(Math.round(p.x2 - cam.x) + 0.5, Math.round(p.y2 - cam.y) + 0.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
      } else if (p.k === 'water') {
        ctx.globalAlpha = 1 - u * 0.6;
        ctx.fillStyle = u < 0.5 ? PAL.V : PAL.v;
        ctx.fillRect(x, y - Math.round(p.h || 0), 2, 2);
        ctx.globalAlpha = 1;
      } else if (p.k === 'pop') {
        Font.draw(ctx, p.text, x, y - Math.round(u * 16), { align: 'center', color: p.color || PAL.Y });
      }
    }
  },
};
