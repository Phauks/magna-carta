// THE SEAM. This is the only file in the package that imports dinero.js.
// Everything else uses the branded Money/Rate/Ratio types and the in-house operations re-exported here.
// We use Dinero's default NUMBER calculator: amounts are JS safe-integer numbers (exact below 2^53 =
// $90T at cents). If amounts ever needed to exceed 2^53, swap to a decimal.js custom calculator via
// createDinero({ calculator }) — a one-file change here (verified working on 2026-06-08). See ADR-0061.
import {
  add as addDinero,
  allocate as allocateDinero,
  dinero,
  down,
  halfEven,
  halfUp,
  multiply as multiplyDinero,
  subtract as subtractDinero,
  toDecimal,
  toSnapshot,
  transformScale,
  type Dinero,
  type DineroCurrency,
  type DineroSnapshot,
} from "dinero.js";
import { EUR, USD } from "dinero.js/currencies";

export {
  addDinero,
  allocateDinero,
  down,
  EUR,
  halfEven,
  halfUp,
  multiplyDinero,
  subtractDinero,
  toDecimal,
  transformScale,
  USD,
};

export type NumberDinero = Dinero<number>;
// The general number-currency type (accepts USD, EUR, …) — not `typeof USD`, which would reject EUR.
export type NumberCurrency = DineroCurrency<number>;

export function makeMoneyDinero(
  amount: number,
  currency: NumberCurrency,
  scale: number,
): NumberDinero {
  return dinero({ amount, currency, scale });
}

export function snapshot(value: NumberDinero): DineroSnapshot<number> {
  return toSnapshot(value);
}
