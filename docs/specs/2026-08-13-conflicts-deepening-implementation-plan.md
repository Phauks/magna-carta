# Conflicts 4·1 deepening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Design:** [`2026-08-13-conflicts-deepening-design.md`](2026-08-13-conflicts-deepening-design.md)
**Deepens:** [`2026-07-09-slice-4-1-conflicts-design.md`](2026-07-09-slice-4-1-conflicts-design.md) and its plan
**Goal:** Make the conflicts check fire when the world changes, look far enough to be worth firing,
and never let the platform imply a matter is conflict-free.

**Architecture:** No new package. `@magna-carta/conflicts` grows a read model, a re-check ledger, and
a batched matcher; `@magna-carta/directory` grows two derived name columns, a third phonetic scheme,
and outbox topics at write points that today emit nothing; `apps/worker` grows two queue consumers and
a cron drain. Everything heavy runs behind the transactional outbox, never in a request handler.

**Tech Stack:** TypeScript, Drizzle ORM (per-firm schema), SQLite/D1, Cloudflare Queues + Cron,
Vitest, Hono, `@magna-carta/data-access` effect batches.

---

## Global constraints

- **Golden rule 12 — no shorthand.** `newIdentifier`, not `newId`; "the data-access layer", never
  "the DAL"; `normalizedMatchKey`, not `matchKey`.
- **Golden rule 13 — no process references in source.** No ADR numbers, no "spec §N", no "slice 4·1"
  in code, tests, config, or OpenAPI `description`s. Forward-looking schedule notes are allowed.
- **Golden rule 2 — no emojis** anywhere.
- **Golden rule 10 — nothing heavy in a request handler.** Every trigger producer adds exactly one
  outbox row to a batch it was already composing. If a task finds itself adding a query to a write
  path, it has gone wrong.
- **The three log tables stay append-only.** No `UPDATE`, no `DELETE`, ever. New columns are added by
  `ALTER TABLE ADD COLUMN` (nullable, no default expression), which SQLite performs without a rebuild
  and which leaves the `RAISE(ABORT)` triggers intact. **No CHECK constraint on an existing conflicts
  table is widened** — widening one is a rebuild the additive-only migration lineage forbids.
- **No plaintext identifier** enters the log, the re-check ledger, a cause payload, an outbox payload,
  a notification, or the report artifact.
- **Every mutation writes an `audit_log` row** in the same atomic batch, via `conflictsAuditStatement`.
- **Idempotency on every write route**, threaded through `runConflictsEffect`.
- **D1 has no interactive transactions** — read everything before composing a batch.
- **Migration ids are monotonic** and hand-written where triggers or FTS are involved; take the next
  timestamped id above the current head at the time of the task.
- **Twelve owner flags (F1-F12) are open.** Every one has a shipped default named in the design's
  flag table. Build the mechanism, ship the recommended default **as a firm-configurable setting**,
  and record the setting in force on the row. Do not hard-code a flagged value anywhere.

---

## Slice ordering, and why slice 1 is useful alone

| Slice | Ships                                                                                                                                                                                                               | Useful alone because                                                                                                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | The reporting posture: the matter conflicts posture read, the honest zero-hit report, the vocabulary fitness function                                                                                               | A firm can see, per matter, exactly what was searched, what was not, what is unanswered, and whether the answer predates the firm's current policy — none of which is readable today without raw rows. It ships no new matching and no new firing, and it is the framing every later slice inherits |
| **2** | Event triggers, the re-check ledger, the queue consumers, the cron backstop, the notification type                                                                                                                  | The check now fires when the world changes. This is the larger half of the owner's scope and it stands on slice 1's posture read to surface pending re-checks                                                                                                                                       |
| **3** | Traversal depth: typed per-edge-class budgets, the closure cap and truncation record, expired-edge traversal, firm-marked non-expandable entities, and the batched matcher                                          | The graph half of search depth, with the N+1 removed in the same slice because widening traversal without batching would regress the shipped load profile                                                                                                                                           |
| **4** | Matching depth: the two additive organization match keys with their backfill, the registered-and-empty nickname catalogue, and name-role breadth as a firm setting (Beider-Morse attempted and reverted — Task 4.4) | The name half of search depth. Last of the depth work because it is the only part that touches the Directory **write** path and needs a corpus backfill                                                                                                                                             |
| **5** | The adjudication read models: previously-concluded grouping, bulk affirmation, tiered disposition authority, and the conflicts report artifact                                                                      | Closes the uncertainty loop. Read models and routes only — the Svelte surface is a later slice, UI being parked by owner direction                                                                                                                                                                  |

