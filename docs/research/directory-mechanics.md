# Directory Mechanics — Custom Fields, Merge/Unmerge, Phonetic Encoders (Research)

**Date:** 2026-06-12
**Scope:** The three Directory-internal areas slice 1·3's design cycle would otherwise hit unresearched: the **shared custom-fields engine** (deferred from slice 1·1 so it is designed once for matters _and_ Directory entities), **merge/unmerge mechanics** (the white paper promises relink-every-reference merge with both histories preserved and an unmerge safety net — the surgery, not the detection), and **phonetic-encoder implementation feasibility** (the conflicts research prescribes write-time Double Metaphone / Beider-Morse columns without verifying what runs on the stack). Input to the slice 1·3 **design** cycle, not a design.
**Companions:** [`conflicts-matching-engine.md`](conflicts-matching-engine.md) (the conflicts seams 1·3 carries) · [`protected-crypto-module.md`](protected-crypto-module.md) (the encrypted-identifier channel).
**Purpose:** Verify the mechanics on the current stack (golden rule 11) and resolve each area into a concrete recommended shape the design cycle can ratify or amend.

## Relationship to what is already decided

Settled and not revisited: the Directory model (white paper, _Directory_ — Person/Organization, typed edges, structured names + alias/former-name history, typed identifiers, temporal validity, soft-delete); the six conflicts seams and the encoder _choice_ (Double Metaphone default, Beider-Morse over-inclusive — [`conflicts-matching-engine.md`](conflicts-matching-engine.md) §F/§H); the blind-index policy table (ADR-0084); custom fields are per-firm data with a shared engine for matter types and entity categories (slice 1·1 design, ADR-0080); duplicate _detection_ rides the conflicts matching machinery. This research fills the layer below.

## Method & sources

Web survey of dynamic-attribute storage patterns (EAV / JSON / sparse columns) and SQLite's JSON + generated-column indexing; CRM merge prior art (Salesforce, HubSpot, Dynamics 365) and restore/unmerge tooling; npm/crates phonetic-implementation landscape (words/double-metaphone, the Beider-Morse reference implementations, rphonetic). Confidence high on the storage and merge patterns (multiple consistent sources, primary docs); high on Double Metaphone availability; medium on the exact rphonetic license/maturity details (flagged for build-time verification). Full URLs in [Sources](#sources).

---

## A. The shared custom-fields engine

### A.1 The requirement (from both consumers)

