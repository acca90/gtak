'use strict';
// City generator: a 10x10 grid of blocks on an island, split into four regions.
//
//   NW DOWNTOWN      skyscrapers, offices, a mall, shop rows, parking garage, parks
//   NE IRONWORKS     double-length blocks: warehouses, containers, tank farm, factories, railway
//   SW MAPLE HILLS   2x2 super-blocks with cul-de-sacs and houses, quiet streets
//   SE GOLDEN FIELDS big fields, farmsteads, orchards, micro towns, a river with bridges
//
// Tile layout along each axis (16 px tiles):
//   water | promenade(3) | road(7) block(20) road(7) ... road(7) | promenade(3) | water
// Every road *segment* (between two intersections) can be removed, which merges
// the blocks on both sides into one bigger lot, or turned into railway.

const CITY = { ROAD: 7, PITCH: 27, NB: 10, MARGIN: 12, WALK: 3, IN: 14 };
CITY.LOT = CITY.PITCH - CITY.ROAD;               // 20
CITY.SPAN = CITY.NB * CITY.PITCH + CITY.ROAD;    // 277
CITY.W = CITY.MARGIN * 2 + CITY.SPAN;            // 301
CITY.H = CITY.W;

const KIND = {
  WATER: 0, ROAD: 1, WALK: 2, GRASS: 3, PATH: 4, PLAZA: 5, LOT: 6, BUILDING: 7,
  RAIL: 8, BRIDGE: 9, FIELD: 10, DIRT: 11, VERGE: 12, LAWN: 13, CONCRETE: 14, SAND: 15,
};
const CROPS = ['wheat', 'corn', 'soil', 'pasture'];

const REGIONS = [
  { id: 'downtown', name: 'DOWNTOWN', ring: KIND.WALK, lamps: true, lit: 0.6, park: 0.35,
    models: { sedan: 20, taxi: 16, sport: 8, police: 5, police_suv: 3, hatch: 12, suv: 10, muscle: 4, van: 4, truck: 2, bus: 3 } },
  { id: 'industrial', name: 'IRONWORKS', ring: KIND.WALK, lamps: true, lit: 0.35, park: 0.18,
    models: { truck: 16, semi: 10, tanker: 6, flatbed: 8, mixer: 5, garbage: 4, van: 8, pickup: 8, sedan: 4 } },
  { id: 'suburbs', name: 'MAPLE HILLS', ring: KIND.WALK, lamps: true, lit: 0.45, park: 0.05, trees: 'tree_a',
    models: { hatch: 18, sedan: 18, suv: 18, van: 8, pickup: 8, muscle: 4, sport: 3, police: 2 } },
  { id: 'farm', name: 'GOLDEN FIELDS', ring: KIND.VERGE, lamps: false, lit: 0.35, park: 0.03, trees: 'tree_a',
    models: { pickup: 20, tractor: 10, truck: 6, flatbed: 6, suv: 6, hatch: 4, sedan: 4, van: 3 } },
];

