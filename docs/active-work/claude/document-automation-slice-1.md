---
branch: claude/document-automation-slice-1
started: 2026-08-04
owner: Opus 4.8
---

# Document automation — build slice 2·6·1

The walking slice of the document-automation subsystem: a firm registers a `.docx` template, the
template is normalized once at registration, and an assembly job merges it against a matter and files
the output into the matter's File Manager through the existing ingest chokepoint. Substitution only —
conditionals, repeats, custom-field bindings, letterhead images, and PDF output are later slices with
their seams placed here.

Spec: [`docs/specs/2026-08-04-document-automation-design.md`](../../specs/2026-08-04-document-automation-design.md) ·
Plan: [`docs/specs/2026-08-04-document-automation-implementation-plan.md`](../../specs/2026-08-04-document-automation-implementation-plan.md)

## Files expected to be touched

- `packages/document-assembly/**` — new pure package (OOXML reader/writer, macro strip, normalization,
  dictionary, formatters, resolution, substitution, statements).
- `packages/identifiers/src/registry.ts`, `packages/identifiers/src/types.ts` — three new prefixes.
- `packages/access-control/src/registry.ts` — `templates:manage`, `documents:assemble`.
- `packages/database/src/per-firm-schema.ts` + a new per-firm migration and its journal entry.
- `packages/data-access/src/pii-registry.ts` — classify the three new tables.
- `packages/telemetry/src/events.ts`, `packages/telemetry/src/metrics.ts` — the assembly catalog entries.
- `apps/worker/src/routes/templates.ts`, `apps/worker/src/routes/assemblies.ts`,
  `apps/worker/src/assemblies/**`, `apps/worker/src/app.ts`, `apps/worker/src/index.ts`,
  `apps/worker/src/per-firm-migrations.ts`, `apps/worker/wrangler.jsonc`.
- `apps/worker/openapi/openapi.json` + `packages/api-client/src/**` (both regenerated).
- `apps/worker/test/conformance.test.ts`, `apps/worker/test/me.test.ts`,
  `apps/worker/test/auth-provisioning-e2e.test.ts` — the deliberately-literal inventories.
- Docs: `changelog.d/`, `status.d/2-6-document-automation.md`, `docs/decisions/pending/`,
  `docs/user/`.

## Known overlaps

- **`claude/custodian-build-slice-1`** is adding a per-firm migration at the same time. Both entries
  are timestamp-tagged; the journal `idx` values will need renumbering monotonically at merge.
- `apps/worker/wrangler.jsonc`, `apps/worker/src/app.ts`, and `apps/worker/src/index.ts` are shared
  registration points — append only, never reorder.
