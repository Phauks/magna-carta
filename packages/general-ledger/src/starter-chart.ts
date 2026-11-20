import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { LedgerAccountId } from "@magna-carta/identifiers/types";
import type { AccountType } from "@magna-carta/ledger/types";
import type { AccountRole } from "@magna-carta/account-roles/account-roles";
import { createChartAccount } from "./chart.ts";
import { GeneralLedgerValidationError } from "./general-ledger-validation.ts";
import type { StatementSection } from "./sections.ts";
import type { GeneralLedgerServiceOptions } from "./types.ts";

// A STARTING POINT, NOT A RULE. A small law-firm chart the firm adopts with one press and then
// renames, renumbers and adds to. The accounts are system accounts (never deactivated or re-typed,
// because the app's own postings may land in them). Bank accounts are not here: each operating
// account is opened with its bank's details, and trust accounts are opened on the Trust screen.
//
// NO ROLE IS MAPPED BY SEEDING. Which account fee income lands in is the firm's decision; the
// suggestion below fills the Accounts the App Uses form, and nothing is set until a person saves it.
interface StarterAccount {
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly section: StatementSection;
  readonly suggestedRole?: AccountRole;
}

export const STARTER_CHART: readonly StarterAccount[] = [
  {
    code: "1100",
    name: "Undeposited Funds",
    type: "asset",
    section: "currentAssets",
    suggestedRole: "undeposited_funds",
  },
  {
    code: "1200",
    name: "Accounts Receivable",
    type: "asset",
    section: "currentAssets",
    suggestedRole: "accounts_receivable",
  },
  {
    code: "1300",
    name: "Client Costs Advanced",
    type: "asset",
    section: "currentAssets",
    suggestedRole: "client_costs_advanced",
  },
  { code: "1500", name: "Furniture and Equipment", type: "asset", section: "fixedAssets" },
  {
    code: "2000",
    name: "Accounts Payable",
    type: "liability",
    section: "currentLiabilities",
    suggestedRole: "accounts_payable",
  },
  {
    code: "2100",
    name: "Sales Tax Payable",
    type: "liability",
    section: "currentLiabilities",
    suggestedRole: "tax_payable",
  },
  {
    code: "2200",
    name: "Client Credits",
    type: "liability",
    section: "currentLiabilities",
    suggestedRole: "client_credit_liability",
  },
  { code: "2300", name: "Payroll Liabilities", type: "liability", section: "currentLiabilities" },
  {
    code: "3000",
    name: "Owner's Equity",
    type: "equity",
    section: "equity",
    suggestedRole: "owners_equity",
  },
  { code: "3100", name: "Owner's Draws", type: "equity", section: "equity" },
  {
    code: "4000",
    name: "Legal Fees",
    type: "income",
    section: "feeIncome",
    suggestedRole: "fee_income",
  },
  {
    code: "4050",
    name: "Fee Adjustments",
    type: "income",
    section: "feeIncome",
    suggestedRole: "fee_adjustments",
  },
  {
    code: "4100",
    name: "Cost Recovery Income",
    type: "income",
    section: "otherIncome",
    suggestedRole: "cost_recovery_income",
  },
  { code: "4200", name: "Interest Income", type: "income", section: "otherIncome" },
  { code: "5000", name: "Client Costs Not Recovered", type: "expense", section: "costOfServices" },
  { code: "6000", name: "Salaries and Wages", type: "expense", section: "operatingExpenses" },
  { code: "6050", name: "Payroll Taxes", type: "expense", section: "operatingExpenses" },
  { code: "6100", name: "Rent", type: "expense", section: "operatingExpenses" },
  { code: "6150", name: "Utilities", type: "expense", section: "operatingExpenses" },
  { code: "6200", name: "Telephone and Internet", type: "expense", section: "operatingExpenses" },
  { code: "6250", name: "Office Supplies", type: "expense", section: "operatingExpenses" },
  { code: "6300", name: "Legal Research", type: "expense", section: "operatingExpenses" },
  {
    code: "6350",
    name: "Software and Subscriptions",
    type: "expense",
    section: "operatingExpenses",
  },
  { code: "6400", name: "Professional Fees", type: "expense", section: "operatingExpenses" },
  { code: "6450", name: "Malpractice Insurance", type: "expense", section: "operatingExpenses" },
  { code: "6500", name: "Other Insurance", type: "expense", section: "operatingExpenses" },
  { code: "6550", name: "Bar Dues and Licenses", type: "expense", section: "operatingExpenses" },
  {
    code: "6600",
    name: "Continuing Legal Education",
    type: "expense",
    section: "operatingExpenses",
  },
  {
    code: "6650",
    name: "Advertising and Marketing",
    type: "expense",
    section: "operatingExpenses",
  },
  { code: "6700", name: "Travel", type: "expense", section: "operatingExpenses" },
  { code: "6750", name: "Meals", type: "expense", section: "operatingExpenses" },
  {
    code: "6800",
    name: "Bank Charges",
    type: "expense",
    section: "operatingExpenses",
    suggestedRole: "bank_fees",
  },
  { code: "6850", name: "Postage and Delivery", type: "expense", section: "operatingExpenses" },
  {
    code: "6900",
    name: "Bad Debt",
    type: "expense",
    section: "otherExpenses",
    suggestedRole: "fee_write_off",
  },
];

// Adopts the starter chart once. A firm that already has any system account has started, and a
// second press would make a second copy of every account; one whose numbers clash with accounts it
// made itself is refused by the number check rather than renumbered behind its back.
export async function adoptStarterChart(
  database: SqlDatabase,
  options: GeneralLedgerServiceOptions,
): Promise<{ effect: EffectWrite; accountIds: ReadonlyMap<string, LedgerAccountId> }> {
  const { results } = await database
    .prepare(`SELECT EXISTS(SELECT 1 FROM ledger_account WHERE system_account = 1) AS started`)
    .all<{ started: number }>();
  if (results[0]?.started === 1) {
    throw new GeneralLedgerValidationError(
      "chart-already-started",
      "the standard chart is already in place",
    );
  }
  const statements: EffectWrite["statements"][number][] = [];
  const accountIds = new Map<string, LedgerAccountId>();
  for (const account of STARTER_CHART) {
    const created = await createChartAccount(
      database,
      {
        name: account.name,
        type: account.type,
        code: account.code,
        statementSection: account.section,
      },
      options,
      true,
    );
    statements.push(...created.effect.statements);
    accountIds.set(account.code, created.accountId);
  }
  return { effect: { statements, outboxMessages: [] }, accountIds };
}

// The account the starter chart suggests for each role, among the accounts that exist now. Only a
// suggestion: the form shows it, and nothing is mapped until the firm saves.
export async function suggestedRoleAccounts(
  database: SqlDatabase,
): Promise<Map<AccountRole, LedgerAccountId>> {
  const suggested = new Map<AccountRole, LedgerAccountId>();
  const { results } = await database
    .prepare(`SELECT id, code FROM ledger_account WHERE system_account = 1 AND code IS NOT NULL`)
    .all<{ id: string; code: string }>();
  const byCode = new Map(results.map((row) => [row.code, row.id as LedgerAccountId]));
  for (const account of STARTER_CHART) {
    const accountId = byCode.get(account.code);
    if (account.suggestedRole && accountId) suggested.set(account.suggestedRole, accountId);
  }
  return suggested;
}
