import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { LedgerAccountId } from "@magna-carta/identifiers/types";
import { BillingValidationError } from "./billing-validation.ts";
import {
  setAccountRoleStatement,
  type AccountRoleAssignment,
  type AccountRoleMap,
} from "@magna-carta/account-roles/account-roles";
import type { AccountRole, BillingServiceOptions } from "./types.ts";

// Where a firm sets the map, named in every refusal so a person reading one knows what to do next.
// A path rather than a prose description: the refusal reaches a member who has to act on it.
const CONFIGURATION_SURFACE = "the Accounts the App Uses settings on the Chart of Accounts screen";

export {
  isAccountRole,
  readAccountRoleMap,
  setAccountRoleStatement,
  type AccountRoleAssignment,
  type AccountRoleMap,
} from "@magna-carta/account-roles/account-roles";

// A fact we do not have is not a fact we invent: an unmapped role REFUSES rather than resolving to something plausible. A firm that has not
// mapped its chart cannot finalize an invoice, and the refusal says which role is missing and where
// to set it — the same posture the trust jurisdiction resolver takes.
export function resolveAccountRole(map: AccountRoleMap, role: AccountRole): LedgerAccountId {
  const accountId = map.get(role);
  if (!accountId) {
    throw new BillingValidationError(
      "account-role-unmapped",
      `no ledger account is mapped to the ${role} role: set it in ${CONFIGURATION_SURFACE} before finalizing an invoice`,
    );
  }
  return accountId;
}

// Configuration, not a posting: this composes the map writes and nothing else. Re-pointing a role at
// a different account changes where FUTURE postings land and never restates one already made — a
// posted entry names its accounts by handle, and the ledger is append-only.
export function composeAccountRoleConfiguration(
  database: SqlDatabase,
  assignments: readonly AccountRoleAssignment[],
  options: BillingServiceOptions,
): EffectWrite {
  const now = options.clock.now();
  return {
    statements: assignments.map((assignment) =>
      setAccountRoleStatement(database, assignment.role, assignment.ledgerAccountId, now),
    ),
    outboxMessages: [],
  };
}
