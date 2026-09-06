# Undo, redo, and reversal — one contract for tables, data entry, and deletion

**Status:** Proposed (design) · **Date:** 2026-09-03 · **Owner:** Trevor Goldsmith
**White paper:** _Delivery model and application architecture_ (the one application shell every surface renders into), _Documents and automation_ (the deleted-file lifecycle: trash, Infrequent Access, policy-driven destruction), _Financial Core_ (the append-only ledger, whose reversal is a new entry and never an edit), and _Database backup and disaster recovery_, whose two-layer framing — "a single mechanism cannot cover both undo a mistake and survive a disaster" — is the line this design sits entirely above.
**Decisions this builds on:** ADR-0008 (append-only ledger and audit), ADR-0049 (deleted-file lifecycle), ADR-0067 (route metadata and the one chokepoint), ADR-0077 (versions immutable, soft-delete only), ADR-0080 (closed is archived-but-additive), ADR-0084 (protected fields).
**Rulings that bind:** [`docs/conventions/file-manager-rulings.md`](../conventions/file-manager-rulings.md) — A12 (delete is a soft delete and the dialog promises recoverability), A15 and A15b (undo and redo stacks for movement, living in the footer, saying what they will undo), T7 (a tree move is undoable like any other), D1b/D1c and D2b (the Deleted Files view and the restore that asks), N22 (a deletion is a History row forever); [`docs/conventions/time-tab-rulings.md`](../conventions/time-tab-rulings.md) — L4b (a misfiled entry moves rather than being re-typed), L5f (a void can be undone), L5h (the one void that must stay one), and the recorded judgement that the Time Sheet's stack pushes no step for a void or a move.
**Raised by:** the owner's brief of 2026-09-03 — a comprehensive and modular undo and redo stack tied to the tables and to data entry, specifically for deletion, consolidating the methods the platform already has.

