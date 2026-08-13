---
category: Added
audience: internal
---

Slice 3·6 — financial and trust-compliance reporting: the specification and implementation plan for
all four report families, with the bar-audit pack sliced first per the owner's scope answer. No
product code in this cycle.

**The reporting surface is a projection layer, not a subsystem.** It adds no money concept and no
new assertion about a firm's compliance. Every quantity it prints is classified: owned elsewhere and
therefore **called** rather than reimplemented (`computeTrustThreeWayProof`,
`selectTrustClientLedgerTotalAsOfStatement`, `readAccountsReceivableAging`,
`readContingencyResidual`); a decomposition of one of those, which ships with a fitness test asserting
it sums to its aggregate over the load-profile fixture book; or genuinely new — counts, ratios,
hours — which is deliberately the only class that touches no money the ledger has an opinion about.
Nothing recomputes the three-way reconciliation: a closed period prints its frozen attestation
verbatim, and where the live proof now differs both appear labelled, never a third figure.

**Reproducibility is bitemporal, on columns that already exist.** A ledger-backed read takes
`(periodStart, periodEnd, knownAsOf)` and filters `effective_date` for the period and `recorded_at`
for what was known. Both columns sit on append-only tables and are never updated, so the triple names
a pure function of rows that cannot change. A single-axis read filtered only on `effective_date`
would let a reversal posted next month with a backdated effective date change last month's answer
after somebody signed it — the exact failure ADR-0246 froze the reconciliation to prevent. Omitting
`knownAsOf` is legal, means now, and produces a **live** result stamped `computedAt` and explicitly
not claimed to reproduce. Reproducibility covers **figures**: display names, entity merges,
letterhead and jurisdiction citations are mutable captions carried beside stable ids, and the pack
says so in its own words.

**Read-only is four checkable mechanisms rather than an intention.** A purity fitness function over
`@magna-carta/reporting`'s own sources (modelled on the custodian stocktake's, non-vacuity assertion
included) rejecting write SQL and every composer import; GET-only routes with a conformance assertion
that the namespace declares exactly one non-GET; a `reports:*` permission namespace granting reads
only, seeded to Owner and Admin, with a registry assertion that no `reports:` key reaches a write
path's guard; and the one write named out loud — producing a pack writes an append-only
`report_production` row, an outbox message, and a File Manager version, all composed by the route and
the queue consumer, never by the package.

**Nothing is materialised.** No rollup table, no cached total, no period snapshot — the financial core
is organized against stored derived figures and a reporting layer would be the one place they
reappeared. The honest weak point is named: a journal over a trust bank account drives from
`ledger_line_account_id_index` and filters dates as a residual. If the load profile says that matters,
the remedy is a denormalization of `effective_date` onto `ledger_line`, written in the posting batch —
an immutable column duplicated from the same row's parent, which cannot drift — and not a cached
balance.

**Three things the ledgers cannot currently support are named rather than approximated.** Work in
progress, productivity, and realization's standard-value leg are **live only**: `time_entry` and
`cost_entry` are mutable working stores with a `status` column, no `billed_at`, no `voided_at`, and an
`amount_minor` recomputed on re-rate, so an as-of work-in-progress figure is not reconstructable —
those endpoints omit `knownAsOf` entirely rather than accept and ignore it, and the named remedy is
stamps in the slice that owns the stores. **Profitability** is not computable at all: no timekeeper
cost rate exists anywhere in the schema. **A firm-wide operating position** waits on slice 3·5's chart
of accounts, which is not on `main`.

Six ADR fragments; nine questions flagged for the owner, none of which blocks the first sub-slice.
The load-bearing flag: ethical walls are a deferred seam, and whether a firm-wide financial total
includes a walled matter's money (complete, but the residual leaks that balance by subtraction) or
excludes it (nothing leaks, and the total no longer ties to the reconciliation) changes what the
platform asserts about a firm's books. The trust-compliance pack is settled either way — it is never
screened, because a partial one is not evidence — and every response carries a completeness
declaration from the first sub-slice so the later answer is a field's value rather than a redesign.
