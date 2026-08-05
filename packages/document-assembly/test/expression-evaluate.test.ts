import { describe, expect, it } from "vitest";
import { expressionScopeFor } from "../src/dictionary.ts";
import type { ExpressionType } from "../src/expression/catalog.ts";
import { checkExpression, layerScope, type NameBinding } from "../src/expression/check.ts";
import {
  createEvaluationBudget,
  evaluate,
  type Evaluation,
  type EvaluationBudget,
  type ExpressionValue,
} from "../src/expression/evaluate.ts";
import { EXPRESSION_LIMITS } from "../src/expression/limits.ts";

// The evaluator against a SYNTHETIC merge context — a checked tree plus values, still no document. Every
// outcome is one of three: a value, an unresolved name, or a refusal. Collapsing any two of them is how
// a silently wrong document gets filed.

const SYNTHETIC: readonly (readonly [string, ExpressionType])[] = [
  ["custom.settlement", "money"],
  ["custom.retainer", "money"],
  ["custom.euroFee", "money"],
  ["custom.contingency", "rate"],
  ["custom.hours", "number"],
  ["custom.filedOn", "date"],
  ["custom.absent", "text"],
  ["custom.absentAmount", "money"],
  ["custom.longText", "text"],
];

const SCOPE = layerScope(
  expressionScopeFor(),
  new Map<string, NameBinding>(
    SYNTHETIC.map(([name, type]) => [name, { type, origin: "dictionary" as const }]),
  ),
);

const VALUES: ReadonlyMap<string, ExpressionValue> = new Map<string, ExpressionValue>([
  ["custom.settlement", { kind: "money", amountMinor: 10_000, currencyCode: "USD" }],
  ["custom.retainer", { kind: "money", amountMinor: 250_000, currencyCode: "USD" }],
  ["custom.euroFee", { kind: "money", amountMinor: 5_000, currencyCode: "EUR" }],
  ["custom.contingency", { kind: "rate", rateE4: 3_333, currencyCode: "USD" }],
  ["custom.hours", { kind: "number", significand: 25, scale: 1 }],
  ["custom.filedOn", { kind: "date", isoDate: "2026-01-31" }],
  ["matter.number", { kind: "text", text: "2026-0042" }],
  ["matter.status", { kind: "text", text: "open" }],
  ["matter.eBilling", { kind: "boolean", value: true }],
  ["system.today", { kind: "date", isoDate: "2026-08-04" }],
  // A long stored value: the only way a short expression produces a lot of text is by reading it.
  ["custom.longText", { kind: "text", text: "a".repeat(3_000) }],
]);

function run(source: string, budget: EvaluationBudget = createEvaluationBudget()): Evaluation {
  const checked = checkExpression(source, { scope: SCOPE, required: "formattableScalar" });
  if (!checked.ok) {
    throw new Error(`${source} did not check: ${checked.failure.detail}`);
  }
  return evaluate(checked.value, { values: VALUES, budget });
}

function valueOf(source: string): ExpressionValue {
  const outcome = run(source);
  if (outcome.kind !== "value") {
    throw new Error(`${source} produced ${outcome.kind}`);
  }
  return outcome.value;
}

describe("exact arithmetic", () => {
  it("adds and subtracts decimals at the aligned scale, exactly", () => {
    expect(valueOf("0.1 + 0.2")).toEqual({ kind: "number", significand: 3, scale: 1 });
    expect(valueOf("1 - 0.075")).toEqual({ kind: "number", significand: 925, scale: 3 });
  });

  it("multiplies at the SUM of the operand scales", () => {
    expect(valueOf("0.075 * 0.5")).toEqual({ kind: "number", significand: 375, scale: 4 });
  });

  it("refuses a product whose scale exceeds what the language holds exactly", () => {
    const outcome = run("0.12345 * 0.12345");
    expect(outcome.kind).toBe("refusal");
    if (outcome.kind !== "refusal") return;
    expect(outcome.refusal.code).toBe("scale");
  });

  it("refuses a magnitude breach rather than letting the money package throw", () => {
    const outcome = run(`${Number.MAX_SAFE_INTEGER} + ${Number.MAX_SAFE_INTEGER}`);
    expect(outcome.kind).toBe("refusal");
    if (outcome.kind !== "refusal") return;
    expect(outcome.refusal.code).toBe("magnitude");
  });
});

