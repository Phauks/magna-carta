/*
 * One fee, on paper.
 *
 * The unit is printable by itself — a bill consolidates fees and a report counts them, but the fee
 * stands alone, and this is the sheet it stands on. What reaches the paper is a closed set of
 * stated strings: the sheet takes no markup and no formatter of its own, which is what makes it
 * possible to say with certainty what a client can read.
 *
 * THE INTERNAL MEMO IS ABSENT BY CONSTRUCTION. It is not filtered out here and it is not named
 * here: there is no field on this sheet through which it could arrive. That is the difference
 * between a promise and a proof — a reader of this file can enumerate everything the paper says.
 *
 * A FACT NOBODY SERVES IS STILL A FACT THE SHEET NAMES. The entered date, the person who entered
 * it, the files attached and the invoice a billed fee rides all belong on a printed fee, so the
 * sheet states the gap rather than silently printing a shorter record than the one that exists.
 */
import type { PrintSheetDocument } from "@magna-carta/design-system/print-sheet/projection";
import { statusEntry } from "@magna-carta/design-system/status-register";
import { FEE_LEDGER_GAPS } from "./fee-gaps.ts";
import { billingSentence, feeStatusKey, type FeeRecord } from "./fee-record.ts";

/** Everything the sheet needs that is not the fee itself. */
export interface FeeSheetContext {
  readonly matterTitle: string;
  readonly matterNumber?: string | null;
  /** Money in the matter's own currency, given the amount in major units. */
  readonly money: (amount: number) => string;
  /** A date as a reader sees it. */
  readonly date: (isoDate: string) => string;
  /** When the sheet was taken, already stated as an instant. */
  readonly printedAt: string;
}

const NOT_SERVED = (gap: keyof typeof FEE_LEDGER_GAPS): string =>
  `Not served (waiting on ${FEE_LEDGER_GAPS[gap].waitsOn})`;

/** What one fee's sheet says. */
export function feeEntrySheet(fee: FeeRecord, context: FeeSheetContext): PrintSheetDocument {
  return {
    heading: "Fee",
    // The entry number is the sheet's reference and its only home on the page.
    reference: fee.entryNumber ?? `${FEE_LEDGER_GAPS.entryNumber.field} not yet recorded`,
    subtitle:
      context.matterNumber === undefined || context.matterNumber === null
        ? context.matterTitle
        : `${context.matterTitle} · Matter ${context.matterNumber}`,
    sections: [
      {
        id: "standing",
        kind: "fields",
        fields: [
          { label: "Status", value: statusEntry(feeStatusKey(fee.status)).label },
          { label: "Date", value: context.date(fee.feeDate) },
          {
            label: "Date Entered",
            value:
              fee.enteredDate === null ? NOT_SERVED("dateEntered") : context.date(fee.enteredDate),
          },
          { label: "Timekeeper", value: fee.timekeeperName ?? "Not recorded" },
          { label: "Entered By", value: fee.enteredByName ?? NOT_SERVED("dateEntered") },
        ],
      },
      {
        id: "figures",
        kind: "fields",
        fields: [
          {
            label: "Amount",
            value: fee.amountMinor === null ? "Not recorded" : context.money(fee.amountMinor / 100),
          },
          { label: "Billing", value: billingSentence(fee.billable) },
          {
            label: "Attachments",
            value:
              fee.attachmentCount === null
                ? NOT_SERVED("attachments")
                : String(fee.attachmentCount),
          },
          {
            label: "Invoice",
            value: fee.invoiceNumber ?? (fee.status === "billed" ? NOT_SERVED("invoice") : "—"),
          },
        ],
      },
      { id: "description", kind: "text", title: "Description", text: fee.description },
      { id: "history", kind: "history", title: "History", events: [] },
    ],
    footer: `Magna Carta · printed ${context.printedAt}`,
  };
}
