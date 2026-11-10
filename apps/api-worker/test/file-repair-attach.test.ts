import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { readRepairProvenance } from "@magna-carta/data-access/file-repair-provenance-statements";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FileId, FirmId, FolderId, MatterId, RoleId } from "@magna-carta/identifiers/types";
import { createApp } from "../src/http/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { handleIngestMessage } from "../src/background/files/ingest-consumer.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The Admin role id is a committed literal from 0002_member-rbac.sql.
const OWNER_ADMIN_ROLE_ID = "role_Gw-zKO8hOHQuNv2bWokMp";
const ISO = "2026-07-03T00:00:00.000Z";

const app = createApp();

let poolFirmId: FirmId;
let poolMatterId: MatterId;
let poolFolderId: FolderId;
let firmDb: ReturnType<typeof firmDatabaseFor>;
let toolOnlyRoleId: RoleId;
let uploadOnlyRoleId: RoleId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "File Repair Attach Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  // An active firm carries a provisioned bucket; the dev pool firm shares the single R2 binding
  // (mirrors uploads.test.ts).
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  firmDb = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);

  // tools:fileRepair is seeded by a later migration; grant it directly to Admin so the route
  // tests do not depend on migration ordering in the pool (mirrors file-repair.test.ts).
  await firmDb
    .prepare("INSERT OR IGNORE INTO role_permission (id, role_id, permission) VALUES (?1, ?2, ?3)")
    .bind("rolePermission_FileRepairAttachTest0001", OWNER_ADMIN_ROLE_ID, "tools:fileRepair")
    .run();

  // A minimal role holding ONLY tools:fileRepair (never files:upload) — Admin carries
  // files:upload by default, so the "has the tool permission but not the upload permission" case
  // needs its own role.
  toolOnlyRoleId = newIdentifier("role");
  await firmDb
    .prepare("INSERT INTO role (id, name, created_at) VALUES (?1, ?2, ?3)")
    .bind(toolOnlyRoleId, "Repair Tool Only", ISO)
    .run();
  await firmDb
    .prepare("INSERT OR IGNORE INTO role_permission (id, role_id, permission) VALUES (?1, ?2, ?3)")
    .bind("rolePermission_FileRepairAttachToolOnly01", toolOnlyRoleId, "tools:fileRepair")
    .run();

  // The INVERSE role: files:upload (the primary gate) but NOT tools:fileRepair — a principal who may
  // upload to the matter but is not entitled to the repair tool. Exercises the in-handler second gate
  // (assertAlsoHasPermission), which the primary-gate-missing case never reaches.
  uploadOnlyRoleId = newIdentifier("role");
  await firmDb
    .prepare("INSERT INTO role (id, name, created_at) VALUES (?1, ?2, ?3)")
    .bind(uploadOnlyRoleId, "Upload Only", ISO)
    .run();
  await firmDb
    .prepare("INSERT OR IGNORE INTO role_permission (id, role_id, permission) VALUES (?1, ?2, ?3)")
    .bind("rolePermission_FileRepairAttachUploadOnly", uploadOnlyRoleId, "files:upload")
    .run();

  // A matter + folder to attach into. The responsible member is a fresh owner so the FK is satisfied.
  const seedOwner = await seedCredentialedUser("attach-seed-owner@example.com", {
    userName: "Attach Seed Owner",
    firmId: poolFirmId,
  });
  await mirrorMemberWithOwnerRole(seedOwner.userId, "Attach Seed Owner", poolFirmId);

  poolMatterId = newIdentifier("matter");
  await firmDb
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) " +
        "VALUES (?1, 'Attach Matter', 'open', ?2, ?3, ?3)",
    )
    .bind(poolMatterId, seedOwner.userId, ISO)
    .run();

  poolFolderId = newIdentifier("folder");
  await firmDb
    .prepare(
      "INSERT INTO folder (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, 'Attachments', ?3, ?3)",
    )
    .bind(poolFolderId, poolMatterId, ISO)
    .run();
});

// A fresh Admin member: carries files:upload (built into the seeded role) plus the
// tools:fileRepair grant added in beforeAll — both permissions the attach route's dual gate requires.
async function ownerCookie(email: string, name: string): Promise<string> {
  const { userId } = await seedCredentialedUser(email, { userName: name, firmId: poolFirmId });
  await mirrorMemberWithOwnerRole(userId, name, poolFirmId);
  return signInForSessionCookie(email);
}

