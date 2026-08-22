import { encodeCursor } from "@magna-carta/data-access/cursor-pagination";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FolderId, MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { listFiles, listFilesStatement } from "../src/queries.ts";
import { FileManagerValidationError } from "../src/validation.ts";
import { freshDatabase, seedMatter } from "./support.ts";

// The file listing's orders, its keyset, and what happens when a caller changes order mid-scroll.
// Every assertion here is against a real migrated SQLite, so the ORDER BY, the keyset predicate and
// the indexes the migration adds are exercised together rather than asserted as SQL text.

async function seedFile(
  database: BatchDatabase,
  matterId: MatterId,
  file: {
    readonly name: string;
    readonly createdAt: string;
    readonly updatedAt?: string;
    readonly folderId?: FolderId;
  },
): Promise<string> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  await database
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) " +
        "VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, ?5, ?6)",
    )
    .bind(
      fileId,
      matterId,
      file.folderId ?? null,
      file.name,
      file.createdAt,
      file.updatedAt ?? file.createdAt,
    )
    .run();
  await database
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, " +
        "content_sha256, status, scan_verdict, scan_detail, uploaded_by, created_at, committed_at, inline_playable, storage_class, " +
        "storage_encoding, artifact_role) VALUES (?1, ?2, 1, ?3, 10, 'application/pdf', 'application/pdf', NULL, 'clean', 'clean', NULL, 'user_a', ?4, ?4, NULL, 'standard', 'full', 'original')",
    )
    .bind(versionId, fileId, `files/${fileId}/${versionId}`, file.createdAt)
    .run();
  await database
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  return fileId;
}

