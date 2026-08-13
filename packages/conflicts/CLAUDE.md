# @magna-carta/conflicts — CLAUDE.md

**Purpose.** The conflicts-of-interest matching engine. Firm-wide, deterministic, no scorer: every
candidate the blocking channels surface is shown to a reviewer, ranked by evidence tier, and nothing
is ever suppressed by a threshold. Consumes the Directory conflicts corpus (`@magna-carta/directory`
— phonetic codes, FTS5 trigram, blind-index identifiers, typed edges) without changing its write
path. Runs a check across a typed source registry (party similarity, graph traversal, identity-join
imputation, a registered-but-unavailable content class), writes an immutable three-table log, and
records reviewer dispositions as a fourth append-only stream. Validates in memory and composes
statements into `@magna-carta/data-access`'s `composeEffectBatch`; never runs logic mid-transaction
and never calls external services.

**White paper:** _Conflicts_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Spec:**
[`docs/specs/2026-07-09-slice-4-1-conflicts-design.md`](../../docs/specs/2026-07-09-slice-4-1-conflicts-design.md).
**Plan:**
[`docs/specs/2026-07-09-slice-4-1-conflicts-implementation-plan.md`](../../docs/specs/2026-07-09-slice-4-1-conflicts-implementation-plan.md).

## Key files / entry points

- `src/types.ts` — domain types + open catalogs: `SourceClass` (`party`/`graph`/`imputation`/
  `content`), `Strictness` (`balanced`/`over_inclusive`), `ConflictsTrigger`, `DispositionKind`,
  `SourceAvailability` (`searched`/`unavailable`), `EvidenceTier` (1-4, ordering only), `MatchEvidence`,
  `EdgeStep`
- `src/settings.ts` — `ConflictsPolicy` (the firm-set floor), `resolveScope` (raises a request to the
  floor, never lowers it), `readConflictsPolicy` (falls back to `DEFAULT_CONFLICTS_POLICY`, always
  unions `party` back into `floorSources` even from a corrupt or hand-edited stored row)
- `src/evidence.ts` — `assignTier` (identifier > exact name > phonetic > trigram-only; a candidate
  with no recorded signal still lands at tier 4, never disappears), `describeEvidence` (the
  reviewer-facing explanation string list)
- `src/expansion.ts` — `expandGraph`: breadth-first traversal over `directory_edge` via `readEdges`;
  corporate-family edge types (`corporate_parent`/`corporate_subsidiary`/`corporate_successor`) bypass
  the depth budget, every other edge type obeys it
- `src/imputation.ts` — `findImputationHits`: identity join `matter_party` → `directory_person` →
  `member`, never a similarity matcher
- `src/matching.ts` — `matchOptionsFor` (the strictness → `MatchOptions` mapping), `matchParty`
  (wraps `findDuplicateCandidates` + a direct exact-normalized-name probe, since the directory's three
  blocking channels are phonetic/trigram/blind-index and exact-name has no channel of its own). Passes
  the subject's own entity id as `subjectEntityId` so the blind-index channel fires the **tier-1
  exact-identifier** match over the subject's sealed SSN/EIN/DL/account — a name-mismatched identifier
  twin surfaces here; without it tier 1 could never fire for a party.
- `src/run-check.ts` — `runConflictsCheck`: the check orchestrator — resolves scope, expands the
  graph, matches every reached entity, joins imputation, records source availability (including
  `prior_firm_history`, permanently `unavailable` — a registered source with no table), and writes
  the check + hit rows in one atomic batch. A match that lands back on one of the check's **own**
  subject parties is a co-party surfacing: it is never dropped (dropping it would hide a positional
  conflict between two different parties of the same matter), only flagged `co_party` on the hit so a
  reviewer buckets it apart from a conflict with a prior/other client. The only match that is dropped
  is an entity matching **itself** (`match.entityId === entity.entityId`).
