import {
  commitEffectBatch,
  type BatchDatabase,
  guarded,
} from "@magna-carta/data-access/effect-batch";

import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  advanceProcessingCountsStatement,
  readDiscoveryLoad,
} from "@magna-carta/discovery/load-statements";
import {
  countRecognizedPages,
  formatExtractionRoute,
  joinReviewDocumentText,
  type ReviewDocumentSidecar,
} from "@magna-carta/discovery/processing";
import {
  claimReviewDocumentStatement,
  insertReviewDocumentExceptionStatement,
  markReviewDocumentExceptedStatement,
  markReviewDocumentExpandedStatement,
  markReviewDocumentFamilyParentStatement,
  markReviewDocumentProcessedStatement,
  parkReviewDocumentStatement,
  readReviewDocumentExceptions,
  readReviewDocumentSourceStatus,
} from "@magna-carta/discovery/processing-statements";
import { reviewDocumentMetadataKey, reviewDocumentTextKey } from "@magna-carta/discovery/r2-keys";
import {
  readReviewDocument,
  type ReviewDocumentRow,
} from "@magna-carta/discovery/review-document-statements";
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
import type { Bindings } from "../../bindings.ts";
import { firmDatabaseFor } from "../../firm-database/firm-database-proxy.ts";
import { resolveFirmBucket } from "../../files/firm-bucket.ts";
import { FileManagerValidationError } from "@magna-carta/file-manager/validation";
import { resolveTextExtractionPort } from "../../search/text-extraction.ts";
import {
  ingestContainerChild,
  planContainerChildren,
  resolveArchiveExpansionPort,
  type ArchiveExpansionPort,
  type ContainerSidecar,
} from "../../discovery/archive-expansion.ts";
import {
  commitSuppression,
  resolveDeduplication,
  suppressedTerminalEffect,
} from "../../discovery/deduplication.ts";
import {
  exceptionForExtractionFailure,
  MALWARE_FLAGGED,
  SOURCE_BYTES_MISSING,
  type ReviewDocumentExceptionFact,
} from "../../discovery/extraction-exceptions.ts";
import { writeLoadRecordArtifacts } from "../../discovery/load-artifacts.ts";
import { enqueueReviewDocumentForIndexing } from "../../search/enqueue-index.ts";
import {
  isLoadCompletionMessage,
  type DiscoveryLaneMessage,
  type DiscoveryLoadCompletionMessage,
  type DiscoveryProcessMessage,
} from "../../discovery/discovery-process-types.ts";

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

// The engine's own label for an archive and its own name in a route, both spelled the way the engine
// spells them so a row written here and a row written by the extraction path agree. The vocabularies
// live in crates/discovery-core/src/identify.rs and packages/search/src/extraction.ts.
const CONTAINER_FORMAT = "zipArchive";
const DISCOVERY_ENGINE_ROUTE = "discovery-engine";

export interface DiscoveryProcessPorts {
  readonly extraction: TextExtractionPort;
  // Undefined when the engine is not deployed. Separate from the extraction port because expanding a
  // container is not extraction: it produces documents rather than text, and a port whose contract is
  // "bytes in, passages out" has nowhere to put them.
  readonly archives: ArchiveExpansionPort | undefined;
}

