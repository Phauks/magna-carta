/*
 * The financial reports, arranged for a screen and a file: aging, work in progress, realization.
 *
 * TOTALS FIRST, THEN TABLES (the owner's pick, 2026-11-13). Each report opens with a row of its own
 * totals, then a table by office ruled off with the report's total, then a sortable table by client
 * whose rows open onto the client's matters. The file carries the same tables.
 *
 * Every figure is the payload's. The tiles are the payload's `totals`, the total rows are the same
 * totals, and a client's office is read off the offices its matters name. Nothing here adds two
 * figures; the reporting package's agreement tests prove the groups sum to the totals.
 */
import {
  completenessLine,
  type ReportCell,
  type ReportPresentation,
  type ReportSection,
  type ReportSummaryTile,
} from "./report-presentation.ts";
import { captionOr, counted, hoursCell, hoursText, moneyCell, moneyText } from "./report-cells.ts";
import {
  AGING_BUCKET_LABELS,
  type AccountsReceivableAging,
  type AgingFigures,
  type Realization,
  type RealizationFigures,
  type WorkInProgress,
  type WorkInProgressFigures,
} from "./report-reads.ts";
import type { ReportCaptions } from "./trust-compliance-presenter.ts";

export const NO_OFFICE = "No office";
export const NO_CLIENT = "No client";
export const SEVERAL_OFFICES = "Several offices";

/** The heading a bucket takes in a table, where the tile spells it out. */
const AGING_COLUMN_HEADINGS = ["Current", "1 to 30", "31 to 60", "61 to 90", "Over 90"] as const;
const OVER_NINETY_COLUMN = 4;

/** A matter as the reader knows it: its number, then its title. */
export function matterCaption(matter: {
  readonly matterNumber: string | null;
  readonly matterTitle: string;
}): string {
  return matter.matterNumber === null
    ? matter.matterTitle
    : `${matter.matterNumber} ${matter.matterTitle}`;
}

/**
 * The office a client row stands in: the one office its matters name, or "Several offices". It
 * is a caption read off the rows, not a figure, and it names no office the matters do not.
 */
export function clientOffice(matters: readonly { readonly locationName: string | null }[]): string {
  const offices = new Set(matters.map((matter) => captionOr(matter.locationName, NO_OFFICE)));
  if (offices.size === 1) return [...offices][0] ?? NO_OFFICE;
  return offices.size === 0 ? NO_OFFICE : SEVERAL_OFFICES;
}

/** The label the total row of a by-office table carries. */
function totalLabel(locationId: string | null): string {
  return locationId === null ? "Firm total" : "Office total";
}

// ---- accounts receivable aging --------------------------------------------------------------------

function agingFigureCells(figures: AgingFigures, totalMinor: number): ReportCell[] {
  return [...figures.map((amount) => moneyCell(amount)), moneyCell(totalMinor)];
}

const AGING_HEADINGS = [...AGING_COLUMN_HEADINGS, "Total"];
const AGING_FIGURE_COLUMNS = [1, 2, 3, 4, 5, 6];

