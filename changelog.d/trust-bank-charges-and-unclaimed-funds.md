---
category: Added
---

Trust — bank charges, and the firm's own funds in a trust account. A trust bank account gets charged
by its institution, and until now the ledger had no way to record that: a firm's real bank statement
could not be reconciled, because the one item on it that no member authorized had nowhere to land.
The conduct rules answer that by permitting a firm to keep a small amount of its **own** money in the
account for the sole purpose of bearing those charges, and that is now wired — narrowly.

**A bank charge cannot be turned into a way to move client money, and that is a property of the
structure rather than a rule somebody remembers.** The record beside a firm-funds entry lives in its
own table which has **no column for a client, a matter, a node, or a payee** — so a row of it cannot
describe a movement of anybody else's money whatever a caller intends. The entry goes through a
second composition door that admits exactly two lines, the firm-funds balance and that same account's
bank leaf, and refuses everything else; the door client money goes through still refuses a firm-funds
line outright and was not relaxed to make room. Only two movements exist in the category — the firm
putting its cushion in, and the institution taking a charge out — and there is deliberately no
movement that pays anybody: paying a person out of a trust account is a disbursement and goes through
the disbursement queue with its authorization.

**A bank charge is never borne by client funds, enforced by the database.** The firm-funds balance
carries the same zero floor every matter ledger carries, so a charge larger than the firm's own money
in the account drives it below zero and the whole batch aborts. Recording such a charge is refused
with the remedy named: put the firm's funds in to cover it, then record it. Until then the statement
line sits unmatched and the reconciliation reports the difference, which is the honest state.

**The carve-out is off until a firm turns it on, per account, and it takes a capability of its own.**
`trust:firmFunds` is seeded to Owner/Admin alone — narrower than every other trust key, including the
authority to release a client's money. Opening it is refused on a pooled interest-bearing account:
the researched rules exempt that kind of account from service charges, so there is nothing for the
firm's funds to pay and putting them there would be commingling with no permitted purpose.

**The three-way proof learned about it.** The firm's cushion is a leg of the proof in its own right
and is never folded into the client total — a client leg that quietly included the firm's own money
would tie out while asserting that firm money is client money, and leaving the cushion out of the
comparison entirely would report a `book-to-client` disagreement on every account that enabled the
carve-out, poisoning the one signal that means something reached the ledger without going through the
composition guard. Closing a reconciliation freezes the cushion figure alongside the other three.

---

Trust — unclaimed client funds: the dormancy read and the firm's diligence file. A firm holding money
for somebody it can no longer reach has a continuing duty to make reasonable efforts to locate the
owner and distribute the funds, and to be able to evidence both afterwards. The platform now surfaces
the balances and holds the evidence.

**Nothing here escheats, sweeps, or moves on a timer.** In the jurisdiction researched for this
subsystem, designated client trust accounts are exempt from the state unclaimed-property presumption
outright — nothing escheats, no dormancy period runs against them, and the one onward destination the
rules name is permissive rather than compelled. So there is no countdown, and no screen says a firm
must act by a date.

**Dormancy is a comparison, not a column.** The read lists matter ledgers that still hold money and
have been quiet since a date **the reader states** — there is no default period, because the periods
differ by jurisdiction and several of them gate a permission rather than an obligation. Nothing is
stored, no sweep maintains it, and the same read against a wider window gives a different answer with
no state having changed. It reports two dates rather than one, because the rules' clocks run from
**receipt of the property** and not from the last thing that happened on the matter.

**Every locate attempt is recorded when it is made** — regular mail, certified mail, telephone, email,
a review of the firm's own records — with the address or number actually used, the outcome, and who
recorded it. That is the artifact a certification is built from and the one thing nobody can
reconstruct two years later. The file is append-only and one client ledger carries one open review at
a time.

**Every movement takes a person.** Closing a review as a distribution names a disbursement that
**already posted** through the ordinary authorized path; the closing composer receives no amount, no
payee, no date and no method, so there is nothing it could assemble into a ledger entry. It writes one
row and moves nothing, and the database independently refuses a closure that names a payment out of
another client's ledger.
