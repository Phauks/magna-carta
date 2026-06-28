import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { writeSupportAudit } from "../src/support/support-audit.ts";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

describe("writeSupportAudit", () => {
  it("writes an auth_audit row with principal in metadata", async () => {
    const requesterUserId = newIdentifier("user");
    const grantId = newIdentifier("supportGrant");
    const principalId = newIdentifier("platformStaff");
    await writeSupportAudit(env.DB_CONTROL, {
      event: "support.grant.redeemed",
      requesterUserId,
      metadata: { grantId, principalId, tier: "diagnostic" },
      now: new Date().toISOString(),
    });
    const rows = await env.DB_CONTROL.prepare(
      "SELECT event, user_id, metadata FROM auth_audit WHERE user_id = ?1",
    )
      .bind(requesterUserId)
      .all<{ event: string; user_id: string; metadata: string }>();
    expect(rows.results[0]?.event).toBe("support.grant.redeemed");
    expect(JSON.parse(rows.results[0]?.metadata ?? "{}").principalId).toBe(principalId);
  });
});
