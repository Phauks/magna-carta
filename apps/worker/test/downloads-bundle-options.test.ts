import { env, SELF } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// Integration tests covering the bundle-options validation path (422) on the download route.
// These tests exercise the route through the full chokepoint stack; the actual file-selection and
// delivery logic is NOT exercised here (the test uses a matter that has no files, so the request
// is rejected before reaching selection resolution). The 422 check fires before any selection DB
// query so the matter need not exist.

let ownerCookie: string;
// A matter pre-seeded with two clean files, so a valid heavy-async request resolves to a non-empty
// selection and reaches the 202 hand-off (the 422/501 tests use a throwaway empty matter instead,
// since those responses fire before any selection query).
let seededMatterId: string;

// Seeds one clean, committed file (file + current clean file_version) under a matter directly in the
// per-firm database — the same three-step shape the ingest gate produces (insert file, insert clean
// version, point the file at it). No R2 object is needed: the heavy-async lane hands a manifest to the
// container and returns 202 without reading any bytes in the Worker.
async function seedCleanFile(matterId: string, name: string): Promise<void> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const r2Key = `files/${fileId}/${versionId}`;
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
  )
    .bind(fileId, matterId, name)
    .run();
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at, inline_playable, storage_class, storage_encoding, artifact_role) VALUES (?1, ?2, 1, ?3, 2048, 'application/octet-stream', 'application/octet-stream', NULL, 'clean', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, 'standard', 'full', 'original')",
  )
    .bind(versionId, fileId, r2Key)
    .run();
  await env.DB_FIRM_POOL_1.prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  const { firmId } = await seedFirm({
    name: "Download Options Test Firm",
    databaseIdentifier: "DB_FIRM_POOL_1",
  });
  // The download route calls requireBucket(firm.bucketName) before options validation; set a bucket
  // so the handler reaches the options check without throwing.
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(firmId)
    .run();
  const owner = await seedCredentialedUser("download-opts-owner@example.com", {
    userName: "Download Options Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Download Options Owner");
  ownerCookie = await signInForSessionCookie("download-opts-owner@example.com");

  // A member + matter so the file/version FKs resolve; then two clean files under it.
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO member (user_id, display_name, status, created_at) VALUES ('bundle_opts_member', 'BO', 'active', '2026-01-01T00:00:00.000Z')",
  ).run();
  seededMatterId = newIdentifier("matter");
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO matter (id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES (?1, 'M', NULL, 'open', NULL, NULL, 'bundle_opts_member', NULL, NULL, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
  )
    .bind(seededMatterId)
    .run();
  await seedCleanFile(seededMatterId, "a.pdf");
  await seedCleanFile(seededMatterId, "b.pdf");
});

async function postDownload(body: unknown): Promise<Response> {
  return SELF.fetch("https://example.com/api/v1/downloads/zip", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
    },
    body: JSON.stringify(body),
  });
}

// A fresh, valid matter id for each test (the matter does not need to exist in the DB; the route
// returns 422 before any selection query).
function freshMatter(): string {
  return newIdentifier("matter");
}

describe("POST /api/v1/downloads/zip — invalid bundle options (422)", () => {
  it("rejects ZIP combined with split (ZIP does not support splitting)", async () => {
    const response = await postDownload({
      matterId: freshMatter(),
      options: {
        format: "zip",
        compression: "store",
        encryption: null,
        split: { maxPartBytes: 10_485_760 },
        outputName: "bundle.zip",
        wrapperFolder: null,
        layout: "preserveTree",
        manifest: false,
      },
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.type).toContain("validation");
    expect(body.status).toBe(422);
    expect(typeof body.detail).toBe("string");
    expect((body.detail as string).toLowerCase()).toContain("split");
  });

  it("rejects ZIP with encryptFileNames (ZIP cannot encrypt the file list)", async () => {
    const response = await postDownload({
      matterId: freshMatter(),
      options: {
        format: "zip",
        compression: "store",
        encryption: { algorithm: "aes-256", encryptFileNames: true },
        split: null,
        outputName: "secret.zip",
        wrapperFolder: null,
        layout: "preserveTree",
        manifest: false,
      },
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe(422);
    expect(typeof body.detail).toBe("string");
  });

  it("rejects encryption combined with split (mutually exclusive regardless of format)", async () => {
    const response = await postDownload({
      matterId: freshMatter(),
      options: {
        format: "sevenZip",
        compression: "normal",
        encryption: { algorithm: "aes-256", encryptFileNames: true },
        split: { maxPartBytes: 104_857_600 },
        outputName: "bundle.7z",
        wrapperFolder: null,
        layout: "preserveTree",
        manifest: false,
      },
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe(422);
    // The detail should mention all violations; encryption+split fires its own check in addition
    // to any format-specific ones.
    expect(typeof body.detail).toBe("string");
    expect(body.detail as string).not.toBe("");
  });

  it("returns a problem+json content-type on 422", async () => {
    const response = await postDownload({
      matterId: freshMatter(),
      options: {
        format: "zip",
        compression: "store",
        encryption: null,
        split: { maxPartBytes: 10_485_760 },
        outputName: "bundle.zip",
        wrapperFolder: null,
        layout: "preserveTree",
        manifest: false,
      },
    });
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});

describe("POST /api/v1/downloads/zip — optioned lanes", () => {
  // A well-formed, capability-valid non-plain option set routes through selectBundleLane. The
  // heavy-unencrypted-async lane (compression / 7z / split) is wired: it resolves the selection,
  // content-addresses the bundle, and hands off a background container build, returning 202 + a jobId.
  // The encrypted-stream lane is not yet wired, so it still returns a 501 interim (before any
  // selection query, so its throwaway matter need not exist).
  it("returns 202 with a jobId for a valid heavy-async option (compression other than store)", async () => {
    const response = await postDownload({
      matterId: seededMatterId,
      options: {
        format: "zip",
        compression: "normal",
        encryption: null,
        split: null,
        outputName: "bundle.zip",
        wrapperFolder: null,
        layout: "preserveTree",
        manifest: false,
      },
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { jobId?: string; status?: string };
    expect(typeof body.jobId).toBe("string");
    expect((body.jobId ?? "").length).toBeGreaterThan(0);
    expect(body.status).toBe("building");
  });

  it("returns 501 for a valid encrypted option (encrypted stream lane not yet wired)", async () => {
    const response = await postDownload({
      matterId: freshMatter(),
      options: {
        format: "zip",
        compression: "store",
        encryption: { algorithm: "aes-256", encryptFileNames: false },
        split: null,
        outputName: "secret.zip",
        wrapperFolder: null,
        layout: "preserveTree",
        manifest: false,
      },
    });
    expect(response.status).toBe(501);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.type).toContain("not-implemented");
  });
});
