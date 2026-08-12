import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { TrustLedgerNodeId } from "@magna-carta/identifiers/types";
import { money, USD } from "@magna-carta/money/money";
import { beforeEach, describe, expect, it } from "vitest";
import {
  assertTrustComposition,
  assertTrustFirmFundsComposition,
} from "../src/composition-guard.ts";
import {
  assertTrustFitness,
  firmFundsEntriesTouchingClientMoneyStatement,
  trustLeavesWithoutZeroFloorStatement,
} from "../src/fitness.ts";
import {
  composeTrustBankCharge,
  composeTrustFirmFundsDeposit,
  loadTrustFirmFundsNode,
  openTrustFirmFundsNode,
  readTrustFirmFundsPosition,
} from "../src/firm-funds.ts";
import { composeTrustBankStatement, readTrustBankStatementLines } from "../src/bank-statements.ts";
import { composeTrustReconciliationMatch } from "../src/matching.ts";
import { composeTrustDeposit } from "../src/movements.ts";
import {
  closeTrustReconciliation,
  openTrustReconciliation,
  readTrustReconciliation,
  readTrustThreeWayProof,
} from "../src/reconciliation.ts";
import type { TrustAccountRole } from "../src/types.ts";
import {
  commit,
  expectRefusal,
  options,
  seedMatterLeaf,
  trustFixture,
  type TrustFixtureOptions,
} from "./support.ts";

// THE BANK-CHARGE CARVE-OUT. Every test here is about the same question in a different place: can
// this path be turned into a way to move a client's money? The answers have to come from the schema,
// the composition door, and the account_balance floor — not from a composer remembering to check.

const CHARGE_ACCOUNT: TrustFixtureOptions = { jurisdiction: "US-NV", iolta: false };

type Fixture = Awaited<ReturnType<typeof trustFixture>>;

async function fixtureWithCarveOut(): Promise<{ fixture: Fixture; nodeId: TrustLedgerNodeId }> {
  const fixture = await trustFixture(CHARGE_ACCOUNT);
  const opened = await openTrustFirmFundsNode(
    fixture.database,
    { trustAccountId: fixture.trustAccountId, nodeName: "Firm funds — bank charges" },
    options,
  );
  await commit(fixture.database, opened.effect);
  return { fixture, nodeId: opened.nodeId };
}

// The suites below build entries by hand to prove what the doors refuse, and a nullable node would
// make every one of them carry a fallback that is itself untyped. The carve-out is open in each of
// them, so this narrows once.
async function firmFundsLedgerAccountId(fixture: Fixture) {
  const node = await loadTrustFirmFundsNode(fixture.database, fixture.trustAccountId);
  if (node === null) throw new Error("the fixture opened the carve-out");
  return node.ledgerAccountId;
}

async function fundCushion(fixture: Fixture, amountMinor: number): Promise<void> {
  const deposit = await composeTrustFirmFundsDeposit(
    fixture.database,
    {
      trustAccountId: fixture.trustAccountId,
      amount: money(amountMinor, USD),
      effectiveDate: "2026-08-02",
      description: "Firm funds to cover bank service charges",
      method: "electronic_transfer",
      recordedBy: fixture.memberUserId,
    },
    options,
  );
  await commit(fixture.database, deposit.effect);
}

describe("opening the carve-out on one trust account", () => {
  it("is off by default — an account has no firm-funds node until somebody opens one", async () => {
    const fixture = await trustFixture(CHARGE_ACCOUNT);
    expect(await loadTrustFirmFundsNode(fixture.database, fixture.trustAccountId)).toBeNull();
    expect(await readTrustFirmFundsPosition(fixture.database, fixture.trustAccountId)).toBeNull();
  });

  it("refuses a pooled interest-bearing account, which the rules exempt from service charges", async () => {
    const fixture = await trustFixture({ jurisdiction: "US-NV", iolta: true });
    await expect(
      openTrustFirmFundsNode(
        fixture.database,
        { trustAccountId: fixture.trustAccountId, nodeName: "Firm funds" },
        options,
      ),
    ).rejects.toMatchObject({ code: "firm-funds-account-is-pooled-interest-bearing" });
  });

  it("refuses an account whose office recorded no jurisdiction", async () => {
    const fixture = await trustFixture({ jurisdiction: null, iolta: false });
    await expect(
      openTrustFirmFundsNode(
        fixture.database,
        { trustAccountId: fixture.trustAccountId, nodeName: "Firm funds" },
        options,
      ),
    ).rejects.toMatchObject({ code: "jurisdiction-not-recorded" });
  });

  it("opens exactly one, and refuses a second", async () => {
    const { fixture } = await fixtureWithCarveOut();
    await expect(
      openTrustFirmFundsNode(
        fixture.database,
        { trustAccountId: fixture.trustAccountId, nodeName: "Firm funds again" },
        options,
      ),
    ).rejects.toMatchObject({ code: "firm-funds-node-already-open" });
  });

  it("writes the zero floor in the same batch, so a charge can never overdraw the cushion", async () => {
    const { fixture } = await fixtureWithCarveOut();
    const { results } = await trustLeavesWithoutZeroFloorStatement(fixture.database).all();
    expect(results).toEqual([]);
  });
});

