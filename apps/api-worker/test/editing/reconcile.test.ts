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
import { firmDatabaseHandle } from "../support/firm-database-handle.ts";
import {
  mirrorMemberWithRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "../support/test-auth.ts";

// Human reconciliation of a divergent check-in over the real chokepoint. A document carries a
// conflict_pending conflicting copy (the offline edit) alongside its advanced current version; the
// holder of documents:reconcile chooses which copy is authoritative. The conflicting copy is retained
// forever regardless of the choice.
//
// Both members hold nothing but a seeded role, and the denied one is a PARALEGAL rather than a
// Read-only seat on purpose: the paralegal is the member who could have taken the copy out and
// diverged it, and the seed deliberately stops short of letting them decide which copy becomes the
// firm's text of record. That is the whole split, so it is the one the denial asserts.

const ISO = "2026-06-20T00:00:00.000Z";
let firmId: FirmId;
let firmDb: ReturnType<typeof firmDatabaseHandle>;
let matterId: MatterId;
let attorneyUserId: UserId;
let attorneyCookie: string;
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
  await firmDb
    .prepare(
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
    firmDb
      .prepare(
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
        attorneyUserId,
        ISO,
      )
      .run();
  await insertVersion(v1, 1, "clean", null);
  await insertVersion(v2, 2, "clean", null);
  await firmDb
    .prepare(
      "INSERT INTO document_checkout (id, file_id, holder_member_id, lock_type, base_version_id, acquired_at, last_activity_at, status, idle_release_at) VALUES (?1, ?2, ?3, 'offline_working_copy', ?4, ?5, ?5, 'reconciling', NULL)",
    )
    .bind(checkoutId, fileId, attorneyUserId, v1, ISO)
    .run();
  await insertVersion(v3, 3, "conflict_pending", v1);
  await firmDb
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
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
  firmId = (await seedFirm({ name: "Reconcile Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  firmDb = firmDatabaseHandle(firmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(firmId)
    .run();

  // The acting member is an ATTORNEY, not an owner: documents:reconcile is seeded to Admin and
  // Attorney, and the attorney is the seat the wider half of that pair rests on.
  const attorney = await seedCredentialedUser("reconcile-attorney@example.com", { firmId });
  attorneyUserId = attorney.userId;
  await mirrorMemberWithRole(attorney.userId, "Reconcile Attorney", firmId, "Attorney");
  attorneyCookie = await signInForSessionCookie("reconcile-attorney@example.com");

  const noPerm = await seedCredentialedUser("reconcile-noperm@example.com", { firmId });
  await mirrorMemberWithRole(noPerm.userId, "Reconcile NoPerm", firmId, "Paralegal");
  noPermCookie = await signInForSessionCookie("reconcile-noperm@example.com");

  matterId = newIdentifier("matter");
  await firmDb
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'M', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, attorneyUserId, ISO)
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
  return firmDb
    .prepare("SELECT reconciliation_status FROM file_version WHERE id = ?1")
    .bind(versionId)
    .first<{ reconciliation_status: string }>();
}

async function currentVersionOf(fileId: string) {
  const row = await firmDb
    .prepare("SELECT current_version_id FROM file WHERE id = ?1")
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
      attorneyCookie,
    );
    expect(response.status).toBe(200);

    expect((await versionRow(conflictVersionId))?.reconciliation_status).toBe("reconciled");
    expect(await currentVersionOf(fileId)).toBe(currentVersionId);

    const checkout = await firmDb
      .prepare("SELECT status FROM document_checkout WHERE id = ?1")
      .bind(checkoutId)
      .first<{ status: string }>();
    expect(checkout?.status).toBe("released");

    // The conflicting copy is retained forever and the resolution is audited with the actor + choice.
    const stillThere = await firmDb
      .prepare("SELECT id FROM file_version WHERE id = ?1")
      .bind(conflictVersionId)
      .first<{ id: string }>();
    expect(stillThere?.id).toBe(conflictVersionId);
    const audit = await firmDb
      .prepare(
        "SELECT actor_user_id, metadata FROM audit_log WHERE event = 'document.reconciled' AND subject_id = ?1",
      )
      .bind(fileId)
      .first<{ actor_user_id: string; metadata: string }>();
    expect(audit?.actor_user_id).toBe(attorneyUserId);
    expect(audit?.metadata).toContain("current");
  });

  it("keep=incoming: promotes the offline copy FORWARD as a new current version (never regressing), flags it reconciled", async () => {
    const { fileId, currentVersionId, conflictVersionId } = await seedConflict();

    expect((await reconcile(fileId, { keep: "incoming" }, attorneyCookie)).status).toBe(200);

    // The conflicting copy is reconciled (retained), and current advanced to a NEW version (not the
    // conflict, not the old current) carrying the conflict's content — monotonic pointer preserved.
    expect((await versionRow(conflictVersionId))?.reconciliation_status).toBe("reconciled");
    const current = await currentVersionOf(fileId);
    expect(current).not.toBe(conflictVersionId);
    expect(current).not.toBe(currentVersionId);
    const newCurrent = await firmDb
      .prepare("SELECT content_sha256, version_number FROM file_version WHERE id = ?1")
      .bind(current)
      .first<{ content_sha256: string; version_number: number }>();
    expect(newCurrent?.content_sha256).toBe("hash-3"); // the conflict copy's content, brought forward
    expect(newCurrent?.version_number).toBe(4); // advanced past v3, never regressed
  });

  it("resolves ALL conflict_pending copies in one pass (no orphans) when several diverged", async () => {
    const { fileId, conflictVersionId } = await seedConflict();
    // A second offline copy diverged too: another conflict_pending version on the same file.
    const secondConflict = newIdentifier("fileVersion");
    await firmDb
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, content_sha256, status, reconciliation_status, diverged_from_version_id, uploaded_by, created_at, committed_at) VALUES (?1, ?2, 4, ?3, 10, 'hash-4', 'clean', 'conflict_pending', NULL, ?4, ?5, ?5)",
      )
      .bind(secondConflict, fileId, `files/${fileId}/${secondConflict}`, attorneyUserId, ISO)
      .run();

    expect((await reconcile(fileId, { keep: "current" }, attorneyCookie)).status).toBe(200);

    // BOTH conflict copies are reconciled — neither is orphaned.
    expect((await versionRow(conflictVersionId))?.reconciliation_status).toBe("reconciled");
    expect((await versionRow(secondConflict))?.reconciliation_status).toBe("reconciled");
  });

  it("keep=both: retains both — current unchanged, the copy flagged reconciled", async () => {
    const { fileId, currentVersionId, conflictVersionId } = await seedConflict();

    expect((await reconcile(fileId, { keep: "both" }, attorneyCookie)).status).toBe(200);

    expect((await versionRow(conflictVersionId))?.reconciliation_status).toBe("reconciled");
    expect(await currentVersionOf(fileId)).toBe(currentVersionId);
  });

  it("404s a document with nothing awaiting reconciliation", async () => {
    const id = newIdentifier("file");
    await firmDb
      .prepare(
        "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, 'Clean.docx', ?3, ?3)",
      )
      .bind(id, matterId, ISO)
      .run();
    expect((await reconcile(id, { keep: "current" }, attorneyCookie)).status).toBe(404);
  });

  it("denies a Paralegal — the seat that may take the copy out but not decide which copy wins", async () => {
    const { fileId } = await seedConflict();
    expect((await reconcile(fileId, { keep: "current" }, noPermCookie)).status).toBe(403);
  });
});
