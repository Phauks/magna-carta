import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { insertIndexSplitStatement } from "@magna-carta/data-access/index-split-statements";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import type { FileId, FirmId, IndexSplitId, MatterId } from "@magna-carta/identifiers/types";
import {
  extractedTextObjectDimensions,
  extractedTextObjectKey,
} from "@magna-carta/search/extracted-text";
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
import { writeExtractedText } from "../src/search/extracted-text-store.ts";
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

// The sentence a result quotes. The text is the firm's own object, written by the index job; what is
// pinned here is every check between the index naming a passage and a reader seeing its words.
describe("the sentence a file result quotes", () => {
  const OTHER_MATTER = "matter_test0000000000000000002" as MatterId;
  const PASSAGES = [
    { chunkId: "page-0", text: "Recitals. This lease is made between the parties." },
    {
      chunkId: "page-1",
      text: "The tenant shall indemnify the landlord against every claim arising from the premises.",
    },
  ];
  const READER_TEXT = "INDEMNIFY landl";
  const QUOTE =
    "The tenant shall indemnify the landlord against every claim arising from the premises.";
  let seeded = 0;

  // A file on a matter with one clean version the index holds, and that version's kept text.
  async function seedQuotableFile(
    options: {
      matterId?: MatterId;
      status?: string;
      deleted?: boolean;
      keepText?: boolean;
      indexedVersion?: number;
    } = {},
  ): Promise<FileId> {
    seeded += 1;
    const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    const matterId = options.matterId ?? MATTER;
    const fileId = `file_quote${String(seeded).padStart(20, "0")}` as FileId;
    const versionId = `fileVersion_quote${String(seeded).padStart(20, "0")}`;
    await database
      .prepare(
        "INSERT OR IGNORE INTO member (user_id, display_name, status, created_at) VALUES ('user_quote', 'Q', 'active', '2026-01-01T00:00:00.000Z')",
      )
      .run();
    await database
      .prepare(
        "INSERT OR IGNORE INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'M', 'open', 'user_quote', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      )
      .bind(matterId)
      .run();
    await database
      .prepare(
        "INSERT INTO file (id, matter_id, folder_id, name, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'Lease.pdf', ?3, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      )
      .bind(fileId, matterId, options.deleted === true ? "2026-02-01T00:00:00.000Z" : null)
      .run();
    await database
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, status, uploaded_by, created_at, committed_at, storage_class, storage_encoding, artifact_role) VALUES (?1, ?2, 3, ?3, 10, 'application/pdf', 'application/pdf', ?4, 'user_quote', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'standard', 'full', 'original')",
      )
      .bind(versionId, fileId, `files/${fileId}/${versionId}`, options.status ?? "clean")
      .run();
    await insertIndexSplitStatement(database, {
      id: `indexSplit_quote${String(seeded).padStart(20, "0")}` as IndexSplitId,
      matterId,
      corpusKind: "matter",
      corpusId: matterId,
      documentId: fileId,
      version: options.indexedVersion ?? 3,
      objectKey: `search/quote/${seeded}`,
      documentCount: PASSAGES.length,
      sizeBytes: 1,
      schemaGeneration: 2,
      createdAt: "2026-01-01T00:00:00.000Z",
    }).run();
    if (options.keepText !== false) {
      await writeExtractedText(env.R2, { matterId, fileId, version: 3, passages: PASSAGES });
    }
    return fileId;
  }

  function quotesFor(
    files: readonly { fileId: FileId; chunkId: string }[],
    options: { logger?: Logger; matterId?: MatterId; readerText?: string } = {},
  ): Promise<ReadonlyMap<string, string>> {
    const searcher = matterFileContentsSearcherFor(
      env,
      firmId,
      options.logger === undefined ? {} : { logger: options.logger },
    );
    if (searcher.excerpts === undefined) throw new Error("the searcher does not quote");
    return searcher.excerpts({
      matterId: options.matterId ?? MATTER,
      readerText: options.readerText ?? READER_TEXT,
      files,
    });
  }

  it("quotes the passage the index named, from the version the index holds", async () => {
    const fileId = await seedQuotableFile();

    expect([...(await quotesFor([{ fileId, chunkId: "page-1" }]))]).toEqual([[fileId, QUOTE]]);
    // The object carries its class and its matter, like every object in a firm's bucket.
    const object = await env.R2.head(extractedTextObjectKey(fileId, 3));
    expect(object?.customMetadata).toEqual(extractedTextObjectDimensions(MATTER));
  });

  it("does not quote a passage the reader's words are not in", async () => {
    const fileId = await seedQuotableFile();

    expect((await quotesFor([{ fileId, chunkId: "page-0" }])).size).toBe(0);
    expect((await quotesFor([{ fileId, chunkId: "page-9" }])).size).toBe(0);
  });

  it("does not quote a deleted file, a file on another matter, or a version that is not clean", async () => {
    const deleted = await seedQuotableFile({ deleted: true });
    const elsewhere = await seedQuotableFile({ matterId: OTHER_MATTER });
    const withdrawn = await seedQuotableFile({ status: "quarantined" });
    const shown = await seedQuotableFile();

    const quotes = await quotesFor(
      [deleted, elsewhere, withdrawn, shown].map((fileId) => ({ fileId, chunkId: "page-1" })),
    );

    expect([...quotes.keys()]).toEqual([shown]);
    // The other matter's file is quoted on its own matter and nowhere else.
    expect(
      (await quotesFor([{ fileId: elsewhere, chunkId: "page-1" }], { matterId: OTHER_MATTER }))
        .size,
    ).toBe(1);
  });

  it("does not quote a version whose text was never kept, and that is not a fault", async () => {
    const logged: unknown[] = [];
    const logger: Logger = { log: (event) => void logged.push(event), count: () => undefined };
    const neverKept = await seedQuotableFile({ keepText: false });
    // The index holds a version other than the one whose text is there.
    const otherVersion = await seedQuotableFile({ indexedVersion: 2 });

    const quotes = await quotesFor(
      [neverKept, otherVersion].map((fileId) => ({ fileId, chunkId: "page-1" })),
      { logger },
    );

    expect(quotes.size).toBe(0);
    expect(logged).toEqual([]);
  });

  it("answers for the other files when one object is not kept text, and logs no word of either", async () => {
    const logged: unknown[] = [];
    const logger: Logger = { log: (event) => void logged.push(event), count: () => undefined };
    const broken = await seedQuotableFile({ keepText: false });
    await env.R2.put(extractedTextObjectKey(broken, 3), "the tenant shall indemnify the landlord", {
      customMetadata: extractedTextObjectDimensions(MATTER),
    });
    const whole = await seedQuotableFile();

    const quotes = await quotesFor(
      [broken, whole].map((fileId) => ({ fileId, chunkId: "page-1" })),
      { logger },
    );

    expect([...quotes]).toEqual([[whole, QUOTE]]);
    expect(logged).toHaveLength(1);
    const report = JSON.stringify(logged);
    expect(report).toContain("matterSearch.fileContents.excerpt");
    expect(report.toLowerCase()).not.toContain("indemnify");
    expect(report).not.toContain(broken);
  });

  it("answers with no quotes, and never throws, when the firm's storage cannot be reached", async () => {
    const logged: unknown[] = [];
    const logger: Logger = { log: (event) => void logged.push(event), count: () => undefined };
    const fileId = await seedQuotableFile();
    const failing = {
      ...env,
      R2: {
        get: () => Promise.reject(new Error(`could not read ${extractedTextObjectKey(fileId, 3)}`)),
      },
    } as unknown as typeof env;
    const searcher = matterFileContentsSearcherFor(failing, firmId, { logger });

    const quotes = await searcher.excerpts?.({
      matterId: MATTER,
      readerText: READER_TEXT,
      files: [{ fileId, chunkId: "page-1" }],
    });

    expect(quotes?.size).toBe(0);
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged)).not.toContain(fileId);
  });
});
