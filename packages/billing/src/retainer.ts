import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  MatterId,
  RetainerReplenishmentRequestId,
  TrustAccountId,
  UserId,
} from "@magna-carta/identifiers/types";
import { loadMatterTrustLeaf } from "@magna-carta/trust/account-tree";
import { readTrustAvailableBalance } from "@magna-carta/trust/holds";
import { requireArrangementOfKind } from "./arrangements.ts";
import { BillingValidationError } from "./billing-validation.ts";
import { BILLING_AGGREGATE_KEY } from "./draft.ts";
import type { BillingServiceOptions } from "./types.ts";

// THE EVERGREEN RETAINER. The agreement records the target balance and the replenishment floor —
// business configuration, emphatically not the trust leaf's structural no-negative floor — and this
// module answers two questions about it: where does the matter's trust balance stand against the
// floor, and has the firm asked the client to top it up. The request is a RECORD of the ask (the
// observed balance, the shortfall, who raised it), and that is all it is: it moves no money, writes
// no trust table, and sends nothing. The client's deposit arrives through trust's own deposit path
// exactly as any deposit does, and the earned fee leaves through the one earned-fee application.
//
// This module READS trust — the leaf and its available balance, on trust's own terms (a
// disputed-funds hold reduces what is available here exactly as it reduces what a transfer may
// draw) — and composes no trust statement.

// The topic a raised request emits. Notifications owns the delivery decision; slice 3·7 wires the
// below-floor automation onto this same topic. Nothing here delivers anything.
export const RETAINER_REPLENISHMENT_REQUESTED_TOPIC = "billing.retainer.replenishment_requested";

export interface RetainerStatus {
  readonly matterId: MatterId;
  readonly arrangementId: string;
  readonly targetMinor: number;
  readonly thresholdMinor: number;
  readonly availableMinor: number;
  readonly belowFloor: boolean;
  // What a replenishment to target would ask for. Zero when the balance is at or above the target.
  readonly shortfallMinor: number;
  readonly openRequestId: RetainerReplenishmentRequestId | null;
}

interface OpenRequestRow {
  id: string;
}

async function readOpenRequestId(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<RetainerReplenishmentRequestId | null> {
  const { results } = await database
    .prepare(
      `SELECT id FROM retainer_replenishment_request WHERE matter_id = ?1 AND resolved_at IS NULL`,
    )
    .bind(matterId)
    .all<OpenRequestRow>();
  const row = results[0];
  return row ? (row.id as RetainerReplenishmentRequestId) : null;
}

// Where the matter's trust balance stands against the agreement's floor, on trust's own available
// figure — money under a disputed-funds hold is not money the retainer can count.
export async function readRetainerStatus(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  matterId: MatterId,
): Promise<RetainerStatus> {
  const arrangement = await requireArrangementOfKind(database, matterId, "retainer");
  const leaf = await loadMatterTrustLeaf(database, trustAccountId, matterId);
  const { availableMinor } = await readTrustAvailableBalance(database, leaf.id);
  const targetMinor = arrangement.retainerTargetMinor as number;
  const thresholdMinor = arrangement.retainerThresholdMinor as number;
  return {
    matterId,
    arrangementId: arrangement.id,
    targetMinor,
    thresholdMinor,
    availableMinor,
    belowFloor: availableMinor < thresholdMinor,
    shortfallMinor: Math.max(0, targetMinor - availableMinor),
    openRequestId: await readOpenRequestId(database, matterId),
  };
}

export interface RequestRetainerReplenishmentInput {
  readonly trustAccountId: TrustAccountId;
  readonly matterId: MatterId;
  readonly requestedBy: UserId | null;
}

export interface ComposedReplenishmentRequest {
  readonly requestId: RetainerReplenishmentRequestId;
  readonly observedBalanceMinor: number;
  readonly requestedAmountMinor: number;
  readonly effect: EffectWrite;
}

// Raises the ask, only when the floor is actually crossed and only once at a time. The observed
// balance and the shortfall are stamped on the row as the evidence of why — the live balance stays
// trust's to answer. One OPEN request per matter is the partial unique index's guarantee; the read
// in front of it is the sentence.
export async function requestRetainerReplenishment(
  database: SqlDatabase,
  input: RequestRetainerReplenishmentInput,
  options: BillingServiceOptions,
): Promise<ComposedReplenishmentRequest> {
  const arrangement = await requireArrangementOfKind(database, input.matterId, "retainer");
  const leaf = await loadMatterTrustLeaf(database, input.trustAccountId, input.matterId);
  const { availableMinor } = await readTrustAvailableBalance(database, leaf.id);
  const targetMinor = arrangement.retainerTargetMinor as number;
  const thresholdMinor = arrangement.retainerThresholdMinor as number;
  if (availableMinor >= thresholdMinor) {
    throw new BillingValidationError(
      "retainer-not-below-floor",
      `matter ${input.matterId} holds ${availableMinor} available against a floor of ${thresholdMinor}: the retainer does not need replenishing`,
    );
  }
  const openRequestId = await readOpenRequestId(database, input.matterId);
  if (openRequestId) {
    throw new BillingValidationError(
      "retainer-replenishment-already-open",
      `matter ${input.matterId} already has an open replenishment request (${openRequestId}): resolve it before raising another`,
    );
  }
  // Below the floor, so the shortfall against the target is strictly positive: the floor is at most
  // the target by the arrangement's own bounds.
  const requestedAmountMinor = targetMinor - availableMinor;
  const requestId = newIdentifier("retainerReplenishmentRequest", options.randomSource);
  const now = options.clock.now();
  return {
    requestId,
    observedBalanceMinor: availableMinor,
    requestedAmountMinor,
    effect: {
      statements: [
        database
          .prepare(
            `INSERT INTO retainer_replenishment_request (id, matter_id, arrangement_id, observed_balance_minor, requested_amount_minor, currency, requested_at, requested_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
          )
          .bind(
            requestId,
            input.matterId,
            arrangement.id,
            availableMinor,
            requestedAmountMinor,
            arrangement.currency,
            now,
            input.requestedBy,
          ),
      ],
      outboxMessages: [
        {
          topic: RETAINER_REPLENISHMENT_REQUESTED_TOPIC,
          // Identifiers and non-privileged figures only, as every billing topic carries.
          payload: {
            requestId,
            matterId: input.matterId,
            requestedAmountMinor,
            currency: arrangement.currency,
          },
          aggregateKey: BILLING_AGGREGATE_KEY,
        },
      ],
    },
  };
}

// The one edit a request ever takes: its resolution, when the deposit arrived or the ask was
// withdrawn. The trigger holds the shape; this names it.
export async function resolveRetainerReplenishmentRequest(
  database: SqlDatabase,
  requestId: RetainerReplenishmentRequestId,
  resolvedBy: UserId | null,
  options: BillingServiceOptions,
): Promise<EffectWrite> {
  const { results } = await database
    .prepare(`SELECT id, resolved_at FROM retainer_replenishment_request WHERE id = ?1`)
    .bind(requestId)
    .all<{ id: string; resolved_at: string | null }>();
  const row = results[0];
  if (!row || row.resolved_at !== null) {
    throw new BillingValidationError(
      "retainer-replenishment-not-open",
      `no open replenishment request: ${requestId}`,
    );
  }
  const now = options.clock.now();
  return {
    statements: [
      database
        .prepare(
          `UPDATE retainer_replenishment_request SET resolved_at = ?2, resolved_by = ?3 WHERE id = ?1 AND resolved_at IS NULL`,
        )
        .bind(requestId, now, resolvedBy),
    ],
    outboxMessages: [],
  };
}
