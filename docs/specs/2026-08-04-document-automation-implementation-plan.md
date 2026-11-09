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
- **Template content is never executable.** No `eval`, no `new Function`, no dynamic `import`, no
  `with`, no `Reflect`, no regular expression built from template text, no property traversal, and no
  template-supplied string used as a JavaScript property key. Template expressions are a closed,
  total, in-house grammar checked at registration — not code we sandbox.
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

- [ ] `src/assemble.ts` — `DocumentAssemblyPort.assemble(templateBytes, mergeContext)` returning
      an `AssemblyResult` (typed outcome, never a throw): substitute normalized runs, re-emit the
      package, report absences.
- [ ] Assert the output package's integrity — content types, relationships, and part set intact —
      because a text assertion cannot see a package no reader will open.
- [ ] Tests: substitution across all content-bearing parts; an output that opens; a template with
      zero placeholders passes through unchanged.

**Verify:** package tests green.

## Task 8 — Template registration routes

- [ ] `apps/worker/src/routes/documents/templates.ts` — `POST /api/v1/templates/upload` (presigned PUT, the
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
- [x] `packages/fixtures/src/load-profile/` — a `documentAutomation` volume profile (templates per
      firm, fields per template, assemblies per matter) plus the four measured operations from the
      design's load-profile section; regenerate the committed baseline and confirm the plan scan
      shows index walks.
- [ ] `packages/document-assembly/CLAUDE.md` from the area template; a user guide under
      `docs/user/`; `status.d/2-6-document-automation.md`; a `changelog.d/` fragment.

**Verify:** `pnpm check`, `pnpm test`, `pnpm lint:process-refs` all green.

---

# Build slice 2·6·2 — The expression language, conditionals, repeats, and the full dictionary

The expression ceiling grew on an owner decision: expressions compute. Grammar, evaluator,
conditionals, repeats, and computed fields land as five independently testable steps in that order,
so the language is proven correct as a language before it ever meets an OOXML package — the two
hardest problems here (a grammar's totality and a table row's banding) never have to be debugged at
the same time. Design:
[`docs/specs/2026-08-04-template-expression-language-design.md`](2026-08-04-template-expression-language-design.md).

**The line that binds every task below:** an expression is never executable template-supplied code.
No `eval`, no `new Function`, no dynamic `import`, no `with`, no `Reflect`, no regular expression
built from template text, no property traversal, and no template-supplied string used as a
JavaScript property key. A source-scan fitness test over `src/expression/` refuses all of them.

## Task 11 — The grammar: lexer, parser, checker, limits

Input a string, output a checked syntax tree or a located failure. No dictionary values, no document,
no evaluation.

- [ ] `src/expression/limits.ts` — every bound in one module (source length, token count, tree depth,
      call nodes, keys per expression, expressions per template version, numeric magnitude and scale,
      text result size, step budget, loop items, block nesting, expanded blocks). One test per bound
      that hits it exactly and asserts the named refusal, never a timeout.
- [ ] `src/expression/lex.ts` — tokens over **already-decoded** text (the XML layer decodes; the
      lexer never decodes again). A merge key such as `matter.number` is ONE atom: the dot is part of
      the identifier's lexical form, never an operator. `/` is recognized only to emit the error that
      names `divideExact`, `divideRounded`, and `allocate`.
- [ ] `src/expression/parse.ts` — recursive descent over the closed grammar. Word boolean operators
      (`and` / `or` / `not`), non-associative comparison, no member access, no indexing, no
      assignment, no ternary, no lambda, no comments. Returns a typed failure with a character
      offset; never throws.
- [ ] `src/expression/catalog.ts` — the helper allowlist as a frozen table built from a literal
      array and looked up through a `Map`. A template-supplied name is never used to index a
      JavaScript object.
- [ ] `src/expression/check.ts` — name resolution against the dictionary and the enclosing loop
      scope, then static typing: operand types, helper arity and parameter types, the block's
      required result type, and a computed field's `:format` suffix against the shipped
      `legalFormatsFor` table.
- [ ] Registration failure codes: `expression-syntax-error`, `expression-unknown-key`,
      `expression-type-error`, `expression-too-complex`, `expression-format-illegal`,
      `block-unbalanced`, `block-nesting-too-deep`. Retire `block-syntax-unsupported` — blocks are
      supported now, and a code meaning "we refuse to read this" must not survive as a vaguer version
      of the six that replace it.
- [ ] `test/expression-denied-constructs.test.ts` — the committed hostile corpus, each entry
      asserting a PARSE OR CHECK failure and never an evaluation: `__proto__.constructor`,
      `constructor.constructor("return process")()`, `this`, `[].map(x)`, `a["b"]`,
      `(function(){})()`, `x = 1`, `import("y")`, `/re/`, prototype-named keys, 32-deep nested
      `concat`, a 10^6-character literal, and every symbol operator the grammar does not have.
- [ ] `test/expression-fuzz.test.ts` — a structure-aware generator over the grammar and a byte-level
      generator of arbitrary strings, both seeded through `seededRandomSource` from
      `@magna-carta/identifiers` so a CI failure reproduces from its seed. Properties: parse and
      check never throw, always terminate, always return a tagged result with a location; and
      pretty-print-then-reparse yields an identical tree (the parser-ambiguity detector).
- [ ] `test/expression-purity.test.ts` — the source scan for dynamic-code constructs, plus the
      assertion that `src/expression/` imports nothing from `src/ooxml/` (the checker has to stay
      runnable in a browser for the authoring surface built in slice 2·6·4).

**Verify:** `pnpm --filter @magna-carta/document-assembly test`; `pnpm check:scoped`.

## Task 12 — The evaluator

A checked tree plus a synthetic merge context. Still no document.

- [ ] `src/expression/evaluate.ts` — a single post-order walk over a closed set of node kinds,
      returning `Value | Unresolved | Refusal`. Pure: no clock, no randomness, no environment, no
      I/O, no database handle, no locale beyond the time zone the merge context carries. Nothing in
      the folder throws.
- [ ] Exact arithmetic, no floating point anywhere: money is minor units at scale 2, rates are
      `rate_e4` at scale 4, numbers are `(significand, scale)` pairs. Every intermediate is checked
      against `Number.isSafeInteger` BEFORE the operation, so `@magna-carta/money`'s own
      `assertSafeInteger` throw is unreachable from here and a breach is a typed refusal naming the
      operation.
- [ ] Money rules: same-currency addition and subtraction (a mismatch refuses and names both keys —
      there is no currency conversion in this language), `money * integer` exact, `money + number` a
      static type error. Division is not an operator: `divideExact` refuses when inexact,
      `divideRounded` and `applyRate` and `percentOf` round HALF TO EVEN through the money package's
      `roundLedger`, and `allocate` returns parts that sum exactly to the input through the money
      package's `allocate`.
- [ ] Date math over calendar dates in the matter's office time zone, through the existing
      `timeZoneForLocation` seam — `addDays` / `addMonths` / `addYears` (end-of-month CLAMPS),
      `daysBetween`, `year` / `month` / `day` / `monthName`, and comparisons. There is no instant
      type in the language and therefore no time-of-day arithmetic; no business-day or court-deadline
      helper ships.
- [ ] The three total forms that eliminate absence — `has(key)`, `default(expression, fallback)`, and
      `choose(condition, a, b)` with a lazy unselected arm — and `unresolved` propagation through
      everything else.
- [ ] The shared per-assembly step budget, charged per node visited and per list element.
- [ ] `test/expression-arithmetic-oracle.test.ts` — money and decimal operations against an
      independent exact reference; half-to-even proven on the exact tie cases in both signs;
      `allocate`'s parts proven to sum to the input for every generated split; `divideExact` proven
      to refuse exactly when the quotient is inexact.

**Verify:** package tests green, including the generated-expression property that evaluation always
terminates inside the budget and the result type always matches the checked type.

## Task 13 — Conditionals

- [ ] `src/blocks.ts` — recognize `{{#if}}` / `{{#unless}}` / `{{/if}}` during normalization,
      recording block ranges and the condition source on the manifest. Nesting is validated at
      registration; an unbalanced block is a registration failure with a location.
- [ ] A bare merge key as the whole condition means its VALUE when the key's declared type is
      boolean and its PRESENCE otherwise; inside a larger expression a key is always a value.
- [ ] Removal operates on **whole paragraphs and whole table rows only** — a marker in a row's first
      cell makes the row the unit.
- [ ] Numbering and list continuity preserved across a removed middle element; banded table
      formatting survives a removed row.
- [ ] An unresolved condition defaults to FAILING the assembly, naming the key: a wrong branch is
      invisible, because nobody reads a contract and notices the paragraph that is not there. The
      author who means "omit it when we have no spouse on file" writes `has(...)`, which is total.
- [ ] Tests: a numbered list with a removed middle item renumbers correctly; a banded table with a
      removed row keeps its banding; the unresolved-condition policy in each of its three modes.

## Task 14 — Repeats

- [ ] `{{#each collectionKey}}` over a list-valued dictionary key or `allocate` — never an arbitrary
      expression, never a filtered or sorted list. Expressions do not iterate; `{{#each}}` iterates
      data.
- [ ] The loop scope: the current item's fields plus `loop.index` (1-based), `loop.count`,
      `loop.first`, `loop.last`. A loop reference outside a loop is a registration error.
- [ ] List-valued dictionary sources and their batched read — ONE read for a whole collection, never
      one per item. Repeats are the first list-valued source, so this is where the batching rule
      meets its first real test.
- [ ] Expansion clones the block per item and rebinds the scope per iteration; per-loop item cap,
      nesting cap, and per-assembly expansion cap all enforced from `limits.ts`.
- [ ] Tests: a nested `each` inside an `if`; a repeat that exceeds the item cap fails loudly; a
      table-row repeat keeps its banding.

## Task 15 — Computed fields

- [ ] `{{= expression}}` and `{{= expression:format}}` — a deliberately distinct marker, so a plain
      `{{matter.number}}` keeps exactly the meaning slice 2·6·1 shipped and no registered template
      changes behaviour.
- [ ] The format suffix is checked STATICALLY against the result type's legal formats; the default is
      the type's default (`plain` for text and number, `currency` for money, `long` for date). A bare
      boolean without a format is a type error.
- [ ] An unresolved computed field defaults to a visible `placeholder`, the same bias the absence
      model already takes for merge fields.
- [ ] Manifest entries carry the expression SOURCE, its static result type, and the keys it reads —
      and those keys join the manifest's key set, so the one-read-per-source rule survives
      expressions. Assembly re-parses and re-checks from the source rather than a stored tree, which
      is what catches dictionary drift (a template bound to a custom field archived three months
      later fails naming the key).
- [ ] Telemetry: `documentTemplate.expressionCheck` `[outcome, failureKind]` and
      `documentAssembly.expression` `[outcome, site]`. No expression text, no merge-field key, no
      value is ever a dimension. Problem types `template-expression-invalid` and
      `assembly-expression-refused`.
- [ ] Load profile: two measured operations accreted onto the existing `documentAutomation` volume
      profile — registration-time checking of a template carrying 64 expressions, and an assembly
      whose repeat expands 200 rows.
- [ ] The user guide for template authors under `docs/user/`, and the `status.d/` and `changelog.d/`
      fragments.

**Verify:** `pnpm check`, `pnpm test`, `pnpm lint:process-refs`.

## Task 16 — Directory, custom-field, and logo sources

- [x] `custom.<handle>` entries derived from `custom_field` — **bound by handle, never by name**.
      Directory party roles remain: they are a second batched read over the matter's party links and
      nothing in the custom-field arm blocks them.
- [x] An archived custom field resolves as absent and is reported, in both directions: it contributes
      no dictionary entry (so a bound template fails naming the key) and its stored value is skipped.
- [x] `packages/custom-fields/src/custom-field-service.ts` — the hard-delete guard gains its
      template-binding arm: a field a template binds is `field-in-use` and routes to Archive.
- [x] The letterhead logo asset on `@magna-carta/locations` plus an image merge field — this is the
      seam Locations reserved for document generation. Open question 3 in the design (who declares
      the box) is answered in this task: **the asset does**, and the image-format policy that came
      with it is PNG and JPEG decided by magic bytes.
- [ ] Protected-value binding: `sensitivity: protected` entries resolve through `readProtected`
      only, so the acting member's decrypt permission is checked and a `protected.decrypt` audit row
      is written; a member without it gets a named failure, never a blank.

**Verify:** worker suite green including the two protected-field cases (with and without the
permission); `pnpm check`.

---

# Build slice 2·6·3 — PDF output, signature hand-off, and form filling

## Task 17 — PDF output

- [x] An optional `outputFormat: "docx" | "pdf"` on the assembly request; the `pdf` arm chains the
      existing `docx→pdf` conversion edge after the merge, in the same job, and files the result.
      No new engine, no new registry edge.
- [x] The requested format is a column on `document_assembly`, not something read off the filed
      object: a job that FAILED still has to say what it was trying to make. A conversion that cannot
      be done fails the assembly rather than filing the word-processing package instead.

## Task 18 — Signature hand-off

- [x] The assembly result carries the produced file and version handles in the shape the sealing
      route already accepts, so "assemble then send for signature" is a link rather than a new path.
      The poll answers `outputFormat` beside the handles, from the moment of submit and after a
      failure, which is what tells a caller whether the produced document is a PDF — the one form
      `POST /api/v1/documents/seal` accepts.
- [ ] **The surface on the other end of that link does not exist**, and it is not this slice's. The
      seal is stateless over PDF bytes; the envelope, field placement, signer invitation, consent
      disclosure, and attribution ceremony that produce a signer record are slice 2·5's sub-slice 3
      and are unbuilt. Carried, with the two available shapes, into
      [`2026-08-13-document-automation-tail-remainder-plan.md`](2026-08-13-document-automation-tail-remainder-plan.md).

## Task 19 — Fillable-form filling

- [ ] Firm-supplied fillable PDFs registered as templates of a `pdfForm` kind; the field manifest
      comes from the AcroForm field set that `crates/pdf-core`'s forms engine already reads, bound to
      the same data dictionary, and filling goes through the same engine. **Not built** — it changes
      the shape of a template rather than adding a step to a job, and it is planned as Part B of
      [`2026-08-13-document-automation-tail-remainder-plan.md`](2026-08-13-document-automation-tail-remainder-plan.md).
- [ ] Court-form curation is **out of scope** pending owner decision F2.

---

# Build slice 2·6·4 — Authoring surfaces

## Task 20 — Template editing in the browser

- [ ] Gated on open question 1 in the design (the WOPI token's subject discriminator), which needs
      the editing area's agreement. If the answer is "not yet", this task is dropped and templates
      stay Word-authored and uploaded.

## Task 21 — Assembly preview

- [ ] A dry-run mode on the resolution path that returns the resolved values and absence warnings
      **without** assembling or filing, so the assemble dialog can show a member what they are about
      to produce. The preview response is a transient read; nothing is persisted.

---

## Sequencing and gates

Slice 2·6·1 is self-contained and depends only on what is already on `main`. Slice 2·6·2 depends on
2·6·1's normalization pass, and internally is a straight line: Task 11 (grammar) gates Task 12
(evaluator), which gates Tasks 13 through 15 (conditionals, repeats, computed fields). Tasks 11 and
12 touch no document at all and can be built and reviewed in full before any OOXML work starts; Task
16 (the widened dictionary sources) depends only on 2·6·1 and can run alongside them. Slice 2·6·3's PDF arm
depends on the LibreOffice conversion engine being live — the `libreoffice` engine id is now in the
convert worker's executable set, so the `docx→pdf` edge resolves to the real service wherever the
`CONVERT` binding is present and to the deferred engine everywhere else, which is why the arm reports
itself as a deploy-time activation rather than pretending. Its hand-off depends on the sign worker
being deployed, and past that on slice 2·5's signing surface existing at all.
Slice 2·6·4 is gated on the editing area's answer to the token question.

Owner decisions F1, F7, and F8 (section 13 of the design) blocked the start of slice 2·6·1 and are
answered: the placeholder syntax, the own-versus-adopt engine call, and the macro-template policy are
all baked into Task 4 and Task 7. **F6 (the expression ceiling) is answered — the ceiling grows to
computed expressions**, and slice 2·6·2 is unblocked; the language is designed in
[`docs/specs/2026-08-04-template-expression-language-design.md`](2026-08-04-template-expression-language-design.md),
whose own flags G1 (what an unresolved condition does) and G2 (one rounding mode or three) are the
only ones that change code inside Tasks 12 and 13, and both have a recommended answer built to by
default. F2, F3, F4, F5, and F9 block nothing here.
