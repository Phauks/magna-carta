---
number: 354
slug: a-truncated-conflicts-search-says-so
status: Proposed
date: 2026-08-15
area: Conflicts
summary: "Conflicts graph traversal is budgeted per edge class (corporate family transitive at no hop cost; control, family and representation one hop each by default) rather than by one depth integer, and bounded by a per-run closure cap defaulting to 500 entities — both firm-configurable settings, both resolved per run and recorded verbatim on the check row. The load-bearing rule is that reaching the cap stops the walk and makes the check record that it was TRUNCATED, with the entities reached, the caps in force, the refused frontier, and the reached-but-unexpanded count; the posture read carries it and the report says in words that the search of the graph is incomplete, so a truncated expansion is never reported as a completed one — the depth analogue of the shipped rule that `unavailable` is never `searched and clean`. Degree-based hub suppression is refused: the bound is on the SIZE of the closure, where reaching it is recordable, never on the SHAPE of the graph, where stepping around a hub leaves nothing on the record. Expired edges are traversed with the expiry carried on the path step, judged against the check's own clock. The N+1 is removed in the same change rather than after a measurement — one subject-facts read per node table over the whole closure, one batched edge read per traversal round, and each blocking channel run once over the closure — and the batched matcher is gated by an equivalence test proving it returns exactly the per-entity matcher's hit set over a real corpus before the per-entity path is retired."
---

**A bound on a conflicts search is acceptable only if the search says when it hit one. Everything else
in this decision is downstream of that sentence.**

**Context.** The shipped traversal was a correct 0-1 breadth-first walk with one integer budget:
corporate-family edges cost nothing and were therefore transitive **and unbounded**, every other edge
type cost one hop against `depth`, default 1. Two problems, of different kinds.

The first is expressive. One integer cannot say "follow a company's rename and merger chain as far as
it goes, but do not walk from a spouse to her employer's other directors". Both are hop counts and
they are not the same instruction, so a single number answers one of them wrongly whichever value it
takes. "Configurable search depth" has therefore never meant anything precise.

The second is that an unbounded transitive class over a real corporate group is an availability
problem, and the obvious fixes are all worse than the problem. Capping the corporate class by hops
misses exactly what the corporate class exists to find — a successor entity ten renames down is the
same legal person. Skipping high-degree nodes narrows the search invisibly. Doing nothing puts a
thousand-entity closure inside one queue invocation, and at four matching queries per entity that is
several thousand queries in one run.

**Decision.**

**Budgets are per edge class.** `corporate` (`corporate_parent`, `corporate_subsidiary`,
`corporate_successor`) stays transitive at zero hop cost. `control` (`affiliation`), `family`
(`relationship`), and `representation` (`representation`, `role_assignment`) each carry their own
budget, firm-configurable, recommended default one hop. An edge type this build has never heard of —
the column admits any non-empty string — takes the **widest** budget in force rather than the
narrowest, because a new relationship type that quietly became unwalkable is a conflict the engine
stopped looking for without anybody choosing that. Cost is a vector, and relaxation is Pareto over the
vector rather than over its sum: collapsing to a sum would let a path that has spent its whole family
budget look cheaper than one that spent two control hops and can still walk a family edge, which drops
real conflicts silently. The shipped `depth` request field and column keep working exactly — supplying
`depth` sets every budgeted class to that number, and the column records the widest resolved budget so
a reader of it alone is never told the traversal was shallower than it was.

**The cap is on the size of the closure, and reaching it is recorded.** A per-run closure cap, firm
setting, recommended default 500. On reaching it the walk stops and the check records `truncated`
together with the entities reached, the caps in force, the count of distinct entities it discovered
and refused to admit (never matched), and the count of entities it did match but never expanded from
(so what lies beyond them is unknown). Those last two are kept apart because they are different facts
and one number would destroy the distinction. `readMatterConflictsPosture` carries the record on the
latest check's scope; `describeCheck` states in words that the search of the graph is incomplete. A
row written before the record existed reads `null` — "the row does not say" — which is a third state,
distinct from both "completed" and "truncated", and is never flattened into either.

