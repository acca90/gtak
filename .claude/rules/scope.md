# Scope (set by the user; don't expand without asking)

- **Traffic: unlocked** 2026-09-26 (spec `docs/specs/traffic-v1.md`); phase A (the AOV) first, then phase B.
  **No pedestrians yet**: they come later and use the same AOV, so keep 3-tile sidewalks compatible.
- **Sound:** being built now (spec `docs/specs/sound-v1.md`, owned by `sound-agent`). Radio music is still on hold.
- **Radio:** on hold at the user's request. `radio-agent` may only design and write specs until the
  user unlocks it.
- Each iteration's goal is **gameplay and aesthetics**. Prefer fewer, polished features ("don't go
  down a rabbit hole").
- The world is **World v2** (spec `docs/specs/world-v2.md`, the geography in `docs/geography.md`): a
  768² mainland with three cities, Ironworks, three farm zones, the airport and nature in between.
  Change it through geo-agent, and keep `docs/geography.md` in sync (`node tools/geo-report.js`).
