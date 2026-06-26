import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { CostEntryId, UserId } from "@magna-carta/identifiers/types";
import { IllegalTransitionError } from "@magna-carta/billing-core/lifecycle-error";
import {
  assertTransition,
  isFrozen,
  type BillableStatus,
} from "@magna-carta/billing-core/lifecycle";
import {
  attachReceiptStatement,
  detachReceiptStatement,
  insertCostEntryStatement,
  selectCostEntryStatement,
  selectMatterEBillingStatement,
  setCostKickBackReasonStatement,
  transitionCostStatusStatement,
  updateDraftCostStatement,
  type CostDraftPatch,
  type CostEntrySource,
  type DisbursementClass,
} from "./cost-entry-statements.ts";
import { CostValidationError } from "./cost-validation.ts";

// Maps the generic billing-core error to the cost-domain error so the HTTP layer sees only
// CostValidationError at the 409 boundary.
function guardedAssertTransition(from: BillableStatus, to: BillableStatus, gateOn: boolean): void {
  try {
    assertTransition(from, to, gateOn);
  } catch (error) {
    if (error instanceof IllegalTransitionError) {
      throw new CostValidationError(
        "illegal-transition",
        `cannot move a cost entry from ${error.from} to ${error.to} (review gate ${error.gateOn ? "on" : "off"})`,
      );
    }
    throw error;
  }
}

// Wall-clock and actor arrive from the caller — the service reads no clock and trusts no ambient
// identity. randomSource lets fixtures mint byte-deterministic ids. Mirrors TimekeepingServiceOptions.
export interface ClockPort {
  now(): string;
}

