---
worktree: /home/user/magna-carta/.claude/worktrees/check-order
area: the whole-repo check chain's ordering, and the landed-note sweep
status: review
touches: package.json, docs/active-work/claude/, docs/conventions/build-performance.md, changelog.d/
---

`pnpm check` runs its most expensive and most fragile pass first, so a run that dies partway reports
nothing about the cheap high-signal checks behind it. That matters more than usual right now: with the
gate of record billing-blocked, the whole-repo tier is what a merge leans on, and in a container it
has been observed OOM-killed at step one.

Reordered so the two checks that cost seconds and cannot fail spuriously run before the ones that take
minutes. Plus the periodic sweep of stream notes for branches that have landed, which the registry now
lists rather than leaving to be noticed.
