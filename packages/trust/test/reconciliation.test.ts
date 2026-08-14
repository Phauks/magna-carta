import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { LedgerEntryId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import {
  composeTrustBankStatement,
  readTrustBankStatement,
  readTrustBankStatementLines,
} from "../src/bank-statements.ts";
import { assertTrustFitness } from "../src/fitness.ts";
import {
  composeTrustReconciliationMatch,
  composeTrustReconciliationUnmatch,
  readActiveTrustReconciliationMatches,
  readTrustMatchSuggestions,
} from "../src/matching.ts";
import { composeTrustDeposit } from "../src/movements.ts";
import {
  closeTrustReconciliation,
  openTrustReconciliation,
  readTrustReconciliation,
  readTrustThreeWayProof,
} from "../src/reconciliation.ts";
import { MAX_TRUST_RECONCILIATION_ROWS } from "../src/statements.ts";
import { readOutstandingTrustBankItems } from "../src/three-way-proof.ts";
import { TrustValidationError } from "../src/trust-validation.ts";
import { clock, commit, expectRefusal, options, seedMatter, trustFixture } from "./support.ts";

const usd = (minor: number) => money(minor, USD);
const RECORDER = "user_recorder" as UserId;
const RECONCILER = "user_reconciler" as UserId;

const fixtureWithJurisdiction = () => trustFixture({ jurisdiction: "US-NV" });

type Fixture = Awaited<ReturnType<typeof trustFixture>>;

// The destination names only the matter — the client is derived from that matter's own client party.
const leafReference = (matterId: MatterId, label: string) => ({
  matterId,
  clientNodeName: `Trust — ${label}`,
  matterLeafName: `Trust — ${label} — ${matterId}`,
});

// One deposit into a fresh matter leaf, returning the ledger entry it posted — which is the book
// item a statement line clears.
async function depositInto(
  fixture: Fixture,
  label: string,
  amountMinor: number,
  effectiveDate: string,
  reference: string | null = null,
): Promise<{ entryId: LedgerEntryId; matterId: MatterId }> {
  const matterId = await seedMatter(fixture, label, `entity_${label.toLowerCase()}`);
  const deposit = await composeTrustDeposit(
    fixture.database,
    {
      trustAccountId: fixture.trustAccountId,
      to: leafReference(matterId, label),
      amount: usd(amountMinor),
      effectiveDate,
      description: `${label} retainer received`,
      method: "check",
      reference,
      source: `${label} Holdings`,
      purpose: "Advance on fees and costs",
      recordedBy: RECORDER,
    },
    options,
  );
  await commit(fixture.database, deposit.effect);
  return { entryId: deposit.entryId, matterId };
}

interface StatementLineSpec {
  readonly postedOn: string;
  readonly direction: "deposit" | "withdrawal";
  readonly amountMinor: number;
  readonly description: string;
  readonly reference?: string | null;
  readonly counterpartyName?: string | null;
}

async function recordStatement(
  fixture: Fixture,
  closingBalanceMinor: number,
  lines: readonly StatementLineSpec[],
  periodStart = "2026-08-01",
  periodEnd = "2026-08-05",
) {
  const statement = await composeTrustBankStatement(
    fixture.database,
    {
      trustAccountId: fixture.trustAccountId,
      periodStart,
      periodEnd,
      openingBalance: usd(0),
      closingBalance: usd(closingBalanceMinor),
      statementReference: "2026-08",
      source: "entered",
      lines: lines.map((line) => ({
        postedOn: line.postedOn,
        direction: line.direction,
        amount: usd(line.amountMinor),
        description: line.description,
        reference: line.reference ?? null,
        counterpartyName: line.counterpartyName ?? null,
      })),
      recordedBy: RECONCILER,
    },
    options,
  );
  await commit(fixture.database, statement.effect);
  return statement;
}

async function openedReconciliation(fixture: Fixture, statementId: string) {
  const opened = await openTrustReconciliation(
    fixture.database,
    { statementId: statementId as never, openedBy: RECONCILER },
    options,
  );
  await commit(fixture.database, opened.effect);
  return opened.reconciliationId;
}

describe("bank statement", () => {
  it("records the statement and every line in one batch, with the bank's own figures", async () => {
    const fixture = await fixtureWithJurisdiction();
    const statement = await recordStatement(fixture, 750000, [
      {
        postedOn: "2026-08-02",
        direction: "deposit",
        amountMinor: 500000,
        description: "DEPOSIT CHECK 1041",
        reference: "1041",
        counterpartyName: "Webb Holdings",
      },
      {
        postedOn: "2026-08-03",
        direction: "deposit",
        amountMinor: 250000,
        description: "DEPOSIT CHECK 2201",
      },
    ]);

    const recorded = await readTrustBankStatement(fixture.database, statement.statementId);
    expect(recorded.closingBalanceMinor).toBe(750000);
    expect(recorded.source).toBe("entered");
    const lines = await readTrustBankStatementLines(fixture.database, statement.statementId);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.counterpartyName).toBe("Webb Holdings");
  });

  // The floor guards the firm's book and cannot guard the bank. A statement that could not record an
  // overdrawn closing balance could not record the condition reconciliation exists to catch.
  it("records a negative closing balance rather than refusing it", async () => {
    const fixture = await fixtureWithJurisdiction();
    const statement = await composeTrustBankStatement(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        periodStart: "2026-08-01",
        periodEnd: "2026-08-05",
        openingBalance: usd(0),
        closingBalance: usd(-4500),
        source: "entered",
        lines: [
          {
            postedOn: "2026-08-04",
            direction: "withdrawal",
            amount: usd(4500),
            description: "RETURNED ITEM FEE",
          },
        ],
        recordedBy: RECONCILER,
      },
      options,
    );
    await commit(fixture.database, statement.effect);
    const recorded = await readTrustBankStatement(fixture.database, statement.statementId);
    expect(recorded.closingBalanceMinor).toBe(-4500);
  });

  it("refuses a line dated outside the period it is filed under", async () => {
    const fixture = await fixtureWithJurisdiction();
    await expect(
      expectRefusal(() =>
        recordStatement(fixture, 500000, [
          {
            postedOn: "2026-09-04",
            direction: "deposit",
            amountMinor: 500000,
            description: "DEPOSIT",
          },
        ]),
      ),
    ).rejects.toMatchObject({ code: "statement-line-outside-period" } satisfies Partial<
      Pick<TrustValidationError, "code">
    >);
  });

  it("is append-only: a recorded statement and its lines refuse an update", async () => {
    const fixture = await fixtureWithJurisdiction();
    const statement = await recordStatement(fixture, 100000, [
      { postedOn: "2026-08-02", direction: "deposit", amountMinor: 100000, description: "DEPOSIT" },
    ]);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE trust_bank_statement SET closing_balance_minor = 1 WHERE id = ?1")
          .bind(statement.statementId)
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE trust_bank_statement_line SET amount_minor = 1 WHERE statement_id = ?1")
          .bind(statement.statementId)
          .run(),
      ),
    ).rejects.toThrow(/append-only/);
  });
});

