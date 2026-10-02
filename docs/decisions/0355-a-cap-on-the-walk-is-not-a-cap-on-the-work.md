---
number: 355
slug: a-cap-on-the-walk-is-not-a-cap-on-the-work
status: Proposed
date: 2026-08-15
area: Conflicts
summary: "A conflicts check gets a SECOND bound, on candidates, beside the one on the closure, because a measured corpus sweep shows hits scaling as closure times corpus rather than as closure: with the closure pinned, candidates per subject rise linearly with the Directory at roughly six tenths of the organization corpus for an organization subject and a tenth of the person corpus for a person, and about ninety-nine per cent of that volume is candidates whose only signal is trigram overlap. `candidateCap` joins `closureCap` on `ConflictsPolicy` at a default of 5,000, is applied to the similarity channels' output in run-check rather than inside either matcher (so the batched-versus-per-entity equivalence proof stays about the whole answer), keeps the strongest evidence when it must refuse, never refuses a co-party surfacing, and records candidates surfaced, written, refused, and refused-by-tier on the check row where the posture read and the report statement both carry it. A channel-level bound on the trigram query and a cheaper trigram generation were both considered and rejected. Separately, `composeEffectBatch` stops spreading its statement list — an argument-count ceiling around 125,000 that moved with stack depth — and refuses at a stated 10,000-statement ceiling naming the remedy; `candidateCap` is clamped below that ceiling so the two bounds cannot collide. The recommended closure default of 500 is unchanged; what the sweep says needs an owner's decision is the trigram channel's recall, not the cap."
---

**A bound on the walk is not a bound on the work, and the number that needed deciding turned out not
to be the cap.**

**Context.** The traversal work capped the graph closure at a firm-configurable 500 entities and made
the truncation an honest, recorded fact. The same measurement that proved the N+1 removal also showed
a 613-entity closure producing 211,199 candidates. Two things were left recorded rather than fixed:
that the closure cap bounds ENTITIES while the cost it governs is entities times corpus, and that
`composeEffectBatch` threw `RangeError` on the resulting statement list.

**What the sweep measured.** The axis nobody had swept is the corpus with the closure held constant.
Holding the closure at 40 reached entities and growing the organization corpus from 98 to 1,673, the
candidate count went from 1,937 to 31,936 — a 17-fold corpus producing a 16.5-fold candidate set.
Per subject that is 48 candidates rising to 798, or about six tenths of the organization corpus, flat
across the range. The same sweep over person subjects gives about nine hundredths of the person
corpus: linear too, seven times shallower. In every run the phonetic channel returned a
corpus-independent handful (10 to 36 candidates across a 16-fold corpus) and the blind-index channel
returned what the identifiers actually shared. Between 93 and 99.8 per cent of every candidate set was
trigram overlap with no other signal beside it.

The mechanism is not subtle once seen. `buildTrigramOrExpression` ORs every three-character window of
the query, so the predicate is "shares at least one trigram" — and windows like " an", "and", "ing",
"nd " appear in nearly every multi-word organization name. That is the correct setting for the channel's
original job: entry-time duplicate detection has ONE subject, ranks the result, and shows a human the
top of the list. A conflicts check asks the same question of hundreds of subjects at once and turns
every answer into a permanent, reviewer-facing log row.

**Decision.** A second bound, on candidates, at the place that writes them.

`candidateCap` joins `closureCap` on `ConflictsPolicy` with a shipped default of 5,000, overridable
per run and recorded on every check row whether or not it bites. `boundCandidateHits` applies it to
the similarity channels' output in `run-check.ts`. Four rules bind it:

**It is a capacity refusal, not a threshold.** A threshold asks what a candidate's evidence IS and
removes it on that answer at every volume; this package has none and this is not one. Below the cap
nothing is chosen, nothing is reordered, and nothing is recorded — the ordinary check is the check it
was before the bound existed.

**When it must refuse, it keeps the strongest evidence and says what it lost.** The cap decides how
many; evidence strength decides which. Refusing in matcher-iteration order would discard an
exact-identifier match to make room for a name that shares three consecutive characters. The refusal
is recorded per evidence tier precisely so that a run which lost anything above tier 4 is visibly
alarming rather than indistinguishable from one that lost only trigram overlap.

