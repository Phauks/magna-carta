import { EUR, money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { composeTrustEntry } from "../src/composition-guard.ts";
import { assertTrustFitness } from "../src/fitness.ts";
import { placeTrustHold } from "../src/holds.ts";
import {
  composeTrustToOperatingTransfer,
  refusingEarnedFeePrecondition,
  type EarnedFeePrecondition,
} from "../src/transfer.ts";
import { commit, expectRefusal, options, seedMatterLeaf, trustFixture } from "./support.ts";

const usd = (minor: number) => money(minor, USD);

// A stand-in for whatever evidence the product eventually requires that a fee has been earned. The
// tests that exercise the ceiling supply it explicitly; the default is the refusing port.
const permitting: EarnedFeePrecondition = { assertTransferPermitted: () => Promise.resolve() };

async function fundedLeaf(depositMinor: number) {
  const fixture = await trustFixture();
  const leaf = await seedMatterLeaf(fixture, "entity_a", "Webb");
  const deposit = await composeTrustEntry(
    fixture.database,
    {
      description: "Retainer deposit",
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

const transferInput = (
  fixture: Awaited<ReturnType<typeof trustFixture>>,
  leaf: Awaited<ReturnType<typeof seedMatterLeaf>>,
  amountMinor: number,
) => ({
  fromNodeId: leaf.nodeId,
  amount: usd(amountMinor),
  effectiveDate: "2026-08-05",
  trustDescription: "Earned fees withdrawn from trust",
  operatingDescription: "Earned fees received into operating",
  operatingBankAccountId: fixture.operatingBankAccountId,
  accountsReceivableAccountId: fixture.accountsReceivableAccountId,
});

describe("trust-to-operating transfer", () => {
  it("refuses by default: no earned-fee precondition is wired", async () => {
    const { fixture, leaf } = await fundedLeaf(500000);
    await expect(
      composeTrustToOperatingTransfer(
        fixture.database,
        transferInput(fixture, leaf, 100000),
        options,
      ),
    ).rejects.toMatchObject({ code: "earned-fee-precondition-unavailable" });
    // And the exported default is the same refusal, so a caller cannot opt into a permissive one by
    // accident.
    await expect(
      refusingEarnedFeePrecondition.assertTransferPermitted({
        nodeId: leaf.nodeId,
        matterId: leaf.matterId,
        amountMinor: 1,
        currency: "USD",
      }),
    ).rejects.toMatchObject({ code: "earned-fee-precondition-unavailable" });
  });

  it("posts TWO linked entries and one transfer row, in one batch", async () => {
    const { fixture, leaf } = await fundedLeaf(500000);
    const transfer = await composeTrustToOperatingTransfer(
      fixture.database,
      transferInput(fixture, leaf, 120000),
      { ...options, earnedFeePrecondition: permitting },
    );
    await commit(fixture.database, transfer.effect);
    expect(transfer.trustEntryId).not.toBe(transfer.operatingEntryId);

    const { results } = await fixture.database
      .prepare(
        "SELECT trust_entry_id, operating_entry_id, amount_minor FROM trust_transfer WHERE id = ?1",
      )
      .bind(transfer.transferId)
      .all<{ trust_entry_id: string; operating_entry_id: string; amount_minor: number }>();
    expect(results[0]).toEqual({
      trust_entry_id: transfer.trustEntryId,
      operating_entry_id: transfer.operatingEntryId,
      amount_minor: 120000,
    });

    const balances = await fixture.database
      .prepare("SELECT account_id, balance_minor FROM account_balance WHERE account_id IN (?1, ?2)")
      .bind(leaf.ledgerAccountId, fixture.operatingBankAccountId)
      .all<{ account_id: string; balance_minor: number }>();
    const byAccount = new Map(balances.results.map((row) => [row.account_id, row.balance_minor]));
    expect(byAccount.get(leaf.ledgerAccountId)).toBe(380000);
    expect(byAccount.get(fixture.operatingBankAccountId)).toBe(120000);
    await assertTrustFitness(fixture.database);
  });

  it("is limited by AVAILABLE, not by the positive balance a hold has spoken for", async () => {
    const { fixture, leaf } = await fundedLeaf(500000);
    const hold = await placeTrustHold(
      fixture.database,
      { nodeId: leaf.nodeId, amount: usd(450000), reason: "Disputed portion" },
      options,
    );
    await commit(fixture.database, hold.effect);
    await expect(
      composeTrustToOperatingTransfer(fixture.database, transferInput(fixture, leaf, 100000), {
        ...options,
        earnedFeePrecondition: permitting,
      }),
    ).rejects.toMatchObject({ code: "transfer-exceeds-available" });
    // Under the hold, the undisputed remainder is still transferable.
    const permitted = await composeTrustToOperatingTransfer(
      fixture.database,
      transferInput(fixture, leaf, 50000),
      { ...options, earnedFeePrecondition: permitting },
    );
    await commit(fixture.database, permitted.effect);
    await assertTrustFitness(fixture.database);
  });

  // The guard every sibling composer runs and this one did not. Without it the availability
  // comparison below reads a balance denominated in the ACCOUNT's currency and compares it to this
  // amount's minor units — two different things that happen to typecheck — and the mismatch surfaces
  // only later, from the ledger, naming a line instead of the movement.
  it("refuses an amount in a currency the trust account does not hold", async () => {
    const { fixture, leaf } = await fundedLeaf(500000);
    await expect(
      composeTrustToOperatingTransfer(
        fixture.database,
        {
          ...transferInput(fixture, leaf, 100000),
          amount: money(100000, EUR),
        },
        { ...options, earnedFeePrecondition: permitting },
      ),
    ).rejects.toMatchObject({ code: "movement-currency-mismatch" });
  });

  it("refuses a trust account standing in as the operating side", async () => {
    const { fixture, leaf } = await fundedLeaf(500000);
    await expect(
      composeTrustToOperatingTransfer(
        fixture.database,
        {
          ...transferInput(fixture, leaf, 10000),
          operatingBankAccountId: fixture.bankLedgerAccountId,
        },
        { ...options, earnedFeePrecondition: permitting },
      ),
    ).rejects.toMatchObject({ code: "operating-side-is-trust-account" });
  });

  it("the database itself refuses an UPDATE on a committed transfer", async () => {
    const { fixture, leaf } = await fundedLeaf(500000);
    const transfer = await composeTrustToOperatingTransfer(
      fixture.database,
      transferInput(fixture, leaf, 10000),
      { ...options, earnedFeePrecondition: permitting },
    );
    await commit(fixture.database, transfer.effect);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE trust_transfer SET amount_minor = 1 WHERE id = ?1")
          .bind(transfer.transferId)
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
  });
});