export function presentAccountsReceivableAging(aging: AccountsReceivableAging): ReportPresentation {
  const summary: ReportSummaryTile[] = AGING_BUCKET_LABELS.map((label, index) => {
    const bills = aging.totals.invoiceCount?.[index];
    const amount = aging.totals.unpaidMinor[index] ?? 0;
    return {
      label,
      value: moneyText(amount),
      detail: bills === undefined ? null : counted(bills, "bill", "bills"),
      tone: index === OVER_NINETY_COLUMN && amount !== 0 ? "attention" : "plain",
    };
  });
  summary.push({
    label: "Total owed",
    value: moneyText(aging.totals.totalMinor),
    detail: counted(aging.clients.length, "client", "clients"),
    tone: "total",
  });

  const offices: ReportSection = {
    id: "by-office",
    title: "By Office",
    headers: ["Office", ...AGING_HEADINGS],
    rows: aging.offices.map((office) => [
      captionOr(office.locationName, NO_OFFICE),
      ...agingFigureCells(office.unpaidMinor, office.totalMinor),
    ]),
    endAlignedColumns: AGING_FIGURE_COLUMNS,
    attentionColumns: [OVER_NINETY_COLUMN + 1],
    totalRow: [
      totalLabel(aging.locationId),
      ...agingFigureCells(aging.totals.unpaidMinor, aging.totals.totalMinor),
    ],
    whenEmpty: "Nothing was unpaid at this date.",
  };

  const clients: ReportSection = {
    id: "by-client",
    title: "By Client",
    headers: ["Client", "Office", ...AGING_HEADINGS],
    rows: aging.clients.map((client) => [
      captionOr(client.clientName, client.clientEntityId),
      clientOffice(client.matters),
      ...agingFigureCells(client.unpaidMinor, client.totalMinor),
    ]),
    rowDetails: aging.clients.map((client) =>
      client.matters.map((matter) => [
        matterCaption(matter),
        captionOr(matter.locationName, NO_OFFICE),
        ...agingFigureCells(matter.unpaidMinor, matter.totalMinor),
      ]),
    ),
    endAlignedColumns: AGING_FIGURE_COLUMNS.map((column) => column + 1),
    attentionColumns: [OVER_NINETY_COLUMN + 2],
    sortable: true,
    subordinateColumns: [1],
    aside: completenessLine(aging.completeness),
    whenEmpty: "No client owed anything at this date.",
  };

  return {
    title: "Accounts Receivable Aging",
    subtitle: null,
    stamp: aging.reproducibilityStatement,
    reproducible: aging.reproducibility.reproducible,
    completeness: aging.completeness,
    summary,
    sections: [offices, clients],
  };
}

// ---- work in progress -----------------------------------------------------------------------------

function workInProgressCells(figures: WorkInProgressFigures): ReportCell[] {
  return [
    hoursCell(figures.timeMinutes),
    moneyCell(figures.timeMinor),
    moneyCell(figures.costMinor),
    moneyCell(figures.onDraftMinor),
    moneyCell(figures.totalMinor),
  ];
}

const WORK_IN_PROGRESS_HEADINGS = ["Hours", "Time", "Costs", "On draft bills", "Total"];

export function presentWorkInProgress(
  report: WorkInProgress,
  captions: ReportCaptions,
): ReportPresentation {
  const summary: ReportSummaryTile[] = [
    {
      label: "Unbilled time",
      value: moneyText(report.totals.timeMinor),
      detail: hoursText(report.totals.timeMinutes),
      tone: "plain",
    },
    {
      label: "Unbilled costs",
      value: moneyText(report.totals.costMinor),
      detail: null,
      tone: "plain",
    },
    {
      label: "On draft bills",
      value: moneyText(report.totals.onDraftMinor),
      detail: null,
      tone: "plain",
    },
    {
      label: "Total unbilled",
      value: moneyText(report.totals.totalMinor),
      detail: counted(report.clients.length, "client", "clients"),
      tone: "total",
    },
  ];

  return {
    title: "Work in Progress",
    subtitle: null,
    stamp: report.statement,
    reproducible: false,
    completeness: report.completeness,
    summary,
    sections: [
      {
        id: "by-office",
        title: "By Office",
        headers: ["Office", ...WORK_IN_PROGRESS_HEADINGS],
        rows: report.offices.map((office) => [
          captionOr(office.locationName, NO_OFFICE),
          ...workInProgressCells(office.figures),
        ]),
        endAlignedColumns: [1, 2, 3, 4, 5],
        totalRow: [totalLabel(report.locationId), ...workInProgressCells(report.totals)],
        whenEmpty: "Nothing is unbilled.",
      },
      {
        id: "by-client",
        title: "By Client",
        headers: ["Client", "Office", ...WORK_IN_PROGRESS_HEADINGS],
        rows: report.clients.map((client) => [
          captionOr(client.clientName, client.clientEntityId ?? NO_CLIENT),
          clientOffice(client.matters),
          ...workInProgressCells(client.figures),
        ]),
        rowDetails: report.clients.map((client) =>
          client.matters.map((matter) => [
            matterCaption(matter),
            captionOr(matter.locationName, NO_OFFICE),
            ...workInProgressCells(matter.figures),
          ]),
        ),
        endAlignedColumns: [2, 3, 4, 5, 6],
        sortable: true,
        subordinateColumns: [1],
        aside: completenessLine(report.completeness),
        whenEmpty: "No client has unbilled work.",
      },
      {
        id: "by-timekeeper",
        title: "By Timekeeper",
        headers: ["Timekeeper", ...WORK_IN_PROGRESS_HEADINGS],
        rows: report.timekeepers.map((timekeeper) => [
          captionOr(timekeeper.timekeeperName, captions.member(timekeeper.timekeeperUserId)),
          ...workInProgressCells(timekeeper.figures),
        ]),
        endAlignedColumns: [1, 2, 3, 4, 5],
        sortable: true,
        note: "Costs belong to no timekeeper, so this table carries time alone.",
        whenEmpty: "No timekeeper has unbilled time.",
      },
    ],
  };
}

