/*
 * What the two statement panels put on the wire, worked out away from the panels.
 *
 * A STATEMENT IS WHAT THE BANK SAID, AND THE PLATFORM DOES NOT ARGUE WITH IT. The period, the two
 * balances and every line are the institution's account of the account, so nothing here corrects
 * them: the lines are added up and the closing balance they imply is STATED beside the one the
 * reader typed, and where the two differ the panel says so and records the statement anyway. That
 * difference is not a validation failure, it is the first thing a reconciliation exists to find,
 * and refusing the entry would leave the firm unable to record the very statement it has to
 * reconcile.
 *
 * EVERY REFUSAL IS THE CLIENT'S OWN, AND IT NAMES THE LINE. A statement of forty lines refused by
 * the server for one malformed amount sends the reader hunting; each reading here answers either
 * the request to send or the one sentence to show, and a line's refusal carries its number.
 *
 * THE AMOUNT IS READ BY THE ONE PARSER THE MONEY SURFACES SHARE ($lib/billing/amount-entry.ts):
 * digits in, whole cents out, never a float. WHAT IS THEN DONE WITH THOSE CENTS IS
 * @magna-carta/money'S, not this file's: the lines are carried as Money and added through the
 * package's own exact-integer arithmetic, so the totals beside the fields and the ledger the firm
 * answers for cannot come to two different answers about one period.
 *
 * THE IMPORT QUOTES THE PREVIEW BACK. Nothing is stored by a preview; what it hands over is a
 * fingerprint of the file it read, and the import carries that fingerprint so a file edited between
 * the two is refused by the server rather than landing as rows nobody reviewed. So a request
 * cannot be composed here without a preview in hand, and the type says so.
 *
 * IT IS PURE, so the bodies these panels compose can be asserted without a browser. A request shape
 * that only exists inside a component is a request shape nothing can check, and the defect it hides
 * — a period a day out, an amount in the wrong units — is invisible until a firm's books are wrong.
 */
import {
  civilDateParts,
  endOfCivilMonth,
  startOfCivilMonth,
} from "@magna-carta/civil-time/civil-date";
import {
  isResolvableTimeZone,
  viewerTimeZone,
  zonedReading,
} from "@magna-carta/civil-time/time-zone";
// `fromMinor` and `toMinor` rather than `money` and a snapshot: they are the same two functions
// under the names the money package gives its minor-unit boundary, and "money" is what every panel
// on this surface calls the function that turns an amount into words.
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { add, currencyFromCode, subtract, sum, zero, type Money } from "@magna-carta/money/money";
import { readAmountMinor } from "$lib/billing/amount-entry.ts";
import type { ChoiceOption } from "$lib/components/choice-picker.ts";
import type { TrustRequestReading } from "./trust-write-requests.ts";
import type {
  TrustBankStatementEntry,
  TrustBankStatementLineEntry,
  TrustStatementDateFormat,
  TrustStatementImportPreview,
  TrustStatementImportRequest,
} from "./trust-api.ts";

/**
 * The currency a statement is recorded in.
 *
 * The contract takes one today, and the two requests composed below state it; the totals are added
 * up in that same one rather than in a second opinion about which currency the panel is in. It is
 * one constant because how many minor units make a major unit is a property of the CURRENCY, and a
 * second spelling of the code is a second place for that to be answered.
 */
const STATEMENT_CURRENCY_CODE = "USD";
const STATEMENT_CURRENCY = currencyFromCode(STATEMENT_CURRENCY_CODE);

// ---- the period a statement covers -------------------------------------------------------------

/** The two days a statement's period runs between. */
export interface StatementPeriod {
  readonly periodStart: string;
  readonly periodEnd: string;
}

/**
 * The calendar month before the one the account is living in, which is the period a firm records.
 *
 * The day is the ACCOUNT'S, not the reader's: a statement recorded from a branch office an hour
 * before midnight in another zone would otherwise default to a month the bank has not finished.
 */
export function previousCalendarMonth(timeZone: string, now: number = Date.now()): StatementPeriod {
  const zone = isResolvableTimeZone(timeZone) ? timeZone : viewerTimeZone();
  const { year, month } = civilDateParts(zonedReading(now, zone).civilDate);
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  return {
    periodStart: startOfCivilMonth(previousYear, previousMonth),
    periodEnd: endOfCivilMonth(previousYear, previousMonth),
  };
}

// ---- the lines a member enters by hand ---------------------------------------------------------

