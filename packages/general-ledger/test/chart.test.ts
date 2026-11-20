import { describe, expect, it } from "vitest";
import { readChartOfAccounts, createChartAccount, updateChartAccount } from "../src/chart.ts";
import { configureAccountRoles } from "../src/role-configuration.ts";
import { adoptStarterChart } from "../src/starter-chart.ts";
import { accountId, booksFixture, commit, options } from "./support.ts";

describe("the chart of accounts", () => {
  it("shows bank accounts as cash or trust assets and hides trust's per-client tree", async () => {
    const fixture = await booksFixture();
    const chart = await readChartOfAccounts(fixture.database);
    const operating = chart.filter((account) => account.operatingBankAccountId !== null);
    expect(operating.map((account) => [account.name, account.statementSection])).toEqual([
      ["Operating", "cash"],
      ["Payroll", "cash"],
    ]);
    const trustBank = chart.find(
      (account) => account.ledgerAccountId === fixture.trustBankLedgerAccountId,
    );
    expect(trustBank?.statementSection).toBe("trustAssets");
    expect(trustBank?.trustRegistration).toBe("bank");
    expect(chart.find((account) => account.code === "2000")?.roles).toEqual(["accounts_payable"]);
  });

  it("refuses a second standard chart, a taken number and a type change", async () => {
    const fixture = await booksFixture();
    await expect(adoptStarterChart(fixture.database, options)).rejects.toMatchObject({
      code: "chart-already-started",
    });
    await expect(
      createChartAccount(
        fixture.database,
        { name: "Copier Lease", type: "expense", code: "6100" },
        options,
      ),
    ).rejects.toMatchObject({ code: "account-code-taken" });
    await expect(
      updateChartAccount(fixture.database, {
        ledgerAccountId: accountId(fixture, "6100"),
        type: "asset",
      }),
    ).rejects.toMatchObject({ code: "account-is-a-system-account" });
  });

  it("never lets a trust account be renamed here or carry one of the app's roles", async () => {
    const fixture = await booksFixture();
    await expect(
      updateChartAccount(fixture.database, {
        ledgerAccountId: fixture.trustBankLedgerAccountId,
        name: "Mine",
      }),
    ).rejects.toMatchObject({ code: "account-is-trust-registered" });
    await expect(
      configureAccountRoles(
        fixture.database,
        [{ role: "operating_bank", ledgerAccountId: fixture.trustBankLedgerAccountId }],
        options,
      ),
    ).rejects.toMatchObject({ code: "role-account-is-trust-registered" });
  });

  it("refuses a role on an account of the wrong type", async () => {
    const fixture = await booksFixture();
    await expect(
      configureAccountRoles(
        fixture.database,
        [{ role: "accounts_payable", ledgerAccountId: accountId(fixture, "6100") }],
        options,
      ),
    ).rejects.toMatchObject({ code: "role-account-type-mismatch" });
  });

  it("creates a numbered account in its section", async () => {
    const fixture = await booksFixture();
    const created = await createChartAccount(
      fixture.database,
      {
        name: "Copier Lease",
        type: "expense",
        code: "6260",
        statementSection: "operatingExpenses",
      },
      options,
    );
    await commit(fixture.database, created.effect);
    const chart = await readChartOfAccounts(fixture.database);
    expect(chart.find((account) => account.code === "6260")).toMatchObject({
      name: "Copier Lease",
      statementSection: "operatingExpenses",
      systemAccount: false,
    });
  });
});
