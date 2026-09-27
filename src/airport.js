'use strict';
// Living airport and port (spec docs/specs/ambient-v1.md, X3, vehicles-agent).
//
// Flights: one movement at a time, departures and arrivals alternating on geo-agent's c.airport
// routes. A departure pushes back (taxi.push), taxis out (taxi.out) to the line-up point at the
// runway's south end, rolls north, rotates and climbs out; an arrival flies in from the south
// down the centre line (approach.from -> touchdown), rolls out to rollEnd with reverse thrust and
// taxis in (taxi.in) to a free stand. The first movement is the airliner lined up on the runway
// (stand 6, never reused), 20 s into play; then one every ~2.5 min. A moving plane on the ground
// is solid: it shoves and damages cars (like the train), knocks the player over and kills peds
// and cows it rolls over; it never stops for anything. A parked plane is its stand's static
// obstacles (removed from G.obstacleGrid when it leaves, put back when one parks). Planes
// outside the AOV keep ring only move along their timeline (no collisions).
//
// Cranes: each gantry crane works its own bays of the ship's deck (c.port.cranes[i].bays): it
// takes a container from a quay stack under its boom, hoists it, runs the trolley out over the
// ship (rolling along its rail to the bay if needed), lowers it into an empty deck slot and
// returns. When its bays are full it switches to unloading onto the quay, and back. The deck
// starts about half full. Rolling cranes move their leg obstacles and shove cars off the rail.
//
// Game hooks: Airport.init(city) in Game.start BEFORE Render.init (takes the `dyn` plane and crane
// sprites out of c.sprites, swaps the ship to its empty-deck sprite), Airport.update(dt), and the
// draw hooks drawGround / drawTall / drawAir / drawEmissive / lights(L, cam).
// For sound-agent: Flights.planes[] { tag, phase, v, alt, rev (reverse thrust on), x, y } with phase
// 'parked' 'push' 'taxiOut' 'lineup' 'takeoff' 'climb' 'approach' 'rollout' 'taxiIn';
// Cranes.list[] { x, y, moving (gantry rolling), trolleyV, hoistV (px/s now), clank (G.t of the last
// lock/land: a container latched or set down) }.

const FL = {
  FIRST: 20, EVERY: 150, GAP: 10,  // s: first movement after play starts, start-to-start, after the last ended
  ALT0: 220,                       // px altitude at approach.from (glide to 0 at touchdown)
  LINEUP_T: 4,                     // s holding on the runway before the roll
  GONE: 1400,                      // px past depart.climb before a departure is dropped
  TAXI_DECEL: 12,                  // px/s^2 when stopping at the end of a taxi path
  STRAIGHT: 2,                     // x taxi speed on long straights (the runway backtrack)
  HIT_V: 12,                       // px/s: moving faster than this, a plane hurts what it hits
  // per plane type: approach speed, taxi, pushback, take-off acceleration, rotate speed, climb px/s, top speed
  airliner:  { app: 170, taxi: 40, push: 24, acc: 20, rot: 230, climb: 45, max: 330, r: 150, lights: { nav: [[-125.5, 36.5], [125.5, 36.5]], beacon: [0, 14.5], strobe: [0, 134], land: [0, -133] } },
  propplane: { app: 115, taxi: 34, push: 20, acc: 16, rot: 120, climb: 38, max: 230, r: 80,  lights: { nav: [[-70.5, -15.5], [70.5, -15.5]], beacon: null, strobe: [0, 54], land: [0, -53] } },
};

// polyline helper: { pts, cum, len }, pos / tangent at a distance s along it
const Path = {
  make(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, len: cum[cum.length - 1] || 0 };
  },
  at(P, s, out = [0, 0]) {
    const { pts, cum } = P;
    if (pts.length === 1 || s <= 0) { out[0] = pts[0][0]; out[1] = pts[0][1]; return out; }
    if (s >= P.len) { const l = pts[pts.length - 1]; out[0] = l[0]; out[1] = l[1]; return out; }
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const u = (s - cum[lo]) / (cum[hi] - cum[lo] || 1);
    out[0] = pts[lo][0] + (pts[hi][0] - pts[lo][0]) * u; out[1] = pts[lo][1] + (pts[hi][1] - pts[lo][1]) * u;
    return out;
  },
  // sprite angle (0 = north, clockwise) of the direction of travel at s, smoothed over +-d px
  ang(P, s, d = 10) {
    const a = this.at(P, Math.max(0, Math.min(P.len - 0.01, s) - d), [0, 0]), b = this.at(P, Math.min(P.len, Math.max(0.01, s) + d), [0, 0]);
    return Math.atan2(b[0] - a[0], -(b[1] - a[1]));
  },
};

