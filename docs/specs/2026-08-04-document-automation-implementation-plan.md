# Slice 2·6 — Document automation — implementation plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Each build slice below is sized for one agent batch and leaves `main` shippable on its own.

**Goal:** Build conditional assembly of `.docx` templates from matter data — a firm template
catalogue, a declarative merge-field data dictionary over matter / Directory / Locations / custom
fields, an in-house OOXML assembly engine running in a Worker, and an assembled document filed into
the matter through the existing ingest chokepoint.

**Architecture:** A new pure domain package `@magna-carta/document-assembly` on the established
structure-versus-access seam (mirrors `@magna-carta/custom-fields` and `@magna-carta/metadata`):
pure TypeScript, no D1 binding, no Hono, no `env`, composing statements into
`composeEffectBatch` and returning typed results rather than throwing. Three per-firm tables
(`document_template`, `document_template_version`, `document_assembly`). OOXML manipulation over
`fflate` + `fast-xml-parser`, the same substrate `@magna-carta/metadata` uses. Assembly is a queue
job single-flighted by a `DocumentAssemblyJob` Durable Object (the `ConversionJob` pattern). The
produced document enters the File Manager through `initiateUpload` / `completeUploadSession` — the
same chokepoint, no bypass. Design spec:
[`docs/specs/2026-08-04-document-automation-design.md`](2026-08-04-document-automation-design.md).

**Tech stack:** TypeScript (ESM, ES2022), `fflate`, `fast-xml-parser`, Drizzle (schema types only;
migrations are hand-written raw SQL), Cloudflare D1 (per-firm) + R2 + Queues + Durable Objects,
Hono + `@hono/zod-openapi`, Vitest (+ `@cloudflare/vitest-pool-workers` for the worker suite), `vp`
for test/lint/format.

## Global constraints

Every task's requirements implicitly include this section.

- **Full names, no shorthand** (golden rule 12): identifier prefixes spelled out —
  `documentTemplate_`, `documentTemplateVersion_`, `documentAssembly_`; "the firm-scoped data-access
  layer", never an abbreviation; `newIdentifier`, never `newId`.
- **No process-artifact references in source, tests, or OpenAPI `description`s** (golden rule 13):
  no ADR numbers, no "spec", no "slice 2·6" except a forward-looking "built in slice 2·6·N" schedule
  note. Enforced by `pnpm lint:process-refs`.
- **All business data through the firm-scoped data-access layer** (golden rule 3): the route hands
  the package a firm-scoped database; nothing in the package holds a binding or crosses firms.
- **No floats.** Money is `amount_minor` plus a currency through `@magna-carta/money`; rates are
  `rate_e4`. Every formatter moves a decimal point; none multiplies.
- **Every mutation composes an `audit_log` row** in the same atomic batch, with `metadata` null —
  never a merge value, never a field value.
- **Every mutating route is idempotency-keyed** through the chokepoint.
- **One ingest chokepoint.** An assembled document reaches `clean` through
  `initiateUpload` / `completeUploadSession` and the existing ingest consumer. Never write a
  `file_version` row directly, and never edit `packages/file-manager/src/ingest-core.ts`.
- **Resolved merge values never leave memory.** Not persisted, not logged, not on a queue message.
  Queue messages carry identifiers; the consumer resolves.
- **TDD:** write the failing test, watch it fail, implement the minimum, watch it pass, commit.
- **Migration ordinals and ADR numbers reconcile at merge** if a sibling slice lands first.

## Commands

- Package tests: `pnpm --filter @magna-carta/document-assembly test`
- Repo tests including the Miniflare worker suite: `pnpm test`
- Scoped gate (inner loop): `pnpm check:scoped` · full gate: `pnpm check`
- Process-reference lint: `pnpm lint:process-refs`
- OpenAPI snapshot: `pnpm --filter @magna-carta/worker run emit-openapi`
- Typed client: `pnpm run generate-client`
- Measurement baseline: `pnpm --filter @magna-carta/fixtures run measure`

---

# Build slice 2·6·1 — Template catalogue + substitution assembly

The walking slice: a firm registers a `.docx` template, assembles it against a matter, and the
document lands in the matter's File Manager. Substitution only — no conditionals, no repeats, no
custom fields, no PDF.

## Task 1 — Identifiers, permissions, and the package scaffold

- [ ] `packages/identifiers/src/registry.ts` + `types.ts`: three prefixes and branded types —
      `documentTemplate_`, `documentTemplateVersion_`, `documentAssembly_`.
