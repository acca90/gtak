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
  a: '#3b3f58', A: '#464b66', b: '#565c7a', t: '#c9b79c', T: '#e0d2b8',
  g: '#2a5446', G: '#3f7d5c', h: '#58a06f', H: '#86c28a',
  w: '#24466a', W: '#32658c', v: '#5aa3c4', V: '#a8dcea',
  e: '#2f5d62', E: '#3f7f7a', f: '#5fa39a', F: '#9fd4c4',
  r: '#8e3b53', R: '#d06a6a', p: '#f29b88', P: '#b48ac4', u: '#5b3f73', U: '#8a5a9e',
  y: '#e8a33b', Y: '#f4d58d', c: '#fff1c9', O: '#e07a3f', L: '#f2c14e',
  n: '#6b4432', N: '#8f5e3e', o: '#c08e5e', j: '#ffe9a0', z: '#ff5f7e', q: '#54e8d4',
  B: '#2c5a8c', C: '#7fb0e0',
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
  time: ['KeyN'], map: ['KeyM'], turretL: ['KeyZ', 'Comma'], turretR: ['KeyX', 'Period'], pause: ['KeyP', 'Escape'], start: ['Enter', 'Space'],
};
// standard gamepad mapping
const PADMAP = {
  up: [12], down: [13], left: [14], right: [15],
  fire: [0, 2], shoot: [2], use: [3], weapon: [4, 5], time: [8], pause: [9], start: [9, 0],
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
