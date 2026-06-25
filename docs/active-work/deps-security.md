---
branch: deps-security
worktree: C:/dev/magna-carta-worktrees/deps-security
area: Dependabot security remediation (catalog dependency bumps)
status: review
touches: pnpm-workspace.yaml, pnpm-lock.yaml, changelog.d/
---

Remediates open Dependabot alerts. Scope is deliberately narrow: only `hono` 4.12.23 → 4.12.27,
which is the sole advisory with a production-runtime exploit path (it is the live API framework).
Verified regression-free — typecheck and the worker test suite match the pre-change main baseline
(11 pre-existing pdf/crates type errors, 32 pre-existing test failures; neither changed).

Intentionally NOT bumped here: the remaining alerts are all transitive under dev/build tooling
(undici, ws via miniflare/wrangler; lodash, uuid via prism-cli; js-yaml via hey-api; esbuild via
tsx and drizzle-kit) with no production-runtime path — the Workers runtime uses workerd's own
fetch, not undici. Clearing undici/ws requires bumping wrangler + @cloudflare/vitest-pool-workers
in lockstep, which transitively forces an app-wide @cloudflare/workers-types bump that breaks types
(workers-types 4.20260625.1 makes `tracing` required on `ExecutionContext`, clashing with hono's
`c.executionCtx`). That is a deliberate toolchain upgrade in its own right — track it separately
(a good place to also fix the workers-types `tracing` call sites and prep for drizzle-kit 1.0).