describe("the firm's own cushion", () => {
  it("records a deposit and a charge, and the cushion falls by the charge", async () => {
    const { fixture } = await fixtureWithCarveOut();
    await fundCushion(fixture, 25_000);
    expect(
      (await readTrustFirmFundsPosition(fixture.database, fixture.trustAccountId))?.balanceMinor,
    ).toBe(25_000);

    const charge = await composeTrustBankCharge(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        amount: money(1_200, USD),
        effectiveDate: "2026-08-04",
        description: "Monthly account maintenance",
        recordedBy: fixture.memberUserId,
      },
      options,
    );
    await commit(fixture.database, charge.effect);
    expect(
      (await readTrustFirmFundsPosition(fixture.database, fixture.trustAccountId))?.balanceMinor,
    ).toBe(23_800);
    await assertTrustFitness(fixture.database);
  });

  it("refuses a charge before the carve-out is open on that account", async () => {
    const fixture = await trustFixture(CHARGE_ACCOUNT);
    await expect(
      composeTrustBankCharge(
        fixture.database,
        {
          trustAccountId: fixture.trustAccountId,
          amount: money(1_200, USD),
          effectiveDate: "2026-08-04",
          description: "Monthly account maintenance",
          recordedBy: fixture.memberUserId,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "firm-funds-node-not-open" });
  });

  it("A CHARGE LARGER THAN THE FIRM'S OWN FUNDS IS REFUSED — client money never bears a bank charge", async () => {
    const { fixture } = await fixtureWithCarveOut();
    const leaf = await seedMatterLeaf(fixture, "entity_alvarez", "Alvarez");
    const clientDeposit = await composeTrustDeposit(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        to: {
          matterId: leaf.matterId,
          clientNodeName: "Trust — Alvarez",
          matterLeafName: `Trust — Alvarez — ${leaf.matterId}`,
        },
        amount: money(500_000, USD),
        effectiveDate: "2026-08-03",
        description: "Retainer received",
        method: "wire",
        source: "Alvarez",
        purpose: "Advance on fees",
        recordedBy: fixture.memberUserId,
      },
      options,
    );
    await commit(fixture.database, clientDeposit.effect);
    await fundCushion(fixture, 1_000);

    // Half a million dollars of client money sits in the same bank account. The charge is refused
    // against the thousand of firm money, never against the balance the bank actually holds.
    await expect(
      composeTrustBankCharge(
        fixture.database,
        {
          trustAccountId: fixture.trustAccountId,
          amount: money(1_500, USD),
          effectiveDate: "2026-08-04",
          description: "Wire fee",
          recordedBy: fixture.memberUserId,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "bank-charge-exceeds-firm-funds" });
  });

  it("the account_balance floor is the guarantee, not the pre-check: an overdrawing batch aborts", async () => {
    const { fixture, nodeId } = await fixtureWithCarveOut();
    await fundCushion(fixture, 1_000);
    const node = await loadTrustFirmFundsNode(fixture.database, fixture.trustAccountId);
    expect(node?.id).toBe(nodeId);

    // Two charges composed against the same read of the cushion — the shape of a concurrent pair
    // the pre-check cannot see. Each is within the balance it read; together they are not, and the
    // second batch is what the database refuses.
    const first = await composeTrustBankCharge(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        amount: money(800, USD),
        effectiveDate: "2026-08-04",
        description: "Per-item charge",
        recordedBy: fixture.memberUserId,
      },
      options,
    );
    const second = await composeTrustBankCharge(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        amount: money(800, USD),
        effectiveDate: "2026-08-04",
        description: "Per-item charge",
        recordedBy: fixture.memberUserId,
      },
      options,
    );
    await commit(fixture.database, first.effect);
    await expect(
      expectRefusal(() => commit(fixture.database, second.effect)),
    ).rejects.toThrowError();
  });
});

