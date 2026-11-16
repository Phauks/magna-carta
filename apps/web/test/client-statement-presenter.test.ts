/*
 * The client statement presenter prints the payload's figures and adds none: the tiles are the
 * payload's totals, the balance column is the payload's running balance, the activity table opens
 * with the opening balance and is ruled off with the closing one, every line and every unpaid bill
 * reaches a row, and a reversal prints on its own line naming what it reverses.
 */
import { fromMinor, spreadsheetNumber } from "@magna-carta/money/format";
import { USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import {
  clientCaption,
  presentClientStatement,
} from "../src/lib/reports/client-statement-presenter.ts";
import { moneyText } from "../src/lib/reports/report-cells.ts";
import { reportExportDocument, type ReportCell } from "../src/lib/reports/report-presentation.ts";
import { sampleClientStatement } from "../src/lib/reports/report-samples.ts";

const numberOf = (cell: ReportCell | undefined): number | null =>
  cell === undefined || typeof cell === "string" ? null : cell.number;
const asNumber = (minor: number): number => spreadsheetNumber(fromMinor(minor, USD));

describe("the client statement presenter", () => {
  const report = sampleClientStatement();
  const presentation = presentClientStatement(report);

  it("names the client with their handle beside the name", () => {
    expect(presentation.subtitle).toBe(`${report.clientName} (${report.clientEntityId})`);
    expect(clientCaption({ clientName: null, clientEntityId: "entity_x" })).toBe("entity_x");
  });

  it("opens with the opening balance, billed, paid and credited, and the closing balance", () => {
    const tiles = presentation.summary ?? [];
    expect(tiles.map((tile) => tile.label)).toEqual([
      "Opening balance",
      "Billed",
      "Paid and credited",
      "Closing balance",
    ]);
    expect(tiles.map((tile) => tile.value)).toEqual([
      moneyText(report.totals.openingMinor),
      moneyText(report.totals.billedMinor),
      moneyText(report.totals.appliedMinor),
      moneyText(report.totals.closingMinor),
    ]);
    expect(tiles[3]?.tone).toBe("total");
  });

  it("prints every line with the payload's running balance, between the two balances", () => {
    const activity = presentation.sections.find((section) => section.id === "activity");
    const rows = activity?.rows ?? [];
    expect(rows).toHaveLength(report.activity.length + 1);
    expect(rows[0]?.[1]).toBe("Opening balance");
    expect(numberOf(rows[0]?.[5])).toBe(asNumber(report.totals.openingMinor));
    expect(rows.slice(1).map((row) => numberOf(row[5]))).toEqual(
      report.activity.map((line) => asNumber(line.balanceMinor)),
    );
    expect(activity?.totalRow?.map(numberOf)).toEqual([
      null,
      null,
      null,
      asNumber(report.totals.billedMinor),
      asNumber(report.totals.appliedMinor),
      asNumber(report.totals.closingMinor),
    ]);
  });

  it("puts a bill in the charges column and a reversal, negative, in the payments column", () => {
    const rows = presentation.sections.find((section) => section.id === "activity")?.rows ?? [];
    const billRow = rows.find((row) => row[1] === "Bill 00041");
    expect(numberOf(billRow?.[3])).toBe(asNumber(845_000));
    expect(billRow?.[4]).toBe("");
    const reversal = rows.find(
      (row) => typeof row[1] === "string" && row[1].startsWith("Reversal of write-off"),
    );
    expect(reversal?.[1]).toBe("Reversal of write-off on bill 00041: Discount withdrawn");
    expect(reversal?.[3]).toBe("");
    expect(numberOf(reversal?.[4])).toBe(asNumber(-10_000));
  });

  it("lists every unpaid bill, ruled off with the closing balance", () => {
    const unpaid = presentation.sections.find((section) => section.id === "unpaid-bills");
    expect(unpaid?.rows.map((row) => numberOf(row[6]))).toEqual(
      report.unpaidInvoices.map((bill) => asNumber(bill.unpaidMinor)),
    );
    expect(numberOf(unpaid?.totalRow?.[6])).toBe(asNumber(report.totals.closingMinor));
  });

  it("exports the same sections the screen draws", () => {
    const document = reportExportDocument(presentation, new Date("2026-08-01T15:00:00.000Z"));
    expect(document.sections.map((section) => section.title)).toEqual(
      presentation.sections.map((section) => section.title),
    );
  });
});
