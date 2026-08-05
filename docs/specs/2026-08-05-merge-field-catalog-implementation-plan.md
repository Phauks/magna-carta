# The merge-field catalog system — implementation plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Each build slice below is sized for one agent batch and leaves `main` shippable on its own.
> Task numbering continues from the document-automation plan (which ended at Task 21), so a task
> number means one thing across the subsystem.

**Goal:** Grow the merge-field dictionary from the 29 keys shipped in slice 2·6 to the several
hundred a firm's documents name — without growing the read count, the hand-written surface, or the
risk to registered templates. Design:
[`docs/specs/2026-08-05-merge-field-catalog-system-design.md`](2026-08-05-merge-field-catalog-system-design.md).

**Architecture:** The catalogue stops being a hand-written array and becomes a **cross product of two
small registries** — subjects (the things a document talks about) and facets (the facts about a
subject of that kind) — materialized into the same flat `readonly DictionaryEntry[]` every consumer
already takes. The entry widens with the presentation metadata the catalog contract needs, so the
dictionary is the one home and `@magna-carta/merge-field-catalog-contract` is its projection rather
than its twin. Two structured value types (`name`, `address`) carry the renderings that would
otherwise multiply keys. New facts land as their owning area's records — matter staffing, a court-case
record, an estate record — each costing exactly one batched read. One new per-firm table serves the
catalogue itself: an immutable field-binding index written at registration.

**Tech stack:** TypeScript (ESM, ES2022), `fflate`, `fast-xml-parser`, Drizzle (schema types only;
migrations are hand-written raw SQL), Cloudflare D1 (per-firm) + R2 + Queues + Durable Objects,
Hono with `@hono/zod-openapi`, Svelte 5 with `@magna-carta/design-system`, Vitest (plus
`@cloudflare/vitest-pool-workers` for the worker suite), `vp` for test/lint/format.

## Global constraints

Every task's requirements implicitly include this section, in addition to the document-automation
plan's global constraints, which all still bind.

- **A merge field never issues a query.** Every task that adds keys states which batched read answers
  them, and `test/resolve-batching.test.ts` grows with it. A new source is one statement; a new
  subject is a pass over rows already in memory.
- **A key is permanent.** No task renames, retypes, re-sources, or removes a shipped key. The golden
  key list (Task 24) is what enforces it; a change to that file is a reviewed act, never a
  regeneration.
- **A default is frozen.** A shipped key's default format and absence behaviour do not move, except
  that absence may become more visible (`blank` → `placeholder` → `fail`), never less.
- **Generated, not copied.** A facet that applies to fourteen subjects is declared once. A task that
  writes the same row fourteen times has taken the wrong shape.
- **Presentation lives on the dictionary entry.** No task adds a label, group, or example to the
  contract's fixture that does not exist on the entry it projects.
- **Ambiguity resolves to nothing, with a reason naming the count** — at every level of a key's path,
  not only at the subject.
- **No inference.** No guessed salutation, gender, designation, or attorney. A fact the firm has not
  recorded is an absence with a reason.
- **Full names, no shorthand** (golden rule 12); **no process-artifact references in source, tests,
  or OpenAPI descriptions** (golden rule 13; `pnpm lint:process-refs`).
- **TDD:** write the failing test, watch it fail, implement the minimum, watch it pass, commit.

## Commands

- Package tests: `pnpm --filter @magna-carta/document-assembly test`
- Contract tests: `pnpm --filter @magna-carta/merge-field-catalog-contract test`
- Repo tests including the Miniflare worker suite: `pnpm test`
- Scoped gate (inner loop): `pnpm check:scoped` · full gate: `pnpm check`
- OpenAPI snapshot: `pnpm --filter @magna-carta/worker run emit-openapi`
- Typed client: `pnpm run generate-client`
- Measurement baseline: `pnpm --filter @magna-carta/fixtures run measure`

---

# Build slice 2·6·5 — The generated catalogue and its contract

