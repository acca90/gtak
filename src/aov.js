// Area of view (spec docs/specs/traffic-v1.md, phase A): the region around the camera where
// transient things live. Traffic now, pedestrians and police later, register a pool; untouched
// parked cars stay put, but once the player uses one (drives, shoves or damages it) it becomes
// "managed" and is dropped when it falls out of range. Nothing spawns or vanishes on screen.

const AOV_SCALE = 2.5;          // AOV = 2.5x the widest-zoom view, per axis
const KEEP_SCALE = 1.2;         // managed things are removed only outside AOV x 1.2 (no flicker at the edge)
const VIEW_MARGIN = 64;         // never spawn/remove within this margin of the screen
const WIDEST_VIEW = [1040, 585]; // Main.VIEW x the widest zoom (800x450 x 1.3)
const SCAN_EVERY = 0.5;         // s between car scans
const MOVED_PX = 24;            // a parked car shoved this far off its spot counts as used

const AOV = {
  pools: {},
  refills: [],    // home spots of parked cars that were used and then dropped
  scanT: 0,
  view: null, aov: null, keep: null,

  rect(cx, cy, w, h) { return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 }; },
  within(r, x, y, m = 0) { return x > r.x0 - m && x < r.x1 + m && y > r.y0 - m && y < r.y1 + m; },

  inView(x, y, m = 0) { return this.view && this.within(this.view, x, y, m); },
  inAov(x, y) { return this.aov && this.within(this.aov, x, y); },
  inKeep(x, y) { return !this.keep || this.within(this.keep, x, y); },
  spawnable(x, y) { return this.inAov(x, y) && !this.inView(x, y); },

  // a pool of streamed things: { max, pick() → spot|null, spawn(spot) → thing|null, list() → [], remove(thing) }
  pool(name, def) { def.t = 0; if (!('max' in def)) def.max = 0; this.pools[name] = def; },   // keep def itself: `max` may be a getter

  // the player used this car: from now on the AOV may drop it when it's far away
  release(c) { c.managed = true; },

  // can this car be removed right now? (never the player's, the tank, aircraft, mission cars, or anything on screen)
  removable(c) {
    const p = G.player;
    return c !== p.car && c.driver !== p && c !== G.tank && !c.m.air && !c.target && !c.falling &&
      !this.inView(c.x, c.y, VIEW_MARGIN);
  },

  rings() {
    const cam = G.cam;
    const w = Math.max(cam.w, WIDEST_VIEW[0]) * AOV_SCALE, h = Math.max(cam.h, WIDEST_VIEW[1]) * AOV_SCALE;
    this.view = { x0: cam.x - VIEW_MARGIN, y0: cam.y - VIEW_MARGIN, x1: cam.x + cam.w + VIEW_MARGIN, y1: cam.y + cam.h + VIEW_MARGIN };
    this.aov = this.rect(cam.cx, cam.cy, w, h);
    this.keep = this.rect(cam.cx, cam.cy, w * KEEP_SCALE, h * KEEP_SCALE);
  },

  update(dt) {
    this.rings();
    this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = SCAN_EVERY; this.scanCars(); }
    this.refill();
    for (const name in this.pools) this.runPool(this.pools[name], dt);
  },

  // mark used parked cars, and drop managed cars and burnt-out wrecks that are out of range
  scanCars() {
    let removed = false;
    for (const c of G.cars) {
      if (!c.managed && (c.driver || c.hp < c.m.hp || (c.home && dist(c.x, c.y, c.home.x, c.home.y) > MOVED_PX))) this.release(c);
      const drop = c.wreck ? c.smokeT < -60 : c.managed;
      if (drop && !this.inKeep(c.x, c.y) && this.removable(c)) {
        c.gone = true; removed = true;
        if (c.home) this.refills.push(c.home);
      }
    }
    if (removed) G.cars = G.cars.filter((c) => !c.gone);
  },

  // put a fresh parked car on a freed home spot, but only while nobody can see the spot
  refill() {
    for (let i = this.refills.length - 1; i >= 0; i--) {
      const s = this.refills[i];
      if (this.inView(s.x, s.y, VIEW_MARGIN)) continue;
      if (G.cars.some((c) => Math.abs(c.x - s.x) < 40 && Math.abs(c.y - s.y) < 40)) continue;
      this.refills.splice(i, 1);
      Game.spawnParked(s);
      return;   // one per tick
    }
  },

  runPool(P, dt) {
    const live = P.list();
    for (const e of live) if (!this.inKeep(e.x, e.y) && (!P.removable || P.removable(e))) P.remove(e);
    P.t -= dt;
    if (P.t > 0) return;
    P.t = 0.25;
    const s0 = P.pick();   // also lets the pool refresh its budget
    if (live.length >= P.max) return;
    if (s0 && this.spawnable(s0.x, s0.y) && P.spawn(s0)) return;
    for (let tries = 0; tries < 3; tries++) {
      const s = P.pick();
      if (s && this.spawnable(s.x, s.y) && P.spawn(s)) break;
    }
  },

  // debug on the M map (#demo&map&aov): the rings, and every car (yellow = managed, grey = untouched parked)
  drawOnMap(ctx, x0, y0, s) {
    if (!this.aov) return;
    const X = (x) => x0 + (x / TILE) * s, Y = (y) => y0 + (y / TILE) * s;
    const box = (r, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(X(r.x0)) + 0.5, Math.round(Y(r.y0)) + 0.5, Math.round((r.x1 - r.x0) / TILE * s), Math.round((r.y1 - r.y0) / TILE * s));
    };
    for (const c of G.cars) {
      ctx.fillStyle = c.wreck ? PAL.z : c.managed ? PAL.Y : PAL.m;
      ctx.fillRect(Math.round(X(c.x)), Math.round(Y(c.y)), 1, 1);
    }
    box(this.view, PAL.q); box(this.aov, PAL.Y); box(this.keep, PAL.z);
  },
};
