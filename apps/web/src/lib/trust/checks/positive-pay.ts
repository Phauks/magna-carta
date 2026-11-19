/*
 * The positive pay file: the checks a trust account issued and voided, in the shape a bank takes as
 * an upload, so the bank can refuse any check presented that is not on it. No bank is named yet, so
 * this is the common generic CSV: one header row, one row per check, CRLF line ends.
 *
 * WHICH CHECKS. A check issued in the dates (the day its number was used), and a check voided in the
 * dates (the day of its last event), so a void of an older check still reaches the bank. A number
 * voided before anything printed on it has no payee and no amount, and goes as a void for 0.00:
 * the bank has to hear that the number is dead as much as it has to hear about a live check.
 *
 * WHAT IS LEFT OUT. The matter and the memo stay in the firm. The account number is the caller's
 * and is never kept: the account record holds only its last four digits, and the file needs all of
 * them, so the reader types it each time.
 *
 * A PAYEE IS DATA, NEVER A FORMULA. A spreadsheet opening this file would run a payee that starts
 * with = + - @ (or a tab or carriage return that hides one), so such a payee gets a leading
 * apostrophe, the conventional neutraliser, before it is quoted.
 */
import { zonedReading } from "@magna-carta/civil-time/time-zone";
import { currencyFromCode, isRegisteredCurrencyCode, money, USD } from "@magna-carta/money/money";
import { decimalText } from "@magna-carta/money/format";
import { csvField } from "$lib/export/render-csv.ts";
import type { TrustCheckRegisterRow } from "./checks-api.ts";

export interface PositivePayRow {
  readonly checkNumber: number;
  /** `YYYY-MM-DD`. */
  readonly issueDate: string;
  /** Zero for a number voided before a payment was printed on it. */
  readonly amountMinor: number;
  readonly currency: string;
  /** Empty for a number voided before a payment was printed on it. */
  readonly payee: string;
  readonly voided: boolean;
}

export interface PositivePayRange {
  /** First day, `YYYY-MM-DD`, inclusive. */
  readonly from: string;
  /** Last day, `YYYY-MM-DD`, inclusive. */
  readonly to: string;
  /** The zone a recorded moment is read in to find its day: the reader's. */
  readonly timeZone: string;
}

export const POSITIVE_PAY_HEADER = [
  "Account Number",
  "Check Number",
  "Issue Date",
  "Amount",
  "Payee",
  "Void",
] as const;

function isVoid(status: TrustCheckRegisterRow["status"]): boolean {
  return status === "voided" || status === "spoiled";
}

function dayOf(instant: string, timeZone: string): string {
  return zonedReading(Date.parse(instant), timeZone).civilDate;
}

/** The checks the file lists for these dates, sorted by check number. */
export function positivePayRows(
  register: readonly TrustCheckRegisterRow[],
  range: PositivePayRange,
): PositivePayRow[] {
  const within = (day: string): boolean => day >= range.from && day <= range.to;
  const rows: PositivePayRow[] = [];
  for (const row of register) {
    const voided = isVoid(row.status);
    const issuedOn = dayOf(row.numberedAt, range.timeZone);
    const voidedOn =
      voided && row.lastEventAt !== null ? dayOf(row.lastEventAt, range.timeZone) : null;
    if (!within(issuedOn) && (voidedOn === null || !within(voidedOn))) continue;
    rows.push({
      checkNumber: row.checkNumber,
      issueDate: row.effectiveDate ?? issuedOn,
      amountMinor: row.amountMinor ?? 0,
      currency: row.currency ?? "USD",
      payee: row.payee ?? "",
      voided,
    });
  }
  return rows.sort((left, right) => left.checkNumber - right.checkNumber);
}

/** "4 checks, 1 voided", or the sentence that says the dates hold none. */
export function positivePayCountText(rows: readonly PositivePayRow[]): string {
  if (rows.length === 0) return "No checks in these dates";
  const voided = rows.filter((row) => row.voided).length;
  const checks = `${rows.length} ${rows.length === 1 ? "check" : "checks"}`;
  return voided === 0 ? checks : `${checks}, ${voided} voided`;
}

/** A payee a spreadsheet would read as a formula, made plain text. */
export function formulaSafe(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function amountText(row: PositivePayRow): string {
  const currency = isRegisteredCurrencyCode(row.currency) ? currencyFromCode(row.currency) : USD;
  return decimalText(money(row.amountMinor, currency));
}

/** The file itself: the header and every row, each line ending CRLF. */
export function positivePayCsv(rows: readonly PositivePayRow[], accountNumber: string): string {
  const lines = [
    POSITIVE_PAY_HEADER.join(","),
    ...rows.map((row) =>
      [
        accountNumber,
        String(row.checkNumber),
        row.issueDate,
        amountText(row),
        formulaSafe(row.payee),
        row.voided ? "Y" : "N",
      ]
        .map(csvField)
        .join(","),
    ),
  ];
  return lines.map((line) => `${line}\r\n`).join("");
}

/** A whole bank account number: digits only, at least one. */
export function isAccountNumber(text: string): boolean {
  return /^\d+$/.test(text);
}

/** `positive-pay-iolta-client-trust-2026-11-01-to-2026-11-19.csv` */
export function positivePayFilename(accountName: string, from: string, to: string): string {
  const slug = accountName
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return `positive-pay-${slug === "" ? "account" : slug}-${from}-to-${to}.csv`;
}
