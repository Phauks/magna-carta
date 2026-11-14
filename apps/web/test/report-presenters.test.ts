/*
 * The financial, productivity and operational presenters print the payload's figures and add none:
 * the tiles are the payload's totals, the total rows are the same totals, every client and matter
 * reaches a row, and the export carries each client's matters under it.
 */
import { fromMinor, spreadsheetNumber } from "@magna-carta/money/format";
import { USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import {
  clientOffice,
  presentAccountsReceivableAging,
  presentRealization,
  presentWorkInProgress,
  SEVERAL_OFFICES,
} from "../src/lib/reports/financial-presenters.ts";
import {
  presentMattersList,
  presentOperationalVolumes,
  presentTimekeeperProductivity,
} from "../src/lib/reports/activity-presenters.ts";
import { moneyText } from "../src/lib/reports/report-cells.ts";
import { reportExportDocument, type ReportCell } from "../src/lib/reports/report-presentation.ts";
import {
  sampleAccountsReceivableAging,
  sampleMattersList,
  sampleOperationalVolumes,
  sampleRealization,
  sampleTimekeeperProductivity,
  sampleWorkInProgress,
} from "../src/lib/reports/report-samples.ts";
import { IDENTITY_CAPTIONS } from "../src/lib/reports/trust-compliance-presenter.ts";

const numberOf = (cell: ReportCell | undefined): number | null =>
  cell === undefined || typeof cell === "string" ? null : cell.number;

describe("the aging presenter", () => {
  const aging = sampleAccountsReceivableAging();
  const presentation = presentAccountsReceivableAging(aging);

  it("opens with the payload's own totals, the over-ninety tile in the attention tone", () => {
    const tiles = presentation.summary ?? [];
    expect(tiles.map((tile) => tile.value)).toEqual([
      ...aging.totals.unpaidMinor.map((amount) => moneyText(amount)),
      moneyText(aging.totals.totalMinor),
    ]);
    expect(tiles[4]?.tone).toBe("attention");
    expect(tiles[5]?.tone).toBe("total");
    expect(tiles[0]?.detail).toBe("6 bills");
  });

  it("rules the by-office table off with the payload's totals, not a sum of its rows", () => {
    const offices = presentation.sections.find((section) => section.id === "by-office");
    expect(offices?.totalRow?.[0]).toBe("Firm total");
    expect(numberOf(offices?.totalRow?.[6])).toBe(
      spreadsheetNumber(fromMinor(aging.totals.totalMinor, USD)),
    );
    expect(offices?.rows).toHaveLength(aging.offices.length);
  });

  it("puts every client on a row and every matter under its client, in the file too", () => {
    const clients = presentation.sections.find((section) => section.id === "by-client");
    expect(clients?.sortable).toBe(true);
    expect(clients?.rows).toHaveLength(aging.clients.length);
    expect(clients?.rowDetails?.map((details) => details.length)).toEqual(
      aging.clients.map((client) => client.matters.length),
    );
    expect(clients?.aside).toBe("All matters in scope were read.");
    const file = reportExportDocument(presentation, new Date("2026-08-01T00:00:00Z"));
    const fileClients = file.sections.find((section) => section.title === "By Client");
    expect(fileClients?.rows).toHaveLength(aging.clients.length * 2);
  });

  it("prints the stamp as served", () => {
    expect(presentation.stamp).toBe(aging.reproducibilityStatement);
    expect(presentation.reproducible).toBe(false);
  });
});

describe("a client's office", () => {
  it("is the one office its matters name, or says there are several", () => {
    expect(clientOffice([{ locationName: "North" }, { locationName: "North" }])).toBe("North");
    expect(clientOffice([{ locationName: "North" }, { locationName: "Main" }])).toBe(
      SEVERAL_OFFICES,
    );
  });
});

describe("the other presenters", () => {
  it("draw totals first and a sortable client table for work in progress and realization", () => {
    for (const presentation of [
      presentWorkInProgress(sampleWorkInProgress(), IDENTITY_CAPTIONS),
      presentRealization(sampleRealization()),
    ]) {
      expect(presentation.summary?.length).toBeGreaterThan(0);
      expect(presentation.sections.find((section) => section.id === "by-client")?.sortable).toBe(
        true,
      );
    }
  });

  it("states realization's live standard value beside its by-office table", () => {
    const realization = sampleRealization();
    const offices = presentRealization(realization).sections[0];
    expect(offices?.note).toBe(realization.standardValueStatement);
  });

  it("keeps productivity to minutes and never prints money", () => {
    const presentation = presentTimekeeperProductivity(
      sampleTimekeeperProductivity(),
      IDENTITY_CAPTIONS,
    );
    expect(JSON.stringify(presentation)).not.toMatch(/\$/);
    expect(presentation.summary?.find((tile) => tile.label === "Billable share")?.value).toBe(
      "78%",
    );
  });

  it("places each matter type's opened and closed counts on one row and adds none", () => {
    const presentation = presentOperationalVolumes(sampleOperationalVolumes());
    const matters = presentation.sections.find((section) => section.id === "matters");
    expect(matters?.rows).toEqual([
      ["Litigation", { text: "4", number: 4 }, { text: "2", number: 2 }],
    ]);
    expect(matters?.note).toBe(sampleOperationalVolumes().liveSectionsStatement);
  });
});

describe("the matters list presenter", () => {
  const report = sampleMattersList();
  const presentation = presentMattersList(report);

  it("opens with the payload's counts by status, the whole as the total", () => {
    const tiles = presentation.summary ?? [];
    expect(tiles.map((tile) => tile.value)).toEqual(
      [
        report.totals.openCount,
        report.totals.heldCount,
        report.totals.closedCount,
        report.totals.matterCount,
      ].map(String),
    );
    expect(tiles[3]?.tone).toBe("total");
  });

  it("rules the by-office table off with the payload's totals", () => {
    const offices = presentation.sections.find((section) => section.id === "by-office");
    expect(offices?.totalRow?.[0]).toBe("Firm total");
    expect(numberOf(offices?.totalRow?.[4])).toBe(report.totals.matterCount);
  });

  it("puts every matter on its own row, in the payload's order, with its status in words", () => {
    const matters = presentation.sections.find((section) => section.id === "matters");
    expect(matters?.rows).toHaveLength(report.matters.length);
    expect(matters?.rows.map((row) => row[5])).toEqual(["Open", "On hold", "Closed"]);
    expect(matters?.rows[0]?.[7]).toBe("-");
  });
});
