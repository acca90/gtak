# Decisions and agent memory (`.claude/agent-memory/`)

Every agent has `memory: project`, which auto-loads `.claude/agent-memory/<agent>/MEMORY.md`
into that agent. It's the agent's **decision log**: the choices that shaped its area, so later
work stays consistent instead of re-deciding (or undoing) them.

**Record a decision** when you settle something a future change could plausibly contradict:
a number range (speed ladder, damage values), a contract (footprint, frame order, bus names), a
style rule, a rejected alternative, or a user preference about your area. Don't log routine edits;
git history has those.

Format: newest first, one entry per decision.

```markdown
## 2026-09-25 · Tank is immune to collisions and small arms
- **Decision:** the tank takes no damage from vehicle collisions, walls or bullets; explosions deal 35%.
- **Why:** the user asked for it to be the strongest vehicle, and it must not die to traffic.
- **Where:** `impact`, `updateBullets`, `explode` in src/game.js.
- **Status:** active   (active | superseded by <date/title> | reverted)
```

Rules:
- Only write in **your own** folder. Decisions that affect another agent go in your report's
  **Handoff**. The coordinator (main session) records cross-cutting decisions in
  `.claude/agent-memory/coordinator/MEMORY.md`.
- Before changing something in your area, read your log. If a change goes against an active
  decision, say so in the report and mark the old entry `superseded`. Don't silently undo it.
- Keep entries short and factual. Use absolute dates, and never include secrets.
