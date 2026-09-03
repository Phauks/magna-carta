---
category: Added
audience: internal
---

A voided time entry can be put back.

Voiding is how a mistaken entry is retired, and it has always been one-way. That is right for the act and wrong for the accident: people void the wrong row, void on a colleague's say-so that turns out to be mistaken, and void an afternoon's work when they meant to void one line of it. Until now the only repair was to type the whole entry again, which loses its number, its internal memo, its codes, its attached documents and its history — exactly the loss that made a misfiled entry worth moving rather than re-typing.

**`POST /api/v1/time-entries/{id}/unvoid` returns it to draft** with all of that intact. It restores to DRAFT and never to submitted or approved: those were somebody's judgement about an entry that has since been withdrawn, and they have to be given again. The restore is recorded as its own event, so a reader of the entry's history sees both acts.

**It is not a lifecycle transition, deliberately.** The state machine still says nothing leaves a terminal state, because every other record kind in the product reads that same table and none of them has been designed for a backward move. This is its own guarded act with its own refusals, the way refiling a misfiled entry is its own statement rather than a field on the update.

**The one void that must stay a void is an entry converted into a cost.** That conversion moves the entry's value onto a cost record and voids the time in the same batch, precisely so the firm cannot count the work twice; restoring the time afterwards would undo the half of that act that was protecting the client. The conversion is recorded in the audit trail and nowhere else — no column on either row names the other — so that is what the route asks before it will restore anything.

On screen it is the verb in the place the opposite verb lives: the ledger's own menu turns Void into Unvoid on a voided row, and the record window offers it on the action bar, which is where somebody lands when they open an entry to find out what happened to it.
