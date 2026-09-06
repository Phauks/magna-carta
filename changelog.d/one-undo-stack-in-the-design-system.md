---
category: Added
audience: internal
---

**The design system gains the undo and redo the product had twice and had never agreed on.**
`HistoryStack`, `UndoRedoControls` and `historyShortcuts` live at
`packages/design-system/src/lib/components/history/`, and all three are in `lint:one-ui`'s
one-implementation registry — so the third undo stack is now a gate failure rather than something
somebody notices a year later. There were two before this: the Time Sheet's snapshot stack and the
file manager's inverse-command stack, built weeks apart, bounded differently, labelled differently,
each carrying its own copy of the split-control markup.

**A step is a command with an inverse, never a snapshot.** A snapshot restores a screen; an inverse
restores the record, which is what a reader means by undo. The difference is not academic — a
snapshot cannot know which fields moved, which is why the Time Sheet's undo writes back **every** row
on the sheet rather than the ones the step changed, over rows the step never touched and over
whatever somebody changed in another window meanwhile.

**The outcome follows the inverse, never the pop.** `undo` answers once the writes have answered, and
a failure leaves the step where it was: on the stack, still offered, with the failing act named. The
Time Sheet announces "Undid {label}" the instant the stack pops while its write-through is unawaited,
so a reader is told the record went back before it has; the shared contract cannot do that. The
control hands the outcome back through `onOutcome` and says nothing itself, because the live region
belongs to the surface and a control that spoke would be a second voice on the same strip.

**And the sentence for what undo cannot reach.** `irreversibleAnnouncement` states both halves — that
undo does not reach this act, and where the repair that does reach it lives — because a surface that
offers a step and then announces a reversal that never ran is the worse failure, and "undo does not
reach this" is only half an answer when the other half exists.

**Building it found a live defect in what shipped: all four undo and redo dropdowns on the product
throw when they are opened.** Each renders `DropdownMenu.GroupHeading` with no `DropdownMenu.Group`
above it, and bits answers `Context "Menu.Group | Menu.RadioGroup" not found`. The throw happens on
the press rather than on render, so nothing showed it — two surfaces, built weeks apart, copied the
same markup. The shared control has the group, and the story that opens the menu is what pins it.

Also settled here: a walk in flight refuses the next one rather than interleaving two sequences of
inverses; only `push` grows the stack, so walking back and forth cannot drop the step at the far end;
and the keys are a handler the surface attaches to its own element rather than a window listener, so
two surfaces with stacks cannot receive each other's presses. They reach inside text fields by
default — on a rapid-entry grid the cell is not the surface — with yielding as the seam for a surface
that is one long field, which corrects the design document's stricter first claim.

Thirty-two unit tests and four story tests, the latter running as browser behaviour tests with their
own axe pass. The two ports are deliberately not in this change: those files belong to the streams
that own them, and each port picks up the missing group for free.
