import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { postEntry } from "@magna-carta/ledger/post-entry";
import { money, USD } from "@magna-carta/money/money";
import type { FixtureContext } from "./context.ts";
import { seedDemoChartOfAccounts } from "./demo-chart-of-accounts.ts";
import { assertSeedingAllowed, type SeedingOptions } from "./guard.ts";
import { multiLineSettlement, retainerDeposit, trustCorrection } from "./scenarios.ts";

export interface DemoFirmSummary {
  readonly accountCount: number;
  readonly entryCount: number;
}

// The demo-firm bundle ("Demo, LLP" — becomes a real provisioned firm in slice 0·4): the demo
// chart of accounts plus a coherent dozen-entry story. Stays MINIMAL until matters/clients exist
// to hang richness on (ADR-0072). Every write goes through the real domain services.
export async function seedDemoFirm(
  database: BatchDatabase,
  context: FixtureContext,
  options: SeedingOptions,
): Promise<DemoFirmSummary> {
  assertSeedingAllowed(options);
  const accounts = await seedDemoChartOfAccounts(database, context);
  const post = async (
    description: string,
    lines: Parameters<typeof postEntry>[1]["lines"],
    advanceMinutes: number,
  ) => {
    const { effect } = await postEntry(
      database,
      { description, effectiveDate: context.clock.today(), lines },
      { clock: context.clock, randomSource: context.randomSource },
    );
    await commitEffectBatch(database, effect, { now: () => context.clock.now() });
    context.clock.advanceMinutes(advanceMinutes);
  };
  const id = (key: string) => {
    const accountId = accounts.get(key);
    if (!accountId) throw new Error(`demo firm: missing account ${key}`);
    return accountId;
  };

  // Opening: the owner funds the firm.
  await post(
    "Owner capital contribution",
    [
      { accountId: id("operatingBank"), direction: "debit", amount: money(5_000000, USD) },
      { accountId: id("ownersEquity"), direction: "credit", amount: money(5_000000, USD) },
    ],
    60,
  );

  // Trust activity: a deposit, a correction story, a settlement.
  await retainerDeposit(database, context, accounts);
  await trustCorrection(database, context, accounts);
  await multiLineSettlement(database, context, accounts);

  // Operating month: rent, salaries, supplies, bar dues, a fee billed and received, costs advanced.
  await post(
    "Office rent — monthly",
    [
      { accountId: id("rentExpense"), direction: "debit", amount: money(450000, USD) },
      { accountId: id("operatingBank"), direction: "credit", amount: money(450000, USD) },
    ],
    45,
  );
  await post(
    "Salaries",
    [
      { accountId: id("salariesExpense"), direction: "debit", amount: money(1_200000, USD) },
      { accountId: id("operatingBank"), direction: "credit", amount: money(1_200000, USD) },
    ],
    45,
  );
  await post(
    "Office supplies",
    [
      { accountId: id("officeSuppliesExpense"), direction: "debit", amount: money(23000, USD) },
      { accountId: id("operatingBank"), direction: "credit", amount: money(23000, USD) },
    ],
    30,
  );
  await post(
    "State bar dues",
    [
      { accountId: id("barDuesExpense"), direction: "debit", amount: money(54500, USD) },
      { accountId: id("operatingBank"), direction: "credit", amount: money(54500, USD) },
    ],
    30,
  );
  await post(
    "Fee billed — hourly matter",
    [
      { accountId: id("accountsReceivable"), direction: "debit", amount: money(380000, USD) },
      { accountId: id("feeIncome"), direction: "credit", amount: money(380000, USD) },
    ],
    90,
  );
  await post(
    "Client payment on account",
    [
      { accountId: id("operatingBank"), direction: "debit", amount: money(380000, USD) },
      { accountId: id("accountsReceivable"), direction: "credit", amount: money(380000, USD) },
    ],
    60,
  );
  await post(
    "Filing fee advanced for client",
    [
      { accountId: id("clientCostsAdvanced"), direction: "debit", amount: money(43500, USD) },
      { accountId: id("operatingBank"), direction: "credit", amount: money(43500, USD) },
    ],
    30,
  );

  const { results } = await database
    .prepare(
      "SELECT (SELECT COUNT(*) FROM ledger_account) AS accounts, (SELECT COUNT(*) FROM ledger_entry) AS entries",
    )
    .bind()
    .all<{ accounts: number; entries: number }>();
  return { accountCount: results[0]?.accounts ?? 0, entryCount: results[0]?.entries ?? 0 };
}
