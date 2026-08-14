---
category: Fixed
audience: internal
---

**A case timeline was ninety-four percent one custody predicate, and the predicate was reading the
wrong table first.** The volume profiles committed alongside the custodian and calendar measured sets
named it without fixing it; this is the fix, proved against that baseline.

`custodyDueBack` — "what went out and is due back" — and the register's own overdue check-out sweep
are the same question asked twice. Both were written with the movement ledger as the outer table and
the packet joined to it, which left the planner two predicates on `custody_movement` to choose
between: the partial index built for `due_back_on`, and `item_id IS NULL`. It took `item_id IS NULL`,
which matches every packet-scoped movement the firm has ever recorded — 32,723 of 38,711 rows in the
profile corpus — and evaluated a correlated most-recent-check-out subquery over all of them. The
answer is the 91 packets that are actually out.

Both statements now drive from **the packet**. "Still out" is the selective fact — a firm has tens of
packets out against a ledger that grows for as long as it holds them — so the read seeks those
packets and asks each one for its latest check-out, one indexed seek per packet. `kind` and `item_id`
are asserted only inside the subquery that picks that movement out; stating them again in the outer
`WHERE` filtered nothing and was precisely what offered the planner the worse way in. Same rows, same
predicates, same reasons — proved row-for-row against the old statement over the whole corpus.

Measured on the profile corpus, against the committed baseline and with no schema change at all:

| Read                             | Before   | After    |
| -------------------------------- | -------- | -------- |
| `custody-overdue.sweep`          | 15.30 ms | 0.24 ms  |
| `timeline.matter-page-1`         | 17.34 ms | 1.74 ms  |
| `timeline.matter-shallow-page-1` | 17.14 ms | 1.29 ms  |
| `timeline.matter-page-20`        | 10.60 ms | 1.31 ms  |
| `timeline.firm-window-31-day`    | 18.58 ms | 14.97 ms |

The shallow matter costing what the deep one cost was the tell that the page's cost was never the
matter's depth, and it is the number that moves furthest. The federated read's own bounds are
unchanged — thirteen statements over twelve sources, 180 rows read to return 50 — so nothing here
traded a statement count for a timing. `custodyDueBack` comes off the firm-window scan allowlist in
the same change, because it no longer scans.
