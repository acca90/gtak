'use strict';
// World v2 generator: a 768x768-tile mainland with three cities, an industrial zone,
// three farm districts, an airport, a bay crossed by a long suspension bridge, and
// seeded nature (forest, meadows, desert, lakes, a river, beaches and islands).
//
//   Major City (NW)    downtown core + suburb ring, Central Park, police, stadium
//   Side City (E)      downtown core + suburb ring, PCTV tower, beach, marina
//   Main City (SW)     downtown core + suburb ring, Union Station, hospital, port
//   Ironworks (centre) long industrial blocks, freight yard, boost garage
//   North / West / South-East Farms   big rural lots on dirt roads
//   Pastel Airport     between West Farms and Main City
//
// Every district with streets is a *grid* (origin, block pitch, block kinds). Grids,
// highways and the railway are stamped into per-tile network arrays, and roadAt()
// reads them back: it stays the single source of truth for road, rail and crossing
// tiles. Road bands are 9 tiles wide; their look comes from the segment's profile:
//   avenue (downtown) · street (suburbs) · rough (industrial) · dirt (rural) · highway
// See docs/geography.md for the full map (regenerate its numbers with tools/geo-report.js).

const CITY = { W: 768, H: 768, ROAD: 9, PITCH: 29, LOT: 20, WALK: 3, NB: 7 };

const KIND = {
  WATER: 0, ROAD: 1, WALK: 2, GRASS: 3, PATH: 4, PLAZA: 5, LOT: 6, BUILDING: 7,
  RAIL: 8, BRIDGE: 9, FIELD: 10, DIRT: 11, VERGE: 12, LAWN: 13, CONCRETE: 14, SAND: 15,
  FOREST: 16, MEADOW: 17, DESERT: 18, DUNE: 19, ROCK: 20, PIER: 21, BOARDWALK: 22, QUAY: 23,
  PLATFORM: 24, RUNWAY: 25, TAXIWAY: 26, APRON: 27,
};
// minimap colours, one per kind
const KIND_COLOR = {
  [KIND.WATER]: PAL.w, [KIND.ROAD]: PAL.d, [KIND.WALK]: PAL.t, [KIND.GRASS]: PAL.G,
  [KIND.PATH]: PAL.o, [KIND.PLAZA]: PAL.p, [KIND.LOT]: PAL.b, [KIND.BUILDING]: PAL.l,
  [KIND.RAIL]: PAL.n, [KIND.BRIDGE]: PAL.O, [KIND.FIELD]: PAL.L, [KIND.DIRT]: PAL.o,
  [KIND.VERGE]: PAL.h, [KIND.LAWN]: PAL.h, [KIND.CONCRETE]: PAL.l, [KIND.SAND]: PAL.T,
  [KIND.FOREST]: PAL.g, [KIND.MEADOW]: PAL.H, [KIND.DESERT]: PAL.Y, [KIND.DUNE]: PAL.c,
  [KIND.ROCK]: PAL.m, [KIND.PIER]: PAL.N, [KIND.BOARDWALK]: PAL.o, [KIND.QUAY]: PAL.l,
  [KIND.PLATFORM]: PAL.x, [KIND.RUNWAY]: PAL.k, [KIND.TAXIWAY]: PAL.a, [KIND.APRON]: PAL.x,
};
const CROPS = ['wheat', 'corn', 'soil', 'pasture'];

// road profiles, ranked: an intersection takes the biggest profile that meets there
const PROFILES = ['', 'dirt', 'street', 'rough', 'highway', 'avenue', 'court'];
const RANK = { dirt: 1, street: 2, rough: 3, highway: 4, avenue: 5, court: 0 };

// Area types. regionAt() returns one of these (named after the district) for vehicle
// mixes; `park` = chance a curb spot starts with a parked car, `lit` = window lights.
const ZONES = {
  wild: { id: 'wild', lit: 0.3, park: 0.02,
    models: { pickup: 12, suv: 12, hatch: 5, sedan: 5, van: 3, muscle: 3 } },
  downtown: { id: 'downtown', lit: 0.6, park: 0.4,
    models: { sedan: 20, taxi: 16, sport: 8, police: 5, police_suv: 3, hatch: 12, suv: 10, muscle: 4, van: 4, truck: 2, bus: 3 } },
  suburbs: { id: 'suburbs', lit: 0.45, park: 0.18,
    models: { hatch: 18, sedan: 18, suv: 18, van: 8, pickup: 8, muscle: 4, sport: 3, police: 2 } },
  industrial: { id: 'industrial', lit: 0.35, park: 0.25,
    models: { truck: 16, semi: 10, tanker: 6, flatbed: 8, mixer: 5, garbage: 4, van: 8, pickup: 8, sedan: 4 } },
  rural: { id: 'rural', lit: 0.35, park: 0.05,
    models: { pickup: 20, tractor: 10, truck: 6, flatbed: 6, suv: 6, hatch: 4, sedan: 4, van: 3 } },
  highway: { id: 'highway', lit: 0.3, park: 0,
    models: { sedan: 14, suv: 10, hatch: 8, sport: 5, muscle: 4, truck: 6, semi: 4, tanker: 2, van: 5, pickup: 5, bus: 2, police: 2 } },
  airport: { id: 'airport', lit: 0.5, park: 0.3,
    models: { taxi: 16, sedan: 10, van: 10, suv: 6, hatch: 6, truck: 3 } },
};
// Traffic per zone (spec docs/specs/traffic-v1.md B.2): density = cars alive per 100 road
// tiles inside the AOV, models = the mix (weights). Lanes carry their zone (City.buildLanes).
{
  const TRAFFIC = {
    downtown: [5.0, { sedan: 20, taxi: 18, hatch: 12, suv: 10, bus: 8, van: 6, sport: 4, muscle: 3, ambulance: 3, truck: 2 }],
    suburbs: [0.5, { hatch: 25, sedan: 25, suv: 20, pickup: 8, muscle: 4, sport: 3 }],
    industrial: [1.2, { truck: 16, semi: 12, flatbed: 8, tanker: 6, mixer: 6, garbage: 5, van: 6, pickup: 5 }],
    rural: [0.4, { pickup: 14, tractor: 12, truck: 8, flatbed: 6, harvester: 3, suv: 4, hatch: 3, sedan: 3 }],
    highway: [1.2, { sedan: 14, suv: 10, hatch: 8, truck: 8, semi: 6, tanker: 3, bus: 2, sport: 5, muscle: 4, van: 5 }],
    airport: [2.5, { taxi: 16, sedan: 10, van: 10, bus: 4, suv: 6 }],
    wild: [0.3, { pickup: 12, suv: 12, hatch: 5, sedan: 5, van: 3 }],
  };
  for (const z in TRAFFIC) ZONES[z].traffic = { density: TRAFFIC[z][0], models: TRAFFIC[z][1] };
  // Pedestrians per zone (spec docs/specs/peds-v1.md §2.1): density = peds alive per 100 tiles
  // of walk graph inside the AOV; mix = personality shares; armed = share of the violent ones
  // carrying a pistol / an uzi. Highways and the wild have no sidewalks: density 0.
  // Densities raised 2026-09-27 after screenshots (downtown read empty).
  // cops = the share of the peds budget that are foot cops (spec docs/specs/cops-v1.md §2;
  // the 30% near the police station is applied by src/peds.js around c.policeStation).
  const PEDS = {
    downtown: [16, [0.5, 0.35, 0.15], [0.2, 0.05], 0.06],
    suburbs: [2.5, [0.65, 0.25, 0.1], [0.15, 0.02], 0.03],
    industrial: [3, [0.35, 0.3, 0.35], [0.3, 0.08], 0.04],
    rural: [1.5, [0.5, 0.25, 0.25], [0.25, 0.03], 0.02],
    airport: [6, [0.6, 0.3, 0.1], [0.1, 0], 0.08],
    highway: [0, [0.65, 0.25, 0.1], [0, 0], 0],
    wild: [0, [0.65, 0.25, 0.1], [0, 0], 0],
  };
  for (const z in PEDS) {
    const [density, [scared, angry, violent], [pistol, uzi], cops] = PEDS[z];
    ZONES[z].peds = { density, mix: { scared, angry, violent }, armed: { pistol, uzi }, cops };
  }
}
const ZONE_LIST = Object.values(ZONES);
const REGIONS = ZONE_LIST;                        // legacy name: the vehicle-mix table
const PROFILE_ZONE = { avenue: 'downtown', street: 'suburbs', court: 'suburbs', rough: 'industrial', dirt: 'rural', highway: 'highway' };
const BLOCK_ZONE = { downtown: 'downtown', suburb: 'suburbs', industrial: 'industrial', rural: 'rural' };
const BLOCK_PROFILE = { downtown: 'avenue', suburb: 'street', industrial: 'rough', rural: 'dirt' };

// street name roots (drawn without replacement so every full name is unique)
const NAMES = {
  city: ['Rose', 'Lilac', 'Peach', 'Mint', 'Coral', 'Lavender', 'Magnolia', 'Juniper', 'Cherry', 'Plum',
    'Apricot', 'Honey', 'Pearl', 'Opal', 'Jade', 'Sage', 'Willow', 'Maple', 'Cedar', 'Birch', 'Aspen',
    'Hazel', 'Violet', 'Iris', 'Daisy', 'Tulip', 'Poppy', 'Heather', 'Primrose', 'Marigold', 'Orchid',
    'Camellia', 'Azalea', 'Jasmine', 'Laurel', 'Myrtle', 'Olive', 'Saffron', 'Vanilla', 'Melon', 'Sorbet',
    'Pistachio', 'Lemon', 'Tangerine', 'Indigo', 'Ivory', 'Sunset', 'Dawn', 'Seashell', 'Bluebell',
    'Buttercup', 'Clementine', 'Fern', 'Gardenia', 'Hyacinth', 'Lotus', 'Mulberry', 'Nectar', 'Pebble',
    'Quartz', 'Ruby', 'Sapphire', 'Topaz', 'Amethyst', 'Sunflower', 'Periwinkle', 'Cobalt', 'Blossom',
    'Meringue', 'Macaron', 'Candy', 'Bubblegum', 'Marshmallow', 'Caramel', 'Cocoa', 'Almond', 'Walnut',
    'Chestnut', 'Acorn', 'Starling', 'Robin', 'Swallow', 'Finch', 'Wren', 'Lark', 'Dove', 'Kingfisher',
    'Oriole', 'Canary', 'Flamingo', 'Seagull', 'Sandpiper', 'Tide', 'Breeze', 'Rainbow', 'Cloud',
    'Moonbeam', 'Starlight', 'Aurora', 'Comet', 'Twilight', 'Velvet', 'Satin', 'Silk', 'Linen', 'Cotton',
    'Ribbon', 'Lace', 'Button', 'Crystal', 'Silver', 'Golden', 'Copper', 'Sherbet', 'Toffee', 'Nutmeg',
    'Ginger', 'Cinnamon', 'Lychee', 'Mango', 'Papaya', 'Guava', 'Kiwi', 'Fig', 'Quince', 'Damson',
    'Bramblewood', 'Glade', 'Meadow', 'Brook', 'Spring', 'Summer', 'Autumn', 'Winter', 'Harmony', 'Melody'],
  industrial: ['Anvil', 'Bolt', 'Rivet', 'Forge', 'Crane', 'Piston', 'Gasket', 'Foundry', 'Smelter', 'Cinder',
    'Slag', 'Girder', 'Welder', 'Boiler', 'Kiln', 'Ingot', 'Cog', 'Sprocket', 'Pylon', 'Furnace', 'Turbine',
    'Valve', 'Lathe', 'Hopper'],
  rural: ['Haystack', 'Barley', 'Oat', 'Rye', 'Orchard', 'Meadowlark', 'Windmill', 'Silo', 'Harvest', 'Furrow',
    'Paddock', 'Pumpkin', 'Gooseberry', 'Thistle', 'Clover', 'Sheepfold', 'Millstone', 'Cornflower', 'Hayloft',
    'Beehive', 'Apple', 'Pear', 'Bramble', 'Hedgerow', 'Scarecrow', 'Wagon', 'Plough', 'Dairy', 'Buckwheat',
    'Alfalfa', 'Sorghum', 'Turnip'],
};

// gun stores (spec docs/specs/weapons-v2.md §4): id = index; `goto=Gun Store <id + 1>`
const GUN_STORES = [
  { name: 'PASTEL ARMS', area: 'MAJOR CITY' },       // strip across the road from the spawn
  { name: 'SEABREEZE AMMO', area: 'SIDE CITY' },     // downtown shopping row
  { name: 'UNION FIREARMS', area: 'MAIN CITY' },     // suburban corner shops by Mercy Hill
  { name: 'ANVIL SURPLUS', area: 'IRONWORKS' },      // army surplus at a warehouse gate
  { name: 'DUSTY BARREL', area: 'ROUTE 6' },         // roadside store by the South-East Farms
];

// car paint shops (spec docs/specs/paintshop-v1.md): id = index; `goto=Paint Shop <id + 1>`
const PAINT_SHOPS = [
  { name: 'CANDY COAT', area: 'MAJOR CITY' },        // suburban corner shops, the car park's far end
  { name: 'SPRAY SHACK', area: 'SIDE CITY' },
  { name: 'PASTEL PAINT & BODY', area: 'MAIN CITY' },
  { name: 'IRON COAT', area: 'IRONWORKS' },          // in a warehouse yard, a gate cut in the fence
];

