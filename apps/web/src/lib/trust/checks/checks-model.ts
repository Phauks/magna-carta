/*
 * The Checks screen and the stock editor, as pure functions: what a number previews as, what a
 * status is called, and the inch arithmetic the editor's fields speak. Kept apart from the
 * components so each rule has one test.
 */
import {
  CHECK_FIELD_KINDS,
  CHECK_FIELD_LABELS,
  CHECK_WIDTH_MILS,
  MICR_BAND_TOP_MILS,
  MAX_SHIFT_MILS,
  STANDARD_CHECK_FIELDS,
  fieldHeightMils,
  type CheckField,
  type CheckFieldKind,
} from "@magna-carta/trust/check-layout";
import type { TrustCheckRegisterRow, TrustCheckToPrint } from "./checks-api.ts";
import type { PrintableCheck } from "./check-document.ts";

// ---- the register's three lists ------------------------------------------------------------------

export type ChecksView = "to-print" | "printed" | "voided";

/**
 * Printed holds every live number. A check is recorded as printed the moment it is printed; a
 * "numbered" row is one printed before that was so, and reads exactly like a printed one.
 */
export function printedRows(register: readonly TrustCheckRegisterRow[]): TrustCheckRegisterRow[] {
  return register.filter((row) => row.status === "printed" || row.status === "numbered");
}

/** Voided holds every number taken out of use. A "spoiled" row is an older misprint, voided too. */
export function voidedRows(register: readonly TrustCheckRegisterRow[]): TrustCheckRegisterRow[] {
  return register.filter((row) => row.status === "spoiled" || row.status === "voided");
}

export function checkStatusLabel(status: TrustCheckRegisterRow["status"]): string {
  switch (status) {
    case "numbered":
    case "printed":
      return "Printed";
    case "spoiled":
    case "voided":
      return "Voided";
  }
}

export function checkStatusTone(
  status: TrustCheckRegisterRow["status"],
): "neutral" | "success" | "warning" | "danger" {
  switch (status) {
    case "numbered":
    case "printed":
      return "success";
    case "spoiled":
    case "voided":
      return "neutral";
  }
}

/**
 * What the Voided list says a number was taken out of use for. A misprint recorded before the
 * reason read "Misprinted" carried the older wording, and reads the same as one recorded since.
 */
export function settledReasonText(
  row: Pick<TrustCheckRegisterRow, "status" | "settledReason">,
): string | null {
  if (row.status === "spoiled") {
    return row.settledReason === null || /spoil/i.test(row.settledReason)
      ? "Misprinted"
      : row.settledReason;
  }
  return row.settledReason;
}

/**
 * The number each chosen payment will print on, in the order they will be numbered: the order the
 * screen shows them, from the first check number on the screen.
 */
export function previewNumbers(
  chosenInOrder: readonly string[],
  firstCheckNumber: number,
): ReadonlyMap<string, number> {
  return new Map(chosenInOrder.map((identifier, index) => [identifier, firstCheckNumber + index]));
}

/**
 * What each chosen payment prints, numbered the way the print route numbers them: the first check
 * number, then one more for each payment in the order given. Built from the waiting payments the
 * screen has already read, so the PDF opens before anything is recorded.
 */
export function printableChecks(
  toPrint: readonly TrustCheckToPrint[],
  chosenInOrder: readonly string[],
  firstCheckNumber: number,
): PrintableCheck[] {
  const byIdentifier = new Map(toPrint.map((row) => [row.trustMovementId, row]));
  const payments = chosenInOrder.flatMap((identifier) => {
    const row = byIdentifier.get(identifier);
    return row === undefined ? [] : [row];
  });
  return payments.map((row, index) => ({
    checkNumber: firstCheckNumber + index,
    payee: row.payee,
    amountMinor: row.amountMinor,
    effectiveDate: row.effectiveDate,
    memo: row.memo,
    matterNumber: row.matterNumber,
    matterTitle: row.matterTitle,
  }));
}

/** The print button: "Print 3 Checks", "Print 1 Check", or "Print Checks" with none chosen. */
export function printButtonLabel(count: number): string {
  if (count === 0) return "Print Checks";
  return count === 1 ? "Print 1 Check" : `Print ${count} Checks`;
}

/** The button that records an opened batch: "Mark 3 Printed", or "Mark 1 Printed". */
export function markPrintedLabel(count: number): string {
  return `Mark ${count} Printed`;
}

/** The line under the lists while an opened batch waits to be marked printed. */
export function openedToPrintText(firstCheckNumber: number, count: number): string {
  return count === 1
    ? `Check ${firstCheckNumber} opened to print.`
    : `Checks ${checkRunText(firstCheckNumber, count)} opened to print.`;
}

