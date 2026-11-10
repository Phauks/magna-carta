import { env, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { listSplitsForDocument } from "@magna-carta/data-access/index-split-statements";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import { readReviewSetIndexBacklog } from "@magna-carta/discovery/index-statements";
import { joinReviewDocumentText } from "@magna-carta/discovery/processing";
import { readReviewDocumentExceptions } from "@magna-carta/discovery/processing-statements";
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
import { corpusOfReviewSet } from "@magna-carta/search/corpus";
import { NATURAL_LANGUAGE_FEED_PREFIX } from "@magna-carta/search/natural-language-feed";
import {
  naturalLanguageSearchEnabledDefinition,
  readNaturalLanguageSearchEnabled,
} from "@magna-carta/search/natural-language-settings";
import { enumerateFeedObjects } from "@magna-carta/search/natural-language-statements";
import {
  indexed,
  searchEngineNotImplemented,
  type SearchIndexPort,
} from "@magna-carta/search/port";
import { splitIdentifierForReviewDocument, splitObjectKey } from "@magna-carta/search/split";
import { extractionEngineNotImplemented } from "@magna-carta/search/extraction";
import { searchIndexingEnabledDefinition } from "@magna-carta/search/settings";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { enqueueReviewDocumentForIndexing } from "../src/search/enqueue-index.ts";
import type { SearchIndexJob } from "../src/search/index-coordinator.ts";
import {
  searchIndexQueue,
  type SearchIndexPorts,
} from "../src/background/search/index-consumer.ts";
import { searchIndexJobName, type SearchIndexMessage } from "../src/search/index-types.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirmRow } from "./support/test-auth.ts";

// A review set entering its own corpus, with the index engine ABSENT — which is not a test posture, it
// is the deployed posture: no firm has a SEARCH_SERVICE binding. So the path that has to work today is
// the one that ends in a document parked and enumerable, and drains into the same derived split when
// the engine arrives.

const now = () => new Date().toISOString();

let firmId: FirmId;
let database: ReturnType<typeof firmDatabaseFor>;
let matterId: MatterId;
let reviewSetId: ReviewSetId;
let loadId: DiscoveryLoadId;
let recordCustodianId: RecordCustodianId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = newIdentifier("firm");
  await seedFirmRow(firmId, "Discovery Corpus Index Firm");
  database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  matterId = newIdentifier("matter");
  reviewSetId = newIdentifier("reviewSet");
  loadId = newIdentifier("discoveryLoad");
  recordCustodianId = newIdentifier("recordCustodian");
  const at = now();
  const member = newIdentifier("user");
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'A. Reviewer', 'active', ?2)",
    )
    .bind(member, at)
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) " +
        "VALUES (?1, 'Whitfield v. Arden', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, member, at)
    .run();
  await database
    .prepare(
      "INSERT INTO review_set (id, matter_id, name, state, document_ceiling, created_by, created_at, updated_at) " +
        "VALUES (?1, ?2, 'Plaintiff production', 'open', 250000, ?3, ?4, ?4)",
    )
    .bind(reviewSetId, matterId, member, at)
    .run();
  await database
    .prepare(
      "INSERT INTO record_custodian (id, review_set_id, display_name, kind, created_at, updated_at) " +
        "VALUES (?1, ?2, 'A. Whitfield', 'person', ?3, ?3)",
    )
    .bind(recordCustodianId, reviewSetId, at)
    .run();
  await database
    .prepare(
      "INSERT INTO discovery_load (id, review_set_id, lane, state, transcript_scope, " +
        "declared_document_count, loaded_document_count, initiated_by, initiated_at, created_at, updated_at) " +
        "VALUES (?1, ?2, 'received-production', 'processing', 'exclude', 0, 0, ?3, ?4, ?4, ?4)",
    )
    .bind(loadId, reviewSetId, member, at)
    .run();
  // The firm-level gate. A firm that has not turned indexing on produces no message at all, which the
  // enqueue's own suite already pins; here it is on so the corpus lane can be exercised.
  await database.batch([
    writeFirmSettingStatement(database, searchIndexingEnabledDefinition, true, at),
  ]);
});

