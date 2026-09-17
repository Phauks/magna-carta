import {
  commitEffectBatch,
  guarded,
  type BatchDatabase,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  CustodyDestructionRequestId,
  CustodyItemId,
  CustodyMovementId,
  CustodyPacketId,
  UserId,
} from "@magna-carta/identifiers/types";
import { custodyAuditStatement, type CustodyAuditContext } from "./audit.ts";
import {
  approveCustodyDestructionRequestStatement,
  executeCustodyDestructionRequestStatement,
  insertCustodyDestructionRequestStatement,
  readCustodyDestructionRequest,
  readCustodyIntrinsicValueItemCount,
  refuseCustodyDestructionRequestStatement,
  withdrawCustodyDestructionRequestStatement,
  type CustodyDestructionRequestRow,
} from "./destruction-statements.ts";
import { readActiveCustodyHolds } from "./hold-statements.ts";
import { recordCustodyMovement, type RecordCustodyMovementOptions } from "./movement-service.ts";
import { readCustodyItem, readCustodyPacket } from "./packet-statements.ts";
import { TERMINAL_CUSTODY_DESTRUCTION_OUTCOMES } from "./types.ts";
import { CustodyValidationError } from "./validation.ts";

// Destroying a client's original: request, approve or refuse, execute. Four properties of this path
// are load-bearing, and all four are also enforced at the database rather than only here — a rule a
// service alone enforced would be a rule that the next write path to be built quietly does not have.
//
//   TWO PEOPLE.        The approver is not the requester, and an approval that names no requester at
//                      all is refused too. A single person cannot destroy a client's property on
//                      their own say-so, and a workflow whose two halves can be the same person is a
//                      single person with an extra click.
//   A HOLD REFUSES.    Any hold in force on the packet stops both the request and the execution. The
//                      question is asked twice because a hold placed between them is exactly the
//                      event a hold exists for.
//   INTRINSIC VALUE
//   REFUSES OUTRIGHT.  There is NO override parameter, no force flag, and no privileged caller. The
//                      only way an original of intrinsic value becomes destructible is for a person
//                      to clear the flag on that specific object — a deliberate, audited act about a
//                      fact, not a way around a rule.
//   NO TIMER.          Nothing here reads a retention setting, derives a date, or sweeps. Every
//                      request is raised by a person who wrote down why.
//
// Execution appends its `destroyed` movement through the one movement write path, so the destruction
// of a client's property carries a person's name on the same append-only ledger every other event
// does, rather than being a second, quieter way to change a packet's state.

export interface CustodyDestructionServiceOptions extends CustodyAuditContext {
  readonly randomSource?: RandomSource;
}

export interface RequestCustodyDestructionInput {
  // The reason and the authority the requester asserts, in their words. Free text on purpose: what
  // authorizes destroying a client's property is jurisdictional and factual, and a closed list would
  // be this subsystem inventing law.
  readonly basis: string;
  readonly itemId?: CustodyItemId | null;
}

async function loadPacketOrRefuse(database: SqlDatabase, packetId: CustodyPacketId): Promise<void> {
  const packet = await readCustodyPacket(database, packetId);
  if (packet === undefined) {
    throw new CustodyValidationError(
      "custody-unknown-packet",
      `no such custody packet: ${packetId}`,
    );
  }
}

// The refusal, read before anything is written so a refused request writes nothing at all — not a
// row, not an audit entry, not an idempotency record. The database trigger behind it is the guarantee;
// this is the named refusal a person can act on.
async function assertNotIntrinsicValue(
  database: SqlDatabase,
  packetId: CustodyPacketId,
  itemId: CustodyItemId | null,
): Promise<void> {
  const flagged = await readCustodyIntrinsicValueItemCount(database, packetId, itemId);
  if (flagged === 0) return;
  throw new CustodyValidationError(
    "custody-intrinsic-value-not-destructible",
    itemId === null
      ? "this packet holds an item recorded as an irreplaceable original, which is never destructible through this workflow — an original of intrinsic value is returned to its owner or kept"
      : "this item is recorded as an irreplaceable original, which is never destructible through this workflow — an original of intrinsic value is returned to its owner or kept",
  );
}

async function assertNoHold(database: SqlDatabase, packetId: CustodyPacketId): Promise<void> {
  const holds = await readActiveCustodyHolds(database, packetId);
  if (holds.length === 0) return;
  throw new CustodyValidationError(
    "custody-hold-blocks-action",
    `a ${holds[0]?.kind ?? "custody"} hold is in force on this packet and forbids destroying it`,
  );
}

