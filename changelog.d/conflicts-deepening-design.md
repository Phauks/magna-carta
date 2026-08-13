---
category: Added
audience: internal
---

Conflicts 4·1 deepening — the design for trigger coverage and search depth, answering the owner's
"both gaps" scope call. Design only: a spec, a five-slice implementation plan, and six ADR fragments.
No application code, no schema, no migration.

**The framing decision comes first, and everything else inherits it.** The platform may assert facts
about its own search — these channels ran, this source has no corpus, this traversal was truncated at
500 entities, nothing surfaced — and never a fact about the world. It does not say a matter is
conflict-free. Slice 1 is that posture made mechanical: one derived per-matter read (latest check with
its scope verbatim, the shortfall between that scope and the firm's **current** policy, pending
re-check causes, undisposed counts by tier, unavailable sources, and a never-checked state distinct
from checked-and-nothing-surfaced), with no aggregate and no field named `clear`, `passed`, or
`status`, held by a `lint:conflicts-vocabulary` fitness function modelled on the shipped custodian
lint. Staleness is derived at read time, never written onto a record — the posture the calendar holds
for an overdue deadline.

**Trigger coverage becomes an event-driven re-check ledger.** Seven corpus write points — party
linked, entity merged, entity renamed, edge created, identifier added, matter created, matter opened —
plus personnel change and a cron cadence each commit **one outbox row** in the batch they were already
composing; nothing heavy runs in a request handler. A request consumer resolves the affected matter
set in one bounded query and writes `conflicts_recheck_request` rows; a separate run consumer drains
them under a budget, coalescing every cause accumulated for one matter into one check that names them
all. The ledger exists so a pending re-check is visible before it is satisfied, so work is bounded
without being dropped, and so the interval between a corpus change and the check that answered it is
on the record — which is what a reasonable-procedures defence actually turns on. The **non-triggers**
are decided too and stated as decisions: entity creation alone (an import storm with no possible new
hit), party removal, disposition, matter close, and a policy raise all deliberately fire nothing.

**Search depth splits into its two real axes.** Traversal gains a budget per edge class — corporate
family transitive at zero cost, control/family/representation one hop each — plus a closure cap, with
every stop recorded: reaching the cap writes `expansion_truncated` with the frontier size, so a
truncated expansion is never reported as a completed one. Expired edges are traversed with the expiry
on the path (Rule 1.9 is about former relationships), and degree-based hub suppression is refused in
favour of an attributable firm marking that stops traversal _through_ an entity while still matching
it. Matching gains two derived columns beside the frozen `normalized_display` — `normalized_match_key`
(ampersand and legal-form spelling canonicalized, legal form preserved: `Smith & Jones LLP` and
`Smith and Jones, L.L.P.` match at **tier 2**) and `normalized_match_key_bare` (legal form removed:
LLP versus LLC surfaces at **tier 3**, a question rather than an equation) — plus Beider-Morse as a
third phonetic scheme at over-inclusive strictness. The tier CHECK is deliberately not widened;
widening one rebuilds a growing append-only table.

**Uncertainty is where the design spends its judgement.** A re-surfaced hit may cite an earlier
conclusion and may never inherit one: `answered-before` requires byte-identical evidence and any
strengthening makes it a fresh question, bulk affirmation writes one **real** disposition row per hit
naming the **affirming** member, and two structural layers stop the machine concluding anything — a
source-scan fitness function fails the build if a re-check consumer imports `disposition.ts`, and a
trigger refuses a disposition whose reviewer is not a live member.

The N+1 goes in the same slice as the traversal widening rather than after a measurement — one query
per node table and one per blocking channel over the whole expanded set, with an equivalence test
against the per-entity matcher as the correctness proof — because widening depth without batching
would put thousands of queries in one invocation.

Twelve questions are flagged rather than decided, each shipping as a firm setting with a recommended
default: the balanced band's name-role breadth, lateral-hire imputation, re-scan cadence, the
carry-forward default, tiered disposition authority, the traversal numbers, expired-edge traversal,
notification escalation, firm-marked non-expandable entities, whether a policy raise forces a
re-scan, whether a matter may be refused opening on undisposed tier-1 hits, and a signable engagement
memorandum. Every one changes what the platform asserts about a firm's ethical position, which makes
it the owner's call and not the design's.
