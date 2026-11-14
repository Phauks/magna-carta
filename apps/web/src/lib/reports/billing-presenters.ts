/*
 * The bills and what was set against them, arranged for a screen and a file: the Invoices report and
 * the Payments Applied report.
 *
 * TOTALS FIRST, THEN TABLES, as every financial report (financial-presenters.ts). Invoices opens with
 * what was billed, credited, applied and still unpaid, then a table by office ruled off with the
 * report's total, then a sortable table by client whose rows open onto the client's bills. Payments
 * Applied opens with what was applied by kind, then a table by kind, by office, by client, and every
 * entry in the order it took effect, a reversal on its own negative row naming what it reverses.
 *
 * Every figure is the payload's. Nothing here adds two figures; the reporting package's tests prove
 * the groups sum to the totals.
 */
import { formatDate } from "@magna-carta/design-system/formatters";
import {
  completenessLine,
  type ReportCell,
  type ReportPresentation,
  type ReportSummaryTile,
} from "./report-presentation.ts";
import { captionOr, countCell, counted, moneyCell, moneyText } from "./report-cells.ts";
import { matterCaption, NO_CLIENT, NO_OFFICE } from "./financial-presenters.ts";
import type {
  AppliedEntry,
  AppliedFigures,
  ApplicationKind,
  InvoiceFigures,
  Invoices,
  PaymentsApplied,
} from "./report-reads.ts";

/** The label the total row of a by-office table carries. */
function totalLabel(locationId: string | null): string {
  return locationId === null ? "Firm total" : "Office total";
}

/** A civil date as the reader reads one, or a dash where there is none. */
function dateText(date: string | null): string {
  return date === null ? "-" : formatDate(date);
}

// ---- invoices --------------------------------------------------------------------------------------

const INVOICE_HEADINGS = ["Billed", "Credited", "Applied", "Unpaid"];

function invoiceCells(figures: InvoiceFigures): ReportCell[] {
  return [
    moneyCell(figures.billedMinor),
    moneyCell(figures.creditedMinor),
    moneyCell(figures.appliedMinor),
    moneyCell(figures.unpaidMinor),
  ];
}

/** A bill as the reader knows it: its number, or "Bill" with its date where it has none yet. */
function billCaption(bill: {
  readonly invoiceNumber: string | null;
  readonly issueDate: string;
}): string {
  return bill.invoiceNumber === null
    ? `Bill of ${dateText(bill.issueDate)}`
    : `Bill ${bill.invoiceNumber}`;
}

export function presentInvoices(report: Invoices): ReportPresentation {
  const summary: ReportSummaryTile[] = [
    {
      label: "Billed",
      value: moneyText(report.totals.billedMinor),
      detail: counted(report.totals.invoiceCount, "bill", "bills"),
      tone: "plain",
    },
    {
      label: "Credited and written off",
      value: moneyText(report.totals.creditedMinor),
      detail: null,
      tone: "plain",
    },
    { label: "Applied", value: moneyText(report.totals.appliedMinor), detail: null, tone: "plain" },
    {
      label: "Unpaid at period end",
      value: moneyText(report.totals.unpaidMinor),
      detail: null,
      tone: "total",
    },
  ];

  return {
    title: "Invoices",
    subtitle: null,
    stamp: report.reproducibilityStatement,
    reproducible: report.reproducibility.reproducible,
    completeness: report.completeness,
    summary,
    sections: [
      {
        id: "by-office",
        title: "By Office",
        headers: ["Office", "Bills", ...INVOICE_HEADINGS],
        rows: report.offices.map((office) => [
          captionOr(office.locationName, NO_OFFICE),
          countCell(office.figures.invoiceCount),
          ...invoiceCells(office.figures),
        ]),
        endAlignedColumns: [1, 2, 3, 4, 5],
        totalRow: [
          totalLabel(report.locationId),
          countCell(report.totals.invoiceCount),
          ...invoiceCells(report.totals),
        ],
        note: "A bill that charges matters in two offices counts once in each office.",
        whenEmpty: "No bills were issued in this period.",
      },
      {
        id: "by-client",
        title: "By Client",
        headers: ["Client", "Issued", "Due", ...INVOICE_HEADINGS],
        rows: report.clients.map((client) => [
          captionOr(client.clientName, client.clientEntityId || NO_CLIENT),
          counted(client.figures.invoiceCount, "bill", "bills"),
          "",
          ...invoiceCells(client.figures),
        ]),
        rowDetails: report.clients.map((client) =>
          client.invoices.map((bill) => [
            `${billCaption(bill)}: ${bill.matters.map(matterCaption).join(", ")}`,
            dateText(bill.issueDate),
            dateText(bill.dueDate),
            ...invoiceCells(bill.figures),
          ]),
        ),
        endAlignedColumns: [3, 4, 5, 6],
        sortable: true,
        aside: completenessLine(report.completeness),
        whenEmpty: "No client was billed in this period.",
      },
    ],
  };
}

