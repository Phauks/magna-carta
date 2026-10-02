---
number: 291
slug: nothing-is-materialised-for-a-report
status: Proposed
date: 2026-08-13
area: Reports
summary: "No rollup table, no cached total, no period snapshot. The invoice derives its total rather than storing one, a trust balance is a sum over dated ledger lines, dormancy is a comparison rather than a column, and overdue is derived at read time and never written — the whole financial core is organized against stored derived figures, and a reporting layer that materialised one would reintroduce exactly the drift the rest of the subsystem was built to prevent, in the surface a regulator reads. Every aggregate is computed in SQL rather than by pulling rows into the Worker (the shape the existing aging read already documents and defends against), and per-row sections stream in effective-date order rather than buffering. The reads are bounded by account and period and served by ledger_line_account_id_index and ledger_entry_effective_date_index, which already exist. The one honest weak point is named rather than hidden: a journal over a trust bank account drives from the account index and filters dates as a residual, so a long-lived account reads more lines than the period needs. If the load profile says that matters, the remedy is a DENORMALIZATION rather than a materialisation — a copy of effective_date onto ledger_line, written by the ledger package inside the posting batch so a composite (account_id, effective_date) index can drive the read. That duplicates an immutable column of the same row's parent and can never drift, which is categorically different from storing a computed balance; it is not built now, and measuring it is part of the first sub-slice."
---

**No figure is stored for the benefit of a report, and the performance relief that may eventually be
needed is a denormalization of an immutable column rather than a cached total.**

**Context:** Golden rule 10 says measure before optimizing, and a reporting layer is where the
temptation to pre-compute is strongest: the reads are aggregate, the periods are historical, and the
same month is asked for repeatedly. But this financial core is unusually deliberate about not
storing derived state. The invoice header carries no `total_minor` and no `balance_minor`, so a
payment has no reason to touch it and cannot drift from the subledger. A trust balance is a sum over
dated ledger lines, and the three-way proof computes every leg from those rows rather than from
`account_balance`, precisely so a period reproduces. Overdue is derived at read time and never
written. Dormancy is a comparison a caller states, not a column. A materialised report figure would
be the one stored derived number in the subsystem, and it would sit in the surface a regulator reads.

**Decision:** No rollup table, no cached total, no period snapshot, no materialised view. Every
aggregate is computed in the database and returned as a handful of rows — the shape the existing
accounts-receivable aging read already argues for at length, against the alternative of streaming
every finalized invoice into the Worker and adding it up there. Per-row sections (client ledgers, the
journal) stream in effective-date order rather than buffering. Reads are bounded by account and
period, and served by indexes that already exist.

The weak point is stated rather than hidden. A journal over a trust bank account joins `ledger_line`
by account to `ledger_entry` for the dates, so SQLite drives from `ledger_line_account_id_index` and
filters the dates as a residual; over a long-lived account that reads more lines than the period
needs. Measuring it is a task in the first sub-slice, against the load profile's trust volume at one
month and at twelve.

If the measurement demands relief, the remedy is a **denormalization**: a copy of `effective_date`
onto `ledger_line`, written by the ledger package inside the posting batch, enabling a composite
`(account_id, effective_date)` index. That duplicates an immutable column of the same row's parent —
both are written once, in one batch, and neither is ever updated — so it cannot drift. A stored
balance can. The distinction is the whole of this decision, and it is what keeps the door open
without opening it.

**Considered and rejected:** **A monthly rollup table maintained by the daily cron** — fast, and it
introduces a figure that can be stale, can be wrong after a backdated posting, and would have to be
reconciled against the ledger by a fitness query, which is the ledger read it was meant to avoid.
**Caching produced report payloads in KV** — the produced artifact already serves the "give an
examiner the same document again" case, immutably and with a content hash; a cache serves the
"render the same period twice cheaply" case, which nobody has measured wanting.
**A period-close work-in-progress snapshot**, to give work in progress an as-of it otherwise lacks —
it is a materialised figure by another name, and the honest answer to that gap is stamps on the
work-in-progress stores in the slice that owns them, not stored numbers here.
**Building the denormalization now, on the build-when-in-the-area principle** — that principle covers
seams and columns that are expensive to retrofit; this index is cheap to add later and golden rule 10
governs it, so it waits for the measurement that is already scheduled.

**Consequences:** Every number the reporting surface prints is a live read of the ledger's own rows,
so there is no second place for a figure to be wrong. The cost is that a slow report is slow rather
than quietly stale, and the first sub-slice carries a measurement task whose result may open an ADR
of its own.