Slices 3 and 4 are independent of each other and may run in either order or in parallel by different
owners, provided slice 4 owns `packages/directory/src/` and slice 3 owns `packages/conflicts/src/expansion.ts`
and `matching.ts` exclusively.

---

## Slice 1 — The reporting posture

**Deliverable:** a firm can ask a matter where it stands on conflicts and receive a report, never a
verdict. No schema change beyond none; no new matching; no new firing.

### Task 1.1 — The posture read model

- [ ] Add `packages/conflicts/src/posture.ts` exporting `readMatterConflictsPosture(database, matterId)`.
- [ ] Return the shape in the design's posture table: `latestCheck` (id, `created_at`, trigger,
      `trigger_source`, actor-or-null, scope verbatim), `scopeShortfall`, `pendingRecheck` (empty
      until slice 2), `undisposedByTier`, `dispositionsByKind`, `unavailableSources`, `neverChecked`.
- [ ] `scopeShortfall` is computed by comparing the stored `scope_json` / `strictness` / `depth`
      against `readConflictsPolicy` **at read time**. It writes nothing. A matter whose latest check
      ran below the firm's current floor reports the shortfall and stays reporting it until a later
      check clears it by having run.
- [ ] No field named `clear`, `clean`, `ok`, `passed`, `status`, `severity`, or `conflictFree`. No
      aggregate boolean anywhere in the shape.
- [ ] `neverChecked: true` is a distinct state from a check with zero hits, and both are distinct from
      a check whose sources were all `unavailable`.

### Task 1.2 — Undisposed and disposition projections

- [ ] Add `readHitDispositionStates(database, checkId)` beside the shipped `readCurrentDisposition`:
      one query returning each hit's latest disposition (or none), using the shipped
      `ORDER BY created_at DESC, rowid DESC` tie-break. No N+1 per hit.
- [ ] Derive `undisposedByTier` and `dispositionsByKind` from that projection.

### Task 1.3 — The report sentence

- [ ] Add `packages/conflicts/src/report-text.ts` exporting `describeCheck(check, hits, sources)`,
      producing the structured statement in the design's zero-hit example: what ran, with what
      settings, over how many entities; what did not run and why; and the count that surfaced.
- [ ] The zero-hit case returns "Nothing surfaced." and never a sentence about the matter.
- [ ] Pure and synchronous; no database access, no formatting concerns beyond the sentence list.

### Task 1.4 — Routes

- [ ] `GET /matters/{matterId}/conflicts-posture` on `conflicts:read`, through the chokepoint,
      returning the Task 1.1 shape.
- [ ] Extend the shipped check GET to include the Task 1.3 statement list.
- [ ] OpenAPI `description`s state that the response reports what was searched and found and asserts
      nothing about whether a conflict exists. No description contains "clear" as a property of a
      matter.

### Task 1.5 — The vocabulary fitness function

- [ ] Add `tooling/lint-conflicts-vocabulary.mjs`, modelled on the shipped
      `tooling/lint-custodian-vocabulary.mjs`, wired as `pnpm run lint:conflicts-vocabulary` and into
      the governance job of `.github/workflows/gate.yml`.
- [ ] Scan `packages/conflicts/`, `apps/worker/src/routes/directory/conflicts.ts`, the generated OpenAPI
      snapshot's conflicts paths, conflicts surfaces under `apps/web/`, and `docs/user/`.
- [ ] Ban, case-insensitively: `conflict-free`, `conflict free`, `no conflicts`, `clear of conflicts`,
      `conflicts cleared`, `conflict check passed`, `all clear`, `no conflict found`.
