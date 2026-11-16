/*
 * One client's statement of account, arranged for a screen and a file.
 *
 * TOTALS FIRST, THEN TABLES. It opens with what the client owed when the period began, what was
 * billed, what was paid and credited, and what they owed when it ended; then every line of activity
 * oldest first with the balance after it, opened by the balance brought forward and ruled off with
 * the closing balance; then the bills still unpaid at the period's end, ruled off with the same
 * closing balance. A reversal is its own line in the payments column, negative, naming what it
 * reverses.
 *
 * Every figure is the payload's, the running balance included. Nothing here adds two figures; the
 * reporting package's tests prove the lines carry the opening balance to the closing one.
 */
import { formatDate } from "@magna-carta/design-system/formatters";
import { completenessLine, type ReportPresentation } from "./report-presentation.ts";
import { counted, moneyCell, moneyText } from "./report-cells.ts";
import { billCaption, dateText, entryKindText } from "./billing-presenters.ts";
import { matterCaption } from "./financial-presenters.ts";
import type { ClientStatement, ClientStatementLine } from "./report-reads.ts";

/** The client as the statement names them, with their handle beside the name. */
export function clientCaption(report: Pick<ClientStatement, "clientName" | "clientEntityId">) {
  return report.clientName === null
    ? report.clientEntityId
    : `${report.clientName} (${report.clientEntityId})`;
}

/** What a line was: a bill by its number, an application by its kind and the bill it was set against. */
function itemText(line: ClientStatementLine): string {
  if (line.kind === "invoice") return billCaption({ ...line, issueDate: line.date });
  const against = line.invoiceNumber === null ? "a bill" : `bill ${line.invoiceNumber}`;
  const item = `${entryKindText({ kind: line.kind, reversesKind: line.reversesKind })} on ${against}`;
  return line.reason === null ? item : `${item}: ${line.reason}`;
}

const mattersText = (matters: ClientStatementLine["matters"]): string =>
  matters.map(matterCaption).join(", ");

export function presentClientStatement(report: ClientStatement): ReportPresentation {
  const totals = report.totals;
  return {
    title: "Client Statement of Account",
    subtitle: clientCaption(report),
    stamp: report.reproducibilityStatement,
    reproducible: report.reproducibility.reproducible,
    completeness: report.completeness,
    summary: [
      {
        label: "Opening balance",
        value: moneyText(totals.openingMinor),
        detail: `owed on ${formatDate(report.periodStart)}`,
        tone: "plain",
      },
      {
        label: "Billed",
        value: moneyText(totals.billedMinor),
        detail: counted(totals.invoiceCount, "bill", "bills"),
        tone: "plain",
      },
      {
        label: "Paid and credited",
        value: moneyText(totals.appliedMinor),
        // Reversals are in the figure and on their own lines below.
        detail: counted(totals.applicationCount, "entry", "entries"),
        tone: "plain",
      },
      {
        label: "Closing balance",
        value: moneyText(totals.closingMinor),
        detail: `owed on ${formatDate(report.periodEnd)}`,
        tone: "total",
      },
    ],
    sections: [
      {
        id: "activity",
        title: "Activity",
        headers: ["Date", "Item", "Matter", "Charges", "Payments and credits", "Balance"],
        rows: [
          [
            dateText(report.periodStart),
            "Opening balance",
            "",
            "",
            "",
            moneyCell(totals.openingMinor),
          ],
          ...report.activity.map((line) => [
            dateText(line.date),
            itemText(line),
            mattersText(line.matters),
            line.chargedMinor === null ? "" : moneyCell(line.chargedMinor),
            line.appliedMinor === null ? "" : moneyCell(line.appliedMinor),
            moneyCell(line.balanceMinor),
          ]),
        ],
        endAlignedColumns: [3, 4, 5],
        totalRow: [
          dateText(report.periodEnd),
          "Closing balance",
          "",
          moneyCell(totals.billedMinor),
          moneyCell(totals.appliedMinor),
          moneyCell(totals.closingMinor),
        ],
        aside: completenessLine(report.completeness),
        // In the order each took effect, as served: a day's bills before what was applied that day.
        whenEmpty: "Nothing was billed or applied in this period.",
      },
      {
        id: "unpaid-bills",
        title: `Unpaid Bills at ${formatDate(report.periodEnd)}`,
        headers: ["Bill", "Matter", "Issued", "Due", "Billed", "Paid and credited", "Unpaid"],
        rows: report.unpaidInvoices.map((bill) => [
          bill.invoiceNumber ?? billCaption(bill),
          mattersText(bill.matters),
          dateText(bill.issueDate),
          dateText(bill.dueDate),
          moneyCell(bill.billedMinor),
          moneyCell(bill.paidAndCreditedMinor),
          moneyCell(bill.unpaidMinor),
        ]),
        endAlignedColumns: [4, 5, 6],
        totalRow: ["Total unpaid", "", "", "", "", "", moneyCell(totals.closingMinor)],
        whenEmpty: "Nothing was unpaid at the end of the period.",
      },
    ],
  };
}
