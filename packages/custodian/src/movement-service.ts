import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectStatement } from "@magna-carta/data-access/effect-batch";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { selectMemberStatusStatement } from "@magna-carta/data-access/member-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  CustodyItemId,
  CustodyLocationId,
  CustodyMovementId,
  CustodyPacketId,
  ShipmentId,
  UserId,
} from "@magna-carta/identifiers/types";
import { custodyAuditStatement, type CustodyAuditContext } from "./audit.ts";
import { readCustodyIntrinsicValueItemCount } from "./destruction-statements.ts";
import { readActiveCustodyHolds } from "./hold-statements.ts";
import { insertCustodyMovementStatement, readCustodyMovement } from "./movement-statements.ts";
import {
  assertCustodyItemStatusStatement,
  assertCustodyPacketStatusStatement,
  readCustodyItem,
  readCustodyPacket,
  setCustodyItemStatusStatement,
  setCustodyPacketLocationStatement,
  setCustodyPacketStatusStatement,
  type CustodyItemRow,
  type CustodyPacketRow,
} from "./packet-statements.ts";
import {
  CustodyIdempotencyConflictError,
  type CustodyIdempotencyContext,
} from "./packet-service.ts";
import {
  resolveCustodyReleaseCapture,
  type CustodyReleaseAuthorizationInput,
} from "./release-gate.ts";
import { DEFAULT_CUSTODY_RELEASE_POLICY, readCustodyReleasePolicy } from "./settings.ts";
import {
  HOLD_BLOCKED_MOVEMENT_KINDS,
  ITEM_STATUS_BY_MOVEMENT_KIND,
  PACKET_STATUS_BY_MOVEMENT_KIND,
  TERMINAL_PACKET_STATUSES,
  type CustodyBorrowerKind,
  type CustodyMovementKind,
} from "./types.ts";
import { CustodyValidationError } from "./validation.ts";

// THE ONE WRITE PATH FOR EVERY STATE CHANGE. There is no check-out function, no check-in function,
// and no move function: all of them are recordMovement with a different `kind`. That is the design's
// central decision, and it buys four things at once — one place enforces the append-only invariant,
// one place writes the derived status in the same atomic batch as the movement that caused it, one
// place composes the audit row, and a new movement kind is an enum addition rather than a new
// transaction with its own subtly different guards.
//
// D1 has no interactive transaction, so every read-then-write precondition here also rides the WRITE:
// the status update carries the status it expected, and a zero-row result fails the whole batch. A
// concurrent movement that already moved the packet therefore loses cleanly instead of committing a
// ledger row against a state that no longer holds.

export interface RecordCustodyMovementOptions extends CustodyAuditContext {
  readonly idempotency?: CustodyIdempotencyContext;
  readonly randomSource?: RandomSource;
}

export interface CustodyBorrowerInput {
  readonly kind: CustodyBorrowerKind;
  readonly userId?: UserId | null; // 'member'
  readonly entityId?: string | null; // 'entity' — a Directory person or organization
  readonly name?: string | null; // 'external' — a named individual with no Directory record
}

export interface RecordCustodyMovementInput {
  readonly kind: CustodyMovementKind;
  readonly itemId?: CustodyItemId | null;
  // When it happened in the physical world. Back-dating is supported and visible: a Friday collection
  // typed in on Monday is the ordinary case, and the register would be less truthful without it.
  readonly occurredAt?: string;
  readonly toLocationId?: CustodyLocationId | null;
  readonly borrower?: CustodyBorrowerInput | null;
  readonly dueBackOn?: string | null;
  readonly reason?: string | null;
  readonly correctsMovementId?: CustodyMovementId | null;
  readonly shipmentId?: ShipmentId | null;
  readonly note?: string | null;
  // Required on a `released` movement and refused on every other kind — the gate in release-gate.ts.
  readonly releaseAuthorization?: CustodyReleaseAuthorizationInput | null;
}

export interface RecordedCustodyMovement {
  readonly movementId: CustodyMovementId;
  readonly packetStatus: string;
  readonly replayed: boolean;
}

// The body stored on the idempotency record, which the chokepoint replays verbatim to a retrying
// client. Keyed `id` because that is the platform's created-resource wire shape; the domain result
// above renames it to movementId so a caller cannot confuse it with any other handle.
interface StoredMovementResponse {
  readonly id: CustodyMovementId;
  readonly packetStatus: string;
}

