---
category: Added
audience: internal
---

**The matter's Costs tab is the ledger that was designed for it**, ported from the owner's own
surface rather than approximated from a description of it. What stood there was a read-only
six-column table; what was designed is a working ledger, and the difference was never a smaller
version of the same thing.

Eleven columns with the grid's own sorting, filtering, hiding, reordering, pinning, resizing,
selection and totals. A four-figure footer — advanced, recoverable, billed, absorbed. A details panel
with three faces: the matter's own summary with its largest payees, a single cost with its standing,
its chain and its memo, and a multi-selection that counts what can be submitted or approved and
excludes voids from the amount it names. Recording and editing a cost, with the sentence that says
what the class and billing choice will mean. The review queue walker, kick-back, void, the print
sheet, and a problem report that reaches the real incidents endpoint.

It is wired to the costs API that already existed rather than to fixtures: listing, create, patch,
submit, approve, kick back and void, with the directory search behind the payee picker and the
expense-code catalogue behind the code labels.

**Where the screen cannot show something, it says which fact is missing rather than rendering an
empty cell.** The listing projection drops five columns the table already knows how to draw —
`receipt_file_id`, `kick_back_reason`, `invoice_id`, `created_at`, `created_by` — so entry number,
date entered, entered by, receipt, the kicked-back reason, and the invoice a billed cost rides are
each marked as not served. That is one projection change with no migration behind it, and it is the
single largest gap between this screen and the design it came from.
