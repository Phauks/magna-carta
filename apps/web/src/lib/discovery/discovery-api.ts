/*
 * The discovery surface's reads and writes.
 *
 * Mirrors the `discovery.*` operations in apps/api-worker/openapi/openapi.json. `apps/web`
 * hand-writes the response shapes it reads (the transport seam in $lib/api/request.ts says why), so
 * each type here is the wire shape and nothing more.
 *
 * THREE THINGS THIS MODULE DOES NOT DO, each for a reason the subsystem depends on.
 *
 * It never decides who may see a review set. The per-review-set access list composes into SQL ahead
 * of every LIMIT, on the server, on every read, and a member off the list gets 404 — the review set
 * is ABSENT rather than refused. So a surface built on these calls cannot leak a corpus by
 * forgetting a check, and must never try to help by inferring one: a client-side filter over rows
 * the server already declined to send would be a second answer to a question with one home.
 *
 * It never reaches a document's bytes. A review document is a POINTER at a file version, an email
 * message or an email attachment, and content is served through the file-manager and email read
 * paths that already exist, re-authorized. A private content path here would be a second door into
 * material under a protective order.
 *
 * And it composes no narrowing of its own. What may narrow the document list is declared in
 * criteria.ts and turned into these parameters there, so "what can this corpus be asked" has one
 * home and the answer grows by an entry rather than by a new call.
 *
 * EVERY WRITE CARRIES AN IDEMPOTENCY KEY, and the contract refuses it without one. A retried
 * declaration must not produce a second load: a load is the provenance record for one act of
 * loading, and two rows for one act is a defect in the record a firm hands to another party.
 */
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";
import type {
  DiscoveryLoadLane,
  DiscoveryLoadState,
  RecordCustodianKind,
  ReviewDocumentExceptionCode,
  ReviewDocumentExceptionStage,
  ReviewDocumentIndexState,
  ReviewDocumentProcessingState,
  ReviewSetState,
  TranscriptScope,
} from "./discovery-vocabulary.ts";

/** Reading a review set and everything in it. */
export const READ_DISCOVERY_PERMISSION = "discovery:read";
/** Creating a review set, naming its Custodians of Record, locking and closing it. */
export const MANAGE_REVIEW_SETS_PERMISSION = "discovery:manageReviewSets";
/** Declaring a load and putting material into it. */
export const LOAD_DISCOVERY_PERMISSION = "discovery:load";

function query(parameters: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  const rendered = search.toString();
  return rendered === "" ? "" : `?${rendered}`;
}

// ---- review sets -------------------------------------------------------------------------------

export interface ReviewSet {
  id: string;
  matterId: string;
  name: string;
  state: ReviewSetState;
  /** Snapshotted at creation: a ceiling the firm later lowers does not invalidate this set. */
  documentCeiling: number;
  documentCount: number;
  semanticIndexEnabled: boolean;
  createdBy: string;
  lockedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One matter's review sets, newest first. */
export function listMatterReviewSets(
  fetchImpl: typeof fetch,
  matterId: string,
  cursor?: string,
): Promise<ApiOutcome<Page<ReviewSet>>> {
  return requestJson(fetchImpl, `/api/v1/matters/${matterId}/review-sets${query({ cursor })}`);
}

/**
 * Every review set this member may reach, across every matter.
 *
 * Scoped by the access list and NOT by matter access, which is the register's whole reason for
 * existing: a reviewer brought in for one production is on that review set's list and may hold no
 * access at all to the matter it belongs to.
 */
export function listReviewSets(
  fetchImpl: typeof fetch,
  cursor?: string,
): Promise<ApiOutcome<Page<ReviewSet>>> {
  return requestJson(fetchImpl, `/api/v1/review-sets${query({ cursor })}`);
}

export function readReviewSet(
  fetchImpl: typeof fetch,
  reviewSetId: string,
): Promise<ApiOutcome<ReviewSet>> {
  return requestJson(fetchImpl, `/api/v1/review-sets/${reviewSetId}`);
}

export function createReviewSet(
  fetchImpl: typeof fetch,
  matterId: string,
  body: { name: string; semanticIndexEnabled?: boolean },
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/matters/${matterId}/review-sets`, {
    method: "POST",
    body,
    idempotencyKey,
  });
}

/**
 * Locks or closes a review set. There is no third move and no way back — the corpus under review is
 * what was reviewed, and a set that could be reopened is a corpus whose contents depend on when you
 * looked.
 */
export function transitionReviewSet(
  fetchImpl: typeof fetch,
  reviewSetId: string,
  state: "locked" | "closed",
  idempotencyKey: string,
): Promise<ApiOutcome<ReviewSet>> {
  return requestJson(fetchImpl, `/api/v1/review-sets/${reviewSetId}/state`, {
    method: "POST",
    body: { state },
    idempotencyKey,
  });
}

// ---- Custodians of Record ----------------------------------------------------------------------

/*
 * Two words, always. The platform already registers physical client originals whose family is
 * `custody*`, and a Custodian of Record is a completely different thing — whose ELECTRONIC records
 * these were. The two appear on the same matter and sometimes on the same screen, and a vocabulary
 * gate holds the naming in both directions.
 */
export interface RecordCustodian {
  id: string;
  reviewSetId: string;
  displayName: string;
  directoryEntityId: string | null;
  kind: RecordCustodianKind;
  createdAt: string;
  updatedAt: string;
}

export function listRecordCustodians(
  fetchImpl: typeof fetch,
  reviewSetId: string,
  cursor?: string,
): Promise<ApiOutcome<Page<RecordCustodian>>> {
  return requestJson(
    fetchImpl,
    `/api/v1/review-sets/${reviewSetId}/record-custodians${query({ cursor })}`,
  );
}

export function createRecordCustodian(
  fetchImpl: typeof fetch,
  reviewSetId: string,
  body: { displayName: string; kind: RecordCustodianKind; directoryEntityId?: string | null },
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/review-sets/${reviewSetId}/record-custodians`, {
    method: "POST",
    body,
    idempotencyKey,
  });
}

