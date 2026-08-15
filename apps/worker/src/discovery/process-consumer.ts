import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { advanceProcessingCountsStatement } from "@magna-carta/discovery/load-statements";
import {
  countRecognizedPages,
  formatExtractionRoute,
  type ReviewDocumentSidecar,
} from "@magna-carta/discovery/processing";
import {
  claimReviewDocumentStatement,
  insertReviewDocumentExceptionStatement,
  markReviewDocumentExceptedStatement,
  markReviewDocumentProcessedStatement,
  parkReviewDocumentStatement,
} from "@magna-carta/discovery/processing-statements";
import { reviewDocumentMetadataKey, reviewDocumentTextKey } from "@magna-carta/discovery/r2-keys";
import { readReviewDocument } from "@magna-carta/discovery/review-document-statements";
import { deriveIdentifier } from "@magna-carta/identifiers/generate";
import type {
  DiscoveryLoadId,
  MatterId,
  ReviewDocumentId,
  ReviewSetId,
} from "@magna-carta/identifiers/types";
import { matterScopedObjectDimensions } from "@magna-carta/object-dimensions";
import type { TextExtractionPort, TextExtractionResult } from "@magna-carta/search/extraction";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../app.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { resolveTextExtractionPort } from "../search/text-extraction.ts";
import {
  exceptionForExtractionFailure,
  MALWARE_FLAGGED,
  SOURCE_BYTES_MISSING,
  type ReviewDocumentExceptionFact,
} from "./extraction-exceptions.ts";
import type { DiscoveryProcessMessage } from "./discovery-process-types.ts";

// The discovery processing consumer: one review document per message, read off the queue, extracted
// off every hot path, and ended in exactly one state.
//
// TWO TERMINAL STATES AND NO THIRD. `processed` — the text is in R2, the sidecar is beside it, and the
// derived scalars are on the row. `excepted` — a named code a firm can hand to opposing counsel, with
// the identified format recorded beside it. There is no path that reaches neither, because a document
// that ends in neither has fallen out of the corpus without anyone being able to tell, and in
// discovery that is a defensibility failure rather than a cache miss.
//
// AND ONE NON-TERMINAL STATE THAT IS NOT A FAILURE. An engine that is not deployed, or a service that
// did not answer, parks the document back at `pending` carrying the reason. That is not the platform
// declining to read it: it is the platform saying it has not read it yet, which is a different
// sentence and the only honest one while a Container is undeployed. The parked reason lives on the
// row, so "what is this review set still owed" is one indexed read over the corpus rather than a
// question only a dead-letter queue can answer.
//
// IDEMPOTENCY IS STRUCTURAL. The text key, the sidecar key, and the exception identifier are all
// DERIVED from identifiers that do not change, so a redelivery overwrites its own object and inserts
// nothing new; the claim is guarded by the state the row is in, so two consumers cannot both extract
// one document. None of it depends on knowing whether a previous attempt ran.

const now = () => new Date().toISOString();

export interface DiscoveryProcessPorts {
  readonly extraction: TextExtractionPort;
}

export function resolveDiscoveryProcessPorts(env: Bindings): DiscoveryProcessPorts {
  return { extraction: resolveTextExtractionPort(env) };
}

// A transient fault, distinguished from every other outcome because it is the ONLY one that is thrown
// rather than recorded: the queue retries it and eventually dead-letters it, and a dead-lettered
// message is the record that a document is missing from the corpus.
class DiscoveryProcessingFault extends Error {}

