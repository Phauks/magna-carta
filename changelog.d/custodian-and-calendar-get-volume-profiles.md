---
category: Added
audience: internal
---

Custodian and calendar now have load-profile volume profiles, so the two subsystems that shipped
without a measurement baseline have one.

Every other built subsystem extends the standing harness in-area; these two were missed, and the miss
mattered because both have adversarial data shapes. Custodian holds a physical-item hierarchy walked
by a recursive query, and the calendar's matter timeline is a federated read that unions fourteen
sources per page — a tree walk and an N+1 are exactly what those two shapes hide. The profile version
bumps to 13, which renames the committed baseline and invalidates every cached snapshot by design.

**The volumes come from the designs, not from round numbers.** Custodian's design states its scale
directly — low thousands of packets, a handful of items each, one to two movements per packet per
_year_, held for decades and read across twenty years of history, with one packet at two hundred
movements as the tail. The profile is two thousand packets over a twenty-year span, so a packet's
ledger depth is its age times the movement rate and the movement table (the only one here that grows
without bound) is filled by the SPAN rather than by the packet count. The calendar's two designs state
theirs the same way: a long-tailed distribution of matters by timeline depth with one matter
deliberately deep in every federated source at once, events spread unevenly across a decade with a
dense recent window, several hundred open deadlines with a realistic overdue fraction, a year of
weekly firm events entered as individual rows, eight resources across two offices with a deliberate
overlap fraction, and one hearing continued four times.

**Nine custody measurements and eight calendar ones**, each riding the real production query — the
register list by owner and by location subtree, the recursive subtree walk on its own, occupancy, the
packet detail assembly, the overdue and reviews-due sweeps, a keyset-paginated history page taken at a
real second-page cursor, a custody number draw; and page 1 against page 20 of a deep matter timeline,
a shallow timeline beside it, the firm-wide 31-day window, the member-filtered firm calendar,
availability, the overlap check, and the continuance chain read.

**The calendar's assertions are counts, not only timings.** A federated page reports the statements it
issued and the rows it read, and the smoke test asserts the bound the design names — one statement per
selected source, rows read within `sourceCount × (pageSize + 1)`, and strictly fewer sources on a
member-filtered read than on the same window unfiltered. A per-row lookup added inside a projection
changes no plan and, at a small corpus, no duration; it changes those counts.

**Baselines now record the machine they came off.** The numbers are relative by construction — they
decide regressions on one machine and mean nothing across two — and until now the file could not say
which machine, so a reader diffing two baselines could not tell a regression from a different laptop.
The baseline carries the node version, platform, architecture, processor, core count, and memory, plus
the federated read's counts.

**Most of both subsystems is boring, which is the good outcome.** Every custody read except two sweeps
sits between 0.08 ms and 1.0 ms at two thousand packets and thirty-eight thousand ledger movements;
the recursive subtree walk the custodian design flagged as its least predictable read is 0.22 ms and
seeks on both arms, so neither a materialized path nor a closure table is warranted on this evidence.
Keyset pagination holds on both: a packet's deep history page is 0.18 ms, and page 20 of a deep matter
timeline is faster than page 1.

This is a measurement change and deliberately not a fix. What it found is recorded where the plans are
taken: one predicate (`custodyDueBack`) plans through the wrong index and costs 16.2 ms of a 17.3 ms
matter timeline page and 15.3 ms of the overdue sweep, walking 32,723 movements to answer 91; the
member filter's participant lookup costs about a hundred times the same window unfiltered; the
register list has no index covering its sort; and the firm-wide window scans nine of its fourteen
sources. Each gets its own change, against the baseline this one commits.
