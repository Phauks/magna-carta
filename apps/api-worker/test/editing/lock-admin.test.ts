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

// The exclusive-lock + administration surface: an opt-in exclusive checkout makes a second member's
// edit launch read-only (others still read), and a holder of documents:forceReleaseLock can release
// another member's lock — auditing both the actor and the displaced holder, and freeing the document.
//
// Every member here holds nothing but a seeded role, and the two seats are exactly the split the
// force-release seed draws: an Admin may displace a colleague's hold, and a Paralegal — who
// may edit, may take the copy offline, and may hold the exclusive lock — may not.

const ISO = "2026-06-20T00:00:00.000Z";
let firmId: FirmId;
let firmDb: ReturnType<typeof firmDatabaseHandle>;
let matterId: MatterId;
let ownerUserId: UserId;
let holderUserId: UserId;
let revokedUserId: UserId;
let ownerCookie: string; // Admin: edit + checkout + forceReleaseLock
let holderCookie: string; // Paralegal: edit + checkout, no force-release
let editorBCookie: string; // Paralegal: edit + checkout, no force-release
let revokedCookie: string; // Paralegal: checkout (then deactivated)

async function seedCleanFile(): Promise<{ fileId: FileId; versionId: FileVersionId }> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  await firmDb
    .prepare(
      "INSERT INTO file (id, matter_id, name, current_version_id, created_at, updated_at) VALUES (?1, ?2, 'Brief.docx', NULL, ?3, ?3)",
    )
    .bind(fileId, matterId, ISO)
    .run();
  await firmDb
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, content_sha256, status, uploaded_by, created_at, committed_at) VALUES (?1, ?2, 1, ?3, 10, 'seed-hash', 'clean', ?4, ?5, ?5)",
    )
    .bind(versionId, fileId, `files/${fileId}/${versionId}`, ownerUserId, ISO)
    .run();
  await firmDb
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  return { fileId, versionId };
}

function checkout(fileId: FileId, cookie: string, body: unknown = {}): Promise<Response> {
  return SELF.fetch(`https://example.com/api/v1/documents/${fileId}/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com", cookie },
    body: JSON.stringify(body),
  });
}

function editSession(fileId: FileId, cookie: string): Promise<Response> {
  return SELF.fetch(`https://example.com/api/v1/documents/${fileId}/edit-session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com", cookie },
  });
}

function forceRelease(fileId: FileId, cookie: string): Promise<Response> {
  return SELF.fetch(`https://example.com/api/v1/documents/${fileId}/force-release`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com", cookie },
  });
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Lock Firm", databaseIdentifier: "DB_FIRM_POOL_1" })).firmId;
  firmDb = firmDatabaseHandle(firmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(firmId)
    .run();

  const owner = await seedCredentialedUser("lock-owner@example.com", { firmId });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Lock Owner", firmId);
  ownerCookie = await signInForSessionCookie("lock-owner@example.com");

  const holder = await seedCredentialedUser("lock-holder@example.com", { firmId });
  holderUserId = holder.userId;
  await mirrorMemberWithRole(holder.userId, "Lock Holder", firmId, "Paralegal");
  holderCookie = await signInForSessionCookie("lock-holder@example.com");

  const editorB = await seedCredentialedUser("lock-editorb@example.com", { firmId });
  await mirrorMemberWithRole(editorB.userId, "Lock EditorB", firmId, "Paralegal");
  editorBCookie = await signInForSessionCookie("lock-editorb@example.com");

  const revoked = await seedCredentialedUser("lock-revoked@example.com", { firmId });
  revokedUserId = revoked.userId;
  await mirrorMemberWithRole(revoked.userId, "Lock Revoked", firmId, "Paralegal");
  revokedCookie = await signInForSessionCookie("lock-revoked@example.com");

  matterId = newIdentifier("matter");
  await firmDb
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'M', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, ownerUserId, ISO)
    .run();
});

