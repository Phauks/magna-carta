import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { CustodyHoldId, CustodyItemId, CustodyPacketId } from "@magna-carta/identifiers/types";
import { custodyAuditStatement, type CustodyAuditContext } from "./audit.ts";
import {
  insertCustodyHoldStatement,
  readCustodyHold,
  releaseCustodyHoldStatement,
} from "./hold-statements.ts";
import { insertCustodyMovementStatement } from "./movement-statements.ts";
import { readCustodyPacket } from "./packet-statements.ts";
import type { CustodyHoldKind } from "./types.ts";
import { CustodyValidationError } from "./validation.ts";

// Holds are the concrete blocker the deleted-file lifecycle's "blocked by a Custodian hold" arm was
// written against. Placing and releasing each append a movement in the same batch, so the ledger
// stays the complete story of the packet rather than a story with the holds missing from it.
//
// What a hold forbids is the property leaving the firm's custody or ceasing to exist — release and
// destruction. It deliberately does not block a location move: a held original still has to be
// movable to a fireproof safe or an offsite site, and a hold that prevented that would make firms
// route around the register.

export interface CustodyHoldServiceOptions extends CustodyAuditContext {
  readonly randomSource?: RandomSource;
}

export interface PlaceCustodyHoldInput {
  readonly kind: CustodyHoldKind;
  readonly itemId?: CustodyItemId | null;
  readonly reason?: string | null;
  readonly occurredAt?: string;
}

export async function placeCustodyHold(
  database: SqlDatabase,
  packetId: CustodyPacketId,
  input: PlaceCustodyHoldInput,
  options: CustodyHoldServiceOptions,
): Promise<{ holdId: CustodyHoldId; effect: EffectWrite }> {
  const packet = await readCustodyPacket(database, packetId);
  if (packet === undefined) {
    throw new CustodyValidationError(
      "custody-unknown-packet",
      `no such custody packet: ${packetId}`,
    );
  }
  const holdId = newIdentifier("custodyHold", options.randomSource);
  const now = options.clock.now();
  return {
    holdId,
    effect: {
      statements: [
        insertCustodyHoldStatement(database, {
          id: holdId,
          packetId,
          itemId: input.itemId ?? null,
          kind: input.kind,
          placedAt: now,
          placedBy: options.actorUserId,
          reason: input.reason ?? null,
          createdAt: now,
        }),
        insertCustodyMovementStatement(database, {
          id: newIdentifier("custodyMovement", options.randomSource),
          packetId,
          itemId: input.itemId ?? null,
          kind: "hold_placed",
          occurredAt: input.occurredAt ?? now,
          recordedAt: now,
          recordedByUserId: options.actorUserId,
          fromLocationId: packet.current_location_id,
          toLocationId: packet.current_location_id,
          borrowerKind: null,
          borrowerUserId: null,
          borrowerEntityId: null,
          borrowerName: null,
          dueBackOn: null,
          reason: input.reason ?? null,
          correctsMovementId: null,
          shipmentId: null,
          note: null,
        }),
        custodyAuditStatement(database, options, "custodyHold.placed", holdId, {
          packetId,
          kind: input.kind,
        }),
      ],
      outboxMessages: [],
    },
  };
}

export async function releaseCustodyHold(
  database: SqlDatabase,
  holdId: CustodyHoldId,
  options: CustodyHoldServiceOptions & { readonly occurredAt?: string },
): Promise<{ packetId: CustodyPacketId; effect: EffectWrite }> {
  const hold = await readCustodyHold(database, holdId);
  if (hold === undefined) {
    throw new CustodyValidationError("custody-unknown-hold", `no such custody hold: ${holdId}`);
  }
  if (hold.released_at !== null) {
    throw new CustodyValidationError(
      "custody-hold-already-released",
      "this hold has already been released",
    );
  }
  const packet = await readCustodyPacket(database, hold.packet_id);
  const now = options.clock.now();
  return {
    packetId: hold.packet_id,
    effect: {
      statements: [
        releaseCustodyHoldStatement(database, holdId, options.actorUserId, now),
        insertCustodyMovementStatement(database, {
          id: newIdentifier("custodyMovement", options.randomSource),
          packetId: hold.packet_id,
          itemId: hold.item_id,
          kind: "hold_released",
          occurredAt: options.occurredAt ?? now,
          recordedAt: now,
          recordedByUserId: options.actorUserId,
          fromLocationId: packet?.current_location_id ?? null,
          toLocationId: packet?.current_location_id ?? null,
          borrowerKind: null,
          borrowerUserId: null,
          borrowerEntityId: null,
          borrowerName: null,
          dueBackOn: null,
          reason: null,
          correctsMovementId: null,
          shipmentId: null,
          note: null,
        }),
        custodyAuditStatement(database, options, "custodyHold.released", holdId, {
          packetId: hold.packet_id,
          kind: hold.kind,
        }),
      ],
      outboxMessages: [],
    },
  };
}
