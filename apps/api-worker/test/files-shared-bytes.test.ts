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
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

/*
 * Bytes the firm holds belong to every file that names them. A file the firm already holds is never
 * uploaded again — the upload dialog hashes it and a match is made from the held bytes — so two
 * rows can stand behind one set of bytes, on one matter or two. Deleting one of them must leave the
 * bytes where they are: the other file still reads them, and the deleted one is recoverable.
 * Driven through the real DELETE route, because that is the one place a delete destroys anything.
 */

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let matterId: MatterId;

const ISO = "2026-06-13T00:00:00.000Z";
const SHARED_HASH = "f".repeat(64);
const SHARED_BYTES = "%PDF-1.4 the brief both files hold";

function firmDatabase() {
  return firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
}

/** A clean file whose one committed version holds SHARED_BYTES under its own object key. */
async function seedFileHoldingSharedBytes(
  name: string,
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
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, scan_verdict, scan_engine_version, status, uploaded_by, created_at, committed_at) VALUES (?1, ?2, 1, ?3, ?4, 'application/pdf', 'application/pdf', ?5, 'clean', 'engine-9', 'clean', ?6, ?7, ?7)",
    )
    .bind(versionId, fileId, r2Key, SHARED_BYTES.length, SHARED_HASH, ownerUserId, ISO)
    .run();
  await database
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  await env.R2.put(r2Key, SHARED_BYTES, {
    customMetadata: { matter: matterId, object_class: "working-document" },
  });
  return { fileId, versionId, r2Key };
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Shared Bytes Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();
  const owner = await seedCredentialedUser("shared-bytes-owner@example.com", {
    userName: "Shared Bytes Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Shared Bytes Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("shared-bytes-owner@example.com");
  matterId = newIdentifier("matter");
  await firmDatabase()
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Shared Bytes Matter', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, ownerUserId, ISO)
    .run();
});

async function deleteThroughTheRoute(fileId: string): Promise<Response> {
  return SELF.fetch(`https://example.com/api/v1/files/${fileId}`, {
    method: "DELETE",
    headers: {
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
  });
}

describe("DELETE /api/v1/files/{id} over bytes two files hold", () => {
  it("two rows, one delete: both objects remain, and the surviving file still downloads", async () => {
    const kept = await seedFileHoldingSharedBytes("kept.pdf");
    const deleted = await seedFileHoldingSharedBytes("deleted.pdf");

    const response = await deleteThroughTheRoute(deleted.fileId);
    expect(response.status).toBe(200);

    // The deleted file's own object stays: the row is recoverable, and the bytes are also the
    // other file's. Nothing about a delete may reach into storage past the working copy.
    expect(await env.R2.head(deleted.r2Key)).not.toBeNull();
    expect(await env.R2.head(kept.r2Key)).not.toBeNull();
    expect(await (await env.R2.get(kept.r2Key))?.text()).toBe(SHARED_BYTES);

    const download = await SELF.fetch(`https://example.com/api/v1/files/${kept.fileId}/download`, {
      headers: { origin: "https://example.com", cookie: ownerCookie },
      redirect: "manual",
    });
    expect(download.status).toBe(302);

    // And the deleted file's version row still names its bytes, which is what keeps them alive
    // for whichever file is deleted next.
    const { results } = await firmDatabase()
      .prepare("SELECT content_sha256, r2_key FROM file_version WHERE file_id = ?1")
      .bind(deleted.fileId)
      .all<{ content_sha256: string; r2_key: string }>();
    expect(results).toEqual([{ content_sha256: SHARED_HASH, r2_key: deleted.r2Key }]);
  });
});
