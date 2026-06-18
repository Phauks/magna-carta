import { env, SELF } from "cloudflare:test";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { liveMaxFileCountDefinition } from "@magna-carta/file-manager/upload-policy";
import { bundleManifestHash } from "@magna-carta/file-manager/zip-composition";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
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
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
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
let matterId: MatterId;
let ownerCookie: string;
let readOnlyCookie: string;
let ownerUserId: UserId;

const ISO = "2026-06-13T00:00:00.000Z";

async function mirrorMemberWithRole(userId: UserId, displayName: string, roleName: string) {
  const role = await env.DB_FIRM_POOL_1.prepare("SELECT id FROM role WHERE name = ?1")
    .bind(roleName)
    .first<{ id: string }>();
  if (role === null) throw new Error(`seeded role ${roleName} missing`);
  await insertMemberStatement(env.DB_FIRM_POOL_1, { userId, displayName, now: ISO }).run();
  await insertRoleAssignmentStatement(env.DB_FIRM_POOL_1, {
    id: newIdentifier("memberRole"),
    memberUserId: userId,
    roleId: assertIdentifier(role.id, "role"),
  }).run();
}

// Seeds a folder under the matter (optionally nested).
async function seedFolder(name: string, parentFolderId: FolderId | null = null): Promise<FolderId> {
  const id = newIdentifier("folder");
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO folder (id, matter_id, parent_folder_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
  )
    .bind(id, matterId, parentFolderId, name, ISO)
    .run();
  return id;
}

// Seeds a clean file with a single committed version, writing the bytes into the Miniflare R2 binding
// at the version's key. status='clean' + current_version_id set is the visibility gate.
async function seedCleanFile(
  name: string,
  folderId: FolderId | null,
  bytes: string,
  createdAt = ISO,
): Promise<{ fileId: FileId; versionId: FileVersionId; r2Key: string }> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const r2Key = `files/${fileId}/${versionId}`;
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, ?5, ?5)",
  )
    .bind(fileId, matterId, folderId, name, createdAt)
    .run();
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at) " +
      "VALUES (?1, ?2, 1, ?3, ?4, 'text/plain', 'text/plain', 'hash', 'clean', ?5, ?6, ?6)",
  )
    .bind(versionId, fileId, r2Key, bytes.length, ownerUserId, createdAt)
    .run();
  await env.DB_FIRM_POOL_1.prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  await env.R2.put(r2Key, bytes);
  return { fileId, versionId, r2Key };
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (await seedFirm({ name: "Files Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("files-owner@example.com", {
    userName: "Files Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Files Owner");
  ownerCookie = await signInForSessionCookie("files-owner@example.com");

  const readOnly = await seedCredentialedUser("files-readonly@example.com", {
    userName: "Files Read Only",
    firmId: poolFirmId,
  });
  await mirrorMemberWithRole(readOnly.userId, "Files Read Only", "Read-only");
  readOnlyCookie = await signInForSessionCookie("files-readonly@example.com");

  matterId = newIdentifier("matter");
  await env.DB_FIRM_POOL_1.prepare(
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
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, ?3, 'pending.txt', NULL, NULL, ?4, ?4)",
    )
      .bind(pendingFileId, matterId, folderId, ISO)
      .run();
    const deleted = await seedCleanFile("deleted.txt", folderId, "x");
    await env.DB_FIRM_POOL_1.prepare("UPDATE file SET deleted_at = ?2 WHERE id = ?1")
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

    const row = await env.DB_FIRM_POOL_1.prepare("SELECT name, folder_id FROM file WHERE id = ?1")
      .bind(fileId)
      .first<{ name: string; folder_id: string }>();
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
    const audit = await env.DB_FIRM_POOL_1.prepare(
      "SELECT event FROM audit_log WHERE event = 'file.downloaded' AND subject_id = ?1",
    )
      .bind(
        (
          await env.DB_FIRM_POOL_1.prepare("SELECT current_version_id AS v FROM file WHERE id = ?1")
            .bind(fileId)
            .first<{ v: string }>()
        )?.v,
      )
      .first<{ event: string }>();
    expect(audit?.event).toBe("file.downloaded");
  });

  it("404s a file with no clean current version", async () => {
    const pendingFileId = newIdentifier("file");
    await env.DB_FIRM_POOL_1.prepare(
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
    await env.DB_FIRM_POOL_1.prepare(
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
      const audit = await env.DB_FIRM_POOL_1.prepare(
        "SELECT metadata FROM audit_log WHERE event = 'files.bulkDownloaded' AND subject_id = ?1",
      )
        .bind(zipMatterId)
        .first<{ metadata: string }>();
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
    await env.DB_FIRM_POOL_1.prepare(
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
      await env.DB_FIRM_POOL_1.prepare(
        "INSERT INTO file (id, matter_id, folder_id, name, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'pending.txt', NULL, NULL, ?3, ?3)",
      )
        .bind(pendingFileId, zipMatterId, ISO)
        .run();
      await env.DB_FIRM_POOL_1.prepare(
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
    await env.DB_FIRM_POOL_1.prepare(
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
    await env.DB_FIRM_POOL_1.prepare(
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
      await env.DB_FIRM_POOL_1.prepare(
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
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Zip Async', 'open', ?2, ?3, ?3)",
    )
      .bind(asyncMatterId, ownerUserId, ISO)
      .run();
    const savedMatter = matterId;
    matterId = asyncMatterId;
    // Drop the live file-count threshold to 1 so a two-file selection exceeds it.
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT OR REPLACE INTO setting (key, value, updated_at) VALUES (?1, '1', ?2)",
    )
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
      await env.DB_FIRM_POOL_1.prepare("DELETE FROM setting WHERE key = ?1")
        .bind(liveMaxFileCountDefinition.key)
        .run();
      matterId = savedMatter;
    }
  });

  it("returns 200 with a signed URL when an identical bundle was already built", async () => {
    const cachedMatterId = newIdentifier("matter");
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Zip Cached', 'open', ?2, ?3, ?3)",
    )
      .bind(cachedMatterId, ownerUserId, ISO)
      .run();
    const savedMatter = matterId;
    matterId = cachedMatterId;
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT OR REPLACE INTO setting (key, value, updated_at) VALUES (?1, '1', ?2)",
    )
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
      await env.DB_FIRM_POOL_1.prepare("DELETE FROM setting WHERE key = ?1")
        .bind(liveMaxFileCountDefinition.key)
        .run();
      matterId = savedMatter;
    }
  });
});