export interface CostServiceOptions {
  readonly clock: ClockPort;
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

// The full shape handed in at capture time. amountMinor is integer-minor (cents-equivalent);
// the service validates that amountMinor is a positive integer before storing.
export interface CaptureCostInput {
  // An explicit id may be supplied by the caller to derive the entry handle deterministically from
  // an external token (e.g. a grid import row that must collapse to one row on re-submit).
  // When absent the service mints a fresh identifier.
  readonly id?: CostEntryId;
  readonly matterId: string;
  readonly vendorId?: string;
  readonly incurredDate: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly disbursementClass: DisbursementClass;
  readonly billable: boolean;
  readonly utbmsExpenseCodeId?: string;
  readonly description: string;
  readonly source: CostEntrySource;
  readonly recoveryCategory?: string;
  readonly recoveryRef?: string;
}

function audit(
  database: SqlDatabase,
  options: CostServiceOptions,
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

async function isEBillingMatter(database: SqlDatabase, matterId: string): Promise<boolean> {
  const { results } = await selectMatterEBillingStatement(database, matterId).all<{
    e_billing: number;
  }>();
  return (results[0]?.e_billing ?? 0) === 1;
}

// Pre-reads the current status for every lifecycle op: throws not-found if the row is absent so the
// caller gets a human-facing CostValidationError rather than a silent no-op on the downstream UPDATE.
// The phantom-audit guard lives here — this throw precedes any effect composition, so an unknown id
// can never produce an audit row in the returned effect.
async function loadStatus(database: SqlDatabase, id: CostEntryId): Promise<BillableStatus> {
  const { results } = await selectCostEntryStatement(database, id).all<{
    status: BillableStatus;
  }>();
  const status = results[0]?.status;
  if (status === undefined) {
    throw new CostValidationError("not-found", `no such cost entry: ${id}`);
  }
  return status;
}

// The single WIP-store writer for cost entries. The caller has already resolved the amount and
// disbursement class; this composes the insert + audit into one EffectWrite. The route commits
// through the chokepoint (commitEffectBatch).
export async function captureCost(
  database: SqlDatabase,
  input: CaptureCostInput,
  options: CostServiceOptions,
): Promise<{ costEntryId: CostEntryId; effect: EffectWrite }> {
  // amount_minor must be a positive integer; zero or negative means the capture is malformed before
  // it reaches the WIP store. Checked first (sync, no DB read) for fast feedback.
  if (input.amountMinor <= 0 || !Number.isInteger(input.amountMinor)) {
    throw new CostValidationError(
      "non-positive-amount",
      "amount must be a positive whole number of minor units",
    );
  }

  // A human-captured billable cost on an electronic-billing matter must carry a UTBMS expense code:
  // the LEDES exporter rejects an uncoded line, and at a manual or grid capture a person is present to
  // supply the code, so refusing here keeps an uncodeable entry out of the WIP store. A system-recovered
  // cost is exempt from this capture-time check: no human stands at the capture point to choose a code,
  // and dropping the line would silently lose a real fronted disbursement (the postage or fee the firm
  // has already paid). Such a cost is captured as uncoded draft WIP; the e-billing UTBMS requirement is
  // re-enforced later, at the submit/bill gate, where a person and the billing context exist to code it.
  if (
    input.billable &&
    input.utbmsExpenseCodeId === undefined &&
    input.source !== "recovery" &&
    (await isEBillingMatter(database, input.matterId))
  ) {
    throw new CostValidationError(
      "utbms-required",
      "an electronic-billing matter requires a UTBMS expense code on a billable cost entry",
    );
  }

  const costEntryId = input.id ?? newIdentifier("costEntry", options.randomSource);
  const createdAt = options.clock.now();

  return {
    costEntryId,
    effect: {
      statements: [
        insertCostEntryStatement(database, {
          id: costEntryId,
          matterId: input.matterId,
          vendorId: input.vendorId ?? null,
          incurredDate: input.incurredDate,
          amountMinor: input.amountMinor,
          currency: input.currency,
          disbursementClass: input.disbursementClass,
          billable: input.billable ? 1 : 0,
          utbmsExpenseCodeId: input.utbmsExpenseCodeId ?? null,
          description: input.description,
          receiptFileId: null,
          source: input.source,
          recoveryCategory: input.recoveryCategory ?? null,
          recoveryRef: input.recoveryRef ?? null,
          createdAt,
          createdBy: options.actorUserId,
        }),
        audit(database, options, "cost_entry.captured", costEntryId),
      ],
      outboxMessages: [],
    },
  };
}

// Rewrites the editable draft fields. Refuses a frozen row (billed/void), a non-draft row
// (draft-only), and an empty patch (empty-patch). Returns an EffectWrite for the route to commit.
export async function updateDraftCost(
  database: SqlDatabase,
  id: CostEntryId,
  patch: CostDraftPatch,
  options: CostServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const status = await loadStatus(database, id);
  if (isFrozen(status)) {
    throw new CostValidationError("frozen-entry", `cost entry ${id} is ${status} and frozen`);
  }
  if (status !== "draft") {
    throw new CostValidationError("draft-only", `cost entry ${id} is ${status}, not draft`);
  }
  // An all-undefined patch would produce an invalid UPDATE fragment in the statement layer — refuse
  // early so the caller gets a clear error rather than a silent no-op or SQL syntax error.
  if (Object.values(patch).every((v) => v === undefined)) {
    throw new CostValidationError("empty-patch", "cost patch contains no fields to update");
  }
  const updatedAt = options.clock.now();
  return {
    effect: {
      statements: [
        updateDraftCostStatement(database, id, patch, updatedAt),
        audit(database, options, "cost_entry.updated", id),
      ],
      outboxMessages: [],
    },
  };
}

// On resubmit the submitter has addressed the reviewer's note, so the kick-back reason is cleared.
export async function submitCost(
  database: SqlDatabase,
  id: CostEntryId,
  gateOn: boolean,
  options: CostServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const from = await loadStatus(database, id);
  if (isFrozen(from)) {
    throw new CostValidationError("frozen-entry", `cost entry ${id} is ${from} and frozen`);
  }
  guardedAssertTransition(from, "submitted", gateOn);
  const updatedAt = options.clock.now();
  return {
    effect: {
      statements: [
        transitionCostStatusStatement(database, id, from, "submitted", updatedAt),
        setCostKickBackReasonStatement(database, id, null, updatedAt),
        audit(database, options, "cost_entry.submitted", id),
      ],
      outboxMessages: [],
    },
  };
}

export async function approveCost(
  database: SqlDatabase,
  id: CostEntryId,
  gateOn: boolean,
  options: CostServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const from = await loadStatus(database, id);
  if (isFrozen(from)) {
    throw new CostValidationError("frozen-entry", `cost entry ${id} is ${from} and frozen`);
  }
  guardedAssertTransition(from, "approved", gateOn);
  const updatedAt = options.clock.now();
  return {
    effect: {
      statements: [
        transitionCostStatusStatement(database, id, from, "approved", updatedAt),
        audit(database, options, "cost_entry.approved", id),
      ],
      outboxMessages: [],
    },
  };
}

// Kick-back transitions the entry back to draft and stores the reviewer's reason directly on the
// entry row — the audit row records who/when but carries no free-text (audit_log.metadata is kept
// null to honour the platform convention that metadata never carries privileged content).
export async function kickBackCost(
  database: SqlDatabase,
  id: CostEntryId,
  gateOn: boolean,
  options: CostServiceOptions,
  reason: string,
): Promise<{ effect: EffectWrite }> {
  const from = await loadStatus(database, id);
  if (isFrozen(from)) {
    throw new CostValidationError("frozen-entry", `cost entry ${id} is ${from} and frozen`);
  }
  guardedAssertTransition(from, "draft", gateOn);
  const updatedAt = options.clock.now();
  return {
    effect: {
      statements: [
        transitionCostStatusStatement(database, id, from, "draft", updatedAt),
        setCostKickBackReasonStatement(database, id, reason, updatedAt),
        domainAuditStatement(database, {
          event: "cost_entry.kicked_back",
          subjectId: id,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Void is a terminal freeze reachable from any non-frozen state (a mistaken entry is voided, never
// hard-deleted — the row stays for audit). assertTransition permits <any non-frozen> -> void.
export async function voidCost(
  database: SqlDatabase,
  id: CostEntryId,
  gateOn: boolean,
  options: CostServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const from = await loadStatus(database, id);
  if (isFrozen(from)) {
    throw new CostValidationError("frozen-entry", `cost entry ${id} is ${from} and frozen`);
  }
  guardedAssertTransition(from, "void", gateOn);
  const updatedAt = options.clock.now();
  return {
    effect: {
      statements: [
        transitionCostStatusStatement(database, id, from, "void", updatedAt),
        audit(database, options, "cost_entry.voided", id),
      ],
      outboxMessages: [],
    },
  };
}

// Links a receipt file to an unfrozen cost entry. Like the lifecycle methods, the pre-read throws
// not-found before any effect is composed, so an unknown id can never produce a phantom
// receipt-attached audit row; a billed/void row is refused as frozen. The statement's
// NOT IN ('billed','void') guard is the freeze backstop if the row freezes after the pre-read.
export async function attachReceipt(
  database: SqlDatabase,
  id: CostEntryId,
  fileId: string,
  options: CostServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const status = await loadStatus(database, id);
  if (isFrozen(status)) {
    throw new CostValidationError("frozen-entry", `cost entry ${id} is ${status} and frozen`);
  }
  const updatedAt = options.clock.now();
  return {
    effect: {
      statements: [
        attachReceiptStatement(database, id, fileId, updatedAt),
        audit(database, options, "cost_entry.receipt_attached", id),
      ],
      outboxMessages: [],
    },
  };
}

// Clears the receipt link from an unfrozen cost entry. Same pre-read-then-compose discipline and
// freeze backstop as attachReceipt.
export async function detachReceipt(
  database: SqlDatabase,
  id: CostEntryId,
  options: CostServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const status = await loadStatus(database, id);
  if (isFrozen(status)) {
    throw new CostValidationError("frozen-entry", `cost entry ${id} is ${status} and frozen`);
  }
  const updatedAt = options.clock.now();
  return {
    effect: {
      statements: [
        detachReceiptStatement(database, id, updatedAt),
        audit(database, options, "cost_entry.receipt_detached", id),
      ],
      outboxMessages: [],
    },
  };
}
