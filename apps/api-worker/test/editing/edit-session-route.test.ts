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
  mirrorMemberWithRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "../support/test-auth.ts";

// The editor-launch route over the real chokepoint + Miniflare bindings. Both members here hold
// nothing but a SEEDED ROLE — no direct grant anywhere in this file — because the question this
// suite has to answer is whether an ordinary member of an ordinary firm can open the editor at all.
// A Paralegal can (documents:edit is seeded to the three content-writing seats) and a Read-only
// seat cannot, which is the denial. The launch mints a real WOPI token, asserted by verifying it
// back.

const ISO = "2026-06-20T00:00:00.000Z";
let firmId: FirmId;
let firmDb: ReturnType<typeof firmDatabaseHandle>;
let matterId: MatterId;
let editorUserId: UserId;
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
    .bind(versionId, id, r2Key, editorUserId, ISO)
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

  // A Paralegal, holding documents:edit through the seeded role and nothing else. If the seed ever
  // stops reaching this seat the launch stops working here, which is the failure the firm would see.
  const editor = await seedCredentialedUser("edit-paralegal@example.com", {
    userName: "Edit Paralegal",
    firmId,
  });
  editorUserId = editor.userId;
  await mirrorMemberWithRole(editor.userId, "Edit Paralegal", firmId, "Paralegal");
  editorCookie = await signInForSessionCookie("edit-paralegal@example.com");

  // A Read-only seat: a full member of the same firm, with sight of the matter and no grant that
  // lets them open the document for writing.
  const noPerm = await seedCredentialedUser("edit-noperm@example.com", {
    userName: "No Permission",
    firmId,
  });
  await mirrorMemberWithRole(noPerm.userId, "No Permission", firmId, "Read-only");
  noPermCookie = await signInForSessionCookie("edit-noperm@example.com");

  matterId = newIdentifier("matter");
  await firmDb
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Editing Matter', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, editorUserId, ISO)
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
  it("returns the editor URL and a verifiable edit token for a member holding documents:edit by role alone", async () => {
    const response = await launch(`/api/v1/documents/${fileId}/edit-session`, editorCookie);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      editorUrl: string;
      editorOrigin: string;
      accessToken: string;
      accessTokenTtl: number;
      recordsChanges: boolean;
    };
    // The editor URL carries the host's WOPISrc pointing back at this file's WOPI endpoint.
    expect(body.editorUrl).toContain("WOPISrc=");
    expect(decodeURIComponent(body.editorUrl)).toContain(`/wopi/files/${fileId}`);
    expect(body.editorOrigin).toBe(new URL(body.editorUrl).origin);
    expect(body.accessTokenTtl).toBeGreaterThan(Date.parse(ISO));
    // The firm's editing policy defaults to recording, and the launch says so for the screen that
    // hides the marks once the document is up.
    expect(body.recordsChanges).toBe(true);

    const claims = await verifyEditToken(body.accessToken, env);
    expect(claims.fileId).toBe(fileId);
    expect(claims.capability).toBe("edit");
    expect(claims.firmId).toBe(firmId);
    // The origin that asked for the launch rides in the token, because the WOPI callbacks have no
    // request of their own to read it from — it is what CheckFileInfo returns as PostMessageOrigin,
    // and without it the editor never reports itself up to the screen framing it.
    expect(claims.appOrigin).toBe("https://example.com");
  });

  it("denies a Read-only member, whose seat the documents:edit seed deliberately does not reach", async () => {
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

function read(path: string, cookie: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, { headers: { cookie } });
}

describe("GET /api/v1/documents/{fileId}/edit-session/progress", () => {
  it("answers every mark null before any launch, and the launch's own record after it", async () => {
    const { fileId: freshFileId } = await seedCleanFile();
    const before = await read(
      `/api/v1/documents/${freshFileId}/edit-session/progress`,
      editorCookie,
    );
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({
      launchedAt: null,
      checkFileInfoAt: null,
      getFileAt: null,
      lastCallback: null,
    });

    expect(
      (await launch(`/api/v1/documents/${freshFileId}/edit-session`, editorCookie)).status,
    ).toBe(200);
    const after = await read(
      `/api/v1/documents/${freshFileId}/edit-session/progress`,
      editorCookie,
    );
    expect(after.status).toBe(200);
    const body = (await after.json()) as { launchedAt: string | null; checkFileInfoAt: null };
    expect(body.launchedAt).not.toBeNull();
    // The editor has not called back yet: the launch is the only mark.
    expect(body.checkFileInfoAt).toBeNull();
  });

  it("is readable by a member who can see the document but cannot edit it", async () => {
    const response = await read(`/api/v1/documents/${fileId}/edit-session/progress`, noPermCookie);
    expect(response.status).toBe(200);
  });

  it("404s a file that does not exist in the firm", async () => {
    const response = await read(
      `/api/v1/documents/${newIdentifier("file")}/edit-session/progress`,
      editorCookie,
    );
    expect(response.status).toBe(404);
  });
});
