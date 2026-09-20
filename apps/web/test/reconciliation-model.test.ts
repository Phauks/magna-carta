/*
 * What the reconciliation screen says about a period, asserted away from the screen.
 *
 * Three things are worth pinning here, and each one is a way a firm's books could be misread:
 *
 *   - THE PROOF'S STRUCTURE STANDS BEFORE THE FIGURES ARRIVE. Six terms, in one order, with their
 *     values withheld rather than the list being absent. A screen that rendered the terms only once
 *     the read landed would arrive as a block of furniture the reader has to take in at once.
 *   - WHAT THE FIRM ATTESTED TO IS NOT WHAT THE PERIOD COMES TO NOW. The same six terms arrange the
 *     frozen proof and the recomputed one, which is what lets a closed period show both without
 *     either being presented as the other.
 *   - NOTHING IS MATCHED AUTOMATICALLY. The candidates belong to ONE chosen line, and the control's
 *     own refusal is where the product says so.
 */
import { describe, expect, it } from "vitest";
import type {
  TrustBankItem,
  TrustFrozenProof,
  TrustMatchSuggestion,
  TrustReconciliation,
  TrustReconciliationMatch,
  TrustThreeWayProof,
} from "../src/lib/trust/trust-api.ts";
import {
  bankItemDirectionLabel,
  bankItemKindLabel,
  candidatesForLine,
  closeReading,
  countedPhrase,
  disagreementLegLabel,
  disagreementRows,
  matchRefusal,
  matchSignalsText,
  matchStandingLabel,
  proofFigures,
  verdictLabel,
} from "../src/lib/trust/reconciliation-model.ts";

const money = (amountMinor: number): string => `${String(amountMinor)} cents`;

const PROOF: TrustThreeWayProof = {
  trustAccountId: "trustAccount_bay",
  statementId: "trustBankStatement_1",
  asOfDate: "2026-08-31",
  currency: "USD",
  statementClosingMinor: 1_130_000,
  outstandingDeposits: [],
  outstandingDepositsMinor: 25_000,
  outstandingDisbursements: [],
  outstandingDisbursementsMinor: 5_000,
  adjustedBankMinor: 1_150_000,
  bookBalanceMinor: 1_150_000,
  clientLedgerTotalMinor: 1_150_000,
  unmatchedStatementLines: [],
  balanced: true,
  disagreements: [],
};

const FROZEN: TrustFrozenProof = {
  statementClosingMinor: 1_130_000,
  outstandingDepositsMinor: 25_000,
  outstandingDisbursementsMinor: 5_000,
  adjustedBankMinor: 1_150_000,
  bookBalanceMinor: 1_150_000,
  clientLedgerTotalMinor: 1_150_000,
  unmatchedLineCount: 0,
  unmatchedItemCount: 0,
  balanced: true,
};

const OPEN_RECONCILIATION: TrustReconciliation = {
  id: "trustReconciliation_1",
  trustAccountId: "trustAccount_bay",
  statementId: "trustBankStatement_1",
  status: "open",
  openedBy: "user_ada",
  openedAt: "2026-09-02T14:00:00Z",
  closedBy: null,
  closedAt: null,
  frozenProof: null,
  supersedesReconciliationId: null,
  note: null,
};

function item(over: Partial<TrustBankItem> = {}): TrustBankItem {
  return {
    ledgerEntryId: "ledgerEntry_1",
    effectiveDate: "2026-08-29",
    description: "Filing fee",
    bankDeltaMinor: -5_000,
    trustMovementId: "trustMovement_1",
    movementKind: "disbursement",
    trustTransferId: null,
    reference: null,
    counterpartyName: null,
    ...over,
  };
}

function suggestion(over: Partial<TrustMatchSuggestion> = {}): TrustMatchSuggestion {
  return {
    statementLineId: "trustBankStatementLine_1",
    ledgerEntryId: "ledgerEntry_1",
    signals: ["amount-equal", "same-day"],
    dayGap: 0,
    ...over,
  };
}

