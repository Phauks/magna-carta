---
worktree: /home/user/magna-carta (remote session)
area: One shell for an act asked of a reader — the modal peer of RecordWindow
status: building
touches: packages/design-system/src/lib/components/action-dialog/, packages/design-system/src/lib/internal/close-guard.svelte.ts, packages/design-system/src/lib/internal/discard-question.svelte, packages/design-system/src/lib/components/record-window/, packages/design-system/src/stories/action-dialog.stories.svelte, packages/design-system/package.json, packages/design-system/vitest.config.ts, tooling/lint-one-ui/, roadmap.d/design-system.md, docs/specs/, docs/decisions/pending/, changelog.d/
---

`ActionDialog`, the modal peer of `RecordWindow`, and the enforcement that keeps a third shell from
appearing. Design in `docs/specs/2026-09-01-consolidated-modal-architecture-design.md`; the shell,
the shared close guard, the six stories and both fitness rules are built.

**A concurrent stream should stay out of `packages/design-system/src/lib/internal/` and
`packages/design-system/src/lib/components/record-window/` while this is open** — the unsaved-work
guard moved out of the record window into an internal both shells consume, and the record window's
own inline copy of the question is gone. `tooling/lint-one-ui/` is also owned here: the registry
gained a `modalShells` block and thirty-seven `hand-composed-modal` allowances, so any branch adding
an allowance will conflict.

**A branch adding a new modal panel should reach for `ActionDialog` rather than composing one.**
`lint:one-ui` now fails a hand-composed panel outside a declared shell's home, and the existing
panels are carried as printed allowances — so new work is bitten immediately while nothing already
written is blocked. `claude/custodian-refinements-19iycw` (three new panels) and
`claude/matter-status-modal-wjzv1v` (one) are the intended first adopters; neither has been touched
from here.

Two pre-existing failures on `main` are NOT this stream's and are left alone:
`data-table-grid.stories.svelte > TrailingPinAndRowDetail` and
`masthead.stories.svelte > CompactDensity`. A third one was — `lint-one-ui`'s own header-set
fixture still supplied four controls after the record kind's menu joined the set, so the rule's
passing case had been failing; it is repaired here because this branch could not otherwise show a
green run of the file it is extending.
