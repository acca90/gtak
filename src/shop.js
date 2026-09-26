'use strict';
// Gun stores (spec docs/specs/weapons-v2.md §7). Walk onto a store's door mat on foot to
// go in: the world pauses and the store panel lists every weapon with a `shop` entry.
// Stores come from `G.city.gunshops` (geo), prices and stats from `WEAPONS[id].shop`.

const Shop = {
  open: false,
  store: null,     // the G.city.gunshops entry you're in
  sel: 0,          // selected row
  armed: true,     // false after leaving, until you step off the mat
  note: null,      // { text, color, t } feedback under the BUY button
  rows: [],        // layout of the last draw, for mouse hits
  lastM: null,     // mouse position last frame (hover selects only when it moves)

  items() { return WEAPON_ORDER.filter((id) => WEAPONS[id].shop); },

  // called every frame while playing (not while the store is open)
  check(p) {
    const list = G.city.gunshops;
    if (!list || p.car || p.dead) return;
    let near = null;
    for (const s of list) if (dist(p.x, p.y, s.x, s.y) < 16) { near = s; break; }
    if (!near) { this.armed = true; return; }
    if (this.armed && dist(p.x, p.y, near.x, near.y) < 10) this.enter(near);
  },

  enter(store) {
    this.open = true; this.store = store; this.note = null;
    Sound.ui('shopEnter');
    const items = this.items();
    this.sel = Math.max(0, items.indexOf(G.player.weapon));
    Phone.open = false;
  },

  leave() {
    const p = G.player, s = this.store;
    this.open = false; this.armed = false;
    Sound.ui('shopLeave');
    p.x = s.x + Math.sin(s.ang) * 14; p.y = s.y - Math.cos(s.ang) * 14; p.ang = s.ang;
    Game.toast(s.name, 1.5);
  },

  // why you can't buy it, or null
  blocked(id) {
    const s = WEAPONS[id].shop, have = G.player.ammo[id] || 0;
    if (have >= s.max) return 'FULL';
    if (G.money < s.price) return 'NOT ENOUGH CASH';
    return null;
  },

  buy(id) {
    const p = G.player, s = WEAPONS[id].shop, why = this.blocked(id);
    Sound.ui(why ? 'buzz' : 'buy');
    if (why) { this.note = { text: why, color: PAL.z, t: 1.5 }; return false; }
    const have = p.ammo[id] || 0, got = Math.min(s.max, have + s.pack) - have;
    G.money -= s.price;
    p.ammo[id] = have + got;
    p.weapon = id;
    this.note = { text: '+' + got + ' ' + WEAPONS[id].name, color: PAL.h, t: 1.5 };
    return true;
  },

  update(dt) {
    const items = this.items();
    if (this.note && (this.note.t -= dt) <= 0) this.note = null;
    if (Input.hit('pause') || Input.hit('back')) { this.leave(); return; }
    if (Input.hit('up')) this.sel = (this.sel + items.length - 1) % items.length;
    if (Input.hit('down')) this.sel = (this.sel + 1) % items.length;
    const m = Input.mouseView();
    const row = this.rows.find((r) => m.x >= r.x && m.x < r.x + r.w && m.y >= r.y && m.y < r.y + r.h);
    const moved = this.lastM && (this.lastM.x !== m.x || this.lastM.y !== m.y);
    this.lastM = m;
    if (Input.mouse.active && moved && row && row.i !== undefined) this.sel = row.i;
    if (Input.hit('click') && row) {
      if (row.i !== undefined) this.sel = row.i;
      else if (row.act === 'buy') this.buy(items[this.sel]);
      else if (row.act === 'leave') this.leave();
    } else if (Input.hit('use')) this.buy(items[this.sel]);
  },

  draw(ctx, cam) {
    const W = cam.w, H = cam.h, p = G.player, s = this.store, items = this.items();
    const id = items[this.sel], w = WEAPONS[id], sh = w.shop;
    this.rows = [];
    ctx.fillStyle = 'rgba(26,28,44,0.72)'; ctx.fillRect(0, 0, W, H);

    const pw = Math.min(W - 16, 380), ph = Math.min(H - 16, 232);
    const x0 = Math.round((W - pw) / 2), y0 = Math.round((H - ph) / 2);
    const box = (x, y, bw, bh, fill, edge) => {
      ctx.fillStyle = edge; ctx.fillRect(x, y, bw, bh);
      ctx.fillStyle = fill; ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    };
    box(x0 - 2, y0 - 2, pw + 4, ph + 4, PAL.k, PAL.K);
    ctx.fillStyle = PAL.d; ctx.fillRect(x0 - 1, y0 - 1, pw + 2, 1);

    // header: store name + area, money
    ctx.fillStyle = PAL.u; ctx.fillRect(x0, y0, pw, 24);
    ctx.fillStyle = PAL.U; ctx.fillRect(x0, y0 + 23, pw, 1);
    Font.draw(ctx, s.name, x0 + 6, y0 + 4, { scale: 2, color: PAL.p, shadow: true });
    Font.draw(ctx, 'GUN STORE - ' + s.area, x0 + 6 + Font.width(s.name, 2) + 8, y0 + 12, { color: PAL.P });
    Font.draw(ctx, '$' + G.money, x0 + pw - 6, y0 + 8, { align: 'right', color: PAL.Y, shadow: true });

    // left: the list
    const lx = x0 + 6, ly = y0 + 30, lw = 150, rh = 26;
    items.forEach((iid, i) => {
      const it = WEAPONS[iid], y = ly + i * rh, on = i === this.sel, have = p.ammo[iid] || 0;
      const why = this.blocked(iid);
      if (on) { box(lx, y, lw, rh - 2, PAL.a, PAL.q); }
      else { ctx.fillStyle = PAL.K; ctx.fillRect(lx, y, lw, rh - 2); }
      Assets.draw(ctx, 'props', Assets.frame('props', it.icon), lx + 3, y + 4);
      Font.draw(ctx, it.name, lx + 23, y + 4, { color: on ? PAL.c : PAL.l });
      Font.draw(ctx, '$' + it.shop.price, lx + lw - 4, y + 4, { align: 'right', color: why === 'NOT ENOUGH CASH' ? PAL.r : PAL.Y });
      Font.draw(ctx, have ? 'OWNED ' + have + '/' + it.shop.max : 'NOT OWNED', lx + 23, y + 14, { color: have >= it.shop.max ? PAL.h : PAL.m });
      this.rows.push({ x: lx, y, w: lw, h: rh - 2, i });
    });

    // right: the card
    const cx = lx + lw + 8, cw = x0 + pw - 6 - cx, cy = ly;
    box(cx, cy, cw, ph - 30 - 6, PAL.K, PAL.a);
    const art = Assets.sheets.shop && Assets.sheets.shop.tags['shop_' + id];
    const ax = cx + Math.round((cw - 128) / 2), ay = cy + 6;
    ctx.fillStyle = PAL.a; ctx.fillRect(ax, ay, 128, 64);
    if (art) {
      const sht = Assets.sheets.shop, fi = Assets.frame('shop', 'shop_' + id);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sht.img, fi * sht.w, 0, sht.w, sht.h, ax, ay, sht.w * 2, sht.h * 2);
    } else Assets.draw(ctx, 'props', Assets.frame('props', w.icon), ax + 56, ay + 24);
    Font.draw(ctx, w.name, cx + 6, ay + 70, { scale: 2, color: PAL.c, shadow: true });

    const st = sh.stats || {};
    [['DAMAGE', st.damage], ['RATE', st.rate], ['RANGE', st.range], ['AREA', st.area]].forEach(([k, v], i) => {
      const y = ay + 90 + i * 10;
      Font.draw(ctx, k, cx + 6, y, { color: PAL.m });
      for (let b = 0; b < 5; b++) {
        ctx.fillStyle = b < (v || 0) ? [PAL.h, PAL.H, PAL.L, PAL.y, PAL.z][Math.min(4, (v || 1) - 1)] : PAL.a;
        ctx.fillRect(cx + 50 + b * 12, y, 10, 7);
      }
    });
    const by = ay + 132;
    Font.draw(ctx, 'PACK +' + sh.pack + '   MAX ' + sh.max, cx + 6, by, { color: PAL.l });
    // blurb, word-wrapped to the card
    const maxc = Math.floor((cw - 12) / 6), lines = [''];
    for (const word of String(sh.blurb || '').split(' ')) {
      const cur = lines[lines.length - 1];
      if (cur && cur.length + 1 + word.length > maxc) lines.push(word); else lines[lines.length - 1] = cur ? cur + ' ' + word : word;
    }
    lines.slice(0, 2).forEach((l, i) => Font.draw(ctx, l, cx + 6, by + 11 + i * 9, { color: PAL.P }));

    // BUY button + feedback
    const why = this.blocked(id);
    const bw = cw - 12, bx = cx + 6, bty = cy + ph - 30 - 6 - 24;
    box(bx, bty, bw, 18, why ? PAL.a : PAL.G, why ? PAL.d : PAL.H);
    Font.draw(ctx, why ? why : 'BUY  $' + sh.price, bx + bw / 2, bty + 5, { align: 'center', color: why ? PAL.m : PAL.c });
    this.rows.push({ x: bx, y: bty, w: bw, h: 18, act: 'buy' });
    if (this.note) Font.draw(ctx, this.note.text, bx + bw / 2, bty - 11, { align: 'center', color: this.note.color, shadow: true });

    // footer
    const fy = y0 + ph - 12;
    Font.draw(ctx, 'W/S SELECT  E BUY', lx, fy - 11, { color: PAL.m });
    const lt = 'ESC LEAVE', ltw = Font.width(lt);
    Font.draw(ctx, lt, lx, fy, { color: PAL.p });
    this.rows.push({ x: lx - 2, y: fy - 2, w: ltw + 4, h: 11, act: 'leave' });
  },
};
