import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FileId, FileVersionId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { checkFileInfo, getFile } from "../../src/editing/wopi-routes.ts";
import type { EditTokenClaims } from "../../src/editing/wopi-token.ts";
import type { CurrentObjectMeta } from "../../src/editing/document-session.ts";
import { applyPerFirmMigrations } from "../support/apply-per-firm-migrations.ts";

// The WOPI CheckFileInfo + GetFile handlers, exercised over real Miniflare bindings (the firm D1 from
// the dev pool, the R2 binding). The handlers receive already-verified token claims (the guard +
// firm-database resolution happen upstream), so these tests construct the claims directly and assert
// the protocol shaping: UserCanWrite tracks capability, the file's display name and size come from the
// firm metadata, LastModifiedTime echoes the session's host-assigned timestamp, and GetFile streams
// the version bytes for a read-only viewer but the live `current` working object for an edit session.

const ISO = "2026-06-20T00:00:00.000Z";
const memberId = newIdentifier("user");
let matterId: string;

// Seeds a clean file with one committed version and writes its bytes into the R2 binding at the
// version key — the minimal metadata chain CheckFileInfo/GetFile read from.
async function seedCleanFile(
  name: string,
  versionBytes: string,
): Promise<{ fileId: FileId; versionId: FileVersionId; versionKey: string }> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const versionKey = `files/${fileId}/${versionId}`;
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, NULL, NULL, NULL, ?4, ?4)",
  )
    .bind(fileId, matterId, name, ISO)
    .run();
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at) " +
      "VALUES (?1, ?2, 1, ?3, ?4, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', NULL, 'seed-hash', 'clean', ?5, ?6, ?6)",
  )
    .bind(versionId, fileId, versionKey, versionBytes.length, memberId, ISO)
    .run();
  await env.DB_FIRM_POOL_1.prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  await env.R2.put(versionKey, versionBytes);
  return { fileId, versionId, versionKey };
}

function claimsFor(
  fileId: FileId,
  versionId: FileVersionId,
  capability: "view" | "edit",
): EditTokenClaims {
  return {
    firmId: "firm_pool_one",
    matterId,
    fileId,
    versionId,
    memberId,
    capability,
    sessionId: "wopiSession_test",
    exp: Date.parse(ISO) + 60 * 60 * 1000,
    jti: "test-jti",
  };
}

beforeAll(async () => {
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  matterId = newIdentifier("matter");
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Editor', 'active', ?2)",
  )
    .bind(memberId, ISO)
    .run();
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Editing Matter', 'open', ?2, ?3, ?3)",
  )
    .bind(matterId, memberId, ISO)
    .run();
});

describe("WOPI CheckFileInfo", () => {
  it("reports the file name and size and grants write for an edit token", async () => {
    const { fileId, versionId } = await seedCleanFile("Brief.docx", "hello world");

    const info = await checkFileInfo(claimsFor(fileId, versionId, "edit"), {
      database: env.DB_FIRM_POOL_1,
      bucket: env.R2,
      currentMeta: null,
    });

    expect(info.BaseFileName).toBe("Brief.docx");
    expect(info.Size).toBe("hello world".length);
    expect(info.UserCanWrite).toBe(true);
    expect(info.UserId).toBe(memberId);
    expect(typeof info.OwnerId).toBe("string");
    expect(info.OwnerId.length).toBeGreaterThan(0);
    expect(typeof info.Version).toBe("string");
    expect(info.Version.length).toBeGreaterThan(0);
  });

  it("withholds write for a view token (capability is the gate, not a UI hint)", async () => {
    const { fileId, versionId } = await seedCleanFile("ReadOnly.docx", "abc");

    const info = await checkFileInfo(claimsFor(fileId, versionId, "view"), {
      database: env.DB_FIRM_POOL_1,
      bucket: env.R2,
      currentMeta: null,
    });

    expect(info.UserCanWrite).toBe(false);
  });

  it("echoes the session's host-assigned timestamp as LastModifiedTime when a live session set it", async () => {
    const { fileId, versionId } = await seedCleanFile("Live.docx", "draft");
    const currentMeta: CurrentObjectMeta = {
      sha256: "live-hash",
      sizeBytes: 12345,
      wopiTimestamp: "2026-06-21T09:30:00.000Z",
    };

    const info = await checkFileInfo(claimsFor(fileId, versionId, "edit"), {
      database: env.DB_FIRM_POOL_1,
      bucket: env.R2,
      currentMeta,
    });

    expect(info.LastModifiedTime).toBe("2026-06-21T09:30:00.000Z");
    // The live working-copy size supersedes the committed version's size.
    expect(info.Size).toBe(12345);
  });
});

describe("WOPI GetFile", () => {
  it("streams the committed version bytes for a read-only viewer", async () => {
    const { fileId, versionId } = await seedCleanFile("View.docx", "committed-bytes");

    const response = await getFile(claimsFor(fileId, versionId, "view"), {
      database: env.DB_FIRM_POOL_1,
      bucket: env.R2,
      currentMeta: null,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("committed-bytes");
  });

  it("streams the live `current` working object for an edit session", async () => {
    const { fileId, versionId } = await seedCleanFile("Edit.docx", "committed-bytes");
    const currentKey = `files/${fileId}/current`;
    await env.R2.put(currentKey, "live-working-copy");
    const currentMeta: CurrentObjectMeta = {
      sha256: "live-hash",
      sizeBytes: "live-working-copy".length,
      wopiTimestamp: "2026-06-21T10:00:00.000Z",
    };

    const response = await getFile(claimsFor(fileId, versionId, "edit"), {
      database: env.DB_FIRM_POOL_1,
      bucket: env.R2,
      currentMeta,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("live-working-copy");
  });

  it("falls back to the committed version when an edit session has not yet materialized `current`", async () => {
    const { fileId, versionId } = await seedCleanFile("Fresh.docx", "version-bytes");

    const response = await getFile(claimsFor(fileId, versionId, "edit"), {
      database: env.DB_FIRM_POOL_1,
      bucket: env.R2,
      currentMeta: null,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("version-bytes");
  });
});