// A processed review document with both of its derived objects in the bucket — the state the index
// enqueue is triggered from.
async function seedProcessedDocument(
  options: {
    readonly isPrimary?: boolean;
    readonly processingState?: string;
    readonly writeObjects?: boolean;
    readonly pages?: readonly string[];
  } = {},
): Promise<ReviewDocumentId> {
  const reviewDocumentId = newIdentifier("reviewDocument") as ReviewDocumentId;
  const fileId = newIdentifier("file");
  const fileVersionId = newIdentifier("fileVersion");
  const at = now();
  const pages = options.pages ?? ["the seller shall indemnify the buyer"];
  const textKey = reviewDocumentTextKey(reviewSetId, reviewDocumentId);
  const metadataKey = reviewDocumentMetadataKey(reviewSetId, reviewDocumentId);
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
    .bind(fileVersionId, fileId, `files/${fileVersionId}`, at)
    .run();
  await database
    .prepare(
      "INSERT INTO review_document (id, review_set_id, discovery_load_id, record_custodian_id, " +
        "source_kind, file_version_id, family_id, family_role, processing_state, is_dedup_primary, " +
        "text_r2_key, metadata_r2_key, format_identified, extraction_route, created_at, updated_at) " +
        "VALUES (?1, ?2, ?3, ?4, 'file_version', ?5, ?1, 'standalone', ?6, ?7, ?8, ?9, 'pdf', 'discovery-engine', ?10, ?10)",
    )
    .bind(
      reviewDocumentId,
      reviewSetId,
      loadId,
      recordCustodianId,
      fileVersionId,
      options.processingState ?? "processed",
      options.isPrimary === false ? 0 : 1,
      textKey,
      metadataKey,
      at,
    )
    .run();

  if (options.writeObjects !== false) {
    await env.R2.put(textKey, joinReviewDocumentText([...pages]));
    await env.R2.put(
      metadataKey,
      JSON.stringify({
        reviewDocumentId,
        reviewSetId,
        discoveryLoadId: loadId,
        formatIdentified: "pdf",
        pageCount: pages.length,
        documentDate: null,
        documentDateSource: null,
        extractionRoute: ["discovery-engine"],
        pages: pages.map((_, pageIndex) => ({ pageIndex, provenance: "native", hasText: true })),
        textFingerprint: null,
        extractedAt: at,
      }),
    );
  }
  return reviewDocumentId;
}

function makeBatch(message: SearchIndexMessage) {
  const acks: string[] = [];
  const retries: string[] = [];
  const batch = {
    queue: "magna-carta-production-search-index",
    messages: [
      {
        id: "msg-1",
        timestamp: new Date(),
        attempts: 1,
        body: message,
        ack: () => acks.push("msg-1"),
        retry: () => retries.push("msg-1"),
      },
    ],
  } as unknown as MessageBatch<SearchIndexMessage>;
  return { batch, acks, retries };
}

function stubFor(message: SearchIndexMessage) {
  return env.SEARCH_INDEX_JOB.get(
    env.SEARCH_INDEX_JOB.idFromName(
      searchIndexJobName(message.firmId, message.documentId, message.version),
    ),
  );
}

// The enqueue runs against a real coordinator whose queue send is stubbed, so the test drives the
// consumer directly rather than through a real delivery — the same shape the version-keyed suite uses.
async function enqueueWithoutSending(
  reviewDocumentId: ReviewDocumentId,
): Promise<SearchIndexMessage | undefined> {
  const stub = env.SEARCH_INDEX_JOB.get(
    env.SEARCH_INDEX_JOB.idFromName(searchIndexJobName(firmId, reviewDocumentId, 1)),
  );
  await runInDurableObject(stub, async (instance: SearchIndexJob) => {
    const mutable = instance as unknown as { env: Record<string, unknown> };
    mutable.env = { ...mutable.env, SEARCH_INDEX: { send: async () => {} } };
  });
  const outcome = await enqueueReviewDocumentForIndexing(env, firmId, reviewDocumentId, database);
  return outcome?.message;
}

