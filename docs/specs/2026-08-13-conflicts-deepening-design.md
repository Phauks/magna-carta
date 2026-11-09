# Conflicts 4·1 deepening — trigger coverage and search depth (design)

**Date:** 2026-08-13
**Status:** Design — proposed, twelve owner flags open (see _Flagged for the owner_)
**Scope answer:** the owner scoped this work as **both gaps** — trigger coverage and search depth
(recorded as queue-when-time scope item 112 in
[`docs/active-work/claude/passive-dev-orchestrator-m7f9jw.md`](../active-work/claude/passive-dev-orchestrator-m7f9jw.md)).
**Deepens:** [`2026-07-09-slice-4-1-conflicts-design.md`](2026-07-09-slice-4-1-conflicts-design.md) (ADR-0192)
**Requirements:** ADR-0013 (firm-wide scope, configurable strictness/depth, immutable log)
**Builds on:** ADR-0085 / ADR-0086 (Directory model, conflicts seams, merge), ADR-0084 (protected
fields, blind index), ADR-0064 (transactional outbox), ADR-0050 (cron fan-out), ADR-0059
(notifications registry), ADR-0039 (off the hot path)
**Research input:** [`docs/research/conflicts-matching-engine.md`](../research/conflicts-matching-engine.md)
**Plan:** [`2026-08-13-conflicts-deepening-implementation-plan.md`](2026-08-13-conflicts-deepening-implementation-plan.md)

---

## 1. What this is, and the sentence the whole design turns on

Slice 4·1 built a conflicts engine that is correct and defensible in what it does, and deliberately
narrow in when it does it and how far it looks. It fires only when a human calls the route, and it
reaches one hop into the Directory graph over a name-matching layer that misses `Smith and Jones,
L.L.P.` when the corpus holds `Smith & Jones LLP`. Both narrowings were recorded honestly as deferred
work with named flip conditions. This design deepens them.

Everything below is subordinate to one sentence:

> **A conflicts check that reports nothing is worse than no check at all, because the firm relies on
> it.**

That is not a slogan. It is the tie-breaker for every trade in this document. Where recall costs
reviewer seconds, recall wins. Where a bound must exist (and bounds must exist — an unbounded
traversal over a large Directory is a real availability problem), the bound is **recorded on the
record and surfaced to the reader**, never applied silently. Where the platform could infer that an
earlier human conclusion still holds, it does not infer it; it makes re-affirming cheap and puts a
live person's name on the affirmation.

And its corollary, which shapes the vocabulary of the whole surface:

> **The platform must not assert that a matter is conflict-free.** It reports what it searched, what
> it found, and what it could not search. The conclusion is a lawyer's, and the record says whose.

Section 2 makes that a mechanism rather than a style guide. Sections 3 and 4 answer the two gaps.
Section 5 answers uncertainty. Section 6 says where the work runs. Section 7 lists what is
deliberately not decided here.

---

## 2. The reporting posture

### 2.1 What is wrong with "clear"

The shipped surface already avoids the worst of this — there is no boolean anywhere in
`conflicts_check`, and `resolveScope` records a floor raise so an auditor sees a narrowed request was
refused. But the read side has no shape of its own: a caller reads a check and its hits and forms its
own conclusion, and the first UI to render "0 hits" as a green tick will have made the platform say
something no one designed it to say.

The failure is specific and legal, not aesthetic. A firm that reports "conflict-free" and is later
served a disqualification motion has to defend the sentence. A firm that reports "we searched the
party corpus at over-inclusive strictness, traversed 43 related entities to a one-hop budget, could
not search document content because no corpus exists, and nothing surfaced" is defending a procedure,
which is exactly what Rule 1.10(e) asks for.

### 2.2 The matter conflicts posture — a derived read, never a stored verdict

One new read model, `readMatterConflictsPosture(matterId)`, is the only sanctioned way to ask "where
does this matter stand on conflicts". It is computed at read time from rows, holds no state of its
own, and returns:

| Field                | Meaning                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `latestCheck`        | id, `created_at`, trigger, actor (or `null` for an automated run), and the **scope in force verbatim**                     |
| `scopeShortfall`     | The sources, strictness, depth, and channel set the **current firm policy** requires that the latest check did **not** run |
| `pendingRecheck`     | Open re-check requests for this matter, each naming the corpus change that caused it                                       |
| `undisposedByTier`   | Counts of hits with no disposition, by evidence tier                                                                       |
| `dispositionsByKind` | Counts by disposition kind, each naming its reviewer                                                                       |
| `unavailableSources` | Every source in scope that recorded `unavailable`, with its reason                                                         |
| `neverChecked`       | `true` when the matter has no `conflicts_check` at all — a distinct state from "checked and nothing surfaced"              |

There is deliberately **no** `clear`, `passed`, `ok`, `status`, or `severity` field. There is no
aggregate. A caller that wants a single word has to write it itself, and the design system's rendering
of this shape (slice 5) is a statement of fact with an unanswered-count, never a badge.

`scopeShortfall` and `pendingRecheck` are the two fields that make staleness honest. Both are derived
— compared against the live `conflicts.policy` row and the live re-check ledger at read time. This
follows the posture `packages/calendar/src/overdue.ts` already holds for an overdue deadline and
`readDormantTrustBalances` holds for a dormant trust balance: **the platform computes the comparison
and reports it; it never writes a judgement onto a record and lets it rot.**

### 2.3 What a zero-hit check says

A check that surfaces nothing produces a report, not an absence:

> Searched on 13 August 2026 by A. Attorney, trigger `comprehensive`.
> Party — similarity, over-inclusive strictness, 4 subject parties, 41 name rows compared.
> Graph — 43 entities reached, one-hop budget on control/family edges, corporate family traversed
> transitively (12 entities, cap 500 not reached).
> Imputation — identity join over 9 firm members.
> **Not searched:** content (no corpus exists), prior-firm history (no data recorded).
> **Nothing surfaced.**

