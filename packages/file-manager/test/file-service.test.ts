import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type {
  DocumentCheckoutId,
  FileId,
  FileVersionId,
  FolderId,
  MatterId,
} from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  assignDocumentType,
  commitEditedVersion,
  commitVersion,
  initiateCheckin,
  initiateUpload,
  moveFile,
  quarantineVersion,
  recordRescanVerdict,
  renameFile,
  restoreFile,
  restoreVersion,
  softDeleteFile,
} from "../src/file-service.ts";
import { createFolder } from "../src/folder-service.ts";
import { listFiles, loadCommittedVersionByR2Key } from "../src/queries.ts";
import { lookupScanCache } from "../src/scan-cache.ts";
import { readScanEngineVersion } from "../src/upload-policy.ts";
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

describe("commitEditedVersion", () => {
  it("cuts a new immutable version from the current working object and advances the pointer", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId: v1 } = await initiate(database, matterId);
    await commit(database, v1, "hash-v1");

    const copies: Array<[string, string]> = [];
    const result = await commitEditedVersion(
      database,
      {
        fileId,
        currentR2Key: `files/${fileId}/current`,
        contentSha256: "hash-edited",
        sizeBytes: 2048,
        uploadedBy: ACTOR,
        saveKind: "explicit",
        participants: [],
      },
      options,
      async (from, to) => {
        copies.push([from, to]);
      },
    );

    expect(result.skipped).toBe(false);
    expect(result.versionId).not.toBeNull();
    // server-side copy: current -> the new version's opaque key (no bytes through the Worker)
    expect(copies).toEqual([[`files/${fileId}/current`, `files/${fileId}/${result.versionId}`]]);

    await commitEffectBatch(database, result.effect, { now });

    const { results: rows } = await database
      .prepare(
        "SELECT id, version_number, content_sha256, status FROM file_version WHERE file_id = ?1 ORDER BY version_number",
      )
      .bind(fileId)
      .all<{ id: string; version_number: number; content_sha256: string; status: string }>();
    expect(rows.map((row) => row.version_number)).toEqual([1, 2]);
    expect(rows[1]?.id).toBe(result.versionId);
    expect(rows[1]?.content_sha256).toBe("hash-edited");
    expect(rows[1]?.status).toBe("clean");

    const { results: fileRow } = await database
      .prepare("SELECT current_version_id FROM file WHERE id = ?1")
      .bind(fileId)
      .all<{ current_version_id: string }>();
    expect(fileRow[0]?.current_version_id).toBe(result.versionId);
  });

  it("skips when the saved content matches the current version (no copy, no new version)", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId: v1 } = await initiate(database, matterId);
    await commit(database, v1, "hash-unchanged");

    const copies: string[] = [];
    const result = await commitEditedVersion(
      database,
      {
        fileId,
        currentR2Key: `files/${fileId}/current`,
        contentSha256: "hash-unchanged",
        sizeBytes: 2048,
        uploadedBy: ACTOR,
        saveKind: "explicit",
        participants: [],
      },
      options,
      async (from) => {
        copies.push(from);
      },
    );

    expect(result.skipped).toBe(true);
    expect(result.versionId).toBeNull();
    expect(copies).toEqual([]);
    expect(result.effect.statements).toEqual([]);

    const { results: rows } = await database
      .prepare("SELECT version_number FROM file_version WHERE file_id = ?1")
      .bind(fileId)
      .all<{ version_number: number }>();
    expect(rows).toHaveLength(1);
  });
});

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

  it("refuses a NEW file whose folder belongs to another matter", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const otherMatterId = await seedSecondMatter(database);
    const { folderId, effect } = await createFolder(
      database,
      { matterId: otherMatterId, name: "Foreign" },
      options,
    );
    await commitEffectBatch(database, effect, { now });
    await expect(
      initiateUpload(
        database,
        {
          matterId,
          folderId,
          name: "report.pdf",
          declaredSize: 10,
          declaredContentType: "application/pdf",
          uploadedBy: ACTOR,
          mode: "put",
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "file-cross-matter" });
  });

  it("refuses a NEW file in an unknown folder", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    await expect(
      initiateUpload(
        database,
        {
          matterId,
          folderId: "folder_missing" as FolderId,
          name: "report.pdf",
          declaredSize: 10,
          declaredContentType: "application/pdf",
          uploadedBy: ACTOR,
          mode: "put",
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "unknown-folder" });
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

  // The status = 'pending' guard protects only the UPDATE that carries it. Everything the commit
  // implies — the meter delta, the current-version pointer, the session flip, the audit row, the
  // outbox event — has no such predicate, so a lost race to an abort or expiry would otherwise commit
  // every consequence of a commit that never happened. The batch must fail as a unit instead.
  it("commits nothing at all when the version was abandoned between the read and the batch", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId } = await initiate(database, matterId);

    const result = await commitVersion(
      database,
      {
        versionId,
        sizeBytes: 1024,
        sniffedContentType: "application/pdf",
        contentSha256: "hash-a",
        scanVerdict: "unscanned",
        scanEngineVersion: null,
        scanDetail: null,
        now: now(),
      },
      options,
    );
    // The racing abort lands first: the version leaves 'pending', so the guarded commit UPDATE in the
    // prepared batch will match nothing.
    await database
      .prepare("UPDATE file_version SET status = 'abandoned' WHERE id = ?1")
      .bind(versionId)
      .run();

    await expect(commitEffectBatch(database, result.effect, { now })).rejects.toThrow();

    const version = await database
      .prepare("SELECT status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .all<{ status: string }>();
    expect(version.results[0]?.status).toBe("abandoned");
    const file = await database
      .prepare("SELECT current_version_id FROM file WHERE id = ?1")
      .bind(fileId)
      .all<{ current_version_id: string | null }>();
    expect(file.results[0]?.current_version_id).toBeNull();
    const meter = await database
      .prepare("SELECT bytes FROM storage_meter WHERE prefix = 'files'")
      .all<{ bytes: number }>();
    expect(meter.results).toHaveLength(0);
    // No trail claiming a commit — neither the audit row nor the event the batch would have appended.
    const audit = await database
      .prepare("SELECT id FROM audit_log WHERE event = 'file.version_committed'")
      .all();
    expect(audit.results).toHaveLength(0);
    const outbox = await database
      .prepare("SELECT id FROM outbox WHERE topic = 'file.version_committed'")
      .all();
    expect(outbox.results).toHaveLength(0);
  });
});

