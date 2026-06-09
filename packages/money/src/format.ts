import { snapshot } from "./dinero.ts";
import { money, type NumberCurrency, type Money } from "./money.ts";

// DB boundary: Money <-> minor units (cents). Money is always scale 2, so the snapshot amount IS minor units.
export function toMinor(value: Money): number {
  return snapshot(value).amount;
}

export function fromMinor(minor: number, currency: NumberCurrency): Money {
  return money(minor, currency);
}
