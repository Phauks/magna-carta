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

// The firm's editing policy over its route: on by default for a fresh firm, held by the seeded
// Admin role alone, and written through one idempotent batch with its audit row.

let poolFirmId: FirmId;

const ROUTE = "https://example.com/api/v1/firm/editing-policy";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  // The FirmDatabase Durable Object self-migrates the full per-firm lineage (including the seed
  // that grants Admin firm:manageEditingPolicy) on first access.
  poolFirmId = (
    await seedFirm({ name: "Editing Policy Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
});

async function countAudits(): Promise<number> {
  return (
    (
      await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'firm.editing_policy_updated'")
        .first<{ n: number }>()
    )?.n ?? 0
  );
}

describe("GET /api/v1/firm/editing-policy", () => {
  it("records changes by default for a fresh firm", async () => {
    const { userId } = await seedCredentialedUser("editing-policy-get@example.com", {
      userName: "Editing Policy Reader",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Editing Policy Reader", poolFirmId);
    const cookie = await signInForSessionCookie("editing-policy-get@example.com");
    const response = await SELF.fetch(ROUTE, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recordChanges: true });
  });

  it("returns 403 for an authenticated member without firm:manageEditingPolicy", async () => {
    // In the control-plane firm but not mirrored into the firm database: the chokepoint resolves
    // the firm and finds no permissions, which is a refusal rather than a missing firm.
    await seedCredentialedUser("editing-policy-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("editing-policy-noperm@example.com");
    const response = await SELF.fetch(ROUTE, { headers: { cookie } });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});

describe("PATCH /api/v1/firm/editing-policy", () => {
  let ownerCookie: string;

  beforeAll(async () => {
    const { userId } = await seedCredentialedUser("editing-policy-patch@example.com", {
      userName: "Editing Policy Patcher",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Editing Policy Patcher", poolFirmId);
    ownerCookie = await signInForSessionCookie("editing-policy-patch@example.com");
  });

  const patch = (body: unknown, key = crypto.randomUUID()) =>
    SELF.fetch(ROUTE, {
      method: "PATCH",
      headers: {
        cookie: ownerCookie,
        "content-type": "application/json",
        origin: "https://example.com",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(body),
    });

  it("switches recording off, and the next read agrees", async () => {
    const response = await patch({ recordChanges: false });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recordChanges: false });

    const read = await SELF.fetch(ROUTE, { headers: { cookie: ownerCookie } });
    expect(await read.json()).toEqual({ recordChanges: false });
  });

  it("is idempotent: replaying the same Idempotency-Key writes exactly one audit row", async () => {
    const key = crypto.randomUUID();
    const before = await countAudits();
    const first = await patch({ recordChanges: true }, key);
    expect(first.status).toBe(200);
    const second = await patch({ recordChanges: true }, key);
    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await second.json()).toEqual({ recordChanges: true });
    expect((await countAudits()) - before).toBe(1);
  });

  it("an empty PATCH body writes no audit row and returns the current policy", async () => {
    const before = await countAudits();
    const response = await patch({});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recordChanges: true });
    expect(await countAudits()).toBe(before);
  });

  it("returns 422 for a value the policy does not carry", async () => {
    const response = await patch({ recordChanges: "sometimes" });
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});
