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
 * A FACT NOBODY SERVES IS STILL A FACT THE SHEET NAMES. The entered date, the recorder and the
 * invoice a billed cost rides all belong on a printed cost, so the sheet states the gap rather than
 * silently printing a shorter record than the one that exists.
 */
import type { PrintSheetDocument } from "@magna-carta/design-system/print-sheet/projection";
import { statusEntry } from "@magna-carta/design-system/status-register";
import { costStatusKey, type CostSummary } from "$lib/matters/cost-api.ts";
import { expenseCodeText, type ExpenseCodeLabels } from "./cost-columns.ts";
import { COST_LEDGER_GAPS } from "./cost-gaps.ts";
import {
  CLASS_LABELS,
  billingSentence,
  costAmount,
  payeeText,
  sourceLabel,
  type CostCaptureSource,
} from "./cost-vocabulary.ts";

/** Everything the sheet needs that is not the cost itself. */
export interface CostSheetContext {
  readonly matterTitle: string;
  readonly matterNumber?: string | null;
  /** Money in the matter's own currency, given the amount in major units. */
  readonly money: (amount: number) => string;
  /** A date as a reader sees it. */
  readonly date: (isoDate: string) => string;
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
  const receipt = cost.disbursementClass === "soft" ? "— (soft cost)" : NOT_SERVED("receipt");
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
          { label: "Status", value: statusEntry(costStatusKey(cost.status)).label },
          { label: "Date Incurred", value: context.date(cost.incurredDate) },
          { label: "Date Entered", value: NOT_SERVED("dateEntered") },
          { label: "Payee", value: payeeText(cost) },
          { label: "Entered By", value: NOT_SERVED("enteredBy") },
        ],
      },
      {
        id: "figures",
        kind: "fields",
        fields: [
          { label: "Amount", value: context.money(costAmount(cost)) },
          { label: "Class", value: CLASS_LABELS[cost.disbursementClass] },
          { label: "Billing", value: billingSentence(cost.billable) },
          { label: "Expense Code", value: expenseCode === "" ? "—" : expenseCode },
          { label: "Receipt", value: receipt },
          {
            label: "Source",
            value: context.source === undefined ? "—" : sourceLabel(context.source),
          },
          {
            label: "Invoice",
            value: cost.status === "billed" ? NOT_SERVED("invoice") : "—",
          },
        ],
      },
      { id: "info", kind: "text", title: "Info", text: cost.description },
      { id: "history", kind: "history", title: "History", events: [] },
    ],
    footer: `Magna Carta · printed ${context.printedAt}`,
  };
}
