---
branch: claude/fix-directory-merge-integrity
worktree: .claude/worktrees/agent-a9c087c43c699d38c
area: Directory merge integrity — chain flattening, non-destructive absorption, status-aware existence assertion
status: review
touches: packages/directory, apps/worker/src/routes/directory.ts, apps/worker/test/directory-routes.test.ts, changelog.d
---

Closes three merge-subsystem defects in `@magna-carta/directory`: a second merge now flattens the
first (the merge pointer of every entity previously merged into the subordinate is repointed to the
new master, so one-hop resolution never lands on a dead entity); a colliding `matter_party` or
`directory_edge` row is absorbed by moving it to the master and archiving it rather than being hard
deleted; and `assertEntityExists` treats status as part of existence, so a write aimed at a
merged-away entity is refused with a conflict naming the surviving master instead of quietly growing
data on a dead node. Also adds the missing entity guard to `changeName` and a write-time status
predicate on the subordinate-archive update.

No schema change. Touches only the directory package, its tests, the worker's directory route error
mapping and route test, plus a changelog fragment — a concurrent stream in those files should
coordinate; nothing else is shared.
