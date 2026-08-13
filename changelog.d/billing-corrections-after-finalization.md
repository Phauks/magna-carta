---
category: Added
audience: public
---

Billing — corrections after finalization: credit notes, client credits, write-offs, and reversals,
plus the contingency shrunk-basis residual the fee-models review left open.

**Nothing corrects a bill by editing it.** A finalized invoice is frozen by database trigger and
`void` is unreachable from `final`, so every correction here is a second permanent record standing
beside the first. `credit_note` and `credit_note_line` are append-only from birth and refused
outright against anything but a finalized invoice, by trigger. The invoice's own `total_minor` never
moves: a note lands as an `invoice_application` against `applied_minor`, so what the client was told
stays exactly as it was told and only the derived balance changes.

**A correction that outruns the unpaid balance opens a `client_credit`, and the split is forced by
the balance CHECK.** Reducing a matter's total below what has already been applied to it would be a
negative unpaid receivable, and in the ordinary case that money has already left the client's trust
ledger and become the firm's — un-writing it is a firm-funds decision, not an invoicing one. So the
note credits the receivable by what the bill can absorb and the client-credit liability by the rest.
Open is DERIVED (`amount_minor` frozen, `discharged_minor` delta-updated under a bounds CHECK), on
the same reasoning that keeps a status column off `trust_hold`. The one of the three exits that
moves no money — setting the credit against a later bill of the same client, on any of their matters
— is built; refund-from-operating and return-to-trust are named and deliberately not performed.

**The application door now records WHICH posting each application rode with, and a trigger holds the
pairing.** No entry for a trust transfer (the two linked entries are trust's, and its operating leg
has already credited the receivable), none for a credit note (one posting sits on the note, which is
also the only place a note against a fully-paid bill could record one), exactly one for every other
kind. That turns the single most likely bug in the subsystem — a second receivable credit composed
here — from a remembered discipline into a database guarantee, with a new fitness query re-proving
the other direction: a credit note, write-off, or reversal that moved a balance with no posting
behind it.

**A reversal refuses two kinds by name.** A trust transfer, because putting client money back is a
movement in the trust ledger and billing composes no trust statement; and a credit note, because it
is a document the client may already hold and unwinding its application while it still stood would
orphan any credit it opened. A discharged client credit reversed gives the credit back in the same
batch.

**The contingency shrunk-basis residual.** A fee derived from a basis is billed as the increment
over what earlier bills already charged — and that comparison read the GROSS charge, while a
finalized line cannot be edited. So the one record that can answer a basis that shrank after billing
had no effect on the report that demanded it, and the matter stayed flagged forever. A credit-note
line may now name the invoice line it credits (`credits_invoice_line_id`, held to the same bill and
matter by trigger), and both the composer's offset and
`contingencyBilledBeyondEntitlementStatement` read billed net of attributed credits. A new
`readContingencyResidual` states the residual as an amount and names the finalized fee lines a
correction would be aimed at, with what each bill still owes — and issues nothing, because what a
firm owes back after a settlement collapses is a decision with a client in it.

A matter does not close over an open client credit: a hard block on the shared close-precondition
registry, proven twice like trust's, with the commit guard aiming a value the table's CHECK forbids
at exactly the open rows. There is deliberately no block on an unpaid receivable — bad debt is an
ordinary outcome whose lawful exit is a write-off.

Migration idx 56 (`20260813T000000_billing-credit-notes`); seven new chokepoint routes on the
existing `billing:credit`, `billing:apply`, and `billing:read` keys, so no permission inventory
moved.

## Public

**You can now correct a bill that has already gone out — without the bill changing.**

Issue a **credit note** against it and say why, in your own words. What you credit comes off what
the client still owes; if they have already paid, the part the bill can no longer absorb is recorded
as money the firm owes them back, and that credit stays visible until you give it back. You can set
it against any later bill for the same client, refund it, or return it to their trust account —
whichever your agreement calls for. A matter will not close while a credit is still open.

**Write off** a balance you have decided not to chase, with the reason. It is kept separate from a
credit note on your books, because giving up on money you were owed is a different fact from
conceding you should not have charged it.

**Undo** a payment or credit recorded against the wrong bill or the wrong matter. The original stays
readable and the reversal is a new record linked to it.

**And if a settlement collapses after you have billed your contingency share**, ask the matter for
its contingency position. It compares what you have actually billed against what the surviving
recovery now entitles you to, reports the difference, and names each bill that carries the fee and
what it still owes — so you can see, before you raise anything, whether a correction would reduce a
debt or leave you owing money back. Nothing is issued for you: what a client is owed when a case
falls apart is your call.

The bill itself never changes. It keeps its number, its lines, and its wording forever, and every
correction stands beside it on the record.
