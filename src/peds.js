'use strict';
// Pedestrians and farm cows (spec docs/specs/peds-v1.md, P3, coordinator).
//
// Everyone lives in G.peds: { kind 'ped'|'cow', mood 'scared'|'angry'|'violent', bull, weapon, look,
// state, hp, dead, burnt, burning, gone, ... }. Peds stream through AOV.pool('peds') on geo-agent's
// sidewalk graph (c.walks / c.walkNodes); cows belong to a pasture pen (c.pens) and only exist while
// the pen is inside the AOV's keep ring. The dead stay as corpses (and blood) until they're far away.
//
// States: walk (follow the graph) · wait (at a kerb for the light) · return (back to the nearest
// sidewalk) · flee · cower · complain (angry) · look (violent, alarmed) · fight (violent, hit) ·
// down (knocked over) · burning · graze / stampede / charge (cows) · dead.
//
// Other code talks to this through Peds.hurt(p, dmg, { kind, src, vx, vy }), Peds.kill(p, how),
// Peds.alarm(x, y, r, kind, src) and Peds.near(x, y, r). Weapons and cars call those (P4, P5).

const PED = {
  R: 4, COW_R: 8,   // a cow is ~10x28 px: one circle is a rough fit
  HP: 30, COW_HP: 60,
  WALK: [15, 21], RUN: 58, COW_GRAZE: 6, COW_RUN: 70,   // ~11.5 px per metre: a 1.3-1.8 m/s stroll, a 5 m/s run (the player walks at 90)
  CAP: 120, NIGHT: 0.5,
  CORPSES: 50,
  FLEE_T: [6, 10], COWER: 0.2,
  COMPLAIN_T: 2.5,
  LOOK_T: 1.6,
  GIVE_UP_D: 450, GIVE_UP_T: 25,
  FIST: { dmg: 5, cool: 0.6, reach: 11, car: 1 },
  GUN_AIM: 0.12, BURST: { pistol: 3, uzi: 7, shotgun: 1 }, BURST_PAUSE: 1, GUN_RANGE: [60, 170],
  BULL: { dmg: 18, t: 12, cool: 1.2, push: 26 }, BULLS: 0.2,
  COW_RESPAWN: 180,
  WALLET: 0.55, WALLET_CASH: [10, 50], AMMO: { pistol: 12, uzi: 30, shotgun: 6 },
  BURN_T: 3,
  DOWN_T: 1.3, JACK_DOWN: 0.6, JACK_CHASE: 4, JACK_REACH: 10, JACK_V: 20,
  BLOOD_T: 2,
  DODGE: 0.3, DODGE_SEE: 0.5, DODGE_V: 60, DODGE_T: 0.35,   // chance, s of warning needed, dive px/s and s
  ALARM: { shot: 260, blast: 420, hit: 160, crash: 120, punch: 90, jack: 120 },
};
// basic cops (docs/specs/cops-v1.md): foot patrols that fight the player when they see violence
const COP = {
  HP: 70, WALK: 20, RUN: 72,
  GUNS: { pistol: 0.65, shotgun: 0.35 },
  AIM: 0.07, BURST: { pistol: 2, shotgun: 1 }, PAUSE: { pistol: 0.8, shotgun: 1.1 },
  RANGE: { pistol: [80, 200], shotgun: [40, 110] },
  SIGHT: 320, RADIO: 260, GIVE_UP_D: 600, LOST_T: 20, LOS_EVERY: 0.3,
  STATION_R: 500, STATION_SHARE: 0.15,   // the spawn is next to the station: 30% made the start a precinct
  CRIMES: { shot: 1, blast: 1, punch: 1, hit: 1, jack: 1 },   // alarm kinds that are violence when the player caused them
};
// mob members (docs/specs/gangs-v1.md): the mobs' rules live in src/gangs.js (screenplay-agent);
// here they're peds in their turf that fight back like violent peds, rally each other and, when the
// player's respect with their mob is low, come for the player on sight
const GANG = {
  HP: 40,
  GUNS: [['fist', 0.4], ['pistol', 0.45], ['uzi', 0.1], ['shotgun', 0.05]],
  SIGHT: { hostile: 160, kos: 260 },   // px: how far a member spots the player by band
  RALLY: 200,                          // a member attacked brings his own within this
  RIVAL_SIGHT: 220,                    // px: members of different mobs who see each other open fire
  SCAN: 0.5,
};
const GANG_SAYS = {
  moretti: ['THIS IS MORETTI TURF!', 'YOU LOST, PAL?', 'HEY! FAMILY BUSINESS!'],
  orlov: ['WRONG STREET, FRIEND.', 'YOU ARE LATE. FOR YOUR FUNERAL.', 'ORLOV SAYS HELLO.'],
  orchid: ['NOT WELCOME HERE.', 'THE ORCHID SEES YOU.', 'BAD MOVE.'],
};
const PED_SAYS = {
  angry: ['HEY!', 'WATCH IT!', 'ARE YOU NUTS?!', 'JERK!', "I'M CALLING THE COPS!"],
  violent: ['WANNA GO?', 'YOU WANT SOME?', 'COME ON!'],
  scared: ['AAAH!', 'HELP!', 'NO NO NO!'],
  cop: ['POLICE! FREEZE!', 'DROP IT!', 'SHOTS FIRED!', "YOU'RE UNDER ARREST!"],
  jacked: ['MY CAR!', 'THIEF!', "HEY, THAT'S MINE!", 'GET OUT OF MY CAR!'],
};

