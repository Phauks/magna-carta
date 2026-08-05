---
category: Added
---

Trust accounting — a matter whose client trust ledger still holds money no longer closes. The matter
shell has carried a close hook since the lifecycle landed and nothing had ever registered against
it; trust is its first rule, and it is a hard block rather than a warning, because a closed matter
with somebody else's money in it is precisely how funds become unclaimed and the firm that closed it
is the one that answers for them. The refusal is written to be acted on rather than merely obeyed: it
names what the ledger holds, which trust account it sits in, how much of it is under an active
disputed-funds hold, and the two movements that legitimately empty it — disburse the remaining funds
to the client, or transfer earned fees to the operating account. A matter that never held client
money closes exactly as before; the absence of a trust ledger is not a refusal, and the gate never
creates one to find out.

The rule is proven twice, because a read cannot be atomic with the write that follows it: the check
produces the refusal a person can read, and a guard riding the close batch itself re-asks the same
question where the answer is the committed one, so a deposit that lands between the two aborts the
whole close — its audit row, its event, and its idempotency record with it — instead of closing a
matter over money that arrived a moment earlier. Refused closes now answer with their own problem
type rather than a generic validation failure, naming each rule that refused.
