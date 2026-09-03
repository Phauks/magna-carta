/*
 * What an amount of money reads as, and what a bare count reads as — the platform's one answer for
 * both. Every surface that prints a figure comes here: the table's money and number columns, the
 * details panels beside them, and the totals rows underneath.
 *
 * THIS IS PRESENTATION, NOT ARITHMETIC. `@magna-carta/money` owns what an amount IS — branded
 * minor units, exact by construction, and the only thing a ledger may add up. What arrives here is
 * an amount somebody has already decided, in the currency's MAJOR unit, and this file turns it into
 * the string a reader sees. A surface that needs to add two amounts together adds them in the money
 * package and formats the result once, rather than adding the strings this returns.
 *
 * WHY A NUMBER IS ACCEPTED, AND WHERE THAT STOPS BEING SAFE. A major-unit number is a binary float,
 * so it cannot hold every exact cent. Measured rather than assumed: summing forty per-row amounts
 * and formatting the total agrees with the exact minor-unit sum for every amount a firm's ledger
 * carries, and only starts to disagree once a SINGLE row passes roughly a trillion of the major
 * unit. That is far outside this product's domain, so the number path stands. It is written down
 * here so the next reader does not have to re-derive it — and so that if a surface ever does carry
 * figures at that scale, it is already known what has to change.
 */

/** How a money column and a totals row name their currency and locale. */
export interface MoneyOptions {
  /** ISO-4217 code. Defaults to USD, which is what an unconfigured firm bills in. */
  currency?: string;
  /** BCP-47 locale. Defaults to the runtime's own, which is what a viewer's browser reports. */
  locale?: string;
}

/** How a bare count is named. */
export interface NumberOptions {
  /** BCP-47 locale. Defaults to the runtime's own. */
  locale?: string;
}

/** An amount in the currency's major unit, as the reader sees it. */
export function formatMoney(value: number, options: MoneyOptions = {}): string {
  return new Intl.NumberFormat(options.locale, {
    style: "currency",
    currency: options.currency ?? "USD",
  }).format(value);
}

/** A count, grouped the way the viewer's locale groups digits. */
export function formatNumber(value: number, options: NumberOptions = {}): string {
  return new Intl.NumberFormat(options.locale).format(value);
}