describe("the proof, as the screen arranges it", () => {
  it("stands as six named terms before a proof has arrived", () => {
    const figures = proofFigures(null, money);
    expect(figures.map((figure) => figure.label)).toEqual([
      "Statement Closing",
      "Outstanding Deposits",
      "Outstanding Disbursements",
      "Adjusted Bank",
      "Book Balance",
      "Client Ledgers",
    ]);
    expect(figures.every((figure) => figure.value === null)).toBe(true);
  });

  it("reads every figure through the surface's own money vocabulary", () => {
    expect(proofFigures(PROOF, money).map((figure) => figure.value)).toEqual([
      "1130000 cents",
      "25000 cents",
      "5000 cents",
      "1150000 cents",
      "1150000 cents",
      "1150000 cents",
    ]);
  });

  it("arranges the frozen proof through the same terms, so neither can be dressed as the other", () => {
    // A closed period shows both; what makes them tellable apart is the heading over each, never a
    // different set of words for the same six figures.
    expect(proofFigures(FROZEN, money).map((figure) => figure.label)).toEqual(
      proofFigures(PROOF, money).map((figure) => figure.label),
    );
  });

  it("names the leg that disagrees and the difference, and says nothing when none does", () => {
    expect(disagreementRows(PROOF, money)).toEqual([]);
    expect(
      disagreementRows(
        {
          ...PROOF,
          balanced: false,
          disagreements: [{ leg: "book-to-client", differenceMinor: 250 }],
        },
        money,
      ),
    ).toEqual([
      {
        identifier: "book-to-client",
        label: "Book to Client Ledgers",
        meaning: "The firm's record of the account set against what the client ledgers add up to.",
        difference: "250 cents",
      },
    ]);
    expect(disagreementLegLabel("bank-to-book")).toBe("Bank to Book");
  });

  it("gives the verdict two words, the same two for either proof", () => {
    expect(verdictLabel(true)).toBe("Balanced");
    expect(verdictLabel(false)).toBe("Did Not Balance");
  });
});

describe("the recorded items, as the right-hand table reads them", () => {
  it("takes the direction from the sign the record carries, never from the kind", () => {
    expect(bankItemDirectionLabel(item())).toBe("Out");
    expect(bankItemDirectionLabel(item({ bankDeltaMinor: 5_000 }))).toBe("In");
  });

  it("names an earned-fee transfer, which posts an entry and no movement", () => {
    expect(
      bankItemKindLabel(item({ movementKind: null, trustTransferId: "trustTransfer_1" })),
    ).toBe("Earned Fees");
    expect(bankItemKindLabel(item({ movementKind: null }))).toBe("Recorded Entry");
    expect(bankItemKindLabel(item({ movementKind: "matter_transfer" }))).toBe("Matter Transfer");
  });
});

describe("the suggestions, which assert nothing", () => {
  it("marks nothing at all while no line is chosen", () => {
    expect(candidatesForLine([suggestion()], null).size).toBe(0);
  });

  it("marks only the candidates for the line in hand", () => {
    const marks = candidatesForLine(
      [
        suggestion(),
        suggestion({ statementLineId: "trustBankStatementLine_2", ledgerEntryId: "ledgerEntry_2" }),
      ],
      "trustBankStatementLine_1",
    );
    expect([...marks.keys()]).toEqual(["ledgerEntry_1"]);
    expect(marks.get("ledgerEntry_1")?.text).toBe("amount equal · same day");
  });

  it("spells every signal out, because a reader has to judge the pairing", () => {
    expect(matchSignalsText(["within-window", "reference-equal", "counterparty-similar"])).toBe(
      "within a few days · reference equal · counterparty similar",
    );
  });
});

