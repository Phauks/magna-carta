---
category: Changed
audience: internal
---

**The conflicts graph walk is now budgeted per kind of relationship rather than by one integer, it
stops at a recorded closure cap instead of running unbounded, and it costs a number of queries that
follows the channel count rather than the entity count. The rule that carries the change is that a
truncated expansion is never reported as a completed one.**

**One integer could not express the question.** "Follow a company's rename and merger chain as far as
it goes" and "do not walk from a spouse to her employer's other directors" are different instructions,
and the shipped `depth` answered both with the same number because it could not tell them apart. The
traversal now spends a budget per **edge class** — corporate family (transitive, no hop cost),
control, family, representation — each a firm setting with the design's recommended default of one
hop, each resolved per run and recorded verbatim on the check row. The shipped `depth` request field
and column both keep working: supplying `depth` sets every budgeted class to that number, which is
exactly what it always meant, and the column now carries the widest resolved budget so a reader of it
alone is never told the traversal was shallower than it was. A stored firm policy that predates the
typed budgets keeps its own `defaultDepth` for every class rather than falling back to the shipped
default — falling back would silently narrow the search for precisely the firms that widened it.

**The cap, and the sentence that makes it acceptable.** Corporate-family edges cost no hops, so a real
holding structure can put thousands of entities in one closure; a bound has to exist. The per-run
closure cap (firm-set, recommended default 500) is that bound, and it is never applied silently. On
reaching it the walk stops and the check records **that it was truncated**, the caps in force, the
entities it reached, how many further entities it had discovered and refused to admit, and how many
entities it did match but never expanded from. The posture read carries the record; the report
statement says in words that the search of the graph is incomplete. A check row written before the
record existed reads `traversal: null` — "the row does not say" — which is a third state and is never
flattened into either of the other two. This is the depth analogue of the shipped rule that a source
recording `unavailable` never reads as searched and clean, and it fails the same way if broken: the
platform telling a firm it looked somewhere it did not look.

**Degree-based hub suppression is refused, and the refusal is in the code.** Skipping any node with
more than N edges is the obvious way to keep a closure small and it silently narrows the search — a
clearing bank on five hundred matters is exactly where a positional conflict lives. The bound is on
the SIZE of the closure, where reaching it is a recordable fact, never on the SHAPE of the graph,
where stepping around a hub leaves nothing on the record at all. A test holds it.

**Ended relationships are traversed.** A divorced spouse or a subsidiary sold last year is walked, not
skipped, and the path step carries `expiredAtCheck` so the reviewer weighs it — the rules that most
often decide a conflict are about _former_ clients and _former_ relationships, so a walk that stopped
at currency would drop the dimension they turn on. Expiry is judged against the check's own clock
rather than an ambient wall-clock read, so a long walk cannot hold two opinions about when a
relationship ended.

**The N+1 goes in the same change as the widening, not after a measurement.** Widening a traversal
without batching would have regressed the shipped load profile on the first deep corporate group: the
per-entity path is one or two subject reads plus four matching queries **per reached entity**, which
at a 500-entity closure is roughly 2,500 queries in one invocation. Now there is one subject-facts
read per node table over the whole closure, one batched edge read per traversal round rather than one
per node, and each blocking channel run once over the whole closure — phonetic, trigram, blind-index,
and the exact-name probe — with per-subject attribution kept exact rather than approximated. Every
set-valued read chunks at D1's hundred-parameter cap, so the count is proportional to channels times
ceil(entities / 100) and not to entities times channels.

**Proved, not asserted.** The batched matcher is held to returning _exactly_ the per-entity matcher's
hit set — same entities, same evidence, same tiers, at both strictness levels — over a real migrated
corpus carrying sound-alike surnames, typo variants, an exact-name twin, a name-mismatched identifier
twin, former and alias name rows, a merged-away subordinate resolving to its master, a mononym too
short for trigrams, and organizations alongside persons. A performance change to a conflicts engine
that alters which hits come back is not a refactor; it is a missed conflict. The per-entity path is
kept as the thing the batch is measured against, and a second test counts prepared statements on both
paths so an accidental read inside a loop fails the build rather than waiting for a corpus large
enough to show up in a timing.

**Batching the trigram channel naively is slower than not batching it, and the harness caught that
too.** The union query returns each candidate once, but re-deriving "does this candidate share a
trigram with this subject" inside the per-subject loop is quadratic in subjects times candidates. The
union's rows become an inverted trigram-to-entities index once instead — the shape the phonetic
channel already had — and attribution is a union over each subject's own trigrams. On the same corpus
that took a 613-entity closure from 5,684ms to 394ms for the same 211,199 candidates. Query count is
the right target because a D1 query is a network round trip, but a batch that trades round trips for
quadratic arithmetic has moved the cost rather than removed it.

**Measured.** The load profile gains a deep corporate group — a twelve-deep successor lineage with a
six-hundred-wide subsidiary fan, sized past the default cap on purpose — plus a complete deep-graph
run, a deliberately truncating run, and a statement-count bound on the batched matcher printed beside
the timings.

**Two findings the harness produced, recorded rather than fixed under this change's cover.**

The design says "the candidate set the channels return is still bounded by blocking", and over
multi-word ORGANIZATION names it is not. The trigram channel matches on any shared three-character
window, and company names share " an", "and", "nd ", "inc", "llc" with nearly every other company
name, so each reached organization returns most of the organization corpus as candidates. Nothing is
suppressed — that is the no-threshold rule, and it is right — so **hit rows scale as closure size
times corpus size**, not as closure size. The closure cap therefore bounds the wrong quantity. The
recommended default of 500 ships as designed, because the number is the owner's, but it ships beside
this finding rather than in place of it.

And the second, which is how the first was noticed: at that scale `composeEffectBatch` in
`packages/data-access/src/effect-batch.ts` fails on `statements.push(...effect.statements)` with
`RangeError: Maximum call stack size exceeded`. A spread argument list has a hard engine ceiling, so
the shared batch composer has an undocumented upper bound on statement count that applies to every
domain composing a large batch. Not this change's seam to fix.

The load-profile measurements consequently run at closure caps of 40 and 15, with the reasoning
stated at the constant, so the harness measures the traversal rather than the engine's argument
limit. The gap between those numbers and the shipped default is the size of the finding.

**Not in this change, and deliberately.** The three flags that decide what the platform asserts about
a firm's ethical position are the owner's and are untouched: whether the balanced band searches
former, maiden and alias names; whether an imputed conflict follows a lateral hire and whether a
screen cures it; and whether a matter may refuse to open over undisposed hits. The firm-marked
non-expandable-entity mark needs a Directory write path and belongs with the slice that owns it.
