---
category: Added
audience: internal
---

**Undo, redo and reversal are designed as one contract, and the inventory that forced it is the
finding.** The platform ships **seven** distinct ways to take something back — two independent
client-side undo stacks, soft delete and restore, the discovery journal's exact compensation, void
and unvoid, the ledger's compensating entry, and two shapes of hard delete — and nothing joins them.
The emitted contract carries **thirty-three DELETE operations and five reversal operations of any
kind**. The per-firm schema carries **thirteen `deleted_at` columns and exactly one `deleted_by`**, so
twelve of the platform's thirteen soft-deleting tables cannot answer the first question a deleted view
is asked.

**Three things are called undo and only one of them is.** A surface stack reverses gestures inside a
session; a record's reversibility is a property of an operation, independent of who is looking; and
deletion's lifecycle is a third question that ADR-0049 has settled for files and nowhere else. Every
defect found is a boundary crossing between those three. The file manager's stack covers movement and
stops, its module explaining that a delete is already recoverable through Deleted Files — a Layer-A
stack deferring to Layer B correctly, by hand, and only there. The Time Sheet refuses a step for a
void for the same reason and has to say so in a hand-written sentence naming two other surfaces.

**The proposal is that reversibility becomes route metadata.** `RouteMeta` already carries
`operationId`, `permission`, `audited` and `idempotency`, emitted as `x-mc-*` and gated by conformance
fitness functions; a `reversal` field joins them, as a discriminated union over what the platform can
actually do — `restoration`, `inverse`, `compensating`, `none` — required on every
mutating route, with a `none` obliged to carry the sentence that says why. The count of irreversible
operations becomes a number CI knows. The dialog's recoverability line stops being a string in a
Svelte file and becomes the rendering of the declaration, so "It moves out of the list and stays
recoverable" cannot drift from what delete does.

**Three defects verified in the source, each a consequence of the same conflation.** The Time Sheet
announces "Undid {label}" the instant the stack pops while the write-through is unawaited, so a reader
is told the record went back before it has. The same undo writes back **every** row on the sheet
rather than the ones the step changed, because a snapshot cannot know which fields moved — which also
writes over a row somebody changed elsewhere. And `notes.deleteNote` hard-deletes a note whose own
design rules that there is no hard delete in the product and that retraction is a state.

Also proposed: one `HistoryStack` and one `UndoRedoControls` in the design system, taking the inverse-
command model from `MoveHistory` and the bounding, labels and announcement helper from `SheetHistory`,
so the split control exists once instead of twice; a named deletion vocabulary separating soft delete,
detach, deactivate, tombstoned hard delete and unrecorded hard delete, with soft delete as the default
for anything a member authored; the deleted view as a pattern rather than a screen; and the ruling
with the widest reach — that an acknowledgement dialog is offered **only** where the declaration is
`none`, which is the Nielsen Norman Group posture the product already follows by instinct with one
alert dialog in the entire application.

A generic undo journal was considered and rejected on two independent grounds: it would hold prior
values of privileged content, which `audit_log.metadata` is redacted by construction to exclude, and a
generic backward replay cannot know that unvoiding a cost-converted time entry is forbidden or that a
coding act's undo must be exact to the rows it wrote. Those are domain rules and the subsystems
already express them as routes; the declaration points at those routes rather than replacing them.

No code, no schema, no migration, no route. Eight owner decisions, five build slices, and one
deliberate omission — the implementation plan waits, because slice 1's census changes what the later
slices contain.
