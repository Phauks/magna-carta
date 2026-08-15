---
branch: claude/registry-liveness
worktree: /home/user/magna-carta/.claude/worktrees/registry-liveness
area: the active-work registry — liveness, and the failures it used to hide
status: review
touches: tooling/worktrees, tooling/branch-landing, tooling/clean, docs/active-work, docs/active-work/README.md, CLAUDE.md, vite.config.ts, changelog.d/
---

`vp run worktrees` printed two views of this directory and they disagreed completely: the streams
list was empty while the touch-overlap list named twenty branches, all of them finished. Overlaps
were computed from every note file on disk with no liveness test at all, so a note nobody deleted was
indistinguishable from a stream in flight.

The landing search moves to `tooling/branch-landing`, shared with the build-artifact cleaner, which
already had to answer the same question for the opposite purpose. The registry now filters notes
through it, names the failures it used to swallow (landed notes, unreadable notes, notes whose branch
resolves to no ref), and reports drift as unknown rather than zero when a branch is not checked out
here.
