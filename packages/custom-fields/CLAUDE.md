# @magna-carta/custom-fields — CLAUDE.md

**Purpose.** The firm's typed extra-attributes engine — a typed entity-attribute-value (EAV) store that lets a firm define its own fields on matter types and entity (directory contact) categories, set temporal values on individual records, retype a field without data loss, and govern a field's lifecycle (archive, hard-delete, compliance purge). Validates in memory and composes statements into `@magna-carta/data-access`'s effect batch; holds no D1 binding and performs no I/O of its own. The reference, picklist, and merge integrations reach into matters and the directory, but no business query crosses firms — every read and write rides the firm-scoped per-firm database the route hands in.

**White paper:** _Core domain_ — [`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). (Design and rationale live there; do not restate.)

## Key files / entry points

- `src/types.ts` — `CUSTOM_FIELD_KINDS` (the twelve kinds), `CustomFieldTarget` (`matter` | `entity`), `CustomFieldError` + its `CustomFieldErrorCode` union (the single source the route maps to RFC 9457 problems by code).
- `src/custom-field-service.ts` — define / rename / set-required / reorder / archive / unarchive / hard-delete a field. `defineCustomField` enforces the per-scope and per-firm field caps; `hardDeleteCustomField` refuses (`field-in-use`) when any value rows exist.
- `src/picklist-option-service.ts` — create / rename / reorder / archive / hard-delete a picklist option (option-level mirror of the field lifecycle; `option-in-use` guards the hard-delete).
- `src/custom-field-value-service.ts` — `setCustomFieldValue` / `clearCustomFieldValue` (append-and-flip), and `CustomFieldValueInput` (the tagged value union threaded through values, Convert, and the route). `columnsFor` validates a reference handle before any write.
- `src/coercion.ts` — `classifyCoercion` (pure: clean / needs-rule / parked) + `coerceWithRule`; the per-value classifier Convert preview and apply both run.
- `src/convert.ts` — `previewConvert` (counts, no write) and `applyConvert` (non-destructive retype: every original row flips to history, clean values gain a coerced current row, parked values are left cleared). `CONVERT_INLINE_VALUE_LIMIT` is the inline-vs-Queue threshold.
- `src/reads.ts` — `resolveCustomField` (handle → definition, active/archived/absent), `readCurrentValues` (a record's current values), `readValueHistory` (one field on one record, oldest first).
- `src/purge.ts` — `purgeCustomField`, the compliance-erasure seam (refuses with `purge-not-yet-enabled` until the executing pass is built).
- `src/limits.ts` — `MAX_FIELDS_PER_SCOPE` / `MAX_FIELDS_PER_FIRM` / `MAX_OPTIONS_PER_FIELD` (load-profile-calibrated caps).
- `src/audit.ts` — `customFieldAuditStatement` (the shared write-options type + audit-row builder every write path emits).
- `src/run-custom-field-effect.ts` — `runCustomFieldEffect` (the top-level idempotent executor; `CustomFieldWriteOptions`; `CustomFieldIdempotencyConflictError`).
- `src/*-statements.ts` — the SQL statement builders for the atomic batch (field, value, option).
- `src/fitness.ts` — `assertCustomFieldFitness` + per-invariant probe queries.

Schema home: `packages/database/drizzle/per-firm/0013_custom-fields.sql` (the `custom_field`, `picklist_option`, `custom_field_value` tables, the one-value CHECK, and the one-current partial unique index). HTTP surface: `apps/worker/src/routes/custom-fields.ts`.

## Local conventions

- **Handle identity, never name.** A value binds to a field by its `customField_` handle, not its name — so renaming a field never breaks a stored value. Resolve and read paths key on the id; only the display name changes on a rename.
- **Append-and-flip value history.** A value is never edited in place. `setCustomFieldValue` flips the prior current row to history (`is_current = 0`, `valid_to = now`) and inserts a new current row in the same batch; `clearCustomFieldValue` flips the current row to history and inserts nothing. A field's full history endures, so Convert and clear are reversible and nothing the user entered is lost.
- **Currency/number scaling happens at the route, not in the service.** `value_number` stores an integer in minor units. The route (`valueInputForWrite` in `apps/worker/src/routes/custom-fields.ts`) reads the field's `kind`/`number_scale` and scales the inbound decimal by 10^scale before it reaches the value service (a currency field with no explicit scale falls back to the money minor-unit scale). The domain package only ever sees and stores the already-scaled integer — do not re-scale here.
- **The merge `archive-to-history` collision rule lives in `@magna-carta/directory`, not here.** When two contacts merge, the directory's `mergeEntities` repoints both kinds of custom-field reference: a value that POINTS AT the subordinate (`value_reference_id` → master) and a value OWNED BY the subordinate (`target_row_id` → master). The owned-value repoint uses `onCollision: "archive-to-history"` — if the master already holds a current value of the same field, the subordinate's value is moved onto the master and flipped to history (field-level survivorship) rather than discarded. That logic is in `packages/directory/src/merge.ts`'s `REPOINT_TARGETS`; this package owns only the table shape it operates on.

## Invariants that apply here

- **Exactly one value column is non-null.** `custom_field_value` carries a CHECK that exactly one of `value_text` / `value_number` / `value_date` / `value_option_id` / `value_reference_id` is set. `columnsFor` / `columnsFromCoerced` build the row by populating one column over an all-null base — never widen this to a free-form map.
- **One current value per (record, field).** The partial unique index `(target_row_id, field_id) WHERE is_current = 1` enforces a single live value. Every write that adds a current row must flip the prior one first (`flipCurrentValueStatement`), or the insert collides.
- **No floats in stored values.** `value_number` is an `integer` column holding minor units; the decimal-to-integer scaling is the route's job (see Local conventions). The service and statements never store a fractional number.
- **Reference handle validation.** A `contact-reference` value must carry a `directoryPerson_`/`directoryOrganization_` handle and a `matter-reference` a `matter_` handle; `columnsFor` throws `reference-kind-handle-mismatch` (→ 422 at the route) before any write when the handle does not match the declared kind.
- **All writes compose the atomic batch and emit an audit row.** Every mutation goes through `runCustomFieldEffect` (idempotent) and pushes a `customFieldAuditStatement` into the same batch — never raw D1 outside a statement builder, never a write without its audit row.
- **Firm-scoped data access.** The route hands the service the firm-scoped per-firm database; no query in this package crosses firms.

## Dependencies & contracts

- Depends on: `@magna-carta/data-access` (effect batches, idempotency, audit statements), `@magna-carta/database` (the per-firm `0012` schema), `@magna-carta/identifiers`, `@magna-carta/money` (the minor-unit scale the currency default mirrors).
- Pure and synchronous per operation: produces statements for the caller to run; holds no D1 binding and performs no I/O of its own.
- Callers: `apps/worker/src/routes/custom-fields.ts` is the only caller of the services and `runCustomFieldEffect` — it owns threading `env`, the actor, the clock, the crypto random source, and the idempotency context, and maps `CustomFieldError.code` to problems. `packages/directory/src/merge.ts` reads and repoints `custom_field_value` rows directly during a contact merge (the only cross-package writer of this table).

## Gotchas

- **The Convert confirmed-rule path is a forward seam.** `classifyCoercion` returns `needs-rule` for values that need an admin-confirmed coercion (a magnitude suffix, or a text-to-picklist option creation), and `coerceWithRule` can resolve them — but `applyConvert` does not yet thread a confirmed rule, so today a `needs-rule` value is treated like a parked value (its original moves to history, no new current row). Wiring the confirmed-rule UI + apply path is the slice that builds the Convert review screen.
- **Bulk Convert offload is a forward seam.** `applyConvert` runs inline in one effect batch. `CONVERT_INLINE_VALUE_LIMIT` (500) is the calibrated ceiling above which the route is meant to set `converting = 1` and offload the coercion to a Queue-driven background pass — that background pass is not built yet, so do not retype a field across a very large record population until it lands. Re-derive the limit against the load profile, never raise it on a guess.
- **D1 has no interactive transactions.** Everything an operation needs must be read before composing the batch (the `fieldKind` / `fieldNumberScale` reads happen up front); never plan logic "between" statements.
- **`required` is advisory at the data layer.** Setting a field required does not block a value-less record write in this package — form-level required enforcement is the UI's job; the column records the intent.