// ---- payments applied ------------------------------------------------------------------------------

/** What each kind of application is called on the page. */
export const APPLICATION_KIND_LABELS: Readonly<Record<ApplicationKind, string>> = {
  payment: "Payment",
  trust_transfer: "From trust",
  client_credit: "Client credit",
  credit_note: "Credit note",
  write_off: "Write-off",
  reversal: "Reversal",
};

/** The kinds in the order the tables list them, each with the figure it is totalled in. */
const KIND_COLUMNS: readonly {
  readonly kind: ApplicationKind;
  readonly field: Exclude<keyof AppliedFigures, "entryCount" | "totalMinor">;
}[] = [
  { kind: "payment", field: "paymentMinor" },
  { kind: "trust_transfer", field: "trustTransferMinor" },
  { kind: "client_credit", field: "clientCreditMinor" },
  { kind: "credit_note", field: "creditNoteMinor" },
  { kind: "write_off", field: "writeOffMinor" },
  { kind: "reversal", field: "reversalMinor" },
];

const KIND_HEADINGS = [
  ...KIND_COLUMNS.map((column) => APPLICATION_KIND_LABELS[column.kind]),
  "Total",
];

function kindCells(figures: AppliedFigures): ReportCell[] {
  return [
    ...KIND_COLUMNS.map((column) => moneyCell(figures[column.field])),
    moneyCell(figures.totalMinor),
  ];
}

/** An entry's kind as printed: a reversal names the kind it unwinds. */
export function entryKindText(entry: Pick<AppliedEntry, "kind" | "reversesKind">): string {
  if (entry.kind !== "reversal" || entry.reversesKind === null) {
    return APPLICATION_KIND_LABELS[entry.kind];
  }
  return `Reversal of ${APPLICATION_KIND_LABELS[entry.reversesKind].toLowerCase()}`;
}

export function presentPaymentsApplied(report: PaymentsApplied): ReportPresentation {
  const totals = report.totals;
  const summary: ReportSummaryTile[] = [
    { label: "Payments", value: moneyText(totals.paymentMinor), detail: null, tone: "plain" },
    {
      label: "From trust",
      value: moneyText(totals.trustTransferMinor),
      detail: null,
      tone: "plain",
    },
    {
      label: "Client credits",
      value: moneyText(totals.clientCreditMinor),
      detail: null,
      tone: "plain",
    },
    {
      label: "Credit notes",
      value: moneyText(totals.creditNoteMinor),
      detail: null,
      tone: "plain",
    },
    { label: "Write-offs", value: moneyText(totals.writeOffMinor), detail: null, tone: "plain" },
    {
      label: "Total applied",
      value: moneyText(totals.totalMinor),
      // Reversals are in the total and in their own column of every table below.
      detail: counted(totals.entryCount, "entry", "entries"),
      tone: "total",
    },
  ];

  return {
    title: "Payments Applied",
    subtitle: null,
    stamp: report.reproducibilityStatement,
    reproducible: report.reproducibility.reproducible,
    completeness: report.completeness,
    summary,
    sections: [
      {
        id: "by-office",
        title: "By Office",
        headers: ["Office", ...KIND_HEADINGS],
        rows: report.offices.map((office) => [
          captionOr(office.locationName, NO_OFFICE),
          ...kindCells(office.figures),
        ]),
        endAlignedColumns: [1, 2, 3, 4, 5, 6, 7],
        totalRow: [totalLabel(report.locationId), ...kindCells(totals)],
        note: "Applied means set against a bill. Money arriving in the bank is not recorded here.",
        whenEmpty: "Nothing was applied to a bill in this period.",
      },
      {
        id: "by-client",
        title: "By Client",
        headers: ["Client", ...KIND_HEADINGS],
        rows: report.clients.map((client) => [
          captionOr(client.clientName, client.clientEntityId || NO_CLIENT),
          ...kindCells(client.figures),
        ]),
        endAlignedColumns: [1, 2, 3, 4, 5, 6, 7],
        sortable: true,
        aside: completenessLine(report.completeness),
        whenEmpty: "Nothing was applied to a client's bill in this period.",
      },
      {
        id: "entries",
        title: "Entries",
        headers: ["Date", "Kind", "Client", "Bill", "Matter", "Amount", "Reason"],
        rows: report.entries.map((entry) => [
          dateText(entry.effectiveDate),
          entryKindText(entry),
          captionOr(entry.clientName, entry.clientEntityId || NO_CLIENT),
          entry.invoiceNumber ?? "-",
          matterCaption(entry),
          moneyCell(entry.amountMinor),
          entry.reason ?? "",
        ]),
        endAlignedColumns: [5],
        // In the order each took effect, as served: a reversal sits after the entry it unwinds.
        whenEmpty: "Nothing was applied to a bill in this period.",
      },
    ],
  };
}