**A co-party surfacing is never refused.** It is a match landing on another of the check's own subject
parties, so refusing one drops a positional conflict inside the matter being checked. Subject parties
bypass the closure cap for the same reason, and the bypass has the same consequence: a co-party set
larger than the cap starts the run already over it and the record says exactly that.

**It sits outside both matchers.** `matchPartyBatch` is held to returning exactly the per-entity
matcher's hit set by a real-corpus equivalence test. A bound reaching into either path would make that
proof a proof about a narrowed answer. Bounding the run's output leaves both matchers byte-identical
and the proof intact by construction — the test needed no change and still passes.

The truncation record travels the same road the traversal record already does: onto the check row's
`inputs_json`, out through `readMatterConflictsPosture` on `latestCheck.scope.candidates`, and into
`describeCheck` as a sentence saying the search is incomplete. A row written before the record existed
reports `null` — "the row does not say" — which is a third state and never flattened into either
other. A run whose cap refused everything deliberately does not end "Nothing surfaced.": that sentence
is a fact about the machine having written everything it found, and such a run did not.

**Considered and rejected.**

**A channel-level bound on the trigram query** — bounding the thing actually generating the volume
rather than its output. Rejected on three counts. It bounds cost rather than the log, and the log is
what a reviewer wades through and what the atomic batch has to carry. It cannot attribute its
truncation: the channel runs once over the whole closure, so a bound there can say that something was
not searched but not for whom, where the run-level bound names counts and tiers. And dropping trigram
rows would remove the trigram EVIDENCE from candidates that other channels also returned, mis-tiering
them — which breaks the equivalence between the two matchers rather than leaving it untouched.

**A cheaper trigram candidate generation, so the volume never exists** — the best option if it were
reachable, and it is not. The volume IS the hit set: "shares at least one trigram" is what the channel
means, and every cheaper predicate (a shared-trigram count, a Jaccard floor, a bm25 cut) returns a
different, smaller set. That is a threshold, in the precise sense this package refuses, and it would
change which hits come back. The queries are already batched to one per channel per kind; there is no
remaining cost to remove without removing recall.

**Leaving it unbounded and raising the composer's tolerance instead** — this is what the failure was
already doing implicitly, and it puts an unbounded quantity inside one request and one transaction.

**The batcher, separately.** `composeEffectBatch` composed with `push(...effect.statements)`. A spread
passes every element as a separate argument, so the shared write seam had a ceiling set by the
engine's remaining stack: reproduced here at 125,274 statements, and moving with call depth, so the
same effect could commit on one path and abort on another. The spread is replaced by a loop, which has
no argument-count bound.

That leaves the real question, and the answer is that a batch that large should not be possible. Every
shipped composer assembles a batch bounded by its domain's own shape — an entry's lines, an invoice's
claims, a merge's repoint set — and only the conflicts run had an unbounded one. A stated ceiling of
10,000 statements is set at the seam, with a refusal naming the remedy: bound the effect at the domain
that knows what its rows mean, never split the batch, because splitting trades the ceiling for a
partially committed write. The number is a policy ceiling rather than a measured platform limit
(locally these commits run about ten microseconds a statement, so ten thousand is already a tenth of a
second of pure commit before any network) and is deliberately an order of magnitude below where the
accident sat, so reaching it means a caller is unbounded rather than merely large. `candidateCap` is
clamped below it, so nothing a firm can store in its settings row can turn a reportable truncation
into an outright failure.

**Consequences.** A conflicts check is now bounded in both dimensions that scale, and both bounds are
recorded rather than applied silently. The write seam has a ceiling a caller can discover, test, and
reason about instead of one that moves.

The cost is that at this profile's shape, a graph-scope check over a real Directory will reach the
candidate bound routinely — the arithmetic is 500 reached entities times six tenths of a 700-strong
organization corpus. The platform will say so every time, honestly, which is the correct behaviour and
also a signal.

**That signal is the finding for the owner, and it is deliberately not acted on here.** The
recommended closure default of 500 is the owner's number and stays. What the sweep says is that the
number needing a decision is not the cap at all: it is the trigram channel's recall. A blocking
channel tuned for a one-subject interactive duplicate check, where a human reads a ranked list, has
been inherited by an engine that runs it over hundreds of subjects and makes every candidate a
permanent hit row a reviewer must dispose of. Narrowing it is a professional-conduct decision about
what the firm's search covers, not a performance decision, and it belongs to the owner.
