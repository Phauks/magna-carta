/*
 * The Time ledger's columns — what the matter's time record says about itself, declared once.
 *
 * The grid is the product's one table, so nothing about sorting, filtering, hiding, reordering,
 * pinning, resizing or totalling is decided here. This file says only WHAT the columns are: their
 * words, their value types, which of them sum, and which of them the server cannot fill yet.
 *
 * TWO DURATIONS, NOT ONE. Worked is the time as it happened and Hours is the time as it bills; a
 * firm reads both and the difference between them is where rounding shows. Each renders in both
 * literacies — the decimal leads because it is the figure the arithmetic multiplies and the bill
 * carries, and the clock form sits beside it, quieter.
 *
 * A COLUMN THE LISTING CANNOT FILL STILL EXISTS. Its label is real, it appears in the columns menu,
 * and its cells say what they are waiting on instead of showing a value nobody recorded. It starts
 * hidden, because a column of identical gap marks in front of every reader is noise rather than
 * honesty — the honesty is that the column is there to be turned on and says why it is empty.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { formatDuration, personName } from "@magna-carta/design-system/formatters";
import { statusEntry } from "@magna-carta/design-system/status-register";
import { type TimeEntrySummary } from "$lib/matters/time-api.ts";
import { gapCellTitle, type TimeLedgerGapName } from "./time-gaps.ts";

/** Column ids, spelled in full, so a test and a stored layout name the same thing as the code. */
export const TIME_COLUMN_IDENTIFIERS = {
  workDate: "workDate",
  entryNumber: "entryNumber",
  dateEntered: "dateEntered",
  timekeeper: "timekeeper",
  description: "description",
  category: "category",
  activity: "activity",
  worked: "worked",
  hours: "hours",
  rate: "rate",
  amount: "amount",
  billable: "billable",
  attachments: "attachments",
  status: "status",
} as const;

/** Which columns carry a value the listing does not serve, and which gap each of them names. */
export const UNSERVED_TIME_COLUMNS: Readonly<Record<string, TimeLedgerGapName>> = {
  [TIME_COLUMN_IDENTIFIERS.entryNumber]: "entryNumber",
  [TIME_COLUMN_IDENTIFIERS.dateEntered]: "dateEntered",
  [TIME_COLUMN_IDENTIFIERS.category]: "category",
  [TIME_COLUMN_IDENTIFIERS.activity]: "activity",
  [TIME_COLUMN_IDENTIFIERS.rate]: "rate",
  [TIME_COLUMN_IDENTIFIERS.attachments]: "attachments",
};

/** Whether this column's values can be read at all yet. */
export function isUnservedColumn(columnIdentifier: string): boolean {
  return columnIdentifier in UNSERVED_TIME_COLUMNS;
}

/** The gap a column names, or undefined where the column carries real data. */
export function columnGap(columnIdentifier: string): TimeLedgerGapName | undefined {
  return UNSERVED_TIME_COLUMNS[columnIdentifier];
}

/** What an unserved cell's hover says. */
export function unservedCellTitle(columnIdentifier: string): string {
  const gap = columnGap(columnIdentifier);
  return gap === undefined ? "" : gapCellTitle(gap);
}

/**
 * What an entry charges, in the currency's major unit, or null where it charges nothing.
 *
 * Null is the load-bearing answer: a non-billable entry is not a zero, it is a statement that
 * nothing is charged, and a surface that rendered it as money would be asserting a price. Turning
 * that into text is presentation and belongs where the rendering happens, which is why this returns
 * a number and not a string.
 */
export function chargeAmount(entry: TimeEntrySummary): number | null {
  if (!entry.billable || entry.amountMinor === null) return null;
  return entry.amountMinor / 100;
}