- [ ] Ban a response field whose name matches `/clear|clean|ok|passed|conflictFree/i`.
- [ ] Allowlist `cleared` **only** as a `DISPOSITION_KINDS` value and in the disposition code paths
      that carry a `reviewer_user_id`.
- [ ] Fixture test: each banned phrase fails; the allowlisted use passes.

### Task 1.6 — Tests and docs

- [ ] Posture tests per the design's test plan (never-checked vs zero-hit; shortfall appears on a
      policy raise with no write; unavailable sources surface).
- [ ] Update `packages/conflicts/CLAUDE.md`: the posture read is the sanctioned way to ask where a
      matter stands, and the reporting posture is an invariant with a lint behind it.
- [ ] Add the user-facing page under `docs/user/` explaining what a conflicts report says and, in
      plain language, what it does not say.

---

## Slice 2 — Event triggers and the re-check ledger

**Deliverable:** a corpus change that could alter an already-checked matter's answer produces a
durable, visible re-check request within one outbox relay cycle, and a check that satisfies it.

### Task 2.1 — Outbox topics at the producing write points

- [ ] Add `packages/directory/src/topics.ts` in the shape of `packages/matters/src/topics.ts`: one
      frozen set, one spelling, exported constants. Move the two existing literals
      (`directory.entity.created`, `directory.entity.renamed`) onto it.
- [ ] Emit one outbox row, in the batch each write already composes, from:
      `linkMatterParty` → `matter_party.linked`; `mergeEntities` → `directory.entity.merged`
      (payload names master **and** subordinate); `createEdge` → `directory.edge.created` (payload
      names both endpoints and the edge type); `addIdentifier` → `directory.identifier.added`
      (payload names the entity and the identifier **type** — never a value, never a blind index).
- [ ] Confirm `matter.created` and `matter.opened` already emit; wire them, do not duplicate them.
- [ ] Add no query to any of these write paths. One INSERT each, nothing else.
- [ ] Tests: each producer commits exactly one outbox row in the same batch as its business write, and
      none when the write fails.

### Task 2.2 — The re-check ledger table

- [ ] Hand-written migration adding `conflicts_recheck_request`: `id`, `matter_id`, `cause_topic`,
      `cause_reference`, `cause_occurred_at`, `requested_at`, `satisfied_by_check_id` (nullable),
      `satisfied_at` (nullable).
- [ ] Partial unique index on `(matter_id, cause_topic, cause_reference)` **where
      `satisfied_at IS NULL`**, so a queue redelivery is a no-op and a genuinely recurring cause can
      still be requested again later.
- [ ] Index on `(satisfied_at, requested_at)` for the drain.
- [ ] Rows are never deleted. `satisfied_by_check_id` / `satisfied_at` are the **only** mutable
      columns; a `BEFORE UPDATE` trigger aborts an update touching any other column, so the cause and
      its timing cannot be rewritten after the fact.
- [ ] Add the table to the per-firm schema and the schema-name-sync fitness test.

### Task 2.3 — Affected-matter resolution

- [ ] Add `packages/conflicts/src/recheck-cause.ts`: one function per topic returning the affected
      matter ids, each a single bounded indexed query.
- [ ] `matter_party.linked` → the named matter. `directory.entity.merged` → live matters where master
      **or** subordinate was a party. `directory.entity.renamed` / `directory.identifier.added` →
      live matters where the entity is a party. `directory.edge.created` → live matters where either
      endpoint is a party, plus matters reached within the class budget from a party (bounded by the
      same closure cap slice 3 introduces; until slice 3 lands, the shipped one-hop expansion).
      `member.provisioned` / member-link → open matters, drained over time.
- [ ] Explicitly return **empty** for `directory.entity.created` with no link and no edge, with a
      comment stating the import-storm reasoning inline (never a process-doc citation).
- [ ] Tests including the import regression: two hundred created entities produce zero ledger rows.

### Task 2.4 — The re-check request consumer

- [ ] Add `apps/worker/src/conflicts/recheck-request-consumer.ts`, registered on the per-firm queue.
- [ ] For each cause: resolve the affected matter set, insert ledger rows, ack. Nothing else.
- [ ] A fan-out above `maxMattersPerEvent` still writes **every** row; it never trims the set.
- [ ] The module must not import `runConflictsCheck` — request and run are separate consumers so a
      slow check cannot back-pressure cause resolution.

