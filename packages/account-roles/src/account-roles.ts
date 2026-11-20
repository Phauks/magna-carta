import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { LedgerAccountId } from "@magna-carta/identifiers/types";
import type { AccountType } from "@magna-carta/ledger/types";

// Which of the firm's ledger accounts plays each role a posting needs. The map is the handle every
// posting path resolves through, so renaming or renumbering an account in the chart never moves a
// posting target. Billing and the operating books both read it; neither owns it, which is why it
// lives in this leaf rather than inside either.
export const ACCOUNT_ROLES = [
  "accounts_receivable",
  "fee_income",
  "client_costs_advanced",
  "cost_recovery_income",
  "tax_payable",
  "fee_adjustments",
  "fee_write_off",
  "operating_bank",
  "client_credit_liability",
  "accounts_payable",
  "owners_equity",
  "undeposited_funds",
  "bank_fees",
] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];

// The account type each role must be mapped to. Mapping fee income to an asset account would invert
// the sign of every future invoice without anything downstream noticing: the entry still balances
// and the batch still commits. The configuration guard reads this table to refuse that up front.
// Fee adjustments and write-offs reduce income, so they are contra-income accounts of type income.
export const ACCOUNT_ROLE_TYPES: Readonly<Record<AccountRole, AccountType>> = {
  accounts_receivable: "asset",
  fee_income: "income",
  client_costs_advanced: "asset",
  cost_recovery_income: "income",
  tax_payable: "liability",
  fee_adjustments: "income",
  fee_write_off: "expense",
  operating_bank: "asset",
  client_credit_liability: "liability",
  accounts_payable: "liability",
  owners_equity: "equity",
  // Money received and not yet taken to the bank: posted on the day received, cleared on the day
  // deposited, the way QuickBooks carries it.
  undeposited_funds: "asset",
  // The fee a processor or bank keeps out of a deposit.
  bank_fees: "expense",
};

export type AccountRoleMap = ReadonlyMap<AccountRole, LedgerAccountId>;

export interface AccountRoleAssignment {
  readonly role: AccountRole;
  readonly ledgerAccountId: LedgerAccountId;
}

export function isAccountRole(value: string): value is AccountRole {
  return (ACCOUNT_ROLES as readonly string[]).includes(value);
}

export async function readAccountRoleMap(database: SqlDatabase): Promise<AccountRoleMap> {
  const { results } = await database
    .prepare(`SELECT role, ledger_account_id FROM firm_account_role`)
    .all<{ role: string; ledger_account_id: string }>();
  const map = new Map<AccountRole, LedgerAccountId>();
  for (const row of results) {
    if (isAccountRole(row.role)) map.set(row.role, row.ledger_account_id as LedgerAccountId);
  }
  return map;
}

// Re-pointing a role changes where FUTURE postings land and never restates one already made: a
// posted entry names its accounts by handle, and the ledger is append-only.
export function setAccountRoleStatement(
  database: SqlDatabase,
  role: AccountRole,
  ledgerAccountId: LedgerAccountId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO firm_account_role (role, ledger_account_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT (role) DO UPDATE SET ledger_account_id = ?2, updated_at = ?3`,
    )
    .bind(role, ledgerAccountId, now);
}