const deferredIndexPort: SearchIndexPort = {
  index: async () => searchEngineNotImplemented(),
  remove: async () => searchEngineNotImplemented(),
  query: async () => searchEngineNotImplemented(),
  compact: async () => searchEngineNotImplemented(),
};

function publishingIndexPort(seen: { passages?: readonly unknown[] } = {}): SearchIndexPort {
  return {
    index: async (input) => {
      seen.passages = input.passages;
      return indexed({
        objectKey: input.objectKey,
        documentCount: input.passages.length,
        sizeBytes: 512,
        schemaGeneration: 1,
      });
    },
    remove: async () => ({ ok: true }),
    query: async () => searchEngineNotImplemented(),
    compact: async () => searchEngineNotImplemented(),
  };
}

// The extraction port must never be reached on this lane. A review document's text was already
// extracted and certified; a second parse would give the corpus a second answer about what the
// document says, so the port handed to the consumer here throws if anything calls it.
function extractionPortThatMustNotBeCalled(): SearchIndexPorts["extraction"] {
  return {
    extract: async () => {
      throw new Error("the review-document lane re-extracted a document it had already read");
    },
  };
}

function ports(index: SearchIndexPort): SearchIndexPorts {
  return { extraction: extractionPortThatMustNotBeCalled(), index };
}

describe("enqueueReviewDocumentForIndexing", () => {
  it("names the review set's corpus, the already-extracted text, and its sidecar", async () => {
    const reviewDocumentId = await seedProcessedDocument();
    const message = await enqueueWithoutSending(reviewDocumentId);
    expect(message).toBeDefined();
    expect(message?.corpusKind).toBe("reviewSet");
    expect(message?.corpusId).toBe(reviewSetId);
    // The matter rides along as provenance only. If it were the corpus, this document would be in the
    // matter's own search.
    expect(message?.matterId).toBe(matterId);
    expect(message?.sourceKey).toBe(reviewDocumentTextKey(reviewSetId, reviewDocumentId));
    expect(message?.metadataKey).toBe(reviewDocumentMetadataKey(reviewSetId, reviewDocumentId));
    expect(message?.discoveryLoadId).toBe(loadId);
  });

  it("produces nothing at all for a firm that has not turned indexing on", async () => {
    const at = now();
    await database.batch([
      writeFirmSettingStatement(database, searchIndexingEnabledDefinition, false, at),
    ]);
    const reviewDocumentId = await seedProcessedDocument();
    expect(await enqueueWithoutSending(reviewDocumentId)).toBeUndefined();
    await database.batch([
      writeFirmSettingStatement(database, searchIndexingEnabledDefinition, true, at),
    ]);
  });

  it("does not enqueue a suppressed duplicate, so a group buys one split and not one per custodian", async () => {
    const duplicate = await seedProcessedDocument({ isPrimary: false });
    expect(await enqueueWithoutSending(duplicate)).toBeUndefined();
  });

  it("does not enqueue a document that has not been read yet", async () => {
    const pending = await seedProcessedDocument({ processingState: "pending" });
    expect(await enqueueWithoutSending(pending)).toBeUndefined();
  });
});

