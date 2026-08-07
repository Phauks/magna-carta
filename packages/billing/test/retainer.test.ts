import { describe, expect, it } from "vitest";
import type { MatterId, TrustAccountId } from "@magna-carta/identifiers/types";
import { setBillingArrangement } from "../src/arrangements.ts";
import {
  readRetainerStatus,
  requestRetainerReplenishment,
  resolveRetainerReplenishmentRequest,
  RETAINER_REPLENISHMENT_REQUESTED_TOPIC,
} from "../src/retainer.ts";
import {
  billingFixture,
  commit,
  depositToMatterTrustLeaf,
  expectRefusal,
  options,
  seedMatter,
  seedTrustAccount,
  type BillingFixture,
} from "./support.ts";

async function seedRetainerMatter(
  fixture: BillingFixture,
  targetMinor = 1_000_000,
  thresholdMinor = 250_000,
): Promise<{ matterId: MatterId; trustAccountId: TrustAccountId }> {
  const matterId = await seedMatter(fixture, "entity_client", "Retainer");
  const set = await setBillingArrangement(
    fixture.database,
    {
      matterId,
      kind: "retainer",
      retainerTargetMinor: targetMinor,
      retainerThresholdMinor: thresholdMinor,
      advanceDepositDestination: "trust",
      currency: "USD",
      validFrom: "2026-08-01",
      createdBy: null,
    },
    options,
  );
  await commit(fixture.database, set.effect);
  const trustAccountId = await seedTrustAccount(fixture);
  return { matterId, trustAccountId };
}

describe("the evergreen retainer", () => {
  it("reads the floor status from trust's own available figure", async () => {
    const fixture = await billingFixture();
    const { matterId, trustAccountId } = await seedRetainerMatter(fixture);
    await depositToMatterTrustLeaf(fixture, trustAccountId, matterId, 600_000);

    const status = await readRetainerStatus(fixture.database, trustAccountId, matterId);
    expect(status).toMatchObject({
      targetMinor: 1_000_000,
      thresholdMinor: 250_000,
      availableMinor: 600_000,
      belowFloor: false,
      shortfallMinor: 400_000,
      openRequestId: null,
    });
  });

  it("raises the ask when the floor is crossed, stamping the observed balance and emitting the topic", async () => {
    const fixture = await billingFixture();
    const { matterId, trustAccountId } = await seedRetainerMatter(fixture);
    await depositToMatterTrustLeaf(fixture, trustAccountId, matterId, 200_000);

    const composed = await requestRetainerReplenishment(
      fixture.database,
      { trustAccountId, matterId, requestedBy: null },
      options,
    );
    expect(composed.observedBalanceMinor).toBe(200_000);
    expect(composed.requestedAmountMinor).toBe(800_000);
    // The notifications seam: the topic rides the same batch; nothing here delivers anything.
    expect(composed.effect.outboxMessages[0]?.topic).toBe(RETAINER_REPLENISHMENT_REQUESTED_TOPIC);
    await commit(fixture.database, composed.effect);

    const status = await readRetainerStatus(fixture.database, trustAccountId, matterId);
    expect(status.openRequestId).toBe(composed.requestId);
  });

  it("refuses when the balance is at or above the floor: the retainer does not need replenishing", async () => {
    const fixture = await billingFixture();
    const { matterId, trustAccountId } = await seedRetainerMatter(fixture);
    await depositToMatterTrustLeaf(fixture, trustAccountId, matterId, 250_000);
    await expect(
      requestRetainerReplenishment(
        fixture.database,
        { trustAccountId, matterId, requestedBy: null },
        options,
      ),
    ).rejects.toMatchObject({ code: "retainer-not-below-floor" });
  });

  it("holds ONE open request per matter — the pre-check names it and the partial unique index guards it", async () => {
    const fixture = await billingFixture();
    const { matterId, trustAccountId } = await seedRetainerMatter(fixture);
    await depositToMatterTrustLeaf(fixture, trustAccountId, matterId, 100_000);

    const first = await requestRetainerReplenishment(
      fixture.database,
      { trustAccountId, matterId, requestedBy: null },
      options,
    );
    // A second, composed before the first commits — the concurrent shape. The pre-check saw no open
    // request, so the index is what refuses.
    const second = await requestRetainerReplenishment(
      fixture.database,
      { trustAccountId, matterId, requestedBy: null },
      options,
    );
    await commit(fixture.database, first.effect);
    await expect(expectRefusal(() => commit(fixture.database, second.effect))).rejects.toThrow();
    // And once committed, the pre-check refuses by name.
    await expect(
      requestRetainerReplenishment(
        fixture.database,
        { trustAccountId, matterId, requestedBy: null },
        options,
      ),
    ).rejects.toMatchObject({ code: "retainer-replenishment-already-open" });
  });

  it("resolves the request once — the record is otherwise frozen by trigger — and a new ask may follow", async () => {
    const fixture = await billingFixture();
    const { matterId, trustAccountId } = await seedRetainerMatter(fixture);
    await depositToMatterTrustLeaf(fixture, trustAccountId, matterId, 100_000);
    const composed = await requestRetainerReplenishment(
      fixture.database,
      { trustAccountId, matterId, requestedBy: null },
      options,
    );
    await commit(fixture.database, composed.effect);

    // The observed figures are the record of why and never move.
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            `UPDATE retainer_replenishment_request SET requested_amount_minor = 1 WHERE id = ?1`,
          )
          .bind(composed.requestId)
          .run(),
      ),
    ).rejects.toThrow(/one edit/);

    const resolved = await resolveRetainerReplenishmentRequest(
      fixture.database,
      composed.requestId,
      null,
      options,
    );
    await commit(fixture.database, resolved);
    await expect(
      resolveRetainerReplenishmentRequest(fixture.database, composed.requestId, null, options),
    ).rejects.toMatchObject({ code: "retainer-replenishment-not-open" });

    // The floor is still crossed, and with the first ask resolved a new one may be raised.
    const again = await requestRetainerReplenishment(
      fixture.database,
      { trustAccountId, matterId, requestedBy: null },
      options,
    );
    await commit(fixture.database, again.effect);
  });

  it("refuses on a matter without a retainer agreement, and on a matter holding no trust ledger", async () => {
    const fixture = await billingFixture();
    const { matterId, trustAccountId } = await seedRetainerMatter(fixture);
    const hourlyMatterId = await seedMatter(fixture, "entity_client", "Hourly");
    await expect(
      readRetainerStatus(fixture.database, trustAccountId, hourlyMatterId),
    ).rejects.toMatchObject({ code: "billing-arrangement-kind-mismatch" });

    // No deposit was ever made, so the retainer matter holds no leaf — trust refuses on its own
    // terms, and billing adds nothing.
    await expect(
      readRetainerStatus(fixture.database, trustAccountId, matterId),
    ).rejects.toMatchObject({ code: "unknown-trust-node" });
  });
});
