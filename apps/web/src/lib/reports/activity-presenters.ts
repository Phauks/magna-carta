/*
 * The productivity and operational reports, arranged for a screen and a file.
 *
 * Totals first, then tables, as the financial reports are. Productivity is minutes and never money:
 * what the time was worth is the realization report's, on a different permission. Operational
 * volumes are counts and never money. Every figure is the payload's; the tiles are its totals and
 * fields, and nothing here adds two counts.
 */
import { formatNumber } from "@magna-carta/design-system/formatters";
import {
  completenessLine,
  type ReportCell,
  type ReportPresentation,
  type ReportSummaryTile,
} from "./report-presentation.ts";
import {
  captionOr,
  counted,
  countCell,
  hoursCell,
  hoursText,
  shareCell,
  shareText,
} from "./report-cells.ts";
import { NO_CLIENT, NO_OFFICE } from "./financial-presenters.ts";
import type {
  OperationalVolumes,
  ProductivityFigures,
  TimekeeperProductivity,
} from "./report-reads.ts";
import type { ReportCaptions } from "./trust-compliance-presenter.ts";

// ---- timekeeper productivity ----------------------------------------------------------------------

function productivityCells(figures: ProductivityFigures): ReportCell[] {
  return [
    hoursCell(figures.billableMinutes),
    hoursCell(figures.nonBillableMinutes),
    hoursCell(figures.totalMinutes),
    shareCell(figures.billableShareBasisPoints),
  ];
}

const PRODUCTIVITY_HEADINGS = ["Billable", "Non-billable", "Total", "Billable share"];

export function presentTimekeeperProductivity(
  report: TimekeeperProductivity,
  captions: ReportCaptions,
): ReportPresentation {
  const totals = report.totals;
  const summary: ReportSummaryTile[] = [
    {
      label: "Billable",
      value: hoursText(totals.billableMinutes),
      detail: null,
      tone: "plain",
    },
    {
      label: "Non-billable",
      value: hoursText(totals.nonBillableMinutes),
      detail: null,
      tone: "plain",
    },
    {
      label: "Billable share",
      value:
        totals.billableShareBasisPoints === null ? "-" : shareText(totals.billableShareBasisPoints),
      detail: null,
      tone: "plain",
    },
    {
      label: "Total recorded",
      value: hoursText(totals.totalMinutes),
      detail: `${counted(totals.entryCount, "entry", "entries")} · ${counted(report.timekeepers.length, "timekeeper", "timekeepers")}`,
      tone: "total",
    },
  ];

  return {
    title: "Timekeeper Productivity",
    subtitle: null,
    stamp: report.statement,
    reproducible: false,
    completeness: report.completeness,
    summary,
    sections: [
      {
        id: "by-office",
        title: "By Office",
        headers: ["Office", ...PRODUCTIVITY_HEADINGS],
        rows: report.offices.map((office) => [
          captionOr(office.locationName, NO_OFFICE),
          ...productivityCells(office.figures),
        ]),
        endAlignedColumns: [1, 2, 3, 4],
        totalRow: [
          report.locationId === null ? "Firm total" : "Office total",
          ...productivityCells(totals),
        ],
        whenEmpty: "No time was recorded in this period.",
      },
      {
        id: "by-timekeeper",
        title: "By Timekeeper",
        headers: ["Timekeeper", "Matters", ...PRODUCTIVITY_HEADINGS],
        rows: report.timekeepers.map((timekeeper) => [
          captionOr(timekeeper.timekeeperName, captions.member(timekeeper.timekeeperUserId)),
          countCell(timekeeper.matterCount),
          ...productivityCells(timekeeper.figures),
        ]),
        endAlignedColumns: [1, 2, 3, 4, 5],
        sortable: true,
        aside: completenessLine(report.completeness),
        whenEmpty: "No time was recorded in this period.",
      },
      {
        id: "by-client",
        title: "By Client",
        headers: ["Client", ...PRODUCTIVITY_HEADINGS],
        rows: report.clients.map((client) => [
          captionOr(client.clientName, client.clientEntityId ?? NO_CLIENT),
          ...productivityCells(client.figures),
        ]),
        endAlignedColumns: [1, 2, 3, 4],
        sortable: true,
        whenEmpty: "No time was recorded in this period.",
      },
      {
        id: "by-task-code",
        title: "By Task Code",
        headers: ["Task code", ...PRODUCTIVITY_HEADINGS],
        rows: report.taskCodes.map((task) => [
          task.code === null
            ? "No task code"
            : task.label === null
              ? task.code
              : `${task.code} ${task.label}`,
          ...productivityCells(task.figures),
        ]),
        endAlignedColumns: [1, 2, 3, 4],
        sortable: true,
        whenEmpty: "No time was recorded in this period.",
      },
      {
        id: "non-billable-categories",
        title: "Non-Billable Time by Category",
        headers: ["Category", "Hours"],
        rows: report.nonBillableCategories.map((category) => [
          captionOr(category.categoryName, "No category"),
          hoursCell(category.minutes),
        ]),
        endAlignedColumns: [1],
        whenEmpty: "No non-billable time was recorded in this period.",
      },
    ],
  };
}

