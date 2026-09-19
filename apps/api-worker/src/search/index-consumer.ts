import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  listSplitsForDocument,
  markMembersStaleForDocumentStatement,
  replaceDocumentSplitStatements,
  type IndexedDocumentId,
} from "@magna-carta/data-access/index-split-statements";
import { deriveIdentifier } from "@magna-carta/identifiers/generate";
import {
  markReviewDocumentIndexDeferredStatement,
  markReviewDocumentIndexedStatement,
  markReviewDocumentIndexFailedStatement,
} from "@magna-carta/discovery/index-statements";
import type { ReviewDocumentSidecar } from "@magna-carta/discovery/processing";
import { insertReviewDocumentExceptionStatement } from "@magna-carta/discovery/processing-statements";
import { readSearchCompactionPolicy } from "@magna-carta/search/settings";
import type {
  DiscoveryLoadId,
  FileId,
  FirmId,
  IndexSplitId,
  MatterId,
  ReviewDocumentExceptionId,
  ReviewDocumentId,
  ReviewSetId,
} from "@magna-carta/identifiers/types";
import { corpusOfMatter, corpusOfReviewSet, type CorpusScope } from "@magna-carta/search/corpus";
import type { TextExtractionPort } from "@magna-carta/search/extraction";
import type { Passage, SearchIndexPort } from "@magna-carta/search/port";
import {
  splitIdentifierForDocumentVersion,
  splitIdentifierForReviewDocument,
  splitObjectKey,
} from "@magna-carta/search/split";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../bindings.ts";
import { resolveFirmBucketForFirmId } from "../files/firm-bucket.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { corpusNeedsCompaction } from "./compaction-consumer.ts";
import { searchCompactionJobName } from "./compaction-types.ts";
import { writeNaturalLanguageFeedObject } from "./natural-language-feed-writer.ts";
import { resolveSearchIndexPort } from "./search-engine.ts";
import { indexMessageCorpus, searchIndexJobName, type SearchIndexMessage } from "./index-types.ts";
import { reviewDocumentPassages } from "./review-document-passages.ts";
import { resolveTextExtractionPort } from "./text-extraction.ts";

// The search-index queue consumer: one committed document version in, one published split plus one
// catalog row out. Extract text, build the split through the engine port, then converge the catalog.
//
// THE THREE OUTCOMES, and why they are three. A document that reaches this consumer must end in exactly
// one of them, because a document that quietly ends in none of them has fallen out of the searchable
// corpus without anyone being able to tell — which in discovery is a defensibility failure, not a cache
// miss:
//
//   indexed  — the split is in R2 and the catalog names it. Terminal.
//   deferred — an engine is not deployed yet. Terminal FOR NOW and acked, not retried: retrying against
//              an unbuilt engine only burns the message's attempts and dead-letters it, turning "not
//              built yet" into "lost". The job's Durable Object holds the state, so the backlog is
//              enumerable, and replaying the enqueue after a deploy drains it.
//   failed   — either terminal-for-this-document (bytes nothing can read) and acked, or transient and
//              rethrown so the queue retries and finally dead-letters. Never silently dropped.
//
// IDEMPOTENCY is structural rather than guarded. The split id is derived from documentId + version, so
// every attempt at the same version computes the same id and the same R2 key: a retry overwrites its own
// object instead of leaving an orphan. The catalog write is a delete-then-insert of the document's rows
// in one batch, so a retry that got as far as inserting last time still ends with exactly one live row.
// Neither depends on knowing whether a previous attempt ran.

const now = () => new Date().toISOString();

export interface SearchIndexPorts {
  readonly extraction: TextExtractionPort;
  readonly index: SearchIndexPort;
}

function coordinatorFor(env: Bindings, message: SearchIndexMessage) {
  return env.SEARCH_INDEX_JOB.get(
    env.SEARCH_INDEX_JOB.idFromName(
      searchIndexJobName(message.firmId, message.documentId, message.version),
    ),
  );
}

