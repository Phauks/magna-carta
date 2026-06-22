import { env, SELF } from "cloudflare:test";
import type { FirmId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// Focused route-registration test for the conversion endpoints. Asserts each route is reachable at
// its declared method/path and that Route B rejects an unconvertible pair (png->mp4 has no graph
// path) with 422. Route A and Route C are checked for presence (not 404) against a seeded session.

let firmId: FirmId;
let ownerCookie: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  firmId = (
    await seedFirm({ name: "Conversion Routes Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(firmId)
    .run();
  const owner = await seedCredentialedUser("conversion-owner@example.com", {
    userName: "Conversion Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Conversion Owner");
  ownerCookie = await signInForSessionCookie("conversion-owner@example.com");
});

describe("POST /api/v1/conversions/upload", () => {
  it("is registered and returns 200 (presign minted by dev presigner)", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/conversions/upload", {
      method: "POST",
      headers: { cookie: ownerCookie, origin: "https://example.com" },
    });
    // The dev presigner returns a placeholder signed URL so the route returns 200, not 404.
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      jobId?: string;
      uploadUrl?: string;
      sourceKey?: string;
    };
    expect(typeof body.jobId).toBe("string");
    expect(typeof body.uploadUrl).toBe("string");
    expect(typeof body.sourceKey).toBe("string");
    expect(body.sourceKey).toContain("conversions/");
  });
});

describe("POST /api/v1/conversions", () => {
  it("rejects an unconvertible format pair (png->mp4) with 422", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/conversions", {
      method: "POST",
      headers: {
        cookie: ownerCookie,
        origin: "https://example.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: "png", to: "mp4", jobId: "x", sourceKey: "y" }),
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { status?: number; type?: string };
    expect(body.status).toBe(422);
  });
});

describe("GET /api/v1/conversions/{jobId}", () => {
  it("is registered and returns 200 (unknown job maps to failed state)", async () => {
    // The DO for this job has never been started, so status() returns the UNKNOWN sentinel:
    // { status: "failed", reason: "unknown job" }. The route maps that to { status: "failed" }.
    const response = await SELF.fetch("https://example.com/api/v1/conversions/someId", {
      headers: { cookie: ownerCookie, origin: "https://example.com" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status?: string; reason?: string };
    expect(body.status).toBe("failed");
  });
});