async function seedSortableMatter(): Promise<{
  database: BatchDatabase;
  matterId: MatterId;
  newestFileId: string;
}> {
  const database = freshDatabase();
  const matterId = await seedMatter(database);
  // Names chosen so a case-sensitive sort and a case-insensitive one disagree, and so name order,
  // creation order and update order are three different orders.
  await seedFile(database, matterId, {
    name: "banana.pdf",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  });
  await seedFile(database, matterId, {
    name: "Apple.pdf",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
  const newestFileId = await seedFile(database, matterId, {
    name: "cherry.pdf",
    createdAt: "2026-01-03T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  });
  return { database, matterId, newestFileId };
}

const namesOf = (page: { data: readonly { name: string }[] }) => page.data.map((row) => row.name);

describe("the file listing serves the order it was asked for", () => {
  it("defaults to newest-created-first, exactly as it did before there were orders", async () => {
    const { database, matterId } = await seedSortableMatter();

    expect(namesOf(await listFiles(database, { matterId }))).toEqual([
      "cherry.pdf",
      "Apple.pdf",
      "banana.pdf",
    ]);
  });

  it("sorts by name case-insensitively, ascending by default", async () => {
    // A case-sensitive sort would put every capitalised name ahead of every lowercase one, which is
    // what the NOCASE collation on the index and on both the ORDER BY and the keyset exists to avoid.
    const { database, matterId } = await seedSortableMatter();

    expect(namesOf(await listFiles(database, { matterId, sort: "name" }))).toEqual([
      "Apple.pdf",
      "banana.pdf",
      "cherry.pdf",
    ]);
    expect(
      namesOf(await listFiles(database, { matterId, sort: "name", direction: "desc" })),
    ).toEqual(["cherry.pdf", "banana.pdf", "Apple.pdf"]);
  });

  it("sorts by last activity, which is not creation order", async () => {
    const { database, matterId } = await seedSortableMatter();

    expect(namesOf(await listFiles(database, { matterId, sort: "updated" }))).toEqual([
      "banana.pdf",
      "cherry.pdf",
      "Apple.pdf",
    ]);
  });

  it("takes each order's natural direction as its default", async () => {
    const { database, matterId } = await seedSortableMatter();

    expect(namesOf(await listFiles(database, { matterId, sort: "created" }))).toEqual(
      namesOf(await listFiles(database, { matterId, sort: "created", direction: "desc" })),
    );
    expect(namesOf(await listFiles(database, { matterId, sort: "name" }))).toEqual(
      namesOf(await listFiles(database, { matterId, sort: "name", direction: "asc" })),
    );
  });
});

describe("the keyset walks each order exactly once", () => {
  it("pages every order without skipping or repeating a row", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    // Duplicate names and duplicate update instants, because neither column is a total order on its
    // own: files have no sibling-name uniqueness at all, and a batch move writes one instant to many
    // rows. Without `id` as the final key the keyset would skip or loop here.
    for (let index = 0; index < 9; index += 1) {
      await seedFile(database, matterId, {
        name: index % 3 === 0 ? "shared-name.pdf" : `document-${index}.pdf`,
        createdAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        updatedAt: index < 5 ? "2026-05-01T00:00:00.000Z" : "2026-06-01T00:00:00.000Z",
      });
    }

    for (const sort of ["created", "name", "updated"] as const) {
      for (const direction of ["asc", "desc"] as const) {
        const whole = await listFiles(database, { matterId, sort, direction, pageSize: 50 });
        const walked: string[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 10; page += 1) {
          const result = await listFiles(database, {
            matterId,
            sort,
            direction,
            pageSize: 2,
            ...(cursor === undefined ? {} : { cursor }),
          });
          walked.push(...result.data.map((row) => row.id));
          if (result.nextCursor === null) break;
          cursor = result.nextCursor;
        }
        expect(walked, `${sort} ${direction}`).toEqual(whole.data.map((row) => row.id));
      }
    }
  });
});

describe("a cursor belongs to the order that minted it", () => {
  it("refuses a cursor replayed under a different order rather than restarting", async () => {
    const { database, matterId } = await seedSortableMatter();
    const first = await listFiles(database, { matterId, sort: "created", pageSize: 1 });
    const cursor = first.nextCursor;
    expect(cursor).not.toBeNull();

    await expect(
      listFiles(database, { matterId, sort: "name", pageSize: 1, cursor: cursor ?? "" }),
    ).rejects.toThrow(FileManagerValidationError);
  });

  it("refuses a cursor replayed under the other direction of the same order", async () => {
    const { database, matterId } = await seedSortableMatter();
    const first = await listFiles(database, { matterId, sort: "name", pageSize: 1 });

    await expect(
      listFiles(database, {
        matterId,
        sort: "name",
        direction: "desc",
        pageSize: 1,
        cursor: first.nextCursor ?? "",
      }),
    ).rejects.toThrow(/cannot be read back under name:desc/);
  });

  it("still honours a cursor minted before the orders existed", async () => {
    // Such a cursor has no order tag at all. It was minted when creation-descending was the only
    // order there was, so that is the one it is read back under — and any other is refused.
    const { database, matterId, newestFileId } = await seedSortableMatter();
    const untagged = encodeCursor("2026-01-03T00:00:00.000Z", newestFileId);

    const page = await listFiles(database, { matterId, cursor: untagged });

    expect(namesOf(page)).toEqual(["Apple.pdf", "banana.pdf"]);
    await expect(listFiles(database, { matterId, sort: "name", cursor: untagged })).rejects.toThrow(
      FileManagerValidationError,
    );
  });

  it("treats a malformed cursor as the first page, as it always has", async () => {
    // A tampered token reveals nothing by being ignored. Only a well-formed cursor this system minted
    // is worth refusing, because only then is the caller actually mid-scroll.
    const { database, matterId } = await seedSortableMatter();

    const page = await listFiles(database, { matterId, sort: "name", cursor: "not-a-cursor" });

    expect(namesOf(page)).toEqual(["Apple.pdf", "banana.pdf", "cherry.pdf"]);
  });
});

describe("the sorted listing plans as an index seek", () => {
  it("uses the covering index for every order, in both directions, with no temporary B-tree", async () => {
    // The whole reason the keyset is written as a row value with the collation on the BOUND side: the
    // other two spellings are correct and plan as a scan of the matter on every page.
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    // The planner reads the schema, not the rows, so this needs no data — only a folder-filtered
    // variant of each order, because the folder-scoped indexes are half the set the migration adds.
    const folderId = "folder_a" as FolderId;

    for (const sort of ["created", "name", "updated"] as const) {
      for (const direction of ["asc", "desc"] as const) {
        for (const scope of [{}, { folderId }]) {
          const statement = listFilesStatement(
            database,
            { matterId, sort, direction, ...scope },
            { createdAt: "2026-01-01T00:00:00.000Z", id: "file_a" },
            10,
          );
          const { results } = await database
            .prepare(`EXPLAIN QUERY PLAN ${statement.sql ?? ""}`)
            .bind(...bindingsOf(statement))
            .all<{ detail: string }>();
          const plan = results.map((row) => row.detail).join(" | ");
          expect(plan, `${sort} ${direction}`).not.toMatch(/TEMP B-TREE FOR ORDER BY/);
          expect(plan, `${sort} ${direction}`).toMatch(
            new RegExp(
              `INDEX file_(matter|folder)_id_${sort === "created" ? "created_at" : sort === "name" ? "name" : "updated_at"}_id_index`,
            ),
          );
        }
      }
    }
  });
});

// The statement builder binds as it prepares, and node:sqlite needs the values again to explain the
// plan. The stub records them; the real database does not expose them, so re-derive from the shape.
function bindingsOf(statement: { readonly sql?: string }): unknown[] {
  const placeholders = (statement.sql ?? "").split("?").length - 1;
  // Placeholder order for this statement: matter id, optional folder id, the two keyset values, limit.
  return Array.from({ length: placeholders }, () => "x");
}
