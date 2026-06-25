import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";

// POST /api/v1/platform/firms/{firmId}/release-channel end-to-end (Miniflare):
// the platform-admin guard, the alpha-capable channel write, and the schema rejection.
//
// Storage is SHARED across this file's tests; the firm is seeded once in beforeAll.

let seededFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  ({ firmId: seededFirmId } = await seedFirm({ name: "Platform Channel Test Firm" }));
});

async function postPlatformReleaseChannel(
  firmId: string,
  body: unknown,
  options: { adminKey?: string | null; idempotencyKey?: string } = {},
): Promise<Response> {
  const adminKey = options.adminKey === undefined ? env.PLATFORM_ADMIN_KEY : options.adminKey;
  return SELF.fetch(`https://example.com/api/v1/platform/firms/${firmId}/release-channel`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(adminKey === null ? {} : { "X-Platform-Admin-Key": adminKey }),
      ...(options.idempotencyKey === undefined
        ? {}
        : { "Idempotency-Key": options.idempotencyKey }),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/platform/firms/{firmId}/release-channel", () => {
  it("answers a missing X-Platform-Admin-Key with a 401 problem", async () => {
    const response = await postPlatformReleaseChannel(
      seededFirmId,
      { channel: "alpha" },
      {
        adminKey: null,
        idempotencyKey: crypto.randomUUID(),
      },
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/unauthenticated",
      status: 401,
    });
    expect(body["errorId"]).toMatch(/^error_/);
  });

  it("answers a wrong X-Platform-Admin-Key with a field-identical 401 problem", async () => {
    const response = await postPlatformReleaseChannel(
      seededFirmId,
      { channel: "alpha" },
      {
        adminKey: "wrong-key",
        idempotencyKey: crypto.randomUUID(),
      },
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/unauthenticated",
      status: 401,
    });
    expect(body["errorId"]).toMatch(/^error_/);
  });

  it("sets the firm's release channel to alpha and the control-plane firm row reflects it", async () => {
    const response = await postPlatformReleaseChannel(
      seededFirmId,
      { channel: "alpha" },
      {
        idempotencyKey: crypto.randomUUID(),
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { channel: string };
    expect(body.channel).toBe("alpha");

    const firmRow = await env.DB_CONTROL.prepare("SELECT release_channel FROM firm WHERE id = ?1")
      .bind(seededFirmId)
      .first<{ release_channel: string }>();
    expect(firmRow?.release_channel).toBe("alpha");
  });

  it("answers 422 for a body with a channel value outside the schema enum (schema rejection)", async () => {
    const response = await postPlatformReleaseChannel(
      seededFirmId,
      { channel: "nonsense" },
      {
        idempotencyKey: crypto.randomUUID(),
      },
    );
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/validation",
      status: 422,
    });
    expect(body["errorId"]).toMatch(/^error_/);
  });
});
