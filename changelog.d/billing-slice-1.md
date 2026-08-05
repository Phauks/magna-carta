---
category: Added
---

Billing — the invoice spine. The first working bill: a firm can now assemble a draft from unbilled
time and costs, review what the client will be told, and turn it into a financial record.

**A draft is a working document; finalizing it is the only interesting moment.** While a bill is a
draft, lines can be added, re-worded, trimmed, or thrown away, and the work on it is only claimed —
still editable, still the timekeeper's to correct. Finalizing happens in a single all-or-nothing
step: the next invoice number is drawn, the letterhead and client details are copied onto the bill,
every claimed entry locks as billed, the amount each matter owes is created with a ceiling nothing
can exceed, and the receivable posts to the firm's books. If any part of that fails, no number is
used up, no work is locked, and nothing is posted — which is what makes the invoice sequence gapless
rather than merely careful. After it, the bill cannot be edited at all: the database refuses, and a
bill issued in error will be corrected by a credit note rather than erased.

**Two drafts cannot bill the same hour.** Pulling an entry onto a draft claims it, and the claim is
enforced by the database rather than by checking first — so when two people reach for the same work,
one gets it and the other is told plainly, instead of both quietly composing a line over it.
Removing a line, or throwing a draft away, hands every entry back to unbilled work and leaves the
record that it was once on that draft.

**Bill review edits the bill, not the timekeeper's record.** Trimming a line's hours or rewording it
changes what the client is told and leaves the underlying time entry exactly as the timekeeper wrote
it. Both are true, both are worth keeping, and it is what lets a finalized bill be re-rendered years
later without reading a single row from anywhere else.

**A bill will not post into an account the firm has not named.** Before a firm can finalize anything,
it says which of its ledger accounts is the receivable, which is fee income, which holds costs
advanced on a client's behalf. Until it does, finalizing refuses and says which one is missing and
where to set it — rather than posting real money somewhere plausible. Advanced hard costs credit
Client Costs Advanced and recognize no income, because the firm is being repaid rather than earning.

One bill belongs to one client and may cover several of that client's matters, with every line naming
its own matter and the amount owed tracked per matter — the shape an earned-fee transfer out of trust
will need. What is owed, and how overdue it is, are worked out when you ask rather than stored, so a
bill settled this morning is never reported as late.

Also extracts the sequence-numbering machinery matter numbers already used into a package billing and
matters now share, so the subtlety that makes a number draw race-proof lives in one place instead of
two copies.
