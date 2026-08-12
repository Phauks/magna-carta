# Slice 2·7 — Exhibits and exhibit lists — implementation plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Each build slice below is sized for one agent batch and leaves `main` shippable on its own.

**Goal:** Build the exhibit model a litigation matter needs — a matter-level exhibit that keeps its
identity while its title changes, an ordered set whose labels are computed from position, in-text
references that cite identity and render the label so a reorder moves every citation at once, and a
freeze at issue so a document already filed can never renumber. Plus the two things that follow from
it: the exhibit list, produced as both a live table and an assembled document, and the compiled
package with its separator pages.

**Architecture:** A new pure domain package `@magna-carta/exhibits` on the established
structure-versus-access seam (mirrors `@magna-carta/matter-assets` and `@magna-carta/calendar`): pure
TypeScript, no D1 binding, no Hono, no `env`, composing statements into `composeEffectBatch` and
returning typed results rather than throwing. Per-firm tables: `matter_exhibit`, `exhibit_set`,
`exhibit_set_member`, `exhibit_reference`. Immutability after issue is enforced by hand-written
raw-SQL triggers (the `matter_asset_valuation` / `custody_movement` idiom — drizzle-kit cannot model
triggers), and the supersession chain by two partial unique indexes (the `continuance_of` idiom).
Document bytes never touch an exhibit route: an exhibit is a link over a `file` handle the File
Manager's existing presigned upload and quarantine chokepoint already produced. The list and the
separator pages are assemblies through `@magna-carta/document-assembly`; the package paginates through
`crates/pdf-core`'s shipped `stamp_set`. Design spec:
[`docs/specs/2026-08-11-exhibits-and-exhibit-lists-design.md`](2026-08-11-exhibits-and-exhibit-lists-design.md).

**Tech stack:** TypeScript (ESM, ES2022), Drizzle (schema types only; migrations are hand-written raw
SQL where triggers are involved), Cloudflare D1 (per-firm) + R2, Queues + Durable Objects, Hono +
`@hono/zod-openapi`, Vitest (+ `@cloudflare/vitest-pool-workers` for the worker suite), `vp` for
test/lint/format.

## Global constraints

Every task's requirements implicitly include this section.

- **Full names, no shorthand** (golden rule 12): identifier prefixes spelled out — `matterExhibit_`,
  `exhibitSet_`, `exhibitSetMember_`, `exhibitReference_`, `exhibitPackage_`; `referenceName`, never
  `refName`; "the firm-scoped data-access layer", never an abbreviation; `newIdentifier`, never
  `newId`.
- **No process-artifact references in source, tests, or OpenAPI `description`s** (golden rule 13): no
  ADR numbers, no "spec", no "slice 2·7" except a forward-looking "built in slice 2·7·N" schedule
  note. Enforced by `pnpm lint:process-refs`.
- **All business data through the firm-scoped data-access layer** (golden rule 3): the route hands the
  package a firm-scoped database; nothing in the package holds a binding or crosses firms.
- **A label is computed while a set is a draft and stored only at issue.** No code path writes
  `exhibit_set_member.label` outside the issue batch, and no read of a draft set consults the column.
  A source scan asserts both.
- **An issued set's members are immutable.** No code path issues an `UPDATE` touching `label`,
  `position`, `title_as_issued`, or `file_version_id_as_issued` on a member whose set is `issued`;
  the trigger refuses it at runtime and the purity test refuses it at review. Withdrawal and the
  narrow correction path write only their own columns.
- **A reference names members, never a span.** Nothing anywhere stores or parses an endpoint pair; a
  multi-exhibit citation is a list of names and the phrasing is computed at render.
- **No exhibit route accepts bytes.** Every attach takes a `file_id` that already exists and is
  `clean`. Never write a `file_version` row directly, and never edit
  `packages/file-manager/src/ingest-core.ts`.