const Flights = {
  planes: [], active: null, t: 0, next: FL.FIRST, lastDep: false,

  init(c) {
    this.planes = []; this.active = null; this.t = 0; this.next = FL.FIRST; this.lastDep = false;
    const A = c.airport;
    this.A = A;
    if (!A) return;
    // collision templates per type, in plane-local [lateral right, forward, r], from a stand's obstacles
    this.shape = {};
    for (const s of A.stands) {
      if (this.shape[s.tag]) continue;
      const fx = Math.sin(s.ang), fy = -Math.cos(s.ang);
      this.shape[s.tag] = s.obstacles.map((o) => { const dx = o.x - s.x, dy = o.y - s.y; return [dx * -fy + dy * fx, dx * fx + dy * fy, o.r]; });
    }
    this.paths = { in: {}, out: {}, push: {} };
    for (const k of ['in', 'out', 'push']) for (const id in A.taxi[k]) if (A.taxi[k][id] && A.taxi[k][id].length) this.paths[k][id] = Path.make(A.taxi[k][id]);
    for (const s of A.stands) this.planes.push(this.parked(s));
  },

  parked(s) {
    return { tag: s.tag, P: FL[s.tag], x: s.x, y: s.y, ang: s.ang, alt: 0, v: 0, vx: 0, vy: 0, phase: 'parked', stand: s.id, rev: false };
  },

  standFree(s) { return !this.planes.some((p) => p.stand === s.id); },

  update(dt) {
    if (!this.A) return;
    this.t += dt;
    if (!this.active && this.t >= this.next) this.startNext();
    for (const p of this.planes) {
      if (p.phase === 'parked') continue;
      const x0 = p.x, y0 = p.y;
      this.step(p, dt);
      p.vx = (p.x - x0) / dt; p.vy = (p.y - y0) / dt;
      if (p.alt < 8 && p.phase !== 'parked' && !p.gone && AOV.inKeep(p.x, p.y)) this.collide(p, dt);
    }
    if (this.planes.some((p) => p.gone)) this.planes = this.planes.filter((p) => !p.gone);
  },

  // alternate: a departure, then an arrival into the stand it freed (the first departure is the
  // runway plane, which frees no stand, so a second departure follows it)
  startNext() {
    const A = this.A;
    const free = A.stands.filter((s) => s.kind !== 'runway' && this.standFree(s) && this.paths.in[s.id]);
    if (this.lastDep && free.length) return this.arrive(pick(Math.random, free));
    const parked = this.planes.filter((p) => p.phase === 'parked' && (this.paths.out[p.stand]));
    const run = parked.find((p) => A.stands[p.stand].kind === 'runway');
    const dep = run || (parked.length ? pick(Math.random, parked.filter((p) => p !== this.lastIn).length ? parked.filter((p) => p !== this.lastIn) : parked) : null);
    if (dep) this.depart(dep);
    else if (free.length) this.arrive(pick(Math.random, free));
  },
  begin(p) { this.active = p; this.startT = this.t; },
  end() { this.active = null; this.next = Math.max(this.startT + FL.EVERY, this.t + FL.GAP); },

  depart(p) {
    const s = this.A.stands[p.stand];
    for (const o of s.obstacles) G.obstacleGrid.remove(o);   // the stand's obstacles leave with it
    p.from = p.stand; p.stand = null;
    p.path = this.paths.push[s.id] || null;
    p.phase = p.path ? 'push' : 'taxiOut';
    if (!p.path) p.path = this.paths.out[s.id];
    p.s = 0; p.v = 0;
    this.lastDep = true;
    this.begin(p);
  },
  arrive(s) {
    const A = this.A, tag = s.kind === 'prop' ? 'propplane' : 'airliner';
    const p = { tag, P: FL[tag], x: A.approach.from[0], y: A.approach.from[1], ang: 0, alt: FL.ALT0, v: FL[tag].app, vx: 0, vy: 0, phase: 'approach', to: s.id, stand: null, rev: false };
    this.planes.push(p);
    this.lastDep = false; this.lastIn = p;
    this.begin(p);
    return p;
  },

  step(p, dt) {
    const A = this.A, P = p.P;
    switch (p.phase) {
      case 'push': case 'taxiOut': case 'taxiIn': {
        const L = p.path.len, back = p.phase === 'push';
        const straight = !back && Math.abs(Path.ang(p.path, p.s + 60, 4) - Path.ang(p.path, p.s, 4)) < 0.05 && Math.abs(Path.ang(p.path, p.s + 140, 4) - Path.ang(p.path, p.s, 4)) < 0.05;
        const cruise = back ? P.push : P.taxi * (straight ? FL.STRAIGHT : 1);
        const stop = Math.sqrt(2 * FL.TAXI_DECEL * Math.max(0, L - p.s)) + 2;
        const want = Math.min(cruise, stop);
        p.v += clamp(want - p.v, -FL.TAXI_DECEL * 2 * dt, (back ? 4 : 8) * dt);
        p.s = Math.min(L, p.s + p.v * dt);
        Path.at(p.path, p.s, this._xy || (this._xy = [0, 0]));
        p.x = this._xy[0]; p.y = this._xy[1];
        if (L > 1) { const a = Path.ang(p.path, p.s) + (back ? Math.PI : 0); p.ang = p.ang + wrapA(a - p.ang) * Math.min(1, dt * 6); }
        if (p.s >= L - 0.5) {
          if (p.phase === 'push') { p.phase = 'taxiOut'; p.path = this.paths.out[p.from]; p.s = 0; p.v = 0; }
          else if (p.phase === 'taxiOut') { p.phase = 'lineup'; p.wait = FL.LINEUP_T; p.v = 0; p.x = A.depart.lineup[0]; p.y = A.depart.lineup[1]; }
          else this.park(p);
        }
        return;
      }
      case 'lineup':
        p.ang += wrapA(0 - p.ang) * Math.min(1, dt * 3);
        if ((p.wait -= dt) <= 0) { p.phase = 'takeoff'; p.v = 0; p.ang = 0; }
        return;
      case 'takeoff':
        p.v = Math.min(P.max, p.v + P.acc * dt);
        p.y -= p.v * dt;
        if (p.v >= P.rot) p.phase = 'climb';
        return;
      case 'climb':
        p.v = Math.min(P.max, p.v + P.acc * 0.6 * dt);
        p.y -= p.v * dt;
        p.alt += P.climb * dt * clamp(p.v / P.rot, 0.5, 1.4);
        if (p.y < A.depart.climb[1] - FL.GONE) { p.gone = true; this.end(); }
        return;
      case 'approach': {
        const [tx, ty] = A.approach.touchdown, fy = A.approach.from[1];
        p.v = P.app;
        p.y -= p.v * dt; p.x = tx; p.ang = 0;
        p.alt = Math.max(0, FL.ALT0 * (p.y - ty) / (fy - ty));
        if (p.y <= ty) {
          p.alt = 0; p.phase = 'rollout'; p.rev = true;
          p.dec = (p.v * p.v - P.taxi * P.taxi) / (2 * Math.max(100, ty - A.approach.rollEnd[1]));
          if (G.cam) G.cam.shake = Math.max(G.cam.shake, AOV.inView(p.x, p.y, 0) ? 1.5 : 0);
        }
        return;
      }
      case 'rollout':
        p.v = Math.max(P.taxi, p.v - p.dec * dt);
        p.y -= p.v * dt;
        if (p.v < P.taxi * 1.6) p.rev = false;
        if (p.y <= A.approach.rollEnd[1]) {
          p.y = A.approach.rollEnd[1]; p.rev = false;
          p.phase = 'taxiIn'; p.path = this.paths.in[p.to]; p.s = 0;
        }
        return;
    }
  },

  park(p) {
    const s = this.A.stands[p.to];
    p.phase = 'parked'; p.stand = s.id; p.x = s.x; p.y = s.y; p.ang = s.ang; p.v = 0; p.vx = 0; p.vy = 0; p.path = null;
    for (const o of s.obstacles) G.obstacleGrid.add(o);
    this.end();
  },

  // a plane moving on the ground (or holding on the runway) is a wall that pushes
  circles(p) {
    const fx = Math.sin(p.ang), fy = -Math.cos(p.ang), out = [];
    for (const [lx, lf, r] of this.shape[p.tag] || []) out.push([p.x - fy * lx + fx * lf, p.y + fx * lx + fy * lf, r]);
    return out;
  },
  collide(p, dt) {
    const R = p.P.r, cs = this.circles(p), v = Math.hypot(p.vx, p.vy), hurts = v > FL.HIT_V;
    for (const c of G.cars) {
      if (c.airborne || Math.abs(c.x - p.x) > R + c.len / 2 || Math.abs(c.y - p.y) > R + c.len / 2) continue;
      if (c.planeHit > 0) c.planeHit -= dt;
      let hit = false;
      for (const q of c.circles()) for (const k of cs) {
        const dx = q[0] - k[0], dy = q[1] - k[1], rr = c.hw + k[2], d = Math.hypot(dx, dy);
        if (d >= rr) continue;
        const nx = d > 0.01 ? dx / d : 1, ny = d > 0.01 ? dy / d : 0, over = rr - d;
        c.x += nx * over; c.y += ny * over;
        const vn = c.vx * nx + c.vy * ny, pn = Math.max(0, p.vx * nx + p.vy * ny);
        if (vn < pn + (hurts ? 30 : 0)) { const dv = pn + (hurts ? 30 : 0) - vn; c.vx += nx * dv; c.vy += ny * dv; }
        hit = true;
      }
      if (hit && hurts && !(c.planeHit > 0)) {
        c.planeHit = 0.5;
        c.spin += (Math.random() - 0.5) * 2;
        if (!c.m.tank) Game.damageCar(c, 10 + v * 0.3);
        Parts.sparks(c.x, c.y, 6);
      }
    }
    if (G.peds) for (const b of G.peds) {
      if (b.gone || Math.abs(b.x - p.x) > R || Math.abs(b.y - p.y) > R) continue;
      const r = b.kind === 'cow' ? PED.COW_R : PED.R;
      for (const k of cs) {
        const dx = b.x - k[0], dy = b.y - k[1], rr = r + k[2], d = Math.hypot(dx, dy);
        if (d >= rr) continue;
        const ux = v > 1 ? p.vx / v : 0, uy = v > 1 ? p.vy / v : 0;
        if (b.dead) {
          if (hurts && !(b.runBy && b.runBy.includes(p))) { (b.runBy || (b.runBy = [])).push(p); if (!b.burnt) Render.smear(b.x, b.y, b.x + ux * 24, b.y + uy * 24, 5); }
        } else if (hurts) {
          (b.runBy || (b.runBy = [])).push(p);
          Peds.hurt(b, b.hp + 1, { kind: 'car', src: p, vx: ux * v + (dx / (d || 1)) * 60, vy: uy * v + (dy / (d || 1)) * 60 });
          Render.smear(b.x, b.y, b.x + ux * 30, b.y + uy * 30, b.kind === 'cow' ? 7 : 5);
        } else if (d > 0.01) { b.x = k[0] + (dx / d) * rr; b.y = k[1] + (dy / d) * rr; }
        break;
      }
    }
    const pl = G.player;
    if (pl.car || pl.dead) return;
    for (const k of cs) {
      const dx = pl.x - k[0], dy = pl.y - k[1], rr = 4 + k[2], d = Math.hypot(dx, dy);
      if (d >= rr || d < 0.01) continue;
      pl.x = k[0] + (dx / d) * (rr + 1); pl.y = k[1] + (dy / d) * (rr + 1);
      if (hurts && !(this.hurtT > this.t)) { this.hurtT = this.t + 0.6; Game.hurtPlayer(30); G.cam.shake = Math.max(G.cam.shake, 3); }
    }
  },
};

