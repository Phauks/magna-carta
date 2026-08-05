import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { TrustHoldId, TrustLedgerNodeId, UserId } from "@magna-carta/identifiers/types";
import { currencyCode, toMinor } from "@magna-carta/money/format";
import type { Money } from "@magna-carta/money/money";
import { assertTrustAccountOpen, loadTrustAccount, loadTrustNode } from "./account-tree.ts";
import type { TrustServiceOptions } from "./account-tree.ts";
import {
  insertTrustHoldStatement,
  selectTrustAvailableBalanceStatement,
  selectTrustHoldStatement,
} from "./statements.ts";
import { TrustValidationError } from "./trust-validation.ts";
import type { TrustAvailableBalance, TrustHoldSnapshot } from "./types.ts";

// Disputed funds. Where a lawyer and another person both claim an interest in trust property, the
// disputed portion is kept separate until the dispute resolves while undisputed portions are
// distributed promptly. The money has NOT moved, so a hold is a restriction on a balance rather than
// a transfer into a separate account — modelling it as a transfer would move money that did not move
// and would make the client ledger tell a story the bank statement contradicts.
//
// A hold is a DOMAIN-level restriction layered above a STRUCTURAL one: available balance is the
// disbursement ceiling, and the account_balance floor at zero still guards underneath it. That
// ordering matters — the structural guarantee never depends on this layer being correct.

interface AvailableRow {
  balance_minor: number;
  held_minor: number;
}

interface HoldRow {
  id: string;
  node_id: string;
  amount_minor: number;
  currency: string;
  releases_hold_id: string | null;
  released_by_hold_id: string | null;
}

export async function readTrustAvailableBalance(
  database: SqlDatabase,
  nodeId: TrustLedgerNodeId,
): Promise<TrustAvailableBalance> {
  const { results } = await selectTrustAvailableBalanceStatement(
    database,
    nodeId,
  ).all<AvailableRow>();
  const row = results[0];
  if (!row) {
    throw new TrustValidationError(
      "unknown-trust-node",
      `no such trust ledger node (or it has no balance row): ${nodeId}`,
    );
  }
  return {
    nodeId,
    balanceMinor: row.balance_minor,
    heldMinor: row.held_minor,
    availableMinor: row.balance_minor - row.held_minor,
  };
}

export async function readTrustHold(
  database: SqlDatabase,
  holdId: TrustHoldId,
): Promise<TrustHoldSnapshot> {
  const { results } = await selectTrustHoldStatement(database, holdId).all<HoldRow>();
  const row = results[0];
  if (!row) {
    throw new TrustValidationError("unknown-hold", `no such trust hold: ${holdId}`);
  }
  return {
    id: row.id as TrustHoldId,
    nodeId: row.node_id as TrustLedgerNodeId,
    amountMinor: row.amount_minor,
    currency: row.currency,
    releasesHoldId: row.releases_hold_id as TrustHoldId | null,
    releasedByHoldId: row.released_by_hold_id as TrustHoldId | null,
  };
}

export interface PlaceTrustHoldInput {
  readonly nodeId: TrustLedgerNodeId;
  readonly amount: Money;
  readonly reason: string;
  readonly placedBy?: UserId | null;
}

export interface PlacedTrustHold {
  readonly holdId: TrustHoldId;
  readonly effect: EffectWrite;
}

export async function placeTrustHold(
  database: SqlDatabase,
  input: PlaceTrustHoldInput,
  options: TrustServiceOptions,
): Promise<PlacedTrustHold> {
  const node = await loadTrustNode(database, input.nodeId);
  const account = await loadTrustAccount(database, node.trustAccountId);
  assertTrustAccountOpen(account);
  const currency = currencyCode(input.amount);
  if (currency !== account.currency) {
    throw new TrustValidationError(
      "hold-currency-mismatch",
      `hold currency ${currency} does not match the trust account's ${account.currency}`,
    );
  }
  const amountMinor = toMinor(input.amount);
  const available = await readTrustAvailableBalance(database, input.nodeId);
  // Holding more than is available would make the available balance negative, which is a state no
  // later disbursement could reason about. Two disputes over the same dollar are two claims to
  // resolve, not two holds to record.
  if (amountMinor > available.availableMinor) {
    throw new TrustValidationError(
      "hold-exceeds-available",
      `a hold of ${amountMinor} exceeds the ${available.availableMinor} available on this ledger`,
    );
  }
  const holdId = newIdentifier("trustHold", options.randomSource);
  return {
    holdId,
    effect: {
      statements: [
        insertTrustHoldStatement(database, {
          id: holdId,
          nodeId: input.nodeId,
          amountMinor,
          currency,
          reason: input.reason,
          placedAt: options.clock.now(),
          placedBy: input.placedBy ?? null,
          releasesHoldId: null,
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface ReleaseTrustHoldInput {
  readonly holdId: TrustHoldId;
  readonly reason: string;
  readonly releasedBy?: UserId | null;
}

// Releasing INSERTS a row naming the hold it lifts, exactly as a ledger correction is a new
// reversing entry. Nothing is edited and nothing is deleted, so the record of what was held, by
// whom, and for how long survives the release — which is the record an examiner asks for. The UNIQUE
// index on releases_hold_id makes a concurrent double release lose at commit rather than at a
// pre-check that both racers passed.
export async function releaseTrustHold(
  database: SqlDatabase,
  input: ReleaseTrustHoldInput,
  options: TrustServiceOptions,
): Promise<PlacedTrustHold> {
  const hold = await readTrustHold(database, input.holdId);
  if (hold.releasesHoldId !== null) {
    throw new TrustValidationError(
      "hold-is-a-release",
      `${input.holdId} is itself a release row and lifts nothing`,
    );
  }
  if (hold.releasedByHoldId !== null) {
    throw new TrustValidationError(
      "hold-already-released",
      `hold ${input.holdId} was already released by ${hold.releasedByHoldId}`,
    );
  }
  const releaseId = newIdentifier("trustHold", options.randomSource);
  return {
    holdId: releaseId,
    effect: {
      statements: [
        // The release repeats the held amount and node so the row is readable on its own — an audit
        // trail that has to join to be understood is an audit trail that gets misread. A PARTIAL
        // release is this release plus a new, smaller hold, composed in the same batch.
        insertTrustHoldStatement(database, {
          id: releaseId,
          nodeId: hold.nodeId,
          amountMinor: hold.amountMinor,
          currency: hold.currency,
          reason: input.reason,
          placedAt: options.clock.now(),
          placedBy: input.releasedBy ?? null,
          releasesHoldId: hold.id,
        }),
      ],
      outboxMessages: [],
    },
  };
}
