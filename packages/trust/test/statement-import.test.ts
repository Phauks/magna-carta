import type { UserId } from "@magna-carta/identifiers/types";
import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { readTrustBankStatement, readTrustBankStatementLines } from "../src/bank-statements.ts";
import {
  confirmTrustStatementImport,
  parseDelimitedRows,
  previewTrustStatementImport,
} from "../src/statement-import.ts";
import { commit, expectRefusal, options, trustFixture } from "./support.ts";

const usd = (minor: number) => money(minor, USD);
const RECONCILER = "user_reconciler" as UserId;
const importOptions = { ...options, currency: USD } as const;

const GOOD_FILE = [
  "Date,Description,Amount,Check Number,Payee",
  '2026-08-02,"DEPOSIT CHECK 1041",5000.00,1041,Webb Holdings',
  '2026-08-03,"CHECK PAID",-1250.50,2201,"Reno Court Reporters, Inc."',
  "2026-08-04,MONTHLY SERVICE CHARGE,-25.00,,",
].join("\n");

describe("reading the file", () => {
  it("reads quoted fields, embedded commas, and doubled quotes", () => {
    const rows = parseDelimitedRows('a,b\n"one, two","he said ""no"""\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["one, two", 'he said "no"'],
    ]);
  });
});

describe("the preview", () => {
  // Detection and reporting run whether or not anything is ever imported: the report is frequently
  // the reason a firm decides.
  it("reports the column mapping, every row, and the totals, and stores nothing", () => {
    const preview = previewTrustStatementImport(GOOD_FILE, importOptions);
    expect(preview.columnMapping).toEqual({
      postedOn: "Date",
      description: "Description",
      amount: "Amount",
      reference: "Check Number",
      counterparty: "Payee",
    });
    expect(preview.rows).toHaveLength(3);
    expect(preview.rows[0]).toEqual({
      rowNumber: 2,
      postedOn: "2026-08-02",
      direction: "deposit",
      amountMinor: 500000,
      description: "DEPOSIT CHECK 1041",
      reference: "1041",
      counterpartyName: "Webb Holdings",
    });
    expect(preview.rows[1]?.direction).toBe("withdrawal");
    expect(preview.rows[1]?.amountMinor).toBe(125050);
    expect(preview.depositTotalMinor).toBe(500000);
    expect(preview.withdrawalTotalMinor).toBe(127550);
    expect(preview.earliestPostedOn).toBe("2026-08-02");
    expect(preview.latestPostedOn).toBe("2026-08-04");
    expect(preview.rejections).toEqual([]);
  });

  // A row it cannot read is REPORTED with its number and the reason, never dropped and never
  // guessed at — the person fixing it is looking at their own file.
  it("names the rows it cannot read and why", () => {
    const preview = previewTrustStatementImport(
      [
        "Date,Description,Amount",
        "2026-08-02,GOOD ROW,100.00",
        "08/02/2026,AMERICAN-STYLE DATE,100.00",
        "2026-08-03,,100.00",
        "2026-08-04,ZERO,0.00",
      ].join("\n"),
      importOptions,
    );
    expect(preview.rows).toHaveLength(1);
    expect(preview.rejections.map((rejection) => rejection.rowNumber)).toEqual([3, 4, 5]);
    expect(preview.rejections[0]?.reason).toContain("not readable as iso");
  });

  // 03/04/2026 is two different days on two sides of an ocean. The convention is STATED by the
  // caller and never detected, so the same file always reads the same way.
  it("reads a stated date convention rather than guessing one", () => {
    const file = ["Date,Description,Amount", "03/04/2026,ORDER OF THE DAY,10.00"].join("\n");
    expect(
      previewTrustStatementImport(file, { ...importOptions, dateFormat: "month-day-year" }).rows[0]
        ?.postedOn,
    ).toBe("2026-03-04");
    expect(
      previewTrustStatementImport(file, { ...importOptions, dateFormat: "day-month-year" }).rows[0]
        ?.postedOn,
    ).toBe("2026-04-03");
  });

  it("reads separate deposit and withdrawal columns, and reports a row that fills both", () => {
    const preview = previewTrustStatementImport(
      [
        "Posting Date,Memo,Credit,Debit",
        "2026-08-02,DEPOSIT,1000.00,",
        "2026-08-03,PAYMENT,,250.00",
        "2026-08-04,BOTH,10.00,10.00",
      ].join("\n"),
      importOptions,
    );
    expect(preview.rows.map((row) => row.direction)).toEqual(["deposit", "withdrawal"]);
    expect(preview.rejections[0]?.reason).toContain("both the deposit and the withdrawal column");
  });

  it("normalizes currency symbols, thousands separators, and parenthesized negatives", () => {
    const preview = previewTrustStatementImport(
      ["Date,Description,Amount", '2026-08-02,WIRE,"$12,345.67"', "2026-08-03,FEE,(25.00)"].join(
        "\n",
      ),
      importOptions,
    );
    expect(preview.rows[0]?.amountMinor).toBe(1234567);
    expect(preview.rows[0]?.direction).toBe("deposit");
    expect(preview.rows[1]?.amountMinor).toBe(2500);
    expect(preview.rows[1]?.direction).toBe("withdrawal");
  });

  it("refuses a file whose columns it cannot recognize, naming the headers it found", () => {
    expect(() => previewTrustStatementImport("Col1,Col2,Col3\n1,2,3", importOptions)).toThrowError(
      /Col1, Col2, Col3/,
    );
  });
});

