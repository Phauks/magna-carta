import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { assertLedgerFitness } from "@magna-carta/ledger/fitness";
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
// to hang richness on. Every write goes through the real domain services.
export async function seedDemoFirm(
  database: BatchDatabase,
  context: FixtureContext,
  options: SeedingOptions,
): Promise<DemoFirmSummary> {
  assertSeedingAllowed(options);
  const accounts = await seedDemoChartOfAccounts(database, context);
  let entryCount = 0;
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
    entryCount += 1;
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

  // Costs are advanced BEFORE the settlement recovers them: the settlement's costs-recovered line
  // credits clientCostsAdvanced 100000, so the advance must precede it and cover it — otherwise
  // the asset rests negative, "recovering" money never advanced (review finding).
  await post(
    "Filing fees and expert retainer advanced — client matters",
    [
      { accountId: id("clientCostsAdvanced"), direction: "debit", amount: money(120000, USD) },
      { accountId: id("operatingBank"), direction: "credit", amount: money(120000, USD) },
    ],
    30,
  );

  // Trust activity: a deposit, a correction story, a settlement.
  const deposit = await retainerDeposit(database, context, accounts);
  const correction = await trustCorrection(database, context, accounts);
  const settlement = await multiLineSettlement(database, context, accounts);
  entryCount += [
    deposit.entryId,
    correction.originalEntryId,
    correction.reversalEntryId,
    correction.repostEntryId,
    settlement.entryId,
  ].length;

  // Operating month: rent, salaries, supplies, bar dues, a fee billed and received.
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
  // Every execution context gets the table-wide invariant proof, not just the vitest suite —
  // a seed that corrupted balances mid-story fails HERE, at the seeding chokepoint.
  await assertLedgerFitness(database);

  // Tallied in code from the seed's own posts (the demo-firm test cross-checks against a COUNT);
  // no raw SQL leaves this package's reads outside the schema-name-sync net.
  return { accountCount: accounts.size, entryCount };
}
