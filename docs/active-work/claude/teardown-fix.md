---
branch: claude/teardown-fix
worktree: /home/user/magna-carta/.claude/worktrees/teardown-fix
area: worker test-harness teardown race — background work outliving the Miniflare environment
status: review
touches: apps/worker/src/background.ts, apps/worker/src/request-path-sweep.ts, apps/worker/vitest.config.ts, apps/worker/test/, apps/worker/CLAUDE.md, docs/conventions/testing.md
---

Fixing the teardown race where request-path background work (`executionCtx.waitUntil`) is still in
flight when the worker test environment is torn down, so a pending module-resolution RPC rejects as
`EnvironmentTeardownError: [vitest-worker]: Closing rpc while "resolve" was pending`. The race
pre-exists on `main`; the conflicts slice only widens the window. Fix is a drain seam on the
background-work helper plus a harness setup file that awaits it, not suppression.
