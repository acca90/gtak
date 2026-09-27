'use strict';
// The mobs (backlog 3, spec docs/specs/gangs-v1.md §2). Owner: screenplay-agent.
// Mechanics only: the factions table, the respect store, the war rule, bands, turf and the
// presence share. peds.js / traffic / the HUD read this; nothing here spawns or draws anything.
//
// State lives in G.gangs (Game.start: `G.gangs = Gangs.init()`), so a save is just Gangs.save().
// All numbers below are PROVISIONAL (screenplay-agent's defaults, 2026-09-27) until the user
// reviews them: the war ratio, the band thresholds, the event deltas and the shares.

const Gangs = {
  // --- balance table (provisional) ---
  NUM: {
    min: -100, max: 100, start: 0,
    war: 0.5,              // a gain with Moretti/Orlov lowers the other by this fraction (user may pick 1:1)
    kos: -60, hostile: -20, friendly: 20, trusted: 60,   // band edges: <=kos, <=hostile, >=friendly, >=trusted
    memberHurt: -1,        // the caller counts it once per ped
    memberKilled: -6, killRival: 2,   // killing a member: -6 with it, +2 with its war rival
    carStolen: -3,
  },

  // --- the three mobs (mobs.txt; names from docs/story/factions.md) ---
  // turf: districts as City.placeAt().district returns them (mixed case, matched case-insensitively).
  // share: part of a turf district's ped budget spawned as members; shareIn overrides it per district.
  // carPaint: a PAINTS id, resolved by ramp name at read time (pixel-agent adds NOIR / ORCHID ramps).
  list: [
    { id: 'moretti', name: 'MORETTI FAMILY', color: '#d04a5e', rival: 'orlov', turf: ['Side City'],
      share: 0.12, shareIn: {}, carModel: 'muscle', paintNames: ['CHERRY'], outfit: 'moretti' },
    { id: 'orlov', name: 'ORLOV SYNDICATE', color: '#2c2a36', outline: '#7a849e', rival: 'moretti',
      turf: ['Major City', 'Ironworks'], share: 0.12, shareIn: { ironworks: 0.06 }, carModel: 'sedan',
      paintNames: ['NOIR', 'SLATE'], outfit: 'orlov' },
    { id: 'orchid', name: 'ORCHID SOCIETY', color: '#8a4fc0', rival: null, turf: ['Main City'],
      share: 0.12, shareIn: {}, carModel: 'sport', paintNames: ['ORCHID', 'LILAC'], outfit: 'orchid' },
  ],

  // Callbacks fn(id, old, now, why), called after every respect change (the HUD's flash and band toast).
  onChange: [],

  _by: null, _turf: null,
  _index() {
    if (this._by) return;
    this._by = {}; this._turf = {};
    for (const g of this.list) {
      this._by[g.id] = g;
      for (const d of g.turf) this._turf[d.toLowerCase()] = g.id;
      const names = g.paintNames;
      Object.defineProperty(g, 'carPaint', { enumerable: true, get() {
        const ps = typeof PAINTS !== 'undefined' ? PAINTS : [];
        for (const n of names) { const p = ps.find((q) => q.name === n); if (p) return p.id; }
        return null;
      } });
    }
  },
  get(id) { this._index(); return this._by[id] || null; },

  // Fresh state for a new game; also stored in G.gangs.
  init() {
    this._index();
    const s = { respect: {}, quiet: false };
    for (const g of this.list) s.respect[g.id] = this.NUM.start;
    if (typeof G !== 'undefined') G.gangs = s;
    return s;
  },
  _state() {
    if (typeof G !== 'undefined' && G.gangs && G.gangs.respect) return G.gangs;
    return this.init();
  },

  respect(id) { const r = this._state().respect[id]; return r === undefined ? 0 : r; },

  // Set one mob's respect without the war rule (load, demo hook). Returns the new value.
  set(id, n, why) {
    if (!this.get(id)) return 0;
    const s = this._state(), old = this.respect(id);
    const now = Math.round(clamp(n, this.NUM.min, this.NUM.max));
    if (now === old) return now;
    s.respect[id] = now;
    for (const fn of this.onChange) fn(id, old, now, why || '');
    return now;
  },

  // Add n to a mob. A gain with one side of the war lowers its rival by NUM.war of it.
  add(id, n, why) {
    const g = this.get(id);
    if (!g || !n) return this.respect(id);
    const now = this.set(id, this.respect(id) + n, why);
    if (n > 0 && g.rival) this.set(g.rival, this.respect(g.rival) - Math.round(n * this.NUM.war), why);
    return now;
  },

  band(id) {
    const r = this.respect(id), N = this.NUM;
    return r <= N.kos ? 'kos' : r <= N.hostile ? 'hostile' : r >= N.trusted ? 'trusted' : r >= N.friendly ? 'friendly' : 'neutral';
  },

  // Whose turf a world position (px) is: a mob id or null.
  turfAt(x, y) {
    this._index();
    const d = typeof City !== 'undefined' && City.placeAt ? City.placeAt(x, y).district : '';
    return (d && this._turf[d.toLowerCase()]) || null;
  },
  // The mob whose members spawn here and their share of the ped budget, or null.
  presence(x, y) {
    this._index();
    const d = typeof City !== 'undefined' && City.placeAt ? (City.placeAt(x, y).district || '').toLowerCase() : '';
    const id = d && this._turf[d];
    if (!id) return null;
    const g = this._by[id], s = g.shareIn[d];
    return { id, share: s !== undefined ? s : g.share };
  },

  // Respect events. `by` is who did it: only the player moves respect.
  _player(by) { return by === true || (typeof G !== 'undefined' && by && by === G.player); },
  memberHurt(id, by) { if (this._player(by)) this.add(id, this.NUM.memberHurt, 'hurt'); },
  memberKilled(id, by) {
    if (!this._player(by)) return;
    const g = this.get(id);
    if (!g) return;
    this.set(id, this.respect(id) + this.NUM.memberKilled, 'kill');
    if (g.rival) this.set(g.rival, this.respect(g.rival) + this.NUM.killRival, 'kill');   // no war rule on this
  },
  carStolen(id) { if (this.get(id)) this.add(id, this.NUM.carStolen, 'car'); },

  // True while cops must look away (Orchid jobs set it later; always false in this slice).
  quiet() { return !!this._state().quiet; },

  save() { return { v: 1, respect: Object.assign({}, this._state().respect) }; },
  load(o) {
    const s = this.init();
    if (o && o.respect) for (const g of this.list) if (typeof o.respect[g.id] === 'number') s.respect[g.id] = Math.round(clamp(o.respect[g.id], this.NUM.min, this.NUM.max));
    return s;
  },
};
