import { env, SELF } from "cloudflare:test";
import { strToU8, zipSync } from "fflate";
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
import { handleIngestMessage } from "../src/background/files/ingest-consumer.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// Extraction out of a zip: POST /api/v1/files/{id}/archive-extractions takes named members out of the
// stored archive and files each one onto the archive's own matter through the ordinary ingest
// ceremony. Real zip bytes are written into the test R2 (the same fixture shape
// files-archive-entries.test.ts uses for the listing over these archives), so the route exercises the
// actual central-directory reader and the actual member extractor. Miniflare delivers no R2
// object-create notification, so a filed member stays pending until the ingest consumer is driven —
// which is exactly the property the last test asserts.

let poolFirmId: FirmId;
let ownerCookie: string;
let readOnlyCookie: string;
let ownerUserId: UserId;

const ISO = "2026-06-15T00:00:00.000Z";

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
  const folderId = newIdentifier("folder");
  await firmDatabase()
    .prepare(
      "INSERT INTO folder (id, matter_id, parent_folder_id, name, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?4, ?4)",
    )
    .bind(folderId, matterId, name, ISO)
    .run();
  return folderId;
}

// A clean file whose committed bytes are supplied verbatim — the same seeding shape
// files-archive-entries.test.ts uses, with the sniffed type under the caller's control.
async function seedCleanFileWithBytes(
  matterId: MatterId,
  name: string,
  sniffedContentType: string | null,
  bytes: Uint8Array,
): Promise<{ fileId: FileId; versionId: FileVersionId; r2Key: string }> {
  const database = firmDatabase();
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const r2Key = `files/${fileId}/${versionId}`;
  await database
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, NULL, NULL, NULL, ?4, ?4)",
    )
    .bind(fileId, matterId, name, ISO)
    .run();
  await database
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at) VALUES (?1, ?2, 1, ?3, ?4, 'application/octet-stream', ?5, 'hash', 'clean', ?6, ?7, ?7)",
    )
    .bind(versionId, fileId, r2Key, bytes.byteLength, sniffedContentType, ownerUserId, ISO)
    .run();
  await database
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  await env.R2.put(r2Key, bytes);
  return { fileId, versionId, r2Key };
}

function fixtureZip(): Uint8Array {
  return zipSync({
    "readme.txt": strToU8("hello archive"),
    "exhibits/a.txt": strToU8("exhibit a"),
    "exhibits/b.txt": strToU8("exhibit b"),
  });
}

const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const CENTRAL_FILE_HEADER_BYTES = 46;
const FLAG_ENCRYPTED = 0x0001;

// Sets general-purpose bit 0 — "this member's bytes are encrypted" — on one member's
// central-directory record. No zip writer in the workspace produces an encrypted member, and the
// central directory is where the extractor reads the flag from, so the hostile fixture is made by
// flipping the bit on a real archive rather than by hand-assembling one.
function markMemberEncrypted(archive: Uint8Array, path: string): Uint8Array {
  const bytes = new Uint8Array(archive);
  const view = new DataView(bytes.buffer);
  const wanted = strToU8(path);
  for (let position = 0; position + CENTRAL_FILE_HEADER_BYTES <= bytes.byteLength; position += 1) {
    if (view.getUint32(position, true) !== CENTRAL_FILE_HEADER_SIGNATURE) continue;
    const nameLength = view.getUint16(position + 28, true);
    if (nameLength !== wanted.byteLength) continue;
    const nameStart = position + CENTRAL_FILE_HEADER_BYTES;
    const name = bytes.subarray(nameStart, nameStart + nameLength);
    if (!name.every((byte, index) => byte === wanted[index])) continue;
    view.setUint16(position + 8, view.getUint16(position + 8, true) | FLAG_ENCRYPTED, true);
    return bytes;
  }
  throw new Error(`no central-directory record for ${path}`);
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Archive Extraction Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();
  const owner = await seedCredentialedUser("extraction-owner@example.com", {
    userName: "Extraction Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Extraction Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("extraction-owner@example.com");

  const readOnly = await seedCredentialedUser("extraction-readonly@example.com", {
    userName: "Extraction Read Only",
    firmId: poolFirmId,
  });
  await mirrorMemberWithRole(readOnly.userId, "Extraction Read Only", poolFirmId, "Read-only");
  readOnlyCookie = await signInForSessionCookie("extraction-readonly@example.com");
});

interface ExtractionBody {
  extracted: { path: string; fileId: string; versionId: string; name: string }[];
  refused: { path: string; reason: string }[];
}

interface FileRow {
  name: string;
  folder_id: string | null;
  matter_id: string;
  current_version_id: string | null;
  deleted_at: string | null;
}

async function extract(
  fileId: string,
  body: { paths: string[]; folderId?: string | null },
  cookie = ownerCookie,
): Promise<Response> {
  return SELF.fetch(`https://example.com/api/v1/files/${fileId}/archive-extractions`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com", cookie },
    body: JSON.stringify(body),
  });
}

