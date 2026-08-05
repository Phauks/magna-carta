import { seededRandomSource } from "@magna-carta/identifiers/random";
import { describe, expect, it } from "vitest";
import type { ExpressionType } from "../src/expression/catalog.ts";
import { checkExpression, layerScope, type NameBinding } from "../src/expression/check.ts";
import {
  createEvaluationBudget,
  evaluate,
  type ExpressionValue,
} from "../src/expression/evaluate.ts";
import { expressionScopeFor } from "../src/dictionary.ts";

// AN INDEPENDENT EXACT REFERENCE for the money and decimal operations. The evaluator computes in
// integers with a declared scale; the oracle below computes the same answers with BigInt, which is a
// different implementation of the same arithmetic — so the two agreeing is evidence rather than a
// tautology.
//
// The three properties this file exists to prove:
//  - half-to-even, on the EXACT TIE CASES, in both signs;
//  - `allocate`'s parts sum to the input for every generated split;
//  - `divideExact` refuses exactly when the quotient is inexact, and never otherwise.

const SCOPE = layerScope(
  expressionScopeFor(),
  new Map<string, NameBinding>([
    ["custom.amount", { type: "money" as ExpressionType, origin: "dictionary" }],
  ]),
);

function moneyValues(amountMinor: number): ReadonlyMap<string, ExpressionValue> {
  return new Map<string, ExpressionValue>([
    ["custom.amount", { kind: "money", amountMinor, currencyCode: "USD" }],
  ]);
}

function evaluateMoney(source: string, amountMinor: number) {
  const checked = checkExpression(source, { scope: SCOPE, required: "formattableScalar" });
  if (!checked.ok) throw new Error(`${source}: ${checked.failure.detail}`);
  return evaluate(checked.value, {
    values: moneyValues(amountMinor),
    budget: createEvaluationBudget(),
  });
}

// The oracle: an exact half-to-even quotient of two integers, in BigInt.
function halfEvenQuotient(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator - quotient * absoluteDenominator;
  const twiceRemainder = remainder * 2n;
  let rounded = quotient;
  if (twiceRemainder > absoluteDenominator) rounded = quotient + 1n;
  else if (twiceRemainder === absoluteDenominator && quotient % 2n === 1n) rounded = quotient + 1n;
  return negative ? -rounded : rounded;
}

// A deterministic integer stream from the seeded generator, so a failure reproduces from its seed.
function integerStream(seed: string): (bound: number) => number {
  const random = seededRandomSource(seed);
  return (bound) => {
    const bytes = random(4);
    const value =
      ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
    return Math.abs(value >>> 0) % bound;
  };
}

describe("divideRounded matches an exact half-to-even oracle", () => {
  it("rounds the exact tie cases to the EVEN cent, in both signs", () => {
    // A tie at the cent is a quotient of exactly half a cent, which happens whenever twice the amount
    // divides evenly and the amount itself does not. 5 / 2 = 2.5 -> 2; 7 / 2 = 3.5 -> 4.
    const ties: readonly (readonly [number, number, number])[] = [
      [5, 2, 2],
      [7, 2, 4],
      [-5, 2, -2],
      [-7, 2, -4],
      [25, 10, 2],
      [35, 10, 4],
      [-25, 10, -2],
      [-35, 10, -4],
    ];
    for (const [amountMinor, parts, expected] of ties) {
      const outcome = evaluateMoney(`divideRounded(custom.amount, ${parts})`, amountMinor);
      expect(outcome.kind, `${amountMinor}/${parts}`).toBe("value");
      if (outcome.kind !== "value" || outcome.value.kind !== "money") continue;
      expect(outcome.value.amountMinor, `${amountMinor}/${parts}`).toBe(expected);
    }
  });

  it("agrees with the oracle over a seeded sweep of amounts and divisors", () => {
    const next = integerStream("expression-divide-rounded");
    for (let trial = 0; trial < 400; trial += 1) {
      const amountMinor = next(2_000_001) - 1_000_000;
      const parts = next(97) + 1;
      const outcome = evaluateMoney(`divideRounded(custom.amount, ${parts})`, amountMinor);
      expect(outcome.kind, `${amountMinor}/${parts}`).toBe("value");
      if (outcome.kind !== "value" || outcome.value.kind !== "money") continue;
      const expected = Number(halfEvenQuotient(BigInt(amountMinor), BigInt(parts)));
      expect(outcome.value.amountMinor, `${amountMinor}/${parts}`).toBe(expected);
    }
  });
});

