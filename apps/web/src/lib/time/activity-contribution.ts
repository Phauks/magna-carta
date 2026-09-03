/*
 * How a time entry reads on the matter's Activity section — the narrative leads, because what the
 * work was is the only thing worth leading a row with; the hours and whether it bills ride beside.
 */
import Clock from "@lucide/svelte/icons/clock";
import {
  factNumber,
  factText,
  navigateInto,
  type ActivityContribution,
  type Fact,
} from "$lib/activity/contribution.ts";
import { formatDuration } from "@magna-carta/design-system/formatters";
import { ledgerStatusWord } from "$lib/records/ledger-status-word.ts";

export const timeEntryActivityContribution: ActivityContribution = {
  sourceKey: "timeEntry",
  section: "Time",
  noun: "Time entry",
  happened: "Time was booked",
  icon: Clock,
  labelMeaning: "Time booked",
  types: ["Time entry"],
  factsOf: (row) => {
    const result: Fact[] = [];
    const minutes = factNumber(row.facts, "durationMinutes");
    // One decimal is what an activity row can carry beside a narrative; the billing convention's
    // two decimals belong on the ledger, where the figure is the arithmetic rather than a gloss.
    if (minutes !== null) {
      result.push({ value: `${formatDuration(minutes, { decimalPlaces: 1 }).decimal} h` });
    }
    if (factNumber(row.facts, "billable") === 0) result.push({ value: "Non-billable" });
    const entryNumber = factText(row.facts, "entryNumber");
    if (entryNumber !== null) result.push({ value: entryNumber, tone: "muted" });
    const status = ledgerStatusWord(factText(row.facts, "status"));
    if (status !== undefined) result.push({ value: status });
    return result;
  },
  open: navigateInto,
};