// Delete the R2 objects of the LIVE splits the catalog holds for this document, except the one this
// attempt is about to write. Objects go before rows: a crash between the two leaves a catalog row
// pointing at a deleted object (a query gets nothing from it, and the next index run replaces it),
// whereas the other order leaves bytes in the firm's bucket that nothing references and nothing will
// ever collect.
//
// A SUPERSEDED SPLIT IS NOT THIS PATH'S TO DELETE, and skipping it is not tidiness. Compaction leaves a
// merged-away split superseded but present precisely so that a query which resolved its key a moment
// before the swap can still read it; that promise is kept by a grace period the retirement sweep honours
// (compaction-sweep.ts). Deleting one here would break the promise from the side compaction cannot see —
// a re-index of this document, arriving inside that window, taking out bytes a live query is holding a
// key to. The rows are left behind with the objects for the same reason: the sweep finds them by row.
function deletePriorSplitObjects(
  bucket: R2Bucket,
  prior: readonly { readonly objectKey: string; readonly supersededAt: string | null }[],
  keepKey: string,
): Promise<void> {
  const stale = prior
    .filter((split) => split.supersededAt === null && split.objectKey !== keepKey)
    .map((split) => split.objectKey);
  if (stale.length === 0) return Promise.resolve();
  return bucket.delete(stale);
}

// The two corpora reach the engine with the same passages and diverge nowhere after this point. What
// differs is only how those passages are obtained, which is a fact about where the document came from
// rather than about indexing.
interface ResolvedDocument {
  readonly corpus: CorpusScope;
  readonly documentId: IndexedDocumentId;
  readonly splitId: IndexSplitId;
  readonly passages: readonly Passage[];
}

type ResolveOutcome =
  | { readonly ok: true; readonly document: ResolvedDocument }
  | { readonly ok: false; readonly settled: true };

// A MATTER document: read the committed bytes and extract them here, because nothing has read them yet.
async function resolveMatterDocument(
  env: Bindings,
  message: SearchIndexMessage,
  ports: SearchIndexPorts,
  coordinator: ReturnType<typeof coordinatorFor>,
  bucket: R2Bucket,
): Promise<ResolveOutcome> {
  const source = await bucket.get(message.sourceKey);
  if (source === null) {
    // The version's bytes are gone (reaped, or the version was withdrawn). Nothing to index and no
    // retry can bring them back — terminal, and recorded so it is visible rather than inferred.
    await coordinator.markFailed("source bytes not found");
    return { ok: false, settled: true };
  }
  const bytes = new Uint8Array(await source.arrayBuffer());

  const extraction = await ports.extraction.extract({
    bytes,
    contentType: message.contentType,
  });
  if (!extraction.ok) {
    if (extraction.reason === "engine-not-implemented") {
      await coordinator.markDeferred("text extraction engine not deployed");
      return { ok: false, settled: true };
    }
    if (extraction.reason === "unextractable") {
      await coordinator.markFailed(extraction.detail ?? "document yielded no indexable text");
      return { ok: false, settled: true };
    }
    // adapter-error: transient. Throw so the queue retries and eventually dead-letters.
    throw new Error(`text extraction failed: ${extraction.detail ?? "adapter error"}`);
  }

  const documentId = message.documentId as FileId;
  return {
    ok: true,
    document: {
      // A document that arrives this way arrives because it was committed to a matter, and a matter's
      // corpus is the matter — the identity mapping.
      corpus: corpusOfMatter(message.matterId as MatterId),
      documentId,
      splitId: await splitIdentifierForDocumentVersion(documentId, message.version),
      passages: extraction.passages,
    },
  };
}

