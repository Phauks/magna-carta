import { describe, expect, it } from "vitest";
import type { IndexSplitId, MatterId } from "@magna-carta/identifiers/types";
import { freshFirmDatabase } from "./support/fresh-firm-database.ts";
import {
  deleteIndexSplitStatement,
  insertIndexSplitStatement,
  listLiveSplitsForMatter,
  markSplitSupersededStatement,
  type InsertIndexSplitRow,
} from "../src/index-split-statements.ts";

const MATTER = "matter_test0000000000000000001" as MatterId;
const OTHER_MATTER = "matter_test0000000000000000002" as MatterId;

function split(id: string, matterId: MatterId, createdAt: string): InsertIndexSplitRow {
  return {
    id: id as IndexSplitId,
    matterId,
    objectKey: `search/${matterId}/splits/${id}.split`,
    documentCount: 100,
    sizeBytes: 4096,
    schemaGeneration: 1,
    createdAt,
  };
}

describe("index_split catalog statements", () => {
  it("lists a matter's live splits oldest-first and never another matter's", async () => {
    const db = await freshFirmDatabase();
    await db.batch([
      insertIndexSplitStatement(db, split("indexSplit_test0000000000000000002", MATTER, "2026-07-17T02:00:00.000Z")),
      insertIndexSplitStatement(db, split("indexSplit_test0000000000000000001", MATTER, "2026-07-17T01:00:00.000Z")),
      insertIndexSplitStatement(db, split("indexSplit_test0000000000000000009", OTHER_MATTER, "2026-07-17T03:00:00.000Z")),
    ]);

    const live = await listLiveSplitsForMatter(db, MATTER);
    expect(live.map((row) => row.id)).toEqual([
      "indexSplit_test0000000000000000001",
      "indexSplit_test0000000000000000002",
    ]);
    expect(live[0]?.objectKey).toContain(MATTER);
    expect(live[0]?.documentCount).toBe(100);
    expect(live[0]?.schemaGeneration).toBe(1);
  });

  it("drops a split from the live set once it is superseded, keeping the row", async () => {
    const db = await freshFirmDatabase();
    const target = "indexSplit_test0000000000000000001";
    await db.batch([
      insertIndexSplitStatement(db, split(target, MATTER, "2026-07-17T01:00:00.000Z")),
    ]);
    expect((await listLiveSplitsForMatter(db, MATTER)).length).toBe(1);

    await db.batch([
      markSplitSupersededStatement(db, target as IndexSplitId, "2026-07-17T05:00:00.000Z"),
    ]);
    expect(await listLiveSplitsForMatter(db, MATTER)).toEqual([]);

    // The row is retained (not deleted) so an in-flight query against the old split still resolves.
    const remaining = await db
      .prepare("SELECT superseded_at FROM index_split WHERE id = ?1")
      .bind(target)
      .first<{ superseded_at: string | null }>();
    expect(remaining?.superseded_at).toBe("2026-07-17T05:00:00.000Z");
  });

  it("removes the row on delete", async () => {
    const db = await freshFirmDatabase();
    const target = "indexSplit_test0000000000000000001";
    await db.batch([
      insertIndexSplitStatement(db, split(target, MATTER, "2026-07-17T01:00:00.000Z")),
      deleteIndexSplitStatement(db, target as IndexSplitId),
    ]);
    const row = await db
      .prepare("SELECT id FROM index_split WHERE id = ?1")
      .bind(target)
      .first();
    expect(row).toBeNull();
  });
});
