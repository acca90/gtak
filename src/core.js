'use strict';
// Core helpers: math, RNG, canvas, sprite atlas, bitmap font, input.

const TILE = 16;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// mulberry32 — small, fast, seedable
function rng(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (R, arr) => arr[Math.floor(R() * arr.length)];

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  c.ctx = c.getContext('2d');
  c.ctx.imageSmoothingEnabled = false;
  return c;
}

// Palette mirror of tools/generate-art.lua, for code-drawn pixels.
const PAL = {
  K: '#1a1c2c', k: '#2b2d42', d: '#4f5168', m: '#7f8198', l: '#b8b8c8', x: '#f2efe6',
  a: '#3b3f58', A: '#464b66', b: '#565c7a', s: '#9c8b75', S: '#b5a288', t: '#c9b79c', T: '#e0d2b8', i: '#e8e4d8',
  g: '#2a5446', G: '#3f7d5c', h: '#58a06f', H: '#86c28a',
  w: '#24466a', W: '#32658c', v: '#5aa3c4', V: '#a8dcea',
  e: '#2f5d62', E: '#3f7f7a', f: '#5fa39a', F: '#9fd4c4',
  r: '#8e3b53', R: '#d06a6a', p: '#f29b88', P: '#b48ac4', u: '#5b3f73', U: '#8a5a9e',
  y: '#e8a33b', Y: '#f4d58d', c: '#fff1c9', O: '#e07a3f', L: '#f2c14e',
  n: '#6b4432', N: '#8f5e3e', o: '#c08e5e', j: '#ffe9a0', z: '#ff5f7e', q: '#54e8d4',
  B: '#2c5a8c', C: '#7fb0e0',
};

// Paint shop colours (paintshop-v1, pixel-agent). ramp = [light, mid, shadow], the same
// roles as a car's body ramp. Runtime-only recolours, not palette chars (like Render.BLOOD):
// pastel, hue-shifted shadows, mids bright enough to read under the night multiply.
const PAINTS = [
  { id: 0, name: 'CANDY PINK', ramp: ['#ffc4d6', '#f08cb0', '#b0547c'] },
  { id: 1, name: 'MINT', ramp: ['#c8f2dc', '#8fd8b8', '#4f9c86'] },
  { id: 2, name: 'SKY', ramp: ['#c4e8f6', '#86c4e6', '#4a80b4'] },
  { id: 3, name: 'LILAC', ramp: ['#e2ccf0', '#b48ac4', '#7e5a9e'] },
  { id: 4, name: 'LEMON', ramp: ['#fff4b8', '#f4d86a', '#c49a3a'] },
  { id: 5, name: 'PEACH', ramp: ['#ffd8bc', '#f6a982', '#c0704e'] },
  { id: 6, name: 'CREAM', ramp: ['#fff8e6', '#f0e2c0', '#bfa888'] },
  { id: 7, name: 'TEAL', ramp: ['#9fd4c4', '#4fa89e', '#2f6e6e'] },
  { id: 8, name: 'CHERRY', ramp: ['#f08a8a', '#d04a5e', '#8a2440'] },
  { id: 9, name: 'SLATE', ramp: ['#b8c0d4', '#7a849e', '#4a5068'] },  // gangs-v1 G2 (appended; ids are stored on cars, never reorder): Orlov black sedans, Orchid sports cars
  { id: 10, name: 'NOIR', ramp: ['#767c9a', '#3c3f58', '#1c1e2c'] },
  { id: 11, name: 'ORCHID', ramp: ['#c77fe6', '#8b3cb8', '#4f1a78'] },
];
// Stock body ramp [light, mid, shadow] of each paintable model: the `body` of CAR_SPECS in
// tools/generate-art.lua (stored there as {dark, mid, light}). Keep the two in sync.
const CAR_BODY = {
  hatch: [PAL.H, PAL.h, PAL.G], sedan: [PAL.f, PAL.E, PAL.e], sport: [PAL.p, PAL.R, PAL.r],
  muscle: [PAL.C, PAL.B, PAL.k], suv: [PAL.l, PAL.m, PAL.d], taxi: [PAL.Y, PAL.L, PAL.y],
  pickup: [PAL.o, PAL.N, PAL.n], van: [PAL.P, PAL.U, PAL.u],
};

