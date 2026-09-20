import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { loadEffectivePermissions } from "../session-context.ts";
import {
  fileCheckOnMatterStatement,
  openCheckRun,
  openedRunBody,
  parseRunProgress,
  parseStoredRunRequest,
  previewNextCheckNumber,
  readNumberedCheckByAnyId,
  readLatestNumberedCheckForMatter,
  readRunsForCheck,
  RUN_STAGES,
  RUN_STATUSES,
  settleStaleRuns,
  UnknownNumberedCheckError,
  type CheckRunRow,
  type NumberedCheckRow,
  type StoredRunRequest,
} from "@magna-carta/conflicts/check-run";
import { type RunCheckInput } from "@magna-carta/conflicts/run-check";
import {
  recordDisposition,
  readDispositionTrail,
  readHitDispositionStates,
  readPriorConclusions,
  EmptyRationaleError,
  InvalidWaiverDateError,
  UnknownConsentingPartyError,
  UnknownHitError,
  UnknownWaiverDocumentError,
  WaiverRecordNotApplicableError,
  WaiverRecordRequiredError,
} from "@magna-carta/conflicts/disposition";
import { readEntityDisplayNames } from "@magna-carta/conflicts/subject-facts";
import {
  selectConflictsChecksStatement,
  type ConflictsCheckSummaryRow,
} from "@magna-carta/conflicts/statements";
import {
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
} from "@magna-carta/data-access/cursor-pagination";
import { cursorQuery, paginated } from "../contracts/pagination.ts";
import {
  parseCheckInputs,
  parseCheckScope,
  readMatterConflictsPosture,
  reportedSourcesFor,
} from "@magna-carta/conflicts/posture";
import { describeCheck, type ReportedSource } from "@magna-carta/conflicts/report-text";
import { ConflictsIdempotencyConflictError } from "@magna-carta/conflicts/run-conflicts-effect";
import {
  readConflictsPolicy,
  writeConflictsPolicy,
  type ConflictsPolicy,
} from "@magna-carta/conflicts/settings";
import { CONFLICTS_CHECK_TABLE, CONFLICTS_HIT_TABLE } from "@magna-carta/conflicts/statements";
import {
  CONFLICTS_TRIGGERS,
  DISPOSITION_KINDS,
  SOURCE_AVAILABILITIES,
  SOURCE_CLASSES,
  STRICTNESS_LEVELS,
} from "@magna-carta/conflicts/types";
import { WAIVER_SHORTFALLS, waiverShortfalls } from "@magna-carta/conflicts/waiver";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { ConflictsCheckId } from "@magna-carta/identifiers/types";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import { identifierField, identifierPathParam, idempotencyKeyHeader } from "../contracts/common.ts";
import type { Context } from "hono";
import type { Bindings } from "../bindings.ts";
import { runInBackground } from "../background.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { executeConflictsRunInBackground } from "../conflicts/check-run-executor.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";
import { firmKeyProviderForEnv } from "../firm-key-provider-wiring.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// The conflicts HTTP surface over the @magna-carta/conflicts domain package.
//
// A CHECK IS A NUMBERED RECORD WITH RUNS UNDER IT. Asking for a check opens it — the numbered
// check, its first run queued — and answers at once with the number a person will refer to it by;
// the search runs after the response and the check's read reports where it has got to until the
// run settles. A check can be run again from its own screen, which opens a further run under the
// same number, and it can be filed on a matter after it ran, which is the ordinary case: the
// pre-engagement screen happens before there is a matter to file it on. Every run's search record
// stays what it was — the immutable row a court is shown — and reading a check reads the record of
// whichever run is selected.
//
// Every mutation rides the chokepoint's idempotency gate (an Idempotency-Key is required); every
// handler hands the domain service the firm-scoped per-firm database, the real clock, a crypto
// random source, and the authenticated actor — none of which is ever client input.

// ---- shared service handles ----

// The read-side context every conflicts write needs to walk the directory corpus (firm key, database,
// effective permissions, acting user, clock, random source). Mirrors directory.ts's identifierContext:
// built here because the route is the only caller that owns env, actor, and crypto-context threading.
async function conflictsContext(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
): Promise<DirectoryIdentifierContext> {
  const firm = requireChokepointFirmContext(c);
  const firmId = requireChokepointFirmId(c);
  const actorUserId = requireChokepointUserId(c);
  const effectivePermissions = await loadEffectivePermissions(firm.firmDatabase, actorUserId);
  return {
    firmId,
    firmKeyVersion: 1,
    firmKeyProvider: firmKeyProviderForEnv(c.env),
    database: firm.firmDatabase,
    effectivePermissions,
    actorUserId,
    clock: { now: () => new Date().toISOString() },
    randomSource: cryptoRandomSource,
  };
}

function nowInstant(): string {
  return new Date().toISOString();
}

// A raw conflicts_check row, read directly (the package exposes no readCheck — it is a route-local
// concern, like the raw reads directory.ts performs for its own GET routes).
interface CheckRow {
  readonly id: string;
  readonly trigger: string;
  readonly subject_matter_id: string | null;
  readonly subject_parties_json: string;
  readonly scope_json: string;
  readonly strictness: string;
  readonly depth: number;
  // The inputs blob is read for the COUNTS the report sentence states (how many subject parties, how
  // many entities the traversal reached, which identifier types were skipped). It is never returned:
  // it also holds the identifier references, and the response has no business carrying them.
  readonly inputs_json: string;
  readonly floor_raised: number;
  readonly actor_user_id: string | null;
  readonly created_at: string;
}

async function readCheckRow(database: SqlDatabase, checkId: string): Promise<CheckRow | null> {
  const { results } = await database
    .prepare(
      `SELECT id, trigger, subject_matter_id, subject_parties_json, scope_json, strictness, depth, inputs_json, floor_raised, actor_user_id, created_at FROM ${CONFLICTS_CHECK_TABLE} WHERE id = ?1`,
    )
    .bind(checkId)
    .all<CheckRow>();
  return results[0] ?? null;
}

interface HitRow {
  readonly id: string;
  readonly entity_id: string;
  readonly source_class: string;
  readonly evidence_tier: number;
  readonly matched_fields_json: string;
  readonly graph_path_json: string;
  readonly co_party: number;
  readonly created_at: string;
}

// Whether a hit exists in THIS firm's database. The firm scoping is the handle to the per-firm
// database itself, as everywhere else here — there is no firm column to filter on because there is
// no cross-firm table to filter.
async function readHitById(database: SqlDatabase, hitId: string): Promise<{ id: string } | null> {
  const { results } = await database
    .prepare(`SELECT id FROM ${CONFLICTS_HIT_TABLE} WHERE id = ?1`)
    .bind(hitId)
    .all<{ id: string }>();
  return results[0] ?? null;
}

