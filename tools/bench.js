#!/usr/bin/env node
// Update-loop benchmark: loads every game script (like tools/check.js), starts the real game
// headless with canvas/audio stubbed out, and times Game.update over simulated seconds.
// Rendering is not measured (it needs a real canvas); this is the simulation cost only.
//
//   node tools/bench.js              60 s of driving from the spawn
//   node tools/bench.js --secs 20
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const secs = args.includes('--secs') ? +args[args.indexOf('--secs') + 1] : 60;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const files = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);

const stub = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : stub()), apply: () => stub() });
const ctx = { console, Math, JSON, performance: { now: () => Number(process.hrtime.bigint()) / 1e6 },
  document: stub(), navigator: {}, addEventListener() {}, requestAnimationFrame() {}, innerWidth: 1280, innerHeight: 720,
  localStorage: { getItem: () => null, setItem() {} } };
ctx.window = ctx;
vm.createContext(ctx);
let src = '';
for (const f of files) src += fs.readFileSync(path.join(root, f), 'utf8') + '\n';
src += 'for (const n in ATLAS) Assets.sheets[n] = ATLAS[n];\nthis.__api = { Game, G, Input, STEP: typeof STEP !== "undefined" ? STEP : 1 / 60 };';
vm.runInContext(src, ctx, { filename: 'bundle.js' });
const { Game, G, Input, STEP } = ctx.__api;

Game.start(20260925);
G.state = 'play';
vm.runInContext('Clock.init()', ctx);
G.cam.w = 1040; G.cam.h = 585;
G.perf = { upd: 0, draw: 0, cars: 0, updated: 0, pairs: 0 };
// hold the gas: the player walks/drives around, so the camera and AOV move
Input.throttle = () => 1; Input.axis = () => 0.15;

const ticks = Math.round(secs / STEP), times = [];
for (let i = 0; i < ticks; i++) {
  const t0 = process.hrtime.bigint();
  Game.update(STEP);
  times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  Game.updateCamera(STEP);
}
times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
const P = G.perf;
console.log(`update: avg ${avg.toFixed(3)} ms  p95 ${times[Math.floor(times.length * 0.95)].toFixed(3)} ms  max ${times[times.length - 1].toFixed(3)} ms  over ${ticks} ticks`);
console.log(`cars ${P.cars}  updated ${P.updated}  pairs ${P.pairs}`);
if (G.peds) {
  const by = {};
  for (const p of G.peds) { const k = p.kind + (p.dead ? ':dead' : ':' + p.state); by[k] = (by[k] || 0) + 1; }
  console.log(`peds ${G.peds.filter((p) => p.kind === 'ped' && !p.dead).length} (budget ${vm.runInContext('Peds.budget', ctx)})  ` + Object.entries(by).map(([k, v]) => k + ' ' + v).join('  '));
}