// ---- realization ----------------------------------------------------------------------------------

function realizationCells(figures: RealizationFigures): ReportCell[] {
  return [
    moneyCell(figures.standardValueMinor),
    moneyCell(figures.billedMinor),
    moneyCell(figures.creditedMinor),
    moneyCell(figures.appliedMinor),
  ];
}

const REALIZATION_HEADINGS = ["Standard value", "Billed", "Credited and written off", "Applied"];

export function presentRealization(report: Realization): ReportPresentation {
  const summary: ReportSummaryTile[] = [
    {
      label: "Standard value",
      value: moneyText(report.totals.standardValueMinor),
      detail: "Live",
      tone: "plain",
    },
    { label: "Billed", value: moneyText(report.totals.billedMinor), detail: null, tone: "total" },
    {
      label: "Credited and written off",
      value: moneyText(report.totals.creditedMinor),
      detail: null,
      tone: "plain",
    },
    { label: "Applied", value: moneyText(report.totals.appliedMinor), detail: null, tone: "plain" },
  ];

  return {
    title: "Realization",
    subtitle: null,
    stamp: report.reproducibilityStatement,
    reproducible: report.reproducibility.reproducible,
    completeness: report.completeness,
    summary,
    sections: [
      {
        id: "by-office",
        title: "By Office",
        headers: ["Office", ...REALIZATION_HEADINGS],
        rows: report.offices.map((office) => [
          captionOr(office.locationName, NO_OFFICE),
          ...realizationCells(office.figures),
        ]),
        endAlignedColumns: [1, 2, 3, 4],
        totalRow: [totalLabel(report.locationId), ...realizationCells(report.totals)],
        note: report.standardValueStatement,
        whenEmpty: "Nothing was billed in this period.",
      },
      {
        id: "by-client",
        title: "By Client",
        headers: ["Client", "Office", ...REALIZATION_HEADINGS],
        rows: report.clients.map((client) => [
          captionOr(client.clientName, client.clientEntityId ?? NO_CLIENT),
          clientOffice(client.matters),
          ...realizationCells(client.figures),
        ]),
        rowDetails: report.clients.map((client) =>
          client.matters.map((matter) => [
            matterCaption(matter),
            captionOr(matter.locationName, NO_OFFICE),
            ...realizationCells(matter.figures),
          ]),
        ),
        endAlignedColumns: [2, 3, 4, 5],
        sortable: true,
        subordinateColumns: [1],
        aside: completenessLine(report.completeness),
        whenEmpty: "No client was billed in this period.",
      },
    ],
  };
}
