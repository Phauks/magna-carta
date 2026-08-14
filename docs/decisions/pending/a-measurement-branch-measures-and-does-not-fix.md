---
slug: a-measurement-branch-measures-and-does-not-fix
status: Proposed
area: Performance
date: 2026-08-14
summary: "Custodian and calendar get load-profile volume profiles sized from the numbers their own designs state — two thousand packets over a twenty-year history span for custodian, and a decade of unevenly-spread litigation events with one matter deep in every federated source for calendar — and the branch that adds them changes no query. Three findings the profiles surfaced are recorded and left: `custody_packet` carries no index on its `(created_at, id)` sort key, so the register list materializes and sorts rather than walking a keyset; the overdue check-out sweep and the reviews-due sweep both plan through an index chosen for the wrong predicate, giving them a cost that tracks the whole movement ledger and the whole held-packet population rather than the size of their answers; and the firm-wide 31-day timeline window scans nine of its fourteen sources, because every source whose only useful index is keyed on matter_id has nothing to seek when there is no matter. The last of these is the answer to a question the calendar design left explicitly to this measurement. A fix in the same change would have made every number in the committed baseline unattributable — a baseline that moved because the corpus arrived and a baseline that moved because a query was rewritten are indistinguishable once both land together."
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

**Three findings, recorded and left.**

**The register list has no index for its sort.** `custody_packet` is ordered by `(created_at, id)`
descending on every page of the register, and no index covers that ordering — so the plan carries a
temporary B-tree and the read materializes its matches before applying the LIMIT. Under the owner
filter that is bounded by one owner's holdings and costs nothing today. Unfiltered it is the whole
register, sorted, on every page, which is what keyset pagination is supposed to make impossible.

**Two sweeps plan through the wrong index.** The overdue check-out sweep's most selective predicate is
`kind = 'checked_out' AND due_back_on IS NOT NULL`, which the schema already carries a partial index
for — and the planner instead walks `custody_movement_item_index` for `item_id IS NULL`, which selects
every packet-scoped movement the firm has ever recorded. The reviews-due sweep does the same thing in
its own way, walking the status index rather than the partial review-date index, so its cost tracks
the number of packets the firm holds rather than the number due. Both are reads whose answer is small
and constant while their cost grows with a table that never stops growing, which is the failure the
custodian design named as its own worst case before any of this was measured.

**The firm-wide window scans nine of fourteen sources**, and that is the answer to a question the
calendar design explicitly left to this measurement. Every source is indexed on `matter_id` first
because a case timeline is what they were built for; a read with no matter in scope has nothing to
seek, so the date window is applied over the whole table — and `time_entry` and `cost_entry`, the two
densest sources in the platform by row count, carry no index on their date columns at all. Matter
timelines are clean: all fourteen sources seek. The exemption list in the measurement module names the
nine by hand rather than by prefix, so a source added later is gated at both scopes until somebody
looks at its plan, and a source that gains a date-keyed index comes off the list in the change that
gives it one.

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
