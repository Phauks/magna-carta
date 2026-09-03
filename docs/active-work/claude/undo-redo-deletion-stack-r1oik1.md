---
worktree: /home/user/magna-carta
area: Undo, redo and reversal — consolidating the seven mechanisms the platform already ships into one declared contract
status: designing
touches: docs/specs/, changelog.d/
---

Design only: no code, no schema, no route, no migration. It inventories every reversal mechanism on
`main` — the two independent client-side undo stacks, soft delete and restore, the discovery journal's
exact compensation, void and unvoid, the ledger's compensating entry, and the two shapes of hard
delete — and proposes one contract underneath them: a `reversal` declaration on `RouteMeta`, a single
history stack in the design system, and a named deletion vocabulary.

The stream deliberately touches no implementation, so it collides with nothing in flight. It does
report on code the `magna-carta-timesheet-ui-uekeer` and `magna-carta-file-manager-mdnug5` streams own
(`apps/web/src/lib/time/time-sheet-history.svelte.ts`, `apps/web/src/lib/file-manager/move-history.ts`)
and proposes replacing both with one design-system primitive — a proposal for the owner, not an edit,
and the two streams keep their files.
