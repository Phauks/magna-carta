import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  assertLedgerFitness,
  parentAccountsWithNonZeroBalanceStatement,
} from "@magna-carta/ledger/fitness";
import { insertLineStatement } from "@magna-carta/ledger/statements";
import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { composeTrustEntry } from "../src/composition-guard.ts";
import {
  assertTrustFitness,
  commingledTrustEntriesStatement,
  multiClientTrustEntriesStatement,
  trustHoldsExceedingBalanceStatement,
  trustLeavesWithoutZeroFloorStatement,
  trustRollupNodesWithPostingsStatement,
} from "../src/fitness.ts";
import { placeTrustHold } from "../src/holds.ts";
import { commit, options, seedMatterLeaf, trustFixture } from "./support.ts";

const usd = (minor: number) => money(minor, USD);

// The fitness queries exist to catch what a write-path guard cannot: a read-then-write race, or a
// future caller that finds a door around the composition guard. So each test injects the corruption
// DIRECTLY, past the guard, and asserts the query surfaces it — a fitness query that only ever runs
// against data its own guard produced proves nothing.
async function fundedFixture() {
  const fixture = await trustFixture();
  const leaf = await seedMatterLeaf(fixture, "entity_a", "Webb");
  const deposit = await composeTrustEntry(
    fixture.database,
    {
      description: "Retainer deposit",
      effectiveDate: "2026-08-05",
      lines: [
        { accountId: fixture.bankLedgerAccountId, direction: "debit", amount: usd(300000) },
        { accountId: leaf.ledgerAccountId, direction: "credit", amount: usd(300000) },
      ],
    },
    options,
  );
  await commit(fixture.database, deposit.effect);
  return { fixture, leaf, entryId: deposit.entryId };
}

describe("trust fitness", () => {
  it("is clean over well-formed trust activity", async () => {
    const { fixture } = await fundedFixture();
    await assertTrustFitness(fixture.database);
    await assertLedgerFitness(fixture.database);
  });

  it("surfaces a commingled entry", async () => {
    const { fixture, entryId } = await fundedFixture();
    // A processor-fee line grafted onto a committed trust entry — what a bypass of the guard would
    // look like in the data.
    await fixture.database
      .batch([
        insertLineStatement(fixture.database, {
          id: newIdentifier("ledgerLine"),
          entryId,
          accountId: fixture.processorFeeAccountId,
          lineIndex: 9,
          direction: "debit",
          amountMinor: 3000,
        }),
      ])
      .catch(() => undefined);
    const { results } = await commingledTrustEntriesStatement(fixture.database).all();
    expect(results).toHaveLength(1);
    await expect(assertTrustFitness(fixture.database)).rejects.toThrow(/commingled trust entries/);
  });

  it("surfaces an entry touching two clients", async () => {
    const { fixture, entryId } = await fundedFixture();
    const other = await seedMatterLeaf(fixture, "entity_b", "Alvarez");
    await fixture.database.batch([
      insertLineStatement(fixture.database, {
        id: newIdentifier("ledgerLine"),
        entryId,
        accountId: other.ledgerAccountId,
        lineIndex: 9,
        direction: "debit",
        amountMinor: 1000,
      }),
    ]);
    const { results } = await multiClientTrustEntriesStatement(fixture.database).all();
    expect(results).toHaveLength(1);
  });

  it("surfaces a matter leaf whose floor was cleared", async () => {
    const { fixture, leaf } = await fundedFixture();
    await fixture.database
      .prepare("UPDATE account_balance SET min_balance_minor = NULL WHERE account_id = ?1")
      .bind(leaf.ledgerAccountId)
      .run();
    const { results } = await trustLeavesWithoutZeroFloorStatement(fixture.database).all();
    expect(results).toHaveLength(1);
  });

  it("surfaces a roll-up node that carries a posting", async () => {
    const { fixture, entryId } = await fundedFixture();
    const clientNode = await fixture.database
      .prepare("SELECT ledger_account_id FROM trust_ledger_node WHERE kind = 'client'")
      .bind()
      .all<{ ledger_account_id: string }>();
    await fixture.database.batch([
      insertLineStatement(fixture.database, {
        id: newIdentifier("ledgerLine"),
        entryId,
        accountId: clientNode.results[0]?.ledger_account_id as never,
        lineIndex: 9,
        direction: "debit",
        amountMinor: 1000,
      }),
    ]);
    const { results } = await trustRollupNodesWithPostingsStatement(fixture.database).all();
    expect(results).toHaveLength(1);
  });

  it("surfaces a hold that outlived the money it restricted", async () => {
    const { fixture, leaf } = await fundedFixture();
    const hold = await placeTrustHold(
      fixture.database,
      { nodeId: leaf.nodeId, amount: usd(300000), reason: "Disputed in full" },
      options,
    );
    await commit(fixture.database, hold.effect);
    expect(
      (await trustHoldsExceedingBalanceStatement(fixture.database).all()).results,
    ).toHaveLength(0);
    // The balance drops away underneath the hold — the shape a bypassed available-balance check
    // would leave behind.
    await fixture.database
      .prepare("UPDATE account_balance SET balance_minor = 1000 WHERE account_id = ?1")
      .bind(leaf.ledgerAccountId)
      .run();
    expect(
      (await trustHoldsExceedingBalanceStatement(fixture.database).all()).results,
    ).toHaveLength(1);
  });

  it("the ledger's own parent-balance query catches a roll-up carrying a stored balance", async () => {
    const { fixture } = await fundedFixture();
    await assertLedgerFitness(fixture.database);
    await fixture.database
      .prepare("UPDATE account_balance SET balance_minor = 5 WHERE account_id = ?1")
      .bind(fixture.clientLiabilityAccountId)
      .run();
    // A parent's stored balance is never written after creation, so a non-zero one is corruption —
    // and it is the exact shape that makes a client-money report silently read a number nobody
    // wrote. The query states that rule on its own terms; the two older queries happen to catch the
    // same row from different directions (an unbacked balance, or a parent carrying lines), which is
    // the overlap defense in depth is supposed to have.
    const offenders = await parentAccountsWithNonZeroBalanceStatement(fixture.database).all();
    expect(offenders.results).toHaveLength(1);
    await expect(assertLedgerFitness(fixture.database)).rejects.toThrow(/ledger fitness/);
  });
});
