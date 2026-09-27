'use strict';
// Sound v1: everything is synthesised with the Web Audio API (no samples, no fetch, so it
// works from file://). Spec: docs/specs/sound-v1.md. Owner: sound-agent.
//
// Graph:  sources → voice gain → stereo pan → bus → master (volume / mute) → limiter → out
//   buses: sfx   world one-shots and loops (positional)
//          amb   ambience beds and critters (positional or not)
//          ui    non-positional: phone, pickups, jingles, footsteps
//          music reserved for radio-agent (nothing here plays on it; it only gets ducked)
//
// Safety: every public call is a no-op until the first key/mouse gesture starts the
// AudioContext, and whenever audio is unavailable (headless screenshots, old browsers).
// Public entry points catch their own errors, so audio can never stop the game loop.
//
// How the game drives it:
//   Sound.update(dt)  once per game tick, also on the title and while paused. Continuous sounds
//                     (engines, skids, horns, sirens, fire, hydrant spray, train, payphone,
//                     cellphone, people's voices, cows, planes, cranes, ambience) are read from
//                     game state here and need no hooks.
//                     Loops are "wanted" each tick; anything not wanted is faded out and stopped.
//   one-line hooks    Sound.play / ui / shot / explode / impact / breakProp / door / pickup /
//                     punch / body at events in game.js, entities.js, peds.js and missions.js.
// soundboard.html lists every sound (Sound.catalog) for review and tuning.

const SND_STORE = 'pastelcity.sound';
const SND_BUS = { sfx: 0.9, amb: 0.55, ui: 0.7, music: 0.8 };   // bus levels before ducking
const sndClamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sndRand = (a, b) => a + Math.random() * (b - a);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const sndNop = () => {};
const SND_NOOPTS = {};

// Time of day for the ambience (spec docs/specs/time-v1.md §6). `dark` 0..1 comes from
// Clock.light(); without a clock (soundboard) it is full day. Everything that follows the clock
// is continuous in the hour, and the beds' gains glide on their own tau, so the O fast-forward
// (6 h in 1.5 s) sweeps the levels instead of jumping.
const sndLin = (x, a, b) => sndClamp((x - a) / (b - a), 0, 1);
function sndDaytime() {
  if (typeof Clock === 'undefined' || typeof G === 'undefined' || !G.clock) return { dark: 0, birds: 1 };
  const h = Clock.hour(), dark = Clock.light().dark;
  // songbirds: silent at night, dawn chorus 05:30-07:00 (x2.2), a normal day chorus (x1) by
  // 09:00, thinning from 16:00 and gone by 19:30
  const birds = h < 4.75 || h > 19.5 ? 0
    : h < 5.5 ? 2.2 * sndLin(h, 4.75, 5.5)
    : h < 7 ? 2.2
    : h < 9 ? 2.2 - 1.2 * sndLin(h, 7, 9)
    : 1 - sndLin(h, 16, 19.5);
  return { dark, birds };
}

// Engine classes. The oscillator runs at the engine's firing frequency (Hz), from `idle` to `top`;
// a low-pass keeps the harmonics that make the timbre. sub = second oscillator ratio, chug = depth
// of the amplitude throb (at half the firing rate), noise = intake/exhaust hiss, gears = fake gear
// count (1 = no gears, e.g. the electric forklift). vol = loop level.
const SND_ENGINES = {
  small:     { wave: 'sawtooth', idle: 36, top: 150, sub: 2, subMix: 0.25, cut: 420, cutR: 1600, q: 2, chug: 0.2, noise: 0.12, nf: 1400, gears: 4, vol: 0.34 },
  car:       { wave: 'sawtooth', idle: 30, top: 122, sub: 0.5, subMix: 0.35, cut: 360, cutR: 1300, q: 2, chug: 0.25, noise: 0.1, nf: 1000, gears: 4, vol: 0.36 },
  sport:     { wave: 'sawtooth', idle: 42, top: 250, sub: 2, subMix: 0.3, cut: 520, cutR: 3200, q: 3, chug: 0.12, noise: 0.08, nf: 2200, gears: 6, vol: 0.34 },
  muscle:    { wave: 'square', idle: 24, top: 110, sub: 0.5, subMix: 0.6, cut: 300, cutR: 1200, q: 2.5, chug: 0.6, noise: 0.14, nf: 700, gears: 4, vol: 0.4 },
  diesel:    { wave: 'sawtooth', idle: 16, top: 58, sub: 0.5, subMix: 0.5, cut: 240, cutR: 650, q: 1.5, chug: 0.5, noise: 0.22, nf: 450, gears: 5, vol: 0.5 },
  tractor:   { wave: 'square', idle: 11, top: 34, sub: 0.5, subMix: 0.4, cut: 260, cutR: 420, q: 2, chug: 0.85, noise: 0.18, nf: 380, gears: 3, vol: 0.5 },
  electric:  { wave: 'triangle', idle: 140, top: 900, sub: 2.005, subMix: 0.3, cut: 2500, cutR: 3000, q: 1, chug: 0, noise: 0.05, nf: 3000, gears: 1, vol: 0.26 },
  harvester: { wave: 'sawtooth', idle: 22, top: 40, sub: 1.02, subMix: 0.7, cut: 300, cutR: 400, q: 1.5, chug: 0.3, noise: 0.3, nf: 600, gears: 1, vol: 0.5 },
  tank:      { wave: 'sawtooth', idle: 15, top: 46, sub: 0.5, subMix: 0.6, cut: 220, cutR: 500, q: 1.5, chug: 0.55, noise: 0.2, nf: 400, gears: 3, vol: 0.55, tracks: true },
  rotor:     { rotor: true, vol: 0.6 },
};
// model → engine class (anything missing falls back by flags: air → rotor, tank, heavy → diesel, else car)
const SND_ENGINE_OF = {
  hatch: 'small', sedan: 'car', taxi: 'car', van: 'car', pickup: 'car', suv: 'car', ambulance: 'car', police_suv: 'car',
  sport: 'sport', police: 'sport', muscle: 'muscle',
  semi: 'diesel', bus: 'diesel', truck: 'diesel', tanker: 'diesel', flatbed: 'diesel', mixer: 'diesel', garbage: 'diesel',
  tractor: 'tractor', forklift: 'electric', harvester: 'harvester', tank: 'tank', helicopter: 'rotor',
};
const SND_HORNS = {
  small: { wave: 'square', f: [470, 590], lp: 2400, g: 1 },
  car:   { wave: 'square', f: [349, 440], lp: 1700, g: 1 },
  truck: { wave: 'sawtooth', f: [185, 233, 277], lp: 1100, g: 2 },
};
// max simultaneous loops per type (nearest win; the player's vehicle always first)
// weapon id → its firing sound (Sound.shot)
const SND_SHOT = { pistol: 'pistol', uzi: 'uzi', shotgun: 'shotgun', bazooka: 'bazooka', grenade: 'throwPin', molotov: 'throw' };
const SND_MAX = { engine: 5, skid: 3, horn: 3, siren: 3, fire: 3, scrape: 2, spray: 2, rocket: 4, patch: 3, burn: 2, plane: 2 };

// Voices for people (Sound.vox): vowels as three formants [Hz, Q, gain]. A speaker is { f0 (speaking
// pitch, Hz), fm (formant scale: vocal tract size) }; screams sit ~2.3-3x above f0, and everything
// is low-passed ≤ 3.2 kHz so a crowd never gets shrill.
const SND_VOWEL = {
  ah: [[800, 6, 1], [1200, 7, 0.6], [2600, 9, 0.22]],
  eh: [[550, 6, 1], [1800, 8, 0.55], [2600, 9, 0.25]],
  ee: [[320, 6, 1], [2250, 9, 0.5], [3000, 9, 0.2]],
  uh: [[620, 6, 1], [1050, 7, 0.5], [2400, 9, 0.15]],
  oh: [[480, 6, 1], [850, 7, 0.5], [2400, 9, 0.1]],
  nn: [[300, 5, 1], [1050, 6, 0.15], [2300, 8, 0.05]],   // the nasal end of "come ON"
};
function sndVoice() {
  return Math.random() < 0.5
    ? { f0: sndRand(92, 140), fm: sndRand(0.9, 1.02) }     // lower voices
    : { f0: sndRand(180, 245), fm: sndRand(1.07, 1.2) };   // higher voices
}
const SND_PLAYER_VOICE = { f0: 112, fm: 0.97 };
// cops (peds with mood 'cop'): a low, steady bark voice
const sndCopVoice = () => ({ f0: sndRand(86, 112), fm: sndRand(0.9, 0.98), cop: true });
// cop lines as syllables: [dur s, pitch ×, vowel, end pitch × (fall), plosive onset]; pitch 0 = a gap
const SND_COP_SAYS = {
  'POLICE! FREEZE!': [[0.08, 1, 'uh', 1, 1], [0.2, 1.2, 'ee', 1.05], [0.09, 0], [0.3, 1.28, 'ee', 0.82, 1]],
  'DROP IT!': [[0.2, 1.22, 'ah', 1.05, 1], [0.15, 1.02, 'ee', 0.78, 1]],
  'SHOTS FIRED!': [[0.2, 1.15, 'ah', 1.05, 1], [0.04, 0], [0.14, 1.22, 'ah', 1.1, 1], [0.2, 1.02, 'eh', 0.78]],
  "YOU'RE UNDER ARREST!": [[0.1, 1, 'oh', 1], [0.08, 1.05, 'uh'], [0.08, 1, 'eh'], [0.07, 1, 'uh'], [0.26, 1.26, 'eh', 0.82, 1]],
  'OFFICER DOWN!': [[0.1, 1.12, 'ah', 1.05], [0.08, 1.05, 'ee', 1, 1], [0.08, 1, 'eh'], [0.32, 1.22, 'ah', 0.8, 1]],
  'LOST HIM.': [[0.18, 0.96, 'ah', 0.9, 1], [0.2, 0.92, 'ee', 0.74]],
};
const SND_COP_DEFAULT = [[0.12, 1.1, 'ah', 1, 1], [0.1, 1.05, 'eh'], [0.22, 1.18, 'uh', 0.8, 1]];
// mob members (peds with mood 'gang', docs/specs/gangs-v1.md G5): one voice family per mob.
// f0/fm ranges; g = level (also scales their ouch/scream/growl); len = syllable length ×; swing = how far
// the pitch moves (1 = neutral); hold = syllable sustain (high = clipped, hard stops); gap between
// syllables; a = onset; lp/hp band; rough = rasp; breath = air; fall = the pitch drop at a phrase end.
const SND_MOB = {
  moretti: { f0: [100, 128], fm: [0.94, 1.0], g: 1.0, len: 1.12, swing: 1.45, hold: 0.5, gap: 0.008, a: 0.012, lp: 2400, hp: 140, rough: [30, 0.12], breath: 0.08, fall: 0.8, vib: [5.5, 0.025] },
  orlov: { f0: [72, 90], fm: [0.86, 0.92], g: 0.95, len: 0.78, swing: 0.45, hold: 0.8, gap: 0.045, a: 0.006, lp: 2200, hp: 110, rough: [26, 0.35], breath: 0.05, fall: 0.74 },
  orchid: { f0: [118, 150], fm: [1.0, 1.08], g: 0.6, len: 0.95, swing: 0.75, hold: 0.62, gap: 0.02, a: 0.03, lp: 2900, hp: 280, rough: null, breath: 0.4, fall: 0.86 },
};
const sndMobVoice = (id) => { const s = SND_MOB[id] || SND_MOB.moretti; return { f0: sndRand(s.f0[0], s.f0[1]), fm: sndRand(s.fm[0], s.fm[1]), g: s.g, mob: SND_MOB[id] ? id : 'moretti' }; };
// a bubble's text → syllables [dur, pitch ×, vowel, end ×, plosive] (0 pitch = a pause), in a mob's style.
// Rough English: vowel groups per word (a silent final E dropped), stress on each word's first syllable,
// the phrase drifts down; '!' lifts and drops the last syllable, '?' rises, '.' falls; a mid '.' or ',' pauses.
// the bubbles in peds.js GANG_SAYS (+ a violent ped's), for the soundboard; the game passes the live bubble text
const GANG_SAYS_SND = {
  moretti: ['THIS IS MORETTI TURF!', 'YOU LOST, PAL?', 'HEY! FAMILY BUSINESS!', 'WANNA GO?'],
  orlov: ['WRONG STREET, FRIEND.', 'YOU ARE LATE. FOR YOUR FUNERAL.', 'ORLOV SAYS HELLO.', 'COME ON!'],
  orchid: ['NOT WELCOME HERE.', 'THE ORCHID SEES YOU.', 'BAD MOVE.', 'YOU WANT SOME?'],
};
const SND_MOB_VW = { A: 'ah', E: 'eh', I: 'ee', O: 'oh', U: 'uh', Y: 'ee' };
const sndMobSylCache = new Map();
function sndMobSyl(text, mob) {
  const key = mob + '|' + text;
  let out = sndMobSylCache.get(key);
  if (out) return out;
  const st = SND_MOB[mob] || SND_MOB.moretti, words = String(text).toUpperCase().split(/\s+/).filter(Boolean);
  const parts = words.map((w) => {
    const clean = w.replace(/[^A-Z']/g, ''), punct = w.replace(/[A-Z']/g, '');
    let g = clean.match(/[AEIOUY]+/g) || ['U'];
    if (g.length > 1 && /[^AEIOUY]E$/.test(clean)) g = g.slice(0, -1);
    return { g: g.slice(0, 3), pl: /^[PTKBDGC]/.test(clean), punct };
  });
  let n = parts.reduce((s, p) => s + p.g.length, 0);
  if (n > 10) for (const p of parts.slice(0, -1)) { n -= p.g.length - 1; p.g = p.g.slice(0, 1); }
  out = [];
  let i = 0;
  parts.forEach((p, wi) => {
    const lastW = wi === parts.length - 1, bang = p.punct.includes('!'), ask = p.punct.includes('?'), stop = /[.,]/.test(p.punct);
    p.g.forEach((grp, si) => {
      const last = si === p.g.length - 1;
      let raw = 1.1 - 0.14 * (i / Math.max(1, n - 1)) + (si === 0 ? 0.06 : 0) + (bang && last ? 0.14 : 0);
      let d = (0.092 + (si === 0 ? 0.018 : 0) + (last ? 0.025 : 0)) * st.len, end = 1;
      if (last && (bang || ask || stop || lastW)) { d *= lastW ? 1.9 : 1.4; end = ask ? 1.25 : st.fall; }
      out.push([d, 1 + (raw - 1) * st.swing, SND_MOB_VW[grp[0]] || 'uh', 1 + (end - 1) * Math.min(1.2, st.swing + 0.4), si === 0 && p.pl ? 1 : 0]);
      i++;
    });
    if (!lastW && (stop || bang || ask)) out.push([0.13 * st.len, 0]);
  });
  sndMobSylCache.set(key, out);
  return out;
}
// a cow's moo: pitch factor p, length d, contour shape [start, peak, end] × f, rasp 0..1
function sndMoo(S, out, t, p, d, shape, rasp) {
  const f = 115 * p;
  const o = S.osc('sawtooth', f), f1 = S.filt('bandpass', 380 * (0.8 + 0.2 * p), 3), f2 = S.filt('bandpass', 950 * (0.8 + 0.2 * p), 4), g = S.gain(0), g2 = S.gain(0.5);
  o.frequency.setValueAtTime(f * shape[0], t); o.frequency.linearRampToValueAtTime(f * shape[1], t + d * 0.35); o.frequency.linearRampToValueAtTime(f * shape[2], t + d * 0.85);
  const vib = S.osc('sine', 5), vg = S.gain(3 * p); vib.connect(vg); vg.connect(o.frequency);
  S.env(g.gain, t, 0.12, 1.6, d * 0.5, d * 0.93);
  let tail = g;
  if (rasp) { const am = S.gain(1 - rasp * 0.5), l = S.osc('square', 31), lg = S.gain(rasp * 0.5); l.connect(lg); lg.connect(am.gain); g.connect(am); tail = am; l.start(t); l.stop(t + d); }
  o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g2); g2.connect(g); tail.connect(out);
  o.start(t); vib.start(t); o.stop(t + d); vib.stop(t + d);
  return d;
}

// ------------------------------------------------------------ sequencer --
// For patterned loops (ringtones, bells): calls step(t, dur, arg) for every step that falls in
// the next `look` seconds. Returns the function to call from the loop's set().
function sndSeq(S, v, pattern, step) {
  v.next = S.ctx.currentTime + 0.03; v.i = 0; v.look = 0.2;
  return () => {
    const now = S.ctx.currentTime;
    if (v.next < now) v.next = now + 0.02;
    while (v.next < now + v.look) {
      const st = pattern[v.i];
      step(v.next, st[0], st[1]);
      v.next += st[0];
      v.i = (v.i + 1) % pattern.length;
    }
  };
}
// open a gate gain for `on` seconds at t (tiny ramps, no clicks)
function sndGate(p, t, on, peak = 1) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + 0.008);
  p.setValueAtTime(peak, t + Math.max(0.01, on - 0.012));
  p.linearRampToValueAtTime(0, t + on);
}

