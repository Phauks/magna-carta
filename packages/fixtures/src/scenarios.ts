import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { LedgerAccountId, LedgerEntryId } from "@magna-carta/identifiers/types";
import { postEntry } from "@magna-carta/ledger/post-entry";
import { reverseEntry } from "@magna-carta/ledger/reverse-entry";
import { setAccountBoundsStatement } from "@magna-carta/ledger/statements";
import { money, USD } from "@magna-carta/money/money";
import type { FixtureContext } from "./context.ts";

// Named scenarios (ADR-0034/ADR-0072): deterministic short stories told through the REAL write
// paths, with assertions baked in — running them IS integration coverage. They throw plain Errors
// (not vitest) so they also run as seeding code outside a test runner.

type DemoAccounts = ReadonlyMap<string, LedgerAccountId>;

function accountOf(accounts: DemoAccounts, key: string): LedgerAccountId {
  const id = accounts.get(key);
  if (!id) throw new Error(`scenario: demo account "${key}" missing`);
  return id;
}

async function balanceOf(database: BatchDatabase, accountId: LedgerAccountId): Promise<number> {
  const { results } = await database
    .prepare("SELECT balance_minor FROM account_balance WHERE account_id = ?1")
    .bind(accountId)
    .all<{ balance_minor: number }>();
  const balance = results[0]?.balance_minor;
  if (balance === undefined) throw new Error(`scenario: no balance row for ${accountId}`);
  return balance;
}

function assertScenario(condition: boolean, message: string): void {
  if (!condition) throw new Error(`scenario assertion failed: ${message}`);
}

const serviceOptions = (context: FixtureContext) => ({
  clock: context.clock,
  randomSource: context.randomSource,
});

// Dana Smith pays a $5,000.00 retainer into trust.
export async function retainerDeposit(
  database: BatchDatabase,
  context: FixtureContext,
  accounts: DemoAccounts,
): Promise<{ entryId: LedgerEntryId }> {
  const trustBank = accountOf(accounts, "trustBank");
  const smith = accountOf(accounts, "trustSmith");
  const before = await balanceOf(database, smith);
  const { entryId, effect } = await postEntry(
    database,
    {
      description: "Retainer deposit — Dana Smith",
      effectiveDate: context.clock.today(),
      lines: [
        { accountId: trustBank, direction: "debit", amount: money(500000, USD) },
        { accountId: smith, direction: "credit", amount: money(500000, USD) },
      ],
    },
    serviceOptions(context),
  );
  await commitEffectBatch(database, effect, { now: () => context.clock.now() });
  context.clock.advanceMinutes(7);
  assertScenario(
    (await balanceOf(database, smith)) === before + 500000,
    "Smith's trust subledger grew by the deposit",
  );
  return { entryId };
}

// A deposit lands on the wrong client; the correction is a linked reversing entry, then a re-post.
export async function trustCorrection(
  database: BatchDatabase,
  context: FixtureContext,
  accounts: DemoAccounts,
): Promise<{ originalEntryId: LedgerEntryId; reversalEntryId: LedgerEntryId }> {
  const trustBank = accountOf(accounts, "trustBank");
  const webb = accountOf(accounts, "trustWebb");
  const smith = accountOf(accounts, "trustSmith");

  const wrong = await postEntry(
    database,
    {
      description: "Retainer deposit — posted to Marcus Webb in error",
      effectiveDate: context.clock.today(),
      lines: [
        { accountId: trustBank, direction: "debit", amount: money(250000, USD) },
        { accountId: webb, direction: "credit", amount: money(250000, USD) },
      ],
    },
    serviceOptions(context),
  );
  await commitEffectBatch(database, wrong.effect, { now: () => context.clock.now() });
  context.clock.advanceMinutes(30);

  const reversal = await reverseEntry(
    database,
    {
      entryId: wrong.entryId,
      description: "Correction: deposit belonged to Dana Smith",
      effectiveDate: context.clock.today(),
    },
    serviceOptions(context),
  );
  await commitEffectBatch(database, reversal.effect, { now: () => context.clock.now() });
  context.clock.advanceMinutes(2);

  // The link IS the correction mechanism — prove it landed, not just the balances.
  const { results: link } = await database
    .prepare("SELECT reverses_entry_id FROM ledger_entry WHERE id = ?1")
    .bind(reversal.entryId)
    .all<{ reverses_entry_id: string }>();
  assertScenario(
    link[0]?.reverses_entry_id === wrong.entryId,
    "reversal entry is linked to the original via reverses_entry_id",
  );

  const repost = await postEntry(
    database,
    {
      description: "Retainer deposit — Dana Smith (corrected)",
      effectiveDate: context.clock.today(),
      lines: [
        { accountId: trustBank, direction: "debit", amount: money(250000, USD) },
        { accountId: smith, direction: "credit", amount: money(250000, USD) },
      ],
    },
    serviceOptions(context),
  );
  await commitEffectBatch(database, repost.effect, { now: () => context.clock.now() });
  context.clock.advanceMinutes(2);

  assertScenario((await balanceOf(database, webb)) === 0, "Webb's subledger restored to zero");
  assertScenario(
    (await balanceOf(database, smith)) >= 250000,
    "Smith's subledger holds the deposit",
  );
  return { originalEntryId: wrong.entryId, reversalEntryId: reversal.entryId };
}

