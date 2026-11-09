import { env, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { listSplitsForDocument } from "@magna-carta/data-access/index-split-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FileId, FirmId, MatterId } from "@magna-carta/identifiers/types";
import {
  extracted,
  extractionAdapterError,
  extractionEngineNotImplemented,
  unextractable,
  type TextExtractionPort,
} from "@magna-carta/search/extraction";
import {
  indexed,
  searchAdapterError,
  searchEngineNotImplemented,
  type SearchIndexPort,
} from "@magna-carta/search/port";
import { corpusOfMatter } from "@magna-carta/search/corpus";
import { splitIdentifierForDocumentVersion, splitObjectKey } from "@magna-carta/search/split";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import type { SearchIndexJob } from "../src/search/index-coordinator.ts";
import {
  searchIndexQueue,
  type SearchIndexPorts,
} from "../src/background/search/index-consumer.ts";
import { searchIndexJobName, type SearchIndexMessage } from "../src/search/index-types.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";

// The search-index queue consumer over real Miniflare bindings (R2 + the SearchIndexJob DO + the firm's
// FirmDatabase DO). The two engine ports are injected, because neither engine Container can run under
// the test pool — which is also the production posture this pipeline is built for, so the deferred path
// below is the real path today, not a test-only branch.

const MATTER = "matter_test0000000000000000001" as MatterId;
const SOURCE_BYTES = new TextEncoder().encode("%PDF-1.4 fake document bytes");

let firmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = newIdentifier("firm");
  // The consumer resolves the firm's bucket from the control-plane row before it reads a byte, so the
  // firm has to exist there — a queue message names a firm, not a bucket.
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, bucket_name, status, created_at) VALUES (?1, ?2, ?3, 'active', ?4)",
  )
    .bind(
      firmId,
      `Search Index Firm ${firmId}`,
      `magna-carta-test-${firmId}`,
      new Date().toISOString(),
    )
    .run();
});

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

// Prime the job's Durable Object the way the enqueue path does, with the queue send stubbed out (the
// test drives the consumer directly rather than through a real queue delivery).
async function seedJob(message: SearchIndexMessage) {
  const stub = stubFor(message);
  await runInDurableObject(stub, async (instance: SearchIndexJob) => {
    const mutable = instance as unknown as { env: Record<string, unknown> };
    mutable.env = { ...mutable.env, SEARCH_INDEX: { send: async () => {} } };
    await instance.start(message);
  });
  return stub;
}

async function messageFor(label: string, version: number): Promise<SearchIndexMessage> {
  const documentId = newIdentifier("file");
  const sourceKey = `matters/${MATTER}/${label}/v${version}`;
  await env.R2.put(sourceKey, SOURCE_BYTES);
  return {
    firmId,
    matterId: MATTER,
    documentId,
    version,
    sourceKey,
    contentType: "application/pdf",
    engineGeneration: "",
  };
}

const extractsTwoPages: TextExtractionPort = {
  extract: async () =>
    extracted([
      { chunkId: "page-0", text: "the seller shall indemnify the buyer", page: 1 },
      { chunkId: "page-1", text: "environmental liability remains", page: 2 },
    ]),
};

// A stand-in for the engine that reports a real publish at the key the caller named.
function publishingIndexPort(): SearchIndexPort {
  return {
    index: async (input) =>
      indexed({
        objectKey: input.objectKey,
        documentCount: input.passages.length,
        sizeBytes: 2048,
        schemaGeneration: 1,
      }),
    remove: async () => ({ ok: true }),
    query: async () => searchEngineNotImplemented(),
    compact: async () => searchEngineNotImplemented(),
  };
}

const deferredIndexPort: SearchIndexPort = {
  index: async () => searchEngineNotImplemented(),
  remove: async () => searchEngineNotImplemented(),
  query: async () => searchEngineNotImplemented(),
  compact: async () => searchEngineNotImplemented(),
};

function ports(
  extraction: TextExtractionPort,
  index: SearchIndexPort = publishingIndexPort(),
): SearchIndexPorts {
  return { extraction, index };
}