export async function requestCustodyDestruction(
  database: SqlDatabase,
  packetId: CustodyPacketId,
  input: RequestCustodyDestructionInput,
  options: CustodyDestructionServiceOptions,
): Promise<{ destructionRequestId: CustodyDestructionRequestId; effect: EffectWrite }> {
  const basis = input.basis.trim();
  if (basis.length === 0) {
    throw new CustodyValidationError(
      "custody-empty-description",
      "a destruction request records the reason and the authority it is made on — there is no unexplained destruction of a client's property",
    );
  }
  await loadPacketOrRefuse(database, packetId);
  const itemId = input.itemId ?? null;
  if (itemId !== null) {
    const item = await readCustodyItem(database, itemId);
    if (item === undefined) {
      throw new CustodyValidationError("custody-unknown-item", `no such custody item: ${itemId}`);
    }
    if (item.packet_id !== packetId) {
      throw new CustodyValidationError(
        "custody-unknown-item",
        "the item named by this destruction request belongs to a different packet",
      );
    }
  }
  await assertNoHold(database, packetId);
  await assertNotIntrinsicValue(database, packetId, itemId);

  const destructionRequestId = newIdentifier("custodyDestructionRequest", options.randomSource);
  const now = options.clock.now();
  return {
    destructionRequestId,
    effect: {
      statements: [
        insertCustodyDestructionRequestStatement(database, {
          id: destructionRequestId,
          packetId,
          itemId,
          requestedBy: options.actorUserId,
          requestedAt: now,
          basis,
          createdAt: now,
        }),
        custodyAuditStatement(
          database,
          options,
          "custodyDestructionRequest.raised",
          destructionRequestId,
          { packetId, itemScoped: itemId !== null },
        ),
      ],
      outboxMessages: [],
    },
  };
}

async function loadRequestOrRefuse(
  database: SqlDatabase,
  destructionRequestId: CustodyDestructionRequestId,
): Promise<CustodyDestructionRequestRow> {
  const row = await readCustodyDestructionRequest(database, destructionRequestId);
  if (row === undefined) {
    throw new CustodyValidationError(
      "custody-unknown-destruction-request",
      `no such custody destruction request: ${destructionRequestId}`,
    );
  }
  return row;
}

function assertStillOpen(row: CustodyDestructionRequestRow): void {
  if (row.outcome !== null && TERMINAL_CUSTODY_DESTRUCTION_OUTCOMES.includes(row.outcome)) {
    throw new CustodyValidationError(
      "custody-destruction-request-decided",
      `this destruction request was already ${row.outcome}; raise a new one rather than re-deciding it`,
    );
  }
}

export async function approveCustodyDestruction(
  database: SqlDatabase,
  destructionRequestId: CustodyDestructionRequestId,
  options: CustodyDestructionServiceOptions,
): Promise<{ packetId: CustodyPacketId; effect: EffectWrite }> {
  const request = await loadRequestOrRefuse(database, destructionRequestId);
  assertStillOpen(request);
  if (request.outcome === "approved") {
    throw new CustodyValidationError(
      "custody-destruction-request-decided",
      "this destruction request has already been approved",
    );
  }
  const approver = options.actorUserId;
  // Two people, named as such. The database refuses this too — including the case the column check
  // cannot see, where the request records no requester at all and any approver would satisfy it.
  if (approver === null || request.requested_by === null || approver === request.requested_by) {
    throw new CustodyValidationError(
      "custody-approver-must-differ",
      "a destruction request is approved by a different person from the one who raised it",
    );
  }
  await assertNoHold(database, request.packet_id);
  await assertNotIntrinsicValue(database, request.packet_id, request.item_id);

  const now = options.clock.now();
  return {
    packetId: request.packet_id,
    effect: {
      statements: [
        guarded(
          approveCustodyDestructionRequestStatement(database, destructionRequestId, approver, now),
          "custody-destruction.decide",
        ),
        custodyAuditStatement(
          database,
          options,
          "custodyDestructionRequest.approved",
          destructionRequestId,
          { packetId: request.packet_id },
        ),
      ],
      outboxMessages: [],
    },
  };
}

export interface RefuseCustodyDestructionInput {
  readonly reason?: string | null;
}

// Refusal is deliberately open to anyone who can manage the register, including the requester. An
// approval needs two people because it ends a client's property; withdrawing the proposal to end it
// needs nobody's agreement at all.
export async function refuseCustodyDestruction(
  database: SqlDatabase,
  destructionRequestId: CustodyDestructionRequestId,
  input: RefuseCustodyDestructionInput,
  options: CustodyDestructionServiceOptions,
): Promise<{ packetId: CustodyPacketId; effect: EffectWrite }> {
  const request = await loadRequestOrRefuse(database, destructionRequestId);
  assertStillOpen(request);
  const now = options.clock.now();
  const reason = input.reason?.trim();
  return {
    packetId: request.packet_id,
    effect: {
      statements: [
        guarded(
          refuseCustodyDestructionRequestStatement(
            database,
            destructionRequestId,
            options.actorUserId,
            now,
            reason === undefined || reason.length === 0 ? null : reason,
          ),
          "custody-destruction.decide",
        ),
        custodyAuditStatement(
          database,
          options,
          "custodyDestructionRequest.refused",
          destructionRequestId,
          { packetId: request.packet_id },
        ),
      ],
      outboxMessages: [],
    },
  };
}