describe("the carve-out cannot be used to move client money", () => {
  let fixture: Fixture;
  let firmFundsNodeId: TrustLedgerNodeId;

  beforeEach(async () => {
    const built = await fixtureWithCarveOut();
    fixture = built.fixture;
    firmFundsNodeId = built.nodeId;
  });

  it("the CLIENT-MONEY door still refuses a firm-funds line outright, unchanged by the carve-out", async () => {
    const leaf = await seedMatterLeaf(fixture, "entity_bell", "Bell");
    const firmFundsAccountId = await firmFundsLedgerAccountId(fixture);
    expect(() =>
      assertTrustComposition(
        {
          description: "not a legitimate entry",
          effectiveDate: "2026-08-05",
          lines: [
            { accountId: leaf.ledgerAccountId, direction: "debit", amount: money(1_000, USD) },
            {
              accountId: firmFundsAccountId,
              direction: "credit",
              amount: money(1_000, USD),
            },
          ],
        },
        new Map<string, TrustAccountRole>([
          [
            leaf.ledgerAccountId,
            {
              kind: "matter",
              trustAccountId: fixture.trustAccountId,
              nodeId: leaf.nodeId,
              clientEntityId: leaf.clientEntityId,
              matterId: leaf.matterId,
            },
          ],
          [
            firmFundsAccountId,
            {
              kind: "firmFunds",
              trustAccountId: fixture.trustAccountId,
              nodeId: firmFundsNodeId,
            },
          ],
        ]),
      ),
    ).toThrowError(/firm/i);
  });

  it("THE FIRM-FUNDS DOOR REFUSES A MATTER LEAF — it can only pair the cushion with the bank leaf", async () => {
    const leaf = await seedMatterLeaf(fixture, "entity_chan", "Chan");
    const firmFundsAccountId = await firmFundsLedgerAccountId(fixture);
    expect(() =>
      assertTrustFirmFundsComposition(
        {
          description: "firm money onto a client ledger",
          effectiveDate: "2026-08-05",
          lines: [
            {
              accountId: firmFundsAccountId,
              direction: "debit",
              amount: money(1_000, USD),
            },
            { accountId: leaf.ledgerAccountId, direction: "credit", amount: money(1_000, USD) },
          ],
        },
        new Map<string, TrustAccountRole>([
          [
            firmFundsAccountId,
            { kind: "firmFunds", trustAccountId: fixture.trustAccountId, nodeId: firmFundsNodeId },
          ],
          [
            leaf.ledgerAccountId,
            {
              kind: "matter",
              trustAccountId: fixture.trustAccountId,
              nodeId: leaf.nodeId,
              clientEntityId: leaf.clientEntityId,
              matterId: leaf.matterId,
            },
          ],
        ]),
        firmFundsNodeId,
      ),
    ).toThrowError(/client money|composeTrustEntry/i);
  });

  it("THE FIRM-FUNDS DOOR REFUSES ANYTHING OUTSIDE THE TRUST ACCOUNT — no operating leg", async () => {
    const firmFundsAccountId = await firmFundsLedgerAccountId(fixture);
    expect(() =>
      assertTrustFirmFundsComposition(
        {
          description: "firm money straight back to the operating account",
          effectiveDate: "2026-08-05",
          lines: [
            {
              accountId: firmFundsAccountId,
              direction: "debit",
              amount: money(1_000, USD),
            },
            {
              accountId: fixture.operatingBankAccountId,
              direction: "credit",
              amount: money(1_000, USD),
            },
          ],
        },
        new Map<string, TrustAccountRole>([
          [
            firmFundsAccountId,
            { kind: "firmFunds", trustAccountId: fixture.trustAccountId, nodeId: firmFundsNodeId },
          ],
          [fixture.operatingBankAccountId, { kind: "outside" }],
        ]),
        firmFundsNodeId,
      ),
    ).toThrowError(/client money|composeTrustEntry/i);
  });

  it("THE FIRM-FUNDS DOOR REFUSES A THIRD LINE — a charge netted against a client deposit", async () => {
    const leaf = await seedMatterLeaf(fixture, "entity_diaz", "Diaz");
    const firmFundsAccountId = await firmFundsLedgerAccountId(fixture);
    expect(() =>
      assertTrustFirmFundsComposition(
        {
          description: "deposit net of the wire fee",
          effectiveDate: "2026-08-05",
          lines: [
            {
              accountId: fixture.bankLedgerAccountId,
              direction: "debit",
              amount: money(9_000, USD),
            },
            { accountId: leaf.ledgerAccountId, direction: "credit", amount: money(10_000, USD) },
            {
              accountId: firmFundsAccountId,
              direction: "debit",
              amount: money(1_000, USD),
            },
          ],
        },
        new Map<string, TrustAccountRole>([
          [fixture.bankLedgerAccountId, { kind: "bank", trustAccountId: fixture.trustAccountId }],
          [
            leaf.ledgerAccountId,
            {
              kind: "matter",
              trustAccountId: fixture.trustAccountId,
              nodeId: leaf.nodeId,
              clientEntityId: leaf.clientEntityId,
              matterId: leaf.matterId,
            },
          ],
          [
            firmFundsAccountId,
            { kind: "firmFunds", trustAccountId: fixture.trustAccountId, nodeId: firmFundsNodeId },
          ],
        ]),
        firmFundsNodeId,
      ),
    ).toThrowError(/exactly two lines/i);
  });

  it("the fitness pass re-proves over stored rows that no firm-funds entry touched client money", async () => {
    await fundCushion(fixture, 5_000);
    const leaf = await seedMatterLeaf(fixture, "entity_ellis", "Ellis");
    const clientDeposit = await composeTrustDeposit(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        to: {
          matterId: leaf.matterId,
          clientNodeName: "Trust — Ellis",
          matterLeafName: `Trust — Ellis — ${leaf.matterId}`,
        },
        amount: money(100_000, USD),
        effectiveDate: "2026-08-03",
        description: "Retainer received",
        method: "wire",
        source: "Ellis",
        purpose: "Advance on fees",
        recordedBy: fixture.memberUserId,
      },
      options,
    );
    await commit(fixture.database, clientDeposit.effect);
    const { results } = await firmFundsEntriesTouchingClientMoneyStatement(fixture.database).all();
    expect(results).toEqual([]);
    await assertTrustFitness(fixture.database);
  });
});