/** One line of the statement as the panel holds it while it is being typed. */
export interface TrustStatementLineDraft {
  /** This row's identity in the list, minted when the row is added. Never sent. */
  readonly key: string;
  readonly postedOn: string;
  readonly direction: "deposit" | "withdrawal";
  readonly amountText: string;
  readonly description: string;
  readonly reference: string;
  readonly counterpartyName: string;
}

/** The two directions a bank posts in, as the picker offers them. */
export const STATEMENT_DIRECTION_CHOICES: readonly ChoiceOption[] = [
  { value: "deposit", label: "Deposit", meaning: "Money the bank paid into the account." },
  { value: "withdrawal", label: "Withdrawal", meaning: "Money the bank paid out of the account." },
];

/** The date formats a statement file is written in, as the picker offers them. */
export const STATEMENT_DATE_FORMAT_CHOICES: readonly ChoiceOption[] = [
  { value: "iso", label: "Year-Month-Day", aside: "2026-08-31", keywords: ["iso"] },
  { value: "month-day-year", label: "Month/Day/Year", aside: "08/31/2026" },
  { value: "day-month-year", label: "Day/Month/Year", aside: "31/08/2026" },
];

/** Whether a value read off a picker is one of the three formats the contract names. */
export function readsAsStatementDateFormat(value: string): value is TrustStatementDateFormat {
  return value === "iso" || value === "month-day-year" || value === "day-month-year";
}

/**
 * What the typed lines come to, and what closing balance they imply.
 *
 * The totals count only the lines whose amount reads as one, so a running total is on screen while
 * a row is still being typed. The IMPLIED CLOSING is withheld entirely until the opening balance
 * and every line read, because a figure computed from some of the lines is a figure that disagrees
 * with the statement for a reason the reader cannot see.
 */
export interface StatementTotals {
  readonly depositTotalMinor: number;
  readonly withdrawalTotalMinor: number;
  /** Null until the opening balance and every line's amount are amounts. */
  readonly impliedClosingMinor: number | null;
}

export function statementTotals(
  openingBalanceText: string,
  lines: readonly TrustStatementLineDraft[],
): StatementTotals {
  const deposits: Money[] = [];
  const withdrawals: Money[] = [];
  let everyLineReads = true;
  for (const line of lines) {
    const reading = readAmountMinor(line.amountText);
    if (reading.kind !== "amount") {
      everyLineReads = false;
      continue;
    }
    const amount = fromMinor(reading.minor, STATEMENT_CURRENCY);
    if (line.direction === "deposit") deposits.push(amount);
    else withdrawals.push(amount);
  }
  // `sum` cannot infer a currency from an empty list, and a statement with no deposits is an
  // ordinary statement, so the empty case takes the account's own zero rather than a bare 0.
  const depositTotal = deposits.length === 0 ? zero(STATEMENT_CURRENCY) : sum(deposits);
  const withdrawalTotal = withdrawals.length === 0 ? zero(STATEMENT_CURRENCY) : sum(withdrawals);
  const opening = readAmountMinor(openingBalanceText);
  const impliedClosing =
    everyLineReads && opening.kind === "amount"
      ? subtract(add(fromMinor(opening.minor, STATEMENT_CURRENCY), depositTotal), withdrawalTotal)
      : null;
  return {
    depositTotalMinor: toMinor(depositTotal),
    withdrawalTotalMinor: toMinor(withdrawalTotal),
    impliedClosingMinor: impliedClosing === null ? null : toMinor(impliedClosing),
  };
}

/**
 * What the panel says where the lines and the typed closing balance disagree.
 *
 * A warning, never a refusal: the server takes either figure, and the difference is exactly what
 * the reconciliation this statement will be read against is for.
 */
export function closingDifferenceSentence(
  totals: StatementTotals,
  closingBalanceText: string,
  money: (amountMinor: number) => string,
): string | null {
  const implied = totals.impliedClosingMinor;
  if (implied === null) return null;
  const closing = readAmountMinor(closingBalanceText);
  if (closing.kind !== "amount" || closing.minor === implied) return null;
  return (
    `The lines add up to ${money(implied)} and the closing balance entered is ` +
    `${money(closing.minor)}. Both are recorded as they stand: the difference is what a ` +
    "reconciliation of this period finds."
  );
}

// ---- recording a statement by hand -------------------------------------------------------------

