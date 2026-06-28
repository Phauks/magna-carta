import { env, SELF } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FileId,
  FileVersionId,
  FirmId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyEditToken } from "../../src/editing/wopi-token.ts";
import { applyControlPlaneMigrations } from "../support/apply-control-plane-migrations.ts";
import { firmDatabaseHandle } from "../support/firm-database-handle.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "../support/test-auth.ts";

// The editor-launch route over the real chokepoint + Miniflare bindings. documents:edit is granted
// directly to one owner (not its role), so a second Owner/Admin member without the grant exercises
// the firm-level RBAC denial. The launch mints a real WOPI token, asserted by verifying it back.

const ISO = "2026-06-20T00:00:00.000Z";
let firmId: FirmId;
let firmDb: ReturnType<typeof firmDatabaseHandle>;
let matterId: MatterId;
let ownerUserId: UserId;
let editorCookie: string;
let noPermCookie: string;
let fileId: FileId;

async function seedCleanFile(): Promise<{ fileId: FileId; versionId: FileVersionId }> {
  const id = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const r2Key = `files/${id}/${versionId}`;
  await firmDb
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'Brief.docx', NULL, NULL, NULL, ?3, ?3)",
    )
    .bind(id, matterId, ISO)
    .run();
  await firmDb
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at) " +
        "VALUES (?1, ?2, 1, ?3, 10, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', NULL, 'seed-hash', 'clean', ?4, ?5, ?5)",
    )
    .bind(versionId, id, r2Key, ownerUserId, ISO)
    .run();
  await firmDb
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(id, versionId)
    .run();
  return { fileId: id, versionId };
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Editing Launch Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  firmDb = firmDatabaseHandle(firmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(firmId)
    .run();

  const owner = await seedCredentialedUser("edit-owner@example.com", {
    userName: "Edit Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Edit Owner", firmId);
  // Grant documents:edit directly to this member (the role-seeding migration lands at integration).
  await firmDb
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, expires_at, granted_by, created_at) VALUES (?1, ?2, 'documents:edit', NULL, ?2, ?3)",
    )
    .bind(newIdentifier("grant"), owner.userId, ISO)
    .run();
  editorCookie = await signInForSessionCookie("edit-owner@example.com");

  const noPerm = await seedCredentialedUser("edit-noperm@example.com", {
    userName: "No Permission",
    firmId,
  });
  await mirrorMemberWithOwnerRole(noPerm.userId, "No Permission", firmId);
  noPermCookie = await signInForSessionCookie("edit-noperm@example.com");

  matterId = newIdentifier("matter");
  await firmDb
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Editing Matter', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, ownerUserId, ISO)
    .run();
  ({ fileId } = await seedCleanFile());
});

function launch(path: string, cookie: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com", cookie },
  });
}

describe("POST /api/v1/documents/{fileId}/edit-session", () => {
  it("returns the editor URL and a verifiable edit token for a permitted member", async () => {
    const response = await launch(`/api/v1/documents/${fileId}/edit-session`, editorCookie);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      editorUrl: string;
      editorOrigin: string;
      accessToken: string;
      accessTokenTtl: number;
    };
    // The editor URL carries the host's WOPISrc pointing back at this file's WOPI endpoint.
    expect(body.editorUrl).toContain("WOPISrc=");
    expect(decodeURIComponent(body.editorUrl)).toContain(`/wopi/files/${fileId}`);
    expect(body.editorOrigin).toBe(new URL(body.editorUrl).origin);
    expect(body.accessTokenTtl).toBeGreaterThan(Date.parse(ISO));

    const claims = await verifyEditToken(body.accessToken, env);
    expect(claims.fileId).toBe(fileId);
    expect(claims.capability).toBe("edit");
    expect(claims.firmId).toBe(firmId);
  });

  it("denies a member without documents:edit", async () => {
    const response = await launch(`/api/v1/documents/${fileId}/edit-session`, noPermCookie);
    expect(response.status).toBe(403);
  });

  it("404s a file that does not exist in the firm", async () => {
    const response = await launch(
      `/api/v1/documents/${newIdentifier("file")}/edit-session`,
      editorCookie,
    );
    expect(response.status).toBe(404);
  });
});
