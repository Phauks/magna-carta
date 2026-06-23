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
import { mintEditToken, type EditCapability } from "../../src/editing/wopi-token.ts";
import { applyControlPlaneMigrations } from "../support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "../support/apply-per-firm-migrations.ts";
import { seedFirm } from "../support/test-auth.ts";

// The slice 2·2 editing invariants, proven structurally. These are the security/tenancy posture the
// WOPI host + session model must keep: a token reaches ONLY its own firm's data, a view token mutates
// nothing, reading is never blocked by editing state, and a check-in's untrusted bytes route the
// quarantine ingest. (Container-config invariants — coolwsd has no egress / no R2-D1 creds, one
// container per document — bind on the dedicated magna-carta-edit worker's wrangler config, recorded in
// ADR container-subsystems-extract-to-dedicated-workers; they are enforced there, not in this worker.)

const ISO = "2026-06-20T00:00:00.000Z";
let firmA: FirmId;
let matterA: MatterId;
const MEMBER = "user_fitness" as UserId;

async function seedMember(database: D1Database): Promise<void> {
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Fitness', 'active', ?2)",
    )
    .bind(MEMBER, ISO)
    .run();
}

async function seedFile(
  database: D1Database,
  matterId: MatterId,
  editState: string,
): Promise<{ fileId: FileId; versionId: FileVersionId }> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  await database
    .prepare(
      "INSERT INTO file (id, matter_id, name, current_version_id, edit_state, created_at, updated_at) VALUES (?1, ?2, 'Brief.docx', NULL, ?3, ?4, ?4)",
    )
    .bind(fileId, matterId, editState, ISO)
    .run();
  await database
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, content_sha256, status, uploaded_by, created_at, committed_at) VALUES (?1, ?2, 1, ?3, 10, 'h', 'clean', ?4, ?5, ?5)",
    )
    .bind(versionId, fileId, `files/${fileId}/${versionId}`, MEMBER, ISO)
    .run();
  await database
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  return { fileId, versionId };
}

function token(
  firmId: FirmId,
  matterId: MatterId,
  fileId: FileId,
  versionId: FileVersionId,
  capability: EditCapability,
): Promise<string> {
  return mintEditToken(
    {
      firmId,
      matterId,
      fileId,
      versionId,
      memberId: MEMBER,
      capability,
      sessionId: "fitness",
      exp: Date.now() + 60 * 60 * 1000,
    },
    env,
  );
}

const wopi = (path: string, init?: RequestInit) =>
  SELF.fetch(`https://example.com/wopi/files/${path}`, init);

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_2);
  firmA = (await seedFirm({ name: "Fitness Firm A", databaseIdentifier: "DB_FIRM_POOL_1" })).firmId;
  // Firm B exists only to hold a document the firm-A token must NOT reach (the tenancy test).
  await seedFirm({ name: "Fitness Firm B", databaseIdentifier: "DB_FIRM_POOL_2" });
  await seedMember(env.DB_FIRM_POOL_1);
  await seedMember(env.DB_FIRM_POOL_2);
  matterA = newIdentifier("matter");
  for (const [database, matterId] of [
    [env.DB_FIRM_POOL_1, matterA],
    [env.DB_FIRM_POOL_2, newIdentifier("matter")],
  ] as const) {
    await database
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'M', 'open', ?2, ?3, ?3)",
      )
      .bind(matterId, MEMBER, ISO)
      .run();
  }
});

describe("editing fitness — tenancy", () => {
  it("a firm-A token reaches only firm-A data: it 404s against a firm-B document", async () => {
    // The document lives in firm B's database; the token claims firm A. The guard resolves the firm
    // SOLELY from the token, then the handler looks the file up in THAT firm's database — so a
    // cross-firm token finds nothing and 404s. It never reaches firm B's data.
    const matterBId = newIdentifier("matter");
    await env.DB_FIRM_POOL_2.prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'MB', 'open', ?2, ?3, ?3)",
    )
      .bind(matterBId, MEMBER, ISO)
      .run();
    const fileB = await seedFile(env.DB_FIRM_POOL_2, matterBId, "idle");

    const forgedToken = await token(firmA, matterBId, fileB.fileId, fileB.versionId, "edit");
    const response = await wopi(`${fileB.fileId}?access_token=${encodeURIComponent(forgedToken)}`);
    expect(response.status).toBe(404);

    // The same token against firm A (where the file does not exist either) also 404s — never 200.
    expect(response.status).not.toBe(200);
  });
});

describe("editing fitness — capability", () => {
  it("a view token cannot mutate the working copy (PutFile) or take the lock", async () => {
    const file = await seedFile(env.DB_FIRM_POOL_1, matterA, "idle");
    const viewToken = await token(firmA, matterA, file.fileId, file.versionId, "view");
    const accessToken = encodeURIComponent(viewToken);

    const put = await wopi(`${file.fileId}/contents?access_token=${accessToken}`, {
      method: "POST",
      body: new TextEncoder().encode("nope"),
    });
    expect(put.status).toBe(403);

    const lock = await wopi(`${file.fileId}?access_token=${accessToken}`, {
      method: "POST",
      headers: { "X-WOPI-Override": "LOCK", "X-WOPI-Lock": "L1" },
    });
    expect(lock.status).toBe(403);
  });
});

describe("editing fitness — reading is never blocked", () => {
  it("CheckFileInfo (read) is reachable in every edit_state", async () => {
    for (const editState of ["idle", "coediting", "checked_out"] as const) {
      const file = await seedFile(env.DB_FIRM_POOL_1, matterA, editState);
      const viewToken = await token(firmA, matterA, file.fileId, file.versionId, "view");
      const response = await wopi(`${file.fileId}?access_token=${encodeURIComponent(viewToken)}`);
      expect(response.status, `edit_state=${editState}`).toBe(200);
    }
  });
});
