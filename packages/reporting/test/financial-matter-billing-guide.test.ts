import {
  readBillingArrangementInForce,
  setBillingArrangement,
  type SetBillingArrangementInput,
} from "@magna-carta/billing/arrangements";
import type { MatterId } from "@magna-carta/identifiers/types";
import { createRateCard, appendRate } from "@magna-carta/timekeeping/rate-service";
import { describe, expect, it } from "vitest";
import { assembleMattersList } from "../src/operational/matters-list.ts";
import { assembleMatterBillingGuide } from "../src/financial/matter-billing-guide.ts";
import { AUTHORIZER, commit, optionsAt, reportingFixture, seedMatter } from "./support.ts";

// THE MATTER BILLING GUIDE. Every open and held matter of the Matters List appears exactly once; a
// matter with no agreement is listed with none rather than dropped; and every agreement shown is
// billing's own read of the agreement governing the day.

const COMPUTED_AT = "2026-08-05T15:00:00.000Z";
const TODAY = "2026-08-05";

async function book() {
  const fixture = await reportingFixture();
  const at = "2026-02-01T09:00:00.000Z";
  const options = optionsAt(at);
  const alder = await seedMatter(fixture, "Alder", "entity_alder", at);
  const washoe = await seedMatter(fixture, "Washoe", "entity_washoe", at);
  const elko = await seedMatter(fixture, "Elko", "entity_elko", at);
  const storey = await seedMatter(fixture, "Storey", "entity_storey", at);
  const lander = await seedMatter(fixture, "Lander", "entity_alder", at);
  const closed = await seedMatter(fixture, "Closed", "entity_closed", at);
  const enquiry = await seedMatter(fixture, "Enquiry", "entity_elko", at);
  await fixture.database.batch([
    fixture.database
      .prepare(
        "UPDATE matter SET location_id = ?1, opened_at = ?2, matter_number = '0001' WHERE id = ?3",
      )
      .bind(fixture.locationId, at, alder),
    fixture.database
      .prepare("UPDATE matter SET opened_at = ?1, matter_number = '0002' WHERE id = ?2")
      .bind(at, washoe),
    fixture.database
      .prepare(
        "UPDATE matter SET status = 'hold', hold_reason = 'Client travelling', held_at = ?1, opened_at = ?1, matter_number = '0003' WHERE id = ?2",
      )
      .bind(at, elko),
    fixture.database
      .prepare("UPDATE matter SET opened_at = ?1, matter_number = '0004' WHERE id = ?2")
      .bind(at, storey),
    fixture.database
      .prepare("UPDATE matter SET opened_at = ?1, matter_number = '0005' WHERE id = ?2")
      .bind(at, lander),
    fixture.database
      .prepare(
        "UPDATE matter SET status = 'closed', opened_at = ?1, closed_at = ?2, matter_number = '0006' WHERE id = ?3",
      )
      .bind(at, "2026-07-01T09:00:00.000Z", closed),
    fixture.database.prepare("UPDATE matter SET status = 'intake' WHERE id = ?1").bind(enquiry),
  ]);

  const arrange = async (input: Omit<SetBillingArrangementInput, "currency" | "createdBy">) => {
    const composed = await setBillingArrangement(
      fixture.database,
      { ...input, currency: "USD", createdBy: AUTHORIZER },
      options,
    );
    await commit(fixture.database, composed.effect, at);
  };
  // Alder: a flat fee, amended to a contingency that already governs today.
  await arrange({
    matterId: alder,
    kind: "flat_fee",
    flatFeeAmountMinor: 250_000,
    validFrom: "2026-02-01",
  });
  await arrange({
    matterId: alder,
    kind: "contingency",
    contingencyShareE4: 3333,
    contingencyBasis: "net_after_costs",
    validFrom: "2026-06-01",
  });
  // Washoe: hourly, on the record.
  await arrange({ matterId: washoe, kind: "hourly", validFrom: "2026-02-01" });
  // Elko (held): a retainer.
  await arrange({
    matterId: elko,
    kind: "retainer",
    retainerTargetMinor: 500_000,
    retainerThresholdMinor: 100_000,
    advanceDepositDestination: "trust",
    validFrom: "2026-02-01",
  });
  // Storey: hourly today, a flat fee recorded to start next month.
  await arrange({ matterId: storey, kind: "hourly", validFrom: "2026-02-01" });
  await arrange({
    matterId: storey,
    kind: "flat_fee",
    flatFeeAmountMinor: 90_000,
    validFrom: "2026-09-01",
  });
  // Lander: nothing recorded. Closed: an agreement, but the matter is closed and is not listed.
  await arrange({ matterId: closed, kind: "hourly", validFrom: "2026-02-01" });

  // Rates: one on Alder itself, one on Alder's client (which Lander shares), one ended before today,
  // and one on an archived card.
  const timekeeping = { clock: { now: () => at }, actorUserId: AUTHORIZER };
  const card = await createRateCard(fixture.database, { name: "Standard" }, timekeeping);
  await commit(fixture.database, card.effect, at);
  const archived = await createRateCard(fixture.database, { name: "Old card" }, timekeeping);
  await commit(fixture.database, archived.effect, at);
  await fixture.database
    .prepare("UPDATE rate_card SET archived_at = ?1 WHERE id = ?2")
    .bind(at, archived.rateCardId)
    .run();
  const rate = async (
    rateCardId: typeof card.rateCardId,
    tier: "matter" | "client",
    scopedId: string,
    rateE4: number,
    validFrom: string,
  ) => {
    const appended = await appendRate(
      fixture.database,
      { rateCardId, tier, scopedId, rateE4, currency: "USD", validFrom },
      timekeeping,
    );
    await commit(fixture.database, appended.effect, at);
  };
  await rate(card.rateCardId, "matter", alder, 4_500_000, "2026-01-01");
  await rate(card.rateCardId, "client", "entity_alder", 3_000_000, "2026-01-01");
  await rate(card.rateCardId, "matter", washoe, 2_000_000, "2026-01-01");
  await rate(card.rateCardId, "matter", washoe, 2_500_000, "2026-09-01");
  await rate(archived.rateCardId, "matter", elko, 9_900_000, "2026-01-01");

  return { fixture, alder, washoe, elko, storey, lander, closed };
}

