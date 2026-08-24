---
number: 286
slug: billing-corrections-are-second-records-and-a-credit-is-attributable
status: Proposed
date: 2026-08-13
area: Billing
summary: "Every correction to a finalized bill is a SECOND permanent record and the bill's own total never moves: a credit note lands as an application against applied_minor, and what it cannot absorb becomes an open client_credit whose 'open' is derived from a frozen amount and a delta-updated discharged total under a bounds CHECK, never a status column. Which posting an application rode with is now RECORDED on the row that owns it and held by trigger — none for a trust transfer (trust's two linked entries already credited the receivable), none for a credit note (one posting per note, across however many per-matter applications it produces, including none), exactly one for every other kind — which makes the no-double-credit rule a database guarantee and lets a new fitness query prove the mirror condition in the other direction. A credit-note line may NAME the invoice line it credits, and that attribution is load-bearing: a contingency fee is billed as the increment over what earlier bills already charged, that comparison read the gross charge, and a finalized line cannot be edited — so before this the one record that resolves a shrunk basis had no effect on the report that found it. Both the composer's offset and contingencyBilledBeyondEntitlementStatement now read billed NET of attributed credits, and readContingencyResidual states the residual as an amount against the bills that carry it while issuing nothing. A reversal refuses a trust transfer (billing composes no trust statement) and a credit note (a permanent document is answered by a further correction). A matter does not close over an open client credit — hard block, no override — and deliberately does not block on an unpaid receivable. Credit-note NUMBERING is not built and is an open owner question."
---

**A correction to a finalized bill is a second permanent record; a credit is attributable to the
charge it corrects; and which posting an application rode with is recorded and held by trigger.**

**Context.** The invoice spine froze a finalized invoice by database trigger and made `void`
unreachable from `final`, on the stated ground that a bill issued in error is corrected by a credit
note rather than erased. That correction was named and deferred, and with it client credits,
write-offs, and reversals — the last named gap in the billing spine.

The fee-models build then left a specific hole behind it. A contingency fee is derived at
composition and billed as the increment over what earlier bills already charged, so the composer and
the over-billing fitness report both sum finalized contingency fee lines. A basis that SHRINKS after
billing — a voided recovery, an advanced cost that arrives late under the net-of-costs election, a
share lowered by amendment — leaves the firm having charged more than the surviving basis entitles
it to. That cannot be caught on the write path, because the bill was true when it issued, and the
report was built to surface it. But **a finalized invoice line cannot be edited**, so the only record
that can answer the finding is a credit note standing beside the bill — and a gross comparison meant
that record changed neither the offset nor the report. Every affected matter would stay flagged
forever with the correct remedy already applied, and a report nothing can clear stops being read.

**Decision:**

1. **Nothing edits the bill, and its total never moves.** `credit_note` and `credit_note_line` are
   append-only from birth and refused against anything but a finalized invoice, by trigger. A note
   lands as an `invoice_application` of kind `credit_note` against `applied_minor`. No
   `total_minor` is ever reduced: that would be a negative unpaid receivable, and the invoice model
   deliberately stores no total on the header at all.

2. **What a note cannot absorb opens a `client_credit`.** In the ordinary case the money has already
   left the client's trust ledger and become the firm's, so un-writing it is a firm-funds decision
   and not an invoicing one. The platform records the obligation and refuses to discharge it on its
   own initiative. **Open is DERIVED, not a status column** — `amount_minor` frozen by a shape
   trigger, `discharged_minor` delta-updated inside a posting batch under
   `discharged_minor >= 0 AND discharged_minor <= amount_minor` — the same arrangement
   `invoice_matter_balance` and `account_balance` carry, and the same reasoning that keeps a status
   column off `trust_hold`. The three exits are named; the one that moves no money (setting the
   credit against a later bill of the same client, on any of their matters) is built, and refund-
   from-operating and return-to-trust are refused by absence because both move real money out of a
   firm account through an operating-disbursement path that does not exist yet.

3. **The posting is recorded on the row that OWNS it, and the pairing is a trigger.** No entry for a
   trust transfer — trust's two linked entries already credited the receivable, and a second credit
   composed in billing would leave the ledger balanced, every entry valid, nothing failing, and the
   receivable control account drifting below the subledger by the total of every trust-funded fee
   the firm has ever taken. No entry on the application for a credit note either: one note is one
   posting across however many per-matter applications it produces, including **none at all** when
   the bill is already paid in full, so the entry sits on the note. Exactly one for every other
   kind. This is the first time the no-double-credit rule is enforced by the database rather than by
   one arm of one function, and it makes the mirror condition provable:
   `billingCompositionsWithoutTheirReceivablePostingStatement` reports any non-trust application
   that moved a balance with no receivable posting behind it, or with two.

