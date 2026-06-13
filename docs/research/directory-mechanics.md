# Directory Mechanics — Custom Fields, Merge/Unmerge, Phonetic Encoders (Research)

**Date:** 2026-06-12
**Scope:** The three Directory-internal areas slice 1·3's design cycle would otherwise hit unresearched: the **shared custom-fields engine** (deferred from slice 1·1 so it is designed once for matters _and_ Directory entities), **merge/unmerge mechanics** (the white paper promises relink-every-reference merge with both histories preserved and an unmerge safety net — the surgery, not the detection), and **phonetic-encoder implementation feasibility** (the conflicts research prescribes write-time Double Metaphone / Beider-Morse columns without verifying what runs on the stack). Input to the slice 1·3 **design** cycle, not a design.
**Companions:** [`conflicts-matching-engine.md`](conflicts-matching-engine.md) (the conflicts seams 1·3 carries) · [`protected-crypto-module.md`](protected-crypto-module.md) (the encrypted-identifier channel).
**Purpose:** Verify the mechanics on the current stack (golden rule 11) and resolve each area into a concrete candidate shape.
**Status (owner, 2026-06-12): all three areas are marked _needs further owner input_.** Whether each item should be built **at all**, and whether its benefit justifies its cost, is an explicit open gate for the slice 1·3 design cycle — none of the shapes below is adopted. Each section therefore states the candidate shape _and_ the go/no-go question with its cost and claimed benefit, so the gate can be decided on evidence rather than momentum. Where an item traces to a white-paper Directory promise, the gate decision is build-in-1·3 vs defer-with-seam vs descope (a white-paper amendment).

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

**Candidate shape (NOT adopted — owner gate pending) — typed EAV with per-kind value columns:**

- `custom_field` (definition, per-firm data): name, kind (the A.2 catalog as a CHECK), target (`matter` | `entity`), attachment (matter-type id / entity-category id, nullable = all), required flag, archived flag, position. Picklist options as a child table (option rows are referenceable, renamable without breaking stored values).
- `custom_field_value`: target row id, field id, **typed value columns** (`value_text`, `value_number` INTEGER/minor-units for currency per ADR-0061, `value_date`, `value_option_id` FK → picklist option, `value_reference_id` — an identifier handle validated against the field's kind), UNIQUE(target row, field). Exactly one value column non-null, enforced by CHECK.
- **Reference kinds get real, indexed columns** — merge relinking becomes one indexed UPDATE; the LEAP import writes auditable rows; conflicts/document-automation read typed values.
- Indexes: (field id, each value column) — covers "filter matters where field X = Y" without FTS; list-screen assembly is one join, paginated.

**The go/no-go question (owner gate):** does the firm actually need firm-defined custom fields at launch — or at all? **Cost:** a real sub-engine (definitions admin UI, typed value storage, validation, list filtering, document-automation wiring, LEAP mapping) — plausibly the largest single component in 1·3. **Claimed benefit:** capturing practice-specific data (white paper promises it for both matter types and entity categories) and a landing zone for LEAP custom fields at migration. **Cheaper alternatives if descoped or deferred:** ship the fixed standard fields only (categories still add their standard fields — bar number, jurisdiction, specialty — as ordinary columns, no engine needed) and revisit when a concrete field the firm can name has nowhere to live; or defer to the LEAP-migration slice where the real custom-field inventory is known. The trade study above stands either way — _if_ the engine is ever built, typed-EAV is the shape; whether to build it is the open question.

## B. Merge/unmerge mechanics

### B.1 Prior art — what the market actually does

- **Salesforce:** pick a master + field-level survivorship; duplicate records are **hard-deleted** (recycle bin ~15 days); restore-from-bin recovers the row but **values copied to the master cannot be unwound** — there is no true unmerge; third-party backup tooling exists precisely because of this.
- **HubSpot:** merge is **explicitly irreversible**; no native unmerge (an "Emergency Unmerge" marketplace app reconstructs from backups); the secondary record ceases to exist, which breaks external references/integrations.
- **Dynamics 365 — the closest model to our discipline:** the subordinate record is **deactivated, not deleted**, and linked to the master (merge tracking); 1:N lookups are **reparented** to the master (after the merge, nothing references the subordinate); grandchildren stay attached to their (now-reparented) parents.

**Finding:** nobody in the mainstream does real unmerge; "unmerge" in the wild means restore-from-backup. The white paper's unmerge safety net therefore has to be **designed in**, not assumed — and the ingredients are exactly our existing disciplines: never hard-delete, append-only event records, and findable references (A.3).

### B.2 Candidate model (NOT adopted — owner gate pending) — non-destructive merge + a first-class merge event

1. **Subordinate survives, archived** (Dynamics-style, matching our soft-delete discipline): status `merged_into` + master id. It vanishes from lists/search-as-itself but its row, names, and history remain.
2. **References are relinked, and every relink is recorded.** All inbound references (matter-party links, edges, custom-field reference values, role assignments) are repointed to the master — each one findable by index because references are real columns everywhere (A.3). The merge writes a **`entity_merge` event** (append-only): subordinate, master, the field-survivorship choices made, and **the exact list of repointed references** (table, row, old → new).
3. **Names and identifiers keep matching.** The subordinate's name rows (with their phonetic codes) and identifier blind indexes remain in the search/conflicts corpus, now resolving to the master — a merged-away alias must still trigger a conflict hit (the same rationale as name-change history). This falls out naturally from keeping the subordinate's child rows alive and master-resolved.
4. **Unmerge = deterministic replay of the event, inverse:** restore the subordinate's status, repoint exactly the recorded references back, restore survivorship-overwritten fields from the recorded prior values. **Post-merge edits resolve by policy:** changes made after the merge stay with the master (recorded in the event's timestamp boundary); references _created_ after the merge stay with the master (they were created against it). This is honest — unmerge restores the pre-merge state plus an auditable seam, not a fictional alternate history.
5. **Detection is not this machinery:** duplicate-detection ("possible duplicate?" at entry/import) reuses the conflicts candidate-generation channels (phonetic blocks + blind-index equality) per the conflicts research; merge consumes its output.

