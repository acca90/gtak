# Scope (set by the user; don't expand without asking)

- **No traffic and no pedestrians yet.** They are planned for later iterations, so keep 3-tile
  sidewalks and lane layouts compatible with them.
- **Sound:** being built now (spec `docs/specs/sound-v1.md`, owned by `sound-agent`). Radio music is still on hold.
- **Radio:** on hold at the user's request. `radio-agent` may only design and write specs until the
  user unlocks it.
- Each iteration's goal is **gameplay and aesthetics**. Prefer fewer, polished features ("don't go
  down a rabbit hole").
- The world is **World v2** (spec `docs/specs/world-v2.md`, the geography in `docs/geography.md`): a
  768² mainland with three cities, Ironworks, three farm zones, the airport and nature in between.
  Change it through geo-agent, and keep `docs/geography.md` in sync (`node tools/geo-report.js`).
