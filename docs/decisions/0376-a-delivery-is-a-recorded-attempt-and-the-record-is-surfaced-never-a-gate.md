---
number: 376
slug: a-delivery-is-a-recorded-attempt-and-the-record-is-surfaced-never-a-gate
status: Proposed
date: 2026-08-17
area: Billing
summary: "Invoice delivery is an append-only `invoice_delivery` row per attempt — channel, recipient reference, a firm-supplied civil delivery date, an optional external reference, an outcome, and who recorded it — never a `sent` status on the invoice, because a bill goes out possibly several times by several channels and a status would force the finalized row to stay mutable for its least load-bearing field. The record is a RECORD, not a transmission: nothing renders an invoice or carries one to a client, so every row is a delivery the firm performed out of band and is reporting, which is what makes the compliance question answerable for the firms that hand bills over at meetings, post them, or submit them to a client's own e-billing portal. It is surfaced and never a gate — `readInvoiceDeliveryState` rides the invoice detail read so the apply-funds surface cannot forget it, and finalization alone gates an earned-fee transfer, because a hard delivery gate would be satisfied by firms recording deliveries that never happened and would convert a compliance record into a checkbox. The channel vocabulary is closed at five (`email`, `post`, `hand`, `client_portal`, `e_billing_gateway`) with `client_portal` enumerated before anything can produce it, since SQLite cannot widen a CHECK without a destructive rebuild of a financial-evidence table. Two triggers bound what a row may describe — a delivery names a finalized bill, and cannot predate its issue date — and three hold append-only, including the BEFORE INSERT guard that catches `INSERT OR REPLACE`. Whether a delivery recorded in error may be superseded by a correcting row is left to the owner, and the `outcome` vocabulary ships as `delivered`/`failed`, a floor rather than an answered set."
---

**A firm has to be able to show that it gave a client its bill. The platform that cannot send the bill
can still hold that record — and holding it is worth more than sending it.**

**Context:** "Has this bill been given to the client?" was unanswerable. The billing design specified
an append-only `invoice_delivery` row per attempt, the `invoiceDelivery` identifier prefix was
registered and its branded type exported, and no such table existed anywhere in the per-firm schema.
The gap had already cost something concrete: the billing-automations design hit it while scoping
payment reminders and had to concede that a reminder about a bill the platform cannot establish the
client received is not an honest reminder, carrying a `delivered_at` column that stays null.

The obvious objection is that a delivery record is worthless without a renderer. There is no invoice
renderer and no client-facing channel — every notification audience resolves to a firm member and the
client portal is unbuilt — so the platform cannot produce the document or carry it anywhere. That
objection has the case backwards, and getting it right is the whole decision.

**Decision: the delivery record records; it does not transmit.** Out-of-band delivery is not the
degenerate case, it is the common one. Bills get handed over at a meeting, put in the post, emailed
from the firm's own mailbox, or submitted to the client's own e-billing portal. A table that could
only hold deliveries the platform itself performed would leave every one of those unrecordable — which
is exactly the firm that most needs to answer the question. So the row is the firm's assertion about
something the firm did, with the firm's own date on it, and the platform checks only what it can: that
the bill was finalized, and that the delivery does not predate the bill's own issue date.

**A row per attempt, never a status on the invoice.** A bill goes out possibly several times and
possibly by several channels, and a re-send is not a change to the financial record. A `sent` status
would force the finalized invoice row — frozen by trigger, with no un-finalize — to stay mutable for
its least load-bearing field, which is precisely the concession that stops an append-only table being
one. A second delivery of the same bill is therefore a second row, and nothing already recorded is
edited or withdrawn: this row is the firm's evidence that it discharged an obligation to its client,
read years later in a fee dispute or a bar audit, and evidence that can be edited after the fact is
not evidence.

**Surfaced, never a gate.** Several jurisdictions expect a client to have been given a bill before
fees are withdrawn from trust, so the tempting design is a hard precondition on the earned-fee
transfer. It is refused, and the reason is uncomfortable enough to be worth stating plainly: a hard
delivery gate would be satisfied by firms recording deliveries that the platform did not perform and
that may not have happened, which converts a compliance record into a checkbox and makes the record
worse than not having one at all. Finalization alone gates. The delivery state instead rides the
invoice detail read — not a separate endpoint a caller has to know to ask — because the surface that
must show it is the one where a firm decides to move client money, and a fact that has to be fetched
on purpose is a fact a surface forgets to show. The firm proceeds knowingly.

**The state read answers the two questions that look like one.** A bill with no rows has never been
sent. A bill with three failed attempts has been chased and has not landed. Both are "not delivered",
and a surface that collapsed them into one message would tell a firm nothing it needs, so the attempt
and failure counts sit beside the flag. The recorded date is the **first** success rather than the
latest, because when the client was first given the bill is the question a jurisdiction asks, and a
courtesy re-send weeks later does not move the date a clock ran from.

**The channel vocabulary is closed now, including a value nothing can produce.** Five values —
`email`, `post`, `hand`, `client_portal`, `e_billing_gateway`. SQLite cannot widen a table CHECK
without a destructive rebuild, and this is a financial-evidence table, so the alternative to
enumerating `client_portal` today is rebuilding the table on the day the portal lands. `email` here
means a mail the firm sent from its own mailbox and `e_billing_gateway` a submission the firm made,
consistent with the rule that nothing is performed here.

**Consequences.** The reminder path can now honestly say whether a bill was ever recorded as given to
the client, and can say "no delivery has been recorded" as a fact rather than a limitation; it still
cannot deliver a reminder to a client, which needs a channel that does not exist. The apply-funds
decision gains the context a jurisdiction expects without gaining a refusal that would have been
gameable. And the record is only as good as the firm's own honesty about it — which is true of any
compliance record about an act performed outside the system, and is the reason the alternative was
worse.

**Left to the owner, deliberately.** Whether a delivery recorded in error may be superseded by a
correcting row that names it. The table is append-only by design, so no edit and no deletion; but the
design names no correction shape either, unlike a credit note, whose answer is a further credit note.
A firm that records the wrong date, or a delivery that never happened, has no way to walk it back —
and that is exactly the row the compliance read depends on. Also unresolved: the design names
`outcome` as a column without enumerating it, so `delivered` and `failed` ship as the floor at which
the column still means something, not as an answered vocabulary.
