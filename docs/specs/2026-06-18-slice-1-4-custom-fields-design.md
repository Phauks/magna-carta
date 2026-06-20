# Slice 1·4 — the shared custom-fields engine — design

**Status:** Accepted (design) · **Date:** 2026-06-18 · **Owner:** Trevor Goldsmith
**White-paper home:** _Directory_ + _Matters and File Manager_ (the category/custom-field promise) · consumed later by _Document Automation_
**Design seed:** the typed-EAV shape settled in [`docs/specs/2026-06-12-slice-1-3-directory-design.md`](2026-06-12-slice-1-3-directory-design.md) §9.3
**ADRs:** **ADR-0107 (custom-fields engine realization — this slice)** · **ADR-0108 (custom-field lifecycle & governance — this slice)** · builds on ADR-0087 (the slice promotion + the seed), ADR-0085/0086 (the Directory model + non-destructive merge/relink this extends), ADR-0061 (integer-minor amounts, no floats), ADR-0062 (type-prefixed handles), ADR-0071 (the package/data-access seam), ADR-0078/0083 (build-when-in-the-area + load-profile accretion), ADR-0084 (the `protected()` machinery available to sensitive fields), ADR-0003 (per-firm tenancy), ADR-0017/0038 (observability).

> **Migration & ADR numbering.** Reconciled at the merge to `main`: the `custom_field` migration lands as `0013_custom-fields` (after main's `0012_usage-analytics-opt-out`), and the two ADRs (ADR-0107, ADR-0108) were carried as `docs/decisions/pending/` fragments and numbered contiguously by `vp run decisions-build` at merge — the fragment convention that replaced hand-editing the register.

This spec is the implementation-grade design for slice 1·4 ([`ROADMAP.md`](../../ROADMAP.md)): the **shared custom-fields engine** — the per-firm, typed-EAV layer that lets a firm's own administrator add fields to **matters** (the matter-type axis from slice 1·1) and **directory entities** (the entity-category axis from slice 1·3) without a code change or a per-firm schema. It does not restate the typed-EAV shape settled in the 1·3 spec §9.3 (ADR-0087) — it fixes the tables, columns, identity model, write paths, the field/value lifecycle, the retype and merge behaviours, the APIs, and the governance guards that keep firm-controlled data input from degrading the platform's invariants. **Backend only; no UI** (the UI plan rides 0·7a/0·7b like 1·1 and 1·3).

**Build gates:** slice 1·1 landed (the `matter` + `matter_type` + `setting` + `audit_log` tables and the firm-scoped write path), slice 1·2 landed (the `protected()` machinery + blind-index policy table), slice 1·3 landed (the Directory: `directory_category` / entity tables, the non-destructive `merge.ts` engine with `REPOINT_TARGETS`, the `fitness.ts` reference probes, and `name-history`'s append-and-flip). All three are on `main`; this slice attaches to them.

**This slice is a prerequisite for:** Phase 2·6 (document automation binds custom merge fields), and every later consumer that reads custom data — reporting, list-view filtering, and search — which all bind through the stable field handle this slice fixes.

---

## 0. The governance decisions — resolved

Custom fields hand the firm direct control over its own data model. That power is the feature; left ungoverned it is also how the platform's invariants rot (renames that cascade, retypes that lose data, deletes that orphan automation, schemas that bloat). The owner resolved the governance model (2026-06-18) so the engine is built on rails, not bolted on:

1. **Identity is a stable handle; the name is a label (ADR-0107).** Every field and picklist option carries an immutable `customField_` / `picklistOption_` handle as its primary key and public id (ADR-0062), with a separate, freely-editable display `name`. Everything downstream — stored values, picks, the document-automation merge binding, reports — binds to the **handle, never the label**. A rename is a one-column `UPDATE` with zero rows moved. This is the exact id-vs-label pattern the directory already uses for categories, kinds, and names (§3).

2. **Retype is allowed, as a non-destructive guided Convert (ADR-0108).** A firm may change a field's `kind` after values exist — the owner will not accept "create a new field and lose the old data." Because values are kept as history (decision 3), a kind change is a **previewable, reversible** transformation, never a destructive coercion: it classifies each value (clean / needs-a-rule / un-coercible), the admin decides what happens to the un-coercible ones (park or block — never a silent drop), and applying it appends the coerced values while flipping the originals to history (§5).

3. **Value history is full-temporal; audit is split by content sensitivity (ADR-0107).** Editing a value uses the directory's append-and-flip pattern: one live row per field per target, with prior values preserved as history. The **who/when** of a change lives in the shared `audit_log`; the **what-it-was** lives in the value rows themselves — because golden rule 4 (redact by default) keeps `audit_log.metadata` null, a field value (which can be privileged content) must never be written into the audit log (§4). No new infrastructure; the marginal cost is a handful of small rows per _edited_ field, and custom-field values are low-churn.

4. **Delete is archive-first; a gated Purge is the erasure seam (ADR-0108).** Removing a field **archives** it by default (off entry forms, all data kept and readable, still resolved by automation flagged "archived"). A true hard-delete is permitted **only** when the field has zero values **and** zero references (a clean undo of a setup mistake). Compliance erasure — the one case archive cannot serve — is a separate, permission-gated, audited, irreversible **Purge**; its seam is designed here and the operation is built when a real erasure obligation appears (§6.4).

5. **Conformity templates are deferred — gate: before the first real client (ADR-0108).** Practice-area field "pre-builds" (curated starter bundles a firm applies in one click) are out of this slice. The only cost-now obligation is a reserved, unused `template_field_key` column + provenance hooks so a forked template field stays alignable later (§11). There are no production firms yet, so the retrofit is cheap until then; the gate ensures it is addressed before it stops being cheap.

_Decision-to-ADR map: identity (1) and value history (3) are **ADR-0107** (engine realization); retype (2), delete/purge (4), and templates-deferred (5) are **ADR-0108** (lifecycle & governance)._

---

## 1. Package placement

One new domain package on the ADR-0071 structure-vs-access seam, composing the slice-0·2 atomic write batch exactly as `@magna-carta/directory` and `@magna-carta/matters` do:

- **`@magna-carta/custom-fields`** — the domain package: the field-definition service (define / rename / retype-Convert / archive / hard-delete / purge), the value service (set / edit / clear as append-and-flip), the picklist-option service, the coercion classifier the Convert preview runs, the reference-kind validators, and the table-wide fitness queries. Pure domain logic; composes `composeEffectBatch` statements, never touches Hono or `env` directly. Dependencies: `@magna-carta/identifiers`, `@magna-carta/database` (the schema), `@magna-carta/data-access` (the atomic batch + `audit-statements` + the `protectedField` registry), `@magna-carta/money` (currency-kind scaling, ADR-0061). It serves **both** the matter axis and the entity axis — the genuinely-shared subsystem ADR-0087 named — so it is its own package, not folded into `matters` or `directory`.
- **`packages/database`** — the three tables (§2) land in the per-firm lineage as migration `0013_custom-fields` (raw SQL, `--> statement-breakpoint` delimited, journal-registered — the established authoring pattern). Because the tables live here in the shared schema package, the directory's `merge.ts` can reference `custom_field_value` **by name** when the 1·4 work adds the repoint targets (§8): `@magna-carta/directory` never imports `@magna-carta/custom-fields`, and `@magna-carta/custom-fields` never imports `@magna-carta/directory` (its reference validation needs only the `@magna-carta/identifiers` prefixes) — the two domain packages are siblings, no dependency cycle.
- **`packages/data-access`** — custom-field reads/writes ride the existing firm-scoped gate (golden rule 3). A custom field declared sensitive registers against the 1·2 `protectedField` policy table (§9); no new enforcement layer.
- **Worker routes** — the `/v1/custom-fields/*` surface registered through the 0·5 `defineOpenAPIRoute` chokepoint (§10).

## 2. The data model

Three tables. Definitions and options are per-firm administrative data; values are per-record, typed, and temporal.

### 2.1 `custom_field` — the definition

| Column                      | Type / shape                      | Notes                                                                                                                                                                                             |
| --------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | TEXT PK — `customField_` handle   | **immutable identity** (`newIdentifier('customField', …)`); the durable reference for every value, merge binding, and downstream consumer                                                         |
| `name`                      | TEXT, not null                    | **mutable display label**; renamed freely (§3)                                                                                                                                                    |
| `kind`                      | TEXT CHECK                        | the fixed 12-kind catalog (§2.4)                                                                                                                                                                  |
| `target`                    | TEXT CHECK (`matter` \| `entity`) | which record axis it attaches to                                                                                                                                                                  |
| `attachment_id`             | TEXT, nullable                    | a `matterType_` id (target `matter`) or `directoryCategory_` id (target `entity`); **null = all** records on that axis                                                                            |
| `number_scale`              | INTEGER, nullable                 | decimal places for a `number` field; `currency` uses the firm-currency minor-unit scale instead (§2.5); null for other kinds                                                                      |
| `required`                  | INTEGER 0/1                       | value required on save (a UI/validation policy, not a DB CHECK); applies only to saves _after_ the toggle — never retroactive to existing records — and is skipped entirely for an archived field |
| `archived`                  | INTEGER 0/1                       | retired without data loss (§6.3)                                                                                                                                                                  |
| `converting`                | INTEGER 0/1                       | set for the duration of a bulk Convert (§5); the `kind` flips only when it clears, so readers never see a mixed-kind field                                                                        |
| `position`                  | INTEGER                           | display order within its attach scope                                                                                                                                                             |
| `template_field_key`        | TEXT, nullable                    | **reserved, unused** — the conformity-template alignment seam (§11)                                                                                                                               |
| `created_at` / `created_by` | TEXT / TEXT                       | provenance                                                                                                                                                                                        |

Entity-axis person/organization applicability is **inherited from the attached category** (`directory_category.applies_to`); a field with `attachment_id = null` on the entity axis applies to both kinds, and on the matter axis to all matter types. No separate `applies_to` column is duplicated onto the field.

### 2.2 `picklist_option` — child of a `picklist` field

`id` (TEXT PK, `picklistOption_` handle) · `field_id` (FK → `custom_field.id`) · `name` (mutable label) · `position` · `archived` (0/1). A stored pick references `option.id`, **never the label**, so an option renames freely and an archived option keeps existing picks resolvable (§7).

### 2.3 `custom_field_value` — the typed, temporal value

| Column                      | Type / shape                             | Notes                                                                                                                                                                                                             |
| --------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | TEXT PK — `customFieldValue_` handle     |                                                                                                                                                                                                                   |
| `field_id`                  | TEXT FK → `custom_field.id`              |                                                                                                                                                                                                                   |
| `target_row_id`             | TEXT                                     | the record the value is on — a `matter_` id, or a `directoryPerson_`/`directoryOrganization_` id; the handle prefix discriminates (the `matter_party.entity_id` precedent), validated at the data-access boundary |
| `value_text`                | TEXT, nullable                           | text / single-line / multi-line / url / email                                                                                                                                                                     |
| `value_number`              | INTEGER, nullable                        | scaled integer (no floats, ADR-0061); scale from `custom_field.number_scale` / firm currency (§2.5)                                                                                                               |
| `value_date`                | TEXT, nullable                           | ISO-8601 date / time                                                                                                                                                                                              |
| `value_option_id`           | TEXT FK → `picklist_option.id`, nullable | picklist pick                                                                                                                                                                                                     |
| `value_reference_id`        | TEXT, nullable                           | a `matter_` / `directoryPerson_` / `directoryOrganization_` handle, validated against the field's kind (§8)                                                                                                       |
| `is_current`                | INTEGER 0/1                              | the live value; history rows carry 0                                                                                                                                                                              |
| `valid_from` / `valid_to`   | TEXT / TEXT nullable                     | append-and-flip temporal validity (§4)                                                                                                                                                                            |
| `created_at` / `created_by` | TEXT / TEXT                              | per-row provenance (pairs with the `audit_log` event)                                                                                                                                                             |

`field_id`, `target_row_id`, `is_current`, `valid_from`, `created_at`, and `created_by` are `NOT NULL`; the five `value_*` columns and `valid_to` are nullable. `created_by` is the session actor and `created_at` / `valid_from` the write clock (supplied by the write path, not a DB default).

**Invariants (CHECK + index + fitness):**

- **Exactly one `value_*` non-null** per row — a CHECK enumerating the five value columns. The integer kinds count: an unchecked checkbox is `value_number = 0`, which is non-null and satisfies the CHECK. A row with all five `value_*` null is **not** allowed; "no value" for a record = **no `is_current = 1` row**, never an empty row (§4).
- **`UNIQUE(target_row_id, field_id) WHERE is_current = 1`** — a _partial_ unique: one live value per field per record, unlimited history behind it. This **refines** the seed's `UNIQUE(target, field)` to admit the append-and-flip history (§0.3) while preserving one-current-value. The directory already relies on a D1 partial index for the same purpose (`directory_name`'s one-current-name discipline), so the mechanism is proven in this codebase, not assumed — the integration tests (§13) re-confirm enforcement under concurrent writes.
- A fitness query asserts no `value_reference_id` or `target_row_id` points at a `merged_into` subordinate (§8), mirroring the directory's relink-completeness probe.

### 2.4 The kind catalog — a closed set, by design

`kind` is a **CHECK** (not an open catalog) over the twelve kinds settled in the seed:

`checkbox` · `date` · `time` · `number` · `currency` · `picklist` · `single-line` · `multi-line` · `url` · `email` · `matter-reference` · `contact-reference`.

Closed is deliberate governance: a firm composes its fields from a vetted, typed vocabulary; it **cannot invent arbitrary kinds**. Widening the catalog is a deliberate platform migration (a new CHECK value + the value-column and validator wiring), never a firm-controllable action. This is the typed-EAV bargain — finite kinds, infinite fields — and it is what keeps values findable, sortable, summable, and mergeable (the reasons JSON storage was rejected, ADR-0087).

**Kind → storage column.** The twelve kinds map onto the five typed value columns the exactly-one-non-null CHECK enumerates: `value_text` (single-line / multi-line / url / email), `value_number` (number / currency, and `checkbox` as 0 / 1), `value_date` (date / time-of-day, both ISO-8601), `value_option_id` (picklist), `value_reference_id` (matter-reference / contact-reference).

### 2.5 Numbers without floats (ADR-0061)

`number` and `currency` values are stored as **scaled integers** in `value_number`. `currency` uses the firm-currency minor units (the `@magna-carta/money` scale, as `ledger_line.amount_minor`); `number` uses a per-field `number_scale` (decimal places, default 0). The stored value is `displayed × 10^scale`. No float column ever exists — the fitness "no-float-columns" scan (the ADR-0061 discipline) extends to this table.

## 3. Field identity & the downstream binding contract

The identity decision (§0.1) is the spine of the whole engine, so it is stated as a contract:

- **The handle is the only durable reference.** `custom_field_value.field_id`, `picklist_option.field_id`, `value_option_id`, document-automation merge bindings, and any later reporting/search reference resolve a field by its `customField_` handle. The display `name` is presentation only.
- **Rename is free.** Changing `name` (or an option `name`) is a single-column `UPDATE` + a `custom_field.renamed` audit event. Nothing else moves. There is no field-label history table in v1 (YAGNI — the audit event records that a rename happened; a generated document captures the label-as-rendered at generation time, which is a document artifact, not a live binding). The append-and-flip option exists if label history is ever wanted; it is not built now.
- **The document-automation seam (the 2·6 prerequisite).** A field is always resolvable by handle from `custom_field` (the durable mapping, `SELECT … WHERE id = ?`). This slice fixes the **contract** a `resolveCustomField(handle)` read returns — a tagged result `{ status: 'active', field }` | `{ status: 'archived', field }` | `{ status: 'absent' }` — so the later automation engine binds templates to handles and can **detect at generation time** that a field is archived (degrade gracefully, flag it) or absent — instead of silently emitting a blank. The handle→definition read ships in this slice; a curated resolver helper and the template-variable syntax are 2·6's to build on top. The same contract serves future reporting/search consumers, so they all reference fields one way.

## 4. Value lifecycle & temporal history

A value write is the directory `name-history` append-and-flip, composed into one atomic effect-batch:

- **Set / edit:** flip the prior current row (`is_current = 0`, `valid_to = now`) if one exists, insert the new current row (`is_current = 1`, `valid_from = now`, the one typed column set), and emit a `custom_field.value_set` audit event (subject = the `custom_field_value` id, with `field_id` as the related field; actor; clock). The partial-unique keeps exactly one current row.
- **Clear:** flip the current row to history; emit `custom_field.value_cleared`. "Cleared" is the absence of a current row, not an all-null row.
- **Read (hot path):** `WHERE target_row_id = ? AND is_current = 1` — partial-indexed, same cost as a current-only design. History reads drop the `is_current` filter and order by `valid_from`.

**Audit split (the §0.3 rule, restated because it is easy to get wrong):** the `audit_log` records _that_ a value changed, _who_ and _when_ — never the value content (golden rule 4; `audit_log.metadata` stays null). The old/new content lives only in the per-firm `custom_field_value` rows (firm business data, correctly scoped), recoverable by reading history. This gives a complete legal change-trail without leaking privileged content into the observability pillar.

**Definition-level events.** Changes to a _definition_ are audited the same way, subject = the `custom_field` id: `custom_field.defined`, `custom_field.renamed`, `custom_field.kind_changed` (§5), `custom_field.archived` / `custom_field.unarchived`, `custom_field.hard_deleted`, and `custom_field.purged` (when Purge is built). Option changes mirror these on the `picklist_option` id. They record _that_ and _who/when_, never content — the same redaction rule.

## 5. The Convert operation — retype without data loss

A `kind` change is a domain operation, not an `ALTER`. Four phases:

1. **Preview (read-only).** The coercion classifier reads the field's current values and attempts to coerce each into the target kind, classifying it `clean` (round-trips unambiguously), `needs-a-rule` (coercible once the admin confirms a rule — e.g. `4.25M → 4 250 000`, or each distinct text becoming a picklist option), or `parked` (no defensible coercion — a range, free text into a date). Nothing is written. Coercibility runs along families: `single-line ↔ multi-line ↔ text`, `number ↔ currency` (re-scale), `* → picklist` (distinct values become options), `picklist → text` (option label becomes text) are cheap; `* → date`/`* → number` from free text is where parking happens.
2. **Confirm.** The admin resolves the two non-clean buckets:
   - **`needs-a-rule`** values coerce cleanly _once a rule is set_ — the admin confirms it (e.g. the `4.25M → 4 250 000` magnitude rule; or, for `* → picklist`, that each distinct value becomes a new option). With the rule confirmed they become `clean`; any that still cannot be resolved fall to `parked`.
   - **`parked`** values have no defensible coercion. The admin chooses, for the whole set: **park** (proceed — see Apply) or **block** (the Apply is refused with `ConvertHasParkedValues` and the parked list; the admin edits those source values or confirms more rules, re-runs Preview, and applies once the set is acceptable). Never a silent drop.
3. **Apply.** For each `clean` / ruled value: insert the coerced new current row + flip the original to history (the pre-Convert value is always recoverable). For each **parked** value (park disposition): flip the original to history and create **no** new current row — the record is simply _cleared_ for that field (consistent with §2.3's "no value = no `is_current = 1` row"; no all-null row is ever written), and the record is listed in the Convert's **parked-values report** for manual re-entry (a `required` field also re-surfaces it on the record's next save). The field's `kind` (plus `number_scale` / new options) updates in the same logical operation. The whole Convert emits **one** `custom_field.kind_changed` audit event (from/to kind + counts); the per-value history flips are attributed to it — a Convert does **not** emit per-value `value_set` / `value_cleared` events.
4. **Reversible.** Because every pre-Convert value is preserved as a history row, reverting the kind restores the prior values — the same "non-destructive ⇒ reversible" property the directory's merge relies on.

**Placement (ADR-0039).** Preview and a small-field Apply run inline in one effect-batch. A field with many values is a **bulk** operation: its Apply offloads to a Queue-driven background pass, and the field carries the `converting` flag (§2.1) for the duration — the `kind` flips only in the final batch, once every value is coerced, so a partial run never exposes a mixed-kind field. The inline-vs-Queue threshold and the per-batch chunk size are calibrated against the load profile (§12) in the implementation plan, not guessed here.

## 6. Field lifecycle & governance

Three states — **Draft → Active → Archived** — and every transition is always-safe, guarded, or destructive-and-logged.

### 6.1 Create

Define kind/target/attachment/options/required while no values exist (Draft); publishing makes it Active and it appears on the in-scope records' forms.

### 6.2 Active edits

Rename label (safe, §3); Convert kind (guarded, §5); set/edit values (safe, §4); reorder; toggle `required`.

### 6.3 Archive (the default "delete")

`archived = 1`. The field drops off entry forms; **all values, history, options, and references are kept and readable**; automation still resolves it, flagged archived (§3). Un-archive returns it to Active. This is the directory soft-delete invariant applied to definitions.

### 6.4 Hard-delete & Purge (the destructive paths)

- **Hard-delete** is permitted **only** when the field is unused. "Unused" is concrete: **zero `custom_field_value` rows** (current and historical), and — for a picklist — its options carry zero referencing values. Document-automation template bindings (Phase 2·6) join this guard when that consumer exists; none exist yet, so the value-row check is the whole guard today. Otherwise the operation is refused with `FieldInUseCannotHardDelete`, which the UI routes to Archive. A clean undo of a setup mistake, nothing more.
- **Purge** is the compliance-erasure seam (decision §0.4): a permission-gated, audited, irreversible removal of a field **and all its values including history** — the one case Archive cannot serve (a firm must truly erase data). This slice ships the **seam, not the execution**: a `purge.ts` carrying the signature `purge(fieldId, reason, actor)` and its documented contract (irreversible erasure; emits `custom_field.purged`), the `customFields:purge` permission registered to the Owner role, and a unit test asserting the body throws `PurgeNotYetEnabled`. The executing pass is **built when a real erasure obligation appears** — a destructive bulk op should not ship speculative.

### 6.5 Limits (the anti-bloat guard)

Per-firm caps prevent pathological schemas that would degrade form rendering and query plans (golden rule 10), enforced at definition time. Three dimensions, each with a named code: **fields per attach scope** — counted separately per matter-type, per entity-category, and for the `attachment_id = null` "all" scope → `TooManyFieldsForScope`; **options per picklist field** → `TooManyOptionsForField`; **active fields per firm** (a backstop) → `TooManyFieldsForFirm`. The _mechanism_ and codes ship in this slice; the cap _numbers_ are calibrated against the load profile (§12) in the implementation plan, not guessed here.

## 7. Picklist options

Options are id-keyed child rows (§2.2). Rename is a label `UPDATE` (picks bind to `option.id`). Removing an in-use option **archives** it (the pick stays resolvable, rendered with an archived marker); a hard-delete of an option is allowed only when no value references it. Reordering is `position`. The same governance shape as fields, one level down.

## 8. Reference kinds & the merge interaction

Reference-kind values (`matter-reference`, `contact-reference`) are real, indexed handles, never JSON — the property ADR-0087 protects. This slice **owns** extending the directory's non-destructive merge (ADR-0086) so they stay whole. The mechanism is a **build-when-in-the-area edit to `@magna-carta/directory`**, not a runtime dependency: the 1·4 work adds two entries to the existing `merge.ts` `REPOINT_TARGETS` const and the matching `fitness.ts` `INBOUND_REFERENCE_PROBES` (kept in lockstep), each naming the `custom_field_value` table **by string** (the table lives in the shared `@magna-carta/database` package, so no import of `@magna-carta/custom-fields` is needed — §1). The existing `RepointTarget` shape gains one field — an `onCollision` mode — to express the only new behaviour:

- **Target A — `value_reference_id` (a value that _points at_ a merged entity).** When a `contact-reference` value points at a subordinate that merges into a master, repoint it to the master. The value's own row does not move (its `target_row_id` and `field_id` are unchanged), so the partial-unique cannot collide — a plain indexed `UPDATE`, `onCollision` never fires. `matter-reference` values are never touched here (their handle is a `matter_`; matters do not merge in 1·3).
- **Target B — `target_row_id` (values _owned by_ a merged entity).** Entity-axis values whose `target_row_id` is the subordinate move to the master. Where the master has no current value for that field, repoint `target_row_id`. Where the master **already** has a current value, the partial-unique would collide → `onCollision: 'archive-to-history'`: the master's value stays current; the subordinate's value is repointed to the master **and flipped to history** (`is_current = 0`, `valid_to = now`) — preserved, recorded, reversible. This is field-level survivorship for custom values, and the reason the new mode exists: the directory's four existing targets keep `onCollision: 'delete'` (a duplicate _link_ carries no content, so the engine deletes it — unchanged), whereas a custom _value_ carries content and must be kept. Target B carries both reference kinds when their owning entity merges — only `target_row_id` moves; a `matter-reference`'s `value_reference_id` (a matter) is never rewritten by an entity merge.

The repoint loop's absorb branch reads `onCollision` and either deletes (the existing four) or archives-to-history (custom values) — the single, small change the new behaviour requires. Both moves are written into the append-only `entity_merge` event (table / row / old→new) so merge stays reversible, and the fitness probe fails CI on any custom-field reference still pointing at a `merged_into` subordinate. Because the directory never hard-deletes (soft-delete / `merged_into` only), a reference can never truly dangle — it always resolves; automation and UI render a merged/archived target's state rather than breaking. (If a matter-merge is ever built, the same `target_row_id` + `value_reference_id` repoint pattern extends to it in-area.)

**Reference validation (write-time).** v1 validates the handle **type** only, at the data-access boundary (`isIdentifier` prefix check), with a named code (`ReferenceKindHandleMismatch`) on failure: `contact-reference` ⇒ a `directoryPerson_` or `directoryOrganization_` id; `matter-reference` ⇒ a `matter_` id. It does **not** narrow a `contact-reference` to the person/organization kind the attached category implies — both entity kinds are accepted regardless of the field's category; per-kind narrowing is a later refinement, not v1.

## 9. Protected custom fields (the sensitive-value seam)

A custom field may hold sensitive data (e.g. a firm adds a confidential identifier). Such a field declares against the 1·2 `protectedField` registry: the ciphertext lands in `value_text` as the versioned frame (ADR-0084), reads go through `readProtected` (permission → `audit_log` row → AAD decrypt, inseparable), and a no-plaintext-escape fitness scan extends to this table. v1 does **not** ship a firm-facing "make this field protected" toggle (that is a policy surface with blind-index normalization decisions); it ships the **seam** so a protected custom field is a registry declaration away, not a schema change. Reference and picklist kinds are never protected (they are handles / foreign keys, not content); a declaration attempting it is rejected at definition time with `CannotProtectReferenceOrPicklistKind`.

## 10. API surface

The `/v1/custom-fields/*` routes register through the 0·5 `defineOpenAPIRoute` chokepoint (zod, code-as-contract), firm-scoped, idempotency-keyed on mutations (the matters/directory precedent):

- **Definitions:** create / rename / set-required / reorder / archive / un-archive / hard-delete a field; the Convert **preview** (read) and **apply** (mutation) endpoints; Purge (gated, refuses until enabled).
- **Options:** create / rename / reorder / archive / hard-delete a picklist option.
- **Values:** set-or-edit a value (one upsert endpoint — the append-and-flip of §4) and clear a value (a separate endpoint — flip to history, no new current row); read a record's current values, the handle→definition resolve (§3), and the history of a value.
- All consumer-facing strings (OpenAPI `description`s) carry **no process-artifact references** (golden rule 13 / the `lint:process-refs` gate); reasoning is stated inline or points to a convention by path.

## 11. Conformity templates — the deferred seam (§0.5)

Templates (practice-area field pre-builds) are **out of this slice**. The only build-now obligation is the cheap-to-add / expensive-to-retrofit hook: the reserved `template_field_key` column (§2.1). When a field is later stamped out from a template it will carry that template's stable per-field key (a value shaped like `{templateId}:{fieldSlug}`) — so two firms' forked copies of the same template field share a key and stay alignable for cross-firm conformity and benchmarking, even after each firm renames or retypes its copy. The column ships now; the apply-flow that _writes_ it, the curated content, and the control-plane home are not built or designed here. There are no production firms yet, so adding the rest later is otherwise free — the gate (**before the first real client**) ensures it is revisited while the retrofit is still cheap.

## 12. Load-profile extension (accretion rule — ADR-0078/0083)

Per the accretion rule, 1·4 extends `@magna-carta/fixtures`:

- **A custom-fields volume profile** — field definitions per attach target (a realistic count distribution across matter types and entity categories), picklist options per picklist field, and `custom_field_value` rows per record including a history-depth distribution and a reference-kind share — generated through the real domain write-paths (valid by construction, one-seed deterministic). Joins the active profile (`custom-field-generate.ts`).
- **Volume-shaped measured operations** (`custom-field-measurements.ts`, `EXPLAIN QUERY PLAN` full-scan flagging, no timing gates): the current-values read for a record (the partial-index plan), a reference-kind lookup, the Convert preview scan over a field's values (the bulk-classification cost that sets the inline-vs-Queue threshold, §5), and the merge repoint of Target A/B at entity-merge scale (so the relink cost is known before merge runs on it). These also calibrate the §6.5 caps.

## 13. Testing posture & conformance (TDD)

- **Unit (`@magna-carta/custom-fields`):** the exactly-one-non-null CHECK across all value columns incl. every null combination; partial-unique "one current value" invariant; append-and-flip value history (former carries `valid_to`); the coercion classifier per kind-family (clean/needs-a-rule/parked boundaries, incl. the lossy cases that must park); Convert apply atomicity + reversibility + the parked-value disposition; reference validation named codes; the §6.4 hard-delete guard (refuses with values/refs present) and §6.5 caps.
- **Integration (real SQLite / Miniflare):** migration `0012` applies; the partial unique enforces under concurrent sets; merge composes one atomic batch repointing Target A and absorbing Target B to history with the correct `entity_merge` record; a sensitive custom field round-trips through `protectedField` with the decrypt audit row.
- **Fitness functions (table-wide, the ADR-0051 pattern):** no float columns (ADR-0061); handle-TEXT primary keys; the value→`merged_into` no-dangling-reference probe (the `REPOINT_TARGETS` ⇄ `INBOUND_REFERENCE_PROBES` lockstep); sensitive custom-field values never escape unredacted (the no-plaintext-escape source scan extended here); `lint:process-refs` clean across the new source.
- **End-to-end:** an admin defines fields on a matter type and an entity category (incl. picklist + contact-reference) → values set on a matter and a contact → rename a field (bindings hold) → Convert a text field to currency (parked value handled) → merge two contacts (reference repointed, owned values survivorship-absorbed, alias still resolves) → archive a field (values still readable) → hard-delete is refused once values exist.

## 14. Documentation, ADRs, roadmap (same-commit — golden rule 5)

- **ADR-0107 / ADR-0108** recorded as ADRs (the §0 decisions).
- **ROADMAP:** slice 1·4 moves to designed; its Backlog custom-fields expectation points here; templates noted as a pre-first-client follow-up.
- **STATUS:** 1·4 Spec `[x]`.
- **White paper** _Directory_ / _Matters_: the custom-fields line pointed at the realized engine (identity-by-handle, Convert, archive-first, gated purge).
- **CHANGELOG:** the design-cycle entry.
- **No UI in this slice** → the owner manual-verification checklist (e.g. "rename a field and confirm a saved document/automation binding still resolves"; "Convert text→number parks an un-coercible value, loses nothing, and reverts cleanly") is written with the 1·4 UI plan once 0·7a/0·7b land — the 1·1/1·3 precedent.

## 15. Explicitly out of scope (seamed)

- **Conformity templates** — the curated content, control-plane home, and apply-flow → a pre-first-client follow-up; only the `template_field_key` seam ships here (§11).
- **The Purge execution pass** → built when a real erasure obligation appears; the seam, permission, and audit contract ship here (§6.4).
- **Document-automation merge binding** → Phase 2·6; 1·4 exposes the `resolveCustomField` handle/archived seam it will bind to (§3).
- **Reporting, list-view filtering, and search over custom values** → later consumers; they reuse the same handle-binding and the typed columns this slice fixes.
- **A firm-facing "protected field" toggle and per-field blind-index policy** → seam only (§9); the declaration path exists, the policy UX does not.
- **Field-label history** → not built; append-and-flip is available if ever wanted (§3).
- **UI** → after 0·7a/0·7b.