function fileRow(fileId: string): Promise<FileRow | null> {
  return firmDatabase()
    .prepare(
      "SELECT name, folder_id, matter_id, current_version_id, deleted_at FROM file WHERE id = ?1",
    )
    .bind(fileId)
    .first<FileRow>();
}

describe("POST /api/v1/files/{id}/archive-extractions", () => {
  it("files each requested member onto the archive's matter, under its own base name", async () => {
    const matterId = await seedMatter("Extraction Multi Matter");
    const folderId = await seedFolder(matterId, "Extracted");
    const { fileId } = await seedCleanFileWithBytes(
      matterId,
      "bundle.zip",
      "application/zip",
      fixtureZip(),
    );

    const response = await extract(fileId, { paths: ["exhibits/a.txt", "readme.txt"], folderId });
    expect(response.status).toBe(202);
    const body = (await response.json()) as ExtractionBody;
    expect(body.refused).toEqual([]);
    expect(body.extracted.map((member) => member.path)).toEqual(["exhibits/a.txt", "readme.txt"]);
    // The filed name is the path's last segment, never the archive path.
    expect(body.extracted.map((member) => member.name)).toEqual(["a.txt", "readme.txt"]);
    for (const member of body.extracted) {
      expect(member.fileId).toMatch(/^file_/);
      expect(member.versionId).toMatch(/^fileVersion_/);
    }

    const rows = await Promise.all(body.extracted.map((member) => fileRow(member.fileId)));
    expect(rows.map((row) => row?.name)).toEqual(["a.txt", "readme.txt"]);
    for (const row of rows) {
      expect(row?.matter_id).toBe(matterId);
      expect(row?.folder_id).toBe(folderId);
      expect(row?.deleted_at).toBeNull();
    }

    // The member nobody asked for was left inside the archive.
    const unrequested = await firmDatabase()
      .prepare("SELECT COUNT(*) AS count FROM file WHERE matter_id = ?1 AND name = 'b.txt'")
      .bind(matterId)
      .first<{ count: number }>();
    expect(unrequested?.count).toBe(0);
  });

  it("takes out the members it can and reports the encrypted one, without stopping on it", async () => {
    const matterId = await seedMatter("Extraction Partial Matter");
    const { fileId } = await seedCleanFileWithBytes(
      matterId,
      "mixed.zip",
      "application/zip",
      markMemberEncrypted(fixtureZip(), "exhibits/a.txt"),
    );

    const response = await extract(fileId, {
      paths: ["readme.txt", "exhibits/a.txt", "exhibits/b.txt"],
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as ExtractionBody;
    expect(body.refused).toEqual([{ path: "exhibits/a.txt", reason: "encrypted" }]);
    // The refusal sat between the two good members and neither of them was lost to it.
    expect(body.extracted.map((member) => member.name)).toEqual(["readme.txt", "b.txt"]);
  });

  it("refuses a path the archive does not hold, by name", async () => {
    const matterId = await seedMatter("Extraction Unknown Path Matter");
    const { fileId } = await seedCleanFileWithBytes(
      matterId,
      "sparse.zip",
      "application/zip",
      fixtureZip(),
    );

    const response = await extract(fileId, { paths: ["nowhere/missing.txt", "readme.txt"] });
    expect(response.status).toBe(202);
    const body = (await response.json()) as ExtractionBody;
    expect(body.refused).toEqual([{ path: "nowhere/missing.txt", reason: "not-in-archive" }]);
    expect(body.extracted.map((member) => member.name)).toEqual(["readme.txt"]);
  });

  it("spends one total budget across the request: once it is gone, the rest are refused", async () => {
    const matterId = await seedMatter("Extraction Budget Matter");
    const { fileId } = await seedCleanFileWithBytes(
      matterId,
      "budgeted.zip",
      "application/zip",
      zipSync({
        "first.txt": strToU8("f".repeat(40)),
        "second.txt": strToU8("s".repeat(40)),
      }),
    );
    // Both members pass the firm's PER-MEMBER ceiling; only the first fits the running total.
    const capped = JSON.stringify({
      maxDepth: 16,
      maxEntries: 10000,
      maxUncompressedBytes: 40,
      maxExpansionRatio: 100,
    });
    await firmDatabase()
      .prepare(
        "INSERT INTO setting (key, value, updated_at) VALUES ('fileManager.archiveCaps', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .bind(capped, ISO)
      .run();
    try {
      const response = await extract(fileId, { paths: ["first.txt", "second.txt"] });
      expect(response.status).toBe(202);
      const body = (await response.json()) as ExtractionBody;
      expect(body.extracted.map((member) => member.name)).toEqual(["first.txt"]);
      expect(body.refused).toEqual([{ path: "second.txt", reason: "too-large" }]);
    } finally {
      await firmDatabase()
        .prepare("DELETE FROM setting WHERE key = 'fileManager.archiveCaps'")
        .run();
    }
  });

  it("extracts from a soft-deleted archive, and leaves the archive deleted", async () => {
    const matterId = await seedMatter("Extraction Deleted Archive Matter");
    const { fileId } = await seedCleanFileWithBytes(
      matterId,
      "deleted.zip",
      "application/zip",
      fixtureZip(),
    );
    const deletion = await SELF.fetch(`https://example.com/api/v1/files/${fileId}`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        cookie: ownerCookie,
        "Idempotency-Key": crypto.randomUUID(),
      },
    });
    expect(deletion.status).toBe(200);

    const response = await extract(fileId, { paths: ["readme.txt"] });
    expect(response.status).toBe(202);
    const body = (await response.json()) as ExtractionBody;
    expect(body.extracted).toHaveLength(1);
    // The member is filed live on the matter; the container it came out of stays deleted.
    const extractedRow = await fileRow(body.extracted[0]?.fileId ?? "");
    expect(extractedRow?.deleted_at).toBeNull();
    expect((await fileRow(fileId))?.deleted_at).not.toBeNull();
  });

  it("422s a file that is not a zip", async () => {
    const matterId = await seedMatter("Extraction Not Zip Matter");
    const { fileId } = await seedCleanFileWithBytes(
      matterId,
      "notes.txt",
      "text/plain",
      strToU8("just text"),
    );
    const response = await extract(fileId, { paths: ["readme.txt"] });
    expect(response.status).toBe(422);
  });

  it("409s an archive with no committed version — there is nothing inside it yet", async () => {
    const matterId = await seedMatter("Extraction Pending Matter");
    const database = firmDatabase();
    const fileId = newIdentifier("file");
    const versionId = newIdentifier("fileVersion");
    await database
      .prepare(
        "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'inflight.zip', NULL, NULL, NULL, ?3, ?3)",
      )
      .bind(fileId, matterId, ISO)
      .run();
    await database
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, declared_content_type, status, uploaded_by, created_at) VALUES (?1, ?2, 1, ?3, 'application/zip', 'pending', ?4, ?5)",
      )
      .bind(versionId, fileId, `files/${fileId}/${versionId}`, ownerUserId, ISO)
      .run();
    const response = await extract(fileId, { paths: ["readme.txt"] });
    expect(response.status).toBe(409);
  });

  it("403s a Read-only member (extraction rides files:upload)", async () => {
    const matterId = await seedMatter("Extraction Read-only Matter");
    const { fileId } = await seedCleanFileWithBytes(
      matterId,
      "forbidden.zip",
      "application/zip",
      fixtureZip(),
    );
    const response = await extract(fileId, { paths: ["readme.txt"] }, readOnlyCookie);
    expect(response.status).toBe(403);
  });

  it("files the member pending, not clean: the ingest gate is what commits it", async () => {
    const matterId = await seedMatter("Extraction Gate Matter");
    const memberBytes = strToU8("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");
    const { fileId } = await seedCleanFileWithBytes(
      matterId,
      "gated.zip",
      "application/zip",
      zipSync({ "gate.pdf": memberBytes }),
    );

    const response = await extract(fileId, { paths: ["gate.pdf"] });
    expect(response.status).toBe(202);
    const body = (await response.json()) as ExtractionBody;
    const filed = body.extracted[0];
    expect(filed?.name).toBe("gate.pdf");

    const version = await firmDatabase()
      .prepare("SELECT status, r2_key, size_bytes FROM file_version WHERE id = ?1")
      .bind(filed?.versionId ?? "")
      .first<{ status: string; r2_key: string; size_bytes: number | null }>();
    // Nothing here copied a verdict out of the archive: the version is pending and the file has no
    // current version until something inspects the bytes.
    expect(version?.status).toBe("pending");
    expect((await fileRow(filed?.fileId ?? ""))?.current_version_id).toBeNull();
    // The bytes are in the bucket the ingest consumer reads back from, byte for byte.
    const stored = await env.R2.get(version?.r2_key ?? "");
    expect(stored).not.toBeNull();
    expect(new Uint8Array((await stored?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(
      memberBytes,
    );

    // Driving the event the extraction enqueued (Miniflare fires no R2 notification) takes the
    // member the rest of the way, exactly as an uploaded file's would.
    await handleIngestMessage(env, {
      bucket: "R2",
      object: { key: version?.r2_key ?? "", size: memberBytes.byteLength },
      action: "PutObject",
    });
    const settled = await firmDatabase()
      .prepare("SELECT status FROM file_version WHERE id = ?1")
      .bind(filed?.versionId ?? "")
      .first<{ status: string }>();
    expect(settled?.status).toBe("clean");
    expect((await fileRow(filed?.fileId ?? ""))?.current_version_id).toBe(filed?.versionId);
  });
});
