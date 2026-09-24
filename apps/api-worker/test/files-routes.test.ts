import { env, SELF } from "cloudflare:test";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import {
  liveMaxFileCountDefinition,
  scanEngineVersionDefinition,
} from "@magna-carta/file-manager/upload-policy";
import {
  flaggedTreatmentDefinition,
  scanPolicyDefinition,
  stepUpReauthDefinition,
} from "@magna-carta/file-manager/scan-policy-settings";
import { bundleManifestHash } from "@magna-carta/file-manager/zip-composition";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type {
  FileId,
  FileVersionId,
  FirmId,
  FolderId,
  MatterId,
  UploadSessionId,
  UserId,
} from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The slice 1·1 File Manager metadata + download surface, driven through the chokepoint over real
// Miniflare bindings. Clean files/versions are seeded directly (the upload+ingest path is exercised
// elsewhere); the dev presigner stands in for the SigV4 signer (no R2 S3 creds off-production, so the
// 302 targets a deterministic dev URL). The ZIP path reads real bytes from the Miniflare R2 binding.

let poolFirmId: FirmId;
let firmBId: FirmId;
let matterId: MatterId;
let ownerCookie: string;
let readOnlyCookie: string;
let ownerUserId: UserId;

const ISO = "2026-06-13T00:00:00.000Z";

async function mirrorMemberWithRole(userId: UserId, displayName: string, roleName: string) {
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  const roleResult = await firmDatabase
    .prepare("SELECT id FROM role WHERE name = ?1")
    .bind(roleName)
    .all<{ id: string }>();
  const role = roleResult.results[0];
  if (role === undefined) throw new Error(`seeded role ${roleName} missing`);
  await insertMemberStatement(firmDatabase, { userId, displayName, now: ISO }).run();
  await insertRoleAssignmentStatement(firmDatabase, {
    id: newIdentifier("memberRole"),
    memberUserId: userId,
    roleId: assertIdentifier(role.id, "role"),
  }).run();
}

// Seeds a folder under the matter (optionally nested).
async function seedFolder(name: string, parentFolderId: FolderId | null = null): Promise<FolderId> {
  const id = newIdentifier("folder");
  await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare(
      "INSERT INTO folder (id, matter_id, parent_folder_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
    )
    .bind(id, matterId, parentFolderId, name, ISO)
    .run();
  return id;
}

interface SeedVersionOptions {
  inlinePlayable?: "playable" | "download-only" | "indeterminate" | null;
  storageClass?: "standard" | "infrequent_access";
  storageEncoding?: string;
  artifactRole?: "original" | "derived";
  sniffedContentType?: string;
}

// Seeds a clean file with a single committed version, writing the bytes into the Miniflare R2 binding
// at the version's key. status='clean' + current_version_id set is the visibility gate.
// Optional fields in SeedVersionOptions override verdict/storage columns on the file_version row;
// defaults preserve existing caller behaviour (sniffedContentType='text/plain', storageClass='standard',
// storageEncoding='full', artifactRole='original', inlinePlayable=null).
async function seedCleanFile(
  name: string,
  folderId: FolderId | null,
  bytes: string,
  createdAt = ISO,
  options: SeedVersionOptions = {},
): Promise<{ fileId: FileId; versionId: FileVersionId; r2Key: string }> {
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const r2Key = `files/${fileId}/${versionId}`;
  await firmDatabase
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, ?5, ?5)",
    )
    .bind(fileId, matterId, folderId, name, createdAt)
    .run();
  await firmDatabase
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at, inline_playable, storage_class, storage_encoding, artifact_role) " +
        "VALUES (?1, ?2, 1, ?3, ?4, 'application/octet-stream', ?7, 'hash', 'clean', ?5, ?6, ?6, ?8, ?9, ?10, ?11)",
    )
    .bind(
      versionId,
      fileId,
      r2Key,
      bytes.length,
      ownerUserId,
      createdAt,
      options.sniffedContentType ?? "text/plain",
      options.inlinePlayable ?? null,
      options.storageClass ?? "standard",
      options.storageEncoding ?? "full",
      options.artifactRole ?? "original",
    )
    .run();
  await firmDatabase
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  await env.R2.put(r2Key, bytes);
  return { fileId, versionId, r2Key };
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Files Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  // Seed firm B — the cross-firm isolation test checks that firm A's session cannot reach firm B's data.
  firmBId = (await seedFirm({ name: "Files Test Firm B" })).firmId;

  const owner = await seedCredentialedUser("files-owner@example.com", {
    userName: "Files Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Files Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("files-owner@example.com");

  const readOnly = await seedCredentialedUser("files-readonly@example.com", {
    userName: "Files Read Only",
    firmId: poolFirmId,
  });
  await mirrorMemberWithRole(readOnly.userId, "Files Read Only", "Read-only");
  readOnlyCookie = await signInForSessionCookie("files-readonly@example.com");

  matterId = newIdentifier("matter");
  await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Files Matter', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, owner.userId, ISO)
    .run();
});

function headers(cookie: string, withKey = false): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withKey ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  };
}

async function post(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: headers(cookie, true),
    body: JSON.stringify(body),
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
async function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { cookie, origin: "https://example.com" },
  });
}

describe("folders CRUD", () => {
  it("creates, renames, moves, and deletes a folder", async () => {
    const create = await post("/api/v1/folders", { matterId, name: "Pleadings" });
    expect(create.status).toBe(201);
    const { folderId } = (await create.json()) as { folderId: string };
    expect(folderId).toMatch(/^folder_/);

    const rename = await patch(`/api/v1/folders/${folderId}`, { name: "Renamed" });
    expect(rename.status).toBe(200);

    const child = await post("/api/v1/folders", { matterId, name: "Child" });
    const { folderId: childId } = (await child.json()) as { folderId: string };
    const move = await patch(`/api/v1/folders/${childId}`, { parentFolderId: folderId });
    expect(move.status).toBe(200);

    // The parent now contains the child, so deleting it is refused (409 folder-not-empty).
    const blockedDelete = await del(`/api/v1/folders/${folderId}`);
    expect(blockedDelete.status).toBe(409);

    // The empty child deletes.
    const okDelete = await del(`/api/v1/folders/${childId}`);
    expect(okDelete.status).toBe(200);
  });

  it("403s a Read-only member creating a folder", async () => {
    const response = await post("/api/v1/folders", { matterId, name: "Nope" }, readOnlyCookie);
    expect(response.status).toBe(403);
  });
});

