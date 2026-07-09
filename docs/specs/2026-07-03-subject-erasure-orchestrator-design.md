# Subject-erasure orchestrator — design

Builds the `eraseDataSubject` orchestrator that
[`2026-07-02-data-subject-attribution-erasure-residency-design.md`](2026-07-02-data-subject-attribution-erasure-residency-design.md)
(the erasure-orchestrator section) designed and deferred. That work shipped the **seam** — the
declarative PII/erasure registry (`packages/data-access/src/pii-registry.ts`) plus the coverage
fitness function that keeps it complete. This design resolves the build decisions for the **consumer**:
the orchestrator that traverses that registry to honor a controller-driven GDPR Art. 17 / CCPA erasure
request, and the API route that invokes it.

## Scope

**Ships:** the `eraseDataSubject` orchestrator, a controller-facing API route (permission-gated), the
erasure certificate (an append-only `audit_log` row + the same record returned inline), and the residue
report. Both subject axes (entity + user). Tested.

**Not in scope:** UI (deferred to the general erasure UX); automated sub-processor erase calls (the
residue *lists* sub-processors for the controller to instruct); content-level PII discovery in free
text (surfaced in the residue, never auto-edited); a first-class `legal_hold` construct (retention-by-
default via `retain-under-matter` is the boundary, unchanged from the prior design); control-plane
account deletion (a member's core identity lives in Better Auth `user`, handled by account
deactivation — out of this per-firm orchestrator).

## Key facts that shape the architecture

- **All erasable PII is per-firm D1.** Every R2/file-bearing registry entry is `retain-under-matter`
  (documents are matter corpus). So the live cascade is D1-only — no R2 object deletion, no cross-store
  saga, no compensation.
- **The per-firm database Durable Object commits a batch atomically** (one `commitBatch` RPC =
  transaction). So the whole cascade is a single synchronous atomic operation.
- **The registry is the source of truth** for which tables hold a subject's PII, keyed how, and what
  action to take — already complete and coverage-gated by Track A.

## 1. Home & invocation

- **Orchestrator:** `packages/data-access/src/erase-subject.ts` —
  `eraseDataSubject(firmDb, subject, { initiatedByUserId })`. It owns the registry, builds SQL from it,
  and commits through the firm DB batch — data-access territory (it spans Directory, matters, activity,
  and audit tables, not one domain). `initiatedByUserId` is the authenticated admin (from the session,
  never client input) and becomes the certificate's `actor_user_id`.
- **Route:** `POST /api/v1/directory/erase-subject`, body `{ subject: { kind: "entity" | "user", id } }`.
  One route serves both axes. The initiating admin is derived from the session, not the body. Permission
  **`directory:eraseSubject`** (new, added to the fixed access-control registry, seeded to Owner +
  Admin), enforced at the chokepoint. Returns `200` with the certificate + residue, `404` for an
  unknown subject.
- Erasure is always **controller-initiated** — the firm acting on a data subject's request. The
  platform never erases autonomously.

## 2. The cascade (one atomic batch)

1. **Resolve** the subject to its axis anchor: entity axis → `entityId` (a `directory_person` or
   `directory_organization`); user axis → control-plane `UserId`.
2. **Read** to build the plan and the certificate content: for each registry entry whose `subjectKey`
   matches the axis, count/collect the affected rows (and gather `report-manual` free-text locations for
   the residue).
3. **Emit one `commitBatch`** of subject-keyed writes, **including the certificate `audit_log` row**, so
   the certificate is atomic with the erasure. Per registry `action`:
   - `hard-delete` → `DELETE FROM <table> WHERE <subjectKey> = ?`
   - `anonymize` → `UPDATE <table> SET <pii columns> = NULL WHERE <subjectKey> = ?`
   - `retain-under-matter` → **skipped**; recorded in the certificate with its reason (the entry note)
   - `pseudonymize-keep` → `UPDATE <table> SET <subjectKey> = <sentinel> WHERE <subjectKey> = ?`
   - `report-manual` → not modified; collected into the residue
4. **Indirect subject keys.** Most keys are direct columns (`entity_id`, `user_id`, `from_entity_id`,
   `to_entity_id`). A few are two-hop — `directory_name_phonetic_code.name_id` references
   `directory_name.id`; `custom_field_value` references the row it annotates. These resolve via a
   subquery: `… WHERE name_id IN (SELECT id FROM directory_name WHERE entity_id = ?)`. **The registry
   stays a pure, coverage-gated manifest** — the resolution lives in the orchestrator as a small
   resolver map keyed by `(table, subjectKey)` that returns the subquery for the handful of indirect
   keys; a direct key falls through to `WHERE <key> = ?`. Keeping SQL out of the registry preserves the
   Track A coverage test's assumptions.

Writes are **subject-keyed** (`WHERE <key> = ?`), never rowid-lists — so they are idempotent (a re-run
matches nothing already deleted, and re-scrubbing a tombstone is a no-op) and TOCTOU-safe (a row added
between the read and the write is still caught by the keyed write).

## 3. Concrete scrub semantics

- **Anonymize a Directory node** (`directory_person` / `directory_organization`): null the name columns
  (`name_prefix`, `name_given`, `name_middle`, `name_family`, `name_suffix`, `display_name`; org:
  `legal_name`, `display_name`), set `deleted_at = now`. **Keep** `id`, `status`, `merged_into_id`,
  `member_id`, timestamps as a tombstone so referential integrity holds (`matter_party`, `entity_merge`,
  and matter links still resolve the id). The node's *child* PII tables (`directory_name` / `_email` /
  `_phone` / `_address` / `_identifier` / phonetic code / categories / edges) are hard-deleted, so no
  personal data survives on the node or its children.
