# Data-subject attribution, erasure & residency seams — design

**Status:** Accepted (design) · **Date:** 2026-07-02 · **Owner:** Trevor Goldsmith
**White-paper home:** _Tenancy & data isolation_ (per-firm isolation, crypto-shred as the unit of offboard); _Authentication, access control & encryption_ (the `protected()` chokepoint).
**Compliance home:** [`../conventions/compliance.md`](../conventions/compliance.md) — the two gap-register rows this closes.
**Builds on:**

- The Directory typed-graph model (`packages/directory/`, per-firm schema in `packages/database/src/per-firm-schema.ts`) — `directory_person` / `directory_organization` nodes addressed by `entity_id`.
- `packages/directory/src/merge.ts` `REPOINT_TARGETS` — the existing, fitness-tested inventory of every inbound reference to a directory entity (the entity-merge repoint set). The erasure cascade is a superset of this traversal.
- The `protected()` field chokepoint (`packages/database/src/protected-columns.ts`, `packages/data-access/src/protected-field-registry.ts`) and firm-level crypto-shred (`apps/worker/src/firm-key-shred.ts`).
- Firm provisioning + addressing: `apps/worker/src/firm-provisioner.ts`, `apps/worker/src/firm-resource-provider.ts`, `apps/worker/src/firm-database/firm-database-proxy.ts`; control-plane `firm` table in `packages/database/src/control-plane-schema.ts`.

**ADRs (resolved by this spec):**

- **ADR-subject-level-erasure-dsar** — moves Proposed → Accepted. Resolution: structured-PII erasure with a legal-retention boundary; the attribution model is a declarative PII/erasure registry + a fitness function (the seam built now); the `eraseDataSubject` orchestrator is designed here but its build is deferred to before EU launch.
- **ADR-data-residency-firm-region-seam** — moves Proposed → Accepted. Resolution: a `firm.data_region` column threaded through provisioning; `eu` path built on Cloudflare jurisdiction primitives; set-once, no cross-region moves; Canada flagged open.

The compliance control baseline registered two GDPR gaps: subject-level erasure (beyond the firm-level crypto-shred) and per-firm data residency. Both share one property — the **expensive-to-retrofit part is not the machinery, it is the discipline**: making every personal-data record resolvable to a data subject, and making a firm's storage location an attribute set before any data exists. This spec builds those two seams now (cheap, while the schema is soft) and defers the heavy builds (the erasure orchestrator; multi-region operations) behind named seams — the repo's "build the cheap seam when in the area" rule.

---

## 0. Scope — what ships now vs. deferred

**Ships now (the seams):**

1. A declarative **PII/erasure registry** — one manifest that enumerates every per-firm table/column holding personal data, its subject key, and its erasure action.
2. An **attribution fitness function** — CI fails if a PII-bearing table is missing from the registry.
3. The `firm.data_region` column + provisioning threading (R2 jurisdiction + firm-database DO jurisdiction), with the `eu` path wired.

**Designed, deferred (named seams):**

- The `eraseDataSubject` orchestrator (Track A §5) — built before the first EU/UK firm, when a controller-driven DSAR erasure is real.
- A first-class `legal_hold` / retention construct (§6) — the retention-by-default boundary suffices for the seam; the explicit hold column is a later refinement.
- Multi-region operations beyond `eu` (Canada, cross-region moves) — §7.

Not in scope: content-level PII discovery in free text or documents (out of automated erasure by design — §5); certification/attestation (owner/legal track).

## 1. The data-subject model — two axes, no new table

A GDPR data subject in this system resolves to one of two existing anchors; we do **not** add a `data_subject` table (the Directory already is the registry):

- **Entity axis** — a Directory node addressed by `entity_id` (`directory_person`, and `directory_organization` for cascade completeness). This is the subject for clients, contacts, opposing parties, witnesses, vendors.
- **User axis** — a firm member addressed by control-plane `UserId` (their own account PII: `time_entry.timekeeper_user_id`, `incident.reported_by`, `audit_log.actor_user_id`, `ai_detection_usage.requested_by`).

