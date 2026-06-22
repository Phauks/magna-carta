import { env, SELF } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  DocumentCheckoutId,
  FileId,
  FileVersionId,
  FirmId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "../support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "../support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "../support/test-auth.ts";

// Human reconciliation of a divergent check-in over the real chokepoint. A document carries a
// conflict_pending conflicting copy (the offline edit) alongside its advanced current version; the
// holder of documents:reconcile chooses which copy is authoritative. The conflicting copy is retained
// forever regardless of the choice. documents:reconcile is granted directly to the owner; a second
// member without it exercises the RBAC denial.

const ISO = "2026-06-20T00:00:00.000Z";
let firmId: FirmId;
let matterId: MatterId;
let ownerUserId: UserId;
let ownerCookie: string;
let noPermCookie: string;

// A file whose current is v2, with a v3 conflict_pending copy diverged from v1, and a reconciling
// checkout — the exact state commitCheckinVersion leaves on a divergent check-in.
async function seedConflict(): Promise<{
  fileId: FileId;
  baseVersionId: FileVersionId;
  currentVersionId: FileVersionId;
  conflictVersionId: FileVersionId;
  checkoutId: DocumentCheckoutId;
}> {
  const fileId = newIdentifier("file");
  const v1 = newIdentifier("fileVersion");
  const v2 = newIdentifier("fileVersion");
  const v3 = newIdentifier("fileVersion");
  const checkoutId = newIdentifier("documentCheckout");
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'Brief.docx', NULL, NULL, NULL, ?3, ?3)",
  )
    .bind(fileId, matterId, ISO)
    .run();
  const insertVersion = (
    id: string,
    n: number,
    reconciliation: string,
    divergedFrom: string | null,
  ) =>
    env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, content_sha256, status, reconciliation_status, diverged_from_version_id, checkout_id, uploaded_by, created_at, committed_at) VALUES (?1, ?2, ?3, ?4, 10, ?5, 'clean', ?6, ?7, ?8, ?9, ?10, ?10)",
    )
      .bind(
        id,
        fileId,
        n,
        `files/${fileId}/${id}`,
        `hash-${n}`,
        reconciliation,
        divergedFrom,
        reconciliation === "conflict_pending" ? checkoutId : null,
        ownerUserId,
        ISO,
      )
      .run();
  await insertVersion(v1, 1, "clean", null);
  await insertVersion(v2, 2, "clean", null);
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO document_checkout (id, file_id, holder_member_id, lock_type, base_version_id, acquired_at, last_activity_at, status, idle_release_at) VALUES (?1, ?2, ?3, 'offline_working_copy', ?4, ?5, ?5, 'reconciling', NULL)",
  )
    .bind(checkoutId, fileId, ownerUserId, v1, ISO)
    .run();
  await insertVersion(v3, 3, "conflict_pending", v1);
  await env.DB_FIRM_POOL_1.prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, v2)
    .run();
  return {
    fileId,
    baseVersionId: v1,
    currentVersionId: v2,
    conflictVersionId: v3,
    checkoutId,
  };
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  firmId = (await seedFirm({ name: "Reconcile Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(firmId)
    .run();

  const owner = await seedCredentialedUser("reconcile-owner@example.com", { firmId });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Reconcile Owner");
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO direct_grant (id, member_user_id, permission, expires_at, granted_by, created_at) VALUES (?1, ?2, 'documents:reconcile', NULL, ?2, ?3)",
  )
    .bind(newIdentifier("grant"), owner.userId, ISO)
    .run();
  ownerCookie = await signInForSessionCookie("reconcile-owner@example.com");

  const noPerm = await seedCredentialedUser("reconcile-noperm@example.com", { firmId });
  await mirrorMemberWithOwnerRole(noPerm.userId, "Reconcile NoPerm");
  noPermCookie = await signInForSessionCookie("reconcile-noperm@example.com");

  matterId = newIdentifier("matter");
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'M', 'open', ?2, ?3, ?3)",
  )
    .bind(matterId, ownerUserId, ISO)
    .run();
});

