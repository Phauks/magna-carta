/*
 * The conflicts surface's response shapes and calls. Mirrors the four conflicts operations in
 * apps/api-worker/openapi/openapi.json, plus the two Directory reads this surface needs to put a
 * NAME on an entity; the transport envelope lives in $lib/api/request.ts.
 *
 * `apps/web` does not depend on the generated client, so each surface hand-writes the shapes it
 * reads. Four facts about this contract shape every screen above it, and all four are recorded here
 * rather than rediscovered:
 *
 *   - THE SERVER NAMES NO ENTITY. A hit carries `entityId` and nothing else about who matched, and
 *     there is no batch entity-name read. Naming every row would be one request per row, which is
 *     the fan-out the platform forbids, so the list states the gap and a hit names its party when a
 *     reviewer opens it — one read for the hit under review, through the Directory surface's own
 *     module rather than through a second copy of it here.
 *   - THERE IS NO LISTING OF CHECKS. A check is reachable by its own identifier, and a matter's
 *     latest check through that matter's standing. Nothing answers "every check this firm has run",
 *     so no screen here offers one.
 *   - THE STATEMENT IS THE SERVER'S OWN WORDS. `statement` arrives as a list of sentences the
 *     platform wrote about its own search. Nothing here rewrites, summarizes, or reorders them: the
 *     whole value of the sentence is that the firm can defend the one its system produced.
 *   - A DISPOSITION IS APPEND-ONLY. Recording one never edits an earlier one; a reviewer who
 *     reverses a call records a second disposition and both stay on the books.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

// ---- the domain's own catalogues, as the API spells them -------------------------------------

/** The four classes of thing a check can search. Taken verbatim from the conflicts domain. */
export type SourceClass = "party" | "graph" | "imputation" | "content";

/** A recall band, never a threshold: over_inclusive returns a strict superset of balanced. */
export type Strictness = "balanced" | "over_inclusive";

/** Why a check ran. The catalogue is open on the contract, so a reader must tolerate a new word. */
export type ConflictsTrigger =
  | "preliminary"
  | "comprehensive"
  | "new_party"
  | "entity_merged"
  | "entity_renamed"
  | "relationship_recorded"
  | "identifier_recorded"
  | "personnel_changed"
  | "periodic_rescan";

/** A reviewer's adjudication of one hit. */
export type DispositionKind =
  | "cleared"
  | "waiver_obtained"
  | "wall_erected"
  | "representation_declined";

/** Whether a source ran. "unavailable" is never "searched and nothing surfaced". */
export type SourceAvailability = "searched" | "unavailable";

/** Ordering only. 1 is the strongest evidence, and no tier is ever filtered out. */
export type EvidenceTier = 1 | 2 | 3 | 4;

/** The edge classes that carry a hop budget. Corporate family is traversed transitively. */
export type BudgetedEdgeClass = "control" | "family" | "representation";

// ---- what a check is asked for ---------------------------------------------------------------

export interface ScopeRequest {
  sources: SourceClass[];
  strictness: Strictness;
  /** Omitted means the firm's configured default. An explicit 0 is honoured as given. */
  depth?: number;
  edgeClassBudgets?: Partial<Record<BudgetedEdgeClass, number>>;
  /** The most entities the traversal may reach. Omitted means the firm's setting. */
  closureCap?: number;
  /** The most candidates the run may record. Omitted means the firm's setting. */
  candidateCap?: number;
}

export interface RunCheckRequest {
  trigger: ConflictsTrigger;
  /** Supplying it adds the matter's own parties to the subjects and lets imputation run. */
  matterId?: string;
  subjectEntityIds: string[];
  scope: ScopeRequest;
}

/** What the run answers: the identity of the check it wrote. */
export interface RunCheckResponse {
  id: string;
}

// ---- what a check says about itself ----------------------------------------------------------

/** One hop of the connecting path from a subject party to a surfaced entity. */
export interface GraphPathStep {
  edgeId: string;
  edgeType: string;
  fromEntityId: string;
  toEntityId: string;
  /**
   * True when the relationship had already ended when the check read the corpus. An ended
   * relationship is traversed rather than skipped, and the reviewer weighs the expiry. Absent on a
   * path recorded before the traversal carried the flag.
   */
  expiredAtCheck?: boolean;
}