const Peds = {
  looks: 0,        // how many ped outfits the atlas has (ped0..pedN-1)
  budget: 0,
  sweepT: 0,

  // ------------------------------------------------------------ setup --
  init() {
    const c = G.city;
    G.peds = [];
    G.pedGrid = new Grid([], 64);
    this.looks = 0;
    while (hasSprite('peds', 'ped' + this.looks + '_walk')) this.looks++;
    this.copLooks = 0;
    while (hasSprite('peds', 'cop' + this.copLooks + '_walk')) this.copLooks++;
    for (const pen of c.pens || []) { pen.live = []; pen.killed = []; }
    if (!c.walks || !c.walks.length) return;   // no sidewalk graph: no pedestrians
    let near = [], cum = [], nearAt = -1;
    const self = this;
    this.pool = null;
    this.fillAt = null;
    AOV.pool('peds', {
      get max() { return self.budget; },
      list: () => G.peds.filter((p) => p.kind === 'ped' && !p.dead),
      pick() {
        if (G.t >= nearAt || self.refresh) {   // walk edges touching the AOV, and the budget, refreshed every 2 s
          nearAt = G.t + 2; self.refresh = false;
          const r = AOV.aov;
          near = City.walksIn(r.x0, r.y0, r.x1, r.y1, []).filter((e) => !e.xing);
          let b = 0;
          cum = [];
          for (const e of near) {
            const Z = ZONES[e.zone], w = Z && Z.peds ? Z.peds.density * (e.len || 0) : 0;
            b += w / TILE / 100;
            cum.push((cum.length ? cum[cum.length - 1] : 0) + w);
          }
          const h = Clock.hour();
          if (h >= 22 || h < 6) b *= PED.NIGHT;
          self.budget = Math.min(PED.CAP, Math.round(b));
        }
        if (!near.length || !cum[cum.length - 1]) return null;
        // an edge weighted by its length x its zone's density, so peds spread evenly along the sidewalks
        const u = G.R() * cum[cum.length - 1];
        let lo = 0, hi = cum.length - 1;
        while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < u) lo = m + 1; else hi = m; }
        const e = near[lo], t = 0.1 + G.R() * 0.8;
        return { e, t, x: e.x0 + (e.x1 - e.x0) * t, y: e.y0 + (e.y1 - e.y0) * t };
      },
      spawn(s) {
        if (dist(s.x, s.y, G.player.px, G.player.py) < 200) return null;
        return self.spawnAt(s);
      },
      removable: (p) => !AOV.inView(p.x, p.y, 64),
      remove(p) { p.gone = true; },
    });
    this.pool = AOV.pools.peds;
  },

  // a ped at a pool spot: its zone's mix, and now and then a cop (more around the police station)
  spawnAt(s) {
    const Z = ZONES[s.e.zone];
    if (!Z || !Z.peds || !Z.peds.density) return null;
    const st = G.city.policeStation;
    const share = st && dist(s.x, s.y, st.x, st.y) < COP.STATION_R ? COP.STATION_SHARE : Z.peds.cops || 0;
    const r = G.R();
    if (r < share) return this.spawnPed(s.e, s.x, s.y, Z.peds, 'cop');
    const gp = typeof Gangs !== 'undefined' && Gangs.presence ? Gangs.presence(s.x, s.y) : null;
    if (gp && r < share + gp.share) return this.spawnPed(s.e, s.x, s.y, Z.peds, 'gang', gp.id);
    return this.spawnPed(s.e, s.x, s.y, Z.peds, null);
  },

  // a temper from a zone's mix, and a weapon if it's violent
  temper(P, mood) {
    const R = G.R;
    if (!mood) {
      const m = P.mix, tot = m.scared + m.angry + m.violent;
      let r = R() * tot;
      mood = (r -= m.scared) < 0 ? 'scared' : (r -= m.angry) < 0 ? 'angry' : 'violent';
    }
    let weapon = 'fist';
    if (mood === 'cop') return [mood, R() < COP.GUNS.pistol ? 'pistol' : 'shotgun'];
    if (mood === 'gang') { let r = R(); for (const [w, k] of GANG.GUNS) { if ((r -= k) < 0) return [mood, w]; } return [mood, 'fist']; }
    if (mood === 'violent') { const r = R(); weapon = r < P.armed.uzi ? 'uzi' : r < P.armed.uzi + P.armed.pistol ? 'pistol' : 'fist'; }
    return [mood, weapon];
  },

  spawnPed(e, x, y, P, mood0, gang) {
    const R = G.R, N = G.city.walkNodes;
    const [mood, weapon] = this.temper(P, mood0);
    const dir = R() < 0.5 ? 1 : -1;
    const a = N[dir > 0 ? e.from : e.to], b = N[dir > 0 ? e.to : e.from];
    const p = {
      kind: 'ped', mood, weapon, look: this.looks ? Math.floor(R() * this.looks) : 0,
      x, y, ang: Math.atan2(b.x - a.x, -(b.y - a.y)), vx: 0, vy: 0,
      hp: PED.HP, speed: PED.WALK[0] + R() * (PED.WALK[1] - PED.WALK[0]),
      lat: 3 + R() * 11,          // px to the right of the path's centre line
      state: 'walk', e: e.id, dir, t: 0,
      walkT: R() * 4, cool: 0, punchT: 0, shootT: 0, flash: 0,
    };
    if (mood === 'cop') { p.hp = COP.HP; p.speed = COP.WALK; p.look = this.copLooks ? Math.floor(R() * this.copLooks) : p.look; }
    if (mood === 'gang') this.makeMember(p, gang);
    G.peds.push(p);
    this.dirty = true;   // not in G.pedGrid until it's rebuilt
    return p;
  },

  // carjacking (docs/specs/carjack-v1.md): the driver of `car` is out at (x, y), on the ground.
  // o.byPlayer: the player took the car. o.mood forces a temper (#demo). o.gang: a mob member.
  // o.bail: a mob crew leaving its car to fight (on their feet, not jacked); used for the passenger too.
  // o.foe: who they bail out to fight (a rival member); the player when absent.
  driverOut(car, x, y, ang, o = {}) {
    const L = car.driver && car.driver.lane != null ? G.city.lanes[car.driver.lane] : null;
    const Z = L && ZONES[L.zone] && ZONES[L.zone].peds && ZONES[L.zone].peds.density ? ZONES[L.zone].peds : ZONES.downtown.peds;
    const [mood, weapon] = this.temper(Z, o.gang ? 'gang' : o.mood);
    const hit = City.walkAt(x, y, 200);
    const R = G.R;
    const p = {
      kind: 'ped', mood, weapon, look: car.driverLook != null ? car.driverLook : this.looks ? Math.floor(R() * this.looks) : 0,
      x, y, ang, vx: 0, vy: 0,
      hp: PED.HP, speed: PED.WALK[0] + R() * (PED.WALK[1] - PED.WALK[0]),
      lat: 3 + R() * 11,
      state: 'down', t: PED.JACK_DOWN, e: hit ? hit.walk.id : -1, dir: 1,
      walkT: 0, cool: 0, punchT: 0, shootT: 0, flash: 0,
      foe: o.byPlayer ? G.player : null, jacked: car,
    };
    if (o.gang) this.makeMember(p, o.gang);
    G.peds.push(p);
    this.dirty = true;
    if (o.bail) {   // a mob crew jumping out to fight (their car was hit): on their feet, straight at the player
      p.state = 'walk'; p.t = 0; p.jacked = null;
      this.gangFight(p, o.foe || G.player);   // o.foe: a rival they bailed out to fight
      return p;
    }
    this.alarm(x, y, PED.ALARM.jack, 'jack', G.player, p);
    return p;
  },

  // where a foe is: the player's car when they drive
  at(f) { return f === G.player ? { x: G.player.px, y: G.player.py } : f; },

  spawnCow(pen) {
    const R = Math.random;
    const cow = {
      kind: 'cow', pen, bull: R() < PED.BULLS, mood: 'scared', weapon: 'fist',
      x: lerp(pen.x0 + 8, pen.x1 - 8, R()), y: lerp(pen.y0 + 8, pen.y1 - 8, R()),
      ang: R() * Math.PI * 2, vx: 0, vy: 0, hp: PED.COW_HP,
      state: 'graze', t: R() * 5, walkT: R() * 4, cool: 0, flash: 0,
    };
    G.peds.push(cow);
    pen.live.push(cow);
    this.dirty = true;
    return cow;
  },

  // ------------------------------------------------------------- API --
  near(x, y, r) {
    if (this.dirty) { G.pedGrid = new Grid(G.peds.filter((p) => !p.gone), 64); this.dirty = false; }
    return G.pedGrid.near(x, y, r * 2).filter((p) => !p.dead && !p.gone && Math.abs(p.x - x) < r && Math.abs(p.y - y) < r && dist(p.x, p.y, x, y) < r);
  },

  // src: G.player, a car, or another ped. vx/vy: the hit's push (px/s)
  hurt(p, dmg, o = {}) {
    if (p.dead || p.gone) return;
    p.hp -= dmg;
    p.flash = 0.08;
    if (o.vx || o.vy) { p.vx += o.vx; p.vy += o.vy; }
    if (o.kind === 'bullet' && Render.bloodSplat && Math.random() < 0.6) {
      const v = Math.hypot(o.vx || 0, o.vy || 0) || 1;
      Render.bloodSplat(p.x, p.y, (o.vx || 0) / v, (o.vy || 0) / v);
    }
    if (o.kind === 'fire' && p.kind === 'ped' && !p.burning) { p.burning = true; p.state = 'burning'; p.t = PED.BURN_T; this.say(p, pick(Math.random, PED_SAYS.scared)); }
    const foe = this.foeOf(o.src);
    if (p.gang && foe === G.player && typeof Gangs !== 'undefined' && p.hp > 0 && !p.hurtBy) { p.hurtBy = true; Gangs.memberHurt(p.gang, G.player); }   // once per member
    if (p.hp <= 0) return this.kill(p, o.kind, o);
    if (p.burning) return;
    if ((o.kind === 'car' && Math.hypot(o.vx || 0, o.vy || 0) > 40) || (o.kind === 'punch' && Math.random() < 0.25) || o.kind === 'blast') {
      p.state = 'down'; p.t = PED.DOWN_T; p.foe = foe;
    } else this.react(p, foe, o.kind);
    this.alarm(p.x, p.y, PED.ALARM.hit, 'hit', o.src, p);
  },

  // how p reacts to being hurt by foe (after getting up, too)
  // is b on p's side? (same mob, or both cops): friendly fire hurts but starts no fight
  sameSide(p, b) {
    return !!(b && b.kind === 'ped' && b !== G.player && ((p.gang && b.gang === p.gang) || (p.mood === 'cop' && b.mood === 'cop')));
  },

  react(p, foe, kind) {
    if (this.sameSide(p, foe)) {   // hit by one of their own: shrug it off, keep doing what they were doing
      if (p.state === 'down') { p.state = p.foe && p.foe !== foe ? 'fight' : 'look'; p.t = p.state === 'fight' ? PED.GIVE_UP_T : PED.LOOK_T; }
      return;
    }
    const busy = p.state === 'fight' && p.foe && p.foe !== foe && !(p.foe === G.player ? G.player.dead : p.foe.dead || p.foe.gone);
    if (p.mood === 'cop') {   // the player's violence makes a cop engage; a ped who hurts a cop gets fought
      if (foe === G.player) this.engage(p);
      else if (foe && foe.kind === 'ped') { if (!busy) { p.state = 'fight'; p.foe = foe; p.t = COP.LOST_T; p.losT = 0; p.los = true; p.burst = COP.BURST[p.weapon] || 1; } }
      else { p.state = 'look'; p.t = PED.LOOK_T; }
      return;
    }
    if (p.kind === 'cow') {
      if (p.bull && foe) { p.state = 'charge'; p.t = PED.BULL.t; p.foe = foe; }
      else this.stampede(p, foe || p);
      return;
    }
    if (p.jacked && foe === G.player && p.mood === 'angry') {
      this.complain(p, foe); p.t = PED.JACK_CHASE; this.say(p, pick(Math.random, PED_SAYS.jacked));
      return;
    }
    if (p.mood === 'gang' && foe) {   // whoever it was (the player, a civilian, a cop): fight them, and call the crew
      if (!busy) { this.gangFight(p, foe); this.rally(p, foe); }
      return;
    }
    if (p.mood === 'violent' && foe) {
      p.state = 'fight'; p.foe = foe; p.t = PED.GIVE_UP_T; p.burst = PED.BURST[p.weapon] || 3; p.cool = Math.max(p.cool, 0.35);   // a beat before hitting back (weapons-agent)
      this.say(p, pick(Math.random, p.jacked ? PED_SAYS.jacked : PED_SAYS.violent));
    } else if (p.mood === 'angry' && kind !== 'bullet' && kind !== 'blast' && foe) {
      this.complain(p, foe);
    } else this.flee(p, foe ? this.at(foe) : p);
  },

  // turn whatever hit us into a foe: the player (on foot or in a car), or a ped
  foeOf(src) {
    if (!src) return null;
    if (src === G.player || (src.driver && src.driver === G.player)) return G.player;
    if (src.kind === 'ped' || src.kind === 'cow') return src;
    return null;
  },

  kill(p, how, o = {}) {
    if (p.dead) return;
    p.dead = true; p.hp = 0; p.burning = false;
    p.state = 'dead'; p.deadT = G.t;
    p.burnt = how === 'fire';
    const v = Math.hypot(p.vx, p.vy);
    if (v > 160) { p.vx *= 160 / v; p.vy *= 160 / v; }
    p.slide = 0.35;
    if (p.burnt) { Render.scorch(p.x, p.y, Math.random, 9); for (let i = 0; i < 4; i++) Parts.smoke(p.x, p.y, true); }
    else { p.bloodT = PED.BLOOD_T; p.bloodSeed = (Math.random() * 1e9) | 0; }
    if (p.kind === 'cow') {
      const pen = p.pen;
      if (pen) { pen.live = pen.live.filter((k) => k !== p); pen.killed.push(G.t + PED.COW_RESPAWN); }
    } else this.loot(p);
    if (p.gang && typeof Gangs !== 'undefined') {   // a member down: the crew goes for whoever did it (not their own)
      const killer = this.foeOf(o.src);
      Gangs.memberKilled(p.gang, killer);
      if (killer && !this.sameSide(p, killer)) for (const q of this.near(p.x, p.y, GANG.RALLY)) if (q.gang === p.gang && q !== killer) this.gangFight(q, killer);
    }
    if (p.mood === 'cop') for (const c of this.near(p.x, p.y, COP.SIGHT)) if (c.mood === 'cop' && c !== p && this.sees(c, p.x, p.y)) this.say(c, 'OFFICER DOWN!');
    this.alarm(p.x, p.y, PED.ALARM.hit, 'hit', o.src, p);
  },

  loot(p) {
    if (p.weapon !== 'fist') G.pickups.push({ kind: p.weapon, x: p.x + 6, y: p.y + 3, away: 0, n: PED.AMMO[p.weapon], once: true });
    else if (Math.random() < PED.WALLET) {
      const [a, b] = PED.WALLET_CASH;
      G.pickups.push({ kind: 'wallet', cash: Math.round((a + Math.random() * (b - a)) / 5) * 5, x: p.x + 5, y: p.y + 2, away: 0, once: true });
    }
  },

  // something violent happened at (x, y): everyone within r reacts. `who` is excluded (the victim)
  alarm(x, y, r, kind, src, who) {
    const foe = this.foeOf(src);
    if (foe === G.player && COP.CRIMES[kind]) this.crime(x, y, kind);
    for (const p of this.near(x, y, r)) {
      if (p.mood === 'cop') { if (p.state !== 'fight' && p.state !== 'look' && p !== who) { p.state = 'look'; p.t = PED.LOOK_T; p.lookAt = { x, y }; } continue; }
      if (p === who || p === src || p.burning || p.state === 'down') continue;
      if (p.kind === 'cow') { if (p.state !== 'charge' && kind !== 'punch') this.stampede(p, { x, y }); continue; }
      if (p.state === 'fight') continue;
      const close = dist(p.x, p.y, x, y) < 120;
      if (p.mood === 'scared') {
        if (p.state === 'flee' || p.state === 'cower') { p.t = Math.max(p.t, PED.FLEE_T[0]); continue; }
        if ((kind === 'shot' || kind === 'blast') && Math.random() < PED.COWER) { p.state = 'cower'; p.t = PED.FLEE_T[0]; continue; }
        this.flee(p, { x, y });
      } else if (p.mood === 'angry') {
        if ((kind === 'shot' || kind === 'blast') && close) this.flee(p, { x, y }, true);
        else if (foe && p.state !== 'complain' && p.state !== 'flee') this.complain(p, foe);
      } else if (p.state !== 'look') {   // violent: sizes it up, but only a hit starts a fight
        p.state = 'look'; p.t = PED.LOOK_T; p.lookAt = { x, y };
        if (Math.random() < 0.5) this.say(p, pick(Math.random, PED_SAYS.violent));
      }
    }
  },

  flee(p, from, yelling) {
    p.state = 'flee';
    p.t = PED.FLEE_T[0] + Math.random() * (PED.FLEE_T[1] - PED.FLEE_T[0]);
    p.from = { x: from.x, y: from.y };
    p.fleeA = Math.atan2(p.x - from.x, -(p.y - from.y)) + (Math.random() - 0.5) * 0.8;
    if (yelling) this.say(p, pick(Math.random, PED_SAYS.angry));
    else if (Math.random() < 0.3) this.say(p, pick(Math.random, PED_SAYS.scared));
  },

  complain(p, foe) {
    p.state = 'complain'; p.foe = foe; p.t = PED.COMPLAIN_T + Math.random();
    this.say(p, pick(Math.random, PED_SAYS.angry));
  },

  stampede(c, from) {
    c.state = 'stampede'; c.t = 4 + Math.random() * 4;
    c.fleeA = Math.atan2(c.x - from.x, -(c.y - from.y)) + (Math.random() - 0.5) * 1.2;
  },

  say(p, text) { p.bubble = { text, t: 1.8 }; },

  // ------------------------------------------------------------- cops --
  // the player did something violent: every cop who can see the player joins in, and radios the others
  crime() {
    const pl = G.player;
    if (pl.dead) return;
    for (const c of this.near(pl.px, pl.py, COP.SIGHT)) {
      if (c.mood !== 'cop' || c.state === 'fight' || c.state === 'down' || c.burning) continue;
      if (this.sees(c, pl.px, pl.py)) this.engage(c);
    }
  },

  engage(c, radio) {
    if (c.dead || c.state === 'fight') return;
    c.state = 'fight'; c.foe = G.player; c.t = COP.LOST_T; c.losT = 0; c.los = true;
    c.burst = COP.BURST[c.weapon] || 1; c.cool = Math.max(c.cool, radio ? 0.6 : 0.4);
    this.say(c, pick(Math.random, PED_SAYS.cop));
    if (radio) return;
    for (const o of this.near(c.x, c.y, COP.RADIO)) if (o.mood === 'cop' && o !== c) this.engage(o, true);
  },

  // ------------------------------------------------------------- mobs --
  gangInfo(id) { return typeof Gangs !== 'undefined' && Gangs.list ? Gangs.list.find((g) => g.id === id) : null; },

  // dress a ped as a member of mob `id` (outfits `<prefix><k>_*` from pixel-agent)
  makeMember(p, id) {
    const g = this.gangInfo(id);
    p.mood = 'gang'; p.gang = id; p.hp = GANG.HP; p.scanT = Math.random() * GANG.SCAN;
    p.outfit = (g && g.outfit) || id;
    if (!this.gangLooks) this.gangLooks = {};
    if (this.gangLooks[p.outfit] == null) { let k = 0; while (hasSprite('peds', p.outfit + k + '_walk')) k++; this.gangLooks[p.outfit] = k; }
    const n = this.gangLooks[p.outfit];
    p.look = n ? Math.floor(Math.random() * n) : p.look;
    if (!n) p.outfit = null;   // art not in yet: a plain ped look
  },

  band(id) { return typeof Gangs !== 'undefined' && Gangs.band ? Gangs.band(id) : 'neutral'; },

  // a member at low respect spots the player and goes for them
  gangScan(p, dt) {
    if ((p.scanT -= dt) > 0) return;
    p.scanT = GANG.SCAN;
    // a rival mob's member in sight: shoot on sight, and the crew joins in
    for (const o of this.near(p.x, p.y, GANG.RIVAL_SIGHT)) {
      if (!o.gang || o.gang === p.gang || o.dead || o.gone || !this.sees(p, o.x, o.y)) continue;
      this.gangFight(p, o); this.rally(p, o);
      return;
    }
    const b = this.band(p.gang), r = GANG.SIGHT[b], pl = G.player;
    if (!r || pl.dead) return;
    if (dist(p.x, p.y, pl.px, pl.py) < r && this.sees(p, pl.px, pl.py)) {
      this.gangFight(p);
      this.rally(p);
    }
  },

  // whose turf a walk edge is in (cached on the edge); members don't walk into another mob's turf
  edgeTurf(e) {
    if (e._turf === undefined) e._turf = typeof Gangs !== 'undefined' && Gangs.turfAt ? Gangs.turfAt((e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2) : null;
    return e._turf;
  },

  gangFight(p, foe = G.player) {
    if (p.state === 'fight') return;
    p.state = 'fight'; p.foe = foe; p.t = PED.GIVE_UP_T; p.burst = PED.BURST[p.weapon] || 3; p.cool = Math.max(p.cool, 0.35);
    const lines = GANG_SAYS[p.gang];
    if (lines && Math.random() < 0.6) this.say(p, pick(Math.random, lines));
  },

  // the player hit one of us: every member of the same mob close by joins in
  rally(p, foe = G.player) {
    for (const o of this.near(p.x, p.y, GANG.RALLY)) if (o !== p && o !== foe && o.gang === p.gang && o.state !== 'fight' && o.state !== 'down') this.gangFight(o, foe);
  },

  // a clear line from p to (x, y): no building in between (sampled every 12 px)
  sees(p, x, y) {
    const d = dist(p.x, p.y, x, y), n = Math.ceil(d / 12);
    for (let i = 1; i < n; i++) if (Physics.buildingAt(lerp(p.x, x, i / n), lerp(p.y, y, i / n))) return false;
    return true;
  },

  // ------------------------------------------------------------ update --
  // a new game, or the camera jumped (respawn, #demo goto): populate the whole AOV at once,
  // on screen too, instead of trickling people in from the edges
  fill() {
    const P = this.pool, cam = G.cam;
    if (!P || !AOV.aov) return;
    const far = !this.fillAt || dist(cam.cx, cam.cy, this.fillAt.x, this.fillAt.y) > 1500;
    this.fillAt = { x: cam.cx, y: cam.cy };
    if (!far) return;
    AOV.rings();   // the camera just jumped: this tick's rings aren't computed yet
    this.refresh = true;
    P.pick();   // refresh the walk list and the budget for this spot
    const walking = () => G.peds.filter((p) => p.kind === 'ped' && !p.dead && !p.gone && AOV.inAov(p.x, p.y)).length;   // the old area's peds are dropped later this tick
    for (let n = walking(), tries = 0; n < this.budget && tries < this.budget * 4; tries++) {
      const s = P.pick();
      if (s && AOV.inAov(s.x, s.y) && dist(s.x, s.y, G.player.px, G.player.py) > 40) {
        if (this.spawnAt(s)) n++;
      }
    }
  },

  update(dt) {
    if (!G.peds) return;
    this.fill();
    this.cows(dt);
    G.pedGrid = new Grid(G.peds.filter((p) => !p.gone), 64);
    this.carGrid = new Grid(G.cars, 160);
    this.dirty = false;
    this.dodge();
    const pl = G.player;
    for (const p of G.peds) {
      if (p.gone) continue;
      p.flash -= dt; p.cool -= dt; p.punchT -= dt; p.shootT -= dt;
      if (p.bubble && (p.bubble.t -= dt) <= 0) p.bubble = null;
      if (p.dead) { this.corpse(p, dt); continue; }
      if (p.kind === 'cow') this.cow(p, dt);
      else this.ped(p, dt);
      // soft separation from other walkers and from the player on foot
      const r = p.kind === 'cow' ? PED.COW_R : PED.R;
      for (const o of G.pedGrid.near(p.x, p.y, 16)) {
        if (o === p || o.dead || o.gone) continue;
        const rr = r + (o.kind === 'cow' ? PED.COW_R : PED.R), dx = p.x - o.x, dy = p.y - o.y, d = Math.hypot(dx, dy);
        if (d < rr && d > 0.01) { const k = (rr - d) * 0.5; p.x += (dx / d) * k; p.y += (dy / d) * k; }
      }
      if (!pl.car && !pl.dead) {
        const dx = p.x - pl.x, dy = p.y - pl.y, d = Math.hypot(dx, dy), rr = r + 4;
        if (d < rr && d > 0.01) { p.x = pl.x + (dx / d) * rr; p.y = pl.y + (dy / d) * rr; }
      }
    }
    this.sweepT -= dt;
    if (this.sweepT <= 0) { this.sweepT = 0.5; this.sweep(); }
  },

  // drop far-away corpses (and anything gone), and keep the corpse count down
  sweep() {
    let dead = 0;
    for (const p of G.peds) {
      if (p.dead && !p.gone && !AOV.inKeep(p.x, p.y)) p.gone = true;
      if (p.dead && !p.gone) dead++;
    }
    if (dead > PED.CORPSES) {
      const old = G.peds.filter((p) => p.dead && !p.gone && !AOV.inView(p.x, p.y, 64)).sort((a, b) => a.deadT - b.deadT);
      for (let i = 0; i < dead - PED.CORPSES && i < old.length; i++) old[i].gone = true;
    }
    G.peds = G.peds.filter((p) => !p.gone);
  },

  // walkers in the path of a fast car jump aside (most of them)
  dodge() {
    for (const c of G.cars) {
      if (c.asleep || c.alt > 2) continue;
      const v = c.speed();
      if (v < 60) continue;
      const fx = c.vx / v, fy = c.vy / v, reach = c.len / 2 + v * 0.9;
      for (const p of G.pedGrid.near(c.x + fx * reach / 2, c.y + fy * reach / 2, reach)) {
        if (p.dead || p.dodged || p.state === 'down' || p.state === 'fight' || p.state === 'charge' || p.burning) continue;
        const rx = p.x - c.x, ry = p.y - c.y, along = rx * fx + ry * fy, lat = rx * fy - ry * fx;
        if (along < c.len / 2 - 4 || along > reach || Math.abs(lat) > c.hw + 8) continue;
        p.dodged = true;   // one roll of the dice per close call
        // only a car seen coming with some warning can be dodged, and only sometimes
        if ((along - c.len / 2) / v < PED.DODGE_SEE || Math.random() > PED.DODGE) continue;
        const s = lat >= 0 ? 1 : -1;
        p.jump = { x: fy * s, y: -fx * s, t: PED.DODGE_T };
        if (p.kind === 'ped' && p.mood === 'angry' && Math.random() < 0.6) this.say(p, pick(Math.random, PED_SAYS.angry));
      }
    }
  },

  // Physics.moveWalker, but only against the cars in nearby cells (it scans every car, x 100 peds)
  move(p, dx, dy, r = PED.R) {
    const x0 = p.x, y0 = p.y, S = (x, y) => Physics.solidAt(x, y);
    const blocked = (x, y) => S(x - r, y - r) || S(x + r, y - r) || S(x - r, y + r) || S(x + r, y + r);
    if (!blocked(p.x + dx, p.y)) p.x += dx;
    if (!blocked(p.x, p.y + dy)) p.y += dy;
    for (const o of G.obstacleGrid.near(p.x, p.y)) {
      const ddx = p.x - o.x, ddy = p.y - o.y, rr = o.r + r, d = Math.hypot(ddx, ddy);
      if (d < rr && d > 0) { p.x = o.x + (ddx / d) * rr; p.y = o.y + (ddy / d) * rr; }
    }
    for (const c of this.cars(p.x, p.y)) {
      if (c.airborne) continue;
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
    return Math.hypot(p.x - x0, p.y - y0);
  },

  // cars near (x, y), from a grid rebuilt once per tick (cells cover the longest car)
  cars(x, y) { return this.carGrid ? this.carGrid.near(x, y) : G.cars; },

  // walk toward (tx, ty) at speed v; face that way
  goTo(p, tx, ty, v, dt) {
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
    if (d < 0.5) return 0;
    const s = Math.min(d, v * dt);
    p.ang = Math.atan2(dx, -dy);
    p.walkT += dt * v / 30;
    return this.move(p, (dx / d) * s, (dy / d) * s);
  },

  ped(p, dt) {
    // momentum from hits and dives (down, dodge)
    if (p.jump) {
      p.jump.t -= dt;
      this.move(p, p.jump.x * PED.DODGE_V * dt, p.jump.y * PED.DODGE_V * dt);
      p.walkT += dt * 3;
      if (p.jump.t <= 0) p.jump = null;
      return;
    }
    if (p.vx || p.vy) {
      this.move(p, p.vx * dt, p.vy * dt);
      const k = Math.pow(0.02, dt);
      p.vx *= k; p.vy *= k;
      if (Math.abs(p.vx) + Math.abs(p.vy) < 2) { p.vx = 0; p.vy = 0; }
    }
    if (p.dodged && !this.carNear(p, 60)) p.dodged = false;
    p.t -= dt;
    if (p.gang && (p.state === 'walk' || p.state === 'wait' || p.state === 'look' || p.state === 'return')) this.gangScan(p, dt);
    switch (p.state) {
      case 'walk': return this.walk(p, dt);
      case 'wait': return this.wait(p, dt);
      case 'return': return this.back(p, dt);
      case 'flee': {
        const v = PED.RUN * (p.mood === 'scared' ? 1 : 0.85);
        const moved = this.move(p, Math.sin(p.fleeA) * v * dt, -Math.cos(p.fleeA) * v * dt);
        p.ang = p.fleeA; p.walkT += dt * 3;
        if (moved < v * dt * 0.3) p.fleeA += (Math.random() < 0.5 ? -1 : 1) * 1.1;   // blocked: veer
        if (p.t <= 0) p.state = 'return';
        return;
      }
      case 'cower': if (p.t <= 0) this.flee(p, p.from || p); return;
      case 'complain': {
        if (!p.foe || p.t <= 0) { p.state = 'return'; p.jacked = null; return; }
        const f = this.at(p.foe), d = dist(p.x, p.y, f.x, f.y);
        p.ang = Math.atan2(f.x - p.x, -(f.y - p.y));
        if (d > 22 && p.t > 0.8) this.goTo(p, f.x, f.y, p.jacked ? PED.RUN * 0.8 : p.speed * 1.3, dt);
        return;
      }
      case 'look':
        if (p.lookAt) p.ang = Math.atan2(p.lookAt.x - p.x, -(p.lookAt.y - p.y));
        if (p.t <= 0) p.state = 'walk';
        return;
      case 'fight': return this.fight(p, dt);
      case 'jacking':   // pulling the player out (Game.jack runs it); back to the fight if it failed
        if (!G.jack || G.jack.by !== p || p.t <= 0) { p.state = 'fight'; p.t = PED.GIVE_UP_T; }
        return;
      case 'down':
        if (p.t <= 0) this.react(p, p.foe, 'punch');
        return;
      case 'burning': {
        if (!p.fleeA || Math.random() < dt * 2.5) p.fleeA = Math.random() * Math.PI * 2;
        this.move(p, Math.sin(p.fleeA) * PED.RUN * dt, -Math.cos(p.fleeA) * PED.RUN * dt);
        p.ang = p.fleeA; p.walkT += dt * 3;
        if (Math.random() < 0.7) Parts.add({ k: 'fire', x: p.x + (Math.random() - 0.5) * 6, y: p.y + (Math.random() - 0.5) * 6, vx: 0, vy: -12, life: 0.3 });
        if (Math.random() < dt * 4) Parts.smoke(p.x, p.y, true);
        if (p.t <= 0) this.kill(p, 'fire');
        return;
      }
    }
  },

  carNear(p, r) {
    for (const c of this.cars(p.x, p.y)) if (!c.asleep && Math.abs(c.x - p.x) < r + c.len / 2 && Math.abs(c.y - p.y) < r + c.len / 2 && c.speed() > 20) return true;
    return false;
  },

  // the two ends of edge e in walking order
  ends(e, dir) {
    const N = G.city.walkNodes;
    return dir > 0 ? [N[e.from], N[e.to]] : [N[e.to], N[e.from]];
  },

  walk(p, dt) {
    const W = G.city.walks, e = W[p.e];
    const [a, b] = this.ends(e, p.dir);
    const L = dist(a.x, a.y, b.x, b.y) || 1, ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    const t = clamp((p.x - a.x) * ux + (p.y - a.y) * uy, 0, L);
    if (t >= L - 3) return this.atNode(p, b, e);
    const lat = e.xing ? Math.min(p.lat, 6) : p.lat;
    const ahead = Math.min(L, t + 10);
    const v = e.xing ? p.speed * 1.35 : p.speed;
    // a car stopped across the zebra: wait for it rather than walking into it (but not for one
    // that's waiting for us), and never step onto the rails with a train coming
    const ax = a.x + ux * ahead, ay = a.y + uy * ahead;
    if (e.xing && this.blockedAt(ax, ay, p)) return;
    if (Traffic.trainNear({ x: ax, y: ay })) return;
    const moved = this.goTo(p, a.x + ux * ahead - uy * lat, a.y + uy * ahead + ux * lat, v, dt);
    p.stuck = moved < v * dt * 0.2 ? (p.stuck || 0) + dt : 0;
    if (p.stuck > 3) { p.dir = -p.dir; p.stuck = 0; }   // walked into a wall of props: turn back
  },

  blockedAt(x, y, p) {
    for (const c of this.cars(x, y)) if (!(p && c.driver && c.driver.leadPed === p) && Math.abs(c.x - x) < c.len && Math.abs(c.y - y) < c.len && c.contains(x, y, 4)) return true;
    return false;
  },

  // at the end of an edge: choose the next one (no U-turn unless it's a dead end)
  atNode(p, nd, from) {
    const W = G.city.walks;
    const opts = nd.edges.filter((id) => id !== from.id);
    if (!opts.length) { p.dir = -p.dir; return; }
    let tot = 0;
    const w = opts.map((id) => {
      let k = W[id].xing ? (from.xing ? 0.05 : 0.6) : 1;
      if (p.gang) { const t = this.edgeTurf(W[id]); if (t && t !== p.gang) k *= 0.001; }   // a rival's turf: only if there's no other way
      tot += k; return k;
    });
    let r = Math.random() * tot, i = 0;
    while ((r -= w[i]) > 0 && i < opts.length - 1) i++;
    const e = W[opts[i]];
    p.e = e.id; p.dir = e.from === nd.id ? 1 : -1;
    if (e.xing) { p.state = 'wait'; p.t = 25; }
  },

  // at the kerb of a crossing: signalised ones wait for the road's red with time to cross,
  // the others for a gap in the traffic
  wait(p, dt) {
    const e = G.city.walks[p.e];
    const [a, b] = this.ends(e, p.dir);
    p.ang = Math.atan2(b.x - a.x, -(b.y - a.y));
    if (this.crossable(e, p)) { p.state = 'walk'; return; }
    if (p.t <= 0) {   // gave up: go back the way we came
      const nd = a, opts = nd.edges.filter((id) => !G.city.walks[id].xing);
      if (opts.length) { const e2 = G.city.walks[pick(Math.random, opts)]; p.e = e2.id; p.dir = e2.from === nd.id ? 1 : -1; }
      p.state = 'walk';
    }
  },

  crossable(e, p) {
    const len = e.len || dist(e.x0, e.y0, e.x1, e.y1), need = len / (p.speed * 1.35) + 1.5;
    const mx = (e.x0 + e.x1) / 2, my = (e.y0 + e.y1) / 2;
    if (e.xing.node != null) {
      if (Render.signalFrame(e.xing.axis) !== 0) return false;
      for (let s = 0.5; s <= need; s += 0.5) if (Render.signalFrame(e.xing.axis, G.t + s) !== 0) return false;
      return !this.blockedAt(mx, my);
    }
    for (const c of G.cars) {
      if (c.asleep || c.alt > 2) continue;
      const dx = mx - c.x, dy = my - c.y, d = Math.hypot(dx, dy);
      if (d > 150) continue;
      if (c.contains(mx, my, 10)) return false;
      const v = c.speed();
      if (v > 15 && (c.vx * dx + c.vy * dy) / (v * d || 1) > 0.5 && d / v < need + 1) return false;
    }
    return true;
  },

  // back to the nearest sidewalk after a fright
  back(p, dt) {
    if (!p.home || p.t < -1) {
      const hit = City.walkAt(p.x, p.y, 240);
      if (!hit) { p.state = 'walk'; p.t = 0; if (!G.city.walks[p.e]) p.gone = true; return; }
      p.home = hit; p.t = 12;
    }
    const h = p.home;
    if (this.goTo(p, h.x, h.y, p.speed * 1.2, dt) < 0.3 || p.t <= 0) {
      const e = h.e || h.walk || G.city.walks[h.id];
      if (e && !e.xing) { p.e = e.id; p.dir = Math.random() < 0.5 ? 1 : -1; }
      p.state = 'walk'; p.home = null;
    }
  },

  fight(p, dt) {
    const f = p.foe, pl = G.player;
    const fx = f === pl ? pl.px : f.x, fy = f === pl ? pl.py : f.y;
    const gone = f === pl ? pl.dead : (f.dead || f.gone);
    const d = dist(p.x, p.y, fx, fy), cop = p.mood === 'cop';
    if (cop) {   // sight: refreshed a few times a second; out of sight for LOST_T and they give up
      p.losT -= 1 / 60;
      if (p.losT <= 0) { p.losT = COP.LOS_EVERY; p.los = d < COP.SIGHT * 1.5 && this.sees(p, fx, fy); }
      if (p.los) p.t = COP.LOST_T;
    }
    if (gone || d > (cop ? COP.GIVE_UP_D : PED.GIVE_UP_D) || p.t <= 0) {
      if (cop && !gone) this.say(p, 'LOST HIM.');
      p.state = 'return'; p.foe = null; return;
    }
    p.ang = Math.atan2(fx - p.x, -(fy - p.y));
    const car = f === pl && pl.car;
    // our stolen car, still slow: get to the driver's door and pull the thief out
    if (p.weapon === 'fist' && car && car === p.jacked && typeof Game.jack === 'function') {
      const door = Game.driverDoor ? Game.driverDoor(car) : { x: car.x, y: car.y };
      const dd = dist(p.x, p.y, door.x, door.y);
      if (dd > PED.JACK_REACH) this.goTo(p, door.x, door.y, PED.RUN, dt);
      else if (car.speed() < PED.JACK_V && Game.jack(car, p)) { p.state = 'jacking'; p.t = 3; }
      else if (p.cool <= 0) { this.punch(p); p.t = PED.GIVE_UP_T; }   // it won't stop: bang on the door
      return;
    }
    if (p.weapon === 'fist') {
      const reach = car ? car.hw + PED.FIST.reach : PED.FIST.reach;
      const touching = car ? car.contains(p.x, p.y, PED.FIST.reach) : d < reach;
      if (!touching) this.goTo(p, fx, fy, PED.RUN, dt);
      else if (p.cool <= 0) { this.punch(p); p.t = PED.GIVE_UP_T; }
      return;
    }
    // armed: keep a shooting distance, fire bursts (cops: only with a clear line of fire)
    const [near, far] = cop ? COP.RANGE[p.weapon] : PED.GUN_RANGE, run = cop ? COP.RUN : PED.RUN;
    if (d > far || (cop && !p.los)) this.goTo(p, fx, fy, run, dt);
    else if (d < near) { this.goTo(p, p.x - (fx - p.x), p.y - (fy - p.y), p.speed, dt); p.ang = Math.atan2(fx - p.x, -(fy - p.y)); }
    if (d <= far + 20 && p.cool <= 0 && Game.fireWeapon && (!cop || p.los)) {
      const w = WEAPONS[p.weapon];
      Game.fireWeapon(p, p.weapon, p.ang + (Math.random() - 0.5) * 2 * (cop ? COP.AIM : PED.GUN_AIM));
      p.shootT = 0.15;
      if (!cop) p.t = PED.GIVE_UP_T;
      const B = cop ? COP.BURST : PED.BURST;
      if (--p.burst > 0) p.cool = w.cool;
      else { p.cool = (cop ? COP.PAUSE[p.weapon] : PED.BURST_PAUSE) + Math.random() * 0.5; p.burst = B[p.weapon] || 3; }
    }
  },

  // fists: weapons-agent's shared punch when it exists, else a plain hit on the foe
  punch(p) {
    p.cool = PED.FIST.cool; p.punchT = 0.2;
    if (Game.punch) return Game.punch(p, p.ang);
    const f = p.foe, pl = G.player;
    if (f === pl) { if (pl.car) Game.damageCar(pl.car, PED.FIST.car); else Game.hurtPlayer(PED.FIST.dmg); }
    else this.hurt(f, PED.FIST.dmg, { kind: 'punch', src: p });
  },

  // ------------------------------------------------------------- cows --
  // pens inside keep have their herd; pens that leave keep take theirs away; the dead come back later
  cows() {
    const c = G.city;
    if (!c.pens || !AOV.keep) return;
    for (const pen of c.pens) {
      const cx = (pen.x0 + pen.x1) / 2, cy = (pen.y0 + pen.y1) / 2;
      const inside = AOV.within(AOV.keep, cx, cy, (pen.x1 - pen.x0) / 2);
      if (!inside) {
        if (pen.live.length) { for (const k of pen.live) k.gone = true; pen.live = []; }
        continue;
      }
      pen.killed = pen.killed.filter((t) => t > G.t || AOV.inView(cx, cy, 200));
      const want = Math.max(0, pen.cows - pen.killed.length);
      if (pen.live.length < want && (!pen.stocked || !AOV.inView(cx, cy, 200))) {
        while (pen.live.length < want) this.spawnCow(pen);
      }
      pen.stocked = true;
    }
  },

  cow(k, dt) {
    const pen = k.pen, m = 8;
    if (k.vx || k.vy) {
      k.x += k.vx * dt; k.y += k.vy * dt;
      const f = Math.pow(0.05, dt); k.vx *= f; k.vy *= f;
      if (Math.abs(k.vx) + Math.abs(k.vy) < 2) { k.vx = 0; k.vy = 0; }
    }
    if (k.jump) {
      k.jump.t -= dt; k.x += k.jump.x * PED.DODGE_V * 0.6 * dt; k.y += k.jump.y * PED.DODGE_V * 0.6 * dt; k.walkT += dt * 3;
      if (k.jump.t <= 0) k.jump = null;
    }
    if (k.dodged && !this.carNear(k, 60)) k.dodged = false;
    k.t -= dt;
    if (k.state === 'graze') {
      k.moving = false;
      if (k.goal) {
        const d = dist(k.x, k.y, k.goal.x, k.goal.y);
        if (d < 2) k.goal = null;
        else { k.moving = true; k.ang = Math.atan2(k.goal.x - k.x, -(k.goal.y - k.y)); k.x += Math.sin(k.ang) * PED.COW_GRAZE * dt; k.y -= Math.cos(k.ang) * PED.COW_GRAZE * dt; k.walkT += dt * 0.4; }
      } else if (k.t <= 0) {
        k.t = 3 + Math.random() * 8;
        if (Math.random() < 0.6) k.goal = { x: clamp(k.x + (Math.random() - 0.5) * 60, pen.x0 + m, pen.x1 - m), y: clamp(k.y + (Math.random() - 0.5) * 60, pen.y0 + m, pen.y1 - m) };
      }
    } else if (k.state === 'stampede') {
      k.x += Math.sin(k.fleeA) * PED.COW_RUN * dt; k.y -= Math.cos(k.fleeA) * PED.COW_RUN * dt;
      k.ang = k.fleeA; k.walkT += dt * 2;
      if (k.x < pen.x0 + m || k.x > pen.x1 - m) k.fleeA = -k.fleeA;              // turn off the fence
      if (k.y < pen.y0 + m || k.y > pen.y1 - m) k.fleeA = Math.PI - k.fleeA;
      if (k.t <= 0) { k.state = 'graze'; k.t = 2; k.goal = null; }
    } else if (k.state === 'charge') {
      const pl = G.player, f = k.foe;
      const fx = f === pl ? pl.px : f.x, fy = f === pl ? pl.py : f.y;
      if (k.t <= 0 || (f === pl ? pl.dead : f.dead)) { k.state = 'graze'; k.t = 3; k.foe = null; }
      else {
        k.ang = Math.atan2(fx - k.x, -(fy - k.y));
        const d = dist(k.x, k.y, fx, fy), car = f === pl && pl.car;
        const touching = car ? car.contains(k.x, k.y, PED.COW_R + 4) : d < PED.COW_R + 6;
        if (!touching) { k.x += Math.sin(k.ang) * PED.COW_RUN * 1.15 * dt; k.y -= Math.cos(k.ang) * PED.COW_RUN * 1.15 * dt; k.walkT += dt * 2; }
        else if (k.cool <= 0) this.gore(k, f);
      }
    } else if (k.state === 'down') { if (k.t <= 0) this.react(k, k.foe, 'punch'); }
    k.x = clamp(k.x, pen.x0 + m, pen.x1 - m); k.y = clamp(k.y, pen.y0 + m, pen.y1 - m);
  },

  // a bull's charge lands: hurt and throw the foe, or ram the car
  gore(k, f) {
    k.cool = PED.BULL.cool;
    Sound.play('thud', k.x, k.y, { k: 0.9, cow: true });
    const pl = G.player, a = k.ang, fx = Math.sin(a), fy = -Math.cos(a);
    if (f === pl && pl.car) {
      Game.damageCar(pl.car, 4);
      Physics.impulse(pl.car, fx, fy, 120, k.x, k.y);
    } else if (f === pl) {
      Game.hurtPlayer(PED.BULL.dmg);
      Physics.moveWalker(pl, fx * PED.BULL.push, fy * PED.BULL.push);
      G.cam.shake = Math.max(G.cam.shake, 3);
    } else this.hurt(f, PED.BULL.dmg, { kind: 'punch', src: k, vx: fx * 140, vy: fy * 140 });
  },

  // ------------------------------------------------------------ corpses --
  corpse(p, dt) {
    if (p.slide > 0) {
      p.slide -= dt;
      if (p.kind === 'cow') { p.x += p.vx * dt; p.y += p.vy * dt; } else this.move(p, p.vx * dt, p.vy * dt);
      p.vx *= Math.pow(0.01, dt); p.vy *= Math.pow(0.01, dt);
    }
    if (p.bloodT > 0 && p.slide <= 0) {
      p.bloodT -= dt;
      if (p.bloodT <= 0) { if (Render.blood) Render.blood(p.x, p.y, p.kind === 'cow' ? 14 : 9, p.bloodSeed); else this.fallbackBlood(p.x, p.y, p.kind === 'cow' ? 14 : 9); }
    }
  },
  fallbackBlood(x, y, size) {
    Render.paint(x - size - 2, y - size - 2, size * 2 + 4, size * 2 + 4, (ctx) => Peds.disc(ctx, x, y, size, '#7a1020'));
  },
  disc(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    r = Math.max(1, Math.round(r));
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.round(Math.sqrt(r * r - dy * dy) * 1.2);
      ctx.fillRect(Math.round(x) - w, Math.round(y) + dy, w * 2, 1);
    }
  },

  // ------------------------------------------------------------- draw --
  anim(p) {
    if (p.kind === 'cow') {
      if (p.dead) return ['dead', 0];
      if (p.state === 'stampede' || p.state === 'charge' || p.jump) return ['run', Math.floor(p.walkT * 8)];
      if (p.moving) return ['walk', Math.floor(p.walkT * 8)];
      return ['idle', 0];
    }
    if (p.dead) return [p.burnt ? 'burnt' : 'dead', 0];
    if (p.burning) return ['burning', Math.floor(G.t * 10)];
    if (p.state === 'down') return ['down', 0];
    if (p.state === 'cower') return ['cower', 0];
    if (p.punchT > 0) return ['punch', p.punchT > 0.1 ? 0 : 1];
    if (p.shootT > 0 || (p.state === 'fight' && p.weapon !== 'fist' && p.cool < 0.4)) return ['shoot', 0];
    if (p.state === 'flee' || p.jump || (p.state === 'fight' && p.moving !== false)) return ['run', Math.floor(p.walkT * 9)];
    if (p.state === 'wait' || p.state === 'look' || p.state === 'complain') return ['idle', 0];
    return ['walk', Math.floor(p.walkT * 9)];
  },

  // [sheet, frame] for a body, falling back to older sprites while the art isn't in
  sprite(p) {
    const [a, i] = this.anim(p);
    if (p.kind === 'cow') {
      const tag = (p.bull ? 'bull_' : 'cow_') + a;
      if (hasSprite('animals', tag)) return ['animals', Assets.frame('animals', tag, i)];
      return ['props', Assets.frame('props', 'cow')];
    }
    const shared = a === 'burning' || a === 'burnt';
    const cop = p.mood === 'cop' && this.copLooks;
    if (!shared && p.outfit) {
      const t = p.outfit + p.look + '_' + (a === 'shoot' && p.weapon === 'shotgun' ? 'shotgun' : a);
      if (hasSprite('peds', t)) return ['peds', Assets.frame('peds', t, i)];
    }
    const tag = shared ? a : cop ? 'cop' + p.look + '_' + (a === 'shoot' && p.weapon === 'shotgun' ? 'shotgun' : a === 'cower' ? 'idle' : a) : 'ped' + p.look + '_' + a;
    if (hasSprite('peds', tag)) return ['peds', Assets.frame('peds', tag, i)];
    const alt = a === 'dead' || a === 'burnt' || a === 'down' ? 'dead' : a === 'shoot' ? 'shoot' : a === 'walk' || a === 'run' || a === 'burning' ? 'walk' : 'idle';
    return ['player', Assets.frame('player', alt, i)];
  },

  draw(ctx, cam) {
    if (!G.peds) return;
    const vis = (p) => p.x > cam.x - 20 && p.x < cam.x + cam.w + 20 && p.y > cam.y - 20 && p.y < cam.y + cam.h + 20;
    // growing blood pools, then corpses, then the living
    for (const p of G.peds) {
      if (!p.dead || !(p.bloodT > 0) || p.slide > 0 || !vis(p)) continue;
      const size = (p.kind === 'cow' ? 14 : 9) * (1 - p.bloodT / PED.BLOOD_T);
      if (Render.bloodPool) { if (size >= 1) Render.bloodPool(ctx, p.x - cam.x, p.y - cam.y, size, p.bloodSeed); }
      else this.disc(ctx, p.x - cam.x, p.y - cam.y + 1, size, '#7a1020');
    }
    for (const pass of [true, false]) {
      for (const p of G.peds) {
        if (p.gone || !!p.dead !== pass || !vis(p)) continue;
        const [sh, f] = this.sprite(p);
        const x = p.x - cam.x, y = p.y - cam.y;
        if (!p.dead) {
          ctx.globalAlpha = 0.3;
          Assets.drawRot(ctx, sh, f, x + 1, y + 2, p.ang, Assets.tinted(sh, '#12142e'));
          ctx.globalAlpha = 1;
        }
        const img = p.flash > 0 ? Assets.tinted(sh, '#ffffff') : p.burnt && sh !== 'peds' ? Assets.tinted(sh, '#2a1d1a') : null;
        Assets.drawRot(ctx, sh, f, x, y, p.ang, img);
      }
    }
  },

  // speech bubbles, over everything
  drawOver(ctx, cam) {
    if (!G.peds) return;
    for (const p of G.peds) {
      if (!p.bubble || p.dead || p.gone) continue;
      const x = p.x - cam.x, y = p.y - cam.y - 12;
      if (x < -60 || x > cam.w + 60 || y < -20 || y > cam.h + 20) continue;
      if (Render.bubble) Render.bubble(ctx, x, y, p.bubble.text);
      else Font.draw(ctx, p.bubble.text, x, y - 6, { align: 'center', color: PAL.x });
    }
  },

  // #demo&ped=violent: one ped of that mood next to the player, walking the nearest sidewalk
  demoSpawn(mood, n = 1, weapon) {
    let gang = null;
    if (mood && mood.startsWith('gang:')) { gang = mood.slice(5); mood = 'gang'; }
    const pl = G.player;
    for (let i = 0; i < n; i++) {
      const hit = City.walkAt(pl.x + 30 + i * 12, pl.y, 300);
      if (!hit) return;
      const e = hit.e || hit.walk || G.city.walks[hit.id];
      const Z = ZONES[e.zone] && ZONES[e.zone].peds && ZONES[e.zone].peds.density ? ZONES[e.zone].peds : ZONES.downtown.peds;
      const p = this.spawnPed(e, pl.x + 30 + i * 12, pl.y + 6, Z, mood, gang);
      if (weapon) p.weapon = weapon;
    }
  },
};