/** The initials that ride beside a timekeeper's name — never instead of it. */
export function personInitials(name: string): string {
  const words = name.split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return "";
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Whose work an entry records, as the record itself captured it. */
export function timekeeperOf(entry: TimeEntrySummary): string {
  return personName(entry.timekeeperName);
}

/** Both forms of a duration held in minutes; the decimal leads, the clock reads beside it. */
export function durationParts(minutes: number): { decimal: string; clock: string; text: string } {
  return formatDuration(minutes);
}

/** A sum the totals row holds, arriving in hours because that is the column's own unit. */
function hoursTotalText(sumInHours: number): string {
  return formatDuration(sumInHours * 60).text;
}

/**
 * The ledger's columns, in the order the design puts them.
 *
 * `currency` follows the rows rather than being assumed: a matter's entries are written in the
 * firm's currency, and reading it off the data is what keeps the totals row and the cells agreeing.
 */
export function timeLedgerColumns(currency: string): readonly GridColumn<TimeEntrySummary>[] {
  return [
    {
      id: TIME_COLUMN_IDENTIFIERS.workDate,
      label: "Date",
      type: "date",
      anchored: true,
      value: (entry) => entry.workDate,
    },
    {
      id: TIME_COLUMN_IDENTIFIERS.entryNumber,
      label: "Entry Number",
      type: "text",
      hidden: true,
      filter: "none",
      value: () => null,
      text: () => "",
    },
    {
      id: TIME_COLUMN_IDENTIFIERS.dateEntered,
      label: "Date Entered",
      type: "date",
      hidden: true,
      filter: "none",
      value: () => null,
      text: () => "",
    },
    {
      id: TIME_COLUMN_IDENTIFIERS.timekeeper,
      label: "Timekeeper",
      type: "text",
      filter: "set",
      fitExtra: 30,
      value: (entry) => timekeeperOf(entry),
    },
    {
      id: TIME_COLUMN_IDENTIFIERS.description,
      label: "Description",
      type: "text",
      value: (entry) => entry.narrative,
    },
    {
      id: TIME_COLUMN_IDENTIFIERS.category,
      label: "Category",
      type: "text",
      hidden: true,
      filter: "none",
      value: () => null,
      text: () => "",
    },
    {
      id: TIME_COLUMN_IDENTIFIERS.activity,
      label: "Activity",
      type: "text",
      hidden: true,
      filter: "none",
      value: () => null,
      text: () => "",
    },
    {
      id: TIME_COLUMN_IDENTIFIERS.worked,
      label: "Worked",
      type: "number",
      hidden: true,
      total: "sum",
      filterNote: "In hours, as worked.",
      value: (entry) => entry.rawDurationMinutes / 60,
      text: (entry) => durationParts(entry.rawDurationMinutes).text,
      totalText: hoursTotalText,
    },
    {
      id: TIME_COLUMN_IDENTIFIERS.hours,
      label: "Hours",
      type: "number",
      total: "sum",
      filterNote: "In hours, as billed.",
      value: (entry) => entry.durationMinutes / 60,
      text: (entry) => durationParts(entry.durationMinutes).text,
      totalText: hoursTotalText,
    },
    {
      id: TIME_COLUMN_IDENTIFIERS.rate,
      label: "Rate",
      type: "money",
      currency,
      hidden: true,
      filter: "none",
      value: () => null,
      text: () => "",
    },
    {
      id: TIME_COLUMN_IDENTIFIERS.amount,
      label: "Amount",
      type: "money",
      currency,
      total: "sum",
      filterNote: "In the matter's currency.",
      value: (entry) => chargeAmount(entry),
    },
    {
      id: TIME_COLUMN_IDENTIFIERS.billable,
      label: "Billable",
      type: "text",
      hidden: true,
      filter: "set",
      value: (entry) => (entry.billable ? "Billable" : "Non-billable"),
    },
    {
      id: TIME_COLUMN_IDENTIFIERS.attachments,
      label: "Attachments",
      type: "text",
      hidden: true,
      filter: "none",
      value: () => null,
      text: () => "",
    },
    {
      id: TIME_COLUMN_IDENTIFIERS.status,
      label: "Status",
      type: "text",
      filter: "set",
      fitExtra: 26,
      value: (entry) => statusEntry(entry.status).label,
    },
  ];
}
