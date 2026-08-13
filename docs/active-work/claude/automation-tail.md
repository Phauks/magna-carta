# claude/automation-tail — document automation tail (2·6·3)

**Status:** building
**Area:** document automation — PDF output and the e-signature hand-off

## Scope

The 2·6·3 tail named in
[`docs/specs/2026-08-04-document-automation-implementation-plan.md`](../specs/2026-08-04-document-automation-implementation-plan.md):

- **Task 17 — PDF output.** An `outputFormat` on the assembly request whose `pdf` arm chains the
  existing `docx` to `pdf` conversion edge after the merge, inside the same job, and files the
  converted bytes. No new engine and no new registry edge.
- **Task 18 — the signature hand-off.** The assembly result states what it produced, so an assembled
  PDF is in the shape `POST /api/v1/documents/seal` already accepts.

Task 19 (fillable-PDF form templates) is out of this stream and is written into a follow-on plan
instead of half-built.

## Files this stream expects to touch

- `packages/database/src/per-firm-schema.ts`, `packages/database/drizzle/per-firm/` (one additive
  migration + its snapshot)
- `apps/worker/src/per-firm-migrations.ts`
- `packages/document-assembly/src/assembly-statements.ts` and its `CLAUDE.md`
- `apps/worker/src/assemblies/` (types, coordinator message, consumer), `apps/worker/src/routes/assemblies.ts`
- `apps/worker/openapi/openapi.json` + `packages/api-client/` (regenerated, never hand-edited)
- `apps/web/src/lib/documents/` and `apps/web/src/lib/document-assembly/`
- `changelog.d/`, `docs/decisions/pending/`, `status.d/2-6-document-automation.md`, `docs/user/`