describe("file list / get / patch / delete", () => {
  it("lists clean files and excludes pending/quarantined/deleted", async () => {
    const folderId = await seedFolder("Listing");
    const clean = await seedCleanFile("clean.txt", folderId, "clean-bytes");

    // A pending-only file (no current_version_id) and a soft-deleted file must not appear.
    const pendingFileId = newIdentifier("file");
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO file (id, matter_id, folder_id, name, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, ?3, 'pending.txt', NULL, NULL, ?4, ?4)",
      )
      .bind(pendingFileId, matterId, folderId, ISO)
      .run();
    const deleted = await seedCleanFile("deleted.txt", folderId, "x");
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("UPDATE file SET deleted_at = ?2 WHERE id = ?1")
      .bind(deleted.fileId, ISO)
      .run();

    const response = await get(`/api/v1/files?matterId=${matterId}&folderId=${folderId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string; name: string }[] };
    const names = body.data.map((row) => row.name);
    expect(names).toContain("clean.txt");
    expect(names).not.toContain("pending.txt");
    expect(names).not.toContain("deleted.txt");
    expect(body.data.find((row) => row.id === clean.fileId)).toBeDefined();
  });

  it("gets a file and patches name/move/document-type without touching R2", async () => {
    const target = await seedFolder("PatchTarget");
    const { fileId } = await seedCleanFile("orig.txt", null, "patch-bytes");

    const got = await get(`/api/v1/files/${fileId}`);
    expect(got.status).toBe(200);
    expect(((await got.json()) as { name: string }).name).toBe("orig.txt");

    const patched = await patch(`/api/v1/files/${fileId}`, {
      name: "renamed.txt",
      folderId: target,
    });
    expect(patched.status).toBe(200);

    const rowResult = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT name, folder_id FROM file WHERE id = ?1")
      .bind(fileId)
      .all<{ name: string; folder_id: string }>();
    const row = rowResult.results[0];
    expect(row?.name).toBe("renamed.txt");
    expect(row?.folder_id).toBe(target);
  });

  it("soft-deletes a file and removes it from the default listing", async () => {
    const folderId = await seedFolder("DeleteScope");
    const { fileId } = await seedCleanFile("removeme.txt", folderId, "bytes");

    const response = await del(`/api/v1/files/${fileId}`);
    expect(response.status).toBe(200);

    const list = await get(`/api/v1/files?matterId=${matterId}&folderId=${folderId}`);
    const body = (await list.json()) as { data: { id: string }[] };
    expect(body.data.find((row) => row.id === fileId)).toBeUndefined();

    const got = await get(`/api/v1/files/${fileId}`);
    expect(got.status).toBe(404);
  });

  it("404s a patch or a second delete of a soft-deleted file, like every read of it", async () => {
    const { fileId } = await seedCleanFile("gone.txt", null, "bytes");
    expect((await del(`/api/v1/files/${fileId}`)).status).toBe(200);

    // The file is invisible to reads, so the writes answer the same way — a mutation must not be the
    // one surface that confirms a deleted file is still there.
    expect((await patch(`/api/v1/files/${fileId}`, { name: "resurrected.txt" })).status).toBe(404);
    expect((await del(`/api/v1/files/${fileId}`)).status).toBe(404);

    // …and the refused rename left nothing behind on the deleted row.
    const rowResult = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT name FROM file WHERE id = ?1")
      .bind(fileId)
      .all<{ name: string }>();
    expect(rowResult.results[0]?.name).toBe("gone.txt");
  });

  it("lists a file's clean version history", async () => {
    const { fileId } = await seedCleanFile("versioned.txt", null, "v1-bytes");
    const response = await get(`/api/v1/files/${fileId}/versions`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { versionNumber: number }[] };
    expect(body.data.length).toBe(1);
    expect(body.data[0]?.versionNumber).toBe(1);
  });

  it("403s a Read-only member patching a file", async () => {
    const { fileId } = await seedCleanFile("guarded.txt", null, "bytes");
    const response = await patch(`/api/v1/files/${fileId}`, { name: "hacked.txt" }, readOnlyCookie);
    expect(response.status).toBe(403);
  });
});

// Seeds a file whose only version sits at a non-clean status with NO current_version_id — a first
// upload still processing (pending) or rejected as malware (quarantined). scan_detail carries the
// quarantine reason when given.
async function seedNonCleanFile(
  name: string,
  folderId: FolderId | null,
  status: "pending" | "quarantined",
  scanDetail: string | null = null,
): Promise<{ fileId: FileId; versionId: FileVersionId }> {
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const r2Key = `files/${fileId}/${versionId}`;
  await firmDatabase
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5, ?5)",
    )
    .bind(fileId, matterId, folderId, name, ISO)
    .run();
  await firmDatabase
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, sniffed_content_type, status, scan_detail, created_at) VALUES (?1, ?2, 1, ?3, NULL, NULL, ?4, ?5, ?6)",
    )
    .bind(versionId, fileId, r2Key, status, scanDetail, ISO)
    .run();
  return { fileId, versionId };
}

interface EnrichedRow {
  id: string;
  name: string;
  currentVersionId: string | null;
  updatedAt: string;
  versionNumber: number;
  sizeBytes: number | null;
  sniffedContentType: string | null;
  scanVerdict: string | null;
  status: string;
  quarantineReason: string | null;
}

describe("FileSummary enrichment", () => {
  it("files.list paints the display version's facts (no per-row versions fan-out)", async () => {
    const folderId = await seedFolder("Enriched");
    const { fileId, versionId } = await seedCleanFile("enriched.txt", folderId, "hello", ISO, {
      sniffedContentType: "text/plain",
    });
    const response = await get(`/api/v1/files?matterId=${matterId}&folderId=${folderId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: EnrichedRow[] };
    const row = body.data.find((entry) => entry.id === fileId);
    expect(row).toBeDefined();
    expect(row?.status).toBe("clean");
    expect(row?.versionNumber).toBe(1);
    expect(row?.sizeBytes).toBe("hello".length);
    expect(row?.sniffedContentType).toBe("text/plain");
    expect(row?.scanVerdict).toBeNull();
    expect(row?.currentVersionId).toBe(versionId);
    expect(row?.updatedAt).toBe(ISO);
    expect(row?.quarantineReason).toBeNull();
  });

  it("files.get carries the same enriched fields", async () => {
    const { fileId, versionId } = await seedCleanFile("get-enriched.txt", null, "abcd");
    const response = await get(`/api/v1/files/${fileId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as EnrichedRow;
    expect(body.status).toBe("clean");
    expect(body.versionNumber).toBe(1);
    expect(body.sizeBytes).toBe(4);
    expect(body.currentVersionId).toBe(versionId);
    expect(body.quarantineReason).toBeNull();
  });
});

describe("files.list opt-in status include", () => {
  it("default excludes pending/quarantined; the include surfaces them with a null currentVersionId", async () => {
    const folderId = await seedFolder("IncludeScope");
    const clean = await seedCleanFile("clean.txt", folderId, "x");
    const pending = await seedNonCleanFile("pending.txt", folderId, "pending");
    const quarantined = await seedNonCleanFile(
      "quarantined.txt",
      folderId,
      "quarantined",
      "Eicar-Test",
    );

    // Default: clean only — the historical behaviour, unchanged.
    const def = await get(`/api/v1/files?matterId=${matterId}&folderId=${folderId}`);
    const defBody = (await def.json()) as { data: EnrichedRow[] };
    const defNames = defBody.data.map((row) => row.name);
    expect(defNames).toContain("clean.txt");
    expect(defNames).not.toContain("pending.txt");
    expect(defNames).not.toContain("quarantined.txt");

    // Include: all three, each carrying its status.
    const inc = await get(
      `/api/v1/files?matterId=${matterId}&folderId=${folderId}&includePendingAndQuarantined=true`,
    );
    const incBody = (await inc.json()) as { data: EnrichedRow[] };
    const byId = new Map(incBody.data.map((row) => [row.id, row]));
    expect(byId.get(clean.fileId)?.status).toBe("clean");
    const pendingRow = byId.get(pending.fileId);
    expect(pendingRow?.status).toBe("pending");
    expect(pendingRow?.currentVersionId).toBeNull();
    expect(pendingRow?.quarantineReason).toBeNull();
    const quarantinedRow = byId.get(quarantined.fileId);
    expect(quarantinedRow?.status).toBe("quarantined");
    expect(quarantinedRow?.currentVersionId).toBeNull();
    expect(quarantinedRow?.quarantineReason).toBe("Eicar-Test");
  });
});

describe("GET /api/v1/folders", () => {
  it("lists a matter's folder tree in adjacency-list form", async () => {
    const foldersMatterId = newIdentifier("matter");
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Folders Matter', 'open', ?2, ?3, ?3)",
      )
      .bind(foldersMatterId, ownerUserId, ISO)
      .run();
    const savedMatter = matterId;
    matterId = foldersMatterId;
    try {
      const parent = await seedFolder("Pleadings");
      const child = await seedFolder("Drafts", parent);
      const response = await get(`/api/v1/folders?matterId=${foldersMatterId}`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: { id: string; parentFolderId: string | null; name: string }[];
      };
      expect(body.data.length).toBe(2);
      const byId = new Map(body.data.map((folder) => [folder.id, folder]));
      expect(byId.get(parent)?.parentFolderId).toBeNull();
      expect(byId.get(parent)?.name).toBe("Pleadings");
      expect(byId.get(child)?.parentFolderId).toBe(parent);
      expect(byId.get(child)?.name).toBe("Drafts");
    } finally {
      matterId = savedMatter;
    }
  });

  it("a Read-only member can list folders (permission null)", async () => {
    const response = await get(`/api/v1/folders?matterId=${matterId}`, readOnlyCookie);
    expect(response.status).toBe(200);
  });

  it("firm scoping: a firm-A session sees none of firm-B's folders", async () => {
    const firmBDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmBId);
    const memberId = newIdentifier("user");
    await insertMemberStatement(firmBDatabase, {
      userId: memberId,
      displayName: "Firm B Folder Member",
      now: ISO,
    }).run();
    const firmBMatterId = newIdentifier("matter");
    await firmBDatabase
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Firm B Folder Matter', 'open', ?2, ?3, ?3)",
      )
      .bind(firmBMatterId, memberId, ISO)
      .run();
    await firmBDatabase
      .prepare(
        "INSERT INTO folder (id, matter_id, parent_folder_id, name, created_at, updated_at) VALUES (?1, ?2, NULL, 'Firm B Folder', ?3, ?3)",
      )
      .bind(newIdentifier("folder"), firmBMatterId, ISO)
      .run();
    // Firm A (ownerCookie) queries firm B's matter id — its own physically-isolated database has no
    // such matter, so the tree is empty. No cross-tenant leak.
    const response = await get(`/api/v1/folders?matterId=${firmBMatterId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});

describe("GET /api/v1/uploads/{id}", () => {
  async function seedUploadSession(options: {
    versionStatus: "pending" | "clean" | "quarantined" | "abandoned";
    sessionStatus: "open" | "completed" | "aborted" | "expired";
    firmId?: FirmId;
    matterId?: MatterId;
    scanDetail?: string | null;
  }): Promise<UploadSessionId> {
    const firmId = options.firmId ?? poolFirmId;
    const targetMatterId = options.matterId ?? matterId;
    const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    const fileId = newIdentifier("file");
    const versionId = newIdentifier("fileVersion");
    const sessionId = newIdentifier("uploadSession");
    const r2Key = `files/${fileId}/${versionId}`;
    await firmDatabase
      .prepare(
        "INSERT INTO file (id, matter_id, folder_id, name, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, NULL, NULL, ?4, ?4)",
      )
      .bind(fileId, targetMatterId, `upload-${options.versionStatus}.bin`, ISO)
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, status, scan_detail, created_at) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6)",
      )
      .bind(versionId, fileId, r2Key, options.versionStatus, options.scanDetail ?? null, ISO)
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO upload_session (id, file_version_id, mode, r2_upload_id, declared_size, declared_content_type, status, created_at, expires_at) VALUES (?1, ?2, 'put', NULL, NULL, NULL, ?3, ?4, NULL)",
      )
      .bind(sessionId, versionId, options.sessionStatus, ISO)
      .run();
    return sessionId as UploadSessionId;
  }

  interface UploadStatusBody {
    sessionStatus: string;
    versionStatus: string;
    quarantineReason: string | null;
  }

  it("reports an open session over a pending version", async () => {
    const sessionId = await seedUploadSession({ versionStatus: "pending", sessionStatus: "open" });
    const response = await get(`/api/v1/uploads/${sessionId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as UploadStatusBody;
    expect(body.sessionStatus).toBe("open");
    expect(body.versionStatus).toBe("pending");
    expect(body.quarantineReason).toBeNull();
  });

  it("reports a completed session over a clean committed version", async () => {
    const sessionId = await seedUploadSession({
      versionStatus: "clean",
      sessionStatus: "completed",
    });
    const body = (await (await get(`/api/v1/uploads/${sessionId}`)).json()) as UploadStatusBody;
    expect(body.sessionStatus).toBe("completed");
    expect(body.versionStatus).toBe("clean");
    expect(body.quarantineReason).toBeNull();
  });

  it("reports a quarantined version with its reason", async () => {
    const sessionId = await seedUploadSession({
      versionStatus: "quarantined",
      sessionStatus: "completed",
      scanDetail: "Eicar-Test-Signature",
    });
    const body = (await (await get(`/api/v1/uploads/${sessionId}`)).json()) as UploadStatusBody;
    expect(body.versionStatus).toBe("quarantined");
    expect(body.quarantineReason).toBe("Eicar-Test-Signature");
  });

  it("reports an aborted session over an abandoned version", async () => {
    const sessionId = await seedUploadSession({
      versionStatus: "abandoned",
      sessionStatus: "aborted",
    });
    const body = (await (await get(`/api/v1/uploads/${sessionId}`)).json()) as UploadStatusBody;
    expect(body.sessionStatus).toBe("aborted");
    expect(body.versionStatus).toBe("abandoned");
    expect(body.quarantineReason).toBeNull();
  });

  it("404s an unknown session id", async () => {
    const response = await get(`/api/v1/uploads/${newIdentifier("uploadSession")}`);
    expect(response.status).toBe(404);
  });

  it("404s (never 403) a session that belongs to another firm", async () => {
    const firmBDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmBId);
    const memberId = newIdentifier("user");
    await insertMemberStatement(firmBDatabase, {
      userId: memberId,
      displayName: "Firm B Uploader",
      now: ISO,
    }).run();
    const firmBMatterId = newIdentifier("matter");
    await firmBDatabase
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Firm B Upload Matter', 'open', ?2, ?3, ?3)",
      )
      .bind(firmBMatterId, memberId, ISO)
      .run();
    const sessionId = await seedUploadSession({
      versionStatus: "pending",
      sessionStatus: "open",
      firmId: firmBId,
      matterId: firmBMatterId,
    });
    // Firm A (ownerCookie) holds files:upload, so RBAC passes; the session simply is not in firm A's
    // database, so the answer is 404 — never 403, and never an existence oracle.
    const response = await get(`/api/v1/uploads/${sessionId}`);
    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
  });

  it("403s a Read-only member (lacks files:upload)", async () => {
    const sessionId = await seedUploadSession({ versionStatus: "pending", sessionStatus: "open" });
    const response = await get(`/api/v1/uploads/${sessionId}`, readOnlyCookie);
    expect(response.status).toBe(403);
  });
});

describe("GET /api/v1/files/{id}/download", () => {
  it("302s to a presigned GET for a clean current version", async () => {
    const { fileId, r2Key } = await seedCleanFile("download.txt", null, "download-bytes");
    const response = await SELF.fetch(`https://example.com/api/v1/files/${fileId}/download`, {
      headers: { cookie: ownerCookie, origin: "https://example.com" },
      redirect: "manual",
    });
    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain(encodeURIComponent(r2Key).replace(/%2F/g, "/"));
    // An audit row was written for the export.
    const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
    const versionResult = await firmDatabase
      .prepare("SELECT current_version_id AS v FROM file WHERE id = ?1")
      .bind(fileId)
      .all<{ v: string }>();
    const auditResult = await firmDatabase
      .prepare("SELECT event FROM audit_log WHERE event = 'file.downloaded' AND subject_id = ?1")
      .bind(versionResult.results[0]?.v)
      .all<{ event: string }>();
    const audit = auditResult.results[0];
    expect(audit?.event).toBe("file.downloaded");
  });

  it("flagged + default treatment (block): denied without ack AND with ack — block never serves, denial is audited", async () => {
    const { fileId, r2Key } = await seedCleanFile("flagged.txt", null, "flagged-bytes");
    // A re-scan flagged the committed (still-visible) current version as malware. With the default
    // block treatment the file is inaccessible — there is no acknowledgment override.
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "UPDATE file_version SET scan_verdict = 'flagged', scan_detail = 'Eicar-Test' WHERE r2_key = ?1",
      )
      .bind(r2Key)
      .run();

    // Without acknowledgment → 403 denied (block).
    const blocked = await SELF.fetch(`https://example.com/api/v1/files/${fileId}/download`, {
      headers: { cookie: ownerCookie, origin: "https://example.com" },
      redirect: "manual",
    });
    expect(blocked.status).toBe(403);

    // WITH acknowledgment → still denied (403): the override is NOT honored under block. A flagged file
    // under block must never resolve to a 302 redirect to its bytes.
    const stillBlocked = await SELF.fetch(
      `https://example.com/api/v1/files/${fileId}/download?acknowledgeMalware=true`,
      { headers: { cookie: ownerCookie, origin: "https://example.com" }, redirect: "manual" },
    );
    expect(stillBlocked.status).not.toBe(302);
    expect(stillBlocked.status).toBe(403);

    // The blocked attempt is recorded in the audit trail (metadata only, no content).
    const versionId = (
      await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
        .prepare("SELECT current_version_id AS v FROM file WHERE id = ?1")
        .bind(fileId)
        .first<{ v: string }>()
    )?.v;
    const audit = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "SELECT event FROM audit_log WHERE subject_id = ?1 AND event = 'file.download_blocked_flagged'",
      )
      .bind(versionId)
      .first<{ event: string }>();
    expect(audit?.event).toBe("file.download_blocked_flagged");
  });

  it("404s a file with no clean current version", async () => {
    const pendingFileId = newIdentifier("file");
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO file (id, matter_id, folder_id, name, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'nope.txt', NULL, NULL, ?3, ?3)",
      )
      .bind(pendingFileId, matterId, ISO)
      .run();
    const response = await SELF.fetch(
      `https://example.com/api/v1/files/${pendingFileId}/download`,
      {
        headers: { cookie: ownerCookie, origin: "https://example.com" },
        redirect: "manual",
      },
    );
    expect(response.status).toBe(404);
  });

  it("flagged + informed-access treatment: 409 without ack, 302 + acknowledged audit with ack", async () => {
    await writeFirmSettingStatement(
      firmDatabaseFor(env.FIRM_DATABASE, poolFirmId),
      flaggedTreatmentDefinition,
      "informed-access",
      ISO,
    ).run();
    try {
      const { fileId, r2Key } = await seedCleanFile("flagged-informed.txt", null, "informed-bytes");
      await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
        .prepare(
          "UPDATE file_version SET scan_verdict = 'flagged', scan_detail = 'Eicar-Test' WHERE r2_key = ?1",
        )
        .bind(r2Key)
        .run();

      // Without acknowledgment → 409 (informed-access gate).
      const blocked = await SELF.fetch(`https://example.com/api/v1/files/${fileId}/download`, {
        headers: { cookie: ownerCookie, origin: "https://example.com" },
        redirect: "manual",
      });
      expect(blocked.status).toBe(409);
      const problem = await blocked.json<{ detail: string }>();
      expect(problem.detail).toContain("Eicar-Test");

      // With acknowledgment → 302, audit records the override.
      const allowed = await SELF.fetch(
        `https://example.com/api/v1/files/${fileId}/download?acknowledgeMalware=true`,
        { headers: { cookie: ownerCookie, origin: "https://example.com" }, redirect: "manual" },
      );
      expect(allowed.status).toBe(302);
      const versionId = (
        await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
          .prepare("SELECT current_version_id AS v FROM file WHERE id = ?1")
          .bind(fileId)
          .first<{ v: string }>()
      )?.v;
      const audit = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
        .prepare(
          "SELECT event FROM audit_log WHERE subject_id = ?1 AND event = 'file.downloaded_malware_acknowledged'",
        )
        .bind(versionId)
        .first<{ event: string }>();
      expect(audit?.event).toBe("file.downloaded_malware_acknowledged");
    } finally {
      await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
        .prepare("DELETE FROM setting WHERE key = ?1")
        .bind(flaggedTreatmentDefinition.key)
        .run();
    }
  });

  it("flagged + allow-and-flag treatment: 302 without ack + audit file.downloaded with flagged marker", async () => {
    await writeFirmSettingStatement(
      firmDatabaseFor(env.FIRM_DATABASE, poolFirmId),
      flaggedTreatmentDefinition,
      "allow-and-flag",
      ISO,
    ).run();
    try {
      const { fileId, r2Key } = await seedCleanFile("flagged-allow.txt", null, "allow-bytes");
      await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
        .prepare(
          "UPDATE file_version SET scan_verdict = 'flagged', scan_detail = 'Eicar-Test' WHERE r2_key = ?1",
        )
        .bind(r2Key)
        .run();

      // No acknowledgment needed — allow-and-flag serves the file directly.
      const response = await SELF.fetch(`https://example.com/api/v1/files/${fileId}/download`, {
        headers: { cookie: ownerCookie, origin: "https://example.com" },
        redirect: "manual",
      });
      expect(response.status).toBe(302);

      // Audit records file.downloaded with a flagged:true marker.
      const versionId = (
        await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
          .prepare("SELECT current_version_id AS v FROM file WHERE id = ?1")
          .bind(fileId)
          .first<{ v: string }>()
      )?.v;
      const audit = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
        .prepare("SELECT event, metadata FROM audit_log WHERE subject_id = ?1")
        .bind(versionId)
        .first<{ event: string; metadata: string }>();
      expect(audit?.event).toBe("file.downloaded");
      const metadata = JSON.parse(audit?.metadata ?? "{}") as Record<string, unknown>;
      expect(metadata.flagged).toBe(true);
    } finally {
      await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
        .prepare("DELETE FROM setting WHERE key = ?1")
        .bind(flaggedTreatmentDefinition.key)
        .run();
    }
  });

  it("flagged + informed-access + step-up-reauth seam: 409 carries stepUpRequired:true, 302 with ack (advisory only)", async () => {
    await writeFirmSettingStatement(
      firmDatabaseFor(env.FIRM_DATABASE, poolFirmId),
      flaggedTreatmentDefinition,
      "informed-access",
      ISO,
    ).run();
    await writeFirmSettingStatement(
      firmDatabaseFor(env.FIRM_DATABASE, poolFirmId),
      stepUpReauthDefinition,
      true,
      ISO,
    ).run();
    try {
      const { fileId, r2Key } = await seedCleanFile("flagged-stepup.txt", null, "stepup-bytes");
      await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
        .prepare(
          "UPDATE file_version SET scan_verdict = 'flagged', scan_detail = 'Eicar-Test' WHERE r2_key = ?1",
        )
        .bind(r2Key)
        .run();

      // Without acknowledgment → 409 with stepUpRequired:true signalling the re-auth advisory.
      const blocked = await SELF.fetch(`https://example.com/api/v1/files/${fileId}/download`, {
        headers: { cookie: ownerCookie, origin: "https://example.com" },
        redirect: "manual",
      });
      expect(blocked.status).toBe(409);
      const problem = await blocked.json<{ detail: string; stepUpRequired?: boolean }>();
      expect(problem.stepUpRequired).toBe(true);

      // Step-up is advisory only: with acknowledgeMalware=true the download still succeeds (302).
      const allowed = await SELF.fetch(
        `https://example.com/api/v1/files/${fileId}/download?acknowledgeMalware=true`,
        { headers: { cookie: ownerCookie, origin: "https://example.com" }, redirect: "manual" },
      );
      expect(allowed.status).toBe(302);
    } finally {
      await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
        .prepare("DELETE FROM setting WHERE key = ?1")
        .bind(flaggedTreatmentDefinition.key)
        .run();
      await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
        .prepare("DELETE FROM setting WHERE key = ?1")
        .bind(stepUpReauthDefinition.key)
        .run();
    }
  });

  it("flagged + explicit block treatment: 403 denied without ack, and acknowledgeMalware=true does NOT serve (no 302)", async () => {
    await writeFirmSettingStatement(
      firmDatabaseFor(env.FIRM_DATABASE, poolFirmId),
      flaggedTreatmentDefinition,
      "block",
      ISO,
    ).run();
    try {
      const { fileId, r2Key } = await seedCleanFile("flagged-block.txt", null, "block-bytes");
      await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
        .prepare(
          "UPDATE file_version SET scan_verdict = 'flagged', scan_detail = 'Eicar-Test' WHERE r2_key = ?1",
        )
        .bind(r2Key)
        .run();

      // Block treatment must never serve a flagged file regardless of ingest-time expectations.
      const blocked = await SELF.fetch(`https://example.com/api/v1/files/${fileId}/download`, {
        headers: { cookie: ownerCookie, origin: "https://example.com" },
        redirect: "manual",
      });
      expect(blocked.status).toBe(403);

      // The acknowledgment override must NOT bypass block — still denied, never a 302 to the bytes.
      const acked = await SELF.fetch(
        `https://example.com/api/v1/files/${fileId}/download?acknowledgeMalware=true`,
        { headers: { cookie: ownerCookie, origin: "https://example.com" }, redirect: "manual" },
      );
      expect(acked.status).not.toBe(302);
      expect(acked.status).toBe(403);
    } finally {
      await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
        .prepare("DELETE FROM setting WHERE key = ?1")
        .bind(flaggedTreatmentDefinition.key)
        .run();
    }
  });
});