const CR = {
  H: 150,              // boom height (the gantry sprite's h)
  TY: [-93, 80],       // trolley centre travel, crane-local y (boom tip .. near the legs)
  REST: 30,            // trolley parked over the quay edge between moves
  UP: 118,             // hoist height carrying a box (the spreader's bottom, px above the ground)
  GANTRY_V: 18, TROLLEY_V: 45, HOIST_V: 40,   // px/s
  LATCH: 1.0,          // s to lock / release the spreader
  PAUSE: 3,            // s between moves
  BLINK: 0.6,          // s per warning-lamp frame (crane_gantry frames 0 dark / 1 lit)
  LAMPS: [[-11.5, -101.5], [11.5, -101.5]],
  QUAY_K: 32 / 28,     // quay boxes are drawn at the yard's 32 x 80 size (deck boxes 28 x 73)
  COLOURS: ['red', 'teal', 'blue', 'yellow', 'purple', 'grey', 'brown'],
};

const Cranes = {
  list: [], t: 0,

  init(c) {
    this.list = []; this.t = 0;
    const P = c.port;
    this.P = P;
    if (!P) return;
    const R = rng(0xc0a7a1);
    this.slots = P.ship.slots.map((s) => ({ ...s, box: R() < 0.5 ? pick(R, CR.COLOURS) : null }));
    this.quay = P.quaySlots.map((s) => ({ ...s, box: pick(R, CR.COLOURS) }));
    // the quay stacks are solid (three circles along each box)
    for (const q of this.quay) for (const dx of [-26, 0, 26]) G.obstacleGrid.add(q.obs = { x: q.x + dx, y: q.y, r: 15, crane: 'quay' });
    for (const k of P.cranes) {
      this.list.push({
        id: k.id, x: k.x, y: k.y, bays: k.bays, min: k.bayMin, max: k.bayMax, legs: k.legs, legDx: k.legs.map((o) => o.x - k.x),
        ty: CR.REST, h: CR.UP, box: null, mode: 'load', q: [], wait: 3 + k.id * 8, moving: false, trolleyV: 0, hoistV: 0, clank: -9,
      });
    }
  },

  ty(k, y) { return clamp(k.y - y, CR.TY[0], CR.TY[1]); },   // trolley local y over world y (boom points south)

  // plan the next move as a queue of steps
  plan(k) {
    const mine = this.slots.filter((s) => k.bays.includes(s.x));
    let empty = mine.filter((s) => !s.box), full = mine.filter((s) => s.box);
    if (k.mode === 'load' && !empty.length) k.mode = 'unload';
    if (k.mode === 'unload' && !full.length) k.mode = 'load';
    const quay = this.quay.filter((q) => q.x >= k.min - 1 && q.x <= k.max + 1);
    if (!quay.length) return;
    const slot = pick(Math.random, k.mode === 'load' ? empty : full);
    const q = quay.reduce((a, b) => (Math.abs(b.x - slot.x) < Math.abs(a.x - slot.x) ? b : a));
    const atQ = { k: 'move', x: q.x, ty: this.ty(k, q.y) }, atS = { k: 'move', x: slot.x, ty: this.ty(k, slot.y) };
    const down = { k: 'hoist', h: 0 }, up = { k: 'hoist', h: CR.UP };
    if (k.mode === 'load') {
      k.q = [atQ, down, { k: 'latch', fn: () => { k.box = q.box; q.box = pick(Math.random, CR.COLOURS); } }, up,
        atS, down, { k: 'latch', fn: () => { slot.box = k.box; k.box = null; } }, up, { k: 'move', x: slot.x, ty: CR.REST }];
    } else {
      k.q = [atS, down, { k: 'latch', fn: () => { k.box = slot.box; slot.box = null; } }, up,
        atQ, down, { k: 'latch', fn: () => { q.box = k.box; k.box = null; } }, up, { k: 'move', x: q.x, ty: CR.REST }];
    }
  },

  update(dt) {
    if (!this.P) return;
    this.t += dt;
    for (const k of this.list) {
      k.moving = false; k.trolleyV = 0; k.hoistV = 0;
      if (k.wait > 0) { k.wait -= dt; continue; }
      if (!k.q.length) { this.plan(k); if (!k.q.length) { k.wait = 5; continue; } }
      const st = k.q[0];
      let done = false;
      if (st.k === 'move') {
        const dx = clamp(st.x - k.x, -CR.GANTRY_V * dt, CR.GANTRY_V * dt), dty = clamp(st.ty - k.ty, -CR.TROLLEY_V * dt, CR.TROLLEY_V * dt);
        if (Math.abs(dx) > 1e-4) { this.roll(k, dx); k.moving = true; }
        k.ty += dty; k.trolleyV = Math.abs(dty) / dt;
        done = Math.abs(st.x - k.x) < 0.05 && Math.abs(st.ty - k.ty) < 0.05;
      } else if (st.k === 'hoist') {
        const dh = clamp(st.h - k.h, -CR.HOIST_V * dt, CR.HOIST_V * dt);
        k.h += dh; k.hoistV = Math.abs(dh) / dt;
        done = Math.abs(st.h - k.h) < 0.05;
      } else if (st.k === 'latch') {
        st.t = (st.t || 0) + dt;
        if (st.t >= CR.LATCH) { st.fn(); k.clank = G.t; done = true; }
      }
      if (done) { k.q.shift(); if (!k.q.length) k.wait = CR.PAUSE + Math.random() * 2; }
    }
  },

  // roll the gantry along its rail: the legs move with it and shove cars out of the way
  roll(k, dx) {
    k.x += dx;
    k.legs.forEach((o, i) => { G.obstacleGrid.remove(o); o.x = k.x + k.legDx[i]; G.obstacleGrid.add(o); });
    for (const c of G.cars) {
      if (c.airborne || Math.abs(c.x - k.x) > 40 + c.len / 2 || Math.abs(c.y - k.legs[0].y) > 20 + c.len / 2) continue;
      for (const o of k.legs) for (const q of c.circles()) {
        const ex = q[0] - o.x, ey = q[1] - o.y, rr = c.hw + o.r, d = Math.hypot(ex, ey);
        if (d >= rr || d < 0.01) continue;
        c.x += (ex / d) * (rr - d); c.y += (ey / d) * (rr - d);
        c.vx += Math.sign(dx) * 4;
      }
    }
  },
};