export function resolveDiscoveryProcessPorts(env: Bindings): DiscoveryProcessPorts {
  return {
    extraction: resolveTextExtractionPort(env),
    archives: resolveArchiveExpansionPort(env),
  };
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
      statements: [
        guarded(
          claimReviewDocumentStatement(database, reviewDocumentId, claimedAt),
          "review-document.claim",
        ),
      ],
      outboxMessages: [],
    },
    { now },
  );

  // A quarantined version never reaches a parser. Decided from the status the scan gate recorded
  // rather than from anything read out of the bytes, which is what makes "no parser touched it" a
  // property of the control flow rather than a promise.
  //
  // The message carries the verdict as it stood when the dispatch walk ran, and that is enough for
  // every document a load allocated. It is NOT enough for a container's children, whose bytes cross
  // the gate while this consumer is running — so a message carrying NO verdict yet is re-read from
  // the row before it is acted on.
  //
  // Only that case. A message that already says `quarantined` is acted on as it stands and never
  // re-read: the re-read exists to turn "not decided yet" into a decision, and letting it turn a
  // recorded quarantine back into a clean read would make a flagged file's fate depend on which row
  // a later write happened to leave behind. The failure directions are not symmetrical.
  const sourceStatus =
    message.sourceStatus === "clean" || message.sourceStatus === "quarantined"
      ? message.sourceStatus
      : ((await readReviewDocumentSourceStatus(database, reviewDocumentId)) ?? "pending");
  if (sourceStatus === "quarantined") {
    await recordException(env, database, message, MALWARE_FLAGGED, {
      detail: "the scan gate quarantined this version; it is in the corpus and was not opened",
      formatIdentified: null,
    });
    return;
  }
  if (sourceStatus !== "clean") {
    // Not cleared yet is not a verdict. The document waits for the gate rather than being recorded as
    // one the platform tried and failed to read — and it is thrown rather than acked, because the
    // queue's own redelivery is the only thing that will look again.
    await park(database, reviewDocumentId, "the version has not been cleared by the scan gate");
    throw new DiscoveryProcessingFault("the scan gate has not cleared this version yet");
  }

  // DEDUPLICATION RUNS BEFORE A BYTE IS READ, because what it decides is whether this document is
  // read at all. The identity is a content hash, never the near-duplicate fingerprint: the
  // fingerprint collides by design, and suppressing a document from review on the strength of one
  // would decide on a heuristic that a reviewer never sees a document.
  const deduplication = await resolveDeduplication({
    database,
    document,
    emailDedupKey: message.emailDedupKey,
    now,
  });
  if (deduplication.outcome === "await-primary") {
    await park(
      database,
      reviewDocumentId,
      "an identical copy of this document is being read; this one waits for its reading",
    );
    // Thrown so the queue brings it back. The dispatch walk enqueues in identifier order and the
    // primary is the first copy to claim the group, so in practice the wait is one redelivery.
    throw new DiscoveryProcessingFault("the primary copy of this document has not finished");
  }
  if (deduplication.outcome === "suppressed") {
    await suppressAsDuplicate(env, database, message, document, deduplication.primaryId);
    return;
  }

  const { bucket } = resolveFirmBucket(env, message.bucketName);
  const source = await bucket.get(message.sourceKey);
  if (source === null) {
    await recordException(env, database, message, SOURCE_BYTES_MISSING, {
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
    // A CONTAINER IS NOT A DOCUMENT THAT HELD NO WORDS. Its entries are separate documents, and
    // opening it is a recorded act with a family of its own rather than a failure to read it.
    if (extraction.code === "needsExpansion") {
      await expandContainer(env, database, message, document, ports);
      return;
    }
    await recordException(env, database, message, exceptionForExtractionFailure(extraction.code), {
      detail: extraction.detail ?? null,
      // Recorded even on the failure path, and especially there.
      formatIdentified: null,
    });
    return;
  }

  await writeProcessed(env, database, message, extraction);

  // The document has text and a corpus, which is the first moment it can be indexed at all — and the
  // only moment at which "this is the primary of its duplicate group" is already settled, so the
  // group buys one split rather than one per custodian.
  //
  // BEST-EFFORT, after the write that matters. The row and both derived objects are already
  // committed; failing the processing that succeeded because a queue call did not would re-read and
  // re-extract an opposing party's document to fix a bookkeeping miss. What makes that safe is that
  // the row's own index state is the backlog: a document nothing enqueued is countable and replayable
  // rather than silently absent.
  await enqueueReviewDocumentForIndexing(env, message.firmId, reviewDocumentId, database);
}

// A SUPPRESSED COPY STILL HAS AN ENDING, and it is its primary's. The row survives, its custodian
// survives, an occurrence row names the copy a reviewer will actually open, and the load's
// reconciliation counts it — deduplication buys one extraction per group and never a smaller corpus.
async function suppressAsDuplicate(
  env: Bindings,
  database: BatchDatabase,
  message: DiscoveryProcessMessage,
  document: ReviewDocumentRow,
  primaryId: ReviewDocumentId,
): Promise<void> {
  const primary = await readReviewDocument(database, primaryId);
  if (primary === undefined) {
    // The primary vanished between the group read and here. Nothing to mirror and nothing to invent:
    // the queue looks again, and the group re-resolves against whatever is actually there.
    throw new DiscoveryProcessingFault(
      "the primary copy of this document is no longer in the corpus",
    );
  }
  const terminal = suppressedTerminalEffect({
    database,
    document,
    primary,
    now,
  });
  // A copy of a document that could not be read is excepted FOR THE SAME NAMED REASONS, on its own
  // row. That is what keeps the exception report counting the custodian who held an encrypted
  // document as having held one, rather than letting the count collapse onto whichever copy the
  // dispatch walk happened to reach first.
  const inherited = terminal.excepted
    ? await inheritedExceptionStatements(database, message, document, primary.id)
    : [];
  await commitSuppression({
    database,
    document,
    primary,
    terminal,
    extraStatements: inherited,
    now,
  });
  await enqueueLoadCompletionIfReconciled(env, database, message);
}

async function inheritedExceptionStatements(
  database: BatchDatabase,
  message: DiscoveryProcessMessage,
  document: ReviewDocumentRow,
  primaryId: ReviewDocumentId,
): Promise<SqlStatement[]> {
  const reasons = await readReviewDocumentExceptions(database, primaryId);
  const raisedAt = now();
  const statements: SqlStatement[] = [];
  for (const reason of reasons) {
    statements.push(
      insertReviewDocumentExceptionStatement(
        database,
        {
          id: await deriveIdentifier(
            "reviewDocumentException",
            `${document.id}:${reason.stage}:${reason.code}`,
          ),
          reviewSetId: message.reviewSetId as ReviewSetId,
          discoveryLoadId: message.loadId as DiscoveryLoadId,
          reviewDocumentId: document.id,
          stage: reason.stage,
          code: reason.code,
          // The copy's own sentence, not the primary's repeated. A reader has to be able to tell that
          // this row is about a document nobody opened, and why nobody needed to.
          detail:
            "this copy was suppressed behind an identical document that could not be read; the " +
            "reason is that document's",
        },
        raisedAt,
      ),
    );
  }
  return statements;
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
        guarded(
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
              // The legacy-interop digests, from the engine's own pass over the bytes. They exist for
              // the manifest a firm hands to another party: opposing-party tooling and load-file
              // specifications still ask for MD5 and SHA-1, and this is the only pass over the bytes
              // that would ever compute them.
              contentMd5: extraction.facts.digests?.md5 ?? null,
              contentSha1: extraction.facts.digests?.sha1 ?? null,
            },
            extractedAt,
          ),
          "review-document.terminal",
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
  await enqueueLoadCompletionIfReconciled(env, database, message);
}