/** What the record panel holds while it is being filled in. */
export interface TrustStatementEntryDraft {
  readonly trustAccountId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly openingBalanceText: string;
  readonly closingBalanceText: string;
  readonly statementReference: string;
  readonly lines: readonly TrustStatementLineDraft[];
}

/** The empty string an optional box is left at means the field was not answered, not "". */
function orNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/** The period's own refusals, shared by the panel that types a statement and the one that imports it. */
function refusePeriod(draft: {
  readonly periodStart: string;
  readonly periodEnd: string;
}): string | null {
  if (draft.periodStart === "") return "Say which day the statement's period starts.";
  if (draft.periodEnd === "") return "Say which day the statement's period ends.";
  if (draft.periodEnd < draft.periodStart) {
    return "A period ends on the day it starts or after it. Check the two days.";
  }
  return null;
}

/** The two balances, read once for both panels. */
function readBalances(draft: {
  readonly openingBalanceText: string;
  readonly closingBalanceText: string;
}): TrustRequestReading<{ openingBalanceMinor: number; closingBalanceMinor: number }> {
  const opening = readAmountMinor(draft.openingBalanceText);
  if (opening.kind === "empty") {
    return { kind: "refused", reason: "Say what the account held when the period opened." };
  }
  if (opening.kind === "refused") return { kind: "refused", reason: opening.reason };
  const closing = readAmountMinor(draft.closingBalanceText);
  if (closing.kind === "empty") {
    return { kind: "refused", reason: "Say what the account held when the period closed." };
  }
  if (closing.kind === "refused") return { kind: "refused", reason: closing.reason };
  return {
    kind: "request",
    request: { openingBalanceMinor: opening.minor, closingBalanceMinor: closing.minor },
  };
}

/** One typed line as the contract takes it, or the sentence that says which line is wrong. */
function readStatementLine(
  line: TrustStatementLineDraft,
  position: number,
  period: StatementPeriod,
): TrustRequestReading<TrustBankStatementLineEntry> {
  const name = `Line ${String(position)}`;
  if (line.postedOn === "") {
    return { kind: "refused", reason: `${name}: say which day the bank posted it.` };
  }
  if (line.postedOn < period.periodStart || line.postedOn > period.periodEnd) {
    return {
      kind: "refused",
      reason: `${name}: the day it was posted falls outside the period this statement covers.`,
    };
  }
  const amount = readAmountMinor(line.amountText);
  if (amount.kind === "empty") {
    return { kind: "refused", reason: `${name}: say how much the bank posted.` };
  }
  if (amount.kind === "refused") return { kind: "refused", reason: `${name}: ${amount.reason}` };
  if (amount.minor === 0) {
    return { kind: "refused", reason: `${name}: a line of nothing moves nothing.` };
  }
  if (line.description.trim() === "") {
    return { kind: "refused", reason: `${name}: say what the bank called it.` };
  }
  return {
    kind: "request",
    request: {
      postedOn: line.postedOn,
      direction: line.direction,
      amountMinor: amount.minor,
      description: line.description.trim(),
      reference: orNull(line.reference),
      counterpartyName: orNull(line.counterpartyName),
    },
  };
}

export function readTrustBankStatementEntry(
  draft: TrustStatementEntryDraft,
): TrustRequestReading<TrustBankStatementEntry> {
  const periodRefusal = refusePeriod(draft);
  if (periodRefusal !== null) return { kind: "refused", reason: periodRefusal };
  const balances = readBalances(draft);
  if (balances.kind === "refused") return balances;
  const period = { periodStart: draft.periodStart, periodEnd: draft.periodEnd };
  const lines: TrustBankStatementLineEntry[] = [];
  for (const [index, line] of draft.lines.entries()) {
    const reading = readStatementLine(line, index + 1, period);
    if (reading.kind === "refused") return reading;
    lines.push(reading.request);
  }
  return {
    kind: "request",
    request: {
      trustAccountId: draft.trustAccountId,
      periodStart: draft.periodStart,
      periodEnd: draft.periodEnd,
      openingBalanceMinor: balances.request.openingBalanceMinor,
      closingBalanceMinor: balances.request.closingBalanceMinor,
      currency: STATEMENT_CURRENCY_CODE,
      statementReference: orNull(draft.statementReference),
      lines,
    },
  };
}

// ---- importing a statement from a file ---------------------------------------------------------

