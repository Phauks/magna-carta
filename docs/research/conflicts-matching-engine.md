# Conflicts Matching Engine — Research (and the seams slice 1·3 must build)

**Date:** 2026-06-11
**Scope:** The under-specified conflicts-matching engine (white paper, _Conflicts Check_ — "Needs development") and the **Directory seams slice 1·3 must build now** so the Phase 4 engine is not an expensive retrofit. Covers candidate generation, scoring, related-party graph expansion, the platform-feasible architecture, and the immutable conflicts-log content. Input to two design cycles — the **slice 1·3 Directory** design (imminent: the seams) and the **Phase 4 Conflicts** design (the engine) — not a design itself.
**Purpose:** Turn an ethics-critical "Needs development" flag into concrete, grounded options, and isolate the cheap-now / expensive-to-retrofit parts that belong in the Directory build.

## Relationship to what is already decided

Settled and not revisited: the Directory model — Person/Organization nodes, typed edges (affiliations, relationships, representation, role-links), structured legal names + aliases/AKAs/maiden/former + **name-change history retained because conflicts must match a changed name**, typed identifiers, duplicate-detection/merge/unmerge, temporal validity (white paper, _Directory_); the Conflicts requirements — firm-wide scope spanning all Locations, triggers at intake + party-add + periodic re-scan, configurable strictness (balanced default; over-inclusive fuzzy/phonetic/alias available), configurable depth (structured default; optional document-content scan), human clearance, immutable defensible log (white paper, _Conflicts Check_); and the **encrypted-identifier channel** — SSN/EIN/DL/DOB are `protected()` with an HMAC blind index, so identifier matching is **exact-only**, with DOB handled by compound index or decrypt-and-compare (the exact-identifier-vs-fuzzy-name split in [`protected-crypto-module.md`](protected-crypto-module.md)).

## Method & sources