**Not in scope:** collaborative or multi-user undo (a stack is one person's, in one session, on one surface); offline undo; document-content editing, whose undo belongs to the editor that owns the bytes; the destruction policy engine and its jurisdictional research, which [`2026-08-25-deleted-files-retention-design.md`](2026-08-25-deleted-files-retention-design.md) already scopes as separate work; and platform-level recovery (D1 Time Travel and the export snapshots), which is the layer beneath this one and is never a substitute for anything in it.

---

## 1. What exists today — seven mechanisms, and no vocabulary joining them

Everything below is on `main` at the time of writing. This is the consolidation the brief asks for, and the inventory is the argument.

| #   | Mechanism                  | Where it lives                                                                                                                                                                 | What it reverses                                                     | Shape                                                                                                                              |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Client-side snapshot stack | `apps/web/src/lib/time/time-sheet-history.svelte.ts` (`SheetHistory<TSnapshot>`)                                                                                               | Field edits on the Time Sheet's rows                                 | Bounded at 40 steps; take a snapshot before a change, restore it on undo, then write every saved row back through the update route |
| 2   | Client-side command stack  | `apps/web/src/lib/file-manager/move-history.ts` (`MoveHistory`)                                                                                                                | Movement only — drag-and-drop, cut-and-paste, a move between folders | Unbounded; records what moved, from where, to where, and replays the inverse through the move route                                |
| 3   | Soft delete and restore    | `file.deleted_at` with `files.restore`; the same `deleted_at` column on twelve further per-firm tables                                                                         | A deletion                                                           | A flag cleared in place; the bytes and the version history were never touched                                                      |
| 4   | Journal compensation       | `packages/discovery/src/coding-service.ts` over `review_tag_event`                                                                                                             | A coding act, exactly to the rows that act wrote                     | An `undo` event pointing at what it reverses, at most one per event, the reversed event left in the journal in state `undone`      |
| 5   | Status reversal            | `timeEntries.unvoid`, `matters.reopen`, `tasks.reopenTask`; the void side on invoices, recoveries and costs                                                                    | A state transition                                                   | A second transition on its own route, with its own permission and its own audit row                                                |
| 6   | Compensating entry         | `packages/ledger/src/reverse-entry.ts`                                                                                                                                         | A posted ledger entry                                                | The exact mirror, directions flipped, linked by `reverses_entry_id`; the original is never touched (ADR-0008)                      |
| 7   | Hard delete                | `tasks.deleteTask` (leaving a `matter_task_deletion` tombstone carrying identifiers and nothing else); `notes.deleteNote` and `customFields.hardDeleteField` (leaving nothing) | Nothing — the row is gone                                            | A `DELETE FROM`                                                                                                                    |

Two more things look like undo and are not, and the design keeps them out deliberately. The **record window's abandon guard** (`packages/design-system/src/lib/components/record-window/record-window.svelte`) is uncommitted work being discarded — nothing has reached the record, so there is nothing to reverse. The **settings draft** (`apps/web/src/lib/settings/settings-draft.svelte.ts`) stages edits and commits them as a batch into an append-only change ledger, where restoring an old value is recorded as a new entry — mechanism 6's discipline, applied to preferences.

**The counts are the finding.** The emitted contract carries **thirty-three DELETE operations and five reversal operations of any kind** (`matters.reopen`, `files.restore`, `tasks.reopenTask`, `discovery.undoCodingAct`, `timeEntries.unvoid`). The web application has **two independent undo stacks**, neither in the design system, bounded differently (forty steps against unbounded), reversing differently (snapshot against inverse command), labelled differently, and each carrying its own copy of the split-control markup — the button that takes one step with a caret fused to its side that opens the stack — in `apps/web/src/lib/file-manager/file-manager-footer.svelte` and `apps/web/src/lib/time/time-sheet.svelte`. The per-firm schema has **thirteen `deleted_at` columns and exactly one `deleted_by`** (`matter_task_deletion`), so twelve of the platform's thirteen soft-deleting tables cannot answer the first question a deleted view is asked. And the application uses **one toast call in total and no alert dialog at all**: announcements go to a live region in the footer strip, which is already where the file manager's undo lives.

**Four defects, each verified in the source. The first three follow directly from the inventory; the fourth was found by building the shared control the inventory asks for.**

- **The Time Sheet announces a reversal it has not yet performed.** `runUndo` in `time-sheet.svelte` announces "Undid {label}" the instant the stack pops, while the restore callback fires `void this.#writeBackEverySavedRow()` — unawaited. A write that fails afterwards marks its own row, but the reader has already been told the record went back.
- **The same undo writes back every row on the sheet**, not the rows the step changed, because a snapshot has no idea which fields moved. A one-cell undo issues an update for every workable row, and a row somebody changed in another window is written back over.
- **`notes.deleteNote` hard-deletes a note** whose own design ([`2026-08-15-notes-and-activity-design.md`](2026-08-15-notes-and-activity-design.md), Proposed) rules that there is no hard delete in the product, that retraction is a state, and that a correction is a new revision. The route's description says the note "cannot be recovered." The design is unbuilt and the route shipped ahead of it; the contradiction is live either way.
- **All four undo and redo dropdowns on the product throw when they are opened.** Found while building the shared control (section 8, slice 2): each renders `DropdownMenu.GroupHeading` with no `DropdownMenu.Group` above it, which bits answers with `Context "Menu.Group | Menu.RadioGroup" not found`. The throw happens on the press rather than on render, so nothing shows it until somebody uses the caret — and the two surfaces were built weeks apart, each copying the same markup. The shared control has the group and a story that opens the menu; the two hand-built copies are the port slice's to fix.

The first three are not bugs in the code that carries them — each is what happens when the same word is asked to name three different things, and each was written correctly against the wrong contract. The fourth is a plain defect, and it is the one that argues hardest for a shared control: the markup was copied rather than shared, so one mistake shipped twice and neither copy had a test that opened the menu.

---

## 2. The finding — three layers, one word

**Layer A, the surface stack.** Reversal of _gestures_, inside one session, on one screen, addressed by Ctrl+Z. It is about the pointer and the keyboard, not about the record: what it protects against is the act performed by accident.

**Layer B, the record's reversibility.** A property of an _operation_, not of a screen. Whether a deletion can be undone does not depend on who is looking, how long ago it happened, or whether the browser was closed in between. Restore, unvoid, reopen and the ledger's mirror all live here.

**Layer C, deletion's own lifecycle.** How long a deleted thing stays recoverable, what "deleted" even means for the kind of record in question, and who — if anybody — may destroy it. ADR-0049 and the deleted-files retention design have settled this for files and nowhere else.

Every current defect is a boundary crossing. A15 gave the file manager an undo stack and confined it to movement, and the module says why: "A delete is already recoverable through Deleted Files" — a Layer-A stack declining to offer a step because Layer B has a better answer, correctly, but by hand and only there. The Time Sheet refuses a step for a void for the identical reason and has to say so in a hand-written sentence at the moment of the act, naming two other surfaces where the repair lives. A12's delete dialog promises a file "stays recoverable"; a dozen other delete dialogs make their own promises in their own words, and nothing checks whether any of them is true.

**The structural idea this design proposes is one sentence: Layer B is declared once, per operation, in the place the platform already declares per-operation facts, and Layers A and C read it rather than restating it.**

That place exists and is enforced. Every route declares `RouteMeta` — `operationId`, `surface`, `authenticated`, `permission`, `resource`, `audited`, `idempotency`, `rateLimit` — emitted as `x-mc-*` extensions, carried into the generated client, and gated by conformance fitness functions in CI (ADR-0067). A route that forgets a field does not ship. Reversibility is exactly that kind of fact: universal over mutating routes, invisible from any single call site, and currently answered by prose in thirty-three places.

---

## 3. Layer B — the reversal declaration

### The field

`RouteMeta` gains `reversal`, required on every mutating method (`POST`, `PUT`, `PATCH`, `DELETE` — the set `isMutatingMethod` already names). It is a discriminated union, and the discriminant is what the platform can actually do:

| Kind           | Meaning                                                                                                                                        | Examples on `main` today                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inverse`      | A counterpart operation undoes this one's effect on the same subject. It names that operation — and a route that reverses itself names itself. | `files.delete` → `files.restore`; `notes.detachNoteDocument` → `notes.attachNoteDocument`; `customFields.clearValue` → `customFields.setValue`; every `revoke`/`grant` pair |
| `compensating` | The act stands and a new record cancels it. The original is never touched.                                                                     | `ledger.reverseEntry`; billing's credit note; a retraction, when notes gain one                                                                                             |
| `none`         | Nothing in the product puts this back, and the declaration carries the sentence that says so.                                                  | `directory.merge`; a firm's crypto-shred; destruction under a retention schedule; `notes.deleteNote` as it stands today                                                     |

Two properties make this worth building rather than documenting.

**It is checkable.** A conformance fitness function beside the existing ones asserts that every mutating route declares `reversal`; that an `inverse` or `compensating` names an `operationId` present in the same document and itself mutating; and — the rule with teeth — that **a `none` declaration carries a non-empty `reason`**. The count of irreversible operations in the platform becomes a number CI knows, and adding to it becomes a deliberate act with a sentence attached.

**It is one home for the user-facing sentence.** The `reason` on a `none`, and the counterpart named by an `inverse`, are what a dialog renders. This is the I34 pattern the deleted-files design already uses for the retention statement: one text, two surfaces, structurally unable to disagree. The file manager's "It moves out of the list and stays recoverable" stops being a string in a Svelte file and becomes the rendering of `files.delete`'s declaration — and the day `files.delete` gains a destruction schedule, every surface that speaks about deleting a file changes with it.

**Where it is emitted.** `x-mc-reversal`, alongside the other route metadata, so the generated client carries it and the web application reads it. `idempotencyStore` and `firmlessSession` are deliberately not emitted because they route a request inside the Worker; this one describes the wire and belongs in the document.

### What it does not do

It does not _perform_ the reversal. It says what the reversal is and where it lives; the caller still calls it, with its own permission check, its own idempotency key, and its own audit row. Undo is a change the firm made, and the record says so — the rule `time-sheet-history.svelte.ts` already states ("UNDO DOES NOT REWIND THE RECORD'S HISTORY") is promoted here from a comment in one module to the contract's own rule.

It also does not make an operation reversible. A route whose subsystem has built no restore path declares `none` with the honest reason, and the count goes up. That is the point: the declaration makes the gap visible instead of leaving it to be discovered one dialog at a time.

---

## 4. Layer A — one history stack, in the design system

### One primitive, taking the better half of each existing implementation

`@magna-carta/design-system` gains a `HistoryStack` and an `UndoRedoControls` component. The two live implementations are each right about a different thing, and the merge is not a compromise:

- **From `MoveHistory`: the step is a command with an inverse, not a snapshot.** A snapshot restores a screen; an inverse command restores a record. The snapshot model is what forces the Time Sheet to write every row back on every undo, and it is why a snapshot taken before a re-read is unsafe (the module already clears the stack on re-read for exactly this reason). A step is `{ label, undo(): Promise<Outcome>, redo(): Promise<Outcome> }`, and the surface that pushes it decides what those do.
- **From `SheetHistory`: bounded, labelled, listable, and announced.** Forty steps, `undoLabels` and `redoLabels` newest-first for the split control's dropdown, the `historyAnnouncement` helper, and the "walk back N steps" call the dropdown needs. `MoveHistory` is unbounded, which is a leak on a surface somebody leaves open all day.

### The rules the shared primitive imposes

1. **A step exists only where its inverse is real.** Before pushing, the surface consults the declaration for the operation it just performed. `inverse` is steppable. `compensating` and `none` are not — and the refusal is not silence. The Time Sheet's existing behaviour is the model, generalized: the act happens, no step is pushed, and the announcement says both halves — that undo does not reach this, and where the repair that does reach it lives. The second half comes from the declaration, so a surface can no longer promise a repair that does not exist or omit one that does.
2. **The announcement follows the inverse's outcome, never the stack pop.** This fixes the verified defect in section 1. `undo()` returns when the write has answered; a failure leaves the step on the stack, restores the control to enabled, and announces the failure through the standard error surface with its Error ID. A stack that lies once is worse than no stack.
3. **Undo is audited as its own act.** No route gains a "silent" mode. History never shortens — the discovery journal's rule, which is the strongest reversal the platform has built and the one this design takes its posture from.
4. **The stack clears on any re-read that could change what a key means**, which both implementations already do, and on a surface unmount.
5. **The stack is one person's, in one session.** An inverse that would reverse somebody else's change refuses rather than winning: discovery's undo is exact to the rows one act wrote, and a later independent act keeps its own attribution. Generalized, an inverse re-reads before it writes and refuses on a changed subject with a sentence naming what moved.
6. **The controls live in the footer** (A15b), as a split control that says what it will undo (A15, and `MoveHistory`'s `undoTitle` — "Never a bare Undo: it says what it will undo"), with the announcement in the same strip. `UndoRedoControls` takes a `HistoryStack` and renders both halves; the two hand-built copies are deleted.
7. **Ctrl+Z, Ctrl+Y and Shift+Ctrl+Z**, in one handler the surface attaches to its own element rather than a window listener — two surfaces with stacks must not receive each other's keys. **Correction to this design as first written:** it said the keys should not fire while a text input has focus. Both shipped surfaces reach inside their fields, and they are right to: on a rapid-entry grid the cell is not the surface, and a reader who has typed into six cells and presses Ctrl+Z means the sheet. Reaching is the default; yielding to the platform's own field-level undo is the seam a surface that is one long text field opts into.

### What this gives the tables

`DataTable.Grid` has twelve consumers and one selection model. The primitive plugs in at the footer, which `DataTable.GridFooter` already owns and already treats as the place where a reversal of what the reader just did belongs — its own comment about "Select none" says so: "it undoes something the reader just did, and a selection with no way out is a trap." A grid that performs a steppable act gets undo by passing a stack; a grid that does not, does not, and no grid grows its own.

---

## 5. Layer C — the deletion vocabulary

Thirty-three DELETE operations are doing five different jobs. Naming them is most of the work.

| Kind                             | What it is                                                                         | Recommended default                                                                                      | On `main`                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Soft delete**                  | The record stops being listed and is recoverable in place                          | The default for anything a person authored or a matter's record depends on                               | Thirteen tables carry `deleted_at`; only `file` has a restore route                            |
| **Detach / unlink / revoke**     | A statement about a _relationship_, never about a record                           | Always reversible by the corresponding attach, and never worded as destruction                           | Most of the thirty-three; `tasks.unlinkExternalTask`'s description already states it perfectly |
| **Deactivate**                   | The row stops being offered and stays for provenance                               | The default for firm-defined vocabulary (item types, custom fields, matter plan templates, matter types) | `custody.deactivateItemType`; the discipline `matter_type` and `firm_resource` already use     |
| **Hard delete with a tombstone** | The row goes; a record that it went remains, carrying identifiers and nothing else | Required wherever anything mirrors or subscribes to the record                                           | `matter_task_deletion`, whose comment explains why better than this table can                  |
| **Hard delete with nothing**     | The row goes and nothing records that it did                                       | Requires a named reason in a design, and is the only kind that may say "cannot be recovered"             | `notes.deleteNote`, `customFields.hardDeleteField`, `customFields.hardDeleteOption`            |

**Recommendation: soft delete is the default, and the exceptions are enumerated rather than assumed.** A record a member authored — a note, a task, a time entry, an asset, a directory row — is a record of the firm's work, and the platform's whole posture (versions immutable, the ledger append-only, notes corrected by revision, conflict copies retained forever, the custody register refusing a retention window outright) says records do not quietly vanish. The deleted-files design reached this for files by reasoning from the entire-file doctrine and ABA Formal Opinion 471; the reasoning does not stop at files.

**Recommendation: the deleted view is a pattern, not a screen.** `files.listDeleted` is the first of a family and should be the shape of the rest: the subject's own table filtered to `deleted_at IS NOT NULL`, with Deleted, Deleted By and Was In columns (D1b), Restore in the right-click (D1c), a restore that asks where when the original place is gone (D2b), no permanent-delete affordance anywhere in the view, and no countdown, because there is nothing to count down to. What it needs from the schema is what only one table has today.

**Schema consequence, and it is small.** A soft-deleting table needs three things, not one: `deleted_at`, `deleted_by` (`text`, `UserId`, deliberately not a foreign key — the deletion fact outlives the member row, the `uploaded_by` and `matter_task_deletion.deleted_by` precedent), and, where a restore needs somewhere to land, the as-of-deletion context the deleted-files design calls `deleted_from_path`. Twelve tables carry the first column and none of the others; the columns are additive, backfill null, and a view renders an honest blank for a deletion recorded before the column existed.

**Recommendation: no firm-wide recycle bin.** The deleted-files design recommends against a cross-matter deleted browser and is right, for a reason that generalizes: the oversight question an administrator actually has is an audit question, `audit_log` answers it, and a second surface over the same facts drifts from the first. A deleted set belongs to the subject that owns it.

---

## 6. What is never undoable, and how the platform says it

The `none` declarations, gathered so they can be counted and argued with in one place rather than discovered one dialog at a time:

- **A ledger or audit row.** Not `none` but `compensating` — the mirror exists and the original stands (ADR-0008). The distinction matters to the reader: "this cannot be undone" and "this is corrected by a new entry that everyone can see" are different sentences and only one of them is true here.
- **A directory merge.** `merge-plan.ts` already carries the sentence and the reasoning: undoing a merge is only well defined while nothing has been recorded against the joined record, and the product does not offer it.
- **A firm's crypto-shred** (ADR-0084), which is permanent unreadability by construction.
- **Destruction under a retention schedule**, when it ships — audited like any irreversible act, blocked by the named blocker registry the deleted-files design makes a shipping precondition.
- **A void that converted a time entry into a cost** (L5h) — the one void that must stay one, because restoring the time would undo the half of the act that was protecting the client. This is the case that proves the declaration cannot be per-route alone: the same route is reversible or not depending on the entry. The declaration carries the general answer and the route refuses the specific case with its own reason, which is exactly how the trust subsystem's jurisdiction rule already behaves — refuse rather than fall back.
- **Anything that has left the building**: a production, a filed document, a sent message, a completed export.

**And the payoff, which is the reason to gather them.** Nielsen Norman Group's position on destructive actions is that a confirmation dialog is the weaker tool and undo is the better one, with friction reserved for what is genuinely irreversible ([Confirmation Dialogs Can Prevent User Errors](https://www.nngroup.com/articles/confirmation-dialog/); [Preventing User Errors: Avoiding Conscious Mistakes](https://www.nngroup.com/articles/user-mistakes/)). This platform is already most of the way there by instinct — one alert dialog in the entire application, and a delete dialog whose whole job is to say the file stays recoverable. The declaration turns instinct into a rule that can be enforced: **an acknowledgement dialog is offered only where the declaration is `none`.** Both sides of that become countable, and a dialog that appears anywhere else is a defect a fitness function can name.

---

## 7. Interplay

- **The record window** keeps its abandon guard unchanged. Nothing has reached the record, so nothing needs reversing; the guard asks, and a record kind that knows it has nothing to lose says so with `unsavedChanges`. Undo begins after the commit, not before it.
- **The Time Sheet** keeps every behaviour the time-tab rulings settled and gains two: the announcement waits for the write, and the write covers the rows the step touched. Its refusal to step a void is unchanged in substance and is now read from the declaration rather than hand-written — which also means the day L5f's unvoid becomes reachable from the sheet, one declaration changes and the sentence changes with it.
- **The file manager** keeps A15's movement stack and can extend it to deletion for the first time, because `files.delete` now names `files.restore` and that route exists. Whether it _should_ is an owner decision (section 9): a stepped delete-undo and the Deleted Files view are two ways to reach the same act, and the file manager's own module comment argues today that the view is enough.
- **Discovery** changes not at all. Its journal is the strongest reversal on the platform and this design borrows from it rather than reaching into it; `discovery.undoCodingAct` declares an `inverse` naming itself, and the review surface keeps its own controls.
- **The search index** has the same seam deletion has: the deleted-files design's `file.deleted` and `file.restored` outbox messages, and S19's tag-and-filter posture (a deleted document stays in the index carrying a deleted facet, excluded by default at query time). A restore that did not re-enqueue indexing would restore a file nobody could find, so the `inverse` declaration on `files.delete` is incomplete until the outbox pair exists on both sides.
- **Backup and disaster recovery** stays where the white paper put it. D1 Time Travel is the answer to a bad migration or a fat-finger bulk write; it is not the answer to a member deleting the wrong note, and nothing in this design is a reason to reach for it. The two layers do not substitute for each other in either direction.

---

## 8. A build plan

Five slices, each shippable, ordered so the cheap declarative work makes the expensive work verifiable. Sizes are relative, not estimates.

**Slice 1 — the declaration, and the census it produces. Built (2026-09-03) for DELETE.** `RouteMeta` carries `reversal`, emitted as `x-mc-reversal` and carried into the generated client. `defineOpenAPIRoute` refuses a DELETE that declares nothing, and a conformance fitness function checks the cross-references over the emitted document — that an `inverse` or `compensating` names an operation that exists and mutates, and that a `none` carries a non-empty reason. **The gate starts at DELETE rather than at every mutating method**, because that is where the question is asked most and was answered least (33 against 5), and because 349 mutating operations declared in one pass would be 349 guesses. Widening it is its own slice. The census it produced is section 8a.

**Slice 2 — the primitive, and both ports. Built (2026-09-03).** `HistoryStack`, `UndoRedoControls` and `historyShortcuts` are in the design system at `packages/design-system/src/lib/components/history/`, carrying the seven rules from section 4, and all three are in the one-implementation registry — a third stack is now a gate failure rather than a discovery. Both surfaces are ported and both old stacks are deleted. The file manager's recorded move became the first inverse command, one per key back to where that key came from. The Time Sheet's snapshot became a pair of field writes, which is where its two defects were fixed: an undo now writes **the row the step changed** rather than every row on the sheet, and the announcement waits for the write instead of firing on the pop. An inverse whose entry has left draft refuses rather than writing, and says so. The missing `DropdownMenu.Group` went with the hand-built markup that carried it.

**Slice 3 — the honest sentence.** Render every destructive dialog's recoverability line from the declaration. Audit the acknowledgement dialogs against the `none` census and remove the ones that are not entitled to one. This is where the census turns into user-visible correctness, and it is small.

**Slice 4 — soft delete where the census says it belongs.** For each table the owner rules in (section 9, decision 3): the `deleted_by` and as-of-deletion columns, the restore route, the deleted-set list route, the outbox pair, and the deleted view on the D1b/D1c/D2b pattern. Sized per subsystem and taken one at a time; notes and tasks are the two that need the ruling before the code.

**Slice 5 — the undoable delete.** With slices 1 to 4 in place, a delete becomes a steppable act on the surfaces where the owner wants it, because the inverse is a real route and the declaration says so. It is deliberately last: the stack is worth having only over reversals that exist, and building it first is how a platform ends up with an undo that sometimes silently does nothing. Slice 2 landing early is not a reordering — the stack it built is over movement and field edits, both of which already had their inverses.

An implementation plan is deliberately not written yet. Slice 1's census changes what slices 3 to 5 contain, and several owner decisions below are cheaper to answer with the census in hand.

---

## 8a. The census — what the platform deletes, and what puts it back

Produced by slice 1, over the thirty-five DELETE operations in the emitted contract. It is a fact about the contract rather than a claim in this document: `x-mc-reversal` carries each row, and CI fails if any of them names an operation that does not exist.

| Kind      | Count | What it means                                                                                                           |
| --------- | ----- | ----------------------------------------------------------------------------------------------------------------------- |
| `inverse` | 21    | A counterpart operation undoes it, and the declaration names it — an attach, a link, a grant, a mint, a set, a restore. |
| `none`    | 12    | Nothing in the product puts it back, and each carries the sentence that says why.                                       |

**The twenty-two `inverse` rows are the finding nobody expected.** More than half of what the platform calls deletion is not deletion at all — it is detaching, unlinking, revoking, clearing: a statement about a relationship, fully reversible by the route that made it, and in several cases already worded that way in the route's own description (`tasks.unlinkExternalTask`: "unlinking is a statement about the correspondence and never about the work"). None of those needs a confirmation dialog, and several have one.

**The twelve `none` rows are the real deletion surface, and they are not one thing.** Reading their reasons sorts them into three groups:

- **Irreversible by design, correctly** — `magnus.deleteConversation` (the erasure instrument for everything typed into the assistant), `emails.revokeAutoFileRule` (kept so every message it placed can still name it, and deliberately not resumable), `decryption.recoverCancel` (a terminal job).
- **Irreversible because there is nothing to restore** — `customFields.hardDeleteField` and `.hardDeleteOption`, which refuse to run at all unless the field holds no values.
- **Irreversible by omission, and each one is a gap** — `notes.deleteNote` (whose own design rules that no hard delete should exist), `tasks.deleteTask`, `matterAssets.deleteAsset` (the row is kept and no route clears the flag), `custody.deactivateItemType` (no route makes a deactivated type offerable again), `emails.unlink`, `templates.deleteFieldMapping`, `downloads.remove`.

That third group is what slice 4 works through, and it is now a list rather than a suspicion. `matterAssets.deleteAsset` is the sharpest: its own route description says "a firm that removed a house by mistake this morning wants it back this afternoon," and the schema keeps the row — but no route clears the flag, so the sentence is aspirational.

**What the census cannot yet say** is what the other 316 mutating operations do, because the gate does not reach them. The two that most want declaring next are the void family (`timeEntries.void` → `timeEntries.unvoid` is an `inverse` the platform already has) and the compensating pairs in the ledger, which is where `compensating` earns its arm.

---

## 9. Owner decisions

1. **Ratify the three-layer split and the declaration as its carrier** — reversibility is a route-metadata fact, enforced in CI, read by the UI, never restated in a dialog. (Sections 2 and 3. An ADR fragment records the ratification.)
2. **Ratify one history stack in the design system**, replacing `SheetHistory` and `MoveHistory`, with the inverse-command model and the seven rules — in particular rule 2, that an announcement waits for the write. (Section 4.)
3. **Which subsystems get soft delete and a deleted view.** The recommendation is: notes and tasks yes (both are records of the firm's work, and both hard-delete today); directory contact points, matter assets and calendar rows already carry `deleted_at` and need only the columns and the routes; detach, unlink, revoke and deactivate stay as they are, being reversible already. Custom fields keep their purge, which is a schema operation rather than a record deletion. (Section 5.)
4. **`notes.deleteNote` specifically.** Its own design rules no hard delete and retraction instead; the shipped route hard-deletes and says so. Decide whether the route is corrected to the design, the design is revised to the route, or the route stands until the notes revision chain is built — and whichever it is, the declaration says the truth in the meantime. (Sections 1 and 5.)
5. **Whether delete becomes a step on the file manager's stack**, now that it could. The recommendation is **yes for a single delete and no for a cascade**: undoing a folder delete that took a hundred files with it is a bulk restore wearing a small control, and the Deleted Files view is the honest surface for it. (Section 7.)
6. **The acknowledgement rule.** Ratify that a confirmation dialog with an acknowledgement is offered only where the declaration is `none`, and that a fitness function enforces it. This is the ruling with the widest reach in the product and the one most likely to be wanted with the census in hand rather than before it. (Section 6.)
7. **Whether the stack survives a reload.** The recommendation is **no** — a stack is a session's, and an undo offered over a page load promises more than an inverse command can honour once the subject may have moved. Layer B is what covers the reader who comes back tomorrow, and it covers them better. (Section 4.)
8. **Whether `deleted_by` is backfilled or left blank.** The recommendation is left blank and rendered as an honest blank; the alternative is inventing an actor for a deletion nobody recorded. (Section 5.)

---

## 10. Trade-offs owned

**The declaration is thirty-three-plus small edits and one fitness function, before anything visible changes.** That is real work with no demo at the end of it, and the temptation will be to skip to slice 2. The argument against skipping is section 1's inventory: two undo stacks already exist and neither can be extended to deletion, because neither has anything to ask. Building a third stack without the declaration produces a third thing to consolidate later.

**A declaration can lie.** `reversal: { kind: "inverse", by: "files.restore" }` is true only while `files.restore` actually restores. CI checks that the operation exists and mutates; it cannot check that it is a genuine counterpart. The mitigation is the integration test each such pair owes — delete, restore, assert the subject is back — which is cheap and is the test a restore route should have anyway.

**Soft delete grows the row count and the discovery surface.** ADR-0049 already priced this for files and accepted it; rows are cheaper than objects, and the same reasoning applies with more force. What it does not do is grow the _read_ cost, provided each soft-deleting table takes the partial index on `(scope, deleted_at) WHERE deleted_at IS NOT NULL` that the deleted list walks, keeping the deleted read off the live list's index.

**One stack for two very different surfaces risks a lowest-common-denominator primitive.** The mitigation is that the primitive knows nothing about rows, files, moves or fields — it holds labelled commands and calls them, which is precisely the seam `SheetHistory` already found ("The snapshot type is the caller's... which is what lets it be tested without a row anywhere near it"). The generic half is small; the surfaces keep their own inverses.

**The rejected alternative — a generic undo journal.** A per-firm table recording every mutation with its prior values, replayed backwards on request, would give undo everywhere for free. It is rejected on two independent grounds. It would hold prior values of privileged content, and `audit_log.metadata` is redacted by construction ("ids and non-privileged fields only, NEVER privileged content"), so the journal would need its own encryption, its own access gate and its own retention answer — a second protected corpus, built to hold what the firm has already deleted. And a generic backward replay cannot know that unvoiding a cost-converted time entry is forbidden, that a merge is not reversible, or that a coding act's undo must be exact to the rows it wrote. Every one of those is a domain rule, and the subsystems that hold them already express them as routes. The declaration points at those routes; it does not try to replace them.