describe("searchIndexQueue — deferred engines park the job rather than failing it", () => {
  it("parks the job when the index engine is not deployed, and ACKS so the message is not burned", async () => {
    const message = await messageFor("deferred-index", 1);
    const stub = await seedJob(message);
    const { batch, acks, retries } = makeBatch(message);

    await searchIndexQueue(batch, env, ports(extractsTwoPages, deferredIndexPort));

    // Acked, not retried: retrying against an engine that is not built only burns the message's
    // attempts and ends in a dead-letter, turning "not built yet" into "document lost".
    expect(acks).toEqual(["msg-1"]);
    expect(retries).toEqual([]);

    const state = await stub.status();
    expect(state.status).toBe("deferred");
    expect(state.reason).toBe("search index engine not deployed");
    expect(state.objectKey).toBeNull();

    // Nothing was written: no catalog row claiming a split that does not exist.
    const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    expect(await listSplitsForDocument(database, message.documentId as FileId)).toEqual([]);
  });

  it("parks the job when the extraction engine is not deployed", async () => {
    const message = await messageFor("deferred-extract", 1);
    const stub = await seedJob(message);
    const { batch, acks, retries } = makeBatch(message);

    await searchIndexQueue(
      batch,
      env,
      ports({ extract: async () => extractionEngineNotImplemented() }),
    );

    expect(acks).toEqual(["msg-1"]);
    expect(retries).toEqual([]);
    const state = await stub.status();
    expect(state.status).toBe("deferred");
    expect(state.reason).toBe("text extraction engine not deployed");
  });

  it("a deferred job is re-startable, so deploying the engine drains the backlog", async () => {
    const message = await messageFor("drain", 1);
    const stub = await seedJob(message);
    await searchIndexQueue(
      makeBatch(message).batch,
      env,
      ports(extractsTwoPages, deferredIndexPort),
    );
    expect((await stub.status()).status).toBe("deferred");

    // The replay after a deploy: start() accepts a deferred job back onto the queue, and this time the
    // engine is there.
    await runInDurableObject(stub, async (instance: SearchIndexJob) => {
      const mutable = instance as unknown as { env: Record<string, unknown> };
      mutable.env = { ...mutable.env, SEARCH_INDEX: { send: async () => {} } };
      await instance.start(message);
    });
    await searchIndexQueue(makeBatch(message).batch, env, ports(extractsTwoPages));

    const state = await stub.status();
    expect(state.status).toBe("indexed");
    const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    const rows = await listSplitsForDocument(database, message.documentId as FileId);
    expect(rows).toHaveLength(1);
  });
});

describe("searchIndexQueue — publishing and convergence", () => {
  it("publishes one split at the derived key and catalogs it", async () => {
    const message = await messageFor("publish", 1);
    const stub = await seedJob(message);
    const { batch, acks } = makeBatch(message);

    await searchIndexQueue(batch, env, ports(extractsTwoPages));

    expect(acks).toEqual(["msg-1"]);
    const expectedKey = splitObjectKey(
      corpusOfMatter(MATTER),
      await splitIdentifierForDocumentVersion(message.documentId as FileId, 1),
    );
    expect((await stub.status()).objectKey).toBe(expectedKey);

    const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    const rows = await listSplitsForDocument(database, message.documentId as FileId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.objectKey).toBe(expectedKey);
    expect(rows[0]?.version).toBe(1);
    expect(rows[0]?.documentCount).toBe(2);
  });

  it("a retry of the same version converges — one row, not two", async () => {
    const message = await messageFor("retry", 1);
    await seedJob(message);
    const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);

    await searchIndexQueue(makeBatch(message).batch, env, ports(extractsTwoPages));
    await searchIndexQueue(makeBatch(message).batch, env, ports(extractsTwoPages));
    await searchIndexQueue(makeBatch(message).batch, env, ports(extractsTwoPages));

    const rows = await listSplitsForDocument(database, message.documentId as FileId);
    expect(rows).toHaveLength(1);
  });

  it("indexing a new version replaces the old version's split and deletes its R2 object", async () => {
    const first = await messageFor("reindex", 1);
    await seedJob(first);
    await searchIndexQueue(makeBatch(first).batch, env, ports(extractsTwoPages));
    const firstKey = splitObjectKey(
      corpusOfMatter(MATTER),
      await splitIdentifierForDocumentVersion(first.documentId as FileId, 1),
    );
    // The engine port under test reports a publish without writing bytes, so stand the object up here
    // to prove the consumer actually reaps the superseded one.
    await env.R2.put(firstKey, new TextEncoder().encode("first split bytes"));

    const second: SearchIndexMessage = { ...first, version: 2 };
    await seedJob(second);
    await searchIndexQueue(makeBatch(second).batch, env, ports(extractsTwoPages));

    const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    const rows = await listSplitsForDocument(database, first.documentId as FileId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe(2);
    // The superseded split's bytes are gone — a re-index does not leak orphaned objects into the
    // firm's bucket.
    expect(await env.R2.get(firstKey)).toBeNull();
  });
});

