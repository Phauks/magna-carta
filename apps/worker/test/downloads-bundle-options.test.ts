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