4. **A credit-note line may NAME the invoice line it credits, and the attribution is load-bearing.**
   `credit_note_line.credits_invoice_line_id`, held by trigger to a line of the same bill on the
   same matter. Both `readFinalizedContingencyBilledMinor` (the composer's offset) and
   `contingencyBilledBeyondEntitlementStatement` now read billed NET of credits attributed to
   contingency fee lines. A general credit against the same bill deliberately does not move the
   figure: it is not a statement about the fee. Consequence, stated because it changes what the
   ledger asserts: a credited fee becomes billable again **if and only if the basis itself later
   recovers** — the increment is always measured against the current entitlement, so the firm never
   re-charges what it gave back beyond that entitlement, and never under-charges a genuine later
   recovery either.

5. **`readContingencyResidual` states the residual and issues nothing.** For one matter: the
   surviving entitlement, what is billed net of credits, the difference, and every finalized fee
   line with what its bill still owes — because a correction larger than the unpaid balance leaves
   the firm owing money back rather than reducing a debt, and a firm wants to know that before it
   raises one. It refuses nothing about the basis: a basis that vanished entirely resolves to an
   entitlement of zero, which is the worst case the read exists to report rather than a reason to
   stop reporting. **What the firm owes back after a settlement collapses is a decision with a
   client in it, and the platform does not make it.**

6. **A write-off is a distinct management fact and cannot exceed the unpaid balance.** The charge was
   right and the money is not coming; it posts against its own account so bad debt never hides
   inside adjustments. There is nothing beyond the unpaid balance to give up — money already
   collected is refunded or credited, which is a different record with a different meaning.

7. **A reversal refuses two kinds by name.** A **trust transfer**, because putting the money back is
   a movement in the trust ledger, composed and authorized there, and this package composes no trust
   statement — a source scan already asserts that. A **credit note**, because it is a permanent
   document the client may already hold: unwinding the application while the document stood would
   leave the correction asserting one thing and the balance another, with any client credit it
   opened orphaned beside them. Reversing a reversal is refused too — it would re-apply value under
   a kind whose whole meaning is that it subtracts. A reversed client-credit discharge gives the
   credit back in the same batch.

8. **A matter does not close over an open client credit** — hard block, no override, on the shared
   close-precondition registry beside trust's, proven twice with a commit guard that aims a value the
   table's CHECK forbids at exactly the open rows. It is nearer the trust case than the receivable
   case: the firm has already conceded the money is not its own. There is deliberately **no** block
   on an unpaid receivable: bad debt is an ordinary outcome, its lawful exit is a write-off, and the
   soft-block-with-recorded-override the design recommends needs an override mechanism the close hook
   does not have.

9. **Every amount is integer minor units and NOTHING in this slice introduces a rounding boundary.**
   The applied/residual split is `min` and subtraction over figures already at scale 2; per-matter
   totals go through `aggregateMinor`, which uses Money's own addition and no rounding helper because
   there is no boundary there to decide. The residual is the difference of two integers the SAME
   helper produced — `contingencyFeeMinor`, through `percentOf`/`ratio` collapsed once by
   `roundInvoiceLine` (half-away-from-zero) — reused verbatim rather than re-derived, so a residual
   can never be the artifact of a second, differently-rounded derivation.

**Rejected:** reducing `invoice_matter_balance.total_minor` by a credit note (a negative unpaid
receivable, and it would rewrite what the client was told); an `open`/`discharged` status column on
`client_credit` (cannot express a partial discharge, and it is the column the whole subsystem's
append-only discipline exists to avoid); a shared `credit_note` table with a `kind` discriminating
write-offs (a write-off has no lines and no document — it is an application with a reason, and
conflating them would put two management facts under one name); reversing a trust-transfer
application by composing the mirror entries here (it would make billing a writer of trust
statements, which is the boundary the whole earned-fee seam exists to hold); and issuing the
contingency residual credit note automatically from the fitness finding (it would have the platform
decide what a client is owed).

**Open — for the owner:**

- **Credit-note numbering.** A credit note carries no number. The sequence machinery exists
  (`@magna-carta/sequence-numbering`, which the invoice number already draws from) but the design
  never decided whether a credit note draws from the invoice sequence, its own, or none — and the
  answer has accounting and jurisdictional consequences the platform should not guess. Adding a
  NOT NULL number later is a backfill against issued records, so it is worth answering before the
  first firm issues one.
- **Whether a credited contingency fee should be re-billable at all** if the basis later recovers.
  Decided here as yes, on arithmetic consistency — the increment is always measured against the
  current entitlement — but it is a statement about what the firm may charge a client twice over,
  and an attorney may read it differently.
