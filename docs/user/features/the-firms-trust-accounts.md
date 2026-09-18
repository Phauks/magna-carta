# The firm's trust accounts

_The accounts, the approval queue and the firm's policy are in daily use. Recording and importing
bank statements, working a reconciliation, funding the bank-charge cushion and the unclaimed-funds
file are still to come, and each control says so where it stands._

## What it does

**Trust** in the sidebar's Money group is the firm's own view of client money: every trust account
the firm holds, and for each one the payments waiting on approval, the statements and
reconciliations on record, the firm's bank-charge cushion, and the firm-wide policy on who may
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

## What is recorded for an account

- **Statements** — each period of the account as the bank reported it, with its opening and closing
  balances and where it came from (entered by a member, or imported from a file).
- **Reconciliations** — each reconciliation opened against a statement, who opened and closed it,
  and for a closed one whether the period balanced, with the three totals the firm attested to and
  what did not tie out. A closed reconciliation states what was true when it was closed, not what
  is true now.
- **Firm funds** — the bank-charge cushion, when the firm has opened one on this account: the firm's
  own money, kept in the trust account for the single purpose of bearing the bank's service charges
  so that a charge is never borne by client money. Its balance and every top-up and charge are
  listed.
- **Position** — the account's current balance is not stated on this screen yet. The
  [trust compliance report](trust-compliance-report.md) states it for any period.

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