// EXPANDING A CONTAINER, which is the only place in the platform that opens an archive at all.
//
// The guards are the engine's and every one of them runs before a decompressed byte is retained;
// nothing here second-guesses them. What this does is turn the engine's answer into a family: each
// entry crosses the ordinary ingest gate and becomes a `container-child` of the archive, the archive
// becomes the family head, and every entry the engine DESCRIBED rather than opened becomes a named
// exception on the archive plus a line in its sidecar. An entry that did not come out is accounted
// for or it did not exist.
async function expandContainer(
  env: Bindings,
  database: BatchDatabase,
  message: DiscoveryProcessMessage,
  document: ReviewDocumentRow,
  ports: DiscoveryProcessPorts,
): Promise<void> {
  const reviewDocumentId = message.reviewDocumentId as ReviewDocumentId;
  // ONE LEVEL OF EXPANSION PER DOCUMENT, and the bound is absolute rather than counted. The engine
  // already recursed to its own nesting ceiling and returned the whole tree flattened, so a child
  // that is itself a container is one the engine declined to open — re-expanding it here would walk
  // straight past the guard that stopped it.
  if (document.family_role === "container-child") {
    await recordException(
      env,
      database,
      message,
      { stage: "extract", code: "container-not-expanded" },
      {
        detail:
          "this container came out of another container at the nesting ceiling; its entries are " +
          "described in the parent's record and were not opened",
        formatIdentified: null,
      },
    );
    return;
  }
  if (ports.archives === undefined) {
    await park(database, reviewDocumentId, "the discovery engine is not deployed");
    return;
  }

  const { bucket } = resolveFirmBucket(env, message.bucketName);
  const source = await bucket.get(message.sourceKey);
  if (source === null) {
    await recordException(env, database, message, SOURCE_BYTES_MISSING, {
      detail: "the loaded object is no longer in storage",
      formatIdentified: null,
    });
    return;
  }
  const result = await ports.archives.expand(new Uint8Array(await source.arrayBuffer()));
  if (!result.ok) {
    if (result.kind === "unavailable") {
      await park(database, reviewDocumentId, "the discovery engine did not answer");
      throw new DiscoveryProcessingFault(result.detail);
    }
    // The archive as a whole tripped a guard. Terminal and named: "this container tripped an
    // expansion guard" is a sentence a firm can put in front of a court.
    await recordException(
      env,
      database,
      message,
      { stage: "extract", code: "container-guard-tripped" },
      {
        detail: `the container was refused whole by an expansion guard (${result.code})`,
        formatIdentified: CONTAINER_FORMAT,
      },
    );
    return;
  }

  // Whose act this was. A child's file rows are attributed to the member who ran the load, not to
  // the platform and not to the custodian, because a custodian is whose records these were and an
  // uploader is who put them here.
  const load = await readDiscoveryLoad(database, message.loadId as DiscoveryLoadId);
  if (load === undefined) {
    throw new DiscoveryProcessingFault("the load is no longer in the corpus");
  }

  const children = planContainerChildren(result.expansion);
  const childRecords: { reviewDocumentId: string; path: string; familySequence: number }[] = [];
  // Entries the firm's own upload policy refused, kept apart from the engine's skips because they are
  // a different sentence: the engine could have opened these and the firm has said it does not accept
  // that kind of file. Recorded rather than thrown, because a policy refusal is a fact about one
  // entry and throwing would retry the whole archive until it dead-lettered.
  const refusedByPolicy: { path: string; reason: string; depth: number }[] = [];
  for (const child of children) {
    let ingested: Awaited<ReturnType<typeof ingestContainerChild>>;
    try {
      ingested = await ingestContainerChild({
        env,
        database,
        bucketName: message.bucketName,
        matterId: message.matterId as MatterId,
        reviewSetId: message.reviewSetId as ReviewSetId,
        discoveryLoadId: message.loadId as DiscoveryLoadId,
        // The child's records are the container's records: an entry taken out of one custodian's
        // production did not change hands on the way out.
        recordCustodianId: document.record_custodian_id,
        parentReviewDocumentId: reviewDocumentId,
        uploadedBy: load.initiated_by,
        child,
        now,
      });
    } catch (caught) {
      if (!(caught instanceof FileManagerValidationError)) throw caught;
      refusedByPolicy.push({ path: child.path, reason: "refusedByPolicy", depth: 0 });
      continue;
    }
    childRecords.push({
      reviewDocumentId: ingested.reviewDocumentId,
      path: child.path,
      familySequence: child.sequence,
    });
    // The child is `pending` and the load's dispatch walk has already run past it, so it is queued
    // here. Its own gate verdict has not landed yet; the consumer re-reads the status and waits.
    await env.DISCOVERY_PROCESS.send({
      firmId: message.firmId,
      bucketName: message.bucketName,
      matterId: message.matterId,
      reviewSetId: message.reviewSetId,
      loadId: message.loadId,
      reviewDocumentId: ingested.reviewDocumentId,
      sourceKey: ingested.r2Key,
      contentType: null,
      // Deliberately not `clean`: the bytes are crossing the gate right now, and the consumer's
      // re-read of the row is what turns this into a verdict.
      sourceStatus: "pending",
      emailDedupKey: null,
      engineGeneration: message.engineGeneration,
    } satisfies DiscoveryProcessMessage);
  }

  const expandedAt = now();
  const sidecar: ContainerSidecar = {
    reviewDocumentId,
    reviewSetId: message.reviewSetId,
    discoveryLoadId: message.loadId,
    formatIdentified: CONTAINER_FORMAT,
    expandedAt,
    totalExpandedBytes: result.expansion.totalExpandedBytes,
    children: childRecords,
    // WHAT DID NOT COME OUT, and why. The only place this can be recorded in full: the exception on
    // the archive says how many and of what kind, and this says which.
    notExpanded: [...result.expansion.skipped, ...refusedByPolicy],
  };
  const metadataKey = reviewDocumentMetadataKey(
    message.reviewSetId as ReviewSetId,
    reviewDocumentId,
  );
  await bucket.put(metadataKey, JSON.stringify(sidecar), {
    customMetadata: matterScopedObjectDimensions({
      matterId: message.matterId as MatterId,
      objectClass: "review-document-metadata",
    }),
  });

  await commitEffectBatch(
    database,
    {
      statements: [
        guarded(
          markReviewDocumentExpandedStatement(
            database,
            reviewDocumentId,
            {
              metadataR2Key: metadataKey,
              formatIdentified: CONTAINER_FORMAT,
              extractionRoute: DISCOVERY_ENGINE_ROUTE,
              childCount: childRecords.length,
            },
            expandedAt,
          ),
          "review-document.terminal",
        ),
        markReviewDocumentFamilyParentStatement(database, reviewDocumentId, expandedAt),
        advanceProcessingCountsStatement(
          database,
          message.loadId as DiscoveryLoadId,
          { processed: 1, excepted: 0 },
          expandedAt,
        ),
      ],
      outboxMessages: [],
    },
    { now },
  );

  // The entries the engine described rather than opened. Recorded AFTER the container's own terminal
  // state, because these do not make the container unreadable — it was read, and this is what it
  // turned out to hold that nobody could open. A reader of the report sees a document whose state is
  // `processed` and which still owes a sentence, which is the truth.
  await recordSkippedEntryExceptions(database, message, [
    ...result.expansion.skipped,
    ...refusedByPolicy,
  ]);
  await enqueueLoadCompletionIfReconciled(env, database, message);
}