// A REVIEW document: its text was already extracted by the discovery pipeline and written to R2 with
// its page metadata beside it. Nothing here re-reads the original bytes, and that is the rule rather
// than a saving — a second parse of an opposing party's document is a second answer to what the
// document says, and the answer a firm certified in its manifest is the one already on disk.
async function resolveReviewDocument(
  env: Bindings,
  message: SearchIndexMessage,
  coordinator: ReturnType<typeof coordinatorFor>,
  bucket: R2Bucket,
): Promise<ResolveOutcome> {
  const documentId = message.documentId as ReviewDocumentId;
  const reviewSetId = message.corpusId as ReviewSetId;
  if (message.metadataKey === undefined) {
    // Unreachable through the enqueue, which refuses a document without both objects. Held here
    // because the alternative is indexing passages whose pages nobody can name.
    await coordinator.markFailed("the review document names no metadata object");
    await settleReviewDocumentIndexFailure(
      env,
      message,
      "the review document names no metadata object",
    );
    return { ok: false, settled: true };
  }

  const [textObject, metadataObject] = await Promise.all([
    bucket.get(message.sourceKey),
    bucket.get(message.metadataKey),
  ]);
  if (textObject === null || metadataObject === null) {
    // The derived objects are gone — the review set was closed and its cache released, or a
    // collection rule reached them. Terminal for this attempt and filed as an exception, because
    // unlike a matter document this one IS in a corpus a firm has to be able to account for.
    const reason = "the review document's extracted text is no longer in the bucket";
    await coordinator.markFailed(reason);
    await settleReviewDocumentIndexFailure(env, message, reason, "source-bytes-missing");
    return { ok: false, settled: true };
  }

  const sidecar = (await metadataObject.json()) as ReviewDocumentSidecar;
  const derived = reviewDocumentPassages(await textObject.text(), sidecar);
  if (!derived.ok) {
    await coordinator.markFailed(derived.reason);
    await settleReviewDocumentIndexFailure(env, message, derived.reason);
    return { ok: false, settled: true };
  }

  return {
    ok: true,
    document: {
      corpus: corpusOfReviewSet(reviewSetId),
      documentId,
      splitId: await splitIdentifierForReviewDocument(documentId),
      passages: derived.passages,
    },
  };
}

// What a review document's row is told when the index could not take it. The row is where the backlog
// lives, so this is what makes an unindexed document countable from the corpus rather than only from a
// Durable Object somebody has to know to open.
//
// An EXCEPTION is written only when a code exists that is true of the DOCUMENT. "The index engine is
// not deployed" is a fact about the platform, and the exception vocabulary is a closed list of
// sentences about what could not be read, every one of them rendered into a report a firm hands to
// another party. Missing derived bytes is different: `source-bytes-missing` says exactly what happened
// and is already in that vocabulary.
async function settleReviewDocumentIndexFailure(
  env: Bindings,
  message: SearchIndexMessage,
  reason: string,
  exceptionCode?: "source-bytes-missing",
): Promise<void> {
  const database = firmDatabaseFor(env.FIRM_DATABASE, message.firmId);
  const reviewDocumentId = message.documentId as ReviewDocumentId;
  const reviewSetId = message.corpusId as ReviewSetId;
  const at = now();
  const statements = [
    markReviewDocumentIndexFailedStatement(database, reviewDocumentId, reason, at),
  ];
  if (exceptionCode !== undefined && message.discoveryLoadId !== undefined) {
    statements.push(
      insertReviewDocumentExceptionStatement(
        database,
        {
          // Derived rather than minted, so a redelivery writes the same row: the insert is
          // OR IGNORE, and a minted id would make every retry a second reason on one document.
          id: await deriveIdentifier(
            "reviewDocumentException",
            `index:${reviewDocumentId}:${exceptionCode}`,
          ),
          reviewSetId,
          discoveryLoadId: message.discoveryLoadId as DiscoveryLoadId,
          reviewDocumentId,
          stage: "index",
          code: exceptionCode,
          detail: reason,
        },
        at,
      ),
    );
  }
  await commitEffectBatch(database, { statements, outboxMessages: [] }, { now });
}

