import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import { env, SELF } from "cloudflare:test";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, LocationId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { money, USD } from "@magna-carta/money/money";
import { openTrustAccount } from "@magna-carta/trust/account-tree";
import { composeTrustDeposit, composeTrustDisbursement } from "@magna-carta/trust/movements";
import type { TrustAccountId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { authorizersDefinition } from "../src/reporting/trust-compliance-report-policy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The reporting route surface, driven through the chokepoint over real Miniflare bindings.
//
// Two things are proved here that no unit test can prove: that the capability seeded by the per-firm
// migration actually reaches a provisioned firm's Owner role, and that a member without it is
// refused by the chokepoint rather than by a check inside the handler.
//
// The trust account and its movements are composed directly against the firm's database, because
// opening a trust account is deliberately not an API route — the sub-ledger is built by the trust
// subsystem's own paths, and this suite is about the read over it.

const RECORDED_AT = "2026-07-15T10:00:00.000Z";
const clockAt = (instant: string) => ({
  clock: { now: () => instant, today: () => civilDateOf(instant) },
});

let poolFirmId: FirmId;
let ownerCookie: string;
let noPermissionCookie: string;
let trustAccountId: TrustAccountId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

async function mirrorMemberWithUnrelatedGrant(
  database: ReturnType<typeof firmDatabaseFor>,
  userId: UserId,
  displayName: string,
): Promise<void> {
  await insertMemberStatement(database, { userId, displayName, now: RECORDED_AT }).run();
  await database
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
    )
    .bind(newIdentifier("grant"), userId, "firm:reportIncident", RECORDED_AT)
    .run();
}

const commit = (effect: EffectWrite, instant: string): Promise<void> =>
  commitEffectBatch(firmDatabase, effect, { now: () => instant });

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Reports Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);

  const owner = await seedCredentialedUser("reports-owner@example.com", {
    userName: "Reports Owner",
    firmId: poolFirmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Reports Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("reports-owner@example.com");

  const outsider = await seedCredentialedUser("reports-outsider@example.com", {
    userName: "Reports Outsider",
    firmId: poolFirmId,
  });
  await mirrorMemberWithUnrelatedGrant(firmDatabase, outsider.userId, "Reports Outsider");
  noPermissionCookie = await signInForSessionCookie("reports-outsider@example.com");

  const locationId = newIdentifier("location") as LocationId;
  await firmDatabase
    .prepare(
      "INSERT INTO location (id, name, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)",
    )
    .bind(locationId, "Reno", RECORDED_AT)
    .run();

  const opened = await openTrustAccount(
    firmDatabase,
    {
      name: "Trust — Reno",
      locationId,
      jurisdiction: "US-NV",
      currency: "USD",
      iolta: false,
      openedOn: "2026-01-01",
    },
    clockAt(RECORDED_AT),
  );
  await commit(opened.effect, RECORDED_AT);
  trustAccountId = opened.trustAccountId;

  const matterId = newIdentifier("matter") as MatterId;
  await firmDatabase
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, ?4, ?4)",
    )
    .bind(matterId, "Webb matter", owner.userId, RECORDED_AT)
    .run();
  await firmDatabase
    .prepare(
      "INSERT INTO matter_party (id, matter_id, entity_id, role, created_at, updated_at) VALUES (?1, ?2, ?3, 'client', ?4, ?4)",
    )
    .bind(newIdentifier("matterParty"), matterId, "entity_webb", RECORDED_AT)
    .run();

  const deposit = await composeTrustDeposit(
    firmDatabase,
    {
      trustAccountId,
      to: {
        matterId,
        clientNodeName: "Trust — Webb",
        matterLeafName: `Trust — Webb — ${matterId}`,
      },
      amount: money(500_00, USD),
      effectiveDate: "2026-07-10",
      description: "Retainer received",
      method: "check",
      reference: "1041",
      source: "Webb Holdings",
      purpose: "Advance on fees and costs",
      recordedBy: owner.userId,
    },
    clockAt(RECORDED_AT),
  );
  await commit(deposit.effect, RECORDED_AT);

  const paid = await composeTrustDisbursement(
    firmDatabase,
    {
      fromNodeId: deposit.nodeId,
      amount: money(120_00, USD),
      effectiveDate: "2026-07-20",
      description: "Filing fee",
      method: "check",
      reference: "2001",
      payee: "Clerk of the Court",
      purpose: "Court filing fee",
      recordedBy: owner.userId,
      authorizedBy: owner.userId,
    },
    clockAt("2026-07-20T10:00:00.000Z"),
  );
  await commit(paid.effect, "2026-07-20T10:00:00.000Z");
});

const packUrl = (query: string, account: string = trustAccountId) =>
  `https://example.com/api/v1/reports/trust-compliance/${account}?${query}`;

