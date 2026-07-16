# @magna-carta/directory — CLAUDE.md

**Purpose.** The Directory domain module — the firm's single source of truth for the people and organizations it deals with. Models the firm as a graph: two equal-depth node tables (`directory_person` / `directory_organization`), a typed-edge table, append-only name history with phonetic + trigram search substrate, protected sensitive identifiers behind the 1·2 `protected()` machinery, per-firm category labels, entry-time duplicate-candidate generation, non-destructive merge, and the `matter_party` bridge. Validates in memory and composes statements into `@magna-carta/data-access`'s `composeEffectBatch`; never runs logic mid-transaction and never calls external services.

**White paper:** _Directory_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). (ADR-0085, ADR-0086, ADR-0087.)
**Spec:**
[`docs/specs/2026-06-12-slice-1-3-directory-design.md`](../../docs/specs/2026-06-12-slice-1-3-directory-design.md).
**Plan:**
[`docs/specs/2026-06-12-slice-1-3-backend-implementation-plan.md`](../../docs/specs/2026-06-12-slice-1-3-backend-implementation-plan.md).

## Key files / entry points

- `src/types.ts` — domain types: branded identifier re-exports (`dpe_`/`dor_`/`dnm_`/`did_`/`ded_`/`dct_`/`dpr_`/`mtp_`/`eme_`), `EntityKind`, `NameRole`, `PhoneticScheme`, `EdgeType`, `IdentifierType`
- `src/entity-kind.ts` — `entityKindFromId` / `nodeTableForEntityId` / `assertEntityExists` shared utilities (derive `EntityKind` and the node table from the handle prefix, and assert an entity exists before a referencing write; used by edges, party, categories, name-history, identifiers, merge, and search)
- `src/normalize-name.ts` — frozen name normalization: NFC, case-fold, diacritic/punctuation strip, suffix/title parse — produces the `normalized_display` stored at write time
- `src/phonetics.ts` — scheme-keyed Double Metaphone computation (seam over `words/double-metaphone`); produces `directory_name_phonetic_code` rows for both primary and secondary codes
- `src/statements.ts` — SQL statement builders (insert/update/repoint) for the atomic batch; the `directoryAuditStatement` helper
- `src/person.ts` — `createPerson` / `readPerson` / `updatePerson`
- `src/organization.ts` — `createOrganization` / `readOrganization` / `updateOrganization`
- `src/name-history.ts` — `addName` / `changeName` (append-and-flip); inserts the new `directory_name` row + phonetic codes + flips `is_current` on the prior in the same batch
- `src/search.ts` — FTS5 trigram name search (`searchNames`) + `findDuplicateCandidates` (phonetic-block union trigram union blind-index, signal-count ranked)
- `src/identifiers.ts` — `protectedField` declarations for all identifier types + `upsertIdentifier` / `readIdentifiers` (via `composeProtectedWrite` / `readProtected` / `blindIndexValue`)
- `src/edges.ts` — `createEdge` / `readEdges` (typed, temporal, directional)
- `src/categories.ts` — `defineCategoryLabel` / `assignCategory` / `listCategories`
- `src/merge.ts` — `mergeEntities` (non-destructive, atomic batch, full repoint set, `entity_merge` event + `audit_log` row)
- `src/party.ts` — `linkMatterParty` / `readMatterParties` / `createPartyRole` / `listPartyRoles`
- `src/contact-email.ts` — `addEmail` / `updateEmail` / `removeEmail` / `readEmails` (temporal `directory_email` rows, at-most-one-primary enforced in the write path) + `findEntitiesByEmailAddress` (the address → entity reverse lookup: normalized match key, soft-delete-aware, resolves a merged-away owner to its surviving master)
- `src/client-migration.ts` — idempotent 1·1 `client_display_name`/`client_code` → Directory entity + `matter_party` migration
- `src/audit.ts` — `directoryAuditStatement` (shared write-options type, audit-row builder used by all write paths)
- `src/run-directory-effect.ts` — `runDirectoryEffect` top-level executor (threads the idempotency context + crypto context + actor for routes)
- `src/fitness.ts` — `assertDirectoryFitness` + per-invariant probe queries
- `src/index.ts` — public barrel

## Invariants that apply here

