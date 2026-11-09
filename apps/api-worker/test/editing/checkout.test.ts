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
import { applyControlPlaneMigrations } from "../support/apply-control-plane-migrations.ts";
import { firmDatabaseHandle } from "../support/firm-database-handle.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "../support/test-auth.ts";

// The offline checkout route over the real chokepoint. Both members hold nothing but a seeded role:
// documents:checkout reaches the three content-writing seats, so an Admin has it and a
// Read-only seat does not, which is the RBAC denial. The presigned URL is the dev presigner's
// deterministic output (no R2 S3 creds off-production).

const ISO = "2026-06-20T00:00:00.000Z";
let firmId: FirmId;
let firmDb: ReturnType<typeof firmDatabaseHandle>;
let matterId: MatterId;
let ownerUserId: UserId;
let ownerCookie: string;
let noPermCookie: string;

async function seedCleanFile(): Promise<{ fileId: FileId; versionId: FileVersionId }> {
  const id = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  await firmDb
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'Brief.docx', NULL, NULL, NULL, ?3, ?3)",
    )
    .bind(id, matterId, ISO)
    .run();
  await firmDb
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, content_sha256, status, uploaded_by, created_at, committed_at) VALUES (?1, ?2, 1, ?3, 10, 'seed-hash', 'clean', ?4, ?5, ?5)",
    )
    .bind(versionId, id, `files/${id}/${versionId}`, ownerUserId, ISO)
    .run();
  await firmDb
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(id, versionId)
    .run();
  return { fileId: id, versionId };
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Checkout Firm", databaseIdentifier: "DB_FIRM_POOL_1" })).firmId;
  firmDb = firmDatabaseHandle(firmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(firmId)
    .run();

  // documents:checkout rides the seeded role — no direct grant here, so the suite exercises what an
  // ordinary firm actually has.
  const owner = await seedCredentialedUser("checkout-owner@example.com", { firmId });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Checkout Owner", firmId);
  ownerCookie = await signInForSessionCookie("checkout-owner@example.com");

  // A Read-only seat: the one the checkout seed deliberately does not reach.
  const noPerm = await seedCredentialedUser("checkout-noperm@example.com", { firmId });
  await mirrorMemberWithRole(noPerm.userId, "Checkout NoPerm", firmId, "Read-only");
  noPermCookie = await signInForSessionCookie("checkout-noperm@example.com");

  matterId = newIdentifier("matter");
  await firmDb
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'M', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, ownerUserId, ISO)
    .run();
});

function checkout(fileId: FileId, cookie: string): Promise<Response> {
  return SELF.fetch(`https://example.com/api/v1/documents/${fileId}/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com", cookie },
    body: "{}",
  });
}

describe("POST /api/v1/documents/{fileId}/checkout", () => {
  it("records an offline checkout against the current version and returns a presigned download URL", async () => {
    const { fileId, versionId } = await seedCleanFile();

    const response = await checkout(fileId, ownerCookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { checkoutId: string; presignedGetUrl: string };
    expect(body.checkoutId).toMatch(/^documentCheckout_/);
    expect(body.presignedGetUrl.length).toBeGreaterThan(0);

    const row = await firmDb
      .prepare(
        "SELECT file_id, holder_member_id, lock_type, base_version_id, status FROM document_checkout WHERE id = ?1",
      )
      .bind(body.checkoutId)
      .first<{
        file_id: string;
        holder_member_id: string;
        lock_type: string;
        base_version_id: string;
        status: string;
      }>();
    expect(row).toEqual({
      file_id: fileId,
      holder_member_id: ownerUserId,
      lock_type: "offline_working_copy",
      base_version_id: versionId,
      status: "active",
    });
  });

  it("404s a file with no committed version", async () => {
    const id = newIdentifier("file");
    await firmDb
      .prepare(
        "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, 'Empty.docx', ?3, ?3)",
      )
      .bind(id, matterId, ISO)
      .run();
    expect((await checkout(id, ownerCookie)).status).toBe(404);
  });

  it("denies a Read-only member, whose seat the documents:checkout seed does not reach", async () => {
    const { fileId } = await seedCleanFile();
    expect((await checkout(fileId, noPermCookie)).status).toBe(403);
  });
});
