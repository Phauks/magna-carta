import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId, TrustAccountId, TrustLedgerNodeId } from "@magna-carta/identifiers/types";
import type {
  ClosePrecondition,
  ClosePreconditionContext,
  ClosePreconditionFailure,
} from "@magna-carta/matters/close-preconditions";
import { format, fromMinor } from "@magna-carta/money/format";
import { currencyFromCode } from "@magna-carta/money/money";
import {
  refuseMatterCloseWithTrustBalanceStatement,
  selectMatterTrustPositionsStatement,
} from "./statements.ts";

// The matter-close gate. A matter whose client trust ledger still holds money does not close: a
// closed matter with somebody else's money in it is how funds become unclaimed, and the firm that
// closed it is the one that has to answer for them. So this is a hard block and it carries no
// override — a person told no is instead told exactly what is there and which movements clear it.
//
// A matter that holds NO trust ledger closes freely. The absence of a trust account under a matter
// is the ordinary case, not a condition to refuse, and this gate never creates one to find out.
//
// The refusal is proven twice, at two layers, for the reason every trust rule is:
//   this module            the named refusal a person can act on, read before the batch is built
//   the guard statement    the same question re-asked INSIDE the close batch, where the answer is
//                          the committed one — the only place a concurrent deposit cannot hide

export const TRUST_BALANCE_BLOCKS_CLOSE = "trust-balance-not-zero";
export const TRUST_HOLD_BLOCKS_CLOSE = "trust-hold-active";

export interface MatterTrustPosition {
  readonly nodeId: TrustLedgerNodeId;
  readonly trustAccountId: TrustAccountId;
  readonly trustAccountName: string;
  readonly currency: string;
  readonly balanceMinor: number;
  readonly heldMinor: number;
  readonly availableMinor: number;
}

interface PositionRow {
  node_id: string;
  trust_account_id: string;
  trust_account_name: string;
  currency: string;
  balance_minor: number;
  held_minor: number;
}

// Every client ledger this matter owns, across every trust account the firm runs. A multi-office
// firm can hold one matter's funds in more than one account, so this is a list rather than a single
// balance, and the refusal names each one separately — a person told a total would still have to
// find out where it sits.
export async function readMatterTrustPositions(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<MatterTrustPosition[]> {
  // `.all()` + `results[0]`, never `.first()` — the node-sqlite test adapter has no `.first()`.
  const { results } = await selectMatterTrustPositionsStatement(
    database,
    matterId,
  ).all<PositionRow>();
  return results.map((row) => ({
    nodeId: row.node_id as TrustLedgerNodeId,
    trustAccountId: row.trust_account_id as TrustAccountId,
    trustAccountName: row.trust_account_name,
    currency: row.currency,
    balanceMinor: row.balance_minor,
    heldMinor: row.held_minor,
    availableMinor: row.balance_minor - row.held_minor,
  }));
}

function display(amountMinor: number, currency: string): string {
  return format(fromMinor(amountMinor, currencyFromCode(currency)));
}

// The two movements that legitimately empty a client ledger, named in the refusal itself. A refusal
// that reports a state without naming its exits leaves the reader to guess which of the operations
// on the screen is the lawful one, and in trust the unlawful guesses are the expensive ones.
const WAYS_OUT =
  "disburse the remaining funds to the client, or transfer earned fees to the operating account";

function describe(position: MatterTrustPosition): ClosePreconditionFailure {
  const where = `the ${position.trustAccountName} trust ledger`;
  if (position.balanceMinor !== 0) {
    const held =
      position.heldMinor > 0
        ? `, of which ${display(position.heldMinor, position.currency)} is under an active disputed-funds hold`
        : "";
    return {
      code: TRUST_BALANCE_BLOCKS_CLOSE,
      message: `this matter still holds ${display(position.balanceMinor, position.currency)} on ${where}${held}. A client ledger has to reach zero before its matter closes: ${WAYS_OUT}.`,
    };
  }
  // A hold on an empty ledger means a dispute outlived the money it was placed against. The balance
  // is clear, so no movement empties it — the hold is what has to be released.
  return {
    code: TRUST_HOLD_BLOCKS_CLOSE,
    message: `this matter carries ${display(position.heldMinor, position.currency)} under an active disputed-funds hold on ${where}, on a ledger that is otherwise empty. Release the hold before closing the matter.`,
  };
}

async function check(
  context: ClosePreconditionContext,
): Promise<readonly ClosePreconditionFailure[]> {
  const positions = await readMatterTrustPositions(context.database, context.matterId);
  return positions
    .filter((position) => position.balanceMinor !== 0 || position.heldMinor > 0)
    .map(describe);
}

function commitGuard(context: ClosePreconditionContext): readonly SqlStatement[] {
  return [refuseMatterCloseWithTrustBalanceStatement(context.database, context.matterId)];
}

// What the composition root registers against the matter shell's close hook. The matter shell knows
// nothing about trust and must not: it runs whatever rules it is handed, and this is the first of
// them.
export const matterTrustClosePrecondition: ClosePrecondition = { check, commitGuard };
