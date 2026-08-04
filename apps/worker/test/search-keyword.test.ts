import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FileId, FirmId, IndexSplitId, MatterId } from "@magna-carta/identifiers/types";
import { insertIndexSplitStatement } from "@magna-carta/data-access/index-split-statements";
import { found, type SearchIndexPort } from "@magna-carta/search/port";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { runKeywordSearch } from "../src/search/keyword-search.ts";

const MATTER = "matter_test0000000000000000001" as MatterId;

let firmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Search Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
});

describe("runKeywordSearch", () => {
  it("resolves the matter's live split keys from the catalog and hands them to the engine", async () => {
    const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    await database.batch([
      insertIndexSplitStatement(database, {
        id: "indexSplit_test0000000000000000001" as IndexSplitId,
        matterId: MATTER,
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
        documentId: null,
        version: null,
        objectKey: "search/matter/splits/b.split",
        documentCount: 20,
        sizeBytes: 200,
        schemaGeneration: 1,
        createdAt: "2026-07-17T02:00:00.000Z",
      }),
    ]);

    let capturedSplitKeys: readonly string[] = [];
    const fakePort: SearchIndexPort = {
      index: () => Promise.reject(new Error("index not exercised here")),
      remove: () => Promise.reject(new Error("remove not exercised here")),
      query: (input) => {
        capturedSplitKeys = input.splitKeys;
        return Promise.resolve(
          found([
            { documentId: "file_test00000000000000000001" as FileId, chunkId: "c1", score: 1 },
          ]),
        );
      },
    };

    const result = await runKeywordSearch(
      env,
      { firmId, matterId: MATTER, text: "indemnify", limit: 10 },
      fakePort,
    );

    // The engine received exactly the matter's live split object keys — the catalog is what scopes the
    // query, and the engine range-reads only those.
    expect([...capturedSplitKeys].sort()).toEqual([
      "search/matter/splits/a.split",
      "search/matter/splits/b.split",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.hits[0]?.documentId).toBe("file_test00000000000000000001");
  });

  it("falls back to the deferred engine when no search service is bound", async () => {
    // The test pool binds no SEARCH_SERVICE, so resolveSearchIndexPort returns the deferred port: the
    // catalog still resolves, then the query reports the engine is not yet reachable rather than crashing.
    const result = await runKeywordSearch(env, {
      firmId,
      matterId: MATTER,
      text: "anything",
      limit: 10,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("engine-not-implemented");
  });
});
