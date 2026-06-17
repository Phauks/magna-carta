import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { FileId, FileVersionId, FolderId, MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  commitVersion,
  initiateUpload,
  moveFile,
  quarantineVersion,
  softDeleteFile,
} from "../src/file-service.ts";
import { createFolder } from "../src/folder-service.ts";
import { listFiles } from "../src/queries.ts";
import { ACTOR, freshDatabase, now, options, seedMatter } from "./support.ts";

// A second matter (id + responsible member) alongside seedMatter's matter_a, for cross-matter guards.
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

const pdf = { name: "brief.pdf", declaredSize: 1024, declaredContentType: "application/pdf" };

async function initiate(database: ReturnType<typeof freshDatabase>, matterId: string, extra = {}) {
  const result = await initiateUpload(
    database,
    {
      matterId: matterId as never,
      name: pdf.name,
      declaredSize: pdf.declaredSize,
      declaredContentType: pdf.declaredContentType,
      uploadedBy: ACTOR,
      mode: "put",
      ...extra,
    },
    options,
  );
  await commitEffectBatch(database, result.effect, { now });
  return result;
}

async function commit(
  database: ReturnType<typeof freshDatabase>,
  versionId: FileVersionId,
  hash: string,
) {
  const result = await commitVersion(
    database,
    {
      versionId,
      sizeBytes: 1024,
      sniffedContentType: "application/pdf",
      contentSha256: hash,
      scanVerdict: "unscanned",
      scanEngineVersion: null,
      scanDetail: null,
      now: now(),
    },
    options,
  );
  await commitEffectBatch(database, result.effect, { now });
  return result;
}

describe("initiateUpload", () => {
  it("creates a pending file that is invisible until a version commits", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId } = await initiate(database, matterId);
    // Pending: not in the file list.
    expect((await listFiles(database, { matterId })).data).toHaveLength(0);
    void (fileId satisfies FileId);
  });

  it("refuses a blocked extension and an oversize upload by policy", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    await expect(
      initiateUpload(
        database,
        {
          matterId,
          name: "malware.exe",
          declaredSize: 10,
          declaredContentType: "application/octet-stream",
          uploadedBy: ACTOR,
          mode: "put",
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "upload-policy-type" });
    await expect(
      initiateUpload(
        database,
        {
          matterId,
          name: "huge.pdf",
          declaredSize: 999 * 1024 * 1024 * 1024,
          declaredContentType: "application/pdf",
          uploadedBy: ACTOR,
          mode: "put",
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "upload-policy-size" });
  });
});

describe("commitVersion", () => {
  it("flips the file to visible and meters its bytes", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId } = await initiate(database, matterId);
    const result = await commit(database, versionId, "hash-a");
    expect(result.skipped).toBe(false);
    const { data } = await listFiles(database, { matterId });
    expect(data.map((row) => row.id)).toEqual([fileId]);
    const meter = await database
      .prepare("SELECT bytes, object_count FROM storage_meter WHERE prefix = 'files'")
      .all<{ bytes: number; object_count: number }>();
    expect(meter.results[0]).toEqual({ bytes: 1024, object_count: 1 });
  });

  it("skips a no-op re-upload of identical bytes (no new version cut)", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-a");
    // A second version on the same file with the SAME hash.
    const second = await initiate(database, matterId, { fileId });
    const result = await commit(database, second.versionId, "hash-a");
    expect(result.skipped).toBe(true);
    const versions = await database
      .prepare("SELECT status FROM file_version WHERE file_id = ?1 ORDER BY version_number")
      .bind(fileId)
      .all<{ status: string }>();
    expect(versions.results.map((row) => row.status)).toEqual(["clean", "abandoned"]);
  });

  it("refuses to commit a version that is not pending", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-a");
    await expect(commit(database, versionId, "hash-b")).rejects.toMatchObject({
      code: "version-not-pending",
    });
  });
});

describe("quarantineVersion", () => {
  it("quarantines a pending version, keeping the file invisible", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { versionId } = await initiate(database, matterId);
    const result = await quarantineVersion(
      database,
      { versionId, reason: "scan-infected", scanDetail: null },
      options,
    );
    await commitEffectBatch(database, result.effect, { now });
    expect((await listFiles(database, { matterId })).data).toHaveLength(0);
    const row = await database
      .prepare("SELECT status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .all<{ status: string }>();
    expect(row.results[0]?.status).toBe("quarantined");
  });
});

