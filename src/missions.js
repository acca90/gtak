'use strict';
// Phone-booth missions, GTA1 style: walk up to the ringing phone to get a job.

function say(text, life = 7) {
  const words = text.toUpperCase().split(' ');
  const lines = [''];
  for (const w of words) {
    if ((lines[lines.length - 1] + ' ' + w).trim().length > 50) lines.push(w);
    else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + w).trim();
  }
  G.msg = { lines: lines.slice(0, 2), t: 0, life };
  Phone.message(Missions.active ? Missions.active.from : 'UNKNOWN', text);
}

const MISSION_TYPES = {
  delivery: {
    begin(m) {
      m.goal = Missions.farSpot(G.city.roadSpots, 1100, 2000);
      m.timer = Math.round(dist(G.player.px, G.player.py, m.goal.x, m.goal.y) / 220) + 16;
      m.reward = 1500;
      say(`Hot package, no questions. Grab any ride and reach the drop in ${m.timer} seconds.`);
    },
    target(m) { return m.goal; },
    update(m) {
      const p = G.player;
      if (p.car && dist(p.px, p.py, m.goal.x, m.goal.y) < 36) Missions.complete();
    },
  },

  boost: {
    begin(m) {
      const s = Missions.farSpot(G.city.parkSpots.concat(G.city.stalls), 900, 2000);
      m.car = Missions.placeCar(pick(G.R, ['sport', 'muscle', 'police', 'police_suv', 'suv']), s);
      m.stage = 0;
      m.reward = 3000;
      say(`A client wants that ${m.car.m.name}. Boost it and bring it to the harbor garage in one piece.`);
    },
    target(m) { return m.stage === 0 ? m.car : G.city.garage; },
    update(m) {
      const p = G.player;
      m.stage = p.car === m.car ? 1 : 0;
      if (m.stage === 1 && dist(p.px, p.py, G.city.garage.x, G.city.garage.y) < 40 && m.car.speed() < 200) {
        const kept = Math.round(100 * clamp(m.car.hp / m.car.m.hp, 0, 1));
        m.reward = Math.round(1000 + 2500 * kept / 100);
        Missions.complete(`CAR AT ${kept}%`);
      }
    },
    carDestroyed(m, c) { if (c === m.car) Missions.fail('THE CAR IS TOAST'); },
  },

  torch: {
    begin(m) {
      const s = Missions.farSpot(G.city.parkSpots.concat(G.city.stalls), 800, 1800);
      m.car = Missions.placeCar(pick(G.R, ['taxi', 'van', 'pickup', 'hatch']), s);
      m.timer = 90;
      m.reward = 2500;
      const p = G.player;
      let line = `Some fool parked a ${m.car.m.name} on our turf. Torch it.`;
      if (p.ammo.pistol + p.ammo.uzi < 20) { p.ammo.pistol += 24; line += ' Take this piece.'; }
      say(line);
    },
    target(m) { return m.car; },
    carDestroyed(m, c) { if (c === m.car) Missions.complete(); },
  },

  rush: {
    begin(m) {
      m.points = [];
      let from = { x: G.player.px, y: G.player.py };
      for (let i = 0; i < 5; i++) {
        const s = Missions.farSpot(G.city.roadSpots, 550, 1000, from);
        m.points.push(s);
        from = s;
      }
      m.i = 0;
      m.timer = 25;
      m.reward = 1200;
      say('Checkpoint rush! Hit all five marks. Every mark buys you more time. Wheels only.');
    },
    target(m) { return m.points[m.i]; },
    update(m) {
      const p = G.player, t = m.points[m.i];
      if (p.car && dist(p.px, p.py, t.x, t.y) < 38) {
        m.i++;
        Parts.sparks(t.x, t.y, 10, PAL.q);
        if (m.i >= m.points.length) { m.reward += Math.round(m.timer) * 60; Missions.complete(); }
        else { m.timer += 12; Game.toast(`CHECKPOINT ${m.i}/5  +12S`, 1.5); }
      }
    },
  },
};

