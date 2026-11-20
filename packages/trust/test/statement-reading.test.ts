import { currencyFromCode } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import {
  readStatement,
  type StatementPage,
  type StatementPiece,
} from "../src/statement-reading.ts";

// The statement reader over positioned text shaped like what the PDF engine hands back: one piece
// per glyph for a born-digital page, one piece per word for a recognized one.

const USD = currencyFromCode("USD");
const OPTIONS = { currency: USD, dateOrder: "month-day" as const, periodEnd: "2026-10-31" };
const CHARACTER_WIDTH = 5.5;
const HEIGHT = 10;

/** One row of glyphs: each [x, text] cell laid out a character at a time, the way a PDF draws it. */
function glyphRow(y: number, cells: readonly (readonly [number, string])[]): StatementPiece[] {
  return cells.flatMap(([x, text]) =>
    [...text].map((character, index) => ({
      text: character,
      x0: x + index * CHARACTER_WIDTH,
      x1: x + (index + 1) * CHARACTER_WIDTH,
      y0: y,
      y1: y + HEIGHT,
    })),
  );
}

/** One row of recognized words, each with the recognizer's confidence. */
function wordRow(
  y: number,
  cells: readonly (readonly [number, string, number])[],
): StatementPiece[] {
  return cells.map(([x, text, confidence]) => ({
    text,
    x0: x,
    x1: x + text.length * CHARACTER_WIDTH,
    y0: y,
    y1: y + HEIGHT,
    confidence,
  }));
}

function textPage(rows: StatementPiece[][], pageIndex = 0): StatementPage {
  return { pageIndex, source: "text-layer", pieces: rows.flat() };
}

// The columns a typical statement prints: date, description, deposits, withdrawals, balance. The
// money is right-aligned, so each figure starts further left the longer it is.
const right = (edge: number, text: string): readonly [number, string] => [
  edge - text.length * CHARACTER_WIDTH,
  text,
];