- `src/disposition.ts` — `recordDisposition` (validates a non-blank rationale and that the hit exists
  before composing the batch, then appends a `conflicts_disposition` row), `readCurrentDisposition`
  (latest row by `created_at` — the append-only table's read-side "current state" projection),
  `readHitDispositionStates` (every hit of one check with its latest disposition, in **one** query —
  the same tie-break, without the per-hit N+1 the posture read cannot afford)
- `src/posture.ts` — `readMatterConflictsPosture`: the **only sanctioned way to ask where a matter
  stands on conflicts**. Computed from rows at read time, stores nothing, writes nothing. Also the
  shared readers of a stored check row (`parseCheckScope`, `parseCheckInputs`, `reportedSourcesFor`),
  so the posture read and the check read can never explain the same row differently
- `src/report-text.ts` — `describeCheck`: the pure statement list for one check — what ran with what
  settings over how many entities, what did not run and why, and what surfaced. Zero hits ends
  `"Nothing surfaced."`
- `src/sources.ts` — the one home for what a check can search, what it cannot, and why:
  `availabilityOf` (the write side), `unavailabilityReason` and `displayNameForSource` (the read side)
- `src/statements.ts` — SQL statement builders for the three tables; `CONFLICTS_CHECK_TABLE` /
  `CONFLICTS_HIT_TABLE` / `CONFLICTS_DISPOSITION_TABLE` names, tracked by the schema-name-sync fitness
  test; INSERT only — there is no update or delete builder for any of the three tables
- `src/audit.ts` — `ConflictsWriteOptions` (the shared clock/actor/randomSource/idempotency shape
  every write module takes), `conflictsAuditStatement`
- `src/run-conflicts-effect.ts` — `runConflictsEffect`: the single seam every conflicts mutation
  commits through, a thin delegate over `runDomainEffect` that renames the idempotency-conflict error
  to a package-local one; mirrors `runDirectoryEffect` so the two packages never drift
- `src/fitness.ts` — `assertConflictsFitness` + the five per-invariant probes (append-only triggers
  present, no orphan hits, no orphan dispositions, no plaintext identifier in `inputs_json`, every
  hit's evidence well-formed)
- `src/index.ts` — public barrel

## Invariants that apply here

- **The three log tables are append-only.** No `UPDATE`, no `DELETE`, ever, on `conflicts_check`,
  `conflicts_hit`, or `conflicts_disposition`. SQLite `RAISE(ABORT)` triggers enforce it at the
  database layer — six triggers, two per table — so nothing in application code can silently reopen
  the log to mutation even if a future statement builder tried. `assertConflictsFitness` proves the
  triggers exist by checking `sqlite_master` directly rather than trusting the migration ran intact. A
  reviewer who reverses an earlier disposition appends a new row; the prior row is never touched.
- **Nothing is ever suppressed by tier.** Evidence tiers order and group a reviewer's queue; they
  never remove a hit. A candidate with no recorded signal still lands at tier 4. There is no score and
  no threshold anywhere in this package — a threshold is a mechanism for converting missed conflicts
  into invisible ones.
- **`over_inclusive` is a strict superset of `balanced`.** Raising strictness may only add candidates,
  never hide one. `matchOptionsFor` returns a narrower `MatchOptions` for `balanced` (primary Double
  Metaphone scheme, current-name rows only) and an unrestricted one (`{}`) for `over_inclusive`; any
  change to that mapping must preserve the superset relationship, and the superset test in
  `test/matching.test.ts` guards it directly against the directory's real corpus rather than a mock.
- **Imputation matches by identity only, never name similarity.** `imputation.ts` must never import
  `findDuplicateCandidates`, `phoneticCodes`, or `normalizeName`. Firm personnel carry a flat display
  name with no phonetic code and no FTS entry, so they are structurally invisible to the similarity
  channels — fuzzy-matching them would make a firm named "Smith Law" hit every client named Smith, on
  every check, forever. The conflict is a firm member genuinely _being_ a party, which is an identity
  join (`member.user_id` → `directory_person.member_id` → `matter_party`/`directory_edge`), never a
  surname collision.
- **No plaintext identifier value enters the log.** `conflicts_check.inputs_json` records identifiers
  by `directory_identifier.id` reference (plus the `identifier_type`), never `value_ciphertext` or
  `value_blind_index`, and certainly never a decrypted value. `findPlaintextIdentifiersInChecks`
  sweeps every stored `inputs_json` for a nine-consecutive-digit run as the structural guard.
- **The platform never asserts that a matter is free of conflict** (conflicts-vocabulary:allow —
  states the rule). It reports what it searched, what it could not search, and what surfaced; the
  conclusion is a lawyer's and the record says whose. Three things follow, and all three are
  mechanical rather than conventional:
  1. **`readMatterConflictsPosture` is the sanctioned read, and it has no aggregate.** No field named
     `clear`, `clean`, `ok`, `passed`, `status`, `severity`, or `conflictFree` (conflicts-vocabulary:allow — the banned list itself), and no summary
     boolean. `neverChecked` is the one boolean, and it reports whether a search happened — never what
     one concluded. A caller that wants a single word writes it itself and owns it.
  2. **A zero-hit check reports the search ending, not a clearance.** `describeCheck` finishes
     `"Nothing surfaced."`, which is a fact about the machine's own behaviour. Facts about the machine
     are the only assertions this package makes: these channels ran, this source has no corpus, this
     many candidates surfaced.
  3. **`cleared` survives only as a `DISPOSITION_KINDS` value** — a named human's conclusion about one
     hit, on a row carrying that human's identity and rationale.

  `pnpm run lint:conflicts-vocabulary` (`tooling/lint-conflicts-vocabulary/index.mjs`) enforces all
  three by source scan over this package, the conflicts route, the web conflicts surfaces, and
  `docs/user/`, and runs in the gate's governance step. Prose that exists to state the rule rather than
  to break it carries an inline `conflicts-vocabulary:allow — <reason>` marker on the same line; a
  verdict-shaped **field name** has no such escape hatch.

- **Staleness is derived, never written.** `scopeShortfall` compares the latest check's recorded scope
  against the **live** `conflicts.policy` row on every read, so raising the firm floor makes the
  shortfall appear immediately on every affected matter with no sweep and no write. This is the
  posture `packages/calendar/src/overdue.ts` holds for an overdue deadline: the platform computes the
  comparison and reports it; it never writes a judgement onto a record and lets it rot.
- **A source that cannot run records `unavailable`, never `searched`.** The `content` class and
  `prior_firm_history` have no corpus yet and are always `unavailable`. `imputation` is `unavailable`
  on a check with no `matterId` (there is nothing to join firm members against), regardless of how the
  general availability table classifies the source class. `unavailable` must never be conflated with
  "searched and clean" — an auditor reading the log has to be able to tell the two apart.

## Dependencies & contracts

- Depends on: `@magna-carta/directory` (`findDuplicateCandidates`, `readEdges`, `readMatterParties`,
  `readPerson`/`readOrganization`, `normalizeName`, the identifier statements — read-only, this package
  never writes a Directory table), `@magna-carta/data-access` (effect batches, `composeEffectBatch`,
  the idempotency/audit seams), `@magna-carta/database` (per-firm schema), `@magna-carta/identifiers`,
  `@magna-carta/access-control` (`conflicts:run` / `conflicts:dispose` permissions).
- Pure and synchronous per operation except for its own database reads: produces statements for the
  caller to run via the data-access layer; holds no D1 binding of its own and calls no external
  service.
- The worker routes (`apps/worker/src/routes/conflicts.ts`) are the only callers of
  `runConflictsCheck` / `recordDisposition` / `readMatterConflictsPosture` — they own threading `env`,
  the actor, and idempotency.

## Gotchas

- `readEdges` (`packages/directory/src/edges.ts:127`) reads an ambient `new Date()`. Do not depend on
  it for deterministic expansion tests — pin or ignore the time-sensitive fields instead.
- Corporate-family edges (`corporate_parent`/`corporate_subsidiary`/`corporate_successor`) bypass the
  depth budget in `expandGraph` deliberately — a rename, merger, or successor entity must still match
  regardless of hop count. Every other edge type obeys `depth` normally.
- Drizzle-kit cannot model triggers; the six append-only guard triggers live in the hand-written
  migration `.sql` (`packages/database/drizzle/per-firm/20260709T120000_conflicts.sql`), like the
  Directory FTS5 triggers, and are verified by `packages/database/test/conflicts-append-only.test.ts`
  plus `assertConflictsFitness`.
- **The posture read does not check that the matter exists**, and that is deliberate: a 404 on an
  unknown matter would make "never checked" and "no such matter" the same answer, which is the
  conflation the whole read exists to prevent. `neverChecked` is the answer for both.
- The posture read's counts are scoped to the **latest** check. An earlier check's hits stay on the
  record and are read through that check; cross-check hit identity (a re-surfaced hit that cites an
  earlier conclusion) is the adjudication read model's job and lands with it.
- `matchParty`'s exact-normalized-name probe is a direct SQL query against `directory_name`, not a
  fourth blocking channel added to `findDuplicateCandidates` — the directory's shared corpus reader
  stays phonetic/trigram/blind-index only; tier 2 (exact name) is scored here, in this package. The
  probe is **strictness-scoped** (balanced passes `nameRoles:["current"]`, so a former/alias exact
  match stays balanced-invisible like the fuzzy channels) and **additive** (an exact match surfaces as
  a candidate even when no fuzzy channel returned it — a tier-2 signal is never dropped).
