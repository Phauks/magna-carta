---
worktree: /home/user/magna-carta
area: Undo, redo and reversal — the design, and the one history stack the design system was missing
status: building
touches: packages/design-system/src/lib/components/history, packages/design-system/package.json, packages/design-system/CLAUDE.md, packages/design-system/src/stories, packages/design-system/test, tooling/lint-one-ui/registry.json, docs/specs/, changelog.d/
---

Design only: no code, no schema, no route, no migration. It inventories every reversal mechanism on
`main` — the two independent client-side undo stacks, soft delete and restore, the discovery journal's
exact compensation, void and unvoid, the ledger's compensating entry, and the two shapes of hard
delete — and proposes one contract underneath them: a `reversal` declaration on `RouteMeta`, a single
history stack in the design system, and a named deletion vocabulary.

Then the primitive the design asks for, built in the design system and nowhere else:
`HistoryStack`, `UndoRedoControls` and `historyShortcuts` under
`packages/design-system/src/lib/components/history/`, registered in `lint:one-ui` so a third stack is
a gate failure. Additive — a new directory, one export path, one registry entry, one story, two test
files — so a concurrent stream merges around it.

**It does not port the two surfaces that have their own stacks**
(`apps/web/src/lib/time/time-sheet-history.svelte.ts`,
`apps/web/src/lib/file-manager/move-history.ts`). Those files belong to
`magna-carta-timesheet-ui-uekeer` and `magna-carta-file-manager-mdnug5`, and one owner per file is
what keeps a parallel pass from becoming a serial repair. The ports are theirs to take, and each
picks up a live defect this stream found: all four undo and redo dropdowns on the product render
`DropdownMenu.GroupHeading` with no `DropdownMenu.Group`, which throws when the caret is pressed.
