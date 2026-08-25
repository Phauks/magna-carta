---
worktree: claude/stale-branch-report
area: tooling
status: in-review
touches:
  - tooling/stale-branches/
  - vite.config.ts
  - changelog.d/
---

# 307 branches, and no way to ask which had landed

Reported the accumulation twice before doing anything about it, and the second time concluded the
proper test "needs git plumbing written around it — that's a piece of work". That was wrong:
`landedBranchesIn` already existed in `tooling/branch-landing` and three consumers already call it.
The whole command is thirty lines around it.

The gap is real though, and narrow: `vp run worktrees` asks the landing question only over branches
with a note or a workspace. A retired note takes its branch out of scope, so the branches that
accumulate are precisely the ones nothing looks at.

Prints only. Deleting 283 refs is the owner's call and `retire-note` is the safe way to do one.
