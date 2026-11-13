/*
 * One cost, on paper.
 *
 * The unit is printable by itself — a report combines costs and an invoice consolidates them, but
 * the cost stands alone, and this is the sheet it stands on. What reaches the paper is a closed set
 * of stated strings: the sheet takes no markup and no formatter of its own, which is what makes it
 * possible to say with certainty what a client can read.
 *
 * The internal memo is not on this sheet and is not even named on it. That is not a filter applied
 * here — the record this surface holds carries no memo at all yet.
 *
 * A FACT NOBODY SERVES IS STILL A FACT THE SHEET NAMES. The entry number and the files attached
 * both belong on a printed cost, so the sheet states the gap rather than silently printing a
 * shorter record than the one that exists. The entered date, the recorder and the invoice a billed
 * cost rides were in that list until the listing began serving them; they print values now.
 */
import type { PrintSheetDates } from "$lib/print-sheet";
import type { PrintSheetDocument } from "@magna-carta/design-system/print-sheet/projection";
import { statusEntry } from "@magna-carta/design-system/status-register";
import { costStatusKey, type CostSummary } from "$lib/matters/cost-api.ts";
import { expenseCodeText, type ExpenseCodeLabels } from "./cost-columns.ts";
import { COST_LEDGER_GAPS } from "./cost-gaps.ts";
import {
  billingSentence,
  costAmount,
  payeeText,
  sourceLabel,
  type CostCaptureSource,
} from "./cost-vocabulary.ts";
import { recorderText } from "$lib/records/work-in-progress-record.ts";

/** Everything the sheet needs that is not the cost itself. */
export interface CostSheetContext extends PrintSheetDates {
  readonly matterTitle: string;
  readonly matterNumber?: string | null;
  /** Money in the matter's own currency, given the amount in major units. */
  readonly money: (amount: number) => string;
  /** An instant as a reader sees it — a moment, not a day. */
  readonly instant: (isoInstant: string) => string;
  /** When the sheet was taken, already stated as an instant. */
  readonly printedAt: string;
  /** How an expense-code identifier is read into a human label, where the catalogue is readable. */
  readonly expenseCodeLabels: ExpenseCodeLabels;
  /** How the cost came to be recorded, where the listing said. */
  readonly source?: CostCaptureSource;
}

const NOT_SERVED = (gap: keyof typeof COST_LEDGER_GAPS): string =>
  `Not served (waiting on ${COST_LEDGER_GAPS[gap].waitsOn})`;

/** What one cost's sheet says. */
export function costEntrySheet(cost: CostSummary, context: CostSheetContext): PrintSheetDocument {
  const expenseCode = expenseCodeText(cost, context.expenseCodeLabels);
  return {
    heading: "Cost Entry",
    // The entry number is the sheet's reference and its only home on the page. Until the record
    // carries one, the sheet states the gap rather than printing a number nothing issued.
    reference: `${COST_LEDGER_GAPS.entryNumber.field} not yet recorded`,
    subtitle:
      context.matterNumber === undefined || context.matterNumber === null
        ? context.matterTitle
        : `${context.matterTitle} · Matter ${context.matterNumber}`,
    sections: [
      {
        id: "standing",
        kind: "fields",
        fields: [
          {
            label: "Status",
            value: statusEntry(costStatusKey(cost.status)).label,
          },
          { label: "Date Incurred", value: context.date(cost.incurredDate) },
          { label: "Date Entered", value: context.instant(cost.createdAt) },
          { label: "Payee", value: payeeText(cost) },
          { label: "Entered By", value: recorderText(cost) },
        ],
      },
      {
        id: "figures",
        kind: "fields",
        fields: [
          { label: "Amount", value: context.money(costAmount(cost)) },
          { label: "Billing", value: billingSentence(cost.billable) },
          {
            label: "Expense Code",
            value: expenseCode === "" ? "—" : expenseCode,
          },
          { label: "Attachments", value: NOT_SERVED("attachments") },
          {
            label: "Source",
            value: context.source === undefined ? "—" : sourceLabel(context.source),
          },
          {
            // The reference itself, not a link: paper cannot be clicked, and the number is what
            // somebody holding the sheet needs in order to find the bill. A cost billed before the
            // reference was written on the record says so rather than printing an empty field.
            label: "Invoice",
            value:
              cost.status !== "billed"
                ? "—"
                : (cost.invoiceId ?? "Billed, but the bill isn't linked to this cost"),
          },
        ],
      },
      {
        id: "description",
        kind: "text",
        title: "Description",
        text: cost.description,
      },
      { id: "history", kind: "history", title: "History", events: [] },
    ],
    footer: `Magna Carta · printed ${context.printedAt}`,
  };
}
