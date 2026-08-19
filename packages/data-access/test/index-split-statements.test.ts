import { describe, expect, it } from "vitest";
import type { FileId, IndexSplitId, MatterId } from "@magna-carta/identifiers/types";
import { freshFirmDatabase } from "./support/fresh-firm-database.ts";
import {
  deleteIndexSplitStatement,
  deleteSplitsForDocumentStatement,
  insertIndexSplitStatement,
  listLiveSplitsForCorpus,
  listSplitsForDocument,
  markSplitSupersededStatement,
  replaceDocumentSplitStatements,
  type InsertIndexSplitRow,
} from "../src/index-split-statements.ts";

const MATTER = "matter_test0000000000000000001" as MatterId;
const OTHER_MATTER = "matter_test0000000000000000002" as MatterId;
const DOCUMENT = "file_test00000000000000000001" as FileId;
const OTHER_DOCUMENT = "file_test00000000000000000002" as FileId;

function split(id: string, matterId: MatterId, createdAt: string): InsertIndexSplitRow {
  return {
    id: id as IndexSplitId,
    matterId,
    corpusKind: "matter",
    corpusId: matterId,
    documentId: null,
    version: null,
    objectKey: `search/${matterId}/splits/${id}.split`,
    documentCount: 100,
    sizeBytes: 4096,
    schemaGeneration: 1,
    createdAt,
  };
}

function documentSplit(
  id: string,
  documentId: FileId,
  version: number,
  createdAt: string,
): InsertIndexSplitRow & { documentId: FileId } {
  return {
    ...split(id, MATTER, createdAt),
    documentId,
    version,
    objectKey: `search/${MATTER}/splits/${id}.split`,
  };
}

describe("index_split catalog statements", () => {
  it("lists a matter's live splits oldest-first and never another matter's", async () => {
    const db = await freshFirmDatabase();
    await db.batch([
      insertIndexSplitStatement(
        db,
        split("indexSplit_test0000000000000000002", MATTER, "2026-07-17T02:00:00.000Z"),
      ),
      insertIndexSplitStatement(
        db,
        split("indexSplit_test0000000000000000001", MATTER, "2026-07-17T01:00:00.000Z"),
      ),
      insertIndexSplitStatement(
        db,
        split("indexSplit_test0000000000000000009", OTHER_MATTER, "2026-07-17T03:00:00.000Z"),
      ),
    ]);

    const live = await listLiveSplitsForCorpus(db, MATTER);
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
    expect((await listLiveSplitsForCorpus(db, MATTER)).length).toBe(1);

    await db.batch([
      markSplitSupersededStatement(db, target as IndexSplitId, "2026-07-17T05:00:00.000Z"),
    ]);
    expect(await listLiveSplitsForCorpus(db, MATTER)).toEqual([]);

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
    const row = await db.prepare("SELECT id FROM index_split WHERE id = ?1").bind(target).first();
    expect(row).toBeNull();
  });
});

