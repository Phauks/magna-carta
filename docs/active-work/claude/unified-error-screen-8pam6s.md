---
worktree: C:/dev/magna-carta-worktrees/claude/unified-error-screen-8pam6s
area: Unified error surface — one failure screen and one problem model across apps/web
status: building
touches: docs/specs/, apps/web/src/lib/api/, apps/web/src/lib/costs/, apps/web/src/lib/billing/, packages/design-system/
---

Analysing how failures are surfaced across `apps/web` and designing one unified error surface: a
single client-side problem model that keeps every field the API already sends, one design-system
failure component every surface renders, one reporter, and one crash boundary. Design only at this
stage — no code moved yet. A concurrent stream editing failure rendering in `apps/web/src/lib/costs`,
`apps/web/src/lib/billing`, `apps/web/src/lib/api/request.ts`, or adding a new per-surface
`*-error-state.svelte` should say so here first: those are exactly the files this stream consolidates.
