import { describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { FileId } from "@magna-carta/identifiers/types";
import { freshDatabase, seedMatter } from "./support.ts";
import { getCurrentVersionForIntegrity } from "../src/queries.ts";

async function seedFileWithCleanVersion(
  database: BatchDatabase,
  matterId: string,
  overrides: {
    contentSha256?: string | null;
    r2Key?: string;
    sizeBytes?: number | null;
  } = {},
): Promise<{ fileId: FileId; versionId: string }> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const r2Key = overrides.r2Key ?? `files/${fileId}/${versionId}`;
  await database
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'f', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    .bind(fileId, matterId)
    .run();
  await database
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at, inline_playable, storage_class, storage_encoding, artifact_role) VALUES (?1, ?2, 1, ?3, ?4, 'application/octet-stream', 'application/octet-stream', ?5, 'clean', 'user_a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, 'standard', 'full', 'original')",
    )
    .bind(
      versionId,
      fileId,
      r2Key,
      overrides.sizeBytes !== undefined ? overrides.sizeBytes : 2048,
      overrides.contentSha256 !== undefined ? overrides.contentSha256 : null,
    )
    .run();
  await database
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  return { fileId: fileId as FileId, versionId };
}

async function seedFileWithPendingVersionOnly(
  database: BatchDatabase,
  matterId: string,
): Promise<FileId> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  await database
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'f', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    .bind(fileId, matterId)
    .run();
  await database
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at, inline_playable, storage_class, storage_encoding, artifact_role) VALUES (?1, ?2, 1, ?3, 1024, 'application/octet-stream', 'application/octet-stream', NULL, 'pending', 'user_a', '2026-01-01T00:00:00.000Z', NULL, NULL, 'standard', 'full', 'original')",
    )
    .bind(versionId, fileId, `files/${fileId}/${versionId}`)
    .run();
  // current_version_id remains NULL — a pending-only file has no committed version
  return fileId as FileId;
}

describe("getCurrentVersionForIntegrity", () => {
  it("returns the r2Key, sizeBytes, and contentSha256 for a committed clean version", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const sha256 = "abc123deadbeef0000000000000000000000000000000000000000000000cafe";
    const { fileId, versionId } = await seedFileWithCleanVersion(database, matterId, {
      contentSha256: sha256,
      r2Key: "files/thefile/theversion",
      sizeBytes: 4096,
    });
    const result = await getCurrentVersionForIntegrity(database, fileId);
    expect(result).toEqual({
      id: versionId,
      r2Key: "files/thefile/theversion",
      sizeBytes: 4096,
      contentSha256: sha256,
    });
  });

  it("returns undefined for a file with only a pending version", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const fileId = await seedFileWithPendingVersionOnly(database, matterId);
    expect(await getCurrentVersionForIntegrity(database, fileId)).toBeUndefined();
  });
});
