# data-lifecycle-seams

**Scope:** GDPR/PIPEDA data-lifecycle seams. Track A (data-subject attribution + PII/erasure
registry) is merged to main. **Track B (active): per-firm `data_region` residency seam** — a
control-plane `firm.data_region` column threaded through provisioning so a firm's storage can be
pinned to a jurisdiction (`eu` = hard Cloudflare EU jurisdiction on R2 + firm-database Durable
Object; `us` = North-America placement, the default). Set once at provisioning; no cross-region
moves. DO call-site threading is a deferred activation step (no `eu` firm exists yet).

**Files expected to touch (Track B):**

- `packages/database/src/data-region.ts` (new) + `packages/database/package.json` (subpath export)
- `packages/database/src/control-plane-schema.ts` (+ `firm.data_region` column) + its drizzle
  control-plane migration + `meta/_journal.json`
- `apps/worker/src/control-plane-migrations.ts` (wire the new migration)
- `apps/worker/src/firm-resource-provider.ts` (thread region into R2 bucket creation)
- `apps/worker/src/firm-provisioner.ts` (read `data_region`, pass to `createBucket`)
- `apps/worker/src/firm-database/firm-database-proxy.ts` (jurisdiction-capable `firmDatabaseFor`)
- `changelog.d/firm-data-region.md`

Plan: `docs/specs/2026-07-02-firm-data-region-residency-implementation-plan.md`.
