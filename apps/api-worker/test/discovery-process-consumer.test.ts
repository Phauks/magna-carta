import { env } from "cloudflare:test";
import { readOccurrencesForPrimary } from "@magna-carta/discovery/dedup-statements";
import { readLoadProcessingTally } from "@magna-carta/discovery/processing-statements";
import { readReviewDocument } from "@magna-carta/discovery/review-document-statements";
import {
  loadExceptionReportKey,
  loadExceptionReportTextKey,
  loadManifestKey,
  loadManifestTextKey,
  reviewDocumentMetadataKey,
  reviewDocumentTextKey,
} from "@magna-carta/discovery/r2-keys";
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
import type { ArchiveExpansionResult } from "../src/discovery/archive-expansion.ts";
import { writeLoadRecordArtifacts } from "../src/discovery/load-artifacts.ts";
import { processOne } from "../src/background/discovery/process-consumer.ts";
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
      emailDedupKey: null,
      engineGeneration: "discovery+recognition",
    },
  };
}

function portReturning(result: Awaited<ReturnType<TextExtractionPort["extract"]>>) {
  return {
    extraction: { extract: async () => result } satisfies TextExtractionPort,
    // The engine that expands a container is the same undeployed Container the extraction port
    // stands in for, so the default here is its real absence.
    archives: undefined,
  };
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
    digests: {
      md5: "9e107d9d372bb6826bd81d3542a419d6",
      sha1: "2fd4e1c67a2d28fced849ee1bb76e7391b93eb12",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
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
            digests: null,
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
    await processOne(env, message, { extraction: neverCalled, archives: undefined });

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

// A load holding several documents that point at the SAME bytes, each attributed to its own
// custodian of record. This is the shape the deduplication rules exist for: one document, three
// people who held it, and a reviewer who should read it once without anybody losing the other two.
async function seedDuplicateSet(options: {
  readonly copies: number;
  readonly contentSha256: string;
}): Promise<{
  readonly loadId: DiscoveryLoadId;
  readonly messages: DiscoveryProcessMessage[];
  readonly custodianIds: RecordCustodianId[];
}> {
  const loadId = newIdentifier("discoveryLoad") as DiscoveryLoadId;
  const at = now();
  await database
    .prepare(
      "INSERT INTO discovery_load (id, review_set_id, lane, state, transcript_scope, " +
        "declared_document_count, loaded_document_count, initiated_by, initiated_at, created_at, updated_at) " +
        "VALUES (?1, ?2, 'received-production', 'processing', 'exclude', ?3, ?3, ?4, ?5, ?5, ?5)",
    )
    .bind(loadId, reviewSetId, options.copies, newIdentifier("user"), at)
    .run();

  const messages: DiscoveryProcessMessage[] = [];
  const custodianIds: RecordCustodianId[] = [];
  for (let copy = 0; copy < options.copies; copy++) {
    const custodianId = newIdentifier("recordCustodian") as RecordCustodianId;
    custodianIds.push(custodianId);
    await database
      .prepare(
        "INSERT INTO record_custodian (id, review_set_id, display_name, kind, created_at, updated_at) " +
          "VALUES (?1, ?2, ?3, 'person', ?4, ?4)",
      )
      .bind(custodianId, reviewSetId, `Custodian ${copy} of ${custodianId}`, at)
      .run();
    const reviewDocumentId = newIdentifier("reviewDocument") as ReviewDocumentId;
    const fileId = newIdentifier("file");
    const fileVersionId = newIdentifier("fileVersion");
    const sourceKey = `files/${fileVersionId}`;
    await database
      .prepare(
        "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, 'exhibit.pdf', ?3, ?3)",
      )
      .bind(fileId, matterId, at)
      .run();
    await database
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, status, content_sha256, created_at) " +
          "VALUES (?1, ?2, 1, ?3, 'clean', ?4, ?5)",
      )
      .bind(fileVersionId, fileId, sourceKey, options.contentSha256, at)
      .run();
    await database
      .prepare(
        "INSERT INTO review_document (id, review_set_id, discovery_load_id, record_custodian_id, " +
          "source_kind, file_version_id, family_id, family_role, content_sha256, source_name, " +
          "processing_state, created_at, updated_at) " +
          "VALUES (?1, ?2, ?3, ?4, 'file_version', ?5, ?1, 'standalone', ?6, 'exhibit.pdf', 'pending', ?7, ?7)",
      )
      .bind(
        reviewDocumentId,
        reviewSetId,
        loadId,
        custodianId,
        fileVersionId,
        options.contentSha256,
        at,
      )
      .run();
    await env.R2.put(sourceKey, new TextEncoder().encode("one exhibit, held by several people"));
    messages.push({
      firmId,
      bucketName: BUCKET,
      matterId,
      reviewSetId,
      loadId,
      reviewDocumentId,
      sourceKey,
      contentType: "application/pdf",
      sourceStatus: "clean",
      emailDedupKey: null,
      engineGeneration: "discovery",
    });
  }
  return { loadId, messages, custodianIds };
}