async function readHitRows(database: SqlDatabase, checkId: string): Promise<HitRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, entity_id, source_class, evidence_tier, matched_fields_json, graph_path_json, co_party, created_at FROM ${CONFLICTS_HIT_TABLE} WHERE check_id = ?1 ORDER BY created_at ASC, id ASC`,
    )
    .bind(checkId)
    .all<HitRow>();
  return results;
}

// How many hits each run's record holds, in one read for the whole check. Null for a run with no
// record yet — a search still running has surfaced nothing YET, which is not a count.
async function readHitCounts(
  database: SqlDatabase,
  runIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (runIds.length === 0) return counts;
  const placeholders = runIds.map((_, index) => `?${index + 1}`).join(", ");
  const { results } = await database
    .prepare(
      `SELECT check_id, COUNT(*) AS hit_count FROM ${CONFLICTS_HIT_TABLE} WHERE check_id IN (${placeholders}) GROUP BY check_id`,
    )
    .bind(...runIds)
    .all<{ check_id: string; hit_count: number }>();
  for (const row of results) counts.set(row.check_id, row.hit_count);
  return counts;
}

async function matterExists(database: SqlDatabase, matterId: string): Promise<boolean> {
  const { results } = await database
    .prepare(`SELECT id FROM matter WHERE id = ?1`)
    .bind(matterId)
    .all<{ id: string }>();
  return results.length > 0;
}

// ---- request/response contracts ----

// An entity id supplied as a check subject: a person or organization handle. The domain layer skips
// (never errors on) a reference that fails to resolve to a live row, but the API still constrains the
// shape at the door. The token length is bounded so an arbitrarily long handle can never feed the
// per-seed fan-out or the bound-parameter list below.
const directoryEntityIdPattern = /^(directoryPerson|directoryOrganization)_[A-Za-z0-9_-]{1,64}$/;

// The most subject parties one check may name. A real matter's party set sits far below this; the
// bound refuses abuse at the door with a 422 rather than a bound-parameter overflow in the
// identifier-reference read.
const MAX_SUBJECT_ENTITIES = 200;

const checkIdParam = z.object({
  checkId: identifierPathParam("conflictsCheck", "checkId"),
});

// The listing's own query. `cursor` is the shared opaque continuation; `matterId` narrows to one
// matter's history — the checks FILED on it.
const checkHistoryQuery = cursorQuery.extend({
  matterId: identifierField("matter").optional(),
  search: z.string().max(200).optional(),
});

// Which run a check is read at. Omitted means the latest.
const checkReadQuery = z.object({
  run: identifierField("conflictsCheck").optional(),
});

const hitIdParam = z.object({
  hitId: identifierPathParam("conflictsHit", "hitId"),
});

// What a check searches, and how names are compared. Nothing about how far or how much: a check
// follows relationships to closure, and the bound on a run is the platform's rather than a caller's
// (docs/conventions/conflicts-rulings.md, E1 and E2). A body written under the old contract that
// still carries a depth or a cap is accepted and those fields are dropped at the door.
const ScopeRequest = z
  .object({
    sources: z.array(z.enum(SOURCE_CLASSES)).max(SOURCE_CLASSES.length),
    strictness: z.enum(STRICTNESS_LEVELS),
  })
  .openapi("ConflictsScopeRequest");

const CreateCheckRequest = z
  .object({
    trigger: z.enum(CONFLICTS_TRIGGERS),
    matterId: identifierField("matter").optional(),
    subjectEntityIds: z.array(z.string().regex(directoryEntityIdPattern)).max(MAX_SUBJECT_ENTITIES),
    scope: ScopeRequest,
  })
  .openapi("CreateConflictsCheckRequest");

// What opening a check, or a further run of one, answers: the check's handle and number, and the
// run that was opened under it. The search has not run yet; the check's read says where it is.
const OpenedCheckResponse = z
  .object({
    id: z.string(),
    checkNumber: z.string(),
    runId: z.string(),
    ordinal: z.number().int(),
  })
  .openapi("OpenedConflictsCheckResponse");

const NextCheckNumberResponse = z
  .object({ checkNumber: z.string() })
  .openapi("NextConflictsCheckNumberResponse");

const FileCheckOnMatterRequest = z
  .object({ matterId: identifierField("matter") })
  .openapi("FileConflictsCheckOnMatterRequest");

const FiledCheckResponse = z
  .object({ id: z.string(), matterId: z.string() })
  .openapi("FiledConflictsCheckResponse");

/*
 * The firm's own conflicts floor, as every check is judged against it: the sources every check must
 * search, the band it must reach, and which names the narrower band compares. Nothing about depth or
 * bounds — a firm no longer decides how far a check follows relationships or where it stops.
 *
 * Every member who may read a check may read this, because every member is HELD to it — a reviewer
 * looking at a check that fell short of the floor needs to be able to see what the floor is.
 */
const ConflictsPolicyResponse = z
  .object({
    // The classes a check must search whatever a caller asked for. `party` is always among them:
    // conflicts impute across the whole firm, so the party corpus is not optional, and the read
    // unions it back in even from a stored row that somehow lacks it.
    floorSources: z.array(z.enum(SOURCE_CLASSES)),
    floorStrictness: z.enum(STRICTNESS_LEVELS),
    // The name rows the BALANCED band compares. over_inclusive always searches every role, which is
    // what keeps it a superset whatever this is set to.
    balancedNameRoles: z.array(z.string()),
  })
  .openapi("ConflictsPolicyResponse");

/*
 * The floor a firm is setting. Every field is optional and an omitted one is NOT "leave it alone" —
 * it is "use the shipped default", exactly as an absent key in the stored row means. The whole
 * policy is one value written whole, so a partial PUT that meant "patch" would let two administrators
 * saving different halves of the same screen compose a floor neither of them chose.
 *
 * What a firm cannot opt out of — party in the floor, `current` among the name roles — belongs to the
 * domain and is applied by normalizeConflictsPolicy on the way in, so a caller that bypasses this
 * schema is held to the same guards. The response then says what was actually stored.
 */
const ConflictsPolicyRequest = z
  .object({
    floorSources: z.array(z.enum(SOURCE_CLASSES)).optional(),
    floorStrictness: z.enum(STRICTNESS_LEVELS).optional(),
    balancedNameRoles: z.array(z.string().min(1)).optional(),
  })
  .openapi("ConflictsPolicyRequest");

// Where a running search has got to, and the counts it has so far. Every count is optional because
// a stage reports what it has and no others.
const RunProgress = z
  .object({
    sourcesSearched: z.number().int().optional(),
    subjectParties: z.number().int().optional(),
    entitiesReached: z.number().int().optional(),
    entitiesMatched: z.number().int().optional(),
    candidatesSurfaced: z.number().int().optional(),
    candidatesRecorded: z.number().int().optional(),
  })
  .openapi("ConflictsRunProgress");

// One run of a check: its place in the check's history, where it is, and what it came to.
const RunSummary = z
  .object({
    id: z.string(),
    ordinal: z.number().int(),
    status: z.enum(RUN_STATUSES),
    // The stage a running search is at, in the engine's own order. Null before it starts and once it
    // settles: a settled run's account is its record, never a stale progress line.
    stage: z.enum(RUN_STAGES).nullable(),
    progress: RunProgress,
    trigger: z.string(),
    triggerSource: z.string().nullable(),
    // Null on an automated run, which is nobody's act.
    requestedByUserId: z.string().nullable(),
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    // Why a failed run failed, in a sentence a person can act on. Null unless it failed.
    failure: z.string().nullable(),
    // How many candidates this run's record holds. Null while it has no record.
    hitCount: z.number().int().nullable(),
  })
  .openapi("ConflictsRunSummary");

/*
 * One line of the firm's log: a numbered check, with its latest run's facts and how many runs it has
 * had. Narrow on purpose — the whole check with its runs, its record and its hits is one identifier
 * away.
 */
const CheckSummary = z
  .object({
    id: z.string(),
    checkNumber: z.string(),
    // Where the check is filed. Null for the pre-engagement screen, until somebody files it.
    matterId: z.string().nullable(),
    createdAt: z.string(),
    createdByUserId: z.string().nullable(),
    runCount: z.number().int(),
    latestRunId: z.string().nullable(),
    runStatus: z.enum(RUN_STATUSES).nullable(),
    latestRunAt: z.string().nullable(),
    trigger: z.string().nullable(),
    // What set the latest run going: manual, event, or schedule. Null on a row that does not say.
    triggerSource: z.string().nullable(),
    // Who asked for the latest run. Null on an automated run, which is nobody's act.
    actorUserId: z.string().nullable(),
    // The latest run's record, where it has one: the band it ran under, whether the floor widened
    // it, and how many candidates surfaced. Null while the latest run has no record.
    strictness: z.enum(STRICTNESS_LEVELS).nullable(),
    floorRaised: z.boolean().nullable(),
    hitCount: z.number().int().nullable(),
  })
  .openapi("ConflictsCheckSummary");

const CheckHistoryResponse = paginated(CheckSummary).openapi("ConflictsCheckPage");

const GraphPathStep = z
  .object({
    edgeId: z.string(),
    edgeType: z.string(),
    fromEntityId: z.string(),
    toEntityId: z.string(),
    // True when the relationship had already ended when the check read the corpus. An ended
    // relationship is traversed rather than skipped, and the reviewer weighs the expiry. Absent on a
    // path recorded before the traversal carried the flag.
    expiredAtCheck: z.boolean().optional(),
  })
  .openapi("ConflictsGraphPathStep");

// The waiver's own record, on a disposition that has one. Null on every other kind, and on a
// `waiver_obtained` row recorded before the platform could hold a waiver record at all — which reads
// as the row not saying, and is reported as a shortfall exactly like an absent field would be.
const WaiverDetail = z
  .object({
    // The Directory entity that consented. A handle a reader can look up, never a typed-in name.
    givenByEntityId: z.string().nullable(),
    // Whether the consent was confirmed in writing, stated in its own right. Deliberately not derived
    // from `documentFileId`: consent confirmed in a writing this firm has not filed here, and a
    // document filed against consent nobody confirmed, are different states of the world.
    confirmedInWriting: z.boolean().nullable(),
    // The filed document evidencing the confirmation. Null where the firm has not filed it.
    documentFileId: z.string().nullable(),
    // The civil date the waiver was GIVEN, which is not the instant this row was recorded.
    givenOn: z.string().nullable(),
  })
  .openapi("ConflictsWaiverDetail");

const DispositionDetail = z
  .object({
    id: z.string(),
    kind: z.enum(DISPOSITION_KINDS),
    rationale: z.string(),
    reviewerUserId: z.string(),
    waiver: WaiverDetail.nullable(),
    // What this disposition's record is short of — for a waiver, whether the informed consent was
    // confirmed in writing and whether that confirmation is filed. Always empty on the other three
    // kinds, which carry no waiver record and are not incomplete for lacking one. Reported rather
    // than left to be inferred, because a waiver the firm cannot evidence must never read the same
    // as one it can, on any surface that shows a disposition.
    shortfalls: z.array(z.enum(WAIVER_SHORTFALLS)),
    createdAt: z.string(),
  })
  .openapi("ConflictsDispositionDetail");

// Who the hit is ABOUT, resolved from the Directory at read time rather than copied onto the log.
// The log is append-only and records the entity by reference, so the name a reader sees is the name
// the firm holds today — which is the right answer for a reviewer deciding now, and is why this is
// not a column on conflicts_hit.
const HitParty = z
  .object({
    kind: z.enum(["person", "organization"]),
    // Null when the Directory holds the record and it carries no name at all. Distinct from the
    // whole `party` being null, which says the entity does not resolve.
    displayName: z.string().nullable(),
  })
  .openapi("ConflictsHitParty");

const PriorConclusion = z
  .object({
    checkId: z.string(),
    kind: z.enum(DISPOSITION_KINDS),
    reviewerUserId: z.string(),
    createdAt: z.string(),
  })
  .openapi("ConflictsPriorConclusion");

const HitDetail = z
  .object({
    id: z.string(),
    entityId: z.string(),
    // Null when the entity does not resolve to a live Directory record — a hit whose party the
    // firm has since merged away, which the log's append-only rule makes reachable. The surface
    // says so and names the id; it must never read as "no party matched".
    party: HitParty.nullable(),
    sourceClass: z.enum(SOURCE_CLASSES),
    evidenceTier: z.number().int().min(1).max(4),
    matchedFields: z.array(z.string()),
    graphPath: z.array(GraphPathStep),
    // True when the matched entity is itself a subject party of this check — a co-party surfacing (a
    // positional conflict or a co-party collision), triaged apart from a conflict with a prior client.
    coParty: z.boolean(),
    createdAt: z.string(),
    // The hit's current disposition (the latest reviewer adjudication), or null when no reviewer has
    // acted on it yet.
    disposition: DispositionDetail.nullable(),
    // What the firm already said about the same party on an EARLIER check. Context only — never
    // this hit's answer, which stays unanswered until a reviewer answers it.
    previouslyAnswered: PriorConclusion.nullable(),
  })
  .openapi("ConflictsHitDetail");

const TraversalRecord = z
  .object({
    // True on a run that followed every relationship to closure — every run since the hop budgets
    // were removed. False on an older record, whose `edgeClassBudgets` say how far it went.
    followedToClosure: z.boolean(),
    // The longest chain of relationships the walk followed. Null where the record does not say.
    longestPathLength: z.number().int().nullable(),
    // The hop budget per edge class an OLDER run resolved. Empty on a walk to closure.
    edgeClassBudgets: z.record(z.string(), z.number().int()),
    // The most entities the walk could reach: the platform's ceiling on a walk to closure, the
    // firm's cap on an older run.
    closureCap: z.number().int().nullable(),
    // True when the bound stopped the walk. A truncated expansion is never reported as a completed
    // one, for the same reason a source with no corpus is never reported as searched: the platform
    // looked at part of the world and has to say which part.
    truncated: z.boolean(),
    entitiesReached: z.number().int().nullable(),
    // Entities the bound refused to admit. These were never matched.
    unexploredFrontierSize: z.number().int().nullable(),
    // Entities that ARE in the closure and WERE matched, but whose own edges were never read.
    unexpandedReachedCount: z.number().int().nullable(),
  })
  .openapi("ConflictsTraversalRecord");

const CandidateRecord = z
  .object({
    // The most candidates the run could write — the platform's bound, the most one record can carry.
    candidateCap: z.number().int().nullable(),
    // True when the bound refused candidates the channels had already surfaced. Reported for the
    // same reason a truncated traversal is: the platform searched less than the hit count in front
    // of the reader would otherwise imply, and it has to say so rather than let the count speak for
    // itself.
    truncated: z.boolean(),
    candidatesSurfaced: z.number().int().nullable(),
    candidatesWritten: z.number().int().nullable(),
    candidatesRefused: z.number().int().nullable(),
    // The refused set by evidence tier. Strongest evidence is kept, so all tier 4 is the ordinary
    // shape; anything stronger means the run was far enough over the bound to lose real evidence.
    refusedByTier: z.array(
      z.object({ tier: z.number().int().min(1).max(4), count: z.number().int() }),
    ),
  })
  .openapi("ConflictsCandidateRecord");

// What the name comparison compared. `strictness` is a preset NAME, and a preset is a word whose
// meaning moves as channels are added — a check from one release compared fewer things than a check
// from the next under the same word — so the row names the channels and this reports them.
const MatchingRecord = z
  .object({
    // The name key columns compared for equality.
    nameKeys: z.array(z.string()),
    // The phonetic encoders that ran.
    phoneticSchemes: z.array(z.string()),
    // The name roles compared. Null means every role the corpus holds, which is a different statement
    // from a list that happens to name them all: a firm that adds a role later is covered by the first.
    nameRoles: z.array(z.string()).nullable(),
  })
  .openapi("ConflictsMatchingRecord");

// One run's search record: what ran, over what, under which settings.
const CheckDetail = z
  .object({
    id: z.string(),
    trigger: z.enum(CONFLICTS_TRIGGERS),
    // The matter the search actually ran against — the record's own fact, which stays what it was
    // even after the check is filed on a matter.
    matterId: z.string().nullable(),
    subjectEntityIds: z.array(z.string()),
    // Keyed by source class (plus the registered sources with no class of their own) — every
    // registered source is present, so a caller can always tell "searched and clean" apart from
    // "never searched".
    scope: z.record(z.string(), z.enum(SOURCE_AVAILABILITIES)),
    strictness: z.enum(STRICTNESS_LEVELS),
    // How deep the walk ran on a walk to closure, or the widest hop budget on an older record.
    depth: z.number().int(),
    floorRaised: z.boolean(),
    // Null on a check written before the matching record existed, read exactly as `traversal` is.
    matching: MatchingRecord.nullable(),
    traversal: TraversalRecord.nullable(),
    // Null on a check written before the candidate record existed, read exactly as `traversal` is.
    candidates: CandidateRecord.nullable(),
    actorUserId: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("ConflictsCheckDetail");

// The reader-facing account of the search, one line per statement, in reading order. Every line is a
// fact about the search itself — which channels ran, which sources have no corpus, how many candidates
// surfaced. A search that surfaced nothing ends "Nothing surfaced.", which reports that the search
// ended and says nothing about the matter.
const CheckStatement = z.array(z.string());

// A completed run's record: the search's own account, its recorded scope, and every hit it surfaced.
const CheckRecord = z
  .object({ check: CheckDetail, statement: CheckStatement, hits: z.array(HitDetail) })
  .openapi("ConflictsCheckRecord");

// The numbered check itself: what a person refers to.
const NumberedCheck = z
  .object({
    id: z.string(),
    checkNumber: z.string(),
    // Where the check is filed. Null until somebody files it.
    matterId: z.string().nullable(),
    createdByUserId: z.string().nullable(),
    createdAt: z.string(),
    latestRunId: z.string().nullable(),
  })
  .openapi("ConflictsNumberedCheck");

const GetCheckResponse = z
  .object({
    check: NumberedCheck,
    // Every run, oldest first: the check's history.
    runs: z.array(RunSummary),
    // The run this read is at — the one asked for, else the latest.
    run: RunSummary,
    // That run's record, or null while it has none (queued, running, or failed).
    record: CheckRecord.nullable(),
  })
  .openapi("ConflictsCheckWithRunsResponse");

// ---- the matter conflicts posture ----

const matterIdParam = z.object({
  matterId: identifierPathParam("matter", "matterId"),
});

const PostureScope = z
  .object({
    // Every registered source with the availability the check recorded. A source with no corpus is
    // present and marked unavailable, never omitted and never conflated with one that was searched.
    sources: z.record(z.string(), z.enum(SOURCE_AVAILABILITIES)),
    strictness: z.string(),
    depth: z.number().int(),
    floorRaised: z.boolean(),
    // Null on a check written before the matching record existed — "the row does not say", never "it
    // compared what today's code compares".
    matching: MatchingRecord.nullable(),
    // Null on a check written before the traversal record existed — "the row does not say", which is
    // a different fact from "the walk completed" and is never flattened into it.
    traversal: TraversalRecord.nullable(),
    // Null on a check written before the candidate record existed, read exactly as `traversal` is.
    candidates: CandidateRecord.nullable(),
  })
  .openapi("ConflictsPostureScope");

const PostureLatestCheck = z
  .object({
    id: z.string(),
    // The number of the check this record is a run of.
    checkNumber: z.string().nullable(),
    createdAt: z.string(),
    trigger: z.string(),
    actorUserId: z.string().nullable(),
    scope: PostureScope,
    subjectEntityCount: z.number().int(),
    expandedEntityCount: z.number().int(),
    skippedIdentifierTypes: z.array(z.string()),
    hitCount: z.number().int(),
  })
  .openapi("ConflictsPostureLatestCheck");

const PostureScopeShortfall = z
  .object({
    // Source classes the firm's current policy requires that the latest check did not consider.
    sources: z.array(z.enum(SOURCE_CLASSES)),
    strictness: z.object({ firmFloor: z.enum(STRICTNESS_LEVELS), ranUnder: z.string() }).nullable(),
  })
  .openapi("ConflictsPostureScopeShortfall");

const PostureUndisposedTier = z
  .object({ tier: z.number().int().min(1).max(4), count: z.number().int() })
  .openapi("ConflictsPostureUndisposedTier");

const PostureDispositionKind = z
  .object({
    kind: z.enum(DISPOSITION_KINDS),
    count: z.number().int(),
    reviewerUserIds: z.array(z.string()),
    // How many of those the platform cannot produce the record for — today, waivers whose informed
    // consent is not confirmed in writing or whose confirmation is not filed. Zero on every other
    // kind. A matter reported as carrying three waivers, two of which the firm cannot evidence, is
    // not the matter "three waivers" describes.
    incompleteCount: z.number().int(),
  })
  .openapi("ConflictsPostureDispositionKind");

const PostureUnavailableSource = z
  .object({ source: z.string(), reason: z.string() })
  .openapi("ConflictsPostureUnavailableSource");

const PosturePendingRecheck = z
  .object({
    causeTopic: z.string(),
    causeReference: z.string(),
    causeOccurredAt: z.string(),
    requestedAt: z.string(),
  })
  .openapi("ConflictsPosturePendingRecheck");

const PosturePeriodicRescan = z
  .object({
    enabled: z.boolean(),
    intervalDays: z.number().int(),
    lastRunAt: z.string().nullable(),
  })
  .openapi("ConflictsPosturePeriodicRescan");

const MatterConflictsPostureResponse = z
  .object({
    matterId: z.string(),
    // True when no check has ever named this matter — a different state from a check that searched
    // and surfaced nothing, and different again from one whose sources were all unavailable.
    neverChecked: z.boolean(),
    latestCheck: PostureLatestCheck.nullable(),
    scopeShortfall: PostureScopeShortfall,
    pendingRecheck: z.array(PosturePendingRecheck),
    // The clock-driven backstop's standing for this firm. A firm that has switched it off has made a
    // choice about its own procedure, and a report that leaves it out would leave the reader assuming
    // the opposite.
    periodicRescan: PosturePeriodicRescan,
    undisposedByTier: z.array(PostureUndisposedTier),
    dispositionsByKind: z.array(PostureDispositionKind),
    unavailableSources: z.array(PostureUnavailableSource),
  })
  .openapi("MatterConflictsPostureResponse");

// The waiver a reviewer records alongside a `waiver_obtained` adjudication.
//
// WHAT IS REQUIRED HERE AND WHAT IS NOT. The consenting party and the date the waiver was given are
// required because they are the act itself: a reviewer who cannot say who consented, or when, is
// recording an impression rather than a waiver. Whether it was confirmed in writing is required as a
// STATEMENT — the reviewer must answer the question — but `false` is an accepted answer, and the
// evidencing document may be absent, because a waiver genuinely can be given orally and confirmed
// afterwards. A platform that refused the row until the writing existed would simply be told nothing,
// so the row is recorded and reads as incomplete wherever it is shown.
const WaiverRequest = z
  .object({
    givenByEntityId: z.string().regex(directoryEntityIdPattern),
    confirmedInWriting: z.boolean(),
    // Omitted or null where the firm has not filed the confirmation here yet.
    documentFileId: identifierField("file").nullable().optional(),
    // The civil date the waiver was given, YYYY-MM-DD. Not the instant it is being recorded.
    givenOn: z.string().regex(CIVIL_DATE_PATTERN),
  })
  .openapi("ConflictsWaiverRequest");

const RecordDispositionRequest = z
  .object({
    kind: z.enum(DISPOSITION_KINDS),
    rationale: z.string().min(1),
    // Required on `waiver_obtained` and refused on every other kind, whose payloads are unchanged.
    waiver: WaiverRequest.optional(),
  })
  .openapi("RecordConflictsDispositionRequest");

// Every answer recorded against one hit, oldest first — the trail, not the latest word. The list is
// unpaginated on purpose: it is bounded by how many times human reviewers have answered one
// candidate, which is a handful, and a cursor on a compliance record a firm reads end to end would
// be machinery serving nobody.
/*
 * A trail entry carries the same fields as the check response's `disposition`, and is deliberately a
 * SEPARATE component rather than a reuse of it. Two reasons, one mechanical and one about meaning.
 *
 * Mechanically: `DispositionDetail` is used there as `.nullable()`, and zod-to-openapi carries the
 * component name onto the nullable schema — so reusing the bare object here registers one name under
 * two shapes, which that library resolves first-write-wins and the conformance gate refuses. It
 * caught this on the first emit.
 *
 * In meaning: they answer different questions. There, `disposition` is the reviewer's LATEST word and
 * null means nobody has answered. Here every entry is an act that happened, and there is no null to
 * express — an unanswered hit is an empty trail.
 */
const DispositionTrailEntry = z
  .object({
    id: z.string(),
    kind: z.enum(DISPOSITION_KINDS),
    rationale: z.string(),
    reviewerUserId: z.string(),
    waiver: WaiverDetail.nullable(),
    shortfalls: z.array(z.enum(WAIVER_SHORTFALLS)),
    createdAt: z.string(),
  })
  .openapi("ConflictsDispositionTrailEntry");

const DispositionTrailResponse = z
  .object({ hitId: z.string(), dispositions: z.array(DispositionTrailEntry) })
  .openapi("ConflictsDispositionTrailResponse");

const CreatedDispositionResponse = z
  .object({ id: z.string() })
  .openapi("CreatedConflictsDispositionResponse");

// ---- shared error responses ----

const authErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required permission",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the resource is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is still in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, or the Idempotency-Key was reused with a different payload",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

// Maps a conflicts domain refusal to its RFC 9457 problem. Codes — never messages — drive it; an
// unrecognized throw propagates to the standard error pipeline (a 500).
function conflictsErrorResponse(
  c: Context,
  caught: unknown,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (caught instanceof ConflictsIdempotencyConflictError) {
    return problemResponseForIdempotencyConflict(c, caught);
  }
  if (caught instanceof UnknownHitError || caught instanceof UnknownNumberedCheckError) {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: caught.message,
    });
  }
  // Every domain refusal below is about the BODY the caller sent, so all of them are 422 — including
  // the two that name a reference that does not resolve. A 404 there would be an answer about this
  // route's own resource (the hit), which resolves fine; the consenting party and the evidencing
  // document are values in the payload, and the caller fixes them by sending a different payload.
  if (
    caught instanceof EmptyRationaleError ||
    caught instanceof WaiverRecordRequiredError ||
    caught instanceof WaiverRecordNotApplicableError ||
    caught instanceof InvalidWaiverDateError ||
    caught instanceof UnknownConsentingPartyError ||
    caught instanceof UnknownWaiverDocumentError
  ) {
    return problemJson(c, {
      type: "validation",
      title: "Conflicts request invalid",
      status: 422,
      detail: caught.message,
    });
  }
  throw caught;
}

function notFound(c: Context, detail: string): ProblemResponse<404> {
  return problemJson(c, { type: "not-found", title: "Not found", status: 404, detail });
}

// ---- route metas ----

function mutationMeta(action: string, permission: RouteMeta["permission"]): RouteMeta {
  return {
    operationId: `conflicts.${action}`,
    surface: "app",
    authenticated: true,
    permission,
    resource: "firm",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

function readMeta(action: string, permission: RouteMeta["permission"]): RouteMeta {
  return {
    operationId: `conflicts.${action}`,
    surface: "app",
    authenticated: true,
    permission,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

const runCheckRoute = defineOpenAPIRoute(mutationMeta("runCheck", "conflicts:run"), {
  method: "post",
  path: "/api/v1/conflicts/checks",
  description:
    "Opens a conflicts check: draws the firm's next check number, records the search that was asked " +
    "for as the check's first run, and answers at once with the check's handle and number. The " +
    "search itself runs after the response and follows every recorded relationship to closure; " +
    "reading the check says where the run has got to until it settles, and then carries the " +
    "record of what was searched, what actually ran, and what it found. The trigger must always be " +
    "supplied; no check ever runs on its own.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateCheckRequest } }, required: true },
  },
  responses: {
    202: {
      description: "The check, opened; its first run is queued",
      content: { "application/json": { schema: OpenedCheckResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const nextCheckNumberRoute = defineOpenAPIRoute(readMeta("nextCheckNumber", "conflicts:read"), {
  method: "get",
  path: "/api/v1/conflicts/checks/next-number",
  description:
    "The number the next check this firm opens would draw. A preview rather than a reservation: " +
    "two members opening a check at the same moment both see it, and one of them draws the number " +
    "after it. Shown on the New Check panel so a check is identified before it is saved.",
  responses: {
    200: {
      description: "The next check number",
      content: { "application/json": { schema: NextCheckNumberResponse } },
    },
    401: authErrors[401],
    403: authErrors[403],
    429: authErrors[429],
  },
});

const rerunCheckRoute = defineOpenAPIRoute(mutationMeta("rerunCheck", "conflicts:run"), {
  method: "post",
  path: "/api/v1/conflicts/checks/{checkId}/runs",
  description:
    "Runs a check again: opens a further run under the same check and number, performing the " +
    "search the check was opened with against the matter the check is filed on today, and answers " +
    "at once. The earlier runs and their records stay exactly as they were; the check's history " +
    "gains one entry.",
  request: { headers: idempotencyKeyHeader, params: checkIdParam },
  responses: {
    202: {
      description: "The further run, queued under the check",
      content: { "application/json": { schema: OpenedCheckResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const fileCheckRoute = defineOpenAPIRoute(mutationMeta("fileCheckOnMatter", "conflicts:run"), {
  method: "put",
  path: "/api/v1/conflicts/checks/{checkId}/matter",
  description:
    "Files a check on a matter. A check run before there was a matter is the ordinary case — the " +
    "pre-engagement screen happens before there is a file — and the moment a matter exists is the " +
    "moment somebody is reading the report. Filing moves the check into that matter's own history " +
    "and makes the next run search with the matter's parties; no search record is touched, because " +
    "each record says which matter its search actually ran against.",
  request: {
    headers: idempotencyKeyHeader,
    params: checkIdParam,
    body: { content: { "application/json": { schema: FileCheckOnMatterRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The check, filed on the matter",
      content: { "application/json": { schema: FiledCheckResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const getCheckRoute = defineOpenAPIRoute(readMeta("getCheck", "conflicts:read"), {
  method: "get",
  path: "/api/v1/conflicts/checks/{checkId}",
  description:
    "Returns a conflicts check with every run under it, and the record of the run asked for (the " +
    "latest, unless `run` names another). A run still in flight reports its stage and counts so " +
    "far and carries no record; a settled run carries its record: the recorded scope, every hit it " +
    "surfaced with each hit's current disposition, and a plain-language statement of what the " +
    "search did. The statement reports the search and reaches no conclusion about the matter — a " +
    "search that surfaced nothing ends by saying so, which is a fact about the search and not about " +
    "whether an interest is adverse. Deciding that is a reviewer's act and is recorded as a " +
    "disposition naming them. The address accepts the check's own handle or any run's handle, so an " +
    "address written before runs existed still lands on the check it named. A run that stopped " +
    "reporting is settled as failed by this read, and says so.",
  request: { params: checkIdParam, query: checkReadQuery },
  responses: {
    200: {
      description: "The check, its runs, and the selected run's record where it has one",
      content: { "application/json": { schema: GetCheckResponse } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const checkHistoryRoute = defineOpenAPIRoute(readMeta("listChecks", "conflicts:read"), {
  method: "get",
  path: "/api/v1/conflicts/checks",
  description:
    "The checks this firm refers to, newest first, keyset-paginated: one line per numbered check " +
    "carrying its latest run's facts and how many runs it has had. Filter by `matterId` for the " +
    "checks filed on one matter. Each line carries what set the latest run going, who asked for it " +
    "where anybody did, the band it ran under, whether the firm's floor raised the scope above " +
    "what was requested, and how many candidates surfaced — never a conclusion about any of them, " +
    "which is a reviewer's act recorded as a disposition. `search` narrows to the checks a term " +
    "reaches: the matter a check is filed on, by number or title, and the names it has surfaced on " +
    'ANY of its runs, so "has this firm ever checked this person" is one question rather than a ' +
    "walk through the log. The closed labels — what set a run going, who asked, the band — are " +
    "narrowed from the listing's own column filters instead, which match them exactly.",
  request: { query: checkHistoryQuery },
  responses: {
    200: {
      description: "A page of the firm's conflicts checks, newest first",
      content: { "application/json": { schema: CheckHistoryResponse } },
    },
    401: authErrors[401],
    403: authErrors[403],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const firmPolicyRoute = defineOpenAPIRoute(readMeta("firmPolicy", "conflicts:read"), {
  method: "get",
  path: "/api/v1/firm/conflicts-policy",
  description:
    "The firm's conflicts floor: the source classes every check must search whatever a caller asks " +
    "for, the strictness band it must reach, and which of a party's names the narrower band " +
    "compares. A per-run scope may only ADD to the floor, never subtract from it — otherwise " +
    "narrowing a request would manufacture a check that searched less than the firm requires while " +
    "the log faithfully recorded that a check happened. It reads on conflicts:read because every " +
    "member who can read a check is held to this, and a reviewer looking at a check that fell short " +
    "of the floor has to be able to see what the floor is.",
  responses: {
    200: {
      description: "The firm's conflicts policy floor",
      content: { "application/json": { schema: ConflictsPolicyResponse } },
    },
    401: authErrors[401],
    403: authErrors[403],
    429: authErrors[429],
  },
});

const setFirmPolicyRoute = defineOpenAPIRoute(
  mutationMeta("setFirmPolicy", "conflicts:configure"),
  {
    method: "put",
    path: "/api/v1/firm/conflicts-policy",
    description:
      "Sets the firm's conflicts floor. PUT rather than PATCH because the floor is one value: a " +
      "partial update would let two administrators saving different halves of the same screen " +
      "compose a floor neither of them chose, and the floor is what every future check is held to. " +
      "It writes on conflicts:configure rather than conflicts:run, which is a narrower key seeded to " +
      "Owner and Admin alone — this does not act on a check, it decides what every LATER check " +
      "searches, and no single check row records that a person chose that. The stored value is " +
      "normalized first and the normalized value is returned, so what a firm is shown is what its " +
      "checks will actually run: a floor with every source deselected comes back carrying `party`. " +
      "Changing the floor writes no check and re-runs nothing — a matter whose last check no longer " +
      "covers the new floor reports the shortfall on its own posture read, computed live, which is " +
      "why raising the floor takes effect everywhere at once with no sweep.",
    request: {
      headers: idempotencyKeyHeader,
      body: {
        content: { "application/json": { schema: ConflictsPolicyRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "The firm's conflicts policy as stored, after normalization",
        content: { "application/json": { schema: ConflictsPolicyResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const matterRecheckRoute = defineOpenAPIRoute(mutationMeta("recheckMatter", "conflicts:run"), {
  method: "post",
  path: "/api/v1/matters/{matterId}/conflicts-rechecks",
  description:
    "Runs a fresh comprehensive check against this matter's own live parties, now, because a member " +
    "asked for one. It takes NO scope, and that is the point of it existing beside the general " +
    "check route: 're-check this matter' has no scope for a caller to state, and asking for one " +
    "invites a screen to invent a narrower search than the firm requires. The firm's own policy " +
    "floor is what runs. It opens a further run under the check most recently filed on the matter, " +
    "or a new numbered check where the matter has none, and answers at once; the search runs after " +
    "the response. The run is recorded as a manual run naming the member who asked, and carries no " +
    "cause — a cause is a corpus change the platform noticed, and a person asking now is not one. " +
    "It neither reads nor satisfies the automatic re-check ledger: an open cause stays open, because " +
    "the interval between a cause and the check that answered it is evidence about the firm's " +
    "procedure and a manual run did not answer it.",
  request: { headers: idempotencyKeyHeader, params: matterIdParam },
  responses: {
    202: {
      description: "The run, queued",
      content: { "application/json": { schema: OpenedCheckResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    // The idempotency chokepoint's own refusal: one key, two different bodies. Declared because the
    // shared conflicts error mapper can return it, and a response a route can produce but does not
    // declare is a contract that lies about what a caller may receive.
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const dispositionTrailRoute = defineOpenAPIRoute(readMeta("hitDispositions", "conflicts:read"), {
  method: "get",
  path: "/api/v1/conflicts/hits/{hitId}/dispositions",
  description:
    "Every adjudication recorded against one hit, oldest first — the whole trail rather than the " +
    "reviewer's latest word. The conflicts log is append-only, so a reviewer who cleared a hit and " +
    "later reversed that call leaves both acts standing: the reversal is a second row, never an " +
    "edit. This read is what makes that history producible. Each entry names the reviewer, carries " +
    "the rationale they gave, and for a waiver carries the waiver's own record and what that record " +
    "is short of, so an answer the firm cannot evidence never reads the same as one it can. A hit " +
    "no reviewer has answered returns an empty trail, which is a fact about the hit and not about " +
    "whether an interest is adverse.",
  request: { params: hitIdParam },
  responses: {
    200: {
      description: "Every disposition recorded against the hit, oldest first",
      content: { "application/json": { schema: DispositionTrailResponse } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const matterPostureRoute = defineOpenAPIRoute(readMeta("matterPosture", "conflicts:read"), {
  method: "get",
  path: "/api/v1/matters/{matterId}/conflicts-posture",
  description:
    "Where a matter stands on conflicts: the most recent check with the scope it actually ran under, " +
    "which of the firm's current policy requirements that check did not meet, how many of its hits no " +
    "reviewer has answered (by evidence tier), how its answered hits were disposed of and by whom, " +
    "every re-check the platform knows is owed because the firm's records moved under this matter — " +
    "each naming what changed and when — whether the firm's scheduled re-screening is switched on and " +
    "how often it runs, and " +
    "every source that could not be searched with the reason it could not. A matter that has never " +
    "been checked reports that as its own distinct state, separate from a check that searched and " +
    "surfaced nothing. A check filed on the matter after it ran counts as the matter's own. Every " +
    "field is computed from the log at the moment of the request and nothing is stored, so raising " +
    "the firm's policy shows up here immediately. The response reports what was searched and what " +
    "was found and asserts nothing about whether an interest is adverse: there is no summary field " +
    "and no single verdict, because concluding is a lawyer's act and the record says whose.",
  request: { params: matterIdParam },
  responses: {
    200: {
      description: "The matter's conflicts posture, derived at read time",
      content: { "application/json": { schema: MatterConflictsPostureResponse } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const recordDispositionRoute = defineOpenAPIRoute(
  mutationMeta("recordDisposition", "conflicts:dispose"),
  {
    method: "post",
    path: "/api/v1/conflicts/hits/{hitId}/dispositions",
    description:
      "Records a reviewer's adjudication of a surfaced hit — clearing it, noting a waiver, recording " +
      "that an ethical wall was erected, or declining the representation. Every call appends a new " +
      "row; a reviewer who reverses an earlier call records a second disposition rather than editing " +
      "the first, so the full history of the adjudication stays visible. A waiver carries a record of " +
      "its own: who consented, whether that consent was confirmed in writing, the filed document " +
      "evidencing the confirmation, and the date the waiver was given. The consenting party and the " +
      "date are required, because they are the act being recorded. The written confirmation and its " +
      "document are not, because a waiver can be given orally and confirmed afterwards — a waiver " +
      "recorded without them is accepted and reports what it is short of, so it never reads the same " +
      "as one the firm can evidence.",
    request: {
      headers: idempotencyKeyHeader,
      params: hitIdParam,
      body: {
        content: { "application/json": { schema: RecordDispositionRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: "The recorded disposition",
        content: { "application/json": { schema: CreatedDispositionResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

type ConflictsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

// ---- the run lifecycle, as the routes drive it ----

// The search a stored run performs, as the engine takes it. A person opened this run, so it is a
// manual run whatever the trigger word says about when it ran.
function runInputFrom(request: StoredRunRequest): RunCheckInput {
  return {
    trigger: request.trigger,
    ...(request.matterId === null ? {} : { matterId: request.matterId }),
    subjectEntityIds: [...request.subjectEntityIds],
    scope: request.scope,
    triggerSource: "manual",
  };
}

// Hands an opened run to the runtime to execute after the response. The row already says it is
// queued; the executor claims it, reports onto it, and settles it.
function executeAfterResponse(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  context: DirectoryIdentifierContext,
  runId: ConflictsCheckId,
  input: RunCheckInput,
): void {
  runInBackground(
    c,
    executeConflictsRunInBackground(
      context,
      { runId, input },
      {
        clock: context.clock,
        actorUserId: context.actorUserId,
        randomSource: context.randomSource,
      },
      createWorkersLogger(c.env.TELEMETRY),
    ),
  );
}

function runSummary(run: CheckRunRow, hitCounts: ReadonlyMap<string, number>) {
  return {
    id: run.id,
    ordinal: run.ordinal,
    status: run.status,
    stage: run.stage,
    progress: parseRunProgress(run.progress_json),
    trigger: run.trigger,
    triggerSource: run.trigger_source,
    requestedByUserId: run.requested_by_user_id,
    createdAt: run.created_at,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    failure: run.failure,
    hitCount: run.status === "completed" ? (hitCounts.get(run.id) ?? 0) : null,
  };
}

function numberedCheckBody(check: NumberedCheckRow) {
  return {
    id: check.id,
    checkNumber: check.check_number,
    matterId: check.subject_matter_id,
    createdByUserId: check.created_by_user_id,
    createdAt: check.created_at,
    latestRunId: check.latest_run_id,
  };
}

// A completed run's record, assembled from the append-only rows: the search's own sentences, its
// recorded scope, and every hit with who it is about and what a reviewer said.
async function readRecord(database: SqlDatabase, runId: string) {
  const checkRow = await readCheckRow(database, runId);
  if (checkRow === null) return null;
  const hitRows = await readHitRows(database, runId);

  /*
   * Two set-valued reads, not two per hit.
   *
   * The dispositions were a per-hit readCurrentDisposition inside a Promise.all — the exact N+1
   * readHitDispositionStates exists to replace, and whose own comment names this shape as the
   * mistake: a check against a wide corpus surfaces hundreds of hits. It resolves every hit's
   * latest word in one query, by the same created_at/rowid tie-break, so the answer is identical
   * and the read is one round trip instead of one per hit.
   *
   * The party names are the second read, and they are what lets the hit list say who matched.
   * The entity set is bounded by the hits already read, and the reader chunks it at D1's
   * bound-parameter cap.
   */
  const [dispositionStates, partyNames, priorConclusions] = await Promise.all([
    readHitDispositionStates(database, runId),
    readEntityDisplayNames(
      database,
      hitRows.map((hitRow) => hitRow.entity_id),
    ),
    // What the firm already said about these parties on any OTHER check. Set-valued for the
    // same reason the other two are: a check against a wide corpus surfaces hundreds of hits.
    readPriorConclusions(
      database,
      hitRows.map((hitRow) => hitRow.entity_id),
      runId,
    ),
  ]);
  const dispositionByHit = new Map(
    dispositionStates.map((state) => [state.hitId, state.disposition]),
  );

  const hits = hitRows.map((hitRow) => {
    const disposition = dispositionByHit.get(hitRow.id) ?? null;
    // An entity the Directory no longer resolves is reported as UNRESOLVED, never as absent:
    // the log is append-only, so an old hit can name an entity a later merge reshaped, and a
    // hit whose party read as absent would invert what a conflicts hit means.
    const party = partyNames.get(hitRow.entity_id) ?? null;
    const earlier = priorConclusions.get(hitRow.entity_id) ?? null;
    return {
      id: hitRow.id,
      entityId: hitRow.entity_id,
      party,
      previouslyAnswered:
        earlier === null
          ? null
          : {
              checkId: earlier.checkId,
              kind: earlier.kind,
              reviewerUserId: earlier.reviewerUserId,
              createdAt: earlier.createdAt,
            },
      sourceClass: hitRow.source_class,
      evidenceTier: hitRow.evidence_tier,
      matchedFields: JSON.parse(hitRow.matched_fields_json) as string[],
      graphPath: JSON.parse(hitRow.graph_path_json) as unknown[],
      coParty: hitRow.co_party === 1,
      createdAt: hitRow.created_at,
      disposition:
        disposition === null
          ? null
          : {
              id: disposition.id,
              kind: disposition.kind,
              rationale: disposition.rationale,
              reviewerUserId: disposition.reviewerUserId,
              waiver: disposition.waiver,
              // Derived on every read from the row itself, never stored: filing the
              // confirmation later is a second disposition row, and this answer moves with it.
              shortfalls: waiverShortfalls(disposition.kind, disposition.waiver),
              createdAt: disposition.createdAt,
            },
    };
  });
  const scope = parseCheckScope(checkRow.scope_json);
  const inputs = parseCheckInputs(checkRow.inputs_json);
  const sources: ReportedSource[] = reportedSourcesFor(scope, {
    hasSubjectMatter: checkRow.subject_matter_id !== null,
  });
  const statement = describeCheck(
    {
      createdAt: checkRow.created_at,
      trigger: checkRow.trigger,
      actorUserId: checkRow.actor_user_id,
      strictness: checkRow.strictness as "balanced" | "over_inclusive",
      depth: checkRow.depth,
      floorRaised: checkRow.floor_raised === 1,
      subjectEntityCount: inputs.subjectEntityIds.length,
      expandedEntityCount: inputs.expandedEntityIds.length,
      skippedIdentifierTypes: inputs.skippedIdentifierTypes,
      traversal: inputs.traversal,
      candidates: inputs.candidates,
    },
    hitRows.map((hitRow) => ({ evidenceTier: hitRow.evidence_tier as 1 | 2 | 3 | 4 })),
    sources,
  );
  return {
    check: {
      id: checkRow.id,
      trigger: checkRow.trigger,
      matterId: checkRow.subject_matter_id,
      subjectEntityIds: JSON.parse(checkRow.subject_parties_json) as string[],
      scope,
      strictness: checkRow.strictness,
      depth: checkRow.depth,
      floorRaised: checkRow.floor_raised === 1,
      matching: inputs.matching,
      traversal: inputs.traversal,
      candidates: inputs.candidates,
      actorUserId: checkRow.actor_user_id,
      createdAt: checkRow.created_at,
    },
    statement,
    hits,
  };
}

export function registerConflictsRoutes(app: ConflictsApp, chokepoint: Chokepoint): void {
  // POST /api/v1/conflicts/checks
  app.openapi(
    { ...runCheckRoute, middleware: chokepointMiddleware(chokepoint, runCheckRoute) },
    async (c) => {
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const context = await conflictsContext(c);
      const stored: StoredRunRequest = {
        trigger: request.trigger,
        matterId: request.matterId ?? null,
        subjectEntityIds: request.subjectEntityIds,
        scope: request.scope,
      };
      try {
        // Opened, not run: one small batch that draws the number and queues the first run. A person
        // asked for this one, and the row has to say so — left unset, the run reads on the firm's
        // log as "the row does not say what started it", beside an actor it does in fact name.
        const opened = await openCheckRun(
          context.database,
          { request: stored, triggerSource: "manual", under: null },
          {
            clock: context.clock,
            actorUserId: context.actorUserId,
            randomSource: context.randomSource,
            idempotency,
          },
        );
        // A replayed key returns the run the first request opened; the executor's claim finds
        // nothing queued and searches nothing, so handing it over again is safe.
        executeAfterResponse(c, context, opened.runId, runInputFrom(stored));
        return c.json(openedRunBody(opened) as z.infer<typeof OpenedCheckResponse>, 202);
      } catch (caught) {
        return conflictsErrorResponse(c, caught);
      }
    },
  );

  // GET /api/v1/conflicts/checks/next-number — registered before the {checkId} read so the literal
  // segment is matched as itself rather than refused as a malformed handle.
  app.openapi(
    { ...nextCheckNumberRoute, middleware: chokepointMiddleware(chokepoint, nextCheckNumberRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const checkNumber = await previewNextCheckNumber(firm.firmDatabase, nowInstant());
      return c.json({ checkNumber } as z.infer<typeof NextCheckNumberResponse>, 200);
    },
  );

  // GET /api/v1/conflicts/checks
  app.openapi(
    { ...checkHistoryRoute, middleware: chokepointMiddleware(chokepoint, checkHistoryRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { cursor, matterId, search } = c.req.valid("query");
      // One row past the page, which is how "there is more" is measured rather than estimated —
      // the same probe every other listing here uses.
      const { results } = await selectConflictsChecksStatement(firm.firmDatabase, {
        matterId,
        search,
        cursor: decodeCursor(cursor),
        limit: DEFAULT_PAGE_SIZE + 1,
      }).all<ConflictsCheckSummaryRow>();
      const hasMore = results.length > DEFAULT_PAGE_SIZE;
      const rows = hasMore ? results.slice(0, DEFAULT_PAGE_SIZE) : results;
      const last = rows.at(-1);
      return c.json(
        {
          data: rows.map((row) => ({
            id: row.id,
            checkNumber: row.check_number,
            matterId: row.subject_matter_id,
            createdAt: row.created_at,
            createdByUserId: row.created_by_user_id,
            runCount: row.run_count,
            latestRunId: row.latest_run_id,
            runStatus: row.run_status,
            latestRunAt: row.latest_run_at,
            trigger: row.trigger,
            triggerSource: row.trigger_source,
            actorUserId: row.requested_by_user_id,
            strictness: row.strictness,
            floorRaised: row.floor_raised === null ? null : row.floor_raised === 1,
            hitCount: row.hit_count,
          })),
          // Keyed on the same (created_at, id) pair the statement orders by, so the walk can
          // neither skip a check nor show one twice.
          nextCursor: hasMore && last !== undefined ? encodeCursor(last.created_at, last.id) : null,
        } as unknown as z.infer<typeof CheckHistoryResponse>,
        200,
      );
    },
  );

  // GET /api/v1/firm/conflicts-policy
  app.openapi(
    { ...firmPolicyRoute, middleware: chokepointMiddleware(chokepoint, firmPolicyRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      // readConflictsPolicy falls back to the shipped default for a firm that has set nothing, and
      // unions `party` back into the floor on every read — so a stored row that is corrupt or was
      // hand-edited can never report a floor this platform would not actually run.
      const policy = await readConflictsPolicy(firm.firmDatabase);
      return c.json(policy as unknown as z.infer<typeof ConflictsPolicyResponse>, 200);
    },
  );

  // PUT /api/v1/firm/conflicts-policy
  app.openapi(
    { ...setFirmPolicyRoute, middleware: chokepointMiddleware(chokepoint, setFirmPolicyRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      try {
        // The whole policy, written whole. What comes back is the STORED value after normalization,
        // not the request echoed — a floor the firm cannot actually have (every source deselected)
        // is repaired here and the repair is what the caller is told, so a screen never shows a
        // floor its own checks would not run.
        const policy = await writeConflictsPolicy(firm.firmDatabase, request as ConflictsPolicy, {
          clock: { now: nowInstant },
          actorUserId: userId,
          randomSource: cryptoRandomSource,
          idempotency,
        });
        return c.json(policy as unknown as z.infer<typeof ConflictsPolicyResponse>, 200);
      } catch (caught) {
        // Narrower than conflictsErrorResponse on purpose. This write reads no check, resolves no
        // hit and refuses no policy — normalization repairs rather than rejects — so a replayed
        // Idempotency-Key is the one refusal it can produce. Routing through the general mapper
        // would declare a 404 this route can never return, which reads to a client as an operation
        // that might not find something.
        if (caught instanceof ConflictsIdempotencyConflictError) {
          return problemResponseForIdempotencyConflict(c, caught);
        }
        throw caught;
      }
    },
  );

  // POST /api/v1/matters/{matterId}/conflicts-rechecks
  app.openapi(
    { ...matterRecheckRoute, middleware: chokepointMiddleware(chokepoint, matterRecheckRoute) },
    async (c) => {
      const idempotency = requireChokepointIdempotency(c);
      const { matterId } = c.req.valid("param");
      const context = await conflictsContext(c);
      try {
        // The firm's floor, read here rather than taken from the caller. resolveScope would raise a
        // narrower request to it anyway, so this is not the enforcement — it is the reason the route
        // needs no scope field at all.
        const policy = await readConflictsPolicy(context.database);
        const stored: StoredRunRequest = {
          // A person asking for a re-check is asking for the full one; `preliminary` is the intake
          // band and is not something this affordance should be able to select by accident.
          trigger: "comprehensive",
          matterId,
          // Empty on purpose: the engine reads the matter's own live parties. Naming subjects here
          // would freeze the search to whoever the screen had listed when the button was drawn,
          // which is precisely the staleness a re-check exists to answer.
          subjectEntityIds: [],
          scope: { sources: policy.floorSources, strictness: policy.floorStrictness },
        };
        // Under the matter's own check, so the matter's history is one check with its runs rather
        // than a row per press.
        const home = await readLatestNumberedCheckForMatter(context.database, matterId);
        const opened = await openCheckRun(
          context.database,
          {
            request: stored,
            triggerSource: "manual",
            under: home === null ? null : { numberedCheckId: home.id },
          },
          {
            clock: context.clock,
            actorUserId: context.actorUserId,
            randomSource: context.randomSource,
            idempotency,
          },
        );
        executeAfterResponse(c, context, opened.runId, runInputFrom(stored));
        return c.json(openedRunBody(opened) as z.infer<typeof OpenedCheckResponse>, 202);
      } catch (caught) {
        return conflictsErrorResponse(c, caught);
      }
    },
  );

  // POST /api/v1/conflicts/checks/{checkId}/runs
  app.openapi(
    { ...rerunCheckRoute, middleware: chokepointMiddleware(chokepoint, rerunCheckRoute) },
    async (c) => {
      const idempotency = requireChokepointIdempotency(c);
      const { checkId } = c.req.valid("param");
      const context = await conflictsContext(c);
      const numbered = await readNumberedCheckByAnyId(context.database, checkId);
      if (numbered === null) return notFound(c, "No such conflicts check in this firm.");
      // The search the check was opened with, from its first run: a later run of one check runs the
      // same search, against the matter the check is filed on today.
      const runs = await readRunsForCheck(context.database, numbered.id);
      const first = runs[0];
      const stored = first === undefined ? null : parseStoredRunRequest(first.request_json);
      if (stored === null) {
        return problemJson(c, {
          type: "validation",
          title: "Conflicts request invalid",
          status: 422,
          detail:
            "This check's first run does not record the search it performed, so it cannot be run again.",
        });
      }
      try {
        const opened = await openCheckRun(
          context.database,
          {
            request: stored,
            triggerSource: "manual",
            under: { numberedCheckId: numbered.id },
          },
          {
            clock: context.clock,
            actorUserId: context.actorUserId,
            randomSource: context.randomSource,
            idempotency,
          },
        );
        const openedRun = await readRunsForCheck(context.database, numbered.id);
        const request = openedRun.find((run) => run.id === opened.runId);
        const input =
          request === null || request === undefined
            ? null
            : parseStoredRunRequest(request.request_json);
        if (input !== null) executeAfterResponse(c, context, opened.runId, runInputFrom(input));
        return c.json(openedRunBody(opened) as z.infer<typeof OpenedCheckResponse>, 202);
      } catch (caught) {
        return conflictsErrorResponse(c, caught);
      }
    },
  );

  // PUT /api/v1/conflicts/checks/{checkId}/matter
  app.openapi(
    { ...fileCheckRoute, middleware: chokepointMiddleware(chokepoint, fileCheckRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { checkId } = c.req.valid("param");
      const { matterId } = c.req.valid("json");
      const numbered = await readNumberedCheckByAnyId(firm.firmDatabase, checkId);
      if (numbered === null) return notFound(c, "No such conflicts check in this firm.");
      if (!(await matterExists(firm.firmDatabase, matterId))) {
        return problemJson(c, {
          type: "validation",
          title: "Conflicts request invalid",
          status: 422,
          detail: "No such matter in this firm.",
        });
      }
      // A plain update rather than an effect batch: filing moves one column on a mutable row, and
      // repeating it is harmless — the chokepoint still requires the key so a replay is recognised.
      await fileCheckOnMatterStatement(
        firm.firmDatabase,
        numbered.id,
        matterId,
        nowInstant(),
      ).run();
      return c.json({ id: numbered.id, matterId } as z.infer<typeof FiledCheckResponse>, 200);
    },
  );

  // GET /api/v1/conflicts/checks/{checkId}
  app.openapi(
    { ...getCheckRoute, middleware: chokepointMiddleware(chokepoint, getCheckRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { checkId } = c.req.valid("param");
      const { run: askedRunId } = c.req.valid("query");
      const numbered = await readNumberedCheckByAnyId(firm.firmDatabase, checkId);
      if (numbered === null) return notFound(c, "No such conflicts check in this firm.");
      // A run that stopped reporting is settled here, because this is the moment somebody is
      // looking at it and the moment the honest answer is owed.
      const runs = await settleStaleRuns(
        firm.firmDatabase,
        await readRunsForCheck(firm.firmDatabase, numbered.id),
        nowInstant(),
      );
      const selected =
        askedRunId === undefined
          ? (runs.find((run) => run.id === numbered.latest_run_id) ?? runs.at(-1))
          : runs.find((run) => run.id === askedRunId);
      if (selected === undefined) return notFound(c, "No such run of this conflicts check.");
      const hitCounts = await readHitCounts(
        firm.firmDatabase,
        runs.filter((run) => run.status === "completed").map((run) => run.id),
      );
      const record =
        selected.status === "completed" ? await readRecord(firm.firmDatabase, selected.id) : null;
      return c.json(
        {
          check: numberedCheckBody(numbered),
          runs: runs.map((run) => runSummary(run, hitCounts)),
          run: runSummary(selected, hitCounts),
          record,
        } as unknown as z.infer<typeof GetCheckResponse>,
        200,
      );
    },
  );

  // GET /api/v1/conflicts/hits/{hitId}/dispositions
  app.openapi(
    {
      ...dispositionTrailRoute,
      middleware: chokepointMiddleware(chokepoint, dispositionTrailRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { hitId } = c.req.valid("param");
      // The hit's existence IS checked here, unlike the matter posture read — and for the opposite
      // reason. A hit is a row this firm either has or does not; "no such hit" is not a state with a
      // meaning of its own to report, so an empty trail must mean "nobody has answered this hit"
      // and nothing else. Conflating the two would let a mistyped handle read as an unanswered
      // candidate.
      const hit = await readHitById(firm.firmDatabase, hitId);
      if (hit === null) return notFound(c, "No such conflicts hit in this firm.");
      const dispositions = await readDispositionTrail(firm.firmDatabase, hitId);
      return c.json(
        {
          hitId,
          dispositions: dispositions.map((row) => ({
            id: row.id,
            kind: row.kind,
            rationale: row.rationale,
            reviewerUserId: row.reviewerUserId,
            waiver: row.waiver,
            // Derived on every read from the row itself, never stored: filing the confirmation later
            // is a second disposition row, and this answer moves with it.
            shortfalls: waiverShortfalls(row.kind, row.waiver),
            createdAt: row.createdAt,
          })),
        } as unknown as z.infer<typeof DispositionTrailResponse>,
        200,
      );
    },
  );

  // GET /api/v1/matters/{matterId}/conflicts-posture
  app.openapi(
    { ...matterPostureRoute, middleware: chokepointMiddleware(chokepoint, matterPostureRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      // No existence check on the matter, and deliberately: a matter that has never been checked
      // reads `neverChecked`, and that is exactly the state a caller needs to see. A 404 here would
      // make "never checked" and "no such matter" the same answer, which is the conflation this read
      // exists to prevent.
      const posture = await readMatterConflictsPosture(firm.firmDatabase, matterId);
      return c.json(posture as z.infer<typeof MatterConflictsPostureResponse>, 200);
    },
  );

  // POST /api/v1/conflicts/hits/{hitId}/dispositions
  app.openapi(
    {
      ...recordDispositionRoute,
      middleware: chokepointMiddleware(chokepoint, recordDispositionRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { hitId } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const id = await recordDisposition(
          firm.firmDatabase,
          {
            hitId,
            kind: request.kind,
            rationale: request.rationale,
            reviewerUserId: userId,
            waiver:
              request.waiver === undefined
                ? undefined
                : { ...request.waiver, documentFileId: request.waiver.documentFileId ?? null },
          },
          {
            clock: { now: nowInstant },
            actorUserId: userId,
            randomSource: cryptoRandomSource,
            idempotency,
          },
        );
        return c.json({ id } as z.infer<typeof CreatedDispositionResponse>, 201);
      } catch (caught) {
        return conflictsErrorResponse(c, caught);
      }
    },
  );
}
