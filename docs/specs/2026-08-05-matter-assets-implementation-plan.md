# Slice 4·3 — Matter assets — implementation plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Each build slice below is sized for one agent batch and leaves `main` shippable on its own.

**Goal:** Build the matter-attached asset register — what a client or an estate owns, typed by a
closed platform class with a per-firm catalog under it and the firm's own fields beside it;
structured attributes per class (a property's address and parcel number, a vehicle's identification
number, a firearm's serial); documents linked to an asset without leaving the matter's file list;
interests held by Directory entities; an append-only valuation history answering "what was this
worth as of that date"; encumbrances and net equity; and the grouped estate schedule that falls out
of all of it.

**Architecture:** A new pure domain package `@magna-carta/matter-assets` on the established
structure-versus-access seam (mirrors `@magna-carta/custodian` and `@magna-carta/conflicts`): pure
TypeScript, no D1 binding, no Hono, no `env`, composing statements into `composeEffectBatch` and
returning typed results rather than throwing. Per-firm tables: `matter_asset`, `matter_asset_type`,
`matter_asset_interest`, `matter_asset_valuation`, `matter_asset_encumbrance`,
`matter_asset_document`, `matter_asset_identifier`, plus one attribute table per structured class
(`matter_asset_real_property`, `matter_asset_financial_account`, `matter_asset_vehicle`,
`matter_asset_firearm`, `matter_asset_business_interest`, `matter_asset_insurance_policy`,
`matter_asset_receivable`, `matter_asset_digital_asset`). The valuation history is append-only,
enforced by hand-written raw-SQL triggers (the `custody_movement` idiom — drizzle-kit cannot model
triggers). Document bytes never touch an asset route: they ride the File Manager's existing
presigned upload and quarantine chokepoint, and `matter_asset_document` links the resulting `file`
handle. Design spec:
[`docs/specs/2026-08-05-matter-assets-design.md`](2026-08-05-matter-assets-design.md).

**Tech stack:** TypeScript (ESM, ES2022), Drizzle (schema types only; migrations are hand-written
raw SQL where triggers are involved), Cloudflare D1 (per-firm) + R2, Hono + `@hono/zod-openapi`,
Vitest (+ `@cloudflare/vitest-pool-workers` for the worker suite), `vp` for test/lint/format.

## Global constraints

Every task's requirements implicitly include this section.

- **Full names, no shorthand** (golden rule 12): identifier prefixes spelled out — `matterAsset_`,
  `matterAssetType_`, `matterAssetInterest_`, `matterAssetValuation_`, `matterAssetEncumbrance_`,
  `matterAssetDocument_`, `matterAssetIdentifier_`; `vehicleIdentificationNumber`, never `vin`;
  `parcelNumber`, never `apn`; "the firm-scoped data-access layer", never an abbreviation;
  `newIdentifier`, never `newId`.
- **No process-artifact references in source, tests, or OpenAPI `description`s** (golden rule 13):
  no ADR numbers, no "spec", no "slice 4·3" except a forward-looking "built in slice 4·3·N"
  schedule note. Enforced by `pnpm lint:process-refs`.
- **All business data through the firm-scoped data-access layer** (golden rule 3): the route hands
  the package a firm-scoped database; nothing in the package holds a binding or crosses firms.
- **A valuation is appended, never updated and never deleted.** No code path anywhere issues an
  `UPDATE` or `DELETE` naming `matter_asset_valuation`; a correction is a new row naming the row it
  corrects.
- **No current-value column exists**, on any table, at any point. Every amount a read returns
  travels with the `as_of_date` and `basis` it came from.
- **No money as a float.** Every amount is `amount_minor` plus a currency through
  `@magna-carta/money`. No total is computed across currencies.
- **No credential is storable.** No column holds a password, passphrase, seed or recovery phrase,
  private key, personal identification number, or safe combination — plaintext or protected. The
  identifier write path refuses a credential kind with its own problem type.
- **Nothing derives a legal conclusion.** No code infers probate inclusion from an interest label,
  computes a transfer eligibility, classifies a regulated item, or produces a deadline.
- **Every mutation composes an `audit_log` row** in the same atomic batch, with `metadata` carrying
  identifiers only — never a description, an address, a parcel or serial number, an entity name, or
  an amount.
- **Every mutating route is idempotency-keyed** through the chokepoint; the create, batch,
  valuation, interest, encumbrance, document-link, and identifier routes are `required`.
- **One ingest chokepoint.** Document bytes reach `clean` through the File Manager's
  `initiateUpload` / `completeUploadSession` and the existing ingest consumer. Never write a
  `file_version` row directly, and never edit `packages/file-manager/src/ingest-core.ts`.
- **TDD:** write the failing test, watch it fail, implement the minimum, watch it pass, commit.
- **Migration ordinals and ADR numbers reconcile at merge** if a sibling slice lands first.

## Commands

- Package tests: `pnpm --filter @magna-carta/matter-assets test`
- Repo tests including the Miniflare worker suite: `pnpm test`
- Scoped gate (inner loop): `pnpm check:scoped` · full gate: `pnpm check`
- Process-reference lint: `pnpm lint:process-refs`
- OpenAPI snapshot: `pnpm --filter @magna-carta/worker run emit-openapi`
- Typed client: `pnpm run generate-client`
- Measurement baseline: `pnpm --filter @magna-carta/fixtures run measure`

---

# Build slice 4·3·1 — The register core

The walking slice: a firm opens an estate matter, bulk-adds a house and two bank accounts, attaches
a deed to the house, records a date-of-death appraisal and a later broker figure, and reads the
house's value as of the date of death. Real property and financial accounts only; the remaining
classes ride 4·3·2 on the same spine.

## Task 1 — Identifiers, permissions, and the package scaffold

- [ ] `packages/identifiers/src/registry.ts` + `types.ts`: seven prefixes and branded types —
      `matterAsset`, `matterAssetType`, `matterAssetInterest`, `matterAssetValuation`,
      `matterAssetEncumbrance`, `matterAssetDocument`, `matterAssetIdentifier`.
- [ ] `packages/access-control/src/registry.ts`: `matterAssets:read` and `matterAssets:manage`, each
      with the one-line comment the registry's convention requires — including why the namespace is
      not the bare word (Workers Static Assets and the excluded firm-property register both claim
      it).
- [ ] `apps/worker/test/conformance.test.ts`: add `matterAssets: "matter"` to
      `RESOURCE_BY_PERMISSION_NAMESPACE`, with the comment stating why the matter is the tenancy
      root — an asset row is one matter's assertion and cannot exist without one, the clean contrast
      with the `custody:*` firm binding.
- [ ] Scaffold `packages/matter-assets/` — `package.json` (workspace dependencies:
      `@magna-carta/money`, `@magna-carta/identifiers`, `@magna-carta/data-access`,
      `@magna-carta/database`), `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, copied
      from `@magna-carta/custodian`.
- [ ] `packages/matter-assets/CLAUDE.md` from the area template: the append-only valuation rule, the
      no-current-value rule, the credential refusal, the no-legal-conclusion rule, and the
      Custodian boundary in two sentences.

**Verify:** `pnpm --filter @magna-carta/matter-assets test` (empty suite passes); conformance test
green.

## Task 2 — The class spine and the type catalog

- [ ] `packages/matter-assets/src/classes.ts` — the closed class registry: key, label, whether it
      has an attribute table, the seeded per-firm types it provisions, and the optional
      `handlingNote` (empty for every class in this slice).
- [ ] `packages/database/src/per-firm-schema.ts`: `matter_asset_type` — id, name, `class`, optional
      code, `active`, position, timestamps; unique name per firm; index on `class`.
- [ ] `packages/matter-assets/src/asset-type-service.ts` + `asset-type-statements.ts` — create,
      rename, deactivate (never delete), list by class. The `custody_item_type` service is the model.
- [ ] Provisioning seeds the starting catalog for the two classes this slice ships.

**Verify:** package tests; a type may not be hard-deleted; a duplicate name is refused.

## Task 3 — The asset row and its migration

- [ ] `per-firm-schema.ts`: `matter_asset` — id, `matter_id` (NOT NULL, references `matter`),
      `class`, `asset_type_id` (nullable), `description` (non-empty check), `acquired_on`,
      `estate_treatment` (`probateEstate` / `nonProbateTransfer` / `undetermined`, default
      `undetermined`), `disposition` (default `retained`), `disposition_on`, `custody_item_id`
      (nullable, no index requirement yet), `notes`, `created_at` / `created_by`, `updated_at`,
      `deleted_at`. Checks on the class and the two enums; index on `(matter_id, class, created_at,
    id)` for the filtered keyset list.
- [ ] `matter_asset_real_property` and `matter_asset_financial_account` — one-to-one on
      `asset_id` (primary key), columns per the design. Real-property field names mirror
      `PropertyReference` in `@magna-carta/property-links`; indexes on `parcel_number` and on
      `(region, city)`.
- [ ] The write path enforces **type-class agreement** and **class immutability**, each with its own
      problem type.
- [ ] Classify the new person-referencing tables in the personally-identifiable-information registry
      in this same change (`matter_asset_real_property` carries a home address).

**Verify:** migration applies against a fresh per-firm database in the fixtures harness; a type from
the wrong class is refused; a `PATCH` naming `class` is refused.

## Task 4 — The valuation history, append-only

- [ ] `per-firm-schema.ts`: `matter_asset_valuation` — id, `asset_id`, `encumbrance_id` (nullable,
      unused until 4·3·2), `as_of_date`, `amount_minor` + `currency`, `basis`, `source_note`,
      `supporting_file_id`, `corrects_valuation_id`, `recorded_by`, `recorded_at`. Check that an
      amount and a currency are both present or both absent; index on
      `(asset_id, as_of_date DESC, recorded_at DESC)`.
- [ ] Hand-written raw-SQL migration carrying the three triggers (`BEFORE UPDATE`, `BEFORE DELETE`,
      and the `BEFORE INSERT … WHEN EXISTS` that catches `INSERT OR REPLACE`), each `RAISE(ABORT)`
      with a message naming the rule — the `custody_movement` migration is the model to copy
      verbatim in shape.
- [ ] Extend the append-only source-scan fitness function to cover `matter_asset_valuation`.
- [ ] `valuation-service.ts` — append, and append-a-correction. No update path exists to write.
- [ ] `as-of.ts` — the resolution read: latest `as_of_date` at or before a requested date, excluding
      any row a correction supersedes; returns amount, currency, `as_of_date`, and `basis` together
      or nothing at all.
- [ ] Tests as the table in the design's test strategy: before the first valuation, exactly on a
      date, between two dates, a corrected row never resolving, its correction resolving.

**Verify:** migration tests against a real SQLite database — a direct `UPDATE` aborts, a direct
`DELETE` aborts, an `INSERT OR REPLACE` on an existing id aborts.

## Task 5 — Interests

- [ ] `per-firm-schema.ts`: `matter_asset_interest` — id, `asset_id`, `entity_id` (a Directory
      handle, **no cross-domain foreign key** — the `matter_party` / `custody_owner` precedent),
      `interest_role`, `share_numerator`, `share_denominator`, `effective_from`, `effective_to`,
      timestamps. Check that the share parts are both present or both absent and that the
      denominator is positive. Index on `(entity_id, effective_to)` for the cross-matter read.
- [ ] `interest-service.ts` — add, end (temporal, never a delete). `interest_role` is validated
      against the per-firm label catalog, following the ratified custody ownership-label answer;
      reuse that catalog's shape rather than minting a second mechanism.
- [ ] Classify in the personally-identifiable-information registry.

**Verify:** package tests; a share of `1/0` is refused; ending an interest writes a date and no row
disappears.

## Task 6 — Document links

- [ ] `per-firm-schema.ts`: `matter_asset_document` — id, `asset_id`, `file_id`, `kind`, `note`,
      `linked_at`, `linked_by`. **No unique index on `file_id`** — one statement supports several
      accounts; the divergence from `custody_scan` is deliberate and carries a schema comment saying
      so.
- [ ] `document-link-service.ts` — link an already-ingested file, unlink (the link row is removed;
      the file is untouched), list by asset. The write path asserts the file belongs to the asset's
      matter.
- [ ] No upload route, no presigned URL, no bytes: the File Manager's chokepoint is the only ingest.

**Verify:** linking a file from another matter is refused; unlinking leaves the file in the matter's
file list.

## Task 7 — Routes

- [ ] The nine routes this slice needs, per the design's route table: list, create (with an inline
      valuation and interests riding the same batch), batch create, detail, patch, soft delete,
      valuation append, valuation list, interest add, document link and unlink, and the type catalog
      pair.
- [ ] The batch route takes a bounded list (the bound is a named constant with the reason beside it),
      is idempotency-`required`, and writes one audit row per asset inside one batch.
- [ ] Problem types registered: `matter-asset-type-class-mismatch`, `matter-asset-class-frozen`,
      `matter-asset-valuation-append-only`, `matter-asset-currency-mismatch`,
      `matter-asset-batch-too-large`.
- [ ] `pnpm --filter @magna-carta/worker run emit-openapi` and `pnpm run generate-client`.

**Verify:** conformance suite green (permission, resource, idempotency, audit per route); a retried
batch writes each asset exactly once.

## Task 8 — Telemetry, load profile, and documentation

- [ ] Telemetry declarations: the `matterAssets.assetRecorded` event and the four counters, with the
      catalog test asserting no high-cardinality dimension.
- [ ] `packages/fixtures`: a `matterAssets` volume profile — assets across the two shipped classes,
      long valuation histories on a fraction of rows — and the measured operations for the list, the
      as-of read, and the batch write. Generator version bumps.
- [ ] `docs/user/`: the end-user guide for logging assets and recording values (task-oriented, no
      architecture).
- [ ] `changelog.d/` fragment; `status.d/matter-assets.md` fragment; `roadmap.d/core-domain.md` node
      for the capability.

**Verify:** `pnpm --filter @magna-carta/fixtures run measure` — the plan-scan check shows index walks
on all three measured reads; `pnpm check`; `pnpm test`.

---

# Build slice 4·3·2 — Every class, encumbrances, and the schedule

The register becomes the thing the owner asked for: cars, guns, business interests, policies,
receivables, digital assets, and the grouped estate schedule with equity.

## Task 9 — The remaining attribute tables

- [ ] `matter_asset_vehicle`, `matter_asset_firearm`, `matter_asset_business_interest`,
      `matter_asset_insurance_policy`, `matter_asset_receivable`, `matter_asset_digital_asset` — one
      migration, columns per the design, each one-to-one on `asset_id`.
- [ ] Searchable indexes on `vehicle_identification_number`, `plate_number`, and
      `firearm.serial_number` — public-record identifiers, plaintext by design, and the schema
      comment says why they are not protected while an account number is.
- [ ] `matter_asset_digital_asset` has **no credential column**, and the table comment states the
      refusal and points at the custody register as the correct home for a sealed secret.
- [ ] `personalProperty` and `other` get no table; assert in the class registry test that a class
      declaring no attribute table has none.
- [ ] Seed the per-firm type catalog for every new class.
- [ ] Classify `matter_asset_receivable` and `matter_asset_insurance_policy` (entity references) in
      the personally-identifiable-information registry.

**Verify:** migration applies; a create naming vehicle attributes on a `firearm` asset is refused.

## Task 10 — Protected identifiers

- [ ] `matter_asset_identifier` — id, `asset_id`, `kind`, `display_suffix` (plaintext, at most four
      characters), `value_ciphertext`, `created_at` / `created_by`.
- [ ] Register `{ table: "matter_asset_identifier", column: "value_ciphertext" }` in
      `PROTECTED_COLUMNS`; the data-access conformance fitness and the no-plaintext-escape source
      scan must both pass with exactly one field declaration.
- [ ] Write path: through `protected()`, refusing a credential kind with
      `matter-asset-credential-storage-refused`; `value_ciphertext` is nullable, so a suffix alone is
      a complete record.
- [ ] Read path: one route, decrypt permission required, one `protected.decrypt` audit row per read,
      a named failure and never a blank when the permission is absent.
- [ ] Every list, detail, schedule, and report read returns `display_suffix` only — asserted by a
      test that greps the read projections.

**Verify:** the two worker cases (with and without the decrypt permission); a credential-shaped
write is refused and stores nothing.

## Task 11 — Encumbrances and equity

- [ ] `matter_asset_encumbrance` — id, `asset_id`, `kind`, `holder_entity_id`, `holder_name`,
      `recorded_reference`, `released_on`, timestamps. Classify it, with `holder_name` as a
      value-keyed subject key (the frozen-email-address precedent).
- [ ] `matter_asset_valuation.encumbrance_id` comes into use: a row naming an encumbrance is that
      encumbrance's balance as of a date. The write path refuses an `encumbrance_id` that does not
      belong to the row's asset.
- [ ] `equity.ts` — value as of a date minus every unreleased encumbrance's balance as of the same
      date, per currency, never summed across currencies.

**Verify:** the equity table test, including an asset with two mortgages and one released lien.

## Task 12 — The class handling notice

- [ ] The class registry's `handlingNote` gains one entry: firearms. Short, non-jurisdictional,
      naming no statute and no deadline — the register records what is held, not who may receive it.
- [ ] It is returned by the class registry read and rendered by the interface; nothing branches on
      it.
- [ ] A test asserts the note contains no jurisdiction name, no statute citation, and no numeral —
      the mechanical guard against it drifting into advice.

**Verify:** package tests.

## Task 13 — The schedule read

- [ ] `schedule.ts` — grouped by class, each row carrying description, type, value with its basis and
      actual as-of date, unreleased encumbrances with balances, equity, and estate treatment;
      subtotals per class per currency; the unvalued count stated rather than hidden; the
      `undetermined` estate-treatment group present rather than merged away.
- [ ] `GET /api/v1/matters/{matterId}/asset-schedule?asOf=…`, cursor-free (a schedule is read whole)
      with a bounded asset count and a documented behaviour past it.
- [ ] The as-of date is a required parameter with no default — a schedule with an implied date is the
      failure this subsystem most wants to avoid.

**Verify:** the end-to-end schedule test in the design's test strategy — as of the date of death and
as of today, over the same corpus, with only the numbers moving.

## Task 14 — Load profile and documentation

- [ ] Extend the `matterAssets` profile to every class; add the as-of schedule read and the
      interests-by-entity read to the measured operations.
- [ ] `docs/user/`: extend the guide with the schedule, encumbrances, and what the firearm notice
      means.
- [ ] Fragments.

**Verify:** `measure` shows index walks on all five measured reads; `pnpm check`; `pnpm test`.

---

# Build slice 4·3·3 — Merge fields, the firm's own fields, and the custody link

The register becomes an input to documents.

## Task 15 — The firm's own fields on an asset

- [ ] `custom_field.target` widens to include `matterAsset` — one additive value, plus the migration,
      with the handle-not-name binding discipline the engine already enforces. Coordinate with the
      Custodian `custodyPacket` widening if it has not landed: one migration, both values.
- [ ] Scoping per class through the existing `attachment_id` column; the engine's existing limits and
      lifecycle apply unchanged.
- [ ] The asset detail read returns the firm's own field values; the write path accepts them.

**Verify:** custom-fields package tests plus an asset round trip; the engine's fitness functions
green.

## Task 16 — The asset subjects in the merge catalogue

- [ ] `packages/document-assembly/src/catalog/subjects.ts` gains the `assetClass` subject kind and
      eleven subjects — ten classes plus the aggregate `assets`.
- [ ] They are **collection-only**: each declares `.all` with `itemFields` and no scalar facets. A
      fitness assertion states that no `assetClass` subject declares a scalar, with the reason (a
      matter with two houses would make every scalar an absence).
- [ ] Item fields: the common set on `assets.all`, each class's structured attributes on its own
      subject. `value` and `valueAsOf` are declared together and a test asserts neither exists
      without the other.
- [ ] **No protected value is a facet** — `accountSuffix` is the facet, the full number has no key,
      and a test asserts no dictionary entry resolves from `matter_asset_identifier.value_ciphertext`.
- [ ] Golden key list updated; the key-permanence test covers the new keys.

**Verify:** `pnpm --filter @magna-carta/document-assembly test`.

## Task 17 — The one new assembly source

- [ ] `resolve.ts` gains the `asset` source: one statement over the matter's assets, left-joined to
      the class attribute rows and the as-of valuation resolution, filling every asset subject in one
      pass.
- [ ] The as-of date comes from the matter's estate record when one exists and from the assembly
      context otherwise; the resolved date is always carried into `valueAsOf`.
- [ ] The batching test generalizes: a manifest naming every asset key issues **one** read, and
      adding a class adds none.
- [ ] Absence: `.all` is `blank` (an empty list is a correct document), matching the catalogue's rule
      for collections.

**Verify:** the source-count assertion, not a duration; the merge-context measurement moves with
sources and not with fields.

## Task 18 — The custody link

- [ ] `matter_asset.custody_item_id` comes into use: set and cleared through the patch route, with
      the write path asserting the item exists in this firm. **No unique index** — the same held
      object may be scheduled in two matters, and the schema comment says why.
- [ ] The asset detail read composes Custodian's current location, status, and hold state by
      **reading** Custodian; it copies none of them into an asset column.
- [ ] A test asserts no code path writes a valuation from a custody declared value or the reverse —
      the two numbers answer different questions.

**Verify:** the end-to-end path linking a scheduled ring to the custody item that holds it.

## Task 19 — The schedule as a document, and documentation

- [ ] A starter template assembling the schedule from the asset subjects with a repeating block, in
      the document-automation starter content — not a court form, and the user documentation says so
      in those words.
- [ ] `docs/user/`: how asset fields reach a document, and why a value always prints with its date.
- [ ] Fragments.

**Verify:** `pnpm check`; `pnpm test`.

---

# Build slice 4·3·4 — Carry-forward, integrations, and the portal

Deferred deliberately; each needs a decision or a consumer that does not exist at design time.

## Task 20 — Carry-forward from a prior matter

- [ ] Copy selected assets from one matter to another as **new rows with recorded provenance**
      (`copied_from_asset_id`), never a shared row. The read of the source matter is explicit and
      permission-checked in that matter.
- [ ] Valuations do not copy by default: a value asserted in one matter as of one date is not an
      assertion in another. Copying them is an explicit choice with the basis preserved.

## Task 21 — The parcel and valuation adapters

- [ ] The parcel port fills real-property columns that already exist; the valuation port appends rows
      with basis `automatedEstimate` and can never write `appraisal`.
- [ ] Both behind the integration platform's per-firm credentials and consent gates; procurement,
      not engineering, is the gate on which vendor.

## Task 22 — Portal visibility

- [ ] "What does the estate own" as a portal surface, at a granularity settled before the grant model
      hardens — the open question the design leaves for that area.

---

## Definition of done (every slice)

- [ ] `pnpm check` and `pnpm test` green; `pnpm lint:process-refs` green.
- [ ] `pnpm --filter @magna-carta/fixtures run measure` green with the plan-scan check showing index
      walks on every measured read.
- [ ] Developer documentation current (the area `CLAUDE.md`), user documentation current
      (`docs/user/`), and the changelog, status, and roadmap fragments committed in the same commit
      as the code.
- [ ] Any decision taken during the build recorded as a fragment in `docs/decisions/pending/`.
