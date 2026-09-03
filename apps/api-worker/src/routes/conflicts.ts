import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { loadEffectivePermissions } from "../session-context.ts";
import { runConflictsCheck } from "@magna-carta/conflicts/run-check";
import {
  recordDisposition,
  readDispositionTrail,
  readHitDispositionStates,
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
  parseCheckInputs,
  parseCheckScope,
  readMatterConflictsPosture,
  reportedSourcesFor,
} from "@magna-carta/conflicts/posture";
import { describeCheck, type ReportedSource } from "@magna-carta/conflicts/report-text";
import { ConflictsIdempotencyConflictError } from "@magna-carta/conflicts/run-conflicts-effect";
import { MAX_CANDIDATE_CAP } from "@magna-carta/conflicts/settings";
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
import { identifierField, identifierPathParam, idempotencyKeyHeader } from "../contracts/common.ts";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
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

// The conflicts HTTP surface over the @magna-carta/conflicts domain package: running a
// conflicts-of-interest check against the directory corpus, reading back a completed check with its
// surfaced hits, and recording a reviewer's disposition of a hit. A check's trigger is always supplied
// by the caller — nothing here runs a check on its own. Every mutation rides the chokepoint's
// idempotency gate (an Idempotency-Key is required); every handler hands the domain service the
// firm-scoped per-firm database, the real clock, a crypto random source, and the authenticated actor —
// none of which is ever client input.

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

// ---- request/response contracts ----

// An entity id supplied as a check subject: a person or organization handle. The domain layer skips
// (never errors on) a reference that fails to resolve to a live row, but the API still constrains the
// shape at the door. The token length is bounded so an arbitrarily long handle can never feed the
// per-seed fan-out or the bound-parameter list below.
const directoryEntityIdPattern = /^(directoryPerson|directoryOrganization)_[A-Za-z0-9_-]{1,64}$/;

// Upper bounds that keep one request's work bounded — a conflicts check runs per-seed graph expansion
// and matching in the request handler, so an unbounded subject set or depth is a caller-triggered
// fan-out (and, for the subject set, a bound-parameter overflow in the identifier-reference read). A
// real matter's party set and a real search depth sit far below these, so the caps refuse abuse at the
// door with a 422 rather than a 500 or a stalled worker.
const MAX_SUBJECT_ENTITIES = 200;
const MAX_GRAPH_DEPTH = 6;
// The largest closure one request may ask the traversal to expand to. The firm's own setting is the
// default; this refuses a caller-supplied number that would make one request walk the whole corpus.
const MAX_CLOSURE_CAP = 5000;

const checkIdParam = z.object({
  checkId: identifierPathParam("conflictsCheck", "checkId"),
});

const hitIdParam = z.object({
  hitId: identifierPathParam("conflictsHit", "hitId"),
});

const ScopeRequest = z
  .object({
    sources: z.array(z.enum(SOURCE_CLASSES)).max(SOURCE_CLASSES.length),
    strictness: z.enum(STRICTNESS_LEVELS),
    // Optional: omitted means the firm's configured default depth is applied; an explicit value
    // (0 included) is honored as given, capped so no single request can walk an unbounded traversal.
    // The resolved depth is always recorded on the check.
    depth: z.number().int().min(0).max(MAX_GRAPH_DEPTH).optional(),
    // Per-edge-class hop budgets. A class omitted here falls back to `depth`, then to the firm's own
    // setting, so a caller written before typed budgets existed keeps meaning exactly what it meant.
    // Corporate-family edges carry no budget: they are traversed transitively, bounded only by the
    // closure cap, because a rename or merger chain of any length is one legal person continuing.
    edgeClassBudgets: z
      .object({
        control: z.number().int().min(0).max(MAX_GRAPH_DEPTH).optional(),
        family: z.number().int().min(0).max(MAX_GRAPH_DEPTH).optional(),
        representation: z.number().int().min(0).max(MAX_GRAPH_DEPTH).optional(),
      })
      .optional(),
    // The most entities this run may expand to. Omitted means the firm's setting. Reaching it stops
    // the traversal and the check records that it was truncated, with how much it did not reach.
    closureCap: z.number().int().min(0).max(MAX_CLOSURE_CAP).optional(),
    // The most candidates this run may record. Omitted means the firm's setting. The closure cap
    // bounds how many entities are reached; this bounds what reaching them produced, which grows with
    // the Directory rather than with the graph. Reaching it records that the candidate set was
    // truncated, how many were refused, and at which evidence tiers.
    candidateCap: z.number().int().min(0).max(MAX_CANDIDATE_CAP).optional(),
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

const CreatedCheckResponse = z.object({ id: z.string() }).openapi("CreatedConflictsCheckResponse");

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
  })
  .openapi("ConflictsHitDetail");