describe("the firm-funds record itself", () => {
  it("has no column a client or a matter could be named in", async () => {
    const { fixture } = await fixtureWithCarveOut();
    const { results } = await fixture.database
      .prepare("SELECT name FROM pragma_table_info('trust_firm_funds_movement')")
      .bind()
      .all<{ name: string }>();
    const columns = results.map((row) => row.name);
    // The narrowness is structural, and this is the assertion that says so: there is nowhere in the
    // row to put a client, a matter, a node, or a payee, so a record of this table cannot describe a
    // movement of somebody else's money whatever a caller intends.
    expect(columns).not.toContain("node_id");
    expect(columns).not.toContain("matter_id");
    expect(columns).not.toContain("client_entity_id");
    expect(columns).not.toContain("counterparty_name");
    expect(columns).not.toContain("payee");
  });

  it("is append-only — a recorded charge cannot be edited or deleted", async () => {
    const { fixture } = await fixtureWithCarveOut();
    await fundCushion(fixture, 5_000);
    const charge = await composeTrustBankCharge(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        amount: money(1_200, USD),
        effectiveDate: "2026-08-04",
        description: "Monthly account maintenance",
        recordedBy: fixture.memberUserId,
      },
      options,
    );
    await commit(fixture.database, charge.effect);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE trust_firm_funds_movement SET amount_minor = 1 WHERE id = ?1")
          .bind(charge.firmFundsMovementId)
          .run(),
      ),
    ).rejects.toThrowError(/append-only/);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("DELETE FROM trust_firm_funds_movement WHERE id = ?1")
          .bind(charge.firmFundsMovementId)
          .run(),
      ),
    ).rejects.toThrowError(/append-only/);
  });

  it("the database refuses a firm-funds record on an account with no carve-out open", async () => {
    const fixture = await trustFixture(CHARGE_ACCOUNT);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            "INSERT INTO trust_firm_funds_movement (id, trust_account_id, kind, amount_minor, currency, entry_id, method, reference, description, recorded_by, effective_date, recorded_at) VALUES (?1, ?2, 'bank_charge', 100, 'USD', ?3, 'bank_debit', NULL, 'fabricated', ?4, '2026-08-31', '2026-08-31T00:00:00.000Z')",
          )
          .bind(
            newIdentifier("trustFirmFundsMovement"),
            fixture.trustAccountId,
            newIdentifier("ledgerEntry"),
            fixture.memberUserId,
          )
          .run(),
      ),
    ).rejects.toThrowError(/own funds|FOREIGN KEY/i);
  });
});

