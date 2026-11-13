import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import type { FileId, FirmId, MatterId } from "@magna-carta/identifiers/types";
import {
  found,
  searchAdapterError,
  searchEngineNotImplemented,
  type SearchIndexPort,
  type SearchQueryInput,
  type SearchQueryResult,
} from "@magna-carta/search/port";
import { searchIndexingEnabledDefinition } from "@magna-carta/search/settings";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";
import { fileContentsSearcherFor } from "../src/conflicts/file-contents-searcher.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";

// When a conflicts check is given a way to the words inside the firm's files, and when it is given
// none. None is what makes the check record Files as not searched. A searcher handed to a firm
// whose files are in no index would have every matter answer "nothing names this party", and the
// check would write that down as a search of the firm's files on a record nobody can amend.

const MATTER = "matter_test0000000000000000001" as MatterId;
const FIRST_FILE = "file_test00000000000000000001" as FileId;
const SECOND_FILE = "file_test00000000000000000002" as FileId;
const QUESTION = { matterId: MATTER, phrases: ['"Acme Holdings"'], limit: 25 };

let firmId: FirmId;

function portAnswering(answer: SearchQueryResult): {
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
    "2026-11-13T00:00:00.000Z",
  ).run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (
    await seedFirm({ name: "Conflicts File Search Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
});

describe("the conflicts check's way to the words inside files", () => {
  it("is given none for a fresh firm, which has not turned file indexing on", async () => {
    // The search service is bound in the pool, as it is in the deployment. That alone must not be
    // enough: nothing of this firm's is indexed.
    expect(env.SEARCH_SERVICE).toBeDefined();
    expect(await fileContentsSearcherFor(env, firmId)).toBeUndefined();
  });

  it("is given none while indexing is off, even where an engine would answer", async () => {
    await setIndexing(false);
    const { port, asked } = portAnswering(found([]));
    expect(await fileContentsSearcherFor(env, firmId, port)).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it("is given none on a deployment that binds no search service, whatever the firm chose", async () => {
    await setIndexing(true);
    expect(
      await fileContentsSearcherFor({ ...env, SEARCH_SERVICE: undefined }, firmId),
    ).toBeUndefined();
  });

  it("asks one matter's own corpus once the firm indexes its files", async () => {
    await setIndexing(true);
    const { port, asked } = portAnswering(
      found([
        { documentId: FIRST_FILE, chunkId: "page-2", score: 2 },
        { documentId: FIRST_FILE, chunkId: "page-5", score: 1 },
        { documentId: SECOND_FILE, chunkId: "page-0", score: 1 },
      ]),
    );
    const searcher = await fileContentsSearcherFor(env, firmId, port);
    expect(searcher).toBeDefined();

    expect(await searcher?.query(QUESTION)).toEqual({
      kind: "files",
      fileIds: [FIRST_FILE, SECOND_FILE],
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.corpus).toEqual({ kind: "matter", id: MATTER });
    expect(asked[0]?.firmId).toBe(firmId);
  });

  it("says the index failed for a matter when the engine faults, and unreachable when there is none", async () => {
    await setIndexing(true);
    const faulting = await fileContentsSearcherFor(
      env,
      firmId,
      portAnswering(searchAdapterError("search service 503")).port,
    );
    expect(await faulting?.query(QUESTION)).toEqual({ kind: "failed" });

    const absent = await fileContentsSearcherFor(
      env,
      firmId,
      portAnswering(searchEngineNotImplemented()).port,
    );
    expect(await absent?.query(QUESTION)).toEqual({ kind: "unreachable" });
  });
});