Primary: the entity-resolution / record-linkage literature (Fellegi-Sunter, the ER pipeline, Splink), phonetic-algorithm comparisons (Soundex / Double Metaphone / Beider-Morse), SQLite FTS5 + trigram + spellfix1 feasibility on Cloudflare D1, and ABA Model Rules 1.7/1.9/1.10 + practitioner guidance on defensible conflict-check documentation. Confidence high on the technique and the ABA frame; medium on exact D1 extension availability (spellfix1 — flagged). URLs in [Sources](#sources).

---

## A. The domain frame — what a conflicts check must catch

Conflicts is an ethics obligation, not a search box. ABA Model Rule **1.10(e)** imposes an affirmative duty to maintain *reasonable procedures to detect conflicts* — the system itself is the compliance artifact, and conflicts are the leading cause of malpractice claims (~20% of risk; automated screening drops the claim rate from 3–5% to <0.5%). What must be caught, per Rules 1.7 (current-client), 1.9 (former-client), and 1.10 (imputation):

- **Name variants and changes** — the party who married and changed surname, the entity that renamed or merged, the seven-year-old matter entered with a typo. Exact-match misses all of these → the engine must be **recall-biased** (a missed conflict is a malpractice event; a false positive is a few seconds of reviewer time).
- **Related parties / entity relationships** — the opposing party's spouse you represented elsewhere; the adverse company *owned by* a current client; the *principals of* an org named as adverse. Matching must be **person↔organization and graph-aware**, not just name↔name.
- **Imputed (firm-wide) conflicts** — one lawyer's conflict imputes to the whole firm (Rule 1.10), and **lateral hires carry their prior firm's adverse representations**. So the conflicts graph includes *the firm's own personnel and their employment history*, not only client/matter parties.

This frames every design choice below: bias toward recall, model the graph, and span the whole firm.

## B. The matching pipeline (entity-resolution stages)

The standard ER pipeline maps directly onto the white paper's "candidate-generation + scoring model":

1. **Preprocess / normalize** — canonicalize names (case, punctuation, diacritics→NFC, suffix/title parsing), expand the entity set to search (party + aliases + former names + graph-expanded related parties, §E).
2. **Blocking / candidate generation** (§C) — cheaply reduce the firm-wide Directory to a candidate set, so matching is not O(n²). Two channels: exact-identifier (blind index) and phonetic/n-gram name blocks.
3. **Comparison & scoring** (§D) — per-field similarity over each candidate, combined into a match score (Fellegi-Sunter).
4. **Classification → adjudication** — thresholds map the score to severity bands; a human clears each surfaced hit; the disposition is logged (§G).

Recall lives in stage 2 (blocking must not drop a true match); precision/triage lives in stages 3–4 (scoring and the reviewer).

## C. Candidate generation — two channels

### C.1 Encrypted identifiers — exact, high-precision

SSN/EIN/DL (and DOB with care) match by **equality on the HMAC blind index** — no decryption, exact only. This is the strongest signal (an SSN hit is near-certain) and the cheapest query (indexed equality in D1). Normalization-before-hash is frozen at the crypto layer (strip SSN formatting, etc.). DOB is low-entropy → matched via compound index (DOB+surname) or decrypt-and-compare on the small candidate set a name/identifier match already returned, never a standalone DOB blind index (per the crypto research).

### C.2 Plaintext names — phonetic + n-gram blocking

Names are deliberately **not** encrypted, precisely so fuzzy matching works. Two complementary blocking keys, both **precomputed at write time and indexed**:

- **Phonetic codes.** Encode every name to a phonetic key and block on key equality. Algorithm findings: **Soundex is too crude** (8+ distinct surnames collide per code). **Double Metaphone** is the pragmatic default — wider pronunciation rules, multi-origin (Slavic/Germanic/Celtic/Greek/Romance/Chinese), returns primary + secondary codes. **Beider-Morse (BMPM)** is materially better for *personal surnames* (built to cut false positives across name origins; ~15× more granular than Soundex) and is the right engine for the white paper's "over-inclusive (phonetic)" strictness setting. Recommendation: **Double Metaphone as the balanced default, Beider-Morse as the over-inclusive surname option** — which is exactly the configurable-strictness knob the white paper already specifies.
- **Character n-grams (trigrams)** for substring / typo / transposition recall that phonetics miss (e.g. embedded typos, partial org names).

Every searchable name string gets both keys: structured person names, **aliases/AKAs/maiden/former names**, and org **legal name + DBAs/trade names + former names**. Name-change history must be **queryable name rows**, not audit-log text (§F seam).

## D. Comparison & scoring — Fellegi-Sunter

The **Fellegi-Sunter** model is the foundational, defensible framework: for each compared field it estimates an agreement weight (`m`/`u` probabilities — how often a field agrees among true matches vs. by chance) and sums them into a match score; it is provably optimal under conditional independence and is what Splink/RecordLinkage implement. Applied here:

- **Per-field comparators** over each candidate: Jaro-Winkler or Levenshtein on name parts (Jaro-Winkler favors common-prefix agreement, good for names), exact on identifiers, date proximity on DOB, edge-type weight on graph-derived relationships.
- **Combine** into a weighted score; **map to severity bands** (e.g. *definite / probable / possible*). The white paper's "configurable matching strictness" is exactly the **threshold between bands** — balanced default, looser thresholds (and Beider-Morse + alias inclusion) for over-inclusive.
- **Match explanation is mandatory** (defensibility): each hit records *which fields matched, with what similarity, and the graph path* that connected it — the reviewer needs the "why," and the log needs it (§G).

A full probabilistic-trained FS model can come later; a transparent weighted-score version is defensible and explainable from day one and is the recommended starting point (reviewers and bar auditors must understand the score).

## E. Graph expansion — the related-party search

The dangerous conflicts are relational, so candidate generation **starts from the matter's parties and expands along Directory edges** before name/identifier matching:

- **Affiliations** → an org's principals/officers/registered agent (adverse "ABC Holdings" → check its principals against all clients).
- **Relationships** → spouse/family (person), and **parent/subsidiary/successor/affiliate** (corporate families — a merger or rename must still match).
- **Representation + role-links** → every party in every matter firm-wide (imputation), across all Locations.
- **Firm personnel** → the firm's own lawyers/staff and their **prior-firm employment history** (lateral imputation, Rule 1.10).

Traversal **depth is configurable** (the white paper's "search depth"): 1-hop adverse-to-principals and corporate-family closure as the default, deeper on request. Each expanded entity is then matched (C/D), and every surfaced hit carries the **connecting path** as its explanation.

## F. Architecture on the stack — and what slice 1·3 must seam now

### Platform feasibility

- **D1 (SQLite) is viable for candidate generation.** FTS5 with the **trigram tokenizer is built-in and tested on Cloudflare D1** (substring matching via triggers that sync the FTS index). **spellfix1 (edit-distance) is a loadable extension and almost certainly unavailable on D1** — so do **not** rely on it; instead **precompute phonetic-code columns** (Double Metaphone / Beider-Morse) in the domain layer at write time and block on indexed equality. This is the key feasibility finding: phonetic blocking needs no extension, just computed indexed columns (the same write-time-derivation pattern as the blind index, but over plaintext).
- **Scoring runs in code, not SQL.** Jaro-Winkler/Levenshtein/FS scoring over the candidate set belongs in the **shared Rust doc/discovery core** (already in the stack) — compiled to **WASM for the Worker** and native for Containers — which can host the phonetic encoders, edit-distance comparators, and the FS scorer in one place. Identifier equality stays in D1.
- **Tantivy (already in the stack for Discovery) is the alternative / scale-path index** — fuzzy term queries + n-gram + phonetic token filters in a Container — if the D1-native path proves insufficient at firm scale. Recommendation: **start D1-native (FTS5 trigram + precomputed phonetic columns + WASM scoring); reserve Tantivy** as the scale path, measured against the load-profile harness (golden rule 10). The optional **document-content depth** scan naturally rides the Discovery/Tantivy index.

### The slice 1·3 seams (build-when-in-the-area — cheap now, expensive to retrofit)

The engine is Phase 4, but the Directory build is **slice 1·3 (imminent)**, and several things are far cheaper to build into the Directory than to retrofit:

1. **Phonetic-code columns on every name** (person structured names, aliases/former, org legal/DBA/former), computed at write time and indexed. Retrofitting means recomputing codes over the entire Directory — do it in-area.
2. **Name history as first-class, queryable name rows** (with phonetic codes + temporal validity), not buried in the audit log — because conflicts must *match* former names, not just display them.
3. **The blind-index identifier channel wired onto Directory identifiers** (from slice 1·2): SSN/EIN/DL carry their blind index so the exact channel exists the moment Conflicts is built.
4. **The graph edge types Conflicts traverses** — ensure corporate **successor/parent/subsidiary**, spouse/family, and **principal-of-org** edges exist in the 1·3 edge model (it builds edges anyway; make sure these are among them).
5. **Firm-personnel employment history** (prior firms) — the lateral/imputed-conflict dimension (Rule 1.10) is easy to miss; if Directory models the firm's own people, capture prior-firm affiliations now.
6. **The candidate-generation index shape** (an FTS5 trigram table over the searchable-name set, kept in sync by triggers) — reserve it as the Directory's search substrate.

These are the actionable output for the imminent 1·3 design; the scoring/adjudication engine and the log are Phase 4.

## G. The immutable conflicts log — defensibility

The log is the compliance artifact (Rule 1.10(e)) and the malpractice defense, so its content is a spec, not an afterthought. Practitioner/ABA guidance says record the search **inputs, results, and decisions** in a secure, searchable, durable system. Concretely, each conflicts run records, **append-only and matter-tied** (the same immutability discipline as the Phase 0 ledger):

- **Who** ran it and **when** (timestamped), at which **trigger** (preliminary pre-consult / comprehensive pre-engagement / new-party / periodic re-scan).
- **Inputs searched** — the party set including aliases/DBAs/former names and the graph-expanded related parties; the identifiers searched (by reference, never plaintext SSN in the log).
- **Settings** — the strictness band and search depth in force (so a later auditor knows what was and wasn't searched).
- **Results** — the full candidate set surfaced, each with its **score, the fields that matched, and the connecting graph path** (the explanation).
- **Disposition** — per hit: cleared / waiver obtained / ethical wall erected / representation declined — with reviewer identity and rationale.

Triggers follow the standard cadence: a **preliminary** check before the initial consultation, a **comprehensive** check after consult and before accepting, and a re-check on **every new party** — matching the white paper's trigger list. Ethical walls are deferred (white paper), but the log records the clearance outcome regardless.

## H. Consolidated open decisions

**For slice 1·3 (Directory — now):**
1. Adopt the six seams in §F (phonetic-code columns, queryable name-history rows, blind-index identifier wiring, the conflict-relevant edge types, firm-personnel prior-firm history, the FTS5 trigram search substrate).
2. Phonetic encoder choice to precompute: Double Metaphone (default) and whether to also store Beider-Morse now for the over-inclusive setting (storing both is cheap; recompute later is not).

**For Phase 4 (Conflicts engine — later):**
3. Scoring model: transparent weighted-score (recommended start, explainable) vs. trained Fellegi-Sunter; the per-field comparators and the severity-band thresholds behind the strictness setting.
4. Graph-expansion default depth and the edge types included by default.
5. D1-native vs. Tantivy-container for matching at scale (measure first; D1-native recommended start).
6. The immutable conflicts-log schema (§G) and its append-only enforcement.
7. The reviewer adjudication UX (how hits are surfaced, explained, and dispositioned).

---

## Sources

- [Record linkage — Wikipedia (pipeline, Fellegi-Sunter)](https://en.wikipedia.org/wiki/Record_linkage)
- [WTF is the Fellegi–Sunter Model? A Practical Guide to Record Matching](https://horkan.com/2026/01/05/wtf-is-the-fellegi-sunter-model-a-practical-guide-to-record-matching-in-an-uncertain-world)
- [Splink — fuzzy matching / deduplication at scale (Robin Linacre)](https://www.robinlinacre.com/introducing_splink/)
- [Phonetic Matching: A Better Soundex (Beider-Morse, steve morse)](https://stevemorse.org/phonetics/bmpm2.htm)
- [Babel Street — Fuzzy Name Matching Techniques](https://www.babelstreet.com/blog/fuzzy-name-matching-techniques)
- [Performance Evaluation of Phonetic Matching Algorithms (SciTePress)](https://www.scitepress.org/papers/2016/59263/59263.pdf)
- [SQLite FTS5 Extension (trigram tokenizer)](https://sqlite.org/fts5.html)
- [Trigram FTS5 on Cloudflare D1 (worked example)](https://leaves.chiba.dev/posts/246)
- [ABA Model Rule 1.7 — Conflict of Interest: Current Clients](https://www.americanbar.org/groups/professional_responsibility/publications/model_rules_of_professional_conduct/rule_1_7_conflict_of_interest_current_clients/comment_on_rule_1_7/)
- [ABA Model Rule 1.10 — Imputation of Conflicts of Interest](https://www.americanbar.org/groups/professional_responsibility/publications/model_rules_of_professional_conduct/rule_1_10_imputation_of_conflicts_of_interest_general_rule/)
- [Checking for Conflicts: A Nuts-and-Bolts Guide (ABA GPSolo)](https://www.americanbar.org/groups/gpsolo/resources/magazine/archive/checking-conflicts-nuts-and-bolts-guide/)
- [Identifying and Resolving Conflicts of Interest: Three Simple Rules (Hinshaw)](https://www.hinshawlaw.com/en/insights/lawyers-lawyer-newsletter/identifying-and-resolving-conflicts-of-interest-three-simple-rules)