describe("the three-way proof", () => {
  it("balances when every recorded item is on the statement and matched", async () => {
    const fixture = await fixtureWithJurisdiction();
    const webb = await depositInto(fixture, "Webb", 500000, "2026-08-02", "1041");
    const shaw = await depositInto(fixture, "Shaw", 250000, "2026-08-03", "2201");
    const statement = await recordStatement(fixture, 750000, [
      {
        postedOn: "2026-08-02",
        direction: "deposit",
        amountMinor: 500000,
        description: "DEPOSIT CHECK 1041",
        reference: "1041",
      },
      {
        postedOn: "2026-08-03",
        direction: "deposit",
        amountMinor: 250000,
        description: "DEPOSIT CHECK 2201",
        reference: "2201",
      },
    ]);
    const reconciliationId = await openedReconciliation(fixture, statement.statementId);
    const lines = await readTrustBankStatementLines(fixture.database, statement.statementId);

    for (const [index, entryId] of [webb.entryId, shaw.entryId].entries()) {
      const match = await composeTrustReconciliationMatch(
        fixture.database,
        {
          reconciliationId,
          statementLineId: lines[index]?.id as never,
          entryId,
          matchedBy: RECONCILER,
        },
        options,
      );
      await commit(fixture.database, match.effect);
    }

    const { proof } = await readTrustThreeWayProof(fixture.database, reconciliationId);
    expect(proof.statementClosingMinor).toBe(750000);
    expect(proof.adjustedBankMinor).toBe(750000);
    expect(proof.bookBalanceMinor).toBe(750000);
    expect(proof.clientLedgerTotalMinor).toBe(750000);
    expect(proof.outstandingDeposits).toHaveLength(0);
    expect(proof.unmatchedStatementLines).toHaveLength(0);
    expect(proof.disagreements).toEqual([]);
    expect(proof.balanced).toBe(true);
    await assertTrustFitness(fixture.database);
  });

  // The proof must never be computed from a truncated outstanding list. The read is capped so a
  // runaway period cannot pull an unbounded result set into a request handler, and the cap used to
  // be SILENT: the totals, the adjusted bank figure, and the balanced verdict were all derived from
  // whatever rows came back, internally consistent and short by everything past the ceiling — and
  // closing froze exactly those numbers as the firm's attestation.
  it("refuses the proof rather than computing it from a truncated outstanding list", async () => {
    const fixture = await fixtureWithJurisdiction();
    const webb = await depositInto(fixture, "Webb", 500000, "2026-08-02", "1041");
    expect(webb.entryId).toBeDefined();
    const statement = await recordStatement(fixture, 500000, [
      {
        postedOn: "2026-08-02",
        direction: "deposit",
        amountMinor: 500000,
        description: "DEPOSIT CHECK 1041",
        reference: "1041",
      },
    ]);
    const reconciliationId = await openedReconciliation(fixture, statement.statementId);

    // One past the ceiling, written straight to the ledger: the read counts entries touching the
    // trust bank account that no binding match clears, and the composers are far too slow to build
    // five thousand of them in a test. What matters is the row count the read sees.
    const filler = MAX_TRUST_RECONCILIATION_ROWS;
    for (let start = 0; start < filler; start += 500) {
      const statements = [];
      for (let index = start; index < Math.min(start + 500, filler); index += 1) {
        const entryId = newIdentifier("ledgerEntry");
        statements.push(
          fixture.database
            .prepare(
              "INSERT INTO ledger_entry (id, description, effective_date, recorded_at) VALUES (?1, ?2, ?3, ?4)",
            )
            .bind(entryId, `Uncleared item ${index}`, "2026-08-02", clock.now()),
          fixture.database
            .prepare(
              "INSERT INTO ledger_line (id, entry_id, account_id, line_index, direction, amount_minor) VALUES (?1, ?2, ?3, 0, 'debit', 1)",
            )
            .bind(newIdentifier("ledgerLine"), entryId, fixture.bankLedgerAccountId),
        );
      }
      await fixture.database.batch(statements);
    }

    await expect(readTrustThreeWayProof(fixture.database, reconciliationId)).rejects.toMatchObject({
      code: "reconciliation-outstanding-items-truncated",
    });
    // And the close refuses with it, rather than freezing a total it could not see all of.
    await expect(
      closeTrustReconciliation(fixture.database, reconciliationId, RECONCILER, options),
    ).rejects.toMatchObject({ code: "reconciliation-outstanding-items-truncated" });
  });

  // The proof rests on TWO lists, and the second one had no probe at all. It was whole only because
  // a statement is separately capped at a line count that happens to sit below this ceiling — an
  // arithmetic accident nothing in either constant states, and nothing would have caught if either
  // moved. `frozen_unmatched_line_count` is one of the figures a close freezes as the firm's
  // attestation, so a short list here is the same failure a short outstanding list is.
  it("refuses the proof rather than computing it from a truncated unmatched-line list", async () => {
    const fixture = await fixtureWithJurisdiction();
    const statement = await recordStatement(fixture, 500000, [
      {
        postedOn: "2026-08-02",
        direction: "deposit",
        amountMinor: 500000,
        description: "DEPOSIT CHECK 1041",
      },
    ]);
    const reconciliationId = await openedReconciliation(fixture, statement.statementId);

    // One past the ceiling, written straight onto the statement: the composer caps a statement at
    // its own, lower limit, and what is under test is the row count the READ sees.
    const filler = MAX_TRUST_RECONCILIATION_ROWS;
    for (let start = 0; start < filler; start += 500) {
      const statements = [];
      for (let index = start; index < Math.min(start + 500, filler); index += 1) {
        statements.push(
          fixture.database
            .prepare(
              "INSERT INTO trust_bank_statement_line (id, statement_id, posted_on, direction, amount_minor, description, reference, counterparty_name, source_row_number, recorded_at) VALUES (?1, ?2, '2026-08-02', 'deposit', 1, ?3, NULL, NULL, NULL, ?4)",
            )
            .bind(
              newIdentifier("trustBankStatementLine"),
              statement.statementId,
              `Unaccounted line ${index}`,
              clock.now(),
            ),
        );
      }
      await fixture.database.batch(statements);
    }

    await expect(readTrustThreeWayProof(fixture.database, reconciliationId)).rejects.toMatchObject({
      code: "reconciliation-unmatched-lines-truncated",
    });
    // And the close refuses with it, rather than freezing a count it could not see all of.
    await expect(
      closeTrustReconciliation(fixture.database, reconciliationId, RECONCILER, options),
    ).rejects.toMatchObject({ code: "reconciliation-unmatched-lines-truncated" });
    // And so does the surface a member works the same list from, which reads it through the same
    // function — a member shown a silently short list would believe they had worked the whole one.
    await expect(
      readTrustMatchSuggestions(fixture.database, reconciliationId),
    ).rejects.toMatchObject({ code: "reconciliation-unmatched-lines-truncated" });
  });

  // The classic deposit in transit: recorded before the period ended, credited by the bank after it.
  // The adjustment is what makes the two sides agree, and the item is named rather than absorbed.
  it("adjusts for a deposit in transit and still balances", async () => {
    const fixture = await fixtureWithJurisdiction();
    const webb = await depositInto(fixture, "Webb", 500000, "2026-08-02", "1041");
    await depositInto(fixture, "Shaw", 250000, "2026-08-04", "2201");
    const statement = await recordStatement(fixture, 500000, [
      {
        postedOn: "2026-08-02",
        direction: "deposit",
        amountMinor: 500000,
        description: "DEPOSIT CHECK 1041",
        reference: "1041",
      },
    ]);
    const reconciliationId = await openedReconciliation(fixture, statement.statementId);
    const lines = await readTrustBankStatementLines(fixture.database, statement.statementId);
    const match = await composeTrustReconciliationMatch(
      fixture.database,
      {
        reconciliationId,
        statementLineId: lines[0]?.id as never,
        entryId: webb.entryId,
        matchedBy: RECONCILER,
      },
      options,
    );
    await commit(fixture.database, match.effect);

    const { proof } = await readTrustThreeWayProof(fixture.database, reconciliationId);
    expect(proof.outstandingDeposits).toHaveLength(1);
    expect(proof.outstandingDepositsMinor).toBe(250000);
    expect(proof.adjustedBankMinor).toBe(750000);
    expect(proof.bookBalanceMinor).toBe(750000);
    expect(proof.clientLedgerTotalMinor).toBe(750000);
    expect(proof.balanced).toBe(true);
  });

  // The bank fee nobody recorded: on the statement, in no ledger. This is the whole reason
  // reconciliation is a correctness feature rather than a report, and the proof must say so out loud
  // instead of quietly agreeing.
  it("records WHICH leg disagrees and by how much when the bank knows something the book does not", async () => {
    const fixture = await fixtureWithJurisdiction();
    const webb = await depositInto(fixture, "Webb", 500000, "2026-08-02", "1041");
    const statement = await recordStatement(fixture, 497500, [
      {
        postedOn: "2026-08-02",
        direction: "deposit",
        amountMinor: 500000,
        description: "DEPOSIT CHECK 1041",
        reference: "1041",
      },
      {
        postedOn: "2026-08-04",
        direction: "withdrawal",
        amountMinor: 2500,
        description: "MONTHLY SERVICE CHARGE",
      },
    ]);
    const reconciliationId = await openedReconciliation(fixture, statement.statementId);
    const lines = await readTrustBankStatementLines(fixture.database, statement.statementId);
    const depositLine = lines.find((line) => line.description === "DEPOSIT CHECK 1041");
    const match = await composeTrustReconciliationMatch(
      fixture.database,
      {
        reconciliationId,
        statementLineId: depositLine?.id as never,
        entryId: webb.entryId,
        matchedBy: RECONCILER,
      },
      options,
    );
    await commit(fixture.database, match.effect);

    const { proof } = await readTrustThreeWayProof(fixture.database, reconciliationId);
    expect(proof.balanced).toBe(false);
    // The bank charged 2,500 the firm never recorded, so the bank leg is short of the book by it.
    expect(proof.disagreements).toEqual([{ leg: "bank-to-book", differenceMinor: -2500 }]);
    // Book and client still agree by construction — the composition guard held, and the proof says
    // so by naming only the one leg.
    expect(proof.bookBalanceMinor).toBe(500000);
    expect(proof.clientLedgerTotalMinor).toBe(500000);
    // And the unrecorded item is a first-class outcome, not an error: it is the line to act on.
    expect(proof.unmatchedStatementLines).toHaveLength(1);
    expect(proof.unmatchedStatementLines[0]?.description).toBe("MONTHLY SERVICE CHARGE");
  });

  it("reports unmatched on BOTH sides as outcomes rather than refusals", async () => {
    const fixture = await fixtureWithJurisdiction();
    await depositInto(fixture, "Webb", 500000, "2026-08-02", "1041");
    const statement = await recordStatement(fixture, 310000, [
      {
        postedOn: "2026-08-03",
        direction: "deposit",
        amountMinor: 310000,
        description: "WIRE IN — UNKNOWN ORIGIN",
      },
    ]);
    const reconciliationId = await openedReconciliation(fixture, statement.statementId);

    const { proof } = await readTrustThreeWayProof(fixture.database, reconciliationId);
    expect(proof.unmatchedStatementLines).toHaveLength(1);
    expect(proof.outstandingDeposits).toHaveLength(1);
    expect(proof.balanced).toBe(false);
    // Nothing refused, nothing threw, and the reconciliation is still open and workable.
    const reconciliation = await readTrustReconciliation(fixture.database, reconciliationId);
    expect(reconciliation.status).toBe("open");
  });
});

