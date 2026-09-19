import { env, SELF } from "cloudflare:test";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { commitEditedVersion } from "@magna-carta/file-manager/file-service";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FileId,
  FileVersionId,
  FirmId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { mintEditToken } from "../../src/editing/wopi-token.ts";
import { runTieringSweep } from "../../src/editing/tiering-sweep.ts";
import { handleIngestMessage } from "../../src/files/ingest-consumer.ts";
import { applyControlPlaneMigrations } from "../support/apply-control-plane-migrations.ts";
import { firmDatabaseHandle, type FirmDatabaseHandle } from "../support/firm-database-handle.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "../support/test-auth.ts";

// The slice 2·2 editing lifecycle, end to end over the real chokepoint routes + the mounted WOPI host +
// the quarantine ingest + the background sweeps: launch → edit (WOPI PutFile) → Save cuts a version →
// co-edit + read-only viewer → offline checkout → a check-in that diverged (current advanced meanwhile)
// → conflicting copy → reconcile → exclusive lock makes a second launch read-only → force-release →
// the tiering sweep cools an old superseded version → cross-firm tenancy isolation 404. The document is
// a .pdf so the returning check-in bytes pass the ingest gate deterministically; the editing flow is
// format-agnostic.

const ISO = "2026-06-20T00:00:00.000Z";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer\n%%EOF\n");
let firmA: FirmId;
let firmDbA: FirmDatabaseHandle;
let firmDbB: FirmDatabaseHandle;
let matterA: MatterId;
let ownerId: UserId;
let ownerCookie: string;
let editorCookie: string;
let firmBFileId: FileId;
let firmBVersionId: FileVersionId;

async function grant(
  database: FirmDatabaseHandle,
  userId: UserId,
  permission: string,
): Promise<void> {
  await database
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, expires_at, granted_by, created_at) VALUES (?1, ?2, ?3, NULL, ?2, ?4)",
    )
    .bind(newIdentifier("grant"), userId, permission, ISO)
    .run();
}

async function seedBaseFile(
  database: FirmDatabaseHandle,
  matterId: MatterId,
  uploadedBy: UserId,
): Promise<{ fileId: FileId; versionId: FileVersionId }> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  await database
    .prepare(
      "INSERT INTO file (id, matter_id, name, current_version_id, created_at, updated_at) VALUES (?1, ?2, 'Brief.pdf', NULL, ?3, ?3)",
    )
    .bind(fileId, matterId, ISO)
    .run();
  await database
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, content_sha256, storage_class, status, uploaded_by, created_at, committed_at) VALUES (?1, ?2, 1, ?3, ?4, 'seed-hash', 'standard', 'clean', ?5, ?6, ?6)",
    )
    .bind(versionId, fileId, `files/${fileId}/${versionId}`, PDF_BYTES.byteLength, uploadedBy, ISO)
    .run();
  await database
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  await env.R2.put(`files/${fileId}/${versionId}`, PDF_BYTES);
  return { fileId, versionId };
}

// Cut a new version from the live working object — the deliberate-Save / advance step. (The container
// drives this on a real Save; here it is invoked directly through the same file-service path.)
async function cutVersion(fileId: FileId, hash: string): Promise<void> {
  await env.R2.put(`files/${fileId}/current`, PDF_BYTES);
  const result = await commitEditedVersion(
    firmDbA,
    {
      fileId,
      currentR2Key: `files/${fileId}/current`,
      contentSha256: hash,
      sizeBytes: PDF_BYTES.byteLength,
      uploadedBy: ownerId,
      saveKind: "explicit",
      participants: [],
    },
    { clock: { now: () => new Date().toISOString() }, actorUserId: ownerId },
    async (from, to) => {
      const object = await env.R2.get(from);
      if (object !== null) await env.R2.put(to, object.body);
    },
  );
  await commitEffectBatch(firmDbA, result.effect, {
    now: () => new Date().toISOString(),
  });
}

