/*
 * What a run's files and passes come to, in the words the workspace shows.
 *
 * A pass's report holds fixed codes and no value from the file, so every word a reader sees for a
 * rejected row, a left-out value or a failed pass is decided here. A code this file does not know
 * is shown as it arrived: a new reason on the server is then visible, never silently blank.
 *
 * Pure, and imports nothing from the app, so it is tested without a browser.
 */
import type {
  RecordTransferPass,
  RecordTransferPassFailure,
  RecordTransferRun,
  RecordTransferSourceFile,
} from "@magna-carta/api-client";
import {
  FILE_KIND_CHOICES,
  recordKindOfFileKind,
  type TransferRecordKind,
} from "./column-mapping.ts";

export type TransferPass = RecordTransferPass;
export type TransferSourceFile = RecordTransferSourceFile;
type PassCounts = NonNullable<RecordTransferPass["counts"]>;

const counted = new Intl.NumberFormat("en-US");

export function formatCount(value: number): string {
  return counted.format(value);
}

/** A pass that has not ended and may still: the two states worth asking about again. */
export function passIsInFlight(pass: TransferPass): boolean {
  return pass.state === "requested" || pass.state === "running";
}

function newestFirst(left: TransferPass, right: TransferPass): number {
  return right.requestedAt.localeCompare(left.requestedAt);
}

/** The pass most recently asked for over a file, however it stands. */
export function latestPassOf(passes: readonly TransferPass[], fileId: string): TransferPass | null {
  return passes.filter((pass) => pass.fileId === fileId).toSorted(newestFirst)[0] ?? null;
}

/** The newest pass over a file that finished, which is the one its counts and report come from. */
export function latestFinishedPassOf(
  passes: readonly TransferPass[],
  fileId: string,
): TransferPass | null {
  return (
    passes
      .filter((pass) => pass.fileId === fileId && pass.state === "finished" && pass.counts !== null)
      .toSorted(newestFirst)[0] ?? null
  );
}

/** A run's files that are still held, in the order they were given. */
export function heldFiles(files: readonly TransferSourceFile[]): readonly TransferSourceFile[] {
  return files
    .filter((file) => file.removedAt === null)
    .toSorted((left, right) => left.registeredAt.localeCompare(right.registeredAt));
}

/**
 * What kind of record a file's rows become. A pass says so for certain. Before any pass, the answer
 * given at upload is used: this session's memory of it first, then the slug the file was registered
 * under.
 */
export function recordKindOfFile(
  file: TransferSourceFile,
  passes: readonly TransferPass[],
  declared: Readonly<Record<string, TransferRecordKind>>,
): TransferRecordKind | null {
  return (
    latestPassOf(passes, file.id)?.recordKind ??
    declared[file.id] ??
    recordKindOfFileKind(file.sourceKind)
  );
}

export function recordKindLabel(recordKind: TransferRecordKind | null): string {
  return FILE_KIND_CHOICES.find((choice) => choice.recordKind === recordKind)?.label ?? "";
}

/** Rows that arrived: the ones a pass created and the ones an earlier pass already had. */
export function arrivedCount(counts: PassCounts): number {
  return counts.created + counts.alreadyLinked;
}

/** How many entries the Report tab lists. */
export function reportCount(counts: PassCounts): number {
  return counts.rejected + counts.waiting + counts.findings;
}

/** The state of work a pass is in, in the product's four words for background work. */
export function passStateLabel(state: TransferPass["state"]): string {
  switch (state) {
    case "requested":
      return "Waiting";
    case "running":
      return "In Progress";
    case "stalled":
      return "Stalled";
    case "failed":
      return "Failed";
    case "finished":
      return "Done";
  }
}

/**
 * One sentence over the latest finished pass of every file: how many rows arrived, and how many
 * were rejected or are waiting on another record.
 */
export function runSummary(
  files: readonly TransferSourceFile[],
  passes: readonly TransferPass[],
): string {
  let rows = 0;
  let arrived = 0;
  let undecided = 0;
  let finished = 0;
  for (const file of heldFiles(files)) {
    const counts = latestFinishedPassOf(passes, file.id)?.counts;
    if (counts === null || counts === undefined) continue;
    finished += 1;
    rows += counts.rowsRead;
    arrived += arrivedCount(counts);
    undecided += counts.rejected + counts.waiting;
  }
  if (heldFiles(files).length === 0) return "No files yet.";
  if (finished === 0) return "No file has been run yet.";
  const first = `${formatCount(arrived)} of ${formatCount(rows)} ${rows === 1 ? "row has" : "rows have"} arrived.`;
  if (undecided === 0) return first;
  return `${first} ${formatCount(undecided)} ${undecided === 1 ? "needs" : "need"} a decision before this run can be accepted.`;
}

/** How a Before Cutover line stands. `open` carries how many rows are left. */
export type CutoverStanding =
  | { readonly kind: "done" }
  | { readonly kind: "open"; readonly left: number }
  | { readonly kind: "notRun" }
  | { readonly kind: "notDone" };

export interface CutoverCheck {
  readonly id: string;
  readonly label: string;
  readonly standing: CutoverStanding;
}