describe("the review-set corpus with the index engine absent", () => {
  it("parks the document, records the arrear on its own row, and files no exception", async () => {
    const reviewDocumentId = await seedProcessedDocument();
    const message = await enqueueWithoutSending(reviewDocumentId);
    expect(message).toBeDefined();
    if (message === undefined) return;
    const stub = stubFor(message);
    const { batch, acks, retries } = makeBatch(message);

    await searchIndexQueue(batch, env, ports(deferredIndexPort));

    // Acked, not retried: retrying against an engine that does not exist burns the message's attempts
    // and ends in a dead-letter, turning "not built yet" into "document lost".
    expect(acks).toEqual(["msg-1"]);
    expect(retries).toEqual([]);
    expect((await stub.status()).status).toBe("deferred");

    // THE PROPERTY THIS LANE EXISTS FOR: the arrear is on the corpus's own row, so a person can count
    // what the review set is owed without knowing which Durable Object to open.
    const backlog = await readReviewSetIndexBacklog(database, reviewSetId);
    expect(backlog.deferred).toBeGreaterThanOrEqual(1);

    // And it is NOT an exception. The exception report is what a firm hands to another party, and
    // every line in it is a sentence about a document that could not be READ. "Our own index has not
    // caught up" is not one, and a later deploy would silently change the number.
    expect(await readReviewDocumentExceptions(database, reviewDocumentId)).toEqual([]);

    // Nothing was catalogued: no row claiming a split that does not exist.
    expect(await listSplitsForDocument(database, reviewDocumentId)).toEqual([]);
  });

  it("drains into the derived split the corpus already named, without re-extracting", async () => {
    const reviewDocumentId = await seedProcessedDocument({
      pages: ["page one text", "page two text"],
    });
    const message = await enqueueWithoutSending(reviewDocumentId);
    if (message === undefined) throw new Error("the document was not enqueued");
    const stub = stubFor(message);

    await searchIndexQueue(makeBatch(message).batch, env, ports(deferredIndexPort));
    expect((await stub.status()).status).toBe("deferred");

    // The replay after a deploy. The extraction port would throw if it were reached, so a pass is
    // also proof that the corpus's own text is what got indexed.
    await runInDurableObject(stub, async (instance: SearchIndexJob) => {
      const mutable = instance as unknown as { env: Record<string, unknown> };
      mutable.env = { ...mutable.env, SEARCH_INDEX: { send: async () => {} } };
      await instance.start(message);
    });
    const seen: { passages?: readonly unknown[] } = {};
    await searchIndexQueue(makeBatch(message).batch, env, ports(publishingIndexPort(seen)));

    const state = await stub.status();
    expect(state.status).toBe("indexed");

    // The split is at the key DERIVED from the review document, under the review set's own prefix —
    // which is what makes the replay converge rather than publish a second object.
    const expectedKey = splitObjectKey(
      corpusOfReviewSet(reviewSetId),
      await splitIdentifierForReviewDocument(reviewDocumentId),
    );
    expect(state.objectKey).toBe(expectedKey);
    expect(expectedKey.startsWith(`search/${reviewSetId}/`)).toBe(true);

    const rows = await listSplitsForDocument(database, reviewDocumentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.corpusKind).toBe("reviewSet");
    expect(rows[0]?.corpusId).toBe(reviewSetId);
    // Provenance is still recorded; it is simply not the scope.
    expect(rows[0]?.matterId).toBe(matterId);

    // Both pages reached the engine, on their own page numbers.
    expect(seen.passages).toEqual([
      { chunkId: "page-0", text: "page one text", page: 1 },
      { chunkId: "page-1", text: "page two text", page: 2 },
    ]);

    const backlog = await readReviewSetIndexBacklog(database, reviewSetId);
    expect(backlog.indexed).toBeGreaterThanOrEqual(1);
  });

  it("files source-bytes-missing when the corpus's own derived text is gone", async () => {
    const reviewDocumentId = await seedProcessedDocument({ writeObjects: false });
    const message = await enqueueWithoutSending(reviewDocumentId);
    if (message === undefined) throw new Error("the document was not enqueued");
    const { batch, acks } = makeBatch(message);

    await searchIndexQueue(batch, env, ports(deferredIndexPort));
    expect(acks).toEqual(["msg-1"]);

    // Unlike a deferral, this IS a fact about the document, and it has a true sentence already in the
    // closed vocabulary — so it is filed where a firm accounting for its corpus will find it.
    const exceptions = await readReviewDocumentExceptions(database, reviewDocumentId);
    expect(exceptions.map((exception) => exception.code)).toEqual(["source-bytes-missing"]);
    expect(exceptions[0]?.stage).toBe("index");
  });
});