const api = (path: string, cookie: string, body?: unknown): Promise<Response> =>
  SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com", cookie },
    ...(body !== undefined ? { body: JSON.stringify(body) } : { body: "{}" }),
  });

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmA = (await seedFirm({ name: "Editing E2E A", databaseIdentifier: "DB_FIRM_POOL_1" })).firmId;
  firmDbA = firmDatabaseHandle(firmA);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(firmA)
    .run();
  // Firm B holds a document the firm-A token must never reach (the tenancy-isolation step).
  const firmB = (await seedFirm({ name: "Editing E2E B", databaseIdentifier: "DB_FIRM_POOL_2" }))
    .firmId;
  firmDbB = firmDatabaseHandle(firmB);

  const owner = await seedCredentialedUser("e2e-edit-owner@example.com", { firmId: firmA });
  ownerId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "E2E Owner", firmA);
  for (const permission of [
    "documents:edit",
    "documents:checkout",
    "documents:reconcile",
    "documents:forceReleaseLock",
  ]) {
    await grant(firmDbA, owner.userId, permission);
  }
  ownerCookie = await signInForSessionCookie("e2e-edit-owner@example.com");

  const editor = await seedCredentialedUser("e2e-edit-editor@example.com", { firmId: firmA });
  await mirrorMemberWithOwnerRole(editor.userId, "E2E Editor", firmA);
  await grant(firmDbA, editor.userId, "documents:edit");
  editorCookie = await signInForSessionCookie("e2e-edit-editor@example.com");

  matterA = newIdentifier("matter");
  await firmDbA
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'M', 'open', ?2, ?3, ?3)",
    )
    .bind(matterA, ownerId, ISO)
    .run();

  // Firm B: a member, a matter, and a document the firm-A token must never reach.
  await firmDbB
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'B', 'active', ?2)",
    )
    .bind("user_e2e_b" as UserId, ISO)
    .run();
  const matterB = newIdentifier("matter");
  await firmDbB
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'MB', 'open', ?2, ?3, ?3)",
    )
    .bind(matterB, "user_e2e_b" as UserId, ISO)
    .run();
  const fileB = await seedBaseFile(firmDbB, matterB, "user_e2e_b" as UserId);
  firmBFileId = fileB.fileId;
  firmBVersionId = fileB.versionId;
});

async function currentVersionOf(fileId: FileId): Promise<string | undefined> {
  const row = await firmDbA
    .prepare("SELECT current_version_id FROM file WHERE id = ?1")
    .bind(fileId)
    .first<{ current_version_id: string }>();
  return row?.current_version_id;
}