// The kinds that need a destination. A `moved` or `returned` movement with no destination would
// leave the register unable to say where the property is, which is its entire job.
const KINDS_REQUIRING_DESTINATION: ReadonlySet<CustodyMovementKind> = new Set([
  "moved",
  "returned",
  "found",
]);

export async function recordCustodyMovement(
  database: BatchDatabase,
  packetId: CustodyPacketId,
  input: RecordCustodyMovementInput,
  options: RecordCustodyMovementOptions,
): Promise<RecordedCustodyMovement> {
  const packet = await loadPacketOrRefuse(database, packetId);
  const item = input.itemId == null ? undefined : await loadItemOrRefuse(database, input.itemId);
  if (item !== undefined && item.packet_id !== packetId) {
    throw new CustodyValidationError(
      "custody-invalid-movement",
      "the item named by this movement belongs to a different packet",
    );
  }

  assertMovementShape(input);
  assertPacketAcceptsMovement(packet, input.kind);
  await assertNoBlockingHold(database, packetId, input.kind);
  await assertNotDestroyingAnIrreplaceableOriginal(database, packetId, input);
  // The release gate. The policy read and the witness's roster lookup cost one query each and are
  // issued only on a release, which is the rarest movement a register records — a check-out, the
  // movement a firm makes daily, reads nothing extra. The gate runs BEFORE the identifier is minted
  // and before the batch is composed, so a refused release writes nothing at all, not even an
  // idempotency record.
  const releaseCapture = resolveCustodyReleaseCapture(
    input.kind,
    input.releaseAuthorization,
    input.kind === "released"
      ? await readCustodyReleasePolicy(database)
      : DEFAULT_CUSTODY_RELEASE_POLICY,
    { named: input.borrower != null },
    {
      actorUserId: options.actorUserId,
      witnessMemberStatus: await readReleaseWitnessMemberStatus(database, input),
    },
  );
  if (input.correctsMovementId != null) {
    const corrected = await readCustodyMovement(database, input.correctsMovementId);
    if (corrected === undefined || corrected.packet_id !== packetId) {
      throw new CustodyValidationError(
        "custody-invalid-movement",
        "a correction must name a movement on the same packet",
      );
    }
  }

  const movementId = newIdentifier("custodyMovement", options.randomSource);
  const nextPacketStatus = PACKET_STATUS_BY_MOVEMENT_KIND[input.kind];
  const nextItemStatus = ITEM_STATUS_BY_MOVEMENT_KIND[input.kind];
  // An item-scoped movement changes the item's state, not the packet's: a single will can be
  // withdrawn and released to its owner while the envelope stays in the safe.
  const packetStatusChanges = item === undefined && nextPacketStatus !== undefined;

  const result = await runIdempotentEffect({
    database,
    key: options.idempotency?.key,
    fingerprint: options.idempotency?.fingerprint ?? "",
    newRecordId: options.idempotency?.newRecordId,
    now: () => options.clock.now(),
    effect: () => {
      const now = options.clock.now();
      const fromLocationId = packet.current_location_id;
      const toLocationId = resolveDestination(packet, input);
      const statements: EffectStatement[] = [
        // First: the precondition fence. Every read-then-write precondition this movement relied on
        // is re-asserted against the row as the batch actually sees it, so a concurrent movement
        // that changed the packet (or the item) under us aborts this whole batch rather than
        // appending a ledger row that contradicts the state it claims to have moved from.
        assertCustodyPacketStatusStatement(database, packetId, packet.status),
        ...(item === undefined
          ? []
          : [assertCustodyItemStatusStatement(database, item.id, item.status)]),
        insertCustodyMovementStatement(database, {
          id: movementId,
          packetId,
          itemId: input.itemId ?? null,
          kind: input.kind,
          occurredAt: input.occurredAt ?? now,
          recordedAt: now,
          recordedByUserId: options.actorUserId,
          fromLocationId,
          toLocationId,
          borrowerKind: input.borrower?.kind ?? null,
          borrowerUserId: input.borrower?.userId ?? null,
          borrowerEntityId: input.borrower?.entityId ?? null,
          borrowerName: input.borrower?.name ?? null,
          dueBackOn: input.dueBackOn ?? null,
          reason: input.reason ?? null,
          correctsMovementId: input.correctsMovementId ?? null,
          shipmentId: input.shipmentId ?? null,
          note: input.note ?? null,
          releaseAuthorityBasis: releaseCapture?.authorityBasis ?? null,
          releaseIdentityEvidence: releaseCapture?.identityEvidence ?? null,
          releaseIdentityVerifiedByUserId: releaseCapture?.identityVerifiedByUserId ?? null,
          releaseWitnessedByUserId: releaseCapture?.witnessedByUserId ?? null,
        }),
      ];
      if (packetStatusChanges && nextPacketStatus !== undefined) {
        statements.push(
          guarded(
            setCustodyPacketStatusStatement(
              database,
              packetId,
              nextPacketStatus,
              packet.status,
              toLocationId,
              now,
            ),
            "custody-packet.status",
          ),
        );
      } else if (item === undefined && toLocationId !== packet.current_location_id) {
        statements.push(
          guarded(
            setCustodyPacketLocationStatement(database, packetId, toLocationId, packet.status, now),
            "custody-packet.location",
          ),
        );
      }
      if (item !== undefined && nextItemStatus !== undefined) {
        statements.push(
          guarded(
            setCustodyItemStatusStatement(database, item.id, nextItemStatus, item.status, now),
            "custody-item.status",
          ),
        );
      }
      statements.push(
        custodyAuditStatement(database, options, "custodyMovement.recorded", movementId, {
          packetId,
          kind: input.kind,
          borrowerKind: input.borrower?.kind ?? null,
          hasShipment: input.shipmentId != null,
        }),
      );
      // The stored body IS the wire body: the chokepoint's idempotency gate replays it verbatim as
      // the HTTP response, so a stored shape that differs from what the handler returns would hand a
      // retrying client a different payload than the original request produced.
      const value: StoredMovementResponse = {
        id: movementId,
        packetStatus: packetStatusChanges ? (nextPacketStatus ?? packet.status) : packet.status,
      };
      return Promise.resolve({
        write: { statements, outboxMessages: [] },
        responseCode: 201,
        responseBody: canonicalJsonStringify(value),
      });
    },
  });

  switch (result.kind) {
    case "executed":
    case "replayed": {
      if (result.responseBody === null) {
        throw new Error("custody movement effect stored no response body");
      }
      const value = JSON.parse(result.responseBody) as StoredMovementResponse;
      return {
        movementId: value.id,
        packetStatus: value.packetStatus,
        replayed: result.kind === "replayed",
      };
    }
    case "in-progress":
      throw new CustodyIdempotencyConflictError("in-progress");
    case "fingerprint-mismatch":
      throw new CustodyIdempotencyConflictError("fingerprint-mismatch");
  }
}