export interface DispositionDetail {
  id: string;
  kind: DispositionKind;
  rationale: string;
  reviewerUserId: string;
  createdAt: string;
}

export interface HitDetail {
  id: string;
  entityId: string;
  sourceClass: SourceClass;
  evidenceTier: EvidenceTier;
  /** Every channel that fired, in the domain's own words. Never a score. */
  matchedFields: string[];
  graphPath: GraphPathStep[];
  /** True when the matched entity is itself a subject party of this check. */
  coParty: boolean;
  createdAt: string;
  /** The reviewer's latest word on this hit, or null when nobody has answered it. */
  disposition: DispositionDetail | null;
}

/** What the name comparison compared. `strictness` is a preset name; this names the channels. */
export interface MatchingRecord {
  nameKeys: string[];
  phoneticSchemes: string[];
  /** Null means every role the corpus holds, which is not the same as a list naming them all. */
  nameRoles: string[] | null;
}

/** How far the walk was allowed to go, and whether it got there. */
export interface TraversalRecord {
  edgeClassBudgets: Record<string, number>;
  closureCap: number | null;
  /** True when the closure cap stopped the walk. A truncated walk is never a completed one. */
  truncated: boolean;
  entitiesReached: number | null;
  /** Entities the cap refused to admit. These were never matched. */
  unexploredFrontierSize: number | null;
  /** Entities that are in the closure and were matched, but whose own edges were never read. */
  unexpandedReachedCount: number | null;
}

export interface RefusedTierCount {
  tier: EvidenceTier;
  count: number;
}

/** How many candidates the run wrote, and how many the cap refused. */
export interface CandidateRecord {
  candidateCap: number | null;
  truncated: boolean;
  candidatesSurfaced: number | null;
  candidatesWritten: number | null;
  candidatesRefused: number | null;
  refusedByTier: RefusedTierCount[];
}

export interface CheckDetail {
  id: string;
  trigger: string;
  matterId: string | null;
  subjectEntityIds: string[];
  /** Every registered source with the availability the check recorded, keyed by source. */
  scope: Record<string, SourceAvailability>;
  strictness: string;
  depth: number;
  /** True when the requested scope fell below the firm's floor and was raised to it. */
  floorRaised: boolean;
  /** Null on a check written before the record existed: the row does not say. */
  matching: MatchingRecord | null;
  traversal: TraversalRecord | null;
  candidates: CandidateRecord | null;
  actorUserId: string | null;
  createdAt: string;
}

export interface CheckWithHits {
  check: CheckDetail;
  /** The platform's account of its own search, one sentence per line, in reading order. */
  statement: string[];
  hits: HitDetail[];
}

// ---- where a matter stands -------------------------------------------------------------------

/**
 * The scope a check ran under, as both reads answer it.
 *
 * The two endpoints key the source map differently — the check calls it `scope`, the standing calls
 * it `sources` — and everything else about the shape is identical, because both are reading the
 * same stored row. One type here, with a converter for the check's spelling, is what lets one
 * component state what was searched wherever it is read; two would be two accounts of one row.
 */
export interface ScopeInForceRecord {
  sources: Record<string, SourceAvailability>;
  strictness: string;
  depth: number;
  floorRaised: boolean;
  matching: MatchingRecord | null;
  traversal: TraversalRecord | null;
  candidates: CandidateRecord | null;
}

export type PostureScope = ScopeInForceRecord;

/** A check's own scope, under the shape the standing read uses. */
export function scopeOfCheck(check: CheckDetail): ScopeInForceRecord {
  return {
    sources: check.scope,
    strictness: check.strictness,
    depth: check.depth,
    floorRaised: check.floorRaised,
    matching: check.matching,
    traversal: check.traversal,
    candidates: check.candidates,
  };
}

export interface PostureLatestCheck {
  id: string;
  createdAt: string;
  trigger: string;
  actorUserId: string | null;
  scope: PostureScope;
  subjectEntityCount: number;
  expandedEntityCount: number;
  skippedIdentifierTypes: string[];
  hitCount: number;
}

/** What the firm's current policy requires that the latest check did not run. */
export interface PostureScopeShortfall {
  sources: SourceClass[];
  strictness: { firmFloor: Strictness; ranUnder: string } | null;
  depth: { firmDefault: number; ranAt: number } | null;
}