export async function indexOne(
  env: Bindings,
  message: SearchIndexMessage,
  ports: SearchIndexPorts,
): Promise<void> {
  const coordinator = coordinatorFor(env, message);
  // The document's source bytes, the split this publishes, the prior splits it retires and the
  // natural-language feed object all live in one bucket — the firm's — so it is resolved once here and
  // handed down rather than each leg reaching for the binding.
  const { bucket } = await resolveFirmBucketForFirmId(env, message.firmId);
  await coordinator.markRunning();

  const scope = indexMessageCorpus(message);
  const resolved =
    scope.kind === "reviewSet"
      ? await resolveReviewDocument(env, message, coordinator, bucket)
      : await resolveMatterDocument(env, message, ports, coordinator, bucket);
  if (!resolved.ok) return;

  // Past this line the pipeline knows only "a corpus and its passages", which is what lets a second
  // kind of corpus feed the same consumer without moving a published split.
  const { corpus, documentId, splitId, passages } = resolved.document;
  const matterId = message.matterId as MatterId;
  const objectKey = splitObjectKey(corpus, splitId);

  const built = await ports.index.index({
    firmId: message.firmId as FirmId,
    corpus,
    documentId,
    version: message.version,
    objectKey,
    passages,
  });
  if (!built.ok) {
    if (built.reason === "engine-not-implemented") {
      await coordinator.markDeferred("search index engine not deployed");
      if (corpus.kind === "reviewSet") {
        // Parked, and enumerable from the corpus. Not an exception: the platform has not tried and
        // failed to read this document, it has not been asked yet — and a deploy drains it into the
        // same derived split, because the split's identity comes from the document rather than from
        // the attempt.
        const database = firmDatabaseFor(env.FIRM_DATABASE, message.firmId);
        await commitEffectBatch(
          database,
          {
            statements: [
              markReviewDocumentIndexDeferredStatement(
                database,
                documentId as ReviewDocumentId,
                "search index engine not deployed",
                now(),
              ),
            ],
            outboxMessages: [],
          },
          { now },
        );
      }
      return;
    }
    throw new Error(`split build failed: ${built.detail ?? "adapter error"}`);
  }

  const database = firmDatabaseFor(env.FIRM_DATABASE, message.firmId);
  const prior = await listSplitsForDocument(database, documentId);
  await deletePriorSplitObjects(bucket, prior, objectKey);
  // One atomic batch through the standard write chokepoint: the delete and the insert land together or
  // not at all. No outbox message — publishing a split has no consequence outside the firm's own
  // storage, and no idempotency record — convergence here is structural (the derived id and the
  // delete-then-insert), not guarded by a key.
  const publishedAt = now();
  await commitEffectBatch(
    database,
    {
      statements: [
        // MARK AND PUBLISH TOGETHER, in the one batch, or neither. A compacted split still holds the
        // passages of whatever earlier version of this document it was merged from, and both it and the
        // split about to be inserted are live. Between the insert and the mark the query path would
        // return this document twice — once as it is and once as it was — so the window has to be zero,
        // and the only way to make it zero is to put both writes in the same atomic batch.
        markMembersStaleForDocumentStatement(database, documentId, publishedAt),
        ...replaceDocumentSplitStatements(database, {
          id: splitId,
          // Provenance, and the dimension the split object is stamped with. Never the scope: the
          // corpus below is what a query enumerates by, which is what keeps a matter search
          // structurally unable to name a review set's splits.
          matterId,
          corpusKind: corpus.kind,
          corpusId: corpus.id,
          documentId,
          version: message.version,
          objectKey,
          documentCount: built.published.documentCount,
          sizeBytes: built.published.sizeBytes,
          schemaGeneration: built.published.schemaGeneration,
          createdAt: publishedAt,
        }),
      ],
      outboxMessages: [],
    },
    { now },
  );

  await coordinator.markIndexed(objectKey);

  if (corpus.kind === "reviewSet") {
    // The row is the corpus's own account of where each document stands with the index, so the
    // progress figure and the backlog are one read over the review set rather than a fan of Durable
    // Object calls.
    await commitEffectBatch(
      database,
      {
        statements: [
          markReviewDocumentIndexedStatement(database, documentId as ReviewDocumentId, publishedAt),
        ],
        outboxMessages: [],
      },
      { now },
    );
  }

  // THE SECOND CONSUMER OF THE SAME EXTRACTION. The bytes were read once and parsed once, above;
  // the keyword split and the natural-language feed both read that one result. Re-extracting here
  // would be a second parse of the same untrusted document, and would let the two derived copies
  // disagree about what the document says with nothing comparing them.
  //
  // A REVIEW SET NEVER FEEDS IT, and that is a wall rather than a gap. The feed is the corpus an AI
  // assistant answers a firm's questions from; material an opposing party produced is under a
  // protective order the platform is not a party to, and a review set's access list is a narrower
  // wall than the matter the feed is scoped by. Nothing in discovery may become reachable through a
  // surface whose audience is the matter team.
  //
  // Both of the feature's gates are read inside the writer, at the moment of writing, so a firm that
  // has not opted in and a matter that has been excluded each produce nothing here.
  //
  // A failure is swallowed for the same reason the compaction trigger below swallows one: the
  // document IS indexed and searchable through the keyword half, and turning a failure on a derived
  // secondary copy into a failed index job would take a searchable document back out of the corpus.
  // The daily re-extraction pass re-enqueues the version, which retries this along with everything
  // else.
  if (corpus.kind === "matter") {
    try {
      await writeNaturalLanguageFeedObject(
        database,
        bucket,
        { matterId, documentId: documentId as FileId, version: message.version, passages },
        now,
      );
    } catch (caught) {
      logOperationFailed(
        createWorkersLogger(env.TELEMETRY),
        `queue:search-index:natural-language-feed`,
        caught,
        newCorrelationId(),
      );
    }
  }

  // THE COMPACTION TRIGGER, and it is deliberately only a count. Publishing a split is what makes a
  // corpus's live split count grow, and the read path's cost grows with it — a query is handed every
  // live split and reads each one separately — so this is the moment the platform can notice, for the
  // price of one indexed count against a table it has just written. What it must NOT do here is merge:
  // a merge is proportional to the corpus, so merging on every write would be quadratic in it.
  //
  // The coordinator single-flights per corpus, so a burst of a thousand ingests over the threshold
  // produces one compaction in flight rather than a thousand, and a pass that is bounded re-enqueues
  // itself while the corpus is still over — which is what makes a large back-catalogue converge without
  // any one merge being unbounded. A failure here is swallowed on purpose: the document IS indexed, the
  // daily backstop will notice the same threshold, and turning a housekeeping hiccup into a failed index
  // job would take a searchable document back out of the corpus.
  try {
    const policy = await readSearchCompactionPolicy(database);
    if (await corpusNeedsCompaction(database, corpus.id, policy)) {
      await env.SEARCH_COMPACTION_JOB.get(
        env.SEARCH_COMPACTION_JOB.idFromName(searchCompactionJobName(message.firmId, corpus.id)),
      ).start({
        firmId: message.firmId,
        matterId,
        corpusKind: corpus.kind,
        corpusId: corpus.id,
      });
    }
  } catch (caught) {
    logOperationFailed(
      createWorkersLogger(env.TELEMETRY),
      `queue:search-index:compaction-trigger`,
      caught,
      newCorrelationId(),
    );
  }
}

export function resolveSearchIndexPorts(env: Bindings): SearchIndexPorts {
  return { extraction: resolveTextExtractionPort(env), index: resolveSearchIndexPort(env) };
}

// The queue() handler: one message at a time, ack on every terminal outcome (indexed, deferred, or a
// failure this document can never recover from), retry on a transient throw. Per-message ack so one bad
// document never re-runs an already-published sibling; a message that exhausts its attempts
// dead-letters, where it stays as the record that a document is missing from the corpus.
export async function searchIndexQueue(
  batch: MessageBatch<SearchIndexMessage>,
  env: Bindings,
  ports: SearchIndexPorts = resolveSearchIndexPorts(env),
): Promise<void> {
  const logger = createWorkersLogger(env.TELEMETRY);
  for (const message of batch.messages) {
    const correlationId = newCorrelationId();
    try {
      await indexOne(env, message.body, ports);
      message.ack();
    } catch (error) {
      logOperationFailed(logger, `queue:search-index:${message.id}`, error, correlationId);
      await coordinatorFor(env, message.body).markFailed(
        error instanceof Error ? error.message : "index error",
      );
      message.retry();
    }
  }
}