describe("divideExact refuses EXACTLY when the quotient is inexact", () => {
  it("agrees with the oracle over a seeded sweep", () => {
    const next = integerStream("expression-divide-exact");
    for (let trial = 0; trial < 400; trial += 1) {
      const amountMinor = next(200_001) - 100_000;
      const parts = next(37) + 1;
      const outcome = evaluateMoney(`divideExact(custom.amount, ${parts})`, amountMinor);
      const exact = amountMinor % parts === 0;
      if (exact) {
        expect(outcome.kind, `${amountMinor}/${parts}`).toBe("value");
        if (outcome.kind !== "value" || outcome.value.kind !== "money") continue;
        expect(outcome.value.amountMinor).toBe(amountMinor / parts);
      } else {
        expect(outcome.kind, `${amountMinor}/${parts}`).toBe("refusal");
        if (outcome.kind !== "refusal") continue;
        expect(outcome.refusal.code).toBe("inexact-division");
      }
    }
  });
});

describe("allocate's parts reconcile", () => {
  it("sums to the input for every generated split", () => {
    const next = integerStream("expression-allocate");
    for (let trial = 0; trial < 200; trial += 1) {
      const amountMinor = next(1_000_001);
      const parts = next(23) + 1;
      const checked = checkExpression(`allocate(custom.amount, ${parts})`, {
        scope: SCOPE,
        required: "list",
      });
      expect(checked.ok).toBe(true);
      if (!checked.ok) continue;
      const outcome = evaluate(checked.value, {
        values: moneyValues(amountMinor),
        budget: createEvaluationBudget(),
      });
      expect(outcome.kind, `${amountMinor} into ${parts}`).toBe("value");
      if (outcome.kind !== "value" || outcome.value.kind !== "list") continue;
      expect(outcome.value.items).toHaveLength(parts);
      const total = outcome.value.items.reduce(
        (sum, item) => sum + (item.scalar?.kind === "money" ? item.scalar.amountMinor : NaN),
        0,
      );
      // THE property: no penny drifts. A split whose parts do not add back up to the whole is the one
      // failure a settlement statement cannot survive.
      expect(total, `${amountMinor} into ${parts}`).toBe(amountMinor);
    }
  });
});

describe("exact decimal arithmetic matches a BigInt oracle", () => {
  it("adds, subtracts, and multiplies exactly over a seeded sweep", () => {
    const next = integerStream("expression-decimal");
    for (let trial = 0; trial < 300; trial += 1) {
      const leftScale = next(4);
      const rightScale = next(4);
      const leftSignificand = next(100_000);
      const rightSignificand = next(100_000);
      const left = decimalLiteral(leftSignificand, leftScale);
      const right = decimalLiteral(rightSignificand, rightScale);

      for (const operator of ["+", "-", "*"] as const) {
        const checked = checkExpression(`${left} ${operator} ${right}`, {
          scope: SCOPE,
          required: "formattableScalar",
        });
        expect(checked.ok, `${left} ${operator} ${right}`).toBe(true);
        if (!checked.ok) continue;
        const outcome = evaluate(checked.value, {
          values: new Map(),
          budget: createEvaluationBudget(),
        });
        expect(outcome.kind, `${left} ${operator} ${right}`).toBe("value");
        if (outcome.kind !== "value" || outcome.value.kind !== "number") continue;

        const scale = operator === "*" ? leftScale + rightScale : Math.max(leftScale, rightScale);
        const leftAligned =
          BigInt(leftSignificand) * 10n ** BigInt(operator === "*" ? 0 : scale - leftScale);
        const rightAligned =
          BigInt(rightSignificand) * 10n ** BigInt(operator === "*" ? 0 : scale - rightScale);
        const expected =
          operator === "+"
            ? leftAligned + rightAligned
            : operator === "-"
              ? leftAligned - rightAligned
              : leftAligned * rightAligned;
        expect(BigInt(outcome.value.significand), `${left} ${operator} ${right}`).toBe(expected);
        expect(outcome.value.scale).toBe(scale);
      }
    }
  });
});

function decimalLiteral(significand: number, scale: number): string {
  if (scale === 0) return String(significand);
  const digits = String(significand).padStart(scale + 1, "0");
  return `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
}
