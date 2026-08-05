import type { UserId } from "@magna-carta/identifiers/types";
import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { loadMatterTrustLeaf } from "../src/account-tree.ts";
import { assertTrustFitness } from "../src/fitness.ts";
import { placeTrustHold, readTrustAvailableBalance } from "../src/holds.ts";
import {
  composeMatterToMatterTransfer,
  composeTrustDeposit,
  composeTrustDisbursement,
  type TrustDisbursementMethodPolicy,
} from "../src/movements.ts";
import { TrustValidationError } from "../src/trust-validation.ts";
import {
  clock,
  commit,
  expectRefusal,
  options,
  seedMatter,
  seedMatterLeaf,
  trustFixture,
} from "./support.ts";

const usd = (minor: number) => money(minor, USD);
const RECORDER = "user_recorder" as UserId;
const AUTHORIZER = "user_authorizer" as UserId;

// The office recorded its state, which every movement requires. The suites that prove the
// no-jurisdiction refusal build their own fixture without one.
const fixtureWithJurisdiction = () => trustFixture({ jurisdiction: "US-NV" });

const leafReference = (clientEntityId: string, matterId: string, label: string) => ({
  clientEntityId,
  matterId: matterId as never,
  clientNodeName: `Trust — ${label}`,
  matterLeafName: `Trust — ${label} — ${matterId}`,
});

async function depositedFixture(amountMinor: number) {
  const fixture = await fixtureWithJurisdiction();
  const matterId = await seedMatter(fixture, "Webb");
  const deposit = await composeTrustDeposit(
    fixture.database,
    {
      trustAccountId: fixture.trustAccountId,
      to: leafReference("entity_webb", matterId, "Webb"),
      amount: usd(amountMinor),
      effectiveDate: "2026-08-05",
      description: "Retainer received",
      method: "check",
      reference: "1041",
      source: "Webb Holdings",
      purpose: "Advance on fees and costs",
      recordedBy: RECORDER,
    },
    options,
  );
  await commit(fixture.database, deposit.effect);
  const node = await loadMatterTrustLeaf(
    fixture.database,
    fixture.trustAccountId,
    matterId as never,
  );
  return { fixture, matterId, node, deposit };
}

