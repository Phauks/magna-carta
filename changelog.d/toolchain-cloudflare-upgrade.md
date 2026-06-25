---
category: Changed
---

**Upgraded the Cloudflare dev/test toolchain in lockstep:** `wrangler` 4.98.0 → 4.105.0, `@cloudflare/vitest-pool-workers` 0.16.13 → 0.16.20, and `@cloudflare/workers-types` 4.20260604.1 → 4.20260625.1 (catalog). The pool package hard-pins an exact `wrangler`/`miniflare` pair, so the three move together; the refreshed `miniflare` clears the transitive `undici` (now 7.28.0) and `ws` (8.21.0) advisories in the dev/test graph. `scheduleRequestPathSweep` now takes `Pick<ExecutionContext, "waitUntil">` instead of the full `ExecutionContext`, since the newer `workers-types` makes runtime-only fields such as `tracing` required — depending only on the one method used keeps the helper stable as the Workers type surface grows. (`pnpm-workspace.yaml`, `apps/worker`)
