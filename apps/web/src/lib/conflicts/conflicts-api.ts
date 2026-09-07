/*
 * The conflicts surface's response shapes and calls. Mirrors the four conflicts operations in
 * apps/api-worker/openapi/openapi.json, plus the two Directory reads this surface needs to put a
 * NAME on an entity; the transport envelope lives in $lib/api/request.ts.
 *
 * `apps/web` does not depend on the generated client, so each surface hand-writes the shapes it
 * reads. Four facts about this contract shape every screen above it, and all four are recorded here
 * rather than rediscovered:
 *
 *   - THE SERVER NAMES THE ENTITY, since 2026-09-02. A hit carries `party` — the kind and the name
 *     the Directory holds for it TODAY, resolved on the read rather than copied onto the append-only
 *     log, so a reviewer deciding now sees the current name. It is null when the entity does not
 *     resolve at all, which the log's append-only rule makes reachable (a merge can reshape an
 *     entity an old hit names); that is an unresolved party and is never rendered as no party.
 *   - THE CHECKS A FIRM HAS RUN ARE LISTABLE, since 2026-09-02: `listConflictsChecks` pages them
 *     newest first, optionally narrowed to one matter. A line names what set the run going and who
 *     asked where anybody did, and never a conclusion about what it found.
 *   - THE STATEMENT IS THE SERVER'S OWN WORDS. `statement` arrives as a list of sentences the
 *     platform wrote about its own search. Nothing here rewrites, summarizes, or reorders them: the
 *     whole value of the sentence is that the firm can defend the one its system produced.
 *   - A DISPOSITION IS APPEND-ONLY. Recording one never edits an earlier one; a reviewer who
 *     reverses a call records a second disposition and both stay on the books.
 *   - A WAIVER CARRIES ITS OWN RECORD, AND IT CAN BE SHORT. The server accepts a waiver whose
 *     informed consent is not yet confirmed in writing — that genuinely happens, and refusing the
 *     row would only mean the firm's log never hears about the waiver at all — and it returns what
 *     the record is short of. Every surface that shows a disposition has to show that: an
 *     unevidenced waiver reading the same as an evidenced one is the failure this contract exists
 *     to prevent.
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

/**
 * What one recorded waiver is short of, as the server names it. Empty on every other kind — those
 * carry no waiver record and are not incomplete for lacking one.
 *
 * Each is a fact about the PLATFORM'S OWN RECORD, never about the matter and never a grade of the
 * reviewer's judgement: the platform is saying what it could not produce if somebody asked.
 */
export type WaiverShortfall =
  | "consenting-party-unrecorded"
  | "consent-not-confirmed-in-writing"
  | "confirmation-not-filed"
  | "date-given-unrecorded";

/**
 * The waiver's own record, on a disposition that has one.
 *
 * Null on the other three kinds and on a `waiver_obtained` row recorded before the platform could
 * hold this at all — which is the row not saying, and reads as a shortfall exactly as an absent
 * field on a row that has the columns does.
 */
export interface WaiverDetail {
  /** The Directory entity that consented. A handle, so a reader can look the consenting party up. */
  givenByEntityId: string | null;
  /** Stated in its own right, never inferred from the document being present. */
  confirmedInWriting: boolean | null;
  /** The filed document evidencing the confirmation, where the firm has filed it. */
  documentFileId: string | null;
  /** The civil date the waiver was GIVEN. Not `createdAt`, which is when it was written down. */
  givenOn: string | null;
}

export interface DispositionDetail {
  id: string;
  kind: DispositionKind;
  rationale: string;
  reviewerUserId: string;
  waiver: WaiverDetail | null;
  /** What this record is short of. Always empty on a kind that carries no waiver. */
  shortfalls: WaiverShortfall[];
  createdAt: string;
}

/** Who a hit is about, as the Directory names them today. */
/**
 * One act on a hit's trail. The same fields the check response's `disposition` carries, and a
 * separate type for the same reason the wire keeps them separate: there, null means nobody has
 * answered; here every entry is something that happened and there is no null to express.
 */