// The ADR-0009 mechanism, proven: bound Smith's subledger at min 0, attempt an overdraw, and the
// WHOLE batch must be rejected with the ledger untouched.
export async function boundsRejection(
  database: BatchDatabase,
  context: FixtureContext,
  accounts: DemoAccounts,
): Promise<{ rejected: boolean }> {
  const trustBank = accountOf(accounts, "trustBank");
  const smith = accountOf(accounts, "trustSmith");
  await retainerDeposit(database, context, accounts); // fund Smith with 500000 first
  await database.batch([setAccountBoundsStatement(database, smith, 0, null, context.clock.now())]);
  context.clock.advanceMinutes(1); // bounds set; now attempt the overdraw as a distinct step
  const before = await balanceOf(database, smith);

  const overdraw = await postEntry(
    database,
    {
      description: "Disbursement exceeding Dana Smith's trust balance",
      effectiveDate: context.clock.today(),
      lines: [
        { accountId: smith, direction: "debit", amount: money(before + 100000, USD) },
        { accountId: trustBank, direction: "credit", amount: money(before + 100000, USD) },
      ],
    },
    serviceOptions(context),
  );
  let rejected = false;
  try {
    await commitEffectBatch(database, overdraw.effect, { now: () => context.clock.now() });
  } catch {
    rejected = true;
  }
  assertScenario(rejected, "the overdraw batch was rejected by the bounds CHECK");
  assertScenario((await balanceOf(database, smith)) === before, "Smith's balance is untouched");
  return { rejected };
}

// A settlement-style 4-line entry: operating bank receives, fee income + cost recovery credited,
// costs-advanced receivable cleared. Exercises multi-line balance and multi-account deltas.
export async function multiLineSettlement(
  database: BatchDatabase,
  context: FixtureContext,
  accounts: DemoAccounts,
): Promise<{ entryId: LedgerEntryId }> {
  const { entryId, effect } = await postEntry(
    database,
    {
      description: "Settlement received — fees, recovered costs",
      effectiveDate: context.clock.today(),
      lines: [
        {
          accountId: accountOf(accounts, "operatingBank"),
          direction: "debit",
          amount: money(1_000000, USD),
        },
        {
          accountId: accountOf(accounts, "feeIncome"),
          direction: "credit",
          amount: money(850000, USD),
        },
        {
          accountId: accountOf(accounts, "costRecoveryIncome"),
          direction: "credit",
          amount: money(50000, USD),
        },
        {
          accountId: accountOf(accounts, "clientCostsAdvanced"),
          direction: "credit",
          amount: money(100000, USD),
        },
      ],
    },
    serviceOptions(context),
  );
  await commitEffectBatch(database, effect, { now: () => context.clock.now() });
  context.clock.advanceMinutes(5);
  return { entryId };
}
