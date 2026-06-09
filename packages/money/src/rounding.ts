import { halfEven, halfUp, transformScale, type NumberDinero } from "./dinero.ts";
import type { Money } from "./money.ts";

const MONEY_SCALE = 2;

// No global default rounding. The mode is chosen by the boundary's intent (spec §1.3).
// roundTax / roundInvoiceLine: half-up. roundLedger: banker's (half-even).

export function roundTax(value: NumberDinero): Money {
  return transformScale(value, MONEY_SCALE, halfUp) as Money;
}

export function roundInvoiceLine(value: NumberDinero): Money {
  return transformScale(value, MONEY_SCALE, halfUp) as Money;
}

export function roundLedger(value: NumberDinero): Money {
  return transformScale(value, MONEY_SCALE, halfEven) as Money;
}
