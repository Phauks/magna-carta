import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The operating books over real bindings: the standard chart, two operating accounts, a vendor
// bill with a matter cost, and paying it from the account that is NOT the default. Read-only
// members read nothing and pay nothing.

let ownerCookie: string;
let readOnlyCookie: string;
let ownerUserId: UserId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let matterId: string;

const now = () => new Date().toISOString();

function send(cookie: string, method: string, path: string, body?: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie,
      ...(method === "GET" ? {} : { "Idempotency-Key": crypto.randomUUID() }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

interface Chart {
  accounts: Array<{ ledgerAccountId: string; code: string | null }>;
  operatingAccounts: Array<{
    operatingBankAccountId: string;
    name: string;
    isDefault: boolean;
    balanceMinor: number;
  }>;
  roles: Array<{ role: string; ledgerAccountId: string }>;
  suggestedRoles: Array<{ role: string; ledgerAccountId: string }>;
  hasStandardChart: boolean;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  const firmId: FirmId = (
    await seedFirm({ name: "Books Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  const owner = await seedCredentialedUser("books-owner@example.com", {
    userName: "Books Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Books Owner", firmId);
  ownerCookie = await signInForSessionCookie("books-owner@example.com");

  const readOnly = await seedCredentialedUser("books-reader@example.com", {
    userName: "Books Reader",
    firmId,
  });
  await insertMemberStatement(firmDatabase, {
    userId: readOnly.userId,
    displayName: "Books Reader",
    now: now(),
  }).run();
  await firmDatabase
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, 'firm:reportIncident', ?2, NULL, ?3)",
    )
    .bind(newIdentifier("grant"), readOnly.userId, now())
    .run();
  readOnlyCookie = await signInForSessionCookie("books-reader@example.com");

  matterId = newIdentifier("matter");
  await firmDatabase
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Smith v. Jones', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, ownerUserId, now())
    .run();
});

describe("the operating books routes", () => {
  it("sets up the books, enters a bill and pays it from any operating account", async () => {
    expect((await send(ownerCookie, "POST", "/api/v1/ledger/standard-chart")).status).toBe(201);
    const second = await send(ownerCookie, "POST", "/api/v1/ledger/standard-chart");
    expect(second.status).toBe(422);

    let chart = (await (await send(ownerCookie, "GET", "/api/v1/ledger/accounts")).json()) as Chart;
    expect(chart.hasStandardChart).toBe(true);
    expect(
      (
        await send(ownerCookie, "PUT", "/api/v1/ledger/account-roles", {
          assignments: chart.suggestedRoles,
        })
      ).status,
    ).toBe(201);

    for (const name of ["Operating", "Payroll"]) {
      const opened = await send(ownerCookie, "POST", "/api/v1/ledger/operating-accounts", {
        name,
        openedOn: "2026-01-02",
      });
      expect(opened.status).toBe(201);
    }
    chart = (await (await send(ownerCookie, "GET", "/api/v1/ledger/accounts")).json()) as Chart;
    expect(chart.operatingAccounts.map((account) => [account.name, account.isDefault])).toEqual([
      ["Operating", true],
      ["Payroll", false],
    ]);
    const research = chart.accounts.find((account) => account.code === "6300")?.ledgerAccountId;

    const recorded = await send(ownerCookie, "POST", "/api/v1/payables/bills", {
      vendorId: "organization_courtReporter",
      billReference: "INV-1001",
      billDate: "2026-10-01",
      dueDate: "2026-10-31",
      lines: [
        {
          description: "Deposition transcript",
          amountMinor: 45_000,
          matterId,
          disbursementClass: "hard",
        },
        { description: "Research", amountMinor: 10_000, ledgerAccountId: research },
      ],
    });
    expect(recorded.status).toBe(201);
    const { id: vendorBillId } = (await recorded.json()) as { id: string };

    const payroll = chart.operatingAccounts.find((account) => account.name === "Payroll");
    const paid = await send(ownerCookie, "POST", "/api/v1/payables/payments", {
      operatingBankAccountId: payroll?.operatingBankAccountId,
      paidOn: "2026-11-02",
      method: "check",
      payments: [{ vendorBillId, amountMinor: 55_000 }],
    });
    expect(paid.status).toBe(201);

    const board = (await (
      await send(ownerCookie, "GET", "/api/v1/payables/bills?filter=all&asOf=2026-11-20")
    ).json()) as {
      vendors: Array<{ bills: Array<{ state: string }> }>;
    };
    expect(board.vendors[0]?.bills[0]?.state).toBe("paid");

    const overpay = await send(ownerCookie, "POST", "/api/v1/payables/payments", {
      operatingBankAccountId: payroll?.operatingBankAccountId,
      paidOn: "2026-11-02",
      method: "cash",
      payments: [{ vendorBillId, amountMinor: 1 }],
    });
    expect(overpay.status).toBe(422);

    const { results } = await firmDatabase
      .prepare("SELECT status, amount_minor FROM cost_entry WHERE matter_id = ?1")
      .bind(matterId)
      .all<{ status: string; amount_minor: number }>();
    expect(results).toEqual([{ status: "approved", amount_minor: 45_000 }]);
  });

  it("refuses a member without the books' permissions", async () => {
    expect((await send(readOnlyCookie, "GET", "/api/v1/payables/bills")).status).toBe(403);
    expect((await send(readOnlyCookie, "GET", "/api/v1/ledger/accounts")).status).toBe(403);
    expect(
      (
        await send(readOnlyCookie, "POST", "/api/v1/payables/bills", {
          vendorId: "organization_vendor",
          billDate: "2026-10-01",
          lines: [{ description: "Anything", amountMinor: 100 }],
        })
      ).status,
    ).toBe(403);
  });
});
