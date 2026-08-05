import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { ensureMatterTrustLeaf, TRUST_LEAF_MINIMUM_BALANCE_MINOR } from "../src/account-tree.ts";
import { composeTrustEntry } from "../src/composition-guard.ts";
import { assertTrustFitness } from "../src/fitness.ts";
import { commit, mergeEffects, options, seedMatterLeaf, trustFixture } from "./support.ts";

describe("the trust account tree", () => {
  it("opens a trust account as an asset leaf plus a liability root bound to an office", async () => {
    const fixture = await trustFixture();
    const { results } = await fixture.database
      .prepare(
        "SELECT bank_ledger_account_id, client_liability_account_id, status, jurisdiction FROM trust_account WHERE id = ?1",
      )
      .bind(fixture.trustAccountId)
      .all<{
        bank_ledger_account_id: string;
        client_liability_account_id: string;
        status: string;
        jurisdiction: string | null;
      }>();
    expect(results[0]).toEqual({
      bank_ledger_account_id: fixture.bankLedgerAccountId,
      client_liability_account_id: fixture.clientLiabilityAccountId,
      status: "open",
      // No office jurisdiction was recorded, and nothing invented one.
      jurisdiction: null,
    });
  });

  it("builds client node then matter leaf, and the second matter reuses the client node", async () => {
    const fixture = await trustFixture();
    const first = await seedMatterLeaf(fixture, "entity_a", "Webb");
    const second = await seedMatterLeaf(fixture, "entity_a", "Webb");
    const { results } = await fixture.database
      .prepare("SELECT id, kind, parent_node_id FROM trust_ledger_node ORDER BY kind, id")
      .bind()
      .all<{ id: string; kind: string; parent_node_id: string | null }>();
    const clientNodes = results.filter((row) => row.kind === "client");
    const matterNodes = results.filter((row) => row.kind === "matter");
    expect(clientNodes).toHaveLength(1);
    expect(matterNodes).toHaveLength(2);
    for (const leaf of matterNodes) expect(leaf.parent_node_id).toBe(clientNodes[0]?.id);
    expect(new Set(matterNodes.map((row) => row.id))).toEqual(
      new Set([first.nodeId, second.nodeId]),
    );
  });

  it("is idempotent for a matter that already has a leaf", async () => {
    const fixture = await trustFixture();
    const seeded = await seedMatterLeaf(fixture, "entity_a", "Webb");
    const again = await ensureMatterTrustLeaf(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        clientEntityId: "entity_a",
        matterId: seeded.matterId,
        clientNodeName: "Trust — Webb",
        matterLeafName: "Trust — Webb — again",
      },
      options,
    );
    expect(again.created).toBe(false);
    expect(again.nodeId).toBe(seeded.nodeId);
    expect(again.effect.statements).toHaveLength(0);
  });

  it("writes the zero floor in the SAME batch that creates the leaf", async () => {
    const fixture = await trustFixture();
    const seeded = await seedMatterLeaf(fixture, "entity_a", "Webb");
    const { results } = await fixture.database
      .prepare("SELECT min_balance_minor, balance_minor FROM account_balance WHERE account_id = ?1")
      .bind(seeded.ledgerAccountId)
      .all<{ min_balance_minor: number | null; balance_minor: number }>();
    expect(results[0]).toEqual({
      min_balance_minor: TRUST_LEAF_MINIMUM_BALANCE_MINOR,
      balance_minor: 0,
    });
  });

  it("creates the leaf and its first posting in one batch, so the floor never lags the account", async () => {
    const fixture = await trustFixture();
    const matterId = (await seedMatterLeaf(fixture, "x", "X")).matterId;
    // A fresh client, whose leaf does not exist yet: creation and posting compose together.
    const leaf = await ensureMatterTrustLeaf(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        clientEntityId: "entity_b",
        matterId,
        clientNodeName: "Trust — Alvarez",
        matterLeafName: "Trust — Alvarez — retainer",
      },
      options,
    );
    // The account rows do not exist until the batch commits, so the posting has to be composed
    // against ids the creation effect will produce — which is exactly what the caller does.
    await commit(fixture.database, leaf.effect);
    const deposit = await composeTrustEntry(
      fixture.database,
      {
        description: "Retainer deposit",
        effectiveDate: "2026-08-05",
        lines: [
          {
            accountId: fixture.bankLedgerAccountId,
            direction: "debit",
            amount: money(250000, USD),
          },
          { accountId: leaf.ledgerAccountId, direction: "credit", amount: money(250000, USD) },
        ],
      },
      options,
    );
    await commit(fixture.database, deposit.effect);
    await assertTrustFitness(fixture.database);
  });

  it("refuses a leaf under a closed trust account", async () => {
    const fixture = await trustFixture();
    await fixture.database
      .prepare("UPDATE trust_account SET status = 'closed', closed_at = ?2 WHERE id = ?1")
      .bind(fixture.trustAccountId, "2026-08-05T16:00:00.000Z")
      .run();
    await expect(seedMatterLeaf(fixture, "entity_a", "Webb")).rejects.toMatchObject({
      code: "trust-account-closed",
    });
  });

  it("the client-liability root keeps a zero stored balance while its leaves carry the money", async () => {
    const fixture = await trustFixture();
    const seeded = await seedMatterLeaf(fixture, "entity_a", "Webb");
    const deposit = await composeTrustEntry(
      fixture.database,
      {
        description: "Retainer deposit",
        effectiveDate: "2026-08-05",
        lines: [
          {
            accountId: fixture.bankLedgerAccountId,
            direction: "debit",
            amount: money(100000, USD),
          },
          { accountId: seeded.ledgerAccountId, direction: "credit", amount: money(100000, USD) },
        ],
      },
      options,
    );
    await commit(fixture.database, mergeEffects(deposit.effect));
    const { results } = await fixture.database
      .prepare("SELECT balance_minor FROM account_balance WHERE account_id = ?1")
      .bind(fixture.clientLiabilityAccountId)
      .all<{ balance_minor: number }>();
    // The roll-up is a SUM over descendant leaves; the parent row itself stays at zero, which is why
    // no report may read a trust total from it.
    expect(results[0]?.balance_minor).toBe(0);
  });
});

