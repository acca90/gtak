'use strict';
// Cellphone (right mouse button). Contacts hand out jobs, calls come in when
// someone has work, messages keep the briefings, GPS sets a waypoint.

// Screen rect and button hit areas inside the "ui:phone" sprite (see generate-art.lua).
const PHONE = {
  w: 112, h: 176,
  screen: { x: 10, y: 20, w: 92, h: 124 },
  green: [18, 154, 16, 8], home: [46, 152, 20, 12], red: [78, 154, 16, 8],
};

const CONTACTS = [
  { name: 'MAMA ROSA', job: 'delivery', color: PAL.p, line: 'Package work' },
  { name: 'BIG TONY', job: 'boost', color: PAL.Y, line: 'Wheels for clients' },
  { name: 'ZED', job: 'torch', color: PAL.O, line: 'Fireworks' },
  { name: 'LUCKY LOU', job: 'rush', color: PAL.q, line: 'Street races' },
];

const APPS = [
  { id: 'contacts', label: 'CONTACTS', icon: 'app_contacts' },
  { id: 'messages', label: 'MESSAGES', icon: 'app_messages' },
  { id: 'gps', label: 'GPS', icon: 'app_gps' },
  { id: 'music', label: 'RADIO', icon: 'app_music' },
];

const CLOCK = ['12:30', '19:45', '23:50'];