`directory_person.member_id` bridges the axes when a person is also a member. A subject reference is a discriminated union:

```ts
type SubjectRef =
  | { kind: "entity"; entityId: DirectoryEntityId } // person or organization
  | { kind: "user"; userId: UserId };
```

Erasure is always **controller-initiated** (the firm, on behalf of a data subject), permission-gated by a new `directory:eraseSubject` permission (added to the fixed registry, seeded to Owner/Admin). We are the processor executing the controller's instruction; we never decide erasure autonomously.

## 2. The PII/erasure registry — the core seam

A single declarative manifest, sibling to `PROTECTED_COLUMNS`, living in `packages/data-access/src/pii-registry.ts`. Each per-firm table (and control-plane table) that holds personal data declares one entry:

```ts
interface PiiTableEntry {
  table: string;
  subjectKey: "entity_id" | "from_entity_id" | "to_entity_id" | "user_id" | "matter_id" | "self";
  piiClass: "identifier" | "contact" | "name" | "node" | "reference" | "freetext" | "actor" | "audit";
  action: ErasureAction;
  note?: string; // e.g. the Art. 17(3) basis for a `retain` action
}

type ErasureAction =
  | "hard-delete"          // remove the rows for this subject
  | "anonymize"            // scrub PII columns, keep the row (referential integrity / tombstone)
  | "retain-under-matter"  // kept: legal-obligation / claims retention (GDPR Art. 17(3))
  | "pseudonymize-keep"    // append-only rows: replace the subject reference, never delete
  | "report-manual";       // free-text / content — not auto-erased; surfaced in the residue report
```

**The registry is a superset of `merge.ts:REPOINT_TARGETS`.** REPOINT_TARGETS already enumerates every inbound `entity_id` reference (it powers entity-merge repointing) and is kept complete by the `mergeRelinkCompleteness` fitness probe. The erasure registry reuses that inventory and adds the two things merge does not need: the erasure **action** per table, and the **user-axis** tables merge never touches. To prevent drift, the entity-axis rows are derived from the same source-of-truth list REPOINT_TARGETS consumes.

**Initial entries** (grounded in the current schema):