const City = {
  // area / address lookups (filled by build)
  map: null,
  net: null,

  regionAt(x, y) {
    const m = this.map;
    if (!m) return ZONES.wild;
    const tx = clamp(Math.floor(x / TILE), 0, m.W - 1), ty = clamp(Math.floor(y / TILE), 0, m.H - 1);
    const i = ty * m.W + tx;
    const d = m.dist[i], z = m.zone[i];
    const key = d * 16 + z;
    let o = m.regionCache.get(key);
    if (!o) {
      const zz = ZONE_LIST[z];
      o = Object.assign({}, zz, { zone: zz.id, name: (m.districts[d] || {}).name || 'PASTEL SEA', district: (m.districts[d] || {}).name });
      m.regionCache.set(key, o);
    }
    return o;
  },

  // { district, neighborhood, street } for a world position (px)
  placeAt(x, y) {
    const m = this.map;
    if (!m) return { district: '', neighborhood: '', street: '' };
    const tx = clamp(Math.floor(x / TILE), 0, m.W - 1), ty = clamp(Math.floor(y / TILE), 0, m.H - 1);
    const i = ty * m.W + tx;
    const h = m.hoods[m.hood[i] - 1], s = m.street[i];
    return { district: h ? h.district : '', neighborhood: h ? h.name : '', street: s ? m.streets[s - 1].name : '' };
  },

  // What the network puts on tile (x, y); null = not a road, rail or crossing.
  //   { t: 'v' | 'h' | 'int' | 'rail', profile, across, along, len, ax, ay, street, xing, rail, gg }
  // 'v'/'h': a straight band (across 0..8 left→right / top→bottom, along from its start);
  // 'int': an intersection box (ax, ay inside it); xing: a railway crosses this road tile.
  roadAt(x, y) {
    const n = this.net;
    if (!n || x < 0 || y < 0 || x >= n.W || y >= n.H) return null;
    const i = y * n.W + x;
    const b = n.box[i], v = n.v[i], h = n.h[i], rl = n.rail[i];
    let r = null;
    if (b) {
      const B = n.recs[b - 1];
      r = { t: 'int', profile: B.profile, ax: x - B.x, ay: y - B.y, street: B.street, rec: B };
    } else if (v && h) {
      const V = n.recs[v - 1], Hh = n.recs[h - 1];
      const p = RANK[V.profile] >= RANK[Hh.profile] ? V : Hh;
      r = { t: 'int', profile: p.profile, ax: x - V.x, ay: y - Hh.y, street: p.street, rec: p, gg: V.gg || Hh.gg };
    } else if (v || h) {
      const S = n.recs[(v || h) - 1];
      const vert = S.axis === 'v';
      r = { t: vert ? 'v' : 'h', profile: S.profile, across: vert ? x - S.x : y - S.y, along: vert ? y - S.y : x - S.x,
        len: S.len, street: S.street, rec: S, gg: S.gg };
    }
    if (rl) {
      if (r) { r.xing = true; r.rail = rl - 1; } else r = { t: 'rail', across: rl - 1, axis: n.railAxis };
    }
    return r;
  },

  build(seed) {
    const R = rng(seed);
    const { W, H, ROAD } = CITY;
    // optional phase timing (tools/geo-report.js sets City.timing = {})
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    let tMark = now();
    const mark = (name) => { if (this.timing) { const t = now(); this.timing[name] = (this.timing[name] || 0) + t - tMark; tMark = t; } };
    const N = W * H;
    const T = (t) => t * TILE;
    const c = {
      W, H, seed,
      kind: new Uint8Array(N), sub: new Uint8Array(N), frame: new Int16Array(N).fill(-1), solid: new Uint8Array(N),
      buildings: [], trees: [], lamps: [], props: [], obstacles: [], phones: [], talls: [], paints: [],
      sprites: [], trafficLights: [], cables: [], gunshops: [], paintshops: [], pens: [], walkLines: [],
      parkSpots: [], stalls: [], roadSpots: [], crateSpots: [], parked: [], blocks: [],
      districts: [], neighborhoods: [], streets: [], places: {}, landmarks: [], grids: [],
      garage: null, spawn: null, starterCar: null, tankSpot: null, rail: null,
    };
    const I = (x, y) => y * W + x;
    const inW = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    const kindAt = (x, y) => (inW(x, y) ? c.kind[I(x, y)] : KIND.WATER);
    const net = { W, H, v: new Int32Array(N), h: new Int32Array(N), box: new Int32Array(N), rail: new Uint8Array(N), recs: [], railAxis: 'v' };
    this.net = net;
    const claimed = new Uint8Array(N);     // lots, roads, landmarks: nature stays out
    const zone = new Uint8Array(N);        // index into ZONE_LIST
    const ZI = Object.fromEntries(ZONE_LIST.map((z, i) => [z.id, i]));
    const streetMap = new Uint16Array(N);  // street id + 1

    // ------------------------------------------------------------------ noise --
    const sN = [...Array(10)].map(() => (R() * 65536) | 0);
    // value noise on a seeded 256x256 lattice (fast table lookups, wraps every 256 cells)
    const LAT = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) LAT[i] = R();
    const hash2 = (ix, iy, s) => LAT[((ix + s * 31) & 255) | (((iy + s * 17) & 255) << 8)];
    const vnoise = (x, y, s) => {
      const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
      const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), d = hash2(ix, iy + 1, s), e = hash2(ix + 1, iy + 1, s);
      return a + (b - a) * u + (d - a) * v + (a - b - d + e) * u * v;
    };
    const fbm = (x, y, s) => vnoise(x, y, s) * 0.57 + vnoise(x * 2.03, y * 2.03, s + 17) * 0.29 + vnoise(x * 4.1, y * 4.1, s + 31) * 0.14;
    const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

    // =================================================================== LAYOUT ==
    // grids: cities are 7x7 blocks (3x3 downtown core, suburb ring, corners left wild)
    const cityKind = (bx, by) => {
      if ((bx === 0 || bx === 6) && (by === 0 || by === 6)) return null;
      return bx >= 2 && bx <= 4 && by >= 2 && by <= 4 ? 'downtown' : 'suburb';
    };
    const G = {
      major: { key: 'major', name: 'Major City', kind: 'city', ox: 150, oy: 69, nx: 7, ny: 7, pitch: 29, kindOf: cityKind },
      side: { key: 'side', name: 'Side City', kind: 'city', ox: 505, oy: 214, nx: 7, ny: 7, pitch: 29, kindOf: cityKind },
      main: { key: 'main', name: 'Main City', kind: 'city', ox: 179, oy: 484, nx: 7, ny: 7, pitch: 29, kindOf: cityKind },
      iron: { key: 'iron', name: 'Ironworks', kind: 'industrial', ox: 237, oy: 301, nx: 6, ny: 5, pitch: 29, kindOf: () => 'industrial' },
      north: { key: 'north', name: 'North Farms', kind: 'rural', ox: 534, oy: 30, nx: 3, ny: 3, pitch: 40, kindOf: () => 'rural' },
      west: { key: 'west', name: 'West Farms', kind: 'rural', ox: 24, oy: 345, nx: 3, ny: 3, pitch: 40, kindOf: () => 'rural' },
      south: { key: 'south', name: 'South-East Farms', kind: 'rural', ox: 494, oy: 480, nx: 3, ny: 3, pitch: 40, kindOf: () => 'rural' },
    };
    const GRIDS = [G.major, G.side, G.main, G.iron, G.north, G.west, G.south];
    for (const g of GRIDS) {
      g.lot = g.pitch - ROAD;
      g.w = g.nx * g.pitch + ROAD; g.h = g.ny * g.pitch + ROAD;
      g.rect = { x: g.ox, y: g.oy, w: g.w, h: g.h };
    }
    const AIRPORT = { x: 30, y: 495, w: 147, h: 231 };
    const PORT = { x: 186, y: 696, w: 199, h: 43 };
    const BEACH = { x: 717, y: 200, w: 51, h: 232 };
    const MARINA = { x: 717, y: 432, w: 51, h: 66 };
    const BRIDGE_Y = 243, BAY_W = 366, BAY_E = 500;          // long bridge band and its shores
    const TOWERS = [BAY_W + 38, BAY_E - 38];
    const RAIL_X = 283;                                        // railway band x .. x+3 (rails at +1, +2)
    const RAIL_Y0 = 372, RAIL_Y1 = 567;                        // freight yard buffer .. station buffer
    const LAKES = [
      { name: 'Mirror Lake', x: 80, y: 170, r: 16 },
      { name: 'Willow Lake', x: 195, y: 440, r: 10 },
      { name: 'Heron Lake', x: 455, y: 448, r: 13 },
      { name: 'Oasis Pool', x: 700, y: 700, r: 6 },
    ];
    const ISLANDS = [
      { name: 'Gull Island', x: 440, y: 110, r: 12, bay: true },
      { name: 'Pine Island', x: 30, y: 30, r: 11 },
      { name: 'Seal Rocks', x: 742, y: 36, r: 9, rocky: true },
      { name: 'Pelican Isle', x: 26, y: 744, r: 10 },
      { name: 'Coral Key', x: 744, y: 744, r: 10 },
    ];
    const riverX = (y) => 447 + 9 * Math.sin((y - 450) / 37) + 4 * Math.sin((y - 450) / 13 + 1);
    const riverHalf = (y) => 2.4 + Math.max(0, y - 450) / 110;

    // ================================================================ TERRAIN ==
    const land = new Uint8Array(N);
    const boxSd = (x, y, m) => {
      const r = 100, half = W / 2 - m - r;
      const qx = Math.abs(x + 0.5 - W / 2) - half, qy = Math.abs(y + 0.5 - H / 2) - half;
      const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0;
      return Math.sqrt(ox * ox + oy * oy) + Math.min(qx > qy ? qx : qy, 0) - r;
    };
    const riverMask = new Uint8Array(N);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // rounded-box distance with the coast inset m = 12..46 from noise; the noise is
        // only sampled where it can change the answer
        const mid = boxSd(x, y, 36);
        land[I(x, y)] = mid < -32 ? 1 : mid > 32 ? 0
          : boxSd(x, y, 6 + fbm(x / 58, y / 58, sN[0]) * 56 + (vnoise(x / 11, y / 11, sN[0] + 3) - 0.5) * 8) < 0 ? 1 : 0;
      }
    }
    mark('coast');
    // districts always sit on land, with a noisy margin so the coast stays natural
    const keep = GRIDS.map((g) => g.rect).concat([AIRPORT, { x: 150, y: 0, w: 220, h: 70 }]);
    for (const K of keep) {
      for (let y = Math.max(0, K.y - 14); y < Math.min(H, K.y + K.h + 14); y++) {
        for (let x = Math.max(0, K.x - 14); x < Math.min(W, K.x + K.w + 14); x++) {
          const dx = Math.max(K.x - x, 0, x - (K.x + K.w - 1)), dy = Math.max(K.y - y, 0, y - (K.y + K.h - 1));
          const d = dx + dy === 0 ? 0 : Math.hypot(dx, dy);
          if (d <= 5 || (d <= 14 && d <= 5 + fbm(x / 9, y / 9, sN[1]) * 9)) land[I(x, y)] = 1;
        }
      }
    }
    mark('keepland');
    // the bay: a sea inlet from the north coast, straight-shored where the bridge crosses
    for (let y = 0; y <= 298; y++) {
      const wN = clamp(Math.abs(y - BRIDGE_Y - 4) / 28 - 0.25, 0, 1);
      let xw = BAY_W + wN * ((fbm(y / 22, 1.5, sN[2]) - 0.5) * 26 + (y < 60 ? -14 : 5));
      let xe = BAY_E + wN * ((fbm(y / 22, 7.5, sN[2]) - 0.5) * 26 + 10);
      if (y >= 56) xw = Math.max(BAY_W, xw);
      xe = Math.min(y < 205 ? 526 : BAY_E, xe);
      if (y > 272) { const t = (y - 272) / 26; xw += t * t * 52; xe -= t * t * 34; }
      for (let x = Math.round(xw); x < Math.round(xe); x++) land[I(x, y)] = 0;
    }
    // Side City's east coast: a straight-ish beach line
    for (let y = 196; y < 452; y++) {
      const cx = 738 + Math.round((fbm(y / 12, 3.3, sN[3]) - 0.5) * 5);
      for (let x = 712; x < W; x++) land[I(x, y)] = x < cx ? 1 : 0;
    }
    // marina cove
    for (let y = 440; y < 510; y++) for (let x = 700; x < W; x++) {
      const e = ((x - 744) / 26) ** 2 + ((y - 474) / 22) ** 2;
      if (e < 1 + (fbm(x / 6, y / 6, sN[4]) - 0.5) * 0.3) land[I(x, y)] = 0;
      else if (y < 452 && x >= 717) land[I(x, y)] = x < 738 || y >= 449 ? 1 : 0;
    }
    // port: yard + quay (y < 716), a 15-tile harbour basin (y 716-730) the container ship
    // moors in, and the mole (breakwater quay, y 731-738) that shelters it
    for (let y = PORT.y; y < H; y++) for (let x = PORT.x; x < PORT.x + PORT.w; x++) {
      let l = 1;
      if (y >= 716 && y < 731) l = x < 205 ? 1 : 0;
      else if (y >= 731 && y < 739) l = x <= 380 ? 1 : 0;
      else if (y >= 739) l = 0;
      if (y >= 716 && x > 380) l = 0;
      land[I(x, y)] = l;
    }
    for (const is of ISLANDS) {
      for (let y = is.y - is.r - 4; y <= is.y + is.r + 4; y++) for (let x = is.x - is.r - 4; x <= is.x + is.r + 4; x++) {
        if (!inW(x, y)) continue;
        const a = Math.atan2(y - is.y, x - is.x);
        if (dist(x + 0.5, y + 0.5, is.x, is.y) < is.r * (0.8 + 0.35 * fbm(Math.cos(a) * 2 + is.x, Math.sin(a) * 2, sN[5]))) land[I(x, y)] = 1;
      }
    }
    for (const L of LAKES) {
      for (let y = L.y - L.r - 4; y <= L.y + L.r + 4; y++) for (let x = L.x - L.r - 4; x <= L.x + L.r + 4; x++) {
        const a = Math.atan2(y - L.y, x - L.x);
        if (dist(x + 0.5, y + 0.5, L.x, L.y) < L.r * (0.8 + 0.35 * fbm(Math.cos(a) * 2 + L.x, Math.sin(a) * 2, sN[6]))) land[I(x, y)] = 0;
      }
    }
    // Lilac River: from Heron Lake south to the sea, between Main City and the SE farms
    for (let y = 452; y < H; y++) {
      const xc = riverX(y), hw = riverHalf(y);
      for (let x = Math.floor(xc - hw); x <= Math.ceil(xc + hw); x++) {
        if (Math.abs(x + 0.5 - xc) <= hw) { land[I(x, y)] = 0; riverMask[I(x, y)] = 1; }
      }
    }
    mark('water');
    // sea = water connected to the world border (the bay and the river mouth included)
    const isSea = new Uint8Array(N);
    {
      const q = new Int32Array(N);
      let qh = 0, qt = 0;
      const push = (i) => { if (!land[i] && !isSea[i]) { isSea[i] = 1; q[qt++] = i; } };
      for (let x = 0; x < W; x++) { push(I(x, 0)); push(I(x, H - 1)); }
      for (let y = 0; y < H; y++) { push(I(0, y)); push(I(W - 1, y)); }
      while (qh < qt) {
        const i = q[qh++], x = i % W, y = (i - x) / W;
        if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < H - 1) push(i + W);
      }
    }
    mark('seafill');
    // base terrain: desert in the south-east, forests and meadows elsewhere
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = I(x, y);
        if (!land[i]) { c.kind[i] = KIND.WATER; continue; }
        const sd0 = smooth01((x - 560) / 120) * smooth01((y - 515) / 120);
        const des = sd0 > 0.04 ? sd0 + (fbm(x / 19, y / 19, sN[7]) - 0.5) * 0.95 : 0;
        let k;
        if (des > 0.5) {
          k = fbm(x / 7, y / 7, sN[8]) > 0.66 ? KIND.DUNE : fbm(x / 11, y / 11, sN[9]) > 0.7 ? KIND.ROCK : KIND.DESERT;
        } else {
          let bias = 0;
          if (x < 150 && y < 345) bias += 0.12;
          if (x > 650 && y < 200) bias += 0.1;
          if (x > 150 && x < 240 && y > 280 && y < 490) bias -= 0.08;
          const f = vnoise(x / 30, y / 30, sN[3] + 5) * 0.62 + vnoise(x / 14, y / 14, sN[3] + 9) * 0.38 + bias;
          k = f > 0.56 ? KIND.FOREST : f < 0.32 ? KIND.GRASS : KIND.MEADOW;
        }
        c.kind[i] = k;
        c.sub[i] = 0;
      }
    }

    mark('terrain');
    // ============================================================== HELPERS ==
    const isTerrain = (k) => k === KIND.FOREST || k === KIND.MEADOW || k === KIND.GRASS || k === KIND.DESERT || k === KIND.DUNE || k === KIND.ROCK || k === KIND.SAND;
    const setKind = (x, y, k, sub = 0) => {
      if (!inW(x, y)) return;
      const i = I(x, y), cur = c.kind[i];
      if (cur === KIND.WATER || cur === KIND.BRIDGE || net.rail[i]) return;   // never build over water or track
      c.kind[i] = k; c.sub[i] = sub;
    };
    const fill = (A, k, sub = 0) => {
      for (let y = A.y; y < A.y + A.h; y++) for (let x = A.x; x < A.x + A.w; x++) setKind(x, y, k, typeof sub === 'function' ? sub(x, y) : sub);
    };
    const claim = (A, z) => {
      for (let y = Math.max(0, A.y); y < Math.min(H, A.y + A.h); y++) for (let x = Math.max(0, A.x); x < Math.min(W, A.x + A.w); x++) {
        claimed[I(x, y)] = 1;
        if (z !== undefined) zone[I(x, y)] = ZI[z];
      }
    };
    const BLOCKED = new Uint8Array(32);
    for (const k of ['WATER', 'ROAD', 'BRIDGE', 'BUILDING', 'RAIL', 'SAND', 'DIRT', 'PIER', 'BOARDWALK', 'QUAY', 'PLATFORM', 'RUNWAY', 'TAXIWAY', 'APRON']) BLOCKED[KIND[k]] = 1;
    const blocked = (k) => BLOCKED[k] === 1;
    const areaOpen = (x, y, w, h) => {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (blocked(kindAt(i, j))) return false;
      return true;
    };
    const addObstacle = (x, y, r, extra) => { const o = Object.assign({ x, y, r }, extra); c.obstacles.push(o); return o; };
    const addTree = (x, y, sprite, force) => {
      if (!force && blocked(kindAt(Math.floor(x / TILE), Math.floor(y / TILE)))) return;
      c.trees.push({ x, y, sprite }); addObstacle(x, y, 5);
    };
    const BREAKABLE = new Set(['hydrant', 'bin', 'parking_meter', 'ticket_machine', 'sign_parking', 'sign_noparking', 'sign_speed', 'stop_sign', 'cactus', 'mailbox']);
    const addProp = (sprite, x, y, r, extra) => {
      const p = Object.assign({ sprite, x, y }, extra);
      c.props.push(p);
      if (r) p.obstacle = addObstacle(x, y, r, BREAKABLE.has(sprite) ? { breakable: sprite, prop: p } : null);
      return p;
    };
    const addTall = (sprite, x, y, h, r, extra) => { c.talls.push(Object.assign({ sprite, x, y, h, r }, extra)); addObstacle(x, y, r); };
    // wall: facade style; roof: { type: 'flat', style } | { type: 'pitched', mat, ridge } | { type: 'sprite', tag } | { type: 'stadium' }
    const addBuilding = (tx, ty, tw, th, floors, wall, roof, rg, extra = {}) => {
      if (tw < 2 || th < 2) return null;
      if (!extra.force && !areaOpen(tx, ty, tw, th)) return null;
      delete extra.force;
      // an oval building (the stadium) only claims the tiles whose centre is inside its outer wall
      // (Render.stadiumGeom: 3 px in from the footprint); those keep the plaza paving underneath
      const ra = T(tw) / 2 - 3, rb = T(th) / 2 - 3;
      const inside = (x, y) => !extra.oval || ((T(x - tx) + 8 - T(tw) / 2) / ra) ** 2 + ((T(y - ty) + 8 - T(th) / 2) / rb) ** 2 <= 1;
      if (!extra.overhang) for (let y = ty; y < ty + th; y++) for (let x = tx; x < tx + tw; x++) if (inside(x, y)) {
        if (extra.oval) c.sub[I(x, y)] = 0x80 | (c.kind[I(x, y)] === KIND.PLAZA ? c.sub[I(x, y)] & 1 : 0);
        c.kind[I(x, y)] = KIND.BUILDING; c.solid[I(x, y)] = 1;
      }
      const b = Object.assign({
        tx, ty, tw, th, x: T(tx), y: T(ty), w: T(tw), h: T(th),
        floors, height: floors * 32, wall, roof, lit: rg.lit, seed: (R() * 1e9) | 0,
      }, extra);
      c.buildings.push(b);
      return b;
    };
    const flat = (style) => ({ type: 'flat', style });
    // a gun store (1-2 floors) whose door opens on side `face` ('n','s','e','w'); the door
    // mat is the tile just outside that side, centred on it (on the sidewalk in blocks)
    const gunStore = (i, tx, ty, tw, th, face, rg) => {
      const bl = addBuilding(tx, ty, tw, th, i % 2 ? 2 : 1, 'gunshop', flat('gunshop'), rg, { sign: 'GUNS', gunshop: i });
      if (!bl) return null;
      const ang = { n: 0, e: Math.PI / 2, s: Math.PI, w: -Math.PI / 2 }[face];
      const x = face === 'e' ? T(tx + tw) + 8 : face === 'w' ? T(tx) - 8 : T(tx + tw / 2);
      const y = face === 's' ? T(ty + th) + 8 : face === 'n' ? T(ty) - 8 : T(ty + th / 2);
      c.gunshops.push(Object.assign({ id: i }, GUN_STORES[i], { x, y, ang, b: bl }));
      // the glowing mat points into the store; a floor decal (not solid, not breakable)
      c.sprites.push({ sheet: 'props', tag: 'gunshop_door', x, y, ang: ang + Math.PI, h: 0, shadow: false, anim: 1.5, gunshop: i });
      return bl;
    };
    // parked helicopters: on a building's roof helipad (alt = building height), or on a
    // ground helipad marking (alt 0) where the player can walk up and board
    const heliSpots = [];
    const roofHeli = (b, chance = 1) => {
      if (!b || R() >= chance) return;
      const s = { x: b.x + (Math.floor(b.tw / 2) - 1) * 16 + 24, y: b.y + (Math.floor(b.th / 2) - 1) * 16 + 24, ang: R() * Math.PI * 2, models: ['helicopter'], alt: b.height, roof: true };
      heliSpots.push(s);
    };
    const groundPad = (tx, ty, name) => {
      for (let y = Math.floor(ty) - 1; y <= Math.floor(ty) + 1; y++) for (let x = Math.floor(tx) - 1; x <= Math.floor(tx) + 1; x++) setKind(x, y, KIND.CONCRETE, 0);
      addProp('helipad', T(tx), T(ty), 0, { big: true });
      const s = { x: T(tx), y: T(ty), ang: R() * 0.6 - 0.3, models: ['helicopter'], alt: 0, pad: name };
      heliSpots.push(s);
      return s;
    };
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
    // a cow pen (spec peds-v1 §4): the herd's rect in px, inside the fence with a margin.
    // `spots` = where the old cow props stood (the same RNG draws, so nothing after moves)
    const pen = (x0, y0, x1, y1, n, draw) => {
      const p = { id: c.pens.length, x0, y0, x1, y1, cows: n, spots: [] };
      for (let k = 0; k < n; k++) { const [x, y, ang] = draw(); p.spots.push({ x: clamp(x, x0, x1), y: clamp(y, y0, y1), ang }); }
      c.pens.push(p);
      return p;
    };
    // pedestrian ground outside the block rings (px lines, axis-aligned; City.buildWalks)
    const walkLine = (x0, y0, x1, y1, extra) => c.walkLines.push(Object.assign({ x0, y0, x1, y1 }, extra));
    const weighted = (w) => {
      let r = R() * Object.values(w).reduce((a, b) => a + b, 0);
      for (const k in w) { r -= w[k]; if (r <= 0) return k; }
      return Object.keys(w)[0];
    };
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const pools = { city: shuffle(NAMES.city.slice()), industrial: shuffle(NAMES.industrial.slice()), rural: shuffle(NAMES.rural.slice()) };
    const takeName = (pool) => pools[pool].pop() || ('No. ' + (c.streets.length + 1));
    const place = (name, x, y) => { c.places[name] = { x: Math.round(x), y: Math.round(y) }; };

    // ============================================================== NETWORK ==
    const addStreet = (name, profile, district, from, to, width = ROAD) => {
      const s = { id: c.streets.length, name, profile, district, from, to, width };
      c.streets.push(s);
      return s.id;
    };
    // stamp a straight band: axis 'v' (x = left edge, y = top, len down) or 'h'
    const stampRun = (axis, x, y, len, profile, street, extra) => {
      const rec = Object.assign({ axis, x, y, len, profile, street }, extra);
      const id = net.recs.push(rec);
      const arr = axis === 'v' ? net.v : net.h;
      for (let a = 0; a < ROAD; a++) for (let l = 0; l < len; l++) {
        const tx = axis === 'v' ? x + a : x + l, ty = axis === 'v' ? y + l : y + a;
        if (inW(tx, ty)) arr[I(tx, ty)] = id;
      }
      return rec;
    };
    const stampBox = (x, y, profile, street, extra) => {
      const rec = Object.assign({ axis: 'x', x, y, w: ROAD, h: ROAD, profile, street }, extra);
      const id = net.recs.push(rec);
      for (let j = 0; j < ROAD; j++) for (let i = 0; i < ROAD; i++) if (inW(x + i, y + j)) net.box[I(x + i, y + j)] = id;
      return rec;
    };

    // ------------------------------------------------------------- grids --
    // Each grid: block kinds, merges (plan), then per-segment profiles.
    const gridBlocks = (g) => {
      g.owner = new Int32Array(g.nx * g.ny).fill(-1);
      g.blocks = [];
      g.merge = (bx0, by0, bx1, by1, type, kind) => {
        for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
          if (g.owner[by * g.nx + bx] >= 0 || !g.kindOf(bx, by)) return null;
        }
        const b = { grid: g, bx0, by0, bx1, by1, bx: bx0, by: by0, type, kind: kind || g.kindOf(bx0, by0) };
        const idx = g.blocks.push(b) - 1;
        for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) g.owner[by * g.nx + bx] = idx;
        return b;
      };
      g.free = (bx, by) => bx >= 0 && by >= 0 && bx < g.nx && by < g.ny && g.owner[by * g.nx + bx] < 0 && !!g.kindOf(bx, by);
    };
    const ownerAt = (g, bx, by) => (bx < 0 || by < 0 || bx >= g.nx || by >= g.ny ? -1 : g.owner[by * g.nx + bx]);

    // ---- plans: landmarks first, then merges, then single blocks
    const suburbSingles = (g, w) => {
      for (let by = 0; by < g.ny; by++) for (let bx = 0; bx < g.nx; bx++) {
        if (!g.free(bx, by)) continue;
        const k = g.kindOf(bx, by);
        if (k === 'downtown') g.merge(bx, by, bx, by, weighted({ skyscraper: 0.3, office: 0.3, stores: 0.15, garage: 0.08, park: 0.07, plaza: 0.1 }));
        else if (k === 'suburb') g.merge(bx, by, bx, by, weighted(w || { houses: 0.72, park: 0.1, shops: 0.18 }));
      }
    };
    const ringCuldesacs = (g, n) => {
      const cand = shuffle([[0, 1], [1, 0], [2, 0], [3, 0], [4, 0], [5, 1], [5, 3], [0, 3], [1, 5], [2, 5], [3, 5], [4, 5], [0, 4], [5, 4]]);
      let made = 0;
      for (const [bx, by] of cand) {
        if (made >= n) break;
        const ok = [[0, 0], [1, 0], [0, 1], [1, 1]].every(([i, j]) => g.free(bx + i, by + j) && g.kindOf(bx + i, by + j) === 'suburb');
        if (ok) { g.merge(bx, by, bx + 1, by + 1, 'culdesac'); made++; }
      }
    };
    // Major City: Central Park (2x2 in the core), police, stadium (2x2 in the east ring)
    gridBlocks(G.major);
    G.major.merge(2, 3, 3, 4, 'centralpark');
    G.major.merge(4, 4, 4, 4, 'police');
    G.major.merge(5, 2, 6, 3, 'stadium');
    G.major.merge(2, 2, 3, 2, 'mall');
    ringCuldesacs(G.major, 3);
    suburbSingles(G.major);
    // Side City: PCTV campus (2x1 core), beach and marina outside the grid
    gridBlocks(G.side);
    G.side.merge(3, 3, 4, 3, 'tvhq');
    G.side.merge(2, 4, 2, 4, 'park');
    ringCuldesacs(G.side, 3);
    suburbSingles(G.side);
    // Main City: Union Station (2x3 on the rail line), hospital (2x1)
    gridBlocks(G.main);
    G.main.merge(2, 0, 3, 2, 'station', 'downtown');
    G.main.merge(4, 3, 5, 3, 'hospital', 'downtown');
    G.main.merge(3, 4, 3, 4, 'park');
    ringCuldesacs(G.main, 3);
    suburbSingles(G.main);
    // gun stores: a strip facing the spawn across the road (Major), a downtown shopping row
    // (Side), corner shops by the hospital (Main); Ironworks' is set below
    const gunBlock = (g, bx, by, type, i) => {
      const b = g.blocks[ownerAt(g, bx, by)];
      if (b && b.bx0 === b.bx1 && b.by0 === b.by1) { b.type = type; b.gunshop = i; }
    };
    gunBlock(G.major, 2, 5, 'shops', 0);
    gunBlock(G.side, 4, 4, 'stores', 1);
    gunBlock(G.main, 5, 2, 'shops', 2);
    // Ironworks: long blocks, the freight yard on the railway, the boost garage by the bay
    gridBlocks(G.iron);
    {
      const g = G.iron, ind = ['warehouse', 'containers', 'tankfarm', 'factory', 'warehouse', 'depot'];
      g.merge(0, 2, 1, 4, 'freightyard');
      g.merge(5, 0, 5, 0, 'garagelot');
      g.merge(0, 0, 1, 0, 'warehouse');
      g.merge(0, 1, 1, 1, 'tankfarm');
      g.merge(2, 0, 3, 0, 'factory');
      g.merge(4, 0, 4, 0, 'containers');
      for (let by = 1; by < g.ny; by++) for (const bx of [2, 4]) g.merge(bx, by, bx + 1, by, pick(R, ind));
      const gb = g.blocks[ownerAt(g, 2, 3)];
      gb.type = 'warehouse'; gb.gunshop = 3;       // on Route 4's line, facing north
    }
    // farms: every big lot is fields; one farm town (gas, diner) and one orchard each
    for (const g of [G.north, G.west, G.south]) {
      gridBlocks(g);
      const cells = shuffle([...Array(9)].map((_, i) => [i % 3, Math.floor(i / 3)]));
      g.merge(cells[0][0], cells[0][1], cells[0][0], cells[0][1], 'farmtown');
      g.merge(cells[1][0], cells[1][1], cells[1][0], cells[1][1], 'orchard');
      g.merge(cells[2][0], cells[2][1], cells[2][0], cells[2][1], 'pasture');
      for (let by = 0; by < 3; by++) for (let bx = 0; bx < 3; bx++) if (g.free(bx, by)) g.merge(bx, by, bx, by, 'fields');
    }

    // ---- segments, boxes and street names per grid line
    const lineName = (g, profile) => {
      if (profile === 'avenue') return takeName('city') + ' Avenue';
      if (profile === 'street') return takeName('city') + ' ' + pick(R, ['Street', 'Street', 'Lane', 'Drive']);
      if (profile === 'rough') return takeName('industrial') + ' ' + pick(R, ['Road', 'Way']);
      return takeName('rural') + ' ' + pick(R, ['Track', 'Road', 'Track']);
    };
    for (const g of GRIDS) {
      const { nx, ny, ox, oy, pitch, lot } = g;
      const bk = (idx) => (idx < 0 ? null : g.blocks[idx].kind);
      const segProfile = (a, b) => {
        if (a === b) return null;
        const ka = bk(a), kb = bk(b);
        const pa = ka ? BLOCK_PROFILE[ka] : null, pb = kb ? BLOCK_PROFILE[kb] : null;
        if (!pa) return pb; if (!pb) return pa;
        return RANK[pa] >= RANK[pb] ? pa : pb;
      };
      g.vseg = []; g.hseg = [];
      for (let i = 0; i <= nx; i++) { g.vseg[i] = []; for (let j = 0; j < ny; j++) g.vseg[i][j] = segProfile(ownerAt(g, i - 1, j), ownerAt(g, i, j)); }
      for (let j = 0; j <= ny; j++) { g.hseg[j] = []; for (let i = 0; i < nx; i++) g.hseg[j][i] = segProfile(ownerAt(g, i, j - 1), ownerAt(g, i, j)); }
      // one street per line, named after its biggest profile
      g.vstreet = []; g.hstreet = [];
      const mkLine = (segs, axis, k) => {
        const idx = segs.map((p, n) => (p ? n : -1)).filter((n) => n >= 0);
        if (!idx.length) return -1;
        const prof = segs.filter(Boolean).reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
        const lo = idx[0], hi = idx[idx.length - 1];
        const c0 = axis === 'v' ? ox + k * pitch + 4 : oy + k * pitch + 4;
        const a0 = (axis === 'v' ? oy : ox) + lo * pitch, a1 = (axis === 'v' ? oy : ox) + (hi + 1) * pitch + ROAD - 1;
        const from = axis === 'v' ? { x: c0, y: a0 } : { x: a0, y: c0 }, to = axis === 'v' ? { x: c0, y: a1 } : { x: a1, y: c0 };
        return addStreet(lineName(g, prof), prof, g.name, from, to);
      };
      for (let i = 0; i <= nx; i++) g.vstreet[i] = mkLine(g.vseg[i], 'v', i);
      for (let j = 0; j <= ny; j++) g.hstreet[j] = mkLine(g.hseg[j], 'h', j);
      for (let i = 0; i <= nx; i++) for (let j = 0; j < ny; j++) {
        const p = g.vseg[i][j];
        if (p) stampRun('v', ox + i * pitch, oy + ROAD + j * pitch, lot, p, g.vstreet[i], { grid: g, gi: i, gj: j });
      }
      for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) {
        const p = g.hseg[j][i];
        if (p) stampRun('h', ox + ROAD + i * pitch, oy + j * pitch, lot, p, g.hstreet[j], { grid: g, gi: i, gj: j });
      }
      g.boxes = [];
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
        const up = j > 0 ? g.vseg[i][j - 1] : null, down = j < ny ? g.vseg[i][j] : null;
        const left = i > 0 ? g.hseg[j][i - 1] : null, right = i < nx ? g.hseg[j][i] : null;
        const arms = [up, down, left, right].filter(Boolean);
        if (!arms.length) continue;
        const prof = arms.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
        const vp = up || down, hp = left || right;
        const st = vp && (!hp || RANK[vp] >= RANK[hp]) ? g.vstreet[i] : g.hstreet[j];
        g.boxes.push(stampBox(ox + i * pitch, oy + j * pitch, prof, st, { grid: g, gi: i, gj: j, arms: arms.length, up: !!up, down: !!down, left: !!left, right: !!right }));
      }
    }

    c.grids = GRIDS.map((g) => ({ name: g.name, kind: g.kind, ox: g.ox, oy: g.oy, w: g.w, h: g.h, nx: g.nx, ny: g.ny, pitch: g.pitch, lot: g.lot, blocks: g.blocks,
      profiles: [...new Set(g.vseg.flat().concat(g.hseg.flat()).filter(Boolean))].join(', ') }));

    // ------------------------------------------------------------ highways --
    const hw = (name) => addStreet(name, 'highway', 'Highways', null, null);
    const runH = (y, x0, x1, sid, extra) => stampRun('h', x0, y, x1 - x0, 'highway', sid, extra);
    const runV = (x, y0, y1, sid, extra) => stampRun('v', x, y0, y1 - y0, 'highway', sid, extra);
    const HW = {};
    HW.r1 = hw('Route 1');
    HW.gate = addStreet('Pastel Gate Bridge', 'highway', 'Pastel Bay', { x: BAY_W, y: BRIDGE_Y + 4 }, { x: BAY_E - 1, y: BRIDGE_Y + 4 });
    runH(BRIDGE_Y, G.major.ox + G.major.w, BAY_W, HW.r1);
    const gateRec = runH(BRIDGE_Y, BAY_W, BAY_E, HW.gate, { gg: true });
    runH(BRIDGE_Y, BAY_E, G.side.ox, HW.r1);
    HW.r2 = hw('Route 2'); runV(295, G.major.oy + G.major.h, G.iron.oy, HW.r2);
    HW.r3 = hw('Route 3'); runV(353, G.iron.oy + G.iron.h, G.main.oy, HW.r3);
    HW.r4 = hw('Route 4'); runH(388, G.iron.ox + G.iron.w, G.side.ox, HW.r4);
    HW.r5 = hw('Airport Expressway'); runH(629, 153, G.main.ox, HW.r5);
    HW.air = hw('Airport Road');
    runV(144, G.west.oy + G.west.h, 629, HW.air); stampBox(144, 629, 'highway', HW.air, { arms: 2 });
    HW.r6 = hw('Route 6'); runH(600, G.main.ox + G.main.w, G.south.ox, HW.r6);
    HW.r7 = hw('Route 7'); runV(534, G.side.oy + G.side.h, G.south.oy, HW.r7);
    HW.r8 = hw('Route 8');
    runH(BRIDGE_Y, 73, G.major.ox, HW.r8); stampBox(64, BRIDGE_Y, 'highway', HW.r8, { arms: 2 }); runV(64, BRIDGE_Y + ROAD, G.west.oy, HW.r8);
    HW.r9 = hw('Route 9'); runV(534, G.north.oy + G.north.h, G.side.oy, HW.r9);
    // Marina Drive: a suburb street from Side City's east edge down to the marina
    const marinaSt = addStreet('Marina Drive', 'street', 'Side City', { x: 721, y: 392 }, { x: 730, y: 431 });
    stampRun('h', 717, 388, 9, 'street', marinaSt);
    stampBox(726, 388, 'street', marinaSt, { arms: 2 });
    stampRun('v', 726, 397, 35, 'street', marinaSt);
    // fill the highways' from/to from their runs
    for (const rec of net.recs) {
      const s = c.streets[rec.street];
      if (!s || s.from) continue;
      const pts = [];
      for (const r2 of net.recs) {
        if (r2.street !== s.id) continue;
        if (r2.axis === 'v') pts.push({ x: r2.x + 4, y: r2.y }, { x: r2.x + 4, y: r2.y + r2.len - 1 });
        else if (r2.axis === 'h') pts.push({ x: r2.x, y: r2.y + 4 }, { x: r2.x + r2.len - 1, y: r2.y + 4 });
        else pts.push({ x: r2.x + 4, y: r2.y + 4 });
      }
      s.from = pts[0]; s.to = pts[pts.length - 1];
    }

    // -------------------------------------------------------------- railway --
    for (let y = RAIL_Y0; y <= RAIL_Y1; y++) for (let a = 0; a < 4; a++) net.rail[I(RAIL_X + a, y)] = a + 1;

    mark('network');
    // ----------------------------------------------- road tiles → kinds --
    const cornerZone = (a) => a <= 1 || a >= 7;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = I(x, y);
        if (!net.v[i] && !net.h[i] && !net.box[i] && !net.rail[i]) continue;
        const r = this.roadAt(x, y);
        claimed[i] = 1;
        if (r.t === 'rail') { c.kind[i] = land[i] ? KIND.RAIL : KIND.BRIDGE; continue; }
        let k = KIND.ROAD;
        const p = r.profile;
        if (r.t === 'int') {
          const corner = cornerZone(r.ax) && cornerZone(r.ay);
          if (p === 'street') k = corner ? KIND.VERGE : KIND.ROAD;
          else if (p === 'dirt') k = corner ? KIND.MEADOW : KIND.DIRT;
        } else {
          if (p === 'street') k = cornerZone(r.across) ? KIND.VERGE : KIND.ROAD;
          else if (p === 'dirt') k = cornerZone(r.across) ? KIND.MEADOW : KIND.DIRT;
        }
        if (!land[i]) k = KIND.BRIDGE;
        c.kind[i] = k; c.sub[i] = 0;
        zone[i] = ZI[PROFILE_ZONE[p]];
        if (r.street >= 0) streetMap[i] = r.street + 1;
      }
    }
    mark('roadkinds');
    // keep nature a tile away from every road band
    for (const rec of net.recs) {
      const w = rec.axis === 'v' ? ROAD : rec.axis === 'h' ? rec.len : rec.w;
      const h = rec.axis === 'v' ? rec.len : rec.axis === 'h' ? ROAD : rec.h;
      claim({ x: rec.x - 1, y: rec.y - 1, w: w + 2, h: h + 2 });
    }
    claim({ x: RAIL_X - 2, y: RAIL_Y0 - 2, w: 8, h: RAIL_Y1 - RAIL_Y0 + 5 });

    mark('claim');
    // ================================================================ BLOCKS ==
    const RING = { downtown: 3, suburb: 2, industrial: 2, rural: 0 };
    const INNER = { downtown: KIND.GRASS, suburb: KIND.LAWN, industrial: KIND.CONCRETE, rural: KIND.FIELD };
    for (const g of GRIDS) {
      for (const b of g.blocks) {
        const x0 = g.ox + ROAD + b.bx0 * g.pitch, y0 = g.oy + ROAD + b.by0 * g.pitch;
        const x1 = g.ox + ROAD + b.bx1 * g.pitch + g.lot, y1 = g.oy + ROAD + b.by1 * g.pitch + g.lot;
        const ring = RING[b.kind];
        Object.assign(b, { x0, y0, x1, y1, ring, ringKind: KIND.WALK, zone: BLOCK_ZONE[b.kind], rg: ZONES[BLOCK_ZONE[b.kind]],
          A: { x: x0 + ring, y: y0 + ring, w: x1 - x0 - 2 * ring, h: y1 - y0 - 2 * ring } });
        claim({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, b.zone);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const i = I(x, y);
          if (net.rail[i]) continue;
          const onRing = x < x0 + ring || y < y0 + ring || x >= x1 - ring || y >= y1 - ring;
          c.kind[i] = onRing ? KIND.WALK : INNER[b.kind];
          c.sub[i] = b.kind === 'rural' ? 6 + (y & 1) : 0;
          if (!land[i]) c.kind[i] = KIND.WATER;
        }
        c.blocks.push(b);
      }
    }

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
      const hv = S - 6, hw2 = Math.min(5, S - 3);
      const H0 = rect(1, hv, hw2, 4);
      const wallStyle = pick(R, ['house_white', 'house_pink', 'house_mint', 'house_yellow', 'house_blue']);
      const mat = pick(R, ['red', 'slate', 'green', 'brown', 'teal']);
      addBuilding(H0.x, H0.y, H0.w, H0.h, R() < 0.35 ? 2 : 1, wallStyle,
        { type: 'pitched', mat, ridge: face === 'n' || face === 's' ? 'h' : 'v' }, rg, { house: true });
      // driveway out to the street (over the sidewalk and verge), with the family car on it
      const D = rect(S - 2, S - 5, 2, 5);
      fill(D, KIND.CONCRETE, 0);
      for (let k = 1; k <= 5; k++) {
        const run = face === 's' ? [[D.x, D.y + D.h - 1 + k], [D.x + 1, D.y + D.h - 1 + k]]
          : face === 'n' ? [[D.x, D.y - k], [D.x + 1, D.y - k]]
          : face === 'e' ? [[D.x + D.w - 1 + k, D.y], [D.x + D.w - 1 + k, D.y + 1]]
          : [[D.x - k, D.y], [D.x - k, D.y + 1]];
        if (run.some(([x, y]) => kindAt(x, y) === KIND.ROAD)) break;
        for (const [x, y] of run) { const kk = kindAt(x, y); if (kk === KIND.LAWN || kk === KIND.WALK || kk === KIND.VERGE) setKind(x, y, KIND.CONCRETE); }
      }
      const toHouse = { s: 0, n: Math.PI, e: -Math.PI / 2, w: Math.PI / 2 }[face];
      park(spot(T(D.x + D.w / 2), T(D.y + D.h / 2), toHouse, ['hatch', 'sedan', 'suv', 'suv', 'van', 'pickup', 'muscle'], { driveway: true }), opts.carChance ?? 0.6);
      const [mx, my] = tr(S - 3, S - 1);
      addProp('mailbox', T(mx) + 8, T(my) + 8, 2);
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
    // a thick line of `k` tiles (paths)
    const stroke = (x0, y0, x1, y1, w, k, sub = 0) => {
      const n = Math.max(1, Math.ceil(dist(x0, y0, x1, y1) * 2));
      for (let s = 0; s <= n; s++) {
        const x = lerp(x0, x1, s / n), y = lerp(y0, y1, s / n);
        for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
          const tx = Math.floor(x - w / 2 + i + 0.5), ty = Math.floor(y - w / 2 + j + 0.5);
          if (kindAt(tx, ty) !== KIND.WATER) setKind(tx, ty, k, sub);
        }
      }
    };
    const landmark = (name, x, y, info) => { c.landmarks.push(Object.assign({ name, x: Math.round(x), y: Math.round(y) }, info)); };

    // ------------------------------------------------------------- generators --
    const gen = {
      // ---- downtown
      skyscraper(b) {
        const A = b.A;
        fill(A, KIND.PLAZA, 1);
        if (R() < 0.55) {
          const s = R() < 0.5 ? 8 : 10, o = Math.floor((A.w - s) / 2);
          roofHeli(addBuilding(A.x + o, A.y + o, s, s, 12 + Math.floor(R() * 5), pick(R, ['glass', 'glassg']), flat('glass'), b.rg, { tower: true }), 0.5);
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
          // the gun store opens the north row, its door on the sidewalk
          if (b.gunshop !== undefined && y === A.y && gunStore(b.gunshop, x, y, 8, 5, 'n', b.rg)) x += 8;
          while (x < A.x + A.w - 2) {
            const w = Math.min(A.x + A.w - x, 3 + Math.floor(R() * 3));
            if (w < 3) break;
            const style = pick(R, ['store_a', 'store_b', 'store_c']);
            addBuilding(x, y, w, 5, 1 + (R() < 0.3 ? 1 : 0), style, flat(pick(R, ['rose', 'cream', 'teal'])), b.rg, { sign: pick(R, signs) });
            x += w;
          }
        }
        for (let i = 0; i < 3; i++) park({ x: T(A.x + 2.5 + i * 4.5), y: T(A.y + A.h / 2), ang: Math.PI / 2 * (R() < 0.5 ? 1 : -1), stall: true }, 0.6);
      },
      // suburban corner shops: a short row of stores and a car park
      shops(b) {
        const A = b.A;
        fill(A, KIND.LOT, 0);
        let x = A.x + 1;
        // the gun store sits flush on the sidewalk so its door mat is on it
        if (b.gunshop !== undefined && gunStore(b.gunshop, x, A.y, 8, 5, 'n', b.rg)) x += 9;
        while (x < A.x + A.w - 3) {
          const w = Math.min(A.x + A.w - 1 - x, 3 + Math.floor(R() * 3));
          if (w < 3) break;
          addBuilding(x, A.y + 1, w, 5, 1, pick(R, ['store_a', 'store_b', 'store_c']), flat(pick(R, ['rose', 'cream', 'teal', 'mint'])), b.rg,
            { sign: pick(R, ['DELI', 'CAFE', 'VIDEO', 'SHOP', 'BAKERY', 'LAUNDRY', 'PETS', 'FLOWERS']) });
          x += w;
        }
        lotArea({ x: A.x + 1, y: A.y + 8, w: A.w - 2, h: 4 }, 0.5);
        addTree(T(A.x + 1), T(A.y + A.h - 1), 'tree_a'); addTree(T(A.x + A.w - 1), T(A.y + A.h - 1), 'tree_c');
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
      park(b) {
        const A = b.A;
        const mx = A.x + Math.floor(A.w / 2), my = A.y + Math.floor(A.h / 2);
        fill(A, KIND.GRASS, () => (R() < 0.08 ? 1 : 0));
        for (let y = A.y; y < A.y + A.h; y++) for (let x = A.x; x < A.x + A.w; x++) {
          if (x === mx - 1 || x === mx || y === my - 1 || y === my) setKind(x, y, KIND.PATH);
        }
        if (R() < 0.6) addProp('fountain', T(mx), T(my), 22, { big: true, anim: true });
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
        // a walk around the fountain, with four spokes out to the sidewalk ring
        const cx = T(A.x + A.w / 2), cy = T(A.y + A.h / 2), h = 56, ry0 = T(b.y0) + b.ring * 8, ry1 = T(b.y1) - b.ring * 8;
        const rx0 = T(b.x0) + b.ring * 8, rx1 = T(b.x1) - b.ring * 8;
        walkLine(cx - h, cy - h, cx + h, cy - h); walkLine(cx - h, cy + h, cx + h, cy + h);
        walkLine(cx - h, cy - h, cx - h, cy + h); walkLine(cx + h, cy - h, cx + h, cy + h);
        walkLine(cx - 24, ry0, cx - 24, cy - h); walkLine(cx - 24, cy + h, cx - 24, ry1);      // clear of the payphone and ticket machines
        walkLine(rx0, cy, cx - h, cy); walkLine(cx + h, cy, rx1, cy);
      },

      // ---- landmarks inside grids
      centralpark(b) {
        const A = b.A;
        fill(A, KIND.GRASS, () => (R() < 0.07 ? 1 : 0));
        const cx = A.x + A.w / 2, cy = A.y + A.h / 2;
        // the lake, north-east of the centre
        const lx = cx + 9, ly = cy - 8;
        for (let y = A.y; y < A.y + A.h; y++) for (let x = A.x; x < A.x + A.w; x++) {
          const a = Math.atan2(y - ly, x - lx);
          const e = ((x + 0.5 - lx) / 9) ** 2 + ((y + 0.5 - ly) / 6.5) ** 2;
          if (e < 0.85 + 0.25 * Math.sin(a * 3 + 1)) c.kind[I(x, y)] = KIND.WATER;
        }
        // a winding loop path and four entrance paths
        let prev = null;
        for (let s = 0; s <= 96; s++) {
          const a = (s / 96) * Math.PI * 2;
          const r = 15 + 2.2 * Math.sin(a * 3) + 1.2 * Math.sin(a * 5 + 1);
          const p = [cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.92];
          if (prev) stroke(prev[0], prev[1], p[0], p[1], 2, KIND.PATH);
          prev = p;
        }
        stroke(cx, A.y - 1, cx + 1.5, cy - 14, 2, KIND.PATH);
        stroke(cx - 1, A.y + A.h, cx - 2, cy + 14, 2, KIND.PATH);
        stroke(A.x - 1, cy + 1, cx - 15, cy + 2, 2, KIND.PATH);
        stroke(A.x + A.w, cy + 3, cx + 15, cy + 2, 2, KIND.PATH);
        stroke(cx - 11, cy + 9, cx - 2, cy + 1, 2, KIND.PATH);
        stroke(A.x + 2, A.y + 2, cx - 10, cy - 10, 2, KIND.PATH);
        // central plaza with the big fountain, a second one at the south gate
        for (let y = Math.floor(cy - 4); y <= cy + 4; y++) for (let x = Math.floor(cx - 4); x <= cx + 4; x++) {
          if (dist(x + 0.5, y + 0.5, cx, cy) < 3.6 && kindAt(x, y) !== KIND.WATER) setKind(x, y, KIND.PLAZA, 0);
        }
        addProp('fountain', T(cx), T(cy), 22, { big: true, anim: true });
        addProp('fountain', T(cx - 1.5), T(A.y + A.h - 4), 22, { big: true, anim: true });
        for (let y = A.y + A.h - 7; y < A.y + A.h - 1; y++) for (let x = Math.floor(cx - 5); x < cx + 2; x++) setKind(x, y, KIND.PLAZA, 1);
        // dense trees away from the paths, lake and plazas
        const near = (x, y, k) => { for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (kindAt(x + i, y + j) === k) return true; return false; };
        for (let gy = A.y + 0.8; gy < A.y + A.h - 0.5; gy += 2.3) for (let gx = A.x + 0.8; gx < A.x + A.w - 0.5; gx += 2.3) {
          const x = gx + (R() - 0.5) * 1.2, y = gy + (R() - 0.5) * 1.2;
          const tx = Math.floor(x), ty = Math.floor(y);
          if (kindAt(tx, ty) !== KIND.GRASS || near(tx, ty, KIND.PATH) || near(tx, ty, KIND.WATER) || near(tx, ty, KIND.PLAZA)) continue;
          if (R() < 0.62) addTree(T(x), T(y), weighted({ tree_a: 0.45, tree_c: 0.25, pine: 0.3 }));
          else if (R() < 0.2) addProp('shrub', T(x), T(y), 0, { big: true, frame: R() < 0.5 ? 0 : 1 });
        }
        // benches along the loop
        for (let s = 0; s < 96; s += 9) {
          const a = (s / 96) * Math.PI * 2, r = 15 + 2.2 * Math.sin(a * 3) + 1.2 * Math.sin(a * 5 + 1) + 1.7;
          const x = Math.floor(cx + Math.cos(a) * r), y = Math.floor(cy + Math.sin(a) * r * 0.92);
          if (kindAt(x, y) === KIND.GRASS) addProp('bench', T(x) + 8, T(y) + 8);
        }
        for (let s = 4; s < 96; s += 12) {
          const a = (s / 96) * Math.PI * 2, r = 15 + 2.2 * Math.sin(a * 3) + 1.2 * Math.sin(a * 5 + 1) - 1.6;
          const x = Math.floor(cx + Math.cos(a) * r), y = Math.floor(cy + Math.sin(a) * r * 0.92);
          if (kindAt(x, y) === KIND.GRASS) c.lamps.push({ x: T(x) + 8, y: T(y) + 8 });
        }
        c.crateSpots.push({ x: T(A.x + 3), y: T(A.y + A.h - 3) });
        landmark('Central Park', T(cx), T(cy), { kind: 'park', rect: { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 }, what: 'lake, winding loop path, two fountains, dense trees, benches' });
        b.spawnPark = true;
      },
      police(b) {
        const A = b.A;
        fill(A, KIND.CONCRETE, 0);
        const bl = addBuilding(A.x + 1, A.y + 1, 12, 9, 3, 'police', flat('police'), b.rg, { sign: 'POLICE', tower: true });
        roofHeli(bl);
        fill({ x: A.x, y: A.y + 10, w: A.w, h: 4 }, KIND.LOT, 0);
        for (let i = 0; i < 4; i++) {
          const s = spot(T(A.x + 2 + i * 3.4), T(A.y + 12), Math.PI / 2, ['police', 'police', 'police_suv'], { stall: true });
          c.stalls.push(s); park(s, 0.95);
        }
        fenceRect('chain', { x: A.x, y: A.y + 10, w: A.w, h: 4 }, 48);
        // cops' hotspot (spec cops-v1 §2): the front door, on the north sidewalk's inner edge
        c.policeStation = { x: T(A.x + 7), y: T(A.y) - 8 };
        landmark('Police Station', T(A.x + 7), T(A.y + 5.5), { kind: 'building', rect: { x: bl.tx, y: bl.ty, w: bl.tw, h: bl.th }, what: '12x9 building, 3 floors, wall police, roof police + helipad, POLICE sign, fenced yard with police cars' });
      },
      // Beira-Rio style: the bowl on a wide paved esplanade (oval bands of paving, trees,
      // benches, lamps), car parks north and south, the helipad in the NW corner. The
      // floodlights are built into the roof's inner rim (Render.stadiumRoof), so no towers.
      stadium(b) {
        const A = b.A;
        lotArea(A, 0.35);
        fill({ x: A.x, y: A.y, w: 5, h: 5 }, KIND.CONCRETE, 0);
        groundPad(A.x + 2.5, A.y + 2.5, 'Stadium Helipad');
        const sw = 28, sh = 22, sx = A.x + Math.floor((A.w - sw) / 2), sy = A.y + Math.floor((A.h - sh) / 2);
        const E = { x: sx - 6, y: sy - 5, w: sw + 12, h: sh + 9 };      // esplanade (the south side is the main gate)
        const ecx = sx + sw / 2, ecy = sy + sh / 2;
        fill(E, KIND.PLAZA, (x, y) => Math.floor(Math.hypot((x + 0.5 - ecx) / (sw / 2), (y + 0.5 - ecy) / (sh / 2)) * 5) & 1);
        const bl = addBuilding(sx, sy, sw, sh, 3, 'stadium', { type: 'stadium' }, b.rg, { sign: 'PASTEL STADIUM', oval: true });
        // trees at the esplanade's edge, benches and lamps along it
        for (let k = 0; k <= 8; k++) {
          const x = E.x + 1 + (k * (E.w - 3)) / 8;
          for (const y of [E.y + 1, E.y + E.h - 2]) if (k % 2 === 0) addTree(T(x) + 8, T(y) + 8, 'tree_c');
          if (k % 2) { c.lamps.push({ x: T(x) + 8, y: T(E.y) + 6 }, { x: T(x) + 8, y: T(E.y + E.h) - 6 }); addProp('bench', T(x) + 8, T(E.y + E.h - 2) + 8); }
        }
        for (let k = 1; k < 5; k++) {
          const y = E.y + 1 + (k * (E.h - 3)) / 5;
          for (const x of [E.x + 1, E.x + E.w - 2]) addTree(T(x) + 8, T(y) + 8, k % 2 ? 'tree_b' : 'tree_c');
        }
        // stalls and cars only where the car park is still car park
        const onLot = (s2) => kindAt(Math.floor(s2.x / TILE), Math.floor(s2.y / TILE)) === KIND.LOT;
        c.stalls = c.stalls.filter((s2) => !(s2.x > T(A.x) && s2.x < T(A.x + A.w) && s2.y > T(A.y) && s2.y < T(A.y + A.h)) || onLot(s2));
        c.parked = c.parked.filter((s2) => !(s2.x > T(A.x) && s2.x < T(A.x + A.w) && s2.y > T(A.y) && s2.y < T(A.y + A.h)) || onLot(s2));
        landmark('Pastel Stadium', T(sx + sw / 2), T(E.y + E.h - 1), { kind: 'building', rect: { x: bl.tx, y: bl.ty, w: bl.tw, h: bl.th },
          what: `${sw}x${sh} oval Beira-Rio style bowl (oval walls of white leaves, red stands, grass oval with the pitch inscribed, rim floodlights), paved esplanade ${E.w}x${E.h} with trees, benches and lamps, car parks north and south, helipad, on the bay shore (waterfront promenade east of the avenue)` });
        b.stadiumE = E;
      },
      tvhq(b) {
        const A = b.A;
        fill(A, KIND.PLAZA, 1);
        // the tower: helipad in the middle, three dishes and the TV mast on the roof corners
        const bl = addBuilding(A.x + 2, A.y + 2, 10, 10, 15, 'glass', flat('glass'), b.rg, { sign: 'PCTV', tower: true,
          roofProps: [{ tag: 'dish', x: 28, y: 28 }, { tag: 'dish', x: 132, y: 28 }, { tag: 'dish', x: 28, y: 132 }],
          roofTalls: [{ sprite: 'mast', x: 132, y: 132, h: 120, column: 'l', light: { color: 'rgba(255,60,80,0.95)', r: 50 } }] });
        roofHeli(bl);
        // outside-broadcast vans in a fenced yard beside it
        lotArea({ x: A.x + 16, y: A.y + 1, w: A.w - 17, h: A.h - 2 }, 0, ['van']);
        for (const s of c.stalls.slice(-12)) if (s.models && s.models[0] === 'van' && R() < 0.6) c.parked.push(s);
        fenceRect('chain', { x: A.x + 16, y: A.y + 1, w: A.w - 17, h: A.h - 2 }, 40);
        for (const [i, j] of [[0.5, 0.5], [13.5, 0.5], [0.5, 13.5], [13.5, 13.5]]) addTree(T(A.x + i), T(A.y + j), 'tree_b');
        landmark('PCTV Tower', T(A.x + 7), T(A.y + 13), { kind: 'building', rect: { x: bl.tx, y: bl.ty, w: bl.tw, h: bl.th }, what: '10x10 glass tower, 15 floors, PCTV sign; on the roof a helipad, 3 dishes and a TV mast (h 120 above the roof, red light); van yard beside it' });
      },
      hospital(b) {
        const A = b.A;
        fill(A, KIND.PLAZA, 0);
        const bl = addBuilding(A.x + 1, A.y + 1, 16, 10, 5, 'hospital', flat('hospital'), b.rg, { sign: 'HOSPITAL', tower: true });
        roofHeli(bl);
        fill({ x: A.x, y: A.y + 11, w: 18, h: 3 }, KIND.CONCRETE, 0);
        for (let i = 0; i < 3; i++) park(spot(T(A.x + 2.5 + i * 4.5), T(A.y + 12.5), Math.PI / 2, ['ambulance']), i < 2 ? 1 : 0.6);
        lotArea({ x: A.x + 20, y: A.y, w: A.w - 26, h: A.h }, 0.45);
        fill({ x: A.x + A.w - 6, y: A.y, w: 6, h: A.h }, KIND.CONCRETE, 0);
        c.hospitalPad = groundPad(A.x + A.w - 3, A.y + 7, 'Hospital Helipad');
        addTree(T(A.x + 18.5), T(A.y + 1), 'tree_c'); addTree(T(A.x + 18.5), T(A.y + 9), 'tree_c');
        landmark('Mercy Hospital', T(A.x + 9), T(A.y + 12.5), { kind: 'building', rect: { x: bl.tx, y: bl.ty, w: bl.tw, h: bl.th }, what: '16x10 building, 5 floors, wall hospital, roof hospital + helipad, HOSPITAL sign, ambulance bay, car park' });
      },
      // Union Station: the railway runs down the block; platforms either side, the
      // station hall on the west platform, a car park and taxi rank beyond it
      station(b) {
        const A = b.A;
        fill(A, KIND.GRASS, 0);
        const px0 = RAIL_X - 3, px1 = RAIL_X + 4;
        const P0 = 520, P1 = 561;
        for (let y = P0; y < P1; y++) {
          for (let x = px0; x < RAIL_X; x++) setKind(x, y, KIND.PLATFORM, x === RAIL_X - 1 ? 2 : 0);
          for (let x = px1; x < px1 + 3; x++) setKind(x, y, KIND.PLATFORM, x === px1 ? 3 : 0);
        }
        const bl = addBuilding(RAIL_X - 13, 526, 10, 24, 2, 'station', flat('arch'), b.rg, { sign: 'STATION' });
        fill({ x: A.x, y: 520, w: RAIL_X - 13 - A.x, h: 41 }, KIND.PLAZA, 0);
        for (let i = 0; i < 5; i++) { const s = spot(T(RAIL_X - 15), T(528 + i * 4), 0, ['taxi']); c.parkSpots.push(s); park(s, 0.8); }
        lotArea({ x: A.x, y: A.y, w: RAIL_X - 4 - A.x, h: 520 - 2 - A.y }, 0.45);
        lotArea({ x: A.x, y: 563, w: RAIL_X - 4 - A.x, h: A.y + A.h - 563 }, 0.45);
        for (let y = A.y; y < A.y + A.h; y += 3) { addTree(T(px1 + 4) + 8, T(y) + 8, 'tree_b'); }
        fence('chain', T(RAIL_X) - 2, T(A.y), T(RAIL_X) - 2, T(P0));
        fence('chain', T(RAIL_X + 4) + 2, T(A.y), T(RAIL_X + 4) + 2, T(P0));
        for (const y of [P0 + 3, P0 + 20, P1 - 3]) { addProp('bench', T(px0) + 10, T(y) + 8); addProp('bench', T(px1 + 1) + 8, T(y) + 8); }
        for (let y = P0 + 2; y < P1; y += 8) { c.lamps.push({ x: T(px0) + 6, y: T(y) + 8 }, { x: T(px1 + 3) - 6, y: T(y) + 8 }); }
        c.stationStop = T((P0 + P1) / 2);
        landmark('Union Station', T(RAIL_X - 8), T(538), { kind: 'building', rect: { x: bl.tx, y: bl.ty, w: bl.tw, h: bl.th }, what: `10x24 hall (wall station, arched glass roof, STATION sign), platforms y ${P0}-${P1 - 1} both sides of the track, taxi rank, two car parks` });
      },

      // ---- industrial
      warehouse(b) {
        const A = b.A;
        fill(A, KIND.CONCRETE, () => (R() < 0.1 ? 1 : 0));
        // an army-surplus gun store at the gate: flush on the north sidewalk, outside the fence
        let gx = 0;
        if (b.gunshop !== undefined && gunStore(b.gunshop, A.x, A.y, 8, 5, 'n', b.rg)) {
          gx = 9;
          lotArea({ x: A.x, y: A.y + 5, w: 8, h: A.h - 5 }, 0.5, ['pickup', 'pickup', 'van', 'suv']);
        }
        const wide = A.w - gx > 20;
        const w1 = wide ? Math.floor((A.w - gx) * 0.45) : A.w - gx - 2;
        addBuilding(A.x + gx + 1, A.y + 1, w1, 8, 2, pick(R, ['shed', 'shedr']), flat(pick(R, ['metal', 'rust'])), b.rg);
        if (wide) addBuilding(A.x + gx + w1 + 3, A.y + 1, A.w - gx - w1 - 4, 7, 2, pick(R, ['shed', 'shedr']), flat(pick(R, ['metal', 'rust'])), b.rg);
        this.yard({ x: A.x + gx + 1, y: A.y + 10, w: A.w - gx - 2, h: 5 });
        for (let i = 0; i < 6; i++) addProp(pick(R, ['pallet', 'barrel', 'crates']), T(A.x + gx + 1.5 + R() * (A.w - gx - 3)), T(A.y + 9) + 6, 5);
        fenceRect('chain', gx ? { x: A.x + gx, y: A.y, w: A.w - gx, h: A.h } : A, 64);
      },
      yard(Y) {
        let x = T(Y.x) + 10;
        const end = T(Y.x + Y.w) - 10;
        const cy = T(Y.y + Y.h / 2);
        while (x < end) {
          const model = pick(R, ['semi', 'truck', 'flatbed', 'tanker', 'mixer', 'forklift', 'truck']);
          const len = MODELS[model].len;
          if (x + len > end) break;
          park(spot(x + len / 2, cy, Math.PI / 2, [model], { yard: true }), 0.6);
          x += len + 18;
        }
      },
      containers(b) {
        const A = b.A;
        fill(A, KIND.CONCRETE, () => (R() < 0.1 ? 1 : 0));
        const colors = ['container_red', 'container_blue', 'container_teal', 'container_yellow'];
        for (const row of [A.y + 1, A.y + A.h - 6]) {
          for (let x = A.x + 1; x + 2 <= A.x + A.w - 1; x += 3) {
            if (R() < 0.18) continue;
            addBuilding(x, row, 2, 5, R() < 0.4 ? 2 : 1, 'shed', { type: 'sprite', tag: pick(R, colors) }, b.rg, { container: true });
          }
        }
        for (let i = 0; i < 3; i++) park(spot(T(A.x + 3 + R() * (A.w - 6)), T(A.y + A.h / 2), Math.PI / 2, ['forklift']), 0.8);
        fenceRect('chain', A, 64);
      },
      tankfarm(b) {
        const A = b.A;
        fill(A, KIND.CONCRETE, 0);
        const cols = Math.max(1, Math.floor((A.w - 6) / 6));
        for (let i = 0; i < cols; i++) for (let j = 0; j < 2; j++) {
          const x = T(A.x + 3.5 + i * 6), y = T(A.y + 3.5 + j * 8);
          addTall('fueltank', x, y, 36, 21);
          if (i > 0) c.paints.push({ t: 'pipe', x0: x - T(6) + 22, y0: y, x1: x - 22, y1: y });
        }
        addBuilding(A.x + A.w - 5, A.y + 1, 4, 4, 1, 'shed', flat('metal'), b.rg);
        park(spot(T(A.x + A.w - 3), T(A.y + 11), 0, ['tanker', 'tanker', 'truck']), 0.9);
        fenceRect('chain', A, 64);
      },
      factory(b) {
        const A = b.A;
        fill(A, KIND.CONCRETE, () => (R() < 0.1 ? 1 : 0));
        addBuilding(A.x + 1, A.y + 1, A.w - 9, 9, 3, pick(R, ['brick', 'shedr']), flat('rust'), b.rg);
        for (let k = 0; k < 2; k++) addTall('smokestack', T(A.x + A.w - 4), T(A.y + 3 + k * 6), 230, 12, { smoke: true, column: 'R' });
        this.yard({ x: A.x + 1, y: A.y + 11, w: A.w - 9, h: 4 });
        for (let i = 0; i < 5; i++) addProp('barrel', T(A.x + A.w - 7 + R() * 2), T(A.y + 1 + R() * 13), 5);
        fenceRect('chain', A, 64);
      },
      depot(b) {
        const A = b.A;
        fill(A, KIND.CONCRETE, () => (R() < 0.12 ? 1 : 0));
        addBuilding(A.x + 1, A.y + 1, 5, 4, 1, 'shed', flat('metal'), b.rg);
        for (let i = 0; i < Math.floor((A.w - 8) / 3); i++) park(spot(T(A.x + 7.5 + i * 2.6) + 4, T(A.y + A.h / 2) + 8, 0, ['truck', 'garbage', 'mixer', 'van']), 0.6);
        fenceRect('chain', A, 48);
      },
      garagelot(b) {
        lotArea(b.A, 0);
        c.garage = { x: T(b.A.x + 8), y: T(b.A.y + 6.5) };
        landmark('Boost Garage', c.garage.x, c.garage.y, { kind: 'anchor', what: 'boost-mission drop-off: an empty car park by the bay' });
      },
      freightyard(b) {
        const A = b.A;
        fill(A, KIND.CONCRETE, () => (R() < 0.1 ? 1 : 0));
        // two sidings west of the main line, with parked wagons
        for (const sx of [RAIL_X - 10, RAIL_X - 5]) {
          for (let y = A.y + 6; y < A.y + A.h - 6; y++) for (let a = 0; a < 4; a++) { c.kind[I(sx + a, y)] = KIND.RAIL; c.sub[I(sx + a, y)] = a + 1; }
          let y = T(A.y + 12);
          for (let k = 0; k < 3; k++) {
            const tag = pick(R, ['boxcar', 'tankcar', 'flatcar', 'boxcar']);
            c.sprites.push({ sheet: 'rail', tag, x: T(sx + 2), y, ang: 0, h: 0 });
            for (const d of [-40, 0, 40]) addObstacle(T(sx + 2), y + d, 16);
            y += 116;
          }
          addProp('buffer', T(sx + 2), T(A.y + 6) - 6, 6, { rot: 0 });
          addProp('buffer', T(sx + 2), T(A.y + A.h - 6) + 6, 6, { rot: Math.PI });
        }
        // container stacks and a shed on the west side
        const colors = ['container_red', 'container_blue', 'container_teal', 'container_yellow'];
        for (let y = A.y + 2; y + 5 < A.y + A.h - 2; y += 7) for (let x = A.x + 1; x + 2 <= RAIL_X - 13; x += 3) {
          if (R() < 0.3) continue;
          addBuilding(x, y, 2, 5, R() < 0.4 ? 2 : 1, 'shed', { type: 'sprite', tag: pick(R, colors) }, b.rg, { container: true });
        }
        for (let i = 0; i < 4; i++) park(spot(T(A.x + 3 + R() * 14), T(A.y + 6 + R() * (A.h - 12)), 0, ['forklift', 'truck']), 0.7);
        fenceRect('chain', A, 64);
        landmark('Freight Yard', T(RAIL_X - 6), T(A.y + A.h / 2), { kind: 'rail', what: 'north end of the railway, two sidings with wagons, container stacks' });
      },

      // ---- suburbs
      houses(b) {
        const A = b.A, S = 8;
        for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) houseLot({ x: A.x + i * S, y: A.y + j * S }, S, j === 0 ? 'n' : 's', b.rg, { carChance: 0.45 });
      },
      culdesac(b) {
        const A = b.A;
        fill(A, KIND.LAWN);
        let sides = shuffle(['s', 'n', 'e', 'w']).slice(0, R() < 0.5 ? 1 : 2);
        if (sides.length === 2 && !((sides.includes('s') && sides.includes('n')) || (sides.includes('e') && sides.includes('w')))) sides = [sides[0]];
        const depth = sides.length === 2 ? Math.floor(A.h * 0.33) : Math.floor(A.h * 0.52), r = 5;
        const cx = A.x + A.w / 2, cy = A.y + A.h / 2;
        const name = takeName('city') + ' Court';
        const sid = addStreet(name, 'court', b.grid.name, { x: Math.round(cx), y: Math.round(cy) }, { x: Math.round(cx), y: Math.round(cy) }, 4);
        for (const side of sides) {
          let stem, bulb;
          const reach = (x, y, dx, dy) => { let k = 0; while (k < 8 && kindAt(x + dx * k, y + dy * k) !== KIND.ROAD) k++; return k; };
          if (side === 's') { bulb = { x: cx, y: A.y + A.h - depth }; const e = A.y + A.h + reach(Math.round(cx), A.y + A.h, 0, 1); stem = { x: Math.round(cx - 2), y: Math.round(bulb.y), w: 4, h: e - Math.round(bulb.y) }; }
          if (side === 'n') { bulb = { x: cx, y: A.y + depth }; const e = A.y - 1 - reach(Math.round(cx), A.y - 1, 0, -1); stem = { x: Math.round(cx - 2), y: e + 1, w: 4, h: Math.round(bulb.y) - e - 1 }; }
          if (side === 'e') { bulb = { x: A.x + A.w - depth, y: cy }; const e = A.x + A.w + reach(A.x + A.w, Math.round(cy), 1, 0); stem = { x: Math.round(bulb.x), y: Math.round(cy - 2), w: e - Math.round(bulb.x), h: 4 }; }
          if (side === 'w') { bulb = { x: A.x + depth, y: cy }; const e = A.x - 1 - reach(A.x - 1, Math.round(cy), -1, 0); stem = { x: e + 1, y: Math.round(cy - 2), w: Math.round(bulb.x) - e - 1, h: 4 }; }
          for (let y = stem.y; y < stem.y + stem.h; y++) for (let x = stem.x; x < stem.x + stem.w; x++) { c.kind[I(x, y)] = KIND.ROAD; c.sub[I(x, y)] = 9; streetMap[I(x, y)] = sid + 1; }
          for (let y = Math.floor(bulb.y - r - 1); y <= bulb.y + r + 1; y++) for (let x = Math.floor(bulb.x - r - 1); x <= bulb.x + r + 1; x++) {
            if (dist(x + 0.5, y + 0.5, bulb.x, bulb.y) <= r) { c.kind[I(x, y)] = KIND.ROAD; c.sub[I(x, y)] = 9; streetMap[I(x, y)] = sid + 1; }
          }
          c.paints.push({ t: 'culdesac', stem, bulb, r, side, street: sid });
          c.trees.push({ x: T(bulb.x), y: T(bulb.y), sprite: 'tree_a' }); addObstacle(T(bulb.x), T(bulb.y), 14);
          const vert = side === 's' || side === 'n';
          for (let k = 4; k < (vert ? stem.h : stem.w) - 4; k += 6) c.roadSpots.push(vert ? { x: T(cx), y: T(stem.y + k) } : { x: T(stem.x + k), y: T(cy) });
          const st = c.streets[sid];
          st.from = { x: Math.round(stem.x + stem.w / 2), y: Math.round(stem.y + stem.h / 2) }; st.to = { x: Math.round(bulb.x), y: Math.round(bulb.y) };
        }
        // house lots on an 8-tile grid, each facing its nearest street
        const S = 8, n = Math.floor(A.w / S), off = Math.floor((A.w - n * S) / 2);
        const around = (L, face) => {
          const mid = Math.floor(S / 2);
          for (let k = 1; k <= 3; k++) {
            const [x, y] = face === 's' ? [L.x + mid, L.y + S - 1 + k] : face === 'n' ? [L.x + mid, L.y - k] : face === 'e' ? [L.x + S - 1 + k, L.y + mid] : [L.x - k, L.y + mid];
            const kk = kindAt(x, y);
            if (kk === KIND.ROAD || kk === KIND.WALK) return k;
          }
          return 99;
        };
        for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
          const L = { x: A.x + off + gx * S, y: A.y + off + gy * S };
          let hit = false;
          for (let y = L.y - 1; y <= L.y + S && !hit; y++) for (let x = L.x - 1; x <= L.x + S; x++) if (kindAt(x, y) === KIND.ROAD) { hit = true; break; }
          for (let y = L.y; y < L.y + S && !hit; y++) for (let x = L.x; x < L.x + S; x++) if (kindAt(x, y) !== KIND.LAWN) { hit = true; break; }
          if (hit) continue;
          const faces = ['s', 'n', 'e', 'w'].map((f) => [around(L, f), f]).sort((a, b2) => a[0] - b2[0]);
          if (faces[0][0] < 99) houseLot(L, S, faces[0][1], b.rg);
          else addTree(T(L.x + 4), T(L.y + 4), 'tree_a');
        }
      },

      // ---- farmland (big lots, no sidewalk)
      fields(b, homeGen) {
        const A = b.A;
        const sx = A.x + Math.floor(A.w * (0.4 + R() * 0.2)), sy = A.y + Math.floor(A.h * (0.4 + R() * 0.2));
        const quads = [
          { x: A.x, y: A.y, w: sx - A.x, h: sy - A.y }, { x: sx + 2, y: A.y, w: A.x + A.w - sx - 2, h: sy - A.y },
          { x: A.x, y: sy + 2, w: sx - A.x, h: A.y + A.h - sy - 2 }, { x: sx + 2, y: sy + 2, w: A.x + A.w - sx - 2, h: A.y + A.h - sy - 2 },
        ];
        for (let y = A.y; y < A.y + A.h; y++) for (let x = sx; x < sx + 2; x++) setKind(x, y, KIND.DIRT, (x + y) % 2);
        for (let x = A.x; x < A.x + A.w; x++) for (let y = sy; y < sy + 2; y++) setKind(x, y, KIND.DIRT, (x + y) % 2);
        const home = Math.floor(R() * 4);
        // farmhands walk the access tracks (split at the crossing so the walk graph joins them),
        // and the farm town's forecourt is ringed by a path joined to the nearest two tracks
        {
          const X = T(sx + 1), Y = T(sy + 1);
          walkLine(X, T(A.y) + 8, X, Y); walkLine(X, Y, X, T(A.y + A.h) - 8);
          walkLine(T(A.x) + 8, Y, X, Y); walkLine(X, Y, T(A.x + A.w) - 8, Y);
          if (homeGen) {
            const Q = quads[home], X0 = T(Q.x) + 8, X1 = T(Q.x + Q.w) - 8, Y0 = T(Q.y) + 8, Y1 = T(Q.y + Q.h) - 8;
            walkLine(X0, Y0, X1, Y0); walkLine(X0, Y1, X1, Y1); walkLine(X0, Y0, X0, Y1); walkLine(X1, Y0, X1, Y1);
            const my = T(Q.y + 6) + 8, mx = T(Q.x + 7) + 8;          // the gaps between the town's buildings
            if (home % 2 === 0) walkLine(X1, my, X, my, { conn: true }); else walkLine(X, my, X0, my, { conn: true });
            if (home < 2) walkLine(mx, Y1, mx, Y, { conn: true }); else walkLine(mx, Y, mx, Y0, { conn: true });
          }
        }
        quads.forEach((Q, i) => {
          if (i === home) return (homeGen || gen.farmstead).call(gen, { A: Q, rg: b.rg, grid: b.grid });
          const crop = Math.floor(R() * CROPS.length);
          fill(Q, KIND.FIELD, (x, y) => crop * 2 + (y % 2));
          const mx = T(Q.x + Q.w / 2), my = T(Q.y + Q.h / 2);
          if (CROPS[crop] === 'pasture') {
            fenceRect('wood', Q);
            pen(T(Q.x) + 16, T(Q.y) + 16, T(Q.x + Q.w) - 16, T(Q.y + Q.h) - 16, 5, () => [T(Q.x + 2 + R() * (Q.w - 4)), T(Q.y + 2 + R() * (Q.h - 4)), R() * Math.PI * 2]);
            for (let k = 0; k < 3; k++) addProp('haybale', T(Q.x + 1 + R() * (Q.w - 2)), T(Q.y + 1 + R() * (Q.h - 2)), 6);
          } else if (CROPS[crop] === 'wheat') {
            park(spot(mx, my, Math.PI / 2, ['harvester']), 0.7);
          } else if (CROPS[crop] === 'soil') {
            park(spot(mx, my, R() < 0.5 ? Math.PI / 2 : -Math.PI / 2, ['tractor']), 0.7);
          }
        });
      },
      farmstead(b) {
        const A = b.A;
        fill(A, KIND.GRASS, 0);
        for (let y = A.y + 5; y < A.y + 8 && y < A.y + A.h; y++) for (let x = A.x; x < A.x + A.w; x++) setKind(x, y, KIND.DIRT, (x + y) % 2);
        addBuilding(A.x + 1, A.y + 1, 6, 4, 2, pick(R, ['house_white', 'house_yellow']), { type: 'pitched', mat: pick(R, ['red', 'brown']), ridge: 'h' }, b.rg, { house: true });
        addBuilding(A.x + 1, A.y + 8, 7, 5, 2, 'barn', { type: 'pitched', mat: 'barn', ridge: 'v' }, b.rg);
        addTall('silo', T(A.x + 10), T(A.y + 10), 110, 18, { column: 'm' });
        if (A.w >= 14) addTall('silo', T(A.x + 12.8), T(A.y + 11.5), 90, 18, { column: 'm' });
        addProp('haystack', T(A.x + 10), T(A.y + 2.5), 14, { big: true });
        for (let k = 0; k < 3; k++) addProp('haybale', T(A.x + 9 + k * 1.2), T(A.y + 4.5), 6);
        park(spot(T(A.x + 9.5), T(A.y + 6.5), Math.PI / 2, ['pickup', 'pickup', 'suv']), 0.9);
        park(spot(T(A.x + 4.5), T(A.y + 6.5), -Math.PI / 2, ['tractor']), 0.9);
      },
      town(b) {
        const A = b.A;
        fill(A, KIND.CONCRETE, () => (R() < 0.1 ? 1 : 0));
        addBuilding(A.x + 1, A.y + 1, 6, 4, 1, 'shed', flat('canopy'), b.rg, { overhang: true, sign: 'GAS', height: 44 });
        for (const px of [2.5, 5.5]) addProp('pump', T(A.x + px), T(A.y + 3), 5);
        addBuilding(A.x + 8, A.y + 1, Math.min(5, A.w - 9), 4, 1, 'store_c', flat('cream'), b.rg, { sign: 'SHOP' });
        addBuilding(A.x + 1, A.y + 8, 6, 5, 1, 'store_b', flat('rose'), b.rg, { sign: 'BAR' });
        addBuilding(A.x + 8, A.y + 8, Math.min(5, A.w - 9), 5, 1, 'store_a', flat('teal'), b.rg, { sign: 'DINER' });
        park(spot(T(A.x + 4), T(A.y + 6.5), Math.PI / 2, ['pickup', 'pickup', 'suv', 'hatch']), 0.9);
        park(spot(T(A.x + 10.5), T(A.y + 6.5), -Math.PI / 2, ['pickup', 'truck', 'sedan']), 0.7);
        b.phoneAt = { x: T(A.x + 7.5), y: T(A.y + 6.5) };
      },
      farmtown(b) {
        let ph = null;
        this.fields(b, function (q) { gen.town(q); ph = q.phoneAt; });
        b.phoneAt = ph;
      },
      orchard(b) {
        const A = b.A;
        fill(A, KIND.GRASS, 0);
        for (let y = 1; y < A.h; y += 3) for (let x = 1; x < A.w; x += 3) {
          if (y === 16 || y === 15) continue;
          addTree(T(A.x + x) + 8, T(A.y + y) + 8, (y / 3) % 2 < 1 ? 'tree_c' : 'tree_a');
        }
        for (let x = A.x; x < A.x + A.w; x++) setKind(x, A.y + 15, KIND.DIRT, x & 1);
        park(spot(T(A.x + A.w / 2), T(A.y + 15.5), Math.PI / 2, ['tractor', 'pickup']), 0.8);
      },
      pasture(b) {
        const A = b.A;
        fill(A, KIND.FIELD, (x, y) => 6 + (y % 2));
        fenceRect('wood', A, 48);
        // the herd keeps south of the barn (rows 1-5), clear of the fence
        pen(T(A.x) + 16, T(A.y + 7), T(A.x + A.w) - 16, T(A.y + A.h) - 16, 12, () => [T(A.x + 2 + R() * (A.w - 4)), T(A.y + 2 + R() * (A.h - 4)), R() * Math.PI * 2]);
        for (let k = 0; k < 6; k++) addTree(T(A.x + 2 + R() * (A.w - 4)), T(A.y + 2 + R() * (A.h - 4)), 'tree_a');
        addBuilding(A.x + 1, A.y + 1, 7, 5, 2, 'barn', { type: 'pitched', mat: 'barn', ridge: 'h' }, b.rg);
      },
    };

    for (const b of c.blocks) {
      const g = gen[b.type];
      if (g) g.call(gen, b);
    }

    mark('blocks');
    // ============================================================ LANDMARKS ==
    // ---- the long bridge: towers (two pylons each), crossbeams and cables
    {
      const yN = T(BRIDGE_Y) + 8, yS = T(BRIDGE_Y + ROAD - 1) + 8, hTop = 256;
      for (const tx of TOWERS) {
        const x = T(tx) + 8;
        for (const y of [yN, yS]) addTall('pylon', x, y, 260, 7, { column: 'O', light: { color: 'rgba(255,80,80,0.9)', r: 40 } });
        for (const h of [250, 175, 100]) c.cables.push({ ax: x, ay: yN, ah: h, bx: x, by: yS, bh: h, sag: 0, color: 'r', w: 3 });
      }
      const x0 = T(BAY_W), x1 = T(BAY_E), a = T(TOWERS[0]) + 8, b2 = T(TOWERS[1]) + 8;
      for (const y of [yN, yS]) {
        c.cables.push({ ax: x0, ay: y, ah: 14, bx: a, by: y, bh: hTop, sag: 30, color: 'O', w: 2 });
        c.cables.push({ ax: a, ay: y, ah: hTop, bx: b2, by: y, bh: hTop, sag: 236, color: 'O', w: 2 });
        c.cables.push({ ax: b2, ay: y, ah: hTop, bx: x1, by: y, bh: 14, sag: 30, color: 'O', w: 2 });
      }
      for (let tx = BAY_W + 6; tx < BAY_E - 3; tx += 12) {
        if (TOWERS.some((t) => Math.abs(t - tx) < 3)) continue;
        c.lamps.push({ x: T(tx) + 8, y: T(BRIDGE_Y) + 4 }, { x: T(tx) + 8, y: T(BRIDGE_Y + ROAD) - 4 });
      }
      landmark('Pastel Gate Bridge', T((BAY_W + BAY_E) / 2), T(BRIDGE_Y + 4.5), { kind: 'bridge',
        rect: { x: gateRec.x, y: gateRec.y, w: gateRec.len, h: ROAD },
        what: `${gateRec.len}-tile deck on ggbridge tiles, towers at x ${TOWERS[0]} and ${TOWERS[1]} (2 pylons each, h 260), cables sag to the deck mid-span` });
    }

    // ---- Shell Beach (Side City's east coast) and the marina
    {
      claim(BEACH, 'suburbs');
      for (let y = BEACH.y; y < BEACH.y + BEACH.h; y++) {
        for (let x = BEACH.x; x < W; x++) {
          const i = I(x, y);
          if (!land[i] || claimed[i] && (net.v[i] || net.h[i] || net.box[i])) continue;
          if (x < 720) { c.kind[i] = KIND.GRASS; c.sub[i] = 0; }
          else if (x < 723) { c.kind[i] = KIND.BOARDWALK; c.sub[i] = 0; }
          else { c.kind[i] = KIND.SAND; c.sub[i] = 0; }
        }
        if (y % 7 === 3 && kindAt(718, y) === KIND.GRASS) addTree(T(718) + 8, T(y) + 8, 'palm');
        if (y % 12 === 6 && kindAt(719, y) === KIND.GRASS) c.lamps.push({ x: T(720) - 3, y: T(y) + 8 });
      }
      for (let y = BEACH.y + 20; y < BEACH.y + BEACH.h - 10; y += 5) {
        for (let x = 725; x < 736; x += 4) {
          const jx = x + R() * 2, jy = y + R() * 3;
          if (kindAt(Math.floor(jx), Math.floor(jy)) !== KIND.SAND || R() < 0.45) continue;
          addProp('umbrella', T(jx), T(jy), 0, { frame: Math.floor(R() * 3) });
          addProp('towel', T(jx) + 10, T(jy) + 8, 0, { frame: Math.floor(R() * 3) });
        }
      }
      for (let y = BEACH.y + 12; y < BEACH.y + BEACH.h; y += 26) {
        const x = 727 + Math.floor(R() * 4);
        if (kindAt(x, y) === KIND.SAND) addTree(T(x) + 8, T(y) + 8, 'palm', true);
      }
      for (const hy of [262, 346]) addBuilding(729, hy, 3, 3, 1, 'house_white', { type: 'pitched', mat: 'red', ridge: 'h' }, ZONES.suburbs, { force: true, sign: 'SOS' });
      for (let y = BEACH.y + 30; y < BEACH.y + BEACH.h; y += 40) {
        const x = 742 + Math.floor(R() * 6);
        if (kindAt(x, y) === KIND.WATER) addProp('buoy', T(x) + 8, T(y) + 8);
      }
      c.crateSpots.push({ x: T(730), y: T(300) });
      // the boardwalk is a promenade: joined to Side City's east sidewalks across the street
      {
        const bx = T(721) + 8, g = G.side;
        walkLine(bx, T(BEACH.y) + 8, bx, T(BEACH.y + BEACH.h) - 8);
        for (let j = 0; j < g.ny; j++) {
          const b = g.blocks[ownerAt(g, g.nx - 1, j)];
          if (!g.vseg[g.nx][j] || !b || !b.ring) continue;
          const y = T(g.oy + ROAD + j * g.pitch) + b.ring * 8;
          if (y > T(BEACH.y) + 8 && y < T(BEACH.y + BEACH.h) - 8) walkLine(T(b.x1) - b.ring * 8, y, bx, y, { conn: true });
        }
      }
      landmark('Shell Beach', T(730), T(310), { kind: 'beach', rect: { x: 717, y: BEACH.y, w: 21, h: BEACH.h }, what: 'palm promenade, boardwalk (x 720-722), sand to the sea (~14 tiles), umbrellas, towels, 2 lifeguard huts, buoys' });

      // marina: clubhouse + car park on the shore, piers into the cove, moored boats
      claim(MARINA, 'suburbs');
      for (let y = 432; y < 452; y++) for (let x = 717; x < W; x++) {
        const i = I(x, y);
        if (land[i] && !net.v[i] && !net.h[i] && !net.box[i]) { c.kind[i] = x >= 738 ? KIND.QUAY : KIND.CONCRETE; c.sub[i] = 0; }
      }
      addBuilding(718, 436, 7, 6, 2, 'store_c', flat('teal'), ZONES.suburbs, { sign: 'MARINA' });
      // the car park sits on the shore at the end of Marina Drive (x 726-737), not on the water
      lotArea({ x: 726, y: 434, w: 12, h: 13 }, 0.5);
      // piers 11 tiles apart: a yacht (3.5 x 12 tiles) either side of each still leaves a fairway
      const BOATS = { yacht: [3.5, 12], sailboat: [2.5, 8], motorboat: [2, 5.5] };
      const wet = (x0, y0, w, h) => {
        for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++) for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) if (kindAt(x, y) !== KIND.WATER) return false;
        return true;
      };
      const piers = [738, 749, 760];
      let moored = 0;
      for (const px of piers) {
        let y = 449;
        while (y < 489 && (kindAt(px, y) === KIND.WATER || y < 452 || kindAt(px, y) !== KIND.WATER && y < 456)) {
          for (const x of [px, px + 1]) { if (inW(x, y)) { c.kind[I(x, y)] = KIND.PIER; c.sub[I(x, y)] = 0; claimed[I(x, y)] = 1; } }
          y++;
        }
        for (let x = px - 2; x < px + 4; x++) if (kindAt(x, y) === KIND.WATER) { c.kind[I(x, y)] = KIND.PIER; c.sub[I(x, y)] = 1; }
        const end = y;
        for (const side of [-1, 1]) {
          let cy = 453;
          while (cy < end - 3) {
            let placed = false;
            const order = shuffle(['yacht', 'yacht', 'sailboat', 'sailboat', 'motorboat']);
            for (const tag of order) {
              const [bw, bl] = BOATS[tag];
              const x0 = side < 0 ? px - 0.2 - bw : px + 2.2;
              if (cy + bl > end - 0.5 || !wet(x0, cy, bw, bl)) continue;
              if (R() < 0.85) {
                c.sprites.push({ sheet: 'boats', tag, x: T(x0 + bw / 2), y: T(cy + bl / 2), ang: (side < 0 ? 0 : Math.PI) + (R() - 0.5) * 0.04, h: 0 });
                moored++;
              }
              cy += bl + 1; placed = true;
              break;
            }
            if (!placed) cy += 1;
          }
        }
      }
      // one sailboat at anchor in the open west of the cove
      if (wet(725, 468, 4, 9)) c.sprites.push({ sheet: 'boats', tag: 'sailboat', x: T(727), y: T(472.5), ang: 0.35, h: 0 });
      landmark('Sunrise Marina', T(745), T(446), { kind: 'marina', rect: MARINA, what: `${piers.length} piers (x ${piers.join(', ')}) into the cove, ${moored} moored yachts/sailboats/motorboats, MARINA clubhouse, car park on the shore` });
    }

    // ---- the port on Main City's south coast: container yard, the main quay with three
    // gantry cranes over the moored container ship, the basin and the mole
    {
      claim({ x: PORT.x, y: PORT.y, w: PORT.w, h: PORT.h }, 'industrial');
      for (let y = PORT.y; y < PORT.y + PORT.h; y++) for (let x = PORT.x; x < PORT.x + PORT.w; x++) {
        const i = I(x, y);
        if (!land[i]) continue;
        if (y < 711) { c.kind[i] = KIND.CONCRETE; c.sub[i] = (hash2(x, y, 3) < 0.1) ? 1 : 0; }
        else { c.kind[i] = KIND.QUAY; c.sub[i] = (y === 715 || y === 731) && x >= 205 ? 1 : 0; }
      }
      const rgI = ZONES.industrial, colors = ['container_red', 'container_blue', 'container_teal', 'container_yellow'];
      addBuilding(190, 699, 14, 8, 2, 'shedr', flat('rust'), rgI);
      addBuilding(206, 699, 12, 8, 2, 'shed', flat('metal'), rgI);
      for (let y = 699; y + 5 <= 711; y += 7) for (let x = 224; x + 2 <= 330; x += 3) {
        if (R() < 0.25 || (x > 268 && x < 280)) continue;
        addBuilding(x, y, 2, 5, R() < 0.5 ? 2 : 1, 'shed', { type: 'sprite', tag: pick(R, colors) }, rgI, { container: true });
      }
      for (let x = 340; x < 378; x += 6) park(spot(T(x), T(706), 0, ['semi', 'truck', 'flatbed']), 0.7);
      for (let x = 336; x + 2 <= 378; x += 3) {
        if (R() < 0.3) continue;
        addBuilding(x, 733, 2, 5, 1 + (R() < 0.4 ? 1 : 0), 'shed', { type: 'sprite', tag: pick(R, colors) }, rgI, { container: true });
      }
      for (let x = 208; x < 380; x += 5) addProp('bollard', T(x) + 8, T(731) + 5, 3);
      for (let x = 206; x < 380; x += 7) addProp('bollard', T(x) + 8, T(715) + 11, 3);
      // the ship (11 x 60 tiles) lies alongside the main quay, bow east
      const SHIP = { x: 300, y: 716 + 5.5 + 0.3 };
      c.sprites.push({ sheet: 'ships', tag: 'container_ship', x: T(SHIP.x), y: T(SHIP.y), ang: Math.PI / 2, h: 0 });
      c.sprites.push({ sheet: 'boats', tag: 'motorboat', x: T(214), y: T(724), ang: -Math.PI / 2, h: 0 });
      // gantry cranes: legs on the quay, the boom (ang PI = pointing south) over the ship's beam
      c._cranes = [];                                 // for c.port (City.buildRoutes)
      for (const cx of [280, 296, 312]) {
        const sp = { sheet: 'boats', tag: 'crane', x: T(cx), y: T(719.5), ang: Math.PI, h: 150, dyn: 'crane' };
        c.sprites.push(sp);
        const legs = [];
        for (const dx of [-20, 20]) legs.push(addObstacle(T(cx) + dx, T(713) + 8, 6));
        c._cranes.push({ x: T(cx), y: T(719.5), sprite: sp, legs });
      }
      c._ship = { x: T(SHIP.x), y: T(SHIP.y), ang: Math.PI / 2 };
      for (let i = 0; i < 4; i++) park(spot(T(236 + i * 8), T(735), Math.PI / 2, ['forklift', 'truck']), 0.7);
      for (let i = 0; i < 3; i++) park(spot(T(230 + i * 12), T(713) + 8, Math.PI / 2, ['forklift', 'truck', 'semi']), 0.6);
      c.crateSpots.push({ x: T(214), y: T(735) });
      landmark('Port', T(292), T(708), { kind: 'port', rect: { x: PORT.x, y: PORT.y, w: PORT.w, h: PORT.h },
        what: 'container yard, main quay (y 711-715) with 3 gantry cranes over the container ship moored alongside, harbour basin (y 716-730, 15 tiles), mole quay (y 731-738) with containers and bollards' });
    }

    // ---- Pastel Airport
    {
      const A = AIRPORT, rgA = ZONES.airport;
      claim(A, 'airport');
      for (let y = A.y; y < A.y + A.h; y++) for (let x = A.x; x < A.x + A.w; x++) {
        const i = I(x, y);
        if (!land[i] || net.v[i] || net.h[i] || net.box[i]) continue;
        c.kind[i] = KIND.GRASS; c.sub[i] = 0;
      }
      // runway 17 wide (an airliner's 16-tile wingspan fits), a parallel 11-wide taxiway
      // far enough east that wingtips on the two never meet, and three rapid-exit links
      const RW = { x: 38, y: 503, w: 17, h: 200 }, mid = Math.floor(RW.w / 2);
      for (let y = RW.y; y < RW.y + RW.h; y++) for (let x = RW.x; x < RW.x + RW.w; x++) {
        let f = 0;
        const ax = x - RW.x, ay = y - RW.y;
        if (ax === 0) f = 3; else if (ax === RW.w - 1) f = 4;
        else if (ay < 6 || ay >= RW.h - 6) f = ax === mid ? 0 : 2;
        else if (ax === mid && ay % 5 < 3) f = 1;
        c.kind[I(x, y)] = KIND.RUNWAY; c.sub[I(x, y)] = f;
      }
      const taxi = (x0, y0, w, h, line, lineY) => {
        for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
          c.kind[I(x, y)] = KIND.TAXIWAY;
          c.sub[I(x, y)] = (line !== undefined && x === line) || (lineY !== undefined && y === lineY) ? 1 : 0;
        }
      };
      const TW = { x: 62, w: 11 };                     // parallel taxiway x 62-72, centre line x 67
      taxi(TW.x, 508, TW.w, 190, TW.x + 5);
      for (const ty of [508, 596, 687]) taxi(RW.x + RW.w, ty, TW.x - RW.x - RW.w, 11, undefined, ty + 5);
      // the apron from the taxiway to the terminal; gates face the terminal (nose east)
      const AP = { x: TW.x + TW.w, y: 540, w: 122 - TW.x - TW.w, h: 126 };
      for (let y = AP.y; y < AP.y + AP.h; y++) for (let x = AP.x; x < AP.x + AP.w; x++) { c.kind[I(x, y)] = KIND.APRON; c.sub[I(x, y)] = hash2(x, y, 9) < 0.06 ? 1 : 0; }
      taxi(AP.x, AP.y, 11, AP.h, AP.x + 5);           // apron taxilane along the taxiway
      const term = addBuilding(122, 544, 10, 62, 3, 'terminal', flat('metal'), rgA, { sign: 'AIRPORT' });
      for (const hx of [76, 96]) addBuilding(hx, 668, 16, 12, 2, 'hangar', flat('hangar'), rgA, { sign: hx === 76 ? 'HANGAR 1' : 'HANGAR 2' });
      for (let y = 666; y < 682; y++) for (let x = 74; x < 114; x++) if (c.kind[I(x, y)] === KIND.GRASS) setKind(x, y, KIND.CONCRETE, 0);
      addTall('ctower', T(114), T(530), 220, 12, { column: 'm', light: { color: 'rgba(150,220,255,0.85)', r: 70 } });
      addBuilding(111, 533, 6, 4, 1, 'terminal', flat('metal'), rgA);
      for (let y = 540; y < 610; y++) for (let x = 132; x < 144; x++) setKind(x, y, KIND.PLAZA, 0);
      for (let i = 0; i < 8; i++) { const s = spot(T(139), T(550 + i * 7), 0, ['taxi', 'taxi', 'bus']); c.parkSpots.push(s); park(s, 0.8); }
      lotArea({ x: 155, y: 546, w: 20, h: 76 }, 0.4);
      // parked planes (sheet planes: airliner 272 long x 256 span, prop plane 112 x 144):
      // three gates (20 tiles apart, 16-tile span), a remote stand, two prop planes, one
      // airliner lined up on the runway
      const planes = [[113, 555, 'airliner', Math.PI / 2], [113, 575, 'airliner', Math.PI / 2], [113, 595, 'airliner', Math.PI / 2],
        [95, 630, 'airliner', 0], [111, 654, 'propplane', -Math.PI / 2], [93, 656, 'propplane', 0], [RW.x + RW.w / 2, 522, 'airliner', Math.PI]];
      c._planes = [];                                 // stands for c.airport (City.buildRoutes)
      for (const [x, y, tag, ang] of planes) {
        // dyn: the Flights system (src/airport.js) takes these over; until then they draw as static sprites
        const sp = { sheet: 'planes', tag, x: T(x), y: T(y), ang, h: 0, dyn: 'plane' };
        c.sprites.push(sp);
        const big = tag === 'airliner', obs = [];
        const fx = Math.sin(ang), fy = -Math.cos(ang);
        // fuselage along the nose axis, wings across it (slightly aft of the centre)
        for (const d of big ? [-120, -80, -40, 0, 40, 80, 120] : [-44, -18, 8, 34]) obs.push(addObstacle(T(x) + fx * d, T(y) + fy * d, big ? 14 : 8));
        for (const sd of big ? [-110, -76, -42, 42, 76, 110] : [-58, -30, 30, 58]) {
          const aft = big ? 10 + Math.abs(sd) * 0.35 : 4;
          obs.push(addObstacle(T(x) - fy * sd - fx * aft, T(y) + fx * sd - fy * aft, big ? 10 : 7));
        }
        c._planes.push({ x: T(x), y: T(y), ang, tag, sprite: sp, obstacles: obs });
      }
      c.heliport = groundPad(117, 640, 'Heliport');
      groundPad(89, 548, 'Airport North Pad');
      groundPad(99, 548, 'Airport North Pad 2');
      fence('chain', T(35), T(500), T(121), T(500));
      fence('chain', T(35), T(500), T(35), T(706));
      fence('chain', T(35), T(706), T(121), T(706));
      for (const [x, y] of [[101, 565], [101, 585], [100, 610], [119, 620], [88, 575]]) park(spot(T(x), T(y), 0, ['van', 'van', 'truck', 'flatbed']), 0.85);
      c.airportPhone = { x: T(137), y: T(551) };
      c._air = { RW, TW, AP, links: [508, 596, 687] };
      walkLine(T(133) + 8, T(540) + 8, T(133) + 8, T(609) + 8);          // the terminal kerb
      c.crateSpots.push({ x: T(150), y: T(540) });
      landmark('Pastel Airport', T(108), T(570), { kind: 'airport', rect: A,
        what: `runway ${RW.w}x${RW.h} (x ${RW.x}-${RW.x + RW.w - 1}), parallel taxiway ${TW.w} wide (x ${TW.x}-${TW.x + TW.w - 1}), apron x ${AP.x}-${AP.x + AP.w - 1} with 3 airliner gates, a remote stand and 2 prop planes, terminal 10x62, 2 hangars 16x12, control tower (h 220)`, terminal: { x: term.tx, y: term.ty, w: term.tw, h: term.th } });
    }

    // ---- Stadium waterfront: a promenade on the bay shore east of the stadium's avenue
    {
      const sb = G.major.blocks.find((b) => b.type === 'stadium');
      const x0 = G.major.ox + G.major.w;
      for (let y = sb.y0 - 2; y < sb.y1 + 2; y++) {
        let shore = x0;
        while (shore < x0 + 24 && !isSea[I(shore, y)]) shore++;
        if (shore >= x0 + 24 || shore - x0 < 5) continue;
        for (let x = x0; x < shore - 2; x++) {
          const onPath = x >= shore - 5;
          c.kind[I(x, y)] = onPath ? KIND.PATH : KIND.GRASS; c.sub[I(x, y)] = 0; claimed[I(x, y)] = 1;
        }
        if (y % 5 === 0) addTree(T(shore - 6) + 8, T(y) + 8, y % 10 ? 'tree_c' : 'palm');
        if (y % 8 === 4) c.lamps.push({ x: T(shore - 2) - 3, y: T(y) + 8 });
        if (y % 8 === 0) addProp('bench', T(shore - 2) - 4, T(y) + 8);
      }
    }

    // ---- Dusty Barrel: a roadside gun store on Route 6's south verge, by the SE Farms gate
    {
      const rgR = ZONES.rural, F = { x: 466, y: 609, w: 26, h: 14 };
      claim({ x: F.x - 1, y: F.y, w: F.w + 2, h: F.h + 1 }, 'rural');
      fill({ x: F.x, y: F.y, w: F.w, h: 4 }, KIND.CONCRETE, (x, y) => (hash2(x, y, 5) < 0.12 ? 1 : 0));   // forecourt off the highway
      fill({ x: F.x, y: F.y + 4, w: F.w, h: F.h - 4 }, KIND.GRASS, 0);
      gunStore(4, F.x + 3, F.y + 4, 8, 5, 'n', rgR);
      lotArea({ x: F.x + 13, y: F.y + 4, w: 12, h: 4 }, 0.6, ['pickup', 'pickup', 'suv', 'truck']);
      addProp('sign_speed', T(F.x) - 8, T(F.y) + 8, 2);
      c.lamps.push({ x: T(F.x + 1), y: T(F.y) + 6 }, { x: T(F.x + F.w - 1), y: T(F.y) + 6 });
      for (const [i, j] of [[1, 6], [1, 10], [12, 10], [14, 12], [24, 11], [6, 12]]) addTree(T(F.x + i) + 8, T(F.y + j) + 8, pick(R, ['tree_a', 'tree_b']));
      addProp('barrel', T(F.x + 11) + 4, T(F.y + 5) + 4, 5);
      addProp('crates', T(F.x + 11) + 4, T(F.y + 7) + 4, 5);
    }

    // ---- railway ends
    c.rail ={ x0: T(RAIL_X + 2), y0: T(RAIL_Y0) + 20, x1: T(RAIL_X + 2), y1: T(RAIL_Y1) - 6, stops: [{ at: c.stationStop, dwell: 8 }] };
    addProp('buffer', c.rail.x0, c.rail.y0 - 12, 6, { rot: 0 });
    addProp('buffer', c.rail.x1, c.rail.y1 + 12, 6, { rot: Math.PI });
    for (let y = G.iron.oy + G.iron.h + 1; y < G.main.oy - 1; y++) {
      for (const x of [RAIL_X - 1, RAIL_X + 4]) if (isTerrain(kindAt(x, y))) setKind(x, y, KIND.GRASS, 0);
    }
    fence('chain', T(RAIL_X - 1) + 4, T(G.iron.oy + G.iron.h) + 4, T(RAIL_X - 1) + 4, T(G.main.oy) - 4);
    fence('chain', T(RAIL_X + 5) - 4, T(G.iron.oy + G.iron.h) + 4, T(RAIL_X + 5) - 4, T(G.main.oy) - 4);

    mark('landmarks');
    // ================================================================ NATURE ==
    // coasts: sand beaches (rocks on the wild north-east and north-west capes)
    {
      const dq = new Int32Array(N), dd = new Uint8Array(N).fill(255);
      let qh = 0, qt = 0;
      for (let i = 0; i < N; i++) if (isSea[i] && !riverMask[i]) { dd[i] = 0; dq[qt++] = i; }
      while (qh < qt) {
        const i = dq[qh++], d = dd[i];
        if (d >= 3) continue;
        const x = i % W;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
          if (j < 0 || j >= N || dd[j] !== 255) continue;
          dd[j] = d + 1; dq[qt++] = j;
        }
      }
      for (let i = 0; i < N; i++) {
        if (dd[i] === 0 || dd[i] > 3 || claimed[i]) continue;
        const k = c.kind[i];
        if (!isTerrain(k)) continue;
        const x = i % W, y = (i - x) / W;
        const rocky = ((x > 640 && y < 210) || (x < 120 && y < 120)) && fbm(x / 13, y / 13, sN[4] + 3) > 0.47;
        c.kind[i] = rocky ? KIND.ROCK : (k === KIND.DESERT || k === KIND.DUNE) ? KIND.DUNE : KIND.SAND;
      }
      // river and lake banks
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = I(x, y);
        if (claimed[i] || !isTerrain(c.kind[i]) || c.kind[i] === KIND.SAND) continue;
        let wetRiver = false, wetLake = false;
        for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
          const n2 = i + j * W + k;
          if (c.kind[n2] !== KIND.WATER) continue;
          if (riverMask[n2]) wetRiver = true; else if (!isSea[n2]) wetLake = true;
        }
        if (wetRiver) c.kind[i] = KIND.SAND;
        else if (wetLake) c.kind[i] = KIND.GRASS;
      }
    }
    mark('coasts');
    // islands: sand, palms (rocks on Seal Rocks)
    for (const is of ISLANDS) {
      for (let y = is.y - is.r - 3; y <= is.y + is.r + 3; y++) for (let x = is.x - is.r - 3; x <= is.x + is.r + 3; x++) {
        if (!inW(x, y) || !land[I(x, y)]) continue;
        const d = dist(x + 0.5, y + 0.5, is.x, is.y);
        c.kind[I(x, y)] = is.rocky ? KIND.ROCK : d < is.r * 0.45 ? KIND.GRASS : KIND.SAND;
        claimed[I(x, y)] = 1;
      }
      const n = is.rocky ? 3 : Math.round(is.r * 0.8);
      for (let k = 0; k < n; k++) {
        const a = R() * Math.PI * 2, d = R() * is.r * 0.6;
        const x = T(is.x + Math.cos(a) * d), y = T(is.y + Math.sin(a) * d);
        if (kindAt(Math.floor(x / TILE), Math.floor(y / TILE)) === KIND.WATER) continue;
        if (is.rocky) addProp('boulder', x, y, 14, { big: true });
        else addTree(x, y, 'palm', true);
      }
    }
    // trees, cacti and boulders on unclaimed land (jittered 3x3-tile cells)
    for (let gy = 0; gy < H; gy += 3) for (let gx = 0; gx < W; gx += 3) {
      const x = gx + 0.5 + R() * 2, y = gy + 0.5 + R() * 2;
      const tx = Math.floor(x), ty = Math.floor(y);
      if (tx >= W || ty >= H) continue;
      const i = I(tx, ty);
      if (claimed[i]) continue;
      const k = c.kind[i], r = R();
      if (k === KIND.FOREST) { if (r < 0.72) addTree(T(x), T(y), weighted({ pine: 0.55, tree_a: 0.3, tree_b: 0.15 })); }
      else if (k === KIND.MEADOW) { if (r < 0.035) addTree(T(x), T(y), pick(R, ['tree_a', 'tree_a', 'tree_c'])); else if (r < 0.05) addProp('shrub', T(x), T(y), 0, { big: true, frame: R() < 0.5 ? 0 : 1 }); }
      else if (k === KIND.GRASS) { if (r < 0.09) addTree(T(x), T(y), pick(R, ['tree_a', 'tree_b'])); }
      else if (k === KIND.DESERT) {
        if (r < 0.05) addProp('cactus', T(x), T(y), 4, { frame: Math.floor(R() * 2) });
        else if (r < 0.065) addProp('boulder', T(x), T(y), 15, { big: true });
        else if (r < 0.11) addProp('rock_s', T(x), T(y), 0, { frame: Math.floor(R() * 2) });
      } else if (k === KIND.ROCK) { if (r < 0.08) addProp('boulder', T(x), T(y), 15, { big: true }); else if (r < 0.2) addProp('rock_s', T(x), T(y), 0, { frame: Math.floor(R() * 2) }); }
      else if (k === KIND.SAND && !isSea[i]) { if (r < 0.02) addTree(T(x), T(y), 'palm', true); }
    }
    // trees around the lakes, palms at the oasis
    for (const L of LAKES) {
      const n = Math.round(L.r * 1.2);
      for (let k = 0; k < n; k++) {
        const a = R() * Math.PI * 2, d = L.r * (1.15 + R() * 0.5);
        const x = T(L.x + Math.cos(a) * d), y = T(L.y + Math.sin(a) * d);
        const tk = kindAt(Math.floor(x / TILE), Math.floor(y / TILE));
        if (claimed[I(Math.floor(x / TILE), Math.floor(y / TILE))] || tk === KIND.WATER) continue;
        addTree(x, y, L.name === 'Oasis Pool' ? 'palm' : pick(R, ['tree_a', 'tree_b', 'tree_b']), true);
      }
    }

    mark('trees');
    // ===================================================== STREET FURNITURE ==
    // per road record: lamps, curb props, parking bays, curb spots, mission spots
    const kAtPx = (x, y) => kindAt(Math.floor(x / TILE), Math.floor(y / TILE));
    const lamp = (x, y) => { if (kAtPx(x, y) === KIND.WALK) c.lamps.push({ x, y }); };
    const curbProp = (sprite, x, y, r = 2, extra) => { if (kAtPx(x, y) === KIND.WALK) addProp(sprite, x, y, r, extra); };
    const curbSpot = (s) => { const k = kAtPx(s.x, s.y); if (k === KIND.ROAD || k === KIND.VERGE) { c.parkSpots.push(s); park(s, ZONES[PROFILE_ZONE[s.profile]].park); } delete s.profile; };
    for (const rec of net.recs) {
      if (rec.axis === 'x') continue;
      const vert = rec.axis === 'v', p = rec.profile, len = rec.len;
      // world px of (across a, along l) inside the band
      const P = (a, l) => (vert ? [T(rec.x + a), T(rec.y + l)] : [T(rec.x + l), T(rec.y + a)]);
      // curb positions: side -1 (left/top) or +1 (right/bottom), `inset` px into the sidewalk
      const curb = (side, l, inset) => {
        const a = side < 0 ? T(0) - inset : T(ROAD) + inset;
        return vert ? [T(rec.x) + a, T(rec.y + l) + 8] : [T(rec.x + l) + 8, T(rec.y) + a];
      };
      const grid = !!rec.grid && len === CITY.LOT;
      // mission targets on the lanes
      const every = p === 'highway' ? 14 : 7;
      for (let l = 3; l < len - 2; l += every) {
        for (const a of p === 'dirt' ? [4.5] : [3, 6]) {
          const [x, y] = P(a, l + 0.5);
          if (kAtPx(x, y) === KIND.ROAD || kAtPx(x, y) === KIND.BRIDGE || kAtPx(x, y) === KIND.DIRT) c.roadSpots.push({ x, y });
        }
      }
      if (p === 'avenue' && grid) {
        for (const side of [-1, 1]) {
          const hasWalk = kAtPx(...curb(side, 10, 4)) === KIND.WALK;
          for (const l of [6, 10, 14]) {
            // parked-car bay: parallel, facing the traffic on that side
            const a = side < 0 ? 1 : 8;
            const [x, y] = P(a, l);
            const ang = vert ? (side < 0 ? Math.PI : 0) : (side < 0 ? -Math.PI / 2 : Math.PI / 2);
            curbSpot({ x, y, ang, profile: p });
            if (hasWalk) curbProp('parking_meter', ...curb(side, l, 4), 2);
          }
          if (!hasWalk) continue;
          curbProp('sign_parking', ...curb(side, 3, 5), 2);
          curbProp('sign_noparking', ...curb(side, 16, 5), 2);
          // ticket machines and bins stand at the back of the sidewalk: the middle is the walk line
          curbProp('ticket_machine', ...curb(side, 12, 40), 3);
          lamp(...curb(side, 2, 5)); lamp(...curb(side, 17, 5));        // a tile clear of each zebra's walk line
          if (R() < 0.4) curbProp('hydrant', ...curb(side, 8, 6), 3);
          if (R() < 0.35) curbProp('bin', ...curb(side, 4, 40), 4);
        }
      } else if (p === 'street' && grid) {
        for (const side of [-1, 1]) {
          for (const l of [3, 10, 17]) {
            const [x, y] = P(side < 0 ? 1 : 8, l + 0.5);
            if (R() < 0.75 && kAtPx(x, y) === KIND.VERGE) addTree(x, y, 'tree_a');
          }
          for (const l of [6, 14]) {
            // on the grass verge, clear of the traffic lane (lanes at 17 px off the centre line)
            const [x, y] = P(side < 0 ? 1.5 : 7.5, l);
            curbSpot({ x, y, ang: vert ? (side < 0 ? Math.PI : 0) : (side < 0 ? -Math.PI / 2 : Math.PI / 2), profile: p });
          }
          lamp(...curb(side, 7, 4));
          if (R() < 0.25) curbProp('hydrant', ...curb(side, 13, 5), 3);
        }
      } else if (p === 'rough' && grid) {
        for (const side of [-1, 1]) {
          for (const l of [5, 14]) {
            const [x, y] = P(side < 0 ? 1 : 8, l);           // on the gravel shoulder, clear of the lane (heavies too)
            curbSpot({ x, y, ang: vert ? (side < 0 ? Math.PI : 0) : (side < 0 ? -Math.PI / 2 : Math.PI / 2), profile: p });
          }
          lamp(...curb(side, 10, 4));
        }
      } else if (p === 'highway') {
        for (let l = 6; l < len - 3; l += 16) {
          for (const side of [-1, 1]) {
            const [x, y] = curb(side, l, 6);
            const k = kAtPx(x, y);
            if (!rec.gg && isTerrain(k) && k !== KIND.SAND) c.lamps.push({ x, y });
          }
        }
        if (len > 30) {
          const [x, y] = curb(1, 4, 8);
          if (isTerrain(kAtPx(x, y))) addProp('sign_speed', x, y, 2);
        }
      }
    }
    // intersections: traffic lights on avenues, stop signs on suburb streets
    for (const rec of net.recs) {
      if (rec.axis !== 'x' || !rec.grid || rec.arms < 3) continue;
      const x0 = T(rec.x), y0 = T(rec.y), x1 = T(rec.x + ROAD), y1 = T(rec.y + ROAD);
      if (rec.profile === 'avenue') {
        for (const [x, y, axis] of [[x0 - 6, y0 - 6, 'v'], [x1 + 6, y1 + 6, 'v'], [x0 - 6, y1 + 6, 'h'], [x1 + 6, y0 - 6, 'h']]) {
          if (kAtPx(x, y) !== KIND.WALK) continue;
          c.trafficLights.push({ x, y, axis });
          addObstacle(x, y, 3);
        }
      } else if (rec.profile === 'street') {
        for (const [x, y] of [[x0 + 10, y0 + 10], [x1 - 10, y1 - 10], [x0 + 10, y1 - 10], [x1 - 10, y0 + 10]]) {
          if (kAtPx(x, y) === KIND.VERGE) addProp('stop_sign', x, y, 2);
        }
      }
    }
    // hydrants and bins on downtown/suburb block corners, crate spots on single blocks
    for (const b of c.blocks) {
      if (b.kind === 'downtown' || b.kind === 'suburb') {
        if (R() < 0.4) { const x = T(b.x0 + 3), y = T(b.y1) - (b.ring >= 3 ? 10 : 5); if (kAtPx(x, y) === KIND.WALK) addProp('hydrant', x, y, 3); }
      }
      if (b.bx0 === b.bx1 && b.by0 === b.by1 && b.kind !== 'rural' && R() < 0.5) c.crateSpots.push({ x: T(b.x1) - 20, y: T(b.y0 + 12) });
      if (b.kind === 'rural' && R() < 0.4) c.crateSpots.push({ x: T(b.x0 + 2), y: T(b.y0 + 2) });
    }

    mark('furniture');
    // ================================================================ ANCHORS ==
    // spawn: south sidewalk of Central Park, the starter car in the bay below it,
    // and the one tank parked on the sidewalk beside it
    const parkB = c.blocks.find((b) => b.spawnPark);
    c.spawn = { x: T(parkB.x0 + 8.5), y: T(parkB.y1 - 1) + 4 };
    c.starterCar = { x: T(parkB.x0 + 8.5), y: T(parkB.y1) + 16, ang: -Math.PI / 2, model: 'sport' };
    c.tankSpot = { x: c.spawn.x + 100, y: T(parkB.y1 - 1.5), ang: Math.PI / 2 };
    {
      // gun-store door mats stay free of props, lamps, trees and parked cars too
      const clear = (o) => !(Math.abs(o.x - c.tankSpot.x) < 48 && Math.abs(o.y - c.tankSpot.y) < 34) && dist(o.x, o.y, c.starterCar.x, c.starterCar.y) > 30 && dist(o.x, o.y, c.spawn.x, c.spawn.y) > 20
        && c.gunshops.every((g) => dist(o.x, o.y, g.x, g.y) > 20);
      const gone = new Set(c.obstacles.filter((o) => !clear(o)));
      c.trees = c.trees.filter(clear); c.lamps = c.lamps.filter(clear);
      c.props = c.props.filter(clear); c.obstacles = c.obstacles.filter((o) => !gone.has(o));
      c.trafficLights = c.trafficLights.filter(clear);
      c.parked = c.parked.filter(clear); c.stalls = c.stalls.filter(clear); c.parkSpots = c.parkSpots.filter(clear);
      c.gunshops.sort((a, b) => a.id - b.id);
      const cap = (t) => t.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());
      for (const g of c.gunshops) {
        landmark(cap(g.name), g.x + Math.sin(g.ang) * 24, g.y - Math.cos(g.ang) * 24, { kind: 'gunshop', rect: { x: g.b.tx, y: g.b.ty, w: g.b.tw, h: g.b.th },
          what: `gun store ${g.id} (${g.area}): ${g.b.tw}x${g.b.th}, ${g.b.floors} floor(s), wall + roof gunshop, GUNS sign; door mat at tile (${Math.floor(g.x / TILE)}, ${Math.floor(g.y / TILE)}) facing ${['north', 'east', 'south', 'west'][Math.round(((g.ang / (Math.PI / 2)) % 4 + 4) % 4)]}` });
      }
    }
    for (const l of c.lamps) l.obstacle = addObstacle(l.x, l.y, 2, { breakable: 'lamp', lamp: l });

    // payphones: one per district (on a sidewalk), plus the farm towns and the airport
    const phone = (x, y, district) => { c.phones.push({ x, y, district }); addObstacle(x, y, 7); };
    for (const g of [G.major, G.side, G.main, G.iron]) {
      const cand = shuffle(g.blocks.filter((b) => b.bx0 === b.bx1 && b.by0 === b.by1 && (b.kind === 'downtown' || g === G.iron) && !b.spawnPark && b.type !== 'garagelot'));
      for (const b of cand) {
        const p = { x: T(b.x0 + 10), y: T(b.y1 - b.ring) + 4 };       // the inner edge of the sidewalk, off the walk line
        if (kAtPx(p.x, p.y) !== KIND.WALK || dist(p.x, p.y, c.spawn.x, c.spawn.y) < 120) continue;
        phone(p.x, p.y, g.name);
        break;
      }
    }
    for (const g of [G.north, G.west, G.south]) {
      const b = g.blocks.find((b2) => b2.phoneAt);
      if (b) phone(b.phoneAt.x, b.phoneAt.y, g.name);
    }
    phone(c.airportPhone.x, c.airportPhone.y, 'Pastel Airport');

    // parked cars: keep everything near the spawn, thin out the rest (performance)
    {
      const offWater = heliSpots.filter((h) => h.roof || (kAtPx(h.x, h.y) !== KIND.WATER && kAtPx(h.x, h.y) !== KIND.BUILDING));
      const clearOf = (s) => !offWater.some((h) => h.alt === 0 && dist(s.x, s.y, h.x, h.y) < 60);
      c.parked = c.parked.filter(clearOf);
      c.stalls = c.stalls.filter(clearOf);
      c.parkSpots = c.parkSpots.filter(clearOf);
      c.heliSpots = offWater;
      c.parked = c.parked.filter((s) => dist(s.x, s.y, c.starterCar.x, c.starterCar.y) > 70 && dist(s.x, s.y, c.tankSpot.x, c.tankSpot.y) > 70);
      c.parked = c.parked.concat(c.heliSpots);
    }
    // nothing that spawns a car or a crate may sit in the water or in a wall (roof helipads excepted)
    {
      const dry = (s) => { const k = kAtPx(s.x, s.y); return k !== KIND.WATER && k !== KIND.BUILDING; };
      const dryCar = (s) => s.roof || dry(s);
      c.crateSpots = c.crateSpots.filter(dry);
      c.roadSpots = c.roadSpots.filter(dry);
      c.parked = c.parked.filter(dryCar); c.stalls = c.stalls.filter(dryCar); c.parkSpots = c.parkSpots.filter(dryCar);
      c.heliSpots = c.heliSpots.filter(dryCar);
    }

    mark('anchors');
    // ============================================================ NAMES ==
    this.nameAreas(c, { G, GRIDS, AIRPORT, BEACH, MARINA, PORT, LAKES, ISLANDS, isSea, land, zone, streetMap, net, place });

    mark('names');
    // parked cars, thinned per district (needs the address maps)
    {
      // Far fewer parked cars (traffic fills the streets instead): ~130 in all. Landmark cars
      // (police, ambulances, PCTV vans) always stay; the rest keep a share per district and
      // kind of spot, at least one where there were any, spaced out so nothing clumps.
      // Street bays and driveways keep the least, lots, yards and farm machines more.
      const KEEP = { curb: 0.08, driveway: 0.1, stall: 0.2, yard: 0.3, fixed: 0.3 };
      const kindOf = (s) => (s.stall ? 'stall' : s.driveway ? 'driveway' : s.yard ? 'yard' : s.models ? 'fixed' : 'curb');
      const always = (s) => s.models && (s.models.includes('ambulance') || s.models.includes('police') || s.models[0] === 'van' && s.stall && s.models.length === 1);
      const groups = new Map();
      const heli = (s) => s.models && s.models[0] === 'helicopter';
      const kept = c.parked.filter((s) => always(s) && !heli(s));
      for (const s of c.parked) {
        if (always(s) || heli(s)) continue;
        const key = this.placeAt(s.x, s.y).district + '|' + kindOf(s);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
      }
      for (const [key, list] of groups) {
        const nearSpawn = list.filter((s) => dist(s.x, s.y, c.spawn.x, c.spawn.y) < 900).length > list.length / 2;
        const n = Math.max(1, Math.round(list.length * KEEP[key.split('|')[1]] * (nearSpawn ? 1.25 : 1)));
        const pool = shuffle(list.slice()), pick = [];
        for (const gap of [96, 0]) for (const s of pool) {
          if (pick.length >= n) break;
          if (!pick.includes(s) && !pick.some((q) => dist(s.x, s.y, q.x, q.y) < gap)) pick.push(s);
        }
        kept.push(...pick);
      }
      c.parked = kept.concat(c.parked.filter((s) => s.models && s.models[0] === 'helicopter'));
    }
    // ============================================================ PAINT SHOPS ==
    // Four paint & body garages (spec paintshop-v1 S1), placed last and without RNG so nothing
    // else moves: a 6x5 garage flush against a block's inner edge with its door facing the street,
    // and a 4-deep concrete apron between the door and the sidewalk. The bay (3x4 tiles, centred
    // on the door) is where a car parks nose-in. Only LOT/CONCRETE/PLAZA/LAWN tiles are
    // converted (resolveFrames draws no RNG for those, so tile variants elsewhere stay put).
    {
      const OPEN = new Set([KIND.LOT, KIND.CONCRETE, KIND.PLAZA, KIND.LAWN]);
      const FACE = { n: 0, e: Math.PI / 2, s: Math.PI, w: -Math.PI / 2 };
      const OUT = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
      const inPx = (o, r, m = 0) => o.x >= r.x0 - m && o.x < r.x1 + m && o.y >= r.y0 - m && o.y < r.y1 + m;
      const crosses = (l, r) => Math.max(l.x0, l.x1) >= r.x0 && Math.min(l.x0, l.x1) <= r.x1 && Math.max(l.y0, l.y1) >= r.y0 && Math.min(l.y0, l.y1) <= r.y1;
      const solidProps = () => [c.trees, c.lamps, c.props, c.talls, c.trafficLights, c.sprites, c.phones];
      // the site (tiles) for side `side` at offset `o` along the block's inner edge
      const site = (b, side, o) => {
        const A = b.A, D = 9, Wd = 6;
        const r = side === 'n' ? { x: A.x + o, y: A.y, w: Wd, h: D } : side === 's' ? { x: A.x + o, y: A.y + A.h - D, w: Wd, h: D }
          : side === 'w' ? { x: A.x, y: A.y + o, w: D, h: Wd } : { x: A.x + A.w - D, y: A.y + o, w: D, h: Wd };
        const bayT = side === 'n' ? { x: r.x, y: r.y, w: 6, h: 4 } : side === 's' ? { x: r.x, y: r.y + 5, w: 6, h: 4 }
          : side === 'w' ? { x: r.x, y: r.y, w: 4, h: 6 } : { x: r.x + 5, y: r.y, w: 4, h: 6 };
        const bld = side === 'n' ? { x: r.x, y: r.y + 4, w: 6, h: 5 } : side === 's' ? { x: r.x, y: r.y, w: 6, h: 5 }
          : side === 'w' ? { x: r.x + 4, y: r.y, w: 5, h: 6 } : { x: r.x, y: r.y, w: 5, h: 6 };
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (!OPEN.has(kindAt(x, y))) return null;
        // the driveway: from the apron's outer edge across the ring (and verge) to the asphalt
        const [dx, dy] = OUT[side];
        const v = dx === 0;
        const lo = v ? bayT.x + 1 : bayT.y + 1, hi = lo + 4;           // 4 tiles wide, the bay's width + a margin
        let t = v ? (dy < 0 ? bayT.y - 1 : bayT.y + bayT.h) : (dx < 0 ? bayT.x - 1 : bayT.x + bayT.w), n = 0;
        for (; n < 8; n++, t += v ? dy : dx) {
          let road = true;
          for (let u = lo; u < hi; u++) {
            const k = v ? kindAt(u, t) : kindAt(t, u);
            if (k === KIND.BUILDING || k === KIND.WATER || k === KIND.RAIL) return null;
            if (k !== KIND.ROAD) road = false;
          }
          if (road) break;
        }
        if (n === 8 || n === 0) return null;
        const tEnd = t - (v ? dy : dx);                                  // the last off-road tile
        const t0 = v ? (dy < 0 ? bayT.y : bayT.y + bayT.h - 1) : (dx < 0 ? bayT.x : bayT.x + bayT.w - 1);
        const a = Math.min(t0, tEnd), z = Math.max(t0, tEnd) + 1;
        const drive = v ? { x0: T(lo), y0: T(a), x1: T(hi), y1: T(z) } : { x0: T(a), y0: T(lo), x1: T(z), y1: T(hi) };
        const rect = { x0: T(r.x), y0: T(r.y), x1: T(r.x + r.w), y1: T(r.y + r.h) };
        if (solidProps().some((list) => list.some((p) => inPx(p, rect, 8)))) return null;
        if (c.walkLines.some((l) => crosses(l, rect))) return null;
        if (c.pens.some((p) => crosses(p, rect))) return null;
        if (c.trafficLights.some((p) => inPx(p, drive, 12)) || c.phones.some((p) => inPx(p, drive, 12))) return null;
        return { r, bayT, bld, drive, side };
      };
      const pickSite = (blocks, sides) => {
        for (const b of blocks) for (const side of sides) {
          const along = side === 'n' || side === 's' ? b.A.w : b.A.h;
          for (let o = along - 7; o >= 1; o--) { const s = site(b, side, o); if (s) return Object.assign(s, { b }); }
        }
        return null;
      };
      const nearCentre = (g) => (p, q) => dist((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, g.ox + g.w / 2, g.oy + g.h / 2) - dist((q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2, g.ox + g.w / 2, g.oy + g.h / 2);
      const single = (b) => b.bx0 === b.bx1 && b.by0 === b.by1;
      const plans = [
        [G.major, (b) => b.type === 'shops' && single(b) && b.gunshop === undefined, ['s', 'e', 'w']],
        [G.side, (b) => b.type === 'shops' && single(b) && b.gunshop === undefined, ['s', 'e', 'w']],
        [G.main, (b) => b.type === 'shops' && single(b) && b.gunshop === undefined, ['s', 'e', 'w']],
        [G.iron, (b) => (b.type === 'warehouse' || b.type === 'factory') && b.gunshop === undefined, ['s', 'w', 'e', 'n']],
      ];
      const tags = (Assets.sheets.walls || {}).tags || {}, rtags = (Assets.sheets.roofs || {}).tags || {};
      plans.forEach(([g, want, sides], id) => {
        const s = pickSite(g.blocks.filter(want).sort(nearCentre(g)), sides);
        if (!s) throw new Error('no paint shop site in ' + g.name);
        const { bayT, bld, drive, side, b } = s;
        // ground: the garage and a concrete apron in front of it
        for (let y = s.r.y; y < s.r.y + s.r.h; y++) for (let x = s.r.x; x < s.r.x + s.r.w; x++) setKind(x, y, KIND.CONCRETE, 0);
        for (let y = bld.y; y < bld.y + bld.h; y++) for (let x = bld.x; x < bld.x + bld.w; x++) { c.kind[I(x, y)] = KIND.BUILDING; c.solid[I(x, y)] = 1; }
        const bl = { tx: bld.x, ty: bld.y, tw: bld.w, th: bld.h, x: T(bld.x), y: T(bld.y), w: T(bld.w), h: T(bld.h),
          floors: 1, height: 32, wall: tags.wall_paintshop ? 'paintshop' : 'shedr', roof: flat(rtags.roof_paintshop ? 'paintshop' : 'teal'),
          lit: b.rg.lit, seed: 7919 * (id + 1), sign: 'PAINT', paintshop: id };
        c.buildings.push(bl);
        // the bay: 3 tiles across the door, the apron's 4 tiles deep (px)
        const v = side === 'n' || side === 's';
        const bay = v ? { x0: T(bayT.x + 1.5), y0: T(bayT.y), x1: T(bayT.x + 4.5), y1: T(bayT.y + 4) }
          : { x0: T(bayT.x), y0: T(bayT.y + 1.5), x1: T(bayT.x + 4), y1: T(bayT.y + 4.5) };
        const x = (bay.x0 + bay.x1) / 2, y = (bay.y0 + bay.y1) / 2;
        const ang = FACE[side] + Math.PI > Math.PI ? FACE[side] - Math.PI : FACE[side] + Math.PI;   // nose to the door
        const info = PAINT_SHOPS[id];
        c.paintshops.push({ id, name: info.name, area: info.area, district: this.placeAt(x, y).district, x, y, ang, bay, drive, b: bl });
        // keep the apron and the driveway clear: props, trees, lamps, parked cars and spots
        const zone = { x0: Math.min(T(s.r.x), drive.x0), y0: Math.min(T(s.r.y), drive.y0), x1: Math.max(T(s.r.x + s.r.w), drive.x1), y1: Math.max(T(s.r.y + s.r.h), drive.y1) };
        const [ox, oy] = OUT[side];
        const road = { x0: drive.x0 + Math.min(0, ox) * 48, y0: drive.y0 + Math.min(0, oy) * 48, x1: drive.x1 + Math.max(0, ox) * 48, y1: drive.y1 + Math.max(0, oy) * 48 };
        const clear = (o) => !inPx(o, zone, 6) && !inPx(o, road, 6);
        const gone = new Set(c.obstacles.filter((o) => !clear(o)));
        c.trees = c.trees.filter(clear); c.lamps = c.lamps.filter(clear); c.props = c.props.filter(clear);
        c.obstacles = c.obstacles.filter((o) => !gone.has(o));
        for (const k of ['parked', 'stalls', 'parkSpots', 'roadSpots', 'crateSpots']) c[k] = c[k].filter(clear);
        // a gate in any fence across the driveway
        const gate = { x0: drive.x0 - 4, y0: drive.y0 - 4, x1: drive.x1 + 4, y1: drive.y1 + 4 };
        c.paints = c.paints.flatMap((f) => {
          if (f.t !== 'fence' || !crosses(f, gate)) return [f];
          if (f.y0 === f.y1 && v) return [Object.assign({}, f, { x0: Math.min(f.x0, f.x1), x1: gate.x0 }), Object.assign({}, f, { x0: gate.x1, x1: Math.max(f.x0, f.x1) })].filter((q) => q.x1 - q.x0 > 4);
          if (f.x0 === f.x1 && !v) return [Object.assign({}, f, { y0: Math.min(f.y0, f.y1), y1: gate.y0 }), Object.assign({}, f, { y0: gate.y1, y1: Math.max(f.y0, f.y1) })].filter((q) => q.y1 - q.y0 > 4);
          return [f];
        });
        const out = { x: Math.round(x + ox * 40), y: Math.round(y + oy * 40) };      // just outside the bay, on the apron's edge
        const title = info.name.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());
        landmark(title, out.x, out.y, { kind: 'paintshop', rect: { x: bl.tx, y: bl.ty, w: bl.tw, h: bl.th },
          what: `paint shop ${id} (${info.area}): ${bl.tw}x${bl.th} garage, PAINT sign; bay x ${bay.x0}-${bay.x1}, y ${bay.y0}-${bay.y1} px, door facing ${{ n: 'north', e: 'east', s: 'south', w: 'west' }[side]}` });
        for (const k of [title, 'PAINT SHOP: ' + info.area, 'Paint Shop ' + (id + 1)]) c.places[k] = out;
      });
    }
    // extra camera spots for screenshots
    c.places['Bridge Tower'] = { x: T(TOWERS[0]) + 8, y: T(BRIDGE_Y + ROAD) + 40 };
    c.places['Gate Bridge South'] = { x: T(TOWERS[0] + 14), y: T(BRIDGE_Y + 17) };
    c.places['Port Cranes'] = { x: T(296), y: T(713) + 8 };
    c.places['Runway'] = { x: T(58), y: T(526) };
    c.places.Terminal = { x: T(102), y: T(575) };     // the gates (the neighbourhood's centre is lawn)
    c.places.Port = { x: T(300), y: T(713) + 8 };
    c.places.Heliport = { x: c.heliport.x, y: c.heliport.y + 40 };
    c.places['Hospital Helipad'] = { x: c.hospitalPad.x, y: c.hospitalPad.y + 40 };
    this.resolveFrames(c, R);
    mark('frames');
    this.buildLanes(c);
    mark('lanes');
    this.buildWalks(c);
    mark('walks');
    this.buildRoutes(c);
    mark('routes');
    return c;
  },

  // ================================================================ LANES ==
  // Traffic lane graph (spec docs/specs/traffic-v1.md B1), right-hand traffic.
  //   c.lanes: { id, x0, y0, x1, y1, dx, dy, len, zone, profile, from, to, stop, axis, off,
  //              street, yield, xings? }  one per travel direction per road edge; (x0,y0) ->
  //              (x1,y1) is the lane centreline in px, in the direction of travel. `stop` is
  //              where the car's front bumper stops (the avenue stop line, else 4 px before the
  //              box), null where nothing conflicts. `yield`: give way at an unsignalised node.
  //   c.nodes: { id, x, y, kind: 'int' | 'turn', signal, arms, profile, exits: [{ from, to,
  //              turn: 's'|'l'|'r'|'u', path: [[x, y], ...] }] }; a signalised node obeys
  //              Render.signalFrame(lane.axis). 'turn' = a U-turn loop (dead end, cul-de-sac).
  // Road edges are the straight runs between intersection boxes (collinear runs such as
  // Route 1 + Pastel Gate Bridge are one edge); cul-de-sac stems are edges too.
  buildLanes(c) {
    const n = this.net, W = n.W, H = n.H, ROAD = CITY.ROAD, HALF = ROAD * TILE / 2;
    const T = (t) => t * TILE;
    // lane centre offset from the centre line (px), per profile: the driving lane, clear of
    // the avenue parking bays (tiles 0-1, 7-8), the street and rough curb spots, and on the
    // highway the outer (right) lane of the two painted each way (inner lane: 16 px)
    const OFF = { avenue: 20, highway: 44, rough: 20, street: 17, dirt: 16, court: 16 };
    // U-turn loop radius (px): as wide as the band (dead ends) or the bulb (courts) allows
    // with a 28-px car inside it; centred on the edge's centre line so the lane runs into it
    const LOOP = 56;
    const r1 = (v) => Math.round(v * 10) / 10;
    const nodes = [], lanes = [], edges = [];
    const addNode = (x, y, kind, extra) => {
      const nd = Object.assign({ id: nodes.length, x: r1(x), y: r1(y), kind, signal: false, arms: 0, profile: null, exits: [] }, extra);
      nd._arms = [];
      nodes.push(nd);
      return nd;
    };
    const inN = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    const boxAt = (x, y) => (inN(x, y) ? n.box[y * W + x] : 0);
    const runAt = (axis, x, y) => (inN(x, y) && !n.box[y * W + x] ? (axis === 'v' ? n.v : n.h)[y * W + x] : 0);
    const boxNodes = new Map();
    const nodeOfBox = (id) => {
      let nd = boxNodes.get(id);
      if (!nd) {
        const B = n.recs[id - 1];
        nd = addNode(T(B.x) + HALF, T(B.y) + HALF, 'int', { profile: B.profile, box: { x: B.x, y: B.y } });
        boxNodes.set(id, nd);
      }
      return nd;
    };
    const before = (r) => (r.axis === 'v' ? [r.x + 4, r.y - 1] : [r.x - 1, r.y + 4]);
    const after = (r) => (r.axis === 'v' ? [r.x + 4, r.y + r.len] : [r.x + r.len, r.y + 4]);
    const zoneOf = (street, profile) => {
      const s = c.streets[street];
      return s && /^Airport /.test(s.name) ? 'airport' : PROFILE_ZONE[profile];
    };

    // ---- edges: chains of collinear runs between boxes
    n.recs.forEach((r) => {
      if (r.axis === 'x' || runAt(r.axis, ...before(r))) return;          // only chain heads
      const chain = [r];
      let last = r, nx;
      while ((nx = runAt(r.axis, ...after(last)))) { last = n.recs[nx - 1]; chain.push(last); }
      const vert = r.axis === 'v';
      const b0 = boxAt(...before(r)), b1 = boxAt(...after(last));
      edges.push({
        axis: r.axis, c: T(vert ? r.x : r.y) + HALF, a0: T(vert ? r.y : r.x), a1: T(vert ? last.y + last.len : last.x + last.len),
        profile: r.profile, street: r.street, stopLine: chain.length === 1 && !!r.grid && r.len === CITY.LOT && r.profile === 'avenue',
        n0: b0 ? nodeOfBox(b0) : null, n1: b1 ? nodeOfBox(b1) : null, recs: chain,
      });
    });
    // ---- cul-de-sac stems: from a box side to a loop around the bulb's tree
    for (const p of c.paints) {
      if (p.t !== 'culdesac' || !p.side) continue;
      const s = p.stem, vert = p.side === 'n' || p.side === 's';
      const out = { s: [s.x + 2, s.y + s.h], n: [s.x + 2, s.y - 1], e: [s.x + s.w, s.y + 2], w: [s.x - 1, s.y + 2] }[p.side];
      const b = boxAt(...out);
      if (!b) continue;
      // on the stem's centre line (the bulb can sit half a tile off it), level with the bulb
      const sc = T(vert ? s.x + 2 : s.y + 2), lat = Math.abs(sc - T(vert ? p.bulb.x : p.bulb.y));
      const loop = Math.min(64, T(p.r) - 16 - lat);
      const turn = addNode(vert ? sc : T(p.bulb.x), vert ? T(p.bulb.y) : sc, 'turn', { profile: 'court', loop });
      const box = nodeOfBox(b), toward = p.side === 's' || p.side === 'e';     // the box is at the high end
      const aBox = T(vert ? (toward ? s.y + s.h : s.y) : (toward ? s.x + s.w : s.x));
      const aBulb = T(vert ? p.bulb.y : p.bulb.x);
      edges.push({
        axis: vert ? 'v' : 'h', c: T(vert ? s.x + 2 : s.y + 2), a0: toward ? aBulb : aBox, a1: toward ? aBox : aBulb,
        profile: 'court', street: p.street,
        n0: toward ? turn : box, n1: toward ? box : turn, t0: toward ? turn : null, t1: toward ? null : turn, recs: [],
      });
    }
    // ---- dead ends: a U-turn loop inside the band, near its end
    for (const e of edges) {
      const vert = e.axis === 'v';
      if (!e.n0) { const a = e.a0 + LOOP + 16; e.n0 = e.t0 = addNode(vert ? e.c : a, vert ? a : e.c, 'turn', { profile: e.profile, loop: LOOP }); }
      if (!e.n1) { const a = e.a1 - LOOP - 16; e.n1 = e.t1 = addNode(vert ? e.c : a, vert ? a : e.c, 'turn', { profile: e.profile, loop: LOOP }); }
    }

    // ---- lanes, two per edge
    for (const e of edges) {
      const off = OFF[e.profile], vert = e.axis === 'v';
      const reach = (t) => Math.sqrt(t.loop * t.loop - off * off);
      const s0 = e.t0 ? (vert ? e.t0.y : e.t0.x) + reach(e.t0) : e.a0;
      const s1 = e.t1 ? (vert ? e.t1.y : e.t1.x) - reach(e.t1) : e.a1;
      const zone = zoneOf(e.street, e.profile);
      // level crossings on this edge (the railway is vertical, so only 'h' runs cross it)
      const xs = [];
      if (!vert) {
        const ty = Math.floor(e.c / TILE);
        let prev = false;
        for (let tx = Math.floor(s0 / TILE); tx < Math.ceil(s1 / TILE); tx++) {
          const on = inN(tx, ty) && n.rail[ty * W + tx] > 0;
          if (on && !prev) xs.push(T(tx) + 2 * TILE);
          prev = on;
        }
      }
      const pair = [];
      for (const dir of [1, -1]) {
        const dx = vert ? 0 : dir, dy = vert ? dir : 0;
        const ac = e.c + (vert ? -dy : dx) * off;        // right-hand side of the travel direction
        const a = dir > 0 ? s0 : s1, b = dir > 0 ? s1 : s0;
        const P = (t) => (vert ? [r1(ac), r1(t)] : [r1(t), r1(ac)]);
        const [x0, y0] = P(a), [x1, y1] = P(b);
        const from = dir > 0 ? e.n0 : e.n1, to = dir > 0 ? e.n1 : e.n0;
        const L = { id: lanes.length, x0, y0, x1, y1, dx, dy, len: Math.abs(b - a), zone, profile: e.profile, from: from.id, to: to.id,
          stop: null, axis: e.axis, off, street: e.street, yield: false };
        if (xs.length) L.xings = xs.map((t) => ({ x: vert ? r1(ac) : t, y: vert ? t : r1(ac) }));
        L._e = e;
        lanes.push(L);
        pair.push(L);
      }
      const [F, B] = pair;
      e.n0._arms.push({ in: B, out: F, e });
      e.n1._arms.push({ in: F, out: B, e });
    }

    // ---- signals: avenue boxes with 3+ arms that kept their traffic lights
    const lit = new Set();
    for (const s of c.trafficLights) {
      for (const [ox, oy] of [[8, 8], [-8, -8], [8, -8], [-8, 8]]) {
        const b = boxAt(Math.floor((s.x + ox) / TILE), Math.floor((s.y + oy) / TILE));
        if (b) lit.add(b);
      }
    }
    for (const [id, nd] of boxNodes) nd.signal = lit.has(id) && nd.profile === 'avenue' && nd._arms.length >= 3;

    // ---- exits
    const loopPath = (nd, L, M) => {
      // around the node counter-clockwise on screen (right-hand traffic keeps the centre on its left)
      const R = nd.loop || LOOP;
      const rx = -L.dy, ry = L.dx, q = Math.sqrt(Math.max(0, R * R - L.off * L.off));
      const ang = (x, y) => Math.atan2(y - nd.y, x - nd.x);
      const tIn = ang(nd.x + rx * L.off - L.dx * q, nd.y + ry * L.off - L.dy * q);
      let tOut = ang(nd.x - rx * M.off - L.dx * q, nd.y - ry * M.off - L.dy * q);
      while (tOut >= tIn) tOut -= Math.PI * 2;
      const pts = [[L.x1, L.y1]];
      const steps = Math.max(4, Math.ceil((tIn - tOut) / 0.4));
      for (let k = 0; k <= steps; k++) {
        const t = tIn + (tOut - tIn) * (k / steps);
        pts.push([r1(nd.x + Math.cos(t) * R), r1(nd.y + Math.sin(t) * R)]);
      }
      pts.push([M.x0, M.y0]);
      return pts.filter((p, k) => k === 0 || Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) > 0.5);
    };
    const curve = (L, M) => {
      const P0 = [L.x1, L.y1], P3 = [M.x0, M.y0];
      if (L.dx * M.dx + L.dy * M.dy > 0.5) return [P0, P3];               // straight on
      const Q = L.dx === 0 ? [P0[0], P3[1]] : [P3[0], P0[1]];             // where the two lane lines meet
      const pts = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6, u = 1 - t;
        pts.push([r1(u * u * P0[0] + 2 * u * t * Q[0] + t * t * P3[0]), r1(u * u * P0[1] + 2 * u * t * Q[1] + t * t * P3[1])]);
      }
      return pts;
    };
    for (const nd of nodes) {
      const A = nd._arms;
      nd.arms = A.length;
      if (A.length === 1) {
        nd.kind = 'turn';
        if (!nd.loop) nd.loop = LOOP;
        nd.exits.push({ from: A[0].in.id, to: A[0].out.id, turn: 'u', path: loopPath(nd, A[0].in, A[0].out) });
        continue;
      }
      for (const a of A) for (const b of A) {
        if (a === b) continue;
        const L = a.in, M = b.out, dot = L.dx * M.dx + L.dy * M.dy;
        if (dot < -0.5) continue;                     // never into a lane coming back at us
        const turn = dot > 0.5 ? 's' : L.dx * M.dy - L.dy * M.dx > 0 ? 'r' : 'l';
        nd.exits.push({ from: L.id, to: M.id, turn, path: curve(L, M) });
      }
      // stop points and right of way (only where traffic can cross: 3+ arms)
      if (A.length < 3) continue;
      const ranks = A.map((a) => RANK[a.e.profile]);
      const top = Math.max(...ranks), nTop = ranks.filter((r) => r === top).length;
      for (const a of A) {
        const L = a.in;
        const back = a.e.stopLine ? 3 * TILE : 4;
        L.stop = { x: r1(L.x1 - L.dx * back), y: r1(L.y1 - L.dy * back) };
        L.yield = !nd.signal && !(nTop === 2 && nTop < A.length && RANK[a.e.profile] === top);
      }
    }
    for (const nd of nodes) delete nd._arms;
    for (const L of lanes) delete L._e;
    c.lanes = lanes;
    c.nodes = nodes;

    // ---- spatial index: 128-px cells, each lists the lanes within 24 px of it
    const CS = 128, gx = Math.ceil((W * TILE) / CS), gy = Math.ceil((H * TILE) / CS);
    const cells = new Array(gx * gy);
    for (const L of lanes) {
      const m = 24;
      const cx0 = clamp(Math.floor((Math.min(L.x0, L.x1) - m) / CS), 0, gx - 1), cx1 = clamp(Math.floor((Math.max(L.x0, L.x1) + m) / CS), 0, gx - 1);
      const cy0 = clamp(Math.floor((Math.min(L.y0, L.y1) - m) / CS), 0, gy - 1), cy1 = clamp(Math.floor((Math.max(L.y0, L.y1) + m) / CS), 0, gy - 1);
      for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) (cells[y * gx + x] || (cells[y * gx + x] = [])).push(L);
    }
    this.laneIndex = { CS, gx, gy, cells, seen: new Uint32Array(lanes.length), tick: 0, lanes, nodes };
  },

  // Distance (px) from (x, y) to lane L's centreline segment.
  laneDist(L, x, y) {
    const vx = L.x1 - L.x0, vy = L.y1 - L.y0, l2 = vx * vx + vy * vy;
    const t = l2 ? clamp(((x - L.x0) * vx + (y - L.y0) * vy) / l2, 0, 1) : 0;
    return Math.hypot(x - (L.x0 + vx * t), y - (L.y0 + vy * t));
  },

  // The nearest lane within r px (default 24) of a world point, or null. With (dx, dy) set,
  // only lanes heading that way (dot >= 0) count.
  laneAt(x, y, r = 24, dx = 0, dy = 0) {
    const X = this.laneIndex;
    if (!X) return null;
    const cx = Math.floor(x / X.CS), cy = Math.floor(y / X.CS);
    if (cx < 0 || cy < 0 || cx >= X.gx || cy >= X.gy) return null;
    const list = X.cells[cy * X.gx + cx];
    if (!list) return null;
    let best = null, bd = r;
    for (const L of list) {
      if ((dx || dy) && L.dx * dx + L.dy * dy < 0) continue;
      const d = this.laneDist(L, x, y);
      if (d <= bd) { bd = d; best = L; }
    }
    return best;
  },

  // Every lane that passes within 24 px of the rect (px); `out` is reused if given.
  lanesIn(x0, y0, x1, y1, out = []) {
    const X = this.laneIndex;
    out.length = 0;
    if (!X) return out;
    const tick = ++X.tick;
    if (tick > 0xfffffff0) { X.seen.fill(0); X.tick = 1; }
    const a = clamp(Math.floor(x0 / X.CS), 0, X.gx - 1), b = clamp(Math.floor(x1 / X.CS), 0, X.gx - 1);
    const cy0 = clamp(Math.floor(y0 / X.CS), 0, X.gy - 1), cy1 = clamp(Math.floor(y1 / X.CS), 0, X.gy - 1);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = a; cx <= b; cx++) {
      const list = X.cells[cy * X.gx + cx];
      if (list) for (const L of list) if (X.seen[L.id] !== X.tick) { X.seen[L.id] = X.tick; out.push(L); }
    }
    return out;
  },

  // Debug overlay (for #demo&lanes): draws lanes, stop points, nodes and their exit paths
  // inside the world rect, in WORLD coordinates: set the canvas transform first
  // (ctx.translate(-cam.x, -cam.y) with the zoom applied), then call it.
  drawLanes(ctx, x0, y0, x1, y1, px = 1) {
    const X = this.laneIndex;
    if (!X) return;
    const ZC = { downtown: '#ff5ca8', suburbs: '#6fd36f', industrial: '#ffb347', rural: '#d8c36a', highway: '#5ab4ff', airport: '#c792ff', wild: '#aaaaaa' };
    const TC = { s: 'rgba(255,255,255,0.5)', r: 'rgba(120,255,160,0.7)', l: 'rgba(255,170,90,0.7)', u: 'rgba(255,90,255,0.8)' };
    ctx.save();
    const lanes = this.lanesIn(x0, y0, x1, y1);
    const seen = new Set();
    for (const L of lanes) {
      ctx.strokeStyle = ZC[L.zone] || '#fff'; ctx.lineWidth = 2 * px;
      ctx.beginPath(); ctx.moveTo(L.x0, L.y0); ctx.lineTo(L.x1, L.y1); ctx.stroke();
      // chevrons every 64 px show the direction of travel
      ctx.beginPath();
      for (let d = 32; d < L.len; d += 64) {
        const x = L.x0 + L.dx * d, y = L.y0 + L.dy * d, rx = -L.dy, ry = L.dx;
        ctx.moveTo(x - L.dx * 6 + rx * 5, y - L.dy * 6 + ry * 5); ctx.lineTo(x, y); ctx.lineTo(x - L.dx * 6 - rx * 5, y - L.dy * 6 - ry * 5);
      }
      ctx.stroke();
      if (L.stop) {
        ctx.strokeStyle = L.yield ? '#ffe45c' : '#ff3b3b'; ctx.lineWidth = 3 * px;
        const rx = -L.dy * 10, ry = L.dx * 10;
        ctx.beginPath(); ctx.moveTo(L.stop.x - rx, L.stop.y - ry); ctx.lineTo(L.stop.x + rx, L.stop.y + ry); ctx.stroke();
      }
      for (const id of [L.from, L.to]) {
        if (seen.has(id)) continue;
        seen.add(id);
        const nd = X.nodes[id];
        for (const ex of nd.exits) {
          ctx.strokeStyle = TC[ex.turn]; ctx.lineWidth = 1 * px;
          ctx.beginPath(); ctx.moveTo(ex.path[0][0], ex.path[0][1]);
          for (const p of ex.path) ctx.lineTo(p[0], p[1]);
          ctx.stroke();
        }
        ctx.fillStyle = nd.kind === 'turn' ? '#ff5aff' : nd.signal ? '#3bff6a' : '#ffffff';
        ctx.fillRect(nd.x - 5 * px, nd.y - 5 * px, 10 * px, 10 * px);
      }
    }
    ctx.restore();
  },

  // ================================================================ WALKS ==
  // Pedestrian walk graph (spec docs/specs/peds-v1.md §4). Built last, with no RNG.
  //   c.walks: { id, x0, y0, x1, y1, len, zone, from, to, xing? }  axis-aligned segments in px,
  //            x0 <= x1 and y0 <= y1; from/to = walk node ids at (x0, y0) / (x1, y1).
  //            xing = { node, axis } on the road part of a crossing: `axis` is the axis of the
  //            road being crossed (a horizontal crossing crosses a 'v' road); `node` is the lane
  //            node (c.nodes) whose Render.signalFrame(axis) runs that road: cross while it is
  //            red (0). node null = unsignalised: look for cars. Crossing edges end at the kerb.
  //   c.walkNodes: { id, x, y, edges: [walk ids] }
  // Sources: the centre line of every block's sidewalk ring; zebra crossings at both ends of
  // avenue grid runs (their junction's lights), one unsignalised corner crossing per street
  // and rough grid run; court mouths; the plaza walks, the boardwalk, the terminal kerb, farm
  // tracks and farm-town paths (c.walkLines). Lines are split where they meet (T-junctions),
  // cut where they would cross water, buildings, bridges, highways or level crossings, and
  // their road stretches become crossings; crossings left hanging are dropped.
  buildWalks(c) {
    const n = this.net, W = n.W, H = n.H, ROAD = CITY.ROAD;
    const T = (t) => t * TILE;
    const lines = [];
    const add = (x0, y0, x1, y1, extra) => {
      if (x0 !== x1 && y0 !== y1) return;
      if (x0 > x1) [x0, x1] = [x1, x0];
      if (y0 > y1) [y0, y1] = [y1, y0];
      if (x1 - x0 + y1 - y0 < 1) return;
      lines.push(Object.assign({ x0, y0, x1, y1, cross: false, conn: false, sig: null }, extra));
    };
    // ---- sidewalk rings
    for (const b of c.blocks) {
      if (!b.ring) continue;
      const h = b.ring * 8, X0 = T(b.x0) + h, X1 = T(b.x1) - h, Y0 = T(b.y0) + h, Y1 = T(b.y1) - h;
      add(X0, Y0, X1, Y0); add(X0, Y1, X1, Y1); add(X0, Y0, X0, Y1); add(X1, Y0, X1, Y1);
    }
    // ---- crossings over grid runs (block ring to block ring)
    const nodeAtBox = new Map();
    for (const nd of c.nodes || []) if (nd.box) nodeAtBox.set(nd.box.x + ',' + nd.box.y, nd);
    for (const r of n.recs) {
      if (!r.grid || r.axis === 'x' || r.len !== r.grid.lot) continue;
      if (r.profile !== 'avenue' && r.profile !== 'street' && r.profile !== 'rough') continue;
      const g = r.grid, vert = r.axis === 'v';
      const own = (bx, by) => (bx < 0 || by < 0 || bx >= g.nx || by >= g.ny ? -1 : g.owner[by * g.nx + bx]);
      const ia = vert ? own(r.gi - 1, r.gj) : own(r.gi, r.gj - 1), ib = own(r.gi, r.gj);
      if (ia < 0 || ib < 0) continue;
      const A = g.blocks[ia], B = g.blocks[ib];
      if (!A.ring || !B.ring) continue;
      const d = Math.max(A.ring, B.ring) * 8;        // on the zebra (avenue: 24 px into its 32)
      const nd0 = nodeAtBox.get(vert ? r.x + ',' + (r.y - ROAD) : (r.x - ROAD) + ',' + r.y);
      const nd1 = nodeAtBox.get(vert ? r.x + ',' + (r.y + r.len) : (r.x + r.len) + ',' + r.y);
      let ends;
      if (r.profile === 'avenue') ends = [0, 1];
      else {
        // one corner per street: the busier junction's end
        const a0 = nd0 ? nd0.arms : 0, a1 = nd1 ? nd1.arms : 0;
        ends = [a0 > a1 ? 0 : a1 > a0 ? 1 : (r.gi + r.gj) & 1];
      }
      const p0 = T(vert ? r.x : r.y) - A.ring * 8, p1 = T((vert ? r.x : r.y) + ROAD) + B.ring * 8;
      for (const e of ends) {
        const at = e === 0 ? T(vert ? r.y : r.x) + d : T(vert ? r.y + r.len : r.x + r.len) - d;
        const nd = e === 0 ? nd0 : nd1;
        const sig = r.profile === 'avenue' && nd && nd.signal ? nd.id : null;
        if (vert) add(p0, at, p1, at, { cross: true, sig }); else add(at, p0, at, p1, { cross: true, sig });
      }
    }
    for (const l of c.walkLines || []) add(l.x0, l.y0, l.x1, l.y1, { conn: !!l.conn });
    delete c.walkLines;

    // ---- split lines at the endpoints of other lines that land on them (T-junctions)
    const byX = new Map(), byY = new Map();
    const pt = (m, k, v) => { let a = m.get(k); if (!a) m.set(k, (a = [])); a.push(v); };
    for (const l of lines) for (const [x, y] of [[l.x0, l.y0], [l.x1, l.y1]]) { pt(byX, x, y); pt(byY, y, x); }
    const pieces = [];
    for (const l of lines) {
      const vert = l.x0 === l.x1;
      const a0 = vert ? l.y0 : l.x0, a1 = vert ? l.y1 : l.x1;
      const cuts = [...new Set((vert ? byX.get(l.x0) : byY.get(l.y0)) || [])].filter((a) => a > a0 && a < a1).sort((p, q) => p - q);
      let s = a0;
      for (const a of cuts.concat([a1])) {
        pieces.push(Object.assign({}, l, vert ? { y0: s, y1: a } : { x0: s, x1: a }));
        s = a;
      }
    }

    // ---- cut at bad ground; road stretches become crossings
    const OK = 0, RD = 1, BAD = 2;
    const cls = (tx, ty) => {
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) return BAD;
      const i = ty * W + tx, k = c.kind[i];
      if (k === KIND.WATER || k === KIND.BUILDING || k === KIND.BRIDGE || c.solid[i]) return BAD;
      if (k !== KIND.ROAD && k !== KIND.DIRT && k !== KIND.VERGE && k !== KIND.MEADOW) return OK;
      const r = this.roadAt(tx, ty);
      if (r && (r.profile === 'highway' || r.xing)) return BAD;
      if (k === KIND.ROAD) return RD;                  // grid roads, court stems and bulbs
      return r && k === KIND.DIRT ? RD : OK;           // dirt road (farm tracks are DIRT off the network)
    };
    const edges = [];
    for (const l of pieces) {
      const vert = l.x0 === l.x1, cA = vert ? l.x0 : l.y0;
      const a0 = vert ? l.y0 : l.x0, a1 = vert ? l.y1 : l.x1;
      const la = Math.floor((cA - 4) / TILE), lb = Math.floor((cA + 4) / TILE);
      const runs = [];
      for (let t = Math.floor(a0 / TILE); T(t) < a1; t++) {
        let k = OK;
        for (let q = la; q <= lb; q++) k = Math.max(k, vert ? cls(q, t) : cls(t, q));
        const s = Math.max(a0, T(t)), e = Math.min(a1, T(t + 1));
        const last = runs[runs.length - 1];
        if (last && last.k === k) last.e = e; else runs.push({ k, s, e });
      }
      if (l.cross && runs.some((u) => u.k === BAD)) continue;       // a crossing goes all the way or not at all
      for (const u of runs) {
        if (u.k === BAD || u.e - u.s < 2) continue;
        const ed = { x0: vert ? cA : u.s, y0: vert ? u.s : cA, x1: vert ? cA : u.e, y1: vert ? u.e : cA, conn: l.cross || l.conn, xing: null };
        if (u.k === RD) ed.xing = { node: l.cross ? l.sig : null, axis: vert ? 'h' : 'v' };
        edges.push(ed);
      }
    }

    // ---- nodes; drop crossings and connectors left hanging, then tiny islands
    const nodes = new Map();
    const key = (x, y) => Math.round(x * 2) + ',' + Math.round(y * 2);
    const nodeAt = (x, y) => { const k = key(x, y); let nd = nodes.get(k); if (!nd) nodes.set(k, (nd = { x, y, e: new Set() })); return nd; };
    for (const ed of edges) { ed.a = nodeAt(ed.x0, ed.y0); ed.b = nodeAt(ed.x1, ed.y1); ed.a.e.add(ed); ed.b.e.add(ed); }
    const drop = (ed) => { ed.gone = true; ed.a.e.delete(ed); ed.b.e.delete(ed); };
    for (let again = true; again;) {
      again = false;
      for (const ed of edges) if (!ed.gone && (ed.xing || ed.conn) && (ed.a.e.size < 2 || ed.b.e.size < 2)) { drop(ed); again = true; }
    }
    {
      const seen = new Set();
      for (const ed of edges) {
        if (ed.gone || seen.has(ed)) continue;
        const comp = [], stack = [ed];
        seen.add(ed);
        while (stack.length) {
          const e = stack.pop();
          comp.push(e);
          for (const nd of [e.a, e.b]) for (const f of nd.e) if (!seen.has(f)) { seen.add(f); stack.push(f); }
        }
        if (comp.reduce((s, e) => s + e.x1 - e.x0 + e.y1 - e.y0, 0) < 64) for (const e of comp) drop(e);
      }
    }
    // ---- merge straight runs through plain 2-edge nodes (T-junction cuts left unused)
    for (const nd of nodes.values()) {
      if (nd.e.size !== 2) continue;
      const [p, q] = [...nd.e];
      if (p.xing || q.xing) continue;
      const pv = p.x0 === p.x1, qv = q.x0 === q.x1;
      if (pv !== qv) continue;
      const lo = pv ? (p.y0 < q.y0 ? p : q) : (p.x0 < q.x0 ? p : q), hi = lo === p ? q : p;
      const m = { x0: lo.x0, y0: lo.y0, x1: hi.x1, y1: hi.y1, a: lo.a, b: hi.b, conn: false, xing: null };
      drop(p); drop(q);
      m.a.e.add(m); m.b.e.add(m);
      edges.push(m);
    }
    // ---- output
    const walks = [], walkNodes = [];
    const r1 = (v) => Math.round(v * 10) / 10;
    for (const nd of nodes.values()) {
      if (!nd.e.size) continue;
      nd.id = walkNodes.length;
      walkNodes.push({ id: nd.id, x: r1(nd.x), y: r1(nd.y), edges: [] });
    }
    for (const ed of edges) {
      if (ed.gone) continue;
      const w = { id: walks.length, x0: r1(ed.x0), y0: r1(ed.y0), x1: r1(ed.x1), y1: r1(ed.y1), len: r1(ed.x1 - ed.x0 + ed.y1 - ed.y0),
        zone: this.regionAt((ed.x0 + ed.x1) / 2, (ed.y0 + ed.y1) / 2).zone, from: ed.a.id, to: ed.b.id };
      if (ed.xing) w.xing = ed.xing;
      walks.push(w);
      walkNodes[w.from].edges.push(w.id);
      walkNodes[w.to].edges.push(w.id);
    }
    c.walks = walks;
    c.walkNodes = walkNodes;

    // ---- spatial index: 128-px cells, each lists the walks within 16 px of it
    const CS = 128, gx = Math.ceil((W * TILE) / CS), gy = Math.ceil((H * TILE) / CS), m = 16;
    const cells = new Array(gx * gy);
    for (const w of walks) {
      const cx0 = clamp(Math.floor((w.x0 - m) / CS), 0, gx - 1), cx1 = clamp(Math.floor((w.x1 + m) / CS), 0, gx - 1);
      const cy0 = clamp(Math.floor((w.y0 - m) / CS), 0, gy - 1), cy1 = clamp(Math.floor((w.y1 + m) / CS), 0, gy - 1);
      for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) (cells[y * gx + x] || (cells[y * gx + x] = [])).push(w);
    }
    this.walkIndex = { CS, gx, gy, cells, seen: new Uint32Array(walks.length), tick: 0, walks, nodes: walkNodes, pens: c.pens, tmp: [] };
  },

  // ================================================================ ROUTES ==
  // Moving-parts data for the Flights and Cranes systems (spec docs/specs/ambient-v1.md), all px,
  // no RNG. Angles: 0 = north (up), clockwise, like every sprite.
  //   c.airport = { runway: { x0, y0, x1, y1, cx, heading }, approach: { from, touchdown, rollEnd },
  //     depart: { lineup, rotate, climb }, stands: [{ id, kind, x, y, ang, tag, sprite, obstacles }],
  //     taxi: { in: { id: path }, out: { id: path }, push: { id: path } } }
  //   Arrivals fly north up the centre line (from -> touchdown -> rollEnd), then taxi.in[id] from
  //   rollEnd to the stand (nose in). Departures: taxi.push[id] (reversing; [] = none), then
  //   taxi.out[id] from the push end to depart.lineup at the runway's south end, then the roll north
  //   (rotate, climb). Paths are points <= 32 px apart with fillets of radius 96 (props 60) at every
  //   corner. The 'runway' stand (the airliner lined up at start) has no taxi.in: it leaves first.
  //   c.port = { rail: { y, x0, x1 }, cranes: [{ id, x, y, bays, bayMin, bayMax, sprite, legs }],
  //     ship: { x, y, ang, slots: [{ x, y, ang, bay, row }] }, quaySlots: [{ x, y, ang }] }
  // Plane and crane sprites stay in c.sprites with `dyn` set (drawn statically until the new
  // systems filter them out); their obstacles carry `plane: standId` / `crane: craneId`.
  buildRoutes(c) {
    const T = (t) => t * TILE, r1 = (v) => Math.round(v * 10) / 10;
    const path = (pts, R) => {
      const out = [];
      const push = (x, y) => { const l = out[out.length - 1]; if (!l || Math.hypot(x - l[0], y - l[1]) > 1) out.push([r1(x), r1(y)]); };
      const line = (ax, ay, bx, by) => { const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 32)); for (let k = 1; k <= n; k++) push(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n); };
      push(pts[0][0], pts[0][1]);
      let cur = pts[0];
      for (let i = 1; i < pts.length; i++) {
        const A = pts[i - 1], P = pts[i], N = pts[i + 1];
        if (!N) { line(cur[0], cur[1], P[0], P[1]); break; }
        const lin = Math.hypot(P[0] - A[0], P[1] - A[1]), lout = Math.hypot(N[0] - P[0], N[1] - P[1]);
        const din = [(P[0] - A[0]) / lin, (P[1] - A[1]) / lin], dout = [(N[0] - P[0]) / lout, (N[1] - P[1]) / lout];
        const r = Math.min(R, i === 1 ? lin : lin / 2, i + 1 === pts.length - 1 ? lout : lout / 2);
        const a = [P[0] - din[0] * r, P[1] - din[1] * r], b = [P[0] + dout[0] * r, P[1] + dout[1] * r];
        line(cur[0], cur[1], a[0], a[1]);
        const cx = a[0] + dout[0] * r, cy = a[1] + dout[1] * r;           // quarter-circle fillet
        const t0 = Math.atan2(a[1] - cy, a[0] - cx);
        let dt = Math.atan2(b[1] - cy, b[0] - cx) - t0;
        while (dt > Math.PI) dt -= 2 * Math.PI; while (dt < -Math.PI) dt += 2 * Math.PI;
        const n = Math.max(3, Math.ceil((Math.abs(dt) * r) / 16));
        for (let k = 1; k <= n; k++) push(cx + Math.cos(t0 + (dt * k) / n) * r, cy + Math.sin(t0 + (dt * k) / n) * r);
        cur = b;
      }
      return out;
    };
    // ---- airport
    const air = c._air;
    if (air && c._planes) {
      const RW = air.RW, CX = T(RW.x) + T(RW.w) / 2;
      const TWX = T(air.TW.x + air.TW.w / 2), TLX = T(air.AP.x + 5.5);         // taxiway / apron taxilane centre lines
      const LM = T(air.links[1] + 5.5), LS = T(air.links[2] + 5.5);           // mid and south exit links
      const ROLL = LM + 106, LINEUP = T(RW.y + RW.h) - 548, R = 96, RP = 60;
      const runway = { x0: T(RW.x), y0: T(RW.y), x1: T(RW.x + RW.w), y1: T(RW.y + RW.h), cx: CX, heading: 0 };
      const approach = { from: [CX, T(RW.y + RW.h) + 1150], touchdown: [CX, T(RW.y + RW.h) - 248], rollEnd: [CX, ROLL] };
      const depart = { lineup: [CX, LINEUP], rotate: [CX, T(RW.y + RW.h) - 1948], climb: [CX, T(RW.y) - 800] };
      const toRunway = [[TWX, LS], [CX, LS], [CX, LINEUP]];
      const stands = [], tin = {}, tout = {}, tpush = {};
      const kinds = ['gate', 'gate', 'gate', 'remote', 'prop', 'prop', 'runway'];
      c._planes.forEach((pl, id) => {
        const kind = kinds[id] || 'remote';
        const obstacles = pl.obstacles.filter((o) => c.obstacles.includes(o));
        for (const o of obstacles) o.plane = id;
        stands.push({ id, kind, x: pl.x, y: pl.y, ang: pl.ang, tag: pl.tag, sprite: pl.sprite, obstacles });
        pl.sprite.stand = id;
        const { x, y } = pl;
        const head = [[CX, ROLL], [CX, LM], [TWX, LM]];
        if (kind === 'gate') {
          tin[id] = path(head.concat([[TWX, y - 220], [TLX, y - 220], [TLX, y], [x, y]]), R);
          tpush[id] = path([[x, y], [TLX, y], [TLX, y - 110]], R);
          tout[id] = path([[TLX, y - 110], [TLX, 10240], [TWX, 10240]].concat(toRunway), R);
        } else if (kind === 'remote') {
          tin[id] = path(head.concat([[TWX, y + 220], [x, y + 220], [x, y]]), R);
          tpush[id] = path([[x, y], [x, y + 96], [x + 96, y + 96]], R);
          tout[id] = path([[x + 96, y + 96], [TWX, y + 96]].concat(toRunway), R);
        } else if (kind === 'prop' && Math.abs(pl.ang + Math.PI / 2) < 0.1) {          // parked nose west
          tin[id] = path(head.concat([[TWX, y - 134], [x + 124, y - 134], [x + 124, y], [x, y]]), RP);
          tpush[id] = [];
          tout[id] = path([[x, y], [x - 96, y], [x - 96, y - 134], [TWX, y - 134]].concat(toRunway), RP);
        } else if (kind === 'prop') {                                                    // parked nose north
          tin[id] = path(head.concat([[TWX, y + 104], [x, y + 104], [x, y]]), RP);
          tpush[id] = [];
          tout[id] = path([[x, y], [x, y - 166], [TWX, y - 166]].concat(toRunway), RP);
        } else {
          // the airliner lined up at the north end, nose south: backtrack down the runway, turn
          // round in a 96-px teardrop at the south end and stop at the line-up point
          tpush[id] = [];
          const pts = [];
          const add = (px, py) => pts.push([r1(px), r1(py)]);
          for (let yy = y; yy < 10500; yy += 32) add(CX, yy);
          const sBend = (x0, y0, x1, y1) => { for (let k = 0; k <= 12; k++) { const t = k / 12; add(x0 + ((x1 - x0) * (1 - Math.cos(Math.PI * t))) / 2, y0 + (y1 - y0) * t); } };
          sBend(CX, 10500, CX - R, 10760);
          for (let yy = 10792; yy < 11000; yy += 32) add(CX - R, yy);
          add(CX - R, 11000);
          for (let k = 1; k <= 12; k++) { const t = Math.PI - (Math.PI * k) / 12; add(CX + Math.cos(t) * R, 11000 + Math.sin(t) * R); }
          for (let yy = 10968; yy > 10960; yy -= 32) add(CX + R, yy);
          sBend(CX + R, 10960, CX, LINEUP);
          tout[id] = pts.filter((p, k) => k === 0 || Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) > 1);
        }
      });
      c.airport = { runway, approach, depart, stands, taxi: { in: tin, out: tout, push: tpush } };
    }
    // ---- port: crane rails on the main quay, deck slots matching ships:container_ship's painted
    // grid (8 bays at 80 px x 6 rows at 28 px, 72 x 27 containers, measured on the art rotated to
    // bow east), quay slots on the apron under the booms, between the bollards
    if (c._cranes && c._ship) {
      const S = c._ship, slots = [];
      const bayX = [], rowY = [];
      for (let k = 0; k < 8; k++) bayX.push(r1(S.x + 206 - 488 + 80 * k));
      for (let r = 0; r < 6; r++) rowY.push(r1(S.y + 25.5 - 96 + 28 * r));
      bayX.forEach((x, bay) => rowY.forEach((y, row) => slots.push({ x, y, ang: S.ang, bay, row })));
      const railY = c._cranes[0].legs[0].y;
      const rail = { y: railY, x0: T(268), x1: T(332) };
      const groups = [[0, 1, 2], [3, 4, 5], [6, 7]];
      const cranes = c._cranes.map((k, id) => {
        const legs = k.legs.filter((o) => c.obstacles.includes(o));
        for (const o of legs) o.crane = id;
        k.sprite.crane = id;
        const bays = groups[id].map((b) => bayX[b]);
        return { id, x: k.x, y: k.y, bays, bayMin: Math.min(k.x, bays[0]), bayMax: Math.max(k.x, bays[bays.length - 1]), sprite: k.sprite, legs };
      });
      const quaySlots = [];
      for (let k = 0; k < 30; k++) {
        const x = T(206 + 7 * k) + 8 + 56;                 // midway between two bollards
        if (x - 36 >= rail.x0 && x + 36 <= rail.x1) quaySlots.push({ x, y: T(716) - 18, ang: Math.PI / 2 });
      }
      c.port = { rail, cranes, ship: { x: S.x, y: S.y, ang: S.ang, slots }, quaySlots };
    }
    delete c._planes; delete c._cranes; delete c._ship; delete c._air;
  },

  // Debug overlay (for #demo&routes), world coordinates: arrival (red), departure roll and climb
  // (magenta), taxi in (cyan), taxi out (yellow), pushback (white), stands; crane rail (orange),
  // crane bay ranges, ship deck slots (green) and quay slots (orange).
  drawRoutes(ctx, px = 1) {
    const c = G.city, A = c.airport, P = c.port;
    ctx.save();
    const poly = (pts, col, w = 2) => {
      if (!pts || !pts.length) return;
      ctx.strokeStyle = col; ctx.lineWidth = w * px;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      ctx.fillStyle = col;
      for (const p of pts) ctx.fillRect(p[0] - 1.5 * px, p[1] - 1.5 * px, 3 * px, 3 * px);
    };
    if (A) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2 * px;
      ctx.strokeRect(A.runway.x0, A.runway.y0, A.runway.x1 - A.runway.x0, A.runway.y1 - A.runway.y0);
      poly([A.approach.from, A.approach.touchdown, A.approach.rollEnd], '#ff4a4a', 4);
      poly([A.depart.lineup, A.depart.rotate, A.depart.climb], '#ff5aff', 2);
      for (const s of A.stands) {
        poly(A.taxi.in[s.id], '#5fe6ff'); poly(A.taxi.out[s.id], '#ffe45c'); poly(A.taxi.push[s.id], '#ffffff', 3);
        ctx.fillStyle = s.kind === 'runway' ? '#ff5aff' : '#3bff6a';
        ctx.fillRect(s.x - 6 * px, s.y - 6 * px, 12 * px, 12 * px);
        ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 3 * px;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + Math.sin(s.ang) * 60, s.y - Math.cos(s.ang) * 60); ctx.stroke();
      }
      for (const [k, col] of [['touchdown', '#ff4a4a'], ['rollEnd', '#ff4a4a']]) { ctx.fillStyle = col; ctx.fillRect(A.approach[k][0] - 8, A.approach[k][1] - 8, 16, 16); }
      for (const k of ['lineup', 'rotate', 'climb']) { ctx.fillStyle = '#ff5aff'; ctx.fillRect(A.depart[k][0] - 8, A.depart[k][1] - 8, 16, 16); }
    }
    if (P) {
      ctx.strokeStyle = '#ff9d3b'; ctx.lineWidth = 3 * px;
      ctx.beginPath(); ctx.moveTo(P.rail.x0, P.rail.y); ctx.lineTo(P.rail.x1, P.rail.y); ctx.stroke();
      const box = (s, w, h, col) => {
        const v = Math.abs(Math.sin(s.ang)) > 0.5, bw = v ? w : h, bh = v ? h : w;
        ctx.strokeStyle = col; ctx.lineWidth = 1 * px; ctx.strokeRect(s.x - bw / 2, s.y - bh / 2, bw, bh);
      };
      for (const s of P.ship.slots) box(s, 72, 27, '#3bff6a');
      for (const s of P.quaySlots) box(s, 72, 27, '#ff9d3b');
      for (const k of P.cranes) {
        ctx.strokeStyle = '#5fe6ff'; ctx.lineWidth = 2 * px;
        ctx.strokeRect(k.bayMin, P.rail.y - 10, k.bayMax - k.bayMin, 20);
        ctx.fillStyle = '#5fe6ff';
        for (const b of k.bays) ctx.fillRect(b - 2, P.rail.y - 14, 4, 28);
        ctx.fillStyle = '#ffffff';
        for (const o of k.legs) ctx.fillRect(o.x - 4, o.y - 4, 8, 8);
      }
    }
    ctx.restore();
  },

  // Every walk that passes within 16 px of the rect (px); `out` is reused if given.
  walksIn(x0, y0, x1, y1, out = []) {
    const X = this.walkIndex;
    out.length = 0;
    if (!X) return out;
    if (++X.tick > 0xfffffff0) { X.seen.fill(0); X.tick = 1; }
    const a = clamp(Math.floor(x0 / X.CS), 0, X.gx - 1), b = clamp(Math.floor(x1 / X.CS), 0, X.gx - 1);
    const cy0 = clamp(Math.floor(y0 / X.CS), 0, X.gy - 1), cy1 = clamp(Math.floor(y1 / X.CS), 0, X.gy - 1);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = a; cx <= b; cx++) {
      const list = X.cells[cy * X.gx + cx];
      if (list) for (const w of list) if (X.seen[w.id] !== X.tick) { X.seen[w.id] = X.tick; out.push(w); }
    }
    return out;
  },

  // The nearest walk within r px (default 24) of a world point: { walk, x, y, t, d } with
  // (x, y) the projected point on it, t its distance from (walk.x0, walk.y0), d the distance
  // to it; null if none.
  walkAt(x, y, r = 24) {
    const X = this.walkIndex;
    if (!X) return null;
    const list = this.walksIn(x - r, y - r, x + r, y + r, X.tmp);
    let best = null, bd = r;
    for (const w of list) {
      const px = clamp(x, w.x0, w.x1), py = clamp(y, w.y0, w.y1);
      const d = Math.hypot(x - px, y - py);
      if (d <= bd) { bd = d; best = { walk: w, x: px, y: py, t: px - w.x0 + py - w.y0, d }; }
    }
    return best;
  },

  // Debug overlay (for #demo&walks), in WORLD coordinates like drawLanes: sidewalk walks
  // (cyan), crossings (green = signalised, yellow = unsignalised, with the controlling
  // junction marked), walk nodes (white; red = dead end) and cow pens (orange).
  drawWalks(ctx, x0, y0, x1, y1, px = 1) {
    const X = this.walkIndex;
    if (!X) return;
    ctx.save();
    const list = this.walksIn(x0, y0, x1, y1);
    const seen = new Set();
    for (const w of list) {
      ctx.strokeStyle = !w.xing ? '#5fe6ff' : w.xing.node !== null ? '#3bff6a' : '#ffe45c';
      ctx.lineWidth = (w.xing ? 3 : 2) * px;
      ctx.beginPath(); ctx.moveTo(w.x0, w.y0); ctx.lineTo(w.x1, w.y1); ctx.stroke();
      if (w.xing && w.xing.node !== null && G.city && G.city.nodes) {
        const nd = G.city.nodes[w.xing.node];
        ctx.strokeStyle = 'rgba(59,255,106,0.45)'; ctx.lineWidth = 1 * px;
        ctx.beginPath(); ctx.moveTo((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2); ctx.lineTo(nd.x, nd.y); ctx.stroke();
      }
      for (const id of [w.from, w.to]) {
        if (seen.has(id)) continue;
        seen.add(id);
        const nd = X.nodes[id];
        ctx.fillStyle = nd.edges.length === 1 ? '#ff4040' : '#ffffff';
        ctx.fillRect(nd.x - 2 * px, nd.y - 2 * px, 4 * px, 4 * px);
      }
    }
    ctx.strokeStyle = '#ff9d3b'; ctx.lineWidth = 2 * px;
    ctx.fillStyle = '#ff9d3b';
    for (const p of X.pens) {
      if (p.x1 < x0 || p.x0 > x1 || p.y1 < y0 || p.y0 > y1) continue;
      ctx.strokeRect(p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0);
      for (const s of p.spots) ctx.fillRect(s.x - 2 * px, s.y - 2 * px, 4 * px, 4 * px);
    }
    ctx.restore();
  },

  // Districts, neighbourhoods, the per-tile address maps and the #demo goto places.
  nameAreas(c, env) {
    const { G, GRIDS, AIRPORT, BEACH, MARINA, PORT, LAKES, ISLANDS, isSea, zone, streetMap } = env;
    const { W, H } = c;
    const N = W * H;
    const I = (x, y) => y * W + x;
    const districts = c.districts, hoods = c.neighborhoods;
    const dIdx = {};
    const district = (name, kind, rect) => { dIdx[name] = districts.length; districts.push({ id: districts.length, name, kind, rect }); };
    // paint: 'land' = everything except open sea, 'sea' = open sea only, 'all'
    const hood = (name, dist, kind, rect, paint = 'land') => hoods.push({ id: hoods.length, name, district: dist, kind, rect, paint });
    const gr = (g, bx0, by0, bx1, by1) => {
      const x = g.ox + bx0 * g.pitch, y = g.oy + by0 * g.pitch;
      return { x, y, w: (bx1 + 1) * g.pitch - bx0 * g.pitch + (bx1 === g.nx - 1 ? CITY.ROAD : 0), h: (by1 + 1) * g.pitch - by0 * g.pitch + (by1 === g.ny - 1 ? CITY.ROAD : 0) };
    };
    // wild country first (lowest priority), then districts on top
    district('Pinewood Wilds', 'wild', { x: 0, y: 0, w: 366, h: 345 });
    hood('Pinewood Forest', 'Pinewood Wilds', 'forest', { x: 0, y: 0, w: 150, h: 140 });
    hood('Mirror Lake', 'Pinewood Wilds', 'lake', { x: 0, y: 140, w: 150, h: 60 });
    hood('Fernwood', 'Pinewood Wilds', 'forest', { x: 0, y: 200, w: 150, h: 145 });
    hood('North Shore', 'Pinewood Wilds', 'coast', { x: 150, y: 0, w: 216, h: 69 });
    district('Cliffside', 'wild', { x: 663, y: 0, w: 105, h: 200 });
    hood('Cliffside Woods', 'Cliffside', 'forest', { x: 663, y: 0, w: 105, h: 200 });
    district('Clover Meadows', 'wild', { x: 150, y: 281, w: 87, h: 214 });
    hood('Clover Meadows', 'Clover Meadows', 'meadow', { x: 150, y: 281, w: 87, h: 139 });
    hood('Willow Lake', 'Clover Meadows', 'lake', { x: 150, y: 420, w: 87, h: 75 });
    district('Lilac Valley', 'wild', { x: 391, y: 397, w: 114, h: 371 });
    hood('Heron Lake', 'Lilac Valley', 'lake', { x: 420, y: 397, w: 85, h: 83 });
    hood('Lilac River', 'Lilac Valley', 'river', { x: 391, y: 480, w: 103, h: 220 });
    hood('Lilac Delta', 'Lilac Valley', 'coast', { x: 391, y: 700, w: 103, h: 68 });
    district('Amber Desert', 'wild', { x: 494, y: 500, w: 274, h: 268 });
    hood('Sagebrush Flats', 'Amber Desert', 'desert', { x: 494, y: 609, w: 106, h: 159 });
    hood('Cactus Flats', 'Amber Desert', 'desert', { x: 623, y: 500, w: 145, h: 140 });
    hood('Amber Dunes', 'Amber Desert', 'desert', { x: 600, y: 640, w: 80, h: 128 });
    hood('Oasis Springs', 'Amber Desert', 'desert', { x: 680, y: 640, w: 88, h: 128 });
    district('Pastel Bay', 'wild', { x: 366, y: 0, w: 168, h: 300 });
    hood('Pastel Bay', 'Pastel Bay', 'water', { x: 366, y: 0, w: 168, h: 300 }, 'sea');
    district('Pastel Sea', 'wild', { x: 0, y: 0, w: W, h: H });
    // rural and industrial
    const gridHoods = (g, list) => { district(g.name, g.kind === 'city' ? 'city' : g.kind, g.rect); for (const [name, k, r] of list) hood(name, g.name, k, gr(g, ...r)); };
    gridHoods(G.north, [['Honeyfield', 'farms', [0, 0, 1, 2]], ['Clover Hollow', 'farms', [2, 0, 2, 2]]]);
    gridHoods(G.west, [['Wheatmere', 'farms', [0, 0, 2, 1]], ['Old Mill', 'farms', [0, 2, 2, 2]]]);
    gridHoods(G.south, [['Sundown Acres', 'farms', [0, 0, 1, 2]], ['Orchard Glen', 'farms', [2, 0, 2, 2]]]);
    gridHoods(G.iron, [['Freight Yards', 'industrial', [0, 0, 1, 4]], ['Smokestack Row', 'industrial', [2, 0, 3, 4]], ['Dockside Works', 'industrial', [4, 0, 5, 4]]]);
    district('Pastel Airport', 'industrial', AIRPORT);
    hood('Airfield', 'Pastel Airport', 'airport', { x: AIRPORT.x, y: AIRPORT.y, w: 92, h: AIRPORT.h });
    hood('Terminal', 'Pastel Airport', 'airport', { x: AIRPORT.x + 92, y: AIRPORT.y, w: AIRPORT.w - 92, h: AIRPORT.h });
    // cities: core rows split in two, suburb ring in quarters
    const cityHoods = (g, names) => gridHoods(g, [
      [names[0], 'downtown', [2, 2, 4, 2]], [names[1], 'downtown', [2, 3, 4, 4]],
      [names[2], 'suburbs', [0, 0, 6, 1]], [names[3], 'suburbs', [5, 2, 6, 4]],
      [names[4], 'suburbs', [0, 5, 6, 6]], [names[5], 'suburbs', [0, 2, 1, 4]],
    ]);
    cityHoods(G.major, ['Pastel Heights', 'Parkside', 'Lilac Hill', 'Bayview', 'Maple Hills', 'Rosewood']);
    cityHoods(G.side, ['Coral Centre', 'Broadcast Square', 'Sunhill', 'Seabreeze', 'Marina Heights', 'Bridgeview']);
    cityHoods(G.main, ['Union Square', 'Mercy Hill', 'Railside', 'Riverbend', 'Portside', 'Westgate']);
    hood('Shell Beach', 'Side City', 'beach', { x: BEACH.x, y: BEACH.y, w: BEACH.w, h: MARINA.y - BEACH.y });
    hood('Sunrise Marina', 'Side City', 'marina', { x: MARINA.x, y: MARINA.y, w: MARINA.w, h: MARINA.h }, 'all');
    hood('Port', 'Main City', 'port', { x: PORT.x, y: PORT.y, w: PORT.w, h: PORT.h }, 'all');
    // natural features on top
    for (const is of ISLANDS) {
      const dname = is.bay ? 'Pastel Bay' : 'Pastel Sea';
      hood(is.name, dname, 'island', { x: is.x - is.r - 3, y: is.y - is.r - 3, w: 2 * is.r + 6, h: 2 * is.r + 6 });
    }
    const seaHood = hoods.length;
    hood('Open Sea', 'Pastel Sea', 'water', null, 'sea');
    // the long bridge gets its own neighbourhood so the HUD names it
    hood('Pastel Gate Bridge', 'Pastel Bay', 'bridge', { x: 366, y: 243, w: 134, h: 9 }, 'all');

    // paint the per-tile maps (later hoods win), then open sea, then fill gaps by BFS
    const hoodMap = new Uint16Array(N);
    const isBay = (x, y) => x >= 366 && x < 534 && y < 300;
    for (const h of hoods) {
      if (!h.rect) continue;
      const r = h.rect;
      for (let y = Math.max(0, r.y); y < Math.min(H, r.y + r.h); y++) for (let x = Math.max(0, r.x); x < Math.min(W, r.x + r.w); x++) {
        const i = I(x, y), sea = isSea[i] && c.kind[i] === KIND.WATER;
        if (h.paint === 'land' && sea) continue;
        if (h.paint === 'sea' && !sea) continue;
        hoodMap[i] = h.id + 1;
      }
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = I(x, y);
      if (!hoodMap[i] && isSea[i] && c.kind[i] === KIND.WATER && !isBay(x, y)) hoodMap[i] = seaHood + 1;
    }
    {
      const q = new Int32Array(N);
      let qh = 0, qt = 0;
      for (let i = 0; i < N; i++) if (hoodMap[i]) q[qt++] = i;
      while (qh < qt) {
        const i = q[qh++], x = i % W;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
          if (j < 0 || j >= N || hoodMap[j]) continue;
          hoodMap[j] = hoodMap[i]; q[qt++] = j;
        }
      }
    }
    const distMap = new Uint8Array(N);
    for (const h of hoods) h.tiles = 0;
    for (let i = 0; i < N; i++) { const h = hoods[hoodMap[i] - 1]; h.tiles++; distMap[i] = dIdx[h.district]; }
    // sidewalks and verges next to a road carry that road's name (3-tile dilation)
    for (let pass = 0; pass < 3; pass++) {
      const add = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = I(x, y);
        if (streetMap[i]) continue;
        const k = c.kind[i];
        if (k !== KIND.WALK && k !== KIND.VERGE && k !== KIND.MEADOW && k !== KIND.GRASS && k !== KIND.LAWN && k !== KIND.CONCRETE) continue;
        const s = streetMap[i - 1] || streetMap[i + 1] || streetMap[i - W] || streetMap[i + W];
        if (s) add.push(i, s);
      }
      for (let k = 0; k < add.length; k += 2) streetMap[add[k]] = add[k + 1];
    }
    this.map = { W, H, hood: hoodMap, dist: distMap, zone, street: streetMap, hoods, districts, streets: c.streets, regionCache: new Map() };

    // goto places: snap each to the nearest walkable tile
    const snap = (x, y) => {
      const tx = clamp(Math.floor(x / TILE), 0, W - 1), ty = clamp(Math.floor(y / TILE), 0, H - 1);
      for (let r = 0; r < 40; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const X = tx + i, Y = ty + j;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        if (!c.solid[I(X, Y)] && c.kind[I(X, Y)] !== KIND.WATER && c.kind[I(X, Y)] !== KIND.BUILDING) return { x: T(X) + 8, y: T(Y) + 8 };
      }
      return { x, y };
    };
    const T = (t) => t * TILE;
    const put = (name, x, y, raw) => { const p = raw ? { x, y } : snap(x, y); c.places[name] = { x: Math.round(p.x), y: Math.round(p.y) }; };
    for (const d of districts) if (d.name !== 'Pastel Sea') put(d.name, T(d.rect.x + d.rect.w / 2), T(d.rect.y + d.rect.h / 2));
    put('Pastel Sea', T(700), T(120), true);
    for (const h of hoods) if (h.rect) put(h.name, T(h.rect.x + h.rect.w / 2), T(h.rect.y + h.rect.h / 2), h.paint === 'sea');
    for (const g of GRIDS) put(g.name, T(g.ox + g.w / 2), T(g.oy + g.h / 2));
    for (const L of LAKES) put(L.name, T(L.x), T(L.y + L.r + 2));
    for (const is of ISLANDS) put(is.name, T(is.x), T(is.y));
    for (const lm of c.landmarks) put(lm.name, lm.x, lm.y);
    const alias = { Stadium: 'Pastel Stadium', 'TV HQ': 'PCTV Tower', Police: 'Police Station', Bridge: 'Pastel Gate Bridge', 'Long Bridge': 'Pastel Gate Bridge',
      Beach: 'Shell Beach', Marina: 'Sunrise Marina', 'Train Station': 'Union Station', Station: 'Union Station', Hospital: 'Mercy Hospital', Airport: 'Pastel Airport',
      Garage: 'Boost Garage', Park: 'Central Park', Desert: 'Amber Desert', Bay: 'Pastel Bay', Forest: 'Pinewood Forest', River: 'Lilac River' };
    for (const k in alias) if (c.places[alias[k]]) c.places[k] = c.places[alias[k]];
    c.places.Spawn = { x: c.spawn.x, y: c.spawn.y };
    c.places.Tank = { x: c.tankSpot.x, y: c.tankSpot.y + 20 };
    c.places['Railway North'] = { x: c.rail.x0, y: c.rail.y0 + 40 };
    c.places['Railway Crossing'] = { x: c.rail.x0, y: T(CITY.PITCH * 0 + G.main.oy + 4) };
    c.phones.forEach((p, i) => { c.places['Phone ' + (i + 1)] = { x: p.x, y: p.y + 14 }; });
    // gun stores: stand just outside the door mat (stepping on it opens the store)
    for (const g of c.gunshops) {
      const at = { x: Math.round(g.x + Math.sin(g.ang) * 24), y: Math.round(g.y - Math.cos(g.ang) * 24) };
      c.places['GUN STORE: ' + g.area] = at;
      c.places['Gun Store ' + (g.id + 1)] = at;
    }
    for (const s of c.streets) if (s.from && s.to && !c.places[s.name]) put(s.name, T((s.from.x + s.to.x) / 2) + 8, T((s.from.y + s.to.y) / 2) + 8, true);
  },

  resolveFrames(c, R) {
    const { W, H } = c;
    const tags = Assets.sheets.tiles.tags;
    const cache = {};
    const A = (tag, i = 0) => {
      let t = cache[tag];
      if (!t) { const r = tags[tag]; if (!r) throw new Error('unknown sprite tiles:' + tag); t = cache[tag] = [r[0], r[1] - r[0] + 1]; }
      return t[0] + (((i | 0) % t[1]) + t[1]) % t[1];
    };
    const has = (tag) => !!tags[tag];
    const kindAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? KIND.WATER : c.kind[y * W + x]);
    const L = CITY.LOT;
    const edge = (kk) => kk === KIND.ROAD || kk === KIND.WATER || kk === KIND.RAIL || kk === KIND.BRIDGE;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x, k = c.kind[i];
        let f = -1;
        c.solid[i] = k === KIND.BUILDING ? 1 : k === KIND.WATER ? 2 : 0;
        switch (k) {
          case KIND.ROAD: {
            const r = c.sub[i] === 9 ? null : this.roadAt(x, y);
            if (!r) { f = A('asphalt', Math.floor(R() * 3)); break; }
            const p = r.profile;
            if (r.xing && r.rail >= 1 && r.rail <= 2) { f = A('rail_x_v', r.rail - 1); break; }
            if (r.t === 'int') {
              f = p === 'avenue' ? A('ave_v', 0) : p === 'street' ? A('street_v', 0) : p === 'highway' ? A('hwy_v', 0)
                : p === 'rough' ? (R() < 0.3 ? A('rough', Math.floor(R() * 4)) : A('asphalt', Math.floor(R() * 3))) : A('asphalt', 0);
              break;
            }
            const v = r.t === 'v', a = r.across, l = r.along, sfx = v ? '_v' : '_h';
            if (p === 'avenue') {
              const grid = r.len === L;
              if (grid && (l <= 1 || l >= L - 2)) f = A(v ? 'zebra_v' : 'zebra_h', l === 0 || l === L - 2 ? 0 : 1);
              else if (a === 4) f = A(v ? 'line_v_c' : 'line_h_c');
              else if (a <= 1 || a >= 7) f = grid && l >= 4 && l <= 16 ? A('ave' + sfx, l % 4 === 0 ? 2 : 1) : A('ave' + sfx, 0);
              else if (grid && ((v && ((a >= 5 && l === 2) || (a <= 3 && l === L - 3))) || (!v && ((a >= 5 && l === L - 3) || (a <= 3 && l === 2))))) f = A('ave' + sfx, 3);
              else f = A('ave' + sfx, 0);
            } else if (p === 'street') {
              f = A('street' + sfx, a === 4 ? 1 : 0);
            } else if (p === 'rough') {
              if (a === 0 || a === 8) f = A('gravel', Math.floor(R() * 2));
              else if (a === 4) f = A(v ? 'rough_line_v' : 'rough_line_h');
              else f = R() < 0.3 ? A('rough', Math.floor(R() * 4)) : A('asphalt', Math.floor(R() * 3));
            } else if (p === 'highway') {
              f = A('hwy' + sfx, a === 0 ? 2 : a === 8 ? 3 : a === 2 || a === 6 ? 1 : 0);
              if (a === 4) f = A(v ? 'line_v_c' : 'line_h_c');
            } else f = A('asphalt', Math.floor(R() * 3));
            break;
          }
          case KIND.DIRT: {
            const r = this.roadAt(x, y);
            if (r && r.xing && r.rail >= 1 && r.rail <= 2) f = A('rail_x_v', r.rail - 1);
            else if (r && r.t === 'int') f = A('dirtroad_x');
            else if (r && (r.t === 'v' || r.t === 'h')) f = A(r.t === 'v' ? 'dirtroad_v' : 'dirtroad_h', Math.floor(R() * 2));
            else f = A('dirt', c.sub[i] & 1);
            break;
          }
          case KIND.RAIL: {
            const r = this.roadAt(x, y);
            const a = r && r.t === 'rail' ? r.across : c.sub[i] - 1;
            f = a === 1 || a === 2 ? A('rail_v', a - 1) : A('ballast');
            break;
          }
          case KIND.BRIDGE: {
            const r = this.roadAt(x, y);
            if (!r || r.t === 'rail') { f = A('bridge', 1); break; }
            const v = r.t === 'v' || (r.t === 'int' && r.rec && r.rec.axis === 'v');
            const a = r.t === 'int' ? (v ? r.ax : r.ay) : r.across;
            const fr = a === 0 ? 0 : a === 8 ? 3 : a === 4 ? 2 : 1;
            if (r.gg) f = A(v ? 'ggbridge_v' : 'ggbridge', fr);
            else if (!v) f = A('bridge', fr);
            else f = has('bridge_v') ? A('bridge_v', fr) : A('ggbridge_v', fr);
            break;
          }
          case KIND.WALK: case KIND.BUILDING: {
            if (c.sub[i] & 0x80) { f = A('plaza', c.sub[i] & 1); break; }   // under an oval building
            let mask = 0;
            if (edge(kindAt(x, y - 1))) mask |= 1;
            if (edge(kindAt(x + 1, y))) mask |= 2;
            if (edge(kindAt(x, y + 1))) mask |= 4;
            if (edge(kindAt(x - 1, y))) mask |= 8;
            f = A('walk', mask);
            break;
          }
          case KIND.GRASS: f = c.sub[i] === 1 ? A('flowers') : A('grass', Math.floor(R() * 3)); break;
          case KIND.PATH: f = A('path', Math.floor(R() * 2)); break;
          case KIND.PLAZA: f = A('plaza', c.sub[i] & 1); break;
          case KIND.LOT: f = c.sub[i] ? A('lot_line') : A('lot'); break;
          case KIND.FIELD: f = A(CROPS[(c.sub[i] >> 1) & 3], c.sub[i] & 1); break;
          case KIND.VERGE: f = A('verge', Math.floor(R() * 2)); break;
          case KIND.LAWN: f = A('lawn'); break;
          case KIND.CONCRETE: f = A('concrete', c.sub[i] & 1); break;
          case KIND.SAND: f = A('sand', Math.floor(R() * 2)); break;
          case KIND.FOREST: f = A('forest', Math.floor(R() * 2)); break;
          case KIND.MEADOW: f = A('meadow', Math.floor(R() * 2)); break;
          case KIND.DESERT: f = A('desert', Math.floor(R() * 3)); break;
          case KIND.DUNE: f = A('dune'); break;
          case KIND.ROCK: f = A('rock', Math.floor(R() * 2)); break;
          case KIND.PIER: f = A(c.sub[i] ? 'pier_h' : 'pier_v'); break;
          case KIND.BOARDWALK: f = A(c.sub[i] ? 'boardwalk_h' : 'boardwalk_v'); break;
          case KIND.QUAY: f = A('quay', c.sub[i] ? 1 : 0); break;
          case KIND.PLATFORM: {
            // sub 2: track to the east, 3: track to the west (platform_v, if drawn)
            const s = c.sub[i];
            f = s >= 2 && has('platform_v') ? A('platform_v', s - 2) : A('platform', 0);
            break;
          }
          case KIND.RUNWAY: f = A('runway', c.sub[i]); break;
          case KIND.TAXIWAY: f = A('taxiway', c.sub[i]); break;
          case KIND.APRON: f = A('apron', c.sub[i]); break;
          default: f = -1;
        }
        c.frame[i] = f;
      }
    }
  },
};
