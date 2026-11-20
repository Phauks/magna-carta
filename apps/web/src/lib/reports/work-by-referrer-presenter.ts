/*
 * Work by Referrer: what the clients each source and each person sent were billed and paid in a
 * period, arranged for a screen and a file.
 *
 * TOTALS FIRST, THEN THE TABLE, as every financial report. Revenue's three tiles, then one sortable
 * table with a row per source and, under each, a row per person or organization who referred its
 * clients. The clients with a referrer and no source, and the clients with nothing recorded, are
 * rows of their own, so the table's total is the report's.
 *
 * Every figure is the payload's. Nothing here adds two figures; the reporting package's tests prove
 * the rows add up to the totals, and that the totals are the Revenue report's.
 */
import {
  completenessLine,
  type ReportCell,
  type ReportPresentation,
  type ReportSummaryTile,
} from "./report-presentation.ts";
import { captionOr, countCell, moneyCell, moneyText } from "./report-cells.ts";
import type { RevenueFigures, WorkByReferrer, WorkByReferrerSourceRow } from "./report-reads.ts";

/** The clients with a referrer recorded and no source. */
export const NO_SOURCE = "No source";
/** The clients with no referral recorded at all. */
export const NOT_RECORDED = "Not recorded";
/** Within a source, the clients with no person recorded. */
export const NO_REFERRER = "No person recorded";
/** A referrer whose record holds no name. */
export const UNNAMED_REFERRER = "Unnamed record";
/** Said after a source the firm has retired. */
export const RETIRED_SOURCE = "(retired)";

const HEADINGS = ["Clients", "Matters", "Billed", "Credited and written off", "Collected"];

function figureCells(
  row: { readonly clientCount: number; readonly matterCount: number },
  figures: RevenueFigures,
): ReportCell[] {
  return [
    countCell(row.clientCount),
    countCell(row.matterCount),
    moneyCell(figures.billedMinor),
    moneyCell(figures.creditedMinor),
    moneyCell(figures.collectedMinor),
  ];
}

export function sourceCaption(source: WorkByReferrerSourceRow): string {
  if (source.kind === "notRecorded") return NOT_RECORDED;
  if (source.kind === "referrerOnly") return NO_SOURCE;
  const name = captionOr(source.sourceName, NO_SOURCE);
  return source.sourceArchived ? `${name} ${RETIRED_SOURCE}` : name;
}

export function presentWorkByReferrer(report: WorkByReferrer): ReportPresentation {
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
    title: "Work by Referrer",
    subtitle: null,
    stamp: report.reproducibilityStatement,
    reproducible: report.reproducibility.reproducible,
    completeness: report.completeness,
    summary,
    sections: [
      {
        id: "by-source",
        title: "By Source",
        headers: ["Source", ...HEADINGS],
        rows: report.sources.map((source) => [
          sourceCaption(source),
          ...figureCells(source, source.figures),
        ]),
        rowDetails: report.sources.map((source) =>
          source.referrers.map((referrer) => [
            referrer.referrerEntityId === null
              ? NO_REFERRER
              : captionOr(referrer.referrerName, UNNAMED_REFERRER),
            ...figureCells(referrer, referrer.figures),
          ]),
        ),
        endAlignedColumns: [1, 2, 3, 4, 5],
        sortable: true,
        note: report.attributionStatement,
        aside: completenessLine(report.completeness),
        whenEmpty: "Nothing was billed or collected in this period.",
      },
    ],
  };
}
