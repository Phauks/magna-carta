import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { guarded } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { FeeEntryId, UserId } from "@magna-carta/identifiers/types";
import { IllegalTransitionError } from "@magna-carta/billing-core/lifecycle-error";
import {
  assertTransition,
  isFrozen,
  type BillableStatus,
} from "@magna-carta/billing-core/lifecycle";
import {
  deleteDraftFeeStatement,
  insertFeeEntryStatement,
  selectFeeEntryStatement,
  setFeeKickBackReasonStatement,
  transitionFeeStatusStatement,
  updateDraftFeeStatement,
  type FeeDraftPatch,
} from "./fee-entry-statements.ts";
import { FeeValidationError } from "./fee-validation.ts";

/*
 * The recorded fee's only writer.
 *
 * IT RIDES billing-core's LIFECYCLE RATHER THAN RESTATING IT. `assertTransition`, `isFrozen` and
 * `BillableStatus` come from the one module the time and cost stores already use, so "a fee rides
 * the same chain as a time entry and a cost" is a fact the type system holds rather than a sentence
 * three files repeat. A second copy of the transition table would be free to drift the moment one
 * of the three gained a state.
 */

// Maps the generic billing-core error to the fee-domain error so the HTTP layer sees only
// FeeValidationError at the 409 boundary.
function guardedAssertTransition(from: BillableStatus, to: BillableStatus, gateOn: boolean): void {
  try {
    assertTransition(from, to, gateOn);
  } catch (error) {
    if (error instanceof IllegalTransitionError) {
      throw new FeeValidationError(
        "illegal-transition",
        `cannot move a fee entry from ${error.from} to ${error.to} (review gate ${error.gateOn ? "on" : "off"})`,
      );
    }
    throw error;
  }
}

// Wall-clock and actor arrive from the caller — the service reads no clock and trusts no ambient
// identity. randomSource lets fixtures mint byte-deterministic ids.
export interface ClockPort {
  now(): string;
}

export interface FeeServiceOptions {
  readonly clock: ClockPort;
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

// The full shape handed in at capture time. amountMinor is integer-minor (cents-equivalent); the
// service validates that it is a positive integer before storing.
export interface CaptureFeeInput {
  // An explicit id may be supplied so a caller can derive the handle deterministically from an
  // external token. When absent the service mints a fresh identifier.
  readonly id?: FeeEntryId;
  readonly matterId: string;
  readonly serviceDate: string;
  readonly timekeeperUserId?: string;
  readonly description: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly billable: boolean;
  readonly memo?: string;
}

function audit(
  database: SqlDatabase,
  options: FeeServiceOptions,
  event: string,
  subjectId: string,
) {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: options.actorUserId,
    clock: options.clock,
    randomSource: options.randomSource,
  });
}

// Pre-reads the current status for every lifecycle op: throws not-found if the row is absent so the
// caller gets a human-facing FeeValidationError rather than a silent no-op on the downstream
// UPDATE. The phantom-audit guard lives here — this throw precedes any effect composition, so an
// unknown id can never produce an audit row in the returned effect.
async function loadStatus(database: SqlDatabase, id: FeeEntryId): Promise<BillableStatus> {
  const { results } = await selectFeeEntryStatement(database, id).all<{ status: BillableStatus }>();
  const status = results[0]?.status;
  if (status === undefined) {
    throw new FeeValidationError("not-found", `no such fee entry: ${id}`);
  }
  return status;
}