describe("the same document held by three custodians", () => {
  it("is extracted once, kept three times, and reachable from the copy a reviewer opens", async () => {
    const sha = `a${"0".repeat(63)}`;
    const { loadId, messages, custodianIds } = await seedDuplicateSet({
      copies: 3,
      contentSha256: sha,
    });
    let extractions = 0;
    const countingPort = {
      archives: undefined,
      extraction: {
        extract: async () => {
          extractions += 1;
          return READS_ONE_PAGE;
        },
      } satisfies TextExtractionPort,
    };
    for (const message of messages) await processOne(env, message, countingPort);

    // THE EXPENSIVE OPERATION RAN ONCE. That is the whole of what deduplication buys.
    expect(extractions).toBe(1);

    const rows = await Promise.all(
      messages.map((message) =>
        readReviewDocument(database, message.reviewDocumentId as ReviewDocumentId),
      ),
    );
    // Every copy still exists and every copy reached a terminal state, so the load's arithmetic
    // still adds up over the whole corpus rather than over the part of it somebody kept.
    expect(rows.every((row) => row?.processing_state === "processed")).toBe(true);
    const primaries = rows.filter((row) => row?.is_dedup_primary === 1);
    expect(primaries).toHaveLength(1);
    expect(rows.every((row) => row?.dedup_group_id === `content-sha256:${sha}`)).toBe(true);
    // The suppressed copies point at the primary's reading rather than at a second copy of it.
    const primaryTextKey = primaries[0]?.text_r2_key;
    expect(rows.every((row) => row?.text_r2_key === primaryTextKey)).toBe(true);

    const occurrences = await readOccurrencesForPrimary(
      database,
      reviewSetId,
      primaries[0]?.id as ReviewDocumentId,
    );
    expect(occurrences).toHaveLength(2);
    // "WHICH CUSTODIANS HELD THIS DOCUMENT" — the question asked under oath, answered from the
    // occurrence rows rather than from a hash scan over the corpus.
    const attributed = new Set(occurrences.map((row) => row.record_custodian_id));
    const suppressed = rows.filter((row) => row?.is_dedup_primary === 0);
    for (const row of suppressed) {
      expect(attributed.has(row?.record_custodian_id as RecordCustodianId)).toBe(true);
    }
    expect(custodianIds).toHaveLength(3);

    const tally = await readLoadProcessingTally(database, loadId);
    expect(tally).toMatchObject({ loaded: 3, processed: 3, excepted: 0, outstanding: 0 });
  });

  it("gives every copy of an unreadable document its own named reason", async () => {
    const sha = `b${"0".repeat(63)}`;
    const { loadId, messages } = await seedDuplicateSet({ copies: 2, contentSha256: sha });
    for (const message of messages) {
      await processOne(
        env,
        message,
        portReturning(unextractable("the document's content is encrypted", "encrypted")),
      );
    }
    const codes = await database
      .prepare(
        "SELECT review_document_id, code FROM review_document_exception " +
          "WHERE discovery_load_id = ?1 ORDER BY review_document_id ASC",
      )
      .bind(loadId)
      .all<{ review_document_id: string; code: string }>();
    // Both copies carry `encrypted`, so the custodian who held an unreadable document is counted as
    // having held one rather than disappearing behind whichever copy was reached first.
    expect(codes.results).toHaveLength(2);
    expect(codes.results.every((row) => row.code === "encrypted")).toBe(true);
    const tally = await readLoadProcessingTally(database, loadId);
    expect(tally).toMatchObject({ loaded: 2, processed: 0, excepted: 2, outstanding: 0 });
  });

  it("never groups documents whose hash nobody recorded", async () => {
    // A fingerprint collision, or an absent hash, must not silently drop evidence: with no identity
    // the platform declines to assert anything and both documents are read on their own terms.
    const first = await seedOneDocument({});
    const second = await seedOneDocument({});
    let extractions = 0;
    const countingPort = {
      archives: undefined,
      extraction: {
        extract: async () => {
          extractions += 1;
          return READS_ONE_PAGE;
        },
      } satisfies TextExtractionPort,
    };
    await processOne(env, first.message, countingPort);
    await processOne(env, second.message, countingPort);
    expect(extractions).toBe(2);
    const rows = await Promise.all([
      readReviewDocument(database, first.message.reviewDocumentId as ReviewDocumentId),
      readReviewDocument(database, second.message.reviewDocumentId as ReviewDocumentId),
    ]);
    expect(rows.every((row) => row?.dedup_group_id === null)).toBe(true);
    expect(rows.every((row) => row?.is_dedup_primary === 1)).toBe(true);
  });
});