### Task 2.5 — The re-check run consumer and the trigger catalogue

- [ ] Widen `CONFLICTS_TRIGGERS` to the design's catalogue: `preliminary`, `comprehensive`,
      `new_party`, `entity_merged`, `entity_renamed`, `relationship_recorded`,
      `identifier_recorded`, `personnel_changed`, `periodic_rescan`. The column CHECK is
      `length > 0`, so this is additive — **no migration**.
- [ ] `ALTER TABLE conflicts_check ADD COLUMN trigger_source TEXT` and `ADD COLUMN cause_json TEXT`,
      both nullable. A manual run leaves them null and continues to read exactly as it does today.
- [ ] Add `apps/worker/src/conflicts/recheck-run-consumer.ts`: claim unsatisfied ledger rows for one
      matter, **coalesce every accumulated cause into one check** whose `cause_json` names them all,
      run `runConflictsCheck` with `trigger_source: "event"` and no actor, then stamp
      `satisfied_by_check_id` / `satisfied_at` on each claimed row.
- [ ] Wall-clock and row-count budget per invocation. Exceeding it leaves rows pending — a visible
      state, never a discarded one.
- [ ] **This module must not import `disposition.ts`.** Enforce with a source-scan fitness function
      (Task 5.2 hardens it further at the database).
- [ ] Tests: three matters from one merge; redelivery is a no-op; two causes coalesce into one check
      naming both; budget exhaustion leaves rows pending and the posture read reports them.

### Task 2.6 — Cron backstop and the periodic re-scan

- [ ] Extend `runScheduledSweep` with a per-firm conflicts pass: drain unsatisfied ledger rows the
      queue did not, oldest first, under a budget.
- [ ] Add the periodic re-scan: at the firm's configured cadence (setting, default weekly — **F3**),
      enqueue ledger rows for open matters in batches so no invocation walks a whole caseload.
- [ ] The cadence setting, and whether the firm has disabled it, are recorded and surfaced in the
      posture read.

### Task 2.7 — Notification

- [ ] Add `conflicts.hit.surfaced` to `packages/notifications/src/registry.ts`: category `conflicts`,
      subject kind `conflictsCheck`, audience `capability-holders` on `conflicts:read`,
      matter-anchored, `email: category-count`, escalation `digest` (**F8** — the setting, not the
      mechanism, is what is flagged; wire it so flipping to `immediate` is one registry edit plus one
      entry in `IMMEDIATE_ESCALATION_CATEGORIES`).
- [ ] Subscribe to the check-written outbox row; emit only for an **automated** check that surfaced an
      undisposed tier 1-2 hit, or any hit on a matter that previously had none.
- [ ] The notification carries counts and a deep link. It carries no entity name, no matched field,
      and no identifier.

### Task 2.8 — Posture, tests, docs

- [ ] Fill `pendingRecheck` in the posture read from the ledger, each entry naming its cause and the
      time since the cause occurred.
- [ ] Update `packages/conflicts/CLAUDE.md` and `packages/directory/CLAUDE.md` (the new topics and the
      one-INSERT rule on the write paths).
- [ ] Changelog fragment; `docs/user/` page on automatic re-checks.

---

## Slice 3 — Traversal depth, caps, and the batched matcher

**Deliverable:** the graph is walked as far as the firm's typed budgets allow, every stop is recorded,
and the walk costs O(channels) queries rather than O(entities × channels).

### Task 3.1 — The typed edge budget

- [ ] Extend `ConflictsPolicy` with `edgeClassBudgets` (corporate / control / family /
      representation) and `closureCap`, defaults per the design's table (**F6**).
- [ ] Map edge types to classes in `expansion.ts`; keep corporate at zero cost.
- [ ] `resolveScope` records the resolved budgets. Budgets are **defaults, not floors** — a caller may
      go deeper; going shallower is honoured and recorded, exactly as the shipped `depth` already is.
- [ ] Keep the shipped `depth` column and request field working as the control/family/representation
      budget when no per-class budget is supplied, so no caller breaks.

### Task 3.2 — The closure cap and the truncation record