The substrate slice: the catalogue becomes a cross product, the entry carries what a picker needs,
and the interface stops reading a fixture. **No new domain facts and no new sources** — this slice
adds roughly a hundred keys out of data the platform already holds, and every one of them is a
generation rather than a row.

## Task 22 — The subject and facet registries

- [ ] `packages/document-assembly/src/catalog/subjects.ts` — the subject registry: key, label,
      kind (`matter` / `party` / `member` / `office` / `firm` / `court` / `estate` / `financial` /
      `system` / `firmDefined`), group, synonyms, and the role tokens a `party` subject matches on.
      `DIRECTORY_ROLE_SOURCES` folds into it rather than living beside it.
- [ ] `packages/document-assembly/src/catalog/facets.ts` — the facet registry: name, applicable
      subject kinds, value type, default format, absence behaviour, prominence, description and label
      templates, synonyms.
- [ ] `packages/document-assembly/src/catalog/generate.ts` — the cross product, plus the per-subject
      overrides table (the one place `client.displayName` is `fail` where its siblings are
      `placeholder`).
- [ ] `dictionary.ts` keeps its exported shape: `DICTIONARY` is now the generator's output, and
      `dictionaryIndex`, `lookupDictionaryEntry`, `dictionaryForFirm`, and `expressionScopeFor` are
      untouched.
- [ ] Fitness: no two subjects normalize alike; every subject key is in the reserved top-level
      namespace registry; every facet declared for a kind produces an entry for every subject of that
      kind (a hole in the product is a defect).

**Verify:** `pnpm --filter @magna-carta/document-assembly test` — the shipped 29 keys come out of the
generator byte-identical to the hand-written array they replace.

## Task 23 — Presentation metadata on the entry

- [ ] `DictionaryEntry` gains `label`, `group`, `subject`, `prominence`, `synonyms`,
      `exampleRenderings` (one per legal format), `status`, `supersededBy`, `tags`.
- [ ] `packages/document-assembly/src/catalog/groups.ts` — the group registry: key, label, order.
      Adding a group is a row.
- [ ] `availability` and `availabilityNote` are **derived** from source and subject optionality, not
      declared — one function, tested against every entry.
- [ ] `absenceMarkerFor` uses the entry's `label` where one exists, so a marker reads
      `[OPPOSING COUNSEL'S NAME]` rather than `[OPPOSING COUNSEL DISPLAY NAME]`; the key-derived form
      stays the fallback for a `custom.<handle>` entry.
- [ ] Extend `test/dictionary-wellformed.test.ts`: every entry has a label, a group, a subject, a
      prominence, a description, and at least one example rendering per legal format.

**Verify:** package tests green.

## Task 24 — The golden key list

- [ ] `packages/document-assembly/test/fixtures/shipped-keys.json` — every shipped key with its
      value type, source, default format, absence behaviour, and sensitivity.
- [ ] `test/key-permanence.test.ts` — fails when a key disappears, changes type, changes source,
      changes default format, or loosens its absence behaviour. Adding a key is a diff to the golden
      file plus a review; changing one is a failure with the reason named in the message.
- [ ] The message text spells out the rule so a failing agent reads the policy, not just the diff.

**Verify:** the test fails on a deliberately mutated entry, naming the key and the property.

## Task 25 — The field-binding index

- [ ] `packages/database/src/per-firm-schema.ts` + a hand-written migration:
      `document_template_field_binding (template_version_id, merge_key)`, primary key on the pair,
      plus an index leading with `merge_key`.
- [ ] Registration writes one row per distinct manifest key **in the same batch** as the template
      version. Immutable version, immutable rows — no update path exists.
- [ ] `packages/custom-fields/src/custom-field-service.ts`: the hard-delete guard's manifest `instr`
      scan becomes an index lookup against the new table, keeping the by-string table reference (the
      two packages stay independent).