// A container is a transport, and expanding one is the narrow exception to the platform's rule that
// an archive is stored opaque. What these cases hold is the chain of custody it produces: a family
// whose parent is the archive, and an honest account of every entry that did not come out.
function archivePortReturning(result: ArchiveExpansionResult) {
  return {
    extraction: {
      extract: async () =>
        unextractable(
          "the document is a container whose entries are separate documents",
          "needsExpansion",
        ),
    } satisfies TextExtractionPort,
    archives: { expand: async () => result },
  };
}

function base64(text: string): string {
  return btoa(text);
}

describe("a container becomes a family", () => {
  it("makes every entry a child of the archive, through the ordinary ingest gate", async () => {
    const { message, loadId } = await seedOneDocument({});
    await processOne(
      env,
      message,
      archivePortReturning({
        ok: true,
        expansion: {
          entries: [
            { path: "PLTF000002.txt", bytes: base64("second exhibit"), depth: 0 },
            { path: "PLTF000001.txt", bytes: base64("first exhibit"), depth: 0 },
          ],
          skipped: [],
          totalExpandedBytes: 27,
        },
      }),
    );

    const parent = await readReviewDocument(database, message.reviewDocumentId as ReviewDocumentId);
    // The archive PROCESSED. It is not a document that turned out to hold no words, and it has no
    // text object of its own — what it produced is a family, recorded in its sidecar.
    expect(parent?.processing_state).toBe("processed");
    expect(parent?.family_role).toBe("parent");
    expect(parent?.format_identified).toBe("zipArchive");
    expect(parent?.text_r2_key).toBeNull();

    const children = await database
      .prepare(
        "SELECT id, family_id, family_role, family_sequence, source_name, source_path, " +
          "record_custodian_id, processing_state FROM review_document WHERE family_id = ?1 " +
          "AND id <> ?1 ORDER BY family_sequence ASC",
      )
      .bind(message.reviewDocumentId)
      .all<{
        family_id: string;
        family_role: string;
        family_sequence: number;
        source_name: string;
        source_path: string;
        record_custodian_id: string;
        processing_state: string;
      }>();
    expect(children.results).toHaveLength(2);
    // Sorted by PATH, not by the order the decoder walked the central directory, so a re-processing
    // of the same archive numbers the same entry the same way.
    expect(children.results.map((row) => row.source_name)).toEqual([
      "PLTF000001.txt",
      "PLTF000002.txt",
    ]);
    expect(children.results.every((row) => row.family_role === "container-child")).toBe(true);
    expect(children.results.every((row) => row.family_id === message.reviewDocumentId)).toBe(true);
    // A child's records are the container's records: an entry taken out of one custodian's
    // production did not change hands on the way out.
    expect(children.results.every((row) => row.record_custodian_id === recordCustodianId)).toBe(
      true,
    );
    // The children are pending: their bytes are crossing the gate, and nothing reads them until it
    // has a verdict.
    expect(children.results.every((row) => row.processing_state === "pending")).toBe(true);

    const sidecar = await env.R2.get(
      reviewDocumentMetadataKey(reviewSetId, message.reviewDocumentId as ReviewDocumentId),
    );
    const parsed = (await sidecar?.json()) as {
      children: { path: string }[];
      notExpanded: unknown[];
    };
    expect(parsed.children.map((child) => child.path)).toEqual([
      "PLTF000001.txt",
      "PLTF000002.txt",
    ]);
    expect(parsed.notExpanded).toEqual([]);

    // The load's arithmetic grew by the children, and will not balance until they are read. That is
    // the point: a load is not complete while a document it produced is unaccounted for.
    const tally = await readLoadProcessingTally(database, loadId);
    expect(tally).toMatchObject({ loaded: 3, processed: 1, outstanding: 2 });
  });

  it("names what did not come out, without failing the entries that did", async () => {
    const { message } = await seedOneDocument({});
    await processOne(
      env,
      message,
      archivePortReturning({
        ok: true,
        expansion: {
          entries: [{ path: "readable.txt", bytes: base64("plain"), depth: 0 }],
          skipped: [
            { path: "sealed.docx", reason: "encrypted", depth: 0 },
            { path: "../escape.txt", reason: "pathTraversal", depth: 0 },
            { path: "huge.bin", reason: "entryOversize", depth: 0 },
          ],
          totalExpandedBytes: 5,
        },
      }),
    );

    const parent = await readReviewDocument(database, message.reviewDocumentId as ReviewDocumentId);
    // An encrypted entry is reported, never fatal to the archive: the other entries still load, and
    // the container still processed.
    expect(parent?.processing_state).toBe("processed");
    const exceptions = await database
      .prepare(
        "SELECT code, detail FROM review_document_exception WHERE review_document_id = ?1 " +
          "ORDER BY code ASC",
      )
      .bind(message.reviewDocumentId)
      .all<{ code: string; detail: string }>();
    expect(exceptions.results.map((row) => row.code)).toEqual([
      "container-guard-tripped",
      "encrypted-container-entry",
    ]);
    // A count and a kind, and never a path: the entry names live in the sidecar, which is a record
    // rather than an error message.
    expect(exceptions.results[1]?.detail).toContain("1 entries");
    expect(exceptions.results.some((row) => row.detail.includes("sealed.docx"))).toBe(false);

    const sidecar = await env.R2.get(
      reviewDocumentMetadataKey(reviewSetId, message.reviewDocumentId as ReviewDocumentId),
    );
    const parsed = (await sidecar?.json()) as { notExpanded: { path: string; reason: string }[] };
    expect(parsed.notExpanded.map((entry) => entry.reason).toSorted()).toEqual([
      "encrypted",
      "entryOversize",
      "pathTraversal",
    ]);
  });

  it("records an archive the engine refused whole rather than opening it anyway", async () => {
    const { message } = await seedOneDocument({});
    await processOne(
      env,
      message,
      archivePortReturning({ ok: false, kind: "refused", code: "containerGuardTripped" }),
    );
    const row = await readReviewDocument(database, message.reviewDocumentId as ReviewDocumentId);
    expect(row?.processing_state).toBe("excepted");
    expect(row?.format_identified).toBe("zipArchive");
    const exceptions = await database
      .prepare("SELECT code FROM review_document_exception WHERE review_document_id = ?1")
      .bind(message.reviewDocumentId)
      .all<{ code: string }>();
    expect(exceptions.results[0]?.code).toBe("container-guard-tripped");
  });

  it("does not open a container that came out of a container", async () => {
    // The engine already recursed to its own nesting ceiling and returned the tree flattened, so a
    // child that is itself a container is one the engine declined to open. Re-expanding it here
    // would walk straight past the guard that stopped it.
    const { message } = await seedOneDocument({});
    await database
      .prepare("UPDATE review_document SET family_role = 'container-child' WHERE id = ?1")
      .bind(message.reviewDocumentId)
      .run();
    await processOne(
      env,
      message,
      archivePortReturning({
        ok: true,
        expansion: { entries: [], skipped: [], totalExpandedBytes: 0 },
      }),
    );
    const row = await readReviewDocument(database, message.reviewDocumentId as ReviewDocumentId);
    expect(row?.processing_state).toBe("excepted");
    const exceptions = await database
      .prepare("SELECT code FROM review_document_exception WHERE review_document_id = ?1")
      .bind(message.reviewDocumentId)
      .all<{ code: string }>();
    expect(exceptions.results[0]?.code).toBe("container-not-expanded");
  });
});

