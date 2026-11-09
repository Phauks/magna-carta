# Slice 4·1 — Conflicts Matching Engine (design)

**Date:** 2026-07-09
**Status:** Design — accepted, pending implementation plan
**Requirements:** ADR-0013 (firm-wide scope, configurable strictness/depth, immutable log)
**Research input:** [`docs/research/conflicts-matching-engine.md`](../research/conflicts-matching-engine.md)
**Builds on:** ADR-0085 / ADR-0086 (Directory model + conflicts seams), ADR-0084 (protected fields), ADR-0087 (custom fields)
**Supersedes within its scope:** research §D (the Fellegi-Sunter scorer) — see _Divergence from the research_ below.

## Purpose

Turn the shipped Directory conflicts corpus into a conflicts check: a firm-wide, recall-biased search over parties, related parties, and the firm's own people, producing an append-only, defensible record of what was searched, what surfaced, and how a human disposed of it.

Reviewer UX is out of scope. The engine, the settings, the log, and the disposition write-path are in scope, so the subsystem is exercisable end-to-end through the API and a later UI slice is pure presentation.

## What already exists

The recall side is built and shipped in slice 1·3. This slice consumes it rather than reimplementing it.

- `findDuplicateCandidates` (`packages/directory/src/search.ts:412`) runs three blocking channels in parallel — phonetic (Double Metaphone), FTS5 trigram, blind-index identifier — unions them, and resolves merged-away subordinates to their surviving master. It is written as the conflicts corpus and documented as such.
- `directory_name` holds every name, current and former, as a queryable row with temporal validity; `directory_name_phonetic_code` carries scheme-keyed phonetic codes computed on every name write and enforced by the `everyNameHasPhoneticCodes` fitness probe.
- `directory_edge` carries the conflict-relevant edge types: affiliation / principal-of-org, spouse and family relationship, corporate parent / subsidiary / successor, representation, role-assignment.
- `directory_identifier` carries protected identifiers with blind indexes: SSN, EIN, driver's licence, account number. DOB and SSN-last-four are protected but never standalone-indexed.
- `matter_party` bridges a directory entity to a matter in a role, firm-wide across all Locations.

Nothing in this slice changes the Directory package's write path.

## The central decision: no scorer

**Every candidate the blocking channels surface is shown. Nothing is filtered, ranked, or suppressed by a numeric score.**

The research doc proposed a Fellegi-Sunter weighted scorer with severity bands and strictness-as-threshold (§D). This design rejects that, for three reasons.

**A threshold converts missed conflicts into invisible ones.** The research doc's own framing is that the engine must be recall-biased because "a missed conflict is a malpractice event; a false positive is a few seconds of reviewer time." A score with a cutoff is precisely a mechanism for discarding true matches below the bar.

**A score is harder to defend than the evidence behind it.** A conflicts check is a compliance artifact under Rule 1.10(e). "We surfaced everything that matched, ordered by what it matched on" is a defensible sentence. "We computed 0.73 against a 0.70 cutoff" invites the question of who chose 0.70.

**A conflicts check does not decide.** It surfaces candidates for an attorney or clerk to adjudicate. The score's only honest job was ordering, and ordering does not require probability.

Nothing accepted is contradicted. ADR-0013 specifies "firm-wide, configurable strictness/depth, immutable log" — no score, no bands. Fellegi-Sunter appears only in the research doc, which declares itself "input to two design cycles — not a design itself," and in the white paper's _Needs development_ callout, which is the open question rather than a decision.

### What replaces it: evidence tiers

Each hit is ranked by a deterministic ordinal derived from **what kind of thing matched** — not how probable the match is:

| Tier | Evidence                                                                               |
| ---- | -------------------------------------------------------------------------------------- |
| 1    | Exact identifier — SSN, EIN, driver's licence, account number, by blind-index equality |
| 2    | Exact normalized name — after the frozen normalization in `normalize-name.ts`          |
| 3    | Phonetic code match — Double Metaphone                                                 |
| 4    | Trigram overlap only                                                                   |

Orthogonally, each hit records **how the entity was reached**: directly, or through a graph path, with the edges traversed. A spouse-of hit on an exact SSN is a different object from a trigram hit on a direct party, and the reviewer sees both facts.

Tiers order the reviewer's queue and group the display. They never remove a hit. Volume is handled by grouping and counts — "3 hits at tier 1–2; 287 at tier 3–4" — with the weak tier expandable on demand. If real firm volumes prove painful, that is measured against the load-profile harness before any suppression is considered (golden rule 10).