// ---- loads -------------------------------------------------------------------------------------

export interface DiscoveryLoad {
  id: string;
  reviewSetId: string;
  lane: DiscoveryLoadLane;
  state: DiscoveryLoadState;
  transcriptScope: TranscriptScope;
  declaredDocumentCount: number;
  loadedDocumentCount: number;
  processedCount: number;
  exceptionCount: number;
  defaultRecordCustodianId: string | null;
  sourceDescription: string | null;
  initiatedBy: string;
  initiatedAt: string;
  completedAt: string | null;
  /** Written at completion. Null until then, and null forever on a load that failed. */
  manifestR2Key: string | null;
  exceptionReportR2Key: string | null;
  /** What was claimed against what arrived. Reported, never used to correct either number. */
  reconciliation: { declarationMatched: boolean; accountedFor: boolean };
}

export function listLoads(
  fetchImpl: typeof fetch,
  reviewSetId: string,
  cursor?: string,
): Promise<ApiOutcome<Page<DiscoveryLoad>>> {
  return requestJson(fetchImpl, `/api/v1/review-sets/${reviewSetId}/loads${query({ cursor })}`);
}

export function readLoad(
  fetchImpl: typeof fetch,
  loadId: string,
): Promise<ApiOutcome<DiscoveryLoad>> {
  return requestJson(fetchImpl, `/api/v1/loads/${loadId}`);
}

export interface DeclareLoadRequest {
  lane: DiscoveryLoadLane;
  /**
   * Required, with no default in either direction. A transcript is the firm's own work product, and
   * a silent exclusion decides as much for somebody as a silent inclusion would.
   */
  transcriptScope: TranscriptScope;
  declaredDocumentCount: number;
  sourceDescription?: string | null;
  defaultRecordCustodianId?: string | null;
}

/**
 * Declares a load BEFORE the material arrives.
 *
 * That ordering is what makes the manifest's declared-against-actual reconciliation possible at all,
 * and what lets a load resume across a dropped connection.
 */
