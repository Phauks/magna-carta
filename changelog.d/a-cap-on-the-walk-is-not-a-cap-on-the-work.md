---
category: Changed
audience: internal
---

**A conflicts check now bounds what it writes, not only how far it walks — and the effect batcher's
ceiling stopped being an argument-count accident.** The closure cap stops the traversal at 500
entities and records the stop honestly. The corpus sweep behind this change shows why that is only
half a bound: with the closure pinned, candidates rise linearly with the Directory, so the run's total
is the closure times the corpus and the cap bounds one factor of a product.

**What the sweep found.** Pinning the closure and growing the corpus, candidates per subject came out
at roughly six tenths of the organization corpus for an organization subject and roughly a tenth of the
person corpus for a person — linear in both, seven times steeper for organizations. Around ninety-nine
per cent of the volume is candidates whose ONLY signal is trigram overlap; the phonetic and
blind-index channels are corpus-independent and contribute a near-constant handful. The mechanism is
that a trigram-OR match asks whether two names share ONE three-character window, and multi-word
company names nearly always do. The uneven consequence is worth stating plainly: a firm with a deep
corporate group is fine, and a firm with a large Directory is not — which is the ordinary case.

**The second bound.** `candidateCap` joins `closureCap` on `ConflictsPolicy`, defaulting to 5,000,
overridable per run, and recorded on every check row whether or not it bites. When it does bite, the
check records how many candidates surfaced, how many were written, how many were refused and at which
evidence tiers; the posture read carries it on `latestCheck.scope.candidates`, and the report
statement says in words that the search is incomplete. Strongest evidence is kept — the cap decides
how many, evidence strength decides which — and a co-party surfacing is never refused, because it is a
match on another of the check's own subject parties and dropping one would hide a positional conflict
in the matter being checked. This is a capacity refusal, not a threshold: below the cap nothing is
chosen, nothing is reordered, and nothing is recorded, and the matchers themselves are untouched, so
the equivalence proof that the batched matcher returns exactly the per-entity matcher's hit set still
holds by construction.

**The batcher.** `composeEffectBatch` composed with `push(...effect.statements)`. A spread passes every
element as a separate argument, so the seam every domain writes through had a ceiling set by the
engine's remaining stack — it threw `RangeError: Maximum call stack size exceeded` around 125,000
statements, and the exact number moved with how deep the call stack already was, so the same effect
could commit on one path and abort on another. The spread is gone. In its place is a stated ceiling of
10,000 statements per batch, with a refusal that names the remedy: a batch is one transaction inside
one request, so an oversized effect is bounded at the domain that knows what its rows mean, never
split — splitting would trade the ceiling for a partially committed write. The two bounds compose
mechanically: `candidateCap` is clamped below what one batch can carry, so nothing a firm can store in
its settings row can turn a truncation the platform reports into a check that fails outright.

**Re-measurable.** `conflictsCandidateBounds` in the load profile reports the per-channel candidate
breakdown and the corpus of the subject's own kind, so two baselines taken at different profile scales
are the corpus sweep rather than two unrelated numbers.