- [ ] `packages/access-control/src/registry.ts`: `templates:manage` and `documents:assemble`, each
      with the one-line comment the registry's convention requires.
- [ ] Scaffold `packages/document-assembly/` — `package.json` (dependencies: `fflate`,
      `fast-xml-parser`; workspace: `@magna-carta/money`, `@magna-carta/identifiers`,
      `@magna-carta/data-access`, `@magna-carta/database`), `tsconfig.json`,
      `tsconfig.build.json`, `vitest.config.ts`, copied from `@magna-carta/custom-fields`.
- [ ] `test/purity.test.ts` — the package imports no Hono, no `env`, no D1 binding, and no
      Svelte, mirroring `@magna-carta/conversion`'s purity fitness test.

**Verify:** `pnpm check:scoped`, `pnpm --filter @magna-carta/document-assembly test`.

## Task 2 — Schema and migration

- [ ] `packages/database/src/per-firm-schema.ts`: Drizzle definitions for `document_template`,
      `document_template_version`, `document_assembly` (columns per the design's template model and
      provenance record; `document_template_version` mirrors `file_version`'s
      `status` / `storage_encoding` / `content_sha256` / scan-verdict shape).
- [ ] A hand-written per-firm migration adding the three tables, their CHECK constraints (status
      enums, non-empty name), and the indexes the reads need: `(status, name)` on the catalogue,
      `(template_id, created_at, id)` on versions, `(matter_id, created_at, id)` on assemblies.
- [ ] Register the migration in `apps/worker/src/per-firm-migrations.ts`.
- [ ] Classify the three tables in the personally-identifiable-information registry.

**Verify:** migration applies against a fresh per-firm database in the fixtures harness;
`pnpm test`.

## Task 3 — The OOXML package reader and writer

- [ ] `src/ooxml/package.ts` — read an OOXML package to a part map and write it back, over `fflate`,
      with the decompression-bomb and size guards `@magna-carta/metadata`'s `guards.ts` established.
      Never call `unzipSync` directly.
- [ ] `src/ooxml/parts.ts` — the content-bearing part set (main document, headers, footers,
      footnotes, endnotes), shared by every later pass so a part written but not scanned cannot exist.
- [ ] `src/ooxml/xml.ts` — parse and rebuild over `fast-xml-parser`, with the one XML declaration
      rule the metadata package's notes call out (the builder writes it; the parser drops the source
      one).
- [ ] Tests: round-trip a synthesized `.docx` byte-stable; a package missing `[Content_Types].xml`
      is a typed failure, not a throw; an oversize or bomb-shaped entry is refused.

**Verify:** package tests green.

## Task 4 — Normalization and the field manifest

- [ ] `src/normalize.ts` — find `{{key}}` placeholders however Word split them across runs, rewrite
      each into one contiguous run carrying the key, and emit a `FieldManifest`
      (`{ key, occurrences, part, format? }[]`) plus a warning list.
- [ ] Recognize `MERGEFIELD` field constructs as an equivalent authoring form, normalizing them to
      the same internal representation.
- [ ] Typed failures with locations: unclosed delimiter, unknown key, malformed format suffix.
- [ ] Tests against synthesized templates whose placeholders are split in every awkward way —
      braces in separate runs, split across a spellcheck boundary, inside a table cell, inside a
      header, inside a footnote — using the fixture-builder approach `@magna-carta/metadata`'s tests
      established.

**Verify:** package tests green; every split shape normalizes to one run.

## Task 5 — The data dictionary and formatters

- [ ] `src/dictionary.ts` — the declarative catalogue: `key`, `source`, `valueType`, `format`,
      `sensitivity`, `absence`. Slice-1 sources: `matter`, `location`, `firm`, `party` (client only),
      `system`.
- [ ] `src/format.ts` — the formatter table per value type. Money through `@magna-carta/money`
      (`currency`, `currencyWords`, `plain`); dates in the matter's location's time zone (`short`,
      `long`, `legal`, `iso`); text (`plain`, `upper`, `titleCase`).
- [ ] `test/dictionary-wellformed.test.ts` — a fitness function: every entry has a source, a legal
      formatter for its type, and a declared absence behaviour.
- [ ] Tests: every formatter, with money and rate scaling proven integer-exact in both directions.

**Verify:** package tests green.

## Task 6 — Resolution and the batching rule