- **Nothing infers a numbering rule from a jurisdiction, a court, or a matter type.** A scheme is
  column values a member chose. A preset is a copyable set of those values and never a live rule.
- **No exhibit title, description, reference name, or label is ever a telemetry dimension or an
  `audit_log` metadata value.** Identifiers only.
- **Every mutation composes an `audit_log` row** in the same atomic batch.
- **Every mutating route is idempotency-keyed** through the chokepoint; create, reorder, issue,
  withdraw, supersede, and package-build are `required`.
- **TDD:** write the failing test, watch it fail, implement the minimum, watch it pass, commit.
- **Migration ordinals and ADR numbers reconcile at merge** if a sibling slice lands first.

## Commands

- Package tests: `pnpm --filter @magna-carta/exhibits test`
- Assembly package tests: `pnpm --filter @magna-carta/document-assembly test`
- Repo tests including the Miniflare worker suite: `pnpm test`
- Scoped gate (inner loop): `pnpm check:scoped` · full gate: `pnpm check`
- Process-reference lint: `pnpm lint:process-refs`
- OpenAPI snapshot: `pnpm --filter @magna-carta/worker run emit-openapi`
- Typed client: `pnpm run generate-client`
- Measurement baseline: `pnpm --filter @magna-carta/fixtures run measure`

---

# Build slice 2·7·1 — The set, the order, the label, and the freeze

**The walking slice, and it is usable alone.** A paralegal opens a matter, creates an exhibit set for
a motion, adds six matter files to it, drags one from the bottom to the top, watches every label
renumber, prints the exhibit list, and then records that the motion was filed — after which nothing
can renumber it. No in-text references yet; the list is the product.

This slice carries the schema for everything that follows, because columns are cheap now and a
backfill over rows nobody can classify retroactively is not: `source_kind`, `reference_name`,
`bates_begin` / `bates_end`, `continues_from_set_id`, and `supersedes_set_id` all land here even
though only the first two are read before 2·7·2.

## Task 1 — Identifiers, permissions, and the package scaffold

- [ ] `packages/identifiers/src/registry.ts` + `types.ts`: five prefixes and branded types —
      `matterExhibit`, `exhibitSet`, `exhibitSetMember`, `exhibitReference`, `exhibitPackage`.
- [ ] `packages/access-control/src/registry.ts`: `exhibits:manage` and `exhibits:issue`, each with the
      one-line comment the registry's convention requires, including why the two are split — the
      second is the four operations that touch the record of what was served. Both bind
      `resource: "matter"`. Seed by migration: `exhibits:manage` to the practising roles,
      `exhibits:issue` to the roles that may file.
- [ ] `packages/exhibits/` scaffold: `package.json`, `tsconfig.json` (own `compilerOptions` —
      `allowImportingTsExtensions`, `noEmit`, `lib`, `types`; `{extends, include}` alone breaks `.ts`
      imports under `tsc`), `tsconfig.build.json`, `vitest.config.ts`, and the tsconfig-refs entry.
- [ ] `packages/exhibits/CLAUDE.md` from the area template: purpose, key files, the invariants below,
      and the gotchas.

## Task 2 — The label function, as a pure module with no dependencies

Written first and alone, because it is the one piece the whole subsystem's correctness rests on and
it needs no database to be proven.

- [ ] `src/scheme.ts`: the `ExhibitScheme` shape (`noun`, `prefix`, `sequence`, `startAt`,
      `overflowForm`) and the closed `sequence` / `overflowForm` vocabularies.
- [ ] `src/label.ts`: `labelFor(position, scheme)` and `ordinalFor(position, scheme)`. A closed
      registry of sequence generators — `upperLetter`, `lowerLetter`, `arabic`, `roman`. Reads no
      clock, no database, no setting.
- [ ] Tests: every sequence across its first 60 values; the Z boundary in both overflow forms; a
      non-1 `startAt`; roman numerals at 4, 9, 40, 90, 400, 900, and 3999; prefix and noun
      composition; and the property that `labelFor` is injective over positions within one scheme.