// ------------------------------------------------------------------ assets --
const Assets = {
  sheets: {},
  load(done) {
    const names = Object.keys(window.ATLAS);
    let left = names.length;
    for (const n of names) {
      const img = new Image();
      img.onload = () => { if (--left === 0) done(); };
      img.onerror = () => { throw new Error('could not load ' + ATLAS[n].src + ' — run tools/art.sh'); };
      img.src = ATLAS[n].src;
      this.sheets[n] = Object.assign({}, ATLAS[n], { img });
    }
  },
  // absolute frame index of frame i (wrapping) inside a tag
  frame(sheet, tag, i = 0) {
    const t = this.sheets[sheet].tags[tag];
    if (!t) throw new Error('unknown sprite ' + sheet + ':' + tag);
    const n = t[1] - t[0] + 1;
    return t[0] + (((i | 0) % n) + n) % n;
  },
  count(sheet, tag) { const t = this.sheets[sheet].tags[tag]; return t[1] - t[0] + 1; },
  draw(ctx, sheet, idx, x, y, img) {
    const s = this.sheets[sheet];
    ctx.drawImage(img || s.img, idx * s.w, 0, s.w, s.h, Math.round(x), Math.round(y), s.w, s.h);
  },
  // centred on (x, y), rotated clockwise by ang (0 = sprite's "up")
  drawRot(ctx, sheet, idx, x, y, ang, img) {
    const s = this.sheets[sheet];
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(ang);
    ctx.drawImage(img || s.img, idx * s.w, 0, s.w, s.h, -s.w / 2, -s.h / 2, s.w, s.h);
    ctx.restore();
  },
  _tints: {},
  // solid-colour copy of a sheet (shadows, flashes)
  tinted(sheet, color) {
    const key = sheet + color;
    if (!this._tints[key]) {
      const s = this.sheets[sheet];
      const c = mkCanvas(s.img.width, s.img.height);
      c.ctx.drawImage(s.img, 0, 0);
      c.ctx.globalCompositeOperation = 'source-in';
      c.ctx.fillStyle = color;
      c.ctx.fillRect(0, 0, c.width, c.height);
      this._tints[key] = c;
    }
    return this._tints[key];
  },
  _paints: {},
  PAINT_MASKS: { cars: 'carpaint' },   // sheet -> its paint-mask sheet
  // Copy of a sheet where one tag's frames are resprayed with PAINTS[paintId] (paintshop-v1).
  // The mask sheet (PAINT_MASKS: cars -> carpaint) holds, per tag, the body-ramp pixels split
  // into light / mid / shadow frames; each is tinted to the paint shade and drawn over the
  // car, so glass, lights, trim and the taxi sign stay untouched. Compositing only (no
  // getImageData: file:// images taint canvases). Every frame of the tag except the wreck
  // (the 3rd of normal/brake/wreck) is repainted. Unknown tag or paint -> the plain sheet.
  painted(sheet, tag, paintId) {
    const s = this.sheets[sheet], mask = this.sheets[this.PAINT_MASKS[sheet]], p = PAINTS[paintId];
    if (!p || !mask || !mask.tags[tag] || !s.tags[tag]) return s.img;
    const key = sheet + ':' + tag + ':' + paintId;
    let cv = this._paints[key];
    if (cv) return cv;
    cv = mkCanvas(s.img.width, s.img.height);
    cv.ctx.drawImage(s.img, 0, 0);
    const [t0, t1] = s.tags[tag], m0 = mask.tags[tag][0];
    const tmp = mkCanvas(s.w, s.h);
    const last = t1 - t0 + 1 >= 3 ? t1 - 1 : t1;                 // skip the wreck frame
    for (let f = t0; f <= last; f++) {
      for (let j = 0; j < 3; j++) {
        tmp.ctx.globalCompositeOperation = 'source-over';
        tmp.ctx.clearRect(0, 0, s.w, s.h);
        tmp.ctx.drawImage(mask.img, (m0 + j) * mask.w, 0, s.w, s.h, 0, 0, s.w, s.h);
        tmp.ctx.globalCompositeOperation = 'source-in';
        tmp.ctx.fillStyle = p.ramp[j];
        tmp.ctx.fillRect(0, 0, s.w, s.h);
        cv.ctx.drawImage(tmp, f * s.w, 0);
      }
    }
    this._paints[key] = cv;
    return cv;
  },
};

// -------------------------------------------------------------------- font --
// Order must match FONT_CHARS in tools/generate-art.lua.
const FONT_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 $:.,!?-+/%'()<>*\"#=_";
const Font = {
  width(str, scale = 1) { return String(str).length * 6 * scale - scale; },
  draw(ctx, str, x, y, o = {}) {
    const scale = o.scale || 1;
    const color = o.color || PAL.x;
    const outline = o.outline === undefined ? PAL.K : o.outline;
    str = String(str).toUpperCase();
    if (o.align === 'center') x -= Math.floor(this.width(str, scale) / 2);
    else if (o.align === 'right') x -= this.width(str, scale);
    x = Math.round(x); y = Math.round(y);
    if (outline) {
      const img = Assets.tinted('font', outline);
      const d = scale >= 3 ? 2 : 1;
      for (const [dx, dy] of [[-d, 0], [d, 0], [0, -d], [0, d], [-d, -d], [d, -d], [-d, d], [d, d]]) this._run(ctx, img, str, x + dx, y + dy, scale);
      if (o.shadow) this._run(ctx, img, str, x + d, y + d * 2, scale);
    }
    this._run(ctx, Assets.tinted('font', color), str, x, y, scale);
  },
  _run(ctx, img, str, x, y, scale) {
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === ' ') continue;
      let k = FONT_CHARS.indexOf(ch);
      if (k < 0) k = FONT_CHARS.indexOf('?');
      ctx.drawImage(img, k * 6, 0, 6, 8, x + i * 6 * scale, y, 6 * scale, 8 * scale);
    }
  },
};

