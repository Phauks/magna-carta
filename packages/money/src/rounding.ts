import { halfAwayFromZero, halfEven, halfUp, snapshot, transformScale } from "./dinero.ts";
import { assertSafeInteger, MONEY_SCALE, type Intermediate, type Money } from "./money.ts";

// Collapse a high-precision Intermediate to Money (scale 2) at the chosen rounding mode.
// No global default — the mode is the caller's stated intent.
// Guards the raw amount first: the number calculator is exact only below 2^53, so a breach here means
// an upstream multiplyByQuantity/percentOf grew past the safe range and the value can't be trusted
// (ADR-0061). This is the single choke point through which every Intermediate becomes Money.
function collapse(value: Intermediate, mode: typeof halfUp): Money {
  assertSafeInteger(snapshot(value).amount);
  return transformScale(value, MONEY_SCALE, mode) as Money;
}

// roundTax — half-up (round .5 up), the statutory sales/use-tax rule. Tax is computed on a positive
// base; a tax refund reverses an already-rounded charge rather than re-rounding a negative, so half-up
// is correct and never meets a negative amount here.
export function roundTax(value: Intermediate): Money {
  return collapse(value, halfUp);
}

// roundInvoiceLine — half-AWAY-from-zero, so a negative line (discount/credit/write-off) rounds to the
// same magnitude as its positive twin (standard commercial rounding). half-up would round -8.375 to
// -8.37 while +8.375 → +8.38, an asymmetry a billing system with credits must not have.
export function roundInvoiceLine(value: Intermediate): Money {
  return collapse(value, halfAwayFromZero);
}

// roundLedger — banker's rounding (half-even), GAAP-accepted and bias-free for GL aggregation; symmetric
// on negatives by construction.
export function roundLedger(value: Intermediate): Money {
  return collapse(value, halfEven);
}
