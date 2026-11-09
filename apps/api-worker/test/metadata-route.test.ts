import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { createApp } from "../src/http/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The Owner/Admin role id is a committed literal from 0002_member-rbac.sql.
const OWNER_ADMIN_ROLE_ID = "role_Gw-zKO8hOHQuNv2bWokMp";

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// A minimal OOXML (docx) fixture carrying a dc:creator element in docProps/core.xml so the
// inspect engine finds at least one identifying-metadata finding.
function docxFixture(): Uint8Array {
  const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zipSync({
    "[Content_Types].xml": strToU8(`${DECL}<Types/>`),
    "word/document.xml": strToU8(
      `${DECL}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>`,
    ),
    "docProps/core.xml": strToU8(
      `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Jane</dc:creator></cp:coreProperties>`,
    ),
  });
}

const app = createApp();

let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  // Seed the firm first to get its id, then grant the permission into its Durable Object.
  poolFirmId = (
    await seedFirm({ name: "Metadata Route Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  // The DO self-migrates the per-firm lineage on first access. The baseline migration already
  // seeds tools:metadataScrubber onto Owner/Admin; granting it directly is an idempotent belt so
  // this suite does not depend on migration ordering.
  await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare("INSERT OR IGNORE INTO role_permission (id, role_id, permission) VALUES (?1, ?2, ?3)")
    .bind("rolePermission_MetadataOwnerTest0001", OWNER_ADMIN_ROLE_ID, "tools:metadataScrubber")
    .run();
});

describe("POST /api/v1/metadata/inspect", () => {
  it("answers an unauthenticated request with a 401 problem", async () => {
    const response = await app.request(
      "https://example.com/api/v1/metadata/inspect",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: "a.docx", contentBase64: base64(docxFixture()) }),
      },
      env,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("answers 403 for an authenticated member without tools:metadataScrubber", async () => {
    // seedCredentialedUser assigns no role; membership alone carries no permission.
    await seedCredentialedUser("metadata-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("metadata-noperm@example.com");
    const response = await app.request(
      "https://example.com/api/v1/metadata/inspect",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ filename: "a.docx", contentBase64: base64(docxFixture()) }),
      },
      env,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("returns findings for a docx with an author", async () => {
    const { userId } = await seedCredentialedUser("metadata-ok@example.com", {
      userName: "Metadata OK",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Metadata OK", poolFirmId); // Owner/Admin carries tools:metadataScrubber (seeded above)
    const cookie = await signInForSessionCookie("metadata-ok@example.com");
    const response = await app.request(
      "https://example.com/api/v1/metadata/inspect",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          cookie,
        },
        body: JSON.stringify({ filename: "a.docx", contentBase64: base64(docxFixture()) }),
      },
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      format: string;
      findings: Array<{ category: string }>;
      clean: boolean;
    };
    expect(body.clean).toBe(false);
    expect(body.findings.some((f) => f.category === "identifying-metadata")).toBe(true);
  });

  it("rejects a body that is not base64 without letting the decode throw", async () => {
    const { userId } = await seedCredentialedUser("metadata-badbase64@example.com", {
      userName: "Bad Base64",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Bad Base64", poolFirmId);
    const cookie = await signInForSessionCookie("metadata-badbase64@example.com");
    const post = async (contentBase64: string): Promise<Response> =>
      await app.request(
        "https://example.com/api/v1/metadata/inspect",
        {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://example.com", cookie },
          body: JSON.stringify({ filename: "a.docx", contentBase64 }),
        },
        env,
      );

    // Characters outside the alphabet are refused by the request schema.
    const invalid = await post("!!!! not base64 !!!!");
    expect(invalid.status).toBe(422);
    // A string in the alphabet can still be an impossible length; the decoder throws on it, and the
    // answer must be a stated failure rather than an unhandled error.
    const undecodable = await post("A");
    expect(undecodable.status).toBe(400);
    expect(undecodable.headers.get("content-type")).toContain("application/problem+json");
  });

  it("refuses an over-long body on the schema, before it is decoded", async () => {
    const { userId } = await seedCredentialedUser("metadata-toolong@example.com", {
      userName: "Too Long",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Too Long", poolFirmId);
    const cookie = await signInForSessionCookie("metadata-toolong@example.com");
    // Longer than any accepted file can encode to: decoding it first would allocate tens of
    // megabytes to answer a request that is refused either way.
    const overLong = "A".repeat(21_000_000);
    const response = await app.request(
      "https://example.com/api/v1/metadata/inspect",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://example.com", cookie },
        body: JSON.stringify({ filename: "a.docx", contentBase64: overLong }),
      },
      env,
    );
    expect(response.status).toBe(422);
  });

  it("rejects an unsupported file with 400", async () => {
    const { userId } = await seedCredentialedUser("metadata-unsupported@example.com", {
      userName: "Unsupported File",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Unsupported File", poolFirmId);
    const cookie = await signInForSessionCookie("metadata-unsupported@example.com");
    const response = await app.request(
      "https://example.com/api/v1/metadata/inspect",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          cookie,
        },
        body: JSON.stringify({
          filename: "x.bin",
          contentBase64: base64(new Uint8Array([1, 2, 3])),
        }),
      },
      env,
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});

describe("POST /api/v1/metadata/scrub", () => {
  it("returns a cleaned file + report for a docx with an author", async () => {
    const { userId } = await seedCredentialedUser("metadata-scrub@example.com", {
      userName: "Scrub User",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Scrub User", poolFirmId);
    const cookie = await signInForSessionCookie("metadata-scrub@example.com");
    const response = await app.request(
      "https://example.com/api/v1/metadata/scrub",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          cookie,
        },
        body: JSON.stringify({ filename: "a.docx", contentBase64: base64(docxFixture()) }),
      },
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      mediaType: string;
      filename: string;
      cleanedBase64: string;
      report: { clean: boolean };
    };
    expect(body.filename).toBe("a.docx");
    expect(typeof body.cleanedBase64).toBe("string");
    expect(body.cleanedBase64.length).toBeGreaterThan(0);
    // After scrubbing with SCRUB_ALL the report should show clean.
    expect(body.report.clean).toBe(true);
  });
});
