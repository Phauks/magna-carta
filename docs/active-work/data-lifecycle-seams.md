---
branch: data-lifecycle-seams
worktree: C:/dev/magna-carta (primary)
area: GDPR data-lifecycle seams — data-subject attribution + erasure registry, and per-firm residency (region) seam
status: designing
touches: NEW docs/specs/2026-07-02-data-subject-attribution-erasure-residency-design.md, docs/decisions/pending/subject-level-erasure-dsar.md + data-residency-firm-region-seam.md (Proposed→Accepted), later NEW packages/data-access pii/erasure registry + fitness function, packages/database control-plane migration (firm.data_region), apps/worker firm-provisioner + firm-resource-provider + firm-database-proxy (region threading)
---

Realizes the two GDPR data-lifecycle gaps from the compliance control baseline as **cheap-now seams**, deferring the heavy machinery. Track A: a declarative PII/erasure registry (sibling to `PROTECTED_COLUMNS` and `merge.ts:REPOINT_TARGETS`) + a fitness function so no PII-bearing table can silently escape subject attribution; the `eraseDataSubject` orchestrator is designed but deferred to before EU launch. Track B: a `data_region` column on the control-plane `firm` table threaded through provisioning (R2 jurisdiction + firm-database DO jurisdiction), set once at provisioning, no cross-region moves; the `eu` path is Cloudflare-supported, Canada flagged open.

Currently at the design/spec stage — no code yet. When building, the cross-cutting touch points a concurrent stream should know: a new control-plane migration slot (`firm.data_region`), edits to `firm-provisioner.ts` / `firm-resource-provider.ts` / `firm-database-proxy.ts` (region threading through the DO addressing chokepoint — coordinate if you touch firm addressing), and a new registry the directory/matters PII schema must register into. Gate cross-cutting edits on `vp run worktrees` + a `main` sync.
