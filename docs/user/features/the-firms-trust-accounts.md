# The firm's trust accounts

_The accounts, each account's position, the approval queue, the bank-charge cushion, the unclaimed-funds file and the firm's policy are in daily use._

## What it does

**Trust** in the sidebar's Money group is the firm's own view of client money: every trust account
the firm holds, and for each one the payments waiting on approval, the firm's bank-charge cushion, and the firm-wide policy on who may
release client money. A matter's own Trust section shows one matter's ledger; this screen shows the
accounts those ledgers live in.

The accounts are the list on the left. Pick one and its record opens beside it. With one account
it is picked for you. The account you are on is in the address, so sending somebody the link lands
them on the same account.

## Opening a trust account

**New Account** at the top opens one. Give it the name your firm knows it by, the office that holds
it, the bank and the last four digits of the account number if you want them shown, whether it is
a pooled interest-bearing account, and the day it was opened.

Two things are decided for you. The account's **jurisdiction is the office's**: the rules require a
trust account to sit in the state of the lawyer's office, so it is never chosen here. An office
that records no jurisdiction opens the account all the same, and every movement on it is refused
until the office records one, because there is no rule to check the movement against. And **only
the last four digits** of the account number are ever stored.

Opening an account needs the trust management right; the control says so if you do not hold it.

## Deciding a payment

**Awaiting Approval** lists every payment out of the account that nobody has decided yet, oldest
first, earned-fee applications among them and labelled as such. Each row names the amount, the
payee, the purpose, who proposed it and when.

- The person who proposed it can **Withdraw** it.
- Anybody else who may decide it can **Approve** it, which is the moment the money moves, or
  **Reject** it with a reason the proposer can answer.

Approval is checked again at the moment it is given: if the ledger no longer has the money
available, the approval is refused rather than posted. What counts as "may decide it" is your
firm's policy ([trust money-out approvals](../admin/trust-disbursement-approvals.md)).

## Where an account stands

**Position** states the account as it is today, worked out from every recorded entry at the moment
of asking: the bank's **book balance**, what the **client ledgers** come to, what is under
**hold**, the **firm funds** in the bank-charge cushion, how many matter ledgers the account
carries, and how many payments are waiting. The book balance and the client total are the same
two figures a reconciliation proves against, computed the same way.

## Reconciliation

Reconciling an account against its bank statements is on its own screen: press **Open
Reconciliation** on the account's record, or open **Reconciliation** in the sidebar. See
[Reconciling a trust account](reconciling-a-trust-account.md).

## The bank-charge cushion

**Firm funds** is the one place the firm's own money may sit in a trust account, for the single
purpose of bearing the bank's service charges so that a charge is never borne by client money.
**Open Cushion** turns it on for an account (a pooled interest-bearing account refuses it, because
the rules exempt those accounts from the charges the cushion would pay); **Fund Cushion** puts the
firm's money in; **Record Bank Charge** records the institution taking a charge out of it. A charge
larger than the cushion is refused with the remedy named: fund the cushion, then record the charge.
These three need the firm-funds right, which is narrower than the right to move client money.

## Unclaimed funds

**Unclaimed Funds** finds client money that has sat unmoved. Choose a day, and the section lists
every ledger on the account that still holds money and has had no movement since then, with the
earliest receipt still on it and the last activity. There is no default period: which periods
matter differs by jurisdiction, and the firm may have been in touch with the client in ways the
platform never saw, so the comparison is yours to ask for.

- **Open Review** opens a diligence file over one ledger, recording what you saw when you opened
  it. It moves no money.
- **Record Contact Attempt** records each attempt to reach the owner as it is made: the channel,
  the day, the address or number actually used, and what came of it.
- **Close Review** ends the round with its outcome. Closing as **distributed to owner** names a
  payment that already went out through the ordinary approved path; the closure itself takes no
  amount, no payee and no method, and moves nothing.

## The firm's policy

**Authorization Posture** at the foot of the record is the firm's, not the account's: whether money
leaving a client ledger takes a second person (never, above an amount, or always) and whether
whoever releases it must hold the authority to act on client money. **Change** writes a new version
and needs the authority right; every version ever written is listed beneath, with who set it and
when. A change governs new payments only: a payment already waiting keeps the policy it was
proposed under.

## Related

- [`matter-money-sections.md`](matter-money-sections.md) — a matter's Trust section: its ledger, and
  recording a deposit, a payment out or a transfer from it.
- [`trust-compliance-report.md`](trust-compliance-report.md) — the document a firm hands an examiner
  about one trust account.
- [`../admin/trust-disbursement-approvals.md`](../admin/trust-disbursement-approvals.md) — the
  policy behind the approval queue, and how to choose it.
