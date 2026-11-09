import { loadIndexableVersion } from "@magna-carta/file-manager/queries";
import { readReviewDocument } from "@magna-carta/discovery/review-document-statements";
import { readReviewSet } from "@magna-carta/discovery/review-set-statements";
import type { FileVersionId, ReviewDocumentId } from "@magna-carta/identifiers/types";
import { readSearchIndexingEnabled } from "@magna-carta/search/settings";
import type { Bindings } from "../bindings.ts";
import { firmDatabaseFor, type ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { searchEngineGeneration } from "./engine-generation.ts";
import {
  REVIEW_DOCUMENT_INDEX_VERSION,
  searchIndexJobName,
  type SearchIndexMessage,
} from "./index-types.ts";

// THE CEILING ON A DOCUMENT EXTRACTION WILL ATTEMPT AT ALL.
//
// The consumer materialises the whole source object into Worker memory and hands it to the WASM PDF
// engine, which copies it again into linear memory — so the real ceiling is a fraction of a Worker's
// budget, and it sits far below the firm's inspectable-size cap. Past this size the honest answer is a
// recorded `deferred` naming the ceiling, not an out-of-memory inside the queue consumer: an OOM
// surfaces as a retry and then a dead-letter, indistinguishable from a genuinely unreadable document,
// which then makes the version a permanent candidate for the repair sweep.
//
// This is the cheap gate that belongs here until extraction moves into a Container of its own, where a
// large document can be walked as a stream instead of held whole.
const MAXIMUM_EXTRACTABLE_SIZE_BYTES = 64 * 1024 * 1024;

// The seam where a document enters the search corpus: a version that has just committed clean.
//
// WHY HERE. Ingest commit is the first and only moment a version is simultaneously (a) durable, (b)
// scanned and cleared, and (c) pointed at by its file as current. Enqueuing earlier would index bytes
// that might still be quarantined; enqueuing later — from the OCR or conversion paths — would only ever
// catch the documents that happened to pass through those tools, so a plain uploaded PDF would never be
// searchable. Text extraction is the consumer's job, not the trigger's, precisely so that the trigger
// stays "a document became part of the matter" rather than "a document happened to get recognized".
//
// It is deliberately BEST-EFFORT. This runs after the commit has already been recorded, and a failure
// to enqueue must never fail or retry the ingest that already succeeded — re-running ingest would mean
// re-scanning and re-committing a version that is already committed. The cost of that choice is that a
// failure here leaves a document unindexed until something re-enqueues it; the deferred/replay path the
// consumer is built around is the same mechanism that repairs it.
// What one enqueue attempt did. `message` is the fact the ingest path has always wanted — the work this
// version resolves to — and `started` is the fact the repair sweep needs: whether THIS call put the work
// on the queue. They are different questions, and collapsing them is why the sweep could not tell a
// document it had just enqueued from one queued by an earlier pass.
export interface SearchIndexEnqueueOutcome {
  readonly message: SearchIndexMessage;
  /**
   * False when the coordinator declined: the version is already indexed, already in flight, has spent
   * its attempts against this engine generation, or is past the extraction ceiling.
   */
  readonly started: boolean;
}

export async function enqueueVersionForIndexing(
  env: Bindings,
  firmId: string,
  versionId: FileVersionId,
  database: ProxyBatchDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId),
): Promise<SearchIndexEnqueueOutcome | undefined> {
  // The firm-level gate, read before any work: a firm that has not turned indexing on never produces a
  // message, so its documents are never extracted, never built into splits, and never written to R2.
  if (!(await readSearchIndexingEnabled(database))) return undefined;

  const version = await loadIndexableVersion(database, versionId);
  // Not clean, or its file is gone — nothing to index. Not an error: the version simply is not part of
  // the searchable corpus.
  if (version === undefined) return undefined;

  const message: SearchIndexMessage = {
    firmId,
    matterId: version.matterId,
    documentId: version.fileId,
    version: version.versionNumber,
    sourceKey: version.r2Key,
    contentType: version.contentType,
    engineGeneration: searchEngineGeneration(env),
  };
  // Through the coordinator, not straight onto the queue: the Durable Object is what makes a duplicate
  // enqueue for the same document version a no-op instead of a second build, and it is where the job's
  // outcome — including a deferred one — is recorded.
  const coordinator = env.SEARCH_INDEX_JOB.get(
    env.SEARCH_INDEX_JOB.idFromName(
      searchIndexJobName(firmId, version.fileId, version.versionNumber),
    ),
  );

  // Too large to extract: recorded as a deferred job naming the ceiling, so it is enumerable as owed
  // work rather than discovered as an OOM. Done through the coordinator so the state lives where every
  // other outcome for this version lives.
  if (version.sizeBytes !== null && version.sizeBytes > MAXIMUM_EXTRACTABLE_SIZE_BYTES) {
    await coordinator.markDeferred(
      `document is larger than the ${MAXIMUM_EXTRACTABLE_SIZE_BYTES} byte extraction ceiling`,
    );
    return { message, started: false };
  }

  const outcome = await coordinator.start(message);
  return { message, started: outcome.started };
}

