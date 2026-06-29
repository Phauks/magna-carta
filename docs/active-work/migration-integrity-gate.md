# migration-integrity-gate

**Scope:** add a standing fitness function over the generated drizzle migration artifacts — the structural-integrity, apply-from-zero, and destructive-rebuild guards that a parallel-branch merge can violate and that the existing content tests can't see.

**Files touched:**
- `packages/database/test/migration-integrity.test.ts` (new) — the fitness function; reuses `loadMigrationsFromDisk`/`applyMigrations`; pure validators unit-tested both directions.
- `docs/active-work/migration-integrity-gate.md` (this note).

**Status:** built + verified (12/12 green via `vp test run`, node pool, ~0.5s). Local branch, not pushed. Full `vp check` (fmt/lint/type) not run locally — CI/pre-push authoritative.

**Notes:** complements `packages/database/test/generated-migrations.test.ts` (per-migration content). `REVIEWED_REBUILDS` baselines the 6 table-rebuilds present on main as of 2026-06-29; a new rebuild must be audited and added there.