- [ ] `test/purity.test.ts`: `src/label.ts` and `src/scheme.ts` import nothing.

## Task 3 — Schema and migration

- [ ] `packages/database/src/schema/`: `matter_exhibit`, `exhibit_set`, `exhibit_set_member`,
      `exhibit_reference` per the design's section 2.1, with the `CHECK` constraints on `source_kind`,
      `state`, `disposition`, `status`, `sequence`, and `overflow_form`.
- [ ] Indexes: `UNIQUE(matter_id, reference_name)`; `UNIQUE(exhibit_set_id, position)`;
      `UNIQUE(exhibit_set_id, label) WHERE label IS NOT NULL`;
      `UNIQUE(supersedes_set_id) WHERE supersedes_set_id IS NOT NULL` — at most one successor per set,
      the predecessor side held by the column, so a fork is refused even under racing writes; plus the
      read indexes for `(matter_id, state)`, `(matter_exhibit_id)`, and
      `(matter_id, matter_exhibit_id)` on the reference table.
- [ ] Hand-written raw-SQL migration for the triggers: `BEFORE UPDATE ON exhibit_set_member` raising
      when the parent set is `issued` and any of `label`, `position`, `title_as_issued`, or
      `file_version_id_as_issued` changes; `BEFORE DELETE ON exhibit_set_member` raising when the
      parent set is `issued`; `BEFORE UPDATE ON exhibit_set` raising when `state` moves out of
      `issued`.
- [ ] `test/immutability.test.ts`: each trigger fires, by `UPDATE` and by `DELETE`, against a real
      migrated database.
- [ ] Classify all four tables in the personally-identifiable-information registry in this same change.

## Task 4 — Exhibits and sets: the write paths

- [ ] `src/types.ts` — the closed vocabularies and the bounds (members per set, exhibits per matter).
- [ ] `src/validation.ts` — every refusal as a code the route maps to a problem type.
- [ ] `src/reference-name.ts` — minting a `referenceName` from a title (lower camel, letters and
      digits only, deduplicated within the matter by a numeric suffix) and validating a
      member-supplied one. **The mint is one-shot**: nothing recomputes a reference name from a
      changed title, ever, and a test asserts a retitle leaves it byte-identical.
- [ ] `src/exhibit-statements.ts` / `src/exhibit-service.ts` — create, retitle, edit, soft-archive.
- [ ] `src/set-statements.ts` / `src/set-service.ts` — create a set, edit its scheme, soft-archive a
      draft set. Editing a scheme on an issued set is refused by name.
- [ ] `src/member-statements.ts` / `src/member-service.ts` — add a member, remove a draft member, and
      **`reorderMembers`: one batch, a whole-set replace of `position`**, never a sequence of pairwise
      swaps. Two members racing a swap can otherwise both commit and leave a gap or a duplicate; the
      `UNIQUE(exhibit_set_id, position)` index is what refuses it and the whole-set replace is what
      keeps the refusal from being routine.
- [ ] Tests: creation, the reference-name mint and its stability across retitles, add and remove
      renumbering, a reorder that reverses a six-member set, the position uniqueness refusal, and the
      bounds.

## Task 5 — The read: a set, its members, and their labels

- [ ] `src/queries.ts` — `readExhibitSet(database, setId)`: **one statement** joining members to
      exhibits to files, returning rows already ordered by position, with the label computed in the
      Worker from `labelFor` for a draft set and read from the column for an issued one. One
      statement, not one per member; `test/read-batching.test.ts` asserts the count, because the
      natural implementation of a list read is a lookup per row and that is an N+1 pointed at a
      200-member set.
- [ ] The matter-level exhibit register read (every exhibit on the matter and which sets it appears
      in), and the continuation-chain read, **depth-capped** the way the continuance chain is.
