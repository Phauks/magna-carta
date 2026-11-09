import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { completeLoad, reconcileLoad } from "@magna-carta/discovery/load-service";
import { readDiscoveryLoad, type DiscoveryLoadRow } from "@magna-carta/discovery/load-statements";
import { MANIFEST_RECORD_CUSTODIAN_CEILING } from "@magna-carta/discovery/limits";
import {
  exceptionReportEntry,
  exceptionReportPrelude,
  exceptionReportTextLine,
  exceptionReportTextPrelude,
  loadManifestDocumentEntry,
  loadManifestPrelude,
  loadManifestTextDocumentLine,
  loadManifestTextPrelude,
  EXCEPTION_REPORT_EPILOGUE,
  LOAD_MANIFEST_EPILOGUE,
  type LoadArtifactContext,
} from "@magna-carta/discovery/manifest";
import {
  readLoadExceptionCountsByCode,
  readLoadExceptionPage,
  readLoadExtractionRoutes,
  readManifestDocumentPage,
} from "@magna-carta/discovery/manifest-statements";
import { readLoadProcessingTally } from "@magna-carta/discovery/processing-statements";
import {
  loadExceptionReportKey,
  loadExceptionReportTextKey,
  loadManifestKey,
  loadManifestTextKey,
} from "@magna-carta/discovery/r2-keys";
import { readRecordCustodians } from "@magna-carta/discovery/record-custodian-statements";
import { readReviewSet } from "@magna-carta/discovery/review-set-statements";
import type { DiscoveryLoadId, MatterId, ReviewSetId } from "@magna-carta/identifiers/types";
import { matterScopedObjectDimensions } from "@magna-carta/object-dimensions";
import type { Bindings } from "../bindings.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import type { DiscoveryLoadCompletionMessage } from "./discovery-process-types.ts";

// THE TWO RECORD ARTIFACTS, WRITTEN ONCE, AT THE INSTANT THE CORPUS STOPPED MOVING.
//
// The exception report is the reason this whole lane exists in the shape it does. It is the document
// a firm hands to opposing counsel, and what it says is "these documents are in the corpus, we could
// not read them, and here is the named reason for each one". That sentence is only worth anything if
// it reconciles — so the load reaches `complete` only when what arrived equals what was processed
// plus what was excepted, and this handler refuses to write anything while it does not.
//
// REPRODUCIBILITY, AND WHERE IT COMES FROM. The same load reported twice has to be the same document.
// Three things make that true here, and the pure builders in @magna-carta/discovery/manifest hold the
// rest:
//
//   1. THE KNOWLEDGE INSTANT IS READ, NOT TAKEN. It is the load row's `updated_at` — the moment its
//      last counter moved, which is the moment the last document in it reached a terminal state.
//      Nothing advances it afterwards, so a second run of this handler reads the same instant and
//      renders the same header. Using "now" would make the artifact different every time it was
//      built, which is the difference between a record and a snapshot.
//   2. EVERY WALK IS ORDERED BY IDENTIFIER, so the row order in the document is a property of the
//      corpus rather than of the query planner.
//   3. THE KEYS ARE DERIVED. A retry overwrites its own object at the same key with the same bytes
//      rather than leaving a second, differently-named record beside the first.
//
// A LOAD MANIFEST IS NEVER REGENERATED. It describes what ARRIVED, which does not change; a
// re-processing of the corpus writes a new processing record and leaves this alone. The state guard
// on the completion write is what holds that: the load leaves `processing` exactly once.

// R2 requires every part of a multipart upload except the last to be the same size, and at least
// 5 MiB. One fixed size satisfies both, and the artifacts are streamed into it rather than assembled
// in memory: a load at the ceiling is a quarter of a million document entries, which is a manifest
// far larger than an isolate's memory.
const MULTIPART_PART_SIZE = 8 * 1024 * 1024;

// How many rows one page of either walk reads. Bounded by the per-invocation query wall rather than
// by taste: a load at the ceiling is 250 pages of documents, which leaves the invocation's thousand
// queries plenty of room for the exception walk and the writes.
const ARTIFACT_PAGE_SIZE = 1000;

// An append-only text object streamed into R2 in fixed-size parts. Held here rather than in a shared
// helper because it is the only writer in the codebase that produces an object of unbounded length
// from rows rather than from other objects; the bulk-download build streams bodies through and has
// no text to accumulate.
class MultipartTextWriter {
  private readonly encoder = new TextEncoder();
  private buffered: Uint8Array[] = [];
  private bufferedLength = 0;
  private readonly parts: R2UploadedPart[] = [];
  private upload: R2MultipartUpload | undefined;

  constructor(
    private readonly bucket: R2Bucket,
    private readonly key: string,
    private readonly customMetadata: Record<string, string>,
  ) {}

  write(text: string): void {
    const encoded = this.encoder.encode(text);
    this.buffered.push(encoded);
    this.bufferedLength += encoded.byteLength;
  }

  async flushFullParts(): Promise<void> {
    while (this.bufferedLength >= MULTIPART_PART_SIZE) {
      await this.uploadPart(this.take(MULTIPART_PART_SIZE));
    }
  }

