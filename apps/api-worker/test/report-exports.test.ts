import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

let poolFirmId: FirmId;

const renderableDocument = {
  title: "Firm Usage",
  stampLines: ["Generated 8/31/2026", "12:57:56 PM PDT"],
  sections: [
    {
      title: "Storage",
      headers: ["Storage Class", "Objects"],
      rows: [["Standard", "41,208"]],
      endAlignedColumns: [1],
    },
  ],
};

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Export Render Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
});

describe("POST /api/v1/reports/exports", () => {
  it("answers an unauthenticated request with a 401 problem", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/reports/exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "docx", document: renderableDocument }),
    });
    expect(response.status).toBe(401);
  });

  it("answers 403 for an authenticated member without reports:export", async () => {
    await seedCredentialedUser("export-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("export-noperm@example.com");
    const response = await SELF.fetch("https://example.com/api/v1/reports/exports", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ format: "docx", document: renderableDocument }),
    });
    expect(response.status).toBe(403);
  });

  it("renders a word-processing package for an Admin member", async () => {
    const { userId } = await seedCredentialedUser("export-ok@example.com", {
      userName: "Export OK",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Export OK", poolFirmId);
    const cookie = await signInForSessionCookie("export-ok@example.com");
    const response = await SELF.fetch("https://example.com/api/v1/reports/exports", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ format: "docx", document: renderableDocument }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A zip's magic: the composed package is byte-checked in depth by the composer's own suite;
    // this route test holds the transport.
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it("refuses a document past the render bounds by name", async () => {
    const cookie = await signInForSessionCookie("export-ok@example.com");
    const oversized = {
      ...renderableDocument,
      sections: Array.from({ length: 49 }, (unused, index) => ({
        title: `Section ${index}`,
        headers: ["A"],
        rows: [],
      })),
    };
    const response = await SELF.fetch("https://example.com/api/v1/reports/exports", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ format: "docx", document: oversized }),
    });
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("answers the PDF arm honestly when the engine is not reachable in this environment", async () => {
    // The local pool's CONVERT stub satisfies startup validation only, so the conversion cannot
    // succeed here; what the route owes the caller in that state is a retryable 503, never an
    // Error ID for an engine that is warming. The success arm differs from the docx arm only in
    // which bytes it returns, and the live edge is exercised daily by the assembly consumer.
    const cookie = await signInForSessionCookie("export-ok@example.com");
    const response = await SELF.fetch("https://example.com/api/v1/reports/exports", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ format: "pdf", document: renderableDocument }),
    });
    expect(response.status).toBe(503);
    const problem = (await response.json()) as { type?: string };
    expect(problem.type).toContain("service-unavailable");
  });

  it("emits the route into the OpenAPI document with its metadata", async () => {
    const response = await SELF.fetch("https://example.com/api/openapi.json");
    const document = (await response.json()) as {
      paths: Record<string, { post?: Record<string, unknown> }>;
    };
    const operation = document.paths["/api/v1/reports/exports"]?.post;
    expect(operation?.["operationId"]).toBe("reports.exportRender");
    expect(operation).toMatchObject({
      "x-mc-permission": "reports:export",
      "x-mc-resource": "firm",
      "x-mc-audited": false,
    });
  });
});
