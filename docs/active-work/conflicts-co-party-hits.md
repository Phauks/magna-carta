# conflicts-co-party-hits

**Scope.** Follow-up to slice 4·1: resolve the cross-party positional-conflict question by *surfacing*
co-party matches (a check's search landing on another of its own subject parties) flagged distinctly,
rather than dropping them. Only a self-match (entity vs itself) is still dropped.

**Files touched.**

- `packages/conflicts/src/run-check.ts` — flag `coParty` on hits instead of filtering seed matches
- `packages/conflicts/src/statements.ts` — thread `coParty` through the hit insert
- `packages/database/src/per-firm-schema.ts` + `drizzle/per-firm/20260717T181411_conflicts-hit-co-party.sql` + `meta/_journal.json` — `co_party` column
- `apps/worker/src/per-firm-migrations.ts` — register the migration
- `apps/worker/src/routes/conflicts.ts` — expose `coParty` on the hit response; re-emitted OpenAPI + client
- tests, `packages/conflicts/CLAUDE.md`, `changelog.d/`, `status.d/slice-4-1-conflicts.md`
- load-profile: `directory-generate.ts` seeds a deterministic identically-named co-party pair;
  `conflicts-measurements.ts` adds a `conflicts.co-party-check` measurement that surfaces a flagged
  hit; `GENERATOR_VERSION` 5→6; smoke test proves a `co_party = 1` row is written; baseline regenerated

UI still deferred.
