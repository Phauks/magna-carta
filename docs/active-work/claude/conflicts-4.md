# claude/conflicts-4 — conflicts deepening slice 4 (matching depth)

**Scope.** The name half of conflicts search depth, per the `## Slice 4` section of
[`docs/specs/2026-08-13-conflicts-deepening-implementation-plan.md`](../../specs/2026-08-13-conflicts-deepening-implementation-plan.md)
and its design. Slices 1-3 are merged; this builds on what shipped.

- Two additive organization match keys on `directory_name` (`normalized_match_key`,
  `normalized_match_key_bare`) with their write path, indexes and a resumable backfill.
- The two match-key channels as probes in the conflicts matcher (tier 2 and tier 3), on both the
  single-subject and the batched path.
- Beider-Morse was built and then removed: measured at 20,377 ms of workerd CPU on the first request
  that loads its rule tables, against 16 ms in Node. Not shippable in a Worker; the recall it would
  buy is recorded in the decision fragment and the follow-on now carries a numeric flip condition.
- The nickname equivalence catalogue, registered and shipped empty.
- Name-role breadth as an explicit firm setting recorded on the check row (owner flag F1 — the
  mechanism ships, the recommended default ships as a setting, the flag stays open).

**Out of scope.** Slice 5 (adjudication read models, the report artifact — owner flags F4/F5). All UI.

## Files this stream expects to touch

- `packages/directory/src/` — `match-key.ts`, `nickname.ts`, `name-index-backfill.ts` (new);
  `statements.ts`, `fitness.ts`, `types.ts`, `index.ts`, `CLAUDE.md`
- `packages/conflicts/src/` — `matching.ts`, `evidence.ts`, `types.ts`, `settings.ts`, `sources.ts`,
  `run-check.ts`, `report-text.ts`, `posture.ts`, `CLAUDE.md`
- `packages/database/` — one per-firm migration, `src/per-firm-schema.ts`, the refreshed snapshot,
  `test/schema-conformance.test.ts`
- `packages/data-access/src/pii-registry.ts` — the nickname catalogue, classified as holding no personal data
- `packages/fixtures/src/load-profile/` — the matching-depth measurements
- `apps/worker/src/scheduled.ts` — the backfill on the daily pass
- `docs/user/`, `roadmap.d/conflicts.md`, `status.d/slice-4-1-conflicts.md`, `changelog.d/`,
  `docs/decisions/pending/`

## Overlap notes

`packages/directory/src/` is owned exclusively by this stream for its duration, as the plan's slice
ordering requires. The conflicts matcher is touched additively only: `matchParty` and
`matchPartyBatch` gain the same two channels in the same change, so
`test/matcher-equivalence.test.ts` keeps proving the two return one hit set.
