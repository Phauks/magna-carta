---
branch: claude/automation-consent-refinements
area: Document automation — registration consent behaviours and the per-firm field-mapping library
status: building
---

Three owner-directed changes to the merged document-automation slice, all inside
`@magna-carta/document-assembly` and `apps/worker`'s templates/assemblies surface.

1. **Unconverted Word merge fields no longer refuse registration.** A template carrying them registers,
   and each construct is recorded in the field manifest as an unconverted-merge-field entry (name,
   part, occurrences, and the frozen cached text it will render). Registration and assembly both report
   them, so the absence model can see a field that will print stale text instead of a value.
2. **Macro stripping becomes opt-in.** Detection still always reports; the strip runs only on an
   explicit `stripMacros` request flag, and a macro-bearing upload without it is refused with both
   remedies named. The adversarial stripper and its independent re-verification are unchanged.
3. **The per-firm field-mapping library is built** — the store behind `MergeFieldNameResolver`. A
   firm-scoped table of confirmed Word-field-name to merge-key mappings, written when a conversion
   confirms them and consulted by later detections, with list and delete routes under
   `templates:manage`.

Files expected to change:

- `packages/document-assembly/src/{types,normalize,macros,register,template-service}.ts`,
  new `src/field-mapping-statements.ts`, `src/assembly-statements.ts`, and their tests
- `apps/worker/src/routes/{templates,assemblies}.ts`,
  `apps/worker/src/assemblies/assembly-consumer.ts`,
  `apps/worker/openapi/openapi.json`, `apps/worker/test/{document-automation,conformance}.test.ts`
- `packages/database/src/per-firm-schema.ts` + one generated per-firm migration
- `packages/data-access/src/pii-registry.ts`, `packages/identifiers/src/{registry,types}.ts`,
  `packages/telemetry/src/metrics.ts`, `packages/api-client` (regenerated)
- `docs/user/features/document-templates-and-assembly.md`, `status.d/2-6-document-automation.md`,
  one `changelog.d/` fragment and one `docs/decisions/pending/` fragment
