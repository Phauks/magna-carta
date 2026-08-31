import { env, SELF } from "cloudflare:test";
import { strToU8, zipSync } from "fflate";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FileId,
  FileVersionId,
  FirmId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// Browse Inside a zip: GET /api/v1/files/{id}/archive-entries reads the archive's central directory
// straight from R2 (ranged reads, no extraction) and returns the flat entry list. Real zip bytes are
// written into the test R2 so the route exercises the actual parser against a real writer's output.

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;

const ISO = "2026-06-14T00:00:00.000Z";

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

// A clean file whose committed bytes are supplied verbatim — the same seeding shape
// files-deleted-history.test.ts uses, with the sniffed type under the caller's control.
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
    "exhibits/": new Uint8Array(0),
    "exhibits/a.txt": strToU8("exhibit a"),
  });
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Archive Entries Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();
  const owner = await seedCredentialedUser("archive-owner@example.com", {
    userName: "Archive Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Archive Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("archive-owner@example.com");
});

async function get(path: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { cookie: ownerCookie, origin: "https://example.com" },
  });
}

interface ArchiveEntriesBody {
  entries: {
    path: string;
    isDirectory: boolean;
    compressedSizeBytes: number;
    uncompressedSizeBytes: number;
    modifiedAt: string | null;
  }[];
  truncated: boolean;
}

describe("GET /api/v1/files/{id}/archive-entries", () => {
  it("lists a seeded zip's entries from the central directory", async () => {
    const matterId = await seedMatter("Archive Listing Matter");
    const { fileId } = await seedCleanFileWithBytes(
      matterId,
      "bundle.zip",
      "application/zip",
      fixtureZip(),
    );
    const response = await get(`/api/v1/files/${fileId}/archive-entries`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ArchiveEntriesBody;
    expect(body.truncated).toBe(false);
    expect(body.entries.map((entry) => entry.path).toSorted()).toEqual([
      "exhibits/",
      "exhibits/a.txt",
      "readme.txt",
    ]);
    const readme = body.entries.find((entry) => entry.path === "readme.txt");
    expect(readme?.isDirectory).toBe(false);
    expect(readme?.uncompressedSizeBytes).toBe("hello archive".length);
    expect(body.entries.find((entry) => entry.path === "exhibits/")?.isDirectory).toBe(true);
  });

  it("browses a soft-deleted zip exactly like a live one", async () => {
    const matterId = await seedMatter("Archive Deleted Matter");
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

    const response = await get(`/api/v1/files/${fileId}/archive-entries`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ArchiveEntriesBody;
    expect(body.entries.length).toBe(3);
    // Browsing restored nothing — the file is still deleted.
    const row = await firmDatabase()
      .prepare("SELECT deleted_at FROM file WHERE id = ?1")
      .bind(fileId)
      .first<{ deleted_at: string | null }>();
    expect(row?.deleted_at).not.toBeNull();
  });

  it("422s a file that is not a zip", async () => {
    const matterId = await seedMatter("Archive Not Zip Matter");
    const { fileId } = await seedCleanFileWithBytes(
      matterId,
      "notes.txt",
      "text/plain",
      strToU8("just text"),
    );
    const response = await get(`/api/v1/files/${fileId}/archive-entries`);
    expect(response.status).toBe(422);
  });

  it("422s a zip-named file whose bytes are not a readable archive (no sniff recorded)", async () => {
    const matterId = await seedMatter("Archive Lying Name Matter");
    const { fileId } = await seedCleanFileWithBytes(
      matterId,
      "impostor.zip",
      null,
      strToU8("not zip bytes at all, however the name reads"),
    );
    const response = await get(`/api/v1/files/${fileId}/archive-entries`);
    expect(response.status).toBe(422);
  });

  it("409s a pending-only file — there are no bytes to read yet", async () => {
    const matterId = await seedMatter("Archive Pending Matter");
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
    const response = await get(`/api/v1/files/${fileId}/archive-entries`);
    expect(response.status).toBe(409);
  });

  it("404s when the stored object is gone from the bucket, and for an unknown file", async () => {
    const matterId = await seedMatter("Archive Gone Object Matter");
    const { fileId, r2Key } = await seedCleanFileWithBytes(
      matterId,
      "vanished.zip",
      "application/zip",
      fixtureZip(),
    );
    await env.R2.delete(r2Key);
    expect((await get(`/api/v1/files/${fileId}/archive-entries`)).status).toBe(404);
    expect((await get(`/api/v1/files/${newIdentifier("file")}/archive-entries`)).status).toBe(404);
  });

  it("truncates at the firm's archive entry cap", async () => {
    const matterId = await seedMatter("Archive Cap Matter");
    const { fileId } = await seedCleanFileWithBytes(
      matterId,
      "many.zip",
      "application/zip",
      zipSync({
        "one.txt": strToU8("1"),
        "two.txt": strToU8("2"),
        "three.txt": strToU8("3"),
        "four.txt": strToU8("4"),
      }),
    );
    // Tighten the firm's archive-expansion entry cap for this test only, restoring it after so the
    // shared pool firm's other tests keep the default.
    const capped = JSON.stringify({
      maxDepth: 16,
      maxEntries: 2,
      maxUncompressedBytes: 4294967296,
      maxExpansionRatio: 100,
    });
    await firmDatabase()
      .prepare(
        "INSERT INTO setting (key, value, updated_at) VALUES ('fileManager.archiveCaps', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .bind(capped, ISO)
      .run();
    try {
      const response = await get(`/api/v1/files/${fileId}/archive-entries`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as ArchiveEntriesBody;
      expect(body.entries).toHaveLength(2);
      expect(body.truncated).toBe(true);
    } finally {
      await firmDatabase()
        .prepare("DELETE FROM setting WHERE key = 'fileManager.archiveCaps'")
        .run();
    }
  });
});