// The witness's row in the firm's own member roster, or null when the roster holds no such member.
// Issued only for a release that names a witness: the roster is what makes the second signatory a
// second PERSON rather than a well-formed string, and there is nothing to check when nobody was
// named. The same fact is re-asserted by a trigger on the insert, so a write path nobody has built
// inherits the check.
async function readReleaseWitnessMemberStatus(
  database: SqlDatabase,
  input: RecordCustodyMovementInput,
): Promise<string | null> {
  const witnessedByUserId = input.releaseAuthorization?.witnessedByUserId ?? null;
  if (input.kind !== "released" || witnessedByUserId === null) return null;
  const { results } = await selectMemberStatusStatement(database, witnessedByUserId).all<{
    status: string;
  }>();
  return results[0]?.status ?? null;
}

// Where the packet ends up. A check-out, release, destruction, or loss takes it out of the tree
// entirely — recording a shelf it is not on would falsify the occupancy count the register reports —
// while a move or return names its destination and everything else leaves it where it was.
function resolveDestination(
  packet: CustodyPacketRow,
  input: RecordCustodyMovementInput,
): CustodyLocationId | null {
  switch (input.kind) {
    case "checked_out":
    case "released":
    case "destroyed":
    case "lost":
      return null;
    case "moved":
    case "returned":
    case "found":
      return input.toLocationId ?? null;
    default:
      return input.toLocationId ?? packet.current_location_id;
  }
}