- **All writes compose the atomic batch.** Every mutation goes through `composeEffectBatch` (never raw D1 outside a statement builder). Mirror the pattern in `packages/matters/src/matter-service.ts`.
- **Names are append-and-flip, never edited in place.** A name change inserts the new `directory_name` row (with phonetic codes) and flips `is_current = 0` + sets `valid_to` on the prior row in the same batch. The FTS5 external-content index (triggers) and phonetic-code rows travel with each name row. Editing the name text directly breaks the conflicts corpus and history.
- **Phonetic codes on every name write.** Every insert of a `directory_name` row must be accompanied by `directory_name_phonetic_code` rows for both Double Metaphone schemes (`double_metaphone_primary` and `double_metaphone_secondary`) in the same batch statement set. The fitness probe `everyNameHasPhoneticCodes` enforces this.
- **Sensitive identifiers only via `protectedField`.** SSN, EIN, DOB, account numbers, driver's licence numbers, and SSN-last-four are stored encrypted. Write them only through `composeProtectedWrite`; read them only through `readProtected` (permission check → audit row → AAD decrypt, inseparable) or `blindIndexValue` (no permission, no audit — matching reveals nothing). Blind-index policy: SSN digit-strip standalone-indexed (L=16); EIN digit-strip standalone-indexed (L=16); account number strip-spaces-dashes-uppercase standalone-indexed (L=24); driver's licence state-prefixed standalone-indexed (L=16); DOB and SSN-last-four protected but **never** standalone-indexed — decrypt-and-compare on a candidate set. The policy lives in `@magna-carta/data-access`.
- **Uniform `directory_identifier` model.** ALL sensitive identifiers live in `directory_identifier` rows — there are no plaintext `dob` or `ein` columns on the node tables. The design's §5 uniform model was adopted; the plan's §2 table columns were dropped.
- **Soft-delete only.** No `DELETE` ever targets directory tables; set `deleted_at` instead. Merged subordinates carry `status = 'merged_into'` + `merged_into_id`; they remain in the corpus so merged-away aliases still surface in search and conflicts.
- **Merge is non-destructive and atomic.** `mergeEntities` runs a single `composeEffectBatch`: archive the subordinate, repoint ALL inbound references (matter_party, edges, categories, identifiers, contact rows) to the master, write an append-only `entity_merge` event recording the exact repoint list + survivorship choices, and write an `audit_log` row. The repoint set must stay complete — the fitness probe `mergeRelinkCompleteness` enforces no inbound reference pointing at a `merged_into` subordinate.
- **Idempotency on all write routes.** All directory create/update/merge operations thread the idempotency context (the matters pattern) — a same-key retry returns the committed result without re-executing the batch. Merge replay is proven not to double-repoint.
- **Scheme CHECK is open.** The `directory_name_phonetic_code.scheme` column CHECK is `length > 0`, not an exhaustive enum — adding Beider-Morse is additive rows + a backfill sweep, no schema change.
- **Every mutation audited.** An `audit_log` row rides in the same batch as each mutation (the `directoryAuditStatement` helper).

## Dependencies & contracts

- Depends on: `@magna-carta/data-access` (effect batches, `composeProtectedWrite`/`readProtected`/`blindIndexValue`, `protectedField` registry), `@magna-carta/database` (per-firm schema), `@magna-carta/identifiers`, `words/double-metaphone` (pinned).
- Pure and synchronous per operation: produces statements for the caller to run via the data-access layer; holds no D1 binding and performs no I/O of its own.
- The worker routes (`apps/worker/src/routes/directory.ts`) are the only callers of `runDirectoryEffect` — they own threading `env`, the actor, and the crypto context.

## Gotchas

- D1 has no interactive transactions — everything an operation needs must be read before composing the batch; never plan logic "between" statements. Use `assertEntityExists` (from `entity-kind.ts`) before any write that references an entity handle.
- `directory_name` must NOT be WITHOUT ROWID — the implicit SQLite rowid backs the FTS5 external-content table (`content_rowid='rowid'`). Removing or altering the rowid breaks the trigram index.
- The FTS5 trigram table is kept in sync by triggers on `directory_name` (insert/update/soft-delete). The migration `0008_directory` creates these triggers via raw SQL — drizzle-kit cannot model FTS5 or triggers, so they live in the hand-written `.sql` file and are verified by the migration test.
- `NameRole`, `EdgeType`, and `IdentifierType` are application-level open catalogs (the schema enforces only `length > 0`). Add new catalog values to the `as const` union in `src/types.ts` before using them in write paths.
- FTS5 trigrams treat SQL keywords (`and`, `not`, `or`) as query operators, not literals — `searchNames` wraps each trigram as a phrase literal (`"<term>"`) to prevent keyword collisions. Do not change this without adding regression coverage for the collision cases.
- `findDuplicateCandidates` tie-ordering within a signal-count tier is insertion-order (non-deterministic across DB orderings); add a secondary sort `|| a.entityId.localeCompare(b.entityId)` if stable ordering matters in a future test or UI.