// The single WIP-store writer for fee entries: the insert plus its audit, composed into one
// EffectWrite. The route commits through the chokepoint (commitEffectBatch).
export async function captureFee(
  database: SqlDatabase,
  input: CaptureFeeInput,
  options: FeeServiceOptions,
): Promise<{ feeEntryId: FeeEntryId; effect: EffectWrite }> {
  // A fee is a charge somebody decided on, so zero or negative is a record of nothing — a reduction
  // is a discount line on the bill, which is a different act with a different audit. Checked first
  // (sync, no read) for fast feedback, and again by the table's own CHECK.
  if (input.amountMinor <= 0 || !Number.isInteger(input.amountMinor)) {
    throw new FeeValidationError(
      "non-positive-amount",
      "amount must be a positive whole number of minor units",
    );
  }

  // USD-only WIP store (the fee_entry currency CHECK is `IN ('USD')`). Guarding here turns a
  // non-USD value into a FeeValidationError the caller maps to 422, rather than a raw CHECK
  // violation surfacing as a 500.
  if (input.currency !== "USD") {
    throw new FeeValidationError("unsupported-currency", "currency must be USD");
  }

  const feeEntryId = input.id ?? newIdentifier("feeEntry", options.randomSource);
  const createdAt = options.clock.now();

  return {
    feeEntryId,
    effect: {
      statements: [
        insertFeeEntryStatement(database, {
          id: feeEntryId,
          matterId: input.matterId,
          serviceDate: input.serviceDate,
          timekeeperUserId: input.timekeeperUserId ?? null,
          description: input.description,
          amountMinor: input.amountMinor,
          currency: input.currency,
          billable: input.billable ? 1 : 0,
          memo: input.memo ?? null,
          createdAt,
          createdBy: options.actorUserId,
        }),
        audit(database, options, "fee_entry.captured", feeEntryId),
      ],
      outboxMessages: [],
    },
  };
}

// What a refused guard is called when it comes back from the commit. The route turns each into the
// same refusal the pre-commit read would have produced had it seen the state that actually won, so a
// caller cannot tell a lost race from a plainly illegal request — which is right: both mean the entry
// is not in the state the request assumed.
export const FEE_DRAFT_EDIT_GUARD = "fee-entry.draft-edit";
export const FEE_STATUS_TRANSITION_GUARD = "fee-entry.status-transition";

// Rewrites the editable draft fields. Refuses a frozen row (billed/void), a non-draft row
// (draft-only), and an empty patch (empty-patch).
export async function updateDraftFee(
  database: SqlDatabase,
  id: FeeEntryId,
  patch: FeeDraftPatch,
  options: FeeServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const status = await loadStatus(database, id);
  if (isFrozen(status)) {
    throw new FeeValidationError("frozen-entry", `fee entry ${id} is ${status} and frozen`);
  }
  if (status !== "draft") {
    throw new FeeValidationError("draft-only", `fee entry ${id} is ${status}, not draft`);
  }
  if (patch.currency !== undefined && patch.currency !== "USD") {
    throw new FeeValidationError("unsupported-currency", "currency must be USD");
  }
  if (
    patch.amountMinor !== undefined &&
    (patch.amountMinor <= 0 || !Number.isInteger(patch.amountMinor))
  ) {
    throw new FeeValidationError(
      "non-positive-amount",
      "amount must be a positive whole number of minor units",
    );
  }
  // An all-undefined patch would produce an invalid UPDATE fragment in the statement layer — refuse
  // early so the caller gets a clear error rather than a silent no-op or a SQL syntax error.
  if (Object.values(patch).every((value) => value === undefined)) {
    throw new FeeValidationError("empty-patch", "fee patch contains no fields to update");
  }
  const updatedAt = options.clock.now();
  return {
    effect: {
      statements: [
        // Guarded: the status read above is stale by the time this runs, so a row billed in between
        // matches nothing — and that has to refuse the whole batch, or the audit row below records an
        // edit that never landed and the member is told it did.
        guarded(updateDraftFeeStatement(database, id, patch, updatedAt), FEE_DRAFT_EDIT_GUARD),
        audit(database, options, "fee_entry.updated", id),
      ],
      outboxMessages: [],
    },
  };
}

// On resubmit the submitter has addressed the reviewer's note, so the kick-back reason is cleared.
// That clearing is what makes a non-null reason mean exactly one thing on every read of the row.
export async function submitFee(
  database: SqlDatabase,
  id: FeeEntryId,
  gateOn: boolean,
  options: FeeServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const from = await loadStatus(database, id);
  if (isFrozen(from)) {
    throw new FeeValidationError("frozen-entry", `fee entry ${id} is ${from} and frozen`);
  }
  guardedAssertTransition(from, "submitted", gateOn);
  const updatedAt = options.clock.now();
  return {
    effect: {
      statements: [
        guarded(
          transitionFeeStatusStatement(database, id, from, "submitted", updatedAt),
          FEE_STATUS_TRANSITION_GUARD,
        ),
        setFeeKickBackReasonStatement(database, id, null, updatedAt),
        audit(database, options, "fee_entry.submitted", id),
      ],
      outboxMessages: [],
    },
  };
}