- [ ] Classify the table in the personally-identifiable-information registry.
- [ ] Tests: registering a version with 150 distinct keys writes 150 rows and no more; re-registering
      the same bytes under an idempotency key writes them once.

**Verify:** migration applies against a fresh per-firm database in the fixtures harness; `pnpm test`.

## Task 26 — The widened merge-fields endpoint

- [ ] `GET /api/v1/merge-fields` returns the full projection: key, label, group, subject,
      prominence, value type, default format, legal formats, per-format example renderings,
      description, synonyms, availability + note, sensitivity, absence behaviour, status.
- [ ] A `revision` on the response — the platform dictionary version plus a digest of the firm's
      custom-field catalogue — and the caching headers that make it revalidate rather than refetch.
- [ ] `emit-openapi` + `generate-client` regenerated and committed; conformance fitness green.

**Verify:** worker suite green; the response for a firm with no custom fields is stable across two
calls and its revision does not move.

## Task 27 — The contract grows

- [ ] `packages/merge-field-catalog-contract/src/types.ts`: `MergeFieldEntry` gains `subject`,
      `subjectLabel`, `prominence`, `synonyms`, `status`, `supersededBy`, per-format examples;
      `MergeFieldGroup` becomes a declared registry with order and labels rather than a closed union.
- [ ] The contract's value-type union is pinned to the engine's `MergeValueType` — one list, with a
      fitness test on the pairing rather than two unions that drift.
- [ ] `catalog-grouping.ts`: two-level sectioning (group then subject), `catalogSearchKeywords` gains
      synonyms and the subject label, and `searchCatalogSections` keeps its every-term-must-match
      narrowing.
- [ ] Tests for the new search vocabulary: "defendant" finds the opposing party, "PR" finds the
      personal representative, "DOD" finds the date of death.

**Verify:** contract tests green.

## Task 28 — The live catalog provider

- [ ] `apps/web/src/lib/document-assembly/` — a `MergeFieldCatalogProvider` over the typed client,
      replacing `createMockMergeFieldCatalogProvider` at the composition roots only. No consumer edit.
- [ ] The mock stays for stories and tests; `FIXTURE_MERGE_FIELD_CATALOG` becomes a **projection**:
      a test asserts every fixture key exists in the real dictionary, and the fixture's invented keys
      (`matter.practiceArea`, `matter.courtCaseNumber`, `matter.responsibleAttorney`) either become
      real in this slice or leave the fixture.
- [ ] The deliberately broken fixture manifest keeps its unrecognized key — a different key, if the
      old one has become real.

**Verify:** `pnpm check`; the assembly input area renders against live data with no component change.

## Task 29 — Load profile, telemetry, and documentation

- [ ] Two measured operations accreted onto `documentAutomation`: the catalogue projection (with its
      response size recorded) and the binding-index write at registration. Regenerate the committed
      baseline; the plan scan must show index walks.
- [ ] Telemetry: `documentTemplate.fieldBinding` `[outcome]` on the index write. **No merge-field key
      is ever a dimension** — the existing rule, restated because this slice makes keys plentiful.
- [ ] `packages/document-assembly/CLAUDE.md` gains the catalogue section (subjects, facets, the
      permanence rule, the golden list); `packages/merge-field-catalog-contract/CLAUDE.md` records
      that the fixture is now a checked projection.
- [ ] `status.d/2-6-document-automation.md`; a `changelog.d/` fragment.

**Verify:** `pnpm check`, `pnpm test`, `pnpm lint:process-refs` all green.

---

# Build slice 2·6·6 — Structured values and the format system

The formatting slice. It adds no keys and no reads; it makes the keys that exist renderable the way a
document needs them.

## Task 30 — The `name` value type

