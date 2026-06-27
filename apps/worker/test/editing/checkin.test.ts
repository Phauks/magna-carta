import { env, SELF } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  DocumentCheckoutId,
  FileId,
  FileVersionId,
  FirmId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "../support/apply-control-plane-migrations.ts";
import { firmDatabaseHandle } from "../support/firm-database-handle.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "../support/test-auth.ts";

// The offline check-in route over the real chokepoint: it validates the presented checkout, mints a
// pending check-in version (carrying the checkout id) plus an upload session, and returns a presigned
// PUT into the quarantine-ingest pipeline. The returning bytes are never opened by the host — they go
// straight to R2 and through the gate. documents:checkout governs both halves of the offline cycle.

const ISO = "2026-06-20T00:00:00.000Z";
let firmId: FirmId;
let firmDb: ReturnType<typeof firmDatabaseHandle>;
let matterId: MatterId;
let ownerUserId: UserId;
let ownerCookie: string;
let noPermCookie: string;

async function seedCheckedOutFile(): Promise<{
  fileId: FileId;
  baseVersionId: FileVersionId;
  checkoutId: DocumentCheckoutId;
}> {
  const fileId = newIdentifier("file");
  const baseVersionId = newIdentifier("fileVersion");
  await firmDb
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'Brief.docx', NULL, NULL, NULL, ?3, ?3)",
    )
    .bind(fileId, matterId, ISO)
    .run();
  await firmDb
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, content_sha256, status, uploaded_by, created_at, committed_at) VALUES (?1, ?2, 1, ?3, 10, 'seed-hash', 'clean', ?4, ?5, ?5)",
    )
    .bind(baseVersionId, fileId, `files/${fileId}/${baseVersionId}`, ownerUserId, ISO)
    .run();
  await firmDb
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, baseVersionId)
    .run();
  const checkoutId = newIdentifier("documentCheckout");
  await firmDb
    .prepare(
      "INSERT INTO document_checkout (id, file_id, holder_member_id, lock_type, base_version_id, acquired_at, last_activity_at, status, idle_release_at) VALUES (?1, ?2, ?3, 'offline_working_copy', ?4, ?5, ?5, 'active', NULL)",
    )
    .bind(checkoutId, fileId, ownerUserId, baseVersionId, ISO)
    .run();
  return { fileId, baseVersionId, checkoutId };
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Checkin Firm", databaseIdentifier: "DB_FIRM_POOL_1" })).firmId;
  firmDb = firmDatabaseHandle(firmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(firmId)
    .run();

  const owner = await seedCredentialedUser("checkin-owner@example.com", { firmId });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Checkin Owner", firmId);
  await firmDb
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, expires_at, granted_by, created_at) VALUES (?1, ?2, 'documents:checkout', NULL, ?2, ?3)",
    )
    .bind(newIdentifier("grant"), owner.userId, ISO)
    .run();
  ownerCookie = await signInForSessionCookie("checkin-owner@example.com");

  const noPerm = await seedCredentialedUser("checkin-noperm@example.com", { firmId });
  await mirrorMemberWithOwnerRole(noPerm.userId, "Checkin NoPerm", firmId);
  noPermCookie = await signInForSessionCookie("checkin-noperm@example.com");

  matterId = newIdentifier("matter");
  await firmDb
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'M', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, ownerUserId, ISO)
    .run();
});

function checkin(fileId: FileId, checkoutId: string, cookie: string): Promise<Response> {
  return SELF.fetch(`https://example.com/api/v1/documents/${fileId}/checkin`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com", cookie },
    body: JSON.stringify({ checkoutId }),
  });
}

describe("POST /api/v1/documents/{fileId}/checkin", () => {
  it("mints a pending check-in version and an open session, returning a presigned PUT", async () => {
    const { fileId, checkoutId } = await seedCheckedOutFile();

    const response = await checkin(fileId, checkoutId, ownerCookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      versionId: string;
      key: string;
      method: string;
      url: string;
    };
    expect(body.versionId).toMatch(/^fileVersion_/);
    expect(body.method).toBe("PUT");
    expect(body.url.length).toBeGreaterThan(0);
    expect(body.key).toBe(`files/${fileId}/${body.versionId}`);

    const version = await firmDb
      .prepare("SELECT status, checkout_id, version_number FROM file_version WHERE id = ?1")
      .bind(body.versionId)
      .first<{ status: string; checkout_id: string; version_number: number }>();
    expect(version).toEqual({ status: "pending", checkout_id: checkoutId, version_number: 2 });

    const session = await firmDb
      .prepare("SELECT status FROM upload_session WHERE file_version_id = ?1")
      .bind(body.versionId)
      .first<{ status: string }>();
    expect(session?.status).toBe("open");
  });

  it("404s a checkout that is not active against this file", async () => {
    const { fileId } = await seedCheckedOutFile();
    // A foreign / unknown checkout id is not an open checkout of this file.
    expect((await checkin(fileId, newIdentifier("documentCheckout"), ownerCookie)).status).toBe(
      404,
    );
  });

  it("404s when the checkout belongs to a different file", async () => {
    const { checkoutId } = await seedCheckedOutFile();
    const { fileId: otherFileId } = await seedCheckedOutFile();
    expect((await checkin(otherFileId, checkoutId, ownerCookie)).status).toBe(404);
  });

  it("denies a member without documents:checkout", async () => {
    const { fileId, checkoutId } = await seedCheckedOutFile();
    expect((await checkin(fileId, checkoutId, noPermCookie)).status).toBe(403);
  });
});