Audit: the merge/unmerge events are themselves `audit_log` entries plus the dedicated event row (the event row is load-bearing data — the unmerge input — not just history).

**The go/no-go question (owner gate):** how much merge machinery does a small trusted firm need at launch? Three descending tiers, each a real option: (a) the full candidate model above (merge + recorded event + true unmerge); (b) **merge without unmerge** — still non-destructive (subordinate archived, references repointed, event recorded for audit), but no inverse-replay machinery, matching what every mainstream CRM actually ships; (c) **no merge at launch** — duplicate _prevention_ only (the detect-on-entry "possible duplicate?" warning), with merge deferred until the LEAP import makes duplicates real at volume. **Cost gradient:** (c) is nearly free, (b) is moderate, (a) adds the inverse-replay machinery and its tests. **Claimed benefit:** the white paper promises merge + unmerge for the SSOT discipline and the LEAP import; the counterpoint is that the LEAP import is also the first moment merge is truly needed — building (a) in 1·3 may be ahead of need. The conflicts-corpus rule (a merged-away alias must still match) binds any tier that merges.

## C. Phonetic encoders — implementation feasibility

### C.1 The landscape, verified

- **Double Metaphone:** the `words/double-metaphone` npm package — typed, pure string code, no Node APIs (browser/Deno-compatible → Workers-safe), MIT, actively maintained. Returns the primary + secondary codes the conflicts research expects. **Viable today in the Worker at write time.**
- **Beider-Morse: no mature JavaScript/TypeScript implementation exists.** The reference implementations are PHP (stevemorse.org; the Haran/BMDMSoundex fork is PHP-only and **GPL-3** — license-incompatible with our distribution posture anyway); the one npm TypeScript package is v0.4.x, single-maintainer, months old — not a foundation for an ethics-critical matching channel. The serious implementations are Apache **commons-codec** (Java) and its Rust port **`rphonetic`** (BeiderMorse + Daitch-Mokotoff + Double Metaphone, embedded commons-codec rules, on crates.io) — which fits the stack's **shared Rust core → WASM** path (white paper, _Delivery model_; the conflicts research already places scoring comparators there). Verify rphonetic's license + rule-file completeness at adoption (flagged; commons-codec rules are Apache-2.0).
- Daitch-Mokotoff (the genealogy-grade over-inclusive alternative) comes free with rphonetic if that path is taken.