// ---- operational volumes --------------------------------------------------------------------------

const TRUST_MEASURE_LABELS: Readonly<
  Record<OperationalVolumes["trust"][number]["measure"], string>
> = {
  movement: "Trust movements",
  "disbursement-requested": "Disbursement requests",
  "disbursement-decided": "Disbursement decisions",
  "reconciliation-opened": "Reconciliations opened",
  "reconciliation-closed": "Reconciliations closed",
};

const TRUST_DETAIL_LABELS: Readonly<Record<string, string>> = {
  deposit: "Deposit",
  disbursement: "Disbursement",
  matter_transfer: "Transfer between matters",
  firm_funds_deposit: "Firm funds deposit",
  bank_charge: "Bank charge",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

const COST_CLASS_LABELS: Readonly<Record<"hard" | "soft", string>> = {
  hard: "Hard costs",
  soft: "Soft costs",
};

/**
 * The matter counts, one row per matter type with its opened and closed counts beside each other.
 * The payload gives one row per type and measure; this places the two measures of a type on one
 * row and adds nothing.
 */
function matterTypeRows(report: OperationalVolumes): ReportCell[][] {
  const byType = new Map<string, { name: string; opened: number; closed: number }>();
  for (const row of report.matters) {
    const key = row.matterTypeId ?? "";
    const entry = byType.get(key) ?? {
      name: captionOr(row.matterTypeName, "No matter type"),
      opened: 0,
      closed: 0,
    };
    if (row.measure === "opened") entry.opened = row.count;
    else entry.closed = row.count;
    byType.set(key, entry);
  }
  return [...byType.values()].map((entry) => [
    entry.name,
    countCell(entry.opened),
    countCell(entry.closed),
  ]);
}

export function presentOperationalVolumes(report: OperationalVolumes): ReportPresentation {
  const billing = report.billing;
  const tile = (label: string, count: number): ReportSummaryTile => ({
    label,
    value: formatNumber(count),
    detail: null,
    tone: "plain",
  });
  const summary: ReportSummaryTile[] = [
    tile("Bills drafted", billing.billsDrafted),
    tile("Bills finalized", billing.billsFinalized),
    tile("Drafts voided", billing.draftsVoided),
    tile("Credit notes", billing.creditNotesIssued),
    tile("Write-offs", billing.writeOffs),
  ];

  return {
    title: "Operational Volumes",
    subtitle: null,
    stamp: report.reproducibilityStatement,
    reproducible: report.reproducibility.reproducible,
    completeness: report.completeness,
    summary,
    sections: [
      {
        id: "matters",
        title: "Matters",
        headers: ["Matter type", "Opened", "Closed"],
        rows: matterTypeRows(report),
        endAlignedColumns: [1, 2],
        sortable: true,
        note: report.liveSectionsStatement,
        aside: completenessLine(report.completeness),
        whenEmpty: "No matter was opened or closed in this period.",
      },
      {
        id: "billing",
        title: "Billing",
        headers: ["Measure", "Count"],
        rows: [
          ["Bills drafted", countCell(billing.billsDrafted)],
          ["Bills finalized", countCell(billing.billsFinalized)],
          ["Drafts voided", countCell(billing.draftsVoided)],
          ["Credit notes issued", countCell(billing.creditNotesIssued)],
          ["Write-offs", countCell(billing.writeOffs)],
        ],
        endAlignedColumns: [1],
        whenEmpty: "Nothing was billed in this period.",
      },
      {
        id: "trust",
        title: "Trust",
        headers: ["Measure", "Kind", "Count"],
        rows: report.trust.map((row) => [
          TRUST_MEASURE_LABELS[row.measure],
          row.detail === null ? "" : (TRUST_DETAIL_LABELS[row.detail] ?? row.detail),
          countCell(row.count),
        ]),
        endAlignedColumns: [2],
        whenEmpty: "No trust activity in this period.",
      },
      {
        id: "costs",
        title: "Costs",
        headers: ["Class", "Entries"],
        rows: report.costs.map((row) => [
          COST_CLASS_LABELS[row.disbursementClass],
          countCell(row.count),
        ]),
        endAlignedColumns: [1],
        whenEmpty: "No cost was recorded in this period.",
      },
    ],
  };
}