describe("money", () => {
  it("adds two amounts in the same currency", () => {
    expect(valueOf("custom.settlement + custom.retainer")).toEqual({
      kind: "money",
      amountMinor: 260_000,
      currencyCode: "USD",
    });
  });

  it("REFUSES two amounts in different currencies, naming both — there is no conversion here", () => {
    const outcome = run("custom.settlement + custom.euroFee");
    expect(outcome.kind).toBe("refusal");
    if (outcome.kind !== "refusal") return;
    expect(outcome.refusal.code).toBe("currency-mismatch");
    expect(outcome.refusal.detail).toContain("USD");
    expect(outcome.refusal.detail).toContain("EUR");
  });

  it("multiplies money by a whole number exactly, and refuses a fractional one", () => {
    expect(valueOf("custom.settlement * 3")).toEqual({
      kind: "money",
      amountMinor: 30_000,
      currencyCode: "USD",
    });
    const outcome = run("custom.settlement * custom.hours");
    expect(outcome.kind).toBe("refusal");
    if (outcome.kind !== "refusal") return;
    expect(outcome.refusal.code).toBe("invalid-operand");
    expect(outcome.refusal.detail).toContain("percentOf");
  });

  it("divides exactly, or refuses and names the alternatives", () => {
    expect(valueOf("divideExact(custom.settlement, 4)")).toEqual({
      kind: "money",
      amountMinor: 2_500,
      currencyCode: "USD",
    });
    const outcome = run("divideExact(custom.settlement, 3)");
    expect(outcome.kind).toBe("refusal");
    if (outcome.kind !== "refusal") return;
    expect(outcome.refusal.code).toBe("inexact-division");
    expect(outcome.refusal.detail).toContain("allocate");
  });

  it("rounds a division half to even, and the remaining penny is gone", () => {
    expect(valueOf("divideRounded(custom.settlement, 3)")).toEqual({
      kind: "money",
      amountMinor: 3_333,
      currencyCode: "USD",
    });
  });

  it("applies a stored rate, rounding at the boundary", () => {
    // $100.00 at 0.3333 is $33.33.
    expect(valueOf("applyRate(custom.settlement, custom.contingency)")).toEqual({
      kind: "money",
      amountMinor: 3_333,
      currencyCode: "USD",
    });
  });

  it("takes a decimal fraction of an amount, rounding at the boundary", () => {
    expect(valueOf("percentOf(custom.settlement, 0.075)")).toEqual({
      kind: "money",
      amountMinor: 750,
      currencyCode: "USD",
    });
  });

  it("splits into parts that sum EXACTLY to the input", () => {
    const outcome = run("count(allocate(custom.settlement, 3))");
    expect(outcome.kind).toBe("value");
    const checked = checkExpression("allocate(custom.settlement, 3)", {
      scope: SCOPE,
      required: "list",
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const list = evaluate(checked.value, { values: VALUES, budget: createEvaluationBudget() });
    expect(list.kind).toBe("value");
    if (list.kind !== "value" || list.value.kind !== "list") return;
    const parts = list.value.items.map((item) =>
      item.scalar?.kind === "money" ? item.scalar.amountMinor : 0,
    );
    expect(parts).toHaveLength(3);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(10_000);
  });
});

describe("dates", () => {
  it("moves a date by days, months, and years", () => {
    expect(valueOf("addDays(custom.filedOn, 30)")).toEqual({
      kind: "date",
      isoDate: "2026-03-02",
    });
    expect(valueOf("addYears(custom.filedOn, 1)")).toEqual({
      kind: "date",
      isoDate: "2027-01-31",
    });
  });

  it("CLAMPS to the end of the month, because the alternative convention is a wrong deadline", () => {
    expect(valueOf("addMonths(custom.filedOn, 1)")).toEqual({
      kind: "date",
      isoDate: "2026-02-28",
    });
    expect(valueOf('addMonths(date "2024-01-31", 1)')).toEqual({
      kind: "date",
      isoDate: "2024-02-29",
    });
    expect(valueOf('addYears(date "2024-02-29", 1)')).toEqual({
      kind: "date",
      isoDate: "2025-02-28",
    });
  });

  it("counts days between two dates, negative when they are the other way round", () => {
    expect(valueOf('daysBetween(date "2026-01-01", date "2026-01-31")')).toEqual({
      kind: "number",
      significand: 30,
      scale: 0,
    });
    expect(valueOf('daysBetween(date "2026-01-31", date "2026-01-01")')).toEqual({
      kind: "number",
      significand: -30,
      scale: 0,
    });
  });

  it("reads a date's parts", () => {
    expect(valueOf("year(custom.filedOn)")).toEqual({
      kind: "number",
      significand: 2026,
      scale: 0,
    });
    expect(valueOf("monthName(custom.filedOn)")).toEqual({ kind: "text", text: "January" });
  });
});

describe("absence", () => {
  it("propagates unresolved through every operator, naming the key", () => {
    const outcome = run("custom.absentAmount + custom.settlement");
    expect(outcome.kind).toBe("unresolved");
    if (outcome.kind !== "unresolved") return;
    expect(outcome.name).toBe("custom.absentAmount");
  });

  it("answers has() totally, whichever way it goes", () => {
    expect(valueOf('choose(has(custom.absent), "yes", "no")')).toEqual({
      kind: "text",
      text: "no",
    });
    expect(valueOf('choose(has(matter.number), "yes", "no")')).toEqual({
      kind: "text",
      text: "yes",
    });
  });

  it("eliminates absence with default, and never evaluates choose's unselected arm", () => {
    expect(valueOf('default(custom.absent, "fallback")')).toEqual({
      kind: "text",
      text: "fallback",
    });
    // The unselected arm would be unresolved; it is never worked out, so the whole is a value.
    expect(valueOf('choose(matter.eBilling, "billed electronically", custom.absent)')).toEqual({
      kind: "text",
      text: "billed electronically",
    });
  });

  it("does not let and/or short-circuit an unresolved operand into an answer", () => {
    const checked = checkExpression('has(custom.absent) and custom.absent == "x"', {
      scope: SCOPE,
      required: "boolean",
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    // has() is false, so the whole conjunction is knowably false without the second arm.
    const outcome = evaluate(checked.value, { values: VALUES, budget: createEvaluationBudget() });
    expect(outcome).toEqual({ kind: "value", value: { kind: "boolean", value: false } });

    const unknown = checkExpression('matter.eBilling and custom.absent == "x"', {
      scope: SCOPE,
      required: "boolean",
    });
    expect(unknown.ok).toBe(true);
    if (!unknown.ok) return;
    expect(evaluate(unknown.value, { values: VALUES, budget: createEvaluationBudget() }).kind).toBe(
      "unresolved",
    );
  });
});

describe("bounds at evaluation", () => {
  it("refuses when the shared step budget runs out, naming the budget rather than timing out", () => {
    const budget = createEvaluationBudget();
    budget.steps = EXPRESSION_LIMITS.evaluationSteps;
    const outcome = run("1 + 1", budget);
    expect(outcome.kind).toBe("refusal");
    if (outcome.kind !== "refusal") return;
    expect(outcome.refusal.code).toBe("step-budget");
  });

  it("refuses a helper result longer than one result may carry", () => {
    const budget = createEvaluationBudget();
    const outcome = run("concat(custom.longText, custom.longText)", budget);
    expect(outcome.kind).toBe("refusal");
    if (outcome.kind !== "refusal") return;
    expect(outcome.refusal.code).toBe("text-budget");
  });

  it("refuses when the document's expressions produce more text in aggregate than one assembly may carry", () => {
    const budget = createEvaluationBudget();
    budget.text = EXPRESSION_LIMITS.textPerAssembly;
    const outcome = run('concat("a", "b")', budget);
    expect(outcome.kind).toBe("refusal");
    if (outcome.kind !== "refusal") return;
    expect(outcome.refusal.code).toBe("text-budget");
  });

  it("refuses a split into more parts than a repeating block may walk", () => {
    const checked = checkExpression(
      `allocate(custom.settlement, ${EXPRESSION_LIMITS.itemsPerRepeat + 1})`,
      { scope: SCOPE, required: "list" },
    );
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const outcome = evaluate(checked.value, { values: VALUES, budget: createEvaluationBudget() });
    expect(outcome.kind).toBe("refusal");
    if (outcome.kind !== "refusal") return;
    expect(outcome.refusal.code).toBe("repeat-too-large");
  });
});

describe("comparison and membership", () => {
  it("compares text, dates, numbers, and same-currency money", () => {
    expect(valueOf('choose(matter.status == "open", "y", "n")')).toEqual({
      kind: "text",
      text: "y",
    });
    expect(valueOf('choose(custom.filedOn < system.today, "y", "n")')).toEqual({
      kind: "text",
      text: "y",
    });
    expect(valueOf('choose(custom.retainer > custom.settlement, "y", "n")')).toEqual({
      kind: "text",
      text: "y",
    });
  });

  it("refuses to compare money across currencies", () => {
    const outcome = run('choose(custom.settlement > custom.euroFee, "y", "n")');
    expect(outcome.kind).toBe("refusal");
    if (outcome.kind !== "refusal") return;
    expect(outcome.refusal.code).toBe("currency-mismatch");
  });

  it("tests membership against a list of fixed values", () => {
    expect(valueOf('choose(matter.status in ("open", "closed"), "y", "n")')).toEqual({
      kind: "text",
      text: "y",
    });
    expect(valueOf('choose(matter.status in ("closed"), "y", "n")')).toEqual({
      kind: "text",
      text: "n",
    });
  });
});
