import { describe, expect, it } from "vitest";
import { fixtureContext } from "../src/context.ts";
import { DEMO_ACCOUNT_KEYS, seedDemoChartOfAccounts } from "../src/demo-chart-of-accounts.ts";
import { createLocalPerFirmDatabase } from "../src/local-database.ts";

describe("demo chart of accounts (DEMO DATA — not the Phase-3 product chart)", () => {
  it("seeds through createAccount; trust children hang under Client Trust Liability", async () => {
    const { database } = createLocalPerFirmDatabase();
    const context = fixtureContext("demo-llp-1");
    const accounts = await seedDemoChartOfAccounts(database, context);
    for (const key of DEMO_ACCOUNT_KEYS) expect(accounts.has(key)).toBe(true);

    const { results } = await database
      .prepare("SELECT COUNT(*) AS n FROM ledger_account WHERE parent_account_id = ?1")
      .bind(accounts.get("clientTrustLiability"))
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(2); // Dana Smith + Marcus Webb demo client subledgers

    const balances = await database
      .prepare("SELECT COUNT(*) AS n FROM account_balance")
      .bind()
      .all<{ n: number }>();
    expect(balances.results[0]?.n).toBe(DEMO_ACCOUNT_KEYS.length); // every account got its row
  });

  it("is deterministic: same seed twice → identical account rows", async () => {
    const first = createLocalPerFirmDatabase();
    const second = createLocalPerFirmDatabase();
    await seedDemoChartOfAccounts(first.database, fixtureContext("demo-llp-1"));
    await seedDemoChartOfAccounts(second.database, fixtureContext("demo-llp-1"));
    const dump = (raw: typeof first.raw) =>
      raw.prepare("SELECT * FROM ledger_account ORDER BY id").all();
    expect(dump(first.raw)).toEqual(dump(second.raw));
  });
});