- [ ] Stop expansion on reaching `closureCap`; return the entities reached **plus** a truncation
      record: entities reached, caps in force, unexplored frontier size.
- [ ] Record `expansion_truncated` in the check's scope and surface it in the posture read and the
      Task 1.3 statement. A truncated expansion is never reported as a completed one.
- [ ] Determinism: the traversal order is already edge-id-sorted; the cap must therefore truncate the
      same set for the same corpus.

### Task 3.3 — Expired edges and firm-marked non-expandable entities

- [ ] Traverse an edge whose `valid_to` has passed, and carry `expiredAtCheck` on the `EdgeStep`
      (**F7**). The shipped `readEdges` ambient-clock gotcha applies: pass the check's clock rather
      than depending on `new Date()`.
- [ ] Add a firm-set `expansion_hub` marking on a Directory entity (a firm setting keyed by entity id,
      or a nullable column — whichever the Directory owner prefers; it must carry the member who set
      it and when). A marked entity is still **matched** as a party and is not **traversed through**.
- [ ] Every marked entity encountered by a run is listed verbatim in that check's recorded scope
      (**F9**).
- [ ] Refuse, in code and in a comment stating the reason inline, any degree-based automatic hub
      suppression.

### Task 3.4 — The batched matcher

- [ ] Add `readSubjectFactsBatch`: one query per node table over the expanded set, replacing the
      per-entity `readPerson` / `readOrganization` calls.
- [ ] Add `matchPartyBatch` in `matching.ts`: each blocking channel runs **once** over the whole
      expanded set — one phonetic query, one trigram query, one blind-index self-join, one exact-name
      probe, and (after slice 4) one match-key probe — returning a map from subject entity to its
      candidates with channel provenance intact.
- [ ] Extend `findDuplicateCandidates` additively with a set-valued subject, as the shipped design
      extended it additively before; omitting the new parameter must preserve today's behaviour
      exactly, so the merge and entry-time-duplicate callers are untouched.
- [ ] **Equivalence test:** over the same corpus, the batched matcher returns exactly the hit set the
      per-entity matcher returns. This is the refactor's correctness proof and must pass before the
      per-entity path is removed.
- [ ] Keep tiering and explanation construction in TypeScript over the bounded candidate set.

### Task 3.5 — Load profile

- [ ] Extend the fixtures load profile with a deep corporate graph (a long chain and a wide fan, sized
      past the default closure cap) and a large name corpus.
- [ ] Extend `conflicts-measurements.ts`: a deep-graph `conflicts.run-check`, a truncating run, and a
      batched-matcher query-count assertion.
- [ ] Every new hot-path query walks an index — extend the existing plan-scan probe; nothing is
      allowlisted.
- [ ] Emit per-check wall time, expanded-entity count, candidate count, query count, and truncation
      counters through the shipped telemetry pipeline.

### Task 3.6 — Tests and docs

- [ ] Per the design's depth test list: corporate chain past every hop budget fully traversed; control
      edge at two hops not traversed; cap records truncation; expired edge traversed with its expiry;
      marked entity matched but not traversed through.
- [ ] Update `packages/conflicts/CLAUDE.md` — the corporate-edge gotcha grows into the typed-budget
      rule, and the truncation invariant joins the append-only ones.

---

## Slice 4 — Matching depth: match keys, Beider-Morse, nicknames

**Deliverable:** `Smith & Jones LLP` and `Smith and Jones, L.L.P.` are one name at tier 2, and
cross-origin surnames stop being a structural miss. Owns `packages/directory/src/` for its duration.

### Task 4.1 — The two match keys

- [ ] Add `packages/directory/src/match-key.ts`: `normalizedMatchKey(name)` and
      `normalizedMatchKeyBare(name)`, both **layered on** the frozen `normalizeName` output, never
      replacing it.
- [ ] `normalizedMatchKey`: unify `&` and `and`; canonicalize legal-entity forms to one token each
      (`llp`, `llc`, `inc`, `corp`, `ltd`, `plc`, `co`, `pc`, `pllc`, `lp`); drop a leading `the`;
      collapse whitespace. The legal form is **preserved**.
