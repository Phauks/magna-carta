import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { LedgerAccountId } from "@magna-carta/identifiers/types";
import { BillingValidationError } from "./billing-validation.ts";
import { ACCOUNT_ROLES, type AccountRole, type BillingServiceOptions } from "./types.ts";

// Where a firm sets the map, named in every refusal so a person reading one knows what to do next.
// A path rather than a prose description: the refusal reaches a member who has to act on it.
const CONFIGURATION_SURFACE = "the firm's billing account-role settings";

export type AccountRoleMap = ReadonlyMap<AccountRole, LedgerAccountId>;

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

// The product chart of accounts does not exist yet, and a fact we do not have is not a fact we
// invent: an unmapped role REFUSES rather than resolving to something plausible. A firm that has not
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

export interface AccountRoleAssignment {
  readonly role: AccountRole;
  readonly ledgerAccountId: LedgerAccountId;
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
