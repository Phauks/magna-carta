import { env, SELF } from "cloudflare:test";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FileId,
  FileVersionId,
  FirmId,
  FolderId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The recovery surfaces over the slice 1·1 file metadata: the Deleted Files list (deleter resolved
// from the audit trail), restore (straight home / chosen folder / matter-root fallback), and the
// matter file-history read off audit_log. Clean files are seeded directly (upload+ingest is
// exercised elsewhere); the deletions, renames, and restores that produce the audit trail are driven
// through the real routes so the reads are tested against rows the platform actually writes.

let poolFirmId: FirmId;
let ownerCookie: string;
let readOnlyCookie: string;
let ownerUserId: UserId;

const ISO = "2026-06-13T00:00:00.000Z";

function firmDatabase() {
  return firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
}

async function seedMatter(title: string): Promise<MatterId> {
  const matterId = newIdentifier("matter");
  await firmDatabase()
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, ?4, ?4)",
    )
    .bind(matterId, title, ownerUserId, ISO)
    .run();
  return matterId;
}

async function seedFolder(matterId: MatterId, name: string): Promise<FolderId> {
  const id = newIdentifier("folder");
  await firmDatabase()
    .prepare(
      "INSERT INTO folder (id, matter_id, parent_folder_id, name, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?4, ?4)",
    )
    .bind(id, matterId, name, ISO)
    .run();
  return id;
}

// A clean file with one committed version — the same seeding shape files-routes.test.ts uses.
async function seedCleanFile(
  matterId: MatterId,
  name: string,
  folderId: FolderId | null,
  bytes = "bytes",
): Promise<{ fileId: FileId; versionId: FileVersionId }> {
  const database = firmDatabase();
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const r2Key = `files/${fileId}/${versionId}`;
  await database
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, ?5, ?5)",
    )
    .bind(fileId, matterId, folderId, name, ISO)
    .run();
  await database
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at) VALUES (?1, ?2, 1, ?3, ?4, 'application/octet-stream', 'text/plain', 'hash', 'clean', ?5, ?6, ?6)",
    )
    .bind(versionId, fileId, r2Key, bytes.length, ownerUserId, ISO)
    .run();
  await database
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  await env.R2.put(r2Key, bytes);
  return { fileId, versionId };
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Deleted Files Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("deleted-owner@example.com", {
    userName: "Deleted Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Deleted Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("deleted-owner@example.com");

  const readOnly = await seedCredentialedUser("deleted-readonly@example.com", {
    userName: "Deleted Read Only",
    firmId: poolFirmId,
  });
  await mirrorMemberWithRole(readOnly.userId, "Deleted Read Only", poolFirmId, "Read-only");
  readOnlyCookie = await signInForSessionCookie("deleted-readonly@example.com");
});

function headers(cookie: string, withKey = false): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withKey ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  };
}

async function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { cookie, origin: "https://example.com" },
  });
}
async function patch(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PATCH",
    headers: headers(cookie, true),
    body: JSON.stringify(body),
  });
}
async function del(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "DELETE",
    headers: headers(cookie, true),
  });
}
async function restore(
  fileId: string,
  body: unknown = {},
  cookie = ownerCookie,
): Promise<Response> {
  return SELF.fetch(`https://example.com/api/v1/files/${fileId}/restore`, {
    method: "POST",
    headers: headers(cookie, true),
    body: JSON.stringify(body),
  });
}

interface DeletedRow {
  id: string;
  name: string;
  folderId: string | null;
  documentTypeId: string | null;
  deletedAt: string;
  deletedBy: string | null;
  deletedByName: string | null;
  currentVersionId: string | null;
  sizeBytes: number | null;
  sniffedContentType: string | null;
}

describe("GET /api/v1/matters/{matterId}/files/deleted", () => {
  it("lists a deleted file with its deleter resolved from the audit trail, and not a live one", async () => {
    const matterId = await seedMatter("Deleted Listing Matter");
    const folderId = await seedFolder(matterId, "Pleadings");
    const live = await seedCleanFile(matterId, "live.txt", folderId);
    const doomed = await seedCleanFile(matterId, "doomed.txt", folderId, "doomed-bytes");
    expect((await del(`/api/v1/files/${doomed.fileId}`)).status).toBe(200);

    const response = await get(`/api/v1/matters/${matterId}/files/deleted`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: DeletedRow[]; nextCursor: string | null };
    expect(body.nextCursor).toBeNull();
    expect(body.data.map((row) => row.id)).toEqual([doomed.fileId]);
    const row = body.data[0];
    expect(row?.name).toBe("doomed.txt");
    expect(row?.folderId).toBe(folderId);
    expect(row?.deletedAt).toBeTruthy();
    expect(row?.deletedBy).toBe(ownerUserId);
    expect(row?.deletedByName).toBe("Deleted Owner");
    expect(row?.currentVersionId).toBe(doomed.versionId);
    expect(row?.sizeBytes).toBe("doomed-bytes".length);
    expect(row?.sniffedContentType).toBe("text/plain");
    expect(body.data.find((entry) => entry.id === live.fileId)).toBeUndefined();
  });

  it("is matter-scoped: another matter's deletion does not appear", async () => {
    const matterA = await seedMatter("Deleted Scope A");
    const matterB = await seedMatter("Deleted Scope B");
    const other = await seedCleanFile(matterB, "elsewhere.txt", null);
    expect((await del(`/api/v1/files/${other.fileId}`)).status).toBe(200);

    const response = await get(`/api/v1/matters/${matterA}/files/deleted`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: DeletedRow[] };
    expect(body.data).toEqual([]);
  });

  it("is readable by a Read-only member (the files.list read posture)", async () => {
    const matterId = await seedMatter("Deleted Read-only Matter");
    const response = await get(`/api/v1/matters/${matterId}/files/deleted`, readOnlyCookie);
    expect(response.status).toBe(200);
  });
});

