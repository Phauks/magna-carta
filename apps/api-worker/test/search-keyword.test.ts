import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FileId, FirmId, IndexSplitId, MatterId } from "@magna-carta/identifiers/types";
import { insertIndexSplitStatement } from "@magna-carta/data-access/index-split-statements";
import { corpusOfMatter } from "@magna-carta/search/corpus";
import { found, type SearchIndexPort, type SplitQueryTarget } from "@magna-carta/search/port";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { runKeywordSearch } from "../src/search/keyword-search.ts";

const MATTER = "matter_test0000000000000000001" as MatterId;
const CORPUS = corpusOfMatter(MATTER);

let firmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Search Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
});

describe("runKeywordSearch", () => {
  it("resolves the corpus's live split keys from the catalog and hands them to the engine", async () => {
    const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    await database.batch([
      insertIndexSplitStatement(database, {
        id: "indexSplit_test0000000000000000001" as IndexSplitId,
        matterId: MATTER,
        corpusKind: "matter",
        corpusId: MATTER,
        documentId: null,
        version: null,
        objectKey: "search/matter/splits/a.split",
        documentCount: 10,
        sizeBytes: 100,
        schemaGeneration: 1,
        createdAt: "2026-07-17T01:00:00.000Z",
      }),
      insertIndexSplitStatement(database, {
        id: "indexSplit_test0000000000000000002" as IndexSplitId,
        matterId: MATTER,
        corpusKind: "matter",
        corpusId: MATTER,
        documentId: null,
        version: null,
        objectKey: "search/matter/splits/b.split",
        documentCount: 20,
        sizeBytes: 200,
        schemaGeneration: 1,
        createdAt: "2026-07-17T02:00:00.000Z",
      }),
    ]);

    let capturedSplits: readonly SplitQueryTarget[] = [];
    const fakePort: SearchIndexPort = {
      index: () => Promise.reject(new Error("index not exercised here")),
      remove: () => Promise.reject(new Error("remove not exercised here")),
      compact: () => Promise.reject(new Error("compact not exercised here")),
      query: (input) => {
        capturedSplits = input.splits;
        return Promise.resolve(
          found([
            { documentId: "file_test00000000000000000001" as FileId, chunkId: "c1", score: 1 },
          ]),
        );
      },
    };

    const result = await runKeywordSearch(
      env,
      { firmId, corpus: CORPUS, text: "indemnify", limit: 10 },
      fakePort,
    );

    // The engine received exactly the corpus's live split object keys — the catalog is what scopes the
    // query, and the engine range-reads only those.
    expect(capturedSplits.map((split) => split.objectKey).sort()).toEqual([
      "search/matter/splits/a.split",
      "search/matter/splits/b.split",
    ]);
    // Nothing has been re-indexed, so neither split carries an exclusion. An empty list here is the
    // ordinary case and the one a query must not pay for.
    expect(capturedSplits.every((split) => split.excludeDocumentIds.length === 0)).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.hits[0]?.documentId).toBe("file_test00000000000000000001");
  });

  it("falls back to the deferred engine when no search service is bound", async () => {
    // A deployment without SEARCH_SERVICE resolves the deferred port: the catalog still resolves,
    // then the query reports the engine is not yet reachable rather than crashing.
    const result = await runKeywordSearch(
      { ...env, SEARCH_SERVICE: undefined },
      { firmId, corpus: CORPUS, text: "anything", limit: 10 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("engine-not-implemented");
  });

  it("reports an engine fault when the bound service has no engine behind it", async () => {
    // The test pool binds a search service that refuses every operation. A fault is what a caller
    // must read, so a consumer retries and a reader is told the index could not be asked.
    const result = await runKeywordSearch(env, {
      firmId,
      corpus: CORPUS,
      text: "anything",
      limit: 10,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("adapter-error");
  });
});