- [ ] `normalizedMatchKeyBare`: the above with the legal form **removed**.
- [ ] The canonical form table is a single exported constant with the reasoning stated inline; adding
      a form is one entry.
- [ ] Property test: both keys are stable, idempotent, and never empty for a non-empty input.

### Task 4.2 — Columns, write path, backfill

- [ ] Migration adding `normalized_match_key` and `normalized_match_key_bare` to `directory_name`,
      both nullable, plus an index on each. `normalized_display` is **untouched**.
- [ ] Compute both on every `directory_name` insert, in the same batch as the phonetic codes, by the
      same discipline.
- [ ] A backfill sweep over existing rows, resumable and budgeted, riding the cron pass.
- [ ] A fitness probe mirroring `everyNameHasPhoneticCodes`: every live name row has both keys once
      the backfill has run, and the probe reports the outstanding count while it has not.

### Task 4.3 — The match-key channels and their tiers

- [ ] Add the two probes to `matching.ts` beside the shipped exact-name probe: same merge-resolution
      `COALESCE`, same deleted-entity exclusion, same name-role scoping so the superset invariant
      holds.
- [ ] `normalized_match_key` equality → **tier 2**; `normalized_match_key_bare` equality → **tier 3**.
      Both name themselves in `matched_fields_json`.
- [ ] **Do not widen** `CHECK (evidence_tier BETWEEN 1 AND 4)`. Add a comment stating the rebuild
      reasoning inline.
- [ ] Tests: the owner's two examples land at tier 2 and tier 3 respectively, and the LLP/LLC pair
      does **not** reach tier 2.

### Task 4.4 — Beider-Morse — ATTEMPTED, MEASURED, NOT SHIPPED

> Slice 4 built this task and reverted it. The task as written below is not achievable on this
> platform; the design's 4.1.3a records the measurement in full. Do not re-attempt it with another
> JavaScript encoder without first measuring that encoder's MODULE-LOAD cost inside workerd — Node is
> four orders of magnitude faster here and will tell you nothing.

- [x] ~~Add `beider_morse` as a third scheme in `phonetics.ts`~~ — **impossible as specified.**
      `directory_name_phonetic_code`'s PRIMARY KEY is `(name_id, scheme)`, so it holds one code per
      name per scheme; Beider-Morse returns tens. The open `scheme` CHECK is only half the seam. A
      variable-output encoder needs a table keyed by the CODE.
- [x] Encoder survey done. `bmpm` is the only maintained JavaScript implementation: **MIT, pure
      TypeScript, zero runtime dependencies**, so **golden rule 14 was never triggered** and no owner
      consent was needed. It was adopted, wired, measured, and removed.
- [x] **The blocker: 20,377 ms of workerd CPU at module load** (16 ms in Node), measured on the first
      person create with the channel wired. Past the Workers CPU limit on both the write path and the
      read path; a lazy dynamic import is worse because Workers forbid runtime module loading.
- [x] Recall measured before the revert, so the follow-on is justified rather than hoped for: seven
      cross-origin pairs in thirty that Double Metaphone structurally cannot reach.
- [ ] **The follow-on, unscheduled and the owner's call:** the Rust/WASM port, whose flip condition is
      now a number — an encoder whose rule tables cost workerd single-digit milliseconds. It also needs
      a new table keyed `(name_id, code)`, and the read path must probe the SUBJECT's stored phonemes
      rather than computing them, or the request-path cost returns by the back door.

### Task 4.5 — The nickname catalogue, registered and empty

- [ ] Register `nickname_equivalence` as a source input that is always `unavailable` until populated,
      exactly as `prior_firm_history` is.
- [ ] Ship the table and the read; ship no data.
- [ ] Every check records it `unavailable`, so the log states the dimension was not searched rather
      than omitting it.

### Task 4.6 — Name-role breadth becomes explicit (F1)

- [ ] Make the resolved name-role set an explicit, firm-configurable part of scope, recorded verbatim
      on the check row, rather than an implicit consequence of the strictness word.
- [ ] Ship the recommended default from the design's flag table as a **setting**, so answering F1 is a
      configuration change and not a code change.