export function declareLoad(
  fetchImpl: typeof fetch,
  reviewSetId: string,
  body: DeclareLoadRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/review-sets/${reviewSetId}/loads`, {
    method: "POST",
    body,
    idempotencyKey,
  });
}

/** How far one turn of the load's fan-out got. A turn is asked for again until `complete`. */
export interface InternalLoadTurn {
  loadId: string;
  plannedCount: number;
  allocatedCount: number;
  /** What this turn queued to be READ. It says what was asked for, never what came back. */
  dispatchedCount: number;
  complete: boolean;
}

/**
 * Resolves a selection of the firm's own matter files, or its filed email, into review documents.
 *
 * NO BYTES MOVE. The platform already holds them with their hashes and their scan verdicts, so this
 * pins the version each review document points at. A quarantined or unscanned version is refused by
 * name rather than skipped — the difference matters, because a silently skipped document is a hole
 * in a corpus somebody is about to certify the contents of.
 */
export function runInternalSelection(
  fetchImpl: typeof fetch,
  loadId: string,
  body: { recordCustodianId: string; fileIds?: string[]; emailMessageIds?: string[] },
  idempotencyKey: string,
): Promise<ApiOutcome<InternalLoadTurn>> {
  return requestJson(fetchImpl, `/api/v1/loads/${loadId}/internal-selection`, {
    method: "POST",
    body,
    idempotencyKey,
  });
}

// ---- the documents -----------------------------------------------------------------------------

export interface ReviewDocument {
  id: string;
  recordCustodianId: string;
  discoveryLoadId: string;
  familyId: string;
  familyRole: "standalone" | "parent" | "attachment" | "container-child";
  familySequence: number;
  sourceName: string | null;
  sourcePath: string | null;
  sizeBytes: number | null;
  pageCount: number | null;
  formatIdentified: string | null;
  sortDate: string | null;
  sortDateSource: string | null;
  processingState: ReviewDocumentProcessingState;
  processingDeferredReason: string | null;
  indexState: ReviewDocumentIndexState | null;
  /** False on a suppressed duplicate. It stays in the corpus and stays reachable. */
  isDedupPrimary: boolean;
  extractionRoute: string | null;
  pagesRecognized: number | null;
  createdAt: string;
}

/** Everything the server narrows the document list by. Composed in criteria.ts, never here. */
export interface ReviewDocumentQuery {
  recordCustodianId?: string;
  discoveryLoadId?: string;
  familyId?: string;
  processingState?: ReviewDocumentProcessingState;
  exceptionCode?: ReviewDocumentExceptionCode;
  cursor?: string;
}

export function listReviewDocuments(
  fetchImpl: typeof fetch,
  reviewSetId: string,
  parameters: ReviewDocumentQuery = {},
): Promise<ApiOutcome<Page<ReviewDocument>>> {
  return requestJson(
    fetchImpl,
    `/api/v1/review-sets/${reviewSetId}/documents${query({
      recordCustodianId: parameters.recordCustodianId,
      discoveryLoadId: parameters.discoveryLoadId,
      familyId: parameters.familyId,
      processingState: parameters.processingState,
      exceptionCode: parameters.exceptionCode,
      cursor: parameters.cursor,
    })}`,
  );
}

// ---- the exceptions ----------------------------------------------------------------------------

export interface ReviewSetException {
  id: string;
  reviewDocumentId: string;
  discoveryLoadId: string;
  stage: ReviewDocumentExceptionStage;
  code: ReviewDocumentExceptionCode;
  detail: string | null;
  recordCustodianId: string;
  sourceName: string | null;
  processingState: ReviewDocumentProcessingState;
  createdAt: string;
}

/**
 * The live view of what a production's exception report will say. The counts come first because
 * that is the shape of the answer: how many are encrypted, how many damaged, how many yielded no
 * text. One document may carry several reasons and is counted once in each.
 */
export interface ReviewSetExceptionPage {
  countsByCode: { code: ReviewDocumentExceptionCode; documentCount: number }[];
  data: ReviewSetException[];
  nextCursor: string | null;
}

export function listReviewSetExceptions(
  fetchImpl: typeof fetch,
  reviewSetId: string,
  cursor?: string,
): Promise<ApiOutcome<ReviewSetExceptionPage>> {
  return requestJson(
    fetchImpl,
    `/api/v1/review-sets/${reviewSetId}/exceptions${query({ cursor })}`,
  );
}

// ---- what the corpus still owes the index ------------------------------------------------------

/**
 * How much of this review set is searchable.
 *
 * With no search engine deployed every document parks in `deferred`, which is the normal state of
 * this product today. It is counted here so a firm can SEE that rather than infer it, and it is
 * never an exception: it is work the platform owes, and it reaches no report a court reads.
 */
export interface ReviewSetIndexStatus {
  indexed: number;
  deferred: number;
  failed: number;
  unattempted: number;
}

export function readIndexStatus(
  fetchImpl: typeof fetch,
  reviewSetId: string,
): Promise<ApiOutcome<ReviewSetIndexStatus>> {
  return requestJson(fetchImpl, `/api/v1/review-sets/${reviewSetId}/index-status`);
}