export async function approveFee(
  database: SqlDatabase,
  id: FeeEntryId,
  gateOn: boolean,
  options: FeeServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const from = await loadStatus(database, id);
  if (isFrozen(from)) {
    throw new FeeValidationError("frozen-entry", `fee entry ${id} is ${from} and frozen`);
  }
  guardedAssertTransition(from, "approved", gateOn);
  const updatedAt = options.clock.now();
  return {
    effect: {
      statements: [
        guarded(
          transitionFeeStatusStatement(database, id, from, "approved", updatedAt),
          FEE_STATUS_TRANSITION_GUARD,
        ),
        audit(database, options, "fee_entry.approved", id),
      ],
      outboxMessages: [],
    },
  };
}

// Kick-back transitions the entry back to draft and stores the reviewer's reason directly on the
// entry row — the audit row records who and when but carries no free-text, honouring the platform
// convention that audit_log.metadata never carries privileged content.
export async function kickBackFee(
  database: SqlDatabase,
  id: FeeEntryId,
  gateOn: boolean,
  options: FeeServiceOptions,
  reason: string,
): Promise<{ effect: EffectWrite }> {
  const from = await loadStatus(database, id);
  if (isFrozen(from)) {
    throw new FeeValidationError("frozen-entry", `fee entry ${id} is ${from} and frozen`);
  }
  guardedAssertTransition(from, "draft", gateOn);
  const updatedAt = options.clock.now();
  return {
    effect: {
      statements: [
        guarded(
          transitionFeeStatusStatement(database, id, from, "draft", updatedAt),
          FEE_STATUS_TRANSITION_GUARD,
        ),
        setFeeKickBackReasonStatement(database, id, reason, updatedAt),
        audit(database, options, "fee_entry.kicked_back", id),
      ],
      outboxMessages: [],
    },
  };
}

// Void is legal from any non-frozen state under either gate: withdrawing a charge is always
// available until the charge has been billed. The row stays on the ledger counting toward nothing,
// which is what makes it the record of what was withdrawn rather than an erasure.
export async function voidFee(
  database: SqlDatabase,
  id: FeeEntryId,
  gateOn: boolean,
  options: FeeServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const from = await loadStatus(database, id);
  if (isFrozen(from)) {
    throw new FeeValidationError("frozen-entry", `fee entry ${id} is ${from} and frozen`);
  }
  guardedAssertTransition(from, "void", gateOn);
  const updatedAt = options.clock.now();
  return {
    effect: {
      statements: [
        guarded(
          transitionFeeStatusStatement(database, id, from, "void", updatedAt),
          FEE_STATUS_TRANSITION_GUARD,
        ),
        audit(database, options, "fee_entry.voided", id),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * Removes a draft that never entered review.
 *
 * THE DISTINCTION FROM VOID IS THE WHOLE POINT, and it is the one the cost ledger's own menu has
 * been drawing with a disabled control since it shipped. A fee that has been submitted, approved,
 * billed or voided has a record somebody may be asked to account for, so it is voided and stays on
 * the books as evidence of what was withdrawn. A draft nobody else has seen has no such record, and
 * deleting it outright is the honest act rather than leaving a tombstone for a charge that was
 * never made.
 */
export async function deleteDraftFee(
  database: SqlDatabase,
  id: FeeEntryId,
  options: FeeServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const status = await loadStatus(database, id);
  if (isFrozen(status)) {
    throw new FeeValidationError("frozen-entry", `fee entry ${id} is ${status} and frozen`);
  }
  if (status !== "draft") {
    throw new FeeValidationError("draft-only", `fee entry ${id} is ${status}, not draft`);
  }
  return {
    effect: {
      statements: [
        deleteDraftFeeStatement(database, id),
        audit(database, options, "fee_entry.draft_deleted", id),
      ],
      outboxMessages: [],
    },
  };
}
