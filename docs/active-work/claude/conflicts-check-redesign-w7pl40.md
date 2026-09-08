---
worktree: C:/dev/magna-carta-worktrees/claude/conflicts-check-redesign-w7pl40
area: The Conflicts Check screen — the firm's log as the screen, and the run form moved into a panel
status: review
touches: apps/web/src/lib/conflicts, apps/web/src/routes/(app)/conflicts, apps/web/src/routes/(app)/matters/[id]/conflicts, apps/web/test, docs/conventions/design-corrections.md, docs/user/features/conflicts-reports.md, tooling/lint-conflicts-vocabulary, changelog.d
---

The owner's direction of 2026-09-08: `/conflicts` is a HISTORY screen with New Check at the top
right, and the check itself is composed in a modal. So the screen becomes the List archetype — one
`DataTable.Grid` at the full width over the firm's check log (`check-register.svelte` +
`check-columns.ts`), narrowed from its own column headings — and the composer moves into the
product's one `ActionDialog` (`new-check-dialog.svelte`).

`check-runner.svelte` is renamed `check-form.svelte` and reduced to the FIELDS: it hands back the
composed `RunCheckRequest` (or null with the reason), and the panel owns the commit, the busy state
and the failure band. The matter's own Conflicts section drops its inline copy of the composer and
its header's New Check opens the same panel with the matter already named.

Do not step on `apps/web/src/lib/conflicts/*` or either conflicts route. The only cross-cutting edits
are one appended ruling in `docs/conventions/design-corrections.md` and one scanned-path correction
in `tooling/lint-conflicts-vocabulary/index.mjs` (it named `apps/web/src/routes/conflicts`, which has
never existed — the route is under `(app)/`).