describe("commitVersion — scan_detail persistence", () => {
  it("persists scan_detail on commit", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { versionId } = await initiate(database, matterId);
    const result = await commitVersion(
      database,
      {
        versionId,
        sizeBytes: 4,
        sniffedContentType: "application/pdf",
        contentSha256: "ab",
        scanVerdict: "unscanned",
        scanEngineVersion: null,
        scanDetail: "encrypted",
        now: now(),
      },
      options,
    );
    await commitEffectBatch(database, result.effect, { now });
    const rows = await database
      .prepare("SELECT scan_detail FROM file_version WHERE id = ?1")
      .bind(versionId)
      .all<{ scan_detail: string | null }>();
    expect(rows.results[0]?.scan_detail).toBe("encrypted");
  });

  it("persists scan_detail on quarantine", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { versionId } = await initiate(database, matterId);
    const result = await quarantineVersion(
      database,
      { versionId, reason: "scan-infected", scanDetail: "trojan detected" },
      options,
    );
    await commitEffectBatch(database, result.effect, { now });
    const rows = await database
      .prepare("SELECT scan_detail FROM file_version WHERE id = ?1")
      .bind(versionId)
      .all<{ scan_detail: string | null }>();
    expect(rows.results[0]?.scan_detail).toBe("trojan detected");
  });
});

describe("softDeleteFile", () => {
  it("excludes a deleted file by default but a recovery view still finds it", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-a");
    const result = await softDeleteFile(database, fileId, options);
    await commitEffectBatch(database, result.effect, { now });
    expect((await listFiles(database, { matterId })).data).toHaveLength(0);
    const recoverable = await listFiles(database, { matterId, includeDeleted: true });
    expect(recoverable.data.map((row) => row.id)).toEqual([fileId]);
  });

  it("refuses to act on an unknown file", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    await expect(softDeleteFile(database, "file_missing" as FileId, options)).rejects.toMatchObject(
      { code: "unknown-file" },
    );
  });
});

describe("commitVersion — monotonic current version", () => {
  it("keeps the pointer at the newer version when an older one commits out of order", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId: v1 } = await initiate(database, matterId);
    const second = await initiate(database, matterId, { fileId });
    // Commit v2 first (different bytes), then v1 (older) late — the pointer must not regress to v1.
    await commit(database, second.versionId, "hash-v2");
    await commit(database, v1, "hash-v1");
    const file = await database
      .prepare("SELECT current_version_id FROM file WHERE id = ?1")
      .bind(fileId)
      .all<{ current_version_id: string }>();
    expect(file.results[0]?.current_version_id).toBe(second.versionId);
  });
});

describe("moveFile — same-matter integrity", () => {
  it("moves a file into a folder of its own matter", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-a");
    const { folderId, effect } = await createFolder(database, { matterId, name: "Same" }, options);
    await commitEffectBatch(database, effect, { now });
    const moved = await moveFile(database, fileId, folderId, options);
    await commitEffectBatch(database, moved.effect, { now });
    const row = await database
      .prepare("SELECT folder_id FROM file WHERE id = ?1")
      .bind(fileId)
      .all<{ folder_id: string }>();
    expect(row.results[0]?.folder_id).toBe(folderId);
  });

  it("refuses to move a file into a folder of another matter", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const otherMatterId = await seedSecondMatter(database);
    const { fileId, versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-a");
    const { folderId, effect } = await createFolder(
      database,
      { matterId: otherMatterId, name: "Foreign" },
      options,
    );
    await commitEffectBatch(database, effect, { now });
    await expect(moveFile(database, fileId, folderId, options)).rejects.toMatchObject({
      code: "file-cross-matter",
    });
  });

  it("refuses to move a file into an unknown folder", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-a");
    await expect(
      moveFile(database, fileId, "folder_missing" as FolderId, options),
    ).rejects.toMatchObject({ code: "unknown-folder" });
  });
});

describe("initiateUpload — lane selection by uploadKind", () => {
  it("mints an R2 key under files/ by default (interactive lane)", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const result = await initiate(database, matterId);
    expect(result.r2Key).toMatch(/^files\//);
  });

  it("mints an R2 key under bulk/ when uploadKind is bulk", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const result = await initiate(database, matterId, { uploadKind: "bulk" });
    expect(result.r2Key).toMatch(/^bulk\//);
  });

  it("bulk upload still meters under files/ on commit (meter dimension is logical, not the key prefix)", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { versionId } = await initiate(database, matterId, { uploadKind: "bulk" });
    await commit(database, versionId, "hash-bulk");
    const meter = await database
      .prepare("SELECT bytes, object_count FROM storage_meter WHERE prefix = 'files'")
      .all<{ bytes: number; object_count: number }>();
    expect(meter.results[0]).toEqual({ bytes: 1024, object_count: 1 });
  });
});

describe("initiateUpload — new version on an existing file", () => {
  it("refuses a new version whose declared matter differs from the file's matter", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const otherMatterId = await seedSecondMatter(database);
    const { fileId } = await initiate(database, matterId);
    await expect(
      initiateUpload(
        database,
        {
          matterId: otherMatterId,
          name: "v2.pdf",
          declaredSize: 1024,
          declaredContentType: "application/pdf",
          uploadedBy: ACTOR,
          mode: "put",
          fileId,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "file-matter-mismatch" });
  });
});
