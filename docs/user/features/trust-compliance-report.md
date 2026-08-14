# The trust compliance report

_Backend built, screens pending._ The report below can be produced today; the page a person clicks it
from has not been built yet.

This is the document a firm hands a bar examiner, an auditor, or its own accountant when somebody
asks how it has looked after client money. It covers **one trust account** over **one period**, and
it is put together entirely out of records the firm already has — nothing in it is a new opinion
about the firm's books.

## What is in it

**The cover.** Which account, at which bank (the last four digits of the number, never the whole
number), which office holds it, the period, and the statement about reproducing the figures explained
below. The cover also says whether the firm keeps a small amount of its own money in the account to
cover bank service charges, because that is the usual explanation for a difference an examiner would
otherwise ask about.

**Each reconciliation in the period.** For a period the firm reconciled and closed, the report prints
the totals the firm itself attested to at the time — the bank balance, the items still in transit, the
firm's books, the total owed to clients, whether it balanced, and who closed it. Beside them it prints
the same comparison as the ledger stands today. Those two can differ, and when they do the report
states each difference rather than choosing between them: a payment recorded later with an earlier
date is a normal thing to do, and it moves today's figure without touching what the firm signed.

A period nobody reconciled says so on the page, in those words.

**Each client's ledger, and each matter under it.** The balance carried in, every entry in the period
with its date, description, amount and running balance, and the balance carried out. A correction is
shown as its own entry beside the one it corrects — nothing is netted away and nothing is removed,
because the fact that something was corrected is part of the record.

**The receipts and disbursements journal.** Everything that moved the bank balance, in date order,
with a running balance. This includes money taken as earned fees and bank service charges, not only
client receipts and payments — anything that moved the account is here.

**The firm's own money**, if the firm keeps any in the account for bank charges: its own opening and
closing figures and every deposit and charge. It is never mixed into a client total.

**Exceptions.** Holds placed on client money, items the firm has recorded that have not reached the
bank, statement lines nobody has matched to anything, and a check that every stored balance still
agrees with the entries behind it. This section is short on a tidy account, and it is the section
worth reading first.

**Provenance.** When the report was produced, over what period, and the choices it was produced with.

## Running the same period twice

Ask for a period and a **point in time** — "July, as things stood on the first of August" — and every
figure in the report is fixed. Ask again in five years with the same two things and you get the same
numbers, whatever has been recorded in the meantime. That is what makes the report evidence rather
than a screenshot.

Ask for a period **without** a point in time and you get everything known right now. That is often
what you want, and the report says on its face that it is a live one and will read differently later.

Two things in the report are marked as exceptions to this and carry their own timestamp:

- the comparison shown beside each attestation, and
- the outstanding items, unmatched statement lines and balance checks in the exceptions section.

Each of those has one definition inside the platform — the same one the reconciliation screen uses —
and that definition answers about now. Rather than inventing a second version of it that could quietly
disagree, the report shows the real one and tells you it is a live figure.

**Names are not figures.** If a client is renamed, or an office's details change, a report produced
today and the same report produced next year will show different names against the same numbers. Every
line carries the record's own identifier underneath, so the identity is stable even when the caption
is not.

## The choices you can make

- **Ledgers that were empty all period.** By default they are listed, at zero, so the report accounts
  for every ledger that existed. You can ask for only the ledgers with activity or a balance.
- **Who authorized each payment.** By default the report names the person who authorized money leaving
  a client ledger — the platform records it on every such payment for exactly this reason. You can ask
  for it to be left out.

## When the report will not be produced

The report refuses rather than printing something short or something it cannot stand behind:

- **Too much activity for one document.** A period holding more entries than one report can carry is
  refused, and the answer is to produce the period in parts. A report missing entries with no way for
  the reader to tell would be worse than none.
- **More items outstanding than one reconciliation can account for.** This means the earlier periods
  need reconciling first, so the cleared items leave the list.
- **No governing rules to quote.** The report does not print a rule citation for a place whose rules
  nobody at Magna Carta has researched and had checked by a lawyer. Instead the cover says which of
  those is missing, in plain words, and the rest of the report is produced as normal — the figures are
  the firm's own records and no rule elsewhere changes them.

## Who can run it

Owners and administrators. Reporting has its own set of permissions, separate from the ones that let
somebody read a single client's trust balance: a report across every client and matter at once is a
different thing to be trusted with. A firm that wants its bookkeeper to produce these reports can grant
that directly.

## Related

- [Safe custody register](safe-custody-register.md) — physical originals the firm holds
- [Correcting a bill](correcting-a-bill.md) — credit notes, write-offs and money owed back