describe("the Match control's own refusal", () => {
  it("is where the product says that nothing is matched automatically", () => {
    expect(
      matchRefusal({
        permissionRefusal: undefined,
        selectedStatementLineId: null,
        selectedLedgerEntryId: null,
      }),
    ).toBe(
      "Choose a statement line on the left and the recorded item it is. Nothing is matched " +
        "automatically: a member records every match.",
    );
  });

  it("asks for whichever half is missing", () => {
    expect(
      matchRefusal({
        permissionRefusal: undefined,
        selectedStatementLineId: "trustBankStatementLine_1",
        selectedLedgerEntryId: null,
      }),
    ).toBe("Choose the recorded item this statement line is.");
    expect(
      matchRefusal({
        permissionRefusal: undefined,
        selectedStatementLineId: null,
        selectedLedgerEntryId: "ledgerEntry_1",
      }),
    ).toBe("Choose the statement line this recorded item is.");
  });

  it("lets a permission refusal win, because that answer does not change with the selection", () => {
    expect(
      matchRefusal({
        permissionRefusal: "Working a trust reconciliation needs the trust:manage permission.",
        selectedStatementLineId: "trustBankStatementLine_1",
        selectedLedgerEntryId: "ledgerEntry_1",
      }),
    ).toBe("Working a trust reconciliation needs the trust:manage permission.");
  });

  it("stands aside once both sides are chosen", () => {
    expect(
      matchRefusal({
        permissionRefusal: undefined,
        selectedStatementLineId: "trustBankStatementLine_1",
        selectedLedgerEntryId: "ledgerEntry_1",
      }),
    ).toBeUndefined();
  });
});

describe("the matches, and taking one back", () => {
  const match = (over: Partial<TrustReconciliationMatch> = {}): TrustReconciliationMatch => ({
    id: "trustReconciliationMatch_1",
    statementLineId: "trustBankStatementLine_1",
    ledgerEntryId: "ledgerEntry_1",
    recordedBy: "user_ada",
    recordedAt: "2026-09-02T15:00:00Z",
    withdrawnBy: null,
    withdrawnAt: null,
    line: {
      id: "trustBankStatementLine_1",
      postedOn: "2026-08-29",
      direction: "withdrawal",
      amountMinor: 5_000,
      description: "Filing fee",
      reference: null,
      counterpartyName: null,
      sourceRowNumber: null,
    },
    item: item(),
    ...over,
  });

  it("says which assertions still stand", () => {
    expect(matchStandingLabel(match())).toBe("Standing");
    expect(matchStandingLabel(match({ withdrawnAt: "2026-09-03T09:00:00Z" }))).toBe("Withdrawn");
  });
});

describe("what closing this reconciliation would do", () => {
  it("states the verdict, the counts and what closing writes", () => {
    expect(closeReading(OPEN_RECONCILIATION, PROOF, 1, 3)).toEqual({
      refusal: undefined,
      sentence:
        "This period balances. 1 statement line and 3 recorded items are unmatched. Closing " +
        "freezes the proof as it stands now and writes nothing else: no entry is moved, no match " +
        "is made, and a correction afterwards is a new reconciliation that supersedes this one.",
    });
  });

  it("lets a period that did not balance close, and records that it did not tie out", () => {
    const reading = closeReading(OPEN_RECONCILIATION, { ...PROOF, balanced: false }, 0, 0);
    expect(reading.refusal).toBeUndefined();
    expect(reading.sentence).toContain(
      "does not balance, and closing records that it did not tie out",
    );
  });

  it("refuses a reconciliation that is already closed", () => {
    expect(
      closeReading({ ...OPEN_RECONCILIATION, status: "closed", frozenProof: FROZEN }, PROOF, 0, 0)
        .refusal,
    ).toBe("This reconciliation is already closed.");
  });

  it("refuses while the reconciliation is still being read", () => {
    expect(closeReading(null, null, 0, 0).refusal).toBe("Reading this reconciliation.");
  });

  it("counts in the count's own grammar, so nothing reads as 1 lines", () => {
    expect(countedPhrase(1, "statement line", "statement lines")).toBe("1 statement line");
    expect(countedPhrase(0, "statement line", "statement lines")).toBe("0 statement lines");
  });
});