const TraversalRecord = z
  .object({
    // The hop budget in force per budgeted edge class. Corporate family is absent: it is transitive.
    edgeClassBudgets: z.record(z.string(), z.number().int()),
    closureCap: z.number().int().nullable(),
    // True when the closure cap stopped the walk. A truncated expansion is never reported as a
    // completed one, for the same reason a source with no corpus is never reported as searched: the
    // platform looked at part of the world and has to say which part.
    truncated: z.boolean(),
    entitiesReached: z.number().int().nullable(),
    // Entities the cap refused to admit. These were never matched.
    unexploredFrontierSize: z.number().int().nullable(),
    // Entities that ARE in the closure and WERE matched, but whose own edges were never read.
    unexpandedReachedCount: z.number().int().nullable(),
  })
  .openapi("ConflictsTraversalRecord");

const CandidateRecord = z
  .object({
    candidateCap: z.number().int().nullable(),
    // True when the cap refused candidates the channels had already surfaced. Reported for the same
    // reason a truncated traversal is: the platform searched less than the hit count in front of the
    // reader would otherwise imply, and it has to say so rather than let the count speak for itself.
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

const CheckDetail = z
  .object({
    id: z.string(),
    trigger: z.enum(CONFLICTS_TRIGGERS),
    matterId: z.string().nullable(),
    subjectEntityIds: z.array(z.string()),
    // Keyed by source class (plus prior_firm_history, which carries no dedicated class of its own) —
    // every registered source is present, so a caller can always tell "searched and clean" apart from
    // "never searched".
    scope: z.record(z.string(), z.enum(SOURCE_AVAILABILITIES)),
    strictness: z.enum(STRICTNESS_LEVELS),
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

const GetCheckResponse = z
  .object({ check: CheckDetail, statement: CheckStatement, hits: z.array(HitDetail) })
  .openapi("ConflictsCheckWithHitsResponse");

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
    depth: z.object({ firmDefault: z.number().int(), ranAt: z.number().int() }).nullable(),
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
    givenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
  if (caught instanceof UnknownHitError) {
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
    "Runs a conflicts-of-interest check against the directory corpus for the given subject parties " +
    "(and, when a matter is supplied, its existing parties too), and records the search — what was " +
    "asked for, what actually ran, and what it found — as a new entry in the append-only conflicts " +
    "log. The trigger must always be supplied; no check ever runs on its own.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateCheckRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The completed check",
      content: { "application/json": { schema: CreatedCheckResponse } },
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
    "Returns a completed conflicts check and every hit it surfaced, including each hit's current " +
    "disposition when a reviewer has already adjudicated it, alongside a plain-language statement of " +
    "what the search did: which sources ran and with what settings, which could not run and why, and " +
    "how many candidates surfaced. The statement reports the search and reaches no conclusion about " +
    "the matter — a search that surfaced nothing ends by saying so, which is a fact about the search " +
    "and not about whether an interest is adverse. Deciding that is a reviewer's act and is recorded " +
    "as a disposition naming them. A disposition recording a waiver carries the waiver's own record " +
    "and, where the platform does not hold the whole of it, what that record is short of.",
  request: { params: checkIdParam },
  responses: {
    200: {
      description: "The check, the statement of what it searched, and its hits",
      content: { "application/json": { schema: GetCheckResponse } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
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
    "surfaced nothing. Every field is computed from the log at the moment of the request and nothing " +
    "is stored, so raising the firm's policy shows up here immediately. The response reports what was " +
    "searched and what was found and asserts nothing about whether an interest is adverse: there is no " +
    "summary field and no single verdict, because concluding is a lawyer's act and the record says " +
    "whose.",
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

export function registerConflictsRoutes(app: ConflictsApp, chokepoint: Chokepoint): void {
  // POST /api/v1/conflicts/checks
  app.openapi(
    { ...runCheckRoute, middleware: chokepointMiddleware(chokepoint, runCheckRoute) },
    async (c) => {
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const context = await conflictsContext(c);
      try {
        const id = await runConflictsCheck(
          context,
          {
            trigger: request.trigger,
            matterId: request.matterId,
            subjectEntityIds: request.subjectEntityIds,
            scope: request.scope,
          },
          {
            clock: { now: () => new Date().toISOString() },
            actorUserId: userId,
            randomSource: cryptoRandomSource,
            idempotency,
          },
        );
        return c.json({ id } as z.infer<typeof CreatedCheckResponse>, 201);
      } catch (caught) {
        return conflictsErrorResponse(c, caught);
      }
    },
  );

  // GET /api/v1/conflicts/checks/{checkId}
  app.openapi(
    { ...getCheckRoute, middleware: chokepointMiddleware(chokepoint, getCheckRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { checkId } = c.req.valid("param");
      const checkRow = await readCheckRow(firm.firmDatabase, checkId);
      if (checkRow === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such conflicts check in this firm.",
        });
      }
      const hitRows = await readHitRows(firm.firmDatabase, checkId);

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
      const [dispositionStates, partyNames] = await Promise.all([
        readHitDispositionStates(firm.firmDatabase, checkId),
        readEntityDisplayNames(
          firm.firmDatabase,
          hitRows.map((hitRow) => hitRow.entity_id),
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
        return {
          id: hitRow.id,
          entityId: hitRow.entity_id,
          party,
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
      const check = {
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
      };
      return c.json({ check, statement, hits } as unknown as z.infer<typeof GetCheckResponse>, 200);
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
      if (hit === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such conflicts hit in this firm.",
        });
      }
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
            clock: { now: () => new Date().toISOString() },
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