### What strictness becomes

Strictness stops being a threshold and becomes a **recall knob**: which channels run, and which name rows they see.

- **Balanced** (default) — primary Double Metaphone, trigram, blind-index identifiers; current names only.
- **Over-inclusive** — adds the secondary Double Metaphone code, alias / maiden / former-name rows, and a lower trigram bar.

Strictness dials recall up, never precision by exclusion. This reads the white paper's "over-inclusive (fuzzy/phonetic/alias) available to enable" literally.

**Stated limitation.** Beider-Morse is not in this slice. Until it lands, the over-inclusive band is delivered by threshold-loosening, secondary codes, and alias inclusion, without Beider-Morse's cross-origin surname handling. The seam is already paid for: `directory_name_phonetic_code.scheme` has an open `length > 0` CHECK (ADR-0085), so adding a scheme is additive rows plus a backfill sweep, with no migration and no schema change.

## The source registry

What a check searches is a typed registry of **sources**, not a flat depth number. The four classes differ in _how they match_, not only in _what they search_.

| Class          | Searches                                                                                                           | Match mode                                                      | This slice              |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ----------------------- |
| **Party**      | Directory entities (names, aliases, former names, identifiers); `matter_party` role-links firm-wide, all Locations | Similarity — phonetic, trigram, blind-index                     | Built. Always on        |
| **Graph**      | `directory_edge`: principal-of-org, spouse/family, corporate parent/subsidiary/successor                           | Identity traversal, then Party matching on each expanded entity | Built. Toggle + depth   |
| **Imputation** | `member` ↔ `directory_person.member_id` ↔ `matter_party` / `directory_edge`                                        | **Identity only. Never name similarity**                        | Built. Toggle           |
| **Content**    | Email participants; email and document text                                                                        | Exact address equality / unstructured mention                   | Registered, unavailable |

### Why Imputation matches by identity, never by name

Firm personnel are not Directory entities (ADR-0085). `member` carries a flat `display_name` string (`per-firm-schema.ts:118`) with no `directory_name` row, no phonetic code, and no FTS entry — they are structurally invisible to the similarity channels.

That is the correct answer, not a gap. A partner sharing a surname with a client is not a conflict; a firm named "Smith Law" and a client named Smith produce a hit on every check, forever, and the hit means nothing. The real question — _is one of our own people a party to, or related to, a party in, some matter?_ — is an identity question, resolved by join: `member.user_id` → `directory_person.member_id` (nullable, `per-firm-schema.ts:944`) → `matter_party` / `directory_edge`. Exact, no fuzz, no noise.

ADR-0085 already supplies the escape hatch for the case that matters: "a lawyer who is genuinely a party is an ordinary entity (optional `member_id` link)." When a partner is actually adverse, they exist as a `directory_person` with names and phonetic codes and are matched by the **Party** class like anyone else.

This resolves the firm-personnel question ADR-0085 reserved for this design cycle: **personnel become a source, not a node type.** No personnel entities, no third identity to reconcile — exactly the outcome ADR-0085 preferred, now with a consumer.

### Prior-firm lateral history

Registered as an Imputation source; **the table is not built.** ADR-0085 called the data "self-reported, unreliable, no consumer until the engine exists." There is a consumer now, but with capture UX deferred nothing would populate it. Registering it means every log entry honestly records `prior-firm history: no data` rather than silently omitting a Rule 1.10 dimension.

### The floor

User-selectable scope introduces a failure mode: **a narrowed scope manufactures a clean check.** A reviewer under time pressure unchecks the Graph class, gets a clean result, and the log faithfully records a clean result.

Therefore: **firm policy sets a mandatory floor. A per-run selection may only add sources above the floor, never subtract below it.** The Party class is always in the floor and is not toggleable — that is ADR-0013's firm-wide requirement. Every run writes its scope in force verbatim into the log, so an auditor knows exactly what was and was not searched.

### Content class seam constraint

When the Content class lands, two distinctions hold, and one gotcha applies.

**Email participants are structured, not content.** `crates/email-core/src/model.rs` parses `from`/`to`/`cc`/`bcc` into typed `Address` values; an address probes `directory_email` by exact equality, like the blind-index channel. **Email bodies and document text are unstructured**; a name in a document is a _mention_, not a party — it cannot be scored by field comparators, and it never reaches tier 1–2 nor auto-clears anything.

