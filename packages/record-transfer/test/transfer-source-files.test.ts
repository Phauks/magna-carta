import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { TransferRunId, TransferSourceFileId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  InvalidContentDigestError,
  InvalidSourceFileSlugError,
  UnreadableSourceFileFormatError,
  transferSourceFileObjectKey,
} from "../src/source-file.ts";
import { insertTransferRunStatement } from "../src/transfer-run-statements.ts";
import {
  insertTransferSourceFileStatement,
  recordTransferSourceFileReadStatement,
  recordTransferSourceFileRemovedStatement,
  selectTransferSourceFileStatement,
  selectTransferSourceFilesStatement,
  type NewTransferSourceFile,
  type TransferSourceFileRow,
} from "../src/transfer-source-file-statements.ts";

const STARTED = "2026-11-13T09:00:00.000Z";
const LATER = "2026-11-13T10:00:00.000Z";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

// The node:sqlite adapter surfaces a constraint failure as a synchronous throw from run(), so a
// rejects-matcher would never see it.
async function captureError(act: () => Promise<unknown>): Promise<unknown> {
  try {
    await act();
  } catch (caught) {
    return caught;
  }
  throw new Error("expected the statement to fail on a constraint");
}

async function freshRun(): Promise<{ database: BatchDatabase; runId: TransferRunId }> {
  const { database } = createMigratedNodeDatabase("per-firm");
  const operator = newIdentifier("user") as UserId;
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Operator', 'active', ?2)",
    )
    .bind(operator, STARTED)
    .run();
  const runId = await startRun(database, operator);
  return { database, runId };
}

async function startRun(database: BatchDatabase, operator: UserId): Promise<TransferRunId> {
  const id = newIdentifier("transferRun") as TransferRunId;
  await insertTransferRunStatement(
    database,
    { id, sourceSystem: "leap", label: "Rehearsal", startedBy: operator },
    STARTED,
  ).run();
  return id;
}

function matterList(
  runId: TransferRunId,
  overrides: Partial<NewTransferSourceFile> = {},
): NewTransferSourceFile {
  return {
    id: newIdentifier("transferSourceFile") as TransferSourceFileId,
    transferRunId: runId,
    sourceKind: "matter-list",
    format: "delimited-text",
    fileName: "Matter List.csv",
    byteLength: 2048,
    contentSha256: DIGEST_A,
    keyColumn: "Matter Number",
    ...overrides,
  };
}

async function readFile(
  database: BatchDatabase,
  id: TransferSourceFileId,
): Promise<TransferSourceFileRow | undefined> {
  const { results } = await selectTransferSourceFileStatement(
    database,
    id,
  ).all<TransferSourceFileRow>();
  return results[0];
}