const Airport = {
  init(c) {
    // the systems own the planes and cranes now: out of the static sprites (before Render indexes them)
    if (c.airport || c.port) c.sprites = c.sprites.filter((s) => !s.dyn || (s.dyn === 'plane' && !c.airport) || (s.dyn === 'crane' && !c.port));
    if (c.port && hasSprite('ships', 'container_ship_empty')) for (const s of c.sprites) if (s.tag === 'container_ship') s.tag = 'container_ship_empty';
    Flights.init(c);
    Cranes.init(c);
  },
  update(dt) { Flights.update(dt); Cranes.update(dt); },

  // --------------------------------------------------------------- drawing --
  vis(cam, x, y, m) { return x > cam.x - m && x < cam.x + cam.w + m && y > cam.y - m && y < cam.y + cam.h + m; },
  rotS(ctx, sheet, idx, x, y, ang, s, img) {
    const S = Assets.sheets[sheet];
    ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(ang); if (s !== 1) ctx.scale(s, s);
    ctx.drawImage(img || S.img, idx * S.w, 0, S.w, S.h, -S.w / 2, -S.h / 2, S.w, S.h);
    ctx.restore();
  },
  box(ctx, colour, x, y, ang, s, shadow) {
    const f = Assets.frame('port', 'container_' + colour);
    if (shadow) { ctx.globalAlpha = 0.3; this.rotS(ctx, 'port', f, x + 2, y + 3, ang, s, Assets.tinted('port', '#12142e')); ctx.globalAlpha = 1; }
    this.rotS(ctx, 'port', f, x, y, ang, s);
  },

  // ground level (after the static ground sprites): deck boxes, quay stacks, planes on the
  // ground, and the shadows of planes in the air
  drawGround(ctx, cam) {
    if (Cranes.P && this.vis(cam, Cranes.P.ship.x, Cranes.P.ship.y, 520)) {
      for (const s of Cranes.slots) if (s.box && this.vis(cam, s.x, s.y, 40)) this.box(ctx, s.box, s.x - cam.x, s.y - cam.y, s.ang, 1, false);
      for (const q of Cranes.quay) if (q.box && this.vis(cam, q.x, q.y, 50)) this.box(ctx, q.box, q.x - cam.x, q.y - cam.y, q.ang, CR.QUAY_K, true);
    }
    const shadow = Assets.tinted('planes', '#12142e');
    for (const p of Flights.planes) {
      if (!this.vis(cam, p.x, p.y, 160 + p.alt)) continue;
      const f = Assets.frame('planes', p.tag);
      if (p.alt > 2) {   // in the air: only its shadow here, fading and shrinking with altitude
        ctx.globalAlpha = clamp(0.35 - p.alt / 900, 0.1, 0.35);
        this.rotS(ctx, 'planes', f, p.x - cam.x + 3 + p.alt * 0.18, p.y - cam.y + 4 + p.alt * 0.14, p.ang, 1 - Math.min(0.35, p.alt / 800), shadow);
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.globalAlpha = 0.3;
      Assets.drawRot(ctx, 'planes', f, p.x - cam.x + 3, p.y - cam.y + 4, p.ang, shadow);
      ctx.globalAlpha = 1;
      Assets.drawRot(ctx, 'planes', f, p.x - cam.x, p.y - cam.y, p.ang);
    }
  },

  // raised (with the tall things, before the light pass): the cranes and what hangs from them
  drawTall(ctx, cam) {
    const H = CR.H;
    for (const k of Cranes.list) {
      if (!this.vis(cam, k.x, k.y, 260)) continue;
      const [cx, cy] = Render.lift(cam, k.x, k.y, H), a = Math.PI;
      const f = Assets.frame('boats', 'crane_gantry', Math.floor((Cranes.t + k.id * 0.2) / CR.BLINK));
      // the trolley in the crane's lifted frame: local (0, ty) rotated by PI is (0, -ty)
      const tx = cx, ty = cy - k.ty;
      // what hangs below it: from the ground point under the trolley up to the trolley, by height
      const gx = k.x - cam.x, gy = k.y - k.ty - cam.y, u = k.h / H;
      const hx = lerp(gx, tx, u), hy = lerp(gy, ty, u);
      const quayK = lerp(1, CR.QUAY_K, clamp((k.ty - 40) / 30, 0, 1));
      const shA = Math.PI / 2;
      // shadows: gantry (like a raised sprite), hanging box / spreader (closer to its shadow the lower it is)
      ctx.globalAlpha = 0.3;
      Assets.drawRot(ctx, 'boats', f, cx + 3 + H * 0.05, cy + 4 + H * 0.05, a, Assets.tinted('boats', '#12142e'));
      ctx.globalAlpha = 0.3 * (1 - u * 0.5);
      const so = 2 + k.h * 0.06;
      if (k.box) this.rotS(ctx, 'port', Assets.frame('port', 'container_' + k.box), gx + so, gy + so * 1.3, shA, quayK, Assets.tinted('port', '#12142e'));
      else this.rotS(ctx, 'port', Assets.frame('port', 'crane_spreader'), gx + so, gy + so * 1.3, shA, 1, Assets.tinted('port', '#12142e'));
      ctx.globalAlpha = 1;
      // hanging load and spreader, then the cables up to the trolley, then gantry and trolley on top
      if (k.box) this.box(ctx, k.box, hx, hy, shA, quayK, false);
      this.rotS(ctx, 'port', Assets.frame('port', 'crane_spreader'), hx, hy, shA, 1);
      ctx.fillStyle = PAL.K;
      for (const s of [-6, 6]) {
        const n = Math.max(1, Math.ceil(Math.hypot(tx - hx, ty - hy)));
        for (let i = 0; i <= n; i += 1) ctx.fillRect(Math.round(lerp(hx + s, tx + s * 0.6, i / n)), Math.round(lerp(hy, ty, i / n)), 1, 1);
      }
      Assets.drawRot(ctx, 'boats', f, cx, cy, a);
      Assets.drawRot(ctx, 'port', Assets.frame('port', 'crane_trolley'), tx, ty, a);
    }
  },

  // planes in the air, over the roofs (after the light pass, so darkened by hand like drawAir)
  drawAir(ctx, cam) {
    const L = Clock.light();
    for (const p of Flights.planes) {
      if (!(p.alt > 2)) continue;
      const [x, y] = Render.lift(cam, p.x, p.y, p.alt);
      if (x < -160 || y < -160 || x > cam.w + 160 || y > cam.h + 160) continue;
      const f = Assets.frame('planes', p.tag);
      Assets.drawRot(ctx, 'planes', f, x, y, p.ang);
      if (L.ambient) {
        ctx.globalAlpha = L.s <= 1 ? 0.25 * L.s : 0.25 + 0.3 * (L.s - 1);
        Assets.drawRot(ctx, 'planes', f, x, y, p.ang, Assets.tinted('planes', L.ambient));
        ctx.globalAlpha = 1;
      }
      if (G.time) this.navLights(ctx, p, x, y);
    }
  },

  // lights on a plane, drawn at screen (x, y) = its centre: steady nav, blinking beacon, tail strobe
  planeLight(p, lx, ly, x, y) {
    const c = Math.cos(p.ang), s = Math.sin(p.ang);
    return [x + lx * c - ly * s, y + lx * s + ly * c];
  },
  navLights(ctx, p, x, y) {
    const Lt = p.P.lights, dot = (pt, col, w = 2) => { const [a, b] = this.planeLight(p, pt[0], pt[1], x, y); ctx.fillStyle = col; ctx.fillRect(Math.round(a) - (w >> 1), Math.round(b) - (w >> 1), w, w); };
    dot(Lt.nav[0], PAL.z); dot(Lt.nav[1], PAL.h);
    if (p.phase === 'parked') return;
    if (Lt.beacon && (G.t % 1) < 0.12) dot(Lt.beacon, PAL.z, 3);
    const st = G.t % 1.4;
    if (st < 0.06 || (st > 0.16 && st < 0.22)) dot(Lt.strobe, PAL.x, 3);
    dot(Lt.land, PAL.x, 3);
  },

  // after the light pass: crane warning lamps, lights of planes on the ground
  drawEmissive(ctx, cam) {
    for (const k of Cranes.list) {
      if (!this.vis(cam, k.x, k.y, 260) || !this.lampOn(k)) continue;
      const [cx, cy] = Render.lift(cam, k.x, k.y, CR.H);
      ctx.fillStyle = PAL.z;
      for (const [lx, ly] of CR.LAMPS) ctx.fillRect(Math.round(cx - lx) - 1, Math.round(cy - ly) - 1, 3, 3);   // rotated by PI
    }
    for (const p of Flights.planes) if (p.alt <= 2 && this.vis(cam, p.x, p.y, 160)) this.navLights(ctx, p, p.x - cam.x, p.y - cam.y);
  },
  lampOn(k) { return Math.floor((Cranes.t + k.id * 0.2) / CR.BLINK) % 2 === 1; },

  // light-pass entries (world coords): lamp halos, plane nav glows and landing-light cones
  lights(L, cam) {
    for (const k of Cranes.list) {
      if (!this.vis(cam, k.x, k.y, 260) || !this.lampOn(k)) continue;
      const [cx, cy] = Render.lift(cam, k.x, k.y, CR.H);
      for (const [lx, ly] of CR.LAMPS) L.push({ x: cx - lx + cam.x, y: cy - ly + cam.y, r: 18, color: 'rgba(255,60,80,0.9)' });
    }
    for (const p of Flights.planes) {
      if (!this.vis(cam, p.x, p.y, 300 + p.alt)) continue;
      const [x, y] = p.alt > 2 ? Render.lift(cam, p.x, p.y, p.alt) : [p.x - cam.x, p.y - cam.y];
      const Lt = p.P.lights;
      const [rx, ry] = this.planeLight(p, Lt.nav[0][0], Lt.nav[0][1], x, y), [gx, gy] = this.planeLight(p, Lt.nav[1][0], Lt.nav[1][1], x, y);
      L.push({ x: rx + cam.x, y: ry + cam.y, r: 14, color: 'rgba(255,70,90,0.8)' }, { x: gx + cam.x, y: gy + cam.y, r: 14, color: 'rgba(90,255,150,0.8)' });
      if (p.phase === 'parked' || p.alt > 180) continue;
      // landing light: a cone on the ground ahead of the nose (further ahead the higher it is)
      const fx = Math.sin(p.ang), fy = -Math.cos(p.ang), nose = -Lt.land[1] + p.alt * 0.6;
      L.push({ cone: true, x: p.x + fx * nose, y: p.y + fy * nose, ang: p.ang });
    }
  },
};

function wrapA(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
