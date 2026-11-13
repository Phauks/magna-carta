/*
 * What the two statement panels put on the wire, and what they refuse before they send anything.
 *
 * These assert the REQUEST, not the resolution. A call that resolves proves the stub answered; it
 * proves nothing about what went out, and on this surface what goes out is the firm's own account
 * of what its bank reported. Three things are worth more here than anywhere else:
 *
 *   - EVERY AMOUNT IS WHOLE MINOR UNITS. A body carrying a major-unit figure would record a
 *     hundredth of what the bank said, silently and correctly.
 *   - THE PANEL DOES NOT ARGUE WITH THE BANK. A statement whose lines do not add up to its own
 *     closing balance is recorded as it stands, with the difference STATED. A test that let that
 *     become a refusal would be the one that hid the day the firm could not record the statement it
 *     had to reconcile.
 *   - EVERY WRITE CARRIES ITS IDEMPOTENCY KEY. These routes refuse a call without one, so a missing
 *     header is not a degraded write, it is no write at all.
 */
import { describe, expect, it } from "vitest";
import {
  importTrustBankStatement,
  type TrustStatementImportPreview,
} from "../src/lib/trust/trust-api.ts";
import {
  closingDifferenceSentence,
  importColumnRows,
  importDateSpanText,
  previousCalendarMonth,
  readTrustBankStatementEntry,
  readTrustStatementImportRequest,
  readTrustStatementPreviewRequest,
  readsAsStatementDateFormat,
  statementTotals,
  type TrustStatementLineDraft,
} from "../src/lib/trust/statement-entry.ts";
import { IDEMPOTENCY_HEADER, recordRequests } from "./time-request-recorder.ts";

const ACCOUNT = "trustAccount_bay";

function line(over: Partial<TrustStatementLineDraft> = {}): TrustStatementLineDraft {
  return {
    key: "line-1",
    postedOn: "2026-08-04",
    direction: "deposit",
    amountText: "2,500.00",
    description: "Wire in, Pemberton",
    reference: "  0041  ",
    counterpartyName: " Pemberton Holdings ",
    ...over,
  };
}

const DRAFT = {
  trustAccountId: ACCOUNT,
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  openingBalanceText: "10,000.00",
  closingBalanceText: "11,300.00",
  statementReference: " AUG-2026 ",
  lines: [
    line(),
    line({ key: "line-2", direction: "withdrawal", amountText: "1200.00", postedOn: "2026-08-19" }),
  ],
};

const PREVIEW: TrustStatementImportPreview = {
  columnMapping: { postedOn: "Date", amount: "Amount", description: "Memo", reference: null },
  rows: [
    {
      rowNumber: 2,
      postedOn: "2026-08-04",
      direction: "deposit",
      amountMinor: 250_000,
      description: "Wire in",
      reference: null,
      counterpartyName: null,
    },
  ],
  rejections: [{ rowNumber: 5, reason: "No amount on the row." }],
  depositTotalMinor: 250_000,
  withdrawalTotalMinor: 120_000,
  earliestPostedOn: "2026-08-04",
  latestPostedOn: "2026-08-19",
  fingerprint: "sha256-abc",
};

const IMPORT_DRAFT = {
  trustAccountId: ACCOUNT,
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  openingBalanceText: "10,000.00",
  closingBalanceText: "11,300.00",
  statementReference: "",
  fileText: "Date,Amount,Memo\n2026-08-04,2500.00,Wire in\n",
  dateFormat: "iso" as const,
  preview: PREVIEW,
};

/*
 * The money wording the panels read figures through. Deliberately not the product's own formatter:
 * what these assert is that the SENTENCE is composed from the figures handed to it, and a test that
 * re-derived the wording through the formatter would pass whatever the formatter did.
 */
const money = (amountMinor: number): string => `${String(amountMinor)} cents`;

