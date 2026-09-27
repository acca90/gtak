'use strict';
// Car paint shops (spec docs/specs/paintshop-v1.md, coordinator). Drive onto a shop's bay and the
// world pauses on a colour menu (like the gun store): pick a colour, pay, and the car is resprayed
// (and repaired) in a short cloud of paint. Shops come from `G.city.paintshops` (geo); the colours
// (`PAINTS`) and the recolouring (`Assets.painted`) from pixel-agent. The car keeps `c.paint`.

const PAINT_PRICE = 400;
const PAINT_MODELS = { hatch: 1, sedan: 1, sport: 1, muscle: 1, suv: 1, taxi: 1, pickup: 1, van: 1 };
const PAINT_SPRAY_T = 1.2;
const PAINT_GANG_ONLY = { NOIR: 1, ORCHID: 1 };

const Paint = {
  open: false,
  shop: null,
  sel: 0,
  armed: true,      // false after a visit (or a refusal), until the car leaves the bay
  note: null,
  rows: [],
  lastM: null,
  spray: null,      // { car, t, color }
  toldT: 0,

  // the mobs' own colours aren't for sale: a black sedan or a purple sports car should always read as mob
  colors() { return typeof PAINTS !== 'undefined' ? PAINTS.filter((k) => !PAINT_GANG_ONLY[k.name]) : []; },

  inBay(s, c) { const b = s.bay; return c.x > b.x0 && c.x < b.x1 && c.y > b.y0 && c.y < b.y1; },

  // why this car can't be painted, or null
  refuse(c) {
    if (c.m.siren === 'police' || c.model === 'police' || c.model === 'police_suv') return 'NICE TRY';
    if (!PAINT_MODELS[c.model] || c.wreck) return "WE DON'T PAINT THAT";
    return null;
  },

  // every frame while driving (not while the menu is open)
  check(p, dt) {
    const list = G.city.paintshops, c = p.car;
    this.toldT -= dt;
    if (!list || !c || this.spray) return;
    const s = list.find((k) => this.inBay(k, c));
    if (!s) { this.armed = true; return; }
    if (!this.armed || c.speed() > 60) return;
    const why = this.refuse(c);
    if (why) { this.armed = false; if (this.toldT <= 0) { Game.toast(why, 2); this.toldT = 3; } return; }
    this.enter(s, c);
  },

  enter(s, c) {
    this.open = true; this.shop = s; this.note = null;
    c.vx = 0; c.vy = 0; c.spin = 0;
    const cols = this.colors();
    this.sel = Math.max(0, cols.findIndex((k) => k.id === c.paint));
    Sound.ui('shopEnter');
    Phone.open = false;
  },

  leave() {
    this.open = false; this.armed = false;
    Sound.ui('shopLeave');
    Game.toast(this.shop.name, 1.5);
  },

  blocked(k) {
    const c = G.player.car;
    if (c && c.paint === k.id) return 'CURRENT COLOUR';
    if (G.money < PAINT_PRICE) return 'NOT ENOUGH CASH';
    return null;
  },

  buy(k) {
    if (!k) return false;
    const c = G.player.car, why = this.blocked(k);
    Sound.ui(why ? 'buzz' : 'buy');
    if (why) { this.note = { text: why, color: PAL.z, t: 1.5 }; return false; }
    G.money -= PAINT_PRICE;
    this.open = false; this.armed = false;
    this.spray = { car: c, t: PAINT_SPRAY_T, paint: k.id, color: k.ramp[1] };
    return true;
  },

  update(dt) {
    const cols = this.colors();
    if (!cols.length) { this.leave(); return; }
    if (this.note && (this.note.t -= dt) <= 0) this.note = null;
    if (Input.hit('pause') || Input.hit('back')) { this.leave(); return; }
    if (Input.hit('up')) this.sel = (this.sel + cols.length - 1) % cols.length;
    if (Input.hit('down')) this.sel = (this.sel + 1) % cols.length;
    const m = Input.mouseView();
    const row = this.rows.find((r) => m.x >= r.x && m.x < r.x + r.w && m.y >= r.y && m.y < r.y + r.h);
    const moved = this.lastM && (this.lastM.x !== m.x || this.lastM.y !== m.y);
    this.lastM = m;
    if (Input.mouse.active && moved && row && row.i !== undefined) this.sel = row.i;
    if (Input.hit('click') && row) {
      if (row.i !== undefined) this.sel = row.i;
      else if (row.act === 'buy') this.buy(cols[this.sel]);
      else if (row.act === 'leave') this.leave();
    } else if (Input.hit('use')) this.buy(cols[this.sel]);
  },

  // the respray itself: the car holds still in a cloud of paint, then comes out new
  updateSpray(dt) {
    const S = this.spray;
    if (!S) return;
    const c = S.car;
    c.vx = 0; c.vy = 0; c.spin = 0;
    S.t -= dt;
    const k = this.colors().find((q) => q.id === S.paint);
    if (Parts.spray && k) Parts.spray(c.x, c.y, c.ang, k.ramp);
    if (S.t <= PAINT_SPRAY_T / 2 && c.paint !== S.paint) { c.paint = S.paint; c.hp = c.m.hp; c.burning = false; c.smokeT = 0; }
    if (S.t <= 0) {
      this.spray = null;
      Game.toast(k ? k.name : 'FRESH PAINT', 1.8);
    }
  },

  draw(ctx, cam) {
    const W = cam.w, H = cam.h, cols = this.colors(), c = G.player.car, s = this.shop;
    if (!cols.length || !c) return;
    const k = cols[this.sel];
    this.rows = [];
    ctx.fillStyle = 'rgba(26,28,44,0.72)'; ctx.fillRect(0, 0, W, H);
    const pw = Math.min(W - 16, 340), ph = Math.min(H - 16, 30 + cols.length * 16 + 34);
    const x0 = Math.round((W - pw) / 2), y0 = Math.round((H - ph) / 2);
    const box = (x, y, bw, bh, fill, edge) => {
      ctx.fillStyle = edge; ctx.fillRect(x, y, bw, bh);
      ctx.fillStyle = fill; ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    };
    box(x0 - 2, y0 - 2, pw + 4, ph + 4, PAL.k, PAL.K);
    ctx.fillStyle = PAL.u; ctx.fillRect(x0, y0, pw, 24);
    Font.draw(ctx, s.name, x0 + 6, y0 + 4, { scale: 2, color: PAL.p, shadow: true });
    Font.draw(ctx, '$' + G.money, x0 + pw - 6, y0 + 8, { align: 'right', color: PAL.Y, shadow: true });

    // left: the colours
    const lx = x0 + 6, ly = y0 + 30, lw = 150, rh = 16;
    cols.forEach((q, i) => {
      const y = ly + i * rh, on = i === this.sel, cur = c.paint === q.id;
      if (on) box(lx, y, lw, rh - 2, PAL.a, PAL.q);
      else { ctx.fillStyle = PAL.K; ctx.fillRect(lx, y, lw, rh - 2); }
      q.ramp.forEach((col, j) => { ctx.fillStyle = col; ctx.fillRect(lx + 3 + j * 5, y + 3, 5, 8); });
      Font.draw(ctx, q.name, lx + 22, y + 4, { color: on ? PAL.c : PAL.l });
      if (cur) Font.draw(ctx, 'NOW', lx + lw - 4, y + 4, { align: 'right', color: PAL.h });
      this.rows.push({ x: lx, y, w: lw, h: rh - 2, i });
    });

    // right: the car in the selected colour
    const cx = lx + lw + 8, cw = x0 + pw - 6 - cx, cy = ly, chh = cols.length * rh - 2;
    box(cx, cy, cw, chh, PAL.K, PAL.a);
    const sh = c.m.sheet, img = Assets.painted ? Assets.painted(sh, c.tag, k.id) : null;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(cx + cw / 2), Math.round(cy + chh / 2 - 8));
    ctx.scale(2, 2);
    Assets.drawRot(ctx, sh, Assets.frame(sh, c.tag, 0), 0, 0, Math.PI / 2, img);
    ctx.restore();
    Font.draw(ctx, c.m.name, cx + cw / 2, cy + chh - 22, { align: 'center', color: PAL.c });
    Font.draw(ctx, 'RESPRAY + REPAIR', cx + cw / 2, cy + chh - 12, { align: 'center', color: PAL.m });

    // buy button, footer
    const why = this.blocked(k), by = y0 + ph - 30;
    box(cx, by, cw, 18, why ? PAL.a : PAL.G, why ? PAL.d : PAL.H);
    Font.draw(ctx, why || 'PAINT  $' + PAINT_PRICE, cx + cw / 2, by + 5, { align: 'center', color: why ? PAL.m : PAL.c });
    this.rows.push({ x: cx, y: by, w: cw, h: 18, act: 'buy' });
    if (this.note) Font.draw(ctx, this.note.text, cx + cw / 2, by - 11, { align: 'center', color: this.note.color, shadow: true });
    Font.draw(ctx, 'W/S SELECT  E PAINT', lx, y0 + ph - 22, { color: PAL.m });
    const lt = 'ESC LEAVE';
    Font.draw(ctx, lt, lx, y0 + ph - 11, { color: PAL.p });
    this.rows.push({ x: lx - 2, y: y0 + ph - 13, w: Font.width(lt) + 4, h: 11, act: 'leave' });
  },
};
