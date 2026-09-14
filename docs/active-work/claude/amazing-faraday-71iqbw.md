---
worktree: (none — this stream runs in the primary checkout)
area: Screen data loading — the generated client and one query cache behind every screen read, reads moved into the route load so the hover preload finally buys data, and one wordless "No Results" for every empty list
status: building
touches: apps/web/src/lib/api/, apps/web/package.json, apps/web/src/routes/+layout.svelte, apps/web/src/routes/(app)/+layout.ts, packages/design-system/src/lib/components/data-table/data-table-grid.svelte, packages/design-system/src/lib/components/empty-state/, tooling/lint-screen-data/, package.json, docs/specs/, docs/decisions/pending/, docs/conventions/design-corrections.md, changelog.d/
---

Executes the half of ADR-0066 that was never built: `apps/web` reaches the API through
`@magna-carta/api-client` and one TanStack Query cache instead of 48 hand-written modules
(12,389 lines, 459 types hand-mirroring the contract). The seam is new files under
`apps/web/src/lib/api/`, so the foundation collides with nobody; `requestJson` stays until the last
screen is off it.

Three shared-surface edits are the parts a concurrent stream should know about. **`data-table-grid.svelte`
loses its `empty` snippet prop** — the Grid renders "No Results" for both the empty and the
filtered-empty branch, so the 27 bespoke empty states passed in by 14 surfaces are deleted rather
than rewritten, and no surface can supply prose there again. `claude/custodian-refinements-19iycw`
is in review on that same placeholder cell (its prose-wrapping fix) and should land first; this
stream rebases onto it rather than the other way round. **`(app)/+layout.ts`** stops paying for its
own `/api/v1/me` on every navigation by reading it through the cache. **`design-corrections.md`**
records the owner's 2026-09-14 reversal of "an empty state names the control at the top".

Deliberately NOT migrating screens under `apps/web/src/routes/(app)/settings/`,
`apps/web/src/lib/file-manager/`, or the custodian surfaces while
`claude/settings-implementation-plan-asr0l6`, `claude/upbeat-clarke-6znudl` and
`claude/custodian-refinements-19iycw` are in flight there.
