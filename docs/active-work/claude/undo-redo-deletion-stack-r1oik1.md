---
worktree: /home/user/magna-carta
area: Undo, redo and reversal — the design, the history stack, the table's controls, and reversibility as route metadata
status: building
touches: apps/api-worker/src/contracts, apps/api-worker/src/routes, apps/api-worker/openapi/openapi.json, packages/api-client, docs/conventions/api.md, packages/design-system/src/lib/components/history, packages/design-system/package.json, packages/design-system/CLAUDE.md, packages/design-system/src/stories, packages/design-system/test, apps/web/src/lib/file-manager, apps/web/src/lib/time, apps/web/test, tooling/lint-one-ui/registry.json, docs/specs/, changelog.d/
---

First the design, which touches no schema, no route and no migration. It inventories every reversal
mechanism on `main` — the two independent client-side undo stacks, soft delete and restore, the discovery journal's
exact compensation, void and unvoid, the ledger's compensating entry, and the two shapes of hard
delete — and proposes one contract underneath them: a `reversal` declaration on `RouteMeta`, a single
history stack in the design system, and a named deletion vocabulary.

Then the primitive the design asks for, built in the design system and nowhere else:
`HistoryStack`, `UndoRedoControls` and `historyShortcuts` under
`packages/design-system/src/lib/components/history/`, registered in `lint:one-ui` so a third stack is
a gate failure. Additive in the design system — a new directory, three export paths, two registry
entries, one story, two test files.

**Both surfaces are ported and both old stacks are deleted** — `move-history.ts` and
`time-sheet-history.svelte.ts`, with its test. That reaches into files
`magna-carta-timesheet-ui-uekeer` and `magna-carta-file-manager-mdnug5` also touch
(`apps/web/src/lib/time`, `apps/web/src/lib/file-manager`), so those two streams should sync `main`
before continuing on the Time Sheet toolbar or the file-manager footer. The port also fixes a live
defect this stream found: all four undo and redo dropdowns rendered `DropdownMenu.GroupHeading` with
no `DropdownMenu.Group`, which throws when the caret is pressed.

**Then the rest of the table's own controls**, on the owner's 2026-09-03 placement: the clear
control into the control row above the table (`DataTable.ClearFilters`, seven hand-built copies in
three shapes), the labelled figures into the counts strip (`DataTable.GridFigures`, five copies, one
already in the opposite reading order), the way to the rest of a paged list beside the count that
says there is more (`DataTable.LoadMore`, three copies in two places), and the undo pair into the
footer on every surface. Ten screens across billing, costs, time, matters, directory and custodian
change, so a concurrent stream on any of those should sync `main`. Rulings recorded as L42b/A15c,
TB2c/TS9/TS10, and one line in `design-corrections.md`.

**And reversibility becomes route metadata.** `RouteMeta` carries `reversal`, emitted as
`x-mc-reversal`; `defineOpenAPIRoute` refuses a DELETE that declares nothing, and a conformance
fitness function checks that a named reversing operation exists and mutates. All thirty-three DELETE
operations are declared, which touches nineteen route modules with a one-line spread each and
re-emits the OpenAPI snapshot — so a concurrent stream adding a DELETE route will need the field, and
one editing `apps/api-worker/openapi/openapi.json` should re-emit rather than merge it. The census it
produced is section 8a of the design.