// One exception per KIND of skip, not per entry: a container with four hundred encrypted entries is
// one fact about that container, and four hundred rows would drown the report it is written for. The
// count is in the detail and the paths are in the sidecar.
async function recordSkippedEntryExceptions(
  database: BatchDatabase,
  message: DiscoveryProcessMessage,
  skipped: readonly { readonly path: string; readonly reason: string }[],
): Promise<void> {
  if (skipped.length === 0) return;
  const encrypted = skipped.filter((entry) => entry.reason === "encrypted").length;
  const guarded = skipped.length - encrypted;
  const raisedAt = now();
  const statements: SqlStatement[] = [];
  if (encrypted > 0) {
    statements.push(
      await skippedEntryException(database, message, "encrypted-container-entry", encrypted),
    );
  }
  if (guarded > 0) {
    statements.push(
      await skippedEntryException(database, message, "container-guard-tripped", guarded),
    );
  }
  await commitEffectBatch(database, { statements, outboxMessages: [] }, { now });
}

async function skippedEntryException(
  database: BatchDatabase,
  message: DiscoveryProcessMessage,
  code: "encrypted-container-entry" | "container-guard-tripped",
  entryCount: number,
): Promise<SqlStatement> {
  const reviewDocumentId = message.reviewDocumentId as ReviewDocumentId;
  return insertReviewDocumentExceptionStatement(
    database,
    {
      id: await deriveIdentifier("reviewDocumentException", `${reviewDocumentId}:extract:${code}`),
      reviewSetId: message.reviewSetId as ReviewSetId,
      discoveryLoadId: message.loadId as DiscoveryLoadId,
      reviewDocumentId,
      stage: "extract",
      code,
      // A count and a kind, never a path: an entry's name inside an opposing party's production is
      // the kind of free text somebody writes a person's name into, and the sidecar is where it
      // belongs. The number is what a reader of the report acts on.
      detail:
        code === "encrypted-container-entry"
          ? `${entryCount} entries in this container are encrypted and were not opened`
          : `${entryCount} entries in this container were refused by an expansion guard`,
    },
    now(),
  );
}