// The seam where a REVIEW DOCUMENT enters its review set's corpus: a document the discovery pipeline
// has just finished reading.
//
// WHY HERE, and why it is a second entry point rather than the same one. A review document is not a
// file version — it is a version-pinned pointer with its own already-extracted text, its own corpus,
// and its own reason to exist — so the trigger is "the discovery pipeline finished reading this
// document", not "a version committed". Processing completion is the first and only moment a review
// document simultaneously (a) has text, (b) has been decided to be the primary of its duplicate group,
// and (c) belongs to a corpus that will not change under it.
//
// IT INDEXES ONLY THE PRIMARY of a duplicate group, which is the whole economic argument for
// deduplicating at all: the same document held by three custodians is one set of bytes, one
// extraction, and one index entry. The duplicates keep their rows, their custodians and their
// occurrences — nothing is hidden — they simply do not each buy a split.
//
// BEST-EFFORT, exactly like the version-keyed enqueue above. The document is already processed and
// recorded; a failure to enqueue must never fail the processing that succeeded. What makes that safe
// here is that the backlog is enumerable from the corpus itself — `index_state` on the row — so a
// document nothing enqueued is a countable, replayable arrear rather than a silent absence.
export async function enqueueReviewDocumentForIndexing(
  env: Bindings,
  firmId: string,
  reviewDocumentId: ReviewDocumentId,
  database: ProxyBatchDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId),
): Promise<SearchIndexEnqueueOutcome | undefined> {
  // The firm-level gate, read before any work, on the same rule as the version path: a firm that has
  // not turned indexing on never produces a message, so its documents are never built into splits and
  // nothing of theirs is written to R2.
  if (!(await readSearchIndexingEnabled(database))) return undefined;

  const document = await readReviewDocument(database, reviewDocumentId);
  if (document === undefined) return undefined;
  // Nothing to index yet, or nothing to index ever. A document that is not `processed` has no text
  // object; one that is a duplicate is represented in the index by its primary; one with no text key
  // is a container, whose entries are separate documents and are indexed as themselves. None of the
  // three is an error, and none of them is a state a retry changes.
  if (document.processing_state !== "processed") return undefined;
  if (document.is_dedup_primary !== 1) return undefined;
  if (document.text_r2_key === null || document.metadata_r2_key === null) return undefined;

  const reviewSet = await readReviewSet(database, document.review_set_id);
  if (reviewSet === undefined) return undefined;

  const message: SearchIndexMessage = {
    firmId,
    // Provenance: which matter the work was done under, and the dimension the split object is stamped
    // with. Never the corpus — that is the review set, immediately below.
    matterId: reviewSet.matter_id,
    corpusKind: "reviewSet",
    corpusId: document.review_set_id,
    documentId: reviewDocumentId,
    version: REVIEW_DOCUMENT_INDEX_VERSION,
    // The text the discovery engine already produced, not the original bytes. Handing the original
    // bytes to a second parser would give the corpus two answers about what the document says, and
    // the one a firm certified is this one.
    sourceKey: document.text_r2_key,
    contentType: null,
    metadataKey: document.metadata_r2_key,
    discoveryLoadId: document.discovery_load_id,
    engineGeneration: searchEngineGeneration(env),
  };

  // Through the same coordinator as the version path, for the same reason: the Durable Object is what
  // makes a duplicate enqueue a no-op rather than a second build, and it is where a deferred outcome
  // is recorded so a deploy can drain what it was owed.
  const coordinator = env.SEARCH_INDEX_JOB.get(
    env.SEARCH_INDEX_JOB.idFromName(
      searchIndexJobName(firmId, reviewDocumentId, REVIEW_DOCUMENT_INDEX_VERSION),
    ),
  );
  const outcome = await coordinator.start(message);
  return { message, started: outcome.started };
}