describe("the record artifacts a firm hands to another party", () => {
  it("writes both forms of both artifacts, and completes the load only once they exist", async () => {
    const { message, loadId } = await seedOneDocument({});
    await processOne(
      env,
      message,
      portReturning(
        unextractable("the document is locked with a user password", "passwordProtected"),
      ),
    );

    const completion = {
      kind: "load-completion" as const,
      firmId,
      bucketName: BUCKET,
      matterId,
      reviewSetId,
      loadId,
    };
    const outcome = await writeLoadRecordArtifacts(env, completion, now);
    expect(outcome.outcome).toBe("written");

    const manifest = await env.R2.get(loadManifestKey(reviewSetId, loadId));
    const report = await env.R2.get(loadExceptionReportKey(reviewSetId, loadId));
    expect(manifest).not.toBeNull();
    expect(report).not.toBeNull();
    expect(await env.R2.get(loadManifestTextKey(reviewSetId, loadId))).not.toBeNull();
    expect(await env.R2.get(loadExceptionReportTextKey(reviewSetId, loadId))).not.toBeNull();

    const parsedReport = (await report?.json()) as {
      byCode: { code: string; documentCount: number }[];
      exceptions: { code: string; reviewDocumentId: string }[];
      reconciliation: { accountedFor: boolean };
    };
    // The CODE, not a word standing in for several of them: a password can be asked for and a key
    // cannot, so the remedy a firm acts on depends on the report keeping them apart.
    expect(parsedReport.byCode).toEqual([{ code: "password-protected", documentCount: 1 }]);
    expect(parsedReport.exceptions[0]?.code).toBe("password-protected");
    expect(parsedReport.reconciliation.accountedFor).toBe(true);

    const row = await database
      .prepare(
        "SELECT state, manifest_r2_key, exception_report_r2_key FROM discovery_load WHERE id = ?1",
      )
      .bind(loadId)
      .all<{ state: string; manifest_r2_key: string; exception_report_r2_key: string }>();
    expect(row.results[0]?.state).toBe("complete");
    expect(row.results[0]?.manifest_r2_key).toBe(loadManifestKey(reviewSetId, loadId));
    expect(row.results[0]?.exception_report_r2_key).toBe(
      loadExceptionReportKey(reviewSetId, loadId),
    );
  });

  it("refuses to write a record for a load that has not reconciled", async () => {
    // A report that does not reconcile is not a report. The load has one document and it is still
    // outstanding, so there is nothing honest to say about it yet.
    const { loadId } = await seedOneDocument({});
    const outcome = await writeLoadRecordArtifacts(
      env,
      { kind: "load-completion", firmId, bucketName: BUCKET, matterId, reviewSetId, loadId },
      now,
    );
    expect(outcome.outcome).toBe("not-yet");
    expect(await env.R2.get(loadManifestKey(reviewSetId, loadId))).toBeNull();
  });

  it("produces the same document when the same load is reported twice", async () => {
    // REPRODUCIBILITY IS THE PROPERTY. The generation reads the instant the corpus stopped moving
    // off the load row rather than taking a clock, so a rebuild years later states what was known
    // then rather than what is true when somebody happened to press the button.
    const { message, loadId } = await seedOneDocument({});
    await processOne(env, message, portReturning(READS_ONE_PAGE));
    const completion = {
      kind: "load-completion" as const,
      firmId,
      bucketName: BUCKET,
      matterId,
      reviewSetId,
      loadId,
    };
    await writeLoadRecordArtifacts(env, completion, now);
    const first = await (await env.R2.get(loadManifestKey(reviewSetId, loadId)))?.text();
    const firstReport = await (
      await env.R2.get(loadExceptionReportKey(reviewSetId, loadId))
    )?.text();

    // The completion is idempotent: the second delivery finds the load already complete and writes
    // nothing, so the artifact on the shelf is still the one the first run produced.
    const second = await writeLoadRecordArtifacts(env, completion, now);
    expect(second.outcome).toBe("not-yet");
    expect(await (await env.R2.get(loadManifestKey(reviewSetId, loadId)))?.text()).toBe(first);
    expect(await (await env.R2.get(loadExceptionReportKey(reviewSetId, loadId)))?.text()).toBe(
      firstReport,
    );

    const parsed = JSON.parse(first ?? "{}") as {
      knowledgeInstant: string;
      documents: { digests: { md5: string; sha1: string; legacyInterop: string[] } }[];
    };
    expect(parsed.knowledgeInstant).not.toBe("");
    // The legacy-interop digests reached the manifest from the engine's own pass over the bytes,
    // which is the only pass that would ever compute them.
    expect(parsed.documents[0]?.digests.md5).toBe("9e107d9d372bb6826bd81d3542a419d6");
    expect(parsed.documents[0]?.digests.legacyInterop).toEqual(["md5", "sha1"]);
  });
});