describe("searchIndexQueue — failures are recorded, never silently dropped", () => {
  it("retries a transient extraction fault so it can dead-letter rather than vanish", async () => {
    const message = await messageFor("transient", 1);
    const stub = await seedJob(message);
    const { batch, acks, retries } = makeBatch(message);

    await searchIndexQueue(
      batch,
      env,
      ports({ extract: async () => extractionAdapterError("container unreachable") }),
    );

    expect(retries).toEqual(["msg-1"]);
    expect(acks).toEqual([]);
    const state = await stub.status();
    expect(state.status).toBe("failed");
    expect(state.reason).toContain("container unreachable");
  });

  it("retries a transient index-engine fault", async () => {
    const message = await messageFor("transient-index", 1);
    await seedJob(message);
    const { batch, retries } = makeBatch(message);

    await searchIndexQueue(batch, env, {
      extraction: extractsTwoPages,
      index: {
        index: async () => searchAdapterError("engine 500"),
        remove: async () => searchEngineNotImplemented(),
        query: async () => searchEngineNotImplemented(),
        compact: async () => searchEngineNotImplemented(),
      },
    });

    expect(retries).toEqual(["msg-1"]);
  });

  it("is terminal for bytes nothing can read — acked, but recorded as failed", async () => {
    const message = await messageFor("unreadable", 1);
    const stub = await seedJob(message);
    const { batch, acks, retries } = makeBatch(message);

    await searchIndexQueue(
      batch,
      env,
      ports({ extract: async () => unextractable("the engine rejected the document") }),
    );

    // Acked because retrying cannot help, but the job carries the reason, so the document's absence
    // from the corpus is answerable rather than invisible.
    expect(acks).toEqual(["msg-1"]);
    expect(retries).toEqual([]);
    const state = await stub.status();
    expect(state.status).toBe("failed");
    expect(state.reason).toBe("the engine rejected the document");
  });

  it("is terminal when the source bytes are gone", async () => {
    const message = await messageFor("missing-source", 1);
    await env.R2.delete(message.sourceKey);
    const stub = await seedJob(message);
    const { batch, acks } = makeBatch(message);

    await searchIndexQueue(batch, env, ports(extractsTwoPages));

    expect(acks).toEqual(["msg-1"]);
    expect((await stub.status()).status).toBe("failed");
    expect((await stub.status()).reason).toBe("source bytes not found");
  });

  it("a stale failure never clobbers a completed publish", async () => {
    const message = await messageFor("terminal-win", 1);
    const stub = await seedJob(message);
    await searchIndexQueue(makeBatch(message).batch, env, ports(extractsTwoPages));
    expect((await stub.status()).status).toBe("indexed");

    await stub.markFailed("a zombie attempt reporting late");
    expect((await stub.status()).status).toBe("indexed");

    await stub.markDeferred("a zombie attempt reporting late");
    expect((await stub.status()).status).toBe("indexed");
  });
});