export interface DispositionTrailEntry {
  id: string;
  kind: DispositionKind;
  rationale: string;
  reviewerUserId: string;
  waiver: WaiverDetail | null;
  shortfalls: WaiverShortfall[];
  createdAt: string;
}

export interface DispositionTrail {
  hitId: string;
  /** Oldest first: the trail reads as a narrative, and a reversal only makes sense after what it reverses. */
  dispositions: DispositionTrailEntry[];
}

/**
 * One line of the firm's check history. Narrow on purpose: the whole check — its recorded scope, its
 * statement, its hits — is one identifier away, and a listing that carried all of it would read
 * every check's inputs for a surface that shows none of them.
 */
export interface ConflictsCheckSummary {
  id: string;
  trigger: ConflictsTrigger;
  /** Null for a check against a prospective party set with no matter. Not every check has one. */
  matterId: string | null;
  strictness: Strictness;
  depth: number;
  /** True when the firm's floor raised the scope above what was asked for — it searched WIDER. */
  floorRaised: boolean;
  /** Null on an automated run, which is nobody's act. Never the same as a manual run's actor. */
  actorUserId: string | null;
  /** manual, event or schedule. Null on a row written before the column existed. */
  triggerSource: string | null;
  hitCount: number;
  createdAt: string;
}

export interface ConflictsCheckPage {
  data: ConflictsCheckSummary[];
  nextCursor: string | null;
}

/** The firm's mandatory minimum for every check. A per-run scope may add to it, never subtract. */
export interface FirmConflictsPolicy {
  floorSources: SourceClass[];
  floorStrictness: Strictness;
  /** A default rather than a floor: a caller may search shallower, and the check records what ran. */
  defaultDepth: number;
  edgeClassBudgets: Record<string, number>;
  closureCap: number;
  candidateCap: number;
  /** The name rows the balanced band compares. Never empty. */
  balancedNameRoles: string[];
}

export interface HitParty {
  kind: "person" | "organization";
  /** Null when the record exists and carries no name — not the same as an unresolved entity. */
  displayName: string | null;
}

/**
 * What the firm already said about the same party, on an EARLIER check.
 *
 * CONTEXT, never this hit's answer. A company cleared as a former client can re-surface as the
 * subsidiary of a current one — same party, a different question, on a higher bar. So a hit carrying
 * this is still unanswered, and no surface may render it as answered, pre-fill from it, or hide the
 * hit because of it.
 */
export interface PriorConclusion {
  checkId: string;
  kind: DispositionKind;
  reviewerUserId: string;
  createdAt: string;
}

