# subject-erasure-orchestrator

**Scope:** Build the `eraseDataSubject` orchestrator — the GDPR Art. 17 / CCPA deletion cascade that
Track A designed-but-deferred (the PII/erasure registry is the seam it traverses). Backend capability
only (no UI): the orchestrator function, a controller-facing `directory:eraseSubject`-gated API route,
the erasure certificate (audit_log + inline return), and the residue report. Both subject axes
(entity + user). Synchronous, single atomic per-firm-DO batch (all erasable PII is D1; files are
retained under matter). No new table, no schema migration.

**Files expected to touch:**

- `packages/data-access/src/erase-subject.ts` (new — the orchestrator) + tests
- `packages/data-access/src/pii-registry.ts` (possibly: mark indirect subject keys; add
  `audit_log.subject_id` to pseudonymize-keep)
- `packages/access-control` (new `directory:eraseSubject` permission in the fixed registry)
- `apps/worker/src/routes/` (new erase-subject route) + OpenAPI contract regen + api-client regen
- `apps/worker` route/permission conformance tests

Design: `docs/specs/2026-07-03-subject-erasure-orchestrator-design.md`
(builds on `docs/specs/2026-07-02-data-subject-attribution-erasure-residency-design.md`).
