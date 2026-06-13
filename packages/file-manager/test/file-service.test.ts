import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { FileId, FileVersionId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  commitVersion,
  initiateUpload,
  quarantineVersion,
  softDeleteFile,
} from "../src/file-service.ts";
import { listFiles } from "../src/queries.ts";
import { ACTOR, freshDatabase, now, options, seedMatter } from "./support.ts";

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
      { versionId, reason: "scan-infected" },
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