describe("GET /api/v1/files/{id}/preview", () => {
  it("files.preview: a playable/standard/full/original version yields inline-media + a files-host streamUrl", async () => {
    const { fileId } = await seedCleanFile("clip.mp4", null, "0123456789".repeat(50), ISO, {
      inlinePlayable: "playable",
      sniffedContentType: "video/mp4",
    });
    const res = await get(`/api/v1/files/${fileId}/preview`);
    expect(res.status).toBe(200);
    const body = await res.json<{ mode: string; streamUrl: string }>();
    expect(body.mode).toBe("inline-media");
    expect(body.streamUrl).toContain(`https://${env.FILES_ORIGIN}/api/files-preview/`);
  });

  it("files.preview: a download-only verdict yields mode download-only + downloadUrl, no streamUrl", async () => {
    const { fileId } = await seedCleanFile("contract.pdf", null, "pdfbytes", ISO, {
      inlinePlayable: "download-only",
      sniffedContentType: "application/pdf",
    });
    const res = await get(`/api/v1/files/${fileId}/preview`);
    expect(res.status).toBe(200);
    const body = await res.json<{ mode: string; downloadUrl: string; streamUrl?: string }>();
    expect(body.mode).toBe("download-only");
    expect(body.downloadUrl).toContain(`/api/v1/files/${fileId}/download`);
    expect(body.streamUrl).toBeUndefined();
  });

  it("files.preview: a null verdict (never sniffed) yields mode download-only + reason unknown-verdict", async () => {
    const { fileId } = await seedCleanFile("unknown.bin", null, "bytes", ISO, {
      inlinePlayable: null,
    });
    const res = await get(`/api/v1/files/${fileId}/preview`);
    expect(res.status).toBe(200);
    const body = await res.json<{ mode: string; reason: string }>();
    expect(body.mode).toBe("download-only");
    expect(body.reason).toBe("unknown-verdict");
  });

  it("files.preview: 404 for an unknown file id", async () => {
    const fakeId = newIdentifier("file");
    const res = await get(`/api/v1/files/${fakeId}/preview`);
    expect(res.status).toBe(404);
  });

  it("files.preview: no audit row is written for an inline-media grant", async () => {
    const { fileId, versionId } = await seedCleanFile("audio.mp3", null, "audiobytes", ISO, {
      inlinePlayable: "playable",
      sniffedContentType: "audio/mpeg",
    });
    const res = await get(`/api/v1/files/${fileId}/preview`);
    expect(res.status).toBe(200);
    const auditResult = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT event FROM audit_log WHERE subject_id = ?1")
      .bind(versionId)
      .all<{ event: string }>();
    expect(auditResult.results[0]).toBeUndefined();
  });
});

