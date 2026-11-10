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
- `src/check-numbering.ts` — the check-number sequence's tables (`conflicts_check_number_counter` /
  `conflicts_check_number_allocation`, owner column `check_id`) and the rendered-number collision
  the counter cannot see. The number's SHAPE is not here: it is the `conflicts_check` purpose on
  `@magna-carta/sequence-numbering`'s numbering register (CC2026-00001 by default, restarting each
  year), written by the firm on the one numbering settings screen and drawn in `check-run.ts`
  through the shared planner under the shared bounded retry — never `MAX + 1`
- `src/settings.ts` — `ConflictsPolicy` (the firm-set floor), `resolveScope` (raises a request to the
  floor, never lowers it), `normalizeConflictsPolicy` (every guard the floor carries, in one
  function), `readConflictsPolicy` (falls back to `DEFAULT_CONFLICTS_POLICY`, normalizing whatever it
  loads) and `writeConflictsPolicy` (the one write path, normalizing through the SAME function and
  storing the result, audited as `conflicts.policy.changed`)
- `src/evidence.ts` — `assignTier` (identifier > exact name > phonetic > trigram-only; a candidate
  with no recorded signal still lands at tier 4, never disappears), `describeEvidence` (the
  reviewer-facing explanation string list)
- `src/edge-classes.ts` — the edge-type → edge-class map (`corporate` / `control` / `family` /
  `representation`) and `edgeClassOf`. One home, so the traversal, the settings, and the recorded
  scope can never disagree about which class an edge type belongs to
- `src/expansion.ts` — `expandGraph`: breadth-first traversal over `directory_edge`, one batched edge
  read per round rather than one per node. Budgeted per edge class rather than by one integer;
  corporate-family edge types bypass the budget entirely and are bounded only by the per-run closure
  cap. Returns the closure **plus** a truncation record when the cap stopped it. Degree-based hub
  suppression is refused here, in a comment, because this is where the temptation is
- `src/candidate-bound.ts` — `boundCandidateHits`: the second bound. The closure cap bounds the walk;
  this bounds what the walk's matching produced, which is the walk times the corpus. Applied to the
  similarity channels' output in `run-check.ts` and nowhere near either matcher, so the batched/
  per-entity equivalence proof stays a proof about the whole answer. Keeps the strongest evidence,
  never refuses a co-party hit, and returns a truncation record counting the refusal by tier
- `src/subject-facts.ts` — `readSubjectFacts` (one entity) and `readSubjectFactsBatch` (one query per
  node table over a whole closure). One home for "which node table, which columns, what does an
  absent row mean", so the two can never answer it differently. `readEntityDisplayNames` is the same
  question asked for a READER rather than the matcher — the one name the Directory shows, resolved on
  the read rather than copied onto the append-only log, so a reviewer deciding today sees the name the
  firm holds today. An id that resolves to nothing is absent from the map, and the caller reports that
  as an UNRESOLVED party, never as an absent one
- `src/imputation.ts` — `findImputationHits`: identity join `matter_party` → `directory_person` →
  `member`, never a similarity matcher
- `src/matching.ts` — `matchOptionsFor` (the strictness → `MatchOptions` mapping), `matchPartyBatch`
  (the set-valued matcher the check runs: each blocking channel once over the whole closure, plus a
  set-valued exact-name probe), `matchParty`
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
- `src/file-search.ts` — Files: asks each matter's file contents index (through an injected
  `FileContentsSearcher` the application supplies; never a review set's corpus) for each subject
  party's names as exact phrases, bounded by `FILE_QUERY_CEILING`, and keeps only files the database
  still files on that matter and the options asked for. No searcher, or an unreachable index, records
  `files` unavailable rather than searched and empty. Never stores document text.
