---
number: 316
slug: a-measurement-branch-measures-and-does-not-fix
status: Proposed
date: 2026-08-14
area: Performance
summary: "Custodian and calendar get load-profile volume profiles sized from the numbers their own designs state — two thousand packets over a twenty-year history span for custodian, and a decade of unevenly-spread litigation events with one matter deep in every federated source for calendar — and the branch that adds them changes no query. Both subsystems scale as designed except for one shared root cause, which the numbers make unmissable: the `custodyDueBack` predicate plans through `custody_movement_item_index` for `item_id IS NULL` rather than through the partial due-back index built for it, so a read whose answer is the 91 packets currently out walks 32,723 movements with a correlated most-recent-check-out subquery. It costs 16.2 ms of a 17.3 ms matter timeline page — every other source on that page costs between 0.03 ms and 0.21 ms — and 15.3 ms of the standalone overdue sweep. The reviews-due sweep has the same shape through the status index. Two smaller findings: the member-filtered calendar read is slower than the unfiltered window it narrows, because the participant EXISTS resolves through a single-column `member_user_id` index and filters `event_id` inside it, so its cost tracks how many events the member is on; and the register list has no index covering its `(created_at, id)` sort, so it materializes and sorts. The firm-wide window's nine scanning sources — the question the calendar design left explicitly to this measurement — are real but second-order at this corpus. A fix in the same change would have made every number in the committed baseline unattributable."
---

**A branch that measures and a branch that optimizes are two changes, and a baseline can only witness
one of them at a time.**

**Context:** Golden rule 10 makes the load-profile harness the standing baseline for the whole program,
and every domain slice extends it in-area while the slice is open. Custodian and calendar shipped
without doing so. That left two subsystems with real query surfaces and nothing to regress against —
and the two whose data shapes are least forgiving: custodian holds a physical-item hierarchy that a
recursive query walks, and the calendar's timeline is a federated read that issues one statement per
registered source per page. A tree walk that is fine at ten nodes and an N+1 hiding inside a fan-out
are precisely the failures a baseline exists to catch, and precisely the failures no unit test does.

Volumes were taken from what each design claims rather than from round numbers. Custodian's design
states its scale in the body of the document — low thousands of packets, a handful of items each, one
to two movements per packet per year, held for decades, read across twenty years of history, with two
hundred movements as the tail of the distribution — and names the six operations to measure. The
calendar's two designs state theirs in the same place, down to the shape of the firm's own scope (a
year of weekly meetings entered as individual rows, because recurrence is not built and a firm types
one row per week until it is) and the five-node continuance chain. Neither design left the scale to be
guessed, which is the reason to read the design before choosing a number.

**Decision:** Add the two profiles, the two generators over the real write paths, the two measured
sets with their EXPLAIN probes, the smoke wiring, and one regenerated committed baseline — and change
no query, even where the plan says one should change.

The reason is not caution. It is that a baseline is evidence, and evidence about two changes at once
is evidence about neither. A number that moved between v12 and v13 because two thousand packets and a
decade of events arrived is a number a reader can interpret. A number that moved because the corpus
arrived AND a query was rewritten in the same commit is a number nobody can attribute afterwards — and
the next person, wanting to know whether the index helped, would have to rebuild the corpus without it
to find out. The follow-up gets a clean before-and-after against a baseline that already exists, which
is the whole reason to pay for the baseline first.

**Most of both subsystems is boring, and that is the result.** Every custody read except two sweeps
sits between 0.08 ms and 1.0 ms at two thousand packets and thirty-eight thousand ledger movements.
The recursive subtree walk — the read the custodian design singled out as the one with a genuinely
non-obvious plan, and the reason it left the materialized-path-versus-closure-table question to a
measurement — is 0.22 ms over a 498-node tree and plans as index seeks on both arms. On this evidence
the recursive common table expression is the right shape and neither alternative is warranted. Keyset
pagination holds on both subsystems: a packet's history page at the tail of the distribution is
0.18 ms, and page 20 of a deep matter timeline is FASTER than page 1 (10.6 ms against 17.3 ms),
because the cursor narrows every source's range.

**One root cause dominates everything, and it is the same query in two places.**

