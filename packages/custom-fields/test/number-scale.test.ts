import { expect, it } from "vitest";
import {
  decimalStringFromScaledInteger,
  effectiveNumberScale,
  isDecimalString,
  rescaleStoredInteger,
  scaledIntegerFromDecimalString,
} from "../src/number-scale.ts";

it("a currency field with no declared scale stores the firm-currency minor unit", () => {
  expect(effectiveNumberScale("currency", null)).toBe(2);
  expect(effectiveNumberScale("number", null)).toBe(0);
  expect(effectiveNumberScale("checkbox", null)).toBe(0);
});

it("a declared scale wins over the kind's natural scale", () => {
  expect(effectiveNumberScale("currency", 4)).toBe(4);
  expect(effectiveNumberScale("number", 3)).toBe(3);
});

it("renders a stored integer as the decimal it stands for", () => {
  expect(decimalStringFromScaledInteger(50_000, 2)).toBe("500.00");
  expect(decimalStringFromScaledInteger(5, 2)).toBe("0.05");
  expect(decimalStringFromScaledInteger(-1234, 2)).toBe("-12.34");
  expect(decimalStringFromScaledInteger(500, 0)).toBe("500");
});

it("reads a decimal back into the integer it stands for", () => {
  expect(scaledIntegerFromDecimalString("500.00", 2)).toBe(50_000);
  expect(scaledIntegerFromDecimalString("0.05", 2)).toBe(5);
  expect(scaledIntegerFromDecimalString("-12.34", 2)).toBe(-1234);
  expect(scaledIntegerFromDecimalString("500", 2)).toBe(50_000);
});

it("refuses a decimal finer than the scale can hold rather than rounding it", () => {
  expect(scaledIntegerFromDecimalString("12.345", 2)).toBeNull();
  expect(scaledIntegerFromDecimalString("12.50", 0)).toBeNull();
  // Trailing zeros past the scale carry no value, so they are not a loss.
  expect(scaledIntegerFromDecimalString("12.00", 0)).toBe(12);
});

it("refuses text that is not a plain decimal", () => {
  expect(isDecimalString("1e6")).toBe(false);
  expect(isDecimalString("1,000")).toBe(false);
  expect(scaledIntegerFromDecimalString("approx five", 2)).toBeNull();
});

it("re-scales an integer exactly, or not at all", () => {
  expect(rescaleStoredInteger(500, 0, 2)).toBe(50_000);
  expect(rescaleStoredInteger(50_000, 2, 0)).toBe(500);
  expect(rescaleStoredInteger(42, 2, 2)).toBe(42);
  // 500.50 has no exact reading in whole units.
  expect(rescaleStoredInteger(50_050, 2, 0)).toBeNull();
});

it("refuses a re-scale that would leave the exact-integer range", () => {
  expect(rescaleStoredInteger(Number.MAX_SAFE_INTEGER, 0, 2)).toBeNull();
});