- `src/content-search.ts` — the firm's own records as places a check searches: calls and texts
  (`communication`), email (`email_participant` and `email_message.subject`), tasks (`matter_task`
  title and body, by matter status) and Magnus conversations. `readPartyNeedles` reads what each
  subject party is looked for by (names as written, under the check's name roles; email addresses;
  phone digits); `searchContent` runs one small function per place and returns one `content`-class
  result per party per record, identity at tier 1 and the name compared whole at tier 2. Names in
  calls and texts, tasks and Magnus are asked of the firm's record index
  (`@magna-carta/search/record-index-query`, index-led, one exact phrase per name, firm-wide), at
  most `NAME_RESULT_CEILING` records per name per place, with the names that reached it counted on
  the record. Numbers, addresses, linked records and email (not an index source) stay on LIKE and
  equality over their own columns. `found_in_json` on the hit says where (`FoundIn`: kind, id,
  matter, instant), never the record's text, because the log outlives the record
- `src/disposition.ts` — `recordDisposition` (validates a non-blank rationale and that the hit exists
  before composing the batch, then appends a `conflicts_disposition` row), `readCurrentDisposition`
  (latest row by `created_at` — the append-only table's read-side "current state" projection),
  `readHitDispositionStates` (every hit of one check with its latest disposition, in **one** query —
  the same tie-break, without the per-hit N+1 the posture read cannot afford), `readDispositionTrail`
  (EVERY answer on one hit, oldest first — the compliance artifact the append-only rule exists for, so
  a reversed clearance stays readable beside the answer that replaced it), and `readPriorConclusions`
  (what the firm already said about the same parties on any OTHER check)
- `src/posture.ts` — `readMatterConflictsPosture`: the **only sanctioned way to ask where a matter
  stands on conflicts**. Computed from rows at read time, stores nothing, writes nothing. Also the
  shared readers of a stored check row (`parseCheckScope`, `parseCheckInputs`, `reportedSourcesFor`),
  so the posture read and the check read can never explain the same row differently
- `src/report-text.ts` — `describeCheck`: the pure statement list for one check — what ran with what
  settings over how many entities, what did not run and why, and what surfaced. Zero hits ends
  `"0 results."`
- `src/sources.ts` — the one home for what a check can search, what it cannot, and why:
  `availabilityOf` (the write side), `unavailabilityReason` and `displayNameForSource` (the read side)
- `src/topics.ts` — the two outbox topics this package publishes, as one frozen set:
  `conflicts.recheck.requested` (the drain signal, written in the same batch as the ledger rows) and
  `conflicts.hit.surfaced` (the notification's subscription, emitted only by an automated run that
  found something)
- `src/recheck-settings.ts` — the firm's re-check configuration (`maxMattersPerEvent`, whether the
  scheduled re-scan runs and how often, the batch size) plus the last-run marker and `periodicRescanIsDue`
- `src/recheck-cause.ts` — `resolveAffectedMatters`: one bounded indexed query per cause topic
  answering "which already-checked matters could this corpus change have changed the answer for", and
  `triggerForCauseTopic`. `directory.entity.created` deliberately resolves to **nothing**
- `src/recheck-request.ts` — `recordRecheckRequests`: the write half of the request path. Writes a
  ledger row for **every** affected matter and queues at most `maxMattersPerEvent` of them
- `src/recheck-run.ts` — `satisfyRecheckRequestsForMatter`: claim a matter's open causes, coalesce
  every one into a single check that names them all, stamp each claimed row. Shared by the queue
  consumer and the cron backstop so the two can never answer a matter differently
- `src/recheck-statements.ts` — SQL for `conflicts_recheck_request`: the `ON CONFLICT DO NOTHING`
  insert, the guarded satisfaction stamp, the per-matter and oldest-first reads
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
- **`over_inclusive` is a strict superset of `balanced`, and it is structural rather than careful.**
  Raising strictness may only add candidates, never hide one. `matchOptionsFor` returns a narrower
  `MatchOptions` for `balanced` (primary Double Metaphone scheme, the firm's name-role set) and an
  unrestricted one (`{}`) for `over_inclusive`. What makes the relationship hold under a CONFIGURABLE
  name-role set is that over-inclusive is the one band a firm cannot narrow: it always searches every
  role, so whatever set is configured for balanced is a subset of it. A future channel may be enabled
  only at the wider band without breaking the invariant; one enabled at balanced and disabled higher
  up would break it. The superset test in `test/matching.test.ts` and
  `test/matching-depth.test.ts` guard it against the directory's real corpus rather than a mock.
- **Which NAME ROWS a check compared is a setting, and the row says which.** `strictness` is a preset
  name — a word whose meaning moves as channels are added — so it is no longer the only evidence of
  what ran. `ConflictsPolicy.balancedNameRoles` is the firm's setting for the narrower band (shipped
  default: current, former, maiden, alias, so a party who married and changed surname is found there),
  `resolveScope` resolves it, and `runConflictsCheck` writes `inputs_json.matching` with the name keys
  compared, the phonetic schemes that ran, and the resolved roles. `null` roles means every role the
  corpus holds, which is a distinct statement from a list that happens to name them all: a firm adding
  a role later is covered by the first and not the second. A stored set that is corrupt or emptied
  falls back to the default, and `current` is unioned back in unconditionally — a check that did not
  compare the name the party goes by today is not a conflicts check.
