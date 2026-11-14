/*
 * The Invoices and Payments Applied presenters print the payload's figures and add none: the tiles
 * are the payload's totals, the total rows are the same totals, every client, bill and entry reaches
 * a row, and a reversal is printed as its own negative entry naming what it reverses.
 */
import { fromMinor, spreadsheetNumber } from "@magna-carta/money/format";
import { USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import {
  entryKindText,
  presentInvoices,
  presentPaymentsApplied,
} from "../src/lib/reports/billing-presenters.ts";
import { moneyText } from "../src/lib/reports/report-cells.ts";
import { reportExportDocument, type ReportCell } from "../src/lib/reports/report-presentation.ts";
import { sampleInvoices, samplePaymentsApplied } from "../src/lib/reports/report-samples.ts";

const numberOf = (cell: ReportCell | undefined): number | null =>
  cell === undefined || typeof cell === "string" ? null : cell.number;
const dollars = (minor: number) => spreadsheetNumber(fromMinor(minor, USD));

describe("the invoices presenter", () => {
  const report = sampleInvoices();
  const presentation = presentInvoices(report);

  it("opens with the payload's totals, unpaid as the total", () => {
    const tiles = presentation.summary ?? [];
    expect(tiles.map((tile) => tile.value)).toEqual([
      moneyText(report.totals.billedMinor),
      moneyText(report.totals.creditedMinor),
      moneyText(report.totals.appliedMinor),
      moneyText(report.totals.unpaidMinor),
    ]);
    expect(tiles[0]?.detail).toBe("3 bills");
    expect(tiles[3]?.tone).toBe("total");
  });

  it("rules the by-office table off with the payload's totals", () => {
    const offices = presentation.sections.find((section) => section.id === "by-office");
    expect(offices?.totalRow?.[0]).toBe("Firm total");
    expect(numberOf(offices?.totalRow?.[5])).toBe(dollars(report.totals.unpaidMinor));
    expect(offices?.rows).toHaveLength(report.offices.length);
  });

  it("puts every client on a row and every bill under its client, in the file too", () => {
    const clients = presentation.sections.find((section) => section.id === "by-client");
    expect(clients?.sortable).toBe(true);
    expect(clients?.rowDetails?.map((bills) => bills.length)).toEqual(
      report.clients.map((client) => client.invoices.length),
    );
    expect(String(clients?.rowDetails?.[0]?.[0]?.[0])).toContain("Bill 00041");
    const file = reportExportDocument(presentation, new Date("2026-08-01T15:00:00.000Z"));
    const fileClients = file.sections.find((section) => section.title === "By Client");
    expect(fileClients?.rows).toHaveLength(report.clients.length + 3);
  });
});

describe("the payments applied presenter", () => {
  const report = samplePaymentsApplied();
  const presentation = presentPaymentsApplied(report);

  it("opens with each kind's total and the total applied", () => {
    const tiles = presentation.summary ?? [];
    expect(tiles.at(-1)?.value).toBe(moneyText(report.totals.totalMinor));
    expect(tiles.at(-1)?.detail).toBe("5 entries");
    expect(tiles[0]?.value).toBe(moneyText(report.totals.paymentMinor));
  });

  it("lists every entry in the order it took effect, a reversal naming what it reverses", () => {
    const entries = presentation.sections.find((section) => section.id === "entries");
    expect(entries?.rows).toHaveLength(report.entries.length);
    const reversal = entries?.rows.at(-1);
    expect(reversal?.[1]).toBe("Reversal of payment");
    expect(numberOf(reversal?.[5])).toBe(dollars(-100_000));
    expect(entryKindText({ kind: "trust_transfer", reversesKind: null })).toBe("From trust");
  });

  it("rules the by-office table off with the payload's totals", () => {
    const offices = presentation.sections.find((section) => section.id === "by-office");
    expect(numberOf(offices?.totalRow?.[7])).toBe(dollars(report.totals.totalMinor));
  });
});