  async finish(): Promise<void> {
    await this.flushFullParts();
    const remainder = this.take(this.bufferedLength);
    if (this.upload === undefined) {
      // The whole artifact fits in one part, which is every load that is not enormous. A plain put of
      // a known-length body is one operation instead of three, and R2 refuses a multipart upload with
      // no parts at all.
      await this.bucket.put(this.key, remainder, { customMetadata: this.customMetadata });
      return;
    }
    if (remainder.byteLength > 0) await this.uploadPart(remainder);
    await this.upload.complete(this.parts);
  }

  private async uploadPart(body: Uint8Array): Promise<void> {
    this.upload ??= await this.bucket.createMultipartUpload(this.key, {
      customMetadata: this.customMetadata,
    });
    this.parts.push(await this.upload.uploadPart(this.parts.length + 1, body));
  }

  private take(length: number): Uint8Array {
    const out = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      const head = this.buffered[0];
      if (head === undefined) break;
      const wanted = length - written;
      if (head.byteLength <= wanted) {
        out.set(head, written);
        written += head.byteLength;
        this.buffered.shift();
        continue;
      }
      out.set(head.subarray(0, wanted), written);
      this.buffered[0] = head.subarray(wanted);
      written += wanted;
    }
    this.bufferedLength -= written;
    return out;
  }
}

export type LoadCompletionOutcome =
  | {
      readonly outcome: "written";
      readonly manifestKey: string;
      readonly exceptionReportKey: string;
    }
  // The load is not reconciled, or is not in `processing` any more. Neither is a failure: a document
  // is still outstanding and the document that finishes it will send this message again, or another
  // delivery already wrote the artifacts and completed the load.
  | { readonly outcome: "not-yet"; readonly reason: string };

export async function writeLoadRecordArtifacts(
  env: Bindings,
  message: DiscoveryLoadCompletionMessage,
  now: () => string = () => new Date().toISOString(),
): Promise<LoadCompletionOutcome> {
  const database = firmDatabaseFor(env.FIRM_DATABASE, message.firmId);
  const loadId = message.loadId as DiscoveryLoadId;
  const load = await readDiscoveryLoad(database, loadId);
  if (load === undefined)
    return { outcome: "not-yet", reason: "the load is no longer in the corpus" };
  if (load.state !== "processing") {
    return { outcome: "not-yet", reason: `the load is ${load.state}` };
  }

  const reconciliation = reconcileLoad(load);
  if (!reconciliation.accountedFor) {
    return { outcome: "not-yet", reason: "a document in this load is in neither terminal column" };
  }
  // The counters are advanced relatively as each document finishes; this counts the rows themselves.
  // TWO NUMBERS DERIVED TWO DIFFERENT WAYS, and both have to agree before a record is written — a
  // report that reconciled against the number it was drawn from would reconcile with anything.
  const tally = await readLoadProcessingTally(database, loadId);
  if (tally.outstanding !== 0 || tally.loaded !== load.loaded_document_count) {
    return {
      outcome: "not-yet",
      reason: "the load's counters and its rows do not agree about what is in it",
    };
  }

  const reviewSet = await readReviewSet(database, load.review_set_id);
  if (reviewSet === undefined) {
    return { outcome: "not-yet", reason: "the review set is no longer in the corpus" };
  }
  const custodians = await readRecordCustodians(
    database,
    load.review_set_id,
    MANIFEST_RECORD_CUSTODIAN_CEILING,
  );
  const custodianNames = new Map(
    custodians.data.map((custodian) => [custodian.id as string, custodian.display_name]),
  );
  const exceptionCounts = await readLoadExceptionCountsByCode(database, loadId);

  const context: LoadArtifactContext = {
    loadId,
    reviewSetId: load.review_set_id,
    reviewSetName: reviewSet.name,
    matterId: message.matterId,
    lane: load.lane,
    loadState: "complete",
    transcriptScope: load.transcript_scope,
    sourceDescription: load.source_description,
    initiatedBy: load.initiated_by,
    initiatedAt: load.initiated_at,
    // The instant the last counter moved, and therefore the instant the corpus stopped moving for
    // this load. Read off the row rather than taken from a clock, which is what makes a second run
    // of this handler produce the same document.
    knowledgeInstant: load.updated_at,
    reconciliation: {
      declaredDocumentCount: reconciliation.declaredDocumentCount,
      loadedDocumentCount: reconciliation.loadedDocumentCount,
      processedCount: reconciliation.processedCount,
      exceptionCount: reconciliation.exceptionCount,
      declarationMatched: reconciliation.declarationMatched,
      accountedFor: reconciliation.accountedFor,
    },
    recordCustodians: custodians.data.map((custodian) => ({
      id: custodian.id,
      displayName: custodian.display_name,
      kind: custodian.kind,
    })),
    exceptionCounts,
    manifestKey: loadManifestKey(load.review_set_id, loadId),
    exceptionReportKey: loadExceptionReportKey(load.review_set_id, loadId),
    extractionRoutesObserved: await readLoadExtractionRoutes(database, loadId),
  };

  const { bucket } = resolveFirmBucket(env, message.bucketName);
  const dimensions = matterScopedObjectDimensions({
    matterId: message.matterId as MatterId,
    objectClass: "review-load-record",
  });

  await writeManifest(database, load, context, custodianNames, bucket, dimensions);
  await writeExceptionReport(database, load, context, bucket, dimensions);

  // OBJECTS BEFORE THE ROW, for the reason every derived write in this subsystem uses that order: a
  // load whose row names a manifest that is not in the bucket is a corpus asserting a record it does
  // not hold, and the other way round leaves an object nothing points at, which the next attempt
  // overwrites at the same derived key.
  // Attributed to the member who ran the load rather than to the platform: completion is the last
  // act of their load, and the audit row should name a person.
  const { effect } = await completeLoad(database, loadId, {
    clock: { now },
    actorUserId: load.initiated_by,
  });
  await commitEffectBatch(database, effect, { now });
  return {
    outcome: "written",
    manifestKey: context.manifestKey,
    exceptionReportKey: context.exceptionReportKey,
  };
}