### C.2 Candidate shape (NOT adopted — owner gate pending) — scheme-keyed phonetic rows, Double Metaphone now, Beider-Morse additive later

This **refines the conflicts research's "phonetic-code columns"** into a shape that makes the encoder set growable:

- Store codes in a child table keyed by scheme — `name_phonetic_code(name_row_id, scheme, code)`, scheme ∈ {`double_metaphone_primary`, `double_metaphone_secondary`, …} — rather than fixed columns. Adding a scheme later (Beider-Morse via rphonetic/WASM, Daitch-Mokotoff) is **additive rows + one backfill sweep** (the 1·2 sweep pattern), not a schema change; removing one is a delete.
- **Launch with Double Metaphone only** (`words/double-metaphone`, pinned, in the Worker write path). The white paper's "over-inclusive" strictness setting ships at launch as _alias-inclusive + trigram_ matching; the **Beider-Morse surname channel arrives with the Phase 4 conflicts engine**, where the Rust/WASM core is being stood up for scoring comparators anyway — one WASM artifact, not two integration efforts.
- The FTS5 trigram substrate (conflicts research seam 6) is unaffected and complements: trigram catches typos/substrings, phonetics catch sound-alikes.

**The go/no-go question (owner gate):** does 1·3 need write-time phonetic codes at all, given the conflicts _engine_ is Phase 4? **Cost:** small at write time (one pinned library, one child table, codes computed alongside the row), but it is speculative inventory carried for several phases. **Claimed benefit:** the conflicts research's retrofit argument — adding codes later means recomputing over the entire Directory corpus — which is real but **weakened by this research's own sweep precedent**: the 1·2-style backfill sweep makes a later recompute a routine one-off job, not a crisis. The honest framing: this seam is _convenient_ now, not _expensive-to-retrofit_ in the way content hashes were (no byte re-reads — names are plaintext rows). A defensible alternative is to ship only the FTS5 trigram substrate in 1·3 (it serves ordinary Directory search day one) and add phonetic codes by sweep when Phase 4 opens.

---

## D. Consolidated owner gates for the slice 1·3 design cycle

**None of the three areas is adopted (owner, 2026-06-12).** Each enters the 1·3 design cycle as a go/no-go decision — _should this be built at all, and does the benefit justify the cost?_ — with the candidate shape on file only so a "go" is immediately actionable. The design cycle must put each gate to the owner explicitly, with the cost/benefit/alternative framing from its section, before any of these shapes appears in the spec.

1. **Custom-fields engine — gate open.** Build the engine in 1·3, defer it (fixed standard fields only; revisit at LEAP migration when the real field inventory exists), or descope (white-paper amendment)? Candidate shape if "go": typed-EAV (A.3). The deferral option costs little: categories' _standard_ fields are ordinary columns and need no engine.
2. **Merge/unmerge — gate open.** Pick a tier: full merge + true unmerge (a), merge without unmerge (b — the industry norm), or duplicate-prevention only with merge deferred to the LEAP import (c). Candidate model if (a) or (b): non-destructive merge + the `entity_merge` event (B.2). The conflicts-corpus rule (merged-away aliases must still match) binds any merging tier.
3. **Phonetic codes at write time — gate open.** Ship them in 1·3, or ship only the FTS5 trigram search substrate and add phonetic codes by backfill sweep when Phase 4 actually builds the conflicts engine? The retrofit-cost argument is weaker than first stated (C.2) — a sweep makes later addition routine. Candidate shape if "go": scheme-keyed rows + `words/double-metaphone`.
4. **Carried unchanged (not gated by this doc):** the six conflicts seams ([`conflicts-matching-engine.md`](conflicts-matching-engine.md) §F) and the ADR-0084 identifier policy table — though gate 3 directly tempers conflicts seam 1 (phonetic-code columns), and the 1·3 design should resolve them together.

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