describe("the three-way proof over an account that keeps a cushion", () => {
  it("BALANCES: book equals the client ledgers PLUS the firm's own funds, and neither leg absorbs the other", async () => {
    const { fixture } = await fixtureWithCarveOut();
    const leaf = await seedMatterLeaf(fixture, "entity_vance", "Vance");
    const clientDeposit = await composeTrustDeposit(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        to: {
          matterId: leaf.matterId,
          clientNodeName: "Trust — Vance",
          matterLeafName: `Trust — Vance — ${leaf.matterId}`,
        },
        amount: money(500_000, USD),
        effectiveDate: "2026-08-02",
        description: "Retainer received",
        method: "check",
        reference: "1041",
        source: "Vance Holdings",
        purpose: "Advance on fees",
        recordedBy: fixture.memberUserId,
      },
      options,
    );
    await commit(fixture.database, clientDeposit.effect);
    const cushionDeposit = await composeTrustFirmFundsDeposit(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        amount: money(25_000, USD),
        effectiveDate: "2026-08-02",
        description: "Firm funds to cover bank service charges",
        method: "electronic_transfer",
        recordedBy: fixture.memberUserId,
      },
      options,
    );
    await commit(fixture.database, cushionDeposit.effect);

    // The bank holds both: half a million of client money and the firm's twenty-five-dollar cushion.
    const statement = await composeTrustBankStatement(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        periodStart: "2026-08-01",
        periodEnd: "2026-08-04",
        openingBalance: money(0, USD),
        closingBalance: money(525_000, USD),
        statementReference: "2026-08",
        source: "entered",
        lines: [
          {
            postedOn: "2026-08-02",
            direction: "deposit",
            amount: money(500_000, USD),
            description: "DEPOSIT CHECK 1041",
            reference: "1041",
            counterpartyName: "Vance Holdings",
          },
          {
            postedOn: "2026-08-02",
            direction: "deposit",
            amount: money(25_000, USD),
            description: "TRANSFER FROM OPERATING",
            reference: null,
            counterpartyName: null,
          },
        ],
        recordedBy: fixture.memberUserId,
      },
      options,
    );
    await commit(fixture.database, statement.effect);
    const opened = await openTrustReconciliation(
      fixture.database,
      { statementId: statement.statementId, openedBy: fixture.memberUserId },
      options,
    );
    await commit(fixture.database, opened.effect);

    // Both items cleared, so the bank leg has nothing outstanding and the only interesting
    // comparison left is book against client-plus-cushion.
    const lines = await readTrustBankStatementLines(fixture.database, statement.statementId);
    for (const [lineAmount, entryId] of [
      [500_000, clientDeposit.entryId],
      [25_000, cushionDeposit.entryId],
    ] as const) {
      const line = lines.find((candidate) => candidate.amountMinor === lineAmount);
      if (line === undefined) throw new Error("the statement was recorded with both lines");
      const match = await composeTrustReconciliationMatch(
        fixture.database,
        {
          reconciliationId: opened.reconciliationId,
          statementLineId: line.id,
          entryId,
          matchedBy: fixture.memberUserId,
        },
        options,
      );
      await commit(fixture.database, match.effect);
    }

    const { proof } = await readTrustThreeWayProof(fixture.database, opened.reconciliationId);
    expect(proof.bookBalanceMinor).toBe(525_000);
    // The client leg is what the firm owes OTHER PEOPLE and excludes the cushion; the cushion is its
    // own figure. Folding it into the client total would tie out while asserting firm money is
    // client money, and leaving it out of the comparison would report a book-to-client disagreement
    // on every account that enabled the carve-out.
    expect(proof.clientLedgerTotalMinor).toBe(500_000);
    expect(proof.firmFundsMinor).toBe(25_000);
    expect(proof.disagreements).toEqual([]);
    expect(proof.balanced).toBe(true);

    const closed = await closeTrustReconciliation(
      fixture.database,
      opened.reconciliationId,
      fixture.memberUserId,
      options,
    );
    await commit(fixture.database, closed.effect);
    const frozen = await readTrustReconciliation(fixture.database, opened.reconciliationId);
    expect(frozen.frozenProof?.firmFundsMinor).toBe(25_000);
    expect(frozen.frozenProof?.clientLedgerTotalMinor).toBe(500_000);
    await assertTrustFitness(fixture.database);
  });
});