export async function processOne(
  env: Bindings,
  message: DiscoveryProcessMessage,
  ports: DiscoveryProcessPorts,
): Promise<void> {
  const database = firmDatabaseFor(env.FIRM_DATABASE, message.firmId);
  const reviewDocumentId = message.reviewDocumentId as ReviewDocumentId;

  const document = await readReviewDocument(database, reviewDocumentId);
  // The row is gone, or a previous delivery already ended it. Either way this message has nothing
  // left to do, and acking is right: re-processing a terminal document would write a second text over
  // the first and move the load's counters past what the corpus holds.
  if (document === undefined) return;
  if (document.processing_state === "processed" || document.processing_state === "excepted") return;

  const claimedAt = now();
  await commitEffectBatch(
    database,
    {
      statements: [claimReviewDocumentStatement(database, reviewDocumentId, claimedAt)],
      outboxMessages: [],
    },
    { now },
  );

  // A quarantined version never reaches a parser. Decided from the status the scan gate recorded at
  // dispatch rather than from anything read out of the bytes, which is what makes "no parser touched
  // it" a property of the control flow rather than a promise.
  if (message.sourceStatus === "quarantined") {
    await recordException(database, message, MALWARE_FLAGGED, {
      detail: "the scan gate quarantined this version; it is in the corpus and was not opened",
      formatIdentified: null,
    });
    return;
  }
  if (message.sourceStatus !== "clean") {
    // Not cleared yet is not a verdict. The document waits for the gate rather than being recorded as
    // one the platform tried and failed to read.
    await park(database, reviewDocumentId, "the version has not been cleared by the scan gate");
    return;
  }

  const { bucket } = resolveFirmBucket(env, message.bucketName);
  const source = await bucket.get(message.sourceKey);
  if (source === null) {
    await recordException(database, message, SOURCE_BYTES_MISSING, {
      detail: "the loaded object is no longer in storage",
      formatIdentified: null,
    });
    return;
  }
  const bytes = new Uint8Array(await source.arrayBuffer());

  const extraction = await ports.extraction.extract({
    bytes,
    contentType: message.contentType,
  });

  if (!extraction.ok) {
    if (extraction.reason === "engine-not-implemented") {
      await park(
        database,
        reviewDocumentId,
        extraction.detail ?? "an extraction engine is not deployed",
      );
      return;
    }
    if (extraction.code === undefined) {
      // A terminal refusal the router could not name. Treated as transient on purpose: an unnamed
      // reason means the engine and this worker are at different versions, which is a deployment fact
      // rather than a fact about the document — and recording it under one of the named codes would
      // put a sentence in the exception report that nobody checked.
      await park(database, reviewDocumentId, "the extraction engine gave an unrecognized refusal");
      throw new DiscoveryProcessingFault(extraction.detail ?? "unrecognized extraction refusal");
    }
    if (extraction.reason === "adapter-error") {
      await park(database, reviewDocumentId, "an extraction service did not answer");
      throw new DiscoveryProcessingFault(extraction.detail ?? "extraction adapter error");
    }
    await recordException(database, message, exceptionForExtractionFailure(extraction.code), {
      detail: extraction.detail ?? null,
      // Recorded even on the failure path, and especially there.
      formatIdentified: null,
    });
    return;
  }

  await writeProcessed(env, database, message, extraction);
}

// The success path: both derived objects, then the row and the load's counters in one atomic batch.
//
// OBJECTS BEFORE ROWS. A crash between them leaves text in the bucket that the row does not name — a
// derived object nothing reads, which the next attempt overwrites at the same derived key. The other
// order would leave a row pointing at text that is not there, which is a corpus asserting it has
// something it does not.
async function writeProcessed(
  env: Bindings,
  database: BatchDatabase,
  message: DiscoveryProcessMessage,
  extraction: Extract<TextExtractionResult, { ok: true }>,
): Promise<void> {
  const reviewDocumentId = message.reviewDocumentId as ReviewDocumentId;
  const reviewSetId = message.reviewSetId as ReviewSetId;
  const loadId = message.loadId as DiscoveryLoadId;
  const textKey = reviewDocumentTextKey(reviewSetId, reviewDocumentId);
  const metadataKey = reviewDocumentMetadataKey(reviewSetId, reviewDocumentId);
  const extractedAt = now();

  const sidecar: ReviewDocumentSidecar = {
    reviewDocumentId,
    reviewSetId,
    discoveryLoadId: loadId,
    formatIdentified: extraction.facts.formatIdentified,
    pageCount: extraction.facts.pageCount,
    documentDate: extraction.facts.documentDate,
    documentDateSource: extraction.facts.documentDateSource,
    extractionRoute: extraction.route,
    pages: extraction.pages,
    textFingerprint: extraction.facts.textFingerprint,
    extractedAt,
  };

  const { bucket } = resolveFirmBucket(env, message.bucketName);
  // The dimensions every object in a firm's bucket carries. A review document is matter-rooted
  // through its review set, and the two objects carry different classes so a reader of the bucket can
  // tell a document's text from the facts about it without parsing a key.
  await bucket.put(textKey, passageText(extraction), {
    customMetadata: matterScopedObjectDimensions({
      matterId: message.matterId as MatterId,
      objectClass: "review-extracted-text",
    }),
  });
  await bucket.put(metadataKey, JSON.stringify(sidecar), {
    customMetadata: matterScopedObjectDimensions({
      matterId: message.matterId as MatterId,
      objectClass: "review-document-metadata",
    }),
  });

  const route = formatExtractionRoute(extraction.route);
  if (route === null || extraction.facts.formatIdentified === null) {
    // Unreachable through the port, which never reports a success with no route: a document that
    // produced text produced it somewhere. Held here anyway, because the alternative to this throw is
    // a row marked processed that cannot say what read it — and the schema cannot refuse that without
    // rebuilding a shipped table.
    throw new DiscoveryProcessingFault("an extraction reported success without naming its route");
  }

  await commitEffectBatch(
    database,
    {
      statements: [
        markReviewDocumentProcessedStatement(
          database,
          reviewDocumentId,
          {
            textR2Key: textKey,
            metadataR2Key: metadataKey,
            formatIdentified: extraction.facts.formatIdentified,
            pageCount: extraction.facts.pageCount,
            pagesRecognized: countRecognizedPages(extraction.pages),
            extractionRoute: route,
            textFingerprint: extraction.facts.textFingerprint,
            sortDate: extraction.facts.documentDate,
            sortDateSource: extraction.facts.documentDateSource,
          },
          extractedAt,
        ),
        // Relative, in the same batch as the state change, so two consumers finishing at once cannot
        // lose each other's document. The counters are what the load's reconciliation CHECK holds.
        advanceProcessingCountsStatement(
          database,
          loadId,
          { processed: 1, excepted: 0 },
          extractedAt,
        ),
      ],
      outboxMessages: [],
    },
    { now },
  );
}

