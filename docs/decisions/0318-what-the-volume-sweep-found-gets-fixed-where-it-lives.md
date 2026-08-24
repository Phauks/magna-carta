---
number: 318
slug: what-the-volume-sweep-found-gets-fixed-where-it-lives
status: Proposed
date: 2026-08-14
area: Performance
summary: "The four findings the custodian and calendar volume profiles named are answered, each against the baseline that change committed. The largest was diagnosed as a wrong index choice and is not one: `custodyDueBack` and the register's overdue sweep read the movement ledger first and joined the packet to it, so the planner's only choices were the partial due-back index and `item_id IS NULL` — and 32,723 of 38,711 movements matched the latter, each paying a correlated most-recent-check-out subquery, to answer the 91 packets that are out. Driving both statements from the packet instead costs no index at all and takes the standalone sweep from 15.30 ms to 0.24 ms and a matter timeline page from 17.34 ms to 1.74 ms. Making the partial index reachable would have been the wrong fix: it would have narrowed the outer scan from 32,723 rows to 7,312 and left the correlated subquery running once per row."
---

**A plan that names the wrong index is sometimes telling you the query is driving from the wrong
table, and adding an index would then make the wrong shape permanent.**

**Context:** The change that added volume profiles for custodian and calendar deliberately fixed
nothing, so that a number which moved because the corpus arrived stayed distinguishable from a number
which moved because a query was rewritten. It named four findings and left them, each with a
committed baseline to be proved against. This is that follow-up. Every diagnosis below was
re-confirmed with `EXPLAIN QUERY PLAN` against the same profile corpus before anything changed, and
every candidate fix — including the ones rejected — was timed against it.

**Decision: the largest finding is a query defect, not a missing index, and it is fixed without one.**

`custodyDueBack` on the timeline and `selectOverdueCustodyCheckoutsStatement` in the register are the
same question written twice: which packets went out and are due back. Both put `custody_movement` in
the outer position and joined `custody_packet` to it. That leaves the planner choosing between two
predicates on the ledger — the hand-written partial index on `due_back_on`, and `item_id IS NULL` —
and it takes `item_id IS NULL`, which selects every packet-scoped movement in the firm's history
(32,723 of 38,711 rows here) and then evaluates the correlated most-recent-check-out subquery once
per matched row. The answer is 91 packets.

The diagnosis handed to this change was that the partial index is unusable because it says nothing
about `item_id`, and that widening its predicate would let the planner reach it. That is an accurate
reading of the plan and the wrong fix. Widening the index narrows the outer walk from 32,723 rows to
the 7,312 movements that are check-outs carrying a due-back date — and leaves a correlated subquery
running once for each of them, to produce 91 rows. It treats the symptom the plan names rather than
the reason the plan is shaped that way.

The reason is that **the selective fact lives on the packet, not on the ledger**. A firm has tens of
packets out at a time; the ledger grows for as long as it holds any of them. So both statements now
drive from `custody_packet` — `status = 'out'` is one seek returning 91 rows — and reach the movement
through the subquery that picks it out, one indexed seek per packet. `kind` and `item_id` are stated
only inside that subquery: a row it returns satisfies both by construction, so repeating them in the
outer `WHERE` filtered nothing and was exactly what offered the planner the worse entry. Equivalence
was proved row-for-row against the old statement over the whole corpus rather than argued.

Costs **no index**, and it retires two. Nothing reads `custody_movement` by `item_id` and nothing
seeks it by `due_back_on` — every other read goes by `id`, by `packet_id`, or by the date window — so
`custody_movement_item_index` and the partial `custody_movement_due_back_index` had no reader left.
The first had never had one; it was pure write cost on the subsystem's largest table, and an
attractive nuisance that cost this read three orders of magnitude.

**Decision: the member filter's participant lookup gets the composite index, and the single-column
one it subsumes is dropped.** The `EXISTS` behind "what is on my calendar" supplies both `event_id`
and `member_user_id`, but only `matter_event_participant_member_index (member_user_id)` existed, so
each candidate event paid a walk proportional to how many events that member is on.
`(member_user_id, event_id)` makes it a covering seek: 8.06 ms to 0.14 ms. The single-column index is
a strict prefix of the new one and is dropped in the same change, so the table carries the same
number of indexes it did before and the write cost is one marginally wider entry. Widening the
existing `(event_id)` index to `(event_id, member_user_id)` was measured too and is indistinguishable
(0.14 ms); it was rejected because it would have removed the ability to seek by member alone, which
the composite keeps for no extra cost.

**Decision: the register list gets its sort index.** `custody_packet` is ordered by
`(created_at, id)` on every page and no index covered it, so every page — including every keyset page
— was a full table scan into a temporary B-tree, which is the one thing keyset pagination exists to
make impossible. `created_at` and `id` are both immutable, so the index is written once per packet
created and never on the status and location updates that every movement makes. The absolute saving
is small at this corpus (0.32 ms to 0.09 ms on page 1, 0.42 ms to 0.07 ms on page 2) and the shape is
the point: the cost of a page no longer depends on how many packets the firm holds.

**Decision: the firm-wide window gets one index of the nine it could have, and the other eight are
declined with their numbers written down.** With the timeline sources timed individually, the 31-day
firm window decomposes as: `custodyDueBack` 4.67 ms (now 0.32 ms, above), `custodyMovement` 3.59 ms,
`documentFiled` 1.70 ms, `custodyReviewDue` second arm 1.57 ms, `documentAssembly` 1.49 ms,
`matterLifecycle` 0.43 ms, and nine more between 0.02 ms and 0.20 ms.

Only `custody_movement` earns an index, and it earns it on a growth argument rather than on its
current 3.59 ms: it is the one table in the platform that grows without bound by design — a firm holds
originals for decades and appends to their ledger the whole time — so a firm-window read that walks
all of it gets slower forever. It is also append-only, which makes a `(occurred_at, id)` index
insert-only: one B-tree insert per movement a person physically records, which is not a hot write
path by any measure. 3.67 ms to 0.15 ms.

The other eight are declined. `file`, `time_entry`, `cost_entry`, `email_matter_link`,
`document_assembly`, `conflicts_check`, `trust_movement`, and `matter_deadline` are between them the
platform's hottest write paths, and each contributes at most 1.70 ms to one read that the calendar's
own design names as federation's weakest. Nine indexes on nine constantly-written tables to save
about 5 ms on that one read is the wrong trade, and taking it would also spend the evidence that is
supposed to decide whether a projected read model is ever built. `file` behind `documentFiled` is the
one to revisit first, because the document corpus grows fastest — but with a measurement at that
corpus, not now. The scan allowlist keeps naming the rest by hand, so none of them is forgotten.

**Consequences:** No profile parameter changes, so the profile version and the baseline filename stay
at v13 — the corpus is byte-identical and the numbers are directly comparable to the ones the
measuring change committed. The migration adds three indexes and drops three, leaving
`custody_movement` with one fewer index than it had. Two findings from the sweep are deliberately not
addressed: the reviews-due sweep's 2.2 ms (it walks the packet status index rather than the partial
review-date index, the same family of problem at a twentieth of the cost), and the identical
participant `EXISTS` on `firm_event_participant`, which measures 0.04 ms because a firm has tens of
firm events rather than thousands. Both are recorded here so that neither is rediscovered as new.