function reconcile(fileId: FileId, body: unknown, cookie: string): Promise<Response> {
  return SELF.fetch(`https://example.com/api/v1/documents/${fileId}/reconcile`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com", cookie },
    body: JSON.stringify(body),
  });
}

async function versionRow(versionId: string) {
  return env.DB_FIRM_POOL_1.prepare("SELECT reconciliation_status FROM file_version WHERE id = ?1")
    .bind(versionId)
    .first<{ reconciliation_status: string }>();
}

async function currentVersionOf(fileId: string) {
  const row = await env.DB_FIRM_POOL_1.prepare("SELECT current_version_id FROM file WHERE id = ?1")
    .bind(fileId)
    .first<{ current_version_id: string }>();
  return row?.current_version_id;
}

describe("POST /api/v1/documents/{fileId}/reconcile", () => {
  it("keep=current: flags the copy reconciled, leaves current, releases the checkout, retains the copy", async () => {
    const { fileId, currentVersionId, conflictVersionId, checkoutId } = await seedConflict();

    const response = await reconcile(
      fileId,
      { keep: "current", resolvedNote: "kept ours" },
      ownerCookie,
    );
    expect(response.status).toBe(200);

    expect((await versionRow(conflictVersionId))?.reconciliation_status).toBe("reconciled");
    expect(await currentVersionOf(fileId)).toBe(currentVersionId);

    const checkout = await env.DB_FIRM_POOL_1.prepare(
      "SELECT status FROM document_checkout WHERE id = ?1",
    )
      .bind(checkoutId)
      .first<{ status: string }>();
    expect(checkout?.status).toBe("released");

    // The conflicting copy is retained forever and the resolution is audited with the actor + choice.
    const stillThere = await env.DB_FIRM_POOL_1.prepare("SELECT id FROM file_version WHERE id = ?1")
      .bind(conflictVersionId)
      .first<{ id: string }>();
    expect(stillThere?.id).toBe(conflictVersionId);
    const audit = await env.DB_FIRM_POOL_1.prepare(
      "SELECT actor_user_id, metadata FROM audit_log WHERE event = 'document.reconciled' AND subject_id = ?1",
    )
      .bind(fileId)
      .first<{ actor_user_id: string; metadata: string }>();
    expect(audit?.actor_user_id).toBe(ownerUserId);
    expect(audit?.metadata).toContain("current");
  });

  it("keep=incoming: promotes the conflicting copy to current and flags it reconciled", async () => {
    const { fileId, conflictVersionId } = await seedConflict();

    expect((await reconcile(fileId, { keep: "incoming" }, ownerCookie)).status).toBe(200);

    expect((await versionRow(conflictVersionId))?.reconciliation_status).toBe("reconciled");
    expect(await currentVersionOf(fileId)).toBe(conflictVersionId);
  });

  it("keep=both: retains both — current unchanged, the copy flagged reconciled", async () => {
    const { fileId, currentVersionId, conflictVersionId } = await seedConflict();

    expect((await reconcile(fileId, { keep: "both" }, ownerCookie)).status).toBe(200);

    expect((await versionRow(conflictVersionId))?.reconciliation_status).toBe("reconciled");
    expect(await currentVersionOf(fileId)).toBe(currentVersionId);
  });

  it("404s a document with nothing awaiting reconciliation", async () => {
    const id = newIdentifier("file");
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, 'Clean.docx', ?3, ?3)",
    )
      .bind(id, matterId, ISO)
      .run();
    expect((await reconcile(id, { keep: "current" }, ownerCookie)).status).toBe(404);
  });

  it("denies a member without documents:reconcile", async () => {
    const { fileId } = await seedConflict();
    expect((await reconcile(fileId, { keep: "current" }, noPermCookie)).status).toBe(403);
  });
});
