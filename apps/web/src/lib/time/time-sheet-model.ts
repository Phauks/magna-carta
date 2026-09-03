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
 * A ROW WITHOUT A MATTER IS A LEGAL ROW. A person captures time before they know where it belongs,
 * so the sheet is firm-wide and the matter is a column like any other: a row may sit there holding a
 * description and a duration with the matter still blank. What such a row cannot do is reach the
 * firm's record, because capture takes a matter, so it holds a PROVISIONAL code minted here on the
 * sheet and says so. Setting the matter is what lets it be written.
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
import { personName } from "@magna-carta/design-system/formatters";
import { timekeeperOf } from "./time-columns.ts";
import { gapReason } from "./time-gaps.ts";

/** Where a row stands against the firm's record. */
export type SheetSaveState = "unsaved" | "saving" | "saved" | "failed";

/**
 * A matter as the sheet needs it: enough to name one and enough to find one by typing.
 *
 * The number is nullable because an unnumbered consultation is a matter a person may well be
 * recording time against, and numbering it later does not make the time before that unreal.
 */
export interface SheetMatter {
  readonly id: string;
  readonly matterNumber: string | null;
  readonly title: string;
}

/** How a matter reads in a cell and in the picker: the number and the name, together. */
export function matterDisplay(matter: SheetMatter): string {
  return matter.matterNumber === null ? matter.title : `${matter.matterNumber} · ${matter.title}`;
}

/** What the Matter column says for a row with none. It is a value, so the set filter can hold it. */
export const NO_MATTER_TEXT = "No matter";

/** Whether what somebody typed reaches this matter, by number or by name. Either finds it. */
export function matterMatches(matter: SheetMatter, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return true;
  return (
    (matter.matterNumber ?? "").toLowerCase().includes(wanted) ||
    matter.title.toLowerCase().includes(wanted)
  );
}

/**
 * The provisional code a matterless row is held under.
 *
 * It is minted on the sheet, at the instant the row exists, so a row a person is typing into has a
 * name to be referred to by before it has anywhere to live. It is deliberately NOT an entry number:
 * the firm's numbers are the server's to mint and it does not mint one yet, so this code says out
 * loud that it is provisional rather than dressing itself as a record the firm holds.
 */