describe("quarantineVersion", () => {
  it("quarantines a pending version, keeping the file invisible", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { versionId } = await initiate(database, matterId);
    const result = await quarantineVersion(
      database,
      { versionId, reason: "scan-flagged", scanDetail: null },
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
      { versionId, reason: "scan-flagged", scanDetail: "trojan detected" },
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

describe("commitVersion — current scan engine version stamp", () => {
  it("stamps the firm's current scan engine version on a clean commit from a real engine", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    expect(await readScanEngineVersion(database)).toBeNull();
    const { versionId } = await initiate(database, matterId);
    const result = await commitVersion(
      database,
      {
        versionId,
        sizeBytes: 1024,
        sniffedContentType: "application/pdf",
        contentSha256: "hash-clean",
        scanVerdict: "clean",
        scanEngineVersion: "clamav/1.0+heuristics/1",
        scanDetail: null,
        now: now(),
      },
      options,
    );
    await commitEffectBatch(database, result.effect, { now });
    expect(await readScanEngineVersion(database)).toBe("clamav/1.0+heuristics/1");
  });

  it("leaves the stamp unchanged on an unscanned commit (never fabricated without a real scan)", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-unscanned");
    // An `unscanned` commit carries no engine version — the stamp must stay null, never invented.
    expect(await readScanEngineVersion(database)).toBeNull();
  });

  it("does not stamp a clean commit that carries no engine version", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { versionId } = await initiate(database, matterId);
    const result = await commitVersion(
      database,
      {
        versionId,
        sizeBytes: 1024,
        sniffedContentType: "application/pdf",
        contentSha256: "hash-clean-noengine",
        scanVerdict: "clean",
        scanEngineVersion: null,
        scanDetail: null,
        now: now(),
      },
      options,
    );
    await commitEffectBatch(database, result.effect, { now });
    expect(await readScanEngineVersion(database)).toBeNull();
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

  it("clears the live working-copy fields and returns the current key to destroy", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-a");
    // Simulate a live editing session having written a working copy.
    await database
      .prepare(
        "UPDATE file SET current_r2_key = ?2, current_sha256 = 'wc', current_size_bytes = 5, current_wopi_timestamp = 't', edit_state = 'coediting' WHERE id = ?1",
      )
      .bind(fileId, `files/${fileId}/current`)
      .run();

    const result = await softDeleteFile(database, fileId, options);
    expect(result.currentR2Key).toBe(`files/${fileId}/current`);
    await commitEffectBatch(database, result.effect, { now });

    const { results } = await database
      .prepare(
        "SELECT current_r2_key, current_sha256, current_size_bytes, edit_state, deleted_at FROM file WHERE id = ?1",
      )
      .bind(fileId)
      .all<{
        current_r2_key: string | null;
        current_sha256: string | null;
        current_size_bytes: number | null;
        edit_state: string;
        deleted_at: string | null;
      }>();
    expect(results[0]).toEqual({
      current_r2_key: null,
      current_sha256: null,
      current_size_bytes: null,
      edit_state: "idle",
      deleted_at: now(),
    });
  });

  it("returns a null current key when the file had no live working copy", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-a");
    const result = await softDeleteFile(database, fileId, options);
    expect(result.currentR2Key).toBeNull();
  });
});

describe("restoreFile", () => {
  it("clears deleted_at so a recovered file returns to the default listing", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-a");
    await commitEffectBatch(database, (await softDeleteFile(database, fileId, options)).effect, {
      now,
    });
    expect((await listFiles(database, { matterId })).data).toHaveLength(0);

    const restored = await restoreFile(database, fileId, options);
    await commitEffectBatch(database, restored.effect, { now });
    expect((await listFiles(database, { matterId })).data.map((row) => row.id)).toEqual([fileId]);
  });

  it("refuses to restore a file that is not deleted", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-a");
    await expect(restoreFile(database, fileId, options)).rejects.toMatchObject({
      code: "file-not-deleted",
    });
  });

  it("keeps the stored folder when it still exists, and falls back to the matter root when it is gone", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const folder = await createFolder(database, { matterId, name: "Pleadings" }, options);
    await commitEffectBatch(database, folder.effect, { now });
    const { fileId, versionId } = await initiate(database, matterId, {
      folderId: folder.folderId,
    });
    await commit(database, versionId, "hash-a");
    await commitEffectBatch(database, (await softDeleteFile(database, fileId, options)).effect, {
      now,
    });

    // The folder survives: the file goes straight home.
    const home = await restoreFile(database, fileId, options);
    expect(home.folderId).toBe(folder.folderId);
    await commitEffectBatch(database, home.effect, { now });
    await commitEffectBatch(database, (await softDeleteFile(database, fileId, options)).effect, {
      now,
    });

    // The folder is gone by the second restore: the file must not be stranded under a pointer
    // nothing can browse to, so it lands at the matter root. The folder service refuses to delete a
    // non-empty folder, so the orphaned pointer is forced directly with enforcement off — the
    // fallback exists precisely for a state no normal path should produce.
    await database.prepare("PRAGMA foreign_keys = OFF").run();
    await database.prepare("DELETE FROM folder WHERE id = ?1").bind(folder.folderId).run();
    await database.prepare("PRAGMA foreign_keys = ON").run();
    const fallback = await restoreFile(database, fileId, options);
    expect(fallback.folderId).toBeNull();
    await commitEffectBatch(database, fallback.effect, { now });
    const { results } = await database
      .prepare("SELECT folder_id, deleted_at FROM file WHERE id = ?1")
      .bind(fileId)
      .all<{ folder_id: string | null; deleted_at: string | null }>();
    expect(results[0]?.folder_id).toBeNull();
    expect(results[0]?.deleted_at).toBeNull();
  });

  it("restores into a chosen folder, refusing an unknown or cross-matter destination", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const otherMatterId = await seedSecondMatter(database);
    const destination = await createFolder(database, { matterId, name: "Restored" }, options);
    await commitEffectBatch(database, destination.effect, { now });
    const foreign = await createFolder(
      database,
      { matterId: otherMatterId, name: "Elsewhere" },
      options,
    );
    await commitEffectBatch(database, foreign.effect, { now });
    const { fileId, versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-a");
    await commitEffectBatch(database, (await softDeleteFile(database, fileId, options)).effect, {
      now,
    });

    await expect(
      restoreFile(database, fileId, options, { folderId: "folder_missing" as FolderId }),
    ).rejects.toMatchObject({ code: "unknown-folder" });
    await expect(
      restoreFile(database, fileId, options, { folderId: foreign.folderId }),
    ).rejects.toMatchObject({ code: "file-cross-matter" });

    const chosen = await restoreFile(database, fileId, options, {
      folderId: destination.folderId,
    });
    expect(chosen.folderId).toBe(destination.folderId);
    await commitEffectBatch(database, chosen.effect, { now });
    const { results } = await database
      .prepare("SELECT folder_id FROM file WHERE id = ?1")
      .bind(fileId)
      .all<{ folder_id: string | null }>();
    expect(results[0]?.folder_id).toBe(destination.folderId);
  });
});