export interface HitDetail {
  id: string;
  entityId: string;
  /** Null when the entity does not resolve to a live Directory record. Never "no party matched". */
  party: HitParty | null;
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
  /** An earlier check's answer about the same party. Context only — never this hit's answer. */
  previouslyAnswered: PriorConclusion | null;
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
  /** How many of those the platform cannot produce the record for. Zero on every kind but a waiver. */
  incompleteCount: number;
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

/**
 * The waiver a reviewer records alongside a `waiver_obtained` adjudication.
 *
 * The consenting party and the date are required by the server, because they are the act being
 * recorded. Whether it was confirmed in writing must be ANSWERED, and `false` is an accepted answer;
 * the evidencing document may be absent. A waiver given orally and confirmed later is a real thing,
 * and the row that records it reads as incomplete rather than being refused.
 */
export interface WaiverRequest {
  givenByEntityId: string;
  confirmedInWriting: boolean;
  /** Null where the firm has not filed the confirmation here yet. */
  documentFileId: string | null;
  /** The civil date the waiver was given, YYYY-MM-DD. */
  givenOn: string;
}

export interface RecordDispositionRequest {
  kind: DispositionKind;
  /** Never blank: the server refuses an empty rationale, and so does the control that sends it. */
  rationale: string;
  /** Required on `waiver_obtained`; refused on every other kind. */
  waiver?: WaiverRequest;
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

/**
 * Every answer recorded against one hit, oldest first — the trail rather than the latest word.
 *
 * Read when a reviewer OPENS a hit, not with the list: the whole history of one candidate is the one
 * thing only this view uses, and carrying it on the check response would grow every page view by it.
 */
export function readConflictsDispositionTrail(
  fetchImpl: typeof fetch,
  hitId: string,
): Promise<ApiOutcome<DispositionTrail>> {
  return requestJson(fetchImpl, `/api/v1/conflicts/hits/${encodeURIComponent(hitId)}/dispositions`);
}

/**
 * The firm's own conflicts floor — what every check is held to, whatever a caller asks for.
 *
 * On `conflicts:read` because every member who can read a check is held to it: a reviewer looking at
 * a check that fell short of the floor has to be able to see what the floor is.
 */
export function readFirmConflictsPolicy(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<FirmConflictsPolicy>> {
  return requestJson(fetchImpl, "/api/v1/firm/conflicts-policy");
}

/**
 * Set the firm's floor. The whole policy, written whole.
 *
 * PUT rather than a patch because the floor is ONE value: two administrators saving different halves
 * of the same screen would otherwise compose a floor neither of them chose, and the floor is what
 * every later check is held to.
 *
 * WHAT COMES BACK IS WHAT WAS STORED, not what was sent. The platform normalizes on the way in — the
 * party class is unioned back into the floor, `current` back into the name roles, the candidate cap
 * clamped to what one atomic batch can carry — so a caller that displays the RESPONSE is showing the
 * floor its checks will actually run, and one that re-displays its own request is not. Always render
 * the response.
 */
export function writeFirmConflictsPolicy(
  fetchImpl: typeof fetch,
  policy: FirmConflictsPolicy,
  idempotencyKey: string,
): Promise<ApiOutcome<FirmConflictsPolicy>> {
  return requestJson(fetchImpl, "/api/v1/firm/conflicts-policy", {
    method: "PUT",
    body: policy,
    idempotencyKey,
  });
}

/**
 * Run a fresh check against one matter's live parties, now, because a member asked.
 *
 * It sends NO scope, and there is none to send: the firm's floor is what runs. A screen composing a
 * scope here would be a screen deciding how thoroughly the firm searches.
 */
export function recheckMatterConflicts(
  fetchImpl: typeof fetch,
  matterId: string,
  writeKey: string,
): Promise<ApiOutcome<{ checkId: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/matters/${encodeURIComponent(matterId)}/conflicts-rechecks`,
    { method: "POST", body: {}, idempotencyKey: writeKey },
  );
}

/**
 * The checks this firm has run, newest first, one page at a time.
 *
 * `matterId` narrows to one matter's own history, which is also the shape the table's index serves
 * directly; the firm-wide read has its own index, added when the load-profile plan probe measured
 * it as a full table scan of a log that only grows.
 */
export function listConflictsChecks(
  fetchImpl: typeof fetch,
  options: { matterId?: string; cursor?: string } = {},
): Promise<ApiOutcome<ConflictsCheckPage>> {
  const parameters = new URLSearchParams();
  if (options.matterId !== undefined) parameters.set("matterId", options.matterId);
  if (options.cursor !== undefined) parameters.set("cursor", options.cursor);
  const query = parameters.toString();
  return requestJson(fetchImpl, `/api/v1/conflicts/checks${query === "" ? "" : `?${query}`}`);
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
/**
 * Setting the firm's floor. Narrower than the three above and seeded to Owner and Admin alone: this
 * does not act on a check, it decides what every LATER check searches, and no check row records that
 * a person chose it. Reading the floor stays on conflicts:read.
 */
export const CONFIGURE_CONFLICTS_PERMISSION = "conflicts:configure";
