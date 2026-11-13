/*
 * The firm's Time screen's own decisions: the capability behind reading anybody else's time, and
 * what the strip under the table says.
 *
 * The surface is composition; this is the part of it worth holding still in a test. Whose time is
 * being read is no longer decided here: it is the Timekeeper column's own filter, sent to the
 * listing as its `timekeeperUserId` ($lib/money/listing-scope.ts), so the one control a reader
 * sets is the one the server honours.
 */
import { formatDuration } from "@magna-carta/design-system/formatters";
import type { GridFigure } from "@magna-carta/design-system/data-table";
import type { PeriodTotals } from "./time-figures.ts";

/** The capability that lets a member read time that is not their own. */
export const VIEW_FIRM_TIME_PERMISSION = "time:viewFirm";

/** A span of minutes in both literacies, as every duration on the product renders. */
function hours(minutes: number): string {
  return formatDuration(minutes).text;
}

/**
 * The strip under the table, as text.
 *
 * Hours lead and money follows, because a period is read in hours: "how much did I record this
 * week" is asked before "what is it worth". The billable figure carries the non-billable beside it
 * rather than instead of it — internal time is work, and a strip that reported only what bills
 * would quietly teach a firm that the rest of the week did not happen.
 *
 * A VOID IS NAMED RATHER THAN NETTED. Where the period holds one, the count says so, so a reader
 * who counts the rows and does not get the same number has the reason in front of them.
 */
export function periodFigureReading(
  totals: PeriodTotals,
  money: (amountMinor: number) => string,
): readonly GridFigure[] {
  return [
    {
      identifier: "recorded",
      label: "recorded",
      value: hours(totals.recordedMinutes),
      caption:
        totals.voidCount === 0
          ? "All hours recorded this period, billable and not."
          : `All hours recorded this period, billable and not. ${String(totals.voidCount)} voided ${totals.voidCount === 1 ? "entry is" : "entries are"} not counted.`,
    },
    {
      identifier: "billable",
      label: "billable",
      value: hours(totals.billableMinutes),
      caption: "The hours a client can be charged for.",
    },
    {
      identifier: "non-billable",
      label: "non-billable",
      value: hours(totals.nonBillableMinutes),
      caption: "Hours recorded as firm time. Real work that no client is charged for.",
    },
    {
      identifier: "unbilled",
      label: "unbilled",
      value: money(totals.unbilledAmountMinor),
      caption: "Billable value not yet on a finalized bill.",
    },
    {
      identifier: "billed",
      label: "billed",
      value: money(totals.billedAmountMinor),
      caption: "Billable value on a finalized bill.",
    },
  ];
}