describe("the trust-compliance pack route", () => {
  it("serves the pack to an Owner, whose capability comes from the seeded role", async () => {
    const response = await SELF.fetch(
      packUrl("periodStart=2026-07-01&periodEnd=2026-07-31&knownAsOf=2026-08-01T00%3A00%3A00.000Z"),
      { headers: { cookie: ownerCookie } },
    );
    expect(response.status).toBe(200);
    const pack = (await response.json()) as {
      cover: {
        reproducibility: { reproducible: boolean };
        jurisdiction: { available: boolean; refusalCode?: string };
        completeness: { scope: string };
      };
      clientLedgers: { closingBalanceMinor: number }[];
      journal: { closingBalanceMinor: number; entries: unknown[] };
      reconciliationNote: string | null;
    };
    expect(pack.cover.reproducibility.reproducible).toBe(true);
    expect(pack.clientLedgers[0]?.closingBalanceMinor).toBe(380_00);
    expect(pack.journal.closingBalanceMinor).toBe(380_00);
    expect(pack.journal.entries.length).toBe(2);
    // No rules corpus is bound platform-wide, so the cover names the refusal rather than printing a
    // citation nobody stood behind.
    expect(pack.cover.jurisdiction.available).toBe(false);
    expect(pack.cover.completeness.scope).toBe("complete");
    // A period the firm never reconciled says so in words rather than leaving a blank section.
    expect(pack.reconciliationNote).toContain("No reconciliation");
  });

  it("stamps a pack asked for without a knowledge instant as live", async () => {
    const response = await SELF.fetch(packUrl("periodStart=2026-07-01&periodEnd=2026-07-31"), {
      headers: { cookie: ownerCookie },
    });
    expect(response.status).toBe(200);
    const pack = (await response.json()) as {
      cover: { reproducibility: { reproducible: boolean }; reproducibilityStatement: string };
      provenance: { knownAsOf: string | null };
    };
    expect(pack.cover.reproducibility.reproducible).toBe(false);
    expect(pack.cover.reproducibilityStatement).toContain("not claimed to reproduce");
    expect(pack.provenance.knownAsOf).toBeNull();
  });

  it("refuses a member who does not hold the capability, at the chokepoint", async () => {
    const response = await SELF.fetch(packUrl("periodStart=2026-07-01&periodEnd=2026-07-31"), {
      headers: { cookie: noPermissionCookie },
    });
    expect(response.status).toBe(403);
  });

  it("refuses an anonymous caller", async () => {
    const response = await SELF.fetch(packUrl("periodStart=2026-07-01&periodEnd=2026-07-31"));
    expect(response.status).toBe(401);
  });

  it("refuses an inverted period by name rather than answering an empty one", async () => {
    const response = await SELF.fetch(packUrl("periodStart=2026-08-01&periodEnd=2026-07-31"), {
      headers: { cookie: ownerCookie },
    });
    expect(response.status).toBe(422);
    const problem = (await response.json()) as { type: string; errorId: string };
    expect(problem.type).toContain("report-period-invalid");
    expect(problem.errorId).toBeTruthy();
  });

  it("refuses a knowledge instant the platform has not reached", async () => {
    const response = await SELF.fetch(
      packUrl("periodStart=2026-07-01&periodEnd=2026-07-31&knownAsOf=2099-01-01T00%3A00%3A00.000Z"),
      { headers: { cookie: ownerCookie } },
    );
    expect(response.status).toBe(422);
    const problem = (await response.json()) as { type: string };
    expect(problem.type).toContain("report-period-invalid");
  });

  it("answers 404 for a trust account this firm does not have", async () => {
    const response = await SELF.fetch(
      packUrl("periodStart=2026-07-01&periodEnd=2026-07-31", newIdentifier("trustAccount")),
      { headers: { cookie: ownerCookie } },
    );
    expect(response.status).toBe(404);
  });

  it("suppresses the authorizer when the caller asks it to, and names them by default", async () => {
    const named = await SELF.fetch(
      packUrl("periodStart=2026-07-01&periodEnd=2026-07-31&authorizers=include"),
      { headers: { cookie: ownerCookie } },
    );
    const namedPack = (await named.json()) as {
      journal: { entries: { bankDeltaMinor: number; authorizedBy: string | null }[] };
    };
    expect(
      namedPack.journal.entries.find((entry) => entry.bankDeltaMinor < 0)?.authorizedBy,
    ).toBeTruthy();

    const anonymous = await SELF.fetch(
      packUrl("periodStart=2026-07-01&periodEnd=2026-07-31&authorizers=omit"),
      { headers: { cookie: ownerCookie } },
    );
    const anonymousPack = (await anonymous.json()) as {
      journal: { entries: { authorizedBy: string | null }[] };
      provenance: { options: { authorizers: string } };
    };
    for (const entry of anonymousPack.journal.entries) expect(entry.authorizedBy).toBeNull();
    expect(anonymousPack.provenance.options.authorizers).toBe("omit");
  });

  it("takes an option the caller leaves unstated from the firm's report policy", async () => {
    await writeFirmSettingStatement(firmDatabase, authorizersDefinition, "omit", RECORDED_AT).run();
    try {
      const response = await SELF.fetch(packUrl("periodStart=2026-07-01&periodEnd=2026-07-31"), {
        headers: { cookie: ownerCookie },
      });
      const pack = (await response.json()) as {
        journal: { entries: { authorizedBy: string | null }[] };
        provenance: { options: { authorizers: string; zeroBalanceLedgers: string } };
      };
      for (const entry of pack.journal.entries) expect(entry.authorizedBy).toBeNull();
      // The provenance records what was USED, so a reader of the document can see the policy it
      // was produced under without opening the settings.
      expect(pack.provenance.options).toEqual({
        authorizers: "omit",
        zeroBalanceLedgers: "include",
      });
    } finally {
      await writeFirmSettingStatement(
        firmDatabase,
        authorizersDefinition,
        "include",
        RECORDED_AT,
      ).run();
    }
  });
});