The last line is the only conclusion the platform draws, and it is a statement about the search, not
about the matter.

### 2.4 Enforced, not asked for

Vocabulary discipline that lives in a convention document decays. This one becomes a source-scan
fitness function, `pnpm run lint:conflicts-vocabulary`, modelled directly on the shipped
`tooling/lint-custodian-vocabulary.mjs`. It scans `packages/conflicts/`, `apps/worker/src/routes/directory/conflicts.ts`,
the conflicts OpenAPI descriptions, the conflicts surfaces of `apps/web`, and `docs/user/` for
assertion vocabulary — `conflict-free`, `no conflicts`, `clear of conflicts`, `conflicts cleared`
(as a property of a matter rather than of a hit), `check passed`, `all clear` — and fails the build.
It also fails a response schema that introduces a boolean field whose name matches `/clear|clean|ok|passed|conflictFree/i`.

The one place `cleared` remains legitimate is `DISPOSITION_KINDS`, where it names **a human's
conclusion about one hit** and always carries that human's identity and rationale. The lint
allowlists it there and nowhere else.

---

## 3. Gap one — trigger coverage

### 3.1 The problem, stated precisely

A conflicts check is a photograph of two things that both move: the matter's party set, and the
firm's corpus. Slice 4·1 fires only when a person asks, so every check is a photograph nobody retakes.
Four ways a matter that was checked honestly becomes a matter whose check is wrong:

- a party is added to an existing matter, months later;
- two Directory records that were separately clean are **merged**, and the union is not clean;
- a corporate parent, a spouse, or a principal-of link is **recorded later** than the check;
- an SSN or EIN is entered later, making a tier-1 identifier match possible that was invisible before.

None of these is exotic. The merge case in particular is the one the whole Directory duplicate-handling
design (ADR-0086) exists to produce.

### 3.2 The mechanism: outbox topic → queue → re-check ledger → check

Every trigger below uses one path, and no part of it runs in a request handler.

```
write path (party add / merge / edge / identifier / rename / member)
  └─ commits its business batch + ONE outbox row, atomically          <- +1 INSERT on the hot path
       └─ the existing cron outbox relay publishes to the per-firm Queue
            └─ the recheck-request consumer resolves the AFFECTED MATTER SET (one bounded query)
                 └─ writes conflicts_recheck_request rows              <- durable, visible, coalescing
                      └─ the recheck-run consumer drains them with a budget, one matter per message
                           └─ runConflictsCheck(...) writes the ordinary append-only log rows
                                └─ notifications emits conflicts.hit.surfaced when tier 1-2 lands
       └─ the cron sweep drains anything the queue did not, per firm (ADR-0050 fan-out)
```

The **re-check ledger** (`conflicts_recheck_request`) is the load-bearing new object, and it exists
for three reasons that a direct queue-to-check path does not serve:

1. **A request is durable and visible before it is satisfied.** A matter whose corpus moved reads
   "a re-check is pending because entity X was merged on 12 August" from the moment the merge commits.
   The platform never sits on a known-stale answer silently, even for the seconds the queue takes.
2. **It coalesces without dropping.** A merge affecting forty matters, or an import creating two
   hundred edges, writes rows, and the drain runs **one check per matter** covering **all** the causes
   accumulated for it, listing each. Nothing is deduplicated away; several causes collapse into one
   check that names them all.
3. **It bounds the work honestly.** A drain that runs out of budget leaves rows pending. Pending is a
   visible state, so falling behind is a fact the firm can see, not a silent gap.