// A member holding ONLY tools:fileRepair — never files:upload — to exercise the dual-gate refusal.
async function toolOnlyCookie(email: string): Promise<string> {
  const { userId } = await seedCredentialedUser(email, {
    userName: "Tool Only",
    firmId: poolFirmId,
  });
  await insertMemberStatement(firmDb, { userId, displayName: "Tool Only", now: ISO }).run();
  await insertRoleAssignmentStatement(firmDb, {
    id: newIdentifier("memberRole"),
    memberUserId: userId,
    roleId: toolOnlyRoleId,
  }).run();
  return signInForSessionCookie(email);
}

// A member holding ONLY files:upload — never tools:fileRepair — to exercise the in-handler second gate.
async function uploadOnlyCookie(email: string): Promise<string> {
  const { userId } = await seedCredentialedUser(email, {
    userName: "Upload Only",
    firmId: poolFirmId,
  });
  await insertMemberStatement(firmDb, { userId, displayName: "Upload Only", now: ISO }).run();
  await insertRoleAssignmentStatement(firmDb, {
    id: newIdentifier("memberRole"),
    memberUserId: userId,
    roleId: uploadOnlyRoleId,
  }).run();
  return signInForSessionCookie(email);
}

// A normal committed file (a pre-existing, already-ingested version) to attach a new version onto.
async function seedCommittedFile(
  matterId: MatterId,
  folderId: FolderId | null,
): Promise<{ fileId: FileId }> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const r2Key = `files/${fileId}/${versionId}`;
  await firmDb
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, current_version_id, created_at, updated_at) " +
        "VALUES (?1, ?2, ?3, 'existing.pdf', NULL, ?4, ?4)",
    )
    .bind(fileId, matterId, folderId, ISO)
    .run();
  await firmDb
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, content_sha256, " +
        "status, uploaded_by, created_at, committed_at) VALUES (?1, ?2, 1, ?3, 10, 'seed', 'clean', NULL, ?4, ?4)",
    )
    .bind(versionId, fileId, r2Key, ISO)
    .run();
  await firmDb
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  await env.R2.put(r2Key, "existing committed bytes");
  return { fileId };
}

// The R2-event -> queue chain that drives ingest in production is not automatic under the test pool
// (Miniflare cannot deliver real R2 notifications), so this drives the SAME entrypoint the queue
// consumer calls (handleIngestMessage) directly over the pending version the attach route created —
// mirrors ingest-consumer.test.ts's event() + handleIngestMessage call. The pool firm's bucket_name is
// set to 'R2' in beforeAll, matching the single bound R2 binding every firm shares in this pool.
async function driveIngestForVersion(
  firmDatabase: ReturnType<typeof firmDatabaseFor>,
  environment: typeof env,
  versionId: string,
  r2Key: string,
): Promise<void> {
  const object = await environment.R2.head(r2Key);
  await handleIngestMessage(environment, {
    bucket: "R2",
    object: { key: r2Key, size: object?.size ?? 0 },
    action: "PutObject",
  });
}

// The status column alone: enough to assert the ingest gate's terminal outcome for a version.
async function loadVersionStatus(
  firmDatabase: ReturnType<typeof firmDatabaseFor>,
  versionId: string,
): Promise<{ status: string } | null> {
  return firmDatabase
    .prepare("SELECT status FROM file_version WHERE id = ?1")
    .bind(versionId)
    .first<{ status: string }>();
}

// The attach response exposes only { fileId, versionId } (no r2Key); the pending version's key is
// looked up directly so the test can drive ingest over the exact object the route put to R2.
async function loadVersionR2Key(
  firmDatabase: ReturnType<typeof firmDatabaseFor>,
  versionId: string,
): Promise<string> {
  const row = await firmDatabase
    .prepare("SELECT r2_key FROM file_version WHERE id = ?1")
    .bind(versionId)
    .first<{ r2_key: string }>();
  if (row === null) throw new Error(`no file_version row for ${versionId}`);
  return row.r2_key;
}

async function postAttach(
  path: string,
  cookie: string,
  body: string,
  query: Record<string, string | undefined>,
): Promise<Response> {
  const queryString = new URLSearchParams(
    Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined),
  ).toString();
  return await app.request(
    `https://example.com/api/v1/file-repair/${path}?${queryString}`,
    {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/octet-stream",
        "content-length": String(new TextEncoder().encode(body).length),
      },
      body,
    },
    env,
  );
}