- [ ] Tests: label agreement between the computed and stored paths for a set immediately after issue;
      the statement-count assertion; the depth cap as a refusal, not a truncation.

## Task 6 — Issue, correct, withdraw, supersede

- [ ] `src/issue-service.ts` — the issue batch: materialize every member's `label`,
      `title_as_issued`, and `file_version_id_as_issued` (resolving a floating exhibit to the file's
      current clean version), flip `state`, record `disposition` / `issued_on` / `issued_by` /
      `filed_copy_file_id`, and write the audit row. One batch, idempotent, and the only place the
      `label` column is ever written.
- [ ] `src/withdrawal-service.ts` — withdraw an issued member: `status`, `withdrawn_at`,
      `withdrawal_basis`, audit. The label is untouched and the position stays a hole.
- [ ] `src/correction-service.ts` — the narrow correction of an issued member's `title_as_issued` or
      `file_version_id_as_issued`, requiring `exhibits:issue`, audited, and **structurally unable to
      renumber** because it composes no statement touching `label` or `position`.
- [ ] `src/supersession-service.ts` — one batch: create the successor set carrying
      `supersedes_set_id`, optionally `continues_from_set_id`, and its starting ordinal computed from
      the predecessor's highest consumed ordinal **including retired labels**.
- [ ] Tests: issue is idempotent; a post-issue reorder is refused by the trigger; a withdrawn label is
      never reissued to a later member of the same set; a continuing set starts past a retired label;
      the supersession fork is refused by the partial unique index under two racing writes.

## Task 7 — The `exhibits` dictionary source

The assembly engine gains its first collection whose membership a caller chooses.

- [ ] `packages/document-assembly/src/catalog/subjects.ts`: an `exhibits` subject, kind `exhibitSet`,
      **collection-only** — following the `assetClass` precedent, it declares `.all` and no scalar
      facet at all, and a test asserts it never gains one.
- [ ] `packages/document-assembly/src/exhibit-bindings.ts`: the item fields (`label`, `title`,
      `description`, `pageCount`, `batesRange`, `status`, `sourceKind`) and the projection from rows
      to `MergeListItem`.
- [ ] `packages/document-assembly/src/resolve.ts`: `ResolutionInput.exhibitSetId`, supplied by the
      caller exactly as `assetsAsOfDate` is; **one batched read** for the whole collection. A matter
      with more than one draft set and no explicit choice is an **absence naming the count**, with a
      reason, never the newest set.
- [ ] Add the new keys to `test/fixtures/shipped-keys.json` (the committed golden record) and to the
      catalog-contract fixture, and update `test/fixture-projection.test.ts` expectations.
- [ ] Tests: the collection-only assertion; the ambiguity absence and its reason; the batching
      assertion; an empty set renders an empty repeat rather than an absence, per the collections rule.

## Task 8 — Routes, and the assembled exhibit list

- [ ] `apps/worker/src/routes/exhibits.ts` — `createRoute` blocks with Zod schemas for every status
      and `RouteMeta` on every route, through the one chokepoint:

| Route                                                                              | Permission        | Audited | Idempotency |
| ---------------------------------------------------------------------------------- | ----------------- | ------- | ----------- |
| `POST /api/v1/matters/{matterId}/exhibits`                                         | `exhibits:manage` | yes     | required    |
| `GET /api/v1/matters/{matterId}/exhibits`                                          | `exhibits:manage` | no      | none        |
| `PATCH /api/v1/matters/{matterId}/exhibits/{exhibitId}`                            | `exhibits:manage` | yes     | optional    |
| `POST /api/v1/matters/{matterId}/exhibit-sets`                                     | `exhibits:manage` | yes     | required    |
| `GET /api/v1/matters/{matterId}/exhibit-sets`                                      | `exhibits:manage` | no      | none        |
| `GET /api/v1/matters/{matterId}/exhibit-sets/{setId}`                              | `exhibits:manage` | no      | none        |
| `POST /api/v1/matters/{matterId}/exhibit-sets/{setId}/members`                     | `exhibits:manage` | yes     | required    |
| `PUT /api/v1/matters/{matterId}/exhibit-sets/{setId}/order`                        | `exhibits:manage` | yes     | required    |
| `POST /api/v1/matters/{matterId}/exhibit-sets/{setId}/issue`                       | `exhibits:issue`  | yes     | required    |
| `POST /api/v1/matters/{matterId}/exhibit-sets/{setId}/supersede`                   | `exhibits:issue`  | yes     | required    |
| `POST /api/v1/matters/{matterId}/exhibit-sets/{setId}/members/{memberId}/withdraw` | `exhibits:issue`  | yes     | required    |