// ================================================================ loops ==
// make(S, v, arg) builds the graph into v.out and sets v.set(...) (called every tick while wanted).
// Loop def: bus, vol, attack/release (s, time constants), range (× the view width), tau (level smoothing).
const SND_LOOPS = {
  engine: { attack: 0.15, release: 0.2, make(S, v, cls) {
    const E = SND_ENGINES[cls] || SND_ENGINES.car;
    v.vol = E.vol;
    if (E.rotor) return sndRotor(S, v);
    const lp = S.filt('lowpass', E.cut, E.q), am = S.gain(1 - E.chug * 0.5);
    const o1 = S.osc(E.wave, E.idle), o2 = S.osc(E.wave, E.idle * E.sub);
    o2.detune.value = sndRand(-7, 7);
    const m1 = S.gain(0.4), m2 = S.gain(0.4 * E.subMix);
    o1.connect(m1); o2.connect(m2); m1.connect(lp); m2.connect(lp); lp.connect(am); am.connect(v.out);
    let lfo = null;
    if (E.chug) { lfo = S.osc('sine', E.idle * 0.5); const lg = S.gain(E.chug * 0.5); lfo.connect(lg); lg.connect(am.gain); S.start(v, lfo); }
    const ns = S.src(false), bp = S.filt('bandpass', E.nf, 0.9), ng = S.gain(0);
    ns.connect(bp); bp.connect(ng); ng.connect(v.out);
    S.start(v, o1); S.start(v, o2); S.start(v, ns);
    let tg = null, tl = null;
    if (E.tracks) { // tank treads: bright noise chopped at the link rate
      const ts = S.src(false), hp = S.filt('bandpass', 2400, 1.5), tam = S.gain(0.5), tlg = S.gain(0.5);
      tl = S.osc('square', 4); tg = S.gain(0);
      tl.connect(tlg); tlg.connect(tam.gain); ts.connect(hp); hp.connect(tam); tam.connect(tg); tg.connect(v.out);
      S.start(v, ts); S.start(v, tl);
    }
    // rpm 0..1, load = throttle 0..1, spd = speed fraction (treads)
    v.set = (rpm, load, spd) => {
      const now = S.ctx.currentTime, f = E.idle + (E.top - E.idle) * rpm;
      o1.frequency.setTargetAtTime(f, now, 0.05);
      o2.frequency.setTargetAtTime(f * E.sub, now, 0.05);
      if (lfo) lfo.frequency.setTargetAtTime(f * 0.5, now, 0.05);
      lp.frequency.setTargetAtTime(E.cut + E.cutR * (0.35 * rpm + 0.65 * load * (0.3 + rpm)), now, 0.06);
      m1.gain.setTargetAtTime(0.3 + 0.2 * load, now, 0.08);
      ng.gain.setTargetAtTime(E.noise * (0.25 + 0.75 * load) * (0.4 + rpm), now, 0.06);
      if (tg) { tg.gain.setTargetAtTime(0.6 * Math.min(1, spd * 2.5), now, 0.08); tl.frequency.setTargetAtTime(2 + spd * 22, now, 0.08); }
    };
  } },

  rocket: { vol: 0.35, attack: 0.02, release: 0.05, range: 1.2, make(S, v) { // rocket in flight: hiss + flutter
    const s = S.src(false), bp = S.filt('bandpass', 1500, 1.3), am = S.gain(0.7), lfo = S.osc('square', 23), lg = S.gain(0.3);
    const s2 = S.src(true), lp = S.filt('lowpass', 400, 0.7), g2 = S.gain(0.8);
    lfo.connect(lg); lg.connect(am.gain);
    s.connect(bp); bp.connect(am); am.connect(v.out); s2.connect(lp); lp.connect(g2); g2.connect(v.out);
    S.start(v, s); S.start(v, lfo); S.start(v, s2);
  } },

  skid: { vol: 0.35, attack: 0.03, release: 0.08, make(S, v) {
    const s = S.src(false), b1 = S.filt('bandpass', 1150, 5), b2 = S.filt('bandpass', 2350, 8), g = S.gain(0);
    const lfo = S.osc('sine', 7.5), lg = S.gain(120);
    lfo.connect(lg); lg.connect(b1.frequency);
    s.connect(b1); s.connect(b2); b1.connect(g); b2.connect(g); g.connect(v.out);
    S.start(v, s); S.start(v, lfo);
    v.set = (amt) => g.gain.setTargetAtTime(1.5 + 3 * amt, S.ctx.currentTime, 0.05);
  } },

  scrape: { vol: 0.5, attack: 0.03, release: 0.1, make(S, v) {
    const s = S.src(false), bp = S.filt('bandpass', 1500, 1.4), g = S.gain(0);
    const lfo = S.osc('sawtooth', 13), lg = S.gain(500);
    lfo.connect(lg); lg.connect(bp.frequency);
    s.connect(bp); bp.connect(g); g.connect(v.out);
    S.start(v, s); S.start(v, lfo);
    v.set = (amt) => g.gain.setTargetAtTime(0.6 + 1.4 * amt, S.ctx.currentTime, 0.05);
  } },

  horn: { vol: 0.28, attack: 0.01, release: 0.03, make(S, v, cls) {
    const H = SND_HORNS[cls] || SND_HORNS.car, lp = S.filt('lowpass', H.lp, 1), g = S.gain(H.g / H.f.length);
    for (const f of H.f) { const o = S.osc(H.wave, f); o.detune.value = sndRand(-6, 6); o.connect(lp); S.start(v, o); }
    lp.connect(g); g.connect(v.out);
  } },

  siren: { vol: 0.26, attack: 0.03, release: 0.1, range: 1.5, make(S, v, kind) {
    const amb = kind === 'ambulance';
    const o = S.osc('triangle', amb ? 825 : 1000), o2 = S.osc('sine', amb ? 1650 : 2000), g2 = S.gain(0.15);
    const lfo = S.osc(amb ? 'square' : 'triangle', amb ? 0.8 : 0.3), lg = S.gain(amb ? 125 : 420), lg2 = S.gain(amb ? 250 : 840);
    lfo.connect(lg); lg.connect(o.frequency); lfo.connect(lg2); lg2.connect(o2.frequency);
    o.connect(v.out); o2.connect(g2); g2.connect(v.out);
    S.start(v, o); S.start(v, o2); S.start(v, lfo);
    // police: 5 s wail (slow sweep) ↔ 5 s yelp (fast rising whoops)
    const t0 = S.ctx.currentTime;
    v.mode = 0;
    v.set = () => {
      if (amb) return;
      const now = S.ctx.currentTime, m = Math.floor((now - t0) / 5) % 2;
      if (m === v.mode) return;
      v.mode = m;
      lfo.type = m ? 'sawtooth' : 'triangle';
      lfo.frequency.setValueAtTime(m ? 3.6 : 0.3, now);
    };
  } },

  fire: { vol: 0.4, attack: 0.3, release: 0.35, make(S, v) {
    const s = S.src(true), lp = S.filt('lowpass', 650, 0.7), g = S.gain(0.8);
    const s2 = S.src(false), bp = S.filt('bandpass', 1800, 0.8), g2 = S.gain(0.06);
    s.connect(lp); lp.connect(g); g.connect(v.out); s2.connect(bp); bp.connect(g2); g2.connect(v.out);
    S.start(v, s); S.start(v, s2);
    v.set = (dt) => { // random crackles
      if (Math.random() < 7 * (dt || 0.016)) S.noise(v.out, S.ctx.currentTime + Math.random() * 0.02, { type: 'highpass', f: sndRand(1500, 4500), q: 0.7, dur: sndRand(0.01, 0.04), gain: sndRand(0.4, 1.1) });
    };
  } },

  spray: { vol: 0.35, attack: 0.1, release: 0.4, make(S, v) {
    const s = S.src(false), hp = S.filt('highpass', 1200, 0.7), lp = S.filt('lowpass', 7000, 0.7), g = S.gain(0);
    const s2 = S.src(true), bp = S.filt('bandpass', 500, 0.8), g2 = S.gain(0);
    s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(v.out); s2.connect(bp); bp.connect(g2); g2.connect(v.out);
    S.start(v, s); S.start(v, s2);
    v.set = (amt) => { const now = S.ctx.currentTime; g.gain.setTargetAtTime(0.9 * amt, now, 0.2); g2.gain.setTargetAtTime(0.7 * amt, now, 0.2); };
  } },

  // paint shop respray: an air compressor chugging and the aerosol hiss sweeping over the car. set(t) = s left
  paintSpray: { vol: 0.4, attack: 0.08, release: 0.12, make(S, v) {
    const s = S.src(false), hp = S.filt('highpass', 3200, 0.7), lp = S.filt('lowpass', 9000, 0.7), g = S.gain(0.55);
    const sw = S.osc('sine', 1.7), swg = S.gain(0.3);   // the gun passing back and forth
    sw.connect(swg); swg.connect(g.gain);
    const hg = S.gain(1);
    s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(hg); hg.connect(v.out);
    const b = S.src(true), blp = S.filt('lowpass', 260, 1), bg = S.gain(0.5), pump = S.osc('square', 13), pg = S.gain(0.4);   // compressor piston
    pump.connect(pg); pg.connect(bg.gain);
    const hum = S.osc('sawtooth', 58), hlp = S.filt('lowpass', 220, 1), humg = S.gain(0.1);
    b.connect(blp); blp.connect(bg); bg.connect(v.out); hum.connect(hlp); hlp.connect(humg); humg.connect(v.out);
    S.start(v, s); S.start(v, sw); S.start(v, b); S.start(v, pump); S.start(v, hum);
    v.set = (left) => { hg.gain.setTargetAtTime(sndClamp((left ?? 1) / 0.15, 0, 1), S.ctx.currentTime, 0.03); };   // the trigger lets go at the end
  } },
  servo: { vol: 0.14, attack: 0.03, release: 0.06, make(S, v) {
    const o = S.osc('square', 150), lp = S.filt('lowpass', 900, 3), o2 = S.osc('sine', 460), g2 = S.gain(0.3);
    o.connect(lp); lp.connect(v.out); o2.connect(g2); g2.connect(v.out);
    S.start(v, o); S.start(v, o2);
    v.set = (amt) => { const now = S.ctx.currentTime; o.frequency.setTargetAtTime(120 + 90 * amt, now, 0.05); o2.frequency.setTargetAtTime(400 + 200 * amt, now, 0.05); };
  } },

  train: { vol: 0.65, attack: 0.5, release: 0.6, range: 1.5, make(S, v) {
    const r = S.src(true), rl = S.filt('lowpass', 140, 0.7), rg = S.gain(0.3);
    const w = S.src(false), wb = S.filt('bandpass', 650, 0.6), wg = S.gain(0);
    const e = S.osc('sawtooth', 26), el = S.filt('lowpass', 200, 2), cam = S.gain(0.7), eg = S.gain(0.45);
    const lfo = S.osc('sine', 13), lg = S.gain(0.3);
    r.connect(rl); rl.connect(rg); rg.connect(v.out);
    w.connect(wb); wb.connect(wg); wg.connect(v.out);
    lfo.connect(lg); lg.connect(cam.gain); e.connect(el); el.connect(cam); cam.connect(eg); eg.connect(v.out);
    S.start(v, r); S.start(v, w); S.start(v, e); S.start(v, lfo);
    v.set = (spd) => {
      const now = S.ctx.currentTime;
      rg.gain.setTargetAtTime(0.3 + 0.9 * spd, now, 0.2);
      wg.gain.setTargetAtTime(0.35 * spd, now, 0.2);
      e.frequency.setTargetAtTime(24 + 22 * spd, now, 0.3);
      lfo.frequency.setTargetAtTime(12 + 11 * spd, now, 0.3);
      el.frequency.setTargetAtTime(180 + 220 * spd, now, 0.3);
    };
  } },

  squeal: { vol: 0.3, attack: 0.1, release: 0.25, range: 1.3, make(S, v) {
    const o = S.osc('sine', 2900), o2 = S.osc('sine', 3470), lfo = S.osc('sine', 6), lg = S.gain(35), g = S.gain(0);
    lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
    o.connect(g); o2.connect(g); g.connect(v.out);
    S.start(v, o); S.start(v, o2); S.start(v, lfo);
    v.set = (amt) => g.gain.setTargetAtTime(0.5 * amt, S.ctx.currentTime, 0.1);
  } },

  boat: { bus: 'amb', vol: 0.3, attack: 0.5, release: 0.6, make(S, v) {
    const o = S.osc('sawtooth', 40), lp = S.filt('lowpass', 300, 2), am = S.gain(0.55), lfo = S.osc('square', 8.5), lg = S.gain(0.45);
    const s = S.src(true), sl = S.filt('lowpass', 400, 0.7), sg = S.gain(0.3);
    lfo.connect(lg); lg.connect(am.gain); o.connect(lp); lp.connect(am); am.connect(v.out);
    s.connect(sl); sl.connect(sg); sg.connect(v.out);
    S.start(v, o); S.start(v, lfo); S.start(v, s);
  } },

  // payphone bell: two bells hammered at 20 Hz, UK-style double ring
  payphone: { vol: 0.22, attack: 0.02, release: 0.1, range: 1.3, make(S, v) {
    const o1 = S.osc('sine', 1250), o2 = S.osc('sine', 1560), o3 = S.osc('triangle', 2610), g3 = S.gain(0.3);
    const trem = S.gain(0.5), lfo = S.osc('square', 20), lg = S.gain(0.5), gate = S.gain(0);
    lfo.connect(lg); lg.connect(trem.gain);
    o1.connect(trem); o2.connect(trem); o3.connect(g3); g3.connect(trem); trem.connect(gate); gate.connect(v.out);
    S.start(v, o1); S.start(v, o2); S.start(v, o3); S.start(v, lfo);
    v.set = sndSeq(S, v, [[0.6, 0.4], [0.4, 0.4], [2, 0]], (t, d, on) => { if (on) sndGate(gate.gain, t, on); });
  } },

  // cellphone ringtone: a little square-wave tune on the ui bus
  ringtone: { bus: 'ui', vol: 0.3, attack: 0.005, release: 0.05, make(S, v) {
    const o = S.osc('square', 1000), lp = S.filt('lowpass', 3500, 0.7), gate = S.gain(0);
    o.connect(lp); lp.connect(gate); gate.connect(v.out); S.start(v, o);
    const P = [[0.11, 76], [0.11, 79], [0.11, 83], [0.22, 88], [0.11, 0], [0.11, 83], [0.33, 88], [0.9, 0]];
    v.set = sndSeq(S, v, P, (t, d, m) => { if (m) { o.frequency.setValueAtTime(mtof(m), t); sndGate(gate.gain, t, d * 0.85); } });
  } },

  // calling tone heard while dialling a contact
  ringback: { bus: 'ui', vol: 0.18, attack: 0.005, release: 0.05, make(S, v) {
    const o1 = S.osc('sine', 400), o2 = S.osc('sine', 450), gate = S.gain(0);
    o1.connect(gate); o2.connect(gate); gate.connect(v.out); S.start(v, o1); S.start(v, o2);
    v.set = sndSeq(S, v, [[0.6, 0.4], [2, 0.4]], (t, d, on) => sndGate(gate.gain, t, on));
  } },

  // --- people and animals
  // a ped on fire: wavering screams in breathless phrases, until it drops (arg = the ped's voice)
  burnScream: { vol: 0.38, attack: 0.04, release: 0.2, make(S, v, voice) {
    const vc = voice || sndVoice();
    v.next = S.ctx.currentTime + 0.02;
    v.set = () => {
      const now = S.ctx.currentTime;
      if (v.next < now) v.next = now + 0.02;
      while (v.next < now + (v.look || 0.25)) {
        const d = sndRand(0.55, 1.1), f = vc.f0 * sndRand(2.3, 3), w = sndRand(0.9, 1.15);
        S.vox(v.out, v.next, { f: [[0, f * 0.8], [d * 0.3, f * 1.1 * w], [d * 0.65, f * 0.92], [d, f * 0.72]], dur: d, a: 0.05, hold: d * 0.45, gain: 0.8,
          vowel: SND_VOWEL.ah, vowel2: Math.random() < 0.5 ? SND_VOWEL.oh : null, fm: vc.fm, vib: [sndRand(7, 10), f * 0.06], breath: 0.35 });
        v.next += d + sndRand(0.08, 0.25);   // a gasp between cries
      }
    };
  } },
  // stampeding herd / a charging bull: hoof beats over a ground rumble; set(n bodies running, heavy)
  hooves: { vol: 0.5, attack: 0.1, release: 0.4, range: 1.2, make(S, v) {
    const s = S.src(true), lp = S.filt('lowpass', 150, 0.7), g = S.gain(0);
    s.connect(lp); lp.connect(g); g.connect(v.out); S.start(v, s);
    v.next = S.ctx.currentTime + 0.02;
    v.set = (n, heavy) => {
      const now = S.ctx.currentTime, rate = Math.min(26, 5 + 4 * n);
      g.gain.setTargetAtTime(Math.min(1, 0.2 * n), now, 0.2);
      if (v.next < now) v.next = now + 0.01;
      while (v.next < now + (v.look || 0.2)) {
        const k = sndRand(0.5, 1) * (heavy ? 1.2 : 1);
        S.tone(v.out, v.next, { f: sndRand(70, 95), f1: 40, dur: 0.07, gain: 0.55 * k });
        S.noise(v.out, v.next, { type: 'lowpass', f: sndRand(500, 900), dur: 0.04, gain: 0.5 * k });
        v.next += sndRand(0.4, 1.6) / rate;
      }
    };
  } },

  // --- airport and port
  // airliner: fan roar + exhaust hiss + turbine whine; set(spool 0 idle..1 take-off, rev 0/1, near 0..1).
  // `near` (the distance gain) dulls it far away: the whine goes first, the roar carries.
  jet: { vol: 0.5, attack: 0.6, release: 1.2, tau: 0.25, range: 3, make(S, v) {
    const fl = S.filt('lowpass', 6000, 0.7);
    fl.connect(v.out);
    const r = S.src(true), rl = S.filt('lowpass', 300, 0.8), rg = S.gain(0);
    const h = S.src(false), hb = S.filt('bandpass', 1200, 0.8), hg = S.gain(0);
    const w1 = S.osc('sine', 1600), w2 = S.osc('sine', 1600 * 1.498), wg = S.gain(0), w2g = S.gain(0.5);
    const b = S.osc('sawtooth', 50), bl = S.filt('lowpass', 180, 1), bg = S.gain(0);
    r.connect(rl); rl.connect(rg); rg.connect(fl);
    h.connect(hb); hb.connect(hg); hg.connect(fl);
    w1.connect(wg); w2.connect(w2g); w2g.connect(wg); wg.connect(fl);
    b.connect(bl); bl.connect(bg); bg.connect(fl);
    for (const n of [r, h, w1, w2, b]) S.start(v, n);
    v.set = (spool, rev, near) => {
      const now = S.ctx.currentTime, T = 0.7, k = Math.max(spool, 0.9 * rev), wf = 1500 + 2500 * spool;
      rl.frequency.setTargetAtTime(220 + 1200 * k, now, T);
      rg.gain.setTargetAtTime(0.3 + 1.2 * k * k, now, T);
      hb.frequency.setTargetAtTime(900 + 1300 * k, now, T);
      hg.gain.setTargetAtTime(0.06 + 0.3 * k + 0.35 * rev, now, T);
      w1.frequency.setTargetAtTime(wf, now, T); w2.frequency.setTargetAtTime(wf * 1.498, now, T);
      wg.gain.setTargetAtTime(0.07 * (1 - 0.4 * rev) * near * near, now, T);
      b.frequency.setTargetAtTime(40 + 60 * k, now, T); bg.gain.setTargetAtTime(0.12 + 0.25 * k, now, T);
      fl.frequency.setTargetAtTime(700 + 8000 * near * near, now, 0.3);
    };
  } },
  // prop plane: a buzzy piston engine and the propeller's blade-pass thrum; same set() as the jet
  prop: { vol: 0.45, attack: 0.5, release: 1, tau: 0.25, range: 2.2, make(S, v) {
    const fl = S.filt('lowpass', 6000, 0.7);
    fl.connect(v.out);
    const o1 = S.osc('sawtooth', 40), o2 = S.osc('square', 20), ol = S.filt('lowpass', 500, 2), og = S.gain(0), o2g = S.gain(0.4);
    const ns = S.src(false), nb = S.filt('bandpass', 600, 0.8), am = S.gain(0.5), lfo = S.osc('sawtooth', 30), lg = S.gain(0.5), ng = S.gain(0);
    o1.connect(ol); o2.connect(o2g); o2g.connect(ol); ol.connect(og); og.connect(fl);
    lfo.connect(lg); lg.connect(am.gain); ns.connect(nb); nb.connect(am); am.connect(ng); ng.connect(fl);
    for (const n of [o1, o2, ns, lfo]) S.start(v, n);
    v.set = (spool, rev, near) => {
      const now = S.ctx.currentTime, T = 0.6, k = Math.max(spool, 0.8 * rev), f = 32 + 70 * k;
      o1.frequency.setTargetAtTime(f, now, T); o2.frequency.setTargetAtTime(f * 0.5, now, T);
      lfo.frequency.setTargetAtTime(f * 0.75, now, T);
      ol.frequency.setTargetAtTime(350 + 1300 * k, now, T);
      og.gain.setTargetAtTime(0.35 + 0.25 * k, now, T);
      nb.frequency.setTargetAtTime(500 + 700 * k + 400 * rev, now, T);
      ng.gain.setTargetAtTime(0.2 + 0.6 * k + 0.4 * rev, now, T);
      fl.frequency.setTargetAtTime(600 + 7000 * near * near, now, 0.3);
    };
  } },
  // gantry crane drives: electric motor hum + gear whine + cable hiss; set(amount 0..1, hoisting)
  craneMotor: { bus: 'amb', vol: 0.4, attack: 0.15, release: 0.3, tau: 0.15, range: 1.4, make(S, v) {
    const o = S.osc('sawtooth', 50), ol = S.filt('lowpass', 260, 2), og = S.gain(0);
    const w = S.osc('triangle', 300), wg = S.gain(0);
    const n = S.src(false), nb = S.filt('bandpass', 900, 3), ng = S.gain(0);
    o.connect(ol); ol.connect(og); og.connect(v.out); w.connect(wg); wg.connect(v.out); n.connect(nb); nb.connect(ng); ng.connect(v.out);
    for (const x of [o, w, n]) S.start(v, x);
    v.set = (amt, hoist) => {
      const now = S.ctx.currentTime;
      og.gain.setTargetAtTime(0.6 * Math.min(1, amt * 1.5), now, 0.12);
      w.frequency.setTargetAtTime(240 + 480 * amt + (hoist ? 140 : 0), now, 0.15);
      wg.gain.setTargetAtTime(0.14 * amt, now, 0.12);
      nb.frequency.setTargetAtTime(hoist ? 1300 : 800, now, 0.2);
      ng.gain.setTargetAtTime(0.35 * amt, now, 0.12);
    };
  } },

  // --- ambience beds (amb bus, non-positional, slow crossfades)
  bedCity: { bus: 'amb', vol: 0.5, attack: 1.2, release: 1.5, tau: 1.2, make(S, v) {
    const s = S.src(true), lp = S.filt('lowpass', 320, 0.7), s2 = S.src(false), bp = S.filt('bandpass', 1100, 0.5), g2 = S.gain(0.05);
    const lfo = S.osc('sine', 0.07), lg = S.gain(90);
    lfo.connect(lg); lg.connect(lp.frequency);
    s.connect(lp); lp.connect(v.out); s2.connect(bp); bp.connect(g2); g2.connect(v.out);
    S.start(v, s); S.start(v, s2); S.start(v, lfo);
  } },
  bedSuburb: { bus: 'amb', vol: 0.4, attack: 1.2, release: 1.5, tau: 1.2, make(S, v) {
    const s = S.src(true), lp = S.filt('lowpass', 220, 0.7), s2 = S.src(false), hp = S.filt('highpass', 5000, 0.7), g2 = S.gain(0.03);
    const lfo = S.osc('sine', 0.13), lg = S.gain(0.02);
    lfo.connect(lg); lg.connect(g2.gain);
    s.connect(lp); lp.connect(v.out); s2.connect(hp); hp.connect(g2); g2.connect(v.out);
    S.start(v, s); S.start(v, s2); S.start(v, lfo);
  } },
  bedIndustrial: { bus: 'amb', vol: 0.5, attack: 1.2, release: 1.5, tau: 1.2, make(S, v) {
    const s = S.src(true), lp = S.filt('lowpass', 160, 0.7), o = S.osc('sawtooth', 48), ol = S.filt('lowpass', 120, 1), og = S.gain(0.12);
    const lfo = S.osc('sine', 0.05), lg = S.gain(0.08);
    lfo.connect(lg); lg.connect(og.gain);
    s.connect(lp); lp.connect(v.out); o.connect(ol); ol.connect(og); og.connect(v.out);
    S.start(v, s); S.start(v, o); S.start(v, lfo);
  } },
  bedWind: { bus: 'amb', vol: 0.8, attack: 1.2, release: 1.5, tau: 1.2, make(S, v) {
    const s = S.src(false), bp = S.filt('bandpass', 450, 1.2), am = S.gain(0.6);
    const l1 = S.osc('sine', 0.09), g1 = S.gain(250), l2 = S.osc('sine', 0.13), g2 = S.gain(0.4);
    l1.connect(g1); g1.connect(bp.frequency); l2.connect(g2); g2.connect(am.gain);
    s.connect(bp); bp.connect(am); am.connect(v.out);
    S.start(v, s); S.start(v, l1); S.start(v, l2);
  } },
  bedDesert: { bus: 'amb', vol: 0.7, attack: 1.2, release: 1.5, tau: 1.2, make(S, v) {
    const s = S.src(false), bp = S.filt('bandpass', 1100, 4), am = S.gain(0.6);
    const l1 = S.osc('sine', 0.06), g1 = S.gain(600), l2 = S.osc('sine', 0.11), g2 = S.gain(0.4);
    l1.connect(g1); g1.connect(bp.frequency); l2.connect(g2); g2.connect(am.gain);
    s.connect(bp); bp.connect(am); am.connect(v.out);
    S.start(v, s); S.start(v, l1); S.start(v, l2);
  } },
  bedSea: { bus: 'amb', vol: 0.5, attack: 1.2, release: 1.5, tau: 1.2, make(S, v) {
    const s = S.src(true), lp = S.filt('lowpass', 500, 0.7), am = S.gain(0.55);
    const s2 = S.src(false), hp = S.filt('highpass', 2500, 0.7), am2 = S.gain(0.05);
    const lfo = S.osc('sine', 0.11), lg = S.gain(0.45), lg2 = S.gain(0.05);
    lfo.connect(lg); lg.connect(am.gain); lfo.connect(lg2); lg2.connect(am2.gain);
    s.connect(lp); lp.connect(am); am.connect(v.out); s2.connect(hp); hp.connect(am2); am2.connect(v.out);
    S.start(v, s); S.start(v, s2); S.start(v, lfo);
  } },
  bedCrickets: { bus: 'amb', vol: 0.07, attack: 1.2, release: 1.5, tau: 1.2, make(S, v) {
    for (const [f, r1, r2] of [[4300, 30, 1.3], [4750, 34, 0.9]]) {
      const o = S.osc('sine', f), g1 = S.gain(0.5), g2 = S.gain(0.5);
      const a = S.osc('square', r1), ag = S.gain(0.5), b = S.osc('square', r2), bg = S.gain(0.5);
      a.connect(ag); ag.connect(g1.gain); b.connect(bg); bg.connect(g2.gain);
      o.connect(g1); g1.connect(g2); g2.connect(v.out);
      S.start(v, o); S.start(v, a); S.start(v, b);
    }
  } },
};
const SND_BEDS = ['bedCity', 'bedSuburb', 'bedIndustrial', 'bedWind', 'bedDesert', 'bedSea', 'bedCrickets'];

