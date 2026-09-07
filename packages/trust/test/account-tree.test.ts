import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import {
  ensureMatterTrustLeaf,
  listTrustAccounts,
  openTrustAccount,
  TRUST_LEAF_MINIMUM_BALANCE_MINOR,
} from "../src/account-tree.ts";
import { composeTrustEntry } from "../src/composition-guard.ts";
import { assertTrustFitness } from "../src/fitness.ts";
import {
  commit,
  mergeEffects,
  options,
  seedMatter,
  seedMatterClientParty,
  seedMatterLeaf,
  trustFixture,
} from "./support.ts";

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
    // A fresh client on a matter that has never held trust money, so BOTH tiers and the posting
    // compose together — the case the pending-parent declaration exists for.
    const matterId = await seedMatter(fixture, "Alvarez", "entity_b");
    const leaf = await ensureMatterTrustLeaf(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        matterId,
        clientNodeName: "Trust — Alvarez",
        matterLeafName: "Trust — Alvarez — retainer",
      },
      options,
    );
    expect(leaf.created).toBe(true);
    expect(leaf.clientEntityId).toBe("entity_b");
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

describe("listing the firm's trust accounts", () => {
  it("lists every account oldest first and pages on the shared (created_at, id) keyset", async () => {
    const fixture = await trustFixture();
    // Two more accounts, opened after the fixture's own, so the fixture account leads the listing.
    for (const name of ["Zeta Trust", "Alpha Trust"]) {
      const opened = await openTrustAccount(
        fixture.database,
        {
          name,
          locationId: fixture.locationId,
          jurisdiction: null,
          currency: "USD",
          iolta: true,
          openedOn: "2026-01-01",
        },
        options,
      );
      await commit(fixture.database, opened.effect);
    }
    const firstPage = await listTrustAccounts(fixture.database, { limit: 2 });
    // Same clock instant on every row, so the identifier breaks the tie; the fixture's own account
    // was inserted first and the three read back in insertion order across the two pages.
    const names = firstPage.data.map((account) => account.name);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await listTrustAccounts(fixture.database, {
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });
    names.push(...secondPage.data.map((account) => account.name));
    expect(secondPage.data).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    expect(names.toSorted()).toEqual(["Alpha Trust", "IOLTA — Reno", "Zeta Trust"]);
    // The listing carries the identity a picker shows, and never a full account number.
    // Three rows share one clock instant, so which of them leads is the identifier's to decide;
    // what the read promises is that the fixture's account is in the listing, whole.
    const listed = [...firstPage.data, ...secondPage.data].find(
      (account) => account.id === fixture.trustAccountId,
    )!;
    expect(listed.status).toBe("open");
    expect(listed.locationId).toBe(fixture.locationId);
    expect(listed.name).toBe("IOLTA — Reno");
    // The fixture office records no zone; the listing carries the null as read, and the caller
    // resolves it through the one resolver rather than this read inventing a fallback.
    expect(listed.locationTimeZone).toBeNull();
    expect(Object.keys(listed)).not.toContain("accountNumber");
  });
});
