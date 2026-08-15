import { env } from "cloudflare:test";
import { readLoadProcessingTally } from "@magna-carta/discovery/processing-statements";
import { readReviewDocument } from "@magna-carta/discovery/review-document-statements";
import { reviewDocumentMetadataKey, reviewDocumentTextKey } from "@magna-carta/discovery/r2-keys";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  DiscoveryLoadId,
  FirmId,
  MatterId,
  RecordCustodianId,
  ReviewDocumentId,
  ReviewSetId,
} from "@magna-carta/identifiers/types";
import {
  extracted,
  extractionAdapterError,
  extractionEngineNotImplemented,
  unextractable,
  type TextExtractionPort,
} from "@magna-carta/search/extraction";
import { beforeAll, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { processOne } from "../src/discovery/process-consumer.ts";
import type { DiscoveryProcessMessage } from "../src/discovery/discovery-process-types.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";

// The discovery processing consumer over real Miniflare bindings (R2 + the firm's FirmDatabase DO).
// The extraction port is injected, because neither engine Container can run under the test pool —
// which is also the production posture today, so the parked path below is the real path and not a
// test-only branch.
//
// What every case here is really asserting is the same property from a different side: a document
// that entered the corpus ends in a state a person can read, and never in silence.

const BUCKET = "magna-carta-production-platform-files";
const now = () => new Date().toISOString();

let firmId: FirmId;
let database: ReturnType<typeof firmDatabaseFor>;
let matterId: MatterId;
let reviewSetId: ReviewSetId;
let recordCustodianId: RecordCustodianId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = newIdentifier("firm");
  database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  matterId = newIdentifier("matter");
  reviewSetId = newIdentifier("reviewSet");
  recordCustodianId = newIdentifier("recordCustodian");
  const at = now();
  // The corpus hangs off a real matter and a real member: foreign keys are enforced in the per-firm
  // database, so the chain a review document points into has to exist before one can.
  const responsibleMemberId = newIdentifier("user");
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'A. Reviewer', 'active', ?2)",
    )
    .bind(responsibleMemberId, at)
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) " +
        "VALUES (?1, 'Whitfield v. Arden', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, responsibleMemberId, at)
    .run();
  await database
    .prepare(
      "INSERT INTO review_set (id, matter_id, name, state, document_ceiling, created_by, created_at, updated_at) " +
        "VALUES (?1, ?2, 'Plaintiff production, March 2026', 'open', 250000, ?3, ?4, ?4)",
    )
    .bind(reviewSetId, matterId, newIdentifier("user"), at)
    .run();
  await database
    .prepare(
      "INSERT INTO record_custodian (id, review_set_id, display_name, kind, created_at, updated_at) " +
        "VALUES (?1, ?2, 'A. Whitfield', 'person', ?3, ?3)",
    )
    .bind(recordCustodianId, reviewSetId, at)
    .run();
});

// One load holding one document, with the source bytes in the bucket. Each case gets its own so the
// load counters it moves are its own to assert.
async function seedOneDocument(options: {
  readonly bytes?: Uint8Array;
  readonly sourceStatus?: string;
  readonly writeObject?: boolean;
}): Promise<{ message: DiscoveryProcessMessage; loadId: DiscoveryLoadId }> {
  const loadId = newIdentifier("discoveryLoad") as DiscoveryLoadId;
  const reviewDocumentId = newIdentifier("reviewDocument") as ReviewDocumentId;
  const fileId = newIdentifier("file");
  const fileVersionId = newIdentifier("fileVersion");
  const sourceKey = `files/${fileVersionId}`;
  const at = now();
  await database
    .prepare(
      "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, 'produced.pdf', ?3, ?3)",
    )
    .bind(fileId, matterId, at)
    .run();
  await database
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, status, created_at) " +
        "VALUES (?1, ?2, 1, ?3, 'clean', ?4)",
    )
    .bind(fileVersionId, fileId, sourceKey, at)
    .run();
  await database
    .prepare(
      "INSERT INTO discovery_load (id, review_set_id, lane, state, transcript_scope, " +
        "declared_document_count, loaded_document_count, initiated_by, initiated_at, created_at, updated_at) " +
        "VALUES (?1, ?2, 'received-production', 'processing', 'exclude', 1, 1, ?3, ?4, ?4, ?4)",
    )
    .bind(loadId, reviewSetId, newIdentifier("user"), at)
    .run();
  await database
    .prepare(
      "INSERT INTO review_document (id, review_set_id, discovery_load_id, record_custodian_id, " +
        "source_kind, file_version_id, family_id, family_role, processing_state, created_at, updated_at) " +
        "VALUES (?1, ?2, ?3, ?4, 'file_version', ?5, ?1, 'standalone', 'pending', ?6, ?6)",
    )
    .bind(reviewDocumentId, reviewSetId, loadId, recordCustodianId, fileVersionId, at)
    .run();

  if (options.writeObject !== false) {
    await env.R2.put(sourceKey, options.bytes ?? new TextEncoder().encode("document bytes"));
  }
  return {
    loadId,
    message: {
      firmId,
      bucketName: BUCKET,
      matterId,
      reviewSetId,
      loadId,
      reviewDocumentId,
      sourceKey,
      contentType: "application/pdf",
      sourceStatus: options.sourceStatus ?? "clean",
      engineGeneration: "discovery+recognition",
    },
  };
}

