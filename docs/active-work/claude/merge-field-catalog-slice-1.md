# claude/merge-field-catalog-slice-1

**Scope.** Build slice 2·6·5 of the merge-field catalog plan — the generated catalogue and its
contract. The dictionary stops being a hand-written array and becomes the cross product of a subject
registry and a facet registry; the dictionary entry carries the presentation metadata the catalog
contract needs; a committed golden key list makes key permanence a test; the field-binding index
lands as one new per-firm table written at registration. The structured `name` value type rides
along, because `displayName` gaining formats is what makes the format system testable and its
default rendering is proven byte-identical.

**Owner-flag accounting.** Slice 2·6·5 is free of owner flag H1 (new platform tables for staffing,
court/case, and estate facts). It adds no domain facts and no merge sources — every key it emits
comes out of a read the engine already issues. H2, H4, H5, and H6 gate later slices only; H3's
recommendation (`displayName` gains name formats rather than a sibling key) is the one this stream
builds to.

**Files this stream expects to touch.**

- `packages/document-assembly/src/catalog/` (new: `groups.ts`, `subjects.ts`, `facets.ts`,
  `generate.ts`), `src/dictionary.ts`, `src/directory-role-bindings.ts`, `src/protected-bindings.ts`,
  `src/format.ts`, `src/types.ts`, `src/merge-statements.ts`, `src/resolve.ts`, `src/assemble.ts`,
  `src/template-service.ts`, `src/template-statements.ts`, its tests and `CLAUDE.md`
- `packages/merge-field-catalog-contract/src/` and its tests
- `packages/database/src/per-firm-schema.ts`, `drizzle/per-firm/20260806T010000_merge-field-catalog.sql`,
  `drizzle/per-firm/meta/`
- `packages/custom-fields/src/custom-field-service.ts` (the hard-delete guard's scan becomes a lookup)
- `apps/worker/src/per-firm-migrations.ts`, `apps/worker/src/routes/templates.ts`,
  `apps/worker/openapi/openapi.json`, `packages/api-client/src/` (regenerated)
- `packages/fixtures/src/load-profile/` and its committed baseline
- `apps/web/src/lib/document-assembly/merge-field-catalog-source.ts`
- `changelog.d/merge-field-catalog-slice-1.md`, `status.d/2-6-document-automation.md`,
  `docs/user/`

**Known overlaps.** `apps/worker/openapi/openapi.json` and `packages/api-client/src/` are regenerated
artefacts several streams move; second-to-merge regenerates. A calendar branch was in flight taking
per-firm migration tag `20260806T000000`, so this stream takes `20260806T010000`.

**Second-to-merge reconciliation done.** Case calendar (#144) landed first at journal idx 36; this
stream merged `main` and moved to **idx 37**, keeping its tag (`20260806T010000` already sorts after
the calendar's). The snapshot was re-derived as `meta/0037_snapshot.json` rather than renamed, and the
contract was re-emitted from the merged tree (`emit-openapi` then `generate-client`) rather than
hand-merged — the only diff against `main` in either generated file is this stream's own.
