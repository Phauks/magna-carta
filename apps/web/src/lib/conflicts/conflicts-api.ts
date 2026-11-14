/*
 * The conflicts surface's response shapes and calls. Mirrors the conflicts operations in
 * apps/api-worker/openapi/openapi.json, plus nothing from the Directory: naming an entity is the
 * Directory surface's own read; the transport envelope lives in $lib/api/request.ts.
 *
 * `apps/web` does not depend on the generated client, so each surface hand-writes the shapes it
 * reads. The facts about this contract that shape every screen above it are recorded here rather
 * than rediscovered:
 *
 *   - A CHECK IS A NUMBERED RECORD WITH RUNS UNDER IT, since 2026-09-11. Asking for a check OPENS
 *     it: the server draws the firm's next number, queues the first run and answers at once. The
 *     search runs after the response, and reading the check says where the run has got to until it
 *     settles; then it carries that run's record. A check can be run again (a further run under the
 *     same number) and filed on a matter after it ran. The address takes the check's handle or any
 *     run's handle.
 *   - THE SERVER NAMES THE ENTITY, since 2026-09-02. A hit carries `party` — the kind and the name
 *     the Directory holds for it TODAY, resolved on the read rather than copied onto the append-only
 *     log, so a reviewer deciding now sees the current name. It is null when the entity does not
 *     resolve at all, which the log's append-only rule makes reachable (a merge can reshape an
 *     entity an old hit names); that is an unresolved party and is never rendered as no party.
 *   - THE LOG LISTS CHECKS, NOT RUNS: `listConflictsChecks` pages the numbered checks newest first,
 *     one line each carrying the latest run's facts and how many runs there have been, optionally
 *     narrowed to the checks filed on one matter. Never a conclusion about what any of them found.
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

/** Where a run of a check is in its life. */
/** `cancelled` is a run a member stopped: an act, never a fault. */
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/** Where a running search is, in the order the engine actually works. */
export type RunStage = "sources" | "walking" | "matching" | "places" | "candidates";

// ---- what a check is asked for ---------------------------------------------------------------

/**
 * What a check searches and how names are compared. Nothing about how far or how much: a check
 * follows relationships to closure, and the bound on a run is the platform's, not a caller's.
 */
export interface ScopeRequest {
  sources: SourceClass[];
  strictness: Strictness;
  /** The firm's own records to search beyond the Directory. Absent means none. */
  places?: PlacesRequest;
}

export type MessagingChannel = "calls" | "texts" | "email";
/** The matter statuses a task is searched under; a task on no matter is searched whenever tasks are. */
export type TaskMatterStatus = "consultations" | "open" | "closed" | "archived";

/** The matter statuses a file is searched under; Archived is files deleted from a matter. */
export type FileMatterStatus = TaskMatterStatus;

/**
 * Calls, texts, email, tasks, Magnus conversations and files. An empty list, or false, is not asked
 * for; `files` is absent on a run asked for before Files could be searched.
 */
export interface PlacesRequest {
  messaging: MessagingChannel[];
  tasks: TaskMatterStatus[];
  magnus: boolean;
  files?: FileMatterStatus[];
}

export type FoundInKind = "call" | "text" | "email" | "task" | "magnus_conversation" | "file";

/** Where in the firm's own records a result was found. Never the record's text. */
export interface FoundIn {
  kind: FoundInKind;
  id: string;
  matterId: string | null;
  /** The matter's number, or its consultation or intake number. Null when it has none. */
  matterNumber: string | null;
  at: string | null;
}

export interface RunCheckRequest {
  trigger: ConflictsTrigger;
  /** Supplying it adds the matter's own parties to the subjects and lets imputation run. */
  matterId?: string;
  subjectEntityIds: string[];
  scope: ScopeRequest;
  /** The draft number the panel holds, so the check is opened under exactly that number. */
  numberReservation?: string;
}