Ledger row shape: `matter_id`, `cause_topic`, `cause_reference` (the entity/edge/party handle),
`cause_occurred_at`, `requested_at`, `satisfied_by_check_id` (nullable), `satisfied_at` (nullable).
`UNIQUE (matter_id, cause_topic, cause_reference)` among unsatisfied rows makes a queue redelivery a
no-op. Rows are never deleted — a satisfied request is part of the procedure record ("the firm noticed
the merge and re-checked within four minutes"), which is exactly the evidence Rule 1.10(e) asks for
and which the check row alone cannot show.

### 3.3 The trigger list — what fires, and what happens on each

`CONFLICTS_TRIGGERS` widens from four values to the catalogue below. The `trigger` column is `text`
with a `length > 0` CHECK, so this is additive — no migration, no table rebuild on an append-only
table.

| #   | Event                                                      | Trigger recorded        | Subject of the check                      | Affected matters                                                                        | Why                                                                                                                                                                          |
| --- | ---------------------------------------------------------- | ----------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `matter.created` (prospective, with parties)               | `preliminary`           | The matter's parties at creation          | That matter                                                                             | The pre-consult screen. Fires only if the matter already carries a party; a bare shell has nothing to search                                                                 |
| 2   | `matter.opened` (prospective → open)                       | `comprehensive`         | Every live party                          | That matter                                                                             | The engagement moment. Rule 1.7/1.9 attaches when the firm accepts, and this is the one transition that means "we accepted"                                                  |
| 3   | `matter_party.linked`                                      | `new_party`             | The added entity (corpus stays firm-wide) | That matter                                                                             | The white paper's named trigger. Also covers a role change, which the model expresses as unlink-then-link                                                                    |
| 4   | `directory.entity.merged`                                  | `entity_merged`         | The surviving master                      | Every live matter where master **or** subordinate was a party                           | Two separately-clean records become one record whose union may not be. The highest-value trigger in the list                                                                 |
| 5   | `directory.entity.renamed`                                 | `entity_renamed`        | The renamed entity                        | Every live matter where it is a party, and every matter within budget                   | A new alias / maiden / former / DBA row makes matches possible that were not                                                                                                 |
| 6   | `directory.edge.created`                                   | `relationship_recorded` | Both endpoints                            | Live matters where either endpoint is a party, or is reached within budget from a party | The corporate parent discovered later; the spouse recorded later; the principal-of link added later                                                                          |
| 7   | `directory.identifier.added`                               | `identifier_recorded`   | The entity                                | Live matters where it is a party                                                        | An SSN or EIN entered later makes a tier-1 blind-index match possible where none could fire before                                                                           |
| 8   | `member.provisioned` / `directory_person.member_id` linked | `personnel_changed`     | Firm personnel (identity join only)       | Every open matter, drained over time                                                    | Rule 1.10 imputation. A lateral hire is the classic case — see flag F2, and note the check honestly records `prior_firm_history: unavailable`                                |
| 9   | Cron, firm-configurable cadence                            | `periodic_rescan`       | Every live party of every open matter     | Open matters, batched across invocations                                                | The backstop for everything above: a producer that was never wired, a matter that predates a trigger, a bug. A procedure with no backstop is a procedure that fails silently |
| 10  | API call                                                   | as supplied             | as supplied                               | as supplied                                                                             | The shipped path. Unchanged, still required to name its trigger                                                                                                              |

Each row's check is an **ordinary** `conflicts_check` — the same tables, the same append-only
triggers, the same scope resolution against the firm floor. Two additive nullable columns record the
provenance an automated run has and a manual one does not: `trigger_source`
(`manual` | `event` | `schedule`) and `cause_json` (the topics and references the run covers).
`actor_user_id` is already nullable, so an automated run leaves it null and the report reads "run
automatically because entity X was merged", never attributing the run to a person who did not make it.

### 3.4 What deliberately does **not** fire, and why

Stating the non-triggers is as much a part of the design as the triggers — an unstated non-trigger is
indistinguishable from an oversight.

- **`directory.entity.created` alone.** A new Directory entity cannot change any existing matter's
  answer until it is linked to a matter (row 3) or connected by an edge (row 6). Firing on entity
  creation would make a two-thousand-row contact import re-check the firm's entire open caseload for
  no possible new hit.
- **`matter_party` unlinked.** Removing a party cannot create a conflict. The removal is audited by
  the ordinary path; the prior check's hits stay on the record exactly as found, because what the firm
  knew at the time is the point.
- **A disposition being recorded.** Adjudication is downstream of a check and never causes one.
- **`matter.closed`.** A closed matter's parties remain in the corpus and remain findable by other
  matters' checks (Rule 1.9 is about former clients), but the closed matter itself is not re-checked.
  Its posture read continues to report its last check verbatim.
- **A conflicts policy change.** Raising the firm floor does not auto-fire a firm-wide re-scan — that
  would run every open matter at once on an administrative click. It instead makes `scopeShortfall`
  non-empty on every affected matter immediately, which is the honest report, and offers an explicit
  firm-wide re-scan the administrator triggers deliberately (flag F10).

### 3.5 Storm control that never drops

Three bounds, all recorded, none silent:

- **Per-event matter fan-out cap.** An event resolving to more than `maxMattersPerEvent` matters
  (firm-set) still writes **every** ledger row; it just does not attempt them in one queue
  invocation. The drain takes them over subsequent invocations and the cron backstop.
- **Per-invocation drain budget.** Wall-clock and row-count budgeted. Exceeding it leaves rows
  pending, which is a visible state.
- **No suppression by age or repetition.** A cause is never discarded because a similar one was seen
  recently. Coalescing collapses several causes into one check that lists them all; it never collapses
  a cause out of existence.

### 3.6 Notification

One new notification type in the shipped registry — `conflicts.hit.surfaced`, category `conflicts`
(already in `NOTIFICATION_CATEGORIES`), subject kind `conflictsCheck` (already in
`NOTIFICATION_SUBJECT_KINDS`), audience `capability-holders` on `conflicts:read`, matter-anchored,
`email: category-count`. It subscribes to the check-written outbox row like every other type — the
registry's rule is that a type subscribes and never produces.

It fires when an automated check surfaces an **undisposed** hit at tier 1 or 2, or when any hit
surfaces on a matter that previously had none. A manual check needs no notification: the person who
ran it is looking at the result. Escalation is `digest` by default because
`IMMEDIATE_ESCALATION_CATEGORIES` today admits only `trust` and `security` — whether conflicts joins
them is flag F8, and it is a real question: a day's delay on a tier-1 identifier match against a
matter the firm is about to accept is not obviously an inconvenience.

---

## 4. Gap two — search depth

Depth has two independent axes. Conflating them into one number is what the shipped `depth` integer
does, and it is why "configurable search depth" has never meant anything precise.

### 4.1 Axis one — matching depth (how a name is compared)

#### 4.1.1 What the shipped layer catches, and the hole

Shipped channels: exact identifier (HMAC blind index), exact `normalized_display`, Double Metaphone
(primary; secondary at over-inclusive), FTS5 trigram. `normalize-name.ts` performs NFC, case-fold,
diacritic and punctuation strip, and suffix/title parse — and it is **frozen**, because
`normalized_display` is stored at write time across the whole corpus and is load-bearing for merge,
entry-time duplicate detection, and tier-2 scoring.

Run the owner's example through it. `Smith & Jones LLP` normalizes to `smith jones llp`
(`&` is punctuation, stripped). `Smith and Jones, L.L.P.` normalizes to `smith and jones llp`. They do
not match at tier 2. Trigram overlap will probably surface the pair at tier 4 — buried under every
other `smith` in the corpus, which is precisely the "reports nothing useful" failure in a different
costume.

#### 4.1.2 A second key, additive, never a change to the frozen one

Add two derived columns beside `normalized_display` on `directory_name`, computed at write time by the
same discipline as the phonetic codes, and backfilled once over the corpus:

- **`normalized_matchkey`** — the frozen normalization, plus: `&` ↔ `and` unified to one token;
  legal-entity forms canonicalized to a single token each (`l.l.p.`/`llp`/`limited liability
  partnership` → `llp`; `inc`/`incorporated` → `inc`; `corp`/`corporation` → `corp`; `ltd`/`limited`,
  `plc`, `co`/`company`, `pc`, `pllc`, `lp`, `llc`); leading article `the` dropped; whitespace
  collapsed. The **legal form is preserved**, so only spelling is canonicalized. A match here is
  **tier 2**: `Smith & Jones LLP` and `Smith and Jones, L.L.P.` are the same name written two ways,
  and the engine should say so plainly.
- **`normalized_matchkey_bare`** — the above with the legal-entity form **removed** entirely. A match
  here is **tier 3**, because `Smith & Jones LLP` and `Smith & Jones LLC` may be one firm re-formed or
  two unrelated legal persons, and the engine's job is to surface the question rather than answer it.

Both are additive columns and additive blocking channels. `normalized_display` is untouched, so
nothing about merge, entry-time duplicate detection, or already-stored tier-2 semantics moves.

**Tiers are not widened.** `conflicts_hit.evidence_tier` carries `CHECK (evidence_tier BETWEEN 1 AND 4)`,
and widening a CHECK on a growing append-only table is a rebuild the additive-only migration lineage
forbids. The new signals map into the existing four and name themselves in `matched_fields_json`, which
is where a reviewer reads _what_ matched anyway.

#### 4.1.3 Beider-Morse, adopted rather than deferred

> **SUPERSEDED BY MEASUREMENT — slice 4 built this, measured it, and took it back out.** Two claims
> below are now known false and are corrected in place rather than deleted, because the reasoning that
> led to them is the reasoning somebody will repeat. **Read 4.1.3a before planning the follow-on.**

ADR-0192 registered Beider-Morse as a seam with the flip condition "a measured recall gap on
cross-origin surnames". This design adopts it now, and records why the flip condition is being met
by argument rather than by measurement: the gap is structural, not statistical. Double Metaphone is an
English-pronunciation encoder; Beider-Morse was built specifically to handle surnames across
origins and transliterations, which is the population a Nevada firm's Directory actually contains.
Waiting for a measured miss means waiting for a firm to miss a conflict, and measuring the miss
requires knowing the answer, which is the thing the engine exists to supply.

~~The seam is already paid for: `directory_name_phonetic_code.scheme` carries an open `length > 0`
CHECK (ADR-0085), so this is additive rows plus a one-time backfill sweep — no schema change, no
migration on the name table.~~ **FALSE — see 4.1.3a.** It runs at **over-inclusive strictness only**,
keeping the superset invariant intact by construction, and that part holds.

Beider-Morse is a write-time concern (codes are computed on every `directory_name` insert), which is
what makes it the one genuine Rust candidate in the subsystem — the encoder is materially heavier than
Double Metaphone and runs on every name write and once over the whole corpus during backfill.
~~The implementation plan builds it in TypeScript behind the existing `phonetics.ts` scheme seam and
names the Rust/WASM port as the measured follow-on, per golden rule 10.~~ **The TypeScript build was
attempted and does not run on this platform — see 4.1.3a. The Rust/WASM port is no longer the
follow-on optimization; it is the only way this channel ships.**

#### 4.1.3a What slice 4 measured, and why the channel is not built

**The recall claim above is correct and is now measured.** Over a thirty-pair corpus of real
cross-origin surname variants, Beider-Morse joins **seven pairs Double Metaphone structurally
cannot** — `Nowak`/`Novak`, `Kowalczyk`/`Kovalchik`, `Wojcik`/`Voychik`,
`Krzyzanowski`/`Kzhizhanovski`, `Dvorak`/`Dvorzhak`, `Kaczmarek`/`Kachmarek`,
`Wisniewski`/`Vishnevski`. Double Metaphone also joins pairs Beider-Morse does not, so the two are
complementary and the union is the point. Nothing about the case for the channel weakened.

**Correction 1 — the schema seam is not paid for.** `directory_name_phonetic_code.scheme` does carry
an open `length > 0` CHECK, but the table's PRIMARY KEY is `(name_id, scheme)`: it holds **at most one
code per name per scheme**. That fits Soundex (one code) and Double Metaphone (two codes under two
schemes) and nothing whose output is a variable set — Beider-Morse returns tens of phonemes for one
surname. Whenever the encoder lands it needs a table keyed by the **code**, not another `scheme` value.
Suffixing the scheme with an ordinal (`beider_morse_00`, `_01`) fits under the CHECK and was rejected:
the column would stop naming a scheme and `WHERE scheme = 'beider_morse'` would silently find nothing.
Changing the existing table's primary key is a full SQLite rebuild of a table that grows with every
name in every firm's Directory, which the additive-only migration lineage forbids.

**Correction 2 — a TypeScript encoder cannot run in a Worker request, and this is the blocker.** The
only maintained JavaScript implementation is `bmpm` (MIT, pure TypeScript, **zero runtime
dependencies**, so golden rule 14 was never triggered and no owner consent was required). It compiles
the whole Beider-Morse rule set — nineteen languages, both accuracy modes — into regular expressions at
**module load**. Node does that in **16 ms**. Inside workerd it takes **20,377 ms**, measured on the
first `POST /api/v1/directory/persons` with the channel wired to the write path. That is past the
Workers CPU limit; the request never completes. Three ways round it were tried or considered:

- **A lazy dynamic import** is worse, not better — Workers forbid runtime module loading and the
  request hangs instead of completing.
- **Moving the compile off the request path** fixes the write side (a cron sweep could fill phonemes)
  but not the read side: a check computes the **subject's** phonemes to probe with, and a manual check
  is a request.
- **Shipping the table empty** was refused on the same grounds as a half-built nickname catalogue — a
  table nothing writes and nothing queries is not a seam, it is clutter that reads like coverage.

**The flip condition is therefore a number, not a hope: an encoder whose rule tables cost workerd
single-digit milliseconds.** In practice that means the Rust/WASM port, where the tables compile at
build time and the module carries them as data rather than as JavaScript regular expressions — or
running the encoder in a Container off the request path entirely. Either is a slice of its own, and
the seven-pair recall figure above is what justifies scheduling it. Whether to schedule it is the
owner's call and is deliberately not decided here.

#### 4.1.4 Person-name breadth: nicknames, and the maiden-name default

`Bob`/`Robert`, `Bill`/`William`, `Peggy`/`Margaret` are not phonetic relationships and no algorithm
derives them. They need a curated equivalence table. This design **registers** the catalogue and ships
it **empty**, which makes every check record `nickname_equivalence: unavailable` rather than silently
omitting a dimension — the same honesty the prior-firm source already gets. Populating it is data
curation with a licensing question attached and does not belong inside this slice.

The married-name case is more urgent and is not a missing feature but a **default**. Former, maiden,
and alias name rows already exist and are already searched — but only at `over_inclusive`. At the
`balanced` default, a party who married and changed surname is invisible. Given that this design's own
premise is recall over precision, and that the changed surname is the single most-cited conflicts miss
in the practitioner literature, the balanced band arguably should search them. That changes what a
shipped default asserts, so it is **flag F1** and not decided here. The mechanism is built either way:
the resolved name-role set becomes an explicit, recorded part of scope (4.3) instead of an implicit
consequence of one word.

### 4.2 Axis two — traversal depth (how far the graph is walked, and where it stops)

#### 4.2.1 What the shipped traversal does

`expandGraph` is a correct 0-1 BFS: ordinary edges cost one hop against a `depth` budget (default 1),
corporate-family edges cost zero and are therefore traversed **transitively and without bound**. The
zero-cost treatment is right — a rename, merger, or successor must match regardless of chain length —
but "without bound" is a genuine problem. A Directory holding a real corporate group can put thousands
of entities in one closure, and every one of them currently costs a `readSubjectFacts` plus a
`matchParty` (four queries). That is both an availability risk and the N+1 golden rule 10 names.

#### 4.2.2 A typed per-edge-class budget

One integer cannot express "follow corporate renames forever but do not walk from a spouse to her
employer's other directors". Replace it with a budget per edge class, firm-configurable, recorded in
scope:

| Edge class           | Edge types                                                        | Default budget                                  | Why                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Corporate family** | `corporate_parent`, `corporate_subsidiary`, `corporate_successor` | Transitive (0-cost), bounded by the closure cap | A rename or merger chain of any length is the same legal person continuing. Bounding by hops would miss exactly what the search exists to find    |
| **Control**          | `principal_of_org`, `affiliation`                                 | 1 hop                                           | Adverse org → its principals is the case Rule 1.7 comments describe. Principals → their other directorships is two hops and unbounded in practice |
| **Family**           | `spouse`, `family_relationship`                                   | 1 hop                                           | The opposing party's spouse the firm represented elsewhere                                                                                        |
| **Representation**   | `representation`, `role_assignment`                               | 1 hop                                           | Role-links firm-wide are already the Party class's job; this hop catches the link recorded as an edge rather than a `matter_party`                |

The defaults are numbers that decide what gets searched, so they are **flag F6**. The mechanism is the
contribution; the numbers are the owner's.

#### 4.2.3 Where it stops — four stop conditions, all recorded

1. **Class budget exhausted.** The ordinary boundary. Recorded per hit as the hop count and the class
   budget in force.
2. **Closure cap reached.** A per-run cap on total expanded entities (default proposed 500). On
   reaching it the traversal **stops and the check records `expansion_truncated`** with the count
   reached, the caps in force, and the size of the unexplored frontier. The posture read surfaces it,
   and the report says the traversal was truncated. **A truncated expansion is never reported as a
   completed one** — this is the depth analogue of the shipped rule that `unavailable` is never
   `searched and clean`.
3. **A firm-marked non-expandable entity.** A registered agent, a clearing bank, or a state
   corporations office sits on hundreds of unrelated edges, and expanding through it converts a
   conflicts report into noise. The tempting fix is a platform heuristic — skip any node with more than
   N edges — and it is refused: a bank that appears on five hundred matters is exactly where a
   positional conflict lives, and a platform that silently skips hubs has silently narrowed the search.
   Instead the **firm** may mark an entity `expansion_hub`, which is a recorded firm assertion carried
   verbatim in every affected check's scope, attributable to the member who set it. The entity is still
   **matched** as a party; only traversal **through** it stops. (Flag F9.)
4. **Cycle / already-reached.** Unchanged from the shipped relaxation logic.

#### 4.2.4 Expired edges are traversed

A `directory_edge` whose `valid_to` has passed — a divorced spouse, a subsidiary sold last year — is
**traversed**, and each hit reached through one records that the edge was expired at check time. Rule
1.9 is about _former_ clients and _former_ relationships; a design that stops at currency would drop
the former-client dimension the rules care most about. The reviewer sees the expiry on the path and
weighs it. (Flag F7 — this is a rule reading, and the reading is the owner's.)

### 4.3 Scope becomes explicit, and the strictness word becomes a preset

Today `conflicts_check` records `strictness` (one word) and `depth` (one integer), and a reader has to
know what the code did with them on that day to know what was searched. That is fine while the mapping
never changes and fatal the first time it does — a check from March means something different from a
check from September, and nothing on the row says so.

So the check row records the **resolved channel set verbatim**: which phonetic schemes ran, which name
roles were included, which match keys were compared, which identifier types were probed and which were
skipped (`dob`, `ssn_last_four` remain non-standalone-indexable), the per-class hop budgets, the
closure cap, and any firm-marked non-expandable entities encountered. `strictness` stays as the
human-facing preset name and stays on the row; it simply stops being the only evidence of what ran.

This costs one wider JSON blob per check and buys a log that stays legible after the code moves under
it. It also makes the superset invariant checkable from stored data rather than only from a unit test.

---

## 5. Uncertainty — how a possible conflict is surfaced, who clears it, and what record it leaves

This is the part the owner named as the central question, and it is where the shipped design's
"no scorer" decision does most of its work. A fuzzy match **is** a probability, and the platform's
answer to that is not to compute the probability better — it is to refuse to be the thing that acts on
it.

### 5.1 Nothing is suppressed, and nothing auto-clears

The shipped invariants stand and are extended:

- **No threshold anywhere.** Every candidate a blocking channel surfaces is a hit. Tiers order; they
  never filter. The deepening's new channels (match key, bare match key, Beider-Morse) obey the same
  rule.
- **No code path writes a conclusion.** A `conflicts_disposition` row requires a `reviewer_user_id`
  belonging to a live member holding `conflicts:dispose`. The automated re-check consumer runs checks
  and is **structurally incapable** of disposing of one: a source-scan fitness function fails the build
  if the consumer module imports `disposition.ts`, and a database trigger refuses a disposition whose
  reviewer is not a live member. Two layers, because "the consumer must not clear anything" is exactly
  the kind of rule that survives review and dies in a refactor.
- **A hit with no disposition is loud, not quiet.** `undisposedByTier` is a first-class field of the
  posture read, and a matter with undisposed tier-1 hits cannot render as anything resembling settled.

### 5.2 Hit lifecycle — three states, all derived

| State             | Derivation                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `undisposed`      | No `conflicts_disposition` row names this hit                                                                           |
| `disposed`        | The latest disposition row by `created_at`, `rowid` — the shipped `readCurrentDisposition` projection                   |
| `answered-before` | Undisposed, but a **prior** hit with byte-identical evidence, path, and entity on the same matter carries a disposition |

No state is stored. Nothing is ever updated in place. `answered-before` is the interesting one and it
exists to solve a real tension: if every re-check re-surfaces every hit as brand new, a periodic
re-scan buries a reviewer under questions they answered last month, and a buried reviewer stops
reading — which is the "reports nothing" failure arriving by a longer route.

### 5.3 Carry-forward is a citation, never a disposition

The tempting shortcut is to let an evidence-identical re-surfaced hit inherit the prior disposition
automatically. It is refused. Auto-inheriting writes a conclusion into the record that the named
reviewer did not make on that day about that check, and the record's whole value is that every
conclusion has a person behind it.

What ships instead:

- A re-surfaced hit whose **evidence is byte-identical** (same entity, same tier, same matched-fields
  set, same path, same expiry facts) is grouped in the reviewer queue as **previously concluded**, with
  the prior disposition's kind, reviewer, rationale, and date shown, collapsed by default.
- A re-surfaced hit whose evidence **changed at all** — a stronger tier, a new matched field, a new or
  shorter path, a newly expired edge — is a **fresh question** and gets no grouping. Strengthening
  evidence is precisely the case where last month's conclusion is worthless.
- **Bulk affirmation** lets a reviewer clear the previously-concluded group in one action. It writes
  **one real `conflicts_disposition` row per hit**, each naming the **affirming** member as reviewer,
  each with a rationale, and each carrying a new nullable `carried_from_disposition_id` pointing at the
  prior conclusion it re-affirms. Cheap for the reviewer, and a live human's name is on every row.
- The alternative — no grouping at all, every re-surfaced hit reviewed from scratch — is the
  conservative posture and is a legitimate firm choice. Which is the default is **flag F4**; both modes
  are built and the mode in force is recorded on the check.

`carried_from_disposition_id` is a nullable column added by `ALTER TABLE ADD COLUMN`, which SQLite
performs without a table rebuild and which leaves the append-only triggers untouched. No
`DISPOSITION_KINDS` value is added, so the `CHECK (kind IN (...))` constraint is not widened and the
growing table is not rebuilt.

### 5.4 Who clears it

`conflicts:dispose`, as shipped. The open question is whether that is enough for the strongest
evidence: an exact SSN match between a prospective client and an existing adverse party, or an
imputation hit naming a firm member as a party, is a different decision from a trigram collision on a
common surname, and a firm may well want the first two to require a designated responsible attorney.

The mechanism is built as a firm policy with three settings, mirroring the shape the owner already
chose for two-person trust disbursement (off / threshold / always): `tier1DispositionAuthority` =
`any-disposer` | `designated-attorney`. The policy in force is recorded on the disposition row.
**Which setting is the default, and whether tiering disposition authority is wanted at all, is flag F5.**

### 5.5 What record it leaves

Three shipped append-only tables, plus two additions and one artifact:

- **The re-check ledger** (§3.2) — evidence that the firm's procedure _noticed_ a change, with the
  interval between the corpus change and the check that answered it. A check row alone can show that a
  check happened; only the ledger can show that it happened _because the firm's system caught
  something_, which is what a "reasonable procedures" defence under Rule 1.10(e) actually turns on.
- **`carried_from_disposition_id`** (§5.3) — the chain of re-affirmations, each with its own reviewer.
- **The conflicts report artifact** — an on-demand, generated document for one matter: every check in
  chronological order with its scope in force verbatim; every hit with its evidence, tier, and
  connecting path; every disposition with reviewer, rationale, and timestamp; every source that
  recorded `unavailable` and why; every truncation; and the re-check ledger with its intervals. It
  renders through the existing document-assembly and PDF path (no new machinery). It is titled a
  **report**, it states what was searched and found, and it draws no conclusion. Whether the firm also
  wants a signable engagement conflicts memorandum — a lawyer asserting a conclusion, which a lawyer
  may do and the platform may not — is **flag F12**.

### 5.6 The one thing the platform is allowed to assert

For completeness, because the boundary should be stated positively as well as negatively: the platform
**may** assert facts about its own behaviour. "This search ran." "These channels executed." "This
source has no corpus." "This traversal was truncated at 500 entities." "Nothing surfaced." Those are
facts about the machine, verifiable from its own record. What it may never assert is a fact about the
world — that no conflict exists, that a matter is safe to accept, that a hit is not a conflict.

---

## 6. Where the work runs

Golden rule 10 governs, and the honest answer is that the deepened engine is materially heavier than
the shipped one, so placement is a first-class part of the design rather than a footnote.

### 6.1 The hot path gains one INSERT

Every trigger-producing write — party link, merge, edge create, identifier add, name change —
adds exactly **one outbox row to a batch it was already composing**. No traversal, no matching, no
query fan-out, nothing that scales with corpus size, executes in a request handler. The
`matter.opened` and `matter.created` cases are the same. This is the transactional-outbox pattern the
platform already runs (ADR-0064) and the reason the trigger cannot be lost: the outbox row commits if
and only if the business write commits.

### 6.2 Everything else runs in a queue consumer or the cron sweep

- **Affected-matter resolution** — one bounded indexed query per event (`matter_party.entity_id` index
  for rows 3-5 and 7; the same index over both endpoints for row 6). Cheap; runs in the recheck-request
  consumer.
- **The check itself** — one queue message per matter, in the recheck-run consumer, with a wall-clock
  budget. This is where expansion and matching live.
- **The periodic re-scan and the ledger backstop drain** — the existing per-firm cron fan-out
  (ADR-0050), which already walks reachable active firms and already carries per-pass budgets.
- **Nothing on the UI main thread, nothing in a Durable Object, no Container, no Rust.** Stated with
  reasons rather than by omission: the work is D1-query-dominated and bounded by the caps in §4.2.3, so
  a Container adds a hop and buys no throughput; there is no shared mutable state to coordinate, so a
  Durable Object adds a hop and buys no correctness; and the comparison arithmetic remains
  sub-millisecond over a capped candidate set, so a WASM core buys nothing measurable. Tantivy stays
  the reserved scale path with a measured flip condition, unchanged from ADR-0192.

### 6.3 The N+1 has to go, and it goes in-area

The shipped `runConflictsCheck` performs, **per expanded entity**, one or two `readSubjectFacts`
queries plus a `matchParty` that issues four (three blocking channels plus the exact-name probe). At
the shipped default — a handful of parties, one hop — that is a few dozen queries and the load profile
measured it comfortably. At a 500-entity closure cap it is roughly 2,500 queries in one invocation,
which no budget survives.

So the deepening batches, and does it in the same slice as the traversal widening rather than after a
measurement, because it is a foundation and not an optimization ("build when in the area"):

- **`readSubjectFactsBatch`** — one query per node table over the whole expanded set (`WHERE id IN (…)`),
  replacing the per-entity reads.
- **`matchPartyBatch`** — each blocking channel runs **once for the whole expanded set** rather than
  once per entity: one phonetic-code query over the set's codes, one trigram query, one blind-index
  self-join, one match-key probe. Query count becomes O(channels), not O(entities × channels).
- The candidate set the channels return is still bounded by blocking, and tiering stays in TypeScript
  over that bounded set.

### 6.4 Measured, not asserted

Instrumentation ships with the mechanism, not after it: per-check wall time, expanded-entity count,
candidate count, query count, truncation counters, and drain-lag on the re-check ledger, emitted
through the shipped telemetry pipeline. The load-profile harness gains a conflicts profile with a
**deep corporate graph** (a chain and a fan, sized past the default cap) and a **large name corpus**,
extending the existing `conflicts.run-check` / `conflicts.imputation` / `conflicts.co-party-check`
measurements. The Tantivy and Rust flip conditions become numbers read off that harness rather than
opinions.

---

## 7. Flagged for the owner

Every item below changes what the platform **asserts** about a firm's ethical position, or picks a
number that decides what gets searched. The mechanism for each is designed and built; the setting is
not chosen here.

| #   | Question                                                                                                                                                                       | Design's recommendation (not a decision)                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| F1  | Should the **balanced** default band search former, maiden, and alias names? Today only over-inclusive does, so a married-name change is invisible at the default              | Yes — the changed surname is the most-cited miss                                   |
| F2  | Does an **imputed conflict follow a lateral hire**, and does a Rule 1.10(a)(2) screen cure it? Governs whether the personnel trigger produces a conflict or a screening prompt | Surface it as a hit; do not model screening until F2 is answered                   |
| F3  | **Periodic re-scan cadence**, and whether a firm may disable it                                                                                                                | Weekly; disableable but the disabling is recorded and shown                        |
| F4  | **Carry-forward default** — group evidence-identical re-surfaced hits with bulk affirmation, or review every one fresh                                                         | Group with bulk affirmation; strict byte-identical evidence test                   |
| F5  | **Tiered disposition authority** — must tier-1 (exact identifier, imputation) hits be disposed of by a designated attorney?                                                    | Off by default, available as a firm policy                                         |
| F6  | The **traversal numbers** — per-class hop budgets (control/family/representation) and the closure cap                                                                          | 1 hop per class; closure cap 500                                                   |
| F7  | Are **expired edges** (divorced spouse, sold subsidiary) traversed?                                                                                                            | Yes, with the expiry recorded on the path — Rule 1.9 is about former relationships |
| F8  | Should a conflicts notification **escalate immediately** rather than ride the digest? (`IMMEDIATE_ESCALATION_CATEGORIES` is trust + security today)                            | Yes for tier 1-2 on an automated check                                             |
| F9  | May a firm mark an entity **non-expandable** (registered agents, banks), and is that assertion the firm's to make?                                                             | Yes — recorded, attributable, and never a platform heuristic                       |
| F10 | Does a **policy raise** force an immediate firm-wide re-scan, or only mark prior checks as run under a narrower scope?                                                         | Mark, and offer an explicit re-scan                                                |
| F11 | Should a matter **refuse to open** with undisposed tier-1 hits (a hard close-precondition-style gate on `matter.opened`), or only advise?                                      | Advise loudly; a hard block on an ethics judgement is the platform deciding        |
| F12 | Is a **signable engagement conflicts memorandum** wanted — a lawyer's assertion, distinct from the platform's report?                                                          | Offer it as an assembled document a lawyer signs, never generated as a conclusion  |

---

## 8. Deliberately not in this design

| Not here                          | Why                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The **Content** source class      | Unchanged from ADR-0192: `email-core` is parse-only and no document-text index exists. It stays registered and `unavailable`                                                                                                                                                                                                                        |
| **Prior-firm lateral history**    | Still a registered source with no table and no capture surface. The personnel trigger records it `unavailable` honestly, which is the point of registering it                                                                                                                                                                                       |
| **Ethical wall enforcement**      | Deferred by the white paper. `wall_erected` remains a recordable outcome that enforces nothing                                                                                                                                                                                                                                                      |
| **The reviewer UI**               | UI is parked by owner direction. Slice 5 builds the read models and routes an adjudication surface needs; the Svelte surface is a later slice                                                                                                                                                                                                       |
| **A nickname equivalence corpus** | Registered and shipped empty (§4.1.4). Curation with a licensing question attached                                                                                                                                                                                                                                                                  |
| **A scorer**                      | Refused by ADR-0192 and refused again here, harder: the deepening adds channels, and every one obeys the no-threshold rule                                                                                                                                                                                                                          |
| **Rust/WASM for matching**        | Still no measured hot path for the MATCHING arithmetic. Beider-Morse's encoder is no longer merely a candidate: slice 4 measured its only TypeScript implementation at 20,377 ms of workerd module-load CPU against 16 ms in Node, so a Rust/WASM port (or a Container off the request path) is the only way that channel ships at all — see 4.1.3a |

---

## 9. Test plan

Beyond the shipped suite, which stands:

**Posture and vocabulary**

- The posture read never returns a field matching `/clear|clean|ok|passed|conflictFree/i`; the
  vocabulary lint fails a fixture containing each banned phrase, and passes `cleared` inside
  `DISPOSITION_KINDS`.
- A matter with no check reads `neverChecked: true` and is distinguishable from a matter checked with
  zero hits.
- Raising the firm floor makes `scopeShortfall` non-empty on an already-checked matter, with no write
  to any conflicts table.

**Triggers**

- Each of the seven event producers commits exactly one outbox row **in the same batch** as its
  business write, and no outbox row when the write fails.
- A merge of an entity that is a party on three matters produces three ledger rows and three checks.
- A queue redelivery of the same cause produces no second ledger row and no second check.
- Two causes accumulating for one matter before the drain produce **one** check whose `cause_json`
  names both.
- `directory.entity.created` with no link and no edge produces **no** ledger row (the import
  regression).
- A drain that exhausts its budget leaves rows pending, and the posture read reports them.
- The cron backstop satisfies a ledger row the queue never drained.

**Depth**

- `Smith & Jones LLP` and `Smith and Jones, L.L.P.` match at **tier 2** via `normalized_matchkey`.
- `Smith & Jones LLP` and `Smith & Jones LLC` match at **tier 3** via the bare key, and **not** at tier 2.
- Over-inclusive remains a **strict superset** of balanced with every new channel enabled — the
  invariant re-proven against the real corpus, not a mock.
- A corporate chain longer than every hop budget is fully traversed; a control edge two hops out is not.
- A closure exceeding the cap records `expansion_truncated` with the count and the frontier size, and
  the posture read surfaces it.
- An expired edge is traversed and its hit records the expiry.
- A firm-marked non-expandable entity is still **matched** as a party and is not **traversed through**;
  the mark appears verbatim in the check's recorded scope.
- The batched matcher returns exactly the same hit set as the per-entity matcher over the same corpus
  (the refactor's correctness proof), in O(channels) queries.

**Uncertainty**

- The re-check consumer module does not import `disposition.ts` (source-scan fitness), and a
  disposition whose reviewer is not a live member is refused by the database.
- A re-surfaced hit with byte-identical evidence is grouped `answered-before`; one whose tier
  strengthened is not.
- Bulk affirmation writes one disposition row per hit, each naming the **affirming** member and each
  carrying `carried_from_disposition_id`.
- A reversal after an affirmation leaves three rows on the books, in order, none updated.
- No plaintext identifier appears in the ledger, the cause payloads, or the report artifact.

**Performance**

- The deep-graph load profile stays within budget at the default caps, and every conflicts hot-path
  query walks an index (the existing plan-scan probe, extended to the new channels).
