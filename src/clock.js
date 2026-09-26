// In-game clock (spec docs/specs/time-v1.md). One game minute per real second, so a day
// lasts 24 real minutes. The light is a single "look" value s: 0 day, 1 dusk/dawn, 2 night.
// The light pass blends TIMES colours by s, and buildings cross-fade between the cached
// looks floor(s) and ceil(s), which is the same multiply, so ground and walls always match.

const RATE = 1;             // game minutes per real second
const START_MIN = 8 * 60;   // a new game starts on day 1 at 08:00
const TITLE_MIN = 18 * 60 + 40;
const FF_RATE = 240;        // game minutes per real second while fast-forwarding (O: 6 h in 1.5 s)

// hour -> look s; linear between keys (colours live in TIMES, render.js)
const LOOK_KEYS = [
  [0, 2], [4.5, 2], [5.25, 1.75], [6, 1.4], [6.5, 0.8], [7.5, 0.15], [8.5, 0],
  [16, 0], [17.5, 0.2], [18, 0.45], [18.5, 0.9], [19, 1.2], [19.5, 1.4], [20, 1.58],
  [21, 1.82], [22, 2], [24, 2],
];

const Clock = {
  init(min = START_MIN) { G.clock = { min, ff: 0 }; this.sync(); },

  // advance with the world (the caller skips it while paused, shopping or on the title)
  update(dt) {
    const k = G.clock;
    if (k.ff > 0) {
      const step = Math.min(k.ff, FF_RATE * dt);
      k.min += step; k.ff -= step;
    } else k.min += RATE * dt;
    this.sync();
  },

  // spend time: instantly, or fast-forwarded (O, the brothel later)
  advance(minutes, { fast = false } = {}) {
    if (fast) G.clock.ff += minutes;
    else { G.clock.min += minutes; this.sync(); }
  },

  set(hh, mm = 0) { G.clock.min = (this.day() - 1) * 1440 + hh * 60 + mm; G.clock.ff = 0; this.sync(); },

  hour() { return (G.clock.min % 1440) / 60; },
  day() { return Math.floor(G.clock.min / 1440) + 1; },
  label() {
    const m = Math.floor(G.clock.min % 1440);
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  },

  look(h = this.hour()) {
    for (let i = 1; i < LOOK_KEYS.length; i++) {
      const [h1, s1] = LOOK_KEYS[i];
      if (h <= h1) {
        const [h0, s0] = LOOK_KEYS[i - 1];
        return s0 + (s1 - s0) * (h - h0) / (h1 - h0);
      }
    }
    return 2;
  },

  // current lighting: { s, dark, ambient, lights, glow } (ambient null in full day)
  light() { return this._light; },

  // recompute the light and the legacy G.time (0 day, 1 dusk, 2 night) for old checks
  sync() {
    const s = this.look();
    G.time = s < 0.6 ? 0 : s < 1.5 ? 1 : 2;
    const a = Math.floor(Math.min(s, 1.999)), f = s - a;
    const A = TIMES[a], B = TIMES[a + 1];
    const mix = (x, y) => x + (y - x) * f;
    // lamps and windows stay off until the look is well into dusk, then fade in
    const on = (v) => (s >= 1 ? v : v * clamp((s - 0.6) / 0.4, 0, 1));
    this._light = {
      s, dark: s / 2,
      ambient: s <= 0.001 ? null : lerpHex(A.ambient || '#ffffff', B.ambient, f),
      lights: on(mix(A.lights || 0, B.lights)),
      glow: on(mix(A.glow || 0, B.glow)),
    };
  },
};

function lerpHex(a, b, t) {
  const p = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  let out = '#';
  for (let i = 0; i < 3; i++) out += Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, '0');
  return out;
}
