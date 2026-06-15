import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
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