function portReturning(result: Awaited<ReturnType<TextExtractionPort["extract"]>>) {
  return { extraction: { extract: async () => result } satisfies TextExtractionPort };
}

const READS_ONE_PAGE = extracted(
  [{ chunkId: "page-0", text: "The seller shall indemnify the buyer.", page: 1 }],
  [{ pageIndex: 0, provenance: "native", hasText: true }],
  ["discovery-engine"],
  {
    formatIdentified: "pdf",
    pageCount: 1,
    documentDate: "2026-03-04T00:00:00Z",
    documentDateSource: "documentProperties",
    textFingerprint: "9f2c1a04bb37de55",
  },
);

describe("a document that reads", () => {
  it("writes its text and sidecar to R2, its facts to the row, and nothing bulk to the database", async () => {
    const { message, loadId } = await seedOneDocument({});
    await processOne(env, message, portReturning(READS_ONE_PAGE));

    const row = await readReviewDocument(database, message.reviewDocumentId as ReviewDocumentId);
    expect(row?.processing_state).toBe("processed");
    expect(row?.format_identified).toBe("pdf");
    expect(row?.page_count).toBe(1);
    expect(row?.pages_recognized).toBe(0);
    // WHICH ENGINE READ IT, recorded on the row. This is the fact the corpus could not previously
    // state, and the reason a born-digital PDF once extracted to nothing without anybody noticing.
    expect(row?.extraction_route).toBe("discovery-engine");
    expect(row?.text_fingerprint).toBe("9f2c1a04bb37de55");
    expect(row?.sort_date).toBe("2026-03-04T00:00:00Z");
    expect(row?.processing_deferred_reason).toBeNull();

    // The row holds POINTERS. A 50,000-document review set averaging 30 KB of text is 1.5 GB, which
    // settles where the text lives without anybody having to argue about it.
    const textKey = reviewDocumentTextKey(
      reviewSetId,
      message.reviewDocumentId as ReviewDocumentId,
    );
    expect(row?.text_r2_key).toBe(textKey);
    const text = await env.R2.get(textKey);
    expect(await text?.text()).toBe("The seller shall indemnify the buyer.");
    const sidecar = await env.R2.get(
      reviewDocumentMetadataKey(reviewSetId, message.reviewDocumentId as ReviewDocumentId),
    );
    const parsed = (await sidecar?.json()) as { extractionRoute: string[]; pages: unknown[] };
    expect(parsed.extractionRoute).toEqual(["discovery-engine"]);
    expect(parsed.pages).toHaveLength(1);

    const tally = await readLoadProcessingTally(database, loadId);
    expect(tally).toMatchObject({ loaded: 1, processed: 1, excepted: 0, outstanding: 0 });
  });

  it("counts the pages a machine read, so a reviewer knows what kind of text this is", async () => {
    const { message } = await seedOneDocument({});
    await processOne(
      env,
      message,
      portReturning(
        extracted(
          [{ chunkId: "page-0", text: "INVOICE 4471", page: 1 }],
          [
            { pageIndex: 0, provenance: "ocr", hasText: true },
            { pageIndex: 1, provenance: "ocr", hasText: false },
          ],
          ["discovery-engine", "recognition"],
          {
            formatIdentified: "pdf",
            pageCount: 2,
            documentDate: null,
            documentDateSource: null,
            textFingerprint: null,
          },
        ),
      ),
    );
    const row = await readReviewDocument(database, message.reviewDocumentId as ReviewDocumentId);
    expect(row?.pages_recognized).toBe(2);
    expect(row?.extraction_route).toBe("discovery-engine,recognition");
  });

  it("converges on a redelivery instead of processing the document twice", async () => {
    // Structural: the claim is guarded by the state, and every key it writes is derived. A second
    // delivery must not move the load's counters past what the corpus holds.
    const { message, loadId } = await seedOneDocument({});
    await processOne(env, message, portReturning(READS_ONE_PAGE));
    await processOne(env, message, portReturning(READS_ONE_PAGE));
    const tally = await readLoadProcessingTally(database, loadId);
    expect(tally.processed).toBe(1);
    const load = await database
      .prepare("SELECT processed_count FROM discovery_load WHERE id = ?1")
      .bind(loadId)
      .all<{ processed_count: number }>();
    expect(load.results[0]?.processed_count).toBe(1);
  });
});

