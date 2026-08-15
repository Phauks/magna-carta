---
branch: claude/closure-and-batch-bounds
worktree: .claude/worktrees/closure-and-batch-bounds
area: The two bounds the traversal slice found and recorded — a candidate bound on the conflicts run, and the effect batcher's undeclared ceiling
status: building
touches: packages/conflicts/src/, packages/conflicts/test/, packages/data-access/src/effect-batch.ts, packages/data-access/test/effect-batch.test.ts, packages/fixtures/src/load-profile/conflicts-measurements.ts, changelog.d/, docs/decisions/pending/
---

Both findings the traversal slice recorded with evidence, measured and then fixed.

- **The closure cap bounds the wrong quantity.** The cap bounds the WALK; the cost it governs is the
  walk times the corpus. The corpus sweep (closure pinned, corpus grown) is in
  `packages/fixtures/src/load-profile/conflicts-measurements.ts` as `conflictsCandidateBounds`, and it
  shows candidates growing linearly in the corpus with the closure constant, ~99% of the volume coming
  from the trigram channel alone. A second bound — `candidateCap` on `ConflictsPolicy`, applied in
  `run-check.ts` after matching — bounds what one check writes, with the same honest truncation record
  the closure cap already carries. The matcher is untouched, so `test/matcher-equivalence.test.ts`
  still proves the hit set unchanged by construction.
- **The effect batcher's undeclared ceiling.** `composeEffectBatch` spread its statement list into
  `Array.prototype.push` and threw `RangeError` somewhere in the low hundreds of thousands — an
  argument-count accident whose exact value moved with the remaining stack. The spread is gone, and
  the ceiling that replaces it is a stated one that names what to do.

**Overlaps to watch:** `packages/fixtures/src/load-profile/` (`claude/conflicts-traversal`,
`claude/load-profile-gap`), `changelog.d/` and `docs/decisions/pending/` (fragments, so append-only).
`packages/data-access/src/effect-batch.ts` is a shared seam every domain composes through — the change
there is one loop and one refusal, and every existing caller's batch is orders of magnitude under it.

**For the owner, not edited here.** The recommended closure default of 500 stays. What the sweep
actually says is that the number needing a decision is not the cap but the trigram channel's recall:
it is a BLOCKING channel tuned for a one-subject interactive duplicate check, and the conflicts engine
turns each of its candidates into a permanent reviewer-facing hit row for hundreds of subjects at once.