- [ ] `MergeValueType` gains `name`; `MergeValue` gains the structured variant (prefix, given,
      middle, family, suffix, display, and the organisation's legal name).
- [ ] `format.ts`: the name format table — `full` (the default, byte-identical to today's
      `displayName` rendering), `formal`, `lastFirst`, `initials`, `family`, `given`, `upper`.
- [ ] **A rendering that needs a part the record lacks is an absence with a reason**, never a
      fallback to a different rendering. An organisation asked for `lastFirst`, `initials`, `family`,
      or `given` is likewise an absence with a reason naming why.
- [ ] `expressionTypeOf("name")` is `text`, rendering at the default format — stated in the module
      comment with the reason: a document prints text, and a computation over a name part is not
      something this language does.
- [ ] `merge-statements.ts`: the party read projects the name part columns it already has.
- [ ] Tests: every format; the absence-with-reason cases in both directions; the shipped
      `displayName` default output unchanged for a person and for an organisation.

**Verify:** package tests green; the golden key list shows a type change on `displayName` only with
its default rendering proven identical.

## Task 31 — The `address` value type

- [ ] `MergeValueType` gains `address`; the structured variant carries street, city, region, postal,
      country, and the label the row was recorded under.
- [ ] Formats: `block` (the default), `inline`, `street`, `cityRegionPostal`.
- [ ] Tests including a record with a missing region and one with only a country.

**Verify:** package tests green.

## Task 32 — Multi-line renderings in the package

- [ ] `assemble.ts`: a multi-line rendered value emits alternating `w:t` and `w:br` elements within
      the substituted run — a literal newline in a `w:t` renders as a space, which is a document that
      looks subtly wrong and that every text assertion passes.
- [ ] The `xml:space="preserve"` rule holds on every emitted `w:t`.
- [ ] Tests assert over the **emitted parts** (`w:br` present, run structure intact,
      `packageIntegrityViolations` empty), never over document text.

**Verify:** package tests green; a fixture template with a block address opens in the validation
harness.

## Task 33 — The date, money, text, boolean, and number format additions

- [ ] Dates: `legalBare`, `weekday`, `monthYear`, `numeric`.
- [ ] Money: `wordsAndFigures` — "One Thousand Two Hundred Dollars and 00/100 ($1,200.00)", reusing
      the shipped `currencyWords` and `currency` renderings rather than a third implementation.
- [ ] Text: `lower`, `sentenceCase`. Boolean: `checkbox`. Number: `words`, `ordinal`.
- [ ] Every addition is a row in `LEGAL_FORMATS` plus an arm in `formatMergeValue`; **no default
      moves**.
- [ ] Tests: every new format, with money and number renderings proven integer-exact — formatting
      moves a decimal point and never multiplies.

**Verify:** package tests green.

## Task 34 — Formats through the checker and the interface

- [ ] `check.ts`: a computed field's `:format` suffix is checked against the new tables unchanged —
      confirm by test rather than by inspection, including a `name`-typed key inside `default(...)`.
- [ ] The picker's chosen field offers its formats (label plus example rendering per format), and the
      chip shows which format a placeholder carries. Design-system components only; no new floating
      or listbox machinery.
- [ ] Stories for the format chooser, including a field with one format (no chooser) and a field with
      seven.

**Verify:** `pnpm check`; storybook behaviour tests and axe pass.

## Task 35 — Documentation

- [ ] The template-author user guide under `docs/user/` gains the format tables, written as what a
      person types and what comes out.
- [ ] `changelog.d/` and `status.d/` fragments.

---

# Build slice 2·6·7 — Party subjects at scale

Where the key count actually arrives: fourteen party subjects times nine facets, on two new reads.

## Task 36 — The widened subject list

- [ ] Nine subjects added to the party registry: co-counsel, local counsel, guardian ad litem,
      conservator, trustee, personal representative, beneficiary, expert, insurer.
- [ ] Each carries its normalized role tokens, label, synonyms, and group; the fitness test proves no
      two normalize alike.
- [ ] Every existing party facet follows without a new row.

**Verify:** package tests green; the key count matches the design's arithmetic.

## Task 37 — The `partyContact` source

- [ ] One statement joining `matter_party` to the Directory contact tables with **a correlated scalar
      sub-select per facet** — a join per facet would produce a Cartesian product of a party's
      contact rows.
- [ ] Level-2 ambiguity in SQL: the sub-select returns the primary row where one exists, and the
      accompanying count is what tells resolution whether "no primary and several" applies.
- [ ] Resolution fills `<subject>.address`, `.emailAddress`, `.phone` for every subject from that one
      read, and the same values ride each item of the `<subject>.all` collections.
- [ ] `test/resolve-batching.test.ts`: a manifest naming a contact facet on all fourteen subjects
      issues **one** contact read.
- [ ] Tests: a party with two primary addresses is an absence naming the count; a party with one
      non-primary address resolves it; a party with none is an ordinary absence.

**Verify:** package tests green.

## Task 38 — Entity-axis custom fields on a subject

- [ ] `<subject>.custom.<handle>` entries derived per firm from `custom_field WHERE target = 'entity'`
      — the exclusion `custom-field-statements.ts` records is lifted now that a subject exists to
      hang them on.
- [ ] One read covering every (subject, handle) pair the manifest names, joined to the picklist option
      label and referenced record display name exactly as the matter-axis read is.
- [ ] `lex.ts`: the fixed-length handle atom rule extends to the prefixed form, so
      `opposingCounsel.custom.customField_…` lexes as one atom and a hyphen inside a handle is still
      never read as subtraction.
- [ ] Archived means absent, in both directions, exactly as it does on the matter axis.
- [ ] Prominence `secondary`, so a firm with thirty entity fields does not bury a party's name.

**Verify:** package tests green; the batching test covers the two-axis case.

## Task 39 — Capacity

- [ ] `matter_party.capacity` (text, nullable) plus its write path and a hand-written migration.
- [ ] The `capacity` facet; `capacityLine` is deferred to slice 2·6·10, where the estate it names
      exists.

**Verify:** migration applies; worker suite green.

## Task 40 — Firm role aliases

- [ ] `document_merge_role_alias (firm_role_text, subject_key)` plus a migration, an administrative
      surface under the existing party-role catalogue, and `templates:manage` on its writes.
- [ ] Read **once per assembly**, as part of planning the party read — never per role.
- [ ] A firm with no aliases behaves exactly as it does today (asserted).

**Verify:** worker suite green; `emit-openapi` + `generate-client` regenerated.

## Task 41 — Load profile and documentation

- [ ] The probe matter's party links widen to exercise several subjects, one of them ambiguous; the
      merge-context measurement's assertion stays on the **source count**.
- [ ] `CLAUDE.md`, user guide, `status.d/`, `changelog.d/`.

---

# Build slice 2·6·8 — Our people

The firm's own side of "attorneys and types of attorneys", and the first protected facets.

## Task 42 — Matter staffing

- [ ] **Confirm the table's shape with the Matters area before the migration** (design open question
      1): `matter_assignment (matter_id, member_user_id, assignment_role, valid_from, valid_to)`,
      with the existing `matter.responsible_member_id` remaining the responsible attorney's home and
      the table carrying the rest.
