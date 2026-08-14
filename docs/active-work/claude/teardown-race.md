---
branch: claude/teardown-race
worktree: .claude/worktrees/teardown-race
area: test-harness teardown race — background work outliving the worker test that started it
status: building
touches: apps/worker/src/background.ts, apps/worker/src/request-path-sweep.ts, apps/worker/test/support/, apps/worker/vitest.config.ts, apps/worker/CLAUDE.md, changelog.d/
---

Fixes the intermittent `EnvironmentTeardownError: [vitest-worker]: Closing rpc while "resolve" was
pending` that the whole-repo suite logs on `main` and that fails the run outright once a branch adds
another write point to the per-firm outbox bus. The cause is lifecycle, not the branch: a route that
schedules its best-effort outbox sweep through `executionCtx.waitUntil` keeps running after the
`SELF.fetch` that started it has returned, so the work is still in flight when the harness tears the
environment down.

Scope is the worker's background-work seam and the worker suite's teardown only — no route, consumer,
or sweep behaviour changes. Nothing outside `apps/worker` is touched.
