---
category: Added
---

**Totals across a repeating collection in a template.** `sum`, `minimum`, and `maximum` now work across
the items of a list — `{{= sum(matter.parties.amount)}}` — so a settlement statement or a schedule of
disbursements can carry its own total, earliest date, or largest amount. The calculation names the
collection and the field it wants, and nothing else: it cannot filter, sort, or work anything out
per item, and it costs the assembly exactly what a repeating block over the same collection costs.
Money totals are integer-exact through `@magna-carta/money` and still refuse to cross currencies;
a total of money is money, and the earliest of a column of dates is a date. Which fields can be
totalled is settled when the template is registered, so a total of a name or of a yes-or-no is named
then rather than at assembly time. **A collection with no items leaves the answer blank rather than
printing zero** — as does an item with nothing on file for the field — because the smallest of nothing
has no answer and a total of no amounts has no currency; ask `isEmpty(collection)` first, or supply a
fallback with `default(…)`, when a template means "nothing on file means nothing owed".