- **What is STORED as the firm's policy is what runs.** The read repairs an unsound stored policy on
  the way out, which is right for a value this platform did not write — and it becomes a trap the
  moment something can write one, because a stored value and an effective value then differ whenever
  the stored one is unsound. A settings screen that saved `floorSources: []`, re-read `[]`, and
  displayed it would be showing a floor no check would ever run. So `normalizeConflictsPolicy` holds
  every guard once, `readConflictsPolicy` and `writeConflictsPolicy` both call it, and the write
  stores the NORMALIZED value: the row is the effective policy, the read's repairs go back to being a
  backstop against corruption and hand edits rather than a routine correction of this platform's own
  writes, and read and write cannot drift because there is one implementation.
  `test/policy-write.test.ts` asserts against the raw `setting` row rather than the read's answer,
  since a repairing read would make a broken write look correct. The write is also the reason
  `conflicts:configure` exists as a key of its own: it does not act on a check, it decides what every
  LATER check searches, and no check row records that a person chose it.
- **Seven blocking channels now, and three of them are probes in this package.** The directory's shared
  corpus reader offers exactly three (phonetic, trigram, blind-index) and widening it would change what
  entry-time duplicate detection and merge see, so the exact-name probe, the two match-key probes, and
  the Beider-Morse phoneme probe live in `matching.ts` against `directory_name` directly. All four are
  ONE implementation parameterised by key column, so the merge-resolution `COALESCE`, the
  deleted-entity exclusion, and the name-role scoping cannot come to differ between them — and so the
  single-subject and set-valued matchers run the same predicate rather than two meant to agree. Tiering:
  `normalized_match_key` equality is **tier 2** (one name written two ways), `normalized_match_key_bare`
  and Beider-Morse are **tier 3**. `CHECK (evidence_tier BETWEEN 1 AND 4)` is NOT widened — that is a
  rebuild of a growing append-only table — so a new signal maps into the existing rungs and names
  itself in `matched_fields_json`.
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
     `"0 results."`, which is a fact about the machine's own behaviour. Facts about the machine
     are the only assertions this package makes: these channels ran, this source has no corpus, this
     many candidates surfaced.
  3. **`cleared` survives only as a `DISPOSITION_KINDS` value** — a named human's conclusion about one
     hit, on a row carrying that human's identity and rationale.

  `pnpm run lint:conflicts-vocabulary` (`tooling/lint-conflicts-vocabulary/index.mjs`) enforces all
  three by source scan over this package, the conflicts route, the web conflicts surfaces, and
  `docs/user/`, and runs in the gate's governance step. Prose that exists to state the rule rather than
  to break it carries an inline `conflicts-vocabulary:allow — <reason>` marker on the same line; a
  verdict-shaped **field name** has no such escape hatch.

- **A cause is coalesced, never discarded, and never trimmed.** Every affected matter gets a
  `conflicts_recheck_request` row — the caps in `recheck-settings.ts` bound how many are ATTEMPTED in
  one queue invocation, never how many are recorded, because a trimmed set is a conflict the platform
  noticed and then forgot. Several causes accumulated for one matter collapse into ONE check whose
  `cause_json` names them all; the drain running out of budget leaves rows open, which is a visible
  state the posture read reports. The ledger's own rules are enforced by triggers rather than by
  convention: the cause columns cannot be rewritten, a satisfaction cannot be reopened, and no row is
  ever deleted — the interval between a cause and the check that answered it is the evidence that the
  firm's procedure noticed something, and no check row alone can show it.