- [ ] Write path, reads, and routes under the matter's existing permissions.
- [ ] Classify in the personally-identifiable-information registry.

**Verify:** migration applies; worker suite green.

## Task 43 — The member professional profile

- [ ] `member_professional_profile` — title, admissions, direct dial, professional email, signature
      block. Owner area: Members / firm settings.
- [ ] An administrative surface for a member to maintain their own, and for an administrator to
      maintain any.

**Verify:** worker suite green.

## Task 44 — The `member` subjects and the `staffing` source

- [ ] Five member subjects — responsible, originating, supervising, billing attorney, assigned
      paralegal — over one batched read joining assignments to members and profiles.
- [ ] The member facet set: name, title, email address, direct dial, address (the office's), signature
      block, `all`.
- [ ] Level-1 ambiguity unchanged: two supervising attorneys is an absence naming the count, and
      `supervisingAttorney.all` is the way out.

**Verify:** package tests green; the batching test asserts one staffing read.

## Task 45 — Protected facets

- [ ] Gated on the protected-value binding seam from the document-automation plan; if that has not
      landed, this task lands with it.
- [ ] `<subject>.barNumber` resolves through `readProtected` only: decrypt permission checked, a
      `protected.decrypt` audit row per read, and a **named assembly failure** for a member without
      the permission — never a blank.
- [ ] **A protected facet is not decrypted for a subject that did not resolve.** A slot that resolved
      ambiguously is an absence before any decryption is attempted.
- [ ] Tax identifiers behind the firm setting owner flag H4 chose.
- [ ] Worker tests: with the permission (document plus audit row), without it (named failure), and on
      an ambiguous slot (no audit row at all).

**Verify:** worker suite green; `pnpm check`.

## Task 46 — Documentation

- [ ] User guide: what each staffing subject means and where a firm sets it; the audit consequence of
      a template that names a bar number.
- [ ] `status.d/`, `changelog.d/`.

---

# Build slice 2·6·9 — Courts, case identity, and captions

## Task 47 — The court-case record

- [ ] **Confirm with the Matters area, and with Directory on open question 2** (whether a court is a
      Directory organisation): `matter_court_case` — court reference, division, case number, filing
      date, judge reference, department, `client_designation`, `opposing_designation`.
- [ ] Write path, reads, routes, personally-identifiable-information classification.

**Verify:** migration applies; worker suite green.

## Task 48 — The `court` and `case` subjects

- [ ] One batched read joining the record to the court organisation and the judge; `court.*` gains the
      organisation's name and address facets for free if open question 2 resolves that way.
- [ ] `case.number`, `case.filedOn`, `case.division`, `case.department`, `case.clientDesignation`,
      `case.opposingDesignation`.
- [ ] Availability derives as `conditional` — a matter with no court case is not a defect.

**Verify:** package tests green; batching test covers the court read.

## Task 49 — Caption fixtures

- [ ] A pleading-caption fixture template exercising the designations, the court name, the case
      number, and an `upper`-formatted party name — the shape a caption actually takes.
- [ ] The output is asserted over emitted parts, and the template joins the document-engine validation
      harness.

## Task 50 — Documentation and load profile

- [ ] The court record joins the `documentAutomation` volume profile; the merge-context measurement
      grows one source.
- [ ] User guide, `status.d/`, `changelog.d/`.

---

# Build slice 2·6·10 — Estate and capacity

## Task 51 — The estate record

- [ ] `matter_estate` — decedent reference, date of death, estate style, short style, proceeding type,
      letters-issued date, and the estate's own identifier reference. **The style is stored, not
      composed**: a legal designation a court has fixed is not a string a template may invent.
- [ ] Write path, reads, routes, personally-identifiable-information classification.

**Verify:** migration applies; worker suite green.

## Task 52 — The `estate` subject

- [ ] One batched read joining the record to the decedent's Directory person, so every name format
      applies to `estate.decedent`.
- [ ] `estate.style`, `estate.shortStyle`, `estate.dateOfDeath`, `estate.proceedingType`,
      `estate.lettersIssuedOn`, `estate.decedent.*`.

**Verify:** package tests green.

## Task 53 — `capacityLine`

- [ ] Composed in the resolver from the party's name, the capacity recorded on the link, and the
      estate style when the matter carries one — **one absence for the whole phrase** when any part is
      missing, with a reason naming which part.
- [ ] Never template-concatenated: the test that proves it is the three-part absence case, which a
      hand-written template renders as stray punctuation and three markers.
- [ ] Works for a trust or a conservatorship the moment those identity records exist; the estate is
      the first, not the only.

**Verify:** package tests green.

## Task 54 — Probate fixtures and documentation

- [ ] A probate-petition fixture template exercising the estate style, the decedent's name in three
      renderings, and a capacity line.
- [ ] User guide, `status.d/`, `changelog.d/`.

---

# Build slice 2·6·11 — Discoverability and lifecycle at scale

The interface slice. Everything here is design-system components over data the earlier slices ship.

## Task 55 — Two-level grouping and prominence in the picker

- [ ] Group headings with subject subheadings; `secondary` facets collapsed behind a per-subject
      disclosure. **Prominence orders and collapses; it never removes** — a field that exists is
      always findable by search.
- [ ] Stories for a catalogue at full size, an empty group (never rendered), and a subject with a
      single facet.

**Verify:** `pnpm check`; storybook behaviour tests and axe pass.

## Task 56 — Relevance ordering

- [ ] The order is firm usage, then tag match with the template's matter type, then prominence, then
      alphabetical — and **never a filter**.
- [ ] Firm usage comes from the binding index (Task 25) as one aggregate read, asserted to be an index
      walk.

**Verify:** worker suite green; the load-profile plan scan shows an index walk.

## Task 57 — Deprecation surfacing

- [ ] A deprecated entry is hidden from the picker's default view, still resolves, and is flagged in
      the field inspector with what replaced it.
- [ ] An administrative "where is this field used" read over the binding index, under
      `templates:manage`.
- [ ] Tests: a template bound to a deprecated key still assembles; the inspector names the
      replacement.

**Verify:** worker suite green.

## Task 58 — The field inspector at scale

- [ ] The template's declared fields grouped the same way the picker groups them, with unresolved
      keys, unconverted Word merge fields, and deprecated bindings each called out where an author is
      looking.

## Task 59 — Documentation

- [ ] The template-author user guide covers finding a field, choosing a format, and reading an
      absence; the administrator guide covers role aliases and deprecation.
- [ ] `status.d/`, `changelog.d/`.

---

# Later, when their surfaces are live — financial and custody facts

Not a slice: an accretion pattern. `trust.*` (the matter's trust leaf balance and its available
balance), `billing.*` (work in progress, the last invoice, the outstanding balance), and custody
facts each become **one subject and one batched read** by the same mechanism, when the surface that
owns the number is live enough that a document stating it is trustworthy. Each costs one row in the
subject registry, one statement, and one arm in resolution. Nothing in slices 2·6·5 through 2·6·11
blocks them, and nothing in them changes anything already shipped.

---

## Sequencing and gates

**2·6·5 gates everything.** It changes no behaviour and adds no facts, so it is the safest slice in
this plan and the one every later slice is written against. It can land while other document-assembly
work is in flight, provided the generator's first output is proven byte-identical to the array it
replaces.

**2·6·6 depends only on 2·6·5** and is otherwise independent — no schema, no routes, no new reads. It
can run in parallel with 2·6·7.

**2·6·7 depends on 2·6·5** for the subject registry and on 2·6·6 for the structured value types its
address facet renders. Its two new reads are the first real test of the widened batching assertion.

**2·6·8, 2·6·9, and 2·6·10 are independent of each other** and each depends on 2·6·5 through 2·6·7.
Each opens with a schema task that needs its owning area's confirmation (Matters for staffing and the
court-case record, Members for the professional profile, Matters for the estate) — those
conversations are the real gate, not the code. Task 45 is additionally gated on the protected-value
binding seam.

**2·6·11 depends on all of them** for anything to show, though its grouping and prominence work needs
only 2·6·5.

**Owner flags.** H1 (platform tables versus custom fields) gates 2·6·8 through 2·6·10 entirely — a
"no" makes those three slices unnecessary and the design's key count roughly halves. H3 (`displayName`
gains formats) gates Task 30 and is the one flag that would change a shipped key's meaning if
answered the other way. H2 (role aliases) gates Task 40, H4 (which protected identifiers) gates Task
45, H5 (entity fields on every subject) gates Task 38, and H6 (relevance orders, never filters) gates
Task 56. Nothing in 2·6·5 or 2·6·6 is blocked by any flag.
