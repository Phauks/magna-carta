import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { MatterId, ShipmentId, UserId } from "@magna-carta/identifiers/types";
import { domainAuditStatement } from "./audit-statements.ts";
import type { EffectWrite } from "./effect-batch.ts";
import type { SqlDatabase } from "./idempotency-statements.ts";
import {
  insertLabelStatement,
  insertShipmentDraftStatement,
  markShipmentPurchasedStatement,
  markShipmentRefundedStatement,
} from "./shipment-statements.ts";

// Wall-clock and actor arrive from the caller — the service reads no clock and trusts no ambient
// identity. randomSource lets fixtures mint byte-deterministic ids.
export interface ClockPort {
  now(): string;
}

export interface ShipmentServiceOptions {
  readonly clock: ClockPort;
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

function audit(
  database: SqlDatabase,
  options: ShipmentServiceOptions,
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

export interface CreateShipmentDraftInput {
  readonly matterRef: MatterId | null;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly parcel: string;
  readonly options: string;
}

export async function createShipmentDraft(
  database: SqlDatabase,
  input: CreateShipmentDraftInput,
  options: ShipmentServiceOptions,
): Promise<{ shipmentId: ShipmentId; effect: EffectWrite }> {
  const shipmentId = newIdentifier("shipment", options.randomSource);
  const createdAt = options.clock.now();
  return {
    shipmentId,
    effect: {
      statements: [
        insertShipmentDraftStatement(database, {
          id: shipmentId,
          matterRef: input.matterRef,
          fromAddress: input.fromAddress,
          toAddress: input.toAddress,
          parcel: input.parcel,
          options: input.options,
          createdAt,
        }),
        audit(database, options, "shipment.created", shipmentId),
      ],
      outboxMessages: [{ topic: "shipment.created", payload: { shipmentId } }],
    },
  };
}

export interface RecordPurchaseInput {
  readonly shipmentId: ShipmentId;
  readonly remoteShipmentId: string;
  readonly carrier: string;
  readonly service: string;
  readonly trackingCode: string;
  readonly labelFormat: string;
  readonly r2Key: string;
  readonly postageCostMinor: number;
  readonly serviceFeeMinor: number;
  readonly currency: string;
}

export async function recordPurchase(
  database: SqlDatabase,
  input: RecordPurchaseInput,
  options: ShipmentServiceOptions,
): Promise<{ labelId: string; effect: EffectWrite }> {
  const labelId = newIdentifier("shipmentLabel", options.randomSource);
  const updatedAt = options.clock.now();
  return {
    labelId,
    effect: {
      statements: [
        insertLabelStatement(database, {
          id: labelId,
          shipmentRef: input.shipmentId,
          format: input.labelFormat,
          r2Key: input.r2Key,
          trackingCode: input.trackingCode,
          costMinor: input.postageCostMinor,
          currency: input.currency,
          createdAt: updatedAt,
        }),
        markShipmentPurchasedStatement(
          database,
          input.shipmentId,
          {
            remoteShipmentId: input.remoteShipmentId,
            carrier: input.carrier,
            service: input.service,
            trackingCode: input.trackingCode,
            labelRef: labelId,
            postageCostMinor: input.postageCostMinor,
            serviceFeeMinor: input.serviceFeeMinor,
            currency: input.currency,
          },
          updatedAt,
        ),
        audit(database, options, "shipment.purchased", input.shipmentId),
      ],
      // The cost-recovery seam: the Phase-3 financial core consumes this to post a matter disbursement.
      outboxMessages: [
        {
          topic: "shipment.purchased",
          payload: {
            shipmentId: input.shipmentId,
            postageCostMinor: input.postageCostMinor,
            serviceFeeMinor: input.serviceFeeMinor,
            currency: input.currency,
          },
        },
      ],
    },
  };
}

export async function recordRefund(
  database: SqlDatabase,
  shipmentId: ShipmentId,
  options: ShipmentServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const updatedAt = options.clock.now();
  return {
    effect: {
      statements: [
        markShipmentRefundedStatement(database, shipmentId, updatedAt),
        audit(database, options, "shipment.refunded", shipmentId),
      ],
      outboxMessages: [{ topic: "shipment.refunded", payload: { shipmentId } }],
    },
  };
}
