# claude/custodian-destruction-c8-catalog

**Scope.** Custodian 4·2·4: the two-person destruction workflow over the existing
`custody_destruction_request` table, the ratified C4–C11 flag wiring (C4 depth cap, C5 ownership-role
catalog validation, C6 advisory-only matter-close notice), and the C8 jurisdiction-keyed
will-deposit-duty catalog with Nevada encoded from the verified primary-source research.

**Files expected to be touched**

- `packages/custodian/src/` — `destruction-service.ts`, `destruction-statements.ts`,
  `will-deposit-catalog.ts`, `close-advisory.ts` (new); `types.ts`, `validation.ts`, `settings.ts`,
  `movement-service.ts`, `packet-service.ts`, `package.json` (edited)
- `packages/custodian/test/` — `destruction-service.test.ts`, `will-deposit-catalog.test.ts` (new);
  `location-service.test.ts` (edited)
- `packages/matters/src/close-advisories.ts` (new), `packages/matters/src/matter-service.ts`,
  `packages/matters/package.json`
- `packages/database/src/per-firm-schema.ts`,
  `packages/database/drizzle/per-firm/20260805T180000_custodian-destruction.sql`,
  `packages/database/drizzle/per-firm/meta/`
- `apps/worker/src/routes/custody.ts`, `apps/worker/src/routes/matters.ts`,
  `apps/worker/src/contracts/problem-types.ts`, `apps/worker/src/per-firm-migrations.ts`,
  `apps/worker/openapi/openapi.json`, `apps/worker/test/`
- `packages/api-client/src/types.gen.ts` (regenerated)
- `changelog.d/custodian-destruction-c8-catalog.md`, `status.d/4-2-custodian.md`,
  `docs/user/features/safe-custody-register.md`

**Overlap to watch.** A concurrent trust stream is expected to take journal idx 31
(`20260805T170000`); this stream takes idx 32. Both streams move the OpenAPI contract, so
second-to-merge regenerates the snapshot and the api-client.
