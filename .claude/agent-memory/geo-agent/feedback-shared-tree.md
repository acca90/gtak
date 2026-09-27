---
name: feedback-shared-tree
description: Never run git stash, checkout or reset in the gtalike tree; other agents edit it concurrently. Compare against HEAD via git show or a scratchpad worktree.
metadata:
  type: feedback
---

Never run `git stash`, `git checkout` or `git reset` in the working tree.

**Why:** other agents work in the same tree at the same time. A stash/pop to benchmark HEAD (2026-09-27) briefly reverted everyone's uncommitted work, and the coordinator forbade it.

**How to apply:** to compare against HEAD, use `git show HEAD:path > <scratchpad file>` and load that copy, or make a `git worktree add` in the scratchpad and run tools there.