- **The automated path cannot conclude anything.** `recheck-cause.ts`, `recheck-request.ts`,
  `recheck-run.ts`, and the worker's two consumers must never import `disposition.ts` or call
  `recordDisposition`. A run that nobody asked for, under nobody's authority, writing a row that names
  a member as having concluded something is the one failure this subsystem cannot recover from — so it
  is enforced on the source text by `test/automated-path-cannot-dispose.test.ts` and the worker's
  `test/conflicts-recheck-consumers.test.ts`, and a database trigger refusing a disposition whose
  reviewer is not a live member lands with the adjudication read models as the second layer. Request
  and run are separate consumers for a different reason and the same discipline: a slow check must not
  back-pressure the recording of causes, so the request consumer never imports `runConflictsCheck`.
- **An automated run is nobody's act.** `actorUserId` is null and `effectivePermissions` is empty on
  the context the worker builds for it (`apps/api-worker/src/conflicts/recheck-context.ts`). The matching
  channels compare sealed identifiers by blind index, which needs no permission and writes no decrypt
  audit; a path that needed a real decrypt would fail there, loudly, which is the correct outcome for
  machinery running under nobody's authority. `trigger_source` records what set the run going, kept
  beside `actor_user_id` rather than derived from it — an absent actor says nobody is being credited,
  not whether a person, an event, or the clock started it.
- **Staleness is derived, never written.** `scopeShortfall` compares the latest check's recorded scope
  against the **live** `conflicts.policy` row on every read, so raising the firm floor makes the
  shortfall appear immediately on every affected matter with no sweep and no write. This is the
  posture `packages/calendar/src/overdue.ts` holds for an overdue deadline: the platform computes the
  comparison and reports it; it never writes a judgement onto a record and lets it rot.
- **A truncated expansion is never reported as a completed one.** Traversal is bounded — an unbounded
  walk over a real corporate group is an availability problem — but the bound is **recorded and
  reported**, never applied silently. On reaching the per-run closure cap, `expandGraph` stops and
  returns a truncation record; `runConflictsCheck` writes it into the check row's `inputs_json` under
  `traversal`, the posture read carries it on `latestCheck.scope.traversal`, and `describeCheck`
  states in words that the search of the graph is incomplete, with how many entities were refused. A
  check row that predates the record reports `traversal: null` — "the row does not say", which is a
  third state and is never flattened into either of the other two. This is the depth analogue of the
  `unavailable`-is-never-`searched` rule below, and it fails the same way if broken: the platform
  telling a firm it looked somewhere it did not look.
- **There are TWO bounds, because a cap on the walk is not a cap on the work.** Hits scale as the
  closure TIMES the corpus, not as the closure: with the closure pinned, candidates per subject rise
  linearly with the Directory — measured at roughly six tenths of the organization corpus for an
  organization subject and a tenth of the person corpus for a person, with around ninety-nine per cent
  of the volume being candidates whose ONLY signal is trigram overlap, because a trigram-OR match asks
  whether two names share ONE three-character window and multi-word names nearly always do. So
  `candidateCap` sits beside `closureCap` on `ConflictsPolicy` and bounds what a run WRITES. Four
  rules, and they are the reason it is not a threshold: below the cap nothing is chosen, reordered, or
  recorded; when it must refuse it keeps the strongest evidence and records the refusal per tier, so a
  run that lost anything above tier 4 is visibly alarming; a **co-party surfacing is never refused**
  (subject parties bypass the closure cap for the same reason, and the bypass has the same
  consequence); and it lives outside both matchers, so `test/matcher-equivalence.test.ts` still proves
  the batched path returns exactly the per-entity path's hit set rather than the same narrowed one.
  The record travels the road `traversal` already does — check row, posture read, report sentence —
  and a run whose cap refused everything deliberately does **not** end `"0 results."`, which is
  a fact about the machine having written everything it found. Re-measured by
  `conflictsCandidateBounds` in `packages/fixtures/src/load-profile/conflicts-measurements.ts`; two
  baselines at different profile scales are the corpus sweep.