- [ ] `src/resolve.ts` — manifest plus dictionary to a plan, then **one batched read per source**
      through the firm-scoped database the caller hands in, producing a typed `MergeContext`.
- [ ] Absence handling per the declared mode (`blank` / `placeholder` / `fail`), returning the
      absent **keys** on the result.
- [ ] `test/resolve-batching.test.ts` — the load-bearing test: a 150-field manifest issues a bounded,
      asserted number of reads. This is what stops the N+1 from being reintroduced.

**Verify:** package tests green.

## Task 7 — Substitution and the assembly port

- [ ] `src/assemble.ts` — `DocumentAssemblyPort.assemble(templateBytes, mergeContext) →
  AssemblyResult` (typed outcome, never a throw): substitute normalized runs, re-emit the
      package, report absences.
- [ ] Assert the output package's integrity — content types, relationships, and part set intact —
      because a text assertion cannot see a package no reader will open.
- [ ] Tests: substitution across all content-bearing parts; an output that opens; a template with
      zero placeholders passes through unchanged.

**Verify:** package tests green.

## Task 8 — Template registration routes

- [ ] `apps/worker/src/routes/templates.ts` — `POST /api/v1/templates/upload` (presigned PUT, the
      `conversions.upload` shape), `POST /api/v1/templates`, `POST /api/v1/templates/{id}/versions`,
      `GET /api/v1/templates`, `GET /api/v1/templates/{id}/versions/{versionId}/fields`,
      `POST /api/v1/templates/{id}/archive`, `GET /api/v1/merge-fields`.
- [ ] `RouteMeta` per the design's table; problem-type registry entries
      (`template-normalization-failed`, `merge-field-unresolvable`, `template-not-activatable`).
- [ ] Registration refuses `.docm` and any package carrying `vbaProject.bin`; runs
      `@magna-carta/metadata`'s OOXML scrub over the normalized package before storing it.
- [ ] Template bytes ride the existing presign + quarantine ingest path; a version is not
      activatable until its verdict is clean. Template objects use the `templates/` R2 prefix and
      meter under that `storage_meter` prefix.
- [ ] Seed the two permissions by migration (Owner/Admin for `templates:manage`; practising roles
      for `documents:assemble`).

**Verify:** worker suite green; `emit-openapi` + `generate-client` regenerated and committed;
conformance fitness green.

## Task 9 — The assembly job

- [ ] `apps/worker/src/assemblies/assembly-coordinator.ts` — `DocumentAssemblyJob` Durable Object
      keyed `firmId:assemblyId`, modelled on `ConversionJob`: idempotent `start()`, stuck alarm,
      `markRunning` / `markDone` / `markFailed`, done never clobbered.
- [ ] `apps/worker/src/assemblies/assembly-consumer.ts` — the queue consumer: read template bytes
      (isolate cache keyed by `(templateVersionId, contentSha256)`), resolve, assemble, write the
      object, file it through `initiateUpload` / `completeUploadSession`, write the
      `document_assembly` row.
- [ ] `wrangler.jsonc`: the `document-assembly` queue, the Durable Object binding, and an
      **appended** migration tag — the existing tags are never edited.
- [ ] `POST /api/v1/matters/{matterId}/assemblies` (submit: authorize, persist, start — nothing
      else) and `GET /api/v1/matters/{matterId}/assemblies/{assemblyId}` (poll).

**Verify:** worker suite green, including a redelivered queue message producing exactly one filed
document and the stuck alarm failing a job that never reports.

## Task 10 — Telemetry, load profile, and documentation

- [ ] `packages/telemetry/src/events.ts` — `document.assembled`
      (`[outcome, reason, absenceCount]`). `metrics.ts` — `documentAssembly.jobs` `[outcome, stage]`,
      `documentAssembly.absentField` `[source]`, `documentTemplate.normalization`
      `[outcome, placeholderForm]`. No merge-field key is ever a dimension.
- [ ] `packages/fixtures/src/load-profile/` — a `documentAutomation` volume profile (templates per
      firm, fields per template, assemblies per matter) plus the four measured operations from the
      design's load-profile section; regenerate the committed baseline and confirm the plan scan
      shows index walks.
- [ ] `packages/document-assembly/CLAUDE.md` from the area template; a user guide under
      `docs/user/`; `status.d/2-6-document-automation.md`; a `changelog.d/` fragment.

**Verify:** `pnpm check`, `pnpm test`, `pnpm lint:process-refs` all green.

