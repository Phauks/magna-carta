# claude/billing-slice-1 — the invoice spine

**Scope.** Build sub-slice 3·4·1 of
[`docs/specs/2026-08-05-billing-implementation-plan.md`](../../specs/2026-08-05-billing-implementation-plan.md):
the invoice spine — draft, claim, finalize, post, number — on the recommended defaults of
[`docs/specs/2026-08-05-billing-design.md`](../../specs/2026-08-05-billing-design.md).

Trust application, credit notes, client credits, arrangements, taxes, delivery, and LEDES are
sub-slices 3·4·2 to 3·4·4 and are **not** in this stream.

## Files this stream expects to touch

- `packages/sequence-numbering/**` (new — the extracted counter/allocation idiom, B12)
- `packages/matters/src/numbering/counter-statements.ts` + `src/matter-service.ts` (consume the
  extraction; behaviour unchanged)
- `packages/billing/**` (new)
- `packages/database/src/per-firm-schema.ts`,
  `packages/database/drizzle/per-firm/20260805T230000_billing-invoices.sql`, the per-firm snapshot
  and journal
- `packages/identifiers/src/registry.ts` + `src/types.ts`
- `packages/access-control/src/registry.ts` + `test/registry.test.ts`
- `packages/data-access/src/pii-registry.ts`
- `packages/fixtures/src/load-profile/{profile,invoice-generate,invoice-measurements}.ts`
- `apps/worker/src/routes/billing.ts`, `src/app.ts`, `src/per-firm-migrations.ts`,
  `src/contracts/problem-types.ts`, `openapi/openapi.json`
- `apps/worker/test/{conformance,auth-provisioning-e2e,me}.test.ts` (permission inventories only)
- `packages/api-client/src/types.gen.ts` (regenerated)
- `changelog.d/billing-slice-1.md`, `status.d/3-4-billing-and-invoicing.md`

## Known overlap

The auto-file-rules stream carries migration tag `20260805T220000` and lands first. This stream's tag
is `20260805T230000`, which sorts after it, so the merge is a clean append: auto-file takes journal
idx 34 and billing moves to idx 35, with no file rename on either side (the retag rule in
[`packages/database/CLAUDE.md`](../../../packages/database/CLAUDE.md)). Both streams regenerate the
OpenAPI snapshot and the api-client, so this one re-runs both generators when it syncs `main`.