describe("editing lifecycle e2e", () => {
  it("runs launch → edit → save → co-edit → view → checkout → divergent check-in → reconcile → lock → force-release → tiering → cross-firm 404", async () => {
    const { fileId, versionId: v1 } = await seedBaseFile(firmDbA, matterA, ownerId);

    // 1. Launch an editing session — an edit-capability WOPI token.
    const launch = await api(`/api/v1/documents/${fileId}/edit-session`, ownerCookie);
    expect(launch.status).toBe(200);
    const launchBody = (await launch.json()) as { capability: string; accessToken: string };
    expect(launchBody.capability).toBe("edit");
    const editToken = encodeURIComponent(launchBody.accessToken);

    // 2. WOPI CheckFileInfo + GetFile + PutFile (the editor's data plane on the mounted host).
    const info = await SELF.fetch(
      `https://example.com/wopi/files/${fileId}?access_token=${editToken}`,
    );
    expect(info.status).toBe(200);
    expect(((await info.json()) as { UserCanWrite: boolean }).UserCanWrite).toBe(true);
    // Collabora takes the WOPI lock before saving; the host requires a lock for PutFile.
    const lock = await SELF.fetch(
      `https://example.com/wopi/files/${fileId}?access_token=${editToken}`,
      { method: "POST", headers: { "X-WOPI-Override": "LOCK", "X-WOPI-Lock": "editor-lock" } },
    );
    expect(lock.status).toBe(200);
    const put = await SELF.fetch(
      `https://example.com/wopi/files/${fileId}/contents?access_token=${editToken}`,
      { method: "POST", body: PDF_BYTES },
    );
    expect(put.status).toBe(200);

    // 3. A deliberate Save cuts an immutable version → current advances to v2.
    await cutVersion(fileId, "hash-v2");
    const v2 = await currentVersionOf(fileId);
    expect(v2).not.toBe(v1);

    // 4. A second editor joins (co-edit) and a viewer opens read-only.
    expect((await api(`/api/v1/documents/${fileId}/edit-session`, editorCookie)).status).toBe(200);
    const view = await SELF.fetch(`https://example.com/api/v1/documents/${fileId}/view-session`, {
      headers: { origin: "https://example.com", cookie: editorCookie },
    });
    expect(view.status).toBe(200);
    expect(((await view.json()) as { capability: string }).capability).toBe("view");

    // 5. Offline checkout (base = current v2), then current advances to v3 while the copy is out.
    const checkout = await api(`/api/v1/documents/${fileId}/checkout`, ownerCookie);
    expect(checkout.status).toBe(200);
    const checkoutId = ((await checkout.json()) as { checkoutId: string }).checkoutId;
    await cutVersion(fileId, "hash-v3");
    const v3 = await currentVersionOf(fileId);

    // 6. Check-in the offline copy — a pending version routed through the quarantine ingest.
    const checkin = await api(`/api/v1/documents/${fileId}/checkin`, ownerCookie, { checkoutId });
    expect(checkin.status).toBe(200);
    const checkinKey = ((await checkin.json()) as { key: string }).key;
    await env.R2.put(checkinKey, PDF_BYTES);
    // Drive the ingest over the returning bytes — base (v2) != current (v3) → a conflicting copy.
    await handleIngestMessage(env, {
      bucket: "R2",
      object: { key: checkinKey, size: PDF_BYTES.byteLength },
      action: "PutObject",
    });
    const conflict = await firmDbA
      .prepare("SELECT reconciliation_status FROM file_version WHERE r2_key = ?1")
      .bind(checkinKey)
      .first<{ reconciliation_status: string }>();
    expect(conflict?.reconciliation_status).toBe("conflict_pending");
    expect(await currentVersionOf(fileId)).toBe(v3); // current never regressed to the conflicting copy

    // 7. Reconcile (keep current) — the flag clears, the checkout releases, the copy is retained.
    expect(
      (await api(`/api/v1/documents/${fileId}/reconcile`, ownerCookie, { keep: "current" })).status,
    ).toBe(200);
    const reconciled = await firmDbA
      .prepare("SELECT reconciliation_status FROM file_version WHERE r2_key = ?1")
      .bind(checkinKey)
      .first<{ reconciliation_status: string }>();
    expect(reconciled?.reconciliation_status).toBe("reconciled");

    // 8. Exclusive lock makes a second member's edit launch read-only.
    expect(
      (await api(`/api/v1/documents/${fileId}/checkout`, ownerCookie, { lockType: "exclusive" }))
        .status,
    ).toBe(200);
    const lockedLaunch = await api(`/api/v1/documents/${fileId}/edit-session`, editorCookie);
    expect(((await lockedLaunch.json()) as { capability: string }).capability).toBe("view");

    // 9. Force-release frees the document — the second member can edit again.
    expect((await api(`/api/v1/documents/${fileId}/force-release`, ownerCookie)).status).toBe(200);
    const relaunch = await api(`/api/v1/documents/${fileId}/edit-session`, editorCookie);
    expect(((await relaunch.json()) as { capability: string }).capability).toBe("edit");

    // 10. The tiering sweep cools a cold, superseded Standard version (v1) to Infrequent Access.
    await firmDbA
      .prepare("UPDATE file_version SET committed_at = '2020-01-01T00:00:00.000Z' WHERE id = ?1")
      .bind(v1)
      .run();
    const tiered = await runTieringSweep(env, { now: Date.parse("2026-06-23T00:00:00.000Z") });
    expect(tiered.tiered).toBeGreaterThanOrEqual(1);
    const v1Class = await firmDbA
      .prepare("SELECT storage_class FROM file_version WHERE id = ?1")
      .bind(v1)
      .first<{ storage_class: string }>();
    expect(v1Class?.storage_class).toBe("infrequent_access");

    // 11. Tenancy isolation: a firm-A token never reaches firm B's document.
    const crossFirmToken = await mintEditToken(
      {
        firmId: firmA,
        matterId: matterA,
        fileId: firmBFileId,
        versionId: firmBVersionId,
        memberId: ownerId,
        capability: "edit",
        sessionId: "e2e",
        exp: Date.now() + 60 * 60 * 1000,
      },
      env,
    );
    const crossFirm = await SELF.fetch(
      `https://example.com/wopi/files/${firmBFileId}?access_token=${encodeURIComponent(crossFirmToken)}`,
    );
    expect(crossFirm.status).toBe(404);
  });
});