- **The bound is on the SIZE of the closure, never on the SHAPE of the graph.** Degree-based hub
  suppression — skip any node carrying more than N edges — is refused and stays refused. A clearing
  bank or a registered agent on five hundred matters is precisely where a positional conflict lives,
  and a search that quietly steps around it has narrowed itself with nothing on the record to say so.
  Reaching a size cap is a fact a check can record; stepping around a hub is not. A firm may mark an
  entity non-expandable — that is a recorded, attributable firm assertion, and a different thing from
  a platform heuristic. Held by `test/expansion.test.ts`.
- **Expired edges are traversed, with the expiry on the path step.** An ended relationship — a
  divorced spouse, a subsidiary sold last year — is walked, not skipped: the rules that most often
  decide a conflict are about FORMER clients and FORMER relationships, so a traversal that stopped at
  currency would drop the dimension they turn on. `EdgeStep.expiredAtCheck` carries it so the reviewer
  weighs it. Expiry is judged against the CHECK'S OWN clock (`ExpansionBudget.asOf`), never an ambient
  `new Date()`, so a long walk cannot hold two opinions about when a relationship ended.
- **The batched matcher returns exactly the per-entity matcher's hit set.** `matchPartyBatch` and
  `readSubjectFactsBatch` exist to make the query count follow the channel count instead of the entity
  count; they are held to returning the same answer, not a similar one, by
  `test/matcher-equivalence.test.ts` over a real migrated corpus carrying every shape the channels
  distinguish. A performance change here that alters which hits come back is not a refactor — it is a
  missed conflict, which is a professional-conduct failure rather than a latency regression. Any
  future channel added to one path must land in the other in the same change, and the equivalence test
  must be extended to a corpus that exercises it.
- **A source that cannot run records `unavailable`, never `searched`.** The `content` class (as
  asked for directly, meaning document text, which is Files) and `prior_firm_history` have no corpus
  yet and are always `unavailable`. Messaging, tasks and Magnus are recorded under their own keys
  (`messaging`, `tasks`, `magnus_conversations`), `searched` exactly when the check asked for them
  and absent otherwise; their hits carry the `content` class and a `found_in_json`. `imputation` is `unavailable`
  on a check with no `matterId` (there is nothing to join firm members against), regardless of how the
  general availability table classifies the source class. `unavailable` must never be conflated with
  "searched and clean" — an auditor reading the log has to be able to tell the two apart.

## Dependencies & contracts

- Depends on: `@magna-carta/directory` (`findDuplicateCandidates`, `readEdges`, `readMatterParties`,
  `readPerson`/`readOrganization`, `normalizeName`, the identifier statements — read-only, this package
  never writes a Directory table), `@magna-carta/data-access` (effect batches, `composeEffectBatch`,
  the idempotency/audit seams), `@magna-carta/database` (per-firm schema), `@magna-carta/identifiers`,
  `@magna-carta/access-control` (`conflicts:run` / `conflicts:dispose` / `conflicts:configure`
  permissions).
- Pure and synchronous per operation except for its own database reads: produces statements for the
  caller to run via the data-access layer; holds no D1 binding of its own and calls no external
  service.
- The worker routes (`apps/api-worker/src/http/routes/directory/conflicts.ts`) are the only callers of
  `runConflictsCheck` / `recordDisposition` / `readMatterConflictsPosture` / `writeConflictsPolicy` —
  they own threading `env`, the actor, and idempotency.

## Gotchas

- `readEdges` in `packages/directory/src/edges.ts` reads an ambient `new Date()` when no `asOf` is
  supplied. The traversal always supplies one (and `includeExpired`), so its own reads are pinned; any
  other caller in this package must pass the check's clock rather than depending on wall time.
