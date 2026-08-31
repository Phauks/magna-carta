/*
 * What a row of the Time Sheet IS, and every fact the sheet states about one.
 *
 * The Time Sheet is the rapid-entry surface: a grid a person types straight into, where a row is a
 * REAL entry from the instant it exists rather than a form that becomes one when it is submitted.
 * That single decision is what most of this file is about. A row saves with nothing in it, and
 * whether it is COMPLETE is a separate, stated fact rather than a condition of its existence: the
 * alternative is a person typing for a minute, navigating away, and losing the lot.
 *
 * SO INCOMPLETENESS IS SAID OUT LOUD, IN BOTH DIRECTIONS. Each row carries a mark saying whether it
 * is saved, saving, or saved-and-incomplete, and the sheet counts the incomplete ones where the
 * reader cannot miss them. An incomplete row from an earlier day also refuses to fall out of view
 * when the scope moves off its date, because a row nobody can see is a row nobody will finish.
 *
 * TWO PEOPLE, ALWAYS. The timekeeper is whose work an entry records; the enterer is who typed it.
 * Both are facts of every entry rather than of the delegated ones only, and an entry a person
 * records for themselves simply carries the same name twice. Delegation is the case where the two
 * differ, and that is what makes the enterer worth a column of its own.
 *
 * Everything here is pure and holds no state. The store beside it owns the rows; this file owns
 * what the rows mean.
 */
import type { TimeEntrySummary } from "$lib/matters/time-api.ts";
import { timekeeperOf } from "./time-columns.ts";
import { gapReason } from "./time-gaps.ts";

/** Where a row stands against the firm's record. */
export type SheetSaveState = "unsaved" | "saving" | "saved" | "failed";

/**
 * One row of the sheet.
 *
 * `entryIdentifier` is null for the moment between the row being created and the server answering
 * with an identity. It is a real row throughout that moment: the write is already in flight, and
 * showing it as something less than a row would be untrue for exactly as long as the reader is most
 * likely to be typing into it.
 */
export interface SheetRow {
  /** Stable for the row's whole life on this screen, whatever the server later calls it. */
  readonly key: string;
  entryIdentifier: string | null;
  workDate: string;
  description: string;
  /** Seconds as worked. The sheet types in seconds so a running timer has somewhere to land. */
  workedSeconds: number;
  /** Minutes as the server rounded them, or null where nothing has been written yet. */
  billedMinutes: number | null;
  timekeeperUserId: string;
  timekeeperName: string;
  billable: boolean;
  amountMinor: number | null;
  currency: string;
  status: TimeEntrySummary["status"];
  saveState: SheetSaveState;
  /** Why the last write did not land, when it did not. */
  saveFailure: string | null;
  /** Whether a timer is accruing into this row right now. */
  timerRunning: boolean;
}

/** Seconds held as minutes, the unit every write is in. */
export function minutesFromSeconds(seconds: number): number {
  return Math.round(seconds / 60);
}

/** A row built from the entry the listing answered with. */
export function sheetRowFromEntry(entry: TimeEntrySummary): SheetRow {
  return {
    key: entry.id,
    entryIdentifier: entry.id,
    workDate: entry.workDate,
    description: entry.narrative,
    workedSeconds: entry.rawDurationMinutes * 60,
    billedMinutes: entry.durationMinutes,
    timekeeperUserId: entry.timekeeperUserId,
    timekeeperName: timekeeperOf(entry),
    billable: entry.billable,
    amountMinor: entry.amountMinor,
    currency: entry.currency,
    status: entry.status,
    saveState: "saved",
    saveFailure: null,
    timerRunning: false,
  };
}

/** A row that exists on the screen and is on its way to existing on the server. */
export function newSheetRow(input: {
  readonly key: string;
  readonly workDate: string;
  readonly timekeeperUserId: string;
  readonly timekeeperName: string;
  readonly currency: string;
}): SheetRow {
  return {
    key: input.key,
    entryIdentifier: null,
    workDate: input.workDate,
    description: "",
    workedSeconds: 0,
    billedMinutes: null,
    timekeeperUserId: input.timekeeperUserId,
    timekeeperName: input.timekeeperName,
    billable: true,
    amountMinor: null,
    currency: input.currency,
    status: "draft",
    saveState: "unsaved",
    saveFailure: null,
    timerRunning: false,
  };
}

/**
 * What a row still needs before anything downstream can bill it, in the reader's own words.
 *
 * The matter is not on this list: the sheet lives inside a matter, so every row it creates already
 * has one. A firm-wide sheet would add it here and nothing else about this would change.
 */
export function missingFacts(row: SheetRow): readonly string[] {
  const missing: string[] = [];
  if (row.description.trim() === "") missing.push("a description");
  if (row.workedSeconds <= 0) missing.push("a duration");
  return missing;
}

export function isIncomplete(row: SheetRow): boolean {
  return missingFacts(row).length > 0;
}

