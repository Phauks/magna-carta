import { env, SELF } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FileId, FirmId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyEditToken } from "../../src/editing/wopi-token.ts";
import { applyControlPlaneMigrations } from "../support/apply-control-plane-migrations.ts";
import { firmDatabaseHandle } from "../support/firm-database-handle.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "../support/test-auth.ts";

// Co-editing join + the read-only viewer over the real chokepoint. Both members hold nothing but a
// seeded role: an Admin editor (documents:edit reaches the content-writing seats) and a
// Read-only viewer with matter and file access but no edit capability drive the two launch routes;
// the join is asserted by decoding both tokens and comparing their session ids.

const ISO = "2026-06-20T00:00:00.000Z";
let firmId: FirmId;
let firmDb: ReturnType<typeof firmDatabaseHandle>;
let matterId: MatterId;
let ownerUserId: UserId;
let editorCookie: string;
let viewerCookie: string;
let fileId: FileId;

async function seedCleanFile(): Promise<FileId> {
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
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, content_sha256, status, uploaded_by, created_at, committed_at) " +
        "VALUES (?1, ?2, 1, ?3, 10, 'seed-hash', 'clean', ?4, ?5, ?5)",
    )
    .bind(versionId, id, `files/${id}/${versionId}`, ownerUserId, ISO)
    .run();
  await firmDb
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(id, versionId)
    .run();
  return id;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Co-editing Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  firmDb = firmDatabaseHandle(firmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(firmId)
    .run();

  const owner = await seedCredentialedUser("coedit-owner@example.com", { firmId });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Co-editing Owner", firmId);
  editorCookie = await signInForSessionCookie("coedit-owner@example.com");

  // A second member with file access and no seat that carries documents:edit — the read-only viewer.
  const viewer = await seedCredentialedUser("coedit-viewer@example.com", { firmId });
  await mirrorMemberWithRole(viewer.userId, "Co-editing Viewer", firmId, "Read-only");
  viewerCookie = await signInForSessionCookie("coedit-viewer@example.com");

  matterId = newIdentifier("matter");
  await firmDb
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'M', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, ownerUserId, ISO)
    .run();
  fileId = await seedCleanFile();
});

async function launchEdit(cookie: string): Promise<Response> {
  return SELF.fetch(`https://example.com/api/v1/documents/${fileId}/edit-session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com", cookie },
  });
}
async function launchView(cookie: string): Promise<Response> {
  return SELF.fetch(`https://example.com/api/v1/documents/${fileId}/view-session`, {
    headers: { cookie },
  });
}
const tokenOf = async (response: Response) =>
  ((await response.json()) as { accessToken: string }).accessToken;

describe("co-editing join and the read-only viewer", () => {
  it("two edit launches join one session (shared session id) and flip the file to coediting", async () => {
    const first = await launchEdit(editorCookie);
    const second = await launchEdit(editorCookie);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const firstClaims = await verifyEditToken(await tokenOf(first), env);
    const secondClaims = await verifyEditToken(await tokenOf(second), env);
    expect(firstClaims.sessionId).toBe(secondClaims.sessionId);
    expect(firstClaims.capability).toBe("edit");

    const fileRow = await firmDb
      .prepare("SELECT edit_state FROM file WHERE id = ?1")
      .bind(fileId)
      .first<{ edit_state: string }>();
    expect(fileRow?.edit_state).toBe("coediting");
  });

  it("lets a member without documents:edit open a read-only viewer that joins the live session", async () => {
    // A live editor session exists from the test above (or open one to be order-independent).
    const editClaims = await verifyEditToken(await tokenOf(await launchEdit(editorCookie)), env);

    const viewResponse = await launchView(viewerCookie);
    expect(viewResponse.status).toBe(200);
    const viewClaims = await verifyEditToken(await tokenOf(viewResponse), env);
    expect(viewClaims.capability).toBe("view");
    // The viewer joins the same live session read-only.
    expect(viewClaims.sessionId).toBe(editClaims.sessionId);
  });

  it("refuses an edit launch from a Read-only member, whose seat carries no documents:edit", async () => {
    const response = await launchEdit(viewerCookie);
    expect(response.status).toBe(403);
  });
});