// helicopter rotor: noise chopped at the blade rate + a thin turbine whine; set(spin, load)
function sndRotor(S, v) {
  const ns = S.src(true), lp = S.filt('lowpass', 500, 1), am = S.gain(0.4), lfo = S.osc('sawtooth', 6), lg = S.gain(0.6);
  const ws = S.src(false), bp = S.filt('bandpass', 900, 1.2), am2 = S.gain(0.2), lg2 = S.gain(0.2), sg = S.gain(0);
  const tur = S.osc('sine', 1800), tg = S.gain(0), level = S.gain(0);
  lfo.connect(lg); lg.connect(am.gain); lfo.connect(lg2); lg2.connect(am2.gain);
  ns.connect(lp); lp.connect(am); am.connect(level);
  ws.connect(bp); bp.connect(am2); am2.connect(sg); sg.connect(level);
  tur.connect(tg); tg.connect(level); level.connect(v.out);
  for (const n of [ns, lfo, ws, tur]) S.start(v, n);
  v.set = (spin, load) => {
    const now = S.ctx.currentTime;
    lfo.frequency.setTargetAtTime(3 + 13 * spin, now, 0.1);
    lp.frequency.setTargetAtTime(300 + 500 * spin + 300 * load, now, 0.1);
    sg.gain.setTargetAtTime(1.2 * spin, now, 0.1);
    tur.frequency.setTargetAtTime(900 + 1500 * spin + 200 * load, now, 0.1);
    tg.gain.setTargetAtTime(0.05 * spin, now, 0.1);
    level.gain.setTargetAtTime(Math.min(1, spin * 1.3) * (0.8 + 0.2 * load), now, 0.1);
  };
}