- **Pseudonymize-keep** in append-only rows — two cases, to avoid a foreign-key hazard:
  - **User-axis actor columns** (`audit_log.actor_user_id`, `incident.reported_by`,
    `ai_detection_usage.requested_by`): the value is a control-plane `UserId` stored as plain text (no
    per-firm FK), and the member's control-plane account is *not* anonymized here — so replace it with a
    reserved **sentinel `UserId`** constant (e.g. `ERASED_USER`), breaking the link while keeping the
    append-only row.
  - **Entity-axis references** (`entity_merge.subordinate_id`, `audit_log.subject_id` when it holds an
    entity id): the entity's Directory node is anonymized to a tombstone whose `id` persists, so these
    references already resolve to a scrubbed, PII-free node — the tombstone *is* the pseudonymization.
    No sentinel write (which could violate a FK to a now-nonexistent row); the certificate records the
    entry as pseudonymize-keep-via-tombstone. The plan enumerates exactly which columns take the
    sentinel vs. rely on the tombstone.

## 4. Certificate + residue

- **Certificate:** one `audit_log` row written *inside* the erasure batch —
  `event: "directory.subject_erased"`, `actor_user_id` = the initiating admin, `subject_id` = the erased
  subject, `metadata` (redacted JSON) = `{ subject, erasedAt, perTable: [{ table, action, rowCount, reason? }], residue: […] }`.
  The route returns the same object inline.
- **Residue report:** the items the controller must handle manually — `report-manual` free-text
  locations (`time_entry.narrative`, `incident.description_ciphertext`), `retain-under-matter` tables
  (what was kept and why, Art. 17(3)), the control-plane account note (user axis), and the
  sub-processor-instruction list. The controller (firm) acts on the residue; the platform surfaces it.
- **Closes a Track A follow-up:** add `audit_log.subject_id` to the pseudonymize-keep set, so erasing
  subject X also pseudonymizes prior audit rows *about* X (today the registry handles only
  `actor_user_id`).

## 5. Both axes & the boundaries

- **Entity axis** — the primary DSAR case (clients, contacts, opposing parties, witnesses, vendors):
  the full cascade over the Directory tables, with `matter_party` / `cost_entry` / `file` retained under
  matter and `custom_field_value` anonymized.
- **User axis** — a firm member's *per-firm activity* references only (`time_entry` retained under
  matter; `incident` / `ai_detection_usage` / `audit_log` actor refs pseudonymized). **Hard boundary:**
  the member's core account identity is control-plane (Better Auth `user`) and is **not** touched here —
  that is account deactivation, a separate control-plane operation, and it is stated in the residue.
- **A person who is also a member** (`directory_person.member_id` set): erasing the entity anonymizes
  the Directory node; the member account is separate (residue).
- **Shared data:** a `directory_edge` between two entities is hard-deleted (the relationship is gone for
  both — correct). No cross-subject orphaning results from the keyed deletes.

## 6. Idempotency, errors, security

- **Idempotent:** subject-keyed writes make a re-run a clean no-op; the operation may be safely retried.
- **Atomic:** the single `commitBatch` is all-or-nothing — an injected failure erases nothing.
- **Errors:** unknown subject → `404`; a subject already anonymized → a clean no-op that still writes a
  certificate row.
- **Security:** `directory:eraseSubject` (Owner/Admin) at the chokepoint; the operation is firm-scoped
  (the subject is resolved within the caller's firm; no cross-firm reach); the certificate is written to
  the firm's append-only `audit_log`.

## 7. Test plan

- **Unit** (`packages/data-access`): the plan-builder turns the registry into correct subject-keyed SQL
  per action, including the indirect-key subqueries; the certificate/residue record is assembled
  correctly; the sentinel-id substitution is applied to the right columns.
- **Integration** (Miniflare + the per-firm DO): seed a `directory_person` with names, contacts,
  identifiers, edges, categories, a `custom_field_value`, a `matter_party`, and activity rows; run
  `eraseDataSubject`; assert the child PII is hard-deleted, the node is anonymized (name columns null,
  id/status kept), `matter_party` is retained, the certificate `audit_log` row is present with the right
  metadata, the residue lists the free-text fields, a second run is idempotent, and an injected failure
  rolls the whole batch back (nothing erased).
- **Route** (`apps/worker`): permission conformance for `directory:eraseSubject`; the route returns the
  certificate + residue; a `404` for an unknown subject; the OpenAPI snapshot + api-client are
  regenerated in the same commit.
- The Track A registry-coverage fitness function continues to guarantee the registry the orchestrator
  traverses stays complete.

## 8. Module & sequence

1. `packages/access-control`: add the `directory:eraseSubject` permission (fixed registry + seed).
2. `packages/data-access/src/pii-registry.ts`: mark indirect keys (or add a resolution map) and add
   `audit_log.subject_id` to pseudonymize-keep; keep the coverage gate green.
3. `packages/data-access/src/erase-subject.ts`: the orchestrator (plan-builder + batch emitter +
   certificate/residue assembly) with unit tests.
4. `apps/worker`: the `POST /api/v1/directory/erase-subject` route (chokepoint meta, zod contract),
   the DO-backed integration test, OpenAPI + api-client regen, permission conformance.
5. Docs: changelog fragment; ROADMAP/compliance currency (the erasure orchestrator moves from
   designed-deferred to built).