const Missions = {
  init() {
    this.active = null;
    this.ringing = -1;
    this.cooldown = 2;
    this.lastPhone = -1;
    this.bag = [];
  },

  // what the arrow points at: the job, else the GPS waypoint, else a ringing payphone
  target(jobOnly) {
    if (this.active) { const t = MISSION_TYPES[this.active.type].target(this.active); return t && { x: t.x, y: t.y }; }
    if (G.waypoint && !jobOnly) return G.waypoint;
    if (this.ringing >= 0) return G.city.phones[this.ringing];
    return null;
  },

  farSpot(list, min, max, from) {
    from = from || { x: G.player.px, y: G.player.py };
    let best = null;
    for (let i = 0; i < 60; i++) {
      const s = pick(G.R, list);
      const d = dist(from.x, from.y, s.x, s.y);
      if (d >= min && d <= max) return s;
      if (!best || Math.abs(d - (min + max) / 2) < Math.abs(dist(from.x, from.y, best.x, best.y) - (min + max) / 2)) best = s;
    }
    return best;
  },

  placeCar(model, s) {
    G.cars = G.cars.filter((c) => c.driver || dist(c.x, c.y, s.x, s.y) > c.len / 2 + 34);
    const car = Game.spawnCar(model, s);
    car.target = true;
    return car;
  },

  update(dt) {
    const p = G.player;
    if (!this.active) {
      this.cooldown -= dt;
      // offer work: either a payphone rings (GTA1) or someone calls the cellphone
      if (this.ringing < 0 && !Phone.incoming && !Phone.calling && this.cooldown <= 0) {
        if (G.R() < 0.5) {
          let i;
          do { i = Math.floor(G.R() * G.city.phones.length); } while (i === this.lastPhone && G.city.phones.length > 1);
          this.ringing = i;
        } else {
          Phone.ring(pick(G.R, CONTACTS));
        }
      }
      if (this.ringing >= 0 && !p.car && !p.dead) {
        const ph = G.city.phones[this.ringing];
        if (dist(p.x, p.y, ph.x, ph.y) < 16) this.begin();
      }
      return;
    }
    const m = this.active, T = MISSION_TYPES[m.type];
    if (m.timer !== undefined) {
      m.timer -= dt;
      if (m.timer <= 0) return this.fail('OUT OF TIME');
    }
    if (T.update) T.update(m, dt);
  },

  // type/contact given when the job comes from the cellphone; payphones draw from a shuffled bag
  begin(type, contact) {
    if (this.ringing >= 0) { this.lastPhone = this.ringing; this.ringing = -1; }
    if (!type) {
      if (!this.bag.length) this.bag = ['delivery', 'boost', 'torch', 'rush'].sort(() => G.R() - 0.5);
      type = this.bag.pop();
    }
    this.active = { type, from: contact ? contact.name : 'PAYPHONE' };
    G.waypoint = null;
    MISSION_TYPES[type].begin(this.active);
  },

  complete(sub) {
    const m = this.active;
    if (!m) return;
    const pay = m.reward * G.mult;
    Game.earn(m.reward);
    G.banner = { text: 'MISSION COMPLETE', sub: '$' + pay + (sub ? '   ' + sub : '') + '   MULTIPLIER UP', color: PAL.q, t: 3.5 };
    G.mult = Math.min(9, G.mult + 1);
    if (m.car) m.car.target = false;
    this.active = null;
    this.cooldown = 4;
  },

  fail(reason, silent) {
    const m = this.active;
    if (!m) return;
    if (!silent) G.banner = { text: 'MISSION FAILED', sub: reason, color: PAL.z, t: 3 };
    if (m.car) m.car.target = false;
    this.active = null;
    this.cooldown = 4;
  },

  onCarDestroyed(c) {
    const m = this.active;
    if (m && MISSION_TYPES[m.type].carDestroyed) MISSION_TYPES[m.type].carDestroyed(m, c);
  },
  onEnterCar(c) {
    const m = this.active;
    if (m && m.type === 'boost' && c === m.car) say('Nice. Now take it to the harbor garage. Easy on the paint.', 5);
  },

  // ground markers: zones, checkpoint rings, garage
  drawGround(ctx, cam) {
    const m = this.active;
    const ring = (x, y) => {
      Assets.draw(ctx, 'big', Assets.frame('big', 'marker', Math.floor(G.t * 5)), x - cam.x - 24, y - cam.y - 24);
    };
    if (!m) { if (G.waypoint) ring(G.waypoint.x, G.waypoint.y); return; }
    if (m.type === 'delivery') ring(m.goal.x, m.goal.y);
    if (m.type === 'rush') ring(m.points[m.i].x, m.points[m.i].y);
    if (m.type === 'boost' && m.stage === 1) ring(G.city.garage.x, G.city.garage.y);
  },

  drawOver(ctx, cam) {
    const m = this.active;
    if (m && m.car && !m.car.wreck && !(m.type === 'boost' && m.stage === 1)) {
      const bob = Math.round(Math.sin(G.t * 6) * 3);
      Assets.draw(ctx, 'props', Assets.frame('props', 'pointer'), m.car.x - cam.x - 8, m.car.y - cam.y - m.car.len / 2 - 20 + bob);
    }
    if (!m && this.ringing >= 0) {
      const ph = G.city.phones[this.ringing];
      if (Math.floor(G.t * 3) % 2) Font.draw(ctx, 'RING!', ph.x - cam.x, ph.y - cam.y - 20, { align: 'center', color: PAL.q });
    }
  },

  drawHUD(ctx, cam) {
    const m = this.active;
    if (!m || m.timer === undefined) return;
    const t = Math.max(0, Math.ceil(m.timer));
    const s = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    Font.draw(ctx, s, cam.w / 2, 6, { scale: 2, align: 'center', color: t <= 10 ? PAL.z : PAL.c, shadow: true });
  },

  lights(L) {
    const t = this.target();
    if (t) L.push({ x: t.x, y: t.y, r: 44, color: 'rgba(84,232,212,0.7)' });
  },
};
