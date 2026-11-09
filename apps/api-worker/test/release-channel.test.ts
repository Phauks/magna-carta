import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// firm.database_identifier is UNIQUE and storage is shared within this file, so the resolvable
// pool firm is seeded once here and every test attaches its users to it.
let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Release Channel Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
});

async function putReleaseChannel(
  body: unknown,
  options: { cookie?: string; idempotencyKey?: string } = {},
): Promise<Response> {
  return SELF.fetch("https://example.com/api/v1/firm/release-channel", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...(options.idempotencyKey === undefined
        ? {}
        : { "Idempotency-Key": options.idempotencyKey }),
    },
    body: JSON.stringify(body),
  });
}

// Seeds a credentialed user on the resolvable pool firm, grants Admin (which carries
// firm:manageReleaseChannel), and signs in — the acting principal for the happy paths.
async function signInAsOwner(email: string): Promise<string> {
  const { userId } = await seedCredentialedUser(email, { firmId: poolFirmId });
  await mirrorMemberWithOwnerRole(userId, "Release Channel Owner", poolFirmId);
  return signInForSessionCookie(email);
}

describe("PUT /api/v1/firm/release-channel", () => {
  it("answers an unauthenticated request with a 401 problem", async () => {
    const response = await putReleaseChannel(
      { channel: "beta", consentAcknowledged: true },
      { idempotencyKey: crypto.randomUUID() },
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

  it("sets the channel to beta with consent acknowledged and stores the channel in the control plane", async () => {
    const sessionCookie = await signInAsOwner("rc-owner-beta@example.com");

    const response = await putReleaseChannel(
      { channel: "beta", consentAcknowledged: true },
      { cookie: sessionCookie, idempotencyKey: crypto.randomUUID() },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { channel: string };
    expect(body.channel).toBe("beta");

    // Verify the channel was written to the control-plane firm registry.
    // The /me response does not yet expose channel, so assert the persisted value via the
    // control-plane firm row.
    const firmRow = await env.DB_CONTROL.prepare("SELECT release_channel FROM firm WHERE id = ?1")
      .bind(poolFirmId)
      .first<{ release_channel: string }>();
    expect(firmRow?.release_channel).toBe("beta");
  });

  it("answers 400 when beta is requested without the consent acknowledgment", async () => {
    const sessionCookie = await signInAsOwner("rc-owner-noconsent@example.com");

    const response = await putReleaseChannel(
      { channel: "beta", consentAcknowledged: false },
      { cookie: sessionCookie, idempotencyKey: crypto.randomUUID() },
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/beta-consent-required",
      status: 400,
    });
    expect(body["errorId"]).toMatch(/^error_/);
  });

  it("answers 422 when channel is alpha — the schema enum is [stable, beta], so alpha is a validation rejection", async () => {
    const sessionCookie = await signInAsOwner("rc-owner-alpha@example.com");

    const response = await putReleaseChannel(
      { channel: "alpha", consentAcknowledged: true },
      { cookie: sessionCookie, idempotencyKey: crypto.randomUUID() },
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

  it("answers 200 when returning to stable without consent acknowledgment — leaving beta needs no consent", async () => {
    const sessionCookie = await signInAsOwner("rc-owner-stable@example.com");

    const response = await putReleaseChannel(
      { channel: "stable", consentAcknowledged: false },
      { cookie: sessionCookie, idempotencyKey: crypto.randomUUID() },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { channel: string };
    expect(body.channel).toBe("stable");
  });

  it("replaying the same Idempotency-Key produces 200 on both requests and exactly one audit_log row", async () => {
    const sessionCookie = await signInAsOwner("rc-owner-replay@example.com");
    const idempotencyKey = crypto.randomUUID();

    // Snapshot the audit_log count before the requests so other tests' rows do not affect the
    // assertion (all tests share the same poolFirmId within this file).
    const countBefore =
      (
        await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
          .prepare(
            "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'firm.release_channel_changed' AND subject_id = ?1",
          )
          .bind(poolFirmId)
          .first<{ n: number }>()
      )?.n ?? 0;

    // First request — executes the write and commits the idempotency record.
    const firstResponse = await putReleaseChannel(
      { channel: "beta", consentAcknowledged: true },
      { cookie: sessionCookie, idempotencyKey },
    );
    expect(firstResponse.status).toBe(200);

    // Second request with the same Idempotency-Key — the pre-decision replays without re-running
    // the handler, so no duplicate channel write or audit row is produced.
    const secondResponse = await putReleaseChannel(
      { channel: "beta", consentAcknowledged: true },
      { cookie: sessionCookie, idempotencyKey },
    );
    expect(secondResponse.status).toBe(200);

    // Exactly one additional audit_log row must exist — the replay must not have inserted another.
    const countAfter =
      (
        await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
          .prepare(
            "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'firm.release_channel_changed' AND subject_id = ?1",
          )
          .bind(poolFirmId)
          .first<{ n: number }>()
      )?.n ?? 0;
    expect(countAfter - countBefore).toBe(1);
  });
});
