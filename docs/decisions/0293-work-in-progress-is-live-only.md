---
number: 293
slug: work-in-progress-is-live-only
status: Proposed
date: 2026-08-13
area: Reports
summary: "Work in progress, productivity, and realization's standard-value leg are LIVE ONLY and never accept a knowledge instant, because the stores behind them are mutable by design. time_entry and cost_entry are working documents until they freeze at billed or void — bill review is exactly when a firm fixes a narrative or a duration — and they carry a status column, no billed_at, no voided_at, and an amount_minor that is recomputed on an explicit re-rate. So an entry voided today disappears from last month's work-in-progress figure when that figure is re-run, an entry re-rated today changes it, and an entry created today with a backdated work date appears in it: 'unbilled work in progress as of 30 June', asked in August, is not answerable from stored data. Rather than approximate it, these endpoints omit the knownAsOf parameter entirely — accepting it and ignoring it would be the worst of the three options — and stamp computedAt with an explicit non-reproducibility flag that the user documentation explains in one sentence. The named remedy belongs to the slice that owns the stores, not to a reporting layer: billed_at and voided_at stamps on both work-in-progress stores, and re-rate recorded as an append-only adjustment rather than a column rewrite. A period-close snapshot is rejected as the alternative because it is a materialised figure. Profitability is separately not computable at all: no timekeeper cost rate exists anywhere in the schema, rate_card and rate being billing rates only, and it is deferred with its reason rather than approximated from what a client is charged."
---

**A report may not claim an as-of figure over a mutable store, so work in progress, productivity, and
realization's standard-value leg are live and say so.**

**Context:** The bitemporal contract makes ledger-backed reads reproduce, because they sit on
append-only tables with an immutable knowledge column. The work-in-progress stores are the opposite
by design, and correctly so: a time entry stays editable through bill review because bill review is
exactly when a firm fixes a narrative or a duration, and it freezes only at `billed` or `void`. What
that costs a reporting layer is precise:

- `time_entry` and `cost_entry` carry a `status` column and no `billed_at` and no `voided_at`, so
  there is no way to ask what an entry's status *was* on a past date.
- `time_entry.amount_minor` is recomputed on an explicit re-rate, so a past period's value can change
  without any row being added.
- `work_date` and `incurred_date` are freely backdatable, so a period can gain entries after the fact.

Together: an entry voided today leaves last month's work-in-progress figure when it is re-run, a
re-rate moves it, and a backdated entry joins it. The figure is not reconstructable.

**Decision:** Work in progress, productivity, and the standard-value leg of realization are **live
only**. Their endpoints do not accept `knownAsOf` — the parameter is absent from the signature rather
than accepted and discarded — and their responses carry `computedAt` and an explicit
non-reproducibility flag, rendered on the surface and explained in one sentence of user
documentation. Where realization sets a live standard-value leg beside as-of billed, credited and
applied legs, the mixture is labelled rather than blended into one apparently uniform figure.

The remedy is named and belongs elsewhere: `billed_at` and `voided_at` stamps on both
work-in-progress stores, and a re-rate recorded as an append-only adjustment rather than a column
rewrite. That is a change in the slice that owns those stores, where it is cheap, and it is the
build-when-in-the-area case for whoever opens time tracking next.

**Profitability is a separate and harder absence.** No timekeeper **cost** rate exists anywhere in the
schema; `rate_card` and `rate` record what a client is charged, effective-dated and resolved matter →
client → timekeeper → role. Profitability by matter, client, or practice area is therefore deferred
with its reason stated rather than approximated from billing rates, which would produce a number that
looks like margin and is not one.

**Considered and rejected:** **Approximate as-of work in progress from `updated_at`** — it is a live
column with no history, so the approximation would be wrong in an unpredictable direction and would
look exactly like an answer. **A period-close work-in-progress snapshot** — a materialised figure by
another name, refused by the no-materialisation decision, and it would give a firm a stored number
that disagrees with a re-read of the same period. **Accept `knownAsOf` and ignore it** — the caller
would have every reason to believe the figure reproduces. **Add the stamps from this slice** — a
reporting slice writing schema onto the work-in-progress stores would put those columns outside the
package whose lifecycle rules maintain them, and the freeze contract lives in
`@magna-carta/billing-core`.

**Consequences:** Three of the reports in this surface are honestly weaker than the bar-audit pack,
and the difference is visible to the reader rather than buried. The gap has a named, cheap fix in a
package that is not this one, and a report will pick it up the day it lands without any change to
the reporting contract — a live read that gains a knowledge axis is an addition, not a rewrite.
