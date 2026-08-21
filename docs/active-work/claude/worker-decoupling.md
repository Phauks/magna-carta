---
worktree: C:/dev/magna-carta-worktrees/claude/worker-decoupling
area: Cut the one runtime edge between the API Worker's request half and its background half
status: review
touches: apps/api-worker/src, tooling/lint-background-imports, package.json
---

Moves `authForEnv` and the
per-env logger factory out of the composition root into their own wiring modules, so the queue
consumers and Cron sweeps no longer pull the route tree into their bundle, and adds a check that
keeps it cut. The Worker is not being split; this is about bundle hygiene inside the one Worker.

Branches off `claude/api-worker-rename`, so that must land first.