async function writeManifest(
  database: BatchDatabase,
  load: DiscoveryLoadRow,
  context: LoadArtifactContext,
  // Read once by the caller and passed down: a review set holds a handful of custodians and a
  // quarter-million documents, so joining the name per page would be a join repeated on every page
  // to answer a question with a fixed, tiny answer.
  custodianNames: ReadonlyMap<string, string>,
  bucket: R2Bucket,
  dimensions: Record<string, string>,
): Promise<void> {
  const reviewSetId = load.review_set_id;
  const loadId = load.id;

  // The document walk runs ONCE and feeds both forms. Walking twice would double the read cost over
  // the largest table in the firm's database and — worse — would let the machine-readable and the
  // printable form disagree if a row moved between them, which is exactly the disagreement a
  // reproducible artifact cannot have.
  const json = new MultipartTextWriter(bucket, context.manifestKey, dimensions);
  const text = new MultipartTextWriter(
    bucket,
    loadManifestTextKey(reviewSetId, loadId),
    dimensions,
  );
  json.write(loadManifestPrelude(context));
  text.write(loadManifestTextPrelude(context));

  let cursor: string | null = null;
  let first = true;
  for (;;) {
    const page = await readManifestDocumentPage(database, loadId, cursor, ARTIFACT_PAGE_SIZE);
    if (page.length === 0) break;
    for (const row of page) {
      const descriptor = {
        document: row,
        // Falls back to the identifier, never to a word like "unattributed": the document IS
        // attributed and the identifier proves it, so a missing display name is a gap in this
        // header's index rather than a fact about the document.
        recordCustodianName: custodianNames.get(row.record_custodian_id) ?? row.record_custodian_id,
      };
      json.write(first ? "" : ",\n");
      json.write(loadManifestDocumentEntry(descriptor));
      text.write(loadManifestTextDocumentLine(descriptor));
      first = false;
    }
    await json.flushFullParts();
    await text.flushFullParts();
    if (page.length < ARTIFACT_PAGE_SIZE) break;
    cursor = page[page.length - 1]?.id ?? null;
    if (cursor === null) break;
  }
  json.write(LOAD_MANIFEST_EPILOGUE);
  text.write("\n");
  await json.finish();
  await text.finish();
}

async function writeExceptionReport(
  database: BatchDatabase,
  load: DiscoveryLoadRow,
  context: LoadArtifactContext,
  bucket: R2Bucket,
  dimensions: Record<string, string>,
): Promise<void> {
  const reviewSetId = load.review_set_id;
  const loadId = load.id;
  const json = new MultipartTextWriter(bucket, context.exceptionReportKey, dimensions);
  const text = new MultipartTextWriter(
    bucket,
    loadExceptionReportTextKey(reviewSetId, loadId),
    dimensions,
  );
  json.write(exceptionReportPrelude(context));
  text.write(exceptionReportTextPrelude(context));

  let afterDocumentId: string | null = null;
  let afterExceptionId: string | null = null;
  let first = true;
  for (;;) {
    const page = await readLoadExceptionPage(
      database,
      loadId,
      afterDocumentId,
      afterExceptionId,
      ARTIFACT_PAGE_SIZE,
    );
    if (page.length === 0) break;
    for (const row of page) {
      json.write(first ? "" : ",\n");
      json.write(exceptionReportEntry(row));
      text.write(exceptionReportTextLine(row));
      first = false;
    }
    await json.flushFullParts();
    await text.flushFullParts();
    if (page.length < ARTIFACT_PAGE_SIZE) break;
    const last = page[page.length - 1];
    if (last === undefined) break;
    // Resumed from the (document, exception) PAIR, so a page boundary inside a document that carries
    // several reasons neither repeats one nor drops one.
    afterDocumentId = last.review_document_id;
    afterExceptionId = last.exception_id;
  }
  json.write(EXCEPTION_REPORT_EPILOGUE);
  text.write("\n");
  await json.finish();
  await text.finish();
}
