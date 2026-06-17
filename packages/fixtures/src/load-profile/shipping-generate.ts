import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { insertTrackingEventStatement } from "@magna-carta/data-access/shipment-statements";
import { createShipmentDraft, recordPurchase } from "@magna-carta/data-access/shipment-service";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { MatterId, ShipmentId } from "@magna-carta/identifiers/types";
import type { FixtureContext } from "../context.ts";
import { assertSeedingAllowed, type SeedingOptions } from "../guard.ts";
import type { ShippingVolume } from "./profile.ts";

// The shipping volume (shipments / labels / tracking) laid over the practice book: draft shipments
// spread across the firm's matters, a fraction taken through to a bought label, and a handful of
// tracking events appended per purchased shipment. Every write rides a REAL data-access write path
// (createShipmentDraft / recordPurchase, plus the tracking-event statement builder the pull-tracking
// route uses) — valid at any scale by construction. All randomness is drawn from the one
// FixtureContext; the module reads no wall-clock and calls no external service. The R2 label blob is
// MODELED (node:sqlite has no R2): the label row's r2_key is the queryable shadow of the stored PDF.

const TRACKING_STATUSES = ["pre_transit", "in_transit", "out_for_delivery", "delivered"] as const;

// Probe identifiers the shipping measurement layer binds real queries to — deterministic for a given
// profile + seed, recorded in the snapshot manifest.
export interface ShippingProbes {
  readonly busiestMatterId: MatterId; // the matter with the most shipments — the hot by-matter list
  readonly multiEventShipmentId: ShipmentId; // a shipment with several tracking events
}

export interface ShippingGenerationResult {
  readonly shipmentCount: number;
  readonly purchasedCount: number;
  readonly trackingEventCount: number;
  readonly probes: ShippingProbes;
}

// Generate the shipping volume on the same FixtureContext the ledger + practice generation used.
export async function generateShippingVolume(
  database: BatchDatabase,
  context: FixtureContext,
  volume: ShippingVolume,
  options: SeedingOptions,
): Promise<ShippingGenerationResult> {
  assertSeedingAllowed(options);
  const { faker, clock, randomSource } = context;
  const serviceOptions = { clock, actorUserId: null, randomSource };
  const commit = (statements: ReturnType<typeof insertTrackingEventStatement>[]) =>
    commitEffectBatch(database, { statements, outboxMessages: [] }, { now: () => clock.now() });

  // Shipments link to the firm's matters (matter_ref FK). Read them deterministically (ORDER BY id).
  const { results } = await database
    .prepare("SELECT id FROM matter ORDER BY id")
    .all<{ id: string }>();
  const matterIds = results.map((row) => row.id as MatterId);
  if (matterIds.length === 0) {
    throw new Error("load-profile: shipping volume needs at least one matter to link shipments to");
  }

  const address = () =>
    JSON.stringify({
      name: faker.person.fullName(),
      street1: faker.location.streetAddress(),
      city: faker.location.city(),
      state: faker.location.state({ abbreviated: true }),
      zip: faker.location.zipCode(),
      country: "US",
    });

  const shipmentsPerMatter = new Map<MatterId, number>();
  let purchasedCount = 0;
  let trackingEventCount = 0;
  let multiEventShipmentId: ShipmentId | null = null;
  let mostEvents = -1;

  for (let index = 0; index < volume.shipmentCount; index += 1) {
    const matterRef = matterIds[faker.number.int({ min: 0, max: matterIds.length - 1 })]!;
    const draft = await createShipmentDraft(
      database,
      {
        matterRef,
        fromAddress: address(),
        toAddress: address(),
        parcel: JSON.stringify({ weightOz: faker.number.int({ min: 1, max: 80 }) }),
        options: "{}",
      },
      serviceOptions,
    );
    await commitEffectBatch(database, draft.effect, { now: () => clock.now() });
    shipmentsPerMatter.set(matterRef, (shipmentsPerMatter.get(matterRef) ?? 0) + 1);

    if (faker.number.int({ min: 1, max: 100 }) <= volume.purchasedPercent) {
      const purchase = await recordPurchase(
        database,
        {
          shipmentId: draft.shipmentId,
          remoteShipmentId: `shp_${faker.string.alphanumeric({ length: 12 })}`,
          carrier: "USPS",
          service: "Priority",
          trackingCode: `9400${faker.string.numeric({ length: 11 })}`,
          labelFormat: "application/pdf",
          r2Key: `labels/${draft.shipmentId}.pdf`,
          postageCostMinor: faker.number.int({ min: 400, max: 2_000 }),
          serviceFeeMinor: 0,
          currency: "USD",
        },
        serviceOptions,
      );
      await commitEffectBatch(database, purchase.effect, { now: () => clock.now() });
      purchasedCount += 1;

      const eventTarget = faker.number.int({
        min: volume.trackingEventsPerShipment.min,
        max: volume.trackingEventsPerShipment.max,
      });
      const inserts = [];
      for (let eventIndex = 0; eventIndex < eventTarget; eventIndex += 1) {
        clock.advanceMinutes(1);
        inserts.push(
          insertTrackingEventStatement(database, {
            id: newIdentifier("trackingEvent", randomSource),
            shipmentRef: draft.shipmentId,
            remoteId: `evt_${faker.string.alphanumeric({ length: 10 })}`,
            status: TRACKING_STATUSES[eventIndex % TRACKING_STATUSES.length]!,
            occurredAt: clock.now(),
            location: `${faker.location.city()}, ${faker.location.state({ abbreviated: true })}`,
            message: faker.lorem.sentence(),
            createdAt: clock.now(),
          }),
        );
      }
      if (inserts.length > 0) await commit(inserts);
      trackingEventCount += eventTarget;
      if (eventTarget > mostEvents) {
        mostEvents = eventTarget;
        multiEventShipmentId = draft.shipmentId;
      }
    }
  }

  if (multiEventShipmentId === null) {
    throw new Error("load-profile: shipping volume generated no purchased shipment with tracking");
  }

  // The busiest matter by shipment count — the hot by-matter list target.
  let busiestMatterId = matterIds[0]!;
  let mostShipments = -1;
  for (const [matterId, count] of shipmentsPerMatter) {
    if (count > mostShipments) {
      mostShipments = count;
      busiestMatterId = matterId;
    }
  }

  return {
    shipmentCount: volume.shipmentCount,
    purchasedCount,
    trackingEventCount,
    probes: { busiestMatterId, multiEventShipmentId },
  };
}