describe("deposit", () => {
  it("creates the matter leaf, its floor, the entry, and the record in ONE batch", async () => {
    const { fixture, node, deposit } = await depositedFixture(500000);
    expect(deposit.createdMatterLeaf).toBe(true);

    const balance = await readTrustAvailableBalance(fixture.database, node.id);
    expect(balance.balanceMinor).toBe(500000);
    expect(balance.availableMinor).toBe(500000);

    // The floor is written in the SAME batch that created the account — not as a follow-up.
    const { results } = await fixture.database
      .prepare("SELECT min_balance_minor FROM account_balance WHERE account_id = ?1")
      .bind(node.ledgerAccountId)
      .all<{ min_balance_minor: number | null }>();
    expect(results[0]?.min_balance_minor).toBe(0);
    await expect(assertTrustFitness(fixture.database)).resolves.toBeUndefined();
  });

  it("records the source, purpose, method, and reference the client ledger has to show", async () => {
    const { fixture, deposit } = await depositedFixture(500000);
    const { results } = await fixture.database
      .prepare(
        "SELECT kind, method, reference, counterparty_name, purpose, recorded_by, authorized_by, amount_minor, effective_date FROM trust_movement WHERE id = ?1",
      )
      .bind(deposit.movementId)
      .all<Record<string, unknown>>();
    expect(results[0]).toMatchObject({
      kind: "deposit",
      method: "check",
      reference: "1041",
      counterparty_name: "Webb Holdings",
      purpose: "Advance on fees and costs",
      recorded_by: RECORDER,
      authorized_by: null,
      amount_minor: 500000,
      effective_date: "2026-08-05",
    });
  });

  it("reuses an existing leaf on the second deposit rather than building a second one", async () => {
    const { fixture, matterId, node } = await depositedFixture(500000);
    const second = await composeTrustDeposit(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        to: leafReference("entity_webb", matterId, "Webb"),
        amount: usd(250000),
        effectiveDate: "2026-08-05",
        description: "Further funds received",
        method: "wire",
        source: "Webb Holdings",
        purpose: "Replenishment",
        recordedBy: RECORDER,
      },
      options,
    );
    await commit(fixture.database, second.effect);
    expect(second.createdMatterLeaf).toBe(false);
    expect(second.nodeId).toBe(node.id);
    const balance = await readTrustAvailableBalance(fixture.database, node.id);
    expect(balance.balanceMinor).toBe(750000);
  });

  it("lands GROSS — the deposit entry touches nothing but the trust account", async () => {
    const { fixture, deposit } = await depositedFixture(500000);
    const { results } = await fixture.database
      .prepare("SELECT account_id, direction, amount_minor FROM ledger_line WHERE entry_id = ?1")
      .bind(deposit.entryId)
      .all<{ account_id: string; direction: string; amount_minor: number }>();
    expect(results).toHaveLength(2);
    expect(results.some((line) => line.account_id === fixture.processorFeeAccountId)).toBe(false);
    expect(results.every((line) => line.amount_minor === 500000)).toBe(true);
  });

  it("refuses when the office recorded no jurisdiction, distinctly from an unencoded one", async () => {
    const fixture = await trustFixture();
    const matterId = await seedMatter(fixture, "Webb");
    await expect(
      composeTrustDeposit(
        fixture.database,
        {
          trustAccountId: fixture.trustAccountId,
          to: leafReference("entity_webb", matterId, "Webb"),
          amount: usd(100000),
          effectiveDate: "2026-08-05",
          description: "Retainer received",
          method: "check",
          source: "Webb Holdings",
          purpose: "Advance on fees",
          recordedBy: RECORDER,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "jurisdiction-not-recorded" });
  });

  it("refuses a currency the trust account does not hold", async () => {
    const fixture = await fixtureWithJurisdiction();
    const matterId = await seedMatter(fixture, "Webb");
    await expect(
      composeTrustDeposit(
        fixture.database,
        {
          trustAccountId: fixture.trustAccountId,
          to: leafReference("entity_webb", matterId, "Webb"),
          amount: money(100000, "EUR"),
          effectiveDate: "2026-08-05",
          description: "Retainer received",
          method: "wire",
          source: "Webb Holdings",
          purpose: "Advance on fees",
          recordedBy: RECORDER,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "movement-currency-mismatch" });
  });
});

describe("disbursement", () => {
  it("pays out, reduces the ledger, and records the payee and the authorizing member", async () => {
    const { fixture, node } = await depositedFixture(500000);
    const paid = await composeTrustDisbursement(
      fixture.database,
      {
        fromNodeId: node.id,
        amount: usd(120000),
        effectiveDate: "2026-08-05",
        description: "Filing fee paid on the client's behalf",
        method: "check",
        reference: "2207",
        payee: "Second Judicial District Court",
        purpose: "Complaint filing fee",
        recordedBy: RECORDER,
        authorizedBy: AUTHORIZER,
      },
      options,
    );
    await commit(fixture.database, paid.effect);

    const balance = await readTrustAvailableBalance(fixture.database, node.id);
    expect(balance.balanceMinor).toBe(380000);

    const { results } = await fixture.database
      .prepare("SELECT kind, counterparty_name, authorized_by FROM trust_movement WHERE id = ?1")
      .bind(paid.movementId)
      .all<Record<string, unknown>>();
    expect(results[0]).toMatchObject({
      kind: "disbursement",
      counterparty_name: "Second Judicial District Court",
      authorized_by: AUTHORIZER,
    });
    await expect(assertTrustFitness(fixture.database)).resolves.toBeUndefined();
  });

  it("measures against AVAILABLE, not balance — a hold is not money the firm may pay out", async () => {
    const { fixture, node } = await depositedFixture(500000);
    const hold = await placeTrustHold(
      fixture.database,
      { nodeId: node.id, amount: usd(400000), reason: "Disputed fee" },
      options,
    );
    await commit(fixture.database, hold.effect);

    await expect(
      composeTrustDisbursement(
        fixture.database,
        {
          fromNodeId: node.id,
          amount: usd(200000),
          effectiveDate: "2026-08-05",
          description: "Payment to the client",
          method: "check",
          payee: "A Webb",
          purpose: "Undisputed portion",
          recordedBy: RECORDER,
          authorizedBy: AUTHORIZER,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "movement-exceeds-available" });

    // The undisputed portion still goes out promptly, which is the point of holding rather than
    // freezing the whole ledger.
    const undisputed = await composeTrustDisbursement(
      fixture.database,
      {
        fromNodeId: node.id,
        amount: usd(100000),
        effectiveDate: "2026-08-05",
        description: "Payment to the client",
        method: "check",
        payee: "A Webb",
        purpose: "Undisputed portion",
        recordedBy: RECORDER,
        authorizedBy: AUTHORIZER,
      },
      options,
    );
    await commit(fixture.database, undisputed.effect);
    expect((await readTrustAvailableBalance(fixture.database, node.id)).availableMinor).toBe(0);
  });

  it("the database floor, not the pre-check, is the guarantee against an overdraw", async () => {
    const { fixture, node } = await depositedFixture(500000);
    // Composed against a stale read: the pre-check passes, then another disbursement drains the
    // ledger before this batch commits. Only the account_balance floor can catch that, and it
    // aborts the WHOLE batch — which is exactly why no pre-check is ever the guarantee.
    const stale = await composeTrustDisbursement(
      fixture.database,
      {
        fromNodeId: node.id,
        amount: usd(400000),
        effectiveDate: "2026-08-05",
        description: "Payment to the client",
        method: "wire",
        payee: "A Webb",
        purpose: "Balance returned",
        recordedBy: RECORDER,
        authorizedBy: AUTHORIZER,
      },
      options,
    );
    const drain = await composeTrustDisbursement(
      fixture.database,
      {
        fromNodeId: node.id,
        amount: usd(500000),
        effectiveDate: "2026-08-05",
        description: "Payment to the client",
        method: "wire",
        payee: "A Webb",
        purpose: "Balance returned",
        recordedBy: RECORDER,
        authorizedBy: AUTHORIZER,
      },
      options,
    );
    await commit(fixture.database, drain.effect);
    await expect(expectRefusal(() => commit(fixture.database, stale.effect))).rejects.toThrow();
    // The aborted batch left nothing behind — not the entry, not the movement record.
    const { results } = await fixture.database
      .prepare("SELECT id FROM trust_movement WHERE id = ?1")
      .bind(stale.movementId)
      .all();
    expect(results).toHaveLength(0);
    expect((await readTrustAvailableBalance(fixture.database, node.id)).balanceMinor).toBe(0);
  });

  it("refuses a method the bound jurisdiction policy forbids", async () => {
    const { fixture, node } = await depositedFixture(500000);
    const noCash: TrustDisbursementMethodPolicy = {
      assertMethodPermitted(context) {
        if (context.method === "cash") {
          throw new TrustValidationError(
            "movement-method-not-permitted",
            `${context.jurisdiction} does not permit a cash withdrawal from a trust account`,
          );
        }
      },
    };
    await expect(
      composeTrustDisbursement(
        fixture.database,
        {
          fromNodeId: node.id,
          amount: usd(1000),
          effectiveDate: "2026-08-05",
          description: "Cash to the client",
          method: "cash",
          payee: "A Webb",
          purpose: "Refund",
          recordedBy: RECORDER,
          authorizedBy: AUTHORIZER,
        },
        { ...options, disbursementMethodPolicy: noCash },
      ),
    ).rejects.toMatchObject({ code: "movement-method-not-permitted" });
  });

  it("refuses to pay out of a client node — a roll-up carries no balance", async () => {
    const { fixture, node } = await depositedFixture(500000);
    const clientNodeId = node.parentNodeId;
    expect(clientNodeId).not.toBeNull();
    await expect(
      composeTrustDisbursement(
        fixture.database,
        {
          fromNodeId: clientNodeId as never,
          amount: usd(1000),
          effectiveDate: "2026-08-05",
          description: "Payment",
          method: "check",
          payee: "A Webb",
          purpose: "Refund",
          recordedBy: RECORDER,
          authorizedBy: AUTHORIZER,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "movement-node-is-not-a-matter-leaf" });
  });
});

describe("matter-to-matter transfer", () => {
  it("moves funds between two matters of one client and touches no bank line", async () => {
    const { fixture, node } = await depositedFixture(500000);
    const secondMatterId = await seedMatter(fixture, "Webb appeal");
    const moved = await composeMatterToMatterTransfer(
      fixture.database,
      {
        fromNodeId: node.id,
        to: leafReference("entity_webb", secondMatterId, "Webb appeal"),
        amount: usd(150000),
        effectiveDate: "2026-08-05",
        description: "Funds reallocated to the appeal",
        purpose: "Received against the wrong matter",
        recordedBy: RECORDER,
        authorizedBy: AUTHORIZER,
      },
      options,
    );
    await commit(fixture.database, moved.effect);
    expect(moved.createdMatterLeaf).toBe(true);

    expect((await readTrustAvailableBalance(fixture.database, node.id)).balanceMinor).toBe(350000);
    expect(
      (await readTrustAvailableBalance(fixture.database, moved.counterpartyNodeId as never))
        .balanceMinor,
    ).toBe(150000);

    // No bank line: the money never left the account, so the bank balance is untouched and the
    // reconciliation gains no item that could never clear.
    const { results } = await fixture.database
      .prepare("SELECT account_id FROM ledger_line WHERE entry_id = ?1")
      .bind(moved.entryId)
      .all<{ account_id: string }>();
    expect(results).toHaveLength(2);
    expect(results.some((line) => line.account_id === fixture.bankLedgerAccountId)).toBe(false);

    const bank = await fixture.database
      .prepare("SELECT balance_minor FROM account_balance WHERE account_id = ?1")
      .bind(fixture.bankLedgerAccountId)
      .all<{ balance_minor: number }>();
    expect(bank.results[0]?.balance_minor).toBe(500000);
    await expect(assertTrustFitness(fixture.database)).resolves.toBeUndefined();
  });

  it("appears on BOTH client ledgers it touches", async () => {
    const { fixture, node } = await depositedFixture(500000);
    const secondMatterId = await seedMatter(fixture, "Webb appeal");
    const moved = await composeMatterToMatterTransfer(
      fixture.database,
      {
        fromNodeId: node.id,
        to: leafReference("entity_webb", secondMatterId, "Webb appeal"),
        amount: usd(150000),
        effectiveDate: "2026-08-05",
        description: "Funds reallocated to the appeal",
        purpose: "Received against the wrong matter",
        recordedBy: RECORDER,
        authorizedBy: AUTHORIZER,
      },
      options,
    );
    await commit(fixture.database, moved.effect);
    for (const nodeId of [node.id, moved.counterpartyNodeId]) {
      const { results } = await fixture.database
        .prepare(
          "SELECT id FROM trust_movement WHERE node_id = ?1 OR counterparty_node_id = ?1 ORDER BY effective_date",
        )
        .bind(nodeId)
        .all<{ id: string }>();
      expect(results.some((row) => row.id === moved.movementId)).toBe(true);
    }
  });

  it("refuses a movement onto another client's matter — the misappropriation pattern", async () => {
    const { fixture, node } = await depositedFixture(500000);
    const otherClientMatterId = await seedMatter(fixture, "Ashford");
    await expect(
      composeMatterToMatterTransfer(
        fixture.database,
        {
          fromNodeId: node.id,
          to: leafReference("entity_ashford", otherClientMatterId, "Ashford"),
          amount: usd(150000),
          effectiveDate: "2026-08-05",
          description: "Funds moved",
          purpose: "Reallocation",
          recordedBy: RECORDER,
          authorizedBy: AUTHORIZER,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "multiple-clients-on-entry" });
  });

  it("refuses a transfer to the matter it came from", async () => {
    const { fixture, matterId, node } = await depositedFixture(500000);
    await expect(
      composeMatterToMatterTransfer(
        fixture.database,
        {
          fromNodeId: node.id,
          to: leafReference("entity_webb", matterId, "Webb"),
          amount: usd(150000),
          effectiveDate: "2026-08-05",
          description: "Funds moved",
          purpose: "Reallocation",
          recordedBy: RECORDER,
          authorizedBy: AUTHORIZER,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "movement-transfer-to-same-node" });
  });

  it("is bounded by available, not balance", async () => {
    const { fixture, node } = await depositedFixture(500000);
    const secondMatterId = await seedMatter(fixture, "Webb appeal");
    const hold = await placeTrustHold(
      fixture.database,
      { nodeId: node.id, amount: usd(400000), reason: "Disputed fee" },
      options,
    );
    await commit(fixture.database, hold.effect);
    await expect(
      composeMatterToMatterTransfer(
        fixture.database,
        {
          fromNodeId: node.id,
          to: leafReference("entity_webb", secondMatterId, "Webb appeal"),
          amount: usd(200000),
          effectiveDate: "2026-08-05",
          description: "Funds moved",
          purpose: "Reallocation",
          recordedBy: RECORDER,
          authorizedBy: AUTHORIZER,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "movement-exceeds-available" });
  });
});

describe("the movement record is append-only", () => {
  it("refuses an UPDATE, a DELETE, and a REPLACE over a committed record", async () => {
    const { fixture, deposit } = await depositedFixture(500000);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE trust_movement SET counterparty_name = ?2 WHERE id = ?1")
          .bind(deposit.movementId, "Someone else")
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("DELETE FROM trust_movement WHERE id = ?1")
          .bind(deposit.movementId)
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            "INSERT OR REPLACE INTO trust_movement (id, trust_account_id, kind, node_id, counterparty_node_id, amount_minor, currency, entry_id, method, reference, counterparty_name, purpose, recorded_by, authorized_by, effective_date, recorded_at) VALUES (?1, ?2, 'deposit', ?3, NULL, 1, 'USD', ?4, 'check', NULL, 'Rewritten', 'Rewritten', ?5, NULL, '2026-08-05', ?6)",
          )
          .bind(
            deposit.movementId,
            fixture.trustAccountId,
            deposit.nodeId,
            deposit.entryId,
            RECORDER,
            clock.now(),
          )
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
  });
});

describe("the movement shape is enforced by the database, not by the composer", () => {
  it("refuses a disbursement record with nobody named as authorizing it", async () => {
    const { fixture, deposit, node } = await depositedFixture(500000);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            "INSERT INTO trust_movement (id, trust_account_id, kind, node_id, counterparty_node_id, amount_minor, currency, entry_id, method, reference, counterparty_name, purpose, recorded_by, authorized_by, effective_date, recorded_at) VALUES ('trustMovement_forged', ?1, 'disbursement', ?2, NULL, 1, 'USD', ?3, 'check', NULL, 'A payee', 'A purpose', ?4, NULL, '2026-08-05', ?5)",
          )
          .bind(fixture.trustAccountId, node.id, deposit.entryId, RECORDER, clock.now())
          .run(),
      ),
    ).rejects.toThrow();
  });

  it("refuses a matter transfer claiming a bank method or an external payee", async () => {
    const { fixture, deposit, node } = await depositedFixture(500000);
    const secondMatterId = await seedMatter(fixture, "Webb appeal");
    const second = await seedMatterLeaf(fixture, "entity_webb", "Webb appeal");
    expect(second.matterId).not.toBe(secondMatterId);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            "INSERT INTO trust_movement (id, trust_account_id, kind, node_id, counterparty_node_id, amount_minor, currency, entry_id, method, reference, counterparty_name, purpose, recorded_by, authorized_by, effective_date, recorded_at) VALUES ('trustMovement_forged', ?1, 'matter_transfer', ?2, ?3, 1, 'USD', ?4, 'wire', NULL, NULL, 'A purpose', ?5, ?6, '2026-08-05', ?7)",
          )
          .bind(
            fixture.trustAccountId,
            node.id,
            second.nodeId,
            deposit.entryId,
            RECORDER,
            AUTHORIZER,
            clock.now(),
          )
          .run(),
      ),
    ).rejects.toThrow();
  });
});