describe("matching", () => {
  it("suggests candidates with the reasons, and matches nothing on its own", async () => {
    const fixture = await fixtureWithJurisdiction();
    const webb = await depositInto(fixture, "Webb", 500000, "2026-08-02", "1041");
    const statement = await recordStatement(fixture, 500000, [
      {
        postedOn: "2026-08-02",
        direction: "deposit",
        amountMinor: 500000,
        description: "DEPOSIT CHECK 1041",
        reference: "1041",
        counterpartyName: "Webb Holdings",
      },
    ]);
    const reconciliationId = await openedReconciliation(fixture, statement.statementId);

    const suggested = await readTrustMatchSuggestions(fixture.database, reconciliationId);
    expect(suggested.suggestions).toHaveLength(1);
    expect(suggested.suggestions[0]?.entryId).toBe(webb.entryId);
    expect(suggested.suggestions[0]?.signals).toEqual([
      "amount-equal",
      "same-day",
      "reference-equal",
      "counterparty-similar",
    ]);

    // Reading suggestions wrote nothing: the pair is still unmatched, and the proof still says so.
    expect(await readActiveTrustReconciliationMatches(fixture.database, reconciliationId)).toEqual(
      [],
    );
    const { proof } = await readTrustThreeWayProof(fixture.database, reconciliationId);
    expect(proof.unmatchedStatementLines).toHaveLength(1);
  });

  // ONE definition of "unmatched line". The proof counts them and a close freezes the count; the
  // matching surface shows a member the same list to work through. Derived twice — once in SQL and
  // once by subtracting the active matches in memory — both forms answer plausibly, so the day they
  // stopped agreeing nothing would say so and a firm would clear a list its own attestation did not
  // count. This walks the cases where two such derivations would part company first.
  it("shows the matching surface exactly the lines the proof counts as unmatched", async () => {
    const fixture = await fixtureWithJurisdiction();
    const webb = await depositInto(fixture, "Webb", 500000, "2026-08-02", "1041");
    const statement = await recordStatement(fixture, 497500, [
      {
        postedOn: "2026-08-02",
        direction: "deposit",
        amountMinor: 500000,
        description: "DEPOSIT CHECK 1041",
        reference: "1041",
      },
      {
        postedOn: "2026-08-04",
        direction: "withdrawal",
        amountMinor: 2500,
        description: "MONTHLY SERVICE CHARGE",
      },
    ]);
    const reconciliationId = await openedReconciliation(fixture, statement.statementId);
    const lines = await readTrustBankStatementLines(fixture.database, statement.statementId);
    const depositLine = lines.find((line) => line.description === "DEPOSIT CHECK 1041");

    // The two reads, asked the same question, at every step below.
    const agreedUnmatchedLineIds = async (id: typeof reconciliationId) => {
      const { proof } = await readTrustThreeWayProof(fixture.database, id);
      const suggested = await readTrustMatchSuggestions(fixture.database, id);
      const fromProof = proof.unmatchedStatementLines.map((line) => line.id);
      expect(suggested.unmatchedLines.map((line) => line.id)).toEqual(fromProof);
      return fromProof;
    };

    expect(await agreedUnmatchedLineIds(reconciliationId)).toHaveLength(2);

    const match = await composeTrustReconciliationMatch(
      fixture.database,
      {
        reconciliationId,
        statementLineId: depositLine?.id as never,
        entryId: webb.entryId,
        matchedBy: RECONCILER,
      },
      options,
    );
    await commit(fixture.database, match.effect);
    expect(await agreedUnmatchedLineIds(reconciliationId)).toEqual([
      lines.find((line) => line.description === "MONTHLY SERVICE CHARGE")?.id,
    ]);

    // A WITHDRAWN match: active-ness is derived from the absence of a withdrawal row rather than
    // from a column, so a reader that missed the withdrawal would hide a line a person has to work.
    const withdrawal = await composeTrustReconciliationUnmatch(
      fixture.database,
      { matchId: match.matchId, reconciliationId, withdrawnBy: RECONCILER },
      options,
    );
    await commit(fixture.database, withdrawal.effect);
    expect(await agreedUnmatchedLineIds(reconciliationId)).toHaveLength(2);

    // A SUPERSEDED period. Both line reads are scoped to one reconciliation, which is what the
    // outstanding-item read deliberately is not: a line's fate in some other period says nothing
    // about whether THIS one accounted for it, so the replacement starts with both lines open and
    // the superseded period keeps reporting what it matched.
    const kept = await composeTrustReconciliationMatch(
      fixture.database,
      {
        reconciliationId,
        statementLineId: depositLine?.id as never,
        entryId: webb.entryId,
        matchedBy: RECONCILER,
      },
      options,
    );
    await commit(fixture.database, kept.effect);
    const redone = await openTrustReconciliation(
      fixture.database,
      {
        statementId: statement.statementId,
        supersedesReconciliationId: reconciliationId,
        openedBy: RECONCILER,
      },
      options,
    );
    await commit(fixture.database, redone.effect);

    expect(await agreedUnmatchedLineIds(redone.reconciliationId)).toHaveLength(2);
    expect(await agreedUnmatchedLineIds(reconciliationId)).toHaveLength(1);
  });

  it("offers no candidate when the amount or the direction does not correspond", async () => {
    const fixture = await fixtureWithJurisdiction();
    await depositInto(fixture, "Webb", 500000, "2026-08-02");
    const statement = await recordStatement(fixture, 400000, [
      {
        postedOn: "2026-08-02",
        direction: "deposit",
        amountMinor: 400000,
        description: "DEPOSIT — DIFFERENT AMOUNT",
      },
      {
        postedOn: "2026-08-03",
        direction: "withdrawal",
        amountMinor: 500000,
        description: "WITHDRAWAL — WRONG WAY",
      },
    ]);
    const reconciliationId = await openedReconciliation(fixture, statement.statementId);
    const suggested = await readTrustMatchSuggestions(fixture.database, reconciliationId);
    expect(suggested.suggestions).toEqual([]);
  });

  // The URL asserts a containment, so the handler has to check it. Without this the first path
  // segment is decoration: any reconciliation identifier at all withdraws the named match and
  // answers 201, so a client-side mix-up silently moves a withdrawal to the wrong period.
  it("refuses to withdraw a match through a reconciliation it does not belong to", async () => {
    const fixture = await fixtureWithJurisdiction();
    const webb = await depositInto(fixture, "Webb", 500000, "2026-08-02");
    const statement = await recordStatement(fixture, 500000, [
      { postedOn: "2026-08-02", direction: "deposit", amountMinor: 500000, description: "DEPOSIT" },
    ]);
    const reconciliationId = await openedReconciliation(fixture, statement.statementId);
    const lines = await readTrustBankStatementLines(fixture.database, statement.statementId);
    const match = await composeTrustReconciliationMatch(
      fixture.database,
      {
        reconciliationId,
        statementLineId: lines[0]?.id as never,
        entryId: webb.entryId,
        matchedBy: RECONCILER,
      },
      options,
    );
    await commit(fixture.database, match.effect);

    const otherStatement = await recordStatement(
      fixture,
      500000,
      [
        {
          postedOn: "2026-09-02",
          direction: "deposit",
          amountMinor: 500000,
          description: "DEPOSIT",
        },
      ],
      "2026-09-01",
      "2026-09-30",
    );
    const otherReconciliationId = await openedReconciliation(fixture, otherStatement.statementId);

    await expect(
      composeTrustReconciliationUnmatch(
        fixture.database,
        {
          matchId: match.matchId,
          reconciliationId: otherReconciliationId,
          withdrawnBy: RECONCILER,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "match-belongs-to-another-reconciliation" });

    // Naming the right one still works.
    const withdrawal = await composeTrustReconciliationUnmatch(
      fixture.database,
      { matchId: match.matchId, reconciliationId, withdrawnBy: RECONCILER },
      options,
    );
    await commit(fixture.database, withdrawal.effect);
    expect(await readActiveTrustReconciliationMatches(fixture.database, reconciliationId)).toEqual(
      [],
    );
  });

  it("withdraws a wrong match by appending, never by deleting", async () => {
    const fixture = await fixtureWithJurisdiction();
    const webb = await depositInto(fixture, "Webb", 500000, "2026-08-02");
    const statement = await recordStatement(fixture, 500000, [
      { postedOn: "2026-08-02", direction: "deposit", amountMinor: 500000, description: "DEPOSIT" },
    ]);
    const reconciliationId = await openedReconciliation(fixture, statement.statementId);
    const lines = await readTrustBankStatementLines(fixture.database, statement.statementId);
    const match = await composeTrustReconciliationMatch(
      fixture.database,
      {
        reconciliationId,
        statementLineId: lines[0]?.id as never,
        entryId: webb.entryId,
        matchedBy: RECONCILER,
      },
      options,
    );
    await commit(fixture.database, match.effect);
    expect(
      await readActiveTrustReconciliationMatches(fixture.database, reconciliationId),
    ).toHaveLength(1);

    const withdrawal = await composeTrustReconciliationUnmatch(
      fixture.database,
      { matchId: match.matchId, reconciliationId, withdrawnBy: RECONCILER },
      options,
    );
    await commit(fixture.database, withdrawal.effect);

    expect(await readActiveTrustReconciliationMatches(fixture.database, reconciliationId)).toEqual(
      [],
    );
    // Both rows survive: that somebody asserted the pairing and then took it back is the record.
    const { results } = await fixture.database
      .prepare(
        "SELECT COUNT(*) AS rows FROM trust_reconciliation_match WHERE reconciliation_id = ?1",
      )
      .bind(reconciliationId)
      .all<{ rows: number }>();
    expect(results[0]?.rows).toBe(2);
    // And the item is outstanding again, which is what makes a withdrawal a real remedy.
    const reconciliation = await readTrustReconciliation(fixture.database, reconciliationId);
    expect(await readOutstandingTrustBankItems(fixture.database, reconciliation)).toHaveLength(1);
    await assertTrustFitness(fixture.database);
  });

  it("refuses a second active match on the same line", async () => {
    const fixture = await fixtureWithJurisdiction();
    const webb = await depositInto(fixture, "Webb", 500000, "2026-08-02");
    const shaw = await depositInto(fixture, "Shaw", 500000, "2026-08-03");
    const statement = await recordStatement(fixture, 500000, [
      { postedOn: "2026-08-02", direction: "deposit", amountMinor: 500000, description: "DEPOSIT" },
    ]);
    const reconciliationId = await openedReconciliation(fixture, statement.statementId);
    const lines = await readTrustBankStatementLines(fixture.database, statement.statementId);
    const first = await composeTrustReconciliationMatch(
      fixture.database,
      {
        reconciliationId,
        statementLineId: lines[0]?.id as never,
        entryId: webb.entryId,
        matchedBy: RECONCILER,
      },
      options,
    );
    await commit(fixture.database, first.effect);

    await expect(
      expectRefusal(() =>
        composeTrustReconciliationMatch(
          fixture.database,
          {
            reconciliationId,
            statementLineId: lines[0]?.id as never,
            entryId: shaw.entryId,
            matchedBy: RECONCILER,
          },
          options,
        ),
      ),
    ).rejects.toMatchObject({ code: "statement-line-already-matched" });
  });

  // The database is the guarantee, not the composer: a caller that reached the table another way
  // still cannot tie a line from a different period to this reconciliation.
  it("refuses at the database a match naming a line from another statement", async () => {
    const fixture = await fixtureWithJurisdiction();
    const webb = await depositInto(fixture, "Webb", 500000, "2026-08-02");
    const august = await recordStatement(fixture, 500000, [
      { postedOn: "2026-08-02", direction: "deposit", amountMinor: 500000, description: "DEPOSIT" },
    ]);
    const july = await recordStatement(
      fixture,
      500000,
      [
        {
          postedOn: "2026-07-05",
          direction: "deposit",
          amountMinor: 500000,
          description: "DEPOSIT",
        },
      ],
      "2026-07-01",
      "2026-07-31",
    );
    const reconciliationId = await openedReconciliation(fixture, august.statementId);
    const julyLines = await readTrustBankStatementLines(fixture.database, july.statementId);

    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare(
            "INSERT INTO trust_reconciliation_match (id, reconciliation_id, statement_line_id, entry_id, unmatches_match_id, matched_by, matched_at) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6)",
          )
          .bind(
            "trustReconciliationMatch_forced",
            reconciliationId,
            julyLines[0]?.id,
            webb.entryId,
            RECONCILER,
            clock.now(),
          )
          .run(),
      ),
    ).rejects.toThrow(/statement that reconciliation is about/);
  });
});

