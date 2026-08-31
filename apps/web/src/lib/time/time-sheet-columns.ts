/*
 * The Time Sheet's columns.
 *
 * The sheet is the rapid-entry surface, so its columns are the ones a person types into and the
 * ones they read back while typing. It runs on the product's ONE table, which means nothing about
 * sorting, filtering, hiding, reordering, pinning, resizing or totalling is decided here. This file
 * says only WHAT the columns are.
 *
 * WHAT DIFFERS FROM THE MATTER LEDGER'S COLUMNS, AND WHY. The ledger reads a matter's whole time
 * record; the sheet is where the day's work gets written down. So the sheet leads with the row's
 * state and its date, gives the description the room to wrap that the ledger truncates, and puts
 * the two durations side by side because reconciling them is the work.
 *
 * THE MATTER IS A COLUMN, BECAUSE THE SHEET IS THE FIRM'S. It opens from the top bar over whatever
 * a person was doing, so two rows beside each other belong to two different matters and the row is
 * the only thing that knows which. A row with none is a row somebody captured before they knew, and
 * "No matter" is a value that column carries rather than a blank: the reader filters by it, sorts by
 * it and finds it, which is how those rows get finished. Opening the sheet from a matter changes
 * which rows are shown and what a new row starts on; it does not take the column away.
 *
 * A COLUMN THE SERVER CANNOT FILL STILL EXISTS. Its label is real, it is in the columns menu, and
 * its cells say what they wait on rather than showing a value nobody recorded.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { formatDuration } from "@magna-carta/design-system/formatters";
import { statusEntry } from "@magna-carta/design-system/status-register";
import type { TimeLedgerGapName } from "./time-gaps.ts";
import { minutesFromSeconds, type SheetRow } from "./time-sheet-model.ts";

/** Column ids, spelled in full, so a test and a stored layout name the same thing as the code. */
export const TIME_SHEET_COLUMN_IDENTIFIERS = {
  saveState: "saveState",
  timeCode: "timeCode",
  workDate: "workDate",
  matter: "matter",
  dateEntered: "dateEntered",
  description: "description",
  worked: "worked",
  hours: "hours",
  rate: "rate",
  total: "total",
  files: "files",
  timekeeper: "timekeeper",
  enteredBy: "enteredBy",
  status: "status",
  actions: "actions",
} as const;

/** Which sheet columns carry a value the server does not answer, and which gap each one names. */
export const UNSERVED_TIME_SHEET_COLUMNS: Readonly<Record<string, TimeLedgerGapName>> = {
  [TIME_SHEET_COLUMN_IDENTIFIERS.dateEntered]: "dateEntered",
  [TIME_SHEET_COLUMN_IDENTIFIERS.rate]: "rate",
  [TIME_SHEET_COLUMN_IDENTIFIERS.files]: "attachments",
  [TIME_SHEET_COLUMN_IDENTIFIERS.enteredBy]: "dateEntered",
};

export function isUnservedSheetColumn(columnIdentifier: string): boolean {
  return columnIdentifier in UNSERVED_TIME_SHEET_COLUMNS;
}

export function sheetColumnGap(columnIdentifier: string): TimeLedgerGapName | undefined {
  return UNSERVED_TIME_SHEET_COLUMNS[columnIdentifier];
}

/** A duration in hours, for the totals row, in both literacies. */
function hoursTotalText(sumInHours: number): string {
  return formatDuration(sumInHours * 60).text;
}

/**
 * The sheet's columns, in the order the design puts them.
 *
 * `liveSeconds` is handed in rather than read off the row, because a row the timer is running on is
 * longer than the row says it is, and the sorting, the filtering and the totals all have to agree
 * with the clock the reader can see ticking.
 */