describe("the extraction engine is never asked about a review document", () => {
  it("indexes from the stored text even when the extraction port reports no engine", async () => {
    // The extraction port here does not throw — it reports the deferral a real undeployed engine
    // would. A lane that consulted it would park the document; the lane must not consult it at all.
    const reviewDocumentId = await seedProcessedDocument({ pages: ["contract terms"] });
    const message = await enqueueWithoutSending(reviewDocumentId);
    if (message === undefined) throw new Error("the document was not enqueued");
    await searchIndexQueue(makeBatch(message).batch, env, {
      extraction: { extract: async () => extractionEngineNotImplemented() },
      index: publishingIndexPort(),
    });
    expect((await stubFor(message).status()).status).toBe("indexed");
  });
});

describe("the natural-language corpus never learns a review set exists", () => {
  it("writes no feed object and no feed row for an indexed review document, with the firm gate OPEN", async () => {
    // The wall this pins is the one whose failure cannot be taken back. The natural-language feed is
    // the corpus an AI surface answers from, and its audience is the matter team; a review set is
    // material another party produced, often under a protective order that names a narrower list of
    // people than the matter does. A review document that reached the feed would be reachable by
    // asking a question, and — the feed being how the retrieval corpus is built — would have left the
    // platform on its way there.
    //
    // The consumer gates the feed on `corpus.kind === "matter"`, which is the safe direction: a third
    // corpus kind added later does not feed by default, it has to be added on purpose. Nothing
    // asserted it, so the whole wall rested on one comparison nobody would notice being widened to a
    // negation.
    // Through the setting's own definition rather than raw SQL against the table. The two are
    // equivalent today, and equivalent-today is exactly how a test quietly stops testing: the
    // definition is the one home for this key's name and its JSON encoding, so a test that spells
    // either out by hand goes on passing after the encoding moves while the gate it thinks it opened
    // is shut.
    const at = now();
    await database.batch([
      writeFirmSettingStatement(database, naturalLanguageSearchEnabledDefinition, true, at),
    ]);

    // WITHOUT THIS ASSERTION THE TEST IS VACUOUS. A firm that has not opted in writes no feed object
    // for any corpus, so an empty feed would prove nothing about review sets — it would prove the
    // firm gate works, which another suite already pins. The gate is open; what follows is the wall.
    expect(await readNaturalLanguageSearchEnabled(database)).toBe(true);

    const reviewDocumentId = await seedProcessedDocument({ pages: ["privileged strategy memo"] });
    const message = await enqueueWithoutSending(reviewDocumentId);
    if (message === undefined) throw new Error("the document was not enqueued");

    // Indexed for real, not deferred — a parked document writes nothing anywhere, which would be a
    // second way for this to pass without the wall existing.
    await searchIndexQueue(makeBatch(message).batch, env, ports(publishingIndexPort()));
    expect((await stubFor(message).status()).status).toBe("indexed");

    // No catalog row in the feed, and no object under its prefix.
    expect(await enumerateFeedObjects(database, { kind: "firm" }, 100)).toEqual([]);
    const listed = await env.R2.list({ prefix: NATURAL_LANGUAGE_FEED_PREFIX });
    expect(listed.objects.map((object) => object.key)).toEqual([]);

    // Shut again, through the same definition: the gate is firm-wide and this file's other cases run
    // against the same database.
    await database.batch([
      writeFirmSettingStatement(database, naturalLanguageSearchEnabledDefinition, false, now()),
    ]);
  });
});
