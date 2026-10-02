import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { FileId, MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  commitVersion,
  duplicateVersionIntoMatter,
  initiateUpload,
  purgeableVersionObjects,
  softDeleteFile,
} from "../src/file-service.ts";
import { ACTOR, freshDatabase, now, options, seedMatter } from "./support.ts";

/*
 * A file the firm already holds is never uploaded again: a match is made from the held bytes. So
 * one set of bytes can stand behind several files, and the bytes belong to every row that names
 * them. What that rests on is pinned here: deleting one of those files never makes its bytes
 * destroyable while another row — live or deleted — still holds the same content, and the purge
 * guard is the one place that answers which objects a retention policy may take.
 */

const HASH = "c".repeat(64);

async function landClean(
  database: ReturnType<typeof freshDatabase>,
  matterId: string,
  name: string,
  hash = HASH,
) {
  const initiated = await initiateUpload(
    database,
    {
      matterId: matterId as MatterId,
      name,
      declaredSize: 1024,
      declaredContentType: "application/pdf",
      uploadedBy: ACTOR,
      mode: "put",
    },
    options,
  );
  await commitEffectBatch(database, initiated.effect, { now });
  const committed = await commitVersion(
    database,
    {
      versionId: initiated.versionId,
      sizeBytes: 1024,
      sniffedContentType: "application/pdf",
      contentSha256: hash,
      scanVerdict: "clean",
      scanEngineVersion: "engine-9",
      scanDetail: null,
      now: now(),
    },
    options,
  );
  await commitEffectBatch(database, committed.effect, { now });
  return initiated;
}

async function seedSecondMatter(database: ReturnType<typeof freshDatabase>): Promise<MatterId> {
  await database
    .prepare(
      "INSERT INTO matter (id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES ('matter_b', 'N', NULL, 'open', NULL, NULL, 'user_a', NULL, NULL, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    .run();
  return "matter_b" as MatterId;
}

async function deleteFile(database: ReturnType<typeof freshDatabase>, fileId: FileId) {
  const deleted = await softDeleteFile(database, fileId, options);
  await commitEffectBatch(database, deleted.effect, { now });
}

describe("purgeableVersionObjects — the purge guard", () => {
  it("two rows hold the same bytes; deleting one leaves its object retained, held by the other", async () => {
    const database = freshDatabase();
    const matterA = await seedMatter(database);
    const matterB = await seedSecondMatter(database);
    const original = await landClean(database, matterA, "brief.pdf");
    const copies: string[] = [];
    const made = await duplicateVersionIntoMatter(
      database,
      {
        sourceVersionId: original.versionId,
        matterId: matterB,
        folderId: null,
        name: "brief copy.pdf",
        uploadedBy: ACTOR,
        sourceModifiedAt: null,
      },
      options,
      async (fromKey, toKey) => {
        copies.push(`${fromKey} -> ${toKey}`);
      },
    );
    await commitEffectBatch(database, made.effect, { now });
    expect(copies).toHaveLength(1);

    // One delete. The deleted file's version object is NOT destroyable: the copy still holds the
    // same content, so the bytes are the copy's as much as they were the original's.
    await deleteFile(database, original.fileId);
    const afterOne = await purgeableVersionObjects(database, original.fileId);
    expect(afterOne.destroy).toEqual([]);
    expect(afterOne.retained).toEqual([
      { versionId: original.versionId, r2Key: original.r2Key, exportR2Key: null, heldBy: 1 },
    ]);
  });

  it("a soft-deleted row still counts as a holder: two deletes, and both objects are still retained", async () => {
    const database = freshDatabase();
    const matterA = await seedMatter(database);
    const first = await landClean(database, matterA, "one.pdf");
    const second = await landClean(database, matterA, "two.pdf");
    await deleteFile(database, first.fileId);
    await deleteFile(database, second.fileId);
    // A deleted file is recoverable, and a recovered file with no bytes behind it is no recovery:
    // each row keeps the other's bytes alive until the retention policy removes the row itself.
    expect((await purgeableVersionObjects(database, first.fileId)).destroy).toEqual([]);
    expect((await purgeableVersionObjects(database, second.fileId)).destroy).toEqual([]);
  });

  it("names the object nothing else holds as the one a purge may destroy", async () => {
    const database = freshDatabase();
    const matterA = await seedMatter(database);
    const alone = await landClean(database, matterA, "alone.pdf", "d".repeat(64));
    await landClean(database, matterA, "other.pdf", "e".repeat(64));
    await deleteFile(database, alone.fileId);
    const answer = await purgeableVersionObjects(database, alone.fileId);
    expect(answer.retained).toEqual([]);
    expect(answer.destroy).toEqual([
      { versionId: alone.versionId, r2Key: alone.r2Key, exportR2Key: null },
    ]);
  });

  it("refuses a live file: a purge follows a deletion, and never stands in for one", async () => {
    const database = freshDatabase();
    const matterA = await seedMatter(database);
    const live = await landClean(database, matterA, "live.pdf");
    await expect(purgeableVersionObjects(database, live.fileId)).rejects.toMatchObject({
      code: "file-not-deleted",
    });
    await expect(purgeableVersionObjects(database, "file_missing" as FileId)).rejects.toMatchObject(
      {
        code: "unknown-file",
      },
    );
  });
});