- [ ] Problem types as additive registry entries: `exhibit-set-issued` (the operation is refused
      because the set went out), `exhibit-reference-name-taken`, `exhibit-set-ambiguous`,
      `exhibit-position-conflict`.
- [ ] A committed starter **exhibit list template** fixture — a caption, a repeating table row over
      `exhibits.all`, and blank Offered / Objection / Admitted columns — registered through the
      ordinary template catalogue, not a special path.
- [ ] Worker integration tests: the chokepoint contract per route (401 / 403 / 404-not-403 for a
      deactivated member); idempotency on every mutating route; issue-then-reorder refused end to end;
      and the end-to-end path from six files to a filed exhibit list document.

## Task 9 — Load profile, telemetry, docs

- [ ] `packages/fixtures`: an `exhibits` volume profile — a matter with a 200-member draft set, two
      issued predecessors, and a continuation chain — accreting onto the harness rather than a bespoke
      benchmark.
- [ ] Four measured operations on the committed baseline, all asserted to walk indexes: the
      set-and-members read; the matter exhibit register; the continuation chain; and the merge-context
      batch for a list assembly over 200 members.
- [ ] Telemetry: `exhibitSet.issued` `[disposition, sequence]` and a placeholder-free assertion that no
      title, label, or reference name reaches a dimension.
- [ ] `docs/user/features/exhibits.md` — the user guide: building a set, reordering, what issuing
      means and that it cannot be undone, and what withdrawal does to a label.
- [ ] `changelog.d/` and `status.d/2-7-exhibits.md` fragments updated; `ROADMAP.md` entry.

---

# Build slice 2·7·2 — In-text references

The slice that kills the defect. Everything above ships a list that is always right; this ships
prose that is always right.

## Task 10 — The token, in the assembly engine

- [ ] `packages/document-assembly/src/exhibit-reference.ts`: recognizing `{{@name}}` and
      `{{@nameOne,@nameTwo}}` in the normalizer's existing run-reassembly pass, so a token split
      across runs by Word is normalized exactly as a merge placeholder is. **The same normalization,
      not a second scanner.**
- [ ] The four rendering forms (`full`, `bare`, `titled`, `asIssued`) as a closed table, checked
      statically against the placeholder's `:format` suffix the way `legalFormatsFor` already checks
      one. An unknown form is a normalization failure with a location.
- [ ] `src/exhibit-citation.ts`: the phrasing function — one member, two members, a contiguous run,
      and a mixed set — computed from the members' ordinals, never from stored text. Tests over every
      shape including a run broken by an insertion.
- [ ] New `NormalizationFailureCode` values: `exhibit-reference-malformed`,
      `exhibit-reference-format-illegal`.
- [ ] Tests: tokens split across runs, in a table cell, in a header, in a footnote; the phrasing
      function's whole table; and the property that inserting a member between two cited members
      changes the rendered phrasing and not the token.

## Task 11 — Resolution, the reference index, and the failure policy

- [ ] Resolution in the assembly consumer against **one batched read** of the set and its members.
- [ ] The failure policy of the design's section 4.6: a name outside this set or off the matter
      **fails the assembly** naming the reference; a withdrawn member resolves and warns.