**The email-participant channel must exclude the firm's own domains.** `john.smith@smithlaw.com` is not a conflict signal, and without the exclusion every internal email matches.

Neither is available today: `email-core` is parse-only and is imported nowhere outside `crates/`, and no document-text indexing exists.

## Architecture

A new `@magna-carta/conflicts` package, following the Directory pattern exactly: validates in memory, composes statements into `composeEffectBatch`, holds no D1 binding, performs no I/O of its own. It reads the corpus through the Directory package's existing readers rather than reimplementing blocking.

**The Directory write path is untouched; its read path takes two additive changes.** `findDuplicateCandidates` returns only `{entityId, signalCount}`, so evidence tiering cannot tell which channel matched — channel provenance must travel with each candidate. And its phonetic channel applies no scheme filter while neither name channel filters `is_current`, so both Double Metaphone schemes and every alias/former name are _already_ always searched. Balanced strictness therefore cannot be layered on top of the current signature; it needs a scheme filter and a name-role filter that do not exist. Both are added as optional parameters, so omitting them preserves today's behaviour exactly and the merge and entry-time-duplicate callers are unaffected.

```
apps/worker/src/routes/directory/conflicts.ts    owns env, actor, crypto context (mirrors routes/directory/directory.ts)
  └── packages/conflicts/
        ├── run-check.ts       orchestration: resolve scope → expand graph → match → tier → compose log batch
        ├── sources.ts         the typed source registry + floor resolution
        ├── expansion.ts       Graph class: edge traversal to depth, cycle-safe
        ├── imputation.ts      Imputation class: identity joins, no similarity
        ├── evidence.ts        tier assignment + explanation construction
        ├── disposition.ts     append-only adjudication writes
        ├── settings.ts        firm strictness / depth / floor policy
        ├── statements.ts      SQL statement builders for the atomic batch
        └── fitness.ts         invariant probes
```

Comparators (exact-identifier, exact-normalized-name, phonetic, trigram) run in TypeScript over the bounded candidate set that blocking already produced. **Perf is not a reason to reach for Rust here**: blocking bounds the set to hundreds of entities, and comparison across a few name fields is sub-millisecond. The only genuine Rust candidate is Beider-Morse, which is a _write-time_ concern — phonetic codes are precomputed on every `directory_name` insert — and therefore belongs to a separate, self-contained decision with its own backfill, not to the scorer's home.

**H.5 (D1-native vs Tantivy) needs no decision.** `findDuplicateCandidates` is D1-native and shipped. Tantivy remains the reserved scale path, measured against the load harness before adoption. The optional document-content depth scan will ride the Discovery/Tantivy index when the Content class lands.

## Data flow

A check takes a matter (or a prospective party set, for the pre-consult trigger) plus a scope selection.

1. **Resolve scope** — union the requested selection with the firm floor. A selection below the floor is raised to it, and the raise is recorded.
2. **Expand** — from each subject party, traverse `directory_edge` to the configured depth, cycle-safe, collecting the connecting path for each reached entity. Depth default: one hop, plus corporate-family closure (parent / subsidiary / successor traversed transitively, since a rename or merger must still match).
3. **Match** — run the Party class over every entity in the expanded set via `findDuplicateCandidates`, at the strictness in force.
4. **Impute** — run the Imputation joins if the class is in scope.
5. **Tier** — assign each hit its evidence tier and construct its explanation: which fields matched, and the connecting graph path.
6. **Log** — compose one atomic batch writing the run row, every hit row, and the audit row.

Dispositions arrive later, through their own route, and never update the run or hit rows.

## Storage

Three tables, per-firm.

**`conflicts_check`** — the run. Who ran it, when, the trigger (`preliminary` / `comprehensive` / `new_party` / `periodic_rescan`), the subject matter or party set, the **scope in force** and **strictness** and **depth** as recorded values, and the inputs searched. Identifiers are recorded **by reference** (`directory_identifier.id`), never as plaintext — no SSN ever enters the log.

**`conflicts_hit`** — one row per surfaced candidate. The resolved entity, its evidence tier, the fields that matched, the connecting graph path, and the source class that surfaced it. Never deleted, never rescored.

**`conflicts_disposition`** — append-only adjudications: `cleared` / `waiver_obtained` / `wall_erected` / `representation_declined`, with reviewer identity, rationale, and timestamp.

### Why dispositions are a table, not a column on the hit