describe("POST /api/v1/files/{id}/restore", () => {
  it("restores a deleted file straight home and writes the file.restored audit row", async () => {
    const matterId = await seedMatter("Restore Home Matter");
    const folderId = await seedFolder(matterId, "Home");
    const { fileId } = await seedCleanFile(matterId, "come-back.txt", folderId);
    expect((await del(`/api/v1/files/${fileId}`)).status).toBe(200);

    const response = await restore(fileId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { fileId: string; folderId: string | null };
    expect(body.fileId).toBe(fileId);
    expect(body.folderId).toBe(folderId);

    // Back in the default listing, gone from the deleted view.
    const list = await get(`/api/v1/files?matterId=${matterId}&folderId=${folderId}`);
    const listBody = (await list.json()) as { data: { id: string }[] };
    expect(listBody.data.map((row) => row.id)).toContain(fileId);
    const deletedList = await get(`/api/v1/matters/${matterId}/files/deleted`);
    const deletedBody = (await deletedList.json()) as { data: DeletedRow[] };
    expect(deletedBody.data.find((row) => row.id === fileId)).toBeUndefined();

    const audit = await firmDatabase()
      .prepare("SELECT event FROM audit_log WHERE subject_id = ?1 AND event = 'file.restored'")
      .bind(fileId)
      .first<{ event: string }>();
    expect(audit?.event).toBe("file.restored");
  });

  it("restores into an explicitly chosen folder", async () => {
    const matterId = await seedMatter("Restore Chosen Matter");
    const origin = await seedFolder(matterId, "Origin");
    const destination = await seedFolder(matterId, "Destination");
    const { fileId } = await seedCleanFile(matterId, "moved-home.txt", origin);
    expect((await del(`/api/v1/files/${fileId}`)).status).toBe(200);

    const response = await restore(fileId, { folderId: destination });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { folderId: string | null };
    expect(body.folderId).toBe(destination);
    const row = await firmDatabase()
      .prepare("SELECT folder_id, deleted_at FROM file WHERE id = ?1")
      .bind(fileId)
      .first<{ folder_id: string | null; deleted_at: string | null }>();
    expect(row?.folder_id).toBe(destination);
    expect(row?.deleted_at).toBeNull();
  });

  // The gone-folder fallback (restore lands at the matter root when the stored folder no longer
  // exists) is covered in packages/file-manager/test/file-service.test.ts: the Durable Object's
  // SQLite enforces foreign keys, so a dangling file.folder_id pointer cannot be seeded here — the
  // node pool can represent it with enforcement toggled off.
  it("restores to the matter root when the caller chooses it explicitly (folderId: null)", async () => {
    const matterId = await seedMatter("Restore Root Matter");
    const folderId = await seedFolder(matterId, "Origin Root");
    const { fileId } = await seedCleanFile(matterId, "rooted.txt", folderId);
    expect((await del(`/api/v1/files/${fileId}`)).status).toBe(200);

    const response = await restore(fileId, { folderId: null });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { folderId: string | null };
    expect(body.folderId).toBeNull();
    const row = await firmDatabase()
      .prepare("SELECT folder_id, deleted_at FROM file WHERE id = ?1")
      .bind(fileId)
      .first<{ folder_id: string | null; deleted_at: string | null }>();
    expect(row?.folder_id).toBeNull();
    expect(row?.deleted_at).toBeNull();
  });

  it("409s a restore of a file that is not deleted", async () => {
    const matterId = await seedMatter("Restore Live Matter");
    const { fileId } = await seedCleanFile(matterId, "alive.txt", null);
    const response = await restore(fileId);
    expect(response.status).toBe(409);
  });

  it("404s an unknown file and an unknown destination folder", async () => {
    const response = await restore(newIdentifier("file"));
    expect(response.status).toBe(404);

    const matterId = await seedMatter("Restore Unknown Folder Matter");
    const { fileId } = await seedCleanFile(matterId, "nowhere.txt", null);
    expect((await del(`/api/v1/files/${fileId}`)).status).toBe(200);
    const badDestination = await restore(fileId, { folderId: newIdentifier("folder") });
    expect(badDestination.status).toBe(404);
  });

  it("403s a Read-only member (restore rides files:delete)", async () => {
    const matterId = await seedMatter("Restore RBAC Matter");
    const { fileId } = await seedCleanFile(matterId, "guarded.txt", null);
    expect((await del(`/api/v1/files/${fileId}`)).status).toBe(200);
    const response = await restore(fileId, {}, readOnlyCookie);
    expect(response.status).toBe(403);
  });
});

interface HistoryRow {
  at: string;
  event: string;
  fileId: string;
  fileName: string;
  versionNumber: number | null;
  actorUserId: string | null;
  actorName: string | null;
  detail: unknown;
}

describe("GET /api/v1/matters/{matterId}/file-history", () => {
  it("returns the rename/delete/restore trail with resolved names, plus version-subject events", async () => {
    const matterId = await seedMatter("History Matter");
    const { fileId, versionId } = await seedCleanFile(matterId, "original.txt", null);

    // The version-subject shape (uploads/commits carry the version id): written directly since the
    // direct seed above bypassed the upload path.
    await insertAuditLogStatement(firmDatabase(), {
      id: newIdentifier("auditLog"),
      event: "file.upload_initiated",
      actorUserId: ownerUserId,
      subjectId: versionId,
      metadata: null,
      now: "2026-06-13T00:00:01.000Z",
    }).run();

    expect((await patch(`/api/v1/files/${fileId}`, { name: "renamed.txt" })).status).toBe(200);
    expect((await del(`/api/v1/files/${fileId}`)).status).toBe(200);
    expect((await restore(fileId)).status).toBe(200);

    const response = await get(`/api/v1/matters/${matterId}/file-history`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: HistoryRow[]; nextCursor: string | null };
    const events = body.data.map((row) => row.event);
    expect(events).toContain("file.upload_initiated");
    expect(events).toContain("file.renamed");
    expect(events).toContain("file.deleted");
    expect(events).toContain("file.restored");

    // Newest first on the audit clock.
    const stamps = body.data.map((row) => row.at);
    for (let index = 1; index < stamps.length; index += 1) {
      expect(stamps[index - 1]! >= stamps[index]!).toBe(true);
    }

    for (const row of body.data) {
      expect(row.fileId).toBe(fileId);
      // The CURRENT name, resolved at read time — including on rows recorded before the rename.
      expect(row.fileName).toBe("renamed.txt");
      expect(row.actorUserId).toBe(ownerUserId);
      expect(row.actorName).toBe("Deleted Owner");
    }
    const uploadRow = body.data.find((row) => row.event === "file.upload_initiated");
    expect(uploadRow?.versionNumber).toBe(1);
    const renameRow = body.data.find((row) => row.event === "file.renamed");
    expect(renameRow?.versionNumber).toBeNull();
    expect(renameRow?.detail).toBeNull();
  });

  it("is matter-scoped: a second matter's file events do not appear", async () => {
    const matterA = await seedMatter("History Scope A");
    const matterB = await seedMatter("History Scope B");
    const mine = await seedCleanFile(matterA, "mine.txt", null);
    const theirs = await seedCleanFile(matterB, "theirs.txt", null);
    expect((await patch(`/api/v1/files/${mine.fileId}`, { name: "mine-renamed.txt" })).status).toBe(
      200,
    );
    expect((await del(`/api/v1/files/${theirs.fileId}`)).status).toBe(200);

    const response = await get(`/api/v1/matters/${matterA}/file-history`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: HistoryRow[] };
    expect(body.data.length).toBeGreaterThan(0);
    for (const row of body.data) expect(row.fileId).toBe(mine.fileId);
  });

  it("pages on the (created_at, id) keyset", async () => {
    const matterId = await seedMatter("History Paging Matter");
    const { fileId } = await seedCleanFile(matterId, "busy.txt", null);
    // Three distinct-instant audit rows, seeded directly so the timestamps are controlled.
    for (let index = 0; index < 3; index += 1) {
      await insertAuditLogStatement(firmDatabase(), {
        id: newIdentifier("auditLog"),
        event: "file.renamed",
        actorUserId: ownerUserId,
        subjectId: fileId,
        metadata: null,
        now: `2026-06-13T00:00:0${index + 1}.000Z`,
      }).run();
    }
    const first = await get(`/api/v1/matters/${matterId}/file-history?pageSize=2`);
    const firstBody = (await first.json()) as { data: HistoryRow[]; nextCursor: string | null };
    expect(firstBody.data).toHaveLength(2);
    expect(firstBody.nextCursor).not.toBeNull();
    const second = await get(
      `/api/v1/matters/${matterId}/file-history?pageSize=2&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
    );
    const secondBody = (await second.json()) as { data: HistoryRow[]; nextCursor: string | null };
    expect(secondBody.data).toHaveLength(1);
    expect(secondBody.nextCursor).toBeNull();
    const seen = [...firstBody.data, ...secondBody.data].map((row) => row.at);
    expect(new Set(seen).size).toBe(3);
  });
});