// The text object: one page per line group, pages in order, exactly the passages the index will read.
// Written as text rather than as JSON because a firm's own reviewer, and eventually opposing counsel,
// opens this without tooling.
function passageText(extraction: Extract<TextExtractionResult, { ok: true }>): string {
  return extraction.passages.map((passage) => passage.text).join("\n\n");
}

async function recordException(
  database: BatchDatabase,
  message: DiscoveryProcessMessage,
  fact: ReviewDocumentExceptionFact,
  extra: { readonly detail: string | null; readonly formatIdentified: string | null },
): Promise<void> {
  const reviewDocumentId = message.reviewDocumentId as ReviewDocumentId;
  const exceptedAt = now();
  // DERIVED from the document and the reason, so a redelivery that raises the same exception writes
  // the same identifier and the insert converges instead of stacking a second identical row. Several
  // DIFFERENT reasons per document is normal and each gets its own row.
  const id = await deriveIdentifier(
    "reviewDocumentException",
    `${reviewDocumentId}:${fact.stage}:${fact.code}`,
  );
  await commitEffectBatch(
    database,
    {
      statements: [
        insertReviewDocumentExceptionStatement(
          database,
          {
            id,
            reviewSetId: message.reviewSetId as ReviewSetId,
            reviewDocumentId,
            stage: fact.stage,
            code: fact.code,
            detail: extra.detail,
          },
          exceptedAt,
        ),
        markReviewDocumentExceptedStatement(
          database,
          reviewDocumentId,
          extra.formatIdentified,
          exceptedAt,
        ),
        advanceProcessingCountsStatement(
          database,
          message.loadId as DiscoveryLoadId,
          { processed: 0, excepted: 1 },
          exceptedAt,
        ),
      ],
      outboxMessages: [],
    },
    { now },
  );
}

async function park(
  database: BatchDatabase,
  reviewDocumentId: ReviewDocumentId,
  reason: string,
): Promise<void> {
  await commitEffectBatch(
    database,
    {
      statements: [parkReviewDocumentStatement(database, reviewDocumentId, reason, now())],
      outboxMessages: [],
    },
    { now },
  );
}

// The queue() handler: one message at a time, ack on every outcome the platform has an answer for —
// processed, excepted, or parked — and retry only on a transient fault. Per-message ack so one
// unreadable document never re-runs an already-extracted sibling; a message that exhausts its
// attempts dead-letters, where it stays as the record that a document is missing from the corpus.
export async function discoveryProcessQueue(
  batch: MessageBatch<DiscoveryProcessMessage>,
  env: Bindings,
  ports: DiscoveryProcessPorts = resolveDiscoveryProcessPorts(env),
): Promise<void> {
  const logger = createWorkersLogger(env.TELEMETRY);
  for (const message of batch.messages) {
    try {
      await processOne(env, message.body, ports);
      message.ack();
    } catch (error) {
      // Redacted by the standard pipeline, and the message body carries only identifiers and keys, so
      // nothing a document said can reach a log line from here.
      logOperationFailed(
        logger,
        `queue:discovery-process:${message.id}`,
        error,
        newCorrelationId(),
      );
      message.retry();
    }
  }
}