Per-firm administrators define fields; fields attach to **matter types** (slice 1·1's deferral) and **entity categories** (white paper: a category _adds_ standard + custom fields). Values must: feed the **document-automation data dictionary** (Phase 2·6 merge fields), be **filterable/searchable** in lists, survive the **LEAP import** (its custom fields are a primary mapping target), respect the audit discipline, and — critically — **reference other records** (Clio ships matter-reference and contact-reference field kinds; a custom field pointing at a Directory entity must survive a merge).

### A.2 Field-kind catalog (market ground truth)

Clio Manage ships 12 kinds: checkbox, date, time, number, currency, picklist, single-line text, multi-line text, website/URL, email, matter reference, contact reference — grouped into per-practice-area "field sets." That catalog is the right launch superset; nothing in the survey suggests firms need more exotic kinds at intake.

### A.3 Storage — the trade study

Three patterns for dynamic attributes:

| Pattern                              | Strengths                                                                                                                                                                                  | Weaknesses                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EAV rows** (one row per set value) | per-value rows are findable/indexable/auditable; real FK columns possible                                                                                                                  | "long and skinny"; values stringly-typed unless typed columns; joins to assemble a record                                                                                                 |
| **JSON column on the entity**        | one read assembles the record; SQLite indexes chosen paths via **virtual generated columns** (`json_extract` + B-tree index, addable after the fact, plain SQLite ≥ 3.31 so D1-compatible) | **no referential integrity inside JSON** — a reference-kind field is just a string; finding "every value pointing at entity X" is a corpus scan; per-field audit/temporal history awkward |
| Sparse real columns                  | native types and indexes                                                                                                                                                                   | per-firm DDL churn — a non-starter for firm-defined fields                                                                                                                                |

**The deciding constraints are ours, not generic.** Two platform invariants break the JSON option: (1) **merge relinking** — the white paper requires merge to relink _every_ reference; reference-kind custom fields stored in JSON blobs cannot be found by index, only by scanning every document (and the no-dangling-references discipline can't be a FK); (2) **field-level audit and temporal validity** — Directory key fields are time-bounded and audited per change, which maps to rows, not blob diffs. The JSON pattern's strength (read-assembly speed) is recoverable with a join; its weaknesses are structural for us.

**Recommendation — typed EAV with per-kind value columns:**

- `custom_field` (definition, per-firm data): name, kind (the A.2 catalog as a CHECK), target (`matter` | `entity`), attachment (matter-type id / entity-category id, nullable = all), required flag, archived flag, position. Picklist options as a child table (option rows are referenceable, renamable without breaking stored values).
- `custom_field_value`: target row id, field id, **typed value columns** (`value_text`, `value_number` INTEGER/minor-units for currency per ADR-0061, `value_date`, `value_option_id` FK → picklist option, `value_reference_id` — an identifier handle validated against the field's kind), UNIQUE(target row, field). Exactly one value column non-null, enforced by CHECK.
- **Reference kinds get real, indexed columns** — merge relinking becomes one indexed UPDATE; the LEAP import writes auditable rows; conflicts/document-automation read typed values.
- Indexes: (field id, each value column) — covers "filter matters where field X = Y" without FTS; list-screen assembly is one join, paginated.

The engine is one design serving both consumers; 1·3 builds it (Directory needs it for categories) and retro-attaches matter types to it in the same slice — the 1·1 seam (`matter_type` exists, fields deferred) was left exactly for this.

## B. Merge/unmerge mechanics

### B.1 Prior art — what the market actually does

- **Salesforce:** pick a master + field-level survivorship; duplicate records are **hard-deleted** (recycle bin ~15 days); restore-from-bin recovers the row but **values copied to the master cannot be unwound** — there is no true unmerge; third-party backup tooling exists precisely because of this.
- **HubSpot:** merge is **explicitly irreversible**; no native unmerge (an "Emergency Unmerge" marketplace app reconstructs from backups); the secondary record ceases to exist, which breaks external references/integrations.
- **Dynamics 365 — the closest model to our discipline:** the subordinate record is **deactivated, not deleted**, and linked to the master (merge tracking); 1:N lookups are **reparented** to the master (after the merge, nothing references the subordinate); grandchildren stay attached to their (now-reparented) parents.

**Finding:** nobody in the mainstream does real unmerge; "unmerge" in the wild means restore-from-backup. The white paper's unmerge safety net therefore has to be **designed in**, not assumed — and the ingredients are exactly our existing disciplines: never hard-delete, append-only event records, and findable references (A.3).

### B.2 Recommended model — non-destructive merge + a first-class merge event

1. **Subordinate survives, archived** (Dynamics-style, matching our soft-delete discipline): status `merged_into` + master id. It vanishes from lists/search-as-itself but its row, names, and history remain.
2. **References are relinked, and every relink is recorded.** All inbound references (matter-party links, edges, custom-field reference values, role assignments) are repointed to the master — each one findable by index because references are real columns everywhere (A.3). The merge writes a **`entity_merge` event** (append-only): subordinate, master, the field-survivorship choices made, and **the exact list of repointed references** (table, row, old → new).
3. **Names and identifiers keep matching.** The subordinate's name rows (with their phonetic codes) and identifier blind indexes remain in the search/conflicts corpus, now resolving to the master — a merged-away alias must still trigger a conflict hit (the same rationale as name-change history). This falls out naturally from keeping the subordinate's child rows alive and master-resolved.
4. **Unmerge = deterministic replay of the event, inverse:** restore the subordinate's status, repoint exactly the recorded references back, restore survivorship-overwritten fields from the recorded prior values. **Post-merge edits resolve by policy:** changes made after the merge stay with the master (recorded in the event's timestamp boundary); references _created_ after the merge stay with the master (they were created against it). This is honest — unmerge restores the pre-merge state plus an auditable seam, not a fictional alternate history.
5. **Detection is not this machinery:** duplicate-detection ("possible duplicate?" at entry/import) reuses the conflicts candidate-generation channels (phonetic blocks + blind-index equality) per the conflicts research; merge consumes its output.

Audit: the merge/unmerge events are themselves `audit_log` entries plus the dedicated event row (the event row is load-bearing data — the unmerge input — not just history).

## C. Phonetic encoders — implementation feasibility

### C.1 The landscape, verified

- **Double Metaphone:** the `words/double-metaphone` npm package — typed, pure string code, no Node APIs (browser/Deno-compatible → Workers-safe), MIT, actively maintained. Returns the primary + secondary codes the conflicts research expects. **Viable today in the Worker at write time.**
- **Beider-Morse: no mature JavaScript/TypeScript implementation exists.** The reference implementations are PHP (stevemorse.org; the Haran/BMDMSoundex fork is PHP-only and **GPL-3** — license-incompatible with our distribution posture anyway); the one npm TypeScript package is v0.4.x, single-maintainer, months old — not a foundation for an ethics-critical matching channel. The serious implementations are Apache **commons-codec** (Java) and its Rust port **`rphonetic`** (BeiderMorse + Daitch-Mokotoff + Double Metaphone, embedded commons-codec rules, on crates.io) — which fits the stack's **shared Rust core → WASM** path (white paper, _Delivery model_; the conflicts research already places scoring comparators there). Verify rphonetic's license + rule-file completeness at adoption (flagged; commons-codec rules are Apache-2.0).
- Daitch-Mokotoff (the genealogy-grade over-inclusive alternative) comes free with rphonetic if that path is taken.

### C.2 Recommendation — scheme-keyed phonetic rows, Double Metaphone now, Beider-Morse additive later

This **refines the conflicts research's "phonetic-code columns"** into a shape that makes the encoder set growable:

- Store codes in a child table keyed by scheme — `name_phonetic_code(name_row_id, scheme, code)`, scheme ∈ {`double_metaphone_primary`, `double_metaphone_secondary`, …} — rather than fixed columns. Adding a scheme later (Beider-Morse via rphonetic/WASM, Daitch-Mokotoff) is **additive rows + one backfill sweep** (the 1·2 sweep pattern), not a schema change; removing one is a delete.
- **Launch with Double Metaphone only** (`words/double-metaphone`, pinned, in the Worker write path). The white paper's "over-inclusive" strictness setting ships at launch as _alias-inclusive + trigram_ matching; the **Beider-Morse surname channel arrives with the Phase 4 conflicts engine**, where the Rust/WASM core is being stood up for scoring comparators anyway — one WASM artifact, not two integration efforts.
- The FTS5 trigram substrate (conflicts research seam 6) is unaffected and complements: trigram catches typos/substrings, phonetics catch sound-alikes.

---

## D. Consolidated recommendations for the slice 1·3 design cycle

1. **Custom-fields engine:** typed-EAV shape (A.3) — definitions + picklist options + typed value rows with real reference columns; the Clio 12-kind catalog as launch superset; one engine attached to entity categories _and_ matter types in the same slice. JSON storage rejected on merge-relinking and field-audit grounds (recorded trade study).
2. **Merge:** non-destructive Dynamics-style merge with the `entity_merge` event recording survivorship + every repointed reference; subordinate's names/identifiers stay in the matching corpus master-resolved; unmerge = recorded-event inverse replay with the post-merge-edits-stay-with-master policy. (B.2)
3. **Phonetics:** scheme-keyed `name_phonetic_code` rows; `words/double-metaphone` (pinned) at launch; Beider-Morse deferred to the Phase 4 Rust/WASM core via `rphonetic` (verify license/rules then); Daitch-Mokotoff noted as a free rider on that path. (C.2)
4. **Carried unchanged:** the six conflicts seams ([`conflicts-matching-engine.md`](conflicts-matching-engine.md) §F) and the ADR-0084 identifier policy table — this research adds no new obligations to them, only the implementation shapes above.

## Sources

- [Storing Dynamic Attributes — Sparse Columns, EAV, and JSONB Explained (Leapcell)](https://leapcell.io/blog/storing-dynamic-attributes-sparse-columns-eav-and-jsonb-explained)
- [Replacing EAV with JSONB in PostgreSQL (coussej)](https://coussej.github.io/2016/01/14/Replacing-EAV-with-JSONB-in-PostgreSQL/)
- [Laravel Custom Fields: JSON, EAV Model, or Same Table? (Laravel Daily)](https://laraveldaily.com/post/laravel-custom-fields-json-eav-model-same-table)
- [JSON and virtual columns in SQLite (antonz.org)](https://antonz.org/json-virtual-columns/)
- [SQLite JSON Superpower: Virtual Columns + Indexing (DB Pro)](https://www.dbpro.app/blog/sqlite-json-virtual-columns-indexing)
- [Get Started With Custom Fields (Clio Help Center)](https://help.clio.com/hc/en-us/articles/9285493193115-Get-Started-With-Custom-Fields)
- [Create Custom Fields in Clio Manage (Clio Help Center)](https://help.clio.com/hc/en-us/articles/9285496802331-Create-Custom-Fields-in-Clio-Manage)
- [Record Merging and Merge Tracking in Depth in Microsoft Dynamics 365 (Suresh Maurya)](https://sureshmauryanotes.wordpress.com/2021/06/13/record-merging-and-merge-tracking-in-depth-in-microsoft-dynamics-365/)
- [Considerations for Merging Duplicate Records in Dynamics CRM (CRM Consultants UK)](https://www.crmconsultants.co.uk/considerations-for-merging-duplicate-records-in-dynamics-crm/)
- [Recover Merged Salesforce Contacts (Salesforce Help)](https://help.salesforce.com/s/articleView?id=000386067&language=en_US&type=1)
- [Restoring a record that has been merged in Salesforce (Gearset)](https://docs.gearset.com/en/articles/6009690-restoring-a-record-that-has-been-merged-in-salesforce)
- [Merge records (HubSpot Knowledge Base)](https://knowledge.hubspot.com/records/merge-records)
- [Emergency Unmerge (HubSpot marketplace listing)](https://ecosystem.hubspot.com/marketplace/listing/emergency-unmerge)
- [CRM Deduplication 2026: A Merge & Match Methodology (Digital Applied)](https://www.digitalapplied.com/blog/crm-data-deduplication-merge-framework-2026-methodology)
- [words/double-metaphone (GitHub / npm)](https://github.com/words/double-metaphone)
- [Beider-Morse Phonetic Matching (stevemorse.org)](https://stevemorse.org/phonetics/bmpm.htm)
- [Haran/BMDMSoundex — PHP, GPL-3 (GitHub)](https://github.com/Haran/BMDMSoundex)
- [rphonetic — Rust port of commons-codec phonetic algorithms (crates.io)](https://crates.io/crates/rphonetic)
- [BeiderMorse in rphonetic (docs.rs)](https://docs.rs/rphonetic/latest/rphonetic/struct.BeiderMorse.html)
