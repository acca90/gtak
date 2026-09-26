'use strict';
// Traffic driver AI (spec docs/specs/traffic-v1.md, B2 driving + B4 reactions, owned by vehicles-agent).
// Game calls Traffic.controls(car, dt) for every awake car whose driver is { ai: true, ... } and
// feeds the result to Car.update exactly like the player's controls, so each model's own
// acceleration, brakes, steering, grip and mass apply. Nothing here moves a car directly.
//
// Per car, every tick:
//   1. track   where the car is on its route: a lane (G.city.lanes) or the exit path across a
//              node; knocked too far off -> re-acquire the nearest lane heading its way
//   2. route   a short polyline ahead (rest of the lane, the chosen exit path, the next lane,
//              the exit after it) with the stop lines and level crossings on it
//   3. steer   pure pursuit toward a look-ahead point on that polyline
//   4. speed   the lowest of: cruise, turn speed, red/amber light, yield, left turn across
//              oncoming traffic, train at a crossing, and the car / walker ahead on the route
//   5. pedals  throttle/brake to hold that speed (feed-forward for rolling drag)
//
// Driver state (c.driver; the pool creates { ai, lane, cruise }, the rest is added here):
//   mode 'lane' | 'turn' | 'lost', lane (lane id), ex (exit at the end of `lane`, or being
//   followed in 'turn'), nx (the exit after that), pi (path segment in 'turn'), want (target
//   px/s), why (what limits it: 'cruise' 'turn' 'red' 'amber' 'clear' 'yield' 'left' 'train'
//   'car' 'walker' 'pass' 'end' 'lost' 'reverse'), lead (the car ahead, 'walker', or null), gap (px to
//   it), bias (px it edges right for oncoming traffic), id (per-driver, the older wins deadlocks).
// Reactions (B4):
//   blocked  `blockedT` = s stopped behind a car or the walker. When what's at the head of the
//            queue isn't waiting for a light / right of way (a parked or broken-down car, the
//            player, a stuck driver): honk in short double taps after 1.5 s (`c.honking`, which
//            sound-agent's horn plays), and after 4 s pass it on the left if the oncoming side is
//            clear (`pass`, `passP` = px shifted left), then merge back.
//   hit      rammed by the player's car, or damaged with the player nearby (bullets, blasts,
//            fire; the player is the only shooter): `fleeT` = 10 s at the model's top speed,
//            ignoring lights and yields but still following lanes, turning away from the player
//            where it can; then it eases back down to cruise (`calmV`).
// `stuckT`/`revT` = the built-in unstick (reverse 0.9 s with opposite lock after 1.5 s wanting to
// move but not moving).

const TR = {
  LOOK: 16, LOOK_V: 0.25, LOOK_LEN: 0.1,   // pure pursuit look-ahead: px + s x speed + x car length
  LOOK_TURN: 0.8,                          // look-ahead scale inside a junction (tighter corners)
  DECEL: 0.3,                              // planning decel = 30% of the model's brake (smooth stops)
  AMBER_DECEL: 0.6,                        // on amber, stop only if 60% of full braking is enough
  GAP_MIN: 10,                             // px bumper-to-bumper when stopped in a queue (~0.9 m)
  HEADWAY: 0.6,                            // s of extra gap per px/s of the lead's speed
  TURN_ALAT: 120,                          // px/s^2 lateral accel allowed in turns
  TURN_CRUISE: 0.8,                        // and never above 80% of cruise in a turn
  TURN_MARGIN: 1.15,                       // turn arcs >= 1.15 x the model's tightest circle
  UTURN_MAX: 50,                           // px/s on a turn loop
  BOX_HALF: CITY.ROAD * TILE / 2,          // junction box half size (72 px)
  XING_STOP: 44,                           // stop the front bumper this far before a crossing's centre
  PREDICT: [0.4, 0.8],                     // s ahead to test crossing cars' future positions
  KEEP_RIGHT: 4,                           // px a car may edge right to pass oncoming traffic on a narrow road
  LOST_LAT: 40,                            // px off the lane before re-acquiring
  STUCK_T: 1.5,                            // s wanting to move but not moving before backing up
  REVERSE_T: 0.9,                          // s of reversing (unstick, three-point turn)
  CELL: 96,                                // obstacle grid cell
  W_TURN: { s: 3, r: 1.5, l: 1.2, u: 1 },  // exit weights (u only where nothing else exists)
  W_DEADEND: 0.4,                          // x weight for an exit into a lane that ends in a turn loop
  LONG: 80,                                // px: a long vehicle (trucks, buses, rigs)
  W_LONG_STRAIGHT: 3,                      // x weight of going straight for long vehicles
  LONG_TURN_MAX: 45,                       // px/s cap for long vehicles in turns (bumps stay under the damage threshold)
  W_WIDE_NARROW: 0.05,                     // x weight for wide vehicles (w >= 30) entering a street/court lane
  // reactions (B4)
  HONK_AFTER: 1.5,                         // s blocked before honking
  HONK_CYCLE: [0.2, 0.38, 0.58, 2.4],      // tap on 0-0.2 s, off, tap 0.38-0.58 s, silent until 2.4 s
  PASS_AFTER: 4,                           // s blocked before passing
  PASS_V: 70,                              // px/s max while passing
  PASS_SHIFT_V: 35,                        // px/s sideways (how fast it pulls out and back in)
  PASS_MAX_T: 10,                          // s before giving up a pass
  FLEE_T: 10,                              // s of fleeing after being hit
  FLEE_DV: 40,                             // px/s velocity jump in one tick that counts as a hit
  FLEE_RAM_V: 25,                          // the player's car must be moving at least this fast
  FLEE_NEAR: 700,                          // px: damage with the player this close counts as theirs
  FLEE_ALAT: 200,
  FLEE_PASS_AFTER: 1.5,                    // s blocked before a fleeing car passes anything standing still                          // px/s^2 allowed in turns while fleeing
  CALM_DECEL: 70,                          // px/s^2: back down to cruise after fleeing
};
const TR_WAITS = { red: 1, amber: 1, clear: 1, yield: 1, left: 1, train: 1, turn: 1, cruise: 1, pass: 1 };   // a lead waiting for these (or moving) is a legit wait