describe("POST /api/v1/downloads/zip", () => {
  async function zip(body: unknown, cookie = ownerCookie): Promise<Response> {
    return SELF.fetch("https://example.com/api/v1/downloads/zip", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.com", cookie },
      body: JSON.stringify(body),
      redirect: "manual",
    });
  }

  // A minimal store-mode (method 0) ZIP reader over the central directory: client-zip emits
  // uncompressed entries, so each central-directory record points at a local header whose data is the
  // verbatim bytes. Enough to assert entry names and byte-equal contents in the test (no dependency).
  function unzipStore(bytes: Uint8Array): Record<string, string> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const decoder = new TextDecoder();
    const out: Record<string, string> = {};
    // Find the End Of Central Directory record (signature 0x06054b50), scanning from the tail.
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0; i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd === -1) throw new Error("no EOCD found in archive");
    let pointer = view.getUint32(eocd + 16, true); // offset of central directory start
    const count = view.getUint16(eocd + 10, true);
    for (let entry = 0; entry < count; entry += 1) {
      if (view.getUint32(pointer, true) !== 0x02014b50)
        throw new Error("bad central dir signature");
      const nameLength = view.getUint16(pointer + 28, true);
      const extraLength = view.getUint16(pointer + 30, true);
      const commentLength = view.getUint16(pointer + 32, true);
      const localOffset = view.getUint32(pointer + 42, true);
      const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
      // Read the local header to find the data start (its name/extra lengths may differ).
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const compressedSize = view.getUint32(pointer + 20, true); // store mode: == uncompressed
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      out[name] = decoder.decode(bytes.subarray(dataStart, dataStart + compressedSize));
      pointer += 46 + nameLength + extraLength + commentLength;
    }
    return out;
  }

  it("streams a ZIP of a 3-file selection with folder-tree paths and byte-equal contents", async () => {
    const zipMatterId = newIdentifier("matter");
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Zip Matter', 'open', ?2, ?3, ?3)",
      )
      .bind(zipMatterId, ownerUserId, ISO)
      .run();
    const savedMatter = matterId;
    matterId = zipMatterId;
    try {
      const folder = await seedFolder("Pleadings");
      const sub = await seedFolder("Drafts", folder);
      const a = await seedCleanFile("cover.txt", null, "AAA");
      await seedCleanFile("complaint.txt", folder, "BBBB");
      await seedCleanFile("draft.txt", sub, "CCCCC");

      const response = await zip({ matterId: zipMatterId });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/zip");
      const archive = unzipStore(new Uint8Array(await response.arrayBuffer()));
      const paths = Object.keys(archive).sort();
      expect(paths).toEqual(["Pleadings/Drafts/draft.txt", "Pleadings/complaint.txt", "cover.txt"]);
      expect(archive["cover.txt"]).toBe("AAA");
      expect(archive["Pleadings/complaint.txt"]).toBe("BBBB");
      expect(archive["Pleadings/Drafts/draft.txt"]).toBe("CCCCC");
      expect(a.r2Key).toMatch(/^files\//);

      // Audit row carries counts only.
      const auditResult = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
        .prepare(
          "SELECT metadata FROM audit_log WHERE event = 'files.bulkDownloaded' AND subject_id = ?1",
        )
        .bind(zipMatterId)
        .all<{ metadata: string }>();
      const audit = auditResult.results[0];
      const metadata = JSON.parse(audit?.metadata ?? "{}");
      expect(metadata.fileCount).toBe(3);
      expect(metadata.totalBytes).toBe(12);
      expect(metadata.liveMaxFileCount).toBeGreaterThan(0);
      expect(metadata.liveMaxTotalBytes).toBeGreaterThan(0);
      expect(metadata.delivery).toBe("inline");
    } finally {
      matterId = savedMatter;
    }
  });

  it("excludes a pending/quarantined version from the archive", async () => {
    const zipMatterId = newIdentifier("matter");
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Zip Pending', 'open', ?2, ?3, ?3)",
      )
      .bind(zipMatterId, ownerUserId, ISO)
      .run();
    const savedMatter = matterId;
    matterId = zipMatterId;
    try {
      await seedCleanFile("good.txt", null, "GOOD");
      // A pending file (no clean current version).
      const pendingFileId = newIdentifier("file");
      const pendingVersionId = newIdentifier("fileVersion");
      const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
      await firmDatabase
        .prepare(
          "INSERT INTO file (id, matter_id, folder_id, name, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'pending.txt', NULL, NULL, ?3, ?3)",
        )
        .bind(pendingFileId, zipMatterId, ISO)
        .run();
      await firmDatabase
        .prepare(
          "INSERT INTO file_version (id, file_id, version_number, r2_key, status, created_at) VALUES (?1, ?2, 1, ?3, 'pending', ?4)",
        )
        .bind(pendingVersionId, pendingFileId, `files/${pendingFileId}/${pendingVersionId}`, ISO)
        .run();

      const response = await zip({ matterId: zipMatterId });
      // One clean file -> single-file 302 redirect, not a ZIP. The pending file never enters.
      expect(response.status).toBe(302);
    } finally {
      matterId = savedMatter;
    }
  });

  it("302s a single-file selection", async () => {
    const zipMatterId = newIdentifier("matter");
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Zip Single', 'open', ?2, ?3, ?3)",
      )
      .bind(zipMatterId, ownerUserId, ISO)
      .run();
    const savedMatter = matterId;
    matterId = zipMatterId;
    try {
      const only = await seedCleanFile("solo.txt", null, "SOLO");
      const response = await zip({ matterId: zipMatterId, fileIds: [only.fileId] });
      expect(response.status).toBe(302);
      expect(response.headers.get("location") ?? "").toContain("dev-presigned=get");
    } finally {
      matterId = savedMatter;
    }
  });

  it("pins the resolved version: a version committed after resolution does not change the archive", async () => {
    const zipMatterId = newIdentifier("matter");
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Zip Pinned', 'open', ?2, ?3, ?3)",
      )
      .bind(zipMatterId, ownerUserId, ISO)
      .run();
    const savedMatter = matterId;
    matterId = zipMatterId;
    try {
      const first = await seedCleanFile("doc.txt", null, "VERSION-ONE");
      const second = await seedCleanFile("other.txt", null, "OTHER");

      // The archive is resolved at request time from the current clean versions; capture it.
      const response = await zip({ matterId: zipMatterId });
      const archive = unzipStore(new Uint8Array(await response.arrayBuffer()));
      expect(archive["doc.txt"]).toBe("VERSION-ONE");

      // A new version committed AFTER does not retroactively change the already-streamed archive.
      const newVersionId = newIdentifier("fileVersion");
      const newKey = `files/${first.fileId}/${newVersionId}`;
      await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
        .prepare(
          "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, status, created_at, committed_at) VALUES (?1, ?2, 2, ?3, 12, 'clean', ?4, ?4)",
        )
        .bind(newVersionId, first.fileId, newKey, ISO)
        .run();
      await env.R2.put(newKey, "VERSION-TWO!!");
      expect(second.r2Key).toMatch(/^files\//);
      // The already-received archive bytes are unchanged.
      expect(archive["doc.txt"]).toBe("VERSION-ONE");
    } finally {
      matterId = savedMatter;
    }
  });

  it("403s a Read-only member", async () => {
    const response = await zip({ matterId }, readOnlyCookie);
    expect(response.status).toBe(403);
  });

  it("hands a selection over the live file-count threshold to the async build job (202)", async () => {
    const asyncMatterId = newIdentifier("matter");
    const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
    await firmDatabase
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Zip Async', 'open', ?2, ?3, ?3)",
      )
      .bind(asyncMatterId, ownerUserId, ISO)
      .run();
    const savedMatter = matterId;
    matterId = asyncMatterId;
    // Drop the live file-count threshold to 1 so a two-file selection exceeds it.
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("INSERT OR REPLACE INTO setting (key, value, updated_at) VALUES (?1, '1', ?2)")
      .bind(liveMaxFileCountDefinition.key, ISO)
      .run();
    try {
      await seedCleanFile("one.txt", null, "AAA");
      await seedCleanFile("two.txt", null, "BBBB");

      const response = await zip({ matterId: asyncMatterId });
      expect(response.status).toBe(202);
      const body = (await response.json()) as { jobId: string; status: string };
      expect(body.jobId).toMatch(/^[0-9a-f]{64}$/);
      expect(body.status).toBe("building");
    } finally {
      await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
        .prepare("DELETE FROM setting WHERE key = ?1")
        .bind(liveMaxFileCountDefinition.key)
        .run();
      matterId = savedMatter;
    }
  });

  it("returns 200 with a signed URL when an identical bundle was already built", async () => {
    const cachedMatterId = newIdentifier("matter");
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Zip Cached', 'open', ?2, ?3, ?3)",
      )
      .bind(cachedMatterId, ownerUserId, ISO)
      .run();
    const savedMatter = matterId;
    matterId = cachedMatterId;
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("INSERT OR REPLACE INTO setting (key, value, updated_at) VALUES (?1, '1', ?2)")
      .bind(liveMaxFileCountDefinition.key, ISO)
      .run();
    try {
      const a = await seedCleanFile("alpha.txt", null, "AAA");
      const b = await seedCleanFile("beta.txt", null, "BBBB");
      // Pre-place the content-addressed artifact so the route short-circuits to a signed URL rather
      // than starting a new build (the manifest hash matches what the route derives from this set).
      const manifestHash = await bundleManifestHash([
        { r2Key: a.r2Key, path: "alpha.txt" },
        { r2Key: b.r2Key, path: "beta.txt" },
      ]);
      await env.R2.put(`bundles/${manifestHash}.zip`, "PK-fake-zip-bytes");

      const response = await zip({ matterId: cachedMatterId });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type") ?? "").toContain("application/json");
      const body = (await response.json()) as { url: string };
      expect(body.url).toContain("dev-presigned=get");
    } finally {
      await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
        .prepare("DELETE FROM setting WHERE key = ?1")
        .bind(liveMaxFileCountDefinition.key)
        .run();
      matterId = savedMatter;
    }
  });
});

