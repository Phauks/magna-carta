import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FileId,
  FileVersionId,
  FirmId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { createApp } from "../src/http/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The Owner/Admin role id is a committed literal from 0002_member-rbac.sql.
const OWNER_ADMIN_ROLE_ID = "role_Gw-zKO8hOHQuNv2bWokMp";

const app = createApp();

let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  // The firm's FirmDatabase Durable Object self-migrates on first access (resolved by firmId), so
  // create the firm row first, then reach its database.
  poolFirmId = (
    await seedFirm({ name: "File Integrity Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  // tools:fileIntegrity is already seeded onto Owner/Admin by the baseline migration; granting it
  // directly is an idempotent belt so this suite does not depend on migration ordering.
  await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare("INSERT OR IGNORE INTO role_permission (id, role_id, permission) VALUES (?1, ?2, ?3)")
    .bind("rolePermission_FileIntegrityOwnerTest0001", OWNER_ADMIN_ROLE_ID, "tools:fileIntegrity")
    .run();
});

describe("POST /api/v1/file-integrity/hash", () => {
  it("returns all five digests for the streamed body", async () => {
    const { userId } = await seedCredentialedUser("file-integrity-ok@example.com", {
      userName: "Integrity OK",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Integrity OK", poolFirmId);
    const cookie = await signInForSessionCookie("file-integrity-ok@example.com");
    const response = await app.request(
      "https://example.com/api/v1/file-integrity/hash",
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/octet-stream",
          "content-length": "3",
        },
        body: new TextEncoder().encode("abc"),
      },
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      algorithms: { sha256: string; md5: string };
      sizeBytes: number;
    };
    expect(body.algorithms.sha256).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(body.algorithms.md5).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(body.sizeBytes).toBe(3);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const response = await app.request(
      "https://example.com/api/v1/file-integrity/hash",
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new TextEncoder().encode("abc"),
      },
      env,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});

describe("POST /api/v1/file-integrity/verify", () => {
  let verifyOwnerCookie: string;
  let verifyMatterId: MatterId;
  let verifyOwnerUserId: UserId;

  // Seed the ISO timestamp once per describe — stable enough for test rows.
  const ISO = "2026-06-25T00:00:00.000Z";

  // Seeds a committed clean file whose R2 bytes are at the version's key. contentSha256 is the
  // SHA-256 hex of the bytes being stored (pre-computed by the caller so the seeder stays a pure
  // data helper and never re-hashes).
  async function seedCleanFile(
    bytes: Uint8Array,
    contentSha256: string,
  ): Promise<{ fileId: FileId; versionId: FileVersionId; r2Key: string }> {
    const fileId = newIdentifier("file");
    const versionId = newIdentifier("fileVersion");
    const r2Key = `files/${fileId}/${versionId}`;
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'test.txt', NULL, NULL, NULL, ?3, ?3)",
      )
      .bind(fileId, verifyMatterId, ISO)
      .run();
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at, inline_playable, storage_class, storage_encoding, artifact_role) " +
          "VALUES (?1, ?2, 1, ?3, ?4, 'application/octet-stream', 'text/plain', ?5, 'clean', ?6, ?7, ?7, NULL, 'standard', 'full', 'original')",
      )
      .bind(versionId, fileId, r2Key, bytes.byteLength, contentSha256, verifyOwnerUserId, ISO)
      .run();
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
      .bind(fileId, versionId)
      .run();
    await env.R2.put(r2Key, bytes);
    return { fileId, versionId, r2Key };
  }

  beforeAll(async () => {
    const { userId } = await seedCredentialedUser("file-integrity-verify@example.com", {
      userName: "Integrity Verify Owner",
      firmId: poolFirmId,
    });
    verifyOwnerUserId = userId;
    await mirrorMemberWithOwnerRole(userId, "Integrity Verify Owner", poolFirmId);
    verifyOwnerCookie = await signInForSessionCookie("file-integrity-verify@example.com");

    verifyMatterId = newIdentifier("matter");
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Verify Test Matter', 'open', ?2, ?3, ?3)",
      )
      .bind(verifyMatterId, verifyOwnerUserId, ISO)
      .run();
  });

  it("matches a stored file's bytes against its ingest baseline and records an audit row", async () => {
    const bytes = new TextEncoder().encode("abc");
    // SHA-256 of "abc" — the known correct digest for the bytes being stored.
    const sha256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    const { fileId, versionId } = await seedCleanFile(bytes, sha256);

    const response = await app.request(
      "https://example.com/api/v1/file-integrity/verify",
      {
        method: "POST",
        headers: {
          cookie: verifyOwnerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ fileId }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      comparison: string;
      algorithms: { sha256: string };
      sizeBytes: number;
      baselineSha256: string;
      receipt: { verification: { auditLogId: string } };
    };
    expect(body.comparison).toBe("match");
    expect(body.algorithms.sha256).toBe(sha256);
    expect(body.sizeBytes).toBe(3);
    expect(body.baselineSha256).toBe(sha256);
    expect(body.receipt.verification.auditLogId).toBeTruthy();

    // Exactly one file.integrity_verified audit row must exist for this file (the subject_id).
    const auditRow = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "SELECT COUNT(*) AS count FROM audit_log WHERE event = 'file.integrity_verified' AND subject_id = ?1",
      )
      .bind(fileId)
      .first<{ count: number }>();
    expect(auditRow?.count).toBe(1);

    // The receipt's auditLogId must match the row that was written.
    const auditIdRow = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "SELECT id FROM audit_log WHERE event = 'file.integrity_verified' AND subject_id = ?1",
      )
      .bind(fileId)
      .first<{ id: string }>();
    expect(auditIdRow?.id).toBe(body.receipt.verification.auditLogId);

    // Silence the unused versionId warning — the variable is declared in the destructure and
    // serves as documentation that the test seeds exactly one version.
    void versionId;
  });

  it("reports mismatch when the stored bytes were altered after ingest", async () => {
    const bytes = new TextEncoder().encode("abc");
    const sha256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    const { fileId, r2Key } = await seedCleanFile(bytes, sha256);

    // Overwrite the R2 object with different bytes — the route must report a mismatch.
    await env.R2.put(r2Key, new TextEncoder().encode("tampered"));

    const response = await app.request(
      "https://example.com/api/v1/file-integrity/verify",
      {
        method: "POST",
        headers: {
          cookie: verifyOwnerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ fileId }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { comparison: string };
    expect(body.comparison).toBe("mismatch");
  });

  it("reports no-baseline when the stored version has no ingest SHA-256 and records an audit row", async () => {
    const bytes = new TextEncoder().encode("abc");
    // Seed a clean version with size_bytes set but content_sha256 NULL — the no-baseline path.
    const fileId = newIdentifier("file");
    const versionId = newIdentifier("fileVersion");
    const r2Key = `files/${fileId}/${versionId}`;
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'test.txt', NULL, NULL, NULL, ?3, ?3)",
      )
      .bind(fileId, verifyMatterId, ISO)
      .run();
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at, inline_playable, storage_class, storage_encoding, artifact_role) " +
          "VALUES (?1, ?2, 1, ?3, ?4, 'application/octet-stream', 'text/plain', NULL, 'clean', ?5, ?6, ?6, NULL, 'standard', 'full', 'original')",
      )
      .bind(versionId, fileId, r2Key, bytes.byteLength, verifyOwnerUserId, ISO)
      .run();
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
      .bind(fileId, versionId)
      .run();
    await env.R2.put(r2Key, bytes);

    const response = await app.request(
      "https://example.com/api/v1/file-integrity/verify",
      {
        method: "POST",
        headers: {
          cookie: verifyOwnerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ fileId }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      comparison: string;
      baselineSha256: string | null;
    };
    expect(body.comparison).toBe("no-baseline");
    expect(body.baselineSha256).toBeNull();

    const auditCount = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "SELECT COUNT(*) AS count FROM audit_log WHERE event = 'file.integrity_verified' AND subject_id = ?1",
      )
      .bind(fileId)
      .first<{ count: number }>();
    expect(auditCount?.count).toBe(1);
  });

  it("returns 401 for an unauthenticated request", async () => {
    const response = await app.request(
      "https://example.com/api/v1/file-integrity/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileId: "file_abc12345678901234567890" }),
      },
      env,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("returns 404 when the file has no clean current version", async () => {
    // A file that does not exist in this firm resolves to no clean version.
    const response = await app.request(
      "https://example.com/api/v1/file-integrity/verify",
      {
        method: "POST",
        headers: {
          cookie: verifyOwnerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ fileId: newIdentifier("file") }),
      },
      env,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});