// ------------------------------------------------------------------- input --
const KEYMAP = {
  up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  fire: ['Space'], shoot: ['Space', 'mouse0'], click: ['mouse0'], phone: ['mouse2', 'KeyC'],
  use: ['KeyE', 'Enter', 'KeyF'], weapon: ['KeyQ', 'Tab'], daynight: ['KeyO'],
  horn: ['KeyH'], descend: ['ShiftLeft', 'ShiftRight'], volDown: ['Minus', 'NumpadSubtract'], volUp: ['Equal', 'NumpadAdd'], mute: ['Digit0', 'Numpad0'],
  slot1: ['Digit1', 'Numpad1'], slot2: ['Digit2', 'Numpad2'], slot3: ['Digit3', 'Numpad3'], slot4: ['Digit4', 'Numpad4'],
  slot5: ['Digit5', 'Numpad5'], slot6: ['Digit6', 'Numpad6'], slot7: ['Digit7', 'Numpad7'], back: ['Backspace'],
  map: ['KeyM'], turretL: ['KeyZ', 'Comma'], turretR: ['KeyX', 'Period'], pause: ['KeyP', 'Escape'], start: ['Enter', 'Space'],
};
// standard gamepad mapping
const PADMAP = {
  up: [12], down: [13], left: [14], right: [15],
  fire: [0, 2], shoot: [2], use: [3], horn: [10], descend: [10], weapon: [4, 5], pause: [9], start: [9, 0],
  gas: [7], brake: [6], map: [1],
};

const Input = {
  down: new Set(),
  hits: new Set(),
  pad: null, padPrev: {},
  mouse: { x: 0, y: 0, active: false, down: new Set(), wheel: 0 },
  viewScale: 1,
  init() {
    const m = this.mouse;
    addEventListener('mousemove', (e) => { m.x = e.clientX; m.y = e.clientY; m.active = true; });
    addEventListener('mousedown', (e) => {
      m.x = e.clientX; m.y = e.clientY; m.active = true;
      if (!m.down.has(e.button)) this.hits.add('mouse' + e.button);
      m.down.add(e.button);
      e.preventDefault();
    });
    addEventListener('mouseup', (e) => m.down.delete(e.button));
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => { m.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.hits.add(e.code);
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); m.down.clear(); });
  },
  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pad = null;
    for (const p of pads) if (p && p.connected) { this.pad = p; break; }
    if (this.pad) {
      this.pad.buttons.forEach((b, i) => {
        if (b.pressed && !this.padPrev[i]) this.hits.add('pad' + i);
        this.padPrev[i] = b.pressed;
      });
    }
  },
  endTick() { this.hits.clear(); },
  _pad(i) { return this.pad && this.pad.buttons[i] && this.pad.buttons[i].pressed; },
  // mouse position in view (low-res canvas) pixels
  mouseView() { return { x: this.mouse.x * this.viewScale, y: this.mouse.y * this.viewScale }; },
  held(a) {
    if ((KEYMAP[a] || []).some((k) => (k.startsWith('mouse') ? this.mouse.down.has(+k[5]) : this.down.has(k)))) return true;
    return (PADMAP[a] || []).some((i) => this._pad(i));
  },
  hit(a) {
    if ((KEYMAP[a] || []).some((k) => this.hits.has(k))) return true;
    return (PADMAP[a] || []).some((i) => this.hits.has('pad' + i));
  },
  // analog axes in [-1, 1]
  axis(which) {
    let v = 0;
    if (which === 'x') v = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    else v = (this.held('down') ? 1 : 0) - (this.held('up') ? 1 : 0);
    if (this.pad) {
      const a = this.pad.axes[which === 'x' ? 0 : 1] || 0;
      if (Math.abs(a) > 0.2) v = a;
    }
    return clamp(v, -1, 1);
  },
  turret() {
    let t = (this.held('turretR') ? 1 : 0) - (this.held('turretL') ? 1 : 0);
    if (this.pad && Math.abs(this.pad.axes[2] || 0) > 0.25) t = this.pad.axes[2];
    return t;
  },
  throttle() {
    let t = (this.held('up') ? 1 : 0) - (this.held('down') ? 1 : 0);
    if (this.pad) {
      const g = this.pad.buttons[7] ? this.pad.buttons[7].value : 0;
      const b = this.pad.buttons[6] ? this.pad.buttons[6].value : 0;
      if (g > 0.05 || b > 0.05) t = g - b;
    }
    return t;
  },
};