describe("confirming the import", () => {
  it("records the statement only on an explicit confirmation, and reports what it stored", async () => {
    const fixture = await trustFixture({ jurisdiction: "US-NV" });
    const preview = previewTrustStatementImport(GOOD_FILE, importOptions);

    const confirmed = await confirmTrustStatementImport(
      fixture.database,
      {
        trustAccountId: fixture.trustAccountId,
        periodStart: "2026-08-01",
        periodEnd: "2026-08-05",
        openingBalance: usd(0),
        closingBalance: usd(372450),
        fileText: GOOD_FILE,
        confirmedFingerprint: preview.fingerprint,
        recordedBy: RECONCILER,
      },
      importOptions,
    );
    await commit(fixture.database, confirmed.effect);

    expect(confirmed.report).toEqual({
      statementId: confirmed.statementId,
      linesRecorded: 3,
      rowsRejected: 0,
      depositTotalMinor: 500000,
      withdrawalTotalMinor: 127550,
    });

    const statement = await readTrustBankStatement(fixture.database, confirmed.statementId);
    expect(statement.source).toBe("imported");
    const lines = await readTrustBankStatementLines(fixture.database, confirmed.statementId);
    expect(lines).toHaveLength(3);
    // Each line points back at the row of the file it came from, so an import report can send a
    // person to the right line of their own spreadsheet.
    expect(lines.map((line) => line.sourceRowNumber)).toEqual([2, 3, 4]);
  });

  // Confirming one file and storing another is the failure this fingerprint exists to prevent.
  it("refuses a confirmation whose file no longer matches the one that was reviewed", async () => {
    const fixture = await trustFixture({ jurisdiction: "US-NV" });
    const preview = previewTrustStatementImport(GOOD_FILE, importOptions);
    const edited = GOOD_FILE.replace("5000.00", "9000.00");

    await expect(
      expectRefusal(() =>
        confirmTrustStatementImport(
          fixture.database,
          {
            trustAccountId: fixture.trustAccountId,
            periodStart: "2026-08-01",
            periodEnd: "2026-08-05",
            openingBalance: usd(0),
            closingBalance: usd(372450),
            fileText: edited,
            confirmedFingerprint: preview.fingerprint,
            recordedBy: RECONCILER,
          },
          importOptions,
        ),
      ),
    ).rejects.toMatchObject({ code: "statement-import-preview-mismatch" });
  });

  it("refuses to record a file in which nothing could be read", async () => {
    const fixture = await trustFixture({ jurisdiction: "US-NV" });
    const unreadable = ["Date,Description,Amount", "08/02/2026,BAD DATE,100.00"].join("\n");
    const preview = previewTrustStatementImport(unreadable, importOptions);
    expect(preview.rows).toHaveLength(0);

    await expect(
      expectRefusal(() =>
        confirmTrustStatementImport(
          fixture.database,
          {
            trustAccountId: fixture.trustAccountId,
            periodStart: "2026-08-01",
            periodEnd: "2026-08-05",
            openingBalance: usd(0),
            closingBalance: usd(0),
            fileText: unreadable,
            confirmedFingerprint: preview.fingerprint,
            recordedBy: RECONCILER,
          },
          importOptions,
        ),
      ),
    ).rejects.toMatchObject({ code: "statement-import-nothing-to-record" });
  });
});
