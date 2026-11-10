import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import type { FileId, FirmId, MatterId } from "@magna-carta/identifiers/types";
import {
  found,
  searchAdapterError,
  type SearchIndexPort,
  type SearchQueryInput,
} from "@magna-carta/search/port";
import { searchIndexingEnabledDefinition } from "@magna-carta/search/settings";
import type { Logger } from "@magna-carta/telemetry/logger";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { matterFileContentsSearcherFor } from "../src/search/matter-file-contents.ts";

// How a matter's search reaches the index of the words inside its files. What is pinned here is the
// three answers that are not "no matches", and that the question reaches the engine for this
// matter's corpus and no other.

const MATTER = "matter_test0000000000000000001" as MatterId;
const QUESTION = { matterId: MATTER, queryText: '+"indemnify"', limit: 48 };

let firmId: FirmId;

function portAnswering(answer: ReturnType<typeof found> | ReturnType<typeof searchAdapterError>): {
  port: SearchIndexPort;
  asked: SearchQueryInput[];
} {
  const asked: SearchQueryInput[] = [];
  return {
    asked,
    port: {
      index: () => Promise.reject(new Error("index not exercised here")),
      remove: () => Promise.reject(new Error("remove not exercised here")),
      compact: () => Promise.reject(new Error("compact not exercised here")),
      query: (input) => {
        asked.push(input);
        return Promise.resolve(answer);
      },
    },
  };
}

async function setIndexing(enabled: boolean): Promise<void> {
  const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  await writeFirmSettingStatement(
    database,
    searchIndexingEnabledDefinition,
    enabled,
    "2026-11-10T00:00:00.000Z",
  ).run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "File Contents Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
});

describe("the matter search's way to the file contents index", () => {
  it("says the index is not connected while no search service is bound", async () => {
    // The test pool binds no search service, which is every deployment until the search worker is
    // deployed and bound.
    await setIndexing(true);
    const searcher = matterFileContentsSearcherFor(env, firmId);
    expect(await searcher.query(QUESTION)).toEqual({ kind: "not-connected" });
  });

  it("says the firm has not turned indexing on, without asking the index", async () => {
    await setIndexing(false);
    const { port, asked } = portAnswering(found([]));
    const searcher = matterFileContentsSearcherFor(env, firmId, { port });
    expect(await searcher.query(QUESTION)).toEqual({ kind: "off" });
    expect(asked).toEqual([]);
  });

  it("asks for this matter's corpus and answers with the file and passage of each match", async () => {
    await setIndexing(true);
    const { port, asked } = portAnswering(
      found([
        { documentId: "file_test00000000000000000001" as FileId, chunkId: "page-6", score: 3 },
        { documentId: "file_test00000000000000000002" as FileId, chunkId: "page-0", score: 1 },
      ]),
    );
    const searcher = matterFileContentsSearcherFor(env, firmId, { port });

    expect(await searcher.query(QUESTION)).toEqual({
      kind: "passages",
      passages: [
        { fileId: "file_test00000000000000000001", chunkId: "page-6" },
        { fileId: "file_test00000000000000000002", chunkId: "page-0" },
      ],
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.firmId).toBe(firmId);
    expect(asked[0]?.corpus).toEqual({ kind: "matter", id: MATTER });
    expect(asked[0]?.text).toBe('+"indemnify"');
    expect(asked[0]?.limit).toBe(48);
  });

  it("says the index could not be searched when it fails, and logs no word of the question", async () => {
    await setIndexing(true);
    const logged: unknown[] = [];
    const logger: Logger = { log: (event) => void logged.push(event), count: () => undefined };
    const { port } = portAnswering(
      searchAdapterError('could not parse the query +"indemnify" at position 3'),
    );
    const searcher = matterFileContentsSearcherFor(env, firmId, { port, logger });

    expect(await searcher.query(QUESTION)).toEqual({ kind: "unavailable" });
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged)).not.toContain("indemnify");
    expect(JSON.stringify(logged)).toContain("matterSearch.fileContents");
  });
});
