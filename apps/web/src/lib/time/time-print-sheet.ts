/*
 * One time entry, on paper.
 *
 * The unit is printable by itself — a report combines entries and an invoice consolidates them, but
 * the entry stands alone, and this is the sheet it stands on. What reaches the paper is a closed set
 * of stated strings: the sheet takes no markup and no formatter of its own, which is what makes it
 * possible to say with certainty what a client can read.
 *
 * THE INTERNAL MEMO IS NOT ON THIS SHEET AND IS NOT EVEN NAMED ON IT. The record now carries one,
 * so that is a decision this file makes rather than an absence it inherits: the memo is the firm's
 * own note, this sheet is what a client can be handed, and the two never meet. The way it is kept
 * true is that this function names every field it prints — nothing here spreads the entry — so a
 * field reaches the paper only by somebody writing it down here.
 *
 * A duration prints in both literacies, the same way it renders on screen: decimal leading, clock
 * beside it. Money and dates arrive already rendered, because the currency and the locale belong to
 * the surface doing the printing, not to the description of what the paper says.
 */
import type { PrintSheetDates } from "$lib/print-sheet";
import { statusEntry } from "@magna-carta/design-system/status-register";
import type { PrintSheetDocument } from "@magna-carta/design-system/print-sheet/projection";
import type { TimeEntrySummary } from "$lib/matters/time-api.ts";
import {
  chargeAmount,
  durationParts,
  rateAmount,
  timekeeperOf,
  utbmsText,
} from "./time-columns.ts";

/** Everything the sheet needs that is not the entry itself. */
export interface TimeSheetContext extends PrintSheetDates {
  readonly matterTitle: string;
  readonly matterNumber?: string;
  /** Money in the matter's own currency, given the amount in major units. */
  readonly money: (amount: number) => string;
  /** When the sheet was taken, already stated as an instant. */
  readonly printedAt: string;
}

/** What one entry's sheet says. */
export function timeEntrySheet(
  entry: TimeEntrySummary,
  context: TimeSheetContext,
): PrintSheetDocument {
  const worked = durationParts(entry.rawDurationMinutes);
  const billed = durationParts(entry.durationMinutes);
  const amount = chargeAmount(entry);
  return {
    heading: "Time Entry",
    // The entry number is the sheet's reference and its only home on the page. An entry captured
    // before the sequence existed carries none, and the sheet says so rather than printing a
    // number nothing issued.
    reference: entry.entryNumber ?? "Entry number not recorded",
    subtitle:
      context.matterNumber === undefined
        ? context.matterTitle
        : `${context.matterTitle} · Matter ${context.matterNumber}`,
    sections: [
      {
        id: "facts",
        kind: "fields",
        fields: [
          { label: "Work Date", value: context.date(entry.workDate) },
          // Both dates and both people: the day the work was FOR and the day it was written down,
          // whose work it is and who typed it.
          ...(entry.createdAt === undefined
            ? []
            : [{ label: "Date Entered", value: context.instantDate(entry.createdAt) }]),
          { label: "Timekeeper", value: timekeeperOf(entry) },
          ...(entry.createdByName === null || entry.createdByName === undefined
            ? []
            : [{ label: "Entered By", value: entry.createdByName }]),
          { label: "Status", value: statusEntry(entry.status).label },
          { label: "Billable", value: entry.billable ? "Yes" : "No" },
          ...(utbmsText(entry.utbmsTaskCode, entry.utbmsTaskLabel) === ""
            ? []
            : [{ label: "Category", value: utbmsText(entry.utbmsTaskCode, entry.utbmsTaskLabel) }]),
          ...(utbmsText(entry.utbmsActivityCode, entry.utbmsActivityLabel) === ""
            ? []
            : [
                {
                  label: "Activity",
                  value: utbmsText(entry.utbmsActivityCode, entry.utbmsActivityLabel),
                },
              ]),
        ],
      },
      {
        id: "figures",
        kind: "fields",
        fields: [
          { label: "Worked", value: worked.decimal, secondary: worked.clock },
          { label: "Billed", value: billed.decimal, secondary: billed.clock },
          ...(rateAmount(entry) === null
            ? []
            : [{ label: "Rate", value: context.money(rateAmount(entry) ?? 0) }]),
          { label: "Amount", value: amount === null ? "No charge" : context.money(amount) },
        ],
      },
      { id: "description", kind: "text", title: "Description", text: entry.narrative },
    ],
    footer: `Magna Carta · printed ${context.printedAt}`,
  };
}