describe("reading a bank statement", () => {
  it("reads a born-digital statement with column headers, and it foots", () => {
    const statement = readStatement(
      [
        textPage([
          glyphRow(700, [[40, "Beginning Balance"], right(560, "1,000.00")]),
          glyphRow(680, [
            [40, "Date"],
            [100, "Description"],
            [330, "Deposits"],
            [420, "Withdrawals"],
            [520, "Balance"],
          ]),
          glyphRow(660, [
            [40, "10/03"],
            [100, "DEPOSIT REF 41221"],
            right(380, "500.00"),
            right(560, "1,500.00"),
          ]),
          glyphRow(640, [
            [40, "10/09"],
            [100, "CHECK 10418"],
            right(470, "250.00"),
            right(560, "1,250.00"),
          ]),
          glyphRow(620, [[100, "CLARK COUNTY RECORDER"]]),
          glyphRow(600, [
            [40, "10/31"],
            [100, "SERVICE CHARGE"],
            right(470, "15.00"),
            right(560, "1,235.00"),
          ]),
          glyphRow(560, [[40, "Ending Balance"], right(560, "1,235.00")]),
        ]),
      ],
      OPTIONS,
    );
    expect(statement.openingBalanceMinor).toBe(100_000);
    expect(statement.closingBalanceMinor).toBe(123_500);
    expect(statement.rejections).toEqual([]);
    expect(
      statement.lines.map((line) => [
        line.postedOn,
        line.description,
        line.amountMinor,
        line.runningBalanceMinor,
      ]),
    ).toEqual([
      ["2026-10-03", "DEPOSIT REF 41221", 50_000, 150_000],
      ["2026-10-09", "CHECK 10418 CLARK COUNTY RECORDER", -25_000, 125_000],
      ["2026-10-31", "SERVICE CHARGE", -1_500, 123_500],
    ]);
    expect(statement.footing).toEqual({ kind: "foots", linesTotalMinor: 23_500 });
    expect(statement.lines[0]).toMatchObject({
      pageIndex: 0,
      source: "text-layer",
      confidence: null,
    });
  });

  it("tells money in from money out by the running balance when no header says", () => {
    const statement = readStatement(
      [
        textPage([
          glyphRow(700, [[40, "Previous Balance"], right(560, "200.00")]),
          glyphRow(660, [
            [40, "Oct 5"],
            [100, "MOBILE DEPOSIT"],
            right(450, "75.00"),
            right(560, "275.00"),
          ]),
          glyphRow(640, [
            [40, "Oct 6"],
            [100, "WIRE OUT"],
            right(450, "100.00"),
            right(560, "175.00"),
          ]),
          glyphRow(600, [[40, "New Balance"], right(560, "175.00")]),
        ]),
      ],
      OPTIONS,
    );
    expect(statement.lines.map((line) => line.amountMinor)).toEqual([7_500, -10_000]);
    expect(statement.lines.map((line) => line.postedOn)).toEqual(["2026-10-05", "2026-10-06"]);
    expect(statement.footing.kind).toBe("foots");
  });

  it("imports a statement that does not add up, and points at the first line that disagrees", () => {
    const statement = readStatement(
      [
        textPage([
          glyphRow(700, [[40, "Opening Balance"], right(560, "1,000.00")]),
          glyphRow(680, [
            [40, "Date"],
            [100, "Description"],
            [330, "Credits"],
            [420, "Debits"],
            [520, "Balance"],
          ]),
          glyphRow(660, [
            [40, "10/03"],
            [100, "DEPOSIT"],
            right(380, "500.00"),
            right(560, "1,500.00"),
          ]),
          // Read as 180.00 where the page says 130.00: the balance after it is the bank's own.
          glyphRow(640, [
            [40, "10/09"],
            [100, "CHECK 10419"],
            right(470, "180.00"),
            right(560, "1,370.00"),
          ]),
          glyphRow(560, [[40, "Closing Balance"], right(560, "1,370.00")]),
        ]),
      ],
      OPTIONS,
    );
    expect(statement.lines).toHaveLength(2);
    expect(statement.footing).toEqual({
      kind: "does-not-foot",
      linesTotalMinor: 32_000,
      computedClosingMinor: 132_000,
      statedClosingMinor: 137_000,
      differenceMinor: 5_000,
      firstMismatch: { pageIndex: 0, rowIndex: 3 },
    });
  });

  it("reads a recognized page and keeps the lowest confidence on each line", () => {
    const statement = readStatement(
      [
        {
          pageIndex: 2,
          source: "recognition",
          pieces: [
            ...wordRow(660, [
              [40, "10/27", 0.99],
              [100, "INCOMING", 0.97],
              [160, "WIRE", 0.71],
              [330, "1,000.00CR", 0.93],
            ]),
          ],
        },
      ],
      OPTIONS,
    );
    expect(statement.lines).toEqual([
      expect.objectContaining({
        pageIndex: 2,
        postedOn: "2026-10-27",
        description: "INCOMING WIRE",
        amountMinor: 100_000,
        source: "recognition",
        confidence: 0.71,
      }),
    ]);
    expect(statement.footing.kind).toBe("no-balances");
  });

  it("rejects a line whose direction nothing on the page settles, rather than guessing", () => {
    const statement = readStatement(
      [textPage([glyphRow(660, [[40, "10/12"], [100, "TRANSFER"], right(450, "40.00")])])],
      OPTIONS,
    );
    expect(statement.lines).toEqual([]);
    expect(statement.rejections).toEqual([
      expect.objectContaining({
        pageIndex: 0,
        reason: "whether this line is money in or money out is not printed on the statement",
      }),
    ]);
  });

  it("reads the date order the caller states, and gives a yearless date the year before the period's end", () => {
    const statement = readStatement(
      [textPage([glyphRow(660, [[40, "03/12"], [100, "DEPOSIT"], right(450, "-40.00")])])],
      { currency: USD, dateOrder: "day-month", periodEnd: "2027-01-15" },
    );
    expect(statement.lines.map((line) => [line.postedOn, line.amountMinor])).toEqual([
      ["2026-12-03", -4_000],
    ]);
  });
});