export function provisionalTimeCode(sequence: number): string {
  return `TMP-${String(sequence).padStart(4, "0")}`;
}

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
  /** Where the time belongs, or null for a row captured before that was known. */
  matterId: string | null;
  /**
   * The code a row is held under while it is not on the firm's record, or null once it is.
   *
   * It survives the write rather than being cleared, so the Time Code cell can still say which
   * provisional code this entry was held under while it was only on the sheet.
   */
  provisionalCode: string | null;
  /** The firm's own reference, once the row is on the record and the sequence has minted one. */
  entryNumber: string | null;
  workDate: string;
  description: string;
  /** The firm's internal note on this entry. Never on a bill, an export or a printed sheet. */
  memo: string;
  /** Seconds as worked. The sheet types in seconds so a running timer has somewhere to land. */
  workedSeconds: number;
  /** Minutes as the server rounded them, or null where nothing has been written yet. */
  billedMinutes: number | null;
  timekeeperUserId: string;
  timekeeperName: string;
  /**
   * Who typed the row, and when.
   *
   * Both are facts of every entry rather than of the delegated ones only: a person recording their
   * own work carries the same name twice, and delegation is the case where the two names differ.
   * A row not yet on the record answers with the day it was made and the person making it, because
   * that is exactly what the server will record when it lands.
   */
  enteredByName: string;
  enteredAt: string;
  billable: boolean;
  amountMinor: number | null;
  /** The rate frozen at capture, at scale 4. Null on non-billable time and on an unwritten row. */
  rateE4: number | null;
  /** The entry's UTBMS task code — its category — and its activity code, as identifiers. */
  utbmsTaskCodeId: string | null;
  utbmsActivityCodeId: string | null;
  /** How many of the matter's documents this row points at. */
  attachmentCount: number;
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
    matterId: entry.matterId,
    provisionalCode: null,
    entryNumber: entry.entryNumber ?? null,
    workDate: entry.workDate,
    description: entry.narrative,
    memo: entry.memo ?? "",
    workedSeconds: entry.rawDurationMinutes * 60,
    billedMinutes: entry.durationMinutes,
    timekeeperUserId: entry.timekeeperUserId,
    timekeeperName: timekeeperOf(entry),
    // The enterer's name as the record kept it. A record whose member row is gone still names the
    // person; falling back to the timekeeper would quietly assert an entry nobody delegated.
    enteredByName: personName(entry.createdByName),
    enteredAt: (entry.createdAt ?? "").slice(0, 10),
    billable: entry.billable,
    amountMinor: entry.amountMinor,
    rateE4: entry.rateE4 ?? null,
    utbmsTaskCodeId: entry.utbmsTaskCodeId ?? null,
    utbmsActivityCodeId: entry.utbmsActivityCodeId ?? null,
    attachmentCount: entry.attachmentCount ?? 0,
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
  /** The matter the row starts on: the one the sheet was opened from, or null when it was not. */
  readonly matterId: string | null;
  readonly provisionalCode: string;
  readonly timekeeperUserId: string;
  readonly timekeeperName: string;
  /** The day the row is being made, so the entered date reads true before the server answers. */
  readonly enteredAt: string;
  readonly currency: string;
}): SheetRow {
  return {
    key: input.key,
    entryIdentifier: null,
    matterId: input.matterId,
    provisionalCode: input.provisionalCode,
    entryNumber: null,
    workDate: input.workDate,
    description: "",
    memo: "",
    workedSeconds: 0,
    billedMinutes: null,
    timekeeperUserId: input.timekeeperUserId,
    timekeeperName: input.timekeeperName,
    // A row is entered by whoever is making it, which on this surface is always the person at the
    // keyboard: the sheet cannot record one member's work under another's hand yet.
    enteredByName: input.timekeeperName,
    enteredAt: input.enteredAt,
    billable: true,
    amountMinor: null,
    rateE4: null,
    utbmsTaskCodeId: null,
    utbmsActivityCodeId: null,
    attachmentCount: 0,
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
 * The matter leads the list because it is the one of the three that decides where the row can go at
 * all: a row short of a description or a duration is an entry nobody has finished, and a row short
 * of a matter is time nobody has filed.
 */
export function missingFacts(row: SheetRow): readonly string[] {
  const missing: string[] = [];
  if (row.matterId === null) missing.push("a matter");
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

/**
 * Whether the search a person typed reaches this row.
 *
 * `matterText` is how the row's matter reads, handed in rather than held on the row, because the
 * firm's matters are read separately from its time and the name a row shows must always be the
 * current one. A row on a firm-wide sheet is found by its matter as readily as by its words.
 */
export function searchMatches(row: SheetRow, query: string, matterText = ""): boolean {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return true;
  return (
    row.description.toLowerCase().includes(wanted) ||
    // The memo is the firm's own note on its own surface, so it is findable here. It is still
    // absent by construction from everything client-facing.
    row.memo.toLowerCase().includes(wanted) ||
    row.timekeeperName.toLowerCase().includes(wanted) ||
    row.enteredByName.toLowerCase().includes(wanted) ||
    matterText.toLowerCase().includes(wanted) ||
    (row.entryNumber ?? "").toLowerCase().includes(wanted) ||
    (row.provisionalCode ?? "").toLowerCase().includes(wanted)
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
    // Both halves are said, because they are two different facts and only one of them is the
    // reader's to fix. What the ROW still needs comes first, under the provisional code it is held
    // by meanwhile; then the product's own limit, so a mark that says only "not written" cannot
    // read as a save that failed.
    const missing = missingFacts(row);
    const held =
      row.provisionalCode === null ? "" : ` It is held here as ${row.provisionalCode} meanwhile.`;
    const needs =
      missing.length === 0
        ? "Not written to the firm's record yet."
        : `Not written to the firm's record yet: it needs ${missing.join(", ")}. It writes itself as soon as it has them.${held}`;
    return `${needs} Writing a row before that waits on ${gapReason("incompleteCapture")}.`;
  }
  const missing = missingFacts(row);
  if (missing.length > 0) {
    return `Saved, and incomplete: it needs ${missing.join(", ")}. It stays on the sheet until it is completed.`;
  }
  return "Saved.";
}
