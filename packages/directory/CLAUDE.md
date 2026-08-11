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
- `src/entity-kind.ts` — `entityKindFromId` / `nodeTableForEntityId` / `assertEntityExists` shared utilities (derive `EntityKind` and the node table from the handle prefix, and assert an entity exists AND is live — not soft-deleted, not merged away — before a referencing write; used by edges, party, categories, name-history, identifiers, merge, and search)
- `src/normalize-name.ts` — frozen name normalization: NFC, case-fold, diacritic/punctuation strip, suffix/title parse — produces the `normalized_display` stored at write time
- `src/phonetics.ts` — scheme-keyed Double Metaphone computation (seam over `words/double-metaphone`); produces `directory_name_phonetic_code` rows for both primary and secondary codes
- `src/statements.ts` — SQL statement builders (insert/update/repoint) for the atomic batch; the `directoryAuditStatement` helper
- `src/person.ts` — `createPerson` / `readPerson` / `updatePerson` / `setPersonPronouns`
- `src/pronouns.ts` — the pronoun set: the five grammatical forms plus verb agreement, the all-or-nothing column projection, and the validation the write path runs
- `src/organization.ts` — `createOrganization` / `readOrganization` (an organization's name changes through `name-history.ts`, so there is deliberately no `updateOrganization` twin of `updatePerson`)
- `src/name-history.ts` — `addName` / `changeName` (append-and-flip); inserts the new `directory_name` row + phonetic codes + flips `is_current` on the prior in the same batch
- `src/search.ts` — FTS5 trigram name search (`searchNames`) + `findDuplicateCandidates` (phonetic-block union trigram union blind-index, signal-count ranked). The blind-index channel takes plaintext `identifiers` (entry-time duplicate detection) **or** a `subjectEntityId` (conflicts): the latter self-joins an already-persisted entity's sealed blind indexes, so the exact-identifier channel runs with no plaintext in hand.
- `src/identifiers.ts` — `protectedField` declarations for all identifier types + `addIdentifier` / `readIdentifier` / `findByIdentifier` (via `composeProtectedWrite` / `readProtected` / `blindIndexValue`); `findEntitiesSharingIdentifiers` — the conflicts blind-index self-join (other live entities sharing a subject's `value_blind_index`, no decrypt/permission/audit)
- `src/edges.ts` — `createEdge` / `readEdges` (typed, temporal, directional)
- `src/categories.ts` — `createCategory` / `assignCategory` / `readCategories`
- `src/merge.ts` — `mergeEntities` (non-destructive, atomic batch, full repoint set, `entity_merge` event + `audit_log` row)
- `src/party.ts` — `linkMatterParty` / `readMatterParties` / `createPartyRole` / `listPartyRoles`
- `src/contact-email.ts` — `addEmail` / `updateEmail` / `removeEmail` / `readEmails` (temporal `directory_email` rows, at-most-one-primary enforced in the write path) + `findEntitiesByEmailAddress` (the address → entity reverse lookup: normalized match key, soft-delete-aware, resolves a merged-away owner to its surviving master)
- `src/client-migration.ts` — idempotent 1·1 `client_display_name`/`client_code` → Directory entity + `matter_party` migration
- `src/audit.ts` — `directoryAuditStatement` (shared write-options type, audit-row builder used by all write paths)
- `src/run-directory-effect.ts` — `runDirectoryEffect` top-level executor (threads the idempotency context + crypto context + actor for routes)
- `src/fitness.ts` — `assertDirectoryFitness` + the per-invariant probe queries it runs (`findDanglingToSubordinate`, `assertNoDanglingToSubordinate`, `findNamesMissingPhonetics`, `findEdgesToDeletedEntities`)
- `src/index.ts` — public barrel

## Invariants that apply here

- **All writes compose the atomic batch.** Every mutation goes through `composeEffectBatch` (never raw D1 outside a statement builder). Mirror the pattern in `packages/matters/src/matter-service.ts`.
- **Names are append-and-flip, never edited in place.** A name change inserts the new `directory_name` row (with phonetic codes) and flips `is_current = 0` + sets `valid_to` on the prior row in the same batch. The FTS5 external-content index (triggers) and phonetic-code rows travel with each name row. Editing the name text directly breaks the conflicts corpus and history.
- **Phonetic codes on every name write.** Every insert of a `directory_name` row must be accompanied by `directory_name_phonetic_code` rows for both Double Metaphone schemes (`double_metaphone_primary` and `double_metaphone_secondary`) in the same batch statement set. The fitness probe `findNamesMissingPhonetics` enforces this.
- **Sensitive identifiers only via `protectedField`.** SSN, EIN, DOB, account numbers, driver's licence numbers, and SSN-last-four are stored encrypted. Write them only through `composeProtectedWrite`; read them only through `readProtected` (permission check → audit row → AAD decrypt, inseparable) or `blindIndexValue` (no permission, no audit — matching reveals nothing). Blind-index policy: SSN digit-strip standalone-indexed (L=16); EIN digit-strip standalone-indexed (L=16); account number strip-spaces-dashes-uppercase standalone-indexed (L=24); driver's licence state-prefixed standalone-indexed (L=16); DOB and SSN-last-four protected but **never** standalone-indexed — decrypt-and-compare on a candidate set. The policy lives in `@magna-carta/data-access`.
- **Uniform `directory_identifier` model.** ALL sensitive identifiers live in `directory_identifier` rows — there are no plaintext `dob` or `ein` columns on the node tables. The design's §5 uniform model was adopted; the plan's §2 table columns were dropped.
- **Soft-delete only.** No `DELETE` ever targets directory tables; set `deleted_at` instead. Merged subordinates carry `status = 'merged_into'` + `merged_into_id`; they remain in the corpus so merged-away aliases still surface in search and conflicts. The single exception is a colliding `directory_entity_category` link during a merge: the composite primary key leaves no room for a second row under the master, and the row's entire content (the entity/category pair) is written into the `entity_merge` event, so nothing is lost that the event does not carry.
- **Merge is non-destructive and atomic.** `mergeEntities` runs a single `composeEffectBatch`: archive the subordinate, repoint ALL inbound references (matter_party, edges, categories, custom-field values) to the master, write an append-only `entity_merge` event recording the exact repoint list + survivorship choices, and write an `audit_log` row. A reference that cannot be repointed live — a duplicate the master already holds, or a would-be self-loop — is **absorbed**, not destroyed: it still moves to the master but lands archived (soft-deleted for `matter_party`/`directory_edge`, flipped out of currency for a custom-field value), so the record that the subordinate held that relationship stays queryable. The subordinate's OWN child rows — names, phonetic codes, `directory_identifier`, contact rows — are deliberately **left in place**, not repointed: they stay in the search and conflicts corpus under the subordinate and resolve to the master through `merged_into_id`, so a merged-away alias or identifier still surfaces a hit. `REPOINT_REFERENCE_COLUMNS` in `src/merge.ts` is the exported list of what does get repointed (the PII/erasure registry is pinned as a superset of it). The repoint set must stay complete — `assertNoDanglingToSubordinate` enforces no inbound reference pointing at a `merged_into` subordinate.
- **Merge chains are flattened, never followed.** Resolution is one hop (`COALESCE(merged_into_id, id)` in the search channels, and the in-code twins in `search.ts` / `contact-email.ts`), so a merge repoints the `merged_into_id` of every entity previously merged into the subordinate onto the new master, in the same batch. `merged_into_id` therefore always names a live entity; no read path walks a chain and none needs a cycle guard. The two node-table probes in `fitness.ts` enforce it.
- **Writes never land on a merged-away entity.** `assertEntityExists` treats status as part of existence: a merged subordinate throws `MergedEntityError` (409, naming the master), while a missing or soft-deleted row throws `UnknownEntityError` (404). Reads are unchanged — a merged entity is still readable and carries `mergedIntoId` for a client to follow.
- **Idempotency on all write routes.** All directory create/update/merge operations thread the idempotency context (the matters pattern) — a same-key retry returns the committed result without re-executing the batch. Merge replay is proven not to double-repoint.
- **Scheme CHECK is open.** The `directory_name_phonetic_code.scheme` column CHECK is `length > 0`, not an exhaustive enum — adding Beider-Morse is additive rows + a backfill sweep, no schema change.
- **Pronouns are RECORDED, never inferred, and whole or absent.** A person's pronoun set is what
  that person stated. Nothing derives it — not from `name_given`, not from `name_prefix`, not from any
  other column — and nothing derives anything else from it; the platform holds no gender field, and a
  pronoun set must never become a proxy for one. The set is the WHOLE declension (subject, object,
  possessive determiner, possessive pronoun, reflexive) plus a verb-agreement number, because a
  two-form label determines none of the last three for a set the platform has not seen and any
  label-to-forms table is a closed enum in disguise. All six columns are recorded together or none is:
  the table CHECK refuses a partial row, `updatePersonPronounsStatement` is the only write and writes
  all six, and `pronounSetFromColumns` returns null for anything short of a whole set — three layers
  for one invariant, because "she" in one clause and "them" in the next is invisible to a proofreader
  and lands on a real person. Rendering, including what an unrecorded set becomes, is
  `@magna-carta/document-assembly`'s business, not this package's.
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
- `findDuplicateCandidates` orders candidates by signal count descending, then entity id ascending (the final sort in `src/search.ts` — cited by function, not line, so the note does not rot as the file moves) — stable across database row orders, never insertion-order. `channels` (which of the phonetic/trigram/identifier channels fired) and `identifierTypes` (which identifier types matched) travel with each candidate, not only `signalCount`.
