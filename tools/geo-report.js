#!/usr/bin/env node
// Geography report: builds the world in node (no browser) and prints the facts that
// docs/geography.md quotes: build time, districts, neighbourhoods, streets, landmarks,
// highways and bridges, the railway, anchors and counts. Rerun it after changing
// src/city.js and paste the output into the doc.
//
//   node tools/geo-report.js            markdown report (seed 20260925, the game's seed)
//   node tools/geo-report.js --check    only the sanity checks + timing
//   node tools/geo-report.js --seed 7   another seed
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const seed = args.includes('--seed') ? +args[args.indexOf('--seed') + 1] : 20260925;
const checkOnly = args.includes('--check');

// load the scripts the generator needs into one shared scope, like the browser does
const ctx = { console, window: {}, performance: { now: () => Date.now() }, document: { createElement: () => ({ getContext: () => ({}) }) } };
ctx.window = ctx;
vm.createContext(ctx);
let src = '';
for (const f of ['assets/atlas.js', 'src/core.js', 'src/city.js', 'src/entities.js']) src += fs.readFileSync(path.join(root, f), 'utf8') + '\n';
src += 'for (const n in ATLAS) Assets.sheets[n] = ATLAS[n];\nthis.__api = { City, KIND, CITY, MODELS, TILE, REGIONS };';
vm.runInContext(src, ctx, { filename: 'bundle.js' });
const { City, KIND, CITY, TILE, REGIONS } = ctx.__api;

City.timing = {};
const t0 = process.hrtime.bigint();
const c = City.build(seed);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
const phases = Object.entries(City.timing).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ');
City.timing = null;
const t1 = process.hrtime.bigint();
City.build(seed);
const ms2 = Number(process.hrtime.bigint() - t1) / 1e6;

const KN = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [v, k]));
const tile = (px) => Math.floor(px / TILE);
const kindPx = (x, y) => KN[c.kind[tile(y) * c.W + tile(x)]];
const solidPx = (x, y) => c.solid[tile(y) * c.W + tile(x)];
const fmtR = (r) => (r ? `x ${r.x}-${r.x + r.w - 1}, y ${r.y}-${r.y + r.h - 1} (${r.w}x${r.h})` : 'fills the rest');
const tp = (x, y) => `(${tile(x)}, ${tile(y)})`;

