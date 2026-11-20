import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { LedgerAccountId } from "@magna-carta/identifiers/types";
import { loadAccountSnapshots } from "@magna-carta/ledger/post-entry";
import {
  ACCOUNT_ROLE_TYPES,
  readAccountRoleMap,
  setAccountRoleStatement,
  type AccountRole,
  type AccountRoleAssignment,
  type AccountRoleMap,
} from "@magna-carta/account-roles/account-roles";
import { GeneralLedgerValidationError } from "./general-ledger-validation.ts";
import { readTrustRegistrations } from "./trust-refusal.ts";
import type { GeneralLedgerServiceOptions } from "./types.ts";

// Which account each posting role lands in, with three guards in front of the map write. Each
// refusal names the role, the account and what to do next.
//
// 1. No trust-registered account. A role is where the firm's own postings land; a trust leaf there
//    would post firm money into client money.
// 2. No parent account. Postings land on leaves only, so a parent here would be refused at the
//    first commit, after a whole invoice had been composed.
// 3. The account's type matches the role. Fee income mapped to an asset account would invert the
//    sign of every future invoice and nothing downstream would notice.
export async function configureAccountRoles(
  database: SqlDatabase,
  assignments: readonly AccountRoleAssignment[],
  options: GeneralLedgerServiceOptions,
): Promise<EffectWrite> {
  const accountIds = [...new Set(assignments.map((assignment) => assignment.ledgerAccountId))];
  const registrations = await readTrustRegistrations(database, accountIds);
  const snapshots =
    accountIds.length === 0 ? new Map() : await loadAccountSnapshots(database, accountIds);
  for (const { role, ledgerAccountId } of assignments) {
    const snapshot = snapshots.get(ledgerAccountId);
    if (!snapshot) {
      throw new GeneralLedgerValidationError("unknown-account", `no such account: ${ledgerAccountId}`);
    }
    if (registrations.has(ledgerAccountId)) {
      throw new GeneralLedgerValidationError(
        "role-account-is-trust-registered",
        `${roleLabel(role)} cannot use a trust account: pick one of the firm's own accounts`,
      );
    }
    if (snapshot.hasChildren) {
      throw new GeneralLedgerValidationError(
        "role-account-is-a-parent",
        `${roleLabel(role)} needs an account with no accounts under it`,
      );
    }
    if (!snapshot.active) {
      throw new GeneralLedgerValidationError(
        "role-account-inactive",
        `${roleLabel(role)} cannot use an inactive account`,
      );
    }
    const expected = ACCOUNT_ROLE_TYPES[role];
    if (snapshot.type !== expected) {
      throw new GeneralLedgerValidationError(
        "role-account-type-mismatch",
        `${roleLabel(role)} needs a${expected === "asset" || expected === "income" || expected === "expense" || expected === "equity" ? "n" : ""} ${expected} account, and this one is ${snapshot.type}`,
      );
    }
  }
  const now = options.clock.now();
  return {
    statements: assignments.map((assignment) =>
      setAccountRoleStatement(database, assignment.role, assignment.ledgerAccountId, now),
    ),
    outboxMessages: [],
  };
}

// The words a person reads for each role, used in refusals. The screen carries its own labels.
export function roleLabel(role: AccountRole): string {
  const labels: Record<AccountRole, string> = {
    accounts_receivable: "Accounts Receivable",
    fee_income: "Fee Income",
    client_costs_advanced: "Client Costs Advanced",
    cost_recovery_income: "Cost Recovery Income",
    tax_payable: "Sales Tax Payable",
    fee_adjustments: "Fee Adjustments",
    fee_write_off: "Bad Debt",
    operating_bank: "Default Operating Account",
    client_credit_liability: "Client Credits",
    accounts_payable: "Accounts Payable",
    owners_equity: "Owner's Equity",
  };
  return labels[role];
}

export function resolveRequiredRole(map: AccountRoleMap, role: AccountRole): LedgerAccountId {
  const accountId = map.get(role);
  if (!accountId) {
    throw new GeneralLedgerValidationError(
      "account-role-unmapped",
      `no account is set for ${roleLabel(role)}: set it under Accounts the App Uses on the Chart of Accounts screen`,
    );
  }
  return accountId;
}

export { readAccountRoleMap };