// ============================================================ one-shots ==
// fn(S, out, t, o) schedules the sound at time t into `out` and returns its length (s).
// bus defaults to sfx (ui when played with no position), limit = max voices (oldest is cut),
// range = audible distance × the view width, vol = level.
const SND_SFX = {
  // --- weapons
  pistol: { limit: 4, vol: 0.8, fn(S, out, t) {
    S.noise(out, t, { type: 'highpass', f: 1000, f1: 600, dur: 0.14, gain: 0.9 });
    S.tone(out, t, { f: 180, f1: 55, dur: 0.09, gain: 0.7 });
    S.noise(out, t + 0.01, { type: 'bandpass', f: 600, q: 0.8, dur: 0.28, gain: 0.18 });
    return 0.35;
  } },
  uzi: { limit: 5, vol: 0.6, fn(S, out, t) {
    S.noise(out, t, { type: 'highpass', f: 1800, f1: 1100, dur: 0.06, gain: 0.8 });
    S.tone(out, t, { f: sndRand(210, 240), f1: 90, dur: 0.045, gain: 0.5 });
    return 0.08;
  } },
  empty: { limit: 2, vol: 0.9, fn(S, out, t) {
    S.noise(out, t, { type: 'bandpass', f: 3200, q: 4, dur: 0.015, gain: 1 });
    S.noise(out, t + 0.05, { type: 'bandpass', f: 1600, q: 4, dur: 0.02, gain: 0.8 });
    return 0.1;
  } },
  cock: { limit: 2, vol: 0.7, fn(S, out, t) { // weapon switch / weapon pickup
    S.noise(out, t, { type: 'bandpass', f: 2500, q: 8, dur: 0.03, gain: 1.4 });
    S.tone(out, t, { type: 'square', f: 900, f1: 500, dur: 0.03, gain: 0.08 });
    S.noise(out, t + 0.1, { type: 'bandpass', f: 1800, q: 8, dur: 0.045, gain: 1.6 });
    S.tone(out, t + 0.1, { f: 140, f1: 90, dur: 0.05, gain: 0.3 });
    return 0.2;
  } },
  cannon: { limit: 2, vol: 0.8, range: 1.8, fn(S, out, t) {
    S.noise(out, t, { type: 'highpass', f: 2500, dur: 0.05, gain: 0.6 });
    S.noise(out, t, { type: 'lowpass', brown: true, f: 1400, f1: 120, dur: 1.4, gain: 1.4 });
    S.tone(out, t, { f: 95, f1: 28, dur: 0.6, gain: 1 });
    S.duck(0.5);
    return 1.5;
  } },
  ping: { limit: 4, vol: 0.35, fn(S, out, t) { // bullet on a car body
    const f = sndRand(2100, 2800);
    S.tone(out, t, { type: 'triangle', f, f1: f * 0.9, dur: 0.12, gain: 0.8 });
    S.noise(out, t, { type: 'bandpass', f: 3500, q: 2, dur: 0.02, gain: 0.7 });
    return 0.14;
  } },
  clang: { limit: 3, vol: 0.4, fn(S, out, t) { // bullet on the tank's armour
    const f = sndRand(600, 760);
    S.tone(out, t, { type: 'square', f, dur: 0.28, gain: 0.25, lp: 2400 });
    S.tone(out, t, { f: f * 2.76, dur: 0.2, gain: 0.2 });
    S.noise(out, t, { type: 'bandpass', f: 3000, q: 2, dur: 0.02, gain: 0.8 });
    return 0.3;
  } },
  ricochet: { limit: 4, vol: 0.6, fn(S, out, t) { // bullet on a wall
    S.noise(out, t, { type: 'bandpass', f: 2200, q: 1.5, dur: 0.03, gain: 0.9 });
    if (Math.random() < 0.5) S.tone(out, t + 0.01, { f: sndRand(2800, 3600), f1: sndRand(800, 1100), dur: 0.25, gain: 0.35 });
    return 0.27;
  } },

  shotgun: { limit: 3, vol: 0.7, fn(S, out, t) { // blast, then the pump
    S.noise(out, t, { type: 'highpass', f: 600, f1: 350, dur: 0.25, gain: 1 });
    S.noise(out, t, { type: 'lowpass', brown: true, f: 900, f1: 150, dur: 0.4, gain: 1.1 });
    S.tone(out, t, { f: 130, f1: 38, dur: 0.16, gain: 0.9 });
    S.noise(out, t + 0.38, { type: 'bandpass', f: 1300, q: 4, dur: 0.05, gain: 1.6 });
    S.tone(out, t + 0.38, { f: 160, f1: 110, dur: 0.05, gain: 0.3 });
    S.noise(out, t + 0.52, { type: 'bandpass', f: 950, q: 4, dur: 0.06, gain: 1.8 });
    S.tone(out, t + 0.52, { f: 140, f1: 90, dur: 0.06, gain: 0.35 });
    return 0.6;
  } },
  bazooka: { limit: 2, vol: 0.8, range: 1.4, fn(S, out, t) { // launch: thump + a tearing whoosh out of the tube
    S.tone(out, t, { f: 95, f1: 40, dur: 0.25, gain: 1 });
    S.noise(out, t, { type: 'highpass', f: 1500, dur: 0.06, gain: 0.6 });
    S.noise(out, t, { type: 'bandpass', f: 700, f1: 2600, glide: 0.4, q: 1.2, a: 0.02, dur: 0.6, gain: 1.4 });
    S.noise(out, t, { type: 'lowpass', brown: true, f: 600, dur: 0.5, gain: 0.7 });
    return 0.65;
  } },
  throwPin: { limit: 2, vol: 0.6, fn(S, out, t) { // grenade: pin out, then the lob
    S.tone(out, t, { type: 'triangle', f: 3200, dur: 0.08, gain: 0.4 });
    S.noise(out, t, { type: 'bandpass', f: 4000, q: 4, dur: 0.02, gain: 0.8 });
    S.noise(out, t + 0.06, { type: 'bandpass', f: 500, f1: 1500, f2: 600, glide: 0.15, q: 1.5, a: 0.05, dur: 0.3, gain: 1 });
    return 0.4;
  } },
  throw: { limit: 2, vol: 0.6, fn(S, out, t) { // molotov: a slosh and the lob
    S.tone(out, t, { type: 'triangle', f: 1900, dur: 0.05, gain: 0.25 });
    S.noise(out, t, { type: 'bandpass', f: 400, f1: 1300, f2: 500, glide: 0.15, q: 1.5, a: 0.05, dur: 0.32, gain: 1 });
    return 0.35;
  } },
  tink: { limit: 3, vol: 0.4, skip: (S, o) => (o.v ?? 150) < 35 || S.ctx.currentTime - (S.tinkT || -9) < 0.07 || !(S.tinkT = S.ctx.currentTime), fn(S, out, t, o) { // grenade bounce, o.v = its speed
    const k = sndClamp((o.v ?? 150) / 250, 0.2, 1), f = sndRand(2600, 3400);
    S.tone(out, t, { type: 'triangle', f, f1: f * 0.94, dur: 0.1, gain: 0.7 * k });
    S.noise(out, t, { type: 'lowpass', f: 500, dur: 0.04, gain: 0.6 * k });
    return 0.12;
  } },
  shatter: { limit: 2, vol: 0.7, fn(S, out, t) { // molotov: glass, then the flames catch (whoomp)
    S.glass(out, t, 1.3);
    S.noise(out, t + 0.04, { type: 'lowpass', brown: true, f: 200, f1: 1100, glide: 0.35, a: 0.08, dur: 0.8, gain: 1.4 });
    S.noise(out, t + 0.04, { type: 'bandpass', f: 600, f1: 1800, q: 0.8, a: 0.1, dur: 0.6, gain: 0.5 });
    return 0.85;
  } },
  plop: { limit: 2, vol: 0.5, fn(S, out, t) { // lands in water
    S.tone(out, t, { f: 650, f1: 170, dur: 0.12, gain: 0.6 });
    S.noise(out, t, { type: 'lowpass', f: 900, dur: 0.18, gain: 0.5 });
    return 0.2;
  } },

  // --- vehicles
  explosion: { limit: 4, vol: 0.75, range: 1.8, fn(S, out, t, o) {
    const big = (o.big || 1) > 1, k = big ? 1.4 : 1, g = o.chain ? 0.55 : 1;   // chained blasts: quieter, the rumble carries
    S.noise(out, t, { type: 'highpass', f: 1000, dur: 0.08, gain: 0.7 * g });
    S.noise(out, t, { type: 'lowpass', brown: true, f: big ? 1600 : 1300, f1: 110, dur: 1.5 * k, gain: 1.4 * g });
    S.tone(out, t, { f: big ? 75 : 90, f1: 26, dur: 0.7 * k, gain: g });
    S.noise(out, t + 0.05, { type: 'lowpass', brown: true, f: 90, a: 0.1, dur: 2.4 * k, gain: 0.8 });
    for (let i = 0; i < 5; i++) S.noise(out, t + sndRand(0.1, 0.7), { type: 'bandpass', f: sndRand(900, 3000), q: 3, dur: 0.03, gain: 0.25 });
    return 2.5 * k;
  } },
  impact: { limit: 4, vol: 0.8, fn(S, out, t, o) { // o.k 0..1 severity, o.metal, o.glass
    const k = o.k ?? 0.4;
    S.tone(out, t, { f: 120 - 30 * k, f1: 40, dur: 0.12 + 0.15 * k, gain: 0.8 });
    S.noise(out, t, { type: 'lowpass', f: 600 + 2400 * k, f1: 200, dur: 0.1 + 0.3 * k, gain: 0.5 + 0.5 * k });
    S.noise(out, t, { type: 'lowpass', brown: true, f: 400, dur: 0.25, gain: 0.6 * k });
    if (o.metal) {
      for (const f of [380, 920, 1500]) S.noise(out, t, { type: 'bandpass', f: f * sndRand(0.9, 1.1), q: 12, dur: 0.5, gain: 2.5 });
      S.tone(out, t, { type: 'square', f: 110, dur: 0.3, gain: 0.25, lp: 600 });
    }
    if (o.glass) S.glass(out, t + 0.02, 0.8);
    return 0.6;
  } },
  door: { limit: 2, vol: 0.55, fn(S, out, t, o) { // open, then shut (o.enter: slightly quicker)
    const shut = t + (o.enter ? 0.35 : 0.42);
    S.noise(out, t, { type: 'bandpass', f: 2500, q: 3, dur: 0.02, gain: 1 });
    S.noise(out, t + 0.02, { type: 'lowpass', f: 500, dur: 0.06, gain: 0.5 });
    S.tone(out, shut, { f: 85, f1: 55, dur: 0.12, gain: 0.8 });
    S.noise(out, shut, { type: 'lowpass', f: 700, dur: 0.1, gain: 0.6 });
    S.noise(out, shut + 0.01, { type: 'bandpass', f: 2000, q: 3, dur: 0.02, gain: 0.6 });
    return 0.6;
  } },
  hatch: { limit: 2, vol: 0.55, fn(S, out, t) { // tank hatch: a heavy steel clank
    S.noise(out, t, { type: 'bandpass', f: 620, q: 10, dur: 0.45, gain: 3 });
    S.tone(out, t, { f: 70, f1: 45, dur: 0.15, gain: 0.8 });
    S.noise(out, t + 0.4, { type: 'bandpass', f: 540, q: 10, dur: 0.5, gain: 3 });
    S.tone(out, t + 0.4, { f: 65, f1: 40, dur: 0.2, gain: 1 });
    return 0.95;
  } },
  crank: { limit: 1, vol: 0.7, fn(S, out, t) { // starter motor before the engine catches
    for (let i = 0; i < 5; i++) {
      S.noise(out, t + i * 0.085, { type: 'lowpass', f: 900, dur: 0.06, gain: 0.6 });
      S.tone(out, t + i * 0.085, { type: 'sawtooth', f: 60, dur: 0.06, gain: 0.3, lp: 400 });
    }
    return 0.5;
  } },

  // --- world
  lamp: { limit: 2, vol: 0.6, fn(S, out, t) { // lamp post: pole clang + glass
    [[330, 1.2, 0.35], [845, 0.8, 0.2], [1390, 0.6, 0.15], [2230, 0.4, 0.1]].forEach(([f, d, g]) => S.tone(out, t, { f, dur: d, gain: g }));
    S.tone(out, t, { f: 100, f1: 50, dur: 0.12, gain: 0.6 });
    S.glass(out, t + 0.05, 1);
    return 1.2;
  } },
  hydrant: { limit: 2, vol: 0.6, fn(S, out, t) {
    S.tone(out, t, { f: 110, f1: 50, dur: 0.12, gain: 0.8 });
    S.noise(out, t, { type: 'bandpass', f: 700, q: 8, dur: 0.3, gain: 2 });
    S.noise(out, t + 0.03, { type: 'highpass', f: 800, a: 0.02, dur: 0.7, gain: 0.8 });
    return 0.75;
  } },
  bin: { limit: 2, vol: 0.55, fn(S, out, t) { // clatter
    for (let i = 0; i < 6; i++) S.noise(out, t + sndRand(0, 0.45), { type: 'bandpass', f: sndRand(700, 2200), q: 6, dur: 0.06, gain: 2 });
    S.tone(out, t + 0.05, { type: 'triangle', f: sndRand(560, 640), dur: 0.5, gain: 0.15 });
    S.tone(out, t, { f: 120, f1: 60, dur: 0.1, gain: 0.5 });
    return 0.6;
  } },
  sign: { limit: 2, vol: 0.5, fn(S, out, t) { // meters, signs, mailboxes: a sheet-metal whang
    S.noise(out, t, { type: 'bandpass', f: 500, q: 4, dur: 0.3, gain: 1.5 });
    S.tone(out, t, { f: 190, f1: 150, dur: 0.4, gain: 0.3 });
    S.tone(out, t, { f: 90, f1: 50, dur: 0.1, gain: 0.5 });
    return 0.45;
  } },
  cactus: { limit: 2, vol: 0.5, fn(S, out, t) {
    S.noise(out, t, { type: 'lowpass', f: 300, dur: 0.15, gain: 0.9 });
    S.noise(out, t + 0.02, { type: 'highpass', f: 3000, dur: 0.2, gain: 0.25 });
    return 0.25;
  } },
  clack: { limit: 2, vol: 1, range: 1.5, fn(S, out, t) { // train wheels over a rail joint
    for (const d of [0, 0.09]) {
      S.noise(out, t + d, { type: 'lowpass', f: 300, dur: 0.05, gain: 0.8 });
      S.noise(out, t + d, { type: 'bandpass', f: 1200, q: 2, dur: 0.02, gain: 0.5 });
    }
    return 0.15;
  } },
  trainHorn: { limit: 1, vol: 0.5, range: 2.5, fn(S, out, t, o) { // o.n blasts
    const n = o.n || 1;
    for (let i = 0; i < n; i++) {
      const t0 = t + i * 1.25, d = i === n - 1 ? 1.1 : 0.9;
      for (const m of [61, 64, 69]) S.tone(out, t0, { type: 'sawtooth', f: mtof(m) * sndRand(0.995, 1.005), a: 0.05, hold: d - 0.2, dur: d, gain: 0.25, lp: 1600 });
    }
    return n * 1.25;
  } },
  bell: { limit: 3, vol: 0.25, range: 1.2, fn(S, out, t) { // level-crossing bell
    S.tone(out, t, { type: 'triangle', f: 1180, dur: 0.35, gain: 0.7 });
    S.tone(out, t, { f: 2950, dur: 0.2, gain: 0.25 });
    return 0.36;
  } },
  shipHorn: { bus: 'amb', limit: 1, vol: 0.6, range: 3, fn(S, out, t) {
    for (const [f, g] of [[65, 0.5], [97.5, 0.35], [130, 0.2]]) S.tone(out, t, { type: 'sawtooth', f, a: 0.3, hold: 2.4, dur: 4, gain: g, lp: 350 });
    return 4;
  } },
  moo: { bus: 'amb', limit: 2, vol: 0.5, range: 1.2, fn(S, out, t, o) { // a grazing cow (o.bull: deeper)
    return sndMoo(S, out, t, o.bull ? sndRand(0.68, 0.78) : sndRand(0.8, 1.2), 1.5, [0.9, 1.2, 0.85], o.bull ? 0.25 : 0);
  } },
  craneClank: { bus: 'amb', limit: 3, vol: 0.45, range: 1.6, fn(S, out, t) { // a container locks on / sets down
    const k = sndRand(0.9, 1.1);
    for (const [f, g, d] of [[260, 3, 0.9], [690, 2, 0.6], [1340, 1.2, 0.4]]) S.noise(out, t, { type: 'bandpass', f: f * k, q: 18, dur: d, gain: g });
    S.tone(out, t, { f: 62, f1: 38, dur: 0.22, gain: 0.8 });
    S.noise(out, t, { type: 'lowpass', f: 600, dur: 0.08, gain: 0.8 });
    S.noise(out, t + 0.11, { type: 'bandpass', f: 1900 * k, q: 6, dur: 0.05, gain: 0.8 });   // the twist-locks
    return 0.95;
  } },

  // --- people (o.v = the speaker's voice, from Sound.people; random without one)
  scream: { limit: 3, vol: 0.4, fn(S, out, t, o) { // scared: starts fleeing, or badly hurt (o.short: a yelp)
    const v = o.v || sndVoice(), f = v.f0 * sndRand(2.3, 2.9), d = o.short ? sndRand(0.3, 0.42) : sndRand(0.6, 1);
    S.vox(out, t, { f: [[0, f * 0.75], [0.1, f * 1.08], [d * 0.7, f], [d, f * 0.72]], dur: d, a: 0.04, hold: d * 0.4, gain: 0.8 * (v.g || 1),
      vowel: SND_VOWEL.ah, vowel2: o.short ? null : SND_VOWEL.eh, fm: v.fm, vib: [sndRand(5.5, 7.5), f * 0.025], breath: 0.25 });
    return d;
  } },
  ouch: { limit: 3, vol: 0.4, fn(S, out, t, o) { // hurt (o.death: the last breath)
    const v = o.v || sndVoice(), f = v.f0 * 1.6;
    if (o.death) {
      S.vox(out, t, { f: [[0, f * 1.4], [0.08, f * 1.5], [0.5, f * 0.55]], dur: 0.5, a: 0.02, hold: 0.12, gain: 0.8 * (v.g || 1), vowel: SND_VOWEL.ah, vowel2: SND_VOWEL.uh, fm: v.fm, breath: 0.45, rough: [40, 0.35] });
      return 0.5;
    }
    const d = sndRand(0.16, 0.24);
    S.vox(out, t, { f: [[0, f], [0.04, f * 1.25], [d, f * 0.75]], dur: d, a: 0.01, hold: 0.04, gain: 0.8 * (v.g || 1), vowel: SND_VOWEL.uh, fm: v.fm, breath: 0.3 });
    return d;
  } },
  hey: { limit: 2, vol: 0.4, fn(S, out, t, o) { // angry: a shouted "HEY!" (o.low: a violent one's "huh?")
    const v = o.v || sndVoice(), f = v.f0 * (o.low ? 1.1 : 1.5), d = o.low ? 0.26 : 0.22;
    S.noise(out, t, { type: 'bandpass', f: 1800 * v.fm, q: 1, dur: 0.05, gain: 0.3 });
    S.vox(out, t + 0.03, { f: o.low ? [[0, f * 0.9], [d, f * 1.2]] : [[0, f], [0.07, f * 1.3], [d, f * 1.05]], dur: d, a: 0.015, hold: d * 0.4, gain: 0.8 * (v.g || 1),
      vowel: o.low ? SND_VOWEL.uh : SND_VOWEL.eh, vowel2: o.low ? SND_VOWEL.ah : SND_VOWEL.ee, fm: v.fm, rough: o.low ? [36, 0.4] : o.rough ? [38, 0.5] : null });
    return d + 0.05;
  } },
  growl: { limit: 2, vol: 0.5, fn(S, out, t, o) { // violent: "come ON!" as a fight starts
    const v = o.v || sndVoice(), f = v.f0;
    S.noise(out, t, { type: 'bandpass', f: 2200, q: 2, dur: 0.025, gain: 0.5 });
    S.vox(out, t + 0.02, { f: [[0, f * 1.15], [0.12, f * 1.05]], dur: 0.12, a: 0.01, hold: 0.04, gain: 0.7 * (v.g || 1), vowel: SND_VOWEL.uh, fm: v.fm, rough: [38, 0.6] });
    S.vox(out, t + 0.18, { f: [[0, f * 1.3], [0.1, f * 1.45], [0.42, f * 0.95]], dur: 0.42, a: 0.02, hold: 0.15, gain: 0.8 * (v.g || 1), vowel: SND_VOWEL.oh, vowel2: SND_VOWEL.nn, fm: v.fm, rough: [34, 0.7] });
    return 0.62;
  } },
  grunt: { limit: 2, vol: 0.45, fn(S, out, t) { // the player gets hurt
    const v = SND_PLAYER_VOICE, f = v.f0 * sndRand(1.15, 1.35), d = sndRand(0.18, 0.24);
    S.noise(out, t, { type: 'bandpass', f: 1500, q: 1, dur: 0.04, gain: 0.25 });
    S.vox(out, t + 0.01, { f: [[0, f], [0.04, f * 1.08], [d, f * 0.68]], dur: d, a: 0.01, hold: 0.05, gain: 0.85, vowel: SND_VOWEL.uh, fm: v.fm, rough: [45, 0.5], breath: 0.3 });
    return d;
  } },
  // a cop's shouted line (o.text = its bubble, o.v its voice), clipped and a little radio-band.
  // o.radio: 'down' = keyed into the shoulder radio (squelch + chirp first), 'lost' = quieter, a roger beep after
  copBark: { limit: 2, vol: 0.5, fn(S, out, t, o) {
    const v = o.v || sndCopVoice(), R = o.radio, syl = SND_COP_SAYS[o.text] || SND_COP_DEFAULT;
    const hp = S.filt('highpass', R === 'down' ? 480 : 330, 0.7), g = S.gain(R === 'lost' ? 0.6 : 1);
    hp.connect(g); g.connect(out);
    let at = t;
    if (R === 'down') {
      S.noise(out, t, { type: 'bandpass', f: 2200, q: 0.6, a: 0.005, hold: 0.07, dur: 0.12, gain: 0.35 });   // squelch opens
      S.tone(out, t + 0.12, { type: 'square', f: 1750, f1: 2350, glide: 0.04, dur: 0.06, gain: 0.12, lp: 4000 });   // talk-permit chirp
      at = t + 0.2;
    }
    for (const [d, m, vw, end, pl] of syl) {
      if (m) {
        const f = v.f0 * 1.45 * m;
        if (pl) S.noise(hp, at, { type: 'bandpass', f: 2600 * v.fm, q: 1.4, dur: 0.02, gain: 0.45 });
        S.vox(hp, at + (pl ? 0.012 : 0), { f: [[0, f], [d * 0.3, f * 1.04], [d, f * (end || 1)]], dur: d, a: 0.008, hold: d * 0.45, gain: 0.85,
          vowel: SND_VOWEL[vw], fm: v.fm, rough: [42, 0.25], lp: R === 'down' ? 2300 : 2800 });
      }
      at += d + 0.015;
    }
    if (R === 'down') S.noise(out, at + 0.02, { type: 'bandpass', f: 2000, q: 0.6, a: 0.004, dur: 0.1, gain: 0.3 });   // squelch tail
    if (R === 'lost') {   // roger beep, a breath of static
      S.tone(out, at + 0.08, { f: 1400, dur: 0.05, gain: 0.1 });
      S.tone(out, at + 0.14, { f: 1050, dur: 0.06, gain: 0.1 });
      S.noise(out, at + 0.2, { type: 'bandpass', f: 2000, q: 0.6, a: 0.004, dur: 0.07, gain: 0.15 });
      at += 0.28;
    }
    return at - t + 0.15;
  } },
  // a mob member's shouted line (o.text = its bubble, o.v its voice from sndMobVoice, or o.mob for a fresh one)
  mobBark: { limit: 2, vol: 0.5, fn(S, out, t, o) {
    const v = o.v && o.v.mob ? o.v : sndMobVoice(o.mob), st = SND_MOB[v.mob], syl = sndMobSyl(o.text || 'HEY!', v.mob);
    const hp = S.filt('highpass', st.hp, 0.7), g = S.gain(v.g);
    hp.connect(g); g.connect(out);
    let at = t;
    syl.forEach(([d, m, vw, end, pl], i) => {
      if (m) {
        const f = v.f0 * 1.4 * m, lastS = i === syl.length - 1;
        if (pl) S.noise(hp, at, { type: 'bandpass', f: 2400 * v.fm, q: 1.4, dur: 0.018, gain: 0.35 });
        S.vox(hp, at + (pl ? 0.01 : 0), { f: [[0, f], [d * 0.3, f * (1 + 0.04 * st.swing)], [d, f * end]], dur: d, a: st.a, hold: d * st.hold, gain: 0.85,
          vowel: SND_VOWEL[vw], fm: v.fm, rough: st.rough, breath: st.breath, lp: st.lp, vib: lastS && st.vib ? [st.vib[0], f * st.vib[1]] : null });
      }
      at += d + st.gap;
    });
    return at - t + 0.12;
  } },
  // respect changed with a mob (Gangs.onChange; ui bus): two notes up or down in the mob's colour
  // (o.mob; Moretti a plucked triangle, Orlov a low square, Orchid a sine bell). o.up; o.band: crossed
  // into a better band (a third note). respectKos: the band fell to kill-on-sight.
  respect: { bus: 'ui', limit: 2, vol: 0.4, fn(S, out, t, o) {
    const c = { moretti: ['triangle', 69, 2400], orlov: ['square', 57, 1400], orchid: ['sine', 76, 5000] }[o.mob] || ['triangle', 69, 2400];
    const [type, base, lp] = c, ms = o.up ? (o.mob === 'orchid' ? [0, 7] : [0, 5]) : (o.mob === 'orchid' ? [5, 0] : [3, 0]);
    const gain = type === 'square' ? 0.32 : 0.5, bell = type === 'sine';
    ms.forEach((m, i) => {
      const f = mtof(base + m + (o.up ? 0 : -2));
      S.tone(out, t + i * 0.085, { type, f, dur: bell ? 0.32 : 0.14, hold: bell ? 0 : 0.03, gain, lp });
      if (bell) S.tone(out, t + i * 0.085, { f: f * 2.76, dur: 0.12, gain: gain * 0.2 });
    });
    if (o.band) S.tone(out, t + 0.17, { type, f: mtof(base + 12), dur: 0.3, hold: 0.05, gain: gain * 0.9, lp });
    return o.band ? 0.5 : 0.35;
  } },
  respectKos: { bus: 'ui', limit: 1, vol: 0.5, fn(S, out, t) {
    S.tone(out, t, { f: 110, f1: 42, dur: 0.5, gain: 0.8 });   // a low hit
    S.noise(out, t, { type: 'lowpass', brown: true, f: 500, f1: 120, dur: 0.45, gain: 0.6 });
    for (const [m, dt] of [[45, 0.04], [46, 0.04], [39, 0.2]]) S.tone(out, t + dt, { type: 'sawtooth', f: mtof(m), a: 0.01, hold: 0.15, dur: 0.75, gain: 0.16, lp: 700 });   // a sour cluster, then the tritone below
    return 1;
  } },
  // carjack: the thief grabs the handle (a latch clack, a tug-rattle)
  jackGrab: { limit: 2, vol: 0.55, fn(S, out, t) {
    S.noise(out, t, { type: 'bandpass', f: 2400, q: 4, dur: 0.02, gain: 1 });
    S.noise(out, t + 0.07, { type: 'bandpass', f: 1900, q: 4, dur: 0.02, gain: 0.8 });
    S.noise(out, t + 0.12, { type: 'bandpass', f: 420, q: 5, dur: 0.1, gain: 1.2 });   // the panel gives a little
    return 0.25;
  } },
  // the door flung open and a body hauled out: whoosh, a scuffle of cloth and knocks, a thump on the ground
  jackYank: { limit: 2, vol: 0.6, fn(S, out, t) {
    S.noise(out, t, { type: 'bandpass', f: 2500, q: 3, dur: 0.02, gain: 1 });
    S.noise(out, t + 0.01, { type: 'bandpass', f: 400, f1: 1500, glide: 0.12, q: 1.5, a: 0.02, dur: 0.16, gain: 1.2 });
    S.tone(out, t + 0.08, { f: 90, f1: 60, dur: 0.1, gain: 0.5 });   // the door hits its stop
    for (let i = 0; i < 4; i++) S.noise(out, t + 0.1 + i * 0.07 + sndRand(0, 0.03), { type: 'bandpass', f: sndRand(900, 1800), q: 1, a: 0.01, dur: sndRand(0.04, 0.08), gain: sndRand(0.5, 0.9) });
    S.tone(out, t + 0.22, { f: 150, f1: 60, dur: 0.1, gain: 0.5 });   // a shove
    S.tone(out, t + 0.42, { f: 110, f1: 45, dur: 0.16, gain: 0.9 });   // body on the tarmac
    S.noise(out, t + 0.42, { type: 'lowpass', f: 900, f1: 200, dur: 0.14, gain: 0.8 });
    return 0.6;
  } },
  // a mob crew bails out (Game.gangBail, or the passenger in Game.yank): one door kicked open hard against its
  // stop (latch crack, swing, a clang with a short panel ring), then both feet hit the tarmac and the shoes scuff
  crewDoor: { limit: 4, vol: 0.6, fn(S, out, t) {
    S.noise(out, t, { type: 'bandpass', f: 2700, q: 3, dur: 0.018, gain: 1.1 });   // the latch
    S.noise(out, t + 0.01, { type: 'bandpass', f: 500, f1: 1700, glide: 0.08, q: 1.5, a: 0.015, dur: 0.1, gain: 1 });   // the swing
    S.tone(out, t + 0.07, { f: 100, f1: 55, dur: 0.12, gain: 0.9 });   // slams into its stop
    S.noise(out, t + 0.07, { type: 'bandpass', f: 780, q: 9, dur: 0.22, gain: 1.6 });   // the panel rings a little
    const land = t + sndRand(0.2, 0.26);
    S.tone(out, land, { f: 120, f1: 50, dur: 0.08, gain: 0.7 });   // one foot
    S.tone(out, land + 0.05, { f: 110, f1: 48, dur: 0.09, gain: 0.8 });   // the other
    S.noise(out, land, { type: 'lowpass', f: 1100, f1: 250, dur: 0.1, gain: 0.6 });
    S.noise(out, land + 0.1, { type: 'bandpass', f: sndRand(1800, 2600), q: 1.2, a: 0.01, dur: 0.09, gain: 0.5 });   // scuff
    return 0.5;
  } },
  // the reverse jack: the door slammed shut and the tyres chirp as the car tears off
  jackSlam: { limit: 2, vol: 0.6, fn(S, out, t) {
    S.tone(out, t, { f: 90, f1: 50, dur: 0.14, gain: 1 });
    S.noise(out, t, { type: 'lowpass', f: 800, dur: 0.12, gain: 0.8 });
    S.noise(out, t + 0.01, { type: 'bandpass', f: 2200, q: 3, dur: 0.02, gain: 0.7 });
    S.noise(out, t + 0.22, { type: 'bandpass', f: 1500, f1: 1100, q: 5, a: 0.03, hold: 0.15, dur: 0.4, gain: 1.1 });   // tyre chirp
    return 0.65;
  } },
  punch: { limit: 3, vol: 0.7, fn(S, out, t, o) { // a fist lands on a body (o.cow: a big flank)
    const c = o.cow ? 0.7 : 1;
    S.tone(out, t, { f: 150 * c, f1: 55 * c, dur: 0.12, gain: 0.9 });
    S.noise(out, t, { type: 'lowpass', f: 1400 * c, f1: 250, dur: 0.09, gain: 0.9 });
    S.noise(out, t, { type: 'bandpass', f: 2600, q: 1.5, dur: 0.018, gain: 0.5 });
    return 0.15;
  } },
  whiff: { limit: 2, vol: 0.7, fn(S, out, t) { // a punch at thin air
    S.noise(out, t, { type: 'bandpass', f: 500, f1: 2200, f2: 700, glide: 0.07, q: 2, a: 0.02, dur: 0.15, gain: 1.5 });
    return 0.16;
  } },
  punchCar: { limit: 2, vol: 0.6, fn(S, out, t, o) { // a fist on a car panel (o.tank: armour)
    S.tone(out, t, { f: 110, f1: 60, dur: 0.1, gain: 0.6 });
    if (o.tank) S.noise(out, t, { type: 'bandpass', f: 700, q: 12, dur: 0.35, gain: 1.4 });
    else { S.noise(out, t, { type: 'bandpass', f: 380, q: 7, dur: 0.25, gain: 2 }); S.noise(out, t, { type: 'bandpass', f: 1200, q: 5, dur: 0.08, gain: 0.8 }); }
    return 0.35;
  } },
  thwack: { limit: 4, vol: 0.55, fn(S, out, t, o) { // a round into a body (o.cow, o.player)
    const c = o.cow ? 0.7 : 1;
    S.noise(out, t, { type: 'bandpass', f: 1100 * c, q: 1.3, dur: 0.05, gain: 1 });
    S.tone(out, t, { f: 170 * c, f1: 60, dur: 0.07, gain: 0.6 });
    if (o.player) S.noise(out, t, { type: 'lowpass', f: 700, dur: 0.07, gain: 0.6 });
    return 0.08;
  } },
  thud: { limit: 3, vol: 0.7, fn(S, out, t, o) { // a car (or a bull) hits a body, dry; o.k 0..1, o.cow
    const k = o.k ?? 0.5, cow = o.cow;
    S.tone(out, t, { f: cow ? 85 : 120, f1: cow ? 32 : 45, dur: 0.18 + 0.1 * k, gain: 1 });
    S.noise(out, t, { type: 'lowpass', brown: true, f: 700, f1: 150, dur: 0.2 + (cow ? 0.1 : 0), gain: 0.8 + 0.5 * k });
    S.noise(out, t, { type: 'lowpass', f: 300 + 1800 * k, dur: 0.06, gain: 0.5 });
    return 0.3;
  } },
  splat: { limit: 3, vol: 0.75, fn(S, out, t, o) { // a car kills a body: the thud, a crunch, a wet slap
    const k = o.k ?? 0.6;
    SND_SFX.thud.fn(S, out, t, { k, cow: o.cow });
    S.noise(out, t, { type: 'highpass', f: 2500, dur: 0.04, gain: 0.4 * k });
    S.noise(out, t + 0.02, { type: 'lowpass', f: 2500, f1: 400, dur: 0.25, gain: 0.6 });
    for (let i = 0, n = o.cow ? 6 : 4; i < n; i++) S.noise(out, t + sndRand(0.01, 0.14), { type: 'bandpass', f: sndRand(500, 1500) * (o.cow ? 0.8 : 1), q: 3, dur: sndRand(0.03, 0.07), gain: 0.9 });
    return 0.35;
  } },
  bump: { limit: 3, vol: 0.6, fn(S, out, t, o) { // wheels roll over a body (o.k; o.wet)
    const k = o.k ?? 0.5;
    S.tone(out, t, { f: 90, f1: 45, dur: 0.1, gain: 0.6 * k });
    S.noise(out, t, { type: 'lowpass', f: 500, dur: 0.08, gain: 0.7 * k });
    if (o.wet) for (let i = 0; i < 2; i++) S.noise(out, t + sndRand(0.01, 0.06), { type: 'bandpass', f: sndRand(600, 1000), q: 3, dur: 0.04, gain: 0.6 * k });
    return 0.15;
  } },
  bellow: { limit: 2, vol: 0.5, range: 1.2, fn(S, out, t, o) { // a scared / hurt cow (o.die: cut short, falling)
    const p = (o.bull ? 0.75 : 1) * sndRand(1.1, 1.3);
    return o.die ? sndMoo(S, out, t, p, 0.8, [1.3, 1.45, 0.6], 0.5) : sndMoo(S, out, t, p, sndRand(0.8, 1.1), [1.1, 1.55, 1], 0.35);
  } },
  snort: { limit: 2, vol: 0.75, fn(S, out, t) { // a bull about to charge: two snorts
    for (const [d, l] of [[0, 0.2], [0.3, 0.3]]) {
      S.noise(out, t + d, { type: 'bandpass', f: 520, f1: 300, q: 1.5, a: 0.02, dur: l, gain: 1.3 });
      S.tone(out, t + d, { type: 'square', f: 70, f1: 50, dur: l, gain: 0.2, lp: 300 });
    }
    return 0.65;
  } },
  gull: { bus: 'amb', limit: 2, vol: 0.35, fn(S, out, t) {
    const n = 2 + Math.floor(Math.random() * 3), p = sndRand(0.85, 1.15);
    for (let i = 0; i < n; i++) S.tone(out, t + i * 0.3, { type: 'triangle', f: 2200 * p, f1: 1250 * p, dur: 0.25, gain: 0.6 - i * 0.1, vib: [30, 80] });
    return n * 0.3;
  } },
  songbird: { bus: 'amb', limit: 2, vol: 0.25, fn(S, out, t) {
    const n = 3 + Math.floor(Math.random() * 4);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const f = sndRand(2800, 4200), d = sndRand(0.06, 0.12);
      S.tone(out, tt, { f, f1: f * sndRand(0.7, 1.4), dur: d, gain: 0.8 });
      tt += d + sndRand(0.03, 0.06);
    }
    return tt - t;
  } },
  clank: { bus: 'amb', limit: 2, vol: 0.3, fn(S, out, t) { // far-off industrial metal
    const f = sndRand(150, 400);
    for (const [r, g] of [[1, 0.5], [2.76, 0.3], [5.4, 0.15]]) S.tone(out, t, { type: 'triangle', f: f * r, dur: 0.5, gain: g, lp: 1500 });
    return 0.5;
  } },

  // --- gun store (ui)
  shopEnter: { bus: 'ui', limit: 1, vol: 0.4, fn(S, out, t) { // door chime: ding-dong
    S.tone(out, t, { type: 'triangle', f: mtof(88), dur: 0.6, gain: 0.6 });
    S.tone(out, t, { f: mtof(100), dur: 0.3, gain: 0.12 });
    S.tone(out, t + 0.28, { type: 'triangle', f: mtof(84), dur: 0.8, gain: 0.6 });
    S.tone(out, t + 0.28, { f: mtof(96), dur: 0.35, gain: 0.12 });
    return 1.1;
  } },
  shopLeave: { bus: 'ui', limit: 1, vol: 0.4, fn(S, out, t) { // the chime again, softer, and the door shuts
    S.tone(out, t, { type: 'triangle', f: mtof(84), dur: 0.4, gain: 0.35 });
    S.tone(out, t + 0.18, { type: 'triangle', f: mtof(88), dur: 0.5, gain: 0.3 });
    S.tone(out, t + 0.3, { f: 85, f1: 55, dur: 0.12, gain: 0.7 });
    S.noise(out, t + 0.3, { type: 'lowpass', f: 700, dur: 0.1, gain: 0.5 });
    return 0.8;
  } },
  // paint shop: the spray gun cuts off (a puff of air) and the service bell dings
  paintDone: { limit: 1, vol: 0.45, fn(S, out, t) {
    S.noise(out, t, { type: 'highpass', f: 2500, a: 0.005, dur: 0.12, gain: 0.35 });
    S.tone(out, t + 0.12, { f: 2093, dur: 1.2, gain: 0.5 });
    S.tone(out, t + 0.12, { f: 2093 * 2.76, dur: 0.5, gain: 0.12 });
    S.tone(out, t + 0.12, { type: 'triangle', f: 1046, dur: 0.6, gain: 0.15 });
    return 1.35;
  } },
  move: { bus: 'ui', limit: 2, vol: 0.25, fn(S, out, t) {
    S.tone(out, t, { type: 'square', f: 1250, dur: 0.02, gain: 0.4, lp: 3000 });
    return 0.03;
  } },
  buy: { bus: 'ui', limit: 1, vol: 0.45, fn(S, out, t) { // register cha-ching + the gun racked
    SND_SFX.cash.fn(S, out, t, SND_NOOPTS);
    SND_SFX.cock.fn(S, out, t + 0.35, SND_NOOPTS);
    return 0.6;
  } },
  buzz: { bus: 'ui', limit: 1, vol: 0.3, fn(S, out, t) { // can't afford / full
    for (const f of [110, 117]) S.tone(out, t, { type: 'square', f, a: 0.01, hold: 0.18, dur: 0.28, gain: 0.35, lp: 900 });
    return 0.3;
  } },

  // --- player and UI (non-positional, ui bus)
  step: { bus: 'ui', limit: 2, vol: 0.45, fn(S, out, t, o) {
    S.noise(out, t, { type: 'lowpass', f: (o.soft ? 380 : 700) * sndRand(0.85, 1.15), dur: 0.05, gain: o.soft ? 0.6 : 0.9 });
    return 0.06;
  } },
  cash: { bus: 'ui', limit: 2, vol: 0.4, fn(S, out, t) { // cha-ching
    S.tone(out, t, { type: 'square', f: mtof(83), dur: 0.06, gain: 0.3, lp: 4000 });
    S.tone(out, t + 0.07, { type: 'square', f: mtof(88), dur: 0.3, gain: 0.3, lp: 4000 });
    S.noise(out, t + 0.07, { type: 'highpass', f: 5000, dur: 0.2, gain: 0.3 });
    return 0.4;
  } },
  health: { bus: 'ui', limit: 2, vol: 0.4, fn(S, out, t) {
    [72, 76, 79, 84].forEach((m, i) => S.tone(out, t + i * 0.06, { f: mtof(m), dur: 0.12, gain: 0.5 }));
    return 0.35;
  } },
  money: { bus: 'ui', limit: 2, vol: 0.25, skip: (S) => S.ctx.currentTime - S.pickT < 0.25, fn(S, out, t) {
    S.tone(out, t, { f: 1320, f1: 1760, dur: 0.06, gain: 0.5 });
    S.tone(out, t + 0.05, { f: 2093, dur: 0.08, gain: 0.4 });
    return 0.15;
  } },
  checkpoint: { bus: 'ui', limit: 2, vol: 0.6, fn(S, out, t) {
    S.tone(out, t, { type: 'square', f: mtof(76), dur: 0.07, gain: 0.3, lp: 3000 });
    S.tone(out, t + 0.07, { type: 'square', f: mtof(83), dur: 0.14, gain: 0.3, lp: 3000 });
    return 0.25;
  } },
  mission: { bus: 'ui', limit: 1, vol: 0.4, fn(S, out, t) { // job accepted
    S.tone(out, t, { type: 'triangle', f: mtof(67), dur: 0.1, gain: 0.6 });
    S.tone(out, t + 0.1, { type: 'triangle', f: mtof(72), dur: 0.25, gain: 0.6 });
    S.noise(out, t, { type: 'bandpass', f: 3000, q: 2, dur: 0.02, gain: 0.4 });
    return 0.4;
  } },
  complete: { bus: 'ui', limit: 1, vol: 0.4, fn(S, out, t) { // fanfare, then the multiplier-up blip
    [72, 76, 79, 84].forEach((m, i) => S.tone(out, t + i * 0.09, { type: 'square', f: mtof(m), dur: 0.12, gain: 0.25, lp: 3500 }));
    for (const m of [72, 76, 79]) S.tone(out, t + 0.36, { type: 'square', f: mtof(m), a: 0.01, hold: 0.3, dur: 0.6, gain: 0.15, lp: 3000 });
    S.tone(out, t + 0.36, { type: 'triangle', f: mtof(48), a: 0.01, hold: 0.3, dur: 0.6, gain: 0.5 });
    S.tone(out, t + 1.05, { f: mtof(84), f1: mtof(96), dur: 0.18, gain: 0.4 });
    S.tone(out, t + 1.2, { f: mtof(91), dur: 0.2, gain: 0.35 });
    return 1.45;
  } },
  fail: { bus: 'ui', limit: 1, vol: 0.8, fn(S, out, t) {
    [64, 63, 62, 59].forEach((m, i) => S.tone(out, t + i * 0.22, { type: 'sawtooth', f: mtof(m), dur: i === 3 ? 0.7 : 0.24, gain: 0.3, lp: 1400 }));
    return 1.4;
  } },
  wasted: { bus: 'ui', limit: 1, vol: 0.5, fn(S, out, t) {
    S.tone(out, t, { f: 70, f1: 30, dur: 0.6, gain: 0.9 });
    S.noise(out, t, { type: 'lowpass', brown: true, f: 800, f1: 100, dur: 0.8, gain: 0.8 });
    for (const d of [1, 1.012]) S.tone(out, t + 0.1, { type: 'sawtooth', f: 196 * d, f1: 62 * d, a: 0.02, dur: 1.7, gain: 0.25, lp: 900, vib: [5, 6] });
    return 1.9;
  } },
  start: { bus: 'ui', limit: 1, vol: 0.8, fn(S, out, t) { // title screen: game on
    [60, 64, 67, 72].forEach((m, i) => S.tone(out, t + i * 0.07, { type: 'square', f: mtof(m), dur: 0.14, gain: 0.25, lp: 3000 }));
    S.noise(out, t, { type: 'bandpass', f: 400, f1: 3000, q: 1.5, dur: 0.5, gain: 0.3 });
    return 0.6;
  } },
  swoosh: { bus: 'ui', limit: 1, vol: 0.5, fn(S, out, t) { // O: skip 6 hours (fast-forward)
    S.noise(out, t, { type: 'bandpass', f: 300, f1: 2500, f2: 400, glide: 0.55, q: 1.5, a: 0.3, dur: 1.1, gain: 1 });
    return 1.1;
  } },
  phoneOpen: { bus: 'ui', limit: 1, vol: 0.3, fn(S, out, t) {
    S.tone(out, t, { type: 'triangle', f: mtof(81), dur: 0.05, gain: 0.6 });
    S.tone(out, t + 0.05, { type: 'triangle', f: mtof(88), dur: 0.08, gain: 0.6 });
    return 0.14;
  } },
  phoneClose: { bus: 'ui', limit: 1, vol: 0.3, fn(S, out, t) {
    S.tone(out, t, { type: 'triangle', f: mtof(88), dur: 0.05, gain: 0.6 });
    S.tone(out, t + 0.05, { type: 'triangle', f: mtof(81), dur: 0.08, gain: 0.6 });
    return 0.14;
  } },
  click: { bus: 'ui', limit: 2, vol: 0.25, fn(S, out, t) {
    S.tone(out, t, { type: 'square', f: 1800, dur: 0.015, gain: 0.5 });
    return 0.03;
  } },
  answer: { bus: 'ui', limit: 1, vol: 0.3, fn(S, out, t) {
    S.tone(out, t, { f: mtof(76), dur: 0.08, gain: 0.6 });
    S.tone(out, t + 0.09, { f: mtof(83), dur: 0.12, gain: 0.6 });
    return 0.22;
  } },
  hangup: { bus: 'ui', limit: 1, vol: 0.3, fn(S, out, t) {
    for (const d of [0, 0.2]) {
      S.tone(out, t + d, { type: 'square', f: 480, dur: 0.12, gain: 0.3, lp: 1200 });
      S.tone(out, t + d, { type: 'square', f: 320, dur: 0.12, gain: 0.3, lp: 1200 });
    }
    return 0.35;
  } },
  message: { bus: 'ui', limit: 1, vol: 0.3, fn(S, out, t) {
    for (const [d, g] of [[0, 0.6], [0.18, 0.2]]) {
      S.tone(out, t + d, { f: mtof(88), dur: 0.07, gain: g });
      S.tone(out, t + d + 0.07, { f: mtof(95), dur: 0.12, gain: g });
    }
    return 0.4;
  } },
};