// ------------------------------------------------------------- checks --
const problems = [];
const need = (ok, msg) => { if (!ok) problems.push(msg); };
need(c.spawn && !solidPx(c.spawn.x, c.spawn.y), 'spawn is solid or missing');
need(c.tankSpot && !solidPx(c.tankSpot.x, c.tankSpot.y), 'tank spot is solid or missing');
need(c.starterCar && kindPx(c.starterCar.x, c.starterCar.y) === 'ROAD', 'starter car is not on a road: ' + kindPx(c.starterCar.x, c.starterCar.y));
need(c.garage && !solidPx(c.garage.x, c.garage.y), 'garage is solid or missing');
need(c.rail && c.rail.stops.every((s) => s.at - c.rail.y0 >= 339 && c.rail.y1 - s.at >= 339), 'rail stop needs 339 px of track both ways');
for (const p of c.phones) need(!solidPx(p.x, p.y), 'payphone in a wall: ' + p.district);
const districtsWithPhone = new Set(c.phones.map((p) => p.district));
for (const d of ['Major City', 'Side City', 'Main City', 'Ironworks', 'North Farms', 'West Farms', 'South-East Farms', 'Pastel Airport']) need(districtsWithPhone.has(d), 'no payphone in ' + d);
// nothing that spawns a car, a crate or a mission target may sit on water (solid 2) or in a wall
for (const [name, list] of Object.entries({ parked: c.parked, parkSpots: c.parkSpots, stalls: c.stalls, roadSpots: c.roadSpots, crateSpots: c.crateSpots, heliSpots: c.heliSpots })) {
  const wet = (list || []).filter((s) => !s.roof && (solidPx(s.x, s.y) || kindPx(s.x, s.y) === 'WATER'));
  need(!wet.length, `${wet.length} ${name} on water or in a wall, e.g. ` + wet.slice(0, 3).map((s) => tp(s.x, s.y)).join(' '));
}
// gun stores: five, each with a free door mat; one within an easy walk of the spawn
need(c.gunshops && c.gunshops.length === 5, 'expected 5 gun stores, got ' + (c.gunshops || []).length);
for (const g of c.gunshops || []) {
  need(!solidPx(g.x, g.y) && g.b && g.name.length <= 16, 'gun store mat blocked or bad: ' + g.name);
  need(!c.obstacles.some((o) => Math.hypot(o.x - g.x, o.y - g.y) < 12 + (o.r || 0)), 'obstacle on the gun store mat: ' + g.name);
}
need((c.gunshops || []).some((g) => Math.hypot(g.x - c.spawn.x, g.y - c.spawn.y) <= 40 * TILE), 'no gun store within 40 tiles of the spawn');
// paint shops (spec paintshop-v1 S1): four, one per city + Ironworks; each bay on dry open ground,
// off every traffic lane, with nothing solid or parked in it, and a clear drive out to the road
need(c.paintshops && c.paintshops.length === 4, 'expected 4 paint shops, got ' + (c.paintshops || []).length);
need(new Set((c.paintshops || []).map((s) => s.district)).size === 4, 'paint shops not in four districts');
for (const s of c.paintshops || []) {
  const B = s.bay, bad = [];
  for (let y = B.y0 + 4; y < B.y1; y += 8) for (let x = B.x0 + 4; x < B.x1; x += 8) {
    const k = kindPx(x, y);
    if (solidPx(x, y) || k === 'WATER' || k === 'ROAD' || k === 'BRIDGE') bad.push('ground ' + k);
    if (City.laneAt(x, y, 8)) bad.push('lane');
  }
  if (c.obstacles.some((o) => o.x > B.x0 - (o.r || 0) && o.x < B.x1 + (o.r || 0) && o.y > B.y0 - (o.r || 0) && o.y < B.y1 + (o.r || 0))) bad.push('obstacle');
  for (const k of ['parked', 'stalls', 'parkSpots', 'roadSpots']) if (c[k].some((q) => q.x > B.x0 - 16 && q.x < B.x1 + 16 && q.y > B.y0 - 16 && q.y < B.y1 + 16)) bad.push(k);
  need((B.x1 - B.x0) >= 44 && (B.y1 - B.y0) >= 44 && Math.max(B.x1 - B.x0, B.y1 - B.y0) >= 60, 'paint bay too small for a sedan: ' + s.name);
  // drive out: from the bay centre away from the door until the asphalt, clear of walls and obstacles
  const ux = -Math.sin(s.ang), uy = Math.cos(s.ang);
  let road = false;
  for (let d = 0; d < 240 && !road; d += 4) {
    const x = s.x + ux * d, y = s.y + uy * d;
    if (kindPx(x, y) === 'ROAD') { road = true; break; }
    if (solidPx(x, y)) { bad.push('wall on the way out'); break; }
    for (const side of [-14, 0, 14]) {
      const px = x + uy * side, py = y - ux * side;
      if (c.obstacles.some((o) => Math.hypot(o.x - px, o.y - py) < (o.r || 0) + 2)) { bad.push('obstacle on the way out at ' + tp(px, py)); d = 999; break; }
    }
  }
  if (!road) bad.push('no road within 15 tiles');
  const doorX = s.x + Math.sin(s.ang) * 48, doorY = s.y - Math.cos(s.ang) * 48;
  if (!solidPx(doorX, doorY) || !s.b || s.b.sign !== 'PAINT') bad.push('no garage at the head of the bay');
  need(!bad.length, 'paint shop ' + s.name + ': ' + [...new Set(bad)].join(', '));
}
need(c.policeStation && !solidPx(c.policeStation.x, c.policeStation.y) && kindPx(c.policeStation.x, c.policeStation.y) === 'WALK', 'police station hotspot missing or not on a sidewalk');
const hoodNames = c.neighborhoods.map((h) => h.name);
need(new Set(hoodNames).size === hoodNames.length, 'duplicate neighbourhood names');
const streetNames = c.streets.map((s) => s.name);
need(new Set(streetNames).size === streetNames.length, 'duplicate street names: ' + streetNames.filter((n, i) => streetNames.indexOf(n) !== i).join(', '));
for (const l of c.landmarks) need(c.places[l.name], 'landmark without a goto place: ' + l.name);
{
  const norm = {};
  for (const k of Object.keys(c.places)) {
    const n = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm[n] && (c.places[norm[n]].x !== c.places[k].x || c.places[norm[n]].y !== c.places[k].y)) problems.push(`goto names collide: "${norm[n]}" / "${k}"`);
    norm[n] = norm[n] || k;
  }
}
let badFrames = 0;
for (let i = 0; i < c.W * c.H; i++) if (c.frame[i] < 0 && c.kind[i] !== KIND.WATER) badFrames++;
need(badFrames === 0, badFrames + ' land tiles without a frame');
// neighbourhood rects must not overlap inside a district
for (const a of c.neighborhoods) for (const b of c.neighborhoods) {
  if (a.id >= b.id || a.district !== b.district || !a.rect || !b.rect) continue;
  const ov = a.rect.x < b.rect.x + b.rect.w && b.rect.x < a.rect.x + a.rect.w && a.rect.y < b.rect.y + b.rect.h && b.rect.y < a.rect.y + a.rect.h;
  if (ov && a.paint !== 'sea' && b.paint !== 'sea') problems.push(`overlapping neighbourhoods in ${a.district}: ${a.name} / ${b.name}`);
}

