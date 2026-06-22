import { env, runInDurableObject, SELF } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FileId, FirmId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, expect, it } from "vitest";
import { documentSessionStub } from "../../src/editing/document-session.ts";
import type { DocumentSession } from "../../src/editing/document-session.ts";
import { applyControlPlaneMigrations } from "../support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "../support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "../support/test-auth.ts";

// Soft-deleting a file with a live editing session reaps the session first, then destroys the live
// working copy (`current` R2 object + the current_* pointer) — the committed versions and their bytes
// are retained for recovery.

const ISO = "2026-06-20T00:00:00.000Z";
let firmId: FirmId;
let matterId: MatterId;
let ownerUserId: UserId;
let ownerCookie: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  firmId = (await seedFirm({ name: "Delete Firm", databaseIdentifier: "DB_FIRM_POOL_1" })).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(firmId)
    .run();
  const owner = await seedCredentialedUser("delete-owner@example.com", { firmId });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Delete Owner");
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO direct_grant (id, member_user_id, permission, expires_at, granted_by, created_at) VALUES (?1, ?2, 'files:delete', NULL, ?2, ?3)",
  )
    .bind(newIdentifier("grant"), owner.userId, ISO)
    .run();
  ownerCookie = await signInForSessionCookie("delete-owner@example.com");
  matterId = newIdentifier("matter");
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'M', 'open', ?2, ?3, ?3)",
  )
    .bind(matterId, ownerUserId, ISO)
    .run();
});

it("reaps the live session and destroys the working copy on soft-delete, retaining versions", async () => {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO file (id, matter_id, name, current_version_id, current_r2_key, current_sha256, current_size_bytes, edit_state, created_at, updated_at) VALUES (?1, ?2, 'Brief.docx', NULL, ?3, 'wc', 5, 'coediting', ?4, ?4)",
  )
    .bind(fileId, matterId, `files/${fileId}/current`, ISO)
    .run();
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, content_sha256, status, uploaded_by, created_at, committed_at) VALUES (?1, ?2, 1, ?3, 10, 'h', 'clean', ?4, ?5, ?5)",
  )
    .bind(versionId, fileId, `files/${fileId}/${versionId}`, ownerUserId, ISO)
    .run();
  await env.DB_FIRM_POOL_1.prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  // A live working copy + a live editing session.
  await env.R2.put(`files/${fileId}/current`, new Uint8Array([1, 2, 3, 4, 5]));
  await env.R2.put(`files/${fileId}/${versionId}`, new Uint8Array(10));
  const stub = documentSessionStub(env, fileId);
  await stub.joinEditor(ownerUserId, { fileId, bucketName: "R2" });

  const response = await SELF.fetch(`https://example.com/api/v1/files/${fileId}`, {
    method: "DELETE",
    headers: {
      origin: "https://example.com",
      cookie: ownerCookie,
      "idempotency-key": newIdentifier("grant"),
    },
  });
  expect(response.status).toBe(200);

  // The session is reaped.
  await runInDurableObject(stub, async (instance: DocumentSession) => {
    const state = await instance.getState();
    expect(state.participants).toEqual({});
    expect(state.sessionId).toBeNull();
  });

  // The working copy is destroyed and its pointer cleared; the file is soft-deleted.
  expect(await env.R2.get(`files/${fileId}/current`)).toBeNull();
  const file = await env.DB_FIRM_POOL_1.prepare(
    "SELECT current_r2_key, edit_state, deleted_at FROM file WHERE id = ?1",
  )
    .bind(fileId as FileId)
    .first<{ current_r2_key: string | null; edit_state: string; deleted_at: string | null }>();
  expect(file?.current_r2_key).toBeNull();
  expect(file?.edit_state).toBe("idle");
  expect(file?.deleted_at).not.toBeNull();

  // The committed version's bytes are retained.
  expect(await env.R2.get(`files/${fileId}/${versionId}`)).not.toBeNull();
});