describe("registering a source file", () => {
  it("is read back as written, unread and held", async () => {
    const { database, runId } = await freshRun();
    const file = matterList(runId);
    await insertTransferSourceFileStatement(database, file, STARTED).run();

    expect(await readFile(database, file.id)).toEqual({
      id: file.id,
      transfer_run_id: runId,
      source_kind: "matter-list",
      format: "delimited-text",
      file_name: "Matter List.csv",
      object_key: `transfers/${runId}/${file.id}`,
      byte_length: 2048,
      content_sha256: DIGEST_A,
      key_column: "Matter Number",
      row_count: null,
      registered_at: STARTED,
      read_at: null,
      removed_at: null,
    });
  });

  it("keeps the bytes under a key that holds nothing of the file's name", () => {
    const runId = "transferRun_r" as TransferRunId;
    const fileId = "transferSourceFile_f" as TransferSourceFileId;
    expect(transferSourceFileObjectKey(runId, fileId)).toBe(
      "transfers/transferRun_r/transferSourceFile_f",
    );
  });

  it("refuses the same bytes twice in one run and accepts them in another", async () => {
    const { database, runId } = await freshRun();
    await insertTransferSourceFileStatement(database, matterList(runId), STARTED).run();

    const error = await captureError(() =>
      insertTransferSourceFileStatement(
        database,
        matterList(runId, { fileName: "Matter List (1).csv" }),
        LATER,
      ).run(),
    );
    expect(String(error)).toMatch(/UNIQUE/i);

    const operator = newIdentifier("user") as UserId;
    await database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Second', 'active', ?2)",
      )
      .bind(operator, STARTED)
      .run();
    const secondRun = await startRun(database, operator);
    await insertTransferSourceFileStatement(database, matterList(secondRun), LATER).run();
    const { results } = await selectTransferSourceFilesStatement(
      database,
      secondRun,
    ).all<TransferSourceFileRow>();
    expect(results).toHaveLength(1);
  });

  it("refuses a kind or a format that is not a slug, and a format nothing reads", async () => {
    const { database, runId } = await freshRun();
    expect(() =>
      insertTransferSourceFileStatement(
        database,
        matterList(runId, { sourceKind: "Matter List" }),
        STARTED,
      ),
    ).toThrow(InvalidSourceFileSlugError);
    expect(() =>
      insertTransferSourceFileStatement(
        database,
        matterList(runId, { format: "spreadsheet" }),
        STARTED,
      ),
    ).toThrow(UnreadableSourceFileFormatError);
  });

  it("refuses a digest that is not lower-case SHA-256 hex", async () => {
    const { database, runId } = await freshRun();
    for (const contentSha256 of ["A".repeat(64), "a".repeat(63), "g".repeat(64)]) {
      expect(() =>
        insertTransferSourceFileStatement(database, matterList(runId, { contentSha256 }), STARTED),
      ).toThrow(InvalidContentDigestError);
    }
  });

  it("refuses a file for a run that does not exist", async () => {
    const { database } = await freshRun();
    const error = await captureError(() =>
      insertTransferSourceFileStatement(
        database,
        matterList("transferRun_missing" as TransferRunId),
        STARTED,
      ).run(),
    );
    expect(String(error)).toMatch(/FOREIGN KEY/i);
  });

  it("the table itself refuses what the builder refuses", async () => {
    const { database, runId } = await freshRun();
    const insert = (sourceKind: string, digest: string, byteLength: number): Promise<unknown> =>
      database
        .prepare(
          "INSERT INTO transfer_source_file (id, transfer_run_id, source_kind, format, file_name, object_key, byte_length, content_sha256, registered_at) VALUES (?1, ?2, ?3, 'delimited-text', 'x.csv', ?1, ?4, ?5, ?6)",
        )
        .bind(newIdentifier("transferSourceFile"), runId, sourceKind, byteLength, digest, STARTED)
        .run();
    expect(String(await captureError(() => insert("Matter List", DIGEST_A, 1)))).toMatch(/CHECK/i);
    expect(String(await captureError(() => insert("matter-list", "A".repeat(64), 1)))).toMatch(
      /CHECK/i,
    );
    expect(String(await captureError(() => insert("matter-list", DIGEST_A, -1)))).toMatch(/CHECK/i);
  });
});

describe("listing a run's files", () => {
  it("lists them in the order they were given", async () => {
    const { database, runId } = await freshRun();
    const first = matterList(runId);
    const second = matterList(runId, {
      sourceKind: "card-details",
      fileName: "Card Details.csv",
      contentSha256: DIGEST_B,
      keyColumn: null,
    });
    await insertTransferSourceFileStatement(database, second, LATER).run();
    await insertTransferSourceFileStatement(database, first, STARTED).run();

    const { results } = await selectTransferSourceFilesStatement(
      database,
      runId,
    ).all<TransferSourceFileRow>();
    expect(results.map((row) => row.id)).toEqual([first.id, second.id]);
    expect(results[1]?.key_column).toBeNull();
  });
});

describe("recording a read and a release", () => {
  it("records the first read's row count and keeps it against a second", async () => {
    const { database, runId } = await freshRun();
    const file = matterList(runId);
    await insertTransferSourceFileStatement(database, file, STARTED).run();

    const first = await recordTransferSourceFileReadStatement(database, file.id, 412, LATER).run();
    expect(first.meta.changes).toBe(1);
    const second = await recordTransferSourceFileReadStatement(database, file.id, 9, LATER).run();
    expect(second.meta.changes).toBe(0);

    const row = await readFile(database, file.id);
    expect(row?.row_count).toBe(412);
    expect(row?.read_at).toBe(LATER);
  });

  it("records a release once and keeps the row", async () => {
    const { database, runId } = await freshRun();
    const file = matterList(runId);
    await insertTransferSourceFileStatement(database, file, STARTED).run();

    const first = await recordTransferSourceFileRemovedStatement(database, file.id, LATER).run();
    expect(first.meta.changes).toBe(1);
    const second = await recordTransferSourceFileRemovedStatement(database, file.id, STARTED).run();
    expect(second.meta.changes).toBe(0);

    const row = await readFile(database, file.id);
    expect(row?.removed_at).toBe(LATER);
    expect(row?.content_sha256).toBe(DIGEST_A);
  });
});