/** What opening a check, or a further run of one, answers. The search has not run yet. */
export interface OpenedCheck {
  /** The check's handle — its first run's — which is what the check's address is. */
  id: string;
  checkNumber: string;
  runId: string;
  ordinal: number;
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
 * One line of the firm's log: a numbered check, carrying its latest run's facts and how many runs it
 * has had. Narrow on purpose: the whole check — its runs, its record, its hits — is one identifier
 * away, and a listing that carried all of it would read every check's record for a surface that
 * shows none of it.
 */
export interface ConflictsCheckSummary {
  id: string;
  checkNumber: string;
  /** Where the check is filed. Null for the pre-engagement screen, until somebody files it. */
  matterId: string | null;
  createdAt: string;
  createdByUserId: string | null;
  runCount: number;
  latestRunId: string | null;
  runStatus: RunStatus | null;
  latestRunAt: string | null;
  trigger: ConflictsTrigger | null;
  /** manual, event or schedule. Null on a row that does not say. */
  triggerSource: string | null;
  /** Who asked for the latest run. Null on an automated run, which is nobody's act. */
  actorUserId: string | null;
  /** The latest run's record, where it has one. Null while the run has no record yet. */
  strictness: Strictness | null;
  /** True when the firm's floor raised the scope above what was asked for — it searched WIDER. */
  floorRaised: boolean | null;
  hitCount: number | null;
  /** Who the latest run searches, by name. */
  subjectParties: SubjectParty[];
}

/** One party a check was asked about. `party` is null where the Directory no longer resolves it. */
export interface SubjectParty {
  entityId: string;
  party: HitParty | null;
}

export interface ConflictsCheckPage {
  data: ConflictsCheckSummary[];
  nextCursor: string | null;
}

/**
 * The firm's mandatory minimum for every check. A per-run scope may add to it, never subtract.
 * Nothing about depth or bounds: a firm no longer decides how far a check follows relationships or
 * where it stops.
 */
export interface FirmConflictsPolicy {
  floorSources: SourceClass[];
  floorStrictness: Strictness;
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
  /** Where in the firm's own records it was found; null for a Directory result. */
  foundIn: FoundIn | null;
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
  /** Whether names were also found by trigram overlap. True on every check before it could be turned off. */
  trigramMatching: boolean;
}

/** How the walk went, and whether it got to the end. */
export interface TraversalRecord {
  /** True on a run that followed every relationship to closure; false on an older record. */
  followedToClosure: boolean;
  /** The longest chain of relationships the walk followed. Null where the record does not say. */
  longestPathLength: number | null;
  /** The hop budget per edge class an OLDER run resolved. Empty on a walk to closure. */
  edgeClassBudgets: Record<string, number>;
  /** The most entities the walk could reach: the platform's ceiling, or an older run's firm cap. */
  closureCap: number | null;
  /** True when the bound stopped the walk. A truncated walk is never a completed one. */
  truncated: boolean;
  entitiesReached: number | null;
  /** Entities the bound refused to admit. These were never matched. */
  unexploredFrontierSize: number | null;
  /** Entities that are in the closure and were matched, but whose own edges were never read. */
  unexpandedReachedCount: number | null;
}

export interface RefusedTierCount {
  tier: EvidenceTier;
  count: number;
}

/** How many candidates the run wrote, and how many the platform's bound refused. */
export interface CandidateRecord {
  /** The most one record can carry: the platform's bound, never a firm's setting. */
  candidateCap: number | null;
  truncated: boolean;
  candidatesSurfaced: number | null;
  candidatesWritten: number | null;
  candidatesRefused: number | null;
  refusedByTier: RefusedTierCount[];
}

/** One run's search record: what ran, over what, under which settings. */
export interface CheckDetail {
  id: string;
  trigger: string;
  /** The matter the search actually ran against — the record's own fact, which never moves. */
  matterId: string | null;
  subjectEntityIds: string[];
  /** Every registered source with the availability the check recorded, keyed by source. */
  scope: Record<string, SourceAvailability>;
  strictness: string;
  /** How deep the walk ran on a walk to closure, or the widest hop budget on an older record. */
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

/**
 * One part of the platform's account of a search: who searched and when, one part of the Directory
 * search, one place beyond it, what was not searched, or what surfaced. `attention` marks a part
 * saying the search was narrower than asked or stopped short.
 */
export interface ReportSection {
  key:
    | "searched"
    | "names"
    | "relationships"
    | "employees"
    | "messaging"
    | "tasks"
    | "magnus"
    | "files"
    | "not_searched"
    | "results";
  heading: string;
  lines: string[];
  attention: boolean;
}

/** A completed run's record: the search's own account, its recorded scope, and every hit. */
export interface CheckWithHits {
  check: CheckDetail;
  /** The platform's account of its own search, as sections in reading order. */
  report: ReportSection[];
  hits: HitDetail[];
}

/** What a running search has counted so far. A stage reports what it has and no others. */
export interface RunProgress {
  sourcesSearched?: number;
  subjectParties?: number;
  entitiesReached?: number;
  entitiesMatched?: number;
  candidatesSurfaced?: number;
  candidatesRecorded?: number;
  /** Results found in calls, texts, email, tasks and Magnus conversations. */
  placeResults?: number;
}

/** One run of a check: its place in the history, where it is, and what it came to. */
export interface RunSummary {
  id: string;
  ordinal: number;
  status: RunStatus;
  /** Null before the run starts and once it settles: a settled run's account is its record. */
  stage: RunStage | null;
  progress: RunProgress;
  trigger: string;
  triggerSource: string | null;
  /** Null on an automated run, which is nobody's act. */
  requestedByUserId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Why a failed run failed, in a sentence a person can act on. Null unless it failed. */
  failure: string | null;
  /** Who stopped a cancelled run. Null on every other run. */
  cancelledByUserId: string | null;
  /** What the run was asked to search, readable from the moment it is queued. */
  askedScope: {
    sources: string[];
    strictness: string;
    trigramMatching: boolean;
    places: PlacesRequest;
  } | null;
  /** How many candidates this run's record holds. Null while it has no record. */
  hitCount: number | null;
  /** Who this run searches, by name, from the moment it is queued. */
  subjectParties: SubjectParty[];
}

/** The numbered check itself: what a person refers to. */
export interface NumberedCheck {
  id: string;
  checkNumber: string;
  /** Where the check is filed. Null until somebody files it. */
  matterId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  latestRunId: string | null;
}

/** A check, its runs, and the selected run's record where it has one. */
export interface CheckRead {
  check: NumberedCheck;
  /** Every run, oldest first: the check's history. */
  runs: RunSummary[];
  /** The run this read is at — the one asked for, else the latest. */
  run: RunSummary;
  /** That run's record, or null while it has none (queued, running, or failed). */
  record: CheckWithHits | null;
  /**
   * The selected run's candidates, or none while it has no record. The same rows `record.hits`
   * carries, reachable without narrowing the record first — a caller that only wants to count what
   * surfaced should not have to know that a run in flight has no record yet.
   */
  hits: HitDetail[];
}

/** Whether a run is still doing something, i.e. whether a screen should keep asking. */
export function runInFlight(run: RunSummary): boolean {
  return run.status === "queued" || run.status === "running";
}

/** How often a screen asks after a run in flight. A search takes seconds; a second is the cadence. */
export const RUN_POLL_INTERVAL_MILLISECONDS = 1000;

/**
 * The longest a caller waits on one run before giving up on it. Past two minutes without a heartbeat
 * the server settles a run as failed on the next read, so a wait this long always ends in a settled
 * run or a read that could not be made.
 */
const RUN_WAIT_CEILING_MILLISECONDS = 3 * 60 * 1000;

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
  /** The number of the check this record is a run of. */
  checkNumber: string | null;
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
 * Open a check. The idempotency key is required by the contract, so a retried submit cannot open a
 * second check under a second number. The search runs after the response; read the check to follow it.
 */
export function openConflictsCheck(
  fetchImpl: typeof fetch,
  request: RunCheckRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<OpenedCheck>> {
  return requestJson(fetchImpl, "/api/v1/conflicts/checks", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

/** Run a check again: a further run under the same number, with the check's search as it stands. */
export function rerunConflictsCheck(
  fetchImpl: typeof fetch,
  checkId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<OpenedCheck>> {
  return requestJson(fetchImpl, `/api/v1/conflicts/checks/${encodeURIComponent(checkId)}/runs`, {
    method: "POST",
    body: {},
    idempotencyKey,
  });
}

/**
 * Stop a run that has not finished. Answers with how the run now stands: `cancelled`, or how it had
 * already settled when the press arrived.
 */
export function cancelConflictsRun(
  fetchImpl: typeof fetch,
  checkId: string,
  runId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string; status: RunStatus }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/conflicts/checks/${encodeURIComponent(checkId)}/runs/${encodeURIComponent(runId)}/cancel`,
    { method: "POST", body: {}, idempotencyKey },
  );
}

/** File a check on a matter. No search record moves; the next run searches with the matter's parties. */
export function fileConflictsCheckOnMatter(
  fetchImpl: typeof fetch,
  checkId: string,
  matterId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string; matterId: string }>> {
  return requestJson(fetchImpl, `/api/v1/conflicts/checks/${encodeURIComponent(checkId)}/matter`, {
    method: "PUT",
    body: { matterId },
    idempotencyKey,
  });
}

/**
 * One check with its runs, and the selected run's record where it has one. `runId` picks a run out
 * of the history; omitted, the read is at the latest.
 */
export async function readConflictsCheck(
  fetchImpl: typeof fetch,
  checkId: string,
  runId?: string,
): Promise<ApiOutcome<CheckRead>> {
  const query = runId === undefined ? "" : `?run=${encodeURIComponent(runId)}`;
  const outcome = await requestJson<Omit<CheckRead, "hits">>(
    fetchImpl,
    `/api/v1/conflicts/checks/${encodeURIComponent(checkId)}${query}`,
  );
  if (outcome.kind !== "ok") return outcome;
  return { kind: "ok", value: { ...outcome.value, hits: outcome.value.record?.hits ?? [] } };
}

/**
 * Wait for a run to settle, reading the check the way its screen does until the run is no longer
 * in flight. Answers the settled read, or the first read that could not be made. Bounded: a run
 * that never settles ends as a failed run on the server's own stale rule, not as a wait forever.
 */
export async function awaitConflictsRun(
  fetchImpl: typeof fetch,
  checkId: string,
  runId: string,
): Promise<ApiOutcome<CheckRead>> {
  const startedAt = Date.now();
  for (;;) {
    const outcome = await readConflictsCheck(fetchImpl, checkId, runId);
    if (outcome.kind !== "ok" || !runInFlight(outcome.value.run)) return outcome;
    if (Date.now() - startedAt > RUN_WAIT_CEILING_MILLISECONDS) return outcome;
    await new Promise((resolve) => setTimeout(resolve, RUN_POLL_INTERVAL_MILLISECONDS));
  }
}

/**
 * Open a check and wait for its first run to settle, for a caller that wants the finished check in
 * one call — the new-matter panel, which runs a check as part of opening the file and then counts
 * what surfaced. The check's own screen does not use this: it shows the run as it goes.
 */
export async function runConflictsCheck(
  fetchImpl: typeof fetch,
  request: RunCheckRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<OpenedCheck>> {
  const opened = await openConflictsCheck(fetchImpl, request, idempotencyKey);
  if (opened.kind !== "ok") return opened;
  const settled = await awaitConflictsRun(fetchImpl, opened.value.id, opened.value.runId);
  if (settled.kind !== "ok") return settled;
  return opened;
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
 * party class is unioned back into the floor, `current` back into the name roles — so a caller that
 * displays the RESPONSE is showing the floor its checks will actually run, and one that re-displays
 * its own request is not. Always render the response.
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
 * scope here would be a screen deciding how thoroughly the firm searches. It opens a further run
 * under the matter's own check, or a new one where the matter has none.
 */
export function recheckMatterConflicts(
  fetchImpl: typeof fetch,
  matterId: string,
  writeKey: string,
): Promise<ApiOutcome<OpenedCheck>> {
  return requestJson(
    fetchImpl,
    `/api/v1/matters/${encodeURIComponent(matterId)}/conflicts-rechecks`,
    { method: "POST", body: {}, idempotencyKey: writeKey },
  );
}

/**
 * The checks this firm refers to, newest first, one page at a time.
 *
 * `matterId` narrows to the checks filed on one matter, which is also the shape the table's index
 * serves directly.
 *
 * `search` narrows to the checks a term reaches — the matter a check is filed on, and the names it
 * has surfaced on any of its runs. It is a filter on the READ rather than over the rows in hand,
 * because the log is paged and a check nobody can find is a record the firm may have to produce.
 */
export function listConflictsChecks(
  fetchImpl: typeof fetch,
  options: { matterId?: string; search?: string; cursor?: string } = {},
): Promise<ApiOutcome<ConflictsCheckPage>> {
  const parameters = new URLSearchParams();
  if (options.matterId !== undefined) parameters.set("matterId", options.matterId);
  // A blank term is not a search: it would ask the server to match every row against "%%" for an
  // answer identical to asking nothing, at the cost of the scan.
  if (options.search !== undefined && options.search.trim() !== "") {
    parameters.set("search", options.search.trim());
  }
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
