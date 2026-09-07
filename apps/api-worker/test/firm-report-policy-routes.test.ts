import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { readTrustComplianceReportPolicy } from "../src/reporting/trust-compliance-report-policy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The firm's report policy through the chokepoint over real Miniflare bindings: the seeded Owner
// role reaches it, a member who may only run the report cannot change what it says, a write lands
// once with one audit row and none for a no-op, and the stored value is what the pack reads.

let firmId: FirmId;
let ownerCookie: string;
let reporterCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString() };
const POLICY_URL = "https://example.com/api/v1/firm/reports/policy";

interface Policy {
  trustCompliance: { zeroBalanceLedgers: string; authorizers: string };
}

async function readPolicy(cookie: string): Promise<Response> {
  return SELF.fetch(POLICY_URL, { headers: { cookie } });
}

async function patchPolicy(cookie: string, body: unknown, key = crypto.randomUUID()) {
  return SELF.fetch(POLICY_URL, {
    method: "PATCH",
    headers: {
      cookie,
      "content-type": "application/json",
      origin: "https://example.com",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  });
}

async function countPolicyAudits(): Promise<number> {
  return (
    (
      await firmDatabase
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'firm.report_policy_updated'")
        .first<{ n: number }>()
    )?.n ?? 0
  );
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Report Policy Test Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("report-policy-owner@example.com", {
    userName: "Policy Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Policy Owner", firmId);
  ownerCookie = await signInForSessionCookie("report-policy-owner@example.com");

  // A member who may RUN the report and nothing else: the report key must not be the key that
  // decides what the report says.
  const reporter = await seedCredentialedUser("report-policy-reporter@example.com", {
    userName: "Policy Reporter",
    firmId,
  });
  await insertMemberStatement(firmDatabase, {
    userId: reporter.userId as UserId,
    displayName: "Policy Reporter",
    now: clock.now(),
  }).run();
  await firmDatabase
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, 'reports:trustCompliance', ?2, NULL, ?3)",
    )
    .bind(newIdentifier("grant"), reporter.userId, clock.now())
    .run();
  reporterCookie = await signInForSessionCookie("report-policy-reporter@example.com");
});

describe("the firm's report policy", () => {
  it("reads the pack's own defaults where the firm has never set anything", async () => {
    const response = await readPolicy(ownerCookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      trustCompliance: { zeroBalanceLedgers: "include", authorizers: "include" },
    });
  });

  it("refuses a member who may only run the report, on the read and the write alike", async () => {
    expect((await readPolicy(reporterCookie)).status).toBe(403);
    const response = await patchPolicy(reporterCookie, {
      trustCompliance: { authorizers: "omit" },
    });
    expect(response.status).toBe(403);
    expect((await readTrustComplianceReportPolicy(firmDatabase)).authorizers).toBe("include");
  });

  it("changes one setting and leaves the other, with one audit row", async () => {
    const before = await countPolicyAudits();
    const response = await patchPolicy(ownerCookie, { trustCompliance: { authorizers: "omit" } });
    expect(response.status).toBe(200);
    expect(((await response.json()) as Policy).trustCompliance).toEqual({
      zeroBalanceLedgers: "include",
      authorizers: "omit",
    });
    expect(await readTrustComplianceReportPolicy(firmDatabase)).toEqual({
      zeroBalanceLedgers: "include",
      authorizers: "omit",
    });
    expect(await countPolicyAudits()).toBe(before + 1);
  });

  it("replays a retried write rather than recording it twice", async () => {
    const before = await countPolicyAudits();
    const key = crypto.randomUUID();
    const body = { trustCompliance: { zeroBalanceLedgers: "omit" } };
    const first = await patchPolicy(ownerCookie, body, key);
    const second = await patchPolicy(ownerCookie, body, key);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await countPolicyAudits()).toBe(before + 1);
  });

  it("writes nothing and audits nothing for an empty patch", async () => {
    const before = await countPolicyAudits();
    const response = await patchPolicy(ownerCookie, {});
    expect(response.status).toBe(200);
    expect(await countPolicyAudits()).toBe(before);
  });

  it("refuses a value the vocabulary does not carry", async () => {
    const response = await patchPolicy(ownerCookie, { trustCompliance: { authorizers: "never" } });
    expect(response.status).toBe(422);
  });
});
