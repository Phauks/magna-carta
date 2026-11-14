# The history family — CLAUDE.md

One undo stack, one pair of controls, one set of keys for every surface that can undo. The package-wide rules are in [`../../../../CLAUDE.md`](../../../../CLAUDE.md).

## The history family: one stack, one pair of controls, one set of keys

**`src/lib/components/history/` is the one home of undo and redo.** `HistoryStack` holds the steps,
`UndoRedoControls` is the split-control pair, and `historyShortcuts` is the keyboard handler. All
three are in `lint:one-ui`'s one-implementation registry: a second undo stack anywhere is the defect
the entry exists to prevent, and there were two before this landed
(`apps/web/src/lib/time/time-sheet-history.svelte.ts` and
`apps/web/src/lib/file-manager/move-history.ts`); both are gone, and both surfaces now render this
control over this stack. Design: [`docs/specs/2026-09-03-undo-redo-and-reversal-design.md`](../../../../../../docs/specs/2026-09-03-undo-redo-and-reversal-design.md).

- **A step is a command with an inverse, never a snapshot.** A snapshot restores a screen; an
  inverse restores the record. The snapshot model is why the Time Sheet writes back every row on
  every undo — it cannot know which fields moved — and why a snapshot taken before a re-read is
  unsafe. `HistoryStep` is `{ label, undo, redo }` and the surface decides what those do.
- **A step is pushed only where its inverse is real.** What is refused is refused out loud:
  `irreversibleAnnouncement` is the sentence, and it names where the repair lives, because "undo
  does not reach this" is only half an answer when the other half exists.
- **The outcome follows the inverse, never the pop.** `undo`/`redo` answer once the writes have
  answered; a failure leaves the step on the stack, still offered, with the failing label named. The
  control hands the outcome back through `onOutcome` and says nothing itself — the live region
  belongs to the surface, and a control that spoke would be a second voice on the same strip.
- **A walk in flight refuses the next one** rather than interleaving two sequences of inverses, so
  both halves disable while one runs. Only `push` grows the stack (bounded at `STEPS_KEPT`); a walk
  moves a step between the two sides, which is why neither side trims and walking back and forth
  cannot drop the far end.
- **`historyShortcuts` is a handler, not a window listener** — the surface attaches it to its own
  element, so two surfaces with stacks cannot receive each other's keys. It REACHES INSIDE TEXT
  FIELDS by default, which is what both existing surfaces do and is right on a rapid-entry grid: a
  reader who has typed into six cells and presses Ctrl+Z means the sheet, not the caret.
  `insideTextFields: "yield"` is the seam for a surface that is one long text field.
- **The one thing a surface varies is the register** — `variant: "ghost" | "secondary"` — because
  that is a fact about the chrome the pair sits in (a quiet counts footer, a toolbar of secondary
  buttons), not about undo. Closed set, no `class` prop to reach past it, and the bordered register
  also drops the caret's leading edge so the seam is not a double rule.
- **A module with no Svelte in it imports from the leaf paths**, `@magna-carta/design-system/history-stack`
  and `/history-shortcuts`, never the `./history` barrel: the barrel carries the CONTROL, and a
  plain module that pulls its component tree in stops loading anywhere a Svelte transform is not in
  play (it fails as `Unknown file extension ".svelte"` deep inside bits-ui, which reads like
  anything but the import that caused it). `.svelte` consumers take the barrel.
- **`DropdownMenu.GroupHeading` must sit inside a `DropdownMenu.Group`.** Without it bits throws
  `Context "Menu.Group | Menu.RadioGroup" not found` when the menu OPENS — not on render — so it is
  invisible until somebody presses the caret. Both hand-built copies of this control shipped without
  the group; this one has it, and the story that opens the menu is what pins it.