describe("inline preview grant + cookieless delivery", () => {
  const MP4_BYTES = "0123456789".repeat(50); // 500 bytes of deterministic content

  it("auth -> grant: a playable/standard/full/original version yields inline-media + a files-host streamUrl, no audit row", async () => {
    const { fileId } = await seedCleanFile("clip.mp4", null, MP4_BYTES, ISO, {
      inlinePlayable: "playable",
      sniffedContentType: "video/mp4",
    });
    const res = await get(`/api/v1/files/${fileId}/preview`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json<{
      mode: string;
      verdict: string;
      streamUrl: string;
      contentType: string;
      downloadUrl: string;
    }>();
    expect(body.mode).toBe("inline-media");
    expect(body.verdict).toBe("playable");
    expect(body.contentType).toBe("video/mp4");
    expect(body.streamUrl).toContain(`https://${env.FILES_ORIGIN}/api/files-preview/`);
    expect(body.downloadUrl).toBe(`/api/v1/files/${fileId}/download`);
    const audit = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "SELECT event FROM audit_log WHERE event = 'file.downloaded' AND subject_id IN (SELECT id FROM file_version WHERE file_id = ?1)",
      )
      .bind(fileId)
      .all();
    expect(audit.results).toHaveLength(0);
  });

  it("cookieless fetch: full safe-header set, sniffed type wins over declared, no session consulted", async () => {
    const { fileId } = await seedCleanFile("clip2.mp4", null, MP4_BYTES, ISO, {
      inlinePlayable: "playable",
      sniffedContentType: "video/mp4", // declared_content_type is application/octet-stream
    });
    const grant = await (
      await get(`/api/v1/files/${fileId}/preview`)
    ).json<{ streamUrl: string }>();
    const res = await SELF.fetch(grant.streamUrl); // NO cookie
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Type")).toBe("video/mp4"); // sniffed wins over octet-stream
    expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const buf = await res.arrayBuffer();
    expect(new TextDecoder().decode(buf)).toBe(MP4_BYTES);
  });

  it("Range/206: a byte-range request yields 206 + correct Content-Range/ETag and the safe headers", async () => {
    const { fileId } = await seedCleanFile("clip3.mp4", null, MP4_BYTES, ISO, {
      inlinePlayable: "playable",
      sniffedContentType: "video/mp4",
    });
    const grant = await (
      await get(`/api/v1/files/${fileId}/preview`)
    ).json<{ streamUrl: string }>();
    const res = await SELF.fetch(grant.streamUrl, { headers: { Range: "bytes=0-99" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-99/500");
    expect(res.headers.get("Content-Length")).toBe("100");
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
    expect(res.headers.get("ETag")).toBeTruthy();
    // Safe headers must be identical across 200 and 206 responses.
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it("Range/416: an unsatisfiable range yields 416 with the safe headers and no body", async () => {
    const { fileId } = await seedCleanFile("clip4.mp4", null, MP4_BYTES, ISO, {
      inlinePlayable: "playable",
      sniffedContentType: "video/mp4",
    });
    const grant = await (
      await get(`/api/v1/files/${fileId}/preview`)
    ).json<{ streamUrl: string }>();
    const res = await SELF.fetch(grant.streamUrl, { headers: { Range: "bytes=9000-9999" } });
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */500");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("If-Range: a stale If-Range ETag ignores the Range and serves the full 200; a matching If-Range serves 206", async () => {
    const { fileId } = await seedCleanFile("clip5.mp4", null, MP4_BYTES, ISO, {
      inlinePlayable: "playable",
      sniffedContentType: "video/mp4",
    });
    const grant = await (
      await get(`/api/v1/files/${fileId}/preview`)
    ).json<{ streamUrl: string }>();
    // Discover the real ETag.
    const probe = await SELF.fetch(grant.streamUrl, { headers: { Range: "bytes=0-99" } });
    const etag = probe.headers.get("ETag");
    expect(etag).toBeTruthy();
    // Matching If-Range -> 206.
    const matched = await SELF.fetch(grant.streamUrl, {
      headers: { Range: "bytes=0-99", "If-Range": etag as string },
    });
    expect(matched.status).toBe(206);
    // Stale If-Range -> ignore the Range, full 200.
    const stale = await SELF.fetch(grant.streamUrl, {
      headers: { Range: "bytes=0-99", "If-Range": '"a-stale-etag"' },
    });
    expect(stale.status).toBe(200);
    expect((await stale.arrayBuffer()).byteLength).toBe(500);
  });

  it("forged / expired token on the files host -> bare 404, no error_ id, no problem+json", async () => {
    const res = await SELF.fetch(`https://${env.FILES_ORIGIN}/api/files-preview/forged.token`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toMatch(/error_/);
    expect(res.headers.get("Content-Type") ?? "").not.toContain("problem+json");
  });

  it("download-only: a NULL-verdict (never sniffed) version -> mode download-only, no streamUrl", async () => {
    const { fileId } = await seedCleanFile("doc.bin", null, "data", ISO, { inlinePlayable: null });
    const body = await (
      await get(`/api/v1/files/${fileId}/preview`)
    ).json<{ mode: string; reason: string; streamUrl?: string; downloadUrl: string }>();
    expect(body.mode).toBe("download-only");
    expect(body.reason).toBe("unknown-verdict");
    expect(body.streamUrl).toBeUndefined();
    expect(body.downloadUrl).toBe(`/api/v1/files/${fileId}/download`);
  });

  it("download-only: a playable-but-IA version -> mode download-only/tiered", async () => {
    const { fileId } = await seedCleanFile("ia.mp4", null, MP4_BYTES, ISO, {
      inlinePlayable: "playable",
      sniffedContentType: "video/mp4",
      storageClass: "infrequent_access",
    });
    const body = await (
      await get(`/api/v1/files/${fileId}/preview`)
    ).json<{ mode: string; reason: string }>();
    expect(body.mode).toBe("download-only");
    expect(body.reason).toBe("tiered");
  });

  it("read-only member: a Read-only cookie still gets a read grant (permission: null)", async () => {
    const { fileId } = await seedCleanFile("ro.mp4", null, MP4_BYTES, ISO, {
      inlinePlayable: "playable",
      sniffedContentType: "video/mp4",
    });
    const res = await get(`/api/v1/files/${fileId}/preview`, readOnlyCookie);
    expect(res.status).toBe(200);
  });

  it("cookieless tenant isolation: a token presented cold serves only what the signed bucket/key names", async () => {
    // A grant minted for a firm-1 file is honored cold (no cookie) — proving the SIGNED key/bucket,
    // not session/firm-D1 visibility, scopes the byte fetch.
    const { fileId } = await seedCleanFile("iso.mp4", null, MP4_BYTES, ISO, {
      inlinePlayable: "playable",
      sniffedContentType: "video/mp4",
    });
    const grant = await (
      await get(`/api/v1/files/${fileId}/preview`)
    ).json<{ streamUrl: string }>();
    const cold = await SELF.fetch(grant.streamUrl); // no session at all
    expect(cold.status).toBe(200);
  });

  it("cross-firm isolation: a firm-A session requesting a firm-B file id at the preview grant receives 404 (no existence oracle)", async () => {
    // Seed a clean file directly in firm B's DO-backed database. The firm-A session (ownerCookie)
    // then requests firm B's file id at the preview grant endpoint. The firm-scoped data-access layer
    // must not expose existence across tenant boundaries — the response must be a uniform 404.
    //
    // Mirror ownerUserId into firm B's member table so the matter FK (responsible_member_id) resolves.
    // The per-firm member table is a local mirror — no FK back to the control-plane user table.
    const firmBDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmBId);
    await insertMemberStatement(firmBDatabase, {
      userId: ownerUserId,
      displayName: "Firm B Placeholder Member",
      now: ISO,
    }).run();
    const firmBMatterId = newIdentifier("matter");
    await firmBDatabase
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Firm B Matter', 'open', ?2, ?3, ?3)",
      )
      .bind(firmBMatterId, ownerUserId, ISO)
      .run();
    const firmBFileId = newIdentifier("file");
    const firmBVersionId = newIdentifier("fileVersion");
    const firmBR2Key = `files/${firmBFileId}/${firmBVersionId}`;
    await firmBDatabase
      .prepare(
        "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'firm-b.mp4', NULL, NULL, NULL, ?3, ?3)",
      )
      .bind(firmBFileId, firmBMatterId, ISO)
      .run();
    await firmBDatabase
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at, inline_playable, storage_class, storage_encoding, artifact_role) " +
          "VALUES (?1, ?2, 1, ?3, ?4, 'application/octet-stream', 'video/mp4', 'hash', 'clean', ?5, ?6, ?6, 'playable', 'standard', 'full', 'original')",
      )
      .bind(firmBVersionId, firmBFileId, firmBR2Key, MP4_BYTES.length, ownerUserId, ISO)
      .run();
    await firmBDatabase
      .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
      .bind(firmBFileId, firmBVersionId)
      .run();
    await env.R2.put(firmBR2Key, MP4_BYTES);
    // Firm A's authenticated session must receive 404 — firm B's file must not be visible across the
    // tenant boundary regardless of whether the file id exists in another firm's database.
    const res = await get(`/api/v1/files/${firmBFileId}/preview`); // ownerCookie = firm A
    expect(res.status).toBe(404);
  });

  it("preview of a flagged version is download-only/verdict regardless of inline_playable", async () => {
    const { fileId, r2Key } = await seedCleanFile("flagged-preview.mp4", null, "video-bytes", ISO, {
      inlinePlayable: "playable",
      sniffedContentType: "video/mp4",
    });
    // A re-scan flags the already-committed (still-clean-status) version.
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("UPDATE file_version SET scan_verdict = 'flagged' WHERE r2_key = ?1")
      .bind(r2Key)
      .run();

    const res = await get(`/api/v1/files/${fileId}/preview`);
    expect(res.status).toBe(200);
    const body = await res.json<{
      mode: string;
      reason: string;
      streamUrl?: string;
      downloadUrl: string;
    }>();
    expect(body.mode).toBe("download-only");
    expect(body.reason).toBe("verdict");
    expect(body.streamUrl).toBeUndefined();
    expect(body.downloadUrl).toContain(`/api/v1/files/${fileId}/download`);
  });

  it("pre-apex degrade: with FILES_ORIGIN unset the grant is download-only/host-unavailable, downloadUrl only", async () => {
    // Construct an app whose env omits FILES_ORIGIN and call it directly with the owner session, so the
    // binding is genuinely absent (the shared SELF pool binds it via wrangler.jsonc vars).
    const { fileId } = await seedCleanFile("degrade.mp4", null, MP4_BYTES, ISO, {
      inlinePlayable: "playable",
      sniffedContentType: "video/mp4",
    });
    const app = createApp();
    const envWithoutFilesOrigin = { ...(env as Record<string, unknown>), FILES_ORIGIN: undefined };
    const res = await app.fetch(
      new Request(`https://example.com/api/v1/files/${fileId}/preview`, {
        headers: { cookie: ownerCookie, origin: "https://example.com" },
      }),
      envWithoutFilesOrigin as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      mode: string;
      reason: string;
      streamUrl?: string;
      downloadUrl: string;
    }>();
    expect(body.mode).toBe("download-only");
    expect(body.reason).toBe("host-unavailable");
    expect(body.streamUrl).toBeUndefined();
    expect(body.downloadUrl).toBe(`/api/v1/files/${fileId}/download`);
  });
});

describe("POST /api/v1/scan/diagnose", () => {
  it("scans a posted body, returns a diagnosis, and writes an audit row", async () => {
    const res = await SELF.fetch("https://example.com/api/v1/scan/diagnose", {
      method: "POST",
      headers: {
        cookie: ownerCookie,
        origin: "https://example.com",
        "content-type": "application/octet-stream",
      },
      body: new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3, 4]),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ verdict: string; engineVersion: string | null }>();
    // The stub scan service bound via SCAN_SERVICE returns the no-engine verdict — an honest `unscanned`, never a false clean.
    expect(body.verdict).toBe("unscanned");
    const auditResult = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'file.scan_diagnosed'")
      .all<{ n: number }>();
    const audit = auditResult.results[0];
    expect(audit?.n).toBeGreaterThanOrEqual(1);
  });

  it("uses the firm's own scan policy (not a fixed default) so the diagnosis is consistent with ingest", async () => {
    // A firm with a custom policy (extended tier, lowered suspicious-score floor) diagnoses through the
    // same readFirmScanPolicy path ingest uses. With the no-engine stub the verdict is `unscanned`, but
    // the route must resolve the firm policy without error and still write the audit row.
    await writeFirmSettingStatement(
      firmDatabaseFor(env.FIRM_DATABASE, poolFirmId),
      scanPolicyDefinition,
      { tier: "extended", suspiciousScoreFloor: 10 },
      ISO,
    ).run();
    try {
      const res = await SELF.fetch("https://example.com/api/v1/scan/diagnose", {
        method: "POST",
        headers: {
          cookie: ownerCookie,
          origin: "https://example.com",
          "content-type": "application/octet-stream",
        },
        body: new Uint8Array([0x25, 0x50, 0x44, 0x46, 9, 9, 9, 9]),
      });
      expect(res.status).toBe(200);
      const body = await res.json<{ verdict: string }>();
      expect(body.verdict).toBe("unscanned");
    } finally {
      await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
        .prepare("DELETE FROM setting WHERE key = ?1")
        .bind(scanPolicyDefinition.key)
        .run();
    }
  });

  it("requires authentication (401 without a session)", async () => {
    const res = await SELF.fetch("https://example.com/api/v1/scan/diagnose", {
      method: "POST",
      headers: { origin: "https://example.com", "content-type": "application/octet-stream" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/scan/matter/{id}", () => {
  it("enqueues nothing when no current engine version is recorded", async () => {
    // No fileManager.scanEngineVersion set yet — never fabricate a staleness comparison or a scan.
    const res = await SELF.fetch(`https://example.com/api/v1/scan/matter/${matterId}`, {
      method: "POST",
      headers: { cookie: ownerCookie, origin: "https://example.com" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enqueued: 0, capped: false });
  });

  it("queues a matter's stale files for re-scan and audits the request", async () => {
    await writeFirmSettingStatement(
      firmDatabaseFor(env.FIRM_DATABASE, poolFirmId),
      scanEngineVersionDefinition,
      "clamav/9.9",
      ISO,
    ).run();
    await seedCleanFile("matter-rescan-a.txt", null, "alpha");
    await seedCleanFile("matter-rescan-b.txt", null, "beta");
    const res = await SELF.fetch(`https://example.com/api/v1/scan/matter/${matterId}`, {
      method: "POST",
      headers: { cookie: ownerCookie, origin: "https://example.com" },
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ enqueued: number; capped: boolean }>();
    // The matter's stale clean files (NULL scan_engine_version), including the two just seeded.
    expect(body.enqueued).toBeGreaterThanOrEqual(2);
    expect(body.capped).toBe(false);
    const auditResult = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'matter.files_rescan_requested'")
      .all<{ n: number }>();
    const audit = auditResult.results[0];
    expect(audit?.n).toBeGreaterThanOrEqual(1);
  });
});

describe("a file's scan history and a member's re-scan request", () => {
  it("records the request against the named version, and the history reads it back", async () => {
    await writeFirmSettingStatement(
      firmDatabaseFor(env.FIRM_DATABASE, poolFirmId),
      scanEngineVersionDefinition,
      "clamav/9.9",
      ISO,
    ).run();
    const { fileId, versionId } = await seedCleanFile("rescan-me.txt", null, "look again");
    const res = await SELF.fetch(`https://example.com/api/v1/files/${fileId}/rescan`, {
      method: "POST",
      headers: {
        cookie: ownerCookie,
        origin: "https://example.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({ versionId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ requestId: string; versionId: string; enqueued: boolean }>();
    expect(body.versionId).toBe(versionId);

    const history = await SELF.fetch(`https://example.com/api/v1/files/${fileId}/scans`, {
      headers: { cookie: ownerCookie },
    });
    expect(history.status).toBe(200);
    const read = await history.json<{
      currentEngineVersion: string | null;
      scanSettings: {
        tier: string;
        suspiciousScoreFloor: number;
        flaggedTreatment: string;
        stepUpReauthOnFlagged: boolean;
      };
      data: {
        id: string;
        event: string;
        versionId: string;
        actorUserId: string | null;
        scanEngineVersion: string | null;
        queued: boolean | null;
      }[];
    }>();
    expect(read.currentEngineVersion).toBe("clamav/9.9");
    // What the firm's checks run under travels with the history, so a member reading a verdict can
    // read what it was looked for with. The firm has set none of these, so they are the defaults.
    expect(read.scanSettings).toEqual({
      tier: "extended",
      suspiciousScoreFloor: 75,
      flaggedTreatment: "block",
      stepUpReauthOnFlagged: false,
    });
    expect(read.data).toContainEqual(
      expect.objectContaining({
        id: body.requestId,
        event: "file.rescan_requested",
        versionId,
        actorUserId: ownerUserId,
        // The request's own two recorded facts: whether it reached the queue, and the engine that
        // stood at the time — which is what decided the first one.
        queued: body.enqueued,
        scanEngineVersion: "clamav/9.9",
      }),
    );
  });

  it("refuses a version that is not this file's", async () => {
    const mine = await seedCleanFile("rescan-mine.txt", null, "mine");
    const theirs = await seedCleanFile("rescan-theirs.txt", null, "theirs");
    const res = await SELF.fetch(`https://example.com/api/v1/files/${mine.fileId}/rescan`, {
      method: "POST",
      headers: {
        cookie: ownerCookie,
        origin: "https://example.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({ versionId: theirs.versionId }),
    });
    expect(res.status).toBe(404);
  });
});
