import { commitEffectBatch, GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import type { FolderId, MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { createFolder, deleteFolder, moveFolder, renameFolder } from "../src/folder-service.ts";
import { initiateUpload } from "../src/file-service.ts";
import { ACTOR, freshDatabase, now, options, seedMatter } from "./support.ts";

async function makeFolder(
  database: ReturnType<typeof freshDatabase>,
  matterId: MatterId,
  name: string,
  parentFolderId: FolderId | null = null,
): Promise<FolderId> {
  const { folderId, effect } = await createFolder(
    database,
    { matterId, parentFolderId, name },
    options,
  );
  await commitEffectBatch(database, effect, { now });
  return folderId;
}

describe("createFolder", () => {
  it("creates a folder and refuses a duplicate sibling name (incl. at the matter root)", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    await makeFolder(database, matterId, "Pleadings");
    await expect(
      createFolder(database, { matterId, name: "Pleadings" }, options),
    ).rejects.toMatchObject({ code: "folder-name-taken" });
  });
});

// A blank name is its own refusal, distinct from a name clash, and it is caught on every path that
// writes one — the per-firm schema's CHECK would otherwise turn a whitespace-only rename into a raw
// constraint failure the route can only render as a server error.
describe("folder names", () => {
  it("refuses a blank or whitespace-only name on create and on rename", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    await expect(createFolder(database, { matterId, name: "   " }, options)).rejects.toMatchObject({
      code: "invalid-name",
    });

    const folderId = await makeFolder(database, matterId, "Correspondence");
    await expect(renameFolder(database, folderId, "  ", options)).rejects.toMatchObject({
      code: "invalid-name",
    });
    const row = await database
      .prepare("SELECT name FROM folder WHERE id = ?1")
      .bind(folderId)
      .all<{ name: string }>();
    expect(row.results[0]?.name).toBe("Correspondence");
  });
});

describe("createFolder / moveFolder — same-matter integrity", () => {
  async function seedSecondMatter(database: ReturnType<typeof freshDatabase>): Promise<MatterId> {
    const matterId = "matter_b" as MatterId;
    await database
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'M2', 'open', 'user_a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      )
      .bind(matterId)
      .run();
    return matterId;
  }

  it("refuses to create a subfolder under a parent in another matter", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const otherMatterId = await seedSecondMatter(database);
    const parent = await makeFolder(database, otherMatterId, "Foreign");
    await expect(
      createFolder(database, { matterId, parentFolderId: parent, name: "Child" }, options),
    ).rejects.toMatchObject({ code: "folder-cross-matter" });
  });

  it("refuses to move a folder under a parent in another matter", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const otherMatterId = await seedSecondMatter(database);
    const here = await makeFolder(database, matterId, "Here");
    const foreign = await makeFolder(database, otherMatterId, "Foreign");
    await expect(moveFolder(database, here, foreign, options)).rejects.toMatchObject({
      code: "folder-cross-matter",
    });
  });
});

describe("renameFolder / moveFolder", () => {
  it("renames a folder", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const folderId = await makeFolder(database, matterId, "Drafts");
    const { effect } = await renameFolder(database, folderId, "Final", options);
    await commitEffectBatch(database, effect, { now });
    const row = await database
      .prepare("SELECT name FROM folder WHERE id = ?1")
      .bind(folderId)
      .all<{ name: string }>();
    expect(row.results[0]?.name).toBe("Final");
  });

  it("refuses to move a folder into its own descendant", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const parent = await makeFolder(database, matterId, "Parent");
    const child = await makeFolder(database, matterId, "Child", parent);
    await expect(moveFolder(database, parent, child, options)).rejects.toMatchObject({
      code: "folder-cycle",
    });
  });

  // The service's cycle check is a read, and there is no interactive transaction between it and the
  // write. Two cross moves that each pass their own read can still commit a cycle, which permanently
  // detaches a subtree — nothing can reach it to move it back. The guard inside the UPDATE re-decides
  // against the rows as they are at write time, so the second writer moves nothing.
  it("refuses when another writer re-parented the target between the check and the commit", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const alpha = await makeFolder(database, matterId, "Alpha");
    const beta = await makeFolder(database, matterId, "Beta");

    // Both folders are at the root, so moving Alpha under Beta passes the service's cycle check.
    const { effect } = await moveFolder(database, alpha, beta, options);
    // The racing writer lands first: Beta goes under Alpha. Committing the prepared move now would
    // close the loop.
    await database
      .prepare("UPDATE folder SET parent_folder_id = ?2 WHERE id = ?1")
      .bind(beta, alpha)
      .run();

    // The cycle check rides the UPDATE, so the commit matches no row — and that refuses the batch
    // rather than quietly moving nothing. Somebody who dragged a folder and was told it worked, only
    // to find it where they left it, had no way to tell that from a slow refresh.
    await expect(commitEffectBatch(database, effect, { now })).rejects.toBeInstanceOf(
      GuardedWriteRefusedError,
    );

    const { results } = await database
      .prepare("SELECT id, parent_folder_id FROM folder WHERE id IN (?1, ?2)")
      .bind(alpha, beta)
      .all<{ id: FolderId; parent_folder_id: FolderId | null }>();
    const parentOf = new Map(results.map((row) => [row.id, row.parent_folder_id]));
    expect(parentOf.get(alpha)).toBeNull();
    expect(parentOf.get(beta)).toBe(alpha);
  });

  it("still moves a folder to the matter root, where no cycle is possible", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const parent = await makeFolder(database, matterId, "Parent");
    const child = await makeFolder(database, matterId, "Child", parent);

    const { effect } = await moveFolder(database, child, null, options);
    await commitEffectBatch(database, effect, { now });

    const { results } = await database
      .prepare("SELECT parent_folder_id FROM folder WHERE id = ?1")
      .bind(child)
      .all<{ parent_folder_id: FolderId | null }>();
    expect(results[0]?.parent_folder_id).toBeNull();
  });
});

describe("deleteFolder", () => {
  it("refuses to delete a non-empty folder and an unknown one", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const folderId = await makeFolder(database, matterId, "Evidence");
    // A pending file in the folder makes it non-empty.
    const upload = await initiateUpload(
      database,
      {
        matterId,
        folderId,
        name: "photo.jpg",
        declaredSize: 10,
        declaredContentType: "image/jpeg",
        uploadedBy: ACTOR,
        mode: "put",
      },
      options,
    );
    await commitEffectBatch(database, upload.effect, { now });
    await expect(deleteFolder(database, folderId, options)).rejects.toMatchObject({
      code: "folder-not-empty",
    });
    await expect(
      deleteFolder(database, "folder_missing" as FolderId, options),
    ).rejects.toMatchObject({ code: "unknown-folder" });
  });

  it("deletes an empty folder", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const folderId = await makeFolder(database, matterId, "Empty");
    const { effect } = await deleteFolder(database, folderId, options);
    await commitEffectBatch(database, effect, { now });
    const row = await database.prepare("SELECT id FROM folder WHERE id = ?1").bind(folderId).all();
    expect(row.results).toHaveLength(0);
  });
});
