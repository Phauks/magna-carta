/*
 * Revenue: what was billed and what was collected in a period, arranged for a screen and a file.
 *
 * TOTALS FIRST, THEN TABLES, as every financial report (financial-presenters.ts). Three tiles (billed,
 * credited and written off, and collected as the closing tile), then a table by office ruled off with
 * the report's total, then sortable tables by matter type and by responsible attorney.
 *
 * Every figure is the payload's. Nothing here adds two figures; the reporting package's tests prove
 * each table sums to the totals, and that billed and collected agree with the Invoices and Payments
 * Applied reports.
 */
import {
  completenessLine,
  type ReportCell,
  type ReportPresentation,
  type ReportSummaryTile,
} from "./report-presentation.ts";
import { captionOr, countCell, moneyCell, moneyText } from "./report-cells.ts";
import { NO_OFFICE } from "./financial-presenters.ts";
import type { Revenue, RevenueFigures } from "./report-reads.ts";

/** A matter with no type set is counted in its own row. */
export const NO_MATTER_TYPE = "No matter type";

const REVENUE_HEADINGS = ["Billed", "Credited and written off", "Collected"];

function revenueCells(figures: RevenueFigures): ReportCell[] {
  return [
    moneyCell(figures.billedMinor),
    moneyCell(figures.creditedMinor),
    moneyCell(figures.collectedMinor),
  ];
}

export function presentRevenue(report: Revenue): ReportPresentation {
  const summary: ReportSummaryTile[] = [
    { label: "Billed", value: moneyText(report.totals.billedMinor), detail: null, tone: "plain" },
    {
      label: "Credited and written off",
      value: moneyText(report.totals.creditedMinor),
      detail: null,
      tone: "plain",
    },
    {
      label: "Collected",
      value: moneyText(report.totals.collectedMinor),
      detail: null,
      tone: "total",
    },
  ];

  return {
    title: "Revenue",
    subtitle: null,
    stamp: report.reproducibilityStatement,
    reproducible: report.reproducibility.reproducible,
    completeness: report.completeness,
    summary,
    sections: [
      {
        id: "by-office",
        title: "By Office",
        headers: ["Office", ...REVENUE_HEADINGS],
        rows: report.offices.map((office) => [
          captionOr(office.locationName, NO_OFFICE),
          ...revenueCells(office.figures),
        ]),
        endAlignedColumns: [1, 2, 3],
        totalRow: [
          report.locationId === null ? "Firm total" : "Office total",
          ...revenueCells(report.totals),
        ],
        note: report.attributionStatement,
        whenEmpty: "Nothing was billed or collected in this period.",
      },
      {
        id: "by-matter-type",
        title: "By Matter Type",
        headers: ["Matter type", "Matters", ...REVENUE_HEADINGS],
        rows: report.matterTypes.map((type) => [
          captionOr(type.matterTypeName, NO_MATTER_TYPE),
          countCell(type.matterCount),
          ...revenueCells(type.figures),
        ]),
        endAlignedColumns: [1, 2, 3, 4],
        sortable: true,
        whenEmpty: "Nothing was billed or collected on a matter in this period.",
      },
      {
        id: "by-responsible-attorney",
        title: "By Responsible Attorney",
        headers: ["Responsible attorney", "Matters", ...REVENUE_HEADINGS],
        rows: report.responsibleAttorneys.map((attorney) => [
          captionOr(attorney.responsibleName, attorney.responsibleMemberId),
          countCell(attorney.matterCount),
          ...revenueCells(attorney.figures),
        ]),
        endAlignedColumns: [1, 2, 3, 4],
        sortable: true,
        aside: completenessLine(report.completeness),
        whenEmpty: "Nothing was billed or collected on a matter in this period.",
      },
    ],
  };
}