export interface PostureUndisposedTier {
  tier: EvidenceTier;
  count: number;
}

export interface PostureDispositionKind {
  kind: DispositionKind;
  count: number;
  reviewerUserIds: string[];
}

export interface PostureUnavailableSource {
  source: string;
  reason: string;
}

/** A re-check the platform knows is owed, naming the corpus change that caused it. */
export interface PosturePendingRecheck {
  causeTopic: string;
  causeReference: string;
  causeOccurredAt: string;
  requestedAt: string;
}

/** The clock-driven backstop's standing. A firm that switched it off made a choice worth showing. */
export interface PosturePeriodicRescan {
  enabled: boolean;
  intervalDays: number;
  lastRunAt: string | null;
}

/**
 * Where a matter stands on conflicts.
 *
 * There is deliberately no aggregate and no verdict on this shape. It reports what was searched,
 * what could not be searched, and what no reviewer has answered; concluding is a lawyer's act and
 * the record says whose. A surface that wants a single word has to write that word itself and own
 * it, and none of these screens does.
 */
export interface MatterConflictsPosture {
  matterId: string;
  /** True when no check has ever named this matter — its own state, not an empty result. */
  neverChecked: boolean;
  latestCheck: PostureLatestCheck | null;
  scopeShortfall: PostureScopeShortfall;
  pendingRecheck: PosturePendingRecheck[];
  periodicRescan: PosturePeriodicRescan;
  undisposedByTier: PostureUndisposedTier[];
  dispositionsByKind: PostureDispositionKind[];
  unavailableSources: PostureUnavailableSource[];
}

// ---- recording an adjudication ---------------------------------------------------------------

export interface RecordDispositionRequest {
  kind: DispositionKind;
  /** Never blank: the server refuses an empty rationale, and so does the control that sends it. */
  rationale: string;
}

export interface RecordDispositionResponse {
  id: string;
}

// ---- the calls -------------------------------------------------------------------------------

/**
 * Run a check. The idempotency key is required by the contract, so a retried submit cannot write a
 * second check into the firm's append-only conflicts log.
 */
export function runConflictsCheck(
  fetchImpl: typeof fetch,
  request: RunCheckRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<RunCheckResponse>> {
  return requestJson(fetchImpl, "/api/v1/conflicts/checks", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

/** One completed check, the statement of what it searched, and every hit it surfaced. */
export function readConflictsCheck(
  fetchImpl: typeof fetch,
  checkId: string,
): Promise<ApiOutcome<CheckWithHits>> {
  return requestJson(fetchImpl, `/api/v1/conflicts/checks/${encodeURIComponent(checkId)}`);
}

/** Where one matter stands. Derived at read time, so a policy change shows up immediately. */
export function readMatterConflictsPosture(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<MatterConflictsPosture>> {
  return requestJson(
    fetchImpl,
    `/api/v1/matters/${encodeURIComponent(matterId)}/conflicts-posture`,
  );
}

/**
 * Record a reviewer's adjudication of one hit. The reviewer is the authenticated member — the
 * request cannot name somebody else, which is what keeps a conclusion attached to whoever drew it.
 */
export function recordConflictsDisposition(
  fetchImpl: typeof fetch,
  hitId: string,
  request: RecordDispositionRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<RecordDispositionResponse>> {
  return requestJson(
    fetchImpl,
    `/api/v1/conflicts/hits/${encodeURIComponent(hitId)}/dispositions`,
    { method: "POST", body: request, idempotencyKey },
  );
}

// ---- the Directory reads this surface needs --------------------------------------------------
//
// There are none here, deliberately. Picking a subject party, naming the entity a hit landed on and
// telling a person from an organization are all the Directory surface's own reads, and they live in
// $lib/directory/directory-api.ts with the presentation beside them in entity-presentation.ts. A
// second copy of the Directory's transport in this file would be a second answer to what an entity
// is called, and the two would drift the first time either was corrected.

// ---- the permissions these routes name --------------------------------------------------------

/** Running a check. A member without it is refused server-side. */
export const RUN_CHECK_PERMISSION = "conflicts:run";
/** Reading a check and a matter's standing. */
export const READ_CONFLICTS_PERMISSION = "conflicts:read";
/** Recording an adjudication of a hit. */
export const DISPOSE_CONFLICTS_PERMISSION = "conflicts:dispose";