describe("the matter billing guide", () => {
  it("lists every open and held matter of the Matters List exactly once", async () => {
    const { fixture, closed } = await book();
    const guide = await assembleMatterBillingGuide(
      fixture.database,
      { locationId: null },
      { computedAt: COMPUTED_AT },
    );
    const list = await assembleMattersList(
      fixture.database,
      { locationId: null },
      { computedAt: COMPUTED_AT },
    );
    const openAndHeld = list.matters
      .filter((matter) => matter.status === "open" || matter.status === "hold")
      .map((matter) => matter.matterId);
    const listed = guide.matters.map((matter) => matter.matterId);
    expect(listed).toEqual(openAndHeld);
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).not.toContain(closed);
    expect(guide.totals.matterCount).toBe(list.totals.openCount + list.totals.heldCount);
    expect(guide.asOfDate).toBe(TODAY);
  });

  it("shows billing's own agreement for each matter, and none where none is recorded", async () => {
    const { fixture, alder, washoe, elko, storey, lander } = await book();
    const guide = await assembleMatterBillingGuide(
      fixture.database,
      { locationId: null },
      { computedAt: COMPUTED_AT },
    );
    for (const row of guide.matters) {
      const inForce = await readBillingArrangementInForce(
        fixture.database,
        row.matterId as MatterId,
      );
      if (inForce === undefined) {
        expect(row.arrangement).toBeNull();
        expect(row.nextArrangement).toBeNull();
      } else if (inForce.validFrom <= TODAY) {
        // The agreement in force has begun: it is the one shown, and nothing follows it.
        expect(row.arrangement).toMatchObject({
          arrangementId: inForce.id,
          version: inForce.version,
          kind: inForce.kind,
          flatFeeAmountMinor: inForce.flatFeeAmountMinor,
          contingencyShareE4: inForce.contingencyShareE4,
          contingencyBasis: inForce.contingencyBasis,
          retainerTargetMinor: inForce.retainerTargetMinor,
          retainerThresholdMinor: inForce.retainerThresholdMinor,
          validFrom: inForce.validFrom,
        });
        expect(row.nextArrangement).toBeNull();
      } else {
        // Recorded to start later: billing's open row is what comes next, not what governs today.
        expect(row.nextArrangement?.arrangementId).toBe(inForce.id);
        expect(row.arrangement?.validTo).toBe(inForce.validFrom);
      }
    }

    const byId = new Map(guide.matters.map((matter) => [matter.matterId, matter]));
    expect(byId.get(alder)?.arrangement).toMatchObject({
      kind: "contingency",
      version: 2,
      contingencyShareE4: 3333,
    });
    expect(byId.get(washoe)?.arrangement?.kind).toBe("hourly");
    expect(byId.get(elko)?.arrangement).toMatchObject({
      kind: "retainer",
      retainerTargetMinor: 500_000,
    });
    expect(byId.get(storey)?.arrangement?.kind).toBe("hourly");
    expect(byId.get(storey)?.nextArrangement).toMatchObject({
      kind: "flat_fee",
      flatFeeAmountMinor: 90_000,
      validFrom: "2026-09-01",
    });
    expect(byId.get(lander)?.arrangement).toBeNull();
    expect(guide.totals).toEqual({
      matterCount: 5,
      hourlyCount: 2,
      flatFeeCount: 0,
      contingencyCount: 1,
      retainerCount: 1,
      noneRecordedCount: 1,
    });
  });

  it("lists the rates recorded against the matter and its client in force today, on cards in use", async () => {
    const { fixture, alder, washoe, elko, lander } = await book();
    const guide = await assembleMatterBillingGuide(
      fixture.database,
      { locationId: null },
      { computedAt: COMPUTED_AT },
    );
    const byId = new Map(guide.matters.map((matter) => [matter.matterId, matter]));
    expect(
      byId.get(alder)?.rates.map((rate) => [rate.tier, rate.rateE4, rate.rateCardName]),
    ).toEqual([
      ["matter", 4_500_000, "Standard"],
      ["client", 3_000_000, "Standard"],
    ]);
    // The rise recorded for September has not begun.
    expect(byId.get(washoe)?.rates.map((rate) => rate.rateE4)).toEqual([2_000_000]);
    // A rate on an archived card is not one capture falls back to.
    expect(byId.get(elko)?.rates).toEqual([]);
    // Lander has no rate of its own, and shares Alder's client.
    expect(byId.get(lander)?.rates.map((rate) => [rate.tier, rate.rateE4])).toEqual([
      ["client", 3_000_000],
    ]);
  });

  it("narrows to one office", async () => {
    const { fixture, alder } = await book();
    const guide = await assembleMatterBillingGuide(
      fixture.database,
      { locationId: fixture.locationId },
      { computedAt: COMPUTED_AT },
    );
    expect(guide.matters.map((matter) => matter.matterId)).toEqual([alder]);
    expect(guide.totals.matterCount).toBe(1);
  });
});
