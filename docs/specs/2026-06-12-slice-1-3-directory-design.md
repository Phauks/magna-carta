# Slice 1·3 — Directory — design

**Status:** Accepted (design) · **Date:** 2026-06-12 · **Owner:** Trevor Goldsmith
**White-paper home:** _Directory_ (with _Conflicts Check_ for the seams it carries)
**Research input:** [`docs/research/directory-mechanics.md`](../research/directory-mechanics.md) · [`docs/research/conflicts-matching-engine.md`](../research/conflicts-matching-engine.md) · [`docs/research/protected-crypto-module.md`](../research/protected-crypto-module.md)
**ADRs:** ADR-0006 (Directory SSOT — refined here) · ADR-0013 (Conflicts — the seams) · ADR-0031 (Locations) · ADR-0080 (matter shell + custom-fields deferral — amended here) · ADR-0084 (the `protected()` machinery this slice declares against) · **ADR-0085 (Directory model realization + conflicts seams — this slice's decision)** · **ADR-0086 (duplicate handling: prevention + non-destructive merge; guarded unmerge deferred)** · **ADR-0087 (custom-fields engine promoted to slice 1·4)**

This spec is the implementation-grade design for slice 1·3 ([`ROADMAP.md`](../../ROADMAP.md)): the **Directory** — the firm's single source of truth for the people and organizations it deals with, modeled as a graph of typed entities and typed edges, with full name history, sensitive identifiers behind the 1·2 `protected()` machinery, plaintext-name search (ordinary + phonetic), entry-time duplicate prevention, non-destructive merge, and the live wiring of the 1·1 `matter_party` seam. It does not restate ADR-0006 (the SSOT model) or the conflicts research (the matching engine is Phase 4) — it fixes the tables, columns, write paths, APIs, and policies, and resolves the three owner gates the research left open. **Backend only; no UI** (the UI plan follows once 0·7a/0·7b land — the 1·1 precedent).

**Build gates:** slice 1·1 backend landed (the `matter`, `matter_party` seam, `setting`, and `audit_log` tables; the matter-numbering engine), slice 1·2 landed (`@magna-carta/encryption` + the `protected()` enforcement and blind-index policy table in `data-access`), and slice 0·5 landed (the OpenAPI contract pipeline the Directory routes register through). The planned build order 1·1 → 1·2 → 1·3 satisfies all three.

**This slice is a prerequisite for:** slice 1·4 (the custom-fields engine attaches to the entity categories defined here), Phase 3 (matters reference real client/party entities), and Phase 4 Conflicts (the matching engine traverses this graph and reads the seams below).

---

## 0. The three owner gates — resolved

The research ([`directory-mechanics.md`](../research/directory-mechanics.md) §D) left three areas as explicit go/no-go gates. Resolved with the owner (2026-06-12):

1. **Custom-fields engine — promoted to its own slice 1·4 (ADR-0087).** Not built in 1·3 and not deferred to LEAP. 1·3 ships **fixed standard fields only** and **a category is a per-firm classification label, not a schema variant** (§2.3); the shared typed-EAV design is settled here (§9) as 1·4's spec seed. Rationale: it is the largest single component, it serves both matter types (1·1) and entity categories (1·3) so it is genuinely its own shared subsystem, and sequencing it after 1·3 (it needs entity categories as an attach target) and before Phase 2·6 (document automation consumes it) puts it where its consumers are.
2. **Merge/unmerge — tier (b): non-destructive merge now, automated unmerge deferred (ADR-0086).** Duplicates happen in ordinary operation, not just at LEAP (the "same person entered as a beneficiary in a second matter" case), so 1·3 builds merge. It is **non-destructive** (subordinate archived, references repointed, an append-only `entity_merge` event records the exact repoint list). **Automated unmerge is deferred** to the LEAP slice as a **guarded** operation, because unmerge is only well-defined as "reverse a clean, recent merge" — once post-merge activity accrues, a true split is ill-posed (§7.4). The recorded event is the seam; nothing is ever lost (the white-paper "unmerge safety net" honored in substance). Entry-time duplicate **prevention** ships alongside (§7.1).
3. **Phonetic codes — minimal go (ADR-0085).** Ship the FTS5 trigram search substrate (Directory needs ordinary search day one regardless) **and** Double Metaphone via a scheme-keyed phonetic table, both computed at write time. **Beider-Morse is deferred to Phase 4** where the shared Rust/WASM core is stood up for scoring comparators (no mature JS implementation exists). The scheme-keyed shape makes Beider-Morse additive-by-sweep later, no schema change (§4).

---

## 1. Package placement

One new domain package on the ADR-0071 structure-vs-access seam, composing into the slice-0·2 atomic write batch exactly as `@magna-carta/ledger` and `@magna-carta/matters` do:

- **`@magna-carta/directory`** — the domain package: entity/name/edge/identifier/merge domain services, the phonetic-code computation, the validation with named codes, the candidate-generation query for duplicate prevention, and the table-wide fitness queries. Pure domain logic; composes `composeEffectBatch` statements, never touches Hono or `env` directly. Dependencies: `@magna-carta/identifiers`, `@magna-carta/database` (schema), `@magna-carta/data-access` (the atomic batch + `protected()` enforcement + blind index), `@magna-carta/money` only if a value field needs it (none at launch). Phonetics: the pinned `words/double-metaphone`.
- **`packages/data-access`** — Directory entity reads/writes ride the existing firm-scoped gate (golden rule 3); the `protected()` identifier fields (§5) are declared against the 1·2 `protectedField` registry. No new enforcement layer — Directory is a consumer of the 1·2 machinery.
- **Worker routes** — the `/v1/directory/*` surface registered through the 0·5 `defineOpenAPIRoute` chokepoint (§8).

Schema lands in `@magna-carta/database` (per-firm lineage) as migration `<next>_directory` — the sequential number assigned at build against the then-current per-firm sequence (1·1 and 1·2 migrations land first).

## 2. The entity model

### 2.1 Two node types, equal depth

Person and Organization are **distinct tables with distinct standard fields** (ADR-0006 — equal data depth, not a shared polymorphic table). Both carry an opaque type-prefixed identifier handle that is primary key and public id (ADR-0062).

- **`directory_person`** — `dpe_` handle; structured name parts are denormalized onto the row for the _current_ name (prefix, given, middle, family, suffix, also `display_name` rendered) with the full history in `directory_name` (§3); DOB (`protected()`, §5); contact fields (emails, phones — child rows, see §2.4); addresses (§2.4). Soft-delete columns (§9.2).
- **`directory_organization`** — `dor_` handle; `legal_name` + rendered `display_name`; EIN (`protected()`, §5); contact + addresses as for person. Organization "former names"/DBAs live in `directory_name` with the appropriate role (§3) — the same history machinery as person aliases.

The current-name denormalization on the entity row is a read-path convenience (list screens, the matter-party display); `directory_name` is the source of truth for _all_ names including the current one (one row flagged `is_current`), so the search/conflicts corpus is uniform and former names are never special-cased.

### 2.2 The graph is two node tables + one edge table

Rather than a single polymorphic `entity` table, the graph is the two node tables plus a typed-edge table (§6) whose endpoints are entity handles. Because handles are globally type-prefixed (`dpe_`/`dor_`), an edge endpoint column holds either kind and the prefix tells them apart — no discriminator column needed, and the `isIdentifier` boundary check (slice 0·2) validates the prefix at the data-access boundary.

### 2.3 Categories are classification labels (the category-model decision)

A **category** in 1·3 is a per-firm classification label applied to an entity (`directory_category` definition rows — name, applies-to person/org/both, archived flag, position — and a `directory_entity_category` link, an entity may hold several). Examples: "client", "opposing counsel", "expert", "court", "vendor". **A category does not add columns and does not change an entity's schema.** Every Person shares the Person standard fields; every Organization shares the Organization standard fields.

Anything category-_specific_ (an attorney's bar number, an expert's specialty) is a **custom field — slice 1·4**, attached to a category through 1·4's typed-EAV engine. This is the clean resolution of the research's loose "categories add standard fields" phrasing: category-specific columns can be neither sparse real columns (per-firm DDL churn, rejected) nor JSON (breaks merge relinking and field audit), so they are exactly what the 1·4 engine is for. No category-specific field is hardcoded in 1·3 (owner decision 2026-06-12 — the engine follows immediately in 1·4).

### 2.4 Contact details and addresses

Emails, phones, and addresses are **child rows** (`directory_email`, `directory_phone`, `directory_address`) keyed to the entity, each with a type/label (work/home/etc.), a primary flag, and temporal validity (§9.1) — not flattened onto the entity, because a person has many over time and addresses feed letterhead/service-of-process later. Addresses carry the structured fields Locations (ADR-0031) already established (line1/line2/locality/region/postal/country) for reuse. None are `protected()` (they are not in the ADR-0084 narrow set).

## 3. Names and name history

`directory_name` — one row per name an entity has _ever_ held, the queryable name corpus (conflicts seam 2: former names must **match**, not merely display):

- Columns: `dnm_` handle, `entity_id`, `name_role` (TEXT CHECK — person: `current` | `former` | `alias` | `aka` | `maiden`; org: `current` | `former` | `dba` | `trade`), structured parts (person: prefix/given/middle/family/suffix; org: a single `legal_name` part used; both render a `normalized_display`), `is_current` (exactly one per entity per node-kind-appropriate sense, enforced by a partial-unique discipline + fitness query), temporal validity `valid_from`/`valid_to` (§9.1), soft-delete.
- **Normalization** for matching is frozen at write time (NFC, case-fold, punctuation/diacritic strip, suffix/title parse) into `normalized_display` and the per-part normalized forms the phonetic encoder consumes — the same frozen-transform discipline as the 1·2 blind index, but over plaintext.
- Every `directory_name` row gets phonetic codes (§4) and is fed into the trigram FTS index (§4) on write.

A name change is **append a new `current` row + flip the prior to `former` with `valid_to` set** — never an in-place edit — so history and the conflicts corpus are preserved by construction. The current-name denormalization on the entity row (§2.1) updates in the same atomic batch.

## 4. Search substrate — phonetic + trigram (gate 3)

Two complementary, write-time, indexed blocking keys over the `directory_name` corpus — the candidate-generation channel for both ordinary search and duplicate prevention (§7.1), and the Directory half of conflicts seam 1 + seam 6:

- **`directory_name_phonetic_code`** — scheme-keyed child rows: `(name_id, scheme, code)`, `scheme` ∈ {`double_metaphone_primary`, `double_metaphone_secondary`} at launch. Computed in the Worker write path via the pinned **`words/double-metaphone`** (MIT, pure-string, Workers-safe) alongside every `directory_name` row. Indexed on `(scheme, code)` for equality blocking. **The scheme-keyed shape is the growth seam:** adding Beider-Morse (Phase 4, via the Rust/WASM core) or Daitch-Mokotoff is additive rows + one backfill sweep (the 1·2 sweep pattern), never a schema change.
- **FTS5 trigram table** over `normalized_display`, kept in sync by triggers on `directory_name` (insert/update/soft-delete) — the standard D1-tested pattern (conflicts research §F). Serves substring/typo recall for ordinary Directory search day one, and complements phonetics (trigram catches embedded typos; phonetics catch sound-alikes).

**Beider-Morse and the scoring/severity engine are Phase 4** (the over-inclusive strictness setting + the Fellegi-Sunter scorer live with the conflicts engine, where the Rust/WASM core hosts the comparators). 1·3 ships only the recall-side substrate.

## 5. Sensitive identifiers — `protected()` wiring (the EIN decision)

Typed identifier values are stored as `protected()` fields (slice 1·2 / ADR-0084) — never plaintext — and declared against the 1·2 **per-field policy table**. Directory carries them as `directory_identifier` rows (`entity_id`, `identifier_type`, the `protected()` ciphertext column, the sibling `_blind_index` column where the policy allows, temporal validity, soft-delete) so an entity may hold several over time and across types:

| Identifier type     | Applies to   | Index posture (per ADR-0084)                                                   | Normalization                    |
| ------------------- | ------------ | ------------------------------------------------------------------------------ | -------------------------------- |
| SSN                 | Person       | standalone blind index (L=16)                                                  | strip to digits                  |
| **EIN**             | Organization | **standalone blind index (L=16)** — _new policy-table row added by this slice_ | strip to digits                  |
| Driver's license    | Person       | standalone blind index (L=16)                                                  | uppercase, strip, state-prefixed |
| Financial / account | both         | standalone blind index (L=24)                                                  | strip spaces/dashes, uppercase   |
| DOB                 | Person       | **never standalone** (low entropy) — decrypt-and-compare on a candidate set    | —                                |
| SSN last-four       | Person       | **never standalone**                                                           | —                                |

- **The EIN decision.** EIN is a tax identifier (an organization's SSN-equivalent), so it is `pii`, standalone-indexed, digit-stripped. The 1·2 policy table did not enumerate EIN; **this slice adds the EIN row to that table** (a coordinated note to slice 1·2, which is not yet built — Fable's build picks it up). Treated as sensitive, not public-registry data, because the conflicts exact-identifier channel relies on it (an EIN hit is near-certain).
- **The blind index is the Conflicts exact-identifier channel** (§A of the conflicts research): SSN/EIN/DL/account match by indexed equality, no decryption, exact only. It exists the moment Conflicts is built — that is conflicts seam 3, wired here.
- **Permission:** 1·3 registers `directory:viewSensitiveIdentifiers` (ADR-0068) as the decrypt permission carried on these `protectedField` declarations; reading a value is permission-check → `audit_log` row → AAD decrypt, inseparable (1·2 contract). Blind-index matching needs no permission and writes no audit (nothing is revealed).
- DOB is stored protected but **never standalone-indexed**; conflicts matches it by decrypt-and-compare on the small candidate set a name/identifier match already returned (the compound DOB+surname index is a named Phase-4 seam, built only if measured).

## 6. The edge graph

`directory_edge` — typed, directional, temporal relationships between entities:

- Columns: `ded_` handle, `from_entity_id`, `to_entity_id`, `edge_type` (TEXT CHECK), optional `role`/label, temporal validity (§9.1), soft-delete, optional note.
- **Edge types at launch** — the ordinary set **plus the conflicts seam-4 types made explicit** so the Phase 4 engine's graph expansion (related-party search) has them without a retrofit:
  - `affiliation` (person↔org: employee/officer/principal/registered-agent — the **principal-of-org** relationship the conflicts engine expands adverse orgs along),
  - `relationship` (person↔person: **spouse/family**/guardian/beneficiary),
  - corporate `corporate_parent` / `corporate_subsidiary` / `corporate_successor` (org↔org — a merger or rename must still match),
  - `representation` (the firm's representation relationship, distinct from `matter_party` role-links which live on the matter — see §8),
  - `role_assignment` (generic typed role between entities not covered above).
- These are conflicts seam 4. The engine that _traverses_ them (configurable depth, path-as-explanation) is Phase 4; 1·3 only guarantees the edge types exist and are queryable.

**Firm personnel are not Directory entities (the firm-personnel decision — flagged revisitable).** A firm lawyer relates to the system three distinct ways, kept on separate axes:

1. **As staff working a matter** — captured by the 0·4 `member` record + 1·1 matter staff-assignment. Internal staffing, never a `matter_party` role, never a Directory entity.
2. **As a conflict-bearing individual (imputation, Rule 1.10)** — conflicts from matters worked _at this firm_ are derived by the Phase 4 engine **joining `member` ↔ matter ↔ `matter_party`** (no Directory node for the lawyer is needed — the "conflicts graph" is a Phase-4 logical join across Directory + members + matters, not a requirement that personnel be Directory nodes). Conflicts carried from a **prior firm** (lateral hires) are the only genuinely new data; that capture is a **documented seam** (a future `prior_affiliation` shape / edge type), built in Phase 4 where the engine and the data-quality tradeoffs are decided together — the data is self-reported and unreliable, so building elaborate capture before its only consumer exists is unjustified.
3. **As a party — the matter is about them** — a lawyer who is themselves a client/opposing party/witness is an **ordinary Directory entity** with a `matter_party` role like anyone else, optionally linked to their `member` record as a convenience (`directory_person.member_id` nullable — not required).

> **Revisit (owner, 2026-06-12).** Decision 3 is explicitly open for reconsideration in the **Phase 4 Conflicts design cycle** — the owner wants to confirm the firm-personnel / lateral-imputation modeling is right before the conflicts engine commits to it. 1·3's choice (do not model personnel as entities; reserve the prior-firm seam) is the minimal, reversible position: it adds no personnel-entity data to retrofit, so revisiting later is cheap. This note is the record that the decision is provisional.

## 7. Duplicate handling (gate 2 — ADR-0086)

### 7.1 Entry-time prevention

On create/edit of an entity name, the domain service runs the §4 candidate-generation query (phonetic-block equality ∪ trigram match ∪ — when a sensitive identifier is supplied — blind-index equality) and returns a ranked **"possible duplicate?"** candidate list to the caller. This is recall-biased surfacing, not a scorer (scoring is Phase 4); the UI (later) shows it as a soft warning the user may accept ("use the existing record") or override ("no, this is a different person"). Front-line defense against the accidental-duplicate case.

### 7.2 Non-destructive merge

`mergeEntities(master_id, subordinate_id, survivorship)` composes one atomic batch:

1. **Subordinate is archived, not deleted:** `status = 'merged_into'` + `merged_into_id = master`. It leaves lists/search-as-itself but its row, names, identifiers, and edges remain.
2. **References are repointed to the master and each repoint is recorded:** all inbound references — `matter_party` links, `directory_edge` endpoints, `directory_entity_category`, contact/address/identifier rows as policy dictates — are repointed to the master. Every reference is findable because **all references are real indexed columns** (no JSON-blob scan; this is exactly why reference-kind custom fields are deferred to 1·4, §9).
3. **An append-only `entity_merge` event is written:** `eme_` handle, subordinate, master, the field-survivorship choices, and **the exact list of repointed references** (table, row, old→new). This row is load-bearing data (the future unmerge input), not just audit — though a parallel `audit_log` entry is also written.
4. **Names and identifiers stay matching:** the subordinate's `directory_name` rows (with phonetic codes) and identifier blind indexes remain in the search/conflicts corpus, now resolving to the master (the conflicts-corpus rule: a merged-away alias must still trigger a hit). This falls out of keeping the subordinate's child rows alive and master-resolved.

### 7.3 Survivorship

Field-level survivorship: the caller picks, per conflicting standard field, which value the master keeps; the prior values are recorded in the `entity_merge` event (so a future unmerge can restore them). Names/identifiers/edges/categories are _unioned_ onto the master (they are multi-valued child rows, not overwritten), not chosen.

### 7.4 Unmerge is deferred — and why it must be guarded

Automated unmerge is **not built in 1·3** (deferred to the LEAP slice). The reason is a real semantic limit, not just scope:

> If A and B merge into the master, then C (a new reference) is added against the merged entity, then unmerge is requested — deterministic replay restores B's recorded pre-merge references and leaves C with the master, because **C was created against the unified entity and the system cannot know which side it "belonged" to** (that information was never captured — to everyone who touched it, there was one entity). No schema fixes this.

So unmerge is tenable **only** as "reverse a specific, recent, still-clean merge" (the caught-quickly wrong-merge case), **never** as "split a long-lived merged entity." Three consequences, recorded as the seam:

- **Unconditional deterministic unmerge is rejected** — it silently misattributes post-merge data; a footgun dressed as a safety net.
- **Whenever unmerge is built, it must be guarded:** offered only while the merge is clean (no references created against the master, no survivorship-overwritten field edited, since the merge); once post-merge activity accrues, the button locks and recovery becomes a manual/ops path.
- **The `entity_merge` event is the complete seam:** because merge is non-destructive and the event records the exact repoint list + prior field values, the data to reverse a merge always exists; building the guarded automated unmerge later is not a retrofit over lost data. This honors the white-paper "unmerge safety net" in substance now (nothing irrecoverable) with the convenience button deferred — a documented white-paper amendment (defer-with-seam).

## 8. `matter_party` — wiring the 1·1 seam live + migration

Slice 1·1 (ADR-0080) shipped matters with **display-only** client fields (`client_display_name`, `client_code`) and sketched but did not create `matter_party`. This slice creates it and migrates:

- **Create `matter_party`** per the 1·1 sketch: `(matter_id, entity_id, role, valid_from, valid_to)`, **role on the link** (one entity may hold several roles in one matter — "many hats"), `role` drawn from a per-firm role list (`directory_party_role` definition rows; client-ship is `role = 'client'`). Soft-delete; temporal validity (§9.1). This is the `representation`/role-link channel the conflicts engine reads firm-wide.
- **Migrate the 1·1 display fields:** a data migration creates a Directory entity for each distinct `(client_display_name, client_code)` and a `matter_party` row with `role = 'client'`, then the display columns become derived/legacy. **Documented fallback:** display names that cannot be confidently resolved to a single entity (ambiguous/blank) are migrated to a provisional Person entity flagged for human review rather than silently merged — never auto-merge on a bare display string (the §7 prevention/merge path handles consolidation afterward). The migration is idempotent and re-runnable.
- The matter staff-assignment / responsible-attorney fields from 1·1 are **unchanged** — staffing is the `member` axis, not a `matter_party` role (§6).

## 9. Temporal validity, soft-delete, and the 1·4 seam

### 9.1 Temporal validity

`valid_from`/`valid_to` (nullable `valid_to` = currently valid) on the time-bounded facts: `directory_name`, `directory_edge`, `matter_party`, `directory_identifier`, and the contact/address child rows. Core entity identity (the `directory_person`/`directory_organization` row itself) is not time-bounded. Validity is descriptive history, distinct from soft-delete (a correction/removal).

### 9.2 Soft-delete

No hard delete (ADR-0006). Entities and their child rows carry the standard soft-delete columns; a deleted entity leaves active lists but is retained (and, like a merged subordinate, may remain in the conflicts corpus per the engine's later policy). Merge (§7) is the specific archival path for duplicates.

### 9.3 The custom-fields (slice 1·4) seam — the typed-EAV shape, designed here

Per ADR-0087 the engine builds in 1·4, but the shape is settled now (the "design once for matters + entities" moment) so 1·4 has a spec seed and so 1·3's merge/relink accounts for it:

- `custom_field` (definition, per-firm data): name, kind (the Clio-12 catalog as a CHECK — checkbox/date/time/number/currency/picklist/single-line/multi-line/url/email/**matter-reference**/**contact-reference**), target (`matter` | `entity`), attachment (matter-type id / entity-category id, nullable = all), required, archived, position. Picklist options as a child table.
- `custom_field_value`: target row id, field id, **typed value columns** (`value_text`, `value_number` minor-units per ADR-0061, `value_date`, `value_option_id` FK, `value_reference_id` — an identifier handle validated against the field's kind), exactly one non-null (CHECK), UNIQUE(target, field). Reference kinds get **real, indexed columns**.
- **Merge interaction (the reason it is designed now):** reference-kind custom-field values are entity references. When 1·4 builds them, **1·4 extends 1·3's merge relink set** to repoint `custom_field_value.value_reference_id` — a clean build-when-in-the-area extension (1·4 is the slice introducing reference-kind fields, so it owns adding them to merge's relink). 1·3's merge relink surface stays bounded to `matter_party` / edges / categories / contact rows — all real columns, no JSON scan.

This is why JSON storage was rejected for custom fields (breaks merge relinking and field-level audit/temporal history) and why the engine is its own slice rather than crammed into 1·3.

## 10. Load-profile extension (accretion rule — ADR-0078/0083)

Per the accretion rule, 1·3 extends `@magna-carta/fixtures`:

- **A Directory volume profile** — entities (person/org mix), names per entity (with alias/former distribution), edges (the graph degree distribution), identifiers, and `matter_party` links at firm scale, generated through the real domain write-paths (valid by construction, one-seed deterministic). Joins the active profile.
- **Volume-shaped measured operations** added to the measured set: a **blind-index identifier lookup** and a **`protected()` field list read** at Directory scale (1·2's crypto measured where it matters — the 1·2 load-profile note explicitly defers Directory-scale protected volume to here), the **candidate-generation query** (phonetic-block ∪ trigram), and a **graph-expansion traversal** (the Phase-4 related-party query shape, measured now so its plan is known before the engine builds on it). `EXPLAIN QUERY PLAN` full-scan flagging applies; no timing gates (`performance.md`).

## 11. Testing posture & conformance

- **Unit (`@magna-carta/directory`):** name-history append/flip invariants (exactly one current; former carries `valid_to`); phonetic-code computation determinism + the scheme-keyed shape; candidate-generation recall (the "married-and-changed-surname", typo, and sound-alike cases surface); merge atomicity + the exact `entity_merge` repoint list; survivorship recording; the conflicts-corpus rule (a merged-away alias still matches); validation named codes.
- **Integration (real SQLite / Miniflare):** the migration applies; the FTS5 trigram triggers stay in sync across insert/update/soft-delete; merge composes one atomic batch with UNIQUE/rollback semantics (the 0·2/0·3 batch discipline); the `matter_party` migration is idempotent with the ambiguous-name fallback; `protected()` identifier round-trips + blind-index equality + the decrypt audit row (1·2 contract); `directory:viewSensitiveIdentifiers` gates the decrypt.
- **Fitness functions (table-wide, the ADR-0051 pattern):** every `directory_name` row has at least the two Double Metaphone codes; no float columns (ADR-0061); handle-TEXT primary keys; sensitive identifiers never appear in a plaintext column or escape unredacted (the 1·2 no-plaintext-escape source scan extended to Directory fields); no `directory_edge` references a hard-deleted entity (the no-dangling-reference discipline); the merge relink leaves no inbound reference pointing at a `merged_into` subordinate (the relink-completeness invariant).
- **End-to-end:** create entities → add names/edges/identifiers → entry-time duplicate prevention surfaces the dup → merge → confirm matter-party links and edges repointed, the alias still matches, the `entity_merge` event is complete, and an audited sensitive-identifier read works.

## 12. Documentation, ADRs, roadmap

Same-commit (golden rule 5):

- **ADR-0085 / 0086 / 0087** appended to the Decision Log (§0 decisions).
- **ROADMAP:** slice 1·3 moves to designed/planned; **new slice 1·4 — custom-fields engine** added after 1·3, before Phase 2·6; the Backlog "custom fields" expectations point at 1·4.
- **STATUS:** 1·3 Spec `[x]`; new 1·4 row.
- **White paper** _Directory_: the unmerge line amended to defer-with-seam (guarded, LEAP); the custom-fields line pointed at slice 1·4; firm-personnel modeling noted as the conflicts-graph join (provisional, revisit Phase 4).
- **CHANGELOG:** the design-cycle entry.
- **No UI in this slice** → no owner manual-verification checklist yet; the 1·3 UI plan (and its checklist — including "an SSN/EIN displays masked and decrypt is audited", and "the possible-duplicate warning surfaces on entry") is written once 0·7a/0·7b land, the 1·1 precedent.

## 13. Explicitly out of scope (seamed)

- **Custom-fields engine** → slice 1·4 (shape designed §9).
- **Automated unmerge** → LEAP slice, guarded (§7.4).
- **Beider-Morse / Daitch-Mokotoff phonetics, the Fellegi-Sunter scorer, severity bands, configurable strictness/depth, the related-party graph traversal, and the immutable conflicts log** → Phase 4 Conflicts engine (1·3 ships only the recall-side seams §4/§5/§6).
- **Firm-personnel-as-entities and prior-firm lateral-conflict capture** → Phase 4 (provisional; §6 revisit note).
- **Compound DOB+surname blind index** → Phase 4, if measured.
- **UI** → after 0·7a/0·7b.