describe("per-document split convergence", () => {
  it("re-indexing the same document version converges on one row instead of duplicating", async () => {
    const db = await freshFirmDatabase();
    const derived = "indexSplit_test0000000000000000001";
    const row = documentSplit(derived, DOCUMENT, 1, "2026-08-04T01:00:00.000Z");

    // Two publishes of the same version — the shape a queue redelivery produces. Because the split id
    // is derived from documentId + version, both attempts write the same row, and the delete-then-insert
    // means the second lands on a clean table rather than colliding.
    await db.batch(replaceDocumentSplitStatements(db, row));
    await db.batch(
      replaceDocumentSplitStatements(db, { ...row, createdAt: "2026-08-04T02:00:00.000Z" }),
    );

    const live = await listLiveSplitsForCorpus(db, MATTER);
    expect(live.map((split) => split.id)).toEqual([derived]);
    expect(live[0]?.createdAt).toBe("2026-08-04T02:00:00.000Z");
  });

  it("re-indexing a NEW version of a document replaces the old version's split", async () => {
    const db = await freshFirmDatabase();
    const first = documentSplit(
      "indexSplit_test0000000000000000001",
      DOCUMENT,
      1,
      "2026-08-04T01:00:00.000Z",
    );
    const second = documentSplit(
      "indexSplit_test0000000000000000002",
      DOCUMENT,
      2,
      "2026-08-04T02:00:00.000Z",
    );
    await db.batch(replaceDocumentSplitStatements(db, first));
    await db.batch(replaceDocumentSplitStatements(db, second));

    // Exactly one live split for the document: the superseded version's split does not linger and
    // make the old text keep answering queries.
    const live = await listLiveSplitsForCorpus(db, MATTER);
    expect(live.map((split) => split.id)).toEqual(["indexSplit_test0000000000000000002"]);
    expect(live[0]?.version).toBe(2);
  });

  it("touches only its own document's rows", async () => {
    const db = await freshFirmDatabase();
    await db.batch(
      replaceDocumentSplitStatements(
        db,
        documentSplit(
          "indexSplit_test0000000000000000001",
          DOCUMENT,
          1,
          "2026-08-04T01:00:00.000Z",
        ),
      ),
    );
    await db.batch(
      replaceDocumentSplitStatements(
        db,
        documentSplit(
          "indexSplit_test0000000000000000002",
          OTHER_DOCUMENT,
          1,
          "2026-08-04T02:00:00.000Z",
        ),
      ),
    );
    // Re-publishing one document leaves the other's split untouched.
    await db.batch(
      replaceDocumentSplitStatements(
        db,
        documentSplit(
          "indexSplit_test0000000000000000001",
          DOCUMENT,
          2,
          "2026-08-04T03:00:00.000Z",
        ),
      ),
    );

    expect((await listSplitsForDocument(db, OTHER_DOCUMENT)).map((split) => split.id)).toEqual([
      "indexSplit_test0000000000000000002",
    ]);
    expect((await listLiveSplitsForCorpus(db, MATTER)).length).toBe(2);
  });

  it("lists a document's splits so a re-index knows which R2 objects to delete", async () => {
    const db = await freshFirmDatabase();
    await db.batch([
      insertIndexSplitStatement(
        db,
        documentSplit(
          "indexSplit_test0000000000000000001",
          DOCUMENT,
          1,
          "2026-08-04T01:00:00.000Z",
        ),
      ),
    ]);
    const rows = await listSplitsForDocument(db, DOCUMENT);
    expect(rows.map((split) => split.objectKey)).toEqual([
      `search/${MATTER}/splits/indexSplit_test0000000000000000001.split`,
    ]);
    expect(rows[0]?.documentId).toBe(DOCUMENT);
    expect(rows[0]?.version).toBe(1);
  });

  it("refuses a second LIVE split for the same document version", async () => {
    const db = await freshFirmDatabase();
    await db.batch([
      insertIndexSplitStatement(
        db,
        documentSplit(
          "indexSplit_test0000000000000000001",
          DOCUMENT,
          1,
          "2026-08-04T01:00:00.000Z",
        ),
      ),
    ]);
    // A different split id for the same document version — what a non-derived id would have produced.
    // The partial unique index is the last line of defence against a query counting one document twice.
    await expect(
      db.batch([
        insertIndexSplitStatement(
          db,
          documentSplit(
            "indexSplit_test0000000000000000009",
            DOCUMENT,
            1,
            "2026-08-04T02:00:00.000Z",
          ),
        ),
      ]),
    ).rejects.toThrow();
  });

  it("leaves the many-document splits a compaction publishes outside the per-version constraint", async () => {
    const db = await freshFirmDatabase();
    // Two merged splits, neither naming a document. Both are legal: the uniqueness rule is scoped to
    // per-document splits, so compaction is not boxed out by it.
    await db.batch([
      insertIndexSplitStatement(
        db,
        split("indexSplit_test0000000000000000001", MATTER, "2026-08-04T01:00:00.000Z"),
      ),
      insertIndexSplitStatement(
        db,
        split("indexSplit_test0000000000000000002", MATTER, "2026-08-04T02:00:00.000Z"),
      ),
    ]);
    const live = await listLiveSplitsForCorpus(db, MATTER);
    expect(live.length).toBe(2);
    expect(live.every((split) => split.documentId === null)).toBe(true);
  });

  it("deletes only the named document's rows", async () => {
    const db = await freshFirmDatabase();
    await db.batch([
      insertIndexSplitStatement(
        db,
        documentSplit(
          "indexSplit_test0000000000000000001",
          DOCUMENT,
          1,
          "2026-08-04T01:00:00.000Z",
        ),
      ),
      insertIndexSplitStatement(
        db,
        documentSplit(
          "indexSplit_test0000000000000000002",
          OTHER_DOCUMENT,
          1,
          "2026-08-04T02:00:00.000Z",
        ),
      ),
      deleteSplitsForDocumentStatement(db, DOCUMENT),
    ]);
    expect(await listSplitsForDocument(db, DOCUMENT)).toEqual([]);
    expect((await listSplitsForDocument(db, OTHER_DOCUMENT)).length).toBe(1);
  });
});