// ================================================================ Sound ==
const Sound = {
  ctx: null, bus: null, dead: false, force: false,
  vol: 0.7, muted: false,
  tick: 0, errors: 0, onError: null,
  board: { pan: 0, gain: 1 },          // soundboard preview placement (no game running)
  boom: 0, pickT: -9, igniteT: 0, pendingUntil: 0,

  // A context made during a gesture can report 'suspended' for a moment before it runs; sounds
  // scheduled in that window (the title's start sound) still play, so allow them for 1.5 s.
  get on() {
    if (!this.ctx || !this.bus) return false;
    const st = this.ctx.state;
    return this.force || st === 'running' || (st === 'suspended' && this.now() < this.pendingUntil);
  },
  now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); },

  // ------------------------------------------------------------ settings --
  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SND_STORE) || 'null');
      if (s) { if (isFinite(s.vol)) this.vol = sndClamp(Math.round(s.vol * 10) / 10, 0, 1); this.muted = !!s.muted; }
    } catch (e) { /* no storage (file:// in some browsers, headless) */ }
  },
  save() { try { localStorage.setItem(SND_STORE, JSON.stringify({ vol: this.vol, muted: this.muted })); } catch (e) { /* ignore */ } },
  applyVolume() {
    if (!this.bus) return;
    try { this.bus.master.gain.setTargetAtTime(this.muted ? 0 : this.vol * this.vol, this.ctx.currentTime, 0.03); } catch (e) { this.fail(e); }
  },
  // volume keys: dir = ±1 → new volume in percent (a volume key also unmutes)
  step(dir) {
    this.vol = sndClamp(Math.round((this.vol + 0.1 * dir) * 10) / 10, 0, 1);
    this.muted = false;
    this.save(); this.applyVolume();
    this.ui('click');
    return Math.round(this.vol * 100);
  },
  // mute key → true when now muted
  toggleMute() {
    this.muted = !this.muted;
    this.save(); this.applyVolume();
    return this.muted;
  },

  // --------------------------------------------------------------- setup --
  // Starts (or resumes) audio. Called from key/mouse listeners below, so the first gesture works.
  unlock() {
    if (this.dead) return;
    try {
      if (!this.ctx) {
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!AC) { this.dead = true; return; }
        this.ctx = new AC();
        this.build();
      }
      if (this.ctx.state === 'suspended' && !(typeof document !== 'undefined' && document.hidden)) {
        this.pendingUntil = this.now() + 1500;
        const p = this.ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) { this.dead = true; this.ctx = null; this.bus = null; this.fail(e); }
  },
  build() {
    const c = this.ctx;
    this.pannable = typeof c.createStereoPanner === 'function';
    this.white = this.noiseBuffer(false);
    this.brown = this.noiseBuffer(true);
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -8; lim.knee.value = 6; lim.ratio.value = 10; lim.attack.value = 0.003; lim.release.value = 0.25;
    lim.connect(c.destination);
    const master = this.gain(0);
    master.connect(lim);
    this.bus = { master };
    for (const k in SND_BUS) { const g = this.gain(SND_BUS[k]); g.connect(master); this.bus[k] = g; }
    this.duckK = { sfx: 1, amb: 1, music: 1 };
    this.loops = {};
    for (const k in SND_LOOPS) this.loops[k] = new Map();
    this.voices = {};
    this.hitT = new WeakMap();
    this.scrapes = new Map();
    this.ph = { open: false, incoming: null, msg: null, seen: false };
    this.amb = { n: 0, beds: {}, mooT: 0, shipT: 0, boat: null, xings: null, xCity: null };
    this.radioT = {};
    this.pv = new WeakMap();          // per ped/cow: what we heard last tick (Sound.people)
    this.craneSeen = new WeakMap();   // per crane: the last clank time we played
    this.respT = {}; this.respAt = 0; this.mobAt = 0;
    this.voxN = 0; this.voxT = -9; this.php = undefined; this.hurtAcc = 0; this.gruntT = -9;
    this._burn = []; this._cows = [];
    this.train = { odo: 0, wait: 0, v: 0 };
    this._near = []; this._list = [];
    this.subGangs();
    this.applyVolume();
    master.gain.value = this.muted ? 0 : this.vol * this.vol;
  },
  noiseBuffer(brown) {
    const c = this.ctx, n = Math.floor(c.sampleRate * (brown ? 4 : 2));
    const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w * 0.7;
    }
    if (brown) { const slope = (d[n - 1] - d[0]) / n; for (let i = 0; i < n; i++) d[i] -= slope * i; }   // seamless loop
    return b;
  },
  visibility() {
    if (!this.ctx) return;
    try {
      const p = document.hidden ? this.ctx.suspend() : this.ctx.resume();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* ignore */ }
  },
  fail(e) {
    this.errors++;
    if (this.errors <= 5 && typeof console !== 'undefined') console.warn('[sound]', e);
    if (this.onError) this.onError(e);
  },

  // ---------------------------------------------------------- primitives --
  gain(v) { const g = this.ctx.createGain(); g.gain.value = v; return g; },
  osc(type, f) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; },
  filt(type, f, q) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q !== undefined) b.Q.value = q; return b; },
  src(brown) { const s = this.ctx.createBufferSource(); s.buffer = brown ? this.brown : this.white; s.loop = true; return s; },
  // envelope: silent → peak in `a` s, hold, exponential decay to silence at t + dur
  env(p, t, a, peak, hold, dur) {
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(peak, t + a);
    if (hold) p.setValueAtTime(peak, t + a + hold);
    p.exponentialRampToValueAtTime(0.0001, Math.max(t + a + (hold || 0) + 0.01, t + dur));
  },
  // oscillator one-shot: { type, f, f1 (glide to), glide, dur, gain, a, hold, lp, q, vib: [rate, depth] }
  tone(out, t, o) {
    const x = this.osc(o.type || 'sine', o.f), dur = o.dur;
    x.frequency.setValueAtTime(o.f, t);
    if (o.f1) x.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide || dur));
    const g = this.gain(0);
    this.env(g.gain, t, o.a || 0.004, o.gain ?? 0.5, o.hold || 0, dur);
    let n = x;
    if (o.lp) { const f = this.filt('lowpass', o.lp, o.q || 0.7); x.connect(f); n = f; }
    n.connect(g); g.connect(out);
    x.start(t); x.stop(t + dur + 0.05);
    if (o.vib) {
      const l = this.osc('sine', o.vib[0]), lg = this.gain(o.vib[1]);
      l.connect(lg); lg.connect(x.frequency); l.start(t); l.stop(t + dur + 0.05);
    }
    return x;
  },
  // filtered-noise one-shot: { type (filter), f, f1, f2, glide, q, dur, gain, a, hold, brown }
  noise(out, t, o) {
    const s = this.src(o.brown), f = this.filt(o.type || 'bandpass', o.f || 1000, o.q ?? 1);
    if (o.f1) {
      f.frequency.setValueAtTime(o.f, t);
      f.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide || o.dur));
      if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    }
    const g = this.gain(0);
    this.env(g.gain, t, o.a || 0.002, o.gain ?? 0.5, o.hold || 0, o.dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random() * s.buffer.duration); s.stop(t + o.dur + 0.05);
  },
  // shattering glass: a scatter of tiny bright tinkles
  glass(out, t, k) {
    this.noise(out, t, { type: 'highpass', f: 5000, dur: 0.3, gain: 0.35 * k });
    for (let i = 0; i < 8; i++) this.tone(out, t + sndRand(0, 0.25), { type: 'triangle', f: sndRand(3000, 6500), dur: sndRand(0.05, 0.15), gain: 0.15 * k });
  },
  // a voiced sound: a sawtooth "glottis" through three band-pass formants (a vowel, SND_VOWEL).
  // o = { f: [[t, Hz], ...] pitch contour (t from the start), dur, a, hold, gain, vowel, vowel2 (glided
  // to over the middle), fm (formant scale), vib: [Hz, depth Hz], rough: [Hz, 0..1] (rasp), breath, lp }
  vox(out, t, o) {
    const c = o.f, x = this.osc('sawtooth', c[0][1]), end = t + o.dur, fm = o.fm || 1, peak = o.gain ?? 0.5;
    x.frequency.setValueAtTime(c[0][1], t);
    for (let i = 1; i < c.length; i++) x.frequency.exponentialRampToValueAtTime(c[i][1], t + Math.max(0.005, c[i][0]));
    const g = this.gain(0), lp = this.filt('lowpass', o.lp || 3000, 0.7);
    this.env(g.gain, t, o.a || 0.02, peak, o.hold || 0, o.dur);
    const V = o.vowel, V2 = o.vowel2;
    for (let i = 0; i < V.length; i++) {
      const b = this.filt('bandpass', V[i][0] * fm, V[i][1]), bg = this.gain(V[i][2] * 2.2);
      if (V2) { b.frequency.setValueAtTime(V[i][0] * fm, t + o.dur * 0.25); b.frequency.exponentialRampToValueAtTime(V2[i][0] * fm, t + o.dur * 0.8); }
      x.connect(b); b.connect(bg); bg.connect(lp);
    }
    let tail = lp;
    if (o.rough) {
      const am = this.gain(1 - o.rough[1] * 0.5), l = this.osc('square', o.rough[0]), lg = this.gain(o.rough[1] * 0.5);
      l.connect(lg); lg.connect(am.gain); lp.connect(am); tail = am;
      l.start(t); l.stop(end + 0.05);
    }
    tail.connect(g); g.connect(out);
    x.start(t); x.stop(end + 0.05);
    if (o.vib) { const l = this.osc('sine', o.vib[0]), lg = this.gain(o.vib[1]); l.connect(lg); lg.connect(x.frequency); l.start(t); l.stop(end + 0.05); }
    if (o.breath) this.noise(out, t, { type: 'bandpass', f: 1600 * fm, q: 1.2, a: o.a || 0.02, hold: o.hold, dur: o.dur, gain: o.breath * peak });
  },
  duck(k) { this.boom = Math.min(1, this.boom + k); },

  // -------------------------------------------------------------- placing --
  // Sets this._g (distance gain) / this._p (pan) for a world position; false = too far (culled).
  // x undefined → non-positional. Without a running game (soundboard) → the board settings.
  place(x, y, mul) {
    if (x === undefined || x === null) { this._g = 1; this._p = 0; return true; }
    if (typeof G === 'undefined' || !G.cam || !this.inGame) { this._g = this.board.gain; this._p = this.board.pan; return true; }
    const cam = G.cam, dx = x - cam.cx, dy = y - cam.cy, R = Math.max(360, cam.w) * (mul || 1);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= R) return false;
    const k = 1 - d / R;
    this._g = k * (0.3 + 0.7 * k);
    this._p = sndClamp(dx / (cam.w * 0.55), -1, 1) * 0.8;
    return true;
  },

  // ------------------------------------------------------------ one-shots --
  // Sound.play(name, x, y, opts): a one-shot at a world position (no x/y = UI, non-positional)
  play(name, x, y, o) {
    if (!this.on) return;
    try { this.fire(name, x, y, o || SND_NOOPTS); } catch (e) { this.fail(e); }
  },
  ui(name, o) { this.play(name, undefined, undefined, o); },
  fire(name, x, y, o) {
    const def = SND_SFX[name];
    if (!def || (def.skip && def.skip(this, o))) return;
    if (!this.place(x, y, def.range || 1)) return;
    const bus = def.bus || (x === undefined ? 'ui' : 'sfx');
    const now = this.ctx.currentTime;
    // voice limit: cut the oldest
    let list = this.voices[name];
    if (!list) list = this.voices[name] = [];
    while (list.length && list[0].end < now) list.shift();
    if (list.length >= (def.limit || 3)) { const old = list.shift(); old.g.gain.cancelScheduledValues(now); old.g.gain.setTargetAtTime(0, now, 0.015); }
    const g = this.gain(this._g * (def.vol ?? 1));
    let tail = g;
    if (this.pannable && this._p) { const p = this.ctx.createStereoPanner(); p.pan.value = this._p; g.connect(p); tail = p; }
    tail.connect(this.bus[bus]);
    const t = now + 0.005 + (o.delay || 0);
    const dur = def.fn(this, g, t, o) || 1;
    list.push({ g, end: t + dur });
  },

  // ---------------------------------------------------------------- loops --
  // Keep loop `type` alive for `key` this tick at (x, y). Returns the voice, or null when culled.
  want(type, key, x, y, arg, gmul = 1) {
    const L = SND_LOOPS[type];
    if (!this.place(x, y, L.range || 1)) return null;
    const map = this.loops[type];
    let v = map.get(key);
    if (!v) { v = this.makeLoop(type, arg); map.set(key, v); }
    v.stamp = this.tick;
    this.level(v, this._g * gmul, this._p);
    return v;
  },
  makeLoop(type, arg) {
    const L = SND_LOOPS[type];
    const out = this.gain(0);
    let tail = out, pan = null;
    if (this.pannable) { pan = this.ctx.createStereoPanner(); out.connect(pan); tail = pan; }
    tail.connect(this.bus[L.bus || 'sfx']);
    const v = { out, pan, vol: L.vol ?? 1, g: -1, p: 0, srcs: [], stamp: 0, attack: L.attack || 0.05, release: L.release || 0.08, tau: L.tau || 0.06, set: sndNop };
    L.make(this, v, arg);
    return v;
  },
  start(v, node) {
    const now = this.ctx.currentTime;
    if (node.buffer) node.start(now, Math.random() * node.buffer.duration); else node.start(now);
    v.srcs.push(node);
    return node;
  },
  level(v, g, p) {
    const now = this.ctx.currentTime;
    if (Math.abs(g - v.g) > 0.003) { v.out.gain.setTargetAtTime(g * v.vol, now, v.g < 0 ? v.attack : v.tau); v.g = g; }
    if (v.pan && Math.abs(p - v.p) > 0.01) { v.pan.pan.setTargetAtTime(p, now, 0.06); v.p = p; }
  },
  stopLoop(v) {
    if (v.dead) return;
    v.dead = true;
    const now = this.ctx.currentTime, gp = v.out.gain, r = v.release;
    gp.cancelScheduledValues(now);
    gp.setValueAtTime(gp.value, now);
    gp.setTargetAtTime(0, now, r);
    for (const s of v.srcs) { try { s.stop(now + r * 6 + 0.05); } catch (e) { /* already stopped */ } }
  },
  // stop every loop that wasn't wanted this tick
  sweep() {
    for (const type in this.loops) {
      const map = this.loops[type];
      if (!map.size) continue;
      for (const [k, v] of map) if (v.stamp !== this.tick) { this.stopLoop(v); map.delete(k); }
    }
  },

  // ---------------------------------------------------------- game hooks --
  shot(weapon, x, y, ammoLeft) {
    if (!this.on) return;
    try {
      const thrown = weapon === 'grenade' || weapon === 'molotov';
      this.fire(SND_SHOT[weapon] || 'pistol', x, y, SND_NOOPTS);
      if (ammoLeft <= 0 && !thrown) this.fire('empty', x, y, { delay: weapon === 'shotgun' ? 0.7 : 0.15 });
    } catch (e) { this.fail(e); }
  },
  // chained blasts (a tanker's three explosions arrive in one tick) are spread into a rolling rumble
  explode(x, y, big) {
    if (!this.on) return;
    try {
      const now = this.ctx.currentTime;
      this.chain = now - (this.boomAt || -9) < 0.05 ? (this.chain || 0) + 1 : 0;
      this.boomAt = now;
      this.fire('explosion', x, y, { big, chain: this.chain, delay: this.chain ? this.chain * 0.18 + sndRand(0, 0.08) : 0 });
      if (this.place(x, y, 1.8)) this.duck(big > 1 ? 1 : 0.6);
    } catch (e) { this.fail(e); }
  },
  // every collision the physics reports (both cars of a crash call it; one sound per pair)
  impact(c, speed, x, y, other) {
    if (!this.on) return;
    try {
      const now = this.ctx.currentTime;
      if (!other && speed > 6 && speed < 80 && c.speed() > 60 && !c.m.air) this.scrapes.set(c, now);   // grinding along a wall
      if (speed < 45) return;
      if (now - (this.hitT.get(c) || -9) < 0.15) return;
      this.hitT.set(c, now);
      if (other) this.hitT.set(other, now);
      const k = sndClamp((speed - 45) / 300, 0, 1);
      const metal = !!(c.m.heavy || c.m.tank || (other && (other.m.heavy || other.m.tank)));
      this.fire('impact', x, y, { k, metal, glass: speed > 200 });
    } catch (e) { this.fail(e); }
  },
  breakProp(kind, x, y) {
    this.play(kind === 'lamp' ? 'lamp' : kind === 'hydrant' ? 'hydrant' : kind === 'bin' ? 'bin' : kind === 'cactus' ? 'cactus' : 'sign', x, y);
  },
  door(car, entering) {
    if (!this.on) return;
    try {
      const m = car.m;
      this.fire(m.tank ? 'hatch' : 'door', car.x, car.y, { enter: entering });
      if (this.jacked && this.jacked.has(car)) { this.jacked.delete(car); return; }   // a jacked car's engine is already running
      if (entering && !m.air && this.classOf(car) !== 'electric') {
        this.fire('crank', car.x, car.y, { delay: 0.3 });
        this.igniteT = this.ctx.currentTime + 0.75;
      }
    } catch (e) { this.fail(e); }
  },
  // carjack (Game.jack / yank / updateJack): stage 'grab' (the handle), 'steal' (who = the driver ped the
  // player hauls out, may be null), 'back' (who = the ped pulling the player out), 'off' (the ped slams the
  // door and tears off; its engine is the usual state-driven loop)
  jack(car, stage, who) {
    if (!this.on || !car) return;
    try {
      const x = car.x, y = car.y;
      if (stage === 'grab') this.fire('jackGrab', x, y, SND_NOOPTS);
      else if (stage === 'off') this.fire('jackSlam', x, y, SND_NOOPTS);
      else {
        this.fire('jackYank', x, y, SND_NOOPTS);
        const v = who ? this.voiceOf(who) : sndVoice(), mood = who && who.mood;
        if (stage === 'steal') {
          (this.jacked || (this.jacked = new WeakSet())).add(car);
          if (who && who.gang) this.fire('mobBark', x, y, { v: v.mob ? v : sndMobVoice(who.gang), text: 'HEY!', delay: 0.06 });
          else if (mood === 'scared') this.fire('scream', x, y, { v, short: true, delay: 0.08 });
          else this.fire('hey', x, y, { v, rough: mood === 'violent', delay: 0.06 });
        } else {
          this.fire('hey', x, y, { v, rough: true, delay: 0.04 });
          this.fire('grunt', G.player.x, G.player.y, { delay: 0.4 });   // the player hits the ground
          this.gruntT = this.ctx.currentTime + 0.4;   // playerHurt: not twice for the same fall
        }
      }
    } catch (e) { this.fail(e); }
  },
  // a mob crew jumps out (Game.gangBail; Game.yank's passenger): a hard door + landing per member, at the member,
  // the second door 60-110 ms after the first. Their first bark comes from people() (the new bubble).
  bail(car, crew) {
    if (!this.on || !car || !crew) return;
    try {
      let d = 0;
      for (const p of crew) {
        if (!p) continue;
        this.fire('crewDoor', p.x, p.y, d ? { delay: d } : SND_NOOPTS);
        d += sndRand(0.06, 0.11);
      }
    } catch (e) { this.fail(e); }
  },
  // Gangs.onChange (subscribed in build, or the first update): a two-note sting per change, one per 0.4 s per mob;
  // stings from one event (the war rule moves two mobs) are staggered 0.3 s. A fall to kill on sight
  // always plays, as the darker respectKos hit.
  subGangs() {
    if (!this.gangSub && typeof Gangs !== 'undefined' && Gangs.onChange) { this.gangSub = true; Gangs.onChange.push((id, a, b) => this.respect(id, a, b)); }
  },
  respect(id, old, now) {
    if (!this.on || !this.inGame) return;
    try {
      const N = Gangs.NUM, band = (r) => (r <= N.kos ? 0 : r <= N.hostile ? 1 : r >= N.trusted ? 4 : r >= N.friendly ? 3 : 2);
      const b0 = band(old), b1 = band(now), t = this.ctx.currentTime, kos = b1 === 0 && b0 > 0;
      if (!kos && t < (this.respT[id] || 0)) return;
      const delay = Math.max(0, this.respAt - t);
      if (delay > 0.6) return;
      this.respT[id] = t + 0.4; this.respAt = t + delay + 0.3;
      if (kos) this.fire('respectKos', undefined, undefined, { delay });
      else this.fire('respect', undefined, undefined, { mob: id, up: now > old, band: b1 > b0, delay });
    } catch (e) { this.fail(e); }
  },
  // the voice a ped speaks with (kept in Sound.pv, so Sound.people uses the same one)
  voiceOf(p) {
    let e = this.pv.get(p);
    if (!e) { e = { v: this.newVoice(p), t: -1, st: null, b: null, hp: 0, dead: false }; this.pv.set(p, e); }
    return e.v;
  },
  newVoice(p) { return p.kind === 'cow' ? null : p.mood === 'cop' ? sndCopVoice() : p.gang ? sndMobVoice(p.gang) : sndVoice(); },
  pickup(kind) {
    if (!this.on) return;
    this.pickT = this.ctx.currentTime;
    this.ui(kind === 'cash' ? 'cash' : kind === 'health' ? 'health' : 'cock');
  },
  // Game.punch landed: kind 'body' (a ped or cow), 'player' or 'car'; t = what it hit
  punch(kind, x, y, t) {
    if (!this.on) return;
    try {
      if (kind === 'car') this.fire('punchCar', x, y, t && t.m && t.m.tank ? { tank: true } : SND_NOOPTS);
      else this.fire('punch', x, y, t && t.kind === 'cow' ? { cow: true } : SND_NOOPTS);
    } catch (e) { this.fail(e); }
  },
  // a car (or the train) meets a body, from Physics.carVsBodies / Train.bodies. v = impact speed (px/s);
  // how: 'kill', 'down' (knocked over), 'roll' (wheels over someone lying), 'corpse', 'bump' (a cow shoved)
  body(p, v, how) {
    if (!this.on) return;
    try {
      const cow = p.kind === 'cow', k = sndClamp(v / 250, 0.2, 1);
      if (how === 'kill') { this.fire('splat', p.x, p.y, { k, cow }); if (cow) this.fire('bellow', p.x, p.y, { die: true, bull: p.bull }); }
      else if (how === 'down') this.fire('thud', p.x, p.y, { k: k * 0.8 });
      else if (how === 'roll') this.fire('bump', p.x, p.y, { k: 0.8, wet: true });
      else if (how === 'corpse') this.fire('bump', p.x, p.y, { k: cow ? 0.6 : 0.35, wet: !p.burnt });
      else this.fire('thud', p.x, p.y, { k: sndClamp(v / 150, 0.1, 0.8), cow });
    } catch (e) { this.fail(e); }
  },

  // ------------------------------------------------------------- per tick --
  update(dt) {
    if (!this.on) return;
    try { this.tick++; this.frame(dt); } catch (e) { this.fail(e); }
  },
  frame(dt) {
    this.inGame = true;
    this.subGangs();
    const shop = (typeof Shop !== 'undefined' && Shop.open) || (typeof Paint !== 'undefined' && Paint.open);
    const play = G.state === 'play' && !G.paused && !shop;
    const call = play && typeof Phone !== 'undefined' && (Phone.incoming || Phone.calling) ? 1 : 0;
    this.boom = Math.max(0, this.boom - dt * 1.1);
    this.duckTo('sfx', play ? (call ? 0.6 : 1) * (1 - 0.3 * this.boom) : 0);
    this.duckTo('amb', play ? (call ? 0.45 : 1) * (1 - 0.65 * this.boom) : shop && !G.paused ? 0.3 : 0);
    this.duckTo('music', G.paused ? 0 : (call ? 0.4 : 1) * (1 - 0.6 * this.boom));
    if (play) { this.vehicles(dt); this.world(dt); this.phone(); this.player(); this.playerHurt(dt); this.paint(); }
    else if (shop) this.shop();
    if (!shop) this.shopSel = -1;
    this.sweep();
  },
  duckTo(bus, k) {
    const prev = this.duckK[bus];
    if (Math.abs(k - prev) < 0.01 && !(k === 0 && prev !== 0)) return;
    this.duckK[bus] = k;
    this.bus[bus].gain.setTargetAtTime(SND_BUS[bus] * k, this.ctx.currentTime, k < prev ? 0.04 : 0.25);
  },
  classOf(c) { return SND_ENGINE_OF[c.model] || (c.m.air ? 'rotor' : c.m.tank ? 'tank' : c.m.heavy ? 'diesel' : 'car'); },
  // fake gearbox: speed fraction → rpm 0..1 (free revs on the handbrake)
  engineRpm(cls, frac, thr, freeRev) {
    const E = SND_ENGINES[cls] || SND_ENGINES.car, gears = E.gears || 1;
    frac = sndClamp(frac, 0, 1);
    let r = frac;
    if (gears > 1) {
      const x = frac * gears, g = Math.min(gears - 1, Math.floor(x)), w = x - g;
      r = g === 0 ? w * 0.85 : 0.4 + w * 0.55 + g * 0.01;
    }
    if (freeRev) r = Math.max(r, 0.25 + 0.7 * Math.abs(thr));
    return sndClamp(r, 0, 1);
  },
  // nearest-first, player's car first
  byDist(list) {
    const cam = G.cam, pc = G.player.car;
    list.sort((a, b) => (a === pc ? -1 : b === pc ? 1 : ((a.x - cam.cx) ** 2 + (a.y - cam.cy) ** 2) - ((b.x - cam.cx) ** 2 + (b.y - cam.cy) ** 2)));
    return list;
  },

  vehicles(dt) {
    const cam = G.cam, pc = G.player.car, now = this.ctx.currentTime;
    const R = Math.max(360, cam.w) * 1.5, R2 = R * R;
    const near = this._near, list = this._list;
    near.length = 0;
    for (const c of G.cars) {
      if (c.wreck) continue;
      const dx = c.x - cam.cx, dy = c.y - cam.cy;
      if (c === pc || dx * dx + dy * dy < R2) near.push(c);
    }
    // engines: the player's vehicle, anything else with a driver, spinning rotors
    list.length = 0;
    for (const c of near) if (c === pc || c.driver || (c.m.air && c.rotor > 0.02)) list.push(c);
    this.byDist(list);
    for (let i = 0; i < list.length && i < SND_MAX.engine; i++) {
      const c = list[i], cls = this.classOf(c), mine = c === pc;
      const thr = mine ? Input.throttle() : c.driver ? 0.3 : 0;
      const v = this.want('engine', c, c.x, c.y, cls, mine && now < this.igniteT ? 0 : 1);
      if (!v) continue;
      if (cls === 'rotor') v.set(c.rotor || 0, mine ? Math.max(Math.abs(thr), Input.held('fire') ? 1 : 0) : 0);
      else {
        const frac = Math.abs(c.vf()) / c.m.max;
        const rev = mine && !c.m.tank && Input.held('fire');
        v.set(this.engineRpm(cls, frac, thr, rev), Math.abs(thr), frac);
      }
    }
    // tyres, horns, sirens, fires
    this.loopsFor(near, 'skid', (c) => c.skid && c.speed() > 30, (v, c) => v.set(sndClamp((c.slip - 50) / 250, 0.15, 1)));
    this.loopsFor(near, 'horn', (c) => c.honking && c.m.horn, null, (c) => c.m.horn);
    this.loopsFor(near, 'siren', (c) => c.sirenOn && c.m.siren, (v) => v.set(), (c) => c.m.siren);
    this.loopsFor(near, 'fire', (c) => c.burning, (v) => v.set(dt));
    // wall scrapes (reported by impact) last a moment after the last contact
    for (const [c, t] of this.scrapes) {
      if (now - t > 0.12 || c.wreck) { this.scrapes.delete(c); continue; }
      const v = this.want('scrape', c, c.x, c.y);
      if (v) v.set(sndClamp(c.speed() / 300, 0, 1));
    }
    // tank turret servo
    if (pc && pc.m.tank) {
      const rate = Math.abs(pc.turret - (this.lastTurret ?? pc.turret)) / dt;
      this.lastTurret = pc.turret;
      if (rate > 0.3) { const v = this.want('servo', pc, pc.x, pc.y); if (v) v.set(Math.min(1, rate / 2.8)); }
    } else this.lastTurret = undefined;
  },
  loopsFor(near, type, test, set, arg) {
    const list = this._list;
    list.length = 0;
    for (const c of near) if (test(c)) list.push(c);
    if (!list.length) return;
    this.byDist(list);
    for (let i = 0; i < list.length && i < SND_MAX[type]; i++) {
      const c = list[i], v = this.want(type, c, c.x, c.y, arg ? arg(c) : undefined);
      if (v && set) set(v, c);
    }
  },

  world(dt) {
    const cam = G.cam;
    // hydrant sprays
    let n = 0;
    for (const s of G.sprays || []) {
      if (s.t <= 0 || n >= SND_MAX.spray) continue;
      const v = this.want('spray', s, s.x, s.y);
      if (v) { v.set(Math.min(1, s.t / 2)); n++; }
    }
    // rockets in flight, molotov fire patches (fading out over their last 1.2 s)
    n = 0;
    for (const q of G.projectiles || []) {
      if (q.k !== 'rocket' || q.dead || n >= SND_MAX.rocket) continue;
      if (this.want('rocket', q, q.x, q.y)) n++;
    }
    n = 0;
    for (const f of G.fires || []) {
      if (f.t <= 0 || n >= SND_MAX.patch) continue;
      const v = this.want('fire', f, f.x, f.y, undefined, 1.4 * Math.min(1, f.t / 1.2));
      if (v) { v.set(dt); n++; }
    }
    // ringing payphone
    if (typeof Missions !== 'undefined' && Missions.ringing >= 0 && G.city.phones) {
      const ph = G.city.phones[Missions.ringing];
      const v = ph && this.want('payphone', 'pp', ph.x, ph.y);
      if (v) v.set();
    }
    if (typeof Train !== 'undefined' && Train.rail) this.trainSounds(dt);
    this.people();
    this.airport();
    this.ambience(dt, cam);
  },

  trainSounds(dt) {
    const T = Train, S = this.train, cam = G.cam, half = T.len / 2, speed = Math.abs(T.v);
    const pos = (s) => { this._tx = T.rail.x0 + T.ux * s; this._ty = T.rail.y0 + T.uy * s; };
    // the loop sits on the train's nearest point to the camera
    const camS = (cam.cx - T.rail.x0) * T.ux + (cam.cy - T.rail.y0) * T.uy;
    pos(sndClamp(camS, T.s - half, T.s + half));
    const nx = this._tx, ny = this._ty;
    const v = this.want('train', 'train', nx, ny);
    if (v) v.set(speed / T.vmax);
    // wheels over rail joints
    S.odo += speed * dt;
    if (S.odo >= 58) { S.odo -= 58; if (v) this.fire('clack', nx, ny, SND_NOOPTS); }
    pos(T.s + T.dir * half);
    const fx = this._tx, fy = this._ty;
    // brakes squeal as it slows into a stop
    const decel = (S.v - speed) / dt;
    S.v = speed;
    if (speed > 2 && speed < 70 && decel > 10) { const q = this.want('squeal', 'train', fx, fy); if (q) q.set(sndClamp((70 - speed) / 50, 0.2, 1)); }
    // horn on departure
    if (S.wait > 0 && T.wait <= 0) this.fire('trainHorn', fx, fy, { n: 1 });
    S.wait = T.wait;
    // level crossings: horn on approach, bells while the train is near
    if (this.amb.xCity !== G.city) { this.amb.xings = this.crossings(); this.amb.xCity = G.city; }
    const front = T.s + T.dir * half;
    for (const x of this.amb.xings) {
      const ahead = (x.s - front) * T.dir;
      if (ahead < 0) x.honked = false;
      else if (!x.honked && ahead < 280 && speed > 30) { x.honked = true; this.fire('trainHorn', fx, fy, { n: 2 }); }
      const gap = Math.abs(x.s - T.s) - half;
      if (gap < 350 && (speed > 1 || gap < 60)) {
        x.bellT -= dt;
        if (x.bellT <= 0) { x.bellT = 0.5; this.fire('bell', x.x, x.y, SND_NOOPTS); }
      } else x.bellT = 0;
    }
  },
  // level crossings along the railway (computed once per city from City.roadAt)
  crossings() {
    const T = Train, out = [];
    if (typeof City === 'undefined' || !City.roadAt) return out;
    let run = null;
    const flush = () => {
      if (!run) return;
      const s = (run.a + run.b) / 2;
      out.push({ s, x: T.rail.x0 + T.ux * s, y: T.rail.y0 + T.uy * s, honked: false, bellT: 0 });
      run = null;
    };
    for (let s = 0; s <= T.length; s += TILE) {
      const tx = Math.floor((T.rail.x0 + T.ux * s) / TILE), ty = Math.floor((T.rail.y0 + T.uy * s) / TILE);
      let hit = false;
      for (let k = -2; k <= 2 && !hit; k++) { const r = City.roadAt(tx + T.nx * k, ty + T.ny * k); hit = !!(r && r.xing); }
      if (hit) { if (run) run.b = s; else run = { a: s, b: s }; } else flush();
    }
    flush();
    return out;
  },

  // Ambience: a coarse 7×5 sample of tile kinds around the camera every 1/3 s picks the beds'
  // levels and rolls the dice for critters (grazing cows from G.peds, ships and boats from
  // Render.idx.sprites; planes are real now, see airport()). Beds crossfade on their own slow time constant.
  ambience(dt, cam) {
    const A = this.amb, c = G.city, now = this.ctx.currentTime;
    if (--A.n <= 0) {
      A.n = 20;
      let water = 0, coast = 0, green = 0, desert = 0, farm = 0, total = 0;
      const pts = this._pts || (this._pts = []);
      pts.length = 0;
      for (let j = -2; j <= 2; j++) for (let i = -3; i <= 3; i++) {
        const x = cam.cx + i * cam.w * 0.22, y = cam.cy + j * cam.h * 0.3;
        const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
        const k = tx < 0 || ty < 0 || tx >= c.W || ty >= c.H ? KIND.WATER : c.kind[ty * c.W + tx];
        total++;
        if (k === KIND.WATER) water++;
        else if (k === KIND.SAND || k === KIND.PIER || k === KIND.BOARDWALK || k === KIND.QUAY) { coast++; pts.push(x, y, 1); }
        else if (k === KIND.FOREST || k === KIND.MEADOW || k === KIND.GRASS || k === KIND.LAWN) { green++; pts.push(x, y, 2); }
        else if (k === KIND.DESERT || k === KIND.DUNE || k === KIND.ROCK) desert++;
        else if (k === KIND.FIELD || k === KIND.DIRT) farm++;
      }
      const w = water / total, land = 1 - w, co = coast / total, gr = green / total, de = desert / total, fa = farm / total;
      const zone = City.regionAt(cam.cx, cam.cy).zone, T = sndDaytime();
      const night = sndLin(T.dark, 0.2, 0.9); // 0 day .. 1 night: rises ~17:40-20:45, falls ~05:00-07:00
      const pc = G.player.car, high = pc && pc.alt > 60 ? 0.5 : 0;
      const B = A.beds;
      B.bedSea = w > 0.99 ? 0.5 : w > 0 ? Math.min(1, 2.2 * Math.min(w, land) + 0.3 * co) : co > 0 ? 0.3 : 0;
      B.bedCity = land * (zone === 'downtown' ? 0.9 : zone === 'highway' ? 0.35 : zone === 'airport' ? 0.3 : 0) * (1 - 0.3 * night);
      B.bedSuburb = land * (zone === 'suburbs' ? 0.8 : 0);
      B.bedIndustrial = land * (zone === 'industrial' ? 0.9 : 0);
      B.bedWind = Math.min(1, (zone === 'rural' || zone === 'wild' || zone === 'airport' ? 0.7 : 0.1) * (1 - de) * land + high);
      B.bedDesert = Math.min(1, de * 1.6);
      B.bedCrickets = night * Math.min(1, (gr + fa) * 1.4);
      // critters
      const rpt = (kind) => { // a random sample point of that kind → this._tx/_ty
        const m = pts.length / 3;
        for (let tries = 0; tries < 6 && m; tries++) { const i = Math.floor(Math.random() * m) * 3; if (pts[i + 2] === kind) { this._tx = pts[i]; this._ty = pts[i + 1]; return true; } }
        return false;
      };
      if ((co > 0.05 || (w > 0.1 && land > 0.1)) && Math.random() < 0.07 * (1 - night) && (rpt(1) || rpt(2))) this.fire('gull', this._tx, this._ty, SND_NOOPTS);
      if (T.birds > 0 && gr > 0.25 && Math.random() < 0.25 * gr * T.birds && rpt(2)) this.fire('songbird', this._tx, this._ty, SND_NOOPTS);
      if (zone === 'industrial' && Math.random() < 0.08) this.fire('clank', cam.cx + sndRand(-0.5, 0.5) * cam.w, cam.cy + sndRand(-0.5, 0.5) * cam.h, SND_NOOPTS);
      // grazing cows (G.peds, kind 'cow') on screen: one moos now and then, more often in a big herd
      if (now > A.mooT && G.peds) {
        const cows = this._cows;
        cows.length = 0;
        for (const p of G.peds) if (p.kind === 'cow' && !p.dead && !p.gone && p.state === 'graze' && p.x > cam.x - 60 && p.x < cam.x + cam.w + 60 && p.y > cam.y - 60 && p.y < cam.y + cam.h + 60) cows.push(p);
        if (cows.length) { const cw = cows[Math.floor(Math.random() * cows.length)]; this.fire('moo', cw.x, cw.y, cw.bull ? { bull: true } : SND_NOOPTS); A.mooT = now + sndRand(3, 12) * (cows.length > 4 ? 0.7 : 1); }
      }
      const I = typeof Render !== 'undefined' && Render.idx;
      if (I) {
        const Rw = Math.max(360, cam.w);
        let boat = null, bd = Rw * 0.8, ship = null;
        for (const s of I.sprites.query(cam.cx - Rw * 2, cam.cy - Rw * 2, cam.cx + Rw * 2, cam.cy + Rw * 2)) {
          if (s.sheet === 'ships' || s.sheet === 'boats') {
            if (s.tag === 'container_ship') ship = s;
            else if (s.tag === 'motorboat' || s.tag === 'yacht') { const d = Math.hypot(s.x - cam.cx, s.y - cam.cy); if (d < bd) { bd = d; boat = s; } }
          }
        }
        A.boat = boat;
        if (ship) { if (!A.shipT) A.shipT = now + sndRand(5, 15); else if (now > A.shipT) { this.fire('shipHorn', ship.x, ship.y, SND_NOOPTS); A.shipT = now + sndRand(30, 70); } } else A.shipT = 0;
      }
    }
    this.beds();
    if (A.boat) this.want('boat', 'boat', A.boat.x, A.boat.y);
  },
  beds() { const B = this.amb.beds; for (const b of SND_BEDS) if (B[b] > 0.01) this.want(b, 'bed', undefined, undefined, undefined, B[b]); },

  // in a gun store: the world waits (its loops stop), the street stays faintly audible, UI moves tick
  shop() {
    this.beds();
    if (typeof Phone !== 'undefined') this.ph.open = Phone.open;
    const sel = typeof Shop !== 'undefined' && Shop.open ? Shop.sel : Paint.sel;
    if (this.shopSel >= 0 && sel !== this.shopSel) this.fire('move', undefined, undefined, SND_NOOPTS);
    this.shopSel = sel;
  },
  // paint shop respray (Paint.spray = { car, t } while it runs): the spray loop, then a ding
  paint() {
    if (typeof Paint === 'undefined') return;
    const S = Paint.spray;
    if (S && S.car) {
      const v = this.want('paintSpray', S, S.car.x, S.car.y);
      if (v) v.set(S.t);
      this.sprayCar = S.car;
    } else if (this.sprayCar) {
      this.fire('paintDone', this.sprayCar.x, this.sprayCar.y, SND_NOOPTS);
      this.sprayCar = null;
    }
  },

  // cellphone: ring / calling loops, and sounds for open/close, answer/hang-up, clicks, messages
  phone() {
    if (typeof Phone === 'undefined') return;
    const P = this.ph;
    if (Phone.incoming) { const v = this.want('ringtone', 'rt'); if (v) v.set(); }
    if (Phone.calling) { const v = this.want('ringback', 'rb'); if (v) v.set(); }
    if (Phone.open !== P.open) { P.open = Phone.open; this.fire(P.open ? 'phoneOpen' : 'phoneClose', undefined, undefined, SND_NOOPTS); }
    if (P.incoming && !Phone.incoming) this.fire(Phone.calling ? 'answer' : 'hangup', undefined, undefined, SND_NOOPTS);
    P.incoming = Phone.incoming;
    const m0 = Phone.messages && Phone.messages[0];
    if (m0 && m0 !== P.msg && P.seen) this.fire('message', undefined, undefined, SND_NOOPTS);
    P.seen = true;
    P.msg = m0;
    if (Phone.open && Input.hit('click')) { const mv = Input.mouseView(); if (Phone.contains(G.cam, mv.x, mv.y)) this.fire('click', undefined, undefined, SND_NOOPTS); }
  },

  // footsteps (two per walk cycle), softer on grass and sand
  player() {
    const p = G.player;
    if (p.car || p.dead || !p.moving) return;
    const st = Math.floor(p.walkT * 4.5);
    if (st === this.stepN) return;
    this.stepN = st;
    const c = G.city, tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    const k = c.kind[ty * c.W + tx];
    const soft = k === KIND.GRASS || k === KIND.LAWN || k === KIND.MEADOW || k === KIND.FOREST || k === KIND.SAND || k === KIND.FIELD || k === KIND.DIRT;
    this.fire('step', undefined, undefined, soft ? { soft: true } : SND_NOOPTS);
  },

  // the player on foot getting hurt (bullets, fists, a bull, fire): a grunt, at most every 0.6 s
  playerHurt(dt) {
    const p = G.player, now = this.ctx.currentTime;
    const drop = this.php === undefined ? 0 : this.php - p.hp;
    this.php = p.hp;
    this.hurtAcc = this.hurtAcc * Math.pow(0.1, dt) + Math.max(0, drop);
    if (this.hurtAcc >= 4 && !p.dead && !p.car && now - this.gruntT > 0.6) {
      this.gruntT = now; this.hurtAcc = 0;
      this.fire('grunt', p.x, p.y, SND_NOOPTS);
    }
  },

  // People and cows (G.peds): read from state like the engines, no hooks in peds.js. Each body within
  // earshot is compared with what it was last tick (Sound.pv): a new state, a new speech bubble, lost
  // hp or death starts its voice. Burning peds get the burnScream loop, running cows the hooves loop.
  // Crowds: at most 2 new voices per tick and one every 60 ms, plus the per-sound voice limits.
  people() {
    const list = G.peds;
    if (!list || !list.length) return;
    const cam = G.cam, R = Math.max(360, cam.w) * 1.1, R2 = R * R, M = this.pv, tick = this.tick, burn = this._burn;
    burn.length = 0;
    this.voxN = 0; this.copN = 0;
    let hn = 0, hx = 0, hy = 0, heavy = false;
    for (const p of list) {
      if (p.gone) continue;
      const dx = p.x - cam.cx, dy = p.y - cam.cy, near = dx * dx + dy * dy < R2;
      let e = M.get(p);
      if (!e) { e = { v: this.newVoice(p), t: -1, st: null, b: null, hp: 0, dead: false }; M.set(p, e); }
      if (near) {
        if (e.t === tick - 1) this.pedEvents(p, e);   // heard last tick too: react to what changed
        if (p.burning && !p.dead) burn.push(p);
        else if (p.kind === 'cow' && !p.dead && (p.state === 'stampede' || p.state === 'charge')) { hn++; hx += p.x; hy += p.y; heavy = heavy || p.state === 'charge'; }
      }
      e.t = near ? tick : -1; e.st = p.state; e.b = p.bubble; e.hp = p.hp; e.dead = p.dead;
    }
    if (burn.length) {
      this.byDist(burn);
      for (let i = 0; i < burn.length && i < SND_MAX.burn; i++) { const p = burn[i], v = this.want('burnScream', p, p.x, p.y, M.get(p).v); if (v) v.set(); }
    }
    if (hn) { const v = this.want('hooves', 'herd', hx / hn, hy / hn); if (v) v.set(hn, heavy); }
  },
  pedEvents(p, e) {
    const st = p.state, changed = st !== e.st, bub = !!p.bubble && p.bubble !== e.b, hurt = e.hp - p.hp >= 3;
    if (p.dead) {   // killed by a car or the train: the splat says it (Sound.body); burnt: the loop did
      if (!e.dead && !p.burnt && !(p.runBy && p.runBy.length)) this.vocal(p.kind === 'cow' ? 'bellow' : 'ouch', p, p.kind === 'cow' ? { die: true, bull: p.bull } : { v: e.v, death: true });
      return;
    }
    if (p.kind === 'cow') {
      if (changed && st === 'charge') this.fire('snort', p.x, p.y, SND_NOOPTS);
      else if ((changed && st === 'stampede' && Math.random() < 0.4) || (hurt && Math.random() < 0.6)) this.vocal('bellow', p, p.bull ? { bull: true } : SND_NOOPTS);
      return;
    }
    if (p.burning) return;
    if (p.mood === 'cop') { this.copEvents(p, e, bub, hurt); return; }
    if (p.gang) { this.mobEvents(p, e, st, changed, bub); return; }
    if (changed && st === 'fight') this.vocal('growl', p, { v: e.v });
    else if (changed && (st === 'flee' || st === 'cower')) {
      if (p.mood === 'angry' && bub) this.vocal('hey', p, { v: e.v });
      else if (bub || hurt || Math.random() < 0.35) this.vocal('scream', p, { v: e.v, short: st === 'cower' });
    } else if (hurt) this.vocal('ouch', p, { v: e.v });
    else if (bub) this.vocal(p.mood === 'scared' ? 'scream' : 'hey', p, { v: e.v, short: true, low: p.mood === 'violent' });
  },
  // cops don't scream: a grunt when hit, and every bubble is barked (radio squelch on OFFICER DOWN!,
  // a roger beep on LOST HIM.). A radio call engages several at once: at most 2 barks a tick, staggered.
  copEvents(p, e, bub, hurt) {
    if (hurt) this.vocal('ouch', p, { v: e.v });
    if (!bub || this.copN >= 2) return;
    const text = p.bubble.text, radio = text === 'OFFICER DOWN!' ? 'down' : text === 'LOST HIM.' ? 'lost' : null, now = this.ctx.currentTime;
    if (radio) { if (now < (this.radioT[radio] || 0)) return; this.radioT[radio] = now + 2.5; }   // one cop calls it in
    this.fire('copBark', p.x, p.y, { v: e.v, text, radio,
      delay: (hurt ? 0.22 : 0) + this.copN * 0.35 });
    this.copN++;
  },
  // mob members: every bubble is shouted in the mob's voice (queued 0.35 s apart, dropped past 0.7 s), a fight
  // start without a line is a growl; hurt = ouch, a big hit (a shotgun) = a short yelp. They never cower-scream.
  mobEvents(p, e, st, changed, bub) {
    if (!e.v || e.v.mob !== p.gang) e.v = sndMobVoice(p.gang);   // made a member after its voice was picked
    const lost = e.hp - p.hp;
    if (lost >= 14) this.vocal('scream', p, { v: e.v, short: true });
    else if (lost >= 3) this.vocal('ouch', p, { v: e.v });
    const now = this.ctx.currentTime, wait = Math.max(0, this.mobAt - now) + (lost >= 3 ? 0.25 : 0);
    if (bub && wait < 0.7) {   // a rally: the lines queue up 0.35 s apart, and the rest stay silent
      this.fire('mobBark', p.x, p.y, { v: e.v, text: p.bubble.text, delay: wait });
      this.mobAt = now + wait + 0.35;
    } else if (changed && st === 'fight') this.vocal('growl', p, { v: e.v });
  },
  vocal(name, p, o) {
    const now = this.ctx.currentTime;
    if (this.voxN >= 2 || now - this.voxT < 0.06) return;
    this.voxN++; this.voxT = now;
    this.fire(name, p.x, p.y, o);
  },

  // Flights.planes / Cranes.list (src/airport.js): engines follow the flight phase, crane motors
  // their drive speeds, and a crane's clank plays when its `clank` time changes.
  airport() {
    if (typeof Flights !== 'undefined' && Flights.planes) {
      let n = 0;
      for (const p of Flights.planes) {
        if (p.phase === 'parked' || p.gone || n >= SND_MAX.plane) continue;
        const P = p.P || {}, ph = p.phase, fast = P.rot ? sndClamp(p.v / P.rot, 0, 1) : 0;
        const spool = ph === 'push' ? 0.1 : ph === 'lineup' ? 0.3 : ph === 'takeoff' ? 0.55 + 0.45 * fast : ph === 'climb' ? 1
          : ph === 'approach' ? 0.45 : ph === 'rollout' ? 0.3 : 0.2 + 0.1 * sndClamp(p.v / 80, 0, 1);
        const v = this.want(p.tag === 'propplane' ? 'prop' : 'jet', p, p.x, p.y, undefined, 1 / (1 + (p.alt || 0) / 150));
        if (v) { v.set(spool, p.rev ? 1 : 0, this._g); n++; }
      }
    }
    if (typeof Cranes !== 'undefined' && Cranes.list) {
      const C = typeof CR !== 'undefined' ? CR : null, TV = C ? C.TROLLEY_V : 45, HV = C ? C.HOIST_V : 40;
      for (const k of Cranes.list) {
        const y = k.y - (k.ty || 0), last = this.craneSeen.get(k);   // over the trolley
        if (last !== undefined && k.clank !== last) this.fire('craneClank', k.x, y, SND_NOOPTS);
        this.craneSeen.set(k, k.clank);
        const amt = sndClamp(Math.max(k.trolleyV / TV, k.hoistV / HV, k.moving ? 1 : 0), 0, 1);
        if (amt > 0 || (k.q && k.q.length)) { const v = this.want('craneMotor', k, k.x, y); if (v) v.set(amt, k.hoistV > 0); }
      }
    }
  },

  // ----------------------------------------------------------- soundboard --
  // Preview helpers (soundboard.html). They start audio themselves (the click is the gesture).
  preview(name, o) { this.unlock(); if (this.ctx && this.bus) { try { this.fire(name, 0, 0, o || SND_NOOPTS); } catch (e) { this.fail(e); } } },
  startLoop(type, arg) {
    this.unlock();
    if (!this.ctx || !this.bus) return null;
    try { const v = this.makeLoop(type, arg); this.level(v, this.board.gain, this.board.pan); return v; } catch (e) { this.fail(e); return null; }
  },
  stopPreview(v) { if (v && this.ctx) try { this.stopLoop(v); } catch (e) { this.fail(e); } },
  // Offline render of one catalog item → { peak, rms } in dBFS (for level checks without ears)
  measure(item, secs = 3) {
    const OAC = typeof OfflineAudioContext !== 'undefined' && OfflineAudioContext;
    if (!OAC) return Promise.resolve(null);
    const keep = { ctx: this.ctx, bus: this.bus, white: this.white, brown: this.brown, voices: this.voices, pannable: this.pannable, inGame: this.inGame, board: this.board, force: this.force };
    const sr = 22050, off = new OAC(2, Math.ceil(sr * secs), sr);
    try {
      this.ctx = off; this.force = true; this.pannable = typeof off.createStereoPanner === 'function'; this.inGame = false; this.board = { pan: 0, gain: 1 };
      this.white = this.noiseBuffer(false); this.brown = this.noiseBuffer(true);
      const master = this.gain(1); master.connect(off.destination);
      this.bus = { master }; for (const k in SND_BUS) this.bus[k] = master;
      this.voices = {};
      if (item.shot) this.fire(item.shot, 0, 0, item.o || SND_NOOPTS);
      else if (item.fn) item.fn(this);
      else {
        const v = this.makeLoop(item.loop, item.arg);
        v.out.gain.value = v.vol; v.look = secs;
        Sound.applyPreview(item, v, item.test || {});
      }
    } finally { Object.assign(this, keep); }
    return off.startRendering().then((buf) => {
      let peak = 0, sum = 0;
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sum += d[i] * d[i]; }
      }
      const rms = Math.sqrt(sum / (buf.length * buf.numberOfChannels));
      const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
      return { peak: db(peak), rms: db(rms), nan: !isFinite(peak) };
    });
  },
  // soundboard / measure: push slider values into a loop voice
  applyPreview(item, v, s) {
    const ctl = item.ctl;
    if (ctl === 'engine') {
      const sp = s.speed ?? 0.5, thr = s.throttle ?? 1;
      v.set(this.engineRpm(item.arg, sp, thr, !!s.rev), Math.abs(thr), sp);
    } else if (ctl === 'rotor') v.set(s.amount ?? 1, s.throttle ?? 0.5);
    else if (ctl === 'amount') v.set(s.amount ?? 0.7);
    else if (ctl === 'herd') v.set(1 + Math.round(9 * (s.amount ?? 0.3)), !!s.rev);
    else if (ctl === 'jet') v.set(s.amount ?? 0.3, s.rev ? 1 : 0, 1 - (s.far ?? 0));
    else if (ctl === 'crane') v.set(s.amount ?? 0.7, !!s.rev);
    else if (ctl === 'dt') v.set(0.05);
    else v.set();
  },
};

