/*
 * One time entry, on paper.
 *
 * The unit is printable by itself — a report combines entries and an invoice consolidates them, but
 * the entry stands alone, and this is the sheet it stands on. What reaches the paper is a closed set
 * of stated strings: the sheet takes no markup and no formatter of its own, which is what makes it
 * possible to say with certainty what a client can read.
 *
 * The internal memo is not on this sheet and is not even named on it. That is not a filter applied
 * here — the record this surface holds carries no memo at all yet, and when it does, the print
 * sheet's own client-facing projection is what will keep it off the paper.
 *
 * A duration prints in both literacies, the same way it renders on screen: decimal leading, clock
 * beside it. Money and dates arrive already rendered, because the currency and the locale belong to
 * the surface doing the printing, not to the description of what the paper says.
 */
import { statusEntry } from "@magna-carta/design-system/status-register";
import type { PrintSheetDocument } from "@magna-carta/design-system/print-sheet/projection";
import type { TimeEntrySummary } from "$lib/matters/time-api.ts";
import { chargeAmount, durationParts, timekeeperOf } from "./time-columns.ts";
import { TIME_LEDGER_GAPS } from "./time-gaps.ts";

/** Everything the sheet needs that is not the entry itself. */
export interface TimeSheetContext {
  readonly matterTitle: string;
  readonly matterNumber?: string;
  /** Money in the matter's own currency, given the amount in major units. */
  readonly money: (amount: number) => string;
  /** A work date as a reader sees it. */
  readonly date: (isoDate: string) => string;
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
    // The entry number is the sheet's reference and its only home on the page. Until the record
    // carries one, the sheet states the gap rather than printing a number nothing issued.
    reference: `${TIME_LEDGER_GAPS.entryNumber.field} not yet recorded`,
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
          { label: "Timekeeper", value: timekeeperOf(entry) },
          { label: "Status", value: statusEntry(entry.status).label },
          { label: "Billable", value: entry.billable ? "Yes" : "No" },
        ],
      },
      {
        id: "figures",
        kind: "fields",
        fields: [
          { label: "Worked", value: worked.decimal, secondary: worked.clock },
          { label: "Billed", value: billed.decimal, secondary: billed.clock },
          { label: "Amount", value: amount === null ? "No charge" : context.money(amount) },
        ],
      },
      { id: "description", kind: "text", title: "Description", text: entry.narrative },
    ],
    footer: `Magna Carta · printed ${context.printedAt}`,
  };
}
