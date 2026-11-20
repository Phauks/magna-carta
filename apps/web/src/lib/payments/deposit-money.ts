/*
 * The few sums Record a Payment works out as it is filled in: a total of lines, one amount less
 * another, a count of bills and coins. Through @magna-carta/money, so a currency mismatch fails
 * loudly and nothing here does arithmetic on a bare number of cents.
 */
import { decimalText, format, toMinor } from "@magna-carta/money/format";
import {
  currencyFromCode,
  money,
  multiplyByQuantity,
  subtract,
  sum,
} from "@magna-carta/money/money";
import { roundLedger } from "@magna-carta/money/rounding";

/** The deposit's currency. A deposit holds one; the bills on this screen are all in it. */
export const DEPOSIT_CURRENCY = "USD";

export function totalMinor(
  amountsMinor: readonly number[],
  currencyCode = DEPOSIT_CURRENCY,
): number {
  if (amountsMinor.length === 0) return 0;
  const currency = currencyFromCode(currencyCode);
  return toMinor(sum(amountsMinor.map((amount) => money(amount, currency))));
}

export function differenceMinor(
  fromMinor: number,
  lessMinor: number,
  currencyCode = DEPOSIT_CURRENCY,
): number {
  const currency = currencyFromCode(currencyCode);
  return toMinor(subtract(money(fromMinor, currency), money(lessMinor, currency)));
}

/** A whole count of one bill or coin as an amount: exact, so the ledger's rounding rounds nothing. */
export function countedMinor(
  unitMinor: number,
  count: number,
  currencyCode = DEPOSIT_CURRENCY,
): number {
  const currency = currencyFromCode(currencyCode);
  return toMinor(roundLedger(multiplyByQuantity(money(unitMinor, currency), count)));
}

/** An amount as a field shows it once typed: thousands commas and two places, no symbol. */
export function amountText(amountMinor: number, currencyCode = DEPOSIT_CURRENCY): string {
  const plain = decimalText(money(amountMinor, currencyFromCode(currencyCode)));
  const negative = plain.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? plain.slice(1) : plain).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction === "" ? "" : `.${fraction}`}`;
}

/** An amount as the page prints it: the currency's symbol, thousands commas, two places. */
export function moneyText(amountMinor: number, currencyCode = DEPOSIT_CURRENCY): string {
  return format(money(amountMinor, currencyFromCode(currencyCode)));
}
