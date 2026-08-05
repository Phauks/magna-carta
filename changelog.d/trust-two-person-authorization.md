---
category: Changed
---

**Paying money out of a client's trust ledger now takes two people.** A disbursement is proposed
first and paid second: one member writes down the payee, the amount, the method, and why, and a
different member approves it before anything reaches the ledger. Until that approval, nothing has
happened — no entry, no balance change, no client-ledger record — so a request that is refused,
withdrawn, or simply never answered leaves the ledger exactly as it found it. The client ledger then
shows both people: the member who wrote the record, and the member who authorized the payment.

**The approval is measured against the money that is there when it is given, not when it was asked
for.** A request written while the ledger held enough and approved after the funds went elsewhere —
or after part of them came under a disputed-funds hold — is refused, naming the amount asked for,
what is actually available, and the held portion that explains the difference. Two members approving
the same request at the same moment produce one payment, never two.

**A refusal is a record, not a disappearance.** Rejecting a request asks for a reason and keeps it,
alongside who refused it and when. The member who submitted a request can withdraw it; anyone else
records a rejection instead. None of it can be edited or deleted afterwards, exactly like the
movements it sits beside.

**A firm with only one person who can authorize trust payments can still pay.** In that case the
submitter approves their own request and the record says so in as many words, so nobody later has to
work it out by noticing that two names match. The moment the firm has a second member who can
authorize trust payments, that path closes on its own — there is no setting to leave switched on.

The disbursement endpoint is replaced by the request-and-approval pair, so any client calling it
directly moves to the new pair.