function standingOver(
  files: readonly TransferSourceFile[],
  passes: readonly TransferPass[],
  declared: Readonly<Record<string, TransferRecordKind>>,
  kinds: readonly TransferRecordKind[],
): CutoverStanding {
  const relevant = heldFiles(files).filter((file) => {
    const kind = recordKindOfFile(file, passes, declared);
    return kind !== null && kinds.includes(kind);
  });
  if (relevant.length === 0) return { kind: "notRun" };
  let left = 0;
  for (const file of relevant) {
    const counts = latestFinishedPassOf(passes, file.id)?.counts;
    // A file of this kind that has never finished a pass means the check has not been run.
    if (counts === null || counts === undefined) return { kind: "notRun" };
    left += counts.rejected + counts.waiting;
  }
  return left === 0 ? { kind: "done" } : { kind: "open", left };
}

/**
 * The lines under Before Cutover. The first two are counted from the passes. Comparing trust
 * balances and checking samples by eye have nothing to be counted from yet, so they stand as not
 * run and not done.
 */
export function cutoverChecks(
  files: readonly TransferSourceFile[],
  passes: readonly TransferPass[],
  declared: Readonly<Record<string, TransferRecordKind>>,
): readonly CutoverCheck[] {
  return [
    {
      id: "cards",
      label: "Every card arrived or was decided",
      standing: standingOver(files, passes, declared, ["person", "organization"]),
    },
    {
      id: "matters",
      label: "Every matter arrived",
      standing: standingOver(files, passes, declared, ["matter"]),
    },
    { id: "trust", label: "Trust balances match", standing: { kind: "notRun" } },
    { id: "samples", label: "10 samples checked by eye", standing: { kind: "notDone" } },
  ];
}

export function cutoverStandingLabel(standing: CutoverStanding): string {
  switch (standing.kind) {
    case "done":
      return "Done";
    case "open":
      return `${formatCount(standing.left)} left`;
    case "notRun":
      return "Not run";
    case "notDone":
      return "Not done";
  }
}

const REJECTION_LABELS: Readonly<Record<string, string>> = {
  noName: "The row has no name.",
  noSourceKey: "The key column is empty on this row.",
  repeatedSourceKey: "An earlier row has the same key.",
  tooFewValues: "The row has fewer values than the file has columns.",
  tooManyValues: "The row has more values than the file has columns.",
  noTitle: "The row has no title.",
  noMatterNumber: "The row has no matter number.",
  noOpenedDate: "The row has no opening date.",
  openedDateUnreadable: "The opening date can't be read in the stated order.",
  closedDateUnreadable: "The closing date can't be read in the stated order.",
  closedBeforeOpened: "The closing date is before the opening date.",
  responsibleMemberUnmapped: "The staff code isn't matched and there is nobody for everyone else.",
  matterNumberTaken: "Another matter already has this matter number.",
  matterNumberNotUsable: "The matter number can't be used here.",
};

const FINDING_LABELS: Readonly<Record<string, string>> = {
  emailNotAnAddress: "Not an email address. The record arrived without it.",
  phoneHasNoDigits: "No digits in the phone number. The record arrived without it.",
  dateUnreadable: "The date can't be read in the stated order. The record arrived without it.",
  matterTypeUnmapped: "The type code isn't matched. The matter arrived with no type.",
  responsibleMemberUnmapped:
    "The staff code isn't matched. The matter went to the member for everyone else.",
};

export function rejectionLabel(reason: string): string {
  return REJECTION_LABELS[reason] ?? reason;
}

export function findingLabel(finding: string): string {
  return FINDING_LABELS[finding] ?? finding;
}

const FILE_FAULT_LABELS: Readonly<Record<string, string>> = {
  noHeader: "The file has no header row.",
  blankColumnName: "A column in the header row has no name.",
  duplicateColumnName: "Two columns in the header row have the same name.",
  unterminatedQuote: "A quoted value is never closed.",
};

/** Why a pass ended without a report, as one or two short sentences. */
export function passFailureLabel(failure: NonNullable<RecordTransferPassFailure>): string {
  switch (failure.reason) {
    case "sourceFileNotHeld":
      return "This file is no longer held. Upload it again.";
    case "rulesNotReadable":
      return "The column settings for this pass couldn't be read. Run it again.";
    case "fault":
      return "Something went wrong and it was reported. Run it again.";
    case "fileNotReadable": {
      const fault =
        failure.fileFault === null
          ? "The file can't be read as rows."
          : (FILE_FAULT_LABELS[failure.fileFault] ?? "The file can't be read as rows.");
      return failure.lineNumber === null
        ? fault
        : `${fault} Line ${formatCount(failure.lineNumber)}.`;
    }
  }
}

/** A run's ending, as the list's Status column says it. */
export function runStatusLabel(run: RecordTransferRun): string {
  if (run.completedAt !== null) return "Accepted";
  if (run.abandonedAt !== null) return "Abandoned";
  return "Open";
}

/** Whether a run still takes files and passes. */
export function runIsOpen(run: RecordTransferRun): boolean {
  return run.completedAt === null && run.abandonedAt === null;
}

/** A source system's name as a person writes it. The slug is what is stored. */
export function sourceSystemLabel(sourceSystem: string): string {
  if (sourceSystem === "leap") return "LEAP";
  return sourceSystem;
}
