import { env, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  insertIndexSplitStatement,
  listLiveSplitsForCorpus,
  listStaleMembersForCorpus,
  markMembersStaleForDocumentStatement,
} from "@magna-carta/data-access/index-split-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FileId, FirmId, IndexSplitId, MatterId } from "@magna-carta/identifiers/types";
import { corpusOfMatter } from "@magna-carta/search/corpus";
import {
  compacted,
  searchEngineNotImplemented,
  type SearchIndexPort,
  type SplitQueryTarget,
} from "@magna-carta/search/port";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { searchCompactionQueue } from "../src/background/search/compaction-consumer.ts";
import type { SearchCompactionJob } from "../src/search/compaction-coordinator.ts";
import {
  searchCompactionJobName,
  type SearchCompactionMessage,
} from "../src/search/compaction-types.ts";
import { runSearchCompactionSweep } from "../src/background/search/compaction-sweep.ts";
import { runKeywordSearch } from "../src/search/keyword-search.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";

// The compaction pass over real Miniflare bindings (R2 + the coordinator DO + the firm's FirmDatabase
// DO). The engine port is injected, because the Tantivy Container cannot run under the test pool — so
// what is exercised here is everything the app Worker owns: the selection, the catalog swap, the
// ordering that makes an in-flight query correct, and the exclusion window a re-index opens.

let firmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  // A real control-plane firm row, not a minted identifier: the retirement sweep walks the reachable
  // active firms, so a firm the control plane does not know about is a firm the sweep cannot reach.
  firmId = (await seedFirm({ name: "Compaction Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
});

const SPLIT_BYTES = new TextEncoder().encode("not a real split, just bytes to delete");

function databaseFor() {
  return firmDatabaseFor(env.FIRM_DATABASE, firmId);
}

// Publish N per-document splits into the catalog and put an object behind each, exactly as the write
// pipeline leaves a corpus: one split per document version.
async function seedPerDocumentSplits(
  matterId: MatterId,
  count: number,
): Promise<{ splitId: IndexSplitId; documentId: FileId; objectKey: string }[]> {
  const database = databaseFor();
  const seeded: { splitId: IndexSplitId; documentId: FileId; objectKey: string }[] = [];
  const statements = [];
  for (let index = 0; index < count; index++) {
    const splitId = newIdentifier("indexSplit");
    const documentId = newIdentifier("file");
    const objectKey = `search/${matterId}/splits/${splitId}.split`;
    await env.R2.put(objectKey, SPLIT_BYTES);
    statements.push(
      insertIndexSplitStatement(database, {
        id: splitId,
        matterId,
        corpusKind: "matter",
        corpusId: matterId,
        documentId,
        version: 1,
        objectKey,
        documentCount: 3,
        sizeBytes: SPLIT_BYTES.byteLength,
        schemaGeneration: 1,
        // Distinct, ordered instants so the oldest-first selection is deterministic.
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      }),
    );
    seeded.push({ splitId, documentId, objectKey });
  }
  await database.batch(statements);
  return seeded;
}

// An engine that reports a successful merge at the key it was told to write, echoing back whichever
// exclusions its sources carried.
function mergingPort(): SearchIndexPort {
  return {
    index: () => Promise.reject(new Error("index not exercised here")),
    remove: () => Promise.reject(new Error("remove not exercised here")),
    query: () => Promise.resolve(searchEngineNotImplemented()),
    compact: (input) =>
      Promise.resolve(
        compacted({
          objectKey: input.objectKey,
          documentCount: input.sources.length * 3,
          sizeBytes: 512,
          schemaGeneration: 1,
          excludedDocumentIds: input.sources.flatMap((source) => [...source.excludeDocumentIds]),
        }),
      ),
  };
}

const deferredPort: SearchIndexPort = {
  index: () => Promise.resolve(searchEngineNotImplemented()),
  remove: () => Promise.resolve(searchEngineNotImplemented()),
  query: () => Promise.resolve(searchEngineNotImplemented()),
  compact: () => Promise.resolve(searchEngineNotImplemented()),
};

function makeBatch(message: SearchCompactionMessage) {
  const acks: string[] = [];
  const retries: string[] = [];
  const batch = {
    queue: "magna-carta-production-search-compaction",
    messages: [
      {
        id: "compaction-1",
        timestamp: new Date(),
        attempts: 1,
        body: message,
        ack: () => acks.push("compaction-1"),
        retry: () => retries.push("compaction-1"),
      },
    ],
  } as unknown as MessageBatch<SearchCompactionMessage>;
  return { batch, acks, retries };
}

function coordinatorFor(matterId: MatterId) {
  return env.SEARCH_COMPACTION_JOB.get(
    env.SEARCH_COMPACTION_JOB.idFromName(searchCompactionJobName(firmId, matterId)),
  );
}

// Prime the coordinator the way the trigger does, with the queue send stubbed out — the test drives the
// consumer directly rather than through a real queue delivery.
async function seedPass(message: SearchCompactionMessage) {
  const stub = coordinatorFor(message.matterId as MatterId);
  await runInDurableObject(stub, async (instance: SearchCompactionJob) => {
    const mutable = instance as unknown as { env: Record<string, unknown> };
    mutable.env = { ...mutable.env, SEARCH_COMPACTION: { send: async () => {} } };
    await instance.start(message);
  });
  return stub;
}

describe("the compaction pass", () => {
  it("swaps the catalog in one step: the merge becomes live and every source leaves together", async () => {
    const matterId = newIdentifier("matter");
    const seeded = await seedPerDocumentSplits(matterId, 4);
    const message: SearchCompactionMessage = { firmId, matterId };
    await seedPass(message);

    const { batch, acks, retries } = makeBatch(message);
    await searchCompactionQueue(batch, env, mergingPort());
    expect(acks).toEqual(["compaction-1"]);
    expect(retries).toEqual([]);

    const live = await listLiveSplitsForCorpus(databaseFor(), matterId);
    // Exactly one live split, and it is the merged one: a merged split claims no document of its own,
    // which is what keeps it outside the one-live-split-per-document-version unique index.
    expect(live).toHaveLength(1);
    expect(live[0]?.documentId).toBeNull();
    expect(live[0]?.version).toBeNull();
    expect(live[0]?.documentCount).toBe(12);

    // Nothing a query could resolve still names a source. There is no committed state in which the
    // corpus has lost the sources and not yet gained the merge, or holds both — the batch is atomic and
    // the merged row is inserted before the sources are superseded.
    const liveKeys = live.map((split) => split.objectKey);
    for (const source of seeded) {
      expect(liveKeys).not.toContain(source.objectKey);
    }
  });

  it("leaves every superseded source object in place, so an in-flight query cannot lose its bytes", async () => {
    // THE ORDERING GUARANTEE. A query resolves its split keys and then reads them, so a pass that
    // deleted a source it had just superseded could hand a live query a key to bytes that are gone.
    const matterId = newIdentifier("matter");
    const seeded = await seedPerDocumentSplits(matterId, 3);
    const message: SearchCompactionMessage = { firmId, matterId };
    await seedPass(message);

    await searchCompactionQueue(makeBatch(message).batch, env, mergingPort());

    for (const source of seeded) {
      expect(await env.R2.head(source.objectKey)).not.toBeNull();
    }
  });

  it("retires a superseded object only after the grace period has passed", async () => {
    const matterId = newIdentifier("matter");
    const seeded = await seedPerDocumentSplits(matterId, 3);
    const message: SearchCompactionMessage = { firmId, matterId };
    await seedPass(message);
    await searchCompactionQueue(makeBatch(message).batch, env, mergingPort());

    // A sweep running immediately must collect nothing: the sources were superseded seconds ago, and a
    // query that resolved them just before the swap may still be reading them.
    const tooSoon = await runSearchCompactionSweep(env, { gracePeriodMs: 60 * 60 * 1000 });
    expect(tooSoon.splitsRetired).toBe(0);
    for (const source of seeded) {
      expect(await env.R2.head(source.objectKey)).not.toBeNull();
    }

    // Past the grace period, the objects go and then their rows go — objects first, so a crash between
    // the two leaves a row pointing at nothing (which the next pass retires again) rather than bytes no
    // row names.
    const later = await runSearchCompactionSweep(env, { gracePeriodMs: 0 });
    expect(later.splitsRetired).toBeGreaterThanOrEqual(seeded.length);
    for (const source of seeded) {
      expect(await env.R2.head(source.objectKey)).toBeNull();
    }
  });

  it("parks rather than fails when the engine is not deployed, and supersedes nothing", async () => {
    const matterId = newIdentifier("matter");
    await seedPerDocumentSplits(matterId, 3);
    const message: SearchCompactionMessage = { firmId, matterId };
    const stub = await seedPass(message);

    const { batch, acks, retries } = makeBatch(message);
    await searchCompactionQueue(batch, env, deferredPort);
    // Acked, not retried: retrying against an engine that does not exist would burn the message's
    // attempts and dead-letter housekeeping the platform still owes.
    expect(acks).toEqual(["compaction-1"]);
    expect(retries).toEqual([]);
    expect((await stub.status()).status).toBe("deferred");

    // The corpus is untouched — a pass that could not merge must not have superseded anything.
    expect(await listLiveSplitsForCorpus(databaseFor(), matterId)).toHaveLength(3);
  });

  it("does nothing to a corpus with one live split and nothing superseded inside it", async () => {
    const matterId = newIdentifier("matter");
    await seedPerDocumentSplits(matterId, 1);
    const message: SearchCompactionMessage = { firmId, matterId };
    const stub = await seedPass(message);

    await searchCompactionQueue(makeBatch(message).batch, env, mergingPort());
    expect((await stub.status()).status).toBe("skipped");
    expect(await listLiveSplitsForCorpus(databaseFor(), matterId)).toHaveLength(1);
  });
});

describe("the exclusion window a re-index opens", () => {
  it("stops a superseded version matching before any compaction repacks it out", async () => {
    // The window this whole mechanism exists for. A document is compacted into a merged split; the
    // document is then re-indexed. The merged split still holds the OLD passages and is still live, so
    // without an exclusion a query would return the document twice — once as it is and once as it was.
    const matterId = newIdentifier("matter");
    const seeded = await seedPerDocumentSplits(matterId, 3);
    const message: SearchCompactionMessage = { firmId, matterId };
    await seedPass(message);
    await searchCompactionQueue(makeBatch(message).batch, env, mergingPort());

    const database = databaseFor();
    const reindexed = seeded[0]!;

    // Before the re-index the merged split carries no exclusions at all — the ordinary case, and the one
    // a query must not pay for.
    expect(await listStaleMembersForCorpus(database, matterId)).toEqual([]);

    // The re-index: the write pipeline marks the document's membership stale in the same batch that
    // publishes the replacement split.
    const replacementSplitId = newIdentifier("indexSplit");
    const replacementKey = `search/${matterId}/splits/${replacementSplitId}.split`;
    await env.R2.put(replacementKey, SPLIT_BYTES);
    await database.batch([
      markMembersStaleForDocumentStatement(
        database,
        reindexed.documentId,
        new Date().toISOString(),
      ),
      insertIndexSplitStatement(database, {
        id: replacementSplitId,
        matterId,
        corpusKind: "matter",
        corpusId: matterId,
        documentId: reindexed.documentId,
        version: 2,
        objectKey: replacementKey,
        documentCount: 3,
        sizeBytes: SPLIT_BYTES.byteLength,
        schemaGeneration: 1,
        createdAt: new Date().toISOString(),
      }),
    ]);

    let capturedSplits: readonly SplitQueryTarget[] = [];
    const capturingPort: SearchIndexPort = {
      ...mergingPort(),
      query: (input) => {
        capturedSplits = input.splits;
        return Promise.resolve({ ok: true as const, hits: [] });
      },
    };

    await runKeywordSearch(
      env,
      { firmId, corpus: corpusOfMatter(matterId), text: "indemnify", limit: 10 },
      capturingPort,
    );

    // Two live splits: the merged one and the replacement. The merged one excludes the re-indexed
    // document; the replacement does not, because that is where the document's CURRENT text lives.
    expect(capturedSplits).toHaveLength(2);
    const replacement = capturedSplits.find((split) => split.objectKey === replacementKey);
    const merged = capturedSplits.find((split) => split.objectKey !== replacementKey);
    expect(replacement?.excludeDocumentIds).toEqual([]);
    expect(merged?.excludeDocumentIds).toEqual([reindexed.documentId]);
  });

  it("drops the superseded version from the bytes when the split is next compacted", async () => {
    const matterId = newIdentifier("matter");
    const seeded = await seedPerDocumentSplits(matterId, 3);
    const first: SearchCompactionMessage = { firmId, matterId };
    await seedPass(first);
    await searchCompactionQueue(makeBatch(first).batch, env, mergingPort());

    const database = databaseFor();
    const reindexed = seeded[0]!;
    const replacementSplitId = newIdentifier("indexSplit");
    const replacementKey = `search/${matterId}/splits/${replacementSplitId}.split`;
    await env.R2.put(replacementKey, SPLIT_BYTES);
    await database.batch([
      markMembersStaleForDocumentStatement(
        database,
        reindexed.documentId,
        new Date().toISOString(),
      ),
      insertIndexSplitStatement(database, {
        id: replacementSplitId,
        matterId,
        corpusKind: "matter",
        corpusId: matterId,
        documentId: reindexed.documentId,
        version: 2,
        objectKey: replacementKey,
        documentCount: 3,
        sizeBytes: SPLIT_BYTES.byteLength,
        schemaGeneration: 1,
        createdAt: new Date().toISOString(),
      }),
    ]);

    let sawExclusion = false;
    const observingPort: SearchIndexPort = {
      ...mergingPort(),
      compact: (input) => {
        // The exclusion reaches the MERGE, per source. That is what makes the superseded postings leave
        // the published bytes rather than being filtered on every future query forever.
        sawExclusion = input.sources.some((source) =>
          source.excludeDocumentIds.includes(reindexed.documentId),
        );
        return Promise.resolve(
          compacted({
            objectKey: input.objectKey,
            documentCount: 6,
            sizeBytes: 512,
            schemaGeneration: 1,
            excludedDocumentIds: [reindexed.documentId],
          }),
        );
      },
    };

    const second: SearchCompactionMessage = { firmId, matterId };
    await seedPass(second);
    await searchCompactionQueue(makeBatch(second).batch, env, observingPort);

    expect(sawExclusion).toBe(true);
    // Nothing is stale any more: the merge dropped the old version, so the new merged split's membership
    // carries only what survived.
    expect(await listStaleMembersForCorpus(database, matterId)).toEqual([]);
    const live = await listLiveSplitsForCorpus(database, matterId);
    expect(live).toHaveLength(1);
    expect(live[0]?.documentCount).toBe(6);
  });
});

describe("the compaction coordinator", () => {
  it("single-flights per corpus, so a burst of triggers produces one pass", async () => {
    // Two concurrent passes over one corpus would each merge overlapping splits and leave every document
    // in the overlap live in two merged splits at once. Keying the coordinator by corpus is what makes
    // that unrepresentable.
    const matterId = newIdentifier("matter");
    const message: SearchCompactionMessage = { firmId, matterId };
    const stub = coordinatorFor(matterId);

    const outcomes = await runInDurableObject(stub, async (instance: SearchCompactionJob) => {
      const mutable = instance as unknown as { env: Record<string, unknown> };
      mutable.env = { ...mutable.env, SEARCH_COMPACTION: { send: async () => {} } };
      return [
        await instance.start(message),
        await instance.start(message),
        await instance.start(message),
      ];
    });

    expect(outcomes.map((outcome) => outcome.started)).toEqual([true, false, false]);
  });
});