const Phone = {
  init() {
    this.open = false; this.slide = 0;
    this.app = 'home';
    this.scroll = 0;
    this.incoming = null; this.ringT = 0;
    this.calling = null; this.callT = 0;
    this.messages = [];
    this.unread = 0;
    this.hover = -1;
  },

  toggle() {
    this.open = !this.open;
    if (this.open) {
      if (this.incoming) this.app = 'incoming';
      else if (this.app === 'incoming' || this.app === 'call') this.app = 'home';
      if (this.app === 'messages') this.unread = 0;
    }
  },

  // top-left of the handset on screen
  origin(cam) {
    const e = 1 - Math.pow(1 - this.slide, 3);
    return { x: cam.w - PHONE.w - 12, y: Math.round(cam.h + 4 - (PHONE.h + 10) * e) };
  },
  visible() { return this.slide > 0.01; },
  contains(cam, mx, my) {
    const o = this.origin(cam);
    return this.visible() && mx >= o.x && my >= o.y && mx < o.x + PHONE.w && my < o.y + PHONE.h;
  },

  message(from, text) {
    this.messages.unshift({ from, text: text.toUpperCase() });
    if (this.messages.length > 20) this.messages.pop();
    if (!(this.open && this.app === 'messages')) this.unread++;
  },

  ring(contact) {
    this.incoming = contact;
    this.ringT = 14;
    Game.toast('INCOMING CALL: ' + contact.name + '  (RIGHT CLICK)', 3);
    if (this.open) this.app = 'incoming';
  },
  answer() {
    const c = this.incoming;
    if (!c) return;
    this.incoming = null;
    this.startCall(c, true);
  },
  decline() {
    if (!this.incoming) return;
    this.message(this.incoming.name, 'Fine. Call me when you want work.');
    this.incoming = null;
    this.app = 'home';
    Missions.cooldown = 10;
  },
  startCall(c, answered) {
    this.calling = c;
    this.callT = answered ? 0.5 : 1.4;
    this.app = 'call';
  },

  update(dt) {
    this.slide = clamp(this.slide + (this.open ? 5 : -5) * dt, 0, 1);
    if (this.incoming) {
      this.ringT -= dt;
      if (this.ringT <= 0) {
        this.message(this.incoming.name, 'Missed call. Guess you are busy.');
        this.incoming = null;
        if (this.app === 'incoming') this.app = 'home';
        Missions.cooldown = 8;
      }
    }
    if (this.calling) {
      this.callT -= dt;
      if (this.callT <= 0) {
        const c = this.calling;
        this.calling = null;
        if (Missions.active) this.message(c.name, 'You are already on a job. Finish it first.');
        else Missions.begin(c.job, c);
        this.app = 'messages';
        this.unread = 0;
        this.scroll = 0;
      }
    }
  },

  // ---------------------------------------------------------------- input --
  // returns true when the click was used by the phone
  click(cam, mx, my) {
    if (!this.open || !this.contains(cam, mx, my)) return false;
    const o = this.origin(cam);
    const lx = mx - o.x, ly = my - o.y;
    const inR = (r) => lx >= r[0] && ly >= r[1] && lx < r[0] + r[2] && ly < r[1] + r[3];
    if (inR(PHONE.home)) { this.app = this.incoming ? 'incoming' : 'home'; this.scroll = 0; return true; }
    if (inR(PHONE.green)) { if (this.incoming) this.answer(); return true; }
    if (inR(PHONE.red)) { if (this.incoming) this.decline(); else this.open = false; return true; }
    const s = PHONE.screen;
    const sx = lx - s.x, sy = ly - s.y;
    if (sx < 0 || sy < 0 || sx >= s.w || sy >= s.h) return true;
    const row = this.rowAt(sy);
    if (this.app === 'home' && row >= 0 && row < APPS.length) { this.app = APPS[row].id; this.scroll = 0; if (this.app === 'messages') this.unread = 0; }
    else if (this.app === 'contacts' && row >= 0 && row < CONTACTS.length) this.startCall(CONTACTS[row]);
    else if (this.app === 'incoming') { if (sy > 84 && sy < 100) sx < s.w / 2 ? this.answer() : this.decline(); }
    else if (this.app === 'gps') this.gpsClick(sx, sy);
    return true;
  },
  rowAt(sy) { return sy < 14 ? -1 : Math.floor((sy - 14) / 22); },

  wheel(d) {
    if (this.app === 'messages') this.scroll = clamp(this.scroll + d, 0, Math.max(0, this.messages.length - 1));
  },

  gpsRect() { return { x: 4, y: 14, w: 84, h: 84 }; },
  gpsClick(sx, sy) {
    const r = this.gpsRect();
    if (sx < r.x || sy < r.y || sx >= r.x + r.w || sy >= r.y + r.h) return;
    const wx = ((sx - r.x) / r.w) * G.city.W * TILE, wy = ((sy - r.y) / r.h) * G.city.H * TILE;
    if (G.waypoint && dist(G.waypoint.x, G.waypoint.y, wx, wy) < 150) G.waypoint = null;
    else G.waypoint = { x: wx, y: wy };
  },

  // ----------------------------------------------------------------- draw --
  draw(ctx, cam, mx, my) {
    if (!this.visible()) return;
    const o = this.origin(cam);
    Assets.draw(ctx, 'ui', Assets.frame('ui', 'phone'), o.x, o.y);
    const s = PHONE.screen, X = o.x + s.x, Y = o.y + s.y;
    ctx.save();
    ctx.beginPath(); ctx.rect(X, Y, s.w, s.h); ctx.clip();
    // wallpaper
    ctx.fillStyle = PAL.k; ctx.fillRect(X, Y, s.w, s.h);
    ctx.fillStyle = '#34304f';
    for (let i = 0; i < s.h; i += 6) ctx.fillRect(X, Y + i, s.w, 1);
    // status bar
    ctx.fillStyle = PAL.K; ctx.fillRect(X, Y, s.w, 11);
    Font.draw(ctx, CLOCK[G.time], X + 3, Y + 2, { color: PAL.c, outline: null });
    for (let i = 0; i < 4; i++) { ctx.fillStyle = PAL.q; ctx.fillRect(X + s.w - 22 + i * 3, Y + 8 - i * 2, 2, 2 + i * 2); }
    ctx.fillStyle = PAL.h; ctx.fillRect(X + s.w - 8, Y + 3, 5, 5);
    const hoverRow = this.contains(cam, mx, my) ? this.rowAt(my - Y) : -1;
    const inScreen = mx >= X && mx < X + s.w && my >= Y && my < Y + s.h;
    const header = (t) => Font.draw(ctx, t, X + 4, Y + 14, { color: PAL.p, outline: null });

    if (this.app === 'home') {
      APPS.forEach((a, i) => {
        const ry = Y + 14 + i * 22;
        if (inScreen && hoverRow === i) { ctx.fillStyle = '#3f3b63'; ctx.fillRect(X + 2, ry, s.w - 4, 20); }
        Assets.draw(ctx, 'props', Assets.frame('props', a.icon), X + 4, ry + 2);
        Font.draw(ctx, a.label, X + 24, ry + 6, { color: PAL.c, outline: null });
        if (a.id === 'messages' && this.unread) {
          ctx.fillStyle = PAL.z; ctx.fillRect(X + 16, ry + 1, 7, 7);
          Font.draw(ctx, String(Math.min(9, this.unread)), X + 17, ry + 1, { color: PAL.x, outline: null });
        }
      });
      Font.draw(ctx, 'O: DAY/NIGHT', X + 4, Y + s.h - 11, { color: PAL.m, outline: null });
    } else if (this.app === 'contacts') {
      CONTACTS.forEach((c, i) => {
        const ry = Y + 14 + i * 22;
        if (inScreen && hoverRow === i) { ctx.fillStyle = '#3f3b63'; ctx.fillRect(X + 2, ry, s.w - 4, 20); }
        ctx.fillStyle = c.color; ctx.fillRect(X + 4, ry + 3, 4, 14);
        Font.draw(ctx, c.name, X + 11, ry + 3, { color: PAL.c, outline: null });
        Font.draw(ctx, c.line, X + 11, ry + 12, { color: PAL.m, outline: null });
      });
      Font.draw(ctx, 'CLICK TO CALL', X + 4, Y + s.h - 11, { color: PAL.m, outline: null });
    } else if (this.app === 'messages') {
      header('MESSAGES');
      let y = Y + 26;
      if (!this.messages.length) Font.draw(ctx, 'NO MESSAGES', X + 4, y, { color: PAL.m, outline: null });
      for (const m of this.messages.slice(this.scroll)) {
        if (y > Y + s.h - 10) break;
        Font.draw(ctx, m.from, X + 4, y, { color: PAL.q, outline: null });
        y += 10;
        for (const line of wrapText(m.text, 14)) {
          if (y > Y + s.h - 10) break;
          Font.draw(ctx, line, X + 4, y, { color: PAL.c, outline: null });
          y += 9;
        }
        y += 5;
      }
    } else if (this.app === 'gps') {
      const r = this.gpsRect();
      ctx.drawImage(Render.minimap, X + r.x, Y + r.y, r.w, r.h);
      const dot = (x, y, col, sz = 1) => {
        ctx.fillStyle = col;
        ctx.fillRect(Math.round(X + r.x + (x / (G.city.W * TILE)) * r.w) - sz, Math.round(Y + r.y + (y / (G.city.H * TILE)) * r.h) - sz, sz * 2 + 1, sz * 2 + 1);
      };
      const t = Missions.target(true);
      if (t) dot(t.x, t.y, PAL.L, 1);
      if (G.waypoint) dot(G.waypoint.x, G.waypoint.y, PAL.z, 1);
      if (Math.floor(G.t * 4) % 2) dot(G.player.px, G.player.py, PAL.x, 1);
      Font.draw(ctx, 'CLICK: WAYPOINT', X + 1, Y + r.y + r.h + 6, { color: PAL.m, outline: null });
      Font.draw(ctx, G.waypoint ? 'CLICK IT: CLEAR' : '', X + 1, Y + r.y + r.h + 15, { color: PAL.m, outline: null });
    } else if (this.app === 'music') {
      header('RADIO');
      Font.draw(ctx, 'NO SIGNAL', X + 4, Y + 40, { color: PAL.c, outline: null });
      Font.draw(ctx, 'COMING SOON', X + 4, Y + 52, { color: PAL.m, outline: null });
    } else if (this.app === 'incoming' && this.incoming) {
      const c = this.incoming;
      if (Math.floor(G.t * 3) % 2) Font.draw(ctx, 'INCOMING', X + s.w / 2, Y + 22, { align: 'center', color: PAL.m, outline: null });
      ctx.fillStyle = c.color; ctx.fillRect(X + s.w / 2 - 12, Y + 36, 24, 24);
      ctx.fillStyle = PAL.K; ctx.fillRect(X + s.w / 2 - 4, Y + 40, 8, 8); ctx.fillRect(X + s.w / 2 - 8, Y + 50, 16, 10);
      Font.draw(ctx, c.name, X + s.w / 2, Y + 68, { align: 'center', color: PAL.c, outline: null });
      ctx.fillStyle = PAL.h; ctx.fillRect(X + 3, Y + 84, s.w / 2 - 5, 16);
      ctx.fillStyle = PAL.z; ctx.fillRect(X + s.w / 2 + 2, Y + 84, s.w / 2 - 5, 16);
      Font.draw(ctx, 'ANSWER', X + s.w / 4, Y + 88, { align: 'center', color: PAL.K, outline: null });
      Font.draw(ctx, 'NOPE', X + (3 * s.w) / 4, Y + 88, { align: 'center', color: PAL.K, outline: null });
    } else if (this.app === 'call') {
      const c = this.calling;
      Font.draw(ctx, 'CALLING', X + s.w / 2, Y + 30, { align: 'center', color: PAL.m, outline: null });
      if (c) Font.draw(ctx, c.name, X + s.w / 2, Y + 44, { align: 'center', color: PAL.c, outline: null });
      Font.draw(ctx, '.'.repeat(1 + (Math.floor(G.t * 3) % 3)), X + s.w / 2, Y + 58, { align: 'center', color: PAL.q, outline: null });
    } else {
      this.app = 'home';
    }
    ctx.restore();
  },

  // little ringing handset in the corner while a call is waiting
  drawIndicator(ctx, cam) {
    if (!this.incoming || this.open) return;
    const x = cam.w - 30 + (Math.floor(G.t * 20) % 2), y = cam.h - 40;
    ctx.fillStyle = PAL.K; ctx.fillRect(x - 1, y - 1, 12, 20);
    ctx.fillStyle = PAL.R; ctx.fillRect(x, y, 10, 18);
    ctx.fillStyle = PAL.q; ctx.fillRect(x + 2, y + 2, 6, 8);
    Font.draw(ctx, 'RMB', x + 5, y + 22, { align: 'center', color: PAL.q });
  },
};

function wrapText(text, width) {
  const lines = [''];
  for (const w of text.split(' ')) {
    const cur = lines[lines.length - 1];
    if ((cur + ' ' + w).trim().length > width) lines.push(w);
    else lines[lines.length - 1] = (cur + ' ' + w).trim();
  }
  return lines;
}