describe("a document that cannot be read is a verdict a reviewer can see", () => {
  it("records the named code, not an empty text object", async () => {
    const { message, loadId } = await seedOneDocument({});
    await processOne(
      env,
      message,
      portReturning(unextractable("the document's content is encrypted", "encrypted")),
    );

    const row = await readReviewDocument(database, message.reviewDocumentId as ReviewDocumentId);
    expect(row?.processing_state).toBe("excepted");
    expect(row?.text_r2_key).toBeNull();
    const exceptions = await database
      .prepare(
        "SELECT stage, code, detail FROM review_document_exception WHERE review_document_id = ?1",
      )
      .bind(message.reviewDocumentId)
      .all<{ stage: string; code: string; detail: string | null }>();
    expect(exceptions.results).toEqual([
      {
        stage: "extract",
        code: "encrypted",
        detail: "the document's content is encrypted",
      },
    ]);
    const tally = await readLoadProcessingTally(database, loadId);
    expect(tally).toMatchObject({ loaded: 1, processed: 0, excepted: 1, outstanding: 0 });
  });

  it("says no-text-extracted rather than indexing the document as empty", async () => {
    // An empty index entry asserts "this document contains no text", which is the one answer a
    // discovery search must never give wrongly.
    const { message } = await seedOneDocument({});
    await processOne(
      env,
      message,
      portReturning(unextractable("the document yielded no readable text", "noTextExtracted")),
    );
    const exceptions = await database
      .prepare("SELECT code FROM review_document_exception WHERE review_document_id = ?1")
      .bind(message.reviewDocumentId)
      .all<{ code: string }>();
    expect(exceptions.results[0]?.code).toBe("no-text-extracted");
  });

  it("names a quarantined document without opening it", async () => {
    // A flagged file in discovery is EVIDENCE: it is in the corpus, it is in the report, and no
    // parser is pointed at it. The port is one that would throw if it were ever called.
    const { message } = await seedOneDocument({ sourceStatus: "quarantined" });
    const neverCalled: TextExtractionPort = {
      extract: () => {
        throw new Error("a quarantined document reached a parser");
      },
    };
    await processOne(env, message, { extraction: neverCalled });

    const row = await readReviewDocument(database, message.reviewDocumentId as ReviewDocumentId);
    expect(row?.processing_state).toBe("excepted");
    const exceptions = await database
      .prepare("SELECT stage, code FROM review_document_exception WHERE review_document_id = ?1")
      .bind(message.reviewDocumentId)
      .all<{ stage: string; code: string }>();
    expect(exceptions.results[0]).toEqual({ stage: "load", code: "malware-flagged" });
  });

  it("names bytes that are gone rather than reporting a document with no text", async () => {
    const { message } = await seedOneDocument({ writeObject: false });
    await processOne(env, message, portReturning(READS_ONE_PAGE));
    const exceptions = await database
      .prepare("SELECT code FROM review_document_exception WHERE review_document_id = ?1")
      .bind(message.reviewDocumentId)
      .all<{ code: string }>();
    expect(exceptions.results[0]?.code).toBe("source-bytes-missing");
  });

  it("writes one row per reason on a redelivery, never a second copy of the same reason", async () => {
    const { message, loadId } = await seedOneDocument({});
    const port = portReturning(unextractable("the document is damaged past reading", "corrupt"));
    await processOne(env, message, port);
    await processOne(env, message, port);
    const exceptions = await database
      .prepare("SELECT id FROM review_document_exception WHERE review_document_id = ?1")
      .bind(message.reviewDocumentId)
      .all<{ id: string }>();
    expect(exceptions.results).toHaveLength(1);
    const tally = await readLoadProcessingTally(database, loadId);
    expect(tally.excepted).toBe(1);
  });
});

describe("an engine that is not there is a state, not a verdict", () => {
  it("parks the document with the reason on the row, still pending and still owed", async () => {
    const { message, loadId } = await seedOneDocument({});
    await processOne(
      env,
      message,
      portReturning(extractionEngineNotImplemented("the recognition engine is not deployed")),
    );

    const row = await readReviewDocument(database, message.reviewDocumentId as ReviewDocumentId);
    // NOT `excepted`. Recording it as excepted would say the platform tried and the document could
    // not be read, which is a different and untrue sentence while a Container is simply undeployed.
    expect(row?.processing_state).toBe("pending");
    expect(row?.processing_deferred_reason).toBe("the recognition engine is not deployed");
    const tally = await readLoadProcessingTally(database, loadId);
    // The load cannot complete: its reconciliation refuses while a document is outstanding.
    expect(tally).toMatchObject({ processed: 0, excepted: 0, outstanding: 1 });
  });

  it("clears the parked reason when a later attempt gets through", async () => {
    const { message } = await seedOneDocument({});
    await processOne(env, message, portReturning(extractionEngineNotImplemented("not deployed")));
    await processOne(env, message, portReturning(READS_ONE_PAGE));
    const row = await readReviewDocument(database, message.reviewDocumentId as ReviewDocumentId);
    expect(row?.processing_state).toBe("processed");
    expect(row?.processing_deferred_reason).toBeNull();
  });

  it("throws on a transient fault so the queue retries, and leaves the reason visible meanwhile", async () => {
    const { message } = await seedOneDocument({});
    await expect(
      processOne(
        env,
        message,
        portReturning(extractionAdapterError("recognition service 503", "recognitionFailed")),
      ),
    ).rejects.toThrow();
    const row = await readReviewDocument(database, message.reviewDocumentId as ReviewDocumentId);
    expect(row?.processing_state).toBe("pending");
    expect(row?.processing_deferred_reason).toBe("an extraction service did not answer");
  });
});