describe("an archive entry the firm's own policy refuses", () => {
  it("is named in the container's record rather than dead-lettering the archive", async () => {
    // The engine could have opened it; the firm has said it does not accept that kind of file. A
    // policy refusal is a fact about one entry, and throwing would retry the whole archive until it
    // dead-lettered — which would lose the entries that were perfectly acceptable.
    const { message } = await seedOneDocument({});
    await processOne(
      env,
      message,
      archivePortReturning({
        ok: true,
        expansion: {
          entries: [
            { path: "installer.exe", bytes: base64("MZ not really"), depth: 0 },
            { path: "letter.txt", bytes: base64("dear sir"), depth: 0 },
          ],
          skipped: [],
          totalExpandedBytes: 21,
        },
      }),
    );

    const parent = await readReviewDocument(database, message.reviewDocumentId as ReviewDocumentId);
    expect(parent?.processing_state).toBe("processed");
    const sidecar = await env.R2.get(
      reviewDocumentMetadataKey(reviewSetId, message.reviewDocumentId as ReviewDocumentId),
    );
    const parsed = (await sidecar?.json()) as {
      children: { path: string }[];
      notExpanded: { path: string; reason: string }[];
    };
    // The acceptable entry came out; the refused one is named rather than silently absent.
    expect(parsed.children.map((child) => child.path)).toEqual(["letter.txt"]);
    expect(parsed.notExpanded).toEqual([
      { path: "installer.exe", reason: "refusedByPolicy", depth: 0 },
    ]);
    const exceptions = await database
      .prepare("SELECT code, detail FROM review_document_exception WHERE review_document_id = ?1")
      .bind(message.reviewDocumentId)
      .all<{ code: string; detail: string }>();
    expect(exceptions.results[0]?.code).toBe("container-guard-tripped");
    expect(exceptions.results[0]?.detail).toContain("1 entries");
  });
});