- [ ] The strictness preset continues to name a resolved set; the set is what the log records.

---

## Slice 5 — Adjudication read models and the report artifact

**Deliverable:** the uncertainty loop closes — a reviewer can work a queue that distinguishes fresh
questions from previously concluded ones, affirmation is cheap but always human, and the firm can
produce the exhibit. Read models and routes only; the Svelte surface is a later slice.

### Task 5.1 — The reviewer queue read model

- [ ] Add `readAdjudicationQueue(database, matterId | firmWide)`: hits grouped by tier, then by state
      (`undisposed`, `answered-before`, `disposed`), each carrying its evidence, path, and — for
      `answered-before` — the prior disposition's kind, reviewer, rationale, and date.
- [ ] The `answered-before` test is **byte-identical evidence**: same entity, same tier, same
      matched-fields set, same path, same expiry facts. Any strengthening at all makes it a fresh
      question.
- [ ] Cursor-paginated through the shipped pagination helper; no unbounded read.

### Task 5.2 — Bulk affirmation, and the structural refusal to auto-clear

- [ ] `ALTER TABLE conflicts_disposition ADD COLUMN carried_from_disposition_id TEXT` (nullable).
      **No `DISPOSITION_KINDS` value is added** and the `kind` CHECK is not widened.
- [ ] `affirmPreviouslyConcluded(hitIds, reviewerUserId, rationale)` writes one **real** disposition
      row per hit, each naming the **affirming** member and each carrying
      `carried_from_disposition_id`. One atomic batch, one audit row, idempotency-keyed.
- [ ] A `BEFORE INSERT` trigger on `conflicts_disposition` aborts a row whose `reviewer_user_id` does
      not name a live member.
- [ ] A source-scan fitness function fails the build if either re-check consumer imports
      `disposition.ts`.
- [ ] The carry-forward mode (`restate` with grouping, or `re-review` with none) is a firm setting
      recorded on the check (**F4**).

### Task 5.3 — Tiered disposition authority (F5)

- [ ] Firm policy `tier1DispositionAuthority`: `any-disposer` | `designated-attorney`.
- [ ] When `designated-attorney`, a disposition of a tier-1 hit by a member who is not the designated
      responsible attorney is refused with a typed error and a 403 problem response.
- [ ] The policy in force is recorded on the disposition row, so a later reader knows which rule
      governed the act.

### Task 5.4 — The conflicts report artifact

- [ ] `buildConflictsReport(matterId)` assembling: every check chronologically with its scope in force
      verbatim; every hit with evidence, tier, and path; every disposition with reviewer, rationale,
      and timestamp; every `unavailable` source with its reason; every truncation; and the re-check
      ledger with the interval between each cause and the check that satisfied it.
- [ ] Render through the existing document-assembly and PDF path. No new rendering machinery.
- [ ] The document is titled a report and states what was searched and found. It draws no conclusion,
      carries no signature block, and contains no identifier value.
- [ ] The signable engagement memorandum is **not built** — it is F12.

### Task 5.5 — Close-out

- [ ] `docs/user/` pages: reading a conflicts report; working the adjudication queue; what "previously
      concluded" means and why the platform still asks.
- [ ] `packages/conflicts/CLAUDE.md`: the three-state lifecycle, the carry-forward-is-a-citation rule,
      and the two structural refusals to auto-clear.
- [ ] Status fragment `status.d/slice-4-1-conflicts.md` updated for the deepening (the slice's own
      fragment, per the append-don't-collide rule).
- [ ] Changelog fragment and, where a slice settled something the design left open, an ADR fragment.

---

## Verification per slice

- `pnpm check:scoped` in the inner loop; the whole-repo `pnpm check` is the gate of record in CI.
- `pnpm test` for the affected packages, filtered by path.
- `pnpm run lint:process-refs`, `pnpm run lint:decisions`, `pnpm run lint:changelog-fragments`,
  `pnpm run lint:status`, and — from slice 1 — `pnpm run lint:conflicts-vocabulary`.
- Load-profile `measure` after slices 3 and 4; a regression against the shipped conflicts
  measurements blocks the slice.
- Redirect each command to a file and read its own exit code. Never judge a command through a pipe.
