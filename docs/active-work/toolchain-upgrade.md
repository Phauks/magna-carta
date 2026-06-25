---
branch: toolchain-upgrade
worktree: C:/dev/magna-carta-worktrees/toolchain-upgrade
area: Cloudflare dev/test toolchain bump (wrangler + vitest-pool-workers + workers-types)
status: review
touches: pnpm-workspace.yaml, pnpm-lock.yaml, apps/worker/src/request-path-sweep.ts, changelog.d/
---

Bumps wrangler 4.98.0 → 4.105.0, @cloudflare/vitest-pool-workers 0.16.13 → 0.16.20, and
@cloudflare/workers-types 4.20260604.1 → 4.20260625.1 together (the pool hard-pins an exact
wrangler/miniflare pair). Clears the transitive undici and ws Dependabot advisories carried by
miniflare. Sibling to `deps-security` (hono); the two are independent and both target main.

The newer workers-types makes `tracing` required on `ExecutionContext`, which broke
`scheduleRequestPathSweep(c.executionCtx, …)` — fixed by narrowing the parameter to
`Pick<ExecutionContext, "waitUntil">` (the only method it uses). Verified regression-free against
the pre-change main baseline: typecheck = 11 pre-existing pdf/crates errors (unchanged), worker
tests = 32 failed / 663 passed (unchanged).

Touches only `pnpm-workspace.yaml` (catalog) and one worker source file. Does NOT touch drizzle —
1.0 is still RC; staying on the stable line is deliberate (see the drizzle-1.0 readiness note).
Remaining Dependabot alerts after this + `deps-security` merge (lodash, uuid, js-yaml, esbuild,
cookie) are all dev/build-tooling transitives with no production-runtime path.