const City = {
  regionOfBlock(bx, by) { return (bx < 5 ? 0 : 1) + (by < 5 ? 0 : 2); },
  blockOfTile(t) { return clamp(Math.floor((t - CITY.MARGIN - CITY.ROAD / 2) / CITY.PITCH), 0, CITY.NB - 1); },
  regionAt(x, y) {
    return REGIONS[this.regionOfBlock(this.blockOfTile(x / TILE), this.blockOfTile(y / TILE))];
  },
  inCity(t) { return t >= CITY.MARGIN && t < CITY.MARGIN + CITY.SPAN; },
  inLand(t) { return t >= CITY.MARGIN - 3 && t < CITY.MARGIN + CITY.SPAN + 3; },

  // what the road network puts on tile (x, y); null = inside a block
  //   { t: 'v' | 'h' | 'int' | 'rail', along, across, country, xing }
  roadAt(x, y) {
    const { MARGIN, ROAD, PITCH, NB, SPAN } = CITY;
    const lx = x - MARGIN, ly = y - MARGIN;
    if (lx < 0 || ly < 0 || lx >= SPAN || ly >= SPAN) return null;
    const vi = lx % PITCH < ROAD ? Math.floor(lx / PITCH) : -1;
    const hj = ly % PITCH < ROAD ? Math.floor(ly / PITCH) : -1;
    const v = this.vseg, h = this.hseg;
    if (vi >= 0 && hj >= 0) {
      const up = hj > 0 ? v[vi][hj - 1] : null, down = hj < NB ? v[vi][hj] : null;
      const left = vi > 0 ? h[hj][vi - 1] : null, right = vi < NB ? h[hj][vi] : null;
      const vRoad = up === 'road' || down === 'road', hRoad = left === 'road' || right === 'road';
      const segs = [];
      if (up === 'road') segs.push(this.vcountry[vi][hj - 1]);
      if (down === 'road') segs.push(this.vcountry[vi][hj]);
      if (left === 'road') segs.push(this.hcountry[hj][vi - 1]);
      if (right === 'road') segs.push(this.hcountry[hj][vi]);
      const country = segs.length > 0 && segs.every(Boolean);
      if (vRoad || hRoad) return { t: 'int', country, xing: left === 'rail' && right === 'rail' && vRoad, across: ly % PITCH };
      if (left === 'rail' || right === 'rail') return { t: 'rail', across: ly % PITCH };
      return null;
    }
    if (vi >= 0) {
      const row = Math.floor((ly - ROAD) / PITCH);
      if (v[vi][row] !== 'road') return null;
      return { t: 'v', along: ly - (row * PITCH + ROAD), across: lx % PITCH, country: this.vcountry[vi][row] };
    }
    if (hj >= 0) {
      const col = Math.floor((lx - ROAD) / PITCH);
      const s = h[hj][col];
      if (s === 'road') return { t: 'h', along: lx - (col * PITCH + ROAD), across: ly % PITCH, country: this.hcountry[hj][col] };
      if (s === 'rail') return { t: 'rail', across: ly % PITCH };
    }
    return null;
  },

  build(seed) {
    const R = rng(seed);
    const { W, H, MARGIN, ROAD, PITCH, NB, LOT, WALK } = CITY;
    const c = {
      W, H, seed,
      kind: new Uint8Array(W * H), sub: new Uint8Array(W * H), frame: new Int16Array(W * H).fill(-1),
      solid: new Uint8Array(W * H),
      buildings: [], trees: [], lamps: [], props: [], obstacles: [], phones: [], talls: [], paints: [],
      parkSpots: [], stalls: [], roadSpots: [], crateSpots: [], parked: [],
      garage: null, spawn: null, tankSpot: null, rail: null,
    };
    const I = (x, y) => y * W + x;
    const kindAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? KIND.WATER : c.kind[I(x, y)]);
    const setKind = (x, y, k, sub = 0) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const cur = c.kind[I(x, y)];
      if (cur === KIND.WATER || cur === KIND.BRIDGE) return;   // never build over the river
      c.kind[I(x, y)] = k; c.sub[I(x, y)] = sub;
    };
    const fill = (A, k, sub = 0) => { for (let y = A.y; y < A.y + A.h; y++) for (let x = A.x; x < A.x + A.w; x++) setKind(x, y, k, typeof sub === 'function' ? sub(x, y) : sub); };
    const blocked = (k) => k === KIND.WATER || k === KIND.ROAD || k === KIND.BRIDGE || k === KIND.BUILDING || k === KIND.RAIL || k === KIND.SAND;
    const areaOpen = (x, y, w, h) => {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (blocked(kindAt(i, j))) return false;
      return true;
    };
    const T = (t) => t * TILE;

    // ------------------------------------------------------------ network --
    this.vseg = [...Array(NB + 1)].map(() => Array(NB).fill('road'));
    this.hseg = [...Array(NB + 1)].map(() => Array(NB).fill('road'));
    const merges = [], claimed = new Set();
    const merge = (bx0, by0, bx1, by1, type) => {
      merges.push({ bx0, by0, bx1, by1, type });
      for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) claimed.add(bx + ',' + by);
      for (let by = by0; by <= by1; by++) for (let i = bx0 + 1; i <= bx1; i++) this.vseg[i][by] = 'none';
      for (let bx = bx0; bx <= bx1; bx++) for (let j = by0 + 1; j <= by1; j++) this.hseg[j][bx] = 'none';
    };
    merge(1, 1, 2, 1, 'mall');
    const industrial = ['warehouse', 'containers', 'tankfarm', 'factory', 'warehouse'];
    for (let by = 0; by < 5; by++) { merge(5, by, 6, by, pick(R, industrial)); merge(7, by, 8, by, pick(R, industrial)); }
    for (let i = 5; i <= 9; i++) this.hseg[3][i] = 'rail';
    for (const [bx, by] of [[0, 5], [2, 5], [0, 7], [2, 7]]) merge(bx, by, bx + 1, by + 1, 'culdesac');
    for (const [bx, by] of [[5, 5], [8, 5], [5, 8], [8, 8]]) merge(bx, by, bx + 1, by + 1, 'fields');
    const weighted = (w) => {
      let r = R() * Object.values(w).reduce((a, b) => a + b, 0);
      for (const k in w) { r -= w[k]; if (r <= 0) return k; }
      return Object.keys(w)[0];
    };
    const singleType = (bx, by) => {
      const rg = this.regionOfBlock(bx, by);
      if (rg === 0) return bx === 4 && by === 4 ? 'park' : weighted({ skyscraper: 0.3, office: 0.3, stores: 0.15, garage: 0.08, park: 0.1, plaza: 0.07 });
      if (rg === 1) return bx === 9 && by === 1 ? 'garagelot' : weighted({ depot: 0.4, warehouse: 0.4, containers: 0.2 });
      if (rg === 2) return bx === 4 && by === 7 ? 'park' : 'houses';
      if (bx === 7) return by === 5 ? 'pond' : 'riverside';
      return { 5: 'farmstead', 6: 'town', 8: 'town', 9: 'orchard' }[bx];
    };
    for (let by = 0; by < NB; by++) for (let bx = 0; bx < NB; bx++) if (!claimed.has(bx + ',' + by)) merges.push({ bx0: bx, by0: by, bx1: bx, by1: by, type: singleType(bx, by) });

    // country roads: segments with farmland on both sides (or farmland and the sea)
    const farmSide = (bx, by) => bx < 0 || by < 0 || bx >= NB || by >= NB || this.regionOfBlock(bx, by) === 3;
    const anyFarm = (bx, by) => bx >= 0 && by >= 0 && bx < NB && by < NB && this.regionOfBlock(bx, by) === 3;
    this.vcountry = this.vseg.map((col, i) => col.map((_, j) => farmSide(i - 1, j) && farmSide(i, j) && (anyFarm(i - 1, j) || anyFarm(i, j))));
    this.hcountry = this.hseg.map((row, j) => row.map((_, i) => farmSide(i, j - 1) && farmSide(i, j) && (anyFarm(i, j - 1) || anyFarm(i, j))));

    // ------------------------------------------------------ base tiles --
    const midT = MARGIN + CITY.SPAN / 2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let k = KIND.WATER;
        if (this.inLand(x) && this.inLand(y)) k = x > midT && y > midT ? KIND.SAND : KIND.WALK;
        const r = this.roadAt(x, y);
        if (r) k = r.t === 'rail' ? KIND.RAIL : KIND.ROAD;
        c.kind[I(x, y)] = k;
      }
    }
    c.blocks = merges.map((m) => {
      const x0 = MARGIN + ROAD + m.bx0 * PITCH, y0 = MARGIN + ROAD + m.by0 * PITCH;
      const x1 = MARGIN + ROAD + m.bx1 * PITCH + LOT, y1 = MARGIN + ROAD + m.by1 * PITCH + LOT;
      const rg = REGIONS[this.regionOfBlock(m.bx0, m.by0)];
      const b = Object.assign({}, m, { x0, y0, x1, y1, rg, bx: m.bx0, by: m.by0,
        A: { x: x0 + WALK, y: y0 + WALK, w: x1 - x0 - 2 * WALK, h: y1 - y0 - 2 * WALK } });
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const ring = x < x0 + WALK || y < y0 + WALK || x >= x1 - WALK || y >= y1 - WALK;
        c.kind[I(x, y)] = ring ? rg.ring : KIND.GRASS;
      }
      return b;
    });

    // ----------------------------------------------------- river & pond --
    const pondB = c.blocks.find((b) => b.bx === 7 && b.by === 5);
    const pcx = pondB.A.x + pondB.A.w / 2, pcy = pondB.A.y + pondB.A.h / 2;
    const isLandIn = (x, y) => this.inLand(x) && this.inLand(y);
    for (let y = Math.floor(pcy - 7); y < pcy + 7; y++) for (let x = Math.floor(pcx - 7); x < pcx + 7; x++) {
      if (dist(x + 0.5, y + 0.5, pcx, pcy) < 5.3) c.kind[I(x, y)] = KIND.WATER;
    }
    const riverX = (y) => pcx + 3 * Math.sin((y - pcy) / 9) + 1.5 * Math.sin((y - pcy) / 4.3);
    for (let y = Math.floor(pcy); y < H; y++) {
      const xc = riverX(y);
      for (let x = Math.round(xc - 2.7); x <= Math.round(xc + 2.7); x++) {
        const k = c.kind[I(x, y)];
        if (k === KIND.ROAD || (k === KIND.SAND && y >= MARGIN + CITY.SPAN)) c.kind[I(x, y)] = KIND.BRIDGE;
        else if (k !== KIND.WATER && k !== KIND.BRIDGE) c.kind[I(x, y)] = KIND.WATER;
      }
    }

    // ------------------------------------------------------------ helpers --
    const addObstacle = (x, y, r, extra) => { const o = Object.assign({ x, y, r }, extra); c.obstacles.push(o); return o; };
    const addTree = (x, y, sprite) => {
      if (blocked(kindAt(Math.floor(x / TILE), Math.floor(y / TILE)))) return;
      c.trees.push({ x, y, sprite }); addObstacle(x, y, 5);
    };
    const addProp = (sprite, x, y, r, extra) => {
      const p = Object.assign({ sprite, x, y }, extra);
      c.props.push(p);
      if (r) p.obstacle = addObstacle(x, y, r, (sprite === 'hydrant' || sprite === 'bin') ? { breakable: sprite, prop: p } : null);
      return p;
    };
    const addTall = (sprite, x, y, h, r, extra) => { c.talls.push(Object.assign({ sprite, x, y, h, r }, extra)); addObstacle(x, y, r); };
    // wall: facade style; roof: { type: 'flat', style } | { type: 'pitched', mat, ridge } | { type: 'sprite', tag }
    const addBuilding = (tx, ty, tw, th, floors, wall, roof, rg, extra = {}) => {
      if (tw < 2 || th < 2 || !areaOpen(tx, ty, tw, th)) return null;
      if (!extra.overhang) for (let y = ty; y < ty + th; y++) for (let x = tx; x < tx + tw; x++) { c.kind[I(x, y)] = KIND.BUILDING; c.solid[I(x, y)] = 1; }
      const b = Object.assign({
        tx, ty, tw, th, x: T(tx), y: T(ty), w: T(tw), h: T(th),
        floors, height: floors * 32, wall, roof, lit: rg.lit, seed: (R() * 1e9) | 0,
      }, extra);
      c.buildings.push(b);
      return b;
    };
    const flat = (style) => ({ type: 'flat', style });
    const spot = (x, y, ang, models, extra) => Object.assign({ x, y, ang, models }, extra);
    const park = (s, chance = 1) => { if (R() < chance) c.parked.push(s); return s; };
    const fence = (style, x0, y0, x1, y1) => c.paints.push({ t: 'fence', style, x0, y0, x1, y1 });
    const fenceRect = (style, A, gap) => {
      const X0 = T(A.x) + 2, Y0 = T(A.y) + 2, X1 = T(A.x + A.w) - 2, Y1 = T(A.y + A.h) - 2;
      fence(style, X0, Y0, X1, Y0);
      fence(style, X0, Y0, X0, Y1);
      fence(style, X1, Y0, X1, Y1);
      if (gap) { const mx = (X0 + X1) / 2; fence(style, X0, Y1, mx - gap / 2, Y1); fence(style, mx + gap / 2, Y1, X1, Y1); }
      else fence(style, X0, Y1, X1, Y1);
    };

    // BSP split into building footprints (downtown offices)
    const bsp = (A) => {
      const leaves = [];
      (function split(x, y, w, h, depth) {
        const canV = w >= 10, canH = h >= 10;
        if ((!canV && !canH) || (depth > 0 && w * h <= 64 && R() < 0.35)) { leaves.push({ x, y, w, h }); return; }
        const vertical = canV && (!canH || (w > h ? true : w < h ? false : R() < 0.5));
        const len = vertical ? w : h;
        const alley = R() < 0.4 ? 2 : 0;
        const cut = 4 + Math.floor(R() * (len - 7 - alley));
        if (vertical) { split(x, y, cut, h, depth + 1); split(x + cut + alley, y, w - cut - alley, h, depth + 1); }
        else { split(x, y, w, cut, depth + 1); split(x, y + cut + alley, w, h - cut - alley, depth + 1); }
      })(A.x, A.y, A.w, A.h, 0);
      return leaves;
    };

    // parking lot: rows of 2x4 stalls with aisles
    const lotArea = (A, chance, models) => {
      fill(A, KIND.LOT, 0);
      for (let row = 0; row + 4 <= A.h; row += 9) {
        for (let i = 0; i + 2 <= A.w; i += 2) {
          for (let j = 0; j < 4; j++) setKind(A.x + i, A.y + row + j, KIND.LOT, 1);
          const s = { x: T(A.x + i + 1), y: T(A.y + row + 2), ang: R() < 0.5 ? 0 : Math.PI, stall: true, models };
          c.stalls.push(s);
          park(s, chance);
        }
      }
    };

    // house lot of size S x S facing a side ('n','s','e','w'). Local (u, v): u runs
    // along the street, v from the back fence (0) to the street (S-1).
    const houseLot = (L, S, face, rg, opts = {}) => {
      const tr = (u, v) => face === 's' ? [L.x + u, L.y + v] : face === 'n' ? [L.x + S - 1 - u, L.y + S - 1 - v]
        : face === 'e' ? [L.x + v, L.y + S - 1 - u] : [L.x + S - 1 - v, L.y + u];
      const rect = (u0, v0, du, dv) => {
        const [ax, ay] = tr(u0, v0), [bx, by] = tr(u0 + du - 1, v0 + dv - 1);
        return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax) + 1, h: Math.abs(by - ay) + 1 };
      };
      fill({ x: L.x, y: L.y, w: S, h: S }, KIND.LAWN);
      const hv = S - 6, hw = Math.min(5, S - 3);
      const H0 = rect(1, hv, hw, 4);
      const wallStyle = pick(R, ['house_white', 'house_pink', 'house_mint', 'house_yellow', 'house_blue']);
      const mat = pick(R, ['red', 'slate', 'green', 'brown', 'teal']);
      addBuilding(H0.x, H0.y, H0.w, H0.h, R() < 0.35 ? 2 : 1, wallStyle,
        { type: 'pitched', mat, ridge: face === 'n' || face === 's' ? 'h' : 'v' }, rg, { house: true });
      // driveway out to the street, with the family car on it
      const D = rect(S - 2, S - 5, 2, 5);
      fill(D, KIND.CONCRETE, 0);
      for (let k = 1; k <= 3; k++) {
        const run = face === 's' ? [[D.x, D.y + D.h - 1 + k], [D.x + 1, D.y + D.h - 1 + k]]
          : face === 'n' ? [[D.x, D.y - k], [D.x + 1, D.y - k]]
          : face === 'e' ? [[D.x + D.w - 1 + k, D.y], [D.x + D.w - 1 + k, D.y + 1]]
          : [[D.x - k, D.y], [D.x - k, D.y + 1]];
        if (run.some(([x, y]) => kindAt(x, y) === KIND.ROAD)) break;
        for (const [x, y] of run) if (kindAt(x, y) === KIND.LAWN || kindAt(x, y) === KIND.WALK) setKind(x, y, KIND.CONCRETE);
      }
      const toHouse = { s: 0, n: Math.PI, e: -Math.PI / 2, w: Math.PI / 2 }[face];
      park(spot(T(D.x + D.w / 2), T(D.y + D.h / 2), toHouse, ['hatch', 'sedan', 'suv', 'suv', 'van', 'pickup', 'muscle'], { driveway: true }), opts.carChance ?? 0.6);
      const [mx, my] = tr(S - 3, S - 1);
      addProp('mailbox', T(mx) + 8, T(my) + 8, 2);
      // back yard: a pool or a tree, and picket fences along the back and sides
      if (S >= 8 && R() < 0.35) {
        const P = rect(1, 0, 5, 2);
        c.paints.push({ t: 'pool', x: T(P.x + P.w / 2), y: T(P.y + P.h / 2), rot: face === 'e' || face === 'w' });
      } else {
        const [tx, ty] = tr(S - 2, 1); addTree(T(tx) + 8, T(ty) + 8, pick(R, ['tree_a', 'tree_a', 'tree_c']));
      }
      const pxl = (t) => T(t) + 8;
      const [ax, ay] = tr(0, 0), [bx, by] = tr(S - 1, 0), [cx2, cy2] = tr(0, S - 3), [dx, dy] = tr(S - 1, S - 3);
      fence('picket', pxl(ax), pxl(ay), pxl(bx), pxl(by));
      fence('picket', pxl(ax), pxl(ay), pxl(cx2), pxl(cy2));
      fence('picket', pxl(bx), pxl(by), pxl(dx), pxl(dy));
    };

    // ---------------------------------------------------------- generators --
    const gen = {
      // ---- downtown
      skyscraper(b) {
        const A = b.A;
        fill(A, KIND.PLAZA, 1);
        if (R() < 0.55) {
          const s = R() < 0.5 ? 8 : 10, o = Math.floor((A.w - s) / 2);
          addBuilding(A.x + o, A.y + o, s, s, 12 + Math.floor(R() * 5), pick(R, ['glass', 'glassg']), flat('glass'), b.rg, { tower: true });
          for (const [i, j] of [[1, 1], [A.w - 1, 1], [1, A.h - 1], [A.w - 1, A.h - 1]]) addTree(T(A.x + i), T(A.y + j), 'tree_b');
        } else {
          addBuilding(A.x + 1, A.y + 1, 6, 6, 10 + Math.floor(R() * 5), 'glass', flat('glass'), b.rg);
          addBuilding(A.x + A.w - 7, A.y + A.h - 7, 6, 6, 9 + Math.floor(R() * 5), 'glassg', flat('glass'), b.rg);
          addTree(T(A.x + A.w - 3.5), T(A.y + 3.5), 'tree_b'); addTree(T(A.x + 3.5), T(A.y + A.h - 3.5), 'tree_b');
        }
      },
      office(b) {
        fill(b.A, KIND.WALK);
        for (const L of bsp(b.A)) {
          if (R() < 0.9) {
            const style = pick(R, ['teal', 'rose', 'cream', 'plum', 'glassg']);
            addBuilding(L.x, L.y, L.w, L.h, 5 + Math.floor(R() * 5), style, flat(style === 'glassg' ? 'glass' : style), b.rg);
          } else {
            fill(L, KIND.PLAZA, 0); addTree(T(L.x + L.w / 2), T(L.y + L.h / 2), 'tree_c');
          }
        }
      },
      stores(b) {
        const A = b.A;
        fill(A, KIND.LOT, 0);
        const signs = ['SHOP', 'CAFE', 'BOOKS', 'PIZZA', 'MUSIC', 'NAILS', 'VIDEO', 'TOYS', 'DELI'];
        for (const y of [A.y, A.y + A.h - 5]) {
          let x = A.x;
          while (x < A.x + A.w - 2) {
            const w = Math.min(A.x + A.w - x, 3 + Math.floor(R() * 3));
            if (w < 3) break;
            const style = pick(R, ['store_a', 'store_b', 'store_c']);
            addBuilding(x, y, w, 5, 1 + (R() < 0.3 ? 1 : 0), style, flat(pick(R, ['rose', 'cream', 'teal'])), b.rg, { sign: pick(R, signs) });
            x += w;
          }
        }
        for (let i = 0; i < 3; i++) park({ x: T(A.x + 2.5 + i * 4.5), y: T(A.y + 7), ang: Math.PI / 2 * (R() < 0.5 ? 1 : -1), stall: true }, 0.6);
      },
      garage(b) {
        const A = b.A;
        fill(A, KIND.PLAZA, 0);
        addBuilding(A.x + 1, A.y + 1, 12, 12, 3 + (R() < 0.5 ? 1 : 0), 'deck', flat('deck'), b.rg, { roofCars: true, sign: 'P' });
      },
      mall(b) {
        const A = b.A;
        lotArea({ x: A.x + 28, y: A.y, w: A.w - 28, h: A.h }, 0.5);
        fill({ x: A.x, y: A.y, w: 28, h: A.h }, KIND.PLAZA, 0);
        addBuilding(A.x + 1, A.y + 1, 26, 9, 2, 'mall', flat('mall'), b.rg, { sign: 'PASTEL MALL' });
        for (let i = 2; i < 27; i += 5) addTree(T(A.x + i), T(A.y + 12), 'tree_c');
      },
      park(b, central) {
        const A = b.A;
        const mx = A.x + Math.floor(A.w / 2), my = A.y + Math.floor(A.h / 2);
        fill(A, KIND.GRASS, () => (R() < 0.08 ? 1 : 0));
        for (let y = A.y; y < A.y + A.h; y++) for (let x = A.x; x < A.x + A.w; x++) {
          if (x === mx - 1 || x === mx || y === my - 1 || y === my) setKind(x, y, KIND.PATH);
        }
        if (central || R() < 0.5) addProp('fountain', T(mx), T(my), 22, { big: true, anim: true });
        const placed = [];
        for (let y = A.y; y < A.y + A.h; y++) for (let x = A.x; x < A.x + A.w; x++) {
          if (kindAt(x, y) !== KIND.GRASS || R() > 0.3 || Math.abs(x - mx + 0.5) < 3 || Math.abs(y - my + 0.5) < 3) continue;
          const tx = T(x) + 8, ty = T(y) + 8;
          if (placed.some((p) => dist(p[0], p[1], tx, ty) < 38)) continue;
          placed.push([tx, ty]);
          if (R() < 0.7) addTree(tx, ty, R() < 0.25 ? 'tree_c' : 'tree_a');
          else addProp('shrub', tx, ty, 0, { big: true, frame: R() < 0.5 ? 0 : 1 });
        }
        for (const [i, j] of [[-4, -2], [3, -2], [-4, 1], [3, 1]]) if (R() < 0.8) addProp('bench', T(mx + i) + 8, T(my + j) + (j < 0 ? 10 : 6));
        c.crateSpots.push({ x: T(A.x + 2), y: T(A.y + 2) });
      },
      plaza(b) {
        const A = b.A;
        fill(A, KIND.PLAZA, 0);
        for (const [i, j] of [[1.5, 1.5], [A.w - 1.5, 1.5], [1.5, A.h - 1.5], [A.w - 1.5, A.h - 1.5]]) addTree(T(A.x + i), T(A.y + j), 'tree_c');
        addProp('fountain', T(A.x + A.w / 2), T(A.y + A.h / 2), 22, { big: true, anim: true });
        c.crateSpots.push({ x: T(A.x + 4), y: T(A.y + 4) });
      },

      // ---- industrial
      warehouse(b) {
        const A = b.A;
        fill(A, KIND.CONCRETE, () => (R() < 0.1 ? 1 : 0));
        const wide = A.w > 20;
        const w1 = wide ? Math.floor(A.w * 0.45) : A.w - 2;
        addBuilding(A.x + 1, A.y + 1, w1, 8, 2, pick(R, ['shed', 'shedr']), flat(pick(R, ['metal', 'rust'])), b.rg);
        if (wide) addBuilding(A.x + w1 + 3, A.y + 1, A.w - w1 - 4, 7, 2, pick(R, ['shed', 'shedr']), flat(pick(R, ['metal', 'rust'])), b.rg);
        this.yard({ x: A.x + 1, y: A.y + 10, w: A.w - 2, h: 4 });
        for (let i = 0; i < 6; i++) addProp(pick(R, ['pallet', 'barrel', 'crates']), T(A.x + 1.5 + R() * (A.w - 3)), T(A.y + 9) + 6, 5);
        fenceRect('chain', A, 64);
      },
      // a row of parked trucks along a horizontal yard strip
      yard(Y) {
        let x = T(Y.x) + 10;
        const end = T(Y.x + Y.w) - 10;
        const cy = T(Y.y + Y.h / 2);
        while (x < end) {
          const model = pick(R, ['semi', 'truck', 'flatbed', 'tanker', 'mixer', 'forklift', 'truck']);
          const len = MODELS[model].len;
          if (x + len > end) break;
          park(spot(x + len / 2, cy, Math.PI / 2, [model], { yard: true }), 0.7);
          x += len + 18;
        }
      },
      containers(b) {
        const A = b.A;
        fill(A, KIND.CONCRETE, () => (R() < 0.1 ? 1 : 0));
        const colors = ['container_red', 'container_blue', 'container_teal', 'container_yellow'];
        for (const row of [A.y + 1, A.y + 8]) {
          for (let x = A.x + 1; x + 2 <= A.x + A.w - 1; x += 3) {
            if (R() < 0.18) continue;
            addBuilding(x, row, 2, 5, R() < 0.4 ? 2 : 1, 'shed', { type: 'sprite', tag: pick(R, colors) }, b.rg, { container: true });
          }
        }
        for (let i = 0; i < 3; i++) park(spot(T(A.x + 3 + R() * (A.w - 6)), T(A.y + 7), Math.PI / 2, ['forklift']), 0.8);
        fenceRect('chain', A, 64);
      },
      tankfarm(b) {
        const A = b.A;
        fill(A, KIND.CONCRETE, 0);
        const cols = Math.max(1, Math.floor((A.w - 6) / 6));
        for (let i = 0; i < cols; i++) for (let j = 0; j < 2; j++) {
          const x = T(A.x + 3.5 + i * 6), y = T(A.y + 3.5 + j * 7);
          addTall('fueltank', x, y, 36, 21);
          if (i > 0) c.paints.push({ t: 'pipe', x0: x - T(6) + 22, y0: y, x1: x - 22, y1: y });
        }
        addBuilding(A.x + A.w - 5, A.y + 1, 4, 4, 1, 'shed', flat('metal'), b.rg);
        park(spot(T(A.x + A.w - 3), T(A.y + 10), 0, ['tanker', 'tanker', 'truck']), 0.9);
        fenceRect('chain', A, 64);
      },
      factory(b) {
        const A = b.A;
        fill(A, KIND.CONCRETE, () => (R() < 0.1 ? 1 : 0));
        addBuilding(A.x + 1, A.y + 1, A.w - 9, 9, 3, pick(R, ['brick', 'shedr']), flat('rust'), b.rg);
        for (let k = 0; k < 2; k++) addTall('smokestack', T(A.x + A.w - 4), T(A.y + 3 + k * 6), 230, 12, { smoke: true, column: 'R' });
        this.yard({ x: A.x + 1, y: A.y + 11, w: A.w - 9, h: 3 });
        for (let i = 0; i < 5; i++) addProp('barrel', T(A.x + A.w - 7 + R() * 2), T(A.y + 1 + R() * 12), 5);
        fenceRect('chain', A, 64);
      },
      depot(b) {
        const A = b.A;
        fill(A, KIND.CONCRETE, () => (R() < 0.12 ? 1 : 0));
        addBuilding(A.x + 1, A.y + 1, 5, 4, 1, 'shed', flat('metal'), b.rg);
        for (let i = 0; i < 4; i++) park(spot(T(A.x + 7.5 + i * 2.2) + 4, T(A.y + A.h / 2) + 8, 0, ['truck', 'garbage', 'mixer', 'van']), 0.7);
        fenceRect('chain', A, 48);
      },
      garagelot(b) {
        lotArea(b.A, 0);
        c.garage = { x: T(b.A.x + 7), y: T(b.A.y + 6.5) };
      },

      // ---- suburbs
      houses(b) {
        const A = b.A, S = 7;
        for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) houseLot({ x: A.x + i * S, y: A.y + j * S }, S, j === 0 ? 'n' : 's', b.rg, { carChance: 0.5 });
      },
      culdesac(b) {
        const A = b.A;
        fill(A, KIND.LAWN);
        let sides = ['s', 'n', 'e', 'w'].sort(() => R() - 0.5).slice(0, R() < 0.5 ? 1 : 2);
        if (sides.length === 2 && !((sides.includes('s') && sides.includes('n')) || (sides.includes('e') && sides.includes('w')))) sides = [sides[0]];
        const depth = sides.length === 2 ? 14 : 22, r = 5;
        const cx = A.x + A.w / 2, cy = A.y + A.h / 2;
        for (const side of sides) {
          let stem, bulb;
          if (side === 's') { bulb = { x: cx, y: A.y + A.h - depth }; stem = { x: Math.round(cx - 2), y: Math.round(bulb.y), w: 4, h: A.y + A.h + WALK - Math.round(bulb.y) }; }
          if (side === 'n') { bulb = { x: cx, y: A.y + depth }; stem = { x: Math.round(cx - 2), y: A.y - WALK, w: 4, h: Math.round(bulb.y) - A.y + WALK }; }
          if (side === 'e') { bulb = { x: A.x + A.w - depth, y: cy }; stem = { x: Math.round(bulb.x), y: Math.round(cy - 2), w: A.x + A.w + WALK - Math.round(bulb.x), h: 4 }; }
          if (side === 'w') { bulb = { x: A.x + depth, y: cy }; stem = { x: A.x - WALK, y: Math.round(cy - 2), w: Math.round(bulb.x) - A.x + WALK, h: 4 }; }
          for (let y = stem.y; y < stem.y + stem.h; y++) for (let x = stem.x; x < stem.x + stem.w; x++) { c.kind[I(x, y)] = KIND.ROAD; c.sub[I(x, y)] = 9; }
          for (let y = Math.floor(bulb.y - r - 1); y <= bulb.y + r + 1; y++) for (let x = Math.floor(bulb.x - r - 1); x <= bulb.x + r + 1; x++) {
            if (dist(x + 0.5, y + 0.5, bulb.x, bulb.y) <= r) { c.kind[I(x, y)] = KIND.ROAD; c.sub[I(x, y)] = 9; }
          }
          c.paints.push({ t: 'culdesac', stem, bulb, r });
          c.trees.push({ x: T(bulb.x), y: T(bulb.y), sprite: 'tree_a' }); addObstacle(T(bulb.x), T(bulb.y), 14);
          const vert = side === 's' || side === 'n';
          for (let k = 4; k < (vert ? stem.h : stem.w) - 4; k += 6) c.roadSpots.push(vert ? { x: T(cx), y: T(stem.y + k) } : { x: T(stem.x + k), y: T(cy) });
        }
        // house lots on an 8-tile grid, each facing its nearest street
        const S = 8;
        const around = (L, face) => {
          const mid = Math.floor(S / 2);
          for (let k = 1; k <= 3; k++) {
            const [x, y] = face === 's' ? [L.x + mid, L.y + S - 1 + k] : face === 'n' ? [L.x + mid, L.y - k] : face === 'e' ? [L.x + S - 1 + k, L.y + mid] : [L.x - k, L.y + mid];
            const kk = kindAt(x, y);
            if (kk === KIND.ROAD || kk === b.rg.ring) return k;
          }
          return 99;
        };
        for (let gy = 0; gy + S <= A.h; gy += S) for (let gx = 0; gx + S <= A.w; gx += S) {
          const L = { x: A.x + gx + (gx >= 24 ? 1 : 0), y: A.y + gy + (gy >= 24 ? 1 : 0) };
          let hit = false;
          for (let y = L.y - 1; y <= L.y + S && !hit; y++) for (let x = L.x - 1; x <= L.x + S; x++) if (kindAt(x, y) === KIND.ROAD) { hit = true; break; }
          for (let y = L.y; y < L.y + S && !hit; y++) for (let x = L.x; x < L.x + S; x++) if (kindAt(x, y) !== KIND.LAWN) { hit = true; break; }
          if (hit) continue;
          const faces = ['s', 'n', 'e', 'w'].map((f) => [around(L, f), f]).sort((a, b2) => a[0] - b2[0]);
          if (faces[0][0] < 99) houseLot(L, S, faces[0][1], b.rg);
          else addTree(T(L.x + 4), T(L.y + 4), 'tree_a');
        }
      },

      // ---- farmland
      fields(b) {
        const A = b.A;
        const sx = A.x + Math.floor(A.w * (0.4 + R() * 0.2)), sy = A.y + Math.floor(A.h * (0.4 + R() * 0.2));
        const quads = [
          { x: A.x, y: A.y, w: sx - A.x, h: sy - A.y }, { x: sx + 2, y: A.y, w: A.x + A.w - sx - 2, h: sy - A.y },
          { x: A.x, y: sy + 2, w: sx - A.x, h: A.y + A.h - sy - 2 }, { x: sx + 2, y: sy + 2, w: A.x + A.w - sx - 2, h: A.y + A.h - sy - 2 },
        ];
        for (let y = A.y - WALK; y < A.y + A.h + WALK; y++) for (let x = sx; x < sx + 2; x++) setKind(x, y, KIND.DIRT, (x + y) % 2);
        for (let x = A.x - WALK; x < A.x + A.w + WALK; x++) for (let y = sy; y < sy + 2; y++) setKind(x, y, KIND.DIRT, (x + y) % 2);
        const home = Math.floor(R() * 4);
        quads.forEach((Q, i) => {
          if (i === home) return gen.farmstead({ A: Q, rg: b.rg });
          const crop = Math.floor(R() * CROPS.length);
          fill(Q, KIND.FIELD, (x, y) => crop * 2 + (y % 2));
          const mx = T(Q.x + Q.w / 2), my = T(Q.y + Q.h / 2);
          if (CROPS[crop] === 'pasture') {
            fenceRect('wood', Q);
            for (let k = 0; k < 6; k++) addProp('cow', T(Q.x + 2 + R() * (Q.w - 4)), T(Q.y + 2 + R() * (Q.h - 4)), 6, { rot: R() * Math.PI * 2 });
            for (let k = 0; k < 3; k++) addProp('haybale', T(Q.x + 1 + R() * (Q.w - 2)), T(Q.y + 1 + R() * (Q.h - 2)), 6);
          } else if (CROPS[crop] === 'wheat') {
            park(spot(mx, my, Math.PI / 2, ['harvester']), 0.8);
          } else if (CROPS[crop] === 'soil') {
            park(spot(mx, my, R() < 0.5 ? Math.PI / 2 : -Math.PI / 2, ['tractor']), 0.8);
          }
        });
      },
      farmstead(b) {
        const A = b.A;
        fill(A, KIND.GRASS, 0);
        for (let y = A.y + 5; y < A.y + 8 && y < A.y + A.h; y++) for (let x = A.x; x < A.x + A.w; x++) setKind(x, y, KIND.DIRT, (x + y) % 2);
        addBuilding(A.x + 1, A.y + 1, 6, 4, 2, pick(R, ['house_white', 'house_yellow']), { type: 'pitched', mat: pick(R, ['red', 'brown']), ridge: 'h' }, b.rg, { house: true });
        addBuilding(A.x + 1, A.y + 8, 7, 6, 2, 'barn', { type: 'pitched', mat: 'barn', ridge: 'v' }, b.rg);
        addTall('silo', T(A.x + 10), T(A.y + 10), 110, 18, { column: 'm' });
        if (A.w >= 14) addTall('silo', T(A.x + 13), T(A.y + 11.5), 90, 18, { column: 'm' });
        addProp('haystack', T(A.x + 10), T(A.y + 2.5), 14, { big: true });
        for (let k = 0; k < 3; k++) addProp('haybale', T(A.x + 9 + k * 1.2), T(A.y + 5.5), 6);
        park(spot(T(A.x + 9.5), T(A.y + 6.5), Math.PI / 2, ['pickup', 'pickup', 'suv']), 0.9);
        park(spot(T(A.x + 4.5), T(A.y + 6.5), -Math.PI / 2, ['tractor']), 0.9);
      },
      pond(b) {
        fill(b.A, KIND.FIELD, (x, y) => 6 + (y % 2));
        for (let k = 0; k < 10; k++) {
          const a = R() * Math.PI * 2;
          addTree(T(pcx + Math.cos(a) * 7.5), T(pcy + Math.sin(a) * 7.5), pick(R, ['tree_a', 'tree_b']));
        }
        addProp('bench', T(b.A.x + 2), T(b.A.y + 1) + 8);
      },
      riverside(b) {
        const A = b.A;
        fill(A, KIND.FIELD, (x, y) => 6 + (y % 2));
        for (let k = 0; k < 14; k++) addTree(T(A.x + R() * A.w), T(A.y + R() * A.h), pick(R, ['tree_a', 'tree_a', 'tree_b']));
        for (let k = 0; k < 4; k++) {
          const x = T(A.x + R() * A.w), y = T(A.y + R() * A.h);
          if (!blocked(kindAt(Math.floor(x / TILE), Math.floor(y / TILE)))) addProp('cow', x, y, 6, { rot: R() * Math.PI * 2 });
        }
      },
      orchard(b) {
        const A = b.A;
        fill(A, KIND.GRASS, 0);
        for (let y = 1; y < A.h; y += 3) for (let x = 1; x < A.w; x += 3) addTree(T(A.x + x) + 8, T(A.y + y) + 8, (y / 3) % 2 < 1 ? 'tree_c' : 'tree_a');
      },
      town(b) {
        const A = b.A;
        fill(A, KIND.CONCRETE, () => (R() < 0.1 ? 1 : 0));
        // gas station: a canopy over the pumps plus a little shop
        addBuilding(A.x + 1, A.y + 1, 6, 4, 1, 'shed', flat('canopy'), b.rg, { overhang: true, sign: 'GAS', height: 44 });
        for (const px of [2.5, 5.5]) addProp('pump', T(A.x + px), T(A.y + 3), 5);
        addBuilding(A.x + 8, A.y + 1, 5, 4, 1, 'store_c', flat('cream'), b.rg, { sign: 'SHOP' });
        addBuilding(A.x + 1, A.y + 8, 6, 5, 1, 'store_b', flat('rose'), b.rg, { sign: 'BAR' });
        addBuilding(A.x + 8, A.y + 8, 5, 5, 1, 'store_a', flat('teal'), b.rg, { sign: 'DINER' });
        park(spot(T(A.x + 4), T(A.y + 6.5), Math.PI / 2, ['pickup', 'pickup', 'suv', 'hatch']), 0.9);
        park(spot(T(A.x + 10.5), T(A.y + 6.5), -Math.PI / 2, ['pickup', 'truck', 'sedan']), 0.7);
        addTree(T(A.x + 13.5), T(A.y + 6.5), 'tree_a');
      },
    };

    for (const b of c.blocks) {
      const g = gen[b.type];
      if (g) g.call(gen, b, b.type === 'park' && b.bx === 4 && b.by === 4);
    }

    // river banks
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const k = c.kind[I(x, y)];
      if (blocked(k) || k === KIND.WALK || k === KIND.CONCRETE || !isLandIn(x, y)) continue;
      let wet = false;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (c.kind[I(x + i, y + j)] === KIND.WATER) wet = true;
      if (wet) { c.kind[I(x, y)] = KIND.SAND; c.sub[I(x, y)] = 0; }
    }

    // --------------------------------------------------- street furniture --
    const ringKind = (x, y, rg) => kindAt(Math.floor(x / TILE), Math.floor(y / TILE)) === rg.ring;
    for (const b of c.blocks) {
      const rg = b.rg;
      const sides = [
        [b.x1 - b.x0, (i) => [T(b.x0 + i) + 8, T(b.y0) + 5], (i) => [T(b.x0 + i) + 16, T(b.y0 + 1.5)]],
        [b.x1 - b.x0, (i) => [T(b.x0 + i) + 8, T(b.y1) - 5], (i) => [T(b.x0 + i) + 16, T(b.y1 - 1.5)]],
        [b.y1 - b.y0, (i) => [T(b.x0) + 5, T(b.y0 + i) + 8], (i) => [T(b.x0 + 1.5), T(b.y0 + i) + 16]],
        [b.y1 - b.y0, (i) => [T(b.x1) - 5, T(b.y0 + i) + 8], (i) => [T(b.x1 - 1.5), T(b.y0 + i) + 16]],
      ];
      for (const [len, lampAt, treeAt] of sides) {
        if (rg.lamps) for (let i = 4; i < len - 3; i += 11) { const [x, y] = lampAt(i); if (ringKind(x, y, rg)) c.lamps.push({ x, y }); }
        if (rg.trees) for (let i = 8; i < len - 4; i += 9) { const [x, y] = treeAt(i); if (ringKind(x, y, rg) && R() < 0.55) addTree(x, y, rg.trees); }
      }
      if (rg.id === 'downtown' || rg.id === 'suburbs') {
        if (R() < 0.5) { const x = T(b.x0 + 3), y = T(b.y1) - 10; if (ringKind(x, y, rg)) addProp('hydrant', x, y, 3); }
        if (rg.id === 'downtown' && R() < 0.5) { const x = T(b.x1) - 22, y = T(b.y0 + 4); if (ringKind(x, y, rg)) addProp('bin', x, y, 4); }
      }
      if (b.bx0 === b.bx1 && b.by0 === b.by1) c.crateSpots.push({ x: T(b.x1) - 24, y: T(b.y0 + 13) });
    }

    // promenade along the sea (a beach next to the farmland)
    const lo = MARGIN - 3, hi = MARGIN + CITY.SPAN + 2;
    for (let t = lo + 4, n = 0; t < hi - 3; t += 7, n++) {
      for (const [x, y, tree] of [
        [T(t) + 8, T(lo) + 4, null], [T(t) + 8, T(hi + 1) - 4, null], [T(lo) + 4, T(t) + 8, null], [T(hi + 1) - 4, T(t) + 8, null],
        [T(t + 3.5), T(lo + 1.5), 'tree_a'], [T(t + 3.5), T(hi - 0.5), 'tree_a'], [T(lo + 1.5), T(t + 3.5), 'tree_b'], [T(hi - 0.5), T(t + 3.5), 'tree_b'],
      ]) {
        const k = kindAt(Math.floor(x / TILE), Math.floor(y / TILE));
        if (k !== KIND.WALK && k !== KIND.SAND) continue;
        if (tree) addTree(x, y, tree);
        else if (n % 2 === 0 && k === KIND.WALK) c.lamps.push({ x, y });
      }
    }

    // spawn: south sidewalk of the central downtown park, starter car at the curb,
    // and the one tank in town parked on the sidewalk next to it
    const b44 = c.blocks.find((b) => b.bx === 4 && b.by === 4);
    c.spawn = { x: T(b44.x0 + 8.5), y: T(b44.y1 - 1) + 4 };
    c.starterCar = { x: T(b44.x0 + 8.5), y: T(b44.y1) + 16, ang: -Math.PI / 2, model: 'sport' };
    c.tankSpot = { x: c.spawn.x + 100, y: T(b44.y1 - 1.5), ang: Math.PI / 2 };
    const clear = (o) => !(Math.abs(o.x - c.tankSpot.x) < 48 && Math.abs(o.y - c.tankSpot.y) < 34);
    c.trees = c.trees.filter(clear); c.lamps = c.lamps.filter(clear);
    c.props = c.props.filter(clear); c.obstacles = c.obstacles.filter(clear);

    for (const l of c.lamps) l.obstacle = addObstacle(l.x, l.y, 2, { breakable: 'lamp', lamp: l });

    // payphones: one per region, on a south sidewalk
    for (let ri = 0; ri < 4; ri++) {
      const cand = c.blocks.filter((b) => b.bx0 === b.bx1 && b.by0 === b.by1 && this.regionOfBlock(b.bx, b.by) === ri && !(b.bx === 4 && b.by === 4));
      for (const b of cand.sort(() => R() - 0.5)) {
        const p = { x: T(b.x0 + 10), y: T(b.y1 - WALK) + 8, district: REGIONS[ri].name };
        if (kindAt(Math.floor(p.x / TILE), Math.floor(p.y / TILE)) !== b.rg.ring) continue;
        c.phones.push(p); addObstacle(p.x, p.y, 7);
        break;
      }
    }

    // ------------------------------------------------ curb parking spots --
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (c.kind[I(x, y)] !== KIND.ROAD) continue;
        const r = this.roadAt(x, y);
        if (!r || (r.t !== 'v' && r.t !== 'h')) continue;
        const vx = r.t === 'v', along = r.along, across = r.across;
        if (along < 3 || along > LOT - 4) continue;
        const cx = T(x) + 8, cy = T(y) + 8;
        if ((across === 1 || across === ROAD - 2) && along % 4 === 0) c.roadSpots.push({ x: cx, y: cy });
        if ((across !== 0 && across !== ROAD - 1) || along % 4 !== 1) continue;
        const off = across === 0 ? 16 : 0;
        const s = vx ? { x: T(x) + off, y: cy + 16, ang: across === 0 ? Math.PI : 0 }
                     : { x: cx + 16, y: T(y) + off, ang: across === 0 ? -Math.PI / 2 : Math.PI / 2 };
        s.region = this.regionOfBlock(this.blockOfTile(s.x / TILE), this.blockOfTile(s.y / TILE));
        c.parkSpots.push(s);
        if (R() < REGIONS[s.region].park) c.parked.push(s);
      }
    }
    c.parked = c.parked.filter((s) => dist(s.x, s.y, c.starterCar.x, c.starterCar.y) > 70 && dist(s.x, s.y, c.tankSpot.x, c.tankSpot.y) > 70);

    // ---------------------------------------------------------- railway --
    const bandY = MARGIN + 3 * PITCH;
    c.rail = { y: T(bandY + 3), x0: T(MARGIN + 5 * PITCH + ROAD) + 20, x1: T(MARGIN + 9 * PITCH + ROAD + LOT) - 20 };
    addProp('buffer', c.rail.x0 - 12, c.rail.y, 6, { rot: -Math.PI / 2 });
    addProp('buffer', c.rail.x1 + 12, c.rail.y, 6, { rot: Math.PI / 2 });

    this.resolveFrames(c, R);
    return c;
  },

  resolveFrames(c, R) {
    const { W, H } = c;
    const A = (tag, i = 0) => Assets.frame('tiles', tag, i);
    const kindAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? KIND.WATER : c.kind[y * W + x]);
    const L = CITY.LOT;
    const promRow = (y) => y - (CITY.MARGIN + CITY.SPAN);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x, k = c.kind[i];
        let f = -1;
        const plain = () => (R() < 0.02 ? A('manhole') : A('asphalt', Math.floor(R() * 3)));
        c.solid[i] = k === KIND.BUILDING ? 1 : k === KIND.WATER ? 2 : 0;
        if (k === KIND.ROAD) {
          const r = this.roadAt(x, y);
          if (!r || c.sub[i] === 9) f = A('asphalt', Math.floor(R() * 3));
          else if (r.t === 'int') f = r.xing && (r.across === 2 || r.across === 3) ? A('rail_x_h', r.across - 2) : plain();
          else {
            const vert = r.t === 'v';
            if (r.country) f = r.across === 3 ? A(vert ? 'line_v_d' : 'line_h_d') : plain();
            else if (r.along === 0 || r.along === L - 2) f = A(vert ? 'zebra_v' : 'zebra_h', 0);
            else if (r.along === 1 || r.along === L - 1) f = A(vert ? 'zebra_v' : 'zebra_h', 1);
            else f = r.across === 3 ? A(vert ? 'line_v_c' : 'line_h_c') : plain();
          }
        } else if (k === KIND.RAIL) {
          const r = this.roadAt(x, y);
          f = r && (r.across === 2 || r.across === 3) ? A('rail_h', r.across - 2) : A('ballast');
        } else if (k === KIND.BRIDGE) {
          const r = this.roadAt(x, y);
          const across = r ? r.across : promRow(y) === 0 ? 0 : promRow(y) === 2 ? CITY.ROAD - 1 : 1;
          f = A('bridge', across === 0 ? 0 : across === CITY.ROAD - 1 ? 3 : across === 3 && r ? 2 : 1);
        } else if (k === KIND.WALK || k === KIND.BUILDING) {
          const edge = (kk) => kk === KIND.ROAD || kk === KIND.WATER || kk === KIND.RAIL || kk === KIND.BRIDGE;
          let mask = 0;
          if (edge(kindAt(x, y - 1))) mask |= 1;
          if (edge(kindAt(x + 1, y))) mask |= 2;
          if (edge(kindAt(x, y + 1))) mask |= 4;
          if (edge(kindAt(x - 1, y))) mask |= 8;
          f = A('walk', mask);
        } else if (k === KIND.GRASS) f = c.sub[i] ? A('flowers') : A('grass', Math.floor(R() * 3));
        else if (k === KIND.PATH) f = A('path', Math.floor(R() * 2));
        else if (k === KIND.PLAZA) f = A('plaza', c.sub[i]);
        else if (k === KIND.LOT) f = c.sub[i] ? A('lot_line') : A('lot');
        else if (k === KIND.FIELD) f = A(CROPS[c.sub[i] >> 1], c.sub[i] & 1);
        else if (k === KIND.DIRT) f = A('dirt', c.sub[i] & 1);
        else if (k === KIND.VERGE) f = A('verge', Math.floor(R() * 2));
        else if (k === KIND.LAWN) f = A('lawn');
        else if (k === KIND.CONCRETE) f = A('concrete', c.sub[i] & 1);
        else if (k === KIND.SAND) f = A('sand', Math.floor(R() * 2));
        c.frame[i] = f;
      }
    }
  },
};