describe("the no-negative floor", () => {
  it("aborts the WHOLE batch when a disbursement would overdraw a client ledger", async () => {
    const fixture = await trustFixture();
    const seeded = await seedMatterLeaf(fixture, "entity_a", "Webb");
    const deposit = await composeTrustEntry(
      fixture.database,
      {
        description: "Retainer deposit",
        effectiveDate: "2026-08-05",
        lines: [
          { accountId: fixture.bankLedgerAccountId, direction: "debit", amount: money(50000, USD) },
          { accountId: seeded.ledgerAccountId, direction: "credit", amount: money(50000, USD) },
        ],
      },
      options,
    );
    await commit(fixture.database, deposit.effect);

    const overdraw = await composeTrustEntry(
      fixture.database,
      {
        description: "Disbursement beyond the balance",
        effectiveDate: "2026-08-05",
        lines: [
          { accountId: seeded.ledgerAccountId, direction: "debit", amount: money(50001, USD) },
          {
            accountId: fixture.bankLedgerAccountId,
            direction: "credit",
            amount: money(50001, USD),
          },
        ],
      },
      options,
    );
    // Nothing in the trust package compares balances here. The account_balance bounds CHECK fires
    // inside the batch and takes the entry, its lines, every balance write, and the outbox row with
    // it — which is what makes the guarantee independent of any caller remembering to check.
    await expect(commit(fixture.database, overdraw.effect)).rejects.toThrow();
    const { results } = await fixture.database
      .prepare("SELECT COUNT(*) AS entries FROM ledger_entry")
      .bind()
      .all<{ entries: number }>();
    expect(results[0]?.entries).toBe(1);
    await assertTrustFitness(fixture.database);
  });
});