// IS THIS LOAD DONE? Asked by every document that reaches a terminal state, because the last one to
// finish is the only one that can know — and which one that is depends on the order the queue
// happened to deliver.
//
// Sending more than once is safe and expected: the handler re-derives everything it writes and
// commits the completion under a state guard, so a second message rewrites identical bytes at the
// same derived keys and updates no row.
async function enqueueLoadCompletionIfReconciled(
  env: Bindings,
  database: BatchDatabase,
  message: DiscoveryProcessMessage,
): Promise<void> {
  const load = await readDiscoveryLoad(database, message.loadId as DiscoveryLoadId);
  if (load === undefined || load.state !== "processing") return;
  if (load.loaded_document_count === 0) return;
  if (load.processed_count + load.exception_count < load.loaded_document_count) return;
  await env.DISCOVERY_PROCESS.send({
    kind: "load-completion",
    firmId: message.firmId,
    bucketName: message.bucketName,
    matterId: message.matterId,
    reviewSetId: message.reviewSetId,
    loadId: message.loadId,
  } satisfies DiscoveryLoadCompletionMessage);
}

// The text object: one block per page that produced text, pages in order, separated by the form feed
// that is a page break in a plain text file. Written as text rather than as JSON because a firm's own
// reviewer, and eventually opposing counsel, opens this without tooling — and separated rather than
// run together because the index reads this object back and a hit has to be able to name its page.
// The separator's own contract, and why it cannot appear inside a page, is in
// packages/discovery/src/processing.ts.
function passageText(extraction: Extract<TextExtractionResult, { ok: true }>): string {
  return joinReviewDocumentText(extraction.passages.map((passage) => passage.text));
}

