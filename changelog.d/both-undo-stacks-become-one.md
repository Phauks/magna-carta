---
category: Changed
audience: internal
---

**Both surfaces that had their own undo now render the design system's, and both old stacks are
gone.** `apps/web/src/lib/file-manager/move-history.ts` and
`apps/web/src/lib/time/time-sheet-history.svelte.ts` are deleted; the file manager's footer and the
Time Sheet's toolbar each render `UndoRedoControls` over a `HistoryStack`, and the four hand-built
split controls become one. What a surface still varies is the register — quiet ghost buttons in a
counts footer, bordered secondary ones in a toolbar of secondary buttons — because that is a fact
about the chrome the pair sits in rather than about undo.

**The file manager's recorded move became the first inverse command.** Each key goes back to where
IT came from, which is exactly what the old `RecordedMove` already held and what a snapshot of the
surface could never have said. A write that refuses now throws, so the stack keeps the step and the
reader gets another attempt at the same move rather than the one beneath it; the refusal goes to the
same band every other refused act on that surface uses. The revision counter the controls needed in
order to re-derive is gone with it: the shared stack's steps are reactive, so there is nothing to
bump and nothing to forget to bump.

**The Time Sheet's snapshot became a pair of field writes, and that is where its two defects were.**
An undo now writes **the row the step changed** — the snapshot could not say which field moved, so
putting one back meant writing every row on the sheet, over rows the step never touched and over
whatever somebody had changed in another window meanwhile. And the announcement now waits for the
write: `runUndo` used to say "Undid {label}" the instant the stack popped while
`#writeBackEverySavedRow` was unawaited, so a reader was told the entry went back before the record
agreed, and heard nothing when it then refused.

**An inverse whose entry has left draft refuses rather than writing.** The void, the submission or
the approval is the newer fact, and putting a value back on an entry somebody voided in between
would be a second act wearing the first one's name. The step stays on the stack and the walk says
which act it stopped at. Two existing tests already pinned the behaviour through the snapshot model;
they now pin the refusal, and assert that the walk reports it.

Two new tests cover what the port is for: that an undo writes the row the step changed and no other
row on the sheet, and that a walk answers only once the write has answered. The design system gains
leaf export paths — `@magna-carta/design-system/history-stack` and `/history-shortcuts` — because a
module with no Svelte in it must not pull the control's component tree in; doing so fails as
`Unknown file extension ".svelte"` deep inside bits-ui, which reads like anything but the import
that caused it.

And the defect the shared control was built with: all four undo and redo dropdowns rendered
`DropdownMenu.GroupHeading` with no `DropdownMenu.Group`, which throws when the caret is pressed. It
went with the markup that carried it.