/** "the payment to Desert Title Company" as the queue's row names it, for an accessible name. */
export function matterLabel(row: Pick<TrustCheckToPrint, "matterNumber" | "matterTitle">): string {
  return [row.matterTitle, row.matterNumber]
    .filter((part): part is string => part !== null && part !== "")
    .join(" ");
}

// ---- the check numbers ----------------------------------------------------------------------------

/**
 * The first number at or after `from` that no check on the account carries: what the next check
 * will print on once the next number is set to `from`. The server answers the same way.
 */
export function nextUnusedNumber(from: number, used: Iterable<number>): number {
  const taken = new Set(used);
  let candidate = from;
  while (taken.has(candidate)) candidate += 1;
  return candidate;
}

/** A typed check number, or null when it is not a whole number from 1. */
export function typedCheckNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

/** "10422" or "10422 to 10424", as a run of check numbers reads. */
export function checkRunText(first: number, count: number): string {
  return count <= 1 ? String(first) : `${first} to ${first + count - 1}`;
}

/** Whether a refusal from the server is the one that says a number in the batch is already used. */
export function numberAlreadyUsed(detail: string | undefined): boolean {
  return detail !== undefined && /already in this account's register/.test(detail);
}

// ---- the editor's inches -------------------------------------------------------------------------

/** What is drawn behind the fields: the account's scan, nothing, or a plain check drawn as rules. */
export type CheckBackdrop = "scan" | "fields" | "sample";

/** Thousandths of an inch as the editor's fields show them: two decimals. */
export function inchesText(mils: number): string {
  return (mils / 1_000).toFixed(2);
}

/** What a reader typed into an inches field, as whole thousandths, or null when it is not a number. */
export function milsFromInches(text: string): number | null {
  const trimmed = text.trim();
  if (!/^-?\d*(?:\.\d*)?$/.test(trimmed) || trimmed === "" || trimmed === "." || trimmed === "-") {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? Math.round(value * 1_000) : null;
}

/** A whole-page shift is refused past this, either way. */
export function shiftProblem(mils: number): boolean {
  return !Number.isInteger(mils) || Math.abs(mils) > MAX_SHIFT_MILS;
}

/** A field's text size as a share of the check's width, for drawing it at any scale. */
export function textScaleOf(sizePoints: number): number {
  return sizePoints / ((CHECK_WIDTH_MILS / 1_000) * 72);
}

/**
 * Where a dragged field may land: on the check and above the MICR band. A drag stops at the band's
 * edge rather than crossing it; a typed value is not clamped, and shows red instead.
 */
export function clampedPosition(
  field: CheckField,
  x: number,
  y: number,
): { readonly xMils: number; readonly yMils: number } {
  const height = fieldHeightMils(field.sizePoints);
  return {
    xMils: Math.min(Math.max(x, 0), CHECK_WIDTH_MILS - field.widthMils),
    yMils: Math.min(Math.max(y, 0), MICR_BAND_TOP_MILS - height),
  };
}

/** A widened field stops at the check's edge. */
export function clampedWidth(field: CheckField, width: number): number {
  return Math.min(Math.max(width, 300), CHECK_WIDTH_MILS - field.xMils);
}

/** Where a field starts when it is added: its standard place, or one that suits it. */
const ADDED_FIELD_PLACES: Readonly<Record<CheckFieldKind, CheckField>> = {
  ...(Object.fromEntries(STANDARD_CHECK_FIELDS.map((field) => [field.kind, field])) as Record<
    "date" | "payee" | "amount" | "amount_words" | "memo",
    CheckField
  >),
  matter: {
    kind: "matter",
    xMils: 700,
    yMils: 2_240,
    widthMils: 3_600,
    sizePoints: 10,
    align: "start",
  },
  check_number: {
    kind: "check_number",
    xMils: 7_000,
    yMils: 300,
    widthMils: 1_200,
    sizePoints: 12,
    align: "end",
  },
};

export function addedField(kind: CheckFieldKind): CheckField {
  return ADDED_FIELD_PLACES[kind];
}

/** The four fields a check is not a check without; they can be moved, never removed. */
export const REQUIRED_FIELD_KINDS: ReadonlySet<CheckFieldKind> = new Set([
  "date",
  "payee",
  "amount",
  "amount_words",
]);

/** The kinds not yet on the layout, in the vocabulary's own order, for Add Field. */
export function kindsToAdd(fields: readonly CheckField[]): CheckFieldKind[] {
  const placed = new Set(fields.map((field) => field.kind));
  return CHECK_FIELD_KINDS.filter((kind) => !placed.has(kind));
}

export function fieldLabel(kind: CheckFieldKind): string {
  return CHECK_FIELD_LABELS[kind];
}
