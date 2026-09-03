---
worktree: /home/user/magna-carta
area: Undo, redo and reversal — the design, the one history stack, and both surfaces ported onto it
status: building
touches: packages/design-system/src/lib/components/history, packages/design-system/package.json, packages/design-system/CLAUDE.md, packages/design-system/src/stories, packages/design-system/test, apps/web/src/lib/file-manager, apps/web/src/lib/time, apps/web/test, tooling/lint-one-ui/registry.json, docs/specs/, changelog.d/
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
