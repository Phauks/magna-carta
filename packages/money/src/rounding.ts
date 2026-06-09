import { halfEven, halfUp, snapshot, transformScale } from "./dinero.ts";
import { assertSafeInteger, type Intermediate, type Money } from "./money.ts";

const MONEY_SCALE = 2;

// Collapse a high-precision Intermediate to Money (scale 2) at the chosen rounding mode.
// No global default — the mode is the caller's stated intent (spec §1.3).
// Guards the raw amount first: the number calculator is exact only below 2^53, so a breach here means
// an upstream multiplyByQuantity/percentOf grew past the safe range and the value can't be trusted
// (ADR-0061). This is the single choke point through which every Intermediate becomes Money.
function collapse(value: Intermediate, mode: typeof halfUp): Money {
  assertSafeInteger(snapshot(value).amount);
  return transformScale(value, MONEY_SCALE, mode) as Money;
}

// roundTax / roundInvoiceLine: half-up. roundLedger: banker's (half-even).
export function roundTax(value: Intermediate): Money {
  return collapse(value, halfUp);
}

export function roundInvoiceLine(value: Intermediate): Money {
  return collapse(value, halfUp);
}

export function roundLedger(value: Intermediate): Money {
  return collapse(value, halfEven);
}