// A soft-deleted file is invisible to every consumer read, so a write that still landed on one would
// change something nobody can see — and an undelete would then hand back a file that quietly moved,
// was renamed, or grew a version while it was in the recycle bin.
describe("writes against a soft-deleted file", () => {
  async function deletedFile(database: ReturnType<typeof freshDatabase>) {
    const matterId = await seedMatter(database);
    const { fileId, versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-a");
    await commitEffectBatch(database, (await softDeleteFile(database, fileId, options)).effect, {
      now,
    });
    return { matterId, fileId };
  }

  it("refuses a rename", async () => {
    const database = freshDatabase();
    const { fileId } = await deletedFile(database);
    await expect(renameFile(database, fileId, "renamed.pdf", options)).rejects.toMatchObject({
      code: "file-deleted",
    });
  });

  it("refuses a move", async () => {
    const database = freshDatabase();
    const { fileId } = await deletedFile(database);
    await expect(moveFile(database, fileId, null, options)).rejects.toMatchObject({
      code: "file-deleted",
    });
  });

  it("refuses a document-type assignment", async () => {
    const database = freshDatabase();
    const { fileId } = await deletedFile(database);
    await expect(assignDocumentType(database, fileId, null, options)).rejects.toMatchObject({
      code: "file-deleted",
    });
  });

  it("refuses a new version on the file", async () => {
    const database = freshDatabase();
    const { matterId, fileId } = await deletedFile(database);
    await expect(initiate(database, matterId, { fileId })).rejects.toMatchObject({
      code: "file-deleted",
    });
  });

  it("refuses the return leg of an offline checkout", async () => {
    const database = freshDatabase();
    const { fileId } = await deletedFile(database);
    await expect(
      initiateCheckin(
        database,
        {
          fileId,
          checkoutId: "documentCheckout_x" as DocumentCheckoutId,
          declaredSize: null,
          declaredContentType: null,
          uploadedBy: ACTOR,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "file-deleted" });
  });

  it("refuses a second delete rather than re-stamping deleted_at", async () => {
    const database = freshDatabase();
    const { fileId } = await deletedFile(database);
    await expect(softDeleteFile(database, fileId, options)).rejects.toMatchObject({
      code: "file-deleted",
    });
  });

  it("still lets the recovery view read it and the undelete restore it", async () => {
    const database = freshDatabase();
    const { matterId, fileId } = await deletedFile(database);
    // The recovery surface is the one place a deleted file is legitimately visible.
    expect(
      (await listFiles(database, { matterId, includeDeleted: true })).data.map((row) => row.id),
    ).toEqual([fileId]);
    await commitEffectBatch(database, (await restoreFile(database, fileId, options)).effect, {
      now,
    });
    // …and once it is back, the writes it was refusing are allowed again.
    const renamed = await renameFile(database, fileId, "renamed.pdf", options);
    await commitEffectBatch(database, renamed.effect, { now });
    const { results } = await database
      .prepare("SELECT name FROM file WHERE id = ?1")
      .bind(fileId)
      .all<{ name: string }>();
    expect(results[0]?.name).toBe("renamed.pdf");
  });
});

describe("restoreVersion", () => {
  it("copies an archived version forward into a new current version, leaving history intact", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId: v1 } = await initiate(database, matterId);
    await commit(database, v1, "hash-v1");
    const { versionId: v2 } = await initiate(database, matterId, { fileId });
    await commit(database, v2, "hash-v2");

    const copies: Array<[string, string]> = [];
    const result = await restoreVersion(
      database,
      { fileId, sourceVersionId: v1, uploadedBy: ACTOR },
      options,
      async (from, to) => {
        copies.push([from, to]);
      },
    );
    expect(result.skipped).toBe(false);
    expect(result.versionId).not.toBeNull();
    // The archived version's bytes are copied forward to the new version's key (forward-only).
    expect(copies).toEqual([[`files/${fileId}/${v1}`, `files/${fileId}/${result.versionId}`]]);
    await commitEffectBatch(database, result.effect, { now });

    const { results: rows } = await database
      .prepare(
        "SELECT id, version_number, content_sha256 FROM file_version WHERE file_id = ?1 ORDER BY version_number",
      )
      .bind(fileId)
      .all<{ id: string; version_number: number; content_sha256: string }>();
    // History is intact (v1, v2 untouched) and the restored content is a NEW version 3.
    expect(rows.map((r) => r.version_number)).toEqual([1, 2, 3]);
    expect(rows[2]?.id).toBe(result.versionId);
    expect(rows[2]?.content_sha256).toBe("hash-v1");

    const { results: fileRow } = await database
      .prepare("SELECT current_version_id FROM file WHERE id = ?1")
      .bind(fileId)
      .all<{ current_version_id: string }>();
    expect(fileRow[0]?.current_version_id).toBe(result.versionId);
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

describe("recordRescanVerdict — in-place re-scan", () => {
  async function committedVersion(database: ReturnType<typeof freshDatabase>, hash: string) {
    const matterId = await seedMatter(database);
    const { versionId } = (await initiate(database, matterId)) as { versionId: FileVersionId };
    const committed = await commit(database, versionId, hash);
    return { versionId, fileId: committed.fileId };
  }

  it("stamps a clean re-scan verdict in place — no pointer move, cache recorded", async () => {
    const database = freshDatabase();
    const { versionId, fileId } = await committedVersion(database, "hash-x");
    const before = await database
      .prepare("SELECT current_version_id FROM file WHERE id = ?1")
      .bind(fileId)
      .all<{ current_version_id: string }>();

    const cleanRaw = {
      engineVersion: "clamav/2.0",
      clam: { state: "clean" as const },
      heuristic: { kind: "none" as const },
      matches: [],
      timings: { clamdMs: 3, yaraMs: 2 },
    };
    await commitEffectBatch(
      database,
      recordRescanVerdict(
        database,
        {
          fileId,
          versionId,
          scanVerdict: "clean",
          scanEngineVersion: "clamav/2.0",
          scanDetail: null,
          signature: null,
          contentSha256: "hash-x",
          now: now(),
          rawScanResult: cleanRaw,
        },
        options,
      ).effect,
      { now },
    );

    const row = await database
      .prepare("SELECT scan_verdict, scan_engine_version, status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .all<{ scan_verdict: string; scan_engine_version: string; status: string }>();
    expect(row.results[0]).toMatchObject({
      scan_verdict: "clean",
      scan_engine_version: "clamav/2.0",
      status: "clean",
    });
    const after = await database
      .prepare("SELECT current_version_id FROM file WHERE id = ?1")
      .bind(fileId)
      .all<{ current_version_id: string }>();
    expect(after.results[0]?.current_version_id).toBe(before.results[0]?.current_version_id);
    expect(await lookupScanCache(database, "hash-x", "clamav/2.0")).toEqual(cleanRaw);
  });

  it("an infected re-scan keeps the version VISIBLE (status stays clean) — informed access, no data loss", async () => {
    const database = freshDatabase();
    const { versionId, fileId } = await committedVersion(database, "hash-bad");

    const infectedRaw = {
      engineVersion: "clamav/2.0",
      clam: { state: "infected" as const, signature: "Eicar-Test-Signature" },
      heuristic: { kind: "none" as const },
      matches: [],
      timings: { clamdMs: 4, yaraMs: 1 },
    };
    const { effect } = recordRescanVerdict(
      database,
      {
        fileId,
        versionId,
        scanVerdict: "flagged",
        scanEngineVersion: "clamav/2.0",
        scanDetail: "Eicar-Test-Signature",
        signature: "Eicar-Test-Signature",
        contentSha256: "hash-bad",
        now: now(),
        rawScanResult: infectedRaw,
      },
      options,
    );
    // A fresh infected finding emits a notification (the outbox seam); a clean re-scan emits none.
    expect(effect.outboxMessages).toEqual([
      { topic: "file.rescan_infected", payload: { fileId, versionId } },
    ]);
    await commitEffectBatch(database, effect, { now });

    const row = await database
      .prepare("SELECT scan_verdict, status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .all<{ scan_verdict: string; status: string }>();
    // The hallmark of informed access: flagged but still committed/visible — never hidden or regressed.
    expect(row.results[0]).toMatchObject({ scan_verdict: "flagged", status: "clean" });
    expect(await lookupScanCache(database, "hash-bad", "clamav/2.0")).toEqual(infectedRaw);
  });
});

describe("commitVersion — flagged-but-committed version", () => {
  it("persists scan_verdict='flagged', status='clean', populates the scan cache, and records the commit audit", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { versionId } = await initiate(database, matterId);

    const flaggedRaw = {
      engineVersion: "clamav/1.0+heuristics/1",
      clam: { state: "infected" as const, signature: "Eicar-Test-Signature" },
      heuristic: { kind: "none" as const },
      matches: [],
      timings: { clamdMs: 5, yaraMs: 2 },
    };

    const result = await commitVersion(
      database,
      {
        versionId,
        sizeBytes: 2048,
        sniffedContentType: "application/pdf",
        contentSha256: "hash-flagged",
        scanVerdict: "flagged",
        scanEngineVersion: "clamav/1.0+heuristics/1",
        scanDetail: "Eicar-Test-Signature",
        now: now(),
        rawScanResult: flaggedRaw,
      },
      options,
    );
    await commitEffectBatch(database, result.effect, { now });

    // The version row: flagged verdict, but status is 'clean' (committed + accessible per treatment gate).
    const row = await database
      .prepare("SELECT scan_verdict, status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .all<{ scan_verdict: string; status: string }>();
    expect(row.results[0]).toMatchObject({ scan_verdict: "flagged", status: "clean" });

    // The scan cache must be populated (engine-version keyed dedup — same as a clean commit).
    expect(await lookupScanCache(database, "hash-flagged", "clamav/1.0+heuristics/1")).toEqual(
      flaggedRaw,
    );

    // A commit audit row must exist for this version, and its metadata must carry the flagged verdict +
    // reason so the audit trail is useful without exposing privileged content.
    const audit = await database
      .prepare(
        "SELECT event, metadata FROM audit_log WHERE event = 'file.version_committed' AND subject_id = ?1",
      )
      .bind(versionId)
      .all<{ event: string; metadata: string }>();
    expect(audit.results).toHaveLength(1);
    const parsed = JSON.parse(audit.results[0]!.metadata as string);
    expect(parsed).toMatchObject({ scanVerdict: "flagged", scanDetail: "Eicar-Test-Signature" });
  });
});

describe("loadCommittedVersionByR2Key", () => {
  it("loads a committed version by r2 key (hash + engine); undefined while pending or unknown", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { versionId } = (await initiate(database, matterId)) as { versionId: FileVersionId };
    const key = (
      await database
        .prepare("SELECT r2_key FROM file_version WHERE id = ?1")
        .bind(versionId)
        .all<{ r2_key: string }>()
    ).results[0]?.r2_key as string;

    // While pending, the committed-only loader must not find it (status gate).
    expect(await loadCommittedVersionByR2Key(database, key)).toBeUndefined();

    await commit(database, versionId, "hash-q");
    expect(await loadCommittedVersionByR2Key(database, key)).toMatchObject({
      id: versionId,
      contentSha256: "hash-q",
      scanVerdict: "unscanned",
      scanEngineVersion: null,
    });
    expect(await loadCommittedVersionByR2Key(database, "files/does-not-exist")).toBeUndefined();
  });
});
