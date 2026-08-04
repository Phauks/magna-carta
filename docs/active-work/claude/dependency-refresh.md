---
branch: claude/dependency-refresh
worktree: C:/dev/magna-carta-worktrees/claude-dependency-refresh
area: Dependency-freshness audit across both supply chains; apply the low-risk subset only
status: review
touches: pnpm-workspace.yaml, pnpm-lock.yaml, osv-scanner.toml, changelog.d/
---

Audits npm and Rust dependency freshness and applies only the low-risk subset. In the
`pnpm-workspace.yaml` catalog: `hono` 4.12.27 → 4.13.0 (crosses the 4.12.34 security release),
`@hono/zod-openapi` 1.5.1, `@tanstack/svelte-query` 6.1.38, `@internationalized/date` 3.12.3,
`@lucide/svelte` 1.28.0, `@cloudflare/speedtest` 1.13.0, the three font packages → 5.3.0, and the dev
tooling `@faker-js/faker`, `@types/node`, both Stoplight CLIs, and `happy-dom`. In `osv-scanner.toml`:
removes the withdrawn `GHSA-gv7w-rqvm-qjhr` ignore and replaces the vague remediation reasons on the
remaining tracked entries with the verified blocker for each.

No majors, and deliberately no `better-auth` / `drizzle` / `vite` / `vitest` / `svelte` / `tailwind`
moves — those are written up as recommendations on the pull request rather than applied.

Two pins are held on purpose and should not be bumped in isolation by a concurrent stream.
`@playwright/test` stays at 1.60.0 because `.github/workflows/gate.yml` finds the browser CLI through a
`playwright@1.60` path glob and exits non-zero when it misses. The Cloudflare trio (`wrangler`,
`@cloudflare/workers-types`, `@cloudflare/vitest-pool-workers`) stays put because the pool pins an exact
(wrangler, miniflare) pair and miniflare is what pulls `undici`/`ws` into the dev graph. Overrides remain
in `pnpm-workspace.yaml` only — never `package.json`, which breaks the vitest alias chain.