/** How many rows are saved but still short of something. The count the sheet cannot hide. */
export function incompleteCount(rows: readonly SheetRow[]): number {
  return rows.filter(isIncomplete).length;
}

/** Whether a row may still be typed into: a draft is workable, everything later is evidence. */
export function isWorkable(row: SheetRow): boolean {
  return row.status === "draft";
}

/** Both durations a row holds, as seconds and as the minutes the server rounded to. */
export function workedMinutesOf(row: SheetRow): number {
  return minutesFromSeconds(row.workedSeconds);
}

/** A duration as a clock, ticking to the second while a timer is on it. */
export function clockText(seconds: number, toTheSecond: boolean): string {
  const wholeHours = Math.floor(seconds / 3600);
  const wholeMinutes = Math.floor((seconds % 3600) / 60);
  const wholeSeconds = seconds % 60;
  const minutePart = String(wholeMinutes).padStart(2, "0");
  if (!toTheSecond) return `${String(wholeHours)}:${minutePart}`;
  return `${String(wholeHours)}:${minutePart}:${String(wholeSeconds).padStart(2, "0")}`;
}

/** Hours to one decimal, the figure the arithmetic multiplies and the bill carries. */
export function decimalHoursText(minutes: number): string {
  return (Math.round((minutes / 60) * 10) / 10).toFixed(1);
}

/**
 * Reading a duration somebody typed into a cell, as seconds.
 *
 * Both literacies are accepted because both are shown: "1:30" and "1.5" are the same ninety
 * minutes, and "90m" is too. It answers seconds rather than minutes so the timer and the keyboard
 * write into the same quantity.
 */
export function parseDurationSeconds(text: string): number | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "") return null;
  const minutesOnly = /^(\d+)\s*m$/.exec(trimmed);
  if (minutesOnly !== null) return Number(minutesOnly[1]) * 60;
  const parts = trimmed.split(":");
  if (parts.length === 3 || parts.length === 2) {
    const numbers = parts.map((part) => Number(part));
    if (numbers.some((value) => !Number.isFinite(value))) return null;
    const hours = numbers[0] ?? 0;
    const minutes = numbers[1] ?? 0;
    const seconds = numbers[2] ?? 0;
    return hours * 3600 + minutes * 60 + seconds;
  }
  const decimal = Number(trimmed.replace(",", ".").replace(/h$/, ""));
  return Number.isFinite(decimal) ? Math.round(decimal * 3600) : null;
}

/** Whether the search a person typed reaches this row. */
export function searchMatches(row: SheetRow, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return true;
  return (
    row.description.toLowerCase().includes(wanted) ||
    row.timekeeperName.toLowerCase().includes(wanted)
  );
}

/** The figures the sheet states about itself at the bottom, over the rows in the scope. */
export interface SheetHonesty {
  readonly workedSeconds: number;
  readonly billedMinutes: number;
  readonly amountMinor: number;
  readonly incompleteRows: number;
}

/**
 * The honesty strip's figures.
 *
 * A void counts toward nothing, on the same rule the ledger's footer follows: it stays on the
 * record, numbered, with its chip, and contributes to no total anywhere in the product.
 *
 * `workedSecondsOf` is how the caller reads a row's worked time, and it exists because a running
 * timer makes that two different numbers: the seconds the row has banked, and those plus the run
 * accruing into it. The Worked column shows the second one, so the strip that sums the column has
 * to read the same quantity — a footer that disagrees with the column above it while a timer ticks
 * is the footer being wrong. The default is the banked figure, for a caller with no timer.
 */
export function sheetHonesty(
  rows: readonly SheetRow[],
  workedSecondsOf: (row: SheetRow) => number = (row) => row.workedSeconds,
): SheetHonesty {
  const live = rows.filter((row) => row.status !== "void");
  return {
    workedSeconds: live.reduce((total, row) => total + workedSecondsOf(row), 0),
    billedMinutes: live.reduce((total, row) => total + (row.billedMinutes ?? 0), 0),
    amountMinor: live.reduce((total, row) => total + (row.amountMinor ?? 0), 0),
    incompleteRows: incompleteCount(live),
  };
}

/** What a row's save mark says on its hover. */
export function saveStateTitle(row: SheetRow): string {
  if (row.saveState === "saving") return "Saving.";
  if (row.saveState === "failed") {
    return row.saveFailure ?? "The last change was not saved. The record is unchanged.";
  }
  if (row.saveState === "unsaved") {
    // The dependency is named rather than left to be guessed: a row sits here because the capture
    // route will not take an entry that is short of a description or a duration, and a mark that
    // says only "not written" reads as a save that failed.
    return `Not written to the firm's record yet. Waiting on ${gapReason("incompleteCapture")}.`;
  }
  const missing = missingFacts(row);
  if (missing.length > 0) {
    return `Saved, and incomplete: it needs ${missing.join(", ")}. It stays on the sheet until it is completed.`;
  }
  return "Saved.";
}