describe("closing a reconciliation", () => {
  it("freezes the proof, and the frozen figures never move again", async () => {
    const fixture = await fixtureWithJurisdiction();
    const webb = await depositInto(fixture, "Webb", 500000, "2026-08-02");
    const statement = await recordStatement(fixture, 500000, [
      { postedOn: "2026-08-02", direction: "deposit", amountMinor: 500000, description: "DEPOSIT" },
    ]);
    const reconciliationId = await openedReconciliation(fixture, statement.statementId);
    const lines = await readTrustBankStatementLines(fixture.database, statement.statementId);
    const match = await composeTrustReconciliationMatch(
      fixture.database,
      {
        reconciliationId,
        statementLineId: lines[0]?.id as never,
        entryId: webb.entryId,
        matchedBy: RECONCILER,
      },
      options,
    );
    await commit(fixture.database, match.effect);

    const closed = await closeTrustReconciliation(
      fixture.database,
      reconciliationId,
      RECONCILER,
      options,
    );
    await commit(fixture.database, closed.effect);

    const frozen = await readTrustReconciliation(fixture.database, reconciliationId);
    expect(frozen.status).toBe("closed");
    expect(frozen.closedBy).toBe(RECONCILER);
    expect(frozen.frozenProof).toEqual({
      statementClosingMinor: 500000,
      outstandingDepositsMinor: 0,
      outstandingDisbursementsMinor: 0,
      adjustedBankMinor: 500000,
      bookBalanceMinor: 500000,
      clientLedgerTotalMinor: 500000,
      firmFundsMinor: 0,
      unmatchedLineCount: 0,
      unmatchedItemCount: 0,
      balanced: true,
    });

    // A deposit backdated INTO the closed period moves the live proof and leaves the attestation
    // exactly as it was — which is the whole reason the frozen columns exist.
    await depositInto(fixture, "Later", 100000, "2026-08-04");
    const after = await readTrustThreeWayProof(fixture.database, reconciliationId);
    expect(after.proof.bookBalanceMinor).toBe(600000);
    expect(after.proof.outstandingDeposits).toHaveLength(1);
    expect(after.proof.adjustedBankMinor).toBe(600000);
    // The attestation is untouched: it still says what the period said when somebody signed it.
    expect(after.reconciliation.frozenProof?.bookBalanceMinor).toBe(500000);
    expect(after.reconciliation.frozenProof?.adjustedBankMinor).toBe(500000);
    expect(after.reconciliation.frozenProof?.unmatchedItemCount).toBe(0);
    await assertTrustFitness(fixture.database);
  });

  // The record of a problem is the value. A close that refused an unbalanced proof would leave firms
  // with a year of periods permanently open, which is the same as no record at all.
  it("closes an unbalanced period, recording that it did not tie out", async () => {
    const fixture = await fixtureWithJurisdiction();
    await depositInto(fixture, "Webb", 500000, "2026-08-02");
    const statement = await recordStatement(fixture, 497500, [
      { postedOn: "2026-08-02", direction: "deposit", amountMinor: 500000, description: "DEPOSIT" },
      {
        postedOn: "2026-08-02",
        direction: "withdrawal",
        amountMinor: 2500,
        description: "MONTHLY SERVICE CHARGE",
      },
    ]);
    const reconciliationId = await openedReconciliation(fixture, statement.statementId);

    const closed = await closeTrustReconciliation(
      fixture.database,
      reconciliationId,
      RECONCILER,
      options,
    );
    await commit(fixture.database, closed.effect);
    expect(closed.frozen.balanced).toBe(false);

    const frozen = await readTrustReconciliation(fixture.database, reconciliationId);
    expect(frozen.status).toBe("closed");
    expect(frozen.frozenProof?.balanced).toBe(false);
    // Both unmatched sides are counted on the frozen record, so a later reader knows what was open.
    expect(frozen.frozenProof?.unmatchedLineCount).toBe(2);
    expect(frozen.frozenProof?.unmatchedItemCount).toBe(1);
    await assertTrustFitness(fixture.database);
  });

  it("refuses a second close, and the database refuses a reopen outright", async () => {
    const fixture = await fixtureWithJurisdiction();
    await depositInto(fixture, "Webb", 500000, "2026-08-02");
    const statement = await recordStatement(fixture, 500000, [
      { postedOn: "2026-08-02", direction: "deposit", amountMinor: 500000, description: "DEPOSIT" },
    ]);
    const reconciliationId = await openedReconciliation(fixture, statement.statementId);
    const closed = await closeTrustReconciliation(
      fixture.database,
      reconciliationId,
      RECONCILER,
      options,
    );
    await commit(fixture.database, closed.effect);

    await expect(
      expectRefusal(() =>
        closeTrustReconciliation(fixture.database, reconciliationId, RECONCILER, options),
      ),
    ).rejects.toMatchObject({ code: "reconciliation-closed" });

    // Reopening is not an operation, and neither is quietly editing what a closed period attested
    // to: the first fails because the only update this row takes is its close, the second because a
    // closed row takes none at all.
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE trust_reconciliation SET status = 'open' WHERE id = ?1")
          .bind(reconciliationId)
          .run(),
      ),
    ).rejects.toThrow(/the only update a trust reconciliation takes is its close/);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE trust_reconciliation SET frozen_book_balance_minor = 1 WHERE id = ?1")
          .bind(reconciliationId)
          .run(),
      ),
    ).rejects.toThrow(/frozen/);
  });

  it("refuses a match against a closed reconciliation", async () => {
    const fixture = await fixtureWithJurisdiction();
    const webb = await depositInto(fixture, "Webb", 500000, "2026-08-02");
    const statement = await recordStatement(fixture, 500000, [
      { postedOn: "2026-08-02", direction: "deposit", amountMinor: 500000, description: "DEPOSIT" },
    ]);
    const reconciliationId = await openedReconciliation(fixture, statement.statementId);
    const closed = await closeTrustReconciliation(
      fixture.database,
      reconciliationId,
      RECONCILER,
      options,
    );
    await commit(fixture.database, closed.effect);
    const lines = await readTrustBankStatementLines(fixture.database, statement.statementId);

    await expect(
      expectRefusal(() =>
        composeTrustReconciliationMatch(
          fixture.database,
          {
            reconciliationId,
            statementLineId: lines[0]?.id as never,
            entryId: webb.entryId,
            matchedBy: RECONCILER,
          },
          options,
        ),
      ),
    ).rejects.toMatchObject({ code: "reconciliation-closed" });
  });
});