async function recordException(
  env: Bindings,
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
            discoveryLoadId: message.loadId as DiscoveryLoadId,
            reviewDocumentId,
            stage: fact.stage,
            code: fact.code,
            detail: extra.detail,
          },
          exceptedAt,
        ),
        guarded(
          markReviewDocumentExceptedStatement(
            database,
            reviewDocumentId,
            extra.formatIdentified,
            exceptedAt,
          ),
          "review-document.terminal",
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
  await enqueueLoadCompletionIfReconciled(env, database, message);
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

// A load whose every document has reached a terminal state, asking for its record artifacts. It is
// its own message rather than work done by the document that happened to finish last, because
// writing a manifest over a corpus at the ceiling is a walk of a quarter of a million rows and that
// does not belong inside one document's turn.
export async function completeOne(
  env: Bindings,
  message: DiscoveryLoadCompletionMessage,
): Promise<void> {
  await writeLoadRecordArtifacts(env, message, now);
}

// The queue() handler: one message at a time, ack on every outcome the platform has an answer for —
// processed, excepted, or parked — and retry only on a transient fault. Per-message ack so one
// unreadable document never re-runs an already-extracted sibling; a message that exhausts its
// attempts dead-letters, where it stays as the record that a document is missing from the corpus.
export async function discoveryProcessQueue(
  batch: MessageBatch<DiscoveryLaneMessage>,
  env: Bindings,
  ports: DiscoveryProcessPorts = resolveDiscoveryProcessPorts(env),
): Promise<void> {
  const logger = createWorkersLogger(env.TELEMETRY);
  for (const message of batch.messages) {
    try {
      if (isLoadCompletionMessage(message.body)) {
        await completeOne(env, message.body);
      } else {
        await processOne(env, message.body, ports);
      }
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