describe("POST /api/v1/file-repair/repair/attach", () => {
  it("creates a NEW FILE and persists provenance", async () => {
    const cookie = await ownerCookie("attach-newfile@example.com", "Attach NewFile");
    const response = await postAttach("repair/attach", cookie, "a corrupt but recoverable pdf", {
      matterId: poolMatterId,
      folderId: poolFolderId,
      fileName: "recovered.pdf",
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { fileId: string; versionId: string };
    expect(body.fileId).toMatch(/^file_/);
    expect(body.versionId).toMatch(/^fileVersion_/);
    const provenance = await readRepairProvenance(firmDb, body.versionId);
    expect(provenance?.operation).toBe("repair");
    expect(typeof provenance?.fullyRecovered).toBe("boolean");
  });

  it("adds a NEW VERSION to an existing file", async () => {
    const cookie = await ownerCookie("attach-newver@example.com", "Attach NewVer");
    const existing = await seedCommittedFile(poolMatterId, poolFolderId);
    const response = await postAttach("repair/attach", cookie, "a corrupt but recoverable pdf", {
      matterId: poolMatterId,
      fileId: existing.fileId,
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { fileId: string; versionId: string };
    expect(body.fileId).toBe(existing.fileId);
    const provenance = await readRepairProvenance(firmDb, body.versionId);
    expect(provenance?.operation).toBe("repair");
  });

  it("rejects without files:upload even with tools:fileRepair", async () => {
    const cookie = await toolOnlyCookie("attach-noupload@example.com");
    const response = await postAttach("repair/attach", cookie, "bytes", {
      matterId: poolMatterId,
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("rejects with files:upload but WITHOUT tools:fileRepair (the in-handler second gate)", async () => {
    // The primary gate (files:upload) passes, so the request reaches the handler; the second gate
    // (assertAlsoHasPermission for tools:fileRepair) is what refuses. If that gate were removed, this
    // principal would fall through to the recovery dispatch (a non-403 status), so the assertion below
    // fails closed on a regression.
    const cookie = await uploadOnlyCookie("attach-notool@example.com");
    const response = await postAttach("repair/attach", cookie, "bytes", {
      matterId: poolMatterId,
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("returns 422 when the engine cannot reconstruct the file", async () => {
    const cookie = await ownerCookie("attach-unrep@example.com", "Attach Unrep");
    const response = await postAttach("repair/attach", cookie, "hopeless UNREPAIRABLE bytes", {
      matterId: poolMatterId,
    });
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("a flagged reconstruction is quarantined by the ingest gate (firm policy = block)", async () => {
    const cookie = await ownerCookie("attach-flagged@example.com", "Attach Flagged");
    const response = await postAttach(
      "repair/attach",
      cookie,
      "corrupt pdf TRIGGERMALWARE payload",
      {
        matterId: poolMatterId,
        folderId: poolFolderId,
        fileName: "suspect.pdf",
      },
    );
    // The attach route persists the pending version + provenance and puts the reconstructed bytes to
    // R2 regardless of their content — the malware gate is not a second, parallel check here; the same
    // async ingest consumer that governs a direct upload governs this attach too.
    expect(response.status).toBe(202);
    const body = (await response.json()) as { fileId: string; versionId: string };

    const r2Key = await loadVersionR2Key(firmDb, body.versionId);
    await driveIngestForVersion(firmDb, env, body.versionId, r2Key);

    const version = await loadVersionStatus(firmDb, body.versionId);
    expect(version?.status).toBe("quarantined");
    // Provenance persists on the quarantined version too (chain of custody on a quarantined
    // reconstruction survives the later ingest verdict).
    const provenance = await readRepairProvenance(firmDb, body.versionId);
    expect(provenance).not.toBeNull();
    expect(provenance?.operation).toBe("repair");
  });
});

describe("POST /api/v1/file-repair/carve/attach", () => {
  it("carve/attach creates N new files, each with provenance", async () => {
    const cookie = await ownerCookie("attach-carve@example.com", "Attach Carve");
    const res = await postAttach("carve/attach", cookie, "junk with an embedded jpeg", {
      matterId: poolMatterId,
      folderId: poolFolderId,
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      files: { fileId: string; versionId: string; name: string }[];
    };
    expect(body.files.length).toBeGreaterThan(0);
    for (const f of body.files) {
      expect(await readRepairProvenance(firmDb, f.versionId)).not.toBeNull();
    }
  });

  it("carve/attach returns 403 for upload-only cookie (the in-handler second gate)", async () => {
    const cookie = await uploadOnlyCookie("attach-carve-noperm@example.com");
    const res = await postAttach("carve/attach", cookie, "bytes", {
      matterId: poolMatterId,
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });
});
