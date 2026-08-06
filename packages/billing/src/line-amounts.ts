import { toMinor } from "@magna-carta/money/format";
import { currencyFromCode, money, multiplyByQuantity, rate, sum } from "@magna-carta/money/money";
import { roundInvoiceLine } from "@magna-carta/money/rounding";

// The scale the work-in-progress stores snapshot every rate at, and the scale a fee line carries its
// quantity at. Both are integers on the wire; nothing here ever sees a float.
export const RATE_SCALE_DIVISOR = 10_000;

// Rate times quantity, collapsed at the invoice-line boundary. roundInvoiceLine is
// half-AWAY-from-zero so a negative line — a discount, a write-down, a courtesy adjustment — rounds
// to the same magnitude as its positive twin. Half-up would round -8.375 to -8.37 while +8.375 goes
// to +8.38, an asymmetry a billing system with credits must not have.
export function invoiceLineAmountMinor(
  rateE4: number,
  quantityE4: number,
  currencyCode: string,
): number {
  const currency = currencyFromCode(currencyCode);
  const quantity = quantityE4 / RATE_SCALE_DIVISOR;
  return toMinor(roundInvoiceLine(multiplyByQuantity(rate(rateE4, currency), quantity)));
}

// Adding already-collapsed line amounts into a posting total. This goes through Money's own addition
// rather than plain integer arithmetic so a currency mismatch between two lines fails here, loudly,
// instead of silently producing a total in no currency at all.
//
// There is deliberately NO rounding helper on this path: every input is already at scale 2, so the
// sum is exact and a rounding mode would be a mode with nothing to decide. The named helpers appear
// where a boundary genuinely exists — roundInvoiceLine above, roundTax on a tax component computed
// over an aggregate base, and roundLedger where a high-precision figure first becomes a ledger
// amount. Reaching for one here would state a decision that was never made.
export function aggregateMinor(amountsMinor: readonly number[], currencyCode: string): number {
  if (amountsMinor.length === 0) return 0;
  const currency = currencyFromCode(currencyCode);
  return toMinor(sum(amountsMinor.map((amount) => money(amount, currency))));
}