A column would be updated in place, destroying the prior value. The log is the malpractice defense; a reviewer who clears a hit and later reverses must leave both acts visible. An append-only table makes the reversal a second row, and the hit's current disposition is the latest row — reconstructible, never overwritten. This is the same immutability discipline as the Phase 0 ledger.

Ethical walls remain deferred (white paper). `wall_erected` is a recordable _outcome_, not a wall implementation — nothing enforces access restriction in this slice.

### Append-only enforcement

No `UPDATE` and no `DELETE` ever targets `conflicts_check`, `conflicts_hit`, or `conflicts_disposition`. Enforced by SQLite triggers that raise on update and delete, and by a fitness probe (`assertConflictsFitness`) proving the triggers exist and that no statement builder in the package emits an update or delete against these tables.

## Error handling

- A check against a matter with no parties returns an empty run with its scope recorded, not an error. An empty search is a fact worth logging.
- A graph expansion that hits a cycle terminates at the visited set; the path recorded is the first path found to that entity.
- A non-indexable identifier type (`dob`, `ssn_last_four`) is skipped by the blind-index channel and **recorded as skipped in the run's inputs**, so the log never implies it was searched.
- If a source in the resolved scope cannot run (prior-firm history, with no table), the run records the source as `unavailable`, not as `searched and clean`. This distinction is the whole point of recording scope.
- Idempotency threads through every write route, following the Directory pattern: a same-key retry returns the committed run without re-executing the batch.

## Testing

- **Evidence tiering** — an exact-identifier hit outranks an exact-name hit outranks a phonetic hit outranks a trigram hit, for the same entity reached the same way.
- **No suppression** — a deliberately weak trigram-only match still appears in the result set at every strictness setting.
- **Strictness is recall-only** — the over-inclusive set is a strict superset of the balanced set, for the same corpus. This is the invariant that guarantees strictness never hides a hit.
- **The floor holds** — a run requesting a scope below the firm floor is raised to the floor, and the log records the raise.
- **Imputation never fuzzes** — a `member` whose `display_name` is phonetically identical to a party surname produces no imputation hit; only a `member_id`-linked entity on a `matter_party` row does. This is the "Smith Law" regression test.
- **Merged aliases still surface** — a conflict on an entity's merged-away former name surfaces the surviving master, exercising the merge-resolution path in `findDuplicateCandidates`.
- **Append-only** — an `UPDATE` or `DELETE` against any of the three tables raises; the fitness probe proves the triggers exist.
- **No plaintext identifiers in the log** — a run whose inputs include an SSN stores only the `directory_identifier` reference; the probe scans the run row for digit sequences.
- **Idempotent replay** — a repeated check with the same idempotency key writes exactly one run.

## Triggers

API routes only. `trigger` is a required parameter on the check request; nothing auto-fires.

Auto-firing on party-add would couple the Directory write path to the conflicts engine and require a queue consumer. The periodic re-scan has nobody to notify while reviewer UX is deferred. Both are additive once a UI exists to receive them — the log already records which trigger fired, so neither is a retrofit.

## Deferred, with reasons

| Deferred                          | Why                                                                            | Flip condition                                  |
| --------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------- |
| Reviewer adjudication UX          | Owner deferred                                                                 | The design-system app shell                     |
| Beider-Morse                      | Write-time concern with its own backfill; over-inclusive band ships without it | A measured recall gap on cross-origin surnames  |
| Rust/WASM scorer core             | No perf reason; blocking bounds the candidate set                              | A measured hot path, per golden rule 10         |
| Content class (email, documents)  | `email-core` is unwired; no document-text index exists                         | Discovery / Tantivy, and the email capture path |
| Prior-firm lateral table          | Nothing populates it with capture UX deferred                                  | A personnel-history capture surface             |
| Auto-fire triggers + Cron re-scan | No reviewer to notify                                                          | Reviewer UX                                     |
| Ethical wall enforcement          | Deferred by the white paper                                                    | A concrete use case                             |

## Divergence from the research

This design departs from [`docs/research/conflicts-matching-engine.md`](../research/conflicts-matching-engine.md) §D, which proposed a Fellegi-Sunter weighted score with severity bands, and from the white paper's _Needs development_ phrasing of "strictness/score thresholds." Both are superseded within this slice by evidence tiering and strictness-as-recall. The research doc's other findings — recall bias, mandatory match explanation, graph-aware matching, the two-channel blocking design, the D1 feasibility analysis, and the log's required contents — are adopted in full.

The divergence is recorded as an ADR rather than made silently.