describe("exclusive lock", () => {
  it("an exclusive checkout makes a second member's edit launch read-only (the holder still edits)", async () => {
    const { fileId } = await seedCleanFile();

    const taken = await checkout(fileId, holderCookie, { lockType: "exclusive" });
    expect(taken.status).toBe(200);
    const lockRow = await firmDb
      .prepare("SELECT lock_type FROM document_checkout WHERE file_id = ?1 AND status = 'active'")
      .bind(fileId)
      .first<{ lock_type: string }>();
    expect(lockRow?.lock_type).toBe("exclusive");
    const editState = await firmDb
      .prepare("SELECT edit_state FROM file WHERE id = ?1")
      .bind(fileId)
      .first<{ edit_state: string }>();
    expect(editState?.edit_state).toBe("checked_out");

    // A different member launching an edit session is forced read-only.
    const otherLaunch = await editSession(fileId, editorBCookie);
    expect(otherLaunch.status).toBe(200);
    expect(((await otherLaunch.json()) as { capability: string }).capability).toBe("view");

    // The lock holder still gets an editing capability on their own lock.
    const holderLaunch = await editSession(fileId, holderCookie);
    expect(((await holderLaunch.json()) as { capability: string }).capability).toBe("edit");
    // ...and the document stays checked_out (an exclusive lock is NOT co-editing) — not flipped.
    const afterHolderLaunch = await firmDb
      .prepare("SELECT edit_state FROM file WHERE id = ?1")
      .bind(fileId)
      .first<{ edit_state: string }>();
    expect(afterHolderLaunch?.edit_state).toBe("checked_out");
  });

  it("refuses a second exclusive lock while one is active", async () => {
    const { fileId } = await seedCleanFile();
    expect((await checkout(fileId, holderCookie, { lockType: "exclusive" })).status).toBe(200);
    expect((await checkout(fileId, ownerCookie, { lockType: "exclusive" })).status).toBe(409);
  });
});

describe("force-release", () => {
  it("releases another member's exclusive lock, frees the document, and audits both parties", async () => {
    const { fileId } = await seedCleanFile();
    expect((await checkout(fileId, holderCookie, { lockType: "exclusive" })).status).toBe(200);

    const released = await forceRelease(fileId, ownerCookie);
    expect(released.status).toBe(200);

    const lockRow = await firmDb
      .prepare("SELECT status FROM document_checkout WHERE file_id = ?1")
      .bind(fileId)
      .first<{ status: string }>();
    expect(lockRow?.status).toBe("released");
    const editState = await firmDb
      .prepare("SELECT edit_state FROM file WHERE id = ?1")
      .bind(fileId)
      .first<{ edit_state: string }>();
    expect(editState?.edit_state).toBe("idle");

    // After release a second member can edit again.
    const relaunch = await editSession(fileId, editorBCookie);
    expect(((await relaunch.json()) as { capability: string }).capability).toBe("edit");

    // The audit names the actor (owner) and the displaced holder.
    const audit = await firmDb
      .prepare(
        "SELECT actor_user_id, metadata FROM audit_log WHERE event = 'document.lock_force_released' AND subject_id = ?1",
      )
      .bind(fileId)
      .first<{ actor_user_id: string; metadata: string }>();
    expect(audit?.actor_user_id).toBe(ownerUserId);
    expect(audit?.metadata).toContain(holderUserId);
  });

  it("404s a document with no active lock to release", async () => {
    const { fileId } = await seedCleanFile();
    expect((await forceRelease(fileId, ownerCookie)).status).toBe(404);
  });

  it("force-releasing an offline checkout leaves edit_state untouched (does not clobber coediting)", async () => {
    const { fileId } = await seedCleanFile();
    // An offline checkout is out AND others are co-editing online (edit_state = coediting).
    expect((await checkout(fileId, holderCookie)).status).toBe(200);
    await firmDb
      .prepare("UPDATE file SET edit_state = 'coediting' WHERE id = ?1")
      .bind(fileId)
      .run();
    expect((await forceRelease(fileId, ownerCookie)).status).toBe(200);
    // The offline checkout never held the editing posture, so its release must not drop coediting.
    const editState = await firmDb
      .prepare("SELECT edit_state FROM file WHERE id = ?1")
      .bind(fileId)
      .first<{ edit_state: string }>();
    expect(editState?.edit_state).toBe("coediting");
  });

  it("denies a Paralegal — an editor's seat carries no authority to displace another member's hold", async () => {
    const { fileId } = await seedCleanFile();
    expect((await checkout(fileId, holderCookie, { lockType: "exclusive" })).status).toBe(200);
    expect((await forceRelease(fileId, editorBCookie)).status).toBe(403);
  });

  it("force-releases a deactivated member's offline checkout (cleanup), while their own access is gone", async () => {
    const { fileId } = await seedCleanFile();
    expect((await checkout(fileId, revokedCookie)).status).toBe(200);

    // The member is deactivated — the chokepoint now 404s their own requests.
    await firmDb
      .prepare("UPDATE member SET status = 'inactive' WHERE user_id = ?1")
      .bind(revokedUserId)
      .run();
    expect((await checkout(fileId, revokedCookie, { lockType: "exclusive" })).status).toBe(404);

    // An authorized admin can still force-release the stranded checkout.
    expect((await forceRelease(fileId, ownerCookie)).status).toBe(200);
    const lockRow = await firmDb
      .prepare("SELECT status FROM document_checkout WHERE file_id = ?1")
      .bind(fileId)
      .first<{ status: string }>();
    expect(lockRow?.status).toBe("released");
  });
});
