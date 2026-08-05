# claude/automation-letterhead-custom-fields

**Scope:** The custom-field merge bindings and the letterhead logo — the widened-dictionary tasks of
[`docs/specs/2026-08-04-document-automation-implementation-plan.md`](../specs/2026-08-04-document-automation-implementation-plan.md),
against
[`docs/specs/2026-08-04-document-automation-design.md`](../specs/2026-08-04-document-automation-design.md)
and
[`docs/specs/2026-08-04-template-expression-language-design.md`](../specs/2026-08-04-template-expression-language-design.md).
Two halves:

1. **`custom.<handle>` merge bindings** — a firm's own fields enter the dictionary at read time,
   bound by the `customField_` handle and never by name, resolving through `resolveCustomField`'s
   tagged result so an archived field reports as an absence. `number_scale`-aware formatting reuses
   `@magna-carta/custom-fields`'s value model rather than restating the scale rule. The custom-field
   hard-delete guard gains its template-binding arm.
2. **The letterhead logo** — the Locations letterhead columns gain the logo asset, and the assembly
   engine gains its first image work: the image part, its content type, its relationship, and the
   inline drawing XML, emitted into the OOXML package and asserted by package-integrity tests.

**Files expected to be touched**

- `packages/document-assembly/src/` — new: `custom-field-bindings.ts`, `custom-field-statements.ts`,
  `ooxml/image.ts`. Modified: `dictionary.ts`, `resolve.ts`, `merge-statements.ts`, `format.ts`,
  `types.ts`, `normalize.ts`, `assemble.ts`, `ooxml/parts.ts`, `ooxml/package.ts`, `package.json`,
  `CLAUDE.md`.
- `packages/document-assembly/test/` — new custom-field binding, image, and package-integrity suites.
- `packages/custom-fields/src/custom-field-service.ts` + `test/custom-field-service.test.ts` — the
  hard-delete guard's template-binding arm.
- `packages/locations/src/{statements,location-service,validation}.ts` + `CLAUDE.md` — the letterhead
  logo asset.
- `packages/database/src/per-firm-schema.ts` + a new per-firm migration (after the trust-ledger head).
- `apps/worker/src/routes/locations.ts`, `apps/worker/src/routes/templates.ts`,
  `apps/worker/src/assemblies/assembly-consumer.ts`, `apps/worker/src/per-firm-migrations.ts`,
  `apps/worker/test/{conformance,document-automation}.test.ts`,
  `apps/worker/openapi/openapi.json`, `packages/api-client/`.
- `docs/user/`, `ROADMAP.md` (the slice 2·6 bullet only),
  `status.d/2-6-document-automation.md`, `changelog.d/`, `docs/decisions/pending/`,
  `roadmap.d/document-automation.md`.

**No new capability and no new problem type.** The letterhead routes are `locations:manage` like every
other office write, and a refused image is a plain validation problem — a new permission or a new
problem type would be a second way to say something the existing ones already say.

**Overlap watch:** anything else touching `packages/document-assembly`,
`packages/custom-fields/src/custom-field-service.ts`, `packages/locations`, the per-firm migration
lineage (`packages/database/drizzle/per-firm/`), `apps/worker/src/routes/locations.ts`, and
`apps/worker/openapi/openapi.json`.
