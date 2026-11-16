import { snapshot, toDecimal } from "./dinero.ts";
import { money, type NumberCurrency, type Money, type Rate } from "./money.ts";

// DB boundary: Money <-> minor units (cents). Money is always scale 2, so the snapshot amount IS minor units.
export function toMinor(value: Money): number {
  return snapshot(value).amount;
}

export function fromMinor(minor: number, currency: NumberCurrency): Money {
  return money(minor, currency);
}

// Ledger/validation boundary: the ISO-4217 code a Money is tagged with (every value carries its
// currency). Read-only; constructing Money with a currency stays money()'s job.
export function currencyCode(value: Money): string {
  return snapshot(value).currency.code;
}

// Intl.NumberFormat construction is the expensive half of formatting; one instance per currency
// serves every call (formatters are stateless after construction).
const formatters = new Map<string, Intl.NumberFormat>();

export function format(value: Money): string {
  // toDecimal gives the exact decimal string; Intl applies locale currency formatting with an explicit currency.
  const code = snapshot(value).currency.code;
  let formatter = formatters.get(code);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: code });
    formatters.set(code, formatter);
  }
  // The decimal STRING goes to Intl as-is: ECMA-402 parses string input as an exact mathematical
  // value. Converting through Number() would be lossy — float spacing near 2^53 cents (~1.6 cents)
  // exceeds half a cent, silently misprinting the last digits of amounts the package supports.
  // toDecimal returns string; the exact-value overload (ES2023.Intl) wants the numeric-string literal type.
  return formatter.format(toDecimal(value) as Intl.StringNumericLiteral);
}

// A rate per hour at its own scale (four places, 4500000 is 450.00). It prints as money does where it
// is a whole number of cents, and keeps its finer places where a rate card holds them, so nothing a
// rate card says is rounded away on screen.
const rateFormatters = new Map<string, Intl.NumberFormat>();

export function formatRate(value: Rate): string {
  const code = snapshot(value).currency.code;
  let formatter = rateFormatters.get(code);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 4,
    });
    rateFormatters.set(code, formatter);
  }
  return formatter.format(toDecimal(value) as Intl.StringNumericLiteral);
}

// Spreadsheet boundary: the amount as a plain number of whole currency units, for a cell a reader's
// spreadsheet should be able to sum. Display text goes through format(); this is the number BESIDE
// that text, and it is lossy past 2^53 minor units the way every spreadsheet number is.
export function spreadsheetNumber(value: Money): number {
  return Number(toDecimal(value));
}