// What soundboard.html shows: [group, [items]]. item: { shot | loop | fn, label, o, arg, ctl }
// ctl: 'engine' (speed/throttle/handbrake-rev), 'rotor' (spin/throttle), 'amount' (one slider), 'dt'.
Sound.catalog = [
  ['Vehicles', [
    ...['small', 'car', 'sport', 'muscle', 'diesel', 'tractor', 'electric', 'harvester', 'tank'].map((cls) => ({
      loop: 'engine', arg: cls, ctl: 'engine', label: 'Engine: ' + cls,
      note: Object.keys(SND_ENGINE_OF).filter((m) => SND_ENGINE_OF[m] === cls).join(', ') })),
    { loop: 'engine', arg: 'rotor', ctl: 'rotor', label: 'Helicopter rotor', note: 'helicopter (amount = rotor spin)' },
    { loop: 'skid', ctl: 'amount', label: 'Tyre skid', note: 'car.skid, level from slip' },
    { loop: 'horn', arg: 'small', label: 'Horn: small', note: 'hatch, tractor, forklift' },
    { loop: 'horn', arg: 'car', label: 'Horn: car' },
    { loop: 'horn', arg: 'truck', label: 'Horn: truck', note: 'heavies, harvester' },
    { loop: 'siren', arg: 'police', label: 'Siren: police', note: '5 s wail / 5 s yelp' },
    { loop: 'siren', arg: 'ambulance', label: 'Siren: ambulance', note: 'hi-lo' },
    { shot: 'door', o: { enter: true }, label: 'Door open/close' },
    { shot: 'hatch', label: 'Tank hatch' },
    { shot: 'crank', label: 'Starter crank' },
    { shot: 'impact', o: { k: 0.1 }, label: 'Collision: light' },
    { shot: 'impact', o: { k: 0.5 }, label: 'Collision: medium' },
    { shot: 'impact', o: { k: 0.6, metal: true }, label: 'Collision: heavy vehicle (metal)' },
    { shot: 'impact', o: { k: 1, glass: true }, label: 'Collision: big hit (glass)' },
    { loop: 'scrape', ctl: 'amount', label: 'Wall scrape' },
    { loop: 'fire', ctl: 'dt', label: 'Car fire' },
    { shot: 'explosion', o: { big: 1 }, label: 'Explosion' },
    { shot: 'explosion', o: { big: 2 }, label: 'Explosion: heavy' },
    { fn: (S) => { S.explode(0, 0, 2); S.explode(0, 0, 2); S.explode(0, 0, 2); }, label: 'Explosion: tanker chain' },
    { shot: 'cannon', label: 'Tank cannon' },
    { loop: 'servo', ctl: 'amount', label: 'Turret servo' },
  ]],
  ['Weapons', [
    { shot: 'pistol', label: 'Pistol' },
    { shot: 'uzi', label: 'Uzi (one shot)' },
    { fn: (S) => { for (let i = 0; i < 8; i++) S.fire('uzi', 0, 0, { delay: i * 0.085 }); }, label: 'Uzi burst' },
    { shot: 'empty', label: 'Empty click' },
    { shot: 'cock', label: 'Weapon switch / weapon pickup' },
    { shot: 'ping', label: 'Bullet hits a car' },
    { shot: 'clang', label: 'Bullet hits the tank' },
    { shot: 'ricochet', label: 'Bullet hits a wall' },
    { shot: 'shotgun', label: 'Shotgun (blast + pump)' },
    { shot: 'bazooka', label: 'Bazooka launch' },
    { loop: 'rocket', label: 'Rocket in flight' },
    { shot: 'throwPin', label: 'Grenade: pin + throw' },
    { shot: 'tink', o: { v: 200 }, label: 'Grenade bounce' },
    { shot: 'throw', label: 'Molotov throw' },
    { shot: 'shatter', label: 'Molotov shatter + flames' },
    { loop: 'fire', ctl: 'dt', label: 'Fire patch (same loop as car fire)' },
    { shot: 'plop', label: 'Thrown into water' },
  ]],
  ['Gun store', [
    { shot: 'shopEnter', label: 'Enter (door chime)' },
    { shot: 'move', label: 'Selection moves' },
    { shot: 'buy', label: 'Buy' },
    { shot: 'buzz', label: 'Can\'t buy (full / no cash)' },
    { shot: 'shopLeave', label: 'Leave' },
  ]],
  ['Carjack', [
    { shot: 'jackGrab', label: 'Door handle grabbed', note: 'Game.jack starts' },
    { fn: (S) => { const v = sndVoice(); S.fire('jackYank', 0, 0, SND_NOOPTS); S.fire('hey', 0, 0, { v, delay: 0.06 }); }, label: 'Yank: angry driver "HEY!"', note: 'Game.yank, the player steals' },
    { fn: (S) => { const v = sndVoice(); S.fire('jackYank', 0, 0, SND_NOOPTS); S.fire('hey', 0, 0, { v, rough: true, delay: 0.06 }); }, label: 'Yank: violent driver', note: 'then "come on!" when he gets up' },
    { fn: (S) => { const v = sndVoice(); S.fire('jackYank', 0, 0, SND_NOOPTS); S.fire('scream', 0, 0, { v, short: true, delay: 0.08 }); }, label: 'Yank: scared driver' },
    { fn: (S) => { S.fire('jackYank', 0, 0, SND_NOOPTS); S.fire('hey', 0, 0, { rough: true, delay: 0.04 }); S.fire('grunt', 0, 0, { delay: 0.4 }); }, label: 'Pulled out by a driver (+ player grunt)', note: 'reverse jack' },
    { shot: 'jackSlam', label: 'Door slam + tyres, the car tears off', note: 'Traffic.takeOver after a reverse jack' },
    { fn: (S) => { S.fire('crewDoor', 0, 0, SND_NOOPTS); S.fire('crewDoor', 0, 0, { delay: 0.08 }); S.fire('mobBark', 0, 0, { v: sndMobVoice('moretti'), text: 'GET HIM!', delay: 0.45 }); }, label: 'Mob crew bails out (+ first bark)', note: 'Game.gangBail; one door for the passenger in Game.yank' },
  ]],
  ['Cops', [
    ...Object.keys(SND_COP_SAYS).map((text) => ({ shot: 'copBark', o: { text, radio: text === 'OFFICER DOWN!' ? 'down' : text === 'LOST HIM.' ? 'lost' : null },
      label: 'Cop: ' + text, note: text === 'OFFICER DOWN!' ? 'radio squelch + chirp' : text === 'LOST HIM.' ? 'quiet, roger beep' : 'engage bubble' })),
    { fn: (S) => S.fire('ouch', 0, 0, { v: sndCopVoice() }), label: 'Cop hit', note: 'cops never scream; shotgun = Weapons: Shotgun' },
  ]],
  ['Mobs', [
    ...['moretti', 'orlov', 'orchid'].flatMap((mob) => [
      ...GANG_SAYS_SND[mob].map((text) => ({ shot: 'mobBark', o: { mob, text }, label: mob[0].toUpperCase() + mob.slice(1) + ': ' + text, note: 'a new voice each press' })),
      { fn: (S) => { const v = sndMobVoice(mob); S.fire('ouch', 0, 0, { v }); S.fire('scream', 0, 0, { v, short: true, delay: 0.5 }); S.fire('growl', 0, 0, { v, delay: 1 }); },
        label: mob[0].toUpperCase() + mob.slice(1) + ': hurt, big hit, fight', note: 'ouch, shotgun yelp, "come on!"' },
      { shot: 'respect', o: { mob, up: true }, label: 'Respect up: ' + mob, note: 'Gangs.onChange' },
      { shot: 'respect', o: { mob, up: true, band: true }, label: 'Respect up a band: ' + mob },
      { shot: 'respect', o: { mob, up: false }, label: 'Respect down: ' + mob },
    ]),
    { shot: 'respectKos', label: 'Respect falls to KILL ON SIGHT', note: 'any mob' },
  ]],
  ['Paint shop', [
    { loop: 'paintSpray', label: 'Respray: compressor + spray hiss', note: 'Paint.spray (1.2 s in game)' },
    { shot: 'paintDone', label: 'Respray done: ding' },
    { shot: 'shopEnter', label: 'Menu: same as the gun store', note: 'shopEnter / move / buy / buzz / shopLeave' },
  ]],
  ['World', [
    { loop: 'train', ctl: 'amount', label: 'Train rumble', note: 'amount = speed' },
    { shot: 'clack', label: 'Rail joint clack' },
    { shot: 'trainHorn', o: { n: 1 }, label: 'Train horn (departure)' },
    { shot: 'trainHorn', o: { n: 2 }, label: 'Train horn (level crossing)' },
    { loop: 'squeal', ctl: 'amount', label: 'Train brake squeal' },
    { shot: 'bell', label: 'Crossing bell (one ding)' },
    { shot: 'shipHorn', label: 'Container ship horn' },
    { loop: 'boat', label: 'Boat idle putter' },
    { shot: 'moo', label: 'Cow (grazing)' },
    { shot: 'moo', o: { bull: true }, label: 'Bull (grazing)' },
    { shot: 'gull', label: 'Gulls' },
    { shot: 'songbird', label: 'Songbird' },
    { shot: 'clank', label: 'Industrial clank' },
    { shot: 'lamp', label: 'Lamp post knocked over' },
    { shot: 'hydrant', label: 'Hydrant burst' },
    { loop: 'spray', ctl: 'amount', label: 'Hydrant spray' },
    { shot: 'bin', label: 'Bin clatter' },
    { shot: 'sign', label: 'Sign / meter / mailbox' },
    { shot: 'cactus', label: 'Cactus' },
    { loop: 'payphone', label: 'Payphone ringing' },
  ]],
  ['People and cows', [
    { shot: 'scream', label: 'Scream', note: 'a scared ped starts fleeing (a new voice each press)' },
    { shot: 'scream', o: { short: true }, label: 'Scream: short yelp', note: 'cowering, or a scared ped\'s bubble' },
    { fn: (S) => { for (let i = 0; i < 3; i++) S.fire('scream', 0, 0, { delay: i * 0.13 }); }, label: 'Crowd scatter (3 screams)' },
    { loop: 'burnScream', ctl: 'dt', label: 'Burning scream', note: 'state burning' },
    { shot: 'ouch', label: 'Hurt', note: 'a ped loses 3+ hp' },
    { shot: 'ouch', o: { death: true }, label: 'Death cry', note: 'killed, not by a car or fire' },
    { shot: 'hey', label: 'Angry "HEY!"', note: 'an angry ped\'s bubble' },
    { shot: 'hey', o: { low: true }, label: 'Violent "huh?"', note: 'a violent ped sizes you up' },
    { shot: 'growl', label: 'Violent "come on!"', note: 'a fight starts' },
    { shot: 'grunt', label: 'Player hurt grunt', note: 'on foot, 4+ hp lost' },
    { shot: 'punch', label: 'Punch lands' },
    { shot: 'punch', o: { cow: true }, label: 'Punch lands on a cow' },
    { shot: 'whiff', label: 'Punch misses' },
    { shot: 'punchCar', label: 'Punch on a car' },
    { shot: 'punchCar', o: { tank: true }, label: 'Punch on the tank' },
    { shot: 'thwack', label: 'Round hits a ped' },
    { shot: 'thwack', o: { player: true }, label: 'Round hits the player' },
    { shot: 'thwack', o: { cow: true }, label: 'Round hits a cow' },
    { shot: 'thud', o: { k: 0.4 }, label: 'Car knocks a ped down' },
    { shot: 'splat', o: { k: 0.7 }, label: 'Car kills a ped' },
    { shot: 'splat', o: { k: 0.8, cow: true }, label: 'Car kills a cow (+ dying bellow in game)' },
    { shot: 'thud', o: { k: 0.4, cow: true }, label: 'Car shoves a cow / bull rams' },
    { shot: 'bump', o: { k: 0.8, wet: true }, label: 'Wheels over someone lying down' },
    { shot: 'bump', o: { k: 0.35, wet: true }, label: 'Wheels over a corpse' },
    { shot: 'bellow', label: 'Scared cow', note: 'stampede, or hurt' },
    { shot: 'bellow', o: { die: true }, label: 'Dying cow' },
    { shot: 'snort', label: 'Bull snort', note: 'a bull starts its charge' },
    { loop: 'hooves', ctl: 'herd', label: 'Hooves', note: 'amount = cows running; the box = a charging bull' },
  ]],
  ['Airport and port', [
    { loop: 'jet', ctl: 'jet', label: 'Airliner engines', note: 'amount = spool (0.1 push, 0.2 taxi, 0.45 approach, 1 take-off); box = reverse thrust; far = distance dulling' },
    { loop: 'prop', ctl: 'jet', label: 'Prop plane engine', note: 'same controls' },
    { loop: 'craneMotor', ctl: 'crane', label: 'Crane motors', note: 'amount = drive speed; box = hoisting' },
    { shot: 'craneClank', label: 'Crane: container locks / lands' },
  ]],
  ['Ambience beds', [
    { loop: 'bedCity', label: 'Downtown hum' },
    { loop: 'bedSuburb', label: 'Suburb calm' },
    { loop: 'bedIndustrial', label: 'Industrial' },
    { loop: 'bedWind', label: 'Farm / country wind' },
    { loop: 'bedDesert', label: 'Desert wind' },
    { loop: 'bedSea', label: 'Sea / coast' },
    { loop: 'bedCrickets', label: 'Crickets (night)' },
  ]],
  ['Player and UI', [
    { shot: 'step', label: 'Footstep: street' },
    { shot: 'step', o: { soft: true }, label: 'Footstep: grass / sand' },
    { shot: 'cash', label: 'Pickup: cash' },
    { shot: 'health', label: 'Pickup: health' },
    { shot: 'money', label: 'Money pop' },
    { shot: 'checkpoint', label: 'Checkpoint' },
    { shot: 'mission', label: 'Mission start' },
    { shot: 'complete', label: 'Mission complete + multiplier up' },
    { shot: 'fail', label: 'Mission failed' },
    { shot: 'wasted', label: 'WASTED' },
    { shot: 'start', label: 'Title: start' },
    { shot: 'swoosh', label: 'Skip 6 hours swoosh (O)' },
    { loop: 'ringtone', label: 'Cellphone ringtone' },
    { loop: 'ringback', label: 'Calling tone' },
    { shot: 'phoneOpen', label: 'Phone open' },
    { shot: 'phoneClose', label: 'Phone close' },
    { shot: 'click', label: 'Phone click' },
    { shot: 'answer', label: 'Answer' },
    { shot: 'hangup', label: 'Hang up / decline / missed' },
    { shot: 'message', label: 'Message ping' },
  ]],
];

Sound.load();
// start audio on the first gesture (and resume it on any later one); pause it with the tab
if (typeof addEventListener === 'function') {
  const go = () => Sound.unlock();
  for (const ev of ['keydown', 'mousedown', 'pointerdown', 'touchstart']) addEventListener(ev, go, true);
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', () => Sound.visibility());
}
