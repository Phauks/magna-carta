import { describe, expect, it } from "vitest";
import type { DownloadItemId } from "@magna-carta/identifiers/types";
import { freshFirmDatabase } from "./support/fresh-firm-database.ts";
import {
  deleteDownloadItemStatement,
  insertDownloadItemStatement,
  readDownloadItem,
  readDownloadShelf,
  readExpiredDownloadItems,
  recordDownloadedFormatStatement,
  setDownloadItemStateStatement,
  type DownloadItemInsert,
} from "../src/download-register-statements.ts";
import type { BatchDatabase } from "../src/effect-batch.ts";

const OWNER = "user_shelfOwner000000001";
const COLLEAGUE = "user_colleague000000001";

async function seedMembers(database: BatchDatabase): Promise<void> {
  await database.batch(
    [OWNER, COLLEAGUE].map((userId) =>
      database
        .prepare(
          `INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?1, ?2, 'active', 0, '2026-08-31T00:00:00.000Z')`,
        )
        .bind(userId, userId),
    ),
  );
}

function item(overrides: Partial<DownloadItemInsert> = {}): DownloadItemInsert {
  return {
    id: "downloadItem_test000000000000000001" as DownloadItemId,
    memberId: OWNER,
    title: "Firm Usage",
    kind: "snapshot",
    producer: "export",
    objectKey: "downloads/snapshot-one.json",
    byteSize: null,
    createdAt: "2026-08-31T12:00:00.000Z",
    expiresAt: "2026-09-07T12:00:00.000Z",
    state: "ready",
    ...overrides,
  };
}

describe("download register statements", () => {
  it("puts a row on the shelf and reads it back", async () => {
    const database = await freshFirmDatabase();
    await seedMembers(database);
    await database.batch([insertDownloadItemStatement(database, item())]);

    const shelf = await readDownloadShelf(database, OWNER, 50);
    expect(shelf).toHaveLength(1);
    expect(shelf[0]?.title).toBe("Firm Usage");
    expect(shelf[0]?.kind).toBe("snapshot");
    // Built and never fetched is a real state, and it reads as an empty list rather than as absence.
    expect(shelf[0]?.downloadedFormats).toEqual([]);
  });

  it("never shows one member's row on another member's shelf", async () => {
    const database = await freshFirmDatabase();
    await seedMembers(database);
    await database.batch([insertDownloadItemStatement(database, item())]);

    expect(await readDownloadShelf(database, COLLEAGUE, 50)).toEqual([]);
    // And the single read answers a colleague exactly as it answers a request for a row that does
    // not exist — anything else would confirm the row is there.
    expect(
      await readDownloadItem(
        database,
        COLLEAGUE,
        "downloadItem_test000000000000000001" as DownloadItemId,
      ),
    ).toBeUndefined();
  });

  it("orders the shelf newest first", async () => {
    const database = await freshFirmDatabase();
    await seedMembers(database);
    await database.batch([
      insertDownloadItemStatement(
        database,
        item({
          id: "downloadItem_test000000000000000001" as DownloadItemId,
          title: "Older",
          createdAt: "2026-08-30T12:00:00.000Z",
        }),
      ),
      insertDownloadItemStatement(
        database,
        item({
          id: "downloadItem_test000000000000000002" as DownloadItemId,
          title: "Newer",
          createdAt: "2026-08-31T12:00:00.000Z",
        }),
      ),
    ]);

    expect((await readDownloadShelf(database, OWNER, 50)).map((row) => row.title)).toEqual([
      "Newer",
      "Older",
    ]);
  });

  it("appends a taken format without losing the ones already recorded", async () => {
    const database = await freshFirmDatabase();
    await seedMembers(database);
    const id = "downloadItem_test000000000000000001" as DownloadItemId;
    await database.batch([insertDownloadItemStatement(database, item())]);

    await database.batch([recordDownloadedFormatStatement(database, OWNER, id, "docx")]);
    await database.batch([recordDownloadedFormatStatement(database, OWNER, id, "xlsx")]);
    expect((await readDownloadItem(database, OWNER, id))?.downloadedFormats).toEqual([
      "docx",
      "xlsx",
    ]);
  });

  it("keeps the taken formats a set when the same one is fetched twice", async () => {
    const database = await freshFirmDatabase();
    await seedMembers(database);
    const id = "downloadItem_test000000000000000001" as DownloadItemId;
    await database.batch([insertDownloadItemStatement(database, item())]);

    await database.batch([recordDownloadedFormatStatement(database, OWNER, id, "pdf")]);
    await database.batch([recordDownloadedFormatStatement(database, OWNER, id, "pdf")]);
    expect((await readDownloadItem(database, OWNER, id))?.downloadedFormats).toEqual(["pdf"]);
  });

  it("does not let a colleague record a format against somebody else's row", async () => {
    const database = await freshFirmDatabase();
    await seedMembers(database);
    const id = "downloadItem_test000000000000000001" as DownloadItemId;
    await database.batch([insertDownloadItemStatement(database, item())]);

    await database.batch([recordDownloadedFormatStatement(database, COLLEAGUE, id, "docx")]);
    expect((await readDownloadItem(database, OWNER, id))?.downloadedFormats).toEqual([]);
  });

  it("moves a building row to ready and records the size the producer learned", async () => {
    const database = await freshFirmDatabase();
    await seedMembers(database);
    const id = "downloadItem_test000000000000000001" as DownloadItemId;
    await database.batch([
      insertDownloadItemStatement(
        database,
        item({ kind: "artifact", producer: "bundle", state: "building" }),
      ),
    ]);

    await database.batch([setDownloadItemStateStatement(database, id, "ready", 4_096)]);
    const row = await readDownloadItem(database, OWNER, id);
    expect(row?.state).toBe("ready");
    expect(row?.byteSize).toBe(4_096);
  });

  it("removes only the member's own row", async () => {
    const database = await freshFirmDatabase();
    await seedMembers(database);
    const id = "downloadItem_test000000000000000001" as DownloadItemId;
    await database.batch([insertDownloadItemStatement(database, item())]);

    await database.batch([deleteDownloadItemStatement(database, COLLEAGUE, id)]);
    expect(await readDownloadShelf(database, OWNER, 50)).toHaveLength(1);

    await database.batch([deleteDownloadItemStatement(database, OWNER, id)]);
    expect(await readDownloadShelf(database, OWNER, 50)).toEqual([]);
  });

  it("selects only rows whose window has closed, across every member", async () => {
    const database = await freshFirmDatabase();
    await seedMembers(database);
    await database.batch([
      insertDownloadItemStatement(
        database,
        item({
          id: "downloadItem_test000000000000000001" as DownloadItemId,
          expiresAt: "2026-08-20T00:00:00.000Z",
        }),
      ),
      insertDownloadItemStatement(
        database,
        item({
          id: "downloadItem_test000000000000000002" as DownloadItemId,
          memberId: COLLEAGUE,
          expiresAt: "2026-08-21T00:00:00.000Z",
        }),
      ),
      insertDownloadItemStatement(
        database,
        item({
          id: "downloadItem_test000000000000000003" as DownloadItemId,
          expiresAt: "2026-12-01T00:00:00.000Z",
        }),
      ),
    ]);

    const expired = await readExpiredDownloadItems(database, "2026-08-31T00:00:00.000Z", 100);
    expect(expired.map((row) => row.id)).toEqual([
      "downloadItem_test000000000000000001",
      "downloadItem_test000000000000000002",
    ]);
  });
});
