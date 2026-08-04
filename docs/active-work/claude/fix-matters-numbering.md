---
branch: claude/fix-matters-numbering
worktree: C:/dev/magna-carta-worktrees/claude-fix-matters-numbering
area: Matter numbering — the draw's uniqueness backstop and the open/close lifecycle guards
status: review
touches: packages/matters, packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm, apps/worker/src/per-firm-migrations.ts, apps/worker/src/routes/matters.ts, apps/worker/openapi/openapi.json, packages/api-client/src
---

# claude/fix-matters-numbering

**Branch:** `claude/fix-matters-numbering` · **Off:** main (eb55221) · **Owner:** Trevor Goldsmith · **Started:** 2026-08-04

## Scope

Two correctness defects in matter numbering plus the adjacent matter-lifecycle guards in the same
files. No new feature surface; one additive per-firm migration; no OpenAPI request/response change
(one route description and one refusal code mapping only).

1. **The number draw's uniqueness backstop did not cover the general race.** The guarded counter
   increment is a no-op for the loser (a zero-row UPDATE is not an error), so the draw relied on the
   `matter_number` UNIQUE index to abort the losing batch. That index sees only the rendered string:
   when the active scheme carries a variable segment that is not marked scoping (client code, staff
   initials, matter-type code), two draws in one counter scope render different strings from the same
   counter value and nothing fires. The new per-firm `matter_number_allocation` table records
   `{scope_key, drawn_value}` as a composite primary key, so the losing batch aborts on the value
   itself and the existing bounded retry re-reads the advanced counter.
2. **`openMatterStatement` was unguarded.** Its precondition is a read, and D1 has no interactive
   transaction, so a concurrent open (or a close) landing in between let the second writer rewrite an
   already-open matter's frozen number, `numbered_at`, and `opened_at`. The UPDATE now carries
   `AND status = 'prospective'`, and the service confirms after the commit that the row really carries
   the number this call drew — a mismatch is a named `matter-not-prospective` refusal (409).

Adjacent fixes taken while in these files: `closeMatter` refuses an already-closed matter (new
`matter-already-closed` code → 409) with `AND status != 'closed'` as the in-batch belt, so a recorded
close date never moves; `renumberMatter` records the displaced number in its audit metadata and change
event.

## Files I expect to touch

- `packages/matters/src/{matter-service,matter-statements,validation,audit}.ts`,
  `packages/matters/src/numbering/counter-statements.ts`
- `packages/database/src/per-firm-schema.ts` + the generated per-firm migration
  (`drizzle/per-firm/20260804T072255_matter-number-allocation.sql`, journal, snapshot)
- `apps/worker/src/per-firm-migrations.ts` (register the migration),
  `apps/worker/src/routes/matters.ts` (refusal-code mapping + one route description)
- `apps/worker/openapi/openapi.json` + `packages/api-client/src` (re-emitted: one route description
  changed, no schema change)
- tests: `packages/matters/test/{matter-service,counter-statements,schema-name-sync}.test.ts`,
  `packages/database/test/{matters-files-schema,schema-conformance}.test.ts`
- `changelog.d/fix-matters-numbering.md`,
  `docs/decisions/pending/matter-number-allocation-ledger.md`, `packages/matters/CLAUDE.md`

## Coordination

Cross-cutting files touched: the per-firm drizzle journal + a new snapshot, and
`apps/worker/src/per-firm-migrations.ts`. Both are append-only here — the journal gains one entry at
the next `idx` and the migration map one key; a concurrent stream adding its own migration merges by
keeping both entries and renumbering `idx` monotonically. `packages/database/src/per-firm-schema.ts`
gains one table and touches no existing one. No other registered stream is in
`packages/matters` or in the matters routes.
