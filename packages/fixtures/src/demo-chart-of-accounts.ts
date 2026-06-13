import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { LedgerAccountId } from "@magna-carta/identifiers/types";
import { createAccount } from "@magna-carta/ledger/create-account";
import type { AccountType } from "@magna-carta/ledger/types";
import type { FixtureContext } from "./context.ts";

// DEMO DATA ONLY — a tiny small-law-firm chart so scenarios read realistically. This is explicitly
// NOT the Phase-3 product chart-of-accounts template; the product chart gets designed in Phase 3.
// ~14 accounts, stable keys, seeded in declaration order for determinism.
interface DemoAccount {
  readonly key: string;
  readonly name: string;
  readonly type: AccountType;
  readonly parentKey?: string;
}

const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { key: "operatingBank", name: "Operating Bank Account", type: "asset" },
  { key: "trustBank", name: "Trust Bank Account (IOLTA)", type: "asset" },
  { key: "accountsReceivable", name: "Accounts Receivable", type: "asset" },
  { key: "clientCostsAdvanced", name: "Client Costs Advanced", type: "asset" },
  { key: "clientTrustLiability", name: "Client Trust Liability", type: "liability" },
  {
    key: "trustSmith",
    name: "Trust — Dana Smith",
    type: "liability",
    parentKey: "clientTrustLiability",
  },
  {
    key: "trustWebb",
    name: "Trust — Marcus Webb",
    type: "liability",
    parentKey: "clientTrustLiability",
  },
  { key: "ownersEquity", name: "Owner's Equity", type: "equity" },
  { key: "feeIncome", name: "Fee Income", type: "income" },
  { key: "costRecoveryIncome", name: "Cost Recovery Income", type: "income" },
  { key: "rentExpense", name: "Rent Expense", type: "expense" },
  { key: "salariesExpense", name: "Salaries Expense", type: "expense" },
  { key: "officeSuppliesExpense", name: "Office Supplies Expense", type: "expense" },
  { key: "barDuesExpense", name: "Bar Dues Expense", type: "expense" },
];

export const DEMO_ACCOUNT_KEYS: readonly string[] = DEMO_ACCOUNTS.map((account) => account.key);

export async function seedDemoChartOfAccounts(
  database: BatchDatabase,
  context: FixtureContext,
): Promise<Map<string, LedgerAccountId>> {
  const accounts = new Map<string, LedgerAccountId>();
  for (const demo of DEMO_ACCOUNTS) {
    const parentAccountId = demo.parentKey ? accounts.get(demo.parentKey) : undefined;
    if (demo.parentKey && !parentAccountId) {
      throw new Error(`demo chart: parent ${demo.parentKey} must be declared before ${demo.key}`);
    }
    const { accountId, effect } = await createAccount(
      database,
      { name: demo.name, type: demo.type, currency: "USD", parentAccountId },
      { clock: context.clock, randomSource: context.randomSource },
    );
    await commitEffectBatch(database, effect, { now: () => context.clock.now() });
    accounts.set(demo.key, accountId);
  }
  return accounts;
}