// traffic lane graph (City.buildLanes): every lane joins two nodes, every lane arriving at a
// node has an exit, exits join a lane ending there to one starting there and never reverse
// (U-turns only at 'turn' nodes), and no lane or exit path crosses water or a building
const laneStats = { zones: {} };
{
  const L = c.lanes || [], N = c.nodes || [];
  need(L.length > 0 && N.length > 0, 'no lane graph');
  const solidK = (x, y) => { const k = KN[c.kind[tile(y) * c.W + tile(x)]]; return k === 'WATER' || k === 'BUILDING'; };
  const hasExit = new Set();
  let bad = 0;
  for (const nd of N) for (const e of nd.exits) {
    const a = L[e.from], b = L[e.to];
    hasExit.add(e.from);
    if (!a || !b || a.to !== nd.id || b.from !== nd.id) bad++;
    else if (e.turn !== 'u' && a.dx * b.dx + a.dy * b.dy < -0.5) bad++;
    else if (e.turn === 'u' && nd.kind !== 'turn') bad++;
    else if (e.path.some((p) => solidK(p[0], p[1]))) bad++;
  }
  need(!bad, bad + ' bad lane exits (mismatched, reversed or through a wall/water)');
  const noExit = L.filter((l) => !hasExit.has(l.id));
  need(!noExit.length, noExit.length + ' lanes without an exit, e.g. lane ' + (noExit[0] || {}).id);
  const wet = L.filter((l) => { for (let d = 0; d <= l.len; d += 8) if (solidK(l.x0 + l.dx * d, l.y0 + l.dy * d)) return true; return false; });
  need(!wet.length, wet.length + ' lanes cross water or a building, e.g. ' + wet.slice(0, 3).map((l) => tp(l.x0, l.y0)).join(' '));
  need(L.every((l) => Math.hypot(l.dx, l.dy) === 1 && (l.x1 - l.x0) * l.dx + (l.y1 - l.y0) * l.dy > 0), 'a lane runs against its direction');
  need((City.laneAt(L[0].x0 + L[0].dx * 8, L[0].y0 + L[0].dy * 8) || {}).id === L[0].id, 'City.laneAt misses a lane');
  for (const l of L) { const z = laneStats.zones[l.zone] || (laneStats.zones[l.zone] = { lanes: 0, tiles: 0 }); z.lanes++; z.tiles += l.len / TILE; }
  laneStats.lanes = L.length; laneStats.nodes = N.length;
  laneStats.int = N.filter((n) => n.kind === 'int').length; laneStats.turn = N.length - laneStats.int;
  laneStats.signal = N.filter((n) => n.signal).length;
  laneStats.exits = N.reduce((a, n) => a + n.exits.length, 0);
  laneStats.stops = L.filter((l) => l.stop).length; laneStats.yields = L.filter((l) => l.yield).length;
  laneStats.xings = L.filter((l) => l.xings).length;
}
// pedestrian walk graph (City.buildWalks): edges are axis-aligned and join the nodes at their
// ends, nothing runs over water, a building, a bridge, a highway or a level crossing, crossings
// are road stretches tied to a real signalised junction (or null), and pens hold their herd on land
const walkStats = { zones: {} };
{
  const Wk = c.walks || [], WN = c.walkNodes || [];
  need(Wk.length > 0 && WN.length > 0, 'no walk graph');
  let bad = 0, badX = 0;
  const badAt = [];
  for (const w of Wk) {
    const a = WN[w.from], b = WN[w.to];
    if (!a || !b || a.x !== w.x0 || a.y !== w.y0 || b.x !== w.x1 || b.y !== w.y1 || !a.edges.includes(w.id) || !b.edges.includes(w.id)
      || (w.x0 !== w.x1 && w.y0 !== w.y1) || w.x1 < w.x0 || w.y1 < w.y0 || Math.abs(w.len - (w.x1 - w.x0 + w.y1 - w.y0)) > 0.2) { bad++; continue; }
    for (let d = 0; d <= w.len; d += 4) {
      const x = w.x0 + Math.sign(w.x1 - w.x0) * d, y = w.y0 + Math.sign(w.y1 - w.y0) * d;
      const k = KN[c.kind[tile(y) * c.W + tile(x)]], q = City.roadAt(tile(x), tile(y));
      if (k === 'WATER' || k === 'BUILDING' || k === 'BRIDGE' || solidPx(x, y) || (q && (q.profile === 'highway' || q.xing))) { badAt.push(tp(x, y) + ' ' + k); break; }
    }
    if (w.xing) {
      const nd = w.xing.node === null ? null : c.nodes[w.xing.node];
      const across = w.x0 === w.x1 ? 'h' : 'v';
      if (w.xing.axis !== across || (w.xing.node !== null && (!nd || !nd.signal || Math.hypot(nd.x - (w.x0 + w.x1) / 2, nd.y - (w.y0 + w.y1) / 2) > 200))) badX++;
      if (a.edges.length < 2 || b.edges.length < 2) badX++;
    }
  }
  need(!bad, bad + ' walk edges malformed or not joined to their nodes');
  need(!badAt.length, badAt.length + ' walks over water, a wall, a bridge, a highway or a level crossing, e.g. ' + badAt.slice(0, 3).join('; '));
  need(!badX, badX + ' bad crossings (axis, junction or left hanging)');
  need(WN.every((nd) => nd.edges.length > 0), 'a walk node without edges');
  const w0 = Wk[0], hit = w0 && City.walkAt(w0.x0 + (w0.x1 - w0.x0) / 2 + 5, w0.y0 + (w0.y1 - w0.y0) / 2 + 5, 24);
  need(hit && hit.walk.id === w0.id, 'City.walkAt misses a walk');
  need(City.walksIn(w0.x0, w0.y0, w0.x0 + 1, w0.y0 + 1).some((w) => w.id === w0.id), 'City.walksIn misses a walk');
  need(!c.props.some((p) => p.sprite === 'cow'), 'cow props left in c.props (cows live in c.pens)');
  const pens = c.pens || [];
  need(pens.length > 0, 'no cow pens');
  for (const p of pens) {
    let wet = 0, wall = 0;
    for (let y = tile(p.y0); y <= tile(p.y1); y++) for (let x = tile(p.x0); x <= tile(p.x1); x++) {
      const k = KN[c.kind[y * c.W + x]];
      if (k === 'WATER') wet++; else if (k === 'BUILDING') wall++;
    }
    need(p.cows > 0 && p.x1 - p.x0 >= 64 && p.y1 - p.y0 >= 64 && !wet && !wall && p.spots.length === p.cows
      && p.spots.every((s) => s.x >= p.x0 && s.x <= p.x1 && s.y >= p.y0 && s.y <= p.y1), `bad pen ${p.id} at ${tp(p.x0, p.y0)}: ${p.cows} cows, ${wet} water, ${wall} wall tiles`);
  }
  for (const w of Wk) { const z = walkStats.zones[w.zone] || (walkStats.zones[w.zone] = { walks: 0, tiles: 0, xings: 0 }); z.walks++; z.tiles += w.len / TILE; if (w.xing) z.xings++; }
  walkStats.walks = Wk.length; walkStats.nodes = WN.length;
  walkStats.xings = Wk.filter((w) => w.xing).length; walkStats.signal = Wk.filter((w) => w.xing && w.xing.node !== null).length;
  walkStats.dead = WN.filter((nd) => nd.edges.length === 1).length;
  walkStats.pens = pens.length; walkStats.cows = pens.reduce((a, p) => a + p.cows, 0);
  walkStats.tiles = Wk.reduce((a, w) => a + w.len, 0) / TILE;
}
// airport and port route data (City.buildRoutes, spec ambient-v1 §3): stands on dry ground with
// their obstacles tagged, taxi paths dense and clear of buildings and water, ship slots on water,
// quay slots and crane legs on the quay
const routeStats = {};
{
  const A = c.airport, Pt = c.port;
  need(A && A.stands && A.stands.length === 7, 'airport route data missing or not 7 stands');
  need(Pt && Pt.cranes && Pt.cranes.length === 3 && Pt.ship && Pt.ship.slots.length === 48, 'port data missing (3 cranes, 48 deck slots)');
  const k = (x, y) => KN[c.kind[tile(y) * c.W + tile(x)]];
  if (A) {
    let pts = 0;
    for (const s of A.stands) {
      need(!['WATER', 'BUILDING'].includes(k(s.x, s.y)), `stand ${s.id} on ${k(s.x, s.y)}`);
      need(s.obstacles.length > 0 && s.obstacles.every((o) => o.plane === s.id && c.obstacles.includes(o)), `stand ${s.id} obstacles not tagged`);
      need(s.sprite && s.sprite.dyn === 'plane' && c.sprites.includes(s.sprite), `stand ${s.id} sprite not flagged dyn`);
      for (const [name, P] of [['in', A.taxi.in[s.id]], ['out', A.taxi.out[s.id]], ['push', A.taxi.push[s.id]]]) {
        if (name === 'in' && s.kind === 'runway') { need(!P, 'the runway stand has a taxi-in path'); continue; }
        need(Array.isArray(P) && (P.length > 1 || name === 'push'), `stand ${s.id} has no taxi ${name} path`);
        if (!P) continue;
        pts += P.length;
        const bad = P.find((p, i) => ['WATER', 'BUILDING'].includes(k(p[0], p[1])) || (i && Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]) > 33));
        need(!bad, `taxi ${name} path of stand ${s.id} hits water/a wall or jumps at ${bad && tp(bad[0], bad[1])}`);
        const end = P[P.length - 1];
        if (name === 'in') need(Math.hypot(end[0] - s.x, end[1] - s.y) < 1 && Math.hypot(P[0][0] - A.approach.rollEnd[0], P[0][1] - A.approach.rollEnd[1]) < 1, `taxi in of stand ${s.id} doesn't run rollEnd -> stand`);
        if (name === 'out') need(Math.hypot(end[0] - A.depart.lineup[0], end[1] - A.depart.lineup[1]) < 1, `taxi out of stand ${s.id} doesn't end at the line-up`);
      }
    }
    for (const [x, y] of [A.approach.touchdown, A.approach.rollEnd, A.depart.lineup, A.depart.rotate]) need(k(x, y) === 'RUNWAY', 'runway point off the runway: ' + tp(x, y));
    routeStats.air = `airport: ${A.stands.length} stands (${A.stands.map((s) => s.kind).join(', ')}), ${pts} taxi path points`;
  }
  if (Pt) {
    const wet = Pt.ship.slots.filter((s) => k(s.x, s.y) !== 'WATER').length;
    need(!wet, wet + ' ship slots off the water');
    const qbad = Pt.quaySlots.filter((s) => k(s.x, s.y) !== 'QUAY' || c.obstacles.some((o) => Math.abs(o.x - s.x) < 36 + o.r && Math.abs(o.y - s.y) < 13.5 + o.r)).length;
    need(Pt.quaySlots.length > 0 && !qbad, `${qbad} of ${Pt.quaySlots.length} quay slots off the quay or on an obstacle`);
    for (const cr of Pt.cranes) {
      need(cr.legs.length === 2 && cr.legs.every((o) => o.crane === cr.id && k(o.x, o.y) === 'QUAY'), `crane ${cr.id} legs untagged or off the quay`);
      need(cr.sprite && cr.sprite.dyn === 'crane' && cr.bayMin <= cr.x && cr.x <= cr.bayMax && cr.bayMin >= Pt.rail.x0 + 20 && cr.bayMax <= Pt.rail.x1 - 20, `crane ${cr.id} bays or sprite wrong`);
    }
    for (let i = 1; i < Pt.cranes.length; i++) need(Pt.cranes[i].bayMin - Pt.cranes[i - 1].bayMax >= 52, `cranes ${i - 1} and ${i} can meet`);
    routeStats.port = `port: rail y ${tile(Pt.rail.y)} x ${tile(Pt.rail.x0)}-${tile(Pt.rail.x1)}, ${Pt.cranes.length} cranes, ${Pt.ship.slots.length} deck slots, ${Pt.quaySlots.length} quay slots`;
  }
}
const routeLine = () => `${routeStats.air}; ${routeStats.port}`;
const walkLine = () => `walks ${walkStats.walks} (${Math.round(walkStats.tiles)} tiles), walk nodes ${walkStats.nodes} (${walkStats.dead} dead ends), crossings ${walkStats.xings} (${walkStats.signal} signalised), cow pens ${walkStats.pens} (${walkStats.cows} cows)`;
const laneLine = () => `lanes ${laneStats.lanes}, nodes ${laneStats.nodes} (${laneStats.int} junctions, ${laneStats.signal} signalised, ${laneStats.turn} U-turn loops), exits ${laneStats.exits}, stop points ${laneStats.stops} (${laneStats.yields} give way), lanes over a level crossing ${laneStats.xings}`;

