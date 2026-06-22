import { describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { FileId } from "@magna-carta/identifiers/types";
import { freshDatabase, seedMatter } from "./support.ts";
import { getCurrentCleanVersionForPreview } from "../src/queries.ts";

async function seedFileWithVersion(
  db: BatchDatabase,
  matterId: string,
  overrides: {
    status?: string;
    inlinePlayable?: "playable" | "download-only" | "indeterminate" | null;
    storageClass?: string;
    storageEncoding?: string;
    artifactRole?: string;
    sniffedContentType?: string | null;
    r2Key?: string;
    sizeBytes?: number;
  } = {},
): Promise<FileId> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const status = overrides.status ?? "clean";
  const r2Key = overrides.r2Key ?? `files/${fileId}/${versionId}`;
  await db
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'f', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    .bind(fileId, matterId)
    .run();
  await db
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at, inline_playable, storage_class, storage_encoding, artifact_role) " +
        "VALUES (?1, ?2, 1, ?3, ?4, 'application/octet-stream', ?5, 'hash', ?6, 'user_a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?7, ?8, ?9, ?10)",
    )
    .bind(
      versionId,
      fileId,
      r2Key,
      overrides.sizeBytes ?? 1234,
      overrides.sniffedContentType === undefined ? "video/mp4" : overrides.sniffedContentType,
      status,
      overrides.inlinePlayable ?? null,
      overrides.storageClass ?? "standard",
      overrides.storageEncoding ?? "full",
      overrides.artifactRole ?? "original",
    )
    .run();
  await db.prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1").bind(fileId, versionId).run();
  return fileId as FileId;
}

describe("getCurrentCleanVersionForPreview", () => {
  it("projects the verdict + storage facts off the current clean version", async () => {
    const db = freshDatabase();
    const matterId = await seedMatter(db);
    const fileId = await seedFileWithVersion(db, matterId, {
      inlinePlayable: "playable",
      storageClass: "standard",
      storageEncoding: "full",
      artifactRole: "original",
      sniffedContentType: "video/mp4",
      r2Key: "files/f/v",
      sizeBytes: 1234,
    });
    const version = await getCurrentCleanVersionForPreview(db, fileId);
    expect(version).toEqual({
      id: expect.any(String),
      r2Key: "files/f/v",
      sizeBytes: 1234,
      versionNumber: 1,
      inlinePlayable: "playable",
      storageClass: "standard",
      storageEncoding: "full",
      sniffedContentType: "video/mp4",
      artifactRole: "original",
    });
  });

  it("returns undefined for a non-clean version (status gate preserved)", async () => {
    const db = freshDatabase();
    const matterId = await seedMatter(db);
    const fileId = await seedFileWithVersion(db, matterId, { status: "quarantined", r2Key: "files/q/v" });
    expect(await getCurrentCleanVersionForPreview(db, fileId)).toBeUndefined();
  });
});