describe("the period a statement panel opens on", () => {
  it("is the calendar month before the account's own, not the reader's", () => {
    // Midnight UTC on 1 September is still 31 August in Los Angeles, so the account's zone decides
    // which month the panel calls "last month" — which is the whole reason the zone is a prop.
    const atUtc = Date.parse("2026-09-01T04:00:00Z");
    expect(previousCalendarMonth("UTC", atUtc)).toEqual({
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
    });
    expect(previousCalendarMonth("America/Los_Angeles", atUtc)).toEqual({
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
  });

  it("carries a January back into the year before it", () => {
    expect(previousCalendarMonth("UTC", Date.parse("2026-01-17T12:00:00Z"))).toEqual({
      periodStart: "2025-12-01",
      periodEnd: "2025-12-31",
    });
  });
});

describe("what the typed lines come to", () => {
  it("adds the two directions separately and implies the closing balance from both", () => {
    expect(statementTotals(DRAFT.openingBalanceText, DRAFT.lines)).toEqual({
      depositTotalMinor: 250_000,
      withdrawalTotalMinor: 120_000,
      impliedClosingMinor: 1_130_000,
    });
  });

  it("counts the lines that read while one is still being typed, and withholds the implied figure", () => {
    const totals = statementTotals(DRAFT.openingBalanceText, [
      line(),
      line({ key: "line-2", amountText: "12." }),
    ]);
    expect(totals.depositTotalMinor).toBe(250_000);
    // Half a line must not produce a closing balance: a figure computed from some of the lines
    // disagrees with the statement for a reason the reader cannot see.
    expect(totals.impliedClosingMinor).toBeNull();
  });

  it("withholds the implied figure until the opening balance is an amount", () => {
    expect(statementTotals("", DRAFT.lines).impliedClosingMinor).toBeNull();
  });
});

describe("the sentence about a statement that does not add up", () => {
  it("says nothing while the two agree", () => {
    const totals = statementTotals(DRAFT.openingBalanceText, DRAFT.lines);
    expect(closingDifferenceSentence(totals, "11300.00", money)).toBeNull();
  });

  it("names both figures and says the statement is recorded either way", () => {
    const totals = statementTotals(DRAFT.openingBalanceText, DRAFT.lines);
    const sentence = closingDifferenceSentence(totals, "11,000.00", money);
    expect(sentence).toBe(
      "The lines add up to 1130000 cents but the closing balance entered is 1100000 cents. Both " +
        "are saved as entered, and the difference shows up when this period is reconciled.",
    );
  });

  it("says nothing while there is no implied figure to compare", () => {
    expect(closingDifferenceSentence(statementTotals("", DRAFT.lines), "1.00", money)).toBeNull();
  });
});

describe("the body the record panel composes", () => {
  it("sends whole cents, trims what was typed around the words, and keeps the lines in order", () => {
    const reading = readTrustBankStatementEntry(DRAFT);
    expect(reading).toEqual({
      kind: "request",
      request: {
        trustAccountId: ACCOUNT,
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        openingBalanceMinor: 1_000_000,
        closingBalanceMinor: 1_130_000,
        currency: "USD",
        statementReference: "AUG-2026",
        lines: [
          {
            postedOn: "2026-08-04",
            direction: "deposit",
            amountMinor: 250_000,
            description: "Wire in, Pemberton",
            reference: "0041",
            counterpartyName: "Pemberton Holdings",
          },
          {
            postedOn: "2026-08-19",
            direction: "withdrawal",
            amountMinor: 120_000,
            description: "Wire in, Pemberton",
            reference: "0041",
            counterpartyName: "Pemberton Holdings",
          },
        ],
      },
    });
  });

  it("records a statement whose lines disagree with its own closing balance", () => {
    // The server takes either figure and the difference is what the reconciliation finds; a client
    // refusal here would leave the firm unable to record the statement it has to reconcile.
    const reading = readTrustBankStatementEntry({ ...DRAFT, closingBalanceText: "9,000.00" });
    expect(reading.kind).toBe("request");
  });

  it("sends an optional box nobody filled in as null rather than as an empty string", () => {
    const reading = readTrustBankStatementEntry({
      ...DRAFT,
      statementReference: "   ",
      lines: [line({ reference: "", counterpartyName: " " })],
    });
    expect(reading.kind === "request" && reading.request.statementReference).toBeNull();
    expect(reading.kind === "request" && reading.request.lines[0]?.reference).toBeNull();
    expect(reading.kind === "request" && reading.request.lines[0]?.counterpartyName).toBeNull();
  });

  it("records a period the bank posted nothing in", () => {
    expect(readTrustBankStatementEntry({ ...DRAFT, lines: [] }).kind).toBe("request");
  });

  it("refuses each missing fact in its own words, so a control can say which", () => {
    expect(readTrustBankStatementEntry({ ...DRAFT, periodStart: "" })).toEqual({
      kind: "refused",
      reason: "Say which day the statement's period starts.",
    });
    expect(readTrustBankStatementEntry({ ...DRAFT, periodEnd: "2026-07-31" })).toEqual({
      kind: "refused",
      reason: "A period ends on the day it starts or after it. Check the two days.",
    });
    expect(readTrustBankStatementEntry({ ...DRAFT, openingBalanceText: "" })).toEqual({
      kind: "refused",
      reason: "Say what the account held when the period opened.",
    });
    expect(readTrustBankStatementEntry({ ...DRAFT, closingBalanceText: "" })).toEqual({
      kind: "refused",
      reason: "Say what the account held when the period closed.",
    });
  });

  it("names the line that is wrong, by its number on the panel", () => {
    expect(
      readTrustBankStatementEntry({
        ...DRAFT,
        lines: [line(), line({ key: "b", description: " " })],
      }),
    ).toEqual({ kind: "refused", reason: "Line 2: say what the bank called it." });
    expect(
      readTrustBankStatementEntry({ ...DRAFT, lines: [line({ postedOn: "2026-09-02" })] }),
    ).toEqual({
      kind: "refused",
      reason: "Line 1: the day it was posted falls outside the period this statement covers.",
    });
    expect(readTrustBankStatementEntry({ ...DRAFT, lines: [line({ amountText: "0" })] })).toEqual({
      kind: "refused",
      reason: "Line 1: a line of nothing moves nothing.",
    });
  });
});

describe("the import, which quotes the preview back", () => {
  it("cannot be composed without a preview, because the fingerprint is the review", () => {
    expect(readTrustStatementImportRequest({ ...IMPORT_DRAFT, preview: null })).toEqual({
      kind: "refused",
      reason: "Preview the file first, so what would be recorded is read.",
    });
  });

  it("refuses a file nobody has chosen, on both steps", () => {
    const empty = { ...IMPORT_DRAFT, fileText: "", preview: null };
    expect(readTrustStatementPreviewRequest(empty)).toEqual({
      kind: "refused",
      reason: "Choose the statement file the bank sent.",
    });
    expect(readTrustStatementImportRequest(empty)).toEqual({
      kind: "refused",
      reason: "Choose the statement file the bank sent.",
    });
  });

  it("refuses a preview that read nothing, rather than importing an empty statement", () => {
    expect(
      readTrustStatementImportRequest({
        ...IMPORT_DRAFT,
        preview: { ...PREVIEW, rows: [] },
      }),
    ).toEqual({
      kind: "refused",
      reason: "The preview read no lines out of this file. Check the file and the date format.",
    });
  });

  it("carries the file, the format and the reviewed fingerprint", () => {
    expect(readTrustStatementImportRequest(IMPORT_DRAFT)).toEqual({
      kind: "request",
      request: {
        trustAccountId: ACCOUNT,
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        openingBalanceMinor: 1_000_000,
        closingBalanceMinor: 1_130_000,
        currency: "USD",
        statementReference: null,
        fileText: IMPORT_DRAFT.fileText,
        dateFormat: "iso",
        confirmedFingerprint: "sha256-abc",
      },
    });
  });

  it("asks the preview for the file and the format, and nothing about the period", () => {
    expect(readTrustStatementPreviewRequest(IMPORT_DRAFT)).toEqual({
      kind: "request",
      request: { fileText: IMPORT_DRAFT.fileText, dateFormat: "iso", currency: "USD" },
    });
  });

  it("puts the composed request on the wire with its idempotency key", async () => {
    const reading = readTrustStatementImportRequest(IMPORT_DRAFT);
    if (reading.kind !== "request") throw new Error("the fixture composes a request");
    const recorder = recordRequests({ trustBankStatementId: "trustBankStatement_1" });
    await importTrustBankStatement(recorder.fetch, reading.request, "key-1");
    const call = recorder.onlyCall();
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/api/v1/trust/bank-statements/import");
    expect(call.headers[IDEMPOTENCY_HEADER]).toBe("key-1");
    expect(call.body).toMatchObject({ confirmedFingerprint: "sha256-abc", currency: "USD" });
  });

  it("knows which date formats the contract names", () => {
    expect(readsAsStatementDateFormat("day-month-year")).toBe(true);
    expect(readsAsStatementDateFormat("year-day")).toBe(false);
  });
});

describe("what the preview report reads as", () => {
  it("names the fields it knows and keeps the server's own name for the rest", () => {
    expect(
      importColumnRows({ postedOn: "Date", balanceAfter: "Balance", reference: null }),
    ).toEqual([
      { field: "postedOn", label: "Posted On", column: "Date" },
      { field: "balanceAfter", label: "balanceAfter", column: "Balance" },
      { field: "reference", label: "Reference", column: null },
    ]);
  });

  it("states the days the rows span, and nothing where no row carried one", () => {
    expect(importDateSpanText(PREVIEW, (from, to) => `${from} to ${to}`)).toBe(
      "2026-08-04 to 2026-08-19",
    );
    expect(
      importDateSpanText({ ...PREVIEW, earliestPostedOn: null }, (from, to) => `${from} to ${to}`),
    ).toBeNull();
  });
});
