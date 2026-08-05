import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { composeTrustEntry } from "../src/composition-guard.ts";
import { assertTrustFitness } from "../src/fitness.ts";
import { placeTrustHold, readTrustAvailableBalance, releaseTrustHold } from "../src/holds.ts";
import { commit, expectRefusal, options, seedMatterLeaf, trustFixture } from "./support.ts";

const usd = (minor: number) => money(minor, USD);

async function fundedLeaf(depositMinor: number) {
  const fixture = await trustFixture();
  const leaf = await seedMatterLeaf(fixture, "entity_a", "Webb");
  const deposit = await composeTrustEntry(
    fixture.database,
    {
      description: "Settlement funds received",
      effectiveDate: "2026-08-05",
      lines: [
        { accountId: fixture.bankLedgerAccountId, direction: "debit", amount: usd(depositMinor) },
        { accountId: leaf.ledgerAccountId, direction: "credit", amount: usd(depositMinor) },
      ],
    },
    options,
  );
  await commit(fixture.database, deposit.effect);
  return { fixture, leaf };
}

describe("disputed-funds holds", () => {
  it("reduces available without moving money", async () => {
    const { fixture, leaf } = await fundedLeaf(500000);
    const hold = await placeTrustHold(
      fixture.database,
      { nodeId: leaf.nodeId, amount: usd(200000), reason: "Lien asserted by the treating clinic" },
      options,
    );
    await commit(fixture.database, hold.effect);
    const available = await readTrustAvailableBalance(fixture.database, leaf.nodeId);
    // The balance is untouched — the money has not moved. Only what may be paid out has changed.
    expect(available).toMatchObject({
      balanceMinor: 500000,
      heldMinor: 200000,
      availableMinor: 300000,
    });
    await assertTrustFitness(fixture.database);
  });

  it("refuses a hold larger than what is available", async () => {
    const { fixture, leaf } = await fundedLeaf(100000);
    const first = await placeTrustHold(
      fixture.database,
      { nodeId: leaf.nodeId, amount: usd(60000), reason: "First claim" },
      options,
    );
    await commit(fixture.database, first.effect);
    await expect(
      placeTrustHold(
        fixture.database,
        { nodeId: leaf.nodeId, amount: usd(50000), reason: "Second claim over the same money" },
        options,
      ),
    ).rejects.toMatchObject({ code: "hold-exceeds-available" });
  });

  it("releases by appending a linked row, never by editing or deleting", async () => {
    const { fixture, leaf } = await fundedLeaf(400000);
    const hold = await placeTrustHold(
      fixture.database,
      { nodeId: leaf.nodeId, amount: usd(150000), reason: "Disputed fee" },
      options,
    );
    await commit(fixture.database, hold.effect);
    const release = await releaseTrustHold(
      fixture.database,
      { holdId: hold.holdId, reason: "Dispute resolved in the client's favour" },
      options,
    );
    await commit(fixture.database, release.effect);

    const available = await readTrustAvailableBalance(fixture.database, leaf.nodeId);
    expect(available.heldMinor).toBe(0);
    // Both rows survive: the record of what was held and for how long is the record an examiner
    // asks for, and a release that erased it would erase that.
    const { results } = await fixture.database
      .prepare("SELECT COUNT(*) AS rows FROM trust_hold")
      .bind()
      .all<{ rows: number }>();
    expect(results[0]?.rows).toBe(2);
    await assertTrustFitness(fixture.database);
  });

  it("refuses a second release of the same hold, and a release of a release", async () => {
    const { fixture, leaf } = await fundedLeaf(400000);
    const hold = await placeTrustHold(
      fixture.database,
      { nodeId: leaf.nodeId, amount: usd(150000), reason: "Disputed fee" },
      options,
    );
    await commit(fixture.database, hold.effect);
    const release = await releaseTrustHold(
      fixture.database,
      { holdId: hold.holdId, reason: "Resolved" },
      options,
    );
    await commit(fixture.database, release.effect);

    await expect(
      releaseTrustHold(fixture.database, { holdId: hold.holdId, reason: "Again" }, options),
    ).rejects.toMatchObject({ code: "hold-already-released" });
    await expect(
      releaseTrustHold(fixture.database, { holdId: release.holdId, reason: "Nonsense" }, options),
    ).rejects.toMatchObject({ code: "hold-is-a-release" });
  });

  it("the database itself refuses an UPDATE or a DELETE on a hold", async () => {
    const { fixture, leaf } = await fundedLeaf(400000);
    const hold = await placeTrustHold(
      fixture.database,
      { nodeId: leaf.nodeId, amount: usd(150000), reason: "Disputed fee" },
      options,
    );
    await commit(fixture.database, hold.effect);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE trust_hold SET amount_minor = 1 WHERE id = ?1")
          .bind(hold.holdId)
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      expectRefusal(() =>
        fixture.database.prepare("DELETE FROM trust_hold WHERE id = ?1").bind(hold.holdId).run(),
      ),
    ).rejects.toThrow(/append-only/);
  });
});