export function timeSheetColumns(
  currency: string,
  liveSeconds: (row: SheetRow) => number,
  matterText: (row: SheetRow) => string,
): readonly GridColumn<SheetRow>[] {
  return [
    {
      id: TIME_SHEET_COLUMN_IDENTIFIERS.saveState,
      label: "State",
      type: "text",
      anchored: true,
      filter: "none",
      value: (row) => row.saveState,
      text: () => "",
    },
    {
      id: TIME_SHEET_COLUMN_IDENTIFIERS.workDate,
      label: "Work Date",
      type: "date",
      value: (row) => row.workDate,
    },
    /*
     * The code a row is known by. A row that is not on the firm's record carries the provisional
     * code minted for it here, which is a real value and is shown; a row that IS on the record
     * carries the firm's own entry number, which nothing serves yet, so its cell says so. Two
     * different facts, one column, and neither of them invented.
     */
    {
      id: TIME_SHEET_COLUMN_IDENTIFIERS.timeCode,
      label: "Time Code",
      type: "text",
      filter: "none",
      value: (row) => row.provisionalCode,
      text: (row) => row.provisionalCode ?? "",
    },
    {
      id: TIME_SHEET_COLUMN_IDENTIFIERS.matter,
      label: "Matter",
      type: "text",
      filter: "set",
      value: (row) => matterText(row),
    },
    {
      id: TIME_SHEET_COLUMN_IDENTIFIERS.dateEntered,
      label: "Date Entered",
      type: "date",
      hidden: true,
      filter: "none",
      value: () => null,
      text: () => "",
    },
    {
      id: TIME_SHEET_COLUMN_IDENTIFIERS.description,
      label: "Description",
      type: "text",
      value: (row) => row.description,
    },
    {
      id: TIME_SHEET_COLUMN_IDENTIFIERS.worked,
      label: "Worked",
      type: "number",
      total: "sum",
      filterNote: "In hours, as worked.",
      value: (row) => minutesFromSeconds(liveSeconds(row)) / 60,
      text: (row) => formatDuration(minutesFromSeconds(liveSeconds(row))).text,
      totalText: hoursTotalText,
    },
    {
      id: TIME_SHEET_COLUMN_IDENTIFIERS.hours,
      label: "Hours",
      type: "number",
      total: "sum",
      filterNote: "In hours, as billed.",
      value: (row) => (row.billedMinutes ?? 0) / 60,
      text: (row) => (row.billedMinutes === null ? "" : formatDuration(row.billedMinutes).text),
      totalText: hoursTotalText,
    },
    {
      id: TIME_SHEET_COLUMN_IDENTIFIERS.rate,
      label: "Rate",
      type: "money",
      currency,
      hidden: true,
      filter: "none",
      value: () => null,
      text: () => "",
    },
    {
      id: TIME_SHEET_COLUMN_IDENTIFIERS.total,
      label: "Total",
      type: "money",
      currency,
      total: "sum",
      filterNote: "In the matter's currency.",
      value: (row) => (row.amountMinor === null ? null : row.amountMinor / 100),
    },
    {
      id: TIME_SHEET_COLUMN_IDENTIFIERS.files,
      label: "Files",
      type: "text",
      hidden: true,
      filter: "none",
      value: () => null,
      text: () => "",
    },
    {
      id: TIME_SHEET_COLUMN_IDENTIFIERS.timekeeper,
      label: "Recorded By",
      type: "text",
      filter: "set",
      fitExtra: 30,
      value: (row) => row.timekeeperName,
    },
    {
      id: TIME_SHEET_COLUMN_IDENTIFIERS.enteredBy,
      label: "Entered By",
      type: "text",
      hidden: true,
      filter: "none",
      value: () => null,
      text: () => "",
    },
    {
      id: TIME_SHEET_COLUMN_IDENTIFIERS.status,
      label: "Status",
      type: "text",
      filter: "set",
      fitExtra: 26,
      value: (row) => statusEntry(row.status).label,
    },
    /*
     * The row's own verbs, at rest on every row rather than revealed on hover: a row that grows
     * controls under the pointer is a row that reflows under the pointer, and the reader loses the
     * cell they were aiming at.
     */
    {
      id: TIME_SHEET_COLUMN_IDENTIFIERS.actions,
      label: "Row",
      type: "text",
      filter: "none",
      align: "end",
      fitExtra: 96,
      value: () => null,
      text: () => "",
    },
  ];
}