function assertMovementShape(input: RecordCustodyMovementInput): void {
  if (KINDS_REQUIRING_DESTINATION.has(input.kind) && input.toLocationId == null) {
    throw new CustodyValidationError(
      "custody-invalid-movement",
      `a ${input.kind} movement must name the location the packet ends up in`,
    );
  }
  if (input.kind === "correction" && input.correctsMovementId == null) {
    throw new CustodyValidationError(
      "custody-invalid-movement",
      "a correction must name the movement it corrects — the ledger has no edit path",
    );
  }
  if (input.correctsMovementId != null && input.kind !== "correction") {
    throw new CustodyValidationError(
      "custody-invalid-movement",
      "only a correction may name a corrected movement",
    );
  }
  const borrower = input.borrower;
  if (borrower == null) return;
  const carried =
    (borrower.kind === "member" && borrower.userId != null) ||
    (borrower.kind === "entity" && borrower.entityId != null) ||
    (borrower.kind === "external" && (borrower.name ?? "").trim().length > 0);
  if (!carried) {
    throw new CustodyValidationError(
      "custody-invalid-movement",
      `a ${borrower.kind} borrower must be named — a check-out with no borrower cannot answer the question the register exists to answer`,
    );
  }
}

// A released, destroyed, or lost packet is a closed record. The one thing it still accepts is a
// correction (there is no edit path, so a mis-recorded loss is fixed by a compensating row) and, for
// a loss, a `found` — because property does turn up, and saying so must not require falsifying the
// earlier entry. Everything else is refused rather than silently reopening a closed record.
function assertPacketAcceptsMovement(packet: CustodyPacketRow, kind: CustodyMovementKind): void {
  if (kind === "correction") return;
  if (packet.status === "lost" && kind === "found") return;
  if (TERMINAL_PACKET_STATUSES.includes(packet.status)) {
    throw new CustodyValidationError(
      "custody-packet-closed",
      `this packet is ${packet.status}; record a correction rather than a new ${kind} movement`,
    );
  }
  if (kind === "checked_out" && packet.status === "out") {
    throw new CustodyValidationError(
      "custody-invalid-movement",
      "this packet is already checked out — record its return before checking it out again",
    );
  }
}

// A hold blocks the property leaving the firm's custody or ceasing to exist. It deliberately does
// NOT block a location move: a held original still has to be movable to a fireproof safe.
async function assertNoBlockingHold(
  database: SqlDatabase,
  packetId: CustodyPacketId,
  kind: CustodyMovementKind,
): Promise<void> {
  if (!HOLD_BLOCKED_MOVEMENT_KINDS.includes(kind)) return;
  const holds = await readActiveCustodyHolds(database, packetId);
  if (holds.length === 0) return;
  throw new CustodyValidationError(
    "custody-hold-blocks-action",
    `a ${holds[0]?.kind ?? "custody"} hold is in force on this packet and forbids a ${kind} movement`,
  );
}

// An item recorded as an irreplaceable original is never destroyed through this register, and this is
// the refusal on the movement path rather than only on the destruction workflow — the workflow is not
// the only way to append a `destroyed` movement, and a rule enforced in one caller is a rule with the
// other callers standing open beside it. There is no override parameter here on purpose: the only way
// past is for a person to clear the flag on that specific object, which is a deliberate, audited
// change to a fact rather than a way around a rule. A packet-level destruction is refused when ANY
// item in it carries the flag, because destroying the envelope destroys the will inside it. The
// database carries the same refusal as a trigger, so it holds for a write path nobody has built yet.
async function assertNotDestroyingAnIrreplaceableOriginal(
  database: SqlDatabase,
  packetId: CustodyPacketId,
  input: RecordCustodyMovementInput,
): Promise<void> {
  if (input.kind !== "destroyed") return;
  const flagged = await readCustodyIntrinsicValueItemCount(
    database,
    packetId,
    input.itemId ?? null,
  );
  if (flagged === 0) return;
  throw new CustodyValidationError(
    "custody-intrinsic-value-not-destructible",
    input.itemId == null
      ? "this packet holds an item recorded as an irreplaceable original — an original of intrinsic value is returned to its owner or kept, never destroyed through the register"
      : "this item is recorded as an irreplaceable original — an original of intrinsic value is returned to its owner or kept, never destroyed through the register",
  );
}

async function loadPacketOrRefuse(
  database: SqlDatabase,
  packetId: CustodyPacketId,
): Promise<CustodyPacketRow> {
  const row = await readCustodyPacket(database, packetId);
  if (row === undefined) {
    throw new CustodyValidationError(
      "custody-unknown-packet",
      `no such custody packet: ${packetId}`,
    );
  }
  return row;
}

async function loadItemOrRefuse(
  database: SqlDatabase,
  itemId: CustodyItemId,
): Promise<CustodyItemRow> {
  const row = await readCustodyItem(database, itemId);
  if (row === undefined) {
    throw new CustodyValidationError("custody-unknown-item", `no such custody item: ${itemId}`);
  }
  return row;
}
