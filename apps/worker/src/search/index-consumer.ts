import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  listSplitsForDocument,
  markMembersStaleForDocumentStatement,
  replaceDocumentSplitStatements,
} from "@magna-carta/data-access/index-split-statements";
import { readSearchCompactionPolicy } from "@magna-carta/search/settings";
import type { FileId, FirmId, IndexSplitId, MatterId } from "@magna-carta/identifiers/types";
import { corpusOfMatter } from "@magna-carta/search/corpus";
import type { TextExtractionPort } from "@magna-carta/search/extraction";
import type { SearchIndexPort } from "@magna-carta/search/port";
import { splitIdentifierForDocumentVersion, splitObjectKey } from "@magna-carta/search/split";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../app.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { corpusNeedsCompaction } from "./compaction-consumer.ts";
import { searchCompactionJobName } from "./compaction-types.ts";
import { writeNaturalLanguageFeedObject } from "./natural-language-feed-writer.ts";
import { resolveSearchIndexPort } from "./search-engine.ts";
import { searchIndexJobName, type SearchIndexMessage } from "./index-types.ts";
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

export async function indexOne(
  env: Bindings,
  message: SearchIndexMessage,
  ports: SearchIndexPorts,
): Promise<void> {
  const coordinator = coordinatorFor(env, message);
  await coordinator.markRunning();

  const source = await env.R2.get(message.sourceKey);
  if (source === null) {
    // The version's bytes are gone (reaped, or the version was withdrawn). Nothing to index and no
    // retry can bring them back — terminal, and recorded so it is visible rather than inferred.
    await coordinator.markFailed("source bytes not found");
    return;
  }
  const bytes = new Uint8Array(await source.arrayBuffer());

  const extraction = await ports.extraction.extract({
    bytes,
    contentType: message.contentType,
  });
  if (!extraction.ok) {
    if (extraction.reason === "engine-not-implemented") {
      await coordinator.markDeferred("text extraction engine not deployed");
      return;
    }
    if (extraction.reason === "unextractable") {
      await coordinator.markFailed(extraction.detail ?? "document yielded no indexable text");
      return;
    }
    // adapter-error: transient. Throw so the queue retries and eventually dead-letters.
    throw new Error(`text extraction failed: ${extraction.detail ?? "adapter error"}`);
  }

  const documentId = message.documentId as FileId;
  const matterId = message.matterId as MatterId;
  // The corpus this document is indexed into. A document that arrives through this consumer arrives
  // because it was committed to a matter, and a matter's corpus is the matter — the identity mapping.
  // Past this line the pipeline knows only "a corpus", which is what lets a second kind of corpus feed
  // the same consumer without moving a published split.
  const corpus = corpusOfMatter(matterId);
  const splitId: IndexSplitId = await splitIdentifierForDocumentVersion(
    documentId,
    message.version,
  );
  const objectKey = splitObjectKey(corpus, splitId);

  const built = await ports.index.index({
    firmId: message.firmId as FirmId,
    corpus,
    documentId,
    version: message.version,
    objectKey,
    passages: extraction.passages,
  });
  if (!built.ok) {
    if (built.reason === "engine-not-implemented") {
      await coordinator.markDeferred("search index engine not deployed");
      return;
    }
    throw new Error(`split build failed: ${built.detail ?? "adapter error"}`);
  }

  const database = firmDatabaseFor(env.FIRM_DATABASE, message.firmId);
  const prior = await listSplitsForDocument(database, documentId);
  await deletePriorSplitObjects(env.R2, prior, objectKey);
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
          // The catalog is still keyed by matter. It is the one part of the scope that costs a per-firm
          // schema change to widen, and unlike the object key it costs the same whenever it is done — the
          // rows are a rebuildable index of derived objects, not the objects themselves. It widens with
          // the corpus kind that first needs it.
          matterId,
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

  // THE SECOND CONSUMER OF THE SAME EXTRACTION. The bytes were read once and parsed once, above;
  // the keyword split and the natural-language feed both read that one result. Re-extracting here
  // would be a second parse of the same untrusted document, and would let the two derived copies
  // disagree about what the document says with nothing comparing them.
  //
  // Both of the feature's gates are read inside the writer, at the moment of writing, so a firm that
  // has not opted in and a matter that has been excluded each produce nothing here.
  //
  // A failure is swallowed for the same reason the compaction trigger below swallows one: the
  // document IS indexed and searchable through the keyword half, and turning a failure on a derived
  // secondary copy into a failed index job would take a searchable document back out of the corpus.
  // The daily re-extraction pass re-enqueues the version, which retries this along with everything
  // else.
  try {
    await writeNaturalLanguageFeedObject(
      database,
      env.R2,
      { matterId, documentId, version: message.version, passages: extraction.passages },
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
    if (await corpusNeedsCompaction(database, matterId, policy)) {
      await env.SEARCH_COMPACTION_JOB.get(
        env.SEARCH_COMPACTION_JOB.idFromName(searchCompactionJobName(message.firmId, matterId)),
      ).start({ firmId: message.firmId, matterId });
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