const counts = {};
for (let i = 0; i < c.W * c.H; i++) counts[KN[c.kind[i]]] = (counts[KN[c.kind[i]]] || 0) + 1;

if (checkOnly) {
  console.log(`build ${ms.toFixed(0)} ms (second run ${ms2.toFixed(0)} ms)`);
  console.log('phases (ms): ' + phases);
  console.log(`buildings ${c.buildings.length}, trees ${c.trees.length}, props ${c.props.length}, lamps ${c.lamps.length}, obstacles ${c.obstacles.length}, parked ${c.parked.length}, parkSpots ${c.parkSpots.length}, stalls ${c.stalls.length}, roadSpots ${c.roadSpots.length}, crates ${c.crateSpots.length}, talls ${c.talls.length}, sprites ${c.sprites.length}, signals ${c.trafficLights.length}`);
  console.log(laneLine());
  console.log(walkLine());
  console.log(routeLine());
  console.log(`districts ${c.districts.length}, neighbourhoods ${c.neighborhoods.length}, streets ${c.streets.length}, places ${Object.keys(c.places).length}`);
  console.log(problems.length ? 'PROBLEMS:\n  ' + problems.join('\n  ') : 'checks ok');
  process.exit(problems.length ? 1 : 0);
}

// ------------------------------------------------------------- report --
const out = [];
const P = (s = '') => out.push(s);
P(`<!-- generated by: node tools/geo-report.js (seed ${seed}) -->`);
P();
P(`- World: **${c.W} x ${c.H} tiles** (${c.W * TILE} x ${c.H * TILE} px, 16-px tiles), seed ${seed}.`);
P(`- \`City.build\` in node: **${ms.toFixed(0)} ms** first run, ${ms2.toFixed(0)} ms warm.`);
const land = c.W * c.H - (counts.WATER || 0);
P(`- Land ${land} tiles (${(land / (c.W * c.H) * 100).toFixed(1)}%), water ${counts.WATER} tiles.`);
P(`- Counts: ${c.buildings.length} buildings, ${c.trees.length} trees, ${c.props.length} props, ${c.lamps.length} lamps, ${c.trafficLights.length} traffic lights, ${c.talls.length} talls, ${c.sprites.length} sprites, ${c.cables.length} cables, ${c.obstacles.length} obstacles.`);
P(`- Spots: ${c.parkSpots.length} curb spots, ${c.stalls.length} stalls, ${c.parked.length} cars parked at start, ${c.roadSpots.length} mission road spots, ${c.crateSpots.length} crate spots.`);
P(`- Names: ${c.districts.length} districts, ${c.neighborhoods.length} neighbourhoods, ${c.streets.length} streets, ${Object.keys(c.places).length} goto places.`);
P();
P('Tile kinds (tiles):');
P();
P('| kind | tiles | kind | tiles | kind | tiles |');
P('|---|---|---|---|---|---|');
const kk = Object.entries(counts).sort((a, b) => b[1] - a[1]);
for (let i = 0; i < kk.length; i += 3) P('| ' + [0, 1, 2].map((j) => (kk[i + j] ? `${kk[i + j][0]} | ${kk[i + j][1]}` : ' | ')).join(' | ') + ' |');
P();
P('### ASCII map');
P();
P('One character = 8 x 16 tiles (north up). `~` sea/lakes, `=` highway, `#` railway, `A` Major City, `B` Side City, `C` Main City,');
P('`I` Ironworks, `n` North Farms, `w` West Farms, `e` South-East Farms, `P` airport, `^` forest, `,` meadow/grass, `:` desert, `o` sand/rock.');
P();
P('```');
{
  const letter = { 'Major City': 'A', 'Side City': 'B', 'Main City': 'C', Ironworks: 'I', 'North Farms': 'n', 'West Farms': 'w', 'South-East Farms': 'e', 'Pastel Airport': 'P' };
  const colsX = 8, rowsY = 16;
  P('     ' + [...Array(c.W / colsX)].map((_, i) => (i % 10 === 0 ? String(i * colsX).padEnd(10) : '')).join('').slice(0, c.W / colsX));
  for (let ry = 0; ry < c.H / rowsY; ry++) {
    let line = '';
    for (let rx = 0; rx < c.W / colsX; rx++) {
      const tally = {};
      for (let y = ry * rowsY; y < (ry + 1) * rowsY; y += 2) for (let x = rx * colsX; x < (rx + 1) * colsX; x += 2) {
        const i = y * c.W + x, k = KN[c.kind[i]];
        const q = City.roadAt(x, y);
        let ch;
        if (k === 'WATER') ch = '~';
        else if (q && q.t === 'rail') ch = '#';
        else if (q && q.profile === 'highway') ch = '=';
        else {
          const pl = City.placeAt(x * TILE, y * TILE);
          ch = letter[pl.district] || (k === 'FOREST' ? '^' : k === 'DESERT' || k === 'DUNE' ? ':' : k === 'SAND' || k === 'ROCK' ? 'o' : ',');
        }
        tally[ch] = (tally[ch] || 0) + (ch === '=' || ch === '#' ? 6 : 1);
      }
      line += Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
    }
    P(String(ry * rowsY).padStart(4) + ' ' + line);
  }
}
P('```');
P();
P('### Grids');
P();
P('| district | kind | origin (tiles) | size (tiles) | blocks | pitch | lot | roads |');
P('|---|---|---|---|---|---|---|---|');
for (const g of c.grids) P(`| ${g.name} | ${g.kind} | (${g.ox}, ${g.oy}) | ${g.w} x ${g.h} | ${g.nx} x ${g.ny} (${g.blocks.length} lots after merges) | ${g.pitch} | ${g.lot} | ${g.profiles} |`);
P();
P('### Districts and neighbourhoods');
P();
for (const d of c.districts) {
  P(`**${d.name}** (${d.kind}) - ${fmtR(d.rect)}`);
  P();
  const hs = c.neighborhoods.filter((h) => h.district === d.name);
  if (hs.length) {
    P('| neighbourhood | kind | rect (tiles) | tiles | goto |');
    P('|---|---|---|---|---|');
    for (const h of hs) P(`| ${h.name} | ${h.kind} | ${fmtR(h.rect)} | ${h.tiles} | \`goto=${h.name.replace(/ /g, '%20')}\` |`);
    P();
  }
}
P('### Block types per district');
P();
for (const g of c.grids) {
  const t = {};
  for (const b of g.blocks) t[b.type] = (t[b.type] || 0) + 1;
  P(`- ${g.name}: ` + Object.entries(t).map(([k, v]) => `${k} ${v}`).join(', '));
}
P();
P('### Vehicle mixes (area types used by `City.regionAt`)');
P();
P('| area | curb fill | mix (weights) |');
P('|---|---|---|');
for (const z of REGIONS) P(`| ${z.id} | ${Math.round(z.park * 100)}% | ${Object.entries(z.models).map(([m, w]) => `${m} ${w}`).join(', ')} |`);
P();
P('### Traffic lanes');
P();
P(`- ${laneLine()}.`);
P('- Density = cars per 100 road tiles (spec traffic-v1 B.2); lane tiles = lane length / 16, two lanes per road.');
P();
P('| zone | lanes | lane tiles | density | traffic mix (weights) |');
P('|---|---|---|---|---|');
for (const z of REGIONS) {
  const st = laneStats.zones[z.id] || { lanes: 0, tiles: 0 };
  P(`| ${z.id} | ${st.lanes} | ${Math.round(st.tiles)} | ${z.traffic.density} | ${Object.entries(z.traffic.models).map(([m, w]) => `${m} ${w}`).join(', ')} |`);
}
P();
P('### Pedestrians');
P();
P(`- ${walkLine()}.`);
P('- Walks run on the sidewalk centre lines (plus plaza walks, the Shell Beach boardwalk, the terminal kerb, farm tracks and farm-town paths).');
P('  Crossings are the road stretch only: zebras at both ends of every avenue grid run (tied to the junction\'s lights), one unsignalised corner');
P('  crossing per street and rough grid run, and court mouths. Density = peds per 100 walk tiles in the AOV (spec peds-v1 §2.1), x0.5 at night.');
P('  Cops = the share of that budget walking as foot cops (spec cops-v1 §2); within 700 px of the police station it is 30% (src/peds.js).');
P();
P('| zone | walks | walk tiles | crossings | density | scared / angry / violent | armed pistol / uzi | cops |');
P('|---|---|---|---|---|---|---|---|');
for (const z of REGIONS) {
  const st = walkStats.zones[z.id] || { walks: 0, tiles: 0, xings: 0 }, pd = z.peds;
  const pc = (v) => Math.round(v * 100) + '%';
  P(`| ${z.id} | ${st.walks} | ${Math.round(st.tiles)} | ${st.xings} | ${pd.density} | ${pc(pd.mix.scared)} / ${pc(pd.mix.angry)} / ${pc(pd.mix.violent)} | ${pc(pd.armed.pistol)} / ${pc(pd.armed.uzi)} | ${pc(pd.cops || 0)} |`);
}
P();
P('| pen | where (tiles) | size (tiles) | cows | neighbourhood |');
P('|---|---|---|---|---|');
for (const p of c.pens) P(`| ${p.id} | ${tp(p.x0, p.y0)} | ${Math.round((p.x1 - p.x0) / TILE)} x ${Math.round((p.y1 - p.y0) / TILE)} | ${p.cows} | ${City.placeAt(p.x0, p.y0).neighborhood} (${City.placeAt(p.x0, p.y0).district}) |`);
P();
P('### Airport flights and port cranes (route data)');
P();
P(`- ${routeLine()}.`);
P('- `c.airport`: arrivals fly north up the runway centre line (approach from, touchdown, rollEnd), taxi in via the mid exit link and the parallel taxiway; departures push back, taxi down the taxiway to the south link, line up at the south end and roll north. `#demo&routes` draws it all.');
P('- `c.port`: crane rail along the main quay, three crane bay ranges, 48 deck slots on the container ship (8 bays x 6 rows, matching the art) and quay slots between the bollards.');
P();
P('### Streets');
P();
P('| street | profile | district | from (tiles) | to (tiles) | width |');
P('|---|---|---|---|---|---|');
for (const s of c.streets) P(`| ${s.name} | ${s.profile} | ${s.district} | ${s.from ? `(${s.from.x}, ${s.from.y})` : '-'} | ${s.to ? `(${s.to.x}, ${s.to.y})` : '-'} | ${s.width} |`);
P();
P('### Landmarks');
P();
P('| landmark | where (tiles) | neighbourhood | footprint | what | goto |');
P('|---|---|---|---|---|---|');
for (const l of c.landmarks) {
  const pl = City.placeAt(l.x, l.y);
  P(`| ${l.name} | ${tp(l.x, l.y)} | ${pl.neighborhood} (${pl.district}) | ${l.rect ? fmtR(l.rect) : '-'} | ${l.what} | \`goto=${l.name.replace(/ /g, '%20')}\` |`);
}
P();
P('### Railway');
P();
const r = c.rail;
P(`- Vertical line at x ${tile(r.x0)} (track tiles ${tile(r.x0) - 1}-${tile(r.x0)}), from y ${tile(r.y0)} (freight-yard buffer) to y ${tile(r.y1)} (Union Station buffer): ${((r.y1 - r.y0) / TILE).toFixed(0)} tiles.`);
P(`- Station stop at y ${tile(r.stops[0].at)} (dwell ${r.stops[0].dwell} s); ${((r.stops[0].at - r.y0) / TILE).toFixed(0)} tiles of track north of it, ${((r.y1 - r.stops[0].at) / TILE).toFixed(0)} south.`);
const xings = [];
let prev = false;
for (let y = tile(r.y0); y <= tile(r.y1); y++) {
  const q = City.roadAt(tile(r.x0), y);
  const on = !!(q && q.xing);
  if (on && !prev) xings.push({ y, street: c.streets[q.street] ? c.streets[q.street].name : '?' });
  prev = on;
}
P(`- Level crossings: ${xings.map((x) => `${x.street} (y ${x.y})`).join(', ')}.`);
P();
P('### Helicopters');
P();
P('Parked helicopters (`models: [\'helicopter\']`). Roof spots carry `alt` = building height and can\'t be boarded on foot; ground pads (alt 0) can.');
P();
P('| where (tiles) | neighbourhood | alt (px) | pad |');
P('|---|---|---|---|');
for (const h of c.heliSpots) P(`| ${tp(h.x, h.y)} | ${City.placeAt(h.x, h.y).neighborhood} (${City.placeAt(h.x, h.y).district}) | ${h.alt} | ${h.pad || 'roof helipad'} |`);
P();
P('### Anchors');
P();
P(`- Spawn ${tp(c.spawn.x, c.spawn.y)} on ${kindPx(c.spawn.x, c.spawn.y)} in ${City.placeAt(c.spawn.x, c.spawn.y).neighborhood} (${City.placeAt(c.spawn.x, c.spawn.y).street}).`);
P(`- Starter car (${c.starterCar.model}) ${tp(c.starterCar.x, c.starterCar.y)} on ${kindPx(c.starterCar.x, c.starterCar.y)}; tank ${tp(c.tankSpot.x, c.tankSpot.y)} on ${kindPx(c.tankSpot.x, c.tankSpot.y)}.`);
P(`- Boost garage ${tp(c.garage.x, c.garage.y)} in ${City.placeAt(c.garage.x, c.garage.y).neighborhood}.`);
for (const g of c.gunshops) P(`- Gun store ${g.id} **${g.name}** (${g.area}): door mat ${tp(g.x, g.y)} on ${kindPx(g.x, g.y)}, facing ${['north', 'east', 'south', 'west'][Math.round(((g.ang / (Math.PI / 2)) % 4 + 4) % 4)]}, building ${g.b.tw}x${g.b.th} at (${g.b.tx}, ${g.b.ty}), ${City.placeAt(g.x, g.y).neighborhood}, ${City.placeAt(g.x, g.y).street || 'no street'}; ${(Math.hypot(g.x - c.spawn.x, g.y - c.spawn.y) / TILE).toFixed(0)} tiles from the spawn. \`goto=Gun Store ${g.id + 1}\`, \`demo&shop=${g.id}\`.`);
for (const s of c.paintshops) P(`- Paint shop ${s.id} **${s.name}** (${s.district}): bay x ${s.bay.x0}-${s.bay.x1}, y ${s.bay.y0}-${s.bay.y1} px (tiles ${tp(s.bay.x0, s.bay.y0)}-${tp(s.bay.x1 - 1, s.bay.y1 - 1)}), car faces ${['north', 'east', 'south', 'west'][Math.round(((s.ang / (Math.PI / 2)) % 4 + 4) % 4)]} to the door, garage ${s.b.tw}x${s.b.th} at (${s.b.tx}, ${s.b.ty}), ${City.placeAt(s.x, s.y).neighborhood}, ${City.placeAt(s.x, s.y).street || 'no street'}. \`goto=Paint Shop ${s.id + 1}\`, \`demo&paint=${s.id}\`.`);
P(`- Police station (cops' hotspot): front door ${tp(c.policeStation.x, c.policeStation.y)} on ${kindPx(c.policeStation.x, c.policeStation.y)}, ${City.placeAt(c.policeStation.x, c.policeStation.y).neighborhood}.`);
for (const p of c.phones) P(`- Payphone ${p.district}: ${tp(p.x, p.y)}, ${City.placeAt(p.x, p.y).neighborhood}, ${City.placeAt(p.x, p.y).street || 'no street'}.`);
P();
P('### Goto places');
P();
P(Object.keys(c.places).map((k) => '`' + k + '`').join(', '));
P();
P(problems.length ? '**Checks: ' + problems.length + ' problem(s):** ' + problems.join('; ') : 'Checks: all anchors reachable, names unique, every land tile has a frame.');
console.log(out.join('\n'));