/** What the import panel holds: the file it read, how its days are written, and the period around it. */
export interface TrustStatementImportDraft {
  readonly trustAccountId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly openingBalanceText: string;
  readonly closingBalanceText: string;
  readonly statementReference: string;
  /** The file's text as the browser read it, or the empty string where nothing was chosen. */
  readonly fileText: string;
  readonly dateFormat: TrustStatementDateFormat;
  /** What the last preview read, or null where the file has not been previewed. */
  readonly preview: TrustStatementImportPreview | null;
}

/** What the preview is asked, or the sentence saying nothing can be previewed yet. */
export function readTrustStatementPreviewRequest(
  draft: TrustStatementImportDraft,
): TrustRequestReading<{
  fileText: string;
  dateFormat: TrustStatementDateFormat;
  currency: "USD";
}> {
  if (draft.fileText === "") {
    return { kind: "refused", reason: "Choose the statement file the bank sent." };
  }
  return {
    kind: "request",
    request: {
      fileText: draft.fileText,
      dateFormat: draft.dateFormat,
      currency: STATEMENT_CURRENCY_CODE,
    },
  };
}

/**
 * The import, which cannot be composed without the preview it quotes.
 *
 * The fingerprint is the whole point of the two steps: it says which file was reviewed, so a file
 * swapped under the reader between the preview and the commit is refused by the server rather than
 * imported as rows nobody saw.
 */
export function readTrustStatementImportRequest(
  draft: TrustStatementImportDraft,
): TrustRequestReading<TrustStatementImportRequest> {
  if (draft.fileText === "") {
    return { kind: "refused", reason: "Choose the statement file the bank sent." };
  }
  if (draft.preview === null) {
    return {
      kind: "refused",
      reason: "Preview the file first, so what would be recorded is read.",
    };
  }
  if (draft.preview.rows.length === 0) {
    return {
      kind: "refused",
      reason: "The preview read no lines out of this file. Check the file and the date format.",
    };
  }
  const periodRefusal = refusePeriod(draft);
  if (periodRefusal !== null) return { kind: "refused", reason: periodRefusal };
  const balances = readBalances(draft);
  if (balances.kind === "refused") return balances;
  return {
    kind: "request",
    request: {
      trustAccountId: draft.trustAccountId,
      periodStart: draft.periodStart,
      periodEnd: draft.periodEnd,
      openingBalanceMinor: balances.request.openingBalanceMinor,
      closingBalanceMinor: balances.request.closingBalanceMinor,
      currency: STATEMENT_CURRENCY_CODE,
      statementReference: orNull(draft.statementReference),
      fileText: draft.fileText,
      dateFormat: draft.dateFormat,
      confirmedFingerprint: draft.preview.fingerprint,
    },
  };
}

/** One field of an imported statement, and the column the reader took it from. */
export interface ImportColumnRow {
  readonly field: string;
  readonly label: string;
  /** What the mapping named, or null where the file carries no column for the field. */
  readonly column: string | null;
}

/** What each mapped field is called, where the platform has a word for it. */
const IMPORT_FIELD_LABELS: Readonly<Record<string, string>> = {
  postedOn: "Posted On",
  direction: "Direction",
  amount: "Amount",
  amountMinor: "Amount",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  description: "Description",
  reference: "Reference",
  counterpartyName: "Counterparty",
};

/**
 * The column mapping as rows a definition list can stand over.
 *
 * A field the platform has no word for keeps the name the server served rather than being dropped:
 * the mapping is the reader's only account of how their file was read, and a row missing from it is
 * a column silently ignored.
 */
export function importColumnRows(
  columnMapping: Readonly<Record<string, unknown>>,
): readonly ImportColumnRow[] {
  return Object.entries(columnMapping).map(([field, value]) => ({
    field,
    label: IMPORT_FIELD_LABELS[field] ?? field,
    column: namedColumn(value),
  }));
}

/**
 * One mapped column as a reader reads it.
 *
 * A mapping names a column by its heading or by its position, so a string and a number are both
 * answers; anything else is a shape this surface cannot state, and stating it as "[object Object]"
 * would be worse than saying nothing about that field's column.
 */
function namedColumn(value: unknown): string | null {
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number") return String(value);
  return null;
}

/** The days the previewed rows span, or null where the preview read no dated row. */
export function importDateSpanText(
  preview: TrustStatementImportPreview,
  formatSpan: (from: string, to: string) => string,
): string | null {
  const { earliestPostedOn, latestPostedOn } = preview;
  if (earliestPostedOn === null || latestPostedOn === null) return null;
  return formatSpan(earliestPostedOn, latestPostedOn);
}
