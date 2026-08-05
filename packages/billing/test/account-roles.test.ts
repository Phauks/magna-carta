import { describe, expect, it } from "vitest";
import {
  composeAccountRoleConfiguration,
  isAccountRole,
  readAccountRoleMap,
  resolveAccountRole,
} from "../src/account-roles.ts";
import { BillingValidationError } from "../src/billing-validation.ts";
import { ACCOUNT_ROLES, type AccountRole } from "../src/types.ts";
import { billingFixture, commit, options } from "./support.ts";

describe("the account-role map", () => {
  it.each(ACCOUNT_ROLES)("refuses by name when the %s role is unmapped", (role: AccountRole) => {
    const refusal = (() => {
      try {
        resolveAccountRole(new Map(), role);
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(refusal).toBeInstanceOf(BillingValidationError);
    expect((refusal as BillingValidationError).code).toBe("account-role-unmapped");
    // The refusal names the missing role AND where to set it: a fact the platform does not have is
    // not a fact it invents, and a refusal a person cannot act on is a refusal that wastes their day.
    expect((refusal as BillingValidationError).message).toContain(role);
    expect((refusal as BillingValidationError).message).toContain("settings");
  });

  it.each(ACCOUNT_ROLES)("stores and reads back the %s role", async (role: AccountRole) => {
    const fixture = await billingFixture();
    await commit(
      fixture.database,
      composeAccountRoleConfiguration(
        fixture.database,
        [{ role, ledgerAccountId: fixture.feeIncomeAccountId }],
        options,
      ),
    );
    const map = await readAccountRoleMap(fixture.database);
    expect(resolveAccountRole(map, role)).toBe(fixture.feeIncomeAccountId);
  });

  it("re-points a role at a different account without restating any posting already made", async () => {
    const fixture = await billingFixture();
    await commit(
      fixture.database,
      composeAccountRoleConfiguration(
        fixture.database,
        [{ role: "fee_income", ledgerAccountId: fixture.feeIncomeAccountId }],
        options,
      ),
    );
    await commit(
      fixture.database,
      composeAccountRoleConfiguration(
        fixture.database,
        [{ role: "fee_income", ledgerAccountId: fixture.costRecoveryIncomeAccountId }],
        options,
      ),
    );
    const map = await readAccountRoleMap(fixture.database);
    expect(resolveAccountRole(map, "fee_income")).toBe(fixture.costRecoveryIncomeAccountId);
    // Exactly one row per role: the map answers "which account is fee income", not "which have been".
    const rows = await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM firm_account_role")
      .all<{ count: number }>();
    expect(rows.results[0]?.count).toBe(1);
  });

  it("rejects a role outside the closed set", () => {
    expect(isAccountRole("accounts_receivable")).toBe(true);
    expect(isAccountRole("petty_cash")).toBe(false);
  });

  it("stores every role a firm can configure, and the database refuses any other", async () => {
    const fixture = await billingFixture();
    await commit(
      fixture.database,
      composeAccountRoleConfiguration(
        fixture.database,
        ACCOUNT_ROLES.map((role) => ({
          role,
          ledgerAccountId: fixture.accountsReceivableAccountId,
        })),
        options,
      ),
    );
    const map = await readAccountRoleMap(fixture.database);
    expect(map.size).toBe(ACCOUNT_ROLES.length);

    await expect(
      Promise.resolve().then(() =>
        fixture.database
          .prepare(
            "INSERT INTO firm_account_role (role, ledger_account_id, created_at, updated_at) VALUES ('petty_cash', ?1, '2026-08-05', '2026-08-05')",
          )
          .bind(fixture.accountsReceivableAccountId)
          .run(),
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
  });
});