describe("the trust-account listing the report screen picks from", () => {
  it("lists the firm's trust accounts to a member who may read trust", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/trust/accounts", {
      headers: { cookie: ownerCookie },
    });
    expect(response.status).toBe(200);
    const page = (await response.json()) as {
      data: {
        id: string;
        name: string;
        status: string;
        accountNumberLastFour: string | null;
        timeZone: string;
      }[];
      nextCursor: string | null;
    };
    expect(page.nextCursor).toBeNull();
    expect(page.data.map((account) => account.id)).toContain(trustAccountId);
    const listed = page.data.find((account) => account.id === trustAccountId);
    expect(listed?.name).toBe("Trust — Reno");
    expect(listed?.status).toBe("open");
    // The office recorded no zone, so the listing resolves the platform's normalized one rather
    // than serving nothing: a report's "end of day" always has a zone to be the end of.
    expect(listed?.timeZone).toBe("UTC");
    // The listing carries the last four at most; there is no full number anywhere to serve.
    expect(Object.keys(listed ?? {})).not.toContain("accountNumber");
  });

  it("refuses a member who does not hold trust:read, at the chokepoint", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/trust/accounts", {
      headers: { cookie: noPermissionCookie },
    });
    expect(response.status).toBe(403);
  });
});

describe("GET /api/v1/reports/accounts-receivable-aging", () => {
  const agingUrl = (query: string) =>
    `https://example.com/api/v1/reports/accounts-receivable-aging?${query}`;

  it("answers the Owner with the aging at a date, stamped live when no knowledge instant is given", async () => {
    const response = await SELF.fetch(agingUrl("asOfDate=2026-07-31"), {
      headers: { cookie: ownerCookie },
    });
    expect(response.status).toBe(200);
    const report = (await response.json()) as {
      asOfDate: string;
      reproducibility: { reproducible: boolean };
      totals: { unpaidMinor: number[]; invoiceCount: number[] | null };
      offices: unknown[];
      clients: unknown[];
    };
    expect(report.asOfDate).toBe("2026-07-31");
    expect(report.reproducibility.reproducible).toBe(false);
    expect(report.totals.unpaidMinor).toHaveLength(5);
    expect(report.totals.invoiceCount).toHaveLength(5);
  });

  it("refuses a date that is not on the calendar", async () => {
    const response = await SELF.fetch(agingUrl("asOfDate=2026-02-30"), {
      headers: { cookie: ownerCookie },
    });
    expect(response.status).toBe(422);
  });

  it("refuses a member without reports:financial at the chokepoint", async () => {
    const response = await SELF.fetch(agingUrl("asOfDate=2026-07-31"), {
      headers: { cookie: noPermissionCookie },
    });
    expect(response.status).toBe(403);
  });
});

describe("GET /api/v1/reports/work-in-progress", () => {
  const url = "https://example.com/api/v1/reports/work-in-progress";

  it("answers the Owner with live work in progress, stamped with when it was computed", async () => {
    const response = await SELF.fetch(url, { headers: { cookie: ownerCookie } });
    expect(response.status).toBe(200);
    const report = (await response.json()) as {
      reproducible: boolean;
      computedAt: string;
      totals: { totalMinor: number };
    };
    expect(report.reproducible).toBe(false);
    expect(report.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("refuses a member without reports:financial at the chokepoint", async () => {
    const response = await SELF.fetch(url, { headers: { cookie: noPermissionCookie } });
    expect(response.status).toBe(403);
  });
});
