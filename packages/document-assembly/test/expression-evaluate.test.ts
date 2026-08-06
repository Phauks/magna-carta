import { seededRandomSource } from "@magna-carta/identifiers/random";
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

// ---------------------------------------------------------------------------------------------
// The calendar range, over ALL THREE date helpers
// ---------------------------------------------------------------------------------------------
//
// The property is one sentence: a date helper either produces a date the rest of the language can read
// and order, or it refuses. It never produces a third thing. A five-digit or negative year is that
// third thing — it renders as an empty string and it compares backwards against every in-range date,
// both silently — so the boundary is asserted exactly rather than approximately, and then generated
// over so the claim covers offsets nobody thought to enumerate.

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe("the calendar range every date helper shares", () => {
  const HELPERS = ["addDays", "addMonths", "addYears"] as const;

  it("refuses an out-of-range result rather than producing an unreadable date", () => {
    for (const source of [
      "addDays(custom.filedOn, 4000000)",
      "addDays(custom.filedOn, -4000000)",
      "addMonths(custom.filedOn, 200000)",
      "addYears(custom.filedOn, 100000)",
    ]) {
      const outcome = run(source);
      expect(outcome.kind, source).toBe("refusal");
      if (outcome.kind !== "refusal") continue;
      expect(outcome.refusal.code, source).toBe("magnitude");
    }
  });

  it("holds the boundary exactly on both ends", () => {
    // 9999-12-31 is the last representable day and 0001-01-01 the first: one day either side refuses.
    expect(valueOf('addDays(date "9999-12-30", 1)')).toEqual({
      kind: "date",
      isoDate: "9999-12-31",
    });
    expect(run('addDays(date "9999-12-31", 1)').kind).toBe("refusal");
    expect(valueOf('addDays(date "0001-01-02", -1)')).toEqual({
      kind: "date",
      isoDate: "0001-01-01",
    });
    expect(run('addDays(date "0001-01-01", -1)').kind).toBe("refusal");
  });

  it("never yields a value outside the shape the formatter and the ordering both read", () => {
    // Seeded so a failure reproduces from its seed rather than from a screenshot — the discipline
    // test/expression-fuzz.test.ts already keeps for the grammar.
    const random = seededRandomSource("date-helper-calendar-range");
    const nextInt = (bound: number): number => {
      const bytes = random(4);
      const value =
        ((bytes[0] ?? 0) << 24) |
        ((bytes[1] ?? 0) << 16) |
        ((bytes[2] ?? 0) << 8) |
        (bytes[3] ?? 0);
      return (value >>> 0) % bound;
    };

    for (let iteration = 0; iteration < 2_000; iteration += 1) {
      const helper = HELPERS[nextInt(HELPERS.length)] as string;
      // Offsets that straddle the boundary from far outside it to well inside, both signs.
      const magnitude = [1, 12, 366, 4_000, 400_000, 4_000_000, Number.MAX_SAFE_INTEGER][
        nextInt(7)
      ] as number;
      const offset = nextInt(2) === 0 ? magnitude : -magnitude;
      const outcome = run(`${helper}(custom.filedOn, ${offset})`);
      expect(["value", "refusal"]).toContain(outcome.kind);
      if (outcome.kind !== "value") continue;
      expect(outcome.value.kind).toBe("date");
      if (outcome.value.kind !== "date") continue;
      // The two properties every downstream reader depends on: the formatter's pattern matches, and
      // the raw-string ordering the comparison arm uses is a real ordering on it.
      expect(outcome.value.isoDate).toMatch(CALENDAR_DATE);
      const year = Number(outcome.value.isoDate.slice(0, 4));
      expect(year).toBeGreaterThanOrEqual(1);
      expect(year).toBeLessThanOrEqual(9999);
    }
  });

  it("refuses to order a date-shaped value that is not a calendar date", () => {
    // The residual path: a value that reached the evaluator already carrying a non-calendar isoDate.
    const checked = checkExpression("custom.filedOn > custom.filedOn", {
      scope: SCOPE,
      required: "boolean",
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const outcome = evaluate(checked.value, {
      values: new Map<string, ExpressionValue>([
        ["custom.filedOn", { kind: "date", isoDate: "03/14/2026" }],
      ]),
      budget: createEvaluationBudget(),
    });
    expect(outcome.kind).toBe("refusal");
    if (outcome.kind !== "refusal") return;
    expect(outcome.refusal.code).toBe("invalid-operand");
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
