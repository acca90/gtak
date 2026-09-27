# Agents and coordination (`.claude/agents/`)

Seven specialists. Each owns specific files or code sections and hands off the rest. Subagents
can't call each other, so **the main session is the coordinator**: it splits the work, writes the
shared spec, runs the agents, and then integrates and verifies the result.

| Agent | Owns | Typical asks |
|---|---|---|
| `pixel-agent` | `tools/generate-art.lua`, `art/`, exported `assets/`, `gallery.html`, `PAL`, lighting colours, look-only parts of `render.js` | sprites, facades, tiles, FX, icons, style |
| `vehicles-agent` | `MODELS`, `Car`, `Physics`, vehicle damage/explosions, `Train`, tank, enter/exit | stats, handling, toughness, special vehicles |
| `weapons-agent` | `WEAPONS`, shooting, bullets, cannon shells, `explode`, weapon pickups | new weapons, damage, ammo, combat feel |
| `geo-agent` | `src/city.js`: regions, roads, blocks, river, rail line, placement, spawn spots, region vehicle mixes | map realism, where new assets appear |
| `sound-agent` | `src/audio.js` (engine, mixer, buses, positional audio), SFX, `assets/sounds.js`, one-line sound hooks | engines, weapons, phone, impacts, ambience |
| `radio-agent` | **on hold**, then later: `src/radio.js`, stations and music, the phone's RADIO app | station design (specs only while on hold) |
| `screenplay-agent` | `docs/story/`, `src/missions.js`, `src/gangs.js`: story, characters, dialogue, missions, the mobs' respect / war / turf rules | factions, mission scripts, respect tables, new mission types |

Shared or unowned code (`core.js` including `KEYMAP`, the main loop, HUD, peds and cops, and the
phone apart from its RADIO app and its contact/text content) stays with the coordinator unless a task hands it to an agent
explicitly. **Keys are shared:** agents propose bindings, and the coordinator approves them.

**Sound hooks:** sound-agent may add one-line `Sound.*` calls inside other agents' functions
(e.g. in `shoot`, `explode`, `breakProp`). These are the only edits allowed in code it doesn't
own, and they must not change behaviour. The owner keeps the logic. Radio plays only through
the `music` bus from sound-agent.

## How a feature flows (a new vehicle, for example):
1. The coordinator writes one **spec** and gives it to every agent involved, e.g.
   `tag: dozer · sheet: heavy · footprint: 32×70 px · frames: normal/brake/wreck · role: slow,
   very tough, pushes cars · look: yellow bulldozer with a front blade · spawns: Ironworks yards`.
2. Agents whose files don't overlap run **in parallel**: pixel-agent draws `heavy:dozer`,
   vehicles-agent adds `MODELS.dozer` with the same sheet and footprint, geo-agent adds it to
   the yard spots. Anything that needs another agent's output (e.g. placement that depends on
   a new building footprint) runs after it.
3. Each agent verifies its own part (`node tools/check.js` + a screenshot it looked at) and ends
   its report with **Handoff**: what it needs from others.
4. The coordinator resolves the handoffs, runs a final check and in-game screenshot of the
   whole feature, updates README if player-facing, then commits with `/commit`.

Every new thing that makes noise (vehicle, weapon, prop) also gets a sound line in its spec
(`sound: heavy diesel engine, air-brake hiss`) for sound-agent.

Weapons follow the same flow: pixel draws `icon_<id>` / `crate_<id>` / FX, weapons-agent adds the
`WEAPONS` entry and the mechanics, and geo-agent places crates. The damage contract is that
weapons set the damage *dealt* and vehicles set the damage *taken* (armour, immunity).
