import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// firm.database_identifier is UNIQUE and storage is shared within this file, so the resolvable pool
// firm is seeded once and every test attaches its users to it.
let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Firm Profile Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
});

async function putFirmProfile(
  body: unknown,
  options: { cookie?: string; idempotencyKey?: string } = {},
): Promise<Response> {
  return SELF.fetch("https://example.com/api/v1/firm/profile", {
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

async function signInAsOwner(email: string): Promise<string> {
  const { userId } = await seedCredentialedUser(email, { firmId: poolFirmId });
  await mirrorMemberWithOwnerRole(userId, "Firm Profile Owner", poolFirmId);
  return signInForSessionCookie(email);
}

// An Attorney seat rather than a direct grant: what the seeds decide is exactly the fact under
// test, so a denial asserted against a seat stops meaning anything the day that seat is granted the
// key — which is the signal we want.
async function signInAsAttorney(email: string): Promise<string> {
  const { userId } = await seedCredentialedUser(email, { firmId: poolFirmId });
  await mirrorMemberWithRole(userId, "Firm Profile Attorney", poolFirmId, "Attorney");
  return signInForSessionCookie(email);
}

function readFirmRow(): Promise<{ name: string; display_name: string | null } | null> {
  return env.DB_CONTROL.prepare("SELECT name, display_name FROM firm WHERE id = ?1")
    .bind(poolFirmId)
    .first<{ name: string; display_name: string | null }>();
}

describe("PUT /api/v1/firm/profile", () => {
  it("answers an unauthenticated request with a 401 problem", async () => {
    const response = await putFirmProfile(
      { displayName: "Nobody & Co." },
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

  it("refuses a member whose seat does not carry firm:manageProfile", async () => {
    const sessionCookie = await signInAsAttorney("profile-attorney@example.com");

    const response = await putFirmProfile(
      { displayName: "Renamed By An Attorney" },
      { cookie: sessionCookie, idempotencyKey: crypto.randomUUID() },
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");

    const firmRow = await readFirmRow();
    expect(firmRow?.display_name).not.toBe("Renamed By An Attorney");
  });

  it("writes display_name and leaves the provisioning handle alone", async () => {
    const sessionCookie = await signInAsOwner("profile-owner-write@example.com");
    const before = await readFirmRow();

    const response = await putFirmProfile(
      { displayName: "Goldsmith & Partners LLP" },
      { cookie: sessionCookie, idempotencyKey: crypto.randomUUID() },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ displayName: "Goldsmith & Partners LLP" });

    const after = await readFirmRow();
    expect(after?.display_name).toBe("Goldsmith & Partners LLP");
    // `firm.name` is the UNIQUE provisioning handle a crashed provisioning run resumes by. Renaming
    // it would let one firm's chosen name refuse another's, so the write must never reach it.
    expect(after?.name).toBe(before?.name);
  });

  it("trims and normalizes the name to NFC, so the same name typed two ways is one name", async () => {
    const sessionCookie = await signInAsOwner("profile-owner-nfc@example.com");

    // "Bureau Márquez" — a combining acute, which NFC composes to a single code point.
    const response = await putFirmProfile(
      { displayName: "  Bureau Márquez  " },
      { cookie: sessionCookie, idempotencyKey: crypto.randomUUID() },
    );
    expect(response.status).toBe(200);

    const firmRow = await readFirmRow();
    expect(firmRow?.display_name).toBe("Bureau Márquez");
  });

  it("refuses an empty name with a 422 rather than storing one", async () => {
    const sessionCookie = await signInAsOwner("profile-owner-empty@example.com");

    const response = await putFirmProfile(
      { displayName: "   " },
      { cookie: sessionCookie, idempotencyKey: crypto.randomUUID() },
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/validation",
      status: 422,
    });
  });

  it("refuses a name past the bound rather than truncating it", async () => {
    const sessionCookie = await signInAsOwner("profile-owner-long@example.com");

    const response = await putFirmProfile(
      { displayName: "A".repeat(201) },
      { cookie: sessionCookie, idempotencyKey: crypto.randomUUID() },
    );
    expect(response.status).toBe(422);
  });

  it("requires an Idempotency-Key", async () => {
    const sessionCookie = await signInAsOwner("profile-owner-nokey@example.com");

    const response = await putFirmProfile(
      { displayName: "Keyless & Co." },
      { cookie: sessionCookie },
    );
    expect(response.status).toBe(400);
  });

  it("replaying the same Idempotency-Key answers 200 twice and writes exactly one audit row", async () => {
    const sessionCookie = await signInAsOwner("profile-owner-replay@example.com");
    const idempotencyKey = crypto.randomUUID();

    // Every test in this file shares poolFirmId, so count the delta rather than the total.
    const countRows = async (): Promise<number> =>
      (
        await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
          .prepare(
            "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'firm.profile_updated' AND subject_id = ?1",
          )
          .bind(poolFirmId)
          .first<{ n: number }>()
      )?.n ?? 0;

    const countBefore = await countRows();

    const first = await putFirmProfile(
      { displayName: "Replay & Partners" },
      { cookie: sessionCookie, idempotencyKey },
    );
    expect(first.status).toBe(200);

    const second = await putFirmProfile(
      { displayName: "Replay & Partners" },
      { cookie: sessionCookie, idempotencyKey },
    );
    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");

    // The audit row is written after the control-plane batch, on the first execution only: a replay
    // short-circuits ahead of it and must not double-write the firm's history.
    expect((await countRows()) - countBefore).toBe(1);
  });

  it("records what the firm was called before, not a null", async () => {
    const sessionCookie = await signInAsOwner("profile-owner-audit@example.com");

    await putFirmProfile(
      { displayName: "Before The Change" },
      { cookie: sessionCookie, idempotencyKey: crypto.randomUUID() },
    );
    await putFirmProfile(
      { displayName: "After The Change" },
      { cookie: sessionCookie, idempotencyKey: crypto.randomUUID() },
    );

    const row = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "SELECT metadata FROM audit_log WHERE event = 'firm.profile_updated' AND subject_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .bind(poolFirmId)
      .first<{ metadata: string }>();
    expect(JSON.parse(row?.metadata ?? "{}")).toMatchObject({
      from: "Before The Change",
      to: "After The Change",
    });
  });
});
