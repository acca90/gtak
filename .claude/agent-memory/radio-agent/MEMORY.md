# radio-agent — decision log
Format and rules: `.claude/rules/decisions.md`. Newest first.

## 2026-09-25 · Radio feature is on hold
- **Decision:** the agent exists but must not implement anything. Designs and specs only
  (`docs/radio.md`), until the user explicitly unlocks the feature.
- **Why:** the user said "wire the agent, hold the feature".
- **Status:** active

## 2026-09-25 · Radio plays only in vehicles, through sound-agent's `music` bus
- **Decision:** GTA-style in-car radio with original or procedurally generated music (no
  third-party tracks); the phone's RADIO app (`app === 'music'`) is the station UI.
- **Status:** planned
