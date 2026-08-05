import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  CustodyItemId,
  CustodyItemTypeId,
  CustodyPacketId,
} from "@magna-carta/identifiers/types";
import { custodyAuditStatement, type CustodyAuditContext } from "./audit.ts";
import { readCustodyItemType } from "./item-type-statements.ts";
import { insertCustodyMovementStatement } from "./movement-statements.ts";
import {
  insertCustodyItemStatement,
  readCustodyItem,
  readCustodyPacket,
  readNextCustodyItemOrdinal,
  updateCustodyItemFieldsStatement,
  type CustodyItemRow,
} from "./packet-statements.ts";
import { assertReviewIntervalMonths, CustodyValidationError } from "./validation.ts";

// Items are the unit of description. Adding one is a real custody event — the firm now asserts what
// is inside the envelope — so it appends an `itemized` movement alongside the row. A packet may hold
// zero items: a newly logged packet whose contents have not been itemized yet is a state every firm
// passes through, and refusing it would mean the register loses to a sticky note.

export interface CustodyItemServiceOptions extends CustodyAuditContext {
  readonly randomSource?: RandomSource;
}

// A declared value is money, so it arrives as minor units plus a currency and is stored that way —
// never a float, and never a bare number whose scale a reader has to guess.
export interface CustodyDeclaredValue {
  readonly amountMinor: number;
  readonly currency: string;
}

export interface AddCustodyItemInput {
  readonly description: string;
  readonly itemTypeId?: CustodyItemTypeId | null;
  readonly instrumentDate?: string | null;
  // Omitted means "take the type's default". Supplied means a person asserted it about this object,
  // which is the only thing the destruction path should ever act on.
  readonly intrinsicValue?: boolean;
  readonly declaredValue?: CustodyDeclaredValue | null;
  readonly occurredAt?: string; // when the item was actually put in the packet, if not now
}

export async function addCustodyItem(
  database: SqlDatabase,
  packetId: CustodyPacketId,
  input: AddCustodyItemInput,
  options: CustodyItemServiceOptions,
): Promise<{ itemId: CustodyItemId; ordinal: number; effect: EffectWrite }> {
  const description = input.description.trim();
  if (description.length === 0) {
    throw new CustodyValidationError(
      "custody-empty-description",
      "a custody item needs a description",
    );
  }
  const packet = await readCustodyPacket(database, packetId);
  if (packet === undefined) {
    throw new CustodyValidationError(
      "custody-unknown-packet",
      `no such custody packet: ${packetId}`,
    );
  }
  const intrinsicValue = await resolveIntrinsicValue(database, input);
  const ordinal = await readNextCustodyItemOrdinal(database, packetId);
  const itemId = newIdentifier("custodyItem", options.randomSource);
  const now = options.clock.now();
  return {
    itemId,
    ordinal,
    effect: {
      statements: [
        insertCustodyItemStatement(database, {
          id: itemId,
          packetId,
          ordinal,
          itemTypeId: input.itemTypeId ?? null,
          description,
          instrumentDate: input.instrumentDate ?? null,
          intrinsicValue,
          declaredValueAmountMinor: input.declaredValue?.amountMinor ?? null,
          declaredValueCurrency: input.declaredValue?.currency ?? null,
          createdAt: now,
        }),
        insertCustodyMovementStatement(database, {
          id: newIdentifier("custodyMovement", options.randomSource),
          packetId,
          itemId,
          kind: "itemized",
          occurredAt: input.occurredAt ?? now,
          recordedAt: now,
          recordedByUserId: options.actorUserId,
          fromLocationId: null,
          toLocationId: null,
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
        custodyAuditStatement(database, options, "custodyItem.added", itemId, {
          packetId,
          intrinsicValue,
        }),
      ],
      outboxMessages: [],
    },
  };
}

// The type SEEDS the flag; it never fixes it. Deriving intrinsic value from the type at read time
// would make the destruction gate depend on a catalog row a firm can edit, instead of on an
// assertion someone made about the specific object in the safe.
async function resolveIntrinsicValue(
  database: SqlDatabase,
  input: { readonly itemTypeId?: CustodyItemTypeId | null; readonly intrinsicValue?: boolean },
): Promise<boolean> {
  if (input.intrinsicValue !== undefined) return input.intrinsicValue;
  if (input.itemTypeId == null) return false;
  const itemType = await readCustodyItemType(database, input.itemTypeId);
  if (itemType === undefined) {
    throw new CustodyValidationError(
      "custody-unknown-item-type",
      `no such custody item type: ${input.itemTypeId}`,
    );
  }
  return itemType.intrinsic_value_default === 1;
}

export interface UpdateCustodyItemInput {
  readonly description?: string;
  readonly itemTypeId?: CustodyItemTypeId | null;
  readonly instrumentDate?: string | null;
  readonly intrinsicValue?: boolean;
  readonly declaredValue?: CustodyDeclaredValue | null;
  // An item's own review schedule — the passport that expires, the certificate whose registrar
  // changed. Set by the firm; nothing here derives one, and nothing expires when it passes.
  readonly reviewOn?: string | null;
  readonly reviewIntervalMonths?: number | null;
}

// Descriptive fields only — status is derived by the movement write path, and an item never changes
// packet by an edit (re-packeting is a movement, so the register can say when it happened).
export async function updateCustodyItem(
  database: SqlDatabase,
  itemId: CustodyItemId,
  patch: UpdateCustodyItemInput,
  options: CustodyItemServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing: CustodyItemRow | undefined = await readCustodyItem(database, itemId);
  if (existing === undefined) {
    throw new CustodyValidationError("custody-unknown-item", `no such custody item: ${itemId}`);
  }
  const description =
    patch.description === undefined ? existing.description : patch.description.trim();
  if (description.length === 0) {
    throw new CustodyValidationError(
      "custody-empty-description",
      "a custody item needs a description",
    );
  }
  const declaredValue =
    patch.declaredValue === undefined
      ? {
          amountMinor: existing.declared_value_amount_minor,
          currency: existing.declared_value_currency,
        }
      : {
          amountMinor: patch.declaredValue?.amountMinor ?? null,
          currency: patch.declaredValue?.currency ?? null,
        };
  const reviewIntervalMonths =
    patch.reviewIntervalMonths === undefined
      ? existing.review_interval_months
      : patch.reviewIntervalMonths;
  assertReviewIntervalMonths(reviewIntervalMonths);
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        updateCustodyItemFieldsStatement(
          database,
          itemId,
          {
            itemTypeId: patch.itemTypeId === undefined ? existing.item_type_id : patch.itemTypeId,
            description,
            instrumentDate:
              patch.instrumentDate === undefined ? existing.instrument_date : patch.instrumentDate,
            intrinsicValue:
              patch.intrinsicValue === undefined
                ? existing.intrinsic_value === 1
                : patch.intrinsicValue,
            declaredValueAmountMinor: declaredValue.amountMinor,
            declaredValueCurrency: declaredValue.currency,
            reviewOn: patch.reviewOn === undefined ? existing.review_on : patch.reviewOn,
            reviewIntervalMonths,
          },
          now,
        ),
        custodyAuditStatement(database, options, "custodyItem.updated", itemId, {
          packetId: existing.packet_id,
        }),
      ],
      outboxMessages: [],
    },
  };
}