const Traffic = {
  _t: -1, grid: new Map(), nid: 0,
  exitsFrom: null, incoming: null,
  // route scratch (reused; one car at a time)
  rx: new Float64Array(64), ry: new Float64Array(64), rs: new Float64Array(64), rn: 0,
  stops: [], ns: 0,
  out: { throttle: 0, steer: 0, hb: false },

  // exits by incoming lane, and the lanes arriving at each node (built once per city)
  index() {
    const c = G.city;
    if (this.exitsFrom && this.city === c) return;
    this.city = c;
    this.exitsFrom = new Array(c.lanes.length);
    this.incoming = new Array(c.nodes.length);
    for (const nd of c.nodes) for (const ex of nd.exits) {
      (this.exitsFrom[ex.from] || (this.exitsFrom[ex.from] = [])).push(ex);
      ex.tps = {};                                     // turn paths per model (turnPath)
      if (ex.turn === 'u') ex.loopR = nd.loop || 46;
    }
    for (const L of c.lanes) (this.incoming[L.to] || (this.incoming[L.to] = [])).push(L);
  },

  // obstacles: every car on the ground (parked, wrecked, driven) and the player on foot, in a
  // grid rebuilt once per tick
  frame() {
    if (this._t === G.t) return;
    this._t = G.t;
    this.index();
    const g = this.grid, C = TR.CELL;
    for (const b of g.values()) b.length = 0;
    for (const o of G.cars) {
      if (o.gone || o.alt > 8) continue;
      const k = Math.floor(o.x / C) * 8192 + Math.floor(o.y / C);
      const b = g.get(k);
      if (b) b.push(o); else g.set(k, [o]);
    }
    const p = G.player;
    this.walker = p && !p.car && !p.dead ? p : null;
  },

  // weighted random exit; long vehicles turn less (their swept path clips cars waiting at the
  // lines), wide ones (w >= 30) avoid narrow street/court lanes, where a parked car leaves no room
  pickExit(L, d) {
    const list = this.exitsFrom[L.id];
    if (!list || !list.length) return null;
    if (list.length === 1) return list[0];
    const lanes = G.city.lanes, nodes = G.city.nodes;
    let sum = 0;
    const w = list.map((ex) => {
      let v = ex.turn === 'u' && list.some((e) => e.turn !== 'u') ? 0 : TR.W_TURN[ex.turn] || 1;
      const M = lanes[ex.to];
      if (nodes[M.to].kind === 'turn') v *= d && d.long ? 0 : TR.W_DEADEND;   // trucks can't turn in a 56-px loop
      if (d && d.long && ex.turn === 's') v *= TR.W_LONG_STRAIGHT;
      if (d && d.wide && (M.profile === 'street' || M.profile === 'court')) v *= TR.W_WIDE_NARROW;
      if (d && d.fleeT > 0) {   // away from where the player hit us
        const nd = nodes[L.to], ax = nd.x - d.fleeX, ay = nd.y - d.fleeY, al = Math.hypot(ax, ay) || 1;
        v *= 0.15 + 2 * Math.max(0, (M.dx * ax + M.dy * ay) / al);
      }
      sum += v;
      return v;
    });
    if (sum <= 0) return list.find((e) => e.turn !== 'u') || list[0];
    let r = G.R() * sum;
    for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  },

  // The path a model drives through an exit. Straight exits and turn loops use the lane graph's
  // path. Left/right turns use a circular arc tangent to both lanes, with a radius the model can
  // actually steer (Car.update: below 120 px/s the tightest circle is 120 / steer px, so a van
  // can't follow a 57-px street corner and would swing wide into oncoming traffic). A radius
  // bigger than the corner starts the arc `pre` px before the lane end and ends it `post` px
  // into the next lane. Cached per exit and model.
  turnPath(ex, c) {
    let tp = ex.tps[c.model];
    if (tp) return tp;
    if (ex.turn === 's' || ex.turn === 'u') tp = { path: ex.path, pre: 0, post: 0, R: ex.turn === 'u' ? ex.loopR : Infinity };
    else {
      const lanes = G.city.lanes, L = lanes[ex.from], M = lanes[ex.to];
      const qx = L.dx ? M.x0 : L.x1, qy = L.dx ? L.y1 : M.y0;              // where the lane lines meet
      const rL = (qx - L.x1) * L.dx + (qy - L.y1) * L.dy, rM = (M.x0 - qx) * M.dx + (M.y0 - qy) * M.dy;
      const need = (TR.TURN_MARGIN * 120) / (c.m.steer * 0.95);
      const R = Math.ceil(Math.max(rL, rM, need) / 2) * 2;
      const cx = qx - L.dx * R + M.dx * R, cy = qy - L.dy * R + M.dy * R;   // arc centre
      const path = [];
      for (let k = 0; k <= 8; k++) {
        const a = (k / 8) * (Math.PI / 2), co = Math.cos(a), si = Math.sin(a);
        path.push([cx + R * (-M.dx * co + L.dx * si), cy + R * (-M.dy * co + L.dy * si)]);
      }
      tp = { path, pre: Math.min(R - rL, L.len * 0.5), post: R - rM, R };
    }
    return (ex.tps[c.model] = tp);
  },

  enterLane(d, L, ex) {
    d.mode = 'lane'; d.lane = L.id; d.pi = 0;
    d.ex = ex && ex.from === L.id ? ex : this.pickExit(L, d);
    d.nx = d.ex ? this.pickExit(G.city.lanes[d.ex.to], d) : null;
    d.yieldOk = -1; d.waitT = 0; d.amberGo = -1;
  },

  // nearest lane heading roughly our way (a wrong-way lane only as a last resort)
  reacquire(c, d, r) {
    const fx = c.fx, fy = c.fy;
    let best = null, bs = Infinity;
    for (const L of City.lanesIn(c.x - r, c.y - r, c.x + r, c.y + r, this._near || (this._near = []))) {
      const dist = City.laneDist(L, c.x, c.y);
      if (dist > r) continue;
      const dot = L.dx * fx + L.dy * fy;
      const s = dist + (1 - dot) * 30 + (dot < -0.2 ? 400 : 0);
      if (s < bs) { bs = s; best = L; }
    }
    if (!best) { if (d.mode !== 'lost') d.lostT = 0; d.mode = 'lost'; return false; }
    d.acqE = Math.abs((c.x - best.x0) * -best.dy + (c.y - best.y0) * best.dx);
    if (d.mode === 'lane' && d.lane === best.id) return true;   // still the best lane: keep the plan
    this.enterLane(d, best, null);
    d.recovers = (d.recovers || 0) + 1;
    return true;
  },

  // ------------------------------------------------------------------ route polyline --
  push(x, y) {
    const n = this.rn;
    if (n >= 63) return;
    if (n) {
      const s = Math.hypot(x - this.rx[n - 1], y - this.ry[n - 1]);
      if (s < 0.01) return;
      this.rs[n] = this.rs[n - 1] + s;
    } else this.rs[0] = 0;
    this.rx[n] = x; this.ry[n] = y; this.rn = n + 1;
  },
  addStop(s, L, kind, xing) {
    let st = this.stops[this.ns];
    if (!st) st = this.stops[this.ns] = {};
    st.s = s; st.L = L; st.kind = kind; st.xing = xing;
    this.ns++;
  },
  // lane L from t0 to t1 (px along it); stops and crossings are measured from t0
  addLane(L, t0, t1) {
    const s0 = this.rn ? this.rs[this.rn - 1] : 0;
    if (!this.rn) this.push(L.x0 + L.dx * t0, L.y0 + L.dy * t0);
    if (L.stop) {
      const ts = (L.stop.x - L.x0) * L.dx + (L.stop.y - L.y0) * L.dy;
      this.addStop(s0 + ts - t0, L, 'stop', null);
    }
    if (L.xings) for (const X of L.xings) {
      const tx = (X.x - L.x0) * L.dx + (X.y - L.y0) * L.dy;
      this.addStop(s0 + tx - TR.XING_STOP - t0, L, 'xing', X);
    }
    if (t0 < t1) this.push(L.x0 + L.dx * t1, L.y0 + L.dy * t1);
  },
  addPath(P, k) { for (let i = k; i < P.length; i++) this.push(P[i][0], P[i][1]); },

  build(c, d, cap) {
    const lanes = G.city.lanes;
    this.rn = 0; this.ns = 0;
    let exit = d.ex, next = d.nx;
    const endOf = (L, ex) => L.len - (ex ? this.turnPath(ex, c).pre : 0);
    if (d.mode === 'lane') {
      const L = lanes[d.lane], end = endOf(L, exit);
      const t = (c.x - L.x0) * L.dx + (c.y - L.y0) * L.dy;
      this.addLane(L, Math.min(t, end), end);
    } else { // 'turn': from the car's foot on segment pi of the exit path
      const tp = this.turnPath(exit, c), P = tp.path, a = P[d.pi], b = P[Math.min(d.pi + 1, P.length - 1)];
      const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy;
      const u = l2 ? clamp(((c.x - a[0]) * vx + (c.y - a[1]) * vy) / l2, 0, 1) : 1;
      this.push(a[0] + vx * u, a[1] + vy * u);
      // a wide arc can start before the stop line: keep obeying it until the front is past
      const Lin = lanes[d.lane];
      if (Lin.stop) {
        const ts = (Lin.stop.x - Lin.x0) * Lin.dx + (Lin.stop.y - Lin.y0) * Lin.dy, t = (c.x - Lin.x0) * Lin.dx + (c.y - Lin.y0) * Lin.dy;
        if (ts - t > c.len / 2 - 8) this.addStop(ts - t, Lin, 'stop', null);
      }
      this.addPath(P, d.pi + 1);
      const M = lanes[exit.to];
      exit = next; next = null;
      this.addLane(M, tp.post, endOf(M, exit));
    }
    this.turnS = -1; this.turnTp = null;
    for (let k = 0; k < 2 && exit && this.rs[this.rn - 1] < cap; k++) {
      const tp = this.turnPath(exit, c);
      if (!this.turnTp && exit.turn !== 's') { this.turnS = this.rs[this.rn - 1]; this.turnTp = tp; this.turnU = exit.turn === 'u'; }
      this.addPath(tp.path, 1);
      const M = lanes[exit.to];
      exit = next; next = null;
      if (this.rs[this.rn - 1] < cap) this.addLane(M, tp.post, endOf(M, exit));
    }
  },

  // the point `s` px along the route
  at(s, o) {
    const n = this.rn, rs = this.rs;
    let i = 1;
    while (i < n - 1 && rs[i] < s) i++;
    if (n < 2) { o[0] = this.rx[0]; o[1] = this.ry[0]; return o; }
    const seg = rs[i] - rs[i - 1] || 1, u = (s - rs[i - 1]) / seg;
    o[0] = this.rx[i - 1] + (this.rx[i] - this.rx[i - 1]) * u;
    o[1] = this.ry[i - 1] + (this.ry[i] - this.ry[i - 1]) * u;
    this.aux = (this.rx[i] - this.rx[i - 1]) / seg; this.auy = (this.ry[i] - this.ry[i - 1]) / seg;
    return o;
  },

  // ------------------------------------------------------------------ tracking --
  // advance along lane / exit path; false when the car has no route (lost)
  track(c, d, dt) {
    const lanes = G.city.lanes;
    d.reT -= dt;
    if (d.mode === 'lost') {
      d.lostT += dt;
      if (d.reT > 0) return false;
      d.reT = 0.5;
      if (!this.reacquire(c, d, d.lostT > 4 ? 400 : d.lostT > 2 ? 220 : 90)) return false;
    }
    for (let guard = 0; guard < 3; guard++) {
      if (d.mode === 'lane') {
        const L = lanes[d.lane];
        const t = (c.x - L.x0) * L.dx + (c.y - L.y0) * L.dy;
        const e = (c.x - L.x0) * -L.dy + (c.y - L.y0) * L.dx;
        const dot = c.fx * L.dx + c.fy * L.dy;
        // knocked off (or turned the wrong way): look for a better lane, at most twice a second;
        // the lane found is followed even if it's still far, pure pursuit merges back onto it
        // a lane found far away (after a big knock) is allowed that far, as long as we close in on it
        d.acqE = Math.min(d.acqE, Math.abs(e));
        if (d.reT <= 0 && (Math.abs(e) > Math.max(TR.LOST_LAT, d.acqE + 20, d.passP + 20) || t < -80 || t > L.len + 60 || (dot < -0.3 && c.speed() > 20))) {
          d.reT = 0.5;
          if (!this.reacquire(c, d, 90)) return false;
          if (d.lane !== L.id) continue;
        }
        d.off = Math.abs(e);
        if (t < L.len - (d.ex ? this.turnPath(d.ex, c).pre : 0)) return true;
        if (!d.ex) { this.enterLane(d, L, null); if (!d.ex) return true; }   // no exit: stop at the end
        d.mode = 'turn'; d.pi = 0;
        continue;
      }
      // 'turn'
      // the nearest of the next few path segments (paths can have short kinks, so "past the end
      // of this segment" alone can stall); done once past the end of the last one
      const P = this.turnPath(d.ex, c).path;
      let off = Infinity, bi = d.pi, bu = 0;
      for (let i = d.pi; i < Math.min(d.pi + 4, P.length - 1); i++) {
        const a = P[i], b = P[i + 1];
        const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy || 1;
        const u = ((c.x - a[0]) * vx + (c.y - a[1]) * vy) / l2, cu = clamp(u, 0, 1);
        const e = Math.hypot(c.x - a[0] - vx * cu, c.y - a[1] - vy * cu);
        if (e <= off + 0.5) { off = e; bi = i; bu = u; }
      }
      d.pi = bi;
      if (bi === P.length - 2 && bu >= 1) d.pi = P.length - 1;
      if (d.pi >= P.length - 1) { const nx = d.nx; this.enterLane(d, lanes[d.ex.to], nx); continue; }
      d.off = off;
      if (off > TR.LOST_LAT + 8 && d.reT <= 0) { d.reT = 0.5; if (!this.reacquire(c, d, 90)) return false; continue; }
      return true;
    }
    return true;
  },

  // ------------------------------------------------------------------ hazards --
  // can a car cross the level crossing X now? (Train in game.js: one train on one rail)
  trainNear(X) {
    const T = typeof Train !== 'undefined' ? Train : null;
    if (!T || !T.rail) return false;
    const r = T.rail;
    const cross = T.vertical ? X.x - r.x0 : X.y - r.y0, cs = T.vertical ? X.y - r.y0 : X.x - r.x0;
    if (Math.abs(cross) > 80) return false;                      // another line
    const a0 = T.s - T.len / 2, a1 = T.s + T.len / 2;
    const gap = cs < a0 ? a0 - cs : cs > a1 ? cs - a1 : 0;
    if (gap < 40) return true;
    const toward = T.dir > 0 ? cs > a1 : cs < a0;
    return toward && gap < 60 + Math.abs(T.v) * 5 + (T.wait > 0 && T.wait < 2.5 ? 100 : 0);
  },

  // anything in the junction box, or a car heading into it on another approach?
  boxBusy(c, nd, L) {
    const B = TR.BOX_HALF + 6, C = TR.CELL;
    const r = B + 140;
    for (let gx = Math.floor((nd.x - r) / C); gx <= Math.floor((nd.x + r) / C); gx++) {
      for (let gy = Math.floor((nd.y - r) / C); gy <= Math.floor((nd.y + r) / C); gy++) {
        const b = this.grid.get(gx * 8192 + gy);
        if (b) for (const o of b) {
          if (o === c || o.wreck) continue;
          const dx = o.x - nd.x, dy = o.y - nd.y, od = o.driver, ol = o.len / 2;
          // any part of it in the box (a moving car, or one somebody drives)
          if (Math.abs(dx) < B + ol - 2 && Math.abs(dy) < B + ol - 2 && (o.speed() > 3 || od)) {
            if (!(od && od.ai && od.mode === 'lane' && G.city.lanes[od.lane].to === nd.id && od.yieldOk !== od.lane && o.speed() < 3)) return true;
          }
          // another yielder already cleared to go at this node
          if (od && od.ai && od.mode === 'lane' && od.yieldOk === od.lane && G.city.lanes[od.lane].to === nd.id) return true;
          const sp = o.speed();
          if (sp < 25) continue;
          if ((o.vx * L.dx + o.vy * L.dy) / sp > 0.7 && dx * L.dx + dy * L.dy < 0) continue;   // behind us, same way
          if (od && od.ai && od.mode === 'lane' && G.city.lanes[od.lane].yield && od.yieldOk !== od.lane) continue;   // a yielder that will stop
          if (-(dx * o.vx + dy * o.vy) / (Math.hypot(dx, dy) * sp) > 0.8 && Math.hypot(dx, dy) < B + 120) return true;
        }
      }
    }
    return this.walker && Math.abs(this.walker.x - nd.x) < B && Math.abs(this.walker.y - nd.y) < B;
  },

  // a car moving across our direction inside the junction box
  crossing(c, nd, L) {
    const B = TR.BOX_HALF, C = TR.CELL;
    for (let gx = Math.floor((nd.x - B) / C); gx <= Math.floor((nd.x + B) / C); gx++) {
      for (let gy = Math.floor((nd.y - B) / C); gy <= Math.floor((nd.y + B) / C); gy++) {
        const b = this.grid.get(gx * 8192 + gy);
        if (b) for (const o of b) {
          if (o === c || o.wreck || Math.abs(o.x - nd.x) > B || Math.abs(o.y - nd.y) > B) continue;
          const sp = o.speed();
          if (sp > 10 && Math.abs((o.vx * L.dx + o.vy * L.dy) / sp) < 0.6) return true;
        }
      }
    }
    return false;
  },

  // turning left across the oncoming lane: anything coming straight at the box, or in it?
  oncoming(c, nd, L) {
    const inc = this.incoming[nd.id];
    if (!inc) return false;
    let O = null;
    for (const M of inc) if (M.dx === -L.dx && M.dy === -L.dy) { O = M; break; }
    if (!O) return false;
    const C = TR.CELL, cx = O.x1 - O.dx * 40, cy = O.y1 - O.dy * 40, r = 190;
    for (let gx = Math.floor((cx - r) / C); gx <= Math.floor((cx + r) / C); gx++) {
      for (let gy = Math.floor((cy - r) / C); gy <= Math.floor((cy + r) / C); gy++) {
        const b = this.grid.get(gx * 8192 + gy);
        if (b) for (const o of b) {
          if (o === c || o.wreck) continue;
          const t = (o.x - O.x0) * O.dx + (o.y - O.y0) * O.dy, e = Math.abs((o.x - O.x0) * -O.dy + (o.y - O.y0) * O.dx);
          if (e > 26 || t < O.len - 180 || t > O.len + 2 * TR.BOX_HALF) continue;
          const sp = o.speed();
          if (sp < 15 || (o.vx * O.dx + o.vy * O.dy) / sp < 0.5) continue;
          const od = o.driver;
          if (od && od.ai && od.ex && od.ex.turn === 'l' && (od.mode === 'turn' || od.lane === O.id)) continue;   // left vs left: no conflict
          return true;
        }
      }
    }
    return false;
  },

  // the car or walker ahead on the route: returns the allowed speed, sets d.lead / d.gap
  scan(c, d, S, b) {
    const C = TR.CELL, n = this.rn, rx = this.rx, ry = this.ry, rs = this.rs;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n && (i === 0 || rs[i - 1] < S); i++) {
      if (rx[i] < x0) x0 = rx[i]; if (rx[i] > x1) x1 = rx[i];
      if (ry[i] < y0) y0 = ry[i]; if (ry[i] > y1) y1 = ry[i];
    }
    const m = 90;   // the longest half-length of anything we could hit
    let best = Infinity;
    d.lead = null; d.gap = Infinity;
    let pushR = 0, roomR = 99;   // keep right: squeeze from oncoming traffic, room on the right
    const P = d.passP;           // passing: our line is shifted P px left of the route
    const test = (o, ox, oy, ofx, ofy, olen, ohw, ovx, ovy, pred) => {
      // nearest route segment within S
      let dl = Infinity, sAt = 0, ux = 0, uy = 0, side = 0;
      for (let i = 1; i < n && rs[i - 1] < S; i++) {
        const ax = rx[i - 1], ay = ry[i - 1], vx = rx[i] - ax, vy = ry[i] - ay, sl = rs[i] - rs[i - 1];
        const uu = ((ox - ax) * vx + (oy - ay) * vy) / (sl * sl), u = clamp(uu, 0, 1);
        const ex = ox - ax - vx * u, ey = oy - ay - vy * u, e = Math.hypot(ex, ey);
        if (e < dl) { dl = e; sAt = rs[i - 1] + sl * (i === 1 ? Math.min(uu, 1) : u); ux = vx / sl; uy = vy / sl; side = -ex * uy + ey * ux; }
      }
      if (dl === Infinity || sAt <= -c.len / 2 - 60) return;
      const side0 = side;
      if (P > 0.5) { side += P; dl = Math.abs(side); }
      const cos = Math.abs(ux * ofx + uy * ofy), sin = Math.sqrt(Math.max(0, 1 - cos * cos));
      // extents of its collision circles (radius hw along its axis, as Physics.carVsCar uses)
      const oAlong = (olen / 2 - ohw) * cos + ohw, oLat = (olen / 2 - ohw) * sin + ohw;
      // alongside or just ahead: how tight is it on each side?
      if (o && !pred && sAt - oAlong < c.len / 2 + 70 && sAt + oAlong > -c.len / 2) {
        const clear = dl - c.hw - oLat;
        if (side > 0) roomR = Math.min(roomR, clear);
        else if (clear < 3 && (ofx * ux + ofy * uy) < -0.5) pushR = Math.max(pushR, 3 - clear);
      }
      if (sAt <= 0 || dl >= c.hw + oLat - 1.5) return;   // it clears us (circles would at most brush)
      // its speed along our way: the lower of along the route there and along our heading now, so a
      // car we are about to merge in front of (it comes from the side) counts as standing still
      const vo = Math.min(ovx * ux + ovy * uy, ovx * c.fx + ovy * c.fy);
      // oncoming and only just overlapping: it's in its own lane, both keep right (TR.KEEP_RIGHT);
      // overlapping more (it swung wide out of a turn): brake for it
      if (o && dl > c.hw + oLat - 5 && (ofx * ux + ofy * uy) < -0.5) return;
      const gap = Math.max(0, sAt - c.len / 2 - oAlong);
      if (gap > S) return;
      // mutual block (two cars nose to side in a junction): the newer car lets the older one go
      // (not head-on: two cars nose to nose both wait, or one gives up its pass)
      if (o && o.driver && o.driver.ai && o.driver.lead === c && vo < 20 && o.driver.id < d.id && ofx * c.fx + ofy * c.fy > -0.5) return;
      if (pred && gap < 4) return;   // a predicted spot we already overlap: the real car decides
      const v0 = Math.max(0, vo);
      // behind something that isn't going anywhere (a parked or player car, the walker), stop
      // far enough back to pull out and pass it later (d.room)
      const g0 = !o || (!(o.driver && o.driver.ai) && Math.abs(vo) < 3 && !pred) ? d.room : TR.GAP_MIN;
      const v = Math.sqrt(v0 * v0 + 2 * b * Math.max(0, gap - g0 - TR.HEADWAY * v0));
      if (v < best) { best = v; d.lead = o || 'walker'; d.gap = gap; d.leadSide = side0; d.leadLat = oLat; d.leadAlong = oAlong; }
    };
    for (let gx = Math.floor((x0 - m) / C); gx <= Math.floor((x1 + m) / C); gx++) {
      for (let gy = Math.floor((y0 - m) / C); gy <= Math.floor((y1 + m) / C); gy++) {
        const bk = this.grid.get(gx * 8192 + gy);
        if (bk) for (const o of bk) {
          if (o === c) continue;
          test(o, o.x, o.y, o.fx, o.fy, o.len, o.hw, o.vx, o.vy, false);
          // crossing traffic: also where it will be in 0.4 s and 0.8 s, so we brake before it's in our path
          const sp = o.vx * o.vx + o.vy * o.vy;
          if (sp > 400 && Math.abs(o.fx * c.fx + o.fy * c.fy) < 0.8) {
            for (const tau of TR.PREDICT) test(o, o.x + o.vx * tau, o.y + o.vy * tau, o.fx, o.fy, o.len, o.hw, 0, 0, true);
          }
        }
      }
    }
    const w = this.walker;
    if (w && w.x > x0 - m && w.x < x1 + m && w.y > y0 - m && w.y < y1 + m) test(null, w.x, w.y, 1, 0, 12, 6, 0, 0);
    this.keepRight = clamp(Math.min(pushR, roomR - 0.5), 0, TR.KEEP_RIGHT);
    return best;
  },

  // ------------------------------------------------------------------ reactions --
  // Hit by the player? A velocity jump while the player's moving car touches us, or damage with
  // the player nearby and no other car touching us (a crash between two AI cars isn't theirs).
  checkHit(c, d) {
    const p = G.player, dv = Math.hypot(c.vx - d.pvx, c.vy - d.pvy), hurt = c.hp < d.hp0 - 0.5;
    d.pvx = c.vx; d.pvy = c.vy; d.hp0 = c.hp;
    if (!p || p.dead || (dv < TR.FLEE_DV && !hurt)) return;
    const pc = p.car;
    let hit = false;
    // the player's car must be driving into us (not just shoved by us: then it moves away)
    const toward = pc && (c.x - pc.x) * pc.vx + (c.y - pc.y) * pc.vy > 0.5 * pc.speed() * Math.hypot(c.x - pc.x, c.y - pc.y);
    if (pc && pc !== c && pc.speed() > TR.FLEE_RAM_V && toward && this.touching(c, pc)) hit = true;
    else if (hurt && !c.burning && dv < TR.FLEE_DV && Math.hypot(p.px - c.x, p.py - c.y) < TR.FLEE_NEAR) hit = true;
    if (hit) this.flee(c, d);
  },
  touching(a, b) {
    if (Math.abs(a.x - b.x) > (a.len + b.len) / 2 + 8 || Math.abs(a.y - b.y) > (a.len + b.len) / 2 + 8) return false;
    const r = a.hw + b.hw + 4;
    for (const p of a.circles()) for (const q of b.circles()) if ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 < r * r) return true;
    return false;
  },
  // B4 hook: start (or extend) fleeing from the player; also callable from game.js
  flee(c, d) {
    const p = G.player, fresh = !(d.fleeT > 0);
    d.fleeT = TR.FLEE_T; d.fleeX = p.px; d.fleeY = p.py;
    d.pass = null; d.blockedT = 0; d.revT = 0;
    d.fleeCount = (d.fleeCount || 0) + 1;
    // re-plan the next junction away from the player, unless we're about to reach it
    if (fresh && d.mode === 'lane') {
      const L = G.city.lanes[d.lane], t = (c.x - L.x0) * L.dx + (c.y - L.y0) * L.dy;
      if (L.len - t > 90 + c.len / 2) { d.ex = this.pickExit(L, d); d.nx = d.ex ? this.pickExit(G.city.lanes[d.ex.to], d) : null; }
    }
  },

  // What is the queue in front of us really waiting for? Follows the chain of leads: an AI car
  // stopped for a light / right of way (or still moving) is a legit wait; a parked, wrecked or
  // player car, the walker, or a stuck driver is not. The player's car sitting at a red light
  // counts as waiting too.
  blockedBy(d) {
    let o = d.lead;
    for (let i = 0; i < 8 && o; i++) {
      if (o === 'walker') return o;
      const od = o.driver;
      if (od && od.ai) {
        if (od.pass) return null;                            // it's already passing: follow it
        if (od.why === 'car' || od.why === 'walker') { if (od.blockedT > 8) return o; o = od.lead; continue; }
        return TR_WAITS[od.why] ? null : o;                  // lost / reverse / end: stuck
      }
      if (o.speed() > 5) return null;
      if (o === G.player.car && this.atRedLight(o)) return null;
      return o;
    }
    return null;
  },
  atRedLight(o) {
    const L = City.laneAt(o.x, o.y, 24, o.fx, o.fy);
    if (!L || !L.stop || !G.city.nodes[L.to].signal || Render.signalFrame(L.axis) === 2) return false;
    const D = (L.stop.x - o.x) * L.dx + (L.stop.y - o.y) * L.dy - o.len / 2;
    return D > -10 && D < 70;
  },

  honk(c, d, dt) {
    // fleeing: lean on the horn at anything in the way, after half a second
    const flee = d.fleeT > 0;
    const who = d.pass ? null : flee ? (d.blockedT > 0.5 ? d.lead : null) : d.blockedT > TR.HONK_AFTER ? this.blockedBy(d) : null;
    if (!who) { d.hornT = 0; c.honking = false; return; }
    d.hornT += dt;
    const [a, b, e, cyc] = TR.HONK_CYCLE, ph = d.hornT % cyc;
    c.honking = !!c.m.horn && (ph < a || (ph >= b && ph < e));
  },

  // Pass a blocker on the left: start after PASS_AFTER s if the shifted corridor is on the road
  // and nothing oncoming (or parked) is in it for the length of the manoeuvre; end once the
  // blocker is behind us, and give up if something oncoming turns up before we're alongside.
  passing(c, d, dt) {
    const L = G.city.lanes[d.lane];
    if (d.pass) {
      d.passT += dt;
      const o = d.pass;
      const ox = o === 'walker' ? G.player.x : o.x, oy = o === 'walker' ? G.player.y : o.y;
      const along = (ox - c.x) * c.fx + (oy - c.y) * c.fy, oLen = o === 'walker' ? 12 : o.len;
      const lead = d.lead, oncoming = lead && lead !== 'walker' && lead !== o && lead.speed() > 5 &&
        lead.fx * c.fx + lead.fy * c.fy < -0.5;
      // an oncoming car turned up: give up, unless we're already out (then it waits for us)
      const out = Math.abs((c.x - L.x0) * -L.dy + (c.y - L.y0) * L.dx);
      if (along < -(c.len + oLen) / 2 - 12 || d.passT > TR.PASS_MAX_T || (o !== 'walker' && o.gone) ||
        (oncoming && along > 0 && out < d.passNeed * 0.6) || d.mode !== 'lane') d.pass = null;
    } else if (d.mode === 'lane' && d.lead && (d.passReady > G.t ||
      (d.fleeT > 0 ? d.blockedT > TR.FLEE_PASS_AFTER && (d.lead === 'walker' || d.lead.speed() < 3)
        : d.blockedT > TR.PASS_AFTER && this.blockedBy(d) === d.lead))) {
      const need = c.hw + d.leadLat + 4 - d.leadSide;
      const lenP = d.gap + 2 * d.leadAlong + c.len + 30;
      const t = (c.x - L.x0) * L.dx + (c.y - L.y0) * L.dy;
      // room to pull out: a car can't turn tighter than 120/steer px, so from a standstill it
      // needs about sqrt(2 R need) px of gap; back up first (if the lane behind is free)
      const room = this.room(c, need);
      if (need <= 2 * L.off + 12 && L.len - t > lenP + 20 && this.passClear(c, need, lenP, d.lead)) {
        const back = room - d.gap;
        if (back > 6 && !(d.passReady > G.t) && this.roomBehind(c, back + 12)) {
          d.revT = Math.sqrt((2 * back) / (c.m.acc * 0.24)); d.revSteer = 0; d.passReady = G.t + d.revT + 1;
        } else {
          d.pass = d.lead; d.passT = 0; d.passNeed = Math.max(8, need); d.passes = (d.passes || 0) + 1; d.passReady = 0;
        }
      }
    }
    const target = d.pass ? d.passNeed : 0;
    d.passP += clamp(target - d.passP, -TR.PASS_SHIFT_V * dt, TR.PASS_SHIFT_V * dt);
  },
  // gap needed to pull out `need` px from a standstill: a car can't turn tighter than 120/steer px
  room(c, need) { return 0.8 * Math.sqrt((2 * 120 / (c.m.steer * 0.95)) * Math.max(8, need)); },
  roomBehind(c, dist) {
    const C = TR.CELL, bx = c.x - c.fx * (c.len / 2 + dist / 2), by = c.y - c.fy * (c.len / 2 + dist / 2);
    for (let gx = Math.floor((bx - 100) / C); gx <= Math.floor((bx + 100) / C); gx++) {
      for (let gy = Math.floor((by - 100) / C); gy <= Math.floor((by + 100) / C); gy++) {
        const b = this.grid.get(gx * 8192 + gy);
        if (b) for (const o of b) {
          if (o === c) continue;
          const dx = o.x - c.x, dy = o.y - c.y, lf = dx * c.fx + dy * c.fy, lx = dx * -c.fy + dy * c.fx;
          if (Math.abs(lx) < c.hw + o.hw && lf < 0 && -lf - o.len / 2 - c.len / 2 < dist) return false;
        }
      }
    }
    return true;
  },
  passClear(c, P, lenP, blocker) {
    const fx = c.fx, fy = c.fy, rx = -fy, ry = fx;
    for (let k = 0; k <= 4; k++) {                           // the shifted path stays on the road
      const f = (lenP * k) / 4, x = c.x - rx * P + fx * f, y = c.y - ry * P + fy * f;
      if (Physics.solidAt(x, y) !== 0) return false;
    }
    const tPass = (2 * lenP) / TR.PASS_V + 2, C = TR.CELL, reach = lenP + 700;
    const x0 = Math.min(c.x, c.x + fx * reach) - 80, x1 = Math.max(c.x, c.x + fx * reach) + 80;
    const y0 = Math.min(c.y, c.y + fy * reach) - 80, y1 = Math.max(c.y, c.y + fy * reach) + 80;
    for (let gx = Math.floor(x0 / C); gx <= Math.floor(x1 / C); gx++) {
      for (let gy = Math.floor(y0 / C); gy <= Math.floor(y1 / C); gy++) {
        const b = this.grid.get(gx * 8192 + gy);
        if (b) for (const o of b) {
          if (o === c || o === blocker) continue;
          const dx = o.x - c.x, dy = o.y - c.y, lx = dx * rx + dy * ry, lf = dx * fx + dy * fy;
          if (Math.abs(lx + P) > c.hw + o.hw + 4) continue;  // not in the passing corridor
          const toward = Math.max(0, -(o.vx * fx + o.vy * fy));
          if (lf > -c.len / 2 - o.len / 2 && lf < lenP + toward * tPass + o.len / 2) {
            return false;
          }
        }
      }
    }
    return true;
  },

  // ------------------------------------------------------------------ controls --
  controls(c, dt) {
    const d = c.driver, out = this.out;
    out.throttle = 0; out.steer = 0; out.hb = false;
    if (c.wreck || !G.city.lanes) return out;
    this.frame();
    if (!d.id) { d.id = ++this.nid; d.long = c.len >= TR.LONG; d.wide = c.m.w >= 30; this.enterLane(d, G.city.lanes[d.lane], null); d.blockedT = 0; d.fleeT = 0; d.stuckT = 0; d.revT = 0; d.reT = 0; d.lostT = 0; d.bias = 0; d.acqE = 0; d.revCool = 0;
      d.room = this.room(c, 2 * c.hw + 6); d.passP = 0; d.pass = null; d.passT = 0; d.passReady = 0; d.hornT = 0; d.calmV = 0; d.hp0 = c.hp; d.pvx = c.vx; d.pvy = c.vy; }
    const m = c.m, vf = c.vf();
    this.checkHit(c, d);
    if (d.fleeT > 0) { d.fleeT -= dt; if (d.fleeT <= 0) d.calmV = vf; }
    const flee = d.fleeT > 0;
    d.calmV = Math.max(0, d.calmV - TR.CALM_DECEL * dt);

    // unstick: reverse with opposite lock for a moment, so the nose swings toward the route
    if (d.revT > 0) {
      d.revT -= dt;
      out.throttle = d.revSteer ? -0.6 : -0.4; out.steer = -d.revSteer; d.why = 'reverse'; d.want = 0; c.honking = false;
      return out;
    }
    if (!this.track(c, d, dt)) { d.why = 'lost'; d.want = 0; c.honking = false; if (vf > 10) out.throttle = -0.4; return out; }

    const b = m.brake * TR.DECEL;
    const cruise = flee ? m.max : Math.max(d.cruise, d.calmV);
    const S = clamp(40 + c.len / 2 + vf + (vf * vf) / (2 * b), 90, 340);
    let Ld = TR.LOOK + TR.LOOK_V * Math.abs(vf) + TR.LOOK_LEN * c.len;
    if (d.mode === 'turn' && d.ex.turn !== 's') Ld *= TR.LOOK_TURN;
    this.build(c, d, Math.max(S, Ld) + 20);

    // steer: pure pursuit. curvature k = 2 lx / dist^2; yaw rate = steer x rate x min(v/120, 1)
    const vc = this.scan(c, d, S, b);   // the car ahead (used below), and how far to keep right
    const tp = this.at(Ld, this._tp || (this._tp = [0, 0]));
    this.passing(c, d, dt);
    d.bias += clamp((d.pass ? 0 : this.keepRight) - d.bias, -20 * dt, 20 * dt);
    const shift = d.bias - d.passP;   // px right of the route (keep right) or left (passing)
    if (Math.abs(shift) > 0.05) { tp[0] -= this.auy * shift; tp[1] += this.aux * shift; }
    const dx = tp[0] - c.x, dy = tp[1] - c.y, fx = c.fx, fy = c.fy;
    const lx = -fy * dx + fx * dy, lf = fx * dx + fy * dy, l2 = lx * lx + lf * lf || 1;
    const k = (2 * lx) / l2;
    // the route is behind us (knocked around, or re-acquired a lane the other way): back up with
    // opposite lock so the nose swings toward it, then drive on (a three-point turn)
    d.revCool -= dt;
    if (lf < -0.3 * Math.abs(lx) && Math.abs(vf) < 25 && d.revCool <= 0) {
      d.revT = TR.REVERSE_T; d.revSteer = Math.sign(lx) || 1; d.revCool = TR.REVERSE_T + 1.5;
    }
    const rate = m.steer * (1 - 0.3 * clamp(Math.abs(vf) / m.max, 0, 1));
    out.steer = clamp((k * Math.max(Math.abs(vf), 120)) / rate, -1, 1);

    // speed: the lowest limit wins
    let want = cruise, why = 'cruise';
    const lim = (v, w) => { if (v < want) { want = v; why = w; } };
    const reach = (vEnd, dist) => Math.sqrt(vEnd * vEnd + 2 * b * Math.max(0, dist));
    if (Math.abs(lf) < Math.abs(lx) * 1.2 || lf < 0) lim(40, 'turn');                  // pointing well off the route
    const vTurn = (tp, u) => (u ? Math.min(TR.UTURN_MAX, Math.sqrt(80 * tp.R))
      : Math.min(Math.sqrt((flee ? TR.FLEE_ALAT : TR.TURN_ALAT) * tp.R), cruise * TR.TURN_CRUISE, d.long ? TR.LONG_TURN_MAX : Infinity));
    if (d.pass || d.passP > 2) lim(TR.PASS_V, 'pass');
    if (d.mode === 'turn' && d.ex.turn !== 's') lim(vTurn(this.turnPath(d.ex, c), d.ex.turn === 'u'), 'turn');
    if (this.turnTp) lim(reach(vTurn(this.turnTp, this.turnU), this.turnS), 'turn');
    const half = c.len / 2, lanes = G.city.lanes, nodes = G.city.nodes;
    for (let i = 0; i < this.ns; i++) {
      const st = this.stops[i], D = st.s - half - 2;              // front bumper to the stop point
      if (st.kind === 'xing') {
        if (D > -10 && this.trainNear(st.xing)) lim(reach(0, D), 'train');
        continue;
      }
      const L = st.L, nd = nodes[L.to], mine = L.id === d.lane;
      if (flee || D < -6) continue;                                 // past the line: committed
      if (nd.signal) {
        const f = Render.signalFrame(L.axis);
        if (f === 2) {
          if (mine) d.amberGo = -1;
          // no all-red phase: on a fresh green, let cross traffic that ran the amber clear the box first
          if (mine && D < 40 + (vf * vf) / (2 * b) && this.crossing(c, nd, L)) { lim(reach(0, D), 'clear'); continue; }
        }
        else if (mine && d.amberGo === L.id) { /* decided to go on amber */ }
        else if (f === 1 && mine && (vf * vf) / (2 * m.brake * TR.AMBER_DECEL) > D) d.amberGo = L.id;
        else { lim(reach(0, D), f === 1 ? 'amber' : 'red'); continue; }
      } else if (L.yield) {
        if (!mine) { lim(reach(12, D), 'yield'); continue; }       // the next junction: approach slowly
        if (d.yieldOk !== L.id) {
          if (D < 8 && Math.abs(vf) < 10) {
            d.waitT += dt;
            if (d.waitT > 0.4 && !this.boxBusy(c, nd, L)) d.yieldOk = L.id;
          }
          if (d.yieldOk !== L.id) { lim(reach(0, D), 'yield'); continue; }
        }
      }
      // turning left across oncoming traffic: wait at the line for a gap
      if (mine && d.ex && d.ex.turn === 'l' && nd.kind === 'int' && D < 30 + (vf * vf) / (2 * b) && this.oncoming(c, nd, L)) lim(reach(0, D), 'left');
    }
    // no stop line but a left turn across traffic (2 lanes meeting a through road): wait at the box edge
    if (!flee && d.mode === 'lane' && d.ex && d.ex.turn === 'l' && !lanes[d.lane].stop && nodes[lanes[d.lane].to].arms >= 3) {
      const L = lanes[d.lane], t = (c.x - L.x0) * L.dx + (c.y - L.y0) * L.dy, D = L.len - t - half - 4;
      if (D > -6 && D < 30 + (vf * vf) / (2 * b) && this.oncoming(c, nodes[L.to], L)) lim(reach(0, D), 'left');
    }
    if (vc < want) { want = vc; why = d.lead === 'walker' ? 'walker' : 'car'; }
    if (d.mode === 'lane' && !d.ex) { const L = lanes[d.lane]; lim(reach(0, L.len - ((c.x - L.x0) * L.dx + (c.y - L.y0) * L.dy) - half), 'end'); }
    d.want = want; d.why = why;

    // pedals: feed-forward for rolling drag (1 - 0.12/s) and the acc falloff, plus a P term.
    // Never brake below 10 px/s (negative throttle would reverse): coasting drag stops the car.
    const err = want - vf;
    const ff = (0.12 * Math.max(0, vf)) / (m.acc * Math.max(0.2, 1 - (0.55 * Math.max(0, vf)) / m.max));
    if (want < 3 && vf < 15) out.throttle = 0;
    else if (err >= 0) out.throttle = clamp(ff + err / 25, 0, 1);
    else if (err > -6) out.throttle = ff * (1 + err / 6);
    else out.throttle = vf > 10 ? -clamp((-err - 3) / 15, 0, 1) : 0;

    // B4 hooks: blocked by a car/walker (not a light); stuck = wants to go but isn't moving
    const stopped = Math.abs(vf) < 5;
    d.blockedT = stopped && (why === 'car' || why === 'walker') ? d.blockedT + dt : 0;
    this.honk(c, d, dt);
    d.stuckT = stopped && want > 20 ? d.stuckT + dt : 0;
    if (d.stuckT > TR.STUCK_T) { d.stuckT = 0; d.revT = TR.REVERSE_T; d.revSteer = Math.sign(out.steer) || 1; d.revCool = TR.REVERSE_T + 1.5; d.unsticks = (d.unsticks || 0) + 1; }
    return out;
  },
};
