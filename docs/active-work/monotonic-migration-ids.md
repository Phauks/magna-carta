# monotonic-migration-ids

**Scope:** Replace sequential `00NN` schema-migration IDs with monotonic UTC-timestamp IDs and collapse the pre-production migration chain (control-plane + per-firm) to one clean baseline per lineage. Design + ADR + implementation plan under `docs/specs/2026-07-03-monotonic-migration-ids-*` and `docs/decisions/pending/`.

**Status:** PLAN written; Phase B (destructive collapse) gated on owner confirmation of the no-firm-onboarded prerequisite + the resolved sub-decisions. Fresh from main.

**Expected files:** `packages/database/drizzle/{control-plane,per-firm}/**` (baseline collapse), `packages/database/src/migration.ts` (loader order key), `tooling/` (generate wrapper + CI uniqueness check), the two `generate-*` package scripts.