- Corporate-family edges (`corporate_parent`/`corporate_subsidiary`/`corporate_successor`) bypass the
  hop budget in `expandGraph` deliberately — a rename, merger, or successor entity must still match
  regardless of chain length. Every other edge type spends its own class's budget, and an edge type
  this build has never heard of takes the WIDEST budget in force rather than the narrowest: the schema
  admits any non-empty string, and a new relationship type that quietly became unwalkable would be a
  conflict the engine stopped looking for without anybody choosing that.
- The shipped `conflicts_check.depth` column still exists and still means something: `resolveScope`
  records the WIDEST resolved per-class budget there, so a reader of the column alone is never told
  the traversal was shallower than it was. The per-class detail lives in `inputs_json.traversal`.
- Per-class budgets are a Pareto-vector relaxation, not a scalar one. A path's cost is one number per
  edge class, and collapsing that vector to its sum would let a path that has spent its whole family
  budget look cheaper than one that spent two control hops and can still walk a family edge — which
  drops real conflicts, silently. `expansion.ts` keeps the Pareto-minimal set of cost vectors per
  entity for that reason; the reported path is the cheapest, then shortest, then lexicographically
  first by edge id, so one corpus always yields one explanation.
- `composeEffectBatch` refuses a batch past `MAX_BATCH_STATEMENTS` (10,000), and every hit of a check
  rides one batch with the check row. `resolveScope` therefore clamps `candidateCap` below that
  ceiling: a firm that raised the cap past what one transaction can carry would turn a truncation the
  platform reports into a check that fails outright, and a bounded answer on the record beats none.
  The two bounds compose mechanically rather than by convention — see `MAX_CANDIDATE_CAP`.
- Every set-valued read in this package chunks its IN list at 100 bindings, because that is D1's
  bound-parameter cap (`MAX_BOUND_PARAMETERS` in `packages/ledger/src/statements.ts`). The query count
  is therefore proportional to channels times ceil(entities / 100), not to entities times channels —
  a small fan for a platform limit, not a return of the N+1.
- Drizzle-kit cannot model triggers; the six append-only guard triggers live in the hand-written
  migration `.sql` (`packages/database/drizzle/per-firm/20260709T120000_conflicts.sql`), like the
  Directory FTS5 triggers, and are verified by `packages/database/test/conflicts-append-only.test.ts`
  plus `assertConflictsFitness`.
- **The posture read does not check that the matter exists**, and that is deliberate: a 404 on an
  unknown matter would make "never checked" and "no such matter" the same answer, which is the
  conflation the whole read exists to prevent. `neverChecked` is the answer for both.
- **`pendingRecheck` is read for a never-checked matter too.** A matter nobody has ever run a check on
  can still be owed one — a party added to a matter that predates the engine — and reporting nothing
  pending because there is no check would hide exactly the case that most needs saying.
- The posture read's counts are scoped to the **latest** check. An earlier check's hits stay on the
  record and are read through that check.
- **A re-surfaced hit cites an earlier conclusion as CONTEXT and is never marked concluded**
  (`readPriorConclusions`; the owner's ruling of 2026-09-02). It matches on the ENTITY alone, and the
  check response carries it as `previouslyAnswered` — a field deliberately separate from
  `disposition`, so the hit stays unanswered. The case that settled it: a company cleared under Rule
  1.9 as a FORMER client re-surfaces through the graph as the subsidiary of a CURRENT client, which is
  a Rule 1.7 question on a higher bar. Same entity, different question. Narrowing the key does not
  make the judgment safer — adding the source class would hide that second hit precisely BECAUSE it
  arrived through the graph, and adding the evidence tier would make a firm turning on the
  over-inclusive band look like a new conflict. Nothing downstream may turn this into a disposition, a
  pre-filled answer, or a reason to suppress the hit.
- `matchParty`'s exact-normalized-name probe is a direct SQL query against `directory_name`, not a
  fourth blocking channel added to `findDuplicateCandidates` — the directory's shared corpus reader
  stays phonetic/trigram/blind-index only; tier 2 (exact name) is scored here, in this package. The
  probe is **strictness-scoped** (balanced passes `nameRoles:["current"]`, so a former/alias exact
  match stays balanced-invisible like the fuzzy channels) and **additive** (an exact match surfaces as
  a candidate even when no fuzzy channel returned it — a tier-2 signal is never dropped).