**Degree-based hub suppression is refused, permanently.** Skipping any node with more than N edges is
the obvious optimization and it is the failure mode this whole subsystem exists to prevent: a clearing
bank or a registered agent on five hundred matters is precisely where a positional conflict lives, and
a search that steps around it has narrowed itself with nothing on the record to say so. The asymmetry
is the whole argument — a size cap produces a recordable fact ("this walk stopped at 500 and 137 more
were reachable"), and a shape heuristic produces silence. The refusal is stated inline in
`expansion.ts` where the temptation is, and held by a test.

**Expired edges are traversed**, with the expiry on the path step, judged against the check's own
clock rather than an ambient wall-clock read. The rules that most often decide a conflict are about
*former* clients and *former* relationships, so a walk that stopped at currency would drop the
dimension they turn on. The platform surfaces the expiry; weighing it is the reviewer's.

**The N+1 goes in the same change as the widening.** Not after a measurement, because it is the
foundation the cap stands on rather than an optimization of it: widening the traversal without
batching regresses the shipped load profile on the first deep corporate group encountered. One
subject-facts read per node table over the whole closure; one batched edge read per traversal round
rather than one per node; each blocking channel run once over the closure. Per-subject attribution
stays **exact** rather than approximate — the phonetic channel projects the matching code, the
identifier self-join projects the subject side, and the trigram channel returns each candidate's own
`normalized_display` so the per-subject share test is re-run over the rows the union already narrowed
to (an OR-of-trigrams matches a document exactly when they share one, so the union of the per-subject
expressions is the expression over the union of the trigrams). Every set-valued read chunks at D1's
hundred-parameter cap.

**The batched matcher is gated by an equivalence test.** It must return exactly the per-entity
matcher's hit set — same entities, same evidence, same tiers, at both strictness levels — over a real
migrated corpus carrying every shape the channels distinguish, and the per-entity path is kept as the
thing it is measured against. A performance change to a conflicts engine that alters which hits come
back is not a refactor; it is a missed conflict, which is a professional-conduct failure rather than a
latency regression.

**Considered and rejected.**

**A hop cap on the corporate class**, to bound the closure the same way as everything else. It misses
the successor entity at the end of a long rename chain, which is the single case the zero-cost
treatment exists for.

**Degree-based hub suppression** — above. It is the cheapest fix available and the one this decision
most needs to refuse by name, because it will be proposed again by anyone reading a slow deep-graph
measurement.

**A scalar (summed) cost with per-class caps checked at the end.** Simpler to write, and wrong: it
prunes a path that is expensive in total but still admissible in the class it needs to spend next.

**Recording the truncation in `scope_json`.** That column is parsed as a source-to-availability map
and a non-availability value there is silently dropped by the defensive reader, so a truncation record
would have been written and never read. It rides `inputs_json` instead, which is already the free-form
record of what the run took as input and is already read defensively — so no conflicts table is
touched, no CHECK is widened, and no migration is claimed.

**Waiting for a measurement before batching.** The design says to build it in-area and it is right:
the measurement that would justify it is a firm's check timing out, and the corpus that produces it is
a real holding company.

**Consequences.** A firm can set how far each kind of relationship is followed and how large one
check's closure may grow, and every check says which values it ran under. A check that hit the cap
says so in the posture read and in the report; a check written before the record existed says the row
does not say, rather than implying completeness it cannot support. The deep-graph load profile gains a
twelve-deep successor lineage with a six-hundred-wide subsidiary fan sized past the default cap, a
complete deep-graph run, a deliberately truncating run, and a statement-count bound on the matcher
printed beside the timings — so the complexity claim is a number rather than an argument.

**Batching the trigram channel naively is slower than not batching it, which the harness also caught.**
The union query returns each candidate once, but re-deriving "does this candidate share a trigram with
this subject" inside the per-subject loop is quadratic in subjects times candidates — on a
six-hundred-entity closure that arithmetic cost four times what the saved queries were worth against
a local database. The union's rows are turned into an inverted trigram-to-entities index once
instead, which is the shape the phonetic channel already had; attribution is then a union over each
subject's own trigrams. The measured effect on the same corpus was 5,684ms down to 394ms for the same
211,199 candidates. Query count was never the problem to solve on its own: it is the right target
because a D1 query is a network round trip, but a batch that trades round trips for quadratic
arithmetic has moved the cost rather than removed it.

**What the harness found, which the design did not anticipate and which the owner should see.** The
design says "the candidate set the channels return is still bounded by blocking". Over multi-word
ORGANIZATION names that is not true. The trigram channel matches a document sharing any single
three-character window, and company names share " an", "and", "nd ", "inc", "llc" with almost every
other company name, so each reached organization returns most of the organization corpus as
candidates. Nothing is suppressed — that is the no-threshold rule and it is right — so hit rows scale
as **closure size times corpus size**, not as closure size. Against this profile's shape (a
six-hundred-entity corporate group over a seven-hundred-organization corpus) a walk at the
recommended default cap of 500 composes several hundred thousand INSERTs into one batch, and
`composeEffectBatch` in `packages/data-access/src/effect-batch.ts` — which spreads its statement list
into `Array.prototype.push` — throws `RangeError: Maximum call stack size exceeded` before it gets
there.

Two separate facts, and neither is fixed here. The batch composer has an undocumented upper bound on
statement count, which belongs to whoever owns that seam. And the closure cap governs the wrong
quantity: it bounds entities, and the cost that actually matters is entities times corpus. The
recommended default of 500 is shipped as designed because the number is the owner's (flag F6), but it
is shipped alongside this finding rather than in place of it. The load-profile measurements run at 40
and 15 with the reasoning stated at the constant, so the harness measures the traversal rather than
the engine's argument limit, and the gap between those numbers and the shipped default is the size of
the finding.

The standing cost is a second matcher implementation to keep in step with the first. That is a real
maintenance obligation and it is deliberate: the per-entity path is the equivalence test's reference,
so deleting it would delete the proof. A channel added to one path must land in the other in the same
change, with the equivalence corpus extended to exercise it, and the area `CLAUDE.md` says so.

**Not decided here.** The three professional-conduct flags — whether the balanced band searches
former, maiden and alias names, whether an imputed conflict follows a lateral hire and whether a
screen cures it, and whether a matter may refuse to open over undisposed hits — remain the owner's and
are untouched by this change. The firm-marked non-expandable entity, which is the *recorded and
attributable* alternative to the hub heuristic refused above, needs a Directory write path and is left
to the slice that owns those files; until it exists, the only bound on a hub is the closure cap, and
the closure cap reports itself.