export async function withdrawCustodyDestruction(
  database: SqlDatabase,
  destructionRequestId: CustodyDestructionRequestId,
  options: CustodyDestructionServiceOptions,
): Promise<{ packetId: CustodyPacketId; effect: EffectWrite }> {
  const request = await loadRequestOrRefuse(database, destructionRequestId);
  assertStillOpen(request);
  const now = options.clock.now();
  return {
    packetId: request.packet_id,
    effect: {
      statements: [
        guarded(
          withdrawCustodyDestructionRequestStatement(database, destructionRequestId, now),
          "custody-destruction.decide",
        ),
        custodyAuditStatement(
          database,
          options,
          "custodyDestructionRequest.withdrawn",
          destructionRequestId,
          { packetId: request.packet_id },
        ),
      ],
      outboxMessages: [],
    },
  };
}

export interface ExecutedCustodyDestruction {
  readonly destructionRequestId: CustodyDestructionRequestId;
  readonly packetId: CustodyPacketId;
  readonly movementId: CustodyMovementId;
  readonly executedBy: UserId | null;
  readonly executedAt: string;
}

export interface ExecuteCustodyDestructionOptions
  extends CustodyDestructionServiceOptions, Pick<RecordCustodyMovementOptions, "idempotency"> {
  // What actually happened to the property — shredded, incinerated, returned to the owner's agent
  // and witnessed. Recorded on the ledger row as the movement's reason.
  readonly method?: string | null;
  readonly occurredAt?: string;
}

// The one place a destruction actually happens, and it happens as a movement. Two commits, in this
// order and not the other: the ledger row first, the request's completion second. If the second fails
// the register still says truthfully that the property was destroyed, by whom, and when, and a
// request left sitting at `approved` is visible and correctable. The reverse order would record a
// completed destruction with no ledger entry behind it — a destruction nobody can prove, which is the
// one failure a custody register cannot recover from.
export async function executeCustodyDestruction(
  database: BatchDatabase,
  destructionRequestId: CustodyDestructionRequestId,
  options: ExecuteCustodyDestructionOptions,
): Promise<ExecutedCustodyDestruction> {
  const request = await loadRequestOrRefuse(database, destructionRequestId);
  // A destruction that has already been recorded reports itself rather than refusing. This is the one
  // terminal outcome that is safe to answer twice: nothing is destroyed a second time (the ledger
  // refuses a movement on a closed packet, and the row is frozen), so the honest answer to "carry this
  // out" on a request already carried out is the record of when it was and who did it. It also makes a
  // retried request — the reason this operation requires an Idempotency-Key — return what the first
  // one returned instead of an error about a state the caller's own earlier call produced.
  if (request.outcome === "executed" && request.executed_movement_id !== null) {
    return {
      destructionRequestId,
      packetId: request.packet_id,
      movementId: request.executed_movement_id,
      executedBy: request.executed_by,
      executedAt: request.executed_at ?? options.clock.now(),
    };
  }
  assertStillOpen(request);
  if (request.outcome !== "approved" || request.approved_by === null) {
    throw new CustodyValidationError(
      "custody-destruction-not-approved",
      "this destruction request has not been approved by a second person yet",
    );
  }
  await assertNoHold(database, request.packet_id);
  await assertNotIntrinsicValue(database, request.packet_id, request.item_id);

  const method = options.method?.trim();
  const recorded = await recordCustodyMovement(
    database,
    request.packet_id,
    {
      kind: "destroyed",
      itemId: request.item_id,
      occurredAt: options.occurredAt,
      reason: method === undefined || method.length === 0 ? null : method,
    },
    {
      clock: options.clock,
      actorUserId: options.actorUserId,
      randomSource: options.randomSource,
      idempotency: options.idempotency,
    },
  );

  const executedAt = options.clock.now();
  const completion: EffectWrite = {
    statements: [
      guarded(
        executeCustodyDestructionRequestStatement(
          database,
          destructionRequestId,
          options.actorUserId,
          executedAt,
          recorded.movementId,
        ),
        "custody-destruction.execute",
      ),
      custodyAuditStatement(
        database,
        options,
        "custodyDestructionRequest.executed",
        destructionRequestId,
        { packetId: request.packet_id },
      ),
    ],
    outboxMessages: [],
  };
  await commitEffectBatch(database, completion, { now: () => executedAt });

  return {
    destructionRequestId,
    packetId: request.packet_id,
    movementId: recorded.movementId,
    executedBy: options.actorUserId,
    executedAt,
  };
}
