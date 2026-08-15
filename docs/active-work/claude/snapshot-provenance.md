# claude/snapshot-provenance

**Scope.** Correct the `snapshotId` provenance recorded for the three Anthropic catalog entries, and make
the class of error self-detecting. All three carried an identical fabricated `-20260101` suffix; the
provider publishes no dated form for Opus 4.8 or Sonnet 4.6 (their dateless ids are themselves the pinned
snapshot), and Haiku 4.5's real dated id is `-20251001`. The field is written into every per-request
provenance record, so a wrong value is a record that answers "which model produced this" with a snapshot
that never existed. Does not change which models are selected — that stays the owner's call.

**Files expected to touch**

- `packages/inference/src/catalog.ts` — the three snapshot values, a recorded `snapshotForm`, and the
  schema refinement that makes a form/id contradiction fail at module load
- `packages/inference/src/model-pin-freshness.ts` — name the snapshot id among the lifecycle facts
  `availabilityVerifiedOn` covers
- `packages/inference/test/` — fixtures gain the new field; a fitness case for the new invariant
- `packages/inference/CLAUDE.md`
- `roadmap.d/ai.md` — the `ai.inference.model-catalog` node this changes
- `changelog.d/`, `docs/decisions/pending/` — fragments only

**Not touched.** `gateway.ts` (it reads `entry.snapshotId` and keeps doing exactly that — the shape does
not change), `port.ts`, `stub.ts`, `reasoning-tier.ts`, `settings.ts`, any worker composition root, any
UI. No model is switched; no tier moves.

**Overlap watch.** `roadmap.d/ai.md` is the one shared file. `packages/inference/` overlaps with the
just-merged `claude/model-pin-rot` stream (#240), which is already on `main` — this branch is cut from
`origin/main` after it. Nothing here edits `CLAUDE.md`, `STATUS.md`, `ROADMAP.md`, the white paper, or
`docs/conventions/`.
