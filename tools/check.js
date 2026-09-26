#!/usr/bin/env node
// Smoke check: loads every game script in one shared scope (like the browser
// does with plain <script> tags) and reports syntax or top-level errors.
// It does not run the game. Use tools/shot.sh for that.
//
//   node tools/check.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const files = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);

const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => stub() });
const ctx = { console, Math, JSON, performance: { now: () => 0 }, document: stub(), navigator: {}, addEventListener() {}, requestAnimationFrame() {} };
ctx.window = ctx;
vm.createContext(ctx);

let src = '';
for (const f of files) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) { console.error(`missing script: ${f}`); process.exit(1); }
  src += `\n//# file: ${f}\n` + fs.readFileSync(p, 'utf8');
}
try {
  vm.runInContext(src, ctx, { filename: 'bundle.js' });
} catch (e) {
  // map the bundle line back to the source file
  const line = +(String(e.stack).match(/bundle\.js:(\d+)/) || [])[1];
  let file = '?', start = 0;
  src.split('\n').forEach((l, i) => { const m = l.match(/^\/\/# file: (.+)$/); if (m && i + 1 <= line) { file = m[1]; start = i + 1; } });
  console.error(`FAIL ${file}:${line ? line - start : '?'}  ${e.message}`);
  process.exit(1);
}
console.log(`ok  ${files.length} scripts load cleanly (${files.join(', ')})`);