`custodyDueBack` — "what went out and is due back" — filters on `custody_movement.item_id IS NULL`,
`kind = 'checked_out'`, `due_back_on IS NOT NULL`, and the packet still being out. The schema carries
a partial index built for exactly that (`custody_movement_due_back_index` on `due_back_on`, where the
kind and the null check already hold), and the planner does not use it: it walks
`custody_movement_item_index` for `item_id IS NULL`, which selects **every packet-scoped movement the
firm has ever recorded** — 32,723 of the 38,711 rows here — and evaluates a correlated
most-recent-check-out subquery over them. The answer is **91 packets**. Cost tracks the ledger; the
ledger is the one table in this subsystem that grows without bound, and the design said so before any
of this was measured.

It costs **16.2 ms of a 17.3 ms matter timeline page**, where every other source costs between 0.03 ms
and 0.21 ms — so a case timeline is, today, ninety-four percent one custody predicate — and **15.3 ms**
of the standalone overdue sweep. The shallow-matter timeline costs the same 17.1 ms as the deep one,
which is the tell: the page's cost is not the matter's depth, it is this. The reviews-due sweep has
the same shape more mildly (2.3 ms), walking the packet status index rather than the partial
review-date index, so its cost tracks the held population rather than what is due.

**Two smaller findings.**

**The member-filtered calendar read is slower than the unfiltered window it narrows** — 8.6 ms over
three sources against 18.6 ms over fifteen, but 12.1 ms of the unfiltered 18.6 ms is `custodyDueBack`,
so on like-for-like the filter makes `matterEvent` about a hundred times more expensive than the same
window without it. The filter composes as two correlated per-row lookups, and the participant arm
resolves through a single-column `member_user_id` index and then filters `event_id` inside it — so
each candidate event pays a walk proportional to how many events that member is on. Halving the
member's participation share halved the read, which is the confirmation. A composite
`(member_user_id, event_id)` index makes it a seek.

**The register list has no index for its sort.** `custody_packet` is ordered by `(created_at, id)`
descending on every page, and no index covers that ordering, so the plan carries a temporary B-tree
and materializes its matches before the LIMIT. Under the owner filter that is bounded by one owner's
holdings and costs 0.08 ms today. Unfiltered it is the whole register, sorted, on every page — which
is what keyset pagination exists to make impossible.

**The firm-wide window scans nine of fourteen sources**, which is the answer to the question the
calendar design explicitly left to this measurement. Every source is indexed on `matter_id` first
because a case timeline is what they were built for; a read with no matter in scope has nothing to
seek, so the date window applies over the whole table — and `time_entry` and `cost_entry`, the two
densest sources in the platform by row count, carry no index on their date columns at all. It is real
and it is second-order: those scans cost single-digit milliseconds at this corpus and the read's
headline number is `custodyDueBack`. Matter timelines are clean — all fourteen sources seek. The
exemption list in the measurement module names the nine by hand rather than by prefix, so a source
added later is gated at both scopes until somebody looks at its plan, and a source that gains a
date-keyed index comes off the list in the change that gives it one.

**The verdict this evidence supports is not the rebuildable read model.** The design offered it as the
escape hatch if the firm-wide window measured badly, and the window does measure worst — but its cost
is one predicate that a better index fixes, not federation itself. Federation's own bound holds
exactly: fifteen statements for fourteen sources, 371 rows read to return 50, against a ceiling of
765.

**Also decided: a baseline states its machine.** The harness has always held that its numbers are
relative — comparable across commits on one machine, meaningless across two — but the committed file
could not say which machine produced it, so the discipline lived only in a comment. The baseline now
carries the node version, platform, architecture, processor model, core count, and memory. It also
carries the federated read's statement and row counts beside the timings, because those are the
witnesses a timing cannot be: a per-row lookup added inside a projection changes no plan and, at any
corpus a test can afford, no measurable duration.

**Consequences:** The profile version bumps to 13, renaming the baseline file and invalidating every
cached snapshot — full regeneration is the cost of the change and is paid once. The harness stays a
deliberate command: nothing here runs in `pnpm test` except the existing CI smoke at its 0.002
multiplier, which the new floors keep generatable. Three follow-ups are now specified by evidence
rather than by suspicion, and each has a baseline to prove itself against.
