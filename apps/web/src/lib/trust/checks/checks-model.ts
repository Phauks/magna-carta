/*
 * The Checks screen and the stock editor, as pure functions: what a number previews as, what a
 * status is called, what answering "spoiled" will do, and the inch arithmetic the editor's fields
 * speak. Kept apart from the components so each rule has one test.
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

// ---- the register's three lists ------------------------------------------------------------------

export type ChecksView = "to-print" | "printed" | "voided";

/** Printed holds every live number: the ones confirmed and the ones nobody has answered for yet. */
export function printedRows(register: readonly TrustCheckRegisterRow[]): TrustCheckRegisterRow[] {
  return register.filter((row) => row.status === "printed" || row.status === "numbered");
}

/** Voided holds every number taken out of use: spoiled in the printer, or voided afterwards. */
export function voidedRows(register: readonly TrustCheckRegisterRow[]): TrustCheckRegisterRow[] {
  return register.filter((row) => row.status === "spoiled" || row.status === "voided");
}

/** The checks printed and not yet answered for, oldest number first. */
export function waitingRows(register: readonly TrustCheckRegisterRow[]): TrustCheckRegisterRow[] {
  return register
    .filter((row) => row.status === "numbered")
    .toSorted((left, right) => left.checkNumber - right.checkNumber);
}

export function checkStatusLabel(status: TrustCheckRegisterRow["status"]): string {
  switch (status) {
    case "numbered":
      return "Not Answered";
    case "printed":
      return "Printed";
    case "spoiled":
      return "Spoiled";
    case "voided":
      return "Voided";
  }
}

export function checkStatusTone(
  status: TrustCheckRegisterRow["status"],
): "neutral" | "success" | "warning" | "danger" {
  switch (status) {
    case "numbered":
      return "warning";
    case "printed":
      return "success";
    case "spoiled":
    case "voided":
      return "neutral";
  }
}

/**
 * The number each chosen payment will print on, in the order they will be numbered: the order the
 * screen shows them, from the account's next number.
 */
export function previewNumbers(
  chosenInOrder: readonly string[],
  nextCheckNumber: number,
): ReadonlyMap<string, number> {
  return new Map(chosenInOrder.map((identifier, index) => [identifier, nextCheckNumber + index]));
}

/** "the payment to Desert Title Company" as the queue's row names it, for an accessible name. */
export function matterLabel(row: Pick<TrustCheckToPrint, "matterNumber" | "matterTitle">): string {
  return [row.matterTitle, row.matterNumber]
    .filter((part): part is string => part !== null && part !== "")
    .join(" ");
}

// ---- answering a print ----------------------------------------------------------------------------

export type PrintOutcome = "printed" | "spoiled";

export interface AnsweredCheck {
  readonly trustCheckId: string;
  readonly checkNumber: number;
  readonly payee: string;
}

/** A check in the answer panel, with its amount already worded in the account's currency. */
export interface CheckToAnswer extends AnsweredCheck {
  readonly amountText: string;
}

/** Names joined as a sentence reads them: "A", "A and B", "A, B and C". */
export function joinedNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * What confirming the answers will do, in one sentence composed from the answers themselves, so the
 * line can never describe one thing and send another.
 */
export function answerConsequence(
  checks: readonly AnsweredCheck[],
  outcomes: Readonly<Record<string, PrintOutcome>>,
): string {
  const spoiled = checks.filter((check) => outcomes[check.trustCheckId] === "spoiled");
  if (spoiled.length === 0) {
    return checks.length === 1
      ? `${checks[0]?.checkNumber ?? ""} will be recorded as printed.`
      : `All ${checks.length} will be recorded as printed.`;
  }
  const numbers = joinedNames(spoiled.map((check) => String(check.checkNumber)));
  const payees = joinedNames([...new Set(spoiled.map((check) => check.payee))]);
  const verb = spoiled.length === 1 ? "goes" : "go";
  return `${numbers} will be voided, and ${payees} ${verb} back to To Print.`;
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
