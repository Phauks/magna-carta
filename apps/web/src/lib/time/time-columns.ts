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
 *
 * NO COLUMN IS IN THAT STATE ANY MORE. Six of them were — the entry number, the entered date, both
 * UTBMS codes, the resolved rate and the attachment count — against a listing that had been serving
 * every one of them. They stay hidden by default, which is a judgement about what a reader wants in
 * front of them and not a statement about the record; each is one right-click away in the columns
 * roster, and each now carries the value it was always designed to.
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

/**
 * Which columns carry a value the listing does not serve, and which gap each of them names.
 *
 * Empty, and deliberately kept: every column on this ledger now reads a served field. The map and
 * its two readers stay because the next column the design adds will arrive before its route does,
 * and the honest rendering for that is already built.
 */
export const UNSERVED_TIME_COLUMNS: Readonly<Record<string, TimeLedgerGapName>> = {};

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
 * How a UTBMS code reads: the code and its label together, or nothing at all.
 *
 * Both halves, because neither works alone — "A103" is legible to a billing clerk and to nobody
 * else, and "Draft/revise" loses the code an electronic bill actually carries. An entry with no
 * code returns an empty string rather than a stand-in, so the set filter groups the uncoded entries
 * under one honest heading instead of scattering them.
 */
export function utbmsText(
  code: string | null | undefined,
  label: string | null | undefined,
): string {
  if (code === null || code === undefined || code === "") return "";
  return label === null || label === undefined || label === "" ? code : `${code} · ${label}`;
}

/**
 * The rate an entry froze at capture, in the currency's major unit, or null where it charges
 * nothing. The stored scale is 4, so the divisor is 10,000 and not 100.
 */
export function rateAmount(entry: TimeEntrySummary): number | null {
  const rate = entry.rateE4;
  if (rate === null || rate === undefined) return null;
  return rate / 10_000;
}

/** How many files ride an entry. Nothing attached reads as nothing, never as a zero. */
export function attachmentText(count: number): string {
  if (count === 0) return "";
  return count === 1 ? "1 file" : `${String(count)} files`;
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
    /*
     * The entry's own reference, immutable and never reused. Null on an entry captured before the
     * sequence existed, which is a real gap on that row rather than one the product has: the cell
     * says so and nothing invents a number to fill the column.
     */
    {
      id: TIME_COLUMN_IDENTIFIERS.entryNumber,
      label: "Entry Number",
      type: "text",
      hidden: true,
      filter: "none",
      value: (entry) => entry.entryNumber ?? null,
      text: (entry) => entry.entryNumber ?? "",
    },
    // The day the entry was written down, beside the day the work was FOR. Two dates, two columns.
    {
      id: TIME_COLUMN_IDENTIFIERS.dateEntered,
      label: "Date Entered",
      type: "date",
      hidden: true,
      value: (entry) => entry.createdAt ?? null,
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
    /*
     * The two UTBMS codes, each read as the code and its label together: a bare "A103" is legible
     * to a billing clerk and to nobody else, and the label alone loses the code an e-billing export
     * carries. The set filter holds the pair, so filtering by either half finds the row.
     */
    {
      id: TIME_COLUMN_IDENTIFIERS.category,
      label: "Category",
      type: "text",
      hidden: true,
      filter: "set",
      value: (entry) => utbmsText(entry.utbmsTaskCode, entry.utbmsTaskLabel),
    },
    {
      id: TIME_COLUMN_IDENTIFIERS.activity,
      label: "Activity",
      type: "text",
      hidden: true,
      filter: "set",
      value: (entry) => utbmsText(entry.utbmsActivityCode, entry.utbmsActivityLabel),
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
    /*
     * The rate the entry froze at capture, in the currency's major unit. Null on non-billable
     * internal time, which is a statement that nothing is charged rather than a rate of zero — the
     * money column type renders that as a dash of its own accord.
     */
    {
      id: TIME_COLUMN_IDENTIFIERS.rate,
      label: "Rate",
      type: "money",
      currency,
      hidden: true,
      value: (entry) => rateAmount(entry),
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
    // How many of the matter's documents the entry points at. A count, so it sorts and sums.
    {
      id: TIME_COLUMN_IDENTIFIERS.attachments,
      label: "Attachments",
      type: "number",
      hidden: true,
      value: (entry) => entry.attachmentCount ?? 0,
      text: (entry) => attachmentText(entry.attachmentCount ?? 0),
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