- [ ] `exhibit_reference` rows written in the **same batch** that files the output version — immutable
      with it, no update path, the field-binding-index argument.
- [ ] `GET /api/v1/matters/{matterId}/exhibits/{exhibitId}/citations` — which document versions cite
      this exhibit, cursor-paginated on the platform cursor.
- [ ] The pre-reorder impact read: given a proposed order, which cited labels move.
- [ ] Telemetry: `exhibitReference.resolved` `[outcome, form]`.
- [ ] Worker tests: a failing reference fails the job with the reference named and no file filed; a
      withdrawn reference produces the document and the warning; the citation index survives a
      redelivered queue message without doubling.

## Task 12 — The insertion surface

- [ ] Design-system work: `exhibit-picker` and `exhibit-chip`, built on the `merge-field-picker` /
      `merge-field-chip` patterns, multi-select producing the comma-separated token.
- [ ] The chip renders the **current** resolution, so an author reads "Exhibit C" over a token that
      says `{{@employmentAgreement}}`.
- [ ] The reference report surface: stale and withdrawn references per document.
- [ ] Stories for every state, including a withdrawn reference and an unresolvable one.

---

# Build slice 2·7·3 — Separator pages and the compiled package

## Task 13 — Separator pages as assemblies

- [ ] A `separatorPage` template role in the catalogue, and a committed starter template carrying the
      label centred at 24 point.
- [ ] Assembly per member from the set's own labels, **never stored as a matter document** — a source
      scan asserts no code path files one.
- [ ] Tests: the emitted page's text and point size; regeneration after a reorder produces different
      pages from the same template.

## Task 14 — The package job

- [ ] `ExhibitPackageJob` Durable Object keyed `firmId:packageId` on the shipped job shape: idempotent
      `start()`, `queued` persisted, stuck-job alarm, `markRunning` / `markDone` / `markFailed`.
- [ ] The consumer: convert non-PDF members through the shipped conversion edge, concatenate list +
      per-member separator + exhibit, emit PDF bookmarks, paginate through `stamp_set` with the
      package's own prefix and corner, and file the result through the ordinary chokepoint.
- [ ] **No stamp detection.** The corner is the member's choice and the surface warns when any member
      is `discoveryDocument`-sourced; nothing inspects a page for an existing stamp.
- [ ] For an issued set the package is built once at issue and is immutable with it.
- [ ] Telemetry: `exhibitPackage.built` `[outcome, stage]`.
- [ ] Tests: a package over mixed formats; bookmark targets land on the right first pages; a
      redelivered message files exactly one package; the pagination range is contiguous.

---

# Build slice 2·7·4 — Provenance and cross-filing

## Task 15 — Custodian and discovery sources

- [ ] Attaching a custody item: the exhibit points at the item's scan (an ordinary matter file) and
      records the custody link as provenance. **Custodian's tables are read, never written**, and the
      one file that touches them says so, the way `custody-link-statements.ts` does.
- [ ] Attaching a discovery review document: `bates_begin` / `bates_end` / `page_count` copied at
      attach time from the discovery record and **never recomputed**.
- [ ] The `batesRange` item field on the list, and the list template's Bates column.
- [ ] Tests: the provenance is a copy and a later discovery-side change does not move it; a reorder
      leaves every Bates range byte-identical.

## Task 16 — The `asIssued` cross-filing form

- [ ] The fourth rendering form, resolving an exhibit's label **in the issued set it belonged to**
      rather than in the citing document's set, with the set's name and `issued_on`.
- [ ] Refused when the named exhibit belongs to no issued set, with the reason named.
- [ ] Wording per owner decision E3; the string lives in one place so answering E3 is one edit.
- [ ] Tests: the form against an exhibit in two issued sets resolves against the one named, and is an
      ambiguity refusal when none is named.
