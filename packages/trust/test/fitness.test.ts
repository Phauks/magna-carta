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
  trustMatterNodesMisattributedStatement,
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

  // The cross-check the H1 attack needed and did not have. A leaf attributed to one client on
  // another client's matter is a structurally valid row: it satisfies the per-account matter
  // uniqueness index, and the one-client-per-entry query counts DISTINCT client_entity_id over the
  // very column being asserted — so it sees a single, consistent, wrong answer and reports healthy.
  it("surfaces a matter ledger filed under a client whose matter it is not", async () => {
    const { fixture, leaf } = await fundedFixture();
    await assertTrustFitness(fixture.database);
    // The exact stored shape a leaf created before the attribution was derived would carry: the
    // node says one client, the matter's own client party says another.
    await fixture.database
      .prepare("UPDATE matter_party SET entity_id = 'entity_b' WHERE matter_id = ?1")
      .bind(leaf.matterId)
      .run();

    const { results } = await trustMatterNodesMisattributedStatement(fixture.database).all<{
      node_id: string;
      matter_id: string;
      client_entity_id: string;
    }>();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      node_id: leaf.nodeId,
      matter_id: leaf.matterId,
      client_entity_id: "entity_a",
    });
    // The old query still says healthy, which is precisely why the new one has to exist.
    expect((await multiClientTrustEntriesStatement(fixture.database).all()).results).toHaveLength(
      0,
    );
    await expect(assertTrustFitness(fixture.database)).rejects.toThrow(/trust fitness/);
  });

  it("surfaces a matter ledger whose matter has no client party at all", async () => {
    const { fixture, leaf } = await fundedFixture();
    await fixture.database
      .prepare("UPDATE matter_party SET deleted_at = ?2 WHERE matter_id = ?1")
      .bind(leaf.matterId, "2026-08-06T00:00:00.000Z")
      .run();
    expect(
      (await trustMatterNodesMisattributedStatement(fixture.database).all()).results,
    ).toHaveLength(1);
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