| Table / column | subjectKey | class | action |
| --- | --- | --- | --- |
| `directory_identifier.value_ciphertext` (SSN/DOB/DL/EIN/account) | `entity_id` | identifier | hard-delete (firm crypto-shred is the at-rest backstop) |
| `directory_name` (+ phonetic code) | `entity_id` | name | hard-delete |
| `directory_email` / `directory_phone` / `directory_address` | `entity_id` | contact | hard-delete |
| `directory_edge` | `from_entity_id` / `to_entity_id` | reference | hard-delete |
| `directory_entity_category` | `entity_id` | reference | hard-delete |
| `directory_person` / `directory_organization` (node) | `self` | node | anonymize (keep id as tombstone for matter-link / audit integrity) |
| `matter_party` | `entity_id` | reference | retain-under-matter (the party's role on a matter is a matter record; PII is scrubbed at the entity) |
| `custom_field_value` (`value_reference_id`, `target_row_id`) | `entity_id` | reference | anonymize / detach |
| `cost_entry.vendor_id` | `entity_id` | reference | retain-under-matter (financial record) |
| `time_entry` (`timekeeper_user_id`; `narrative`) | `user_id` | actor / freetext | retain-under-matter; narrative → report-manual |
| `incident` (`reported_by`; `description_ciphertext`) | `user_id` | actor / freetext | pseudonymize-keep; description → report-manual |
| `ai_detection_usage.requested_by` | `user_id` | actor | pseudonymize-keep |
| `audit_log` (`actor_user_id`, `subject_id`) | `user_id` | audit | pseudonymize-keep (append-only) |
| `entity_merge` | `entity_id` | audit | pseudonymize-keep (append-only) |
| `file` / `file_version` (matter-rooted) | `matter_id` | reference | retain-under-matter (documents are matter corpus; §5) |

## 3. The attribution fitness function — the enforcement seam

A test in the conformance family (mirroring `no-plaintext-escape` and the `protected-columns` conformance): it walks the per-firm and control-plane schemas and asserts **every table carrying a known personal-data column appears in the PII registry** (or on an explicit, justified `NO_PII` allowlist). A new PII-bearing table added without a registry entry fails CI. This is what converts "we attribute PII to subjects" from a hope into a structural guarantee — and it is the whole reason to build now, before the directory/matters/custom-fields PII surface grows.

The check is column-name driven (a curated set: the `*_ciphertext` protected columns, `given/family/legal_name`, `value` on contact tables, `narrative`, `description*`, `entity_id`/`vendor_id`/`timekeeper_user_id`/`reported_by` subject keys) plus a schema-diff tripwire so a new table with an obvious PII column cannot slip past unregistered.

## 4. Track A module placement

- **`packages/data-access/src/pii-registry.ts`** — the `PiiTableEntry` manifest + `ErasureAction`, and the `SubjectRef` type (or a small `packages/data-access/src/data-subject.ts` for the type). Pure data + types; no I/O.
- **`packages/directory/src/merge.ts`** — refactor `REPOINT_TARGETS` to expose its entity-reference list as the shared source the registry derives entity-axis rows from (behavior-preserving; the merge suite must stay green).
- **`packages/access-control`** — a new `directory:eraseSubject` permission in the fixed registry.
- **Test** — `packages/data-access/test/pii-registry-coverage.test.ts` (the §3 fitness function).
- No route, no orchestrator, no UI in the now-build. The orchestrator (§5) is documented as the deferred consumer.

## 5. The erasure orchestrator (designed, deferred)

`eraseDataSubject(deps, firmId, subject: SubjectRef, opts)` — the future consumer of the registry. Behavior when built:

1. **Resolve** the subject and gather its rows across the registry (entity-axis via the REPOINT_TARGETS traversal; user-axis via the declared user_id tables).
2. **Apply** each table's declared `action` inside a transactional batch where the per-firm DO allows it: `hard-delete` removes rows; `anonymize` scrubs PII columns to a tombstone; `retain-under-matter` is skipped (with a reason); `pseudonymize-keep` replaces the subject reference in append-only rows; `report-manual` collects the row for the residue report.
3. **Backups** are never surgically edited (R2 snapshots are bucket-lock immutable). Protected identifiers are already crypto-inaccessible in backups after any firm crypto-shred; native rows age out on the GFS retention window. This is documented in the certificate, not engineered as a backup edit.
4. **Emit** an **erasure certificate** (append-only audit rows + a structured record of what was erased) and a **residue report** — the matter-corpus data retained under Art. 17(3), the free-text fields needing manual controller review, and any data shared with another subject. The controller (firm) handles the residue.

The orchestrator is idempotent and audited. It is **not built now**; §3's fitness function guarantees the registry it will traverse stays complete in the meantime.

## 6. Legal hold & the retention boundary

There is no `legal_hold` column today; hold is a documented rule, not a schema construct. This spec does **not** add one — the **retention-by-default boundary** covers the seam: every matter-corpus table (`matter_party`, `file`/`file_version`, `cost_entry`, `time_entry`) carries a `retain-under-matter` action, so subject erasure never touches matter-attached data. That is the legally-correct default for a law firm (Art. 17(3) exempts data retained for legal obligations and the establishment/exercise/defence of legal claims — which is most matter data). A first-class `legal_hold` / retention-schedule construct is a named follow-up that will *refine* (not replace) this boundary when matter lifecycle/closure is built.

## 7. Track B — the per-firm residency seam

**Column.** Add `data_region` to the control-plane `firm` table (`control-plane-schema.ts`) via a control-plane migration. Type: a small enum, `'us' | 'eu'` (extensible; `'canada'` reserved, §7 open). **`us` is the primary market and the column default** (existing firms backfill to `us`). Immutable after provisioning. **Asymmetry to be explicit about:** `eu` is a *hard* Cloudflare jurisdiction lock (EU-only data centers); `us` is North-America **placement** via a location hint, because Cloudflare offers no general US jurisdiction primitive (only FedRAMP, a government-only tier). That is adequate for US legal work — no GDPR-style transfer restriction binds US-resident data — and if a *hard* US-residency guarantee is ever required, it is a separate escalation (a FedRAMP-tier or a contractual control), not this column.

**Threading at provisioning** (`firm-provisioner.ts` reads `data_region` and passes it down):

- **R2 bucket** — `firm-resource-provider.ts` `createBucket(firmId, { jurisdiction })`. For `eu`, create the bucket in Cloudflare's **`eu` jurisdiction** (a hard EU-storage guarantee, not a best-effort location hint). For `us`, the account's North-America placement (an `enam`/`wnam` location hint, no hard jurisdiction). This is the single R2 call site to thread the parameter through (`createBucket` today passes only `{ name }`).
- **Per-firm database DO** — the firm database is a Durable Object addressed by `namespace.idFromName(firmId)` in `firm-database-proxy.ts` `firmDatabaseFor`. For `eu`, address via `namespace.jurisdiction("eu").idFromName(firmId)`, which constrains the DO to EU data centers. Because `idFromName` under a jurisdiction yields a **different** DO id than the bare form, a firm's region must be known **wherever** its database is addressed, and it can never change post-creation (addressing it under a different jurisdiction would point at a different, empty DO). Hence: **set once at provisioning, no cross-region moves.**

**Region resolution at addressing time.** `firmDatabaseFor` gains an optional `jurisdiction` derived from the firm's `data_region`. Region is immutable, so it is resolved with firm context at the tenancy chokepoint (where firm context is already established per request) and carried through — aggressively cacheable. The seam ships with `firmDatabaseFor` accepting the jurisdiction and `us` firms passing none (bare `idFromName`); the `eu` path is exercised by a fitness test.

**Fitness test.** An `eu`-tagged firm provisions its R2 bucket under the `eu` jurisdiction and addresses its database DO under the `eu` jurisdiction — asserted so the invariant cannot silently regress. Regional Terms-of-Service variants (legal-perimeter.md) key off the same `data_region`.

**Open (§7):** Cloudflare offers no Canada jurisdiction; a `canada` value would need a different mechanism (or interim US placement + SCCs) — reserved, not built. `us`→`eu` migration for an existing firm is out of scope (would be a full data move, not an addressing change).

## 8. Test plan

- **Track A:** the §3 registry-coverage fitness function (the headline test); a unit test that the registry's entity-axis rows stay in sync with `REPOINT_TARGETS` (drift tripwire); the merge suite stays green after the REPOINT_TARGETS refactor; a `directory:eraseSubject` permission conformance check. The orchestrator's own tests land with the deferred build.
- **Track B:** a provisioning test that a `us` firm places R2 + DO with no jurisdiction (North-America location hint) and an `eu` firm places both under the `eu` jurisdiction; a migration test for the new column (backfill = `us`); an addressing test that `firmDatabaseFor` resolves the right jurisdiction from `data_region`.

## 9. Decomposition & sequence

Two independent implementation tracks, each its own plan:

- **Track A — attribution registry + fitness function** (the erasure seam). Higher priority: it protects the directory/matters/custom-fields PII schema, which is actively growing.
- **Track B — residency column + provisioning threading.** Self-contained; touches the firm addressing chokepoint, so coordinate via `vp run worktrees`.

Each track updates its ADR (Proposed → Accepted) and adds a changelog fragment. The deferred `eraseDataSubject` orchestrator and the `legal_hold` construct get their own specs when built.
