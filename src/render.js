'use strict';
// World rendering.
//
// Buildings use an oblique "GTA1" projection that keeps pixel art crisp: the
// roof is the footprint translated away from the camera by
//     offset = (buildingCentre - cameraCentre) * PARALLAX * height
// and the walls facing the camera fill the gap, drawn one pixel row/column at
// a time so they shear between base and roof.
//
// A wall that is n pixels tall on screen shows `floors` storeys. Instead of
// sampling a full-height texture (which made windows shimmer as n changed),
// every storey is drawn exactly k = floor(n / floors) rows tall from a
// pre-squashed copy of the 32px facade modules; the leftover rows become a
// cornice band at the top. Windows only change when k steps, and then all at once.

const PARALLAX = 1 / 850;
const CHUNK = 1024;
const MODULE = 32;

const TIMES = [
  { name: 'DAY' },
  { name: 'DUSK', ambient: '#e8aaa0', lights: 0.45, glow: 0.55 },
  { name: 'NIGHT', ambient: '#2f3572', lights: 1, glow: 1 },
];

const Render = {
  frameNo: 0,

  init(city) {
    this.city = city;
    this._squash = {};
    this._lights = {};
    this.lightCv = null;
    this.bakeGround();
    this.bakeMinimap();
    this.layoutFacades();
  },

  // ------------------------------------------------------------ ground --
  bakeGround() {
    const c = this.city;
    const WP = c.W * TILE, HP = c.H * TILE;
    this.chunks = [];
    for (let cy = 0; cy * CHUNK < HP; cy++) {
      const row = [];
      for (let cx = 0; cx * CHUNK < WP; cx++) row.push(mkCanvas(Math.min(CHUNK, WP - cx * CHUNK), Math.min(CHUNK, HP - cy * CHUNK)));
      this.chunks.push(row);
    }
    const tiles = Assets.sheets.tiles;
    this.paint(0, 0, WP, HP, (ctx) => {
      for (let y = 0; y < c.H; y++) {
        for (let x = 0; x < c.W; x++) {
          const f = c.frame[y * c.W + x];
          if (f >= 0) ctx.drawImage(tiles.img, f * 16, 0, 16, 16, x * 16, y * 16, 16, 16);
        }
      }
    }, true);
    // quay shadow on the water
    this.paint(0, 0, WP, HP, (ctx) => {
      ctx.fillStyle = 'rgba(20,24,48,0.45)';
      for (let y = 1; y < c.H; y++) {
        for (let x = 1; x < c.W; x++) {
          if (c.kind[y * c.W + x] !== KIND.WATER) continue;
          if (c.kind[(y - 1) * c.W + x] !== KIND.WATER) ctx.fillRect(x * 16, y * 16, 16, 5);
          if (c.kind[y * c.W + x - 1] !== KIND.WATER) ctx.fillRect(x * 16, y * 16, 4, 16);
        }
      }
    }, true);
    // painted ground details: cul-de-sacs, fences, pools, pipes
    for (const op of c.paints) {
      const box = this.paintBox(op);
      this.paint(box[0], box[1], box[2], box[3], (ctx) => this.paintOp(ctx, op));
    }
    // cast shadows (sun from the top-left): drawn solid per chunk, then blended once
    for (let cy = 0; cy < this.chunks.length; cy++) {
      for (let cx = 0; cx < this.chunks[cy].length; cx++) {
        const g = this.chunks[cy][cx];
        const sh = mkCanvas(g.width, g.height);
        const ctx = sh.ctx;
        ctx.translate(-cx * CHUNK, -cy * CHUNK);
        ctx.fillStyle = '#12142e';
        for (const b of c.buildings) {
          const L = Math.round(b.height * (b.overhang ? 0.08 : 0.22));
          if (b.x > (cx + 1) * CHUNK + 10 || b.y > (cy + 1) * CHUNK + 10 || b.x + b.w + L < cx * CHUNK || b.y + b.h + L < cy * CHUNK) continue;
          for (let d = 0; d <= L; d++) ctx.fillRect(b.x + Math.round(d * 0.8), b.y + Math.round(d * 0.6), b.w, b.h);
        }
        for (const t of c.trees) {
          if (Math.abs(t.x - (cx + 0.5) * CHUNK) > CHUNK || Math.abs(t.y - (cy + 0.5) * CHUNK) > CHUNK) continue;
          for (let d = 0; d <= 8; d++) this._disc(ctx, t.x + d, t.y + d * 0.8, 12);
        }
        for (const t of c.talls) {
          if (Math.abs(t.x - (cx + 0.5) * CHUNK) > CHUNK || Math.abs(t.y - (cy + 0.5) * CHUNK) > CHUNK) continue;
          const L = Math.round(t.h * 0.22);
          for (let d = 0; d <= L; d++) this._disc(ctx, t.x + d * 0.8, t.y + d * 0.6, t.r);
        }
        g.ctx.globalAlpha = 0.3;
        g.ctx.drawImage(sh, 0, 0);
        g.ctx.globalAlpha = 1;
      }
    }
    this.paint(0, 0, WP, HP, (ctx) => {
      for (const p of c.props) if (p.sprite === 'bench') Assets.draw(ctx, 'props', Assets.frame('props', 'bench'), p.x - 8, p.y - 8);
    }, true);
  },

  paintBox(op) {
    if (op.t === 'culdesac') {
      const r = op.r + 1;
      const x0 = Math.min(op.stem.x, op.bulb.x - r), y0 = Math.min(op.stem.y, op.bulb.y - r);
      const x1 = Math.max(op.stem.x + op.stem.w, op.bulb.x + r), y1 = Math.max(op.stem.y + op.stem.h, op.bulb.y + r);
      return [x0 * TILE, y0 * TILE, (x1 - x0) * TILE, (y1 - y0) * TILE];
    }
    if (op.t === 'pool') return [op.x - 30, op.y - 30, 60, 60];
    return [Math.min(op.x0, op.x1) - 4, Math.min(op.y0, op.y1) - 4, Math.abs(op.x1 - op.x0) + 8, Math.abs(op.y1 - op.y0) + 8];
  },

  paintOp(ctx, op) {
    if (op.t === 'culdesac') {
      // a smooth curb outline around the stem + turning circle, then asphalt, then the island
      if (!this._asphalt) {
        const a = mkCanvas(16, 16);
        const f = Assets.frame('tiles', 'asphalt', 0);
        a.ctx.drawImage(Assets.sheets.tiles.img, f * 16, 0, 16, 16, 0, 0, 16, 16);
        this._asphalt = ctx.createPattern(a, 'repeat');
      }
      const S = op.stem, B = op.bulb, r = op.r * TILE;
      const shape = (grow) => {
        ctx.beginPath();
        ctx.rect(S.x * TILE - grow, S.y * TILE - grow, S.w * TILE + grow * 2, S.h * TILE + grow * 2);
        ctx.moveTo(B.x * TILE + r + grow, B.y * TILE);
        ctx.arc(B.x * TILE, B.y * TILE, r + grow, 0, Math.PI * 2);
        ctx.fill();
      };
      ctx.fillStyle = PAL.m; shape(3);
      ctx.fillStyle = PAL.x; shape(2);
      ctx.fillStyle = this._asphalt; shape(0);
      ctx.fillStyle = PAL.l;
      ctx.beginPath(); ctx.arc(B.x * TILE, B.y * TILE, 26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PAL.G;
      ctx.beginPath(); ctx.arc(B.x * TILE, B.y * TILE, 24, 0, Math.PI * 2); ctx.fill();
    } else if (op.t === 'fence') {
      const n = Math.max(1, Math.round(Math.hypot(op.x1 - op.x0, op.y1 - op.y0)));
      const col = op.style === 'picket' ? PAL.x : op.style === 'wood' ? PAL.N : PAL.m;
      const post = op.style === 'picket' ? PAL.l : op.style === 'wood' ? PAL.n : PAL.d;
      const step = op.style === 'chain' ? 12 : 6;
      for (let i = 0; i <= n; i++) {
        const x = Math.round(op.x0 + ((op.x1 - op.x0) * i) / n), y = Math.round(op.y0 + ((op.y1 - op.y0) * i) / n);
        ctx.fillStyle = 'rgba(18,20,46,0.25)'; ctx.fillRect(x + 1, y + 1, 1, 1);
        ctx.fillStyle = i % step === 0 ? post : col;
        ctx.fillRect(x, y, i % step === 0 ? 2 : 1, i % step === 0 ? 2 : 1);
      }
    } else if (op.t === 'pool') {
      ctx.save();
      ctx.translate(Math.round(op.x), Math.round(op.y));
      if (op.rot) ctx.rotate(Math.PI / 2);
      Assets.draw(ctx, 'big', Assets.frame('big', 'pool'), -24, -24);
      ctx.restore();
    } else if (op.t === 'pipe') {
      ctx.fillStyle = PAL.d; ctx.fillRect(Math.round(op.x0), Math.round(op.y0) - 3, Math.round(op.x1 - op.x0), 6);
      ctx.fillStyle = PAL.l; ctx.fillRect(Math.round(op.x0), Math.round(op.y0) - 2, Math.round(op.x1 - op.x0), 2);
    }
  },
  _disc(ctx, cx, cy, r) {
    for (let y = -r; y <= r; y++) {
      const w = Math.round(Math.sqrt(r * r - y * y));
      ctx.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2, 1);
    }
  },

  // run fn(ctx) in world coordinates on every chunk the rect touches
  paint(x, y, w, h, fn, all) {
    for (let cy = 0; cy < this.chunks.length; cy++) {
      for (let cx = 0; cx < this.chunks[cy].length; cx++) {
        const X = cx * CHUNK, Y = cy * CHUNK;
        if (!all && (x > X + CHUNK || y > Y + CHUNK || x + w < X || y + h < Y)) continue;
        const ctx = this.chunks[cy][cx].ctx;
        ctx.save();
        ctx.translate(-X, -Y);
        fn(ctx);
        ctx.restore();
      }
    }
  },

  drawGround(ctx, cam) {
    const cx0 = Math.floor(cam.x / CHUNK), cy0 = Math.floor(cam.y / CHUNK);
    const cx1 = Math.floor((cam.x + cam.w) / CHUNK), cy1 = Math.floor((cam.y + cam.h) / CHUNK);
    for (let cy = Math.max(0, cy0); cy <= Math.min(this.chunks.length - 1, cy1); cy++) {
      for (let cx = Math.max(0, cx0); cx <= Math.min(this.chunks[cy].length - 1, cx1); cx++) {
        ctx.drawImage(this.chunks[cy][cx], cx * CHUNK - cam.x, cy * CHUNK - cam.y);
      }
    }
  },

  // permanent marks painted into the ground
  skid(x, y, s = 2) {
    x = Math.round(x); y = Math.round(y);
    this.paint(x - 2, y - 2, 4, 4, (ctx) => {
      ctx.fillStyle = 'rgba(22,22,34,0.2)';
      ctx.fillRect(x - 1, y - 1, s, s);
    });
  },
  scorch(x, y, R, size = 30) {
    const marks = [];
    for (let i = 0; i < 90; i++) {
      const a = R() * Math.PI * 2, d = Math.pow(R(), 0.6) * size;
      marks.push([Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d), 2 + Math.floor(R() * 4), 0.18 + R() * 0.25]);
    }
    this.paint(x - size - 6, y - size - 6, size * 2 + 12, size * 2 + 12, (ctx) => {
      for (const [mx, my, s, a] of marks) { ctx.fillStyle = `rgba(20,18,28,${a})`; ctx.fillRect(mx, my, s, s); }
    });
  },

  // a knocked-over lamp post, painted flat on the ground in the direction it fell
  fallenLamp(x, y, dx, dy) {
    const L = 34;
    this.paint(x - L - 10, y - L - 10, L * 2 + 20, L * 2 + 20, (ctx) => {
      ctx.fillStyle = 'rgba(18,20,40,0.3)';
      for (let i = 0; i <= L; i++) ctx.fillRect(Math.round(x + dx * i) + 1, Math.round(y + dy * i) + 2, 2, 2);
      ctx.fillStyle = PAL.k;
      for (let i = 0; i <= L; i++) ctx.fillRect(Math.round(x + dx * i), Math.round(y + dy * i), 2, 2);
      ctx.fillStyle = PAL.d;
      ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
      Assets.draw(ctx, 'props', Assets.frame('props', 'lamp'), x + dx * L - 8, y + dy * L - 8);
      ctx.fillStyle = PAL.m;
      for (let i = 0; i < 6; i++) ctx.fillRect(Math.round(x + dx * L + (Math.random() - 0.5) * 12), Math.round(y + dy * L + (Math.random() - 0.5) * 12), 1, 1);
    });
  },
  // scattered rubbish from a flattened bin
  litter(x, y, dx, dy) {
    const bits = [];
    for (let i = 0; i < 14; i++) {
      const d = Math.random() * 18;
      bits.push([Math.round(x + dx * d + (Math.random() - 0.5) * 12), Math.round(y + dy * d + (Math.random() - 0.5) * 12), pick(Math.random, [PAL.d, PAL.m, PAL.Y, PAL.h, PAL.x])]);
    }
    this.paint(x - 30, y - 30, 60, 60, (ctx) => {
      ctx.fillStyle = PAL.k; ctx.fillRect(Math.round(x + dx * 10) - 3, Math.round(y + dy * 10) - 3, 6, 6);
      for (const [bx, by, c] of bits) { ctx.fillStyle = c; ctx.fillRect(bx, by, 2, 1); }
    });
  },

  bakeMinimap() {
    const c = this.city;
    const m = (this.minimap = mkCanvas(c.W, c.H));
    const img = m.ctx.createImageData(c.W, c.H);
    const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const colors = {
      [KIND.WATER]: hex(PAL.w), [KIND.ROAD]: hex(PAL.d), [KIND.WALK]: hex(PAL.t), [KIND.GRASS]: hex(PAL.G),
      [KIND.PATH]: hex(PAL.o), [KIND.PLAZA]: hex(PAL.p), [KIND.LOT]: hex(PAL.b), [KIND.BUILDING]: hex(PAL.l),
      [KIND.RAIL]: hex(PAL.n), [KIND.BRIDGE]: hex(PAL.m), [KIND.FIELD]: hex(PAL.L), [KIND.DIRT]: hex(PAL.o),
      [KIND.VERGE]: hex(PAL.h), [KIND.LAWN]: hex(PAL.h), [KIND.CONCRETE]: hex(PAL.l), [KIND.SAND]: hex(PAL.T),
    };
    const styleColor = {
      teal: hex(PAL.f), rose: hex(PAL.R), cream: hex(PAL.Y), plum: hex(PAL.U), brick: hex(PAL.N), mint: hex(PAL.h),
      metal: hex(PAL.x), rust: hex(PAL.N), glass: hex(PAL.B), mall: hex(PAL.x), deck: hex(PAL.m), canopy: hex(PAL.z),
      red: hex(PAL.R), slate: hex(PAL.d), green: hex(PAL.G), brown: hex(PAL.N), barn: hex(PAL.r),
      container_red: hex(PAL.R), container_blue: hex(PAL.B), container_teal: hex(PAL.E), container_yellow: hex(PAL.L),
    };
    for (let i = 0; i < c.W * c.H; i++) {
      const col = colors[c.kind[i]];
      img.data.set([col[0], col[1], col[2], 255], i * 4);
    }
    for (const b of c.buildings) {
      const col = styleColor[b.roof.style || b.roof.mat || b.roof.tag] || hex(PAL.l);
      for (let y = b.ty; y < b.ty + b.th; y++) for (let x = b.tx; x < b.tx + b.tw; x++) {
        const edge = x === b.tx || y === b.ty || x === b.tx + b.tw - 1 || y === b.ty + b.th - 1;
        const k = edge ? 0.7 : 1;
        img.data.set([col[0] * k, col[1] * k, col[2] * k, 255], (y * c.W + x) * 4);
      }
    }
    m.ctx.putImageData(img, 0, 0);
  },

  // ---------------------------------------------------------- buildings --
  // Decide once which module (and lit variant) sits on each storey/column.
  layoutFacades() {
    for (const b of this.city.buildings) {
      const R = rng(b.seed);
      const twin = R() < 0.4;
      const face = (width) => {
        const cols = Math.ceil(width / MODULE);
        const plainCol = [];
        for (let i = 0; i < cols; i++) plainCol.push(R() < 0.14);
        const grid = [];
        for (let f = 0; f < b.floors; f++) {
          const row = [];
          const ground = f === b.floors - 1;
          for (let i = 0; i < cols; i++) {
            let k, lit = -1;
            if (ground && R() < 0.6) { k = 2; if (R() < 0.75) lit = 6; }
            else if (plainCol[i] && !ground) k = 3;
            else { k = twin ? 1 : 0; if (R() < b.lit) lit = twin ? 5 : R() < 0.2 ? 7 : 4; }
            row.push([k, lit]);
          }
          grid.push(row);
        }
        return grid;
      };
      b.faces = { s: face(b.w), n: face(b.w), e: face(b.h), w: face(b.h) };
      b.cache = new Map();
      b.roofs = {};
    }
  },

  // wall sheet with every row pre-squashed to k rows per module
  squashed(k) {
    if (!this._squash[k]) {
      const src = Assets.sheets.walls.img;
      const cv = mkCanvas(src.width, k);
      for (let r = 0; r < k; r++) {
        const sy = Math.min(MODULE - 1, Math.floor(((r + 0.5) * MODULE) / k));
        cv.ctx.drawImage(src, 0, sy, src.width, 1, 0, r, src.width, 1);
      }
      this._squash[k] = cv;
    }
    return this._squash[k];
  },

  // facade texture for one side at squash k; e/w sides come back transposed
  // (column 0 = top of the wall)
  facade(b, side, k, time) {
    const key = side + k + ':' + time;
    let tex = b.cache.get(key);
    if (tex) return tex;
    const grid = b.faces[side];
    const width = side === 's' || side === 'n' ? b.w : b.h;
    const H = b.floors * k;
    const sq = this.squashed(k);
    const F = (i) => Assets.frame('walls', 'wall_' + b.wall, i);
    const day = mkCanvas(width, H), glow = mkCanvas(width, H);
    grid.forEach((row, f) => row.forEach(([m, lit], i) => {
      day.ctx.drawImage(sq, F(m) * MODULE, 0, MODULE, k, i * MODULE, f * k, MODULE, k);
      if (lit >= 0) glow.ctx.drawImage(sq, F(lit) * MODULE, 0, MODULE, k, i * MODULE, f * k, MODULE, k);
    }));
    const ctx = day.ctx;
    ctx.fillStyle = 'rgba(26,28,44,0.35)';
    ctx.fillRect(0, H - Math.min(3, k), width, Math.min(3, k));
    const shade = { s: 0, n: 0.3, e: 0.38, w: 0.16 }[side];
    if (shade) { ctx.fillStyle = `rgba(26,28,60,${shade})`; ctx.fillRect(0, 0, width, H); }
    if (time) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = TIMES[time].ambient;
      ctx.fillRect(0, 0, width, H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = TIMES[time].glow;
      ctx.drawImage(glow, 0, 0);
      ctx.globalAlpha = 1;
    }
    tex = day;
    if (side === 'e' || side === 'w') {
      tex = mkCanvas(H, width);
      tex.ctx.setTransform(0, 1, 1, 0, 0, 0);
      tex.ctx.drawImage(day, 0, 0);
    }
    if (b.cache.size > 12) b.cache.delete(b.cache.keys().next().value);
    b.cache.set(key, tex);
    return tex;
  },

  roof(b, time) {
    if (!b.roofs.day) b.roofs.day = this.makeRoof(b, rng(b.seed ^ 0x2f));
    if (!time) return b.roofs.day;
    if (!b.roofs[time]) {
      const src = b.roofs.day, T = TIMES[time];
      const cv = mkCanvas(src.width, src.height);
      cv.ctx.drawImage(src, 0, 0);
      cv.ctx.globalCompositeOperation = 'multiply';
      cv.ctx.fillStyle = T.ambient;
      cv.ctx.fillRect(0, 0, cv.width, cv.height);
      cv.ctx.globalCompositeOperation = 'source-over';
      cv.ctx.globalAlpha = T.glow;
      cv.ctx.drawImage(this.makeRoofGlow(b), 0, 0);
      cv.ctx.globalAlpha = 1;
      b.roofs[time] = cv;
    }
    return b.roofs[time];
  },

  makeRoof(b, R) {
    let cv;
    if (b.roof.type === 'pitched') cv = this.pitchedRoof(b, R);
    else if (b.roof.type === 'sprite') cv = this.spriteRoof(b);
    else cv = this.flatRoof(b, R);
    if (b.sign) this.drawSign(cv.ctx, b, false);
    return cv;
  },

  // gable roof built in "ridge horizontal" orientation, rotated when the ridge runs north-south
  pitchedRoof(b, R) {
    const horiz = b.roof.ridge === 'h';
    const cols = horiz ? b.tw : b.th, rows = horiz ? b.th : b.tw;
    const base = mkCanvas(cols * 16, rows * 16);
    const img = Assets.sheets.pitched.img, tag = 'pitched_' + b.roof.mat;
    const mid = Math.floor(rows / 2);
    for (let j = 0; j < rows; j++) {
      let t;
      if (j === 0) t = 0;
      else if (j === rows - 1) t = 4;
      else if (rows % 2) t = j < mid ? 1 : j === mid ? 5 : 3;
      else t = j < rows / 2 ? 1 : j === rows / 2 ? 2 : 3;
      for (let i = 0; i < cols; i++) {
        const col = i === 0 ? 0 : i === cols - 1 ? 2 : 1;
        base.ctx.drawImage(img, Assets.frame('pitched', tag, t * 3 + col) * 16, 0, 16, 16, i * 16, j * 16, 16, 16);
      }
    }
    if (b.house && R() < 0.8) { // chimney on the sunny slope
      const x = 8 + Math.floor(R() * (cols * 16 - 24)), y = Math.max(3, Math.floor(rows * 16 * 0.25));
      base.ctx.fillStyle = PAL.K; base.ctx.fillRect(x - 1, y - 1, 8, 8);
      base.ctx.fillStyle = PAL.R; base.ctx.fillRect(x, y, 6, 6);
      base.ctx.fillStyle = PAL.k; base.ctx.fillRect(x + 1, y + 1, 4, 3);
    }
    if (b.house && R() < 0.25) { // solar panels on the shaded slope
      const x = 10, y = Math.ceil(rows * 16 * 0.6);
      base.ctx.fillStyle = PAL.K; base.ctx.fillRect(x - 1, y - 1, Math.min(34, cols * 16 - 20) + 2, 10);
      base.ctx.fillStyle = PAL.B; base.ctx.fillRect(x, y, Math.min(34, cols * 16 - 20), 8);
      base.ctx.fillStyle = PAL.C; for (let k = x; k < x + Math.min(34, cols * 16 - 20); k += 6) base.ctx.fillRect(k, y, 1, 8);
    }
    if (horiz) return base;
    const cv = mkCanvas(b.w, b.h);
    cv.ctx.translate(0, b.h);
    cv.ctx.rotate(-Math.PI / 2);
    cv.ctx.drawImage(base, 0, 0);
    return cv;
  },

  // shipping containers: the roof is the container sprite (32x80 inside a 48x96 cell)
  spriteRoof(b) {
    const cv = mkCanvas(b.w, b.h);
    const img = Assets.sheets.wide.img, f = Assets.frame('wide', b.roof.tag);
    if (b.tw <= b.th) cv.ctx.drawImage(img, f * 48 + 8, 8, 32, 80, 0, 0, b.w, b.h);
    else { cv.ctx.translate(b.w, 0); cv.ctx.rotate(Math.PI / 2); cv.ctx.drawImage(img, f * 48 + 8, 8, 32, 80, 0, 0, b.h, b.w); }
    return cv;
  },

  // shop / bar / mall names on a little rooftop billboard
  drawSign(ctx, b, glow) {
    const text = b.sign;
    const w = Font.width(text) + 8, h = 12;
    const x = Math.round((b.w - w) / 2), y = Math.round(Math.min(b.h - h - 4, b.h * 0.5 - h / 2));
    const neon = b.wall === 'store_b' || b.sign === 'BAR' ? PAL.z : b.sign === 'GAS' ? PAL.L : PAL.q;
    if (!glow) {
      ctx.fillStyle = PAL.K; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = PAL.k; ctx.fillRect(x, y, w, h);
    }
    Font.draw(ctx, text, x + 4, y + 2, { color: neon, outline: null });
  },

  flatRoof(b, R) {
    const cv = mkCanvas(b.w, b.h);
    const tag = 'roof_' + b.roof.style;
    const img = Assets.sheets.roofs.img;
    for (let j = 0; j < b.th; j++) {
      for (let i = 0; i < b.tw; i++) {
        const col = i === 0 ? 0 : i === b.tw - 1 ? 2 : 1;
        const row = j === 0 ? 0 : j === b.th - 1 ? 2 : 1;
        let k = row * 3 + col;
        if (k === 4 && R() < 0.12) k = R() < 0.5 ? 9 : 10;
        cv.ctx.drawImage(img, Assets.frame('roofs', tag, k) * 16, 0, 16, 16, i * 16, j * 16, 16, 16);
      }
    }
    const used = new Set();
    const free = (i, j, s) => {
      for (let y = j; y < j + s; y++) for (let x = i; x < i + s; x++) {
        if (x < 1 || y < 1 || x > b.tw - 2 || y > b.th - 2 || used.has(x + ',' + y)) return false;
      }
      return true;
    };
    const take = (i, j, s) => { for (let y = j; y < j + s; y++) for (let x = i; x < i + s; x++) used.add(x + ',' + y); };
    const big = (sprite, i, j) => { take(i, j, 3); Assets.draw(cv.ctx, 'big', Assets.frame('big', sprite), i * 16, j * 16); };
    if (b.tower) big('helipad', Math.floor(b.tw / 2) - 1, Math.floor(b.th / 2) - 1);
    else if (b.tw >= 5 && b.th >= 5 && R() < 0.45) {
      const i = 1 + Math.floor(R() * (b.tw - 4)), j = 1 + Math.floor(R() * (b.th - 4));
      if (free(i, j, 3)) big('watertank', i, j);
    }
    for (let j = 1; j < b.th - 1; j++) {
      for (let i = 1; i < b.tw - 1; i++) {
        if (!free(i, j, 1)) continue;
        // industrial sheds get sparse vents and skylights; everything else the usual clutter
        const shed = b.roof.style === 'metal' || b.roof.style === 'rust';
        const r = R() * (shed ? 3 : 1);
        const sprite = shed ? (r < 0.08 ? 'skylight' : r < 0.12 ? 'vent' : null)
          : r < 0.12 ? 'ac' : r < 0.19 ? 'vent' : r < 0.25 ? 'skylight' : r < 0.27 ? 'antenna' : null;
        if (!sprite) continue;
        take(i, j, 1);
        Assets.draw(cv.ctx, 'props', Assets.frame('props', sprite), i * 16, j * 16);
      }
    }
    if (b.roofCars) { // cars parked on the top deck
      const models = ['sedan', 'hatch', 'suv', 'taxi', 'van', 'sport'];
      for (let x = 24; x < b.w - 16; x += 32) for (const y of [36, b.h - 36]) {
        if (R() < 0.35) continue;
        Assets.drawRot(cv.ctx, 'cars', Assets.frame('cars', pick(R, models), 0), x, y, R() < 0.5 ? 0 : Math.PI);
      }
    }
    return cv;
  },

  makeRoofGlow(b) {
    const style = b.roof.style;
    const neon = { plum: PAL.z, mint: PAL.q, teal: PAL.q, glass: PAL.q, mall: PAL.p }[style];
    const cv = mkCanvas(b.w, b.h);
    if (b.sign) this.drawSign(cv.ctx, b, true);
    if (b.roof.type !== 'flat') return cv;
    if (neon && (b.floors >= 4 || style === 'plum' || style === 'mall')) {
      cv.ctx.fillStyle = neon;
      cv.ctx.fillRect(1, 1, b.w - 2, 1); cv.ctx.fillRect(1, b.h - 2, b.w - 2, 1);
      cv.ctx.fillRect(1, 1, 1, b.h - 2); cv.ctx.fillRect(b.w - 2, 1, 1, b.h - 2);
    }
    if (b.floors >= 6) { cv.ctx.fillStyle = PAL.z; cv.ctx.fillRect(3, 3, 2, 2); cv.ctx.fillRect(b.w - 5, b.h - 5, 2, 2); }
    return cv;
  },

  drawBuildings(ctx, cam, time) {
    this.frameNo++;
    const list = [];
    const m = 200;
    for (const b of this.city.buildings) {
      if (b.x + b.w < cam.x - m || b.x > cam.x + cam.w + m || b.y + b.h < cam.y - m || b.y > cam.y + cam.h + m) continue;
      const dx = b.x + b.w / 2 - cam.cx, dy = b.y + b.h / 2 - cam.cy;
      list.push({ b, d: dx * dx + dy * dy, ox: Math.round(dx * PARALLAX * b.height), oy: Math.round(dy * PARALLAX * b.height) });
    }
    list.sort((a, b) => b.d - a.d);
    for (const it of list) { it.b.seen = this.frameNo; this.drawBuilding(ctx, cam, it.b, it.ox, it.oy, time); }
    if (this.frameNo % 120 === 0) {
      for (const b of this.city.buildings) if (b.cache.size && this.frameNo - (b.seen || 0) > 240) b.cache.clear();
    }
  },

  drawBuilding(ctx, cam, b, ox, oy, time) {
    const X = b.x - cam.x, Y = b.y - cam.y, W = b.w, D = b.h, fl = b.floors;
    if (b.overhang) { // canopy on posts: just the roof, lifted
      ctx.fillStyle = PAL.k;
      for (const [px, py] of [[4, 4], [W - 7, 4], [4, D - 7], [W - 7, D - 7]]) {
        const steps = Math.max(Math.abs(ox), Math.abs(oy), 1);
        for (let i = 0; i <= steps; i++) ctx.fillRect(X + px + Math.round((ox * i) / steps), Y + py + Math.round((oy * i) / steps), 3, 3);
      }
      ctx.drawImage(this.roof(b, time), X + ox, Y + oy);
      return;
    }
    const kOf = (n) => clamp(Math.floor(n / fl), 1, MODULE);
    if (oy !== 0) {
      const n = Math.abs(oy), k = kOf(n), H = fl * k, band = n - H;
      const tex = this.facade(b, oy < 0 ? 's' : 'n', k, time);
      for (let r = 0; r < n; r++) {
        if (oy < 0) { // south wall: r = 0 at the roof edge
          const t = (r + 0.5) / n;
          const v = Math.max(0, r - band);
          ctx.drawImage(tex, 0, v, W, 1, X + Math.round(ox * (1 - t)), Y + D + oy + r, W, 1);
        } else {      // north wall: r = 0 at the base
          const t = (r + 0.5) / n;
          const v = Math.max(0, H - 1 - r);
          ctx.drawImage(tex, 0, v, W, 1, X + Math.round(ox * t), Y + r, W, 1);
        }
      }
    }
    if (ox !== 0) {
      const n = Math.abs(ox), k = kOf(n), H = fl * k, band = n - H;
      const tex = this.facade(b, ox < 0 ? 'e' : 'w', k, time);
      for (let c = 0; c < n; c++) {
        if (ox < 0) { // east wall: c = 0 at the roof edge
          const t = (c + 0.5) / n;
          const u = Math.max(0, c - band);
          ctx.drawImage(tex, u, 0, 1, D, X + W + ox + c, Y + Math.round(oy * (1 - t)), 1, D);
        } else {      // west wall: c = 0 at the base
          const t = (c + 0.5) / n;
          const u = Math.max(0, H - 1 - c);
          ctx.drawImage(tex, u, 0, 1, D, X + c, Y + Math.round(oy * t), 1, D);
        }
      }
    }
    ctx.drawImage(this.roof(b, time), X + ox, Y + oy);
  },

  // --------------------------------------------------- trees and lamps --
  LAMP_H: 60,
  TREE_H: 40,
  drawTall(ctx, cam, glowPass) {
    const time = G.time;
    for (const l of this.city.lamps) {
      if (l.broken) continue;
      if (l.x < cam.x - 40 || l.x > cam.x + cam.w + 40 || l.y < cam.y - 40 || l.y > cam.y + cam.h + 40) continue;
      const hx = Math.round((l.x - cam.cx) * PARALLAX * this.LAMP_H), hy = Math.round((l.y - cam.cy) * PARALLAX * this.LAMP_H);
      const bx = Math.round(l.x - cam.x), by = Math.round(l.y - cam.y);
      if (!glowPass) {
        ctx.fillStyle = PAL.k;
        const steps = Math.max(1, Math.abs(hx), Math.abs(hy));
        for (let i = 0; i <= steps; i++) ctx.fillRect(bx + Math.round(hx * i / steps), by + Math.round(hy * i / steps), 2, 2);
        ctx.fillRect(bx - 1, by - 1, 4, 4);
      }
      Assets.draw(ctx, 'props', Assets.frame('props', 'lamp'), bx + hx - 8, by + hy - 8);
      if (glowPass && time > 0) {
        ctx.fillStyle = PAL.j;
        ctx.fillRect(bx + hx - 1, by + hy - 1, 3, 2);
      }
    }
    if (glowPass) return;
    const big = Assets.sheets.big;
    for (const t of this.city.talls) {
      const m = 60 + t.h * 0.3;
      if (t.x < cam.x - m || t.x > cam.x + cam.w + m || t.y < cam.y - m || t.y > cam.y + cam.h + m) continue;
      const ox = (t.x - cam.cx) * PARALLAX * t.h, oy = (t.y - cam.cy) * PARALLAX * t.h;
      const bx = t.x - cam.x, by = t.y - cam.y;
      if (t.column) { // cylinder body from the ground up to the top
        const steps = Math.max(1, Math.ceil(Math.hypot(ox, oy)));
        for (let i = 0; i <= steps; i += 2) {
          const u = i / steps;
          ctx.fillStyle = u < 0.5 ? PAL.k : PAL[t.column === 'R' ? 'r' : 'd'];
          this._disc(ctx, bx + ox * u, by + oy * u, t.r - 1);
        }
        if (t.column === 'R') { // candy stripes on a chimney
          ctx.fillStyle = PAL.x;
          for (const u of [0.7, 0.85]) this._disc(ctx, bx + ox * u, by + oy * u, t.r - 1);
        }
      }
      Assets.draw(ctx, 'big', Assets.frame('big', t.sprite), Math.round(bx + ox) - 24, Math.round(by + oy) - 24);
    }
    for (const tr of this.city.trees) {
      if (tr.x < cam.x - 60 || tr.x > cam.x + cam.w + 60 || tr.y < cam.y - 60 || tr.y > cam.y + cam.h + 60) continue;
      const ox = Math.round((tr.x - cam.cx) * PARALLAX * this.TREE_H), oy = Math.round((tr.y - cam.cy) * PARALLAX * this.TREE_H);
      ctx.drawImage(big.img, Assets.frame('big', tr.sprite) * 48, 0, 48, 48, Math.round(tr.x - cam.x - 24 + ox), Math.round(tr.y - cam.y - 24 + oy), 48, 48);
    }
  },

  // -------------------------------------------------------------- lights --
  lightSprite(r, color) {
    const key = r + color;
    if (!this._lights[key]) {
      const cv = mkCanvas(r * 2, r * 2);
      const g = cv.ctx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      cv.ctx.fillStyle = g;
      cv.ctx.fillRect(0, 0, r * 2, r * 2);
      this._lights[key] = cv;
    }
    return this._lights[key];
  },
  coneSprite() {
    if (!this._cone) {
      const L = 170, cv = mkCanvas(L, L);
      const ctx = cv.ctx;
      const g = ctx.createRadialGradient(L / 2, L, 0, L / 2, L, L);
      g.addColorStop(0, 'rgba(255,240,200,0.95)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(L / 2 - 10, L);
      ctx.lineTo(L / 2 - 52, 0);
      ctx.lineTo(L / 2 + 52, 0);
      ctx.lineTo(L / 2 + 10, L);
      ctx.fill();
      this._cone = cv;
    }
    return this._cone;
  },

  applyLighting(ctx, cam, time, lights) {
    const T = TIMES[time];
    if (!this.lightCv || this.lightCv.width !== cam.w || this.lightCv.height !== cam.h) this.lightCv = mkCanvas(cam.w, cam.h);
    const lc = this.lightCv.ctx;
    lc.globalCompositeOperation = 'source-over';
    lc.fillStyle = T.ambient;
    lc.fillRect(0, 0, cam.w, cam.h);
    lc.globalCompositeOperation = 'lighter';
    lc.globalAlpha = T.lights;
    const cone = this.coneSprite();
    for (const L of lights) {
      const x = L.x - cam.x, y = L.y - cam.y;
      if (L.cone) {
        lc.save();
        lc.translate(x, y);
        lc.rotate(L.ang);
        lc.drawImage(cone, -cone.width / 2, -cone.height);
        lc.restore();
      } else {
        if (x < -L.r || y < -L.r || x > cam.w + L.r || y > cam.h + L.r) continue;
        lc.drawImage(this.lightSprite(L.r, L.color), Math.round(x - L.r), Math.round(y - L.r));
      }
    }
    lc.globalAlpha = 1;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.lightCv, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  },
};