---

# Build slice 2·6·2 — Conditionals, repeats, and the full dictionary

## Task 11 — The block grammar

- [ ] `src/blocks.ts` — parse `{{#if}}` / `{{#unless}}` / `{{/if}}` and `{{#each}}` / `{{/each}}`
      during normalization, recording block ranges on the manifest. Nesting is validated at
      registration; an unbalanced block is a registration failure with a location.
- [ ] The expression evaluator: presence, negation, and equality against a literal. **No
      arithmetic, no function calls, no evaluation of template-supplied code** — enforced by a test
      that asserts the parser rejects anything outside the grammar.

## Task 12 — Block removal and repeat expansion

- [ ] Removal operates on **whole paragraphs and whole table rows only** — a marker in a row's first
      cell makes the row the unit.
- [ ] Numbering and list continuity preserved across a removed middle element; banded table
      formatting survives a removed row.
- [ ] Repeat expansion clones the block per item and rebinds `{{collection.field}}` per iteration.
- [ ] Tests: a numbered list with a removed middle item renumbers correctly; a banded table with a
      removed row keeps its banding; a nested `each` inside an `if` behaves.

## Task 13 — Directory, custom-field, and logo sources

- [ ] Dictionary sources widened: Directory party roles through the matter's party links, and
      `custom.<handle>` entries derived from `custom_field` — **bound by handle, never by name**.
- [ ] An archived custom field resolves as absent and is reported, over the existing
      `resolveCustomField` tagged result.
- [ ] `packages/custom-fields/src/custom-field-service.ts` — the hard-delete guard gains its
      template-binding arm: a field a template binds is `field-in-use` and routes to Archive.
- [ ] The letterhead logo asset on `@magna-carta/locations` plus an image merge field — this is the
      seam Locations reserved for document generation. Open question 3 in the design (who declares
      the box) is answered in this task.
- [ ] Protected-value binding: `sensitivity: protected` entries resolve through `readProtected`
      only, so the acting member's decrypt permission is checked and a `protected.decrypt` audit row
      is written; a member without it gets a named failure, never a blank.

**Verify:** worker suite green including the two protected-field cases (with and without the
permission); `pnpm check`.

---

# Build slice 2·6·3 — PDF output, signature hand-off, and form filling

## Task 14 — PDF output

- [ ] An optional `outputFormat: "docx" | "pdf"` on the assembly request; the `pdf` arm chains the
      existing `docx→pdf` conversion edge after the merge, in the same job, and files the result.
      No new engine, no new registry edge.

## Task 15 — Signature hand-off

- [ ] The assembly result carries the produced file and version handles in the shape the sealing
      route already accepts, so "assemble then send for signature" is a link rather than a new path.

## Task 16 — Fillable-form filling

- [ ] Firm-supplied fillable PDFs registered as templates of a `pdfForm` kind; the field manifest
      comes from the AcroForm field set that `crates/pdf-core`'s forms engine already reads, bound to
      the same data dictionary, and filling goes through the same engine.
- [ ] Court-form curation is **out of scope** pending owner decision F2.

---

# Build slice 2·6·4 — Authoring surfaces

## Task 17 — Template editing in the browser

- [ ] Gated on open question 1 in the design (the WOPI token's subject discriminator), which needs
      the editing area's agreement. If the answer is "not yet", this task is dropped and templates
      stay Word-authored and uploaded.

## Task 18 — Assembly preview

- [ ] A dry-run mode on the resolution path that returns the resolved values and absence warnings
      **without** assembling or filing, so the assemble dialog can show a member what they are about
      to produce. The preview response is a transient read; nothing is persisted.

---

## Sequencing and gates

Slice 2·6·1 is self-contained and depends only on what is already on `main`. Slice 2·6·2 depends on
2·6·1's normalization pass. Slice 2·6·3 depends on the LibreOffice conversion engine being live for
its PDF arm (the `docx→pdf` edge currently resolves to the deferred engine) and on the sign worker
being deployed for its hand-off. Slice 2·6·4 is gated on the editing area's answer to the token
question.

Owner decisions F1, F7, and F8 (section 13 of the design) block the start of slice 2·6·1: the
placeholder syntax, the own-versus-adopt engine call, and the macro-template policy are all baked
into Task 4 and Task 7. F6 (the expression ceiling) blocks slice 2·6·2. F2, F3, F4, F5, and F9 do
not block 2·6·1 and can be answered while it is built.
