import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { LedgerAccountId } from "@magna-carta/identifiers/types";
import { MAX_BOUND_PARAMETERS } from "@magna-carta/ledger/statements";
import { loadTrustAccountRoles } from "@magna-carta/trust/composition-guard";
import {
  GeneralLedgerValidationError,
  type GeneralLedgerValidationCode,
} from "./general-ledger-validation.ts";

export type TrustRegistration = "bank" | "liabilityRoot" | "client" | "matter" | "firmFunds";

// Which of these accounts trust has registered, read through TRUST'S OWN resolver, the same read
// its composition guard uses. Nothing here decides for itself whether an account is a trust
// account: a second answer to that question would be the one that let client money through on the
// day the two disagreed. An account missing from the result is outside every trust account.
export async function readTrustRegistrations(
  database: SqlDatabase,
  accountIds: readonly LedgerAccountId[],
): Promise<Map<string, TrustRegistration>> {
  const registered = new Map<string, TrustRegistration>();
  const unique = [...new Set(accountIds)];
  for (let start = 0; start < unique.length; start += MAX_BOUND_PARAMETERS) {
    const roles = await loadTrustAccountRoles(
      database,
      unique.slice(start, start + MAX_BOUND_PARAMETERS),
    );
    for (const [accountId, role] of roles) {
      if (role.kind !== "outside") registered.set(accountId, role.kind);
    }
  }
  return registered;
}

// The operating books never post to an account trust registered. A general journal line, a vendor
// bill line, a role mapping or a bill payment naming one would move client money as if it were the
// firm's, so each is refused by name, pointing at the trust screens where client money moves.
export async function refuseTrustRegisteredAccounts(
  database: SqlDatabase,
  accountIds: readonly LedgerAccountId[],
  code: GeneralLedgerValidationCode,
): Promise<void> {
  const registered = await readTrustRegistrations(database, accountIds);
  const first = [...registered.keys()][0];
  if (first !== undefined) {
    throw new GeneralLedgerValidationError(
      code,
      `account ${first} belongs to a trust account: client money moves only through the trust screens, never through the firm's own books`,
    );
  }
}
