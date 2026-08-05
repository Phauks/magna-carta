import { allocate as allocateMoney } from "@magna-carta/money/allocate";
import { toMinor } from "@magna-carta/money/format";
import {
  currencyFromCode,
  isRegisteredCurrencyCode,
  money as makeMoney,
  percentOf as scaleMoney,
  ratio,
} from "@magna-carta/money/money";
import { roundLedger } from "@magna-carta/money/rounding";
import { titleCase } from "../format.ts";
import { refusal, type Refusal } from "./errors.ts";
import { splitListFieldPath } from "./lex.ts";
import { EXPRESSION_LIMITS } from "./limits.ts";
import type { ComparisonOperator, ExpressionNode } from "./parse.ts";
import type { CheckedExpression } from "./check.ts";

// A single post-order walk over a CLOSED set of node kinds declared in this file's own source. There is
// no node kind meaning "call something the host has": a call node carries a catalog signature the
// parser resolved, so by the time anything runs here, the only callable things in existence are
// functions written above.
//
// The evaluator is PURE and has no ambient authority — no clock, no randomness, no environment, no
// locale beyond the time zone the merge context carries, no I/O, no database handle. `system.today` is
// a resolved value like any other, which is also what keeps an assembly reproducible.
//
// NOTHING HERE IS A FLOAT. Money is minor units at scale 2, a rate is `rate_e4` at scale 4, and a
// number is an exact (significand, scale) pair. Every intermediate is checked against
// Number.isSafeInteger BEFORE the operation is performed, so the money package's own guard is
// unreachable from here and a breach is a typed refusal naming the operation rather than an exception.
//
// A bug in this evaluator is a wrong number in a document, which is serious. It cannot be a foothold in
// a Worker, which would be catastrophic. The two failure classes are separated by the grammar, not by
// our care.

// ---------------------------------------------------------------------------------------------
// Values and outcomes
// ---------------------------------------------------------------------------------------------

export type ExpressionValue =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "number"; readonly significand: number; readonly scale: number }
  | { readonly kind: "money"; readonly amountMinor: number; readonly currencyCode: string }
  | { readonly kind: "rate"; readonly rateE4: number; readonly currencyCode: string }
  | { readonly kind: "date"; readonly isoDate: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "list"; readonly items: readonly ListItem[] };

// One element of a collection. A record collection carries named fields (a party's display name and
// role); a bare-scalar collection — which is what `allocate` produces, since its parts have no field
// names of their own — carries `scalar`, bound in the loop scope as `loop.value`.
export interface ListItem {
  readonly fields: ReadonlyMap<string, ExpressionValue>;
  readonly scalar?: ExpressionValue;
}

// The three outcomes, deliberately distinguished, because collapsing them is how a silently wrong
// document gets filed. `unresolved` is a property of EVALUATION, not a value the language can name,
// compare against, or construct — there is no null to write and none to propagate into a comparison
// that then quietly answers false.
export type Evaluation =
  | { readonly kind: "value"; readonly value: ExpressionValue }
  | { readonly kind: "unresolved"; readonly name: string }
  | { readonly kind: "refusal"; readonly refusal: Refusal };

function valued(value: ExpressionValue): Evaluation {
  return { kind: "value", value };
}

function unresolved(name: string): Evaluation {
  return { kind: "unresolved", name };
}

function refused(code: Refusal["code"], detail: string): Evaluation {
  return { kind: "refusal", refusal: refusal(code, detail) };
}

// The budget is SHARED across every expression in one document rather than reset per expression, so a
// thousand cheap expressions are bounded as well as one expensive one.
export interface EvaluationBudget {
  steps: number;
  text: number;
  expandedBlocks: number;
}

export function createEvaluationBudget(): EvaluationBudget {
  return { steps: 0, text: 0, expandedBlocks: 0 };
}

export interface EvaluationContext {
  // Every name in scope: the resolved dictionary values plus the enclosing repeating block's frame.
  // A Map, so a template-supplied name is never a JavaScript property key.
  readonly values: ReadonlyMap<string, ExpressionValue>;
  readonly budget: EvaluationBudget;
}

// ---------------------------------------------------------------------------------------------
// Exact arithmetic
// ---------------------------------------------------------------------------------------------

const POWERS_OF_TEN: readonly number[] = [
  1, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000, 1_000_000_000,
];

function powerOfTen(exponent: number): number | undefined {
  return POWERS_OF_TEN[exponent];
}

interface ExactDecimal {
  readonly significand: number;
  readonly scale: number;
}

// Bring two exact decimals to a common scale. Every product is checked BEFORE it is formed, which is
// what makes the money package's own throw unreachable from here.
function align(
  left: ExactDecimal,
  right: ExactDecimal,
): { readonly left: number; readonly right: number; readonly scale: number } | undefined {
  const scale = Math.max(left.scale, right.scale);
  const leftFactor = powerOfTen(scale - left.scale);
  const rightFactor = powerOfTen(scale - right.scale);
  if (leftFactor === undefined || rightFactor === undefined) return undefined;
  const leftValue = left.significand * leftFactor;
  const rightValue = right.significand * rightFactor;
  if (!Number.isSafeInteger(leftValue) || !Number.isSafeInteger(rightValue)) return undefined;
  return { left: leftValue, right: rightValue, scale };
}

// The whole-number value of an exact decimal, or undefined when it has a fractional part. `2.0` is two;
// `2.5` is not a count of anything.
function wholeNumberOf(value: ExactDecimal): number | undefined {
  const factor = powerOfTen(value.scale);
  if (factor === undefined) return undefined;
  if (value.significand % factor !== 0) return undefined;
  return value.significand / factor;
}

// ---------------------------------------------------------------------------------------------
// Calendar dates
// ---------------------------------------------------------------------------------------------

// Days since 1970-01-01, by the standard civil-calendar conversion. Deliberately not `Date`: a Date
// carries a clock and a time zone, and every date in this language is a calendar date already projected
// into the matter's office's zone at the resolution boundary. Arithmetic that could see an hour would
// silently make a filing date depend on the hour a job happened to run.
export function daysFromCivil(year: number, month: number, day: number): number {
  const shifted = month <= 2 ? year - 1 : year;
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

export function civilFromDays(days: number): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
} {
  const shifted = days + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);
  return { year: month <= 2 ? year + 1 : year, month, day };
}

export function daysInMonthOf(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isoDateOf(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseIsoDate(
  isoDate: string,
): { readonly year: number; readonly month: number; readonly day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) return undefined;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

const MONTH_NAMES: readonly string[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// END-OF-MONTH CLAMPS: 31 January plus one month is 28 (or 29) February. Stated in the code because the
// alternative convention exists, and a silent choice between the two is a wrong deadline.
function addCalendarMonths(
  date: { year: number; month: number; day: number },
  months: number,
): { year: number; month: number; day: number } {
  const total = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonthOf(year, month)) };
}

// ---------------------------------------------------------------------------------------------
// Money, through the money package and nowhere else
// ---------------------------------------------------------------------------------------------

// The extra digits a rounded division carries before it collapses to cents. A tie at the cent — a
// quotient of exactly half a cent — is exactly representable one digit in, so it is never manufactured
// by truncation; the sticky adjustment below covers the opposite case, where truncation would create a
// tie the true quotient does not have.
const DIVISION_GUARD_DIGITS = 6;

// Banker's rounding is the SINGLE rounding mode this language exposes, and it is the money package's
// roundLedger rather than a fourth implementation of half-to-even. The package's other two modes
// (half-up for statutory tax, half-away-from-zero for an invoice line) are deliberately absent: a
// template computing statutory tax or an invoice credit is a document reimplementing the billing
// subsystem, which is where those rules belong and where they are tested.
function roundedMinorUnits(
  significand: number,
  scale: number,
  currencyCode: string,
): number | undefined {
  if (!isRegisteredCurrencyCode(currencyCode)) return undefined;
  if (!Number.isSafeInteger(significand)) return undefined;
  const currency = currencyFromCode(currencyCode);
  // money(1) is one minor unit at scale 2, so scaling it by (significand, scale) yields an
  // Intermediate whose value is significand x 10^-(2+scale) — the quotient in cents, at a finer scale.
  const intermediate = scaleMoney(makeMoney(1, currency), ratio(significand, scale));
  return toMinor(roundLedger(intermediate));
}

// ---------------------------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------------------------

function charge(context: EvaluationContext, steps: number): Evaluation | undefined {
  context.budget.steps += steps;
  if (context.budget.steps > EXPRESSION_LIMITS.evaluationSteps) {
    return refused(
      "step-budget",
      `this document's calculations went past the ${EXPRESSION_LIMITS.evaluationSteps} steps one assembly may take.`,
    );
  }
  return undefined;
}

function chargeText(context: EvaluationContext, produced: number): Evaluation | undefined {
  if (produced > EXPRESSION_LIMITS.textResultLength) {
    return refused(
      "text-budget",
      `one calculation may produce at most ${EXPRESSION_LIMITS.textResultLength} characters of text.`,
    );
  }
  context.budget.text += produced;
  if (context.budget.text > EXPRESSION_LIMITS.textPerAssembly) {
    return refused(
      "text-budget",
      "this document's calculations produced more text than one assembly may carry.",
    );
  }
  return undefined;
}

export function evaluate(checked: CheckedExpression, context: EvaluationContext): Evaluation {
  return evaluateNode(checked.node, context);
}

function evaluateNode(node: ExpressionNode, context: EvaluationContext): Evaluation {
  const budget = charge(context, 1);
  if (budget !== undefined) return budget;

  switch (node.kind) {
    case "text":
      return valued({ kind: "text", text: node.value });
    case "number":
      return valued({ kind: "number", significand: node.significand, scale: node.scale });
    case "boolean":
      return valued({ kind: "boolean", value: node.value });
    case "date":
      return valued({ kind: "date", isoDate: node.isoDate });

    case "name": {
      const value = context.values.get(node.name);
      return value === undefined ? unresolved(node.name) : valued(value);
    }

    case "not": {
      const operand = evaluateNode(node.operand, context);
      if (operand.kind !== "value") return operand;
      return operand.value.kind === "boolean"
        ? valued({ kind: "boolean", value: !operand.value.value })
        : refused("invalid-operand", '"not" was given something that is not true or false.');
    }

    // `and` and `or` do NOT short-circuit past an unresolved operand: an unresolved condition means we
    // do not know whether a clause belongs in the document, and a short circuit would turn "we do not
    // know" into an answer. They do short-circuit past a KNOWN one, which is ordinary boolean algebra.
    case "and": {
      const left = evaluateNode(node.left, context);
      if (left.kind === "refusal") return left;
      if (left.kind === "value" && left.value.kind === "boolean" && !left.value.value) {
        return valued({ kind: "boolean", value: false });
      }
      const right = evaluateNode(node.right, context);
      if (right.kind === "refusal") return right;
      if (right.kind === "value" && right.value.kind === "boolean" && !right.value.value) {
        return valued({ kind: "boolean", value: false });
      }
      if (left.kind === "unresolved") return left;
      if (right.kind === "unresolved") return right;
      return valued({ kind: "boolean", value: true });
    }

    case "or": {
      const left = evaluateNode(node.left, context);
      if (left.kind === "refusal") return left;
      if (left.kind === "value" && left.value.kind === "boolean" && left.value.value) {
        return valued({ kind: "boolean", value: true });
      }
      const right = evaluateNode(node.right, context);
      if (right.kind === "refusal") return right;
      if (right.kind === "value" && right.value.kind === "boolean" && right.value.value) {
        return valued({ kind: "boolean", value: true });
      }
      if (left.kind === "unresolved") return left;
      if (right.kind === "unresolved") return right;
      return valued({ kind: "boolean", value: false });
    }

    case "compare": {
      const left = evaluateNode(node.left, context);
      if (left.kind !== "value") return left;
      const right = evaluateNode(node.right, context);
      if (right.kind !== "value") return right;
      return compareValues(node.operator, left.value, right.value);
    }

    case "membership": {
      const subject = evaluateNode(node.subject, context);
      if (subject.kind !== "value") return subject;
      for (const option of node.options) {
        const candidate = evaluateNode(option, context);
        if (candidate.kind !== "value") return candidate;
        const equal = compareValues("==", subject.value, candidate.value);
        if (equal.kind !== "value") return equal;
        if (equal.value.kind === "boolean" && equal.value.value) {
          return valued({ kind: "boolean", value: true });
        }
      }
      return valued({ kind: "boolean", value: false });
    }

    case "add":
    case "subtract": {
      const left = evaluateNode(node.left, context);
      if (left.kind !== "value") return left;
      const right = evaluateNode(node.right, context);
      if (right.kind !== "value") return right;
      return addOrSubtract(node.kind, left.value, right.value);
    }

    case "multiply": {
      const left = evaluateNode(node.left, context);
      if (left.kind !== "value") return left;
      const right = evaluateNode(node.right, context);
      if (right.kind !== "value") return right;
      return multiplyValues(left.value, right.value);
    }

    case "negate": {
      const operand = evaluateNode(node.operand, context);
      if (operand.kind !== "value") return operand;
      const value = operand.value;
      if (value.kind === "number") {
        return valued({ kind: "number", significand: -value.significand, scale: value.scale });
      }
      if (value.kind === "money") {
        return valued({
          kind: "money",
          amountMinor: -value.amountMinor,
          currencyCode: value.currencyCode,
        });
      }
      return refused("invalid-operand", "that kind of value has no negative.");
    }

    case "call":
      return evaluateCall(node, context);
  }
}

// ---------------------------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------------------------

function compareValues(
  operator: ComparisonOperator,
  left: ExpressionValue,
  right: ExpressionValue,
): Evaluation {
  const ordering = orderOf(left, right);
  if (ordering.kind === "refusal") return ordering;
  if (ordering.kind === "incomparable") {
    return refused("invalid-operand", "two values of different kinds were compared.");
  }
  const comparison = ordering.comparison;
  switch (operator) {
    case "==":
      return valued({ kind: "boolean", value: comparison === 0 });
    case "!=":
      return valued({ kind: "boolean", value: comparison !== 0 });
    case "<":
      return valued({ kind: "boolean", value: comparison < 0 });
    case "<=":
      return valued({ kind: "boolean", value: comparison <= 0 });
    case ">":
      return valued({ kind: "boolean", value: comparison > 0 });
    case ">=":
      return valued({ kind: "boolean", value: comparison >= 0 });
  }
}

type Ordering =
  | { readonly kind: "ordered"; readonly comparison: number }
  | { readonly kind: "incomparable" }
  | { readonly kind: "refusal"; readonly refusal: Refusal };

function orderOf(left: ExpressionValue, right: ExpressionValue): Ordering {
  if (left.kind === "text" && right.kind === "text") {
    return {
      kind: "ordered",
      comparison: left.text === right.text ? 0 : left.text < right.text ? -1 : 1,
    };
  }
  if (left.kind === "boolean" && right.kind === "boolean") {
    return { kind: "ordered", comparison: left.value === right.value ? 0 : left.value ? 1 : -1 };
  }
  if (left.kind === "date" && right.kind === "date") {
    return {
      kind: "ordered",
      comparison: left.isoDate === right.isoDate ? 0 : left.isoDate < right.isoDate ? -1 : 1,
    };
  }
  if (left.kind === "number" && right.kind === "number") {
    const aligned = align(left, right);
    if (aligned === undefined) {
      return {
        kind: "refusal",
        refusal: refusal("magnitude", "a number went past the exact range while being compared."),
      };
    }
    return {
      kind: "ordered",
      comparison: aligned.left === aligned.right ? 0 : aligned.left < aligned.right ? -1 : 1,
    };
  }
  if (left.kind === "money" && right.kind === "money") {
    if (left.currencyCode !== right.currencyCode) {
      return {
        kind: "refusal",
        refusal: refusal(
          "currency-mismatch",
          `amounts in ${left.currencyCode} and ${right.currencyCode} were compared. This language does not convert between currencies: a rate of exchange is a fact with a date and a source, and a template inventing one would put an unsourced number into a filed document.`,
        ),
      };
    }
    return {
      kind: "ordered",
      comparison:
        left.amountMinor === right.amountMinor ? 0 : left.amountMinor < right.amountMinor ? -1 : 1,
    };
  }
  if (left.kind === "rate" && right.kind === "rate") {
    if (left.currencyCode !== right.currencyCode) {
      return {
        kind: "refusal",
        refusal: refusal(
          "currency-mismatch",
          `rates in ${left.currencyCode} and ${right.currencyCode} were compared.`,
        ),
      };
    }
    return {
      kind: "ordered",
      comparison: left.rateE4 === right.rateE4 ? 0 : left.rateE4 < right.rateE4 ? -1 : 1,
    };
  }
  return { kind: "incomparable" };
}

function addOrSubtract(
  operation: "add" | "subtract",
  left: ExpressionValue,
  right: ExpressionValue,
): Evaluation {
  const sign = operation === "add" ? 1 : -1;

  if (left.kind === "number" && right.kind === "number") {
    const aligned = align(left, right);
    if (aligned === undefined) {
      return refused("magnitude", `a number went past the exact range while being ${operation}ed.`);
    }
    const total = aligned.left + sign * aligned.right;
    if (!Number.isSafeInteger(total)) {
      return refused(
        "magnitude",
        `the result of that ${operation} is larger than this language holds exactly.`,
      );
    }
    return valued({ kind: "number", significand: total, scale: aligned.scale });
  }

  if (left.kind === "money" && right.kind === "money") {
    if (left.currencyCode !== right.currencyCode) {
      return refused(
        "currency-mismatch",
        `an amount in ${left.currencyCode} met an amount in ${right.currencyCode}. This language does not convert between currencies.`,
      );
    }
    const total = left.amountMinor + sign * right.amountMinor;
    if (!Number.isSafeInteger(total)) {
      return refused("magnitude", "that amount is larger than this language holds exactly.");
    }
    return valued({ kind: "money", amountMinor: total, currencyCode: left.currencyCode });
  }

  return refused("invalid-operand", `those two kinds of value cannot be ${operation}ed together.`);
}

function multiplyValues(left: ExpressionValue, right: ExpressionValue): Evaluation {
  if (left.kind === "number" && right.kind === "number") {
    const scale = left.scale + right.scale;
    if (scale > EXPRESSION_LIMITS.numericScale) {
      return refused(
        "scale",
        `that multiplication needs ${scale} places after the decimal point, and this language holds at most ${EXPRESSION_LIMITS.numericScale}.`,
      );
    }
    const product = left.significand * right.significand;
    if (!Number.isSafeInteger(product)) {
      return refused("magnitude", "that product is larger than this language holds exactly.");
    }
    return valued({ kind: "number", significand: product, scale });
  }

  const moneyValue = left.kind === "money" ? left : right.kind === "money" ? right : undefined;
  const countValue = left.kind === "number" ? left : right.kind === "number" ? right : undefined;
  if (moneyValue !== undefined && countValue !== undefined) {
    const whole = wholeNumberOf(countValue);
    if (whole === undefined) {
      return refused(
        "invalid-operand",
        "an amount of money multiplies only by a whole number. For a rate use applyRate; for a fraction use percentOf.",
      );
    }
    const product = moneyValue.amountMinor * whole;
    if (!Number.isSafeInteger(product)) {
      return refused("magnitude", "that amount is larger than this language holds exactly.");
    }
    return valued({
      kind: "money",
      amountMinor: product,
      currencyCode: moneyValue.currencyCode,
    });
  }

  return refused("invalid-operand", "those two kinds of value cannot be multiplied together.");
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function evaluateCall(
  node: ExpressionNode & { kind: "call" },
  context: EvaluationContext,
): Evaluation {
  const name = node.helper.name;
  const argumentNodes = node.argumentNodes;

  // The three total forms, evaluated before anything else because each one CHANGES how absence flows.
  // Everywhere else `unresolved` propagates; these are the only places it stops.
  if (name === "has") {
    const target = argumentNodes[0];
    if (target === undefined || target.kind !== "name") {
      return refused("invalid-operand", "has was not given the name of a merge field.");
    }
    return valued({ kind: "boolean", value: context.values.has(target.name) });
  }

  // The aggregates, also handled before the generic argument walk: their argument is a NAME naming a
  // field of a collection, and that atom resolves to nothing on its own outside a repeating block.
  if (name === "sum" || name === "minimum" || name === "maximum") {
    return evaluateAggregate(name, argumentNodes[0], context);
  }

  if (name === "default") {
    const primary = evaluateNode(argumentNodes[0] as ExpressionNode, context);
    if (primary.kind !== "unresolved") return primary;
    return evaluateNode(argumentNodes[1] as ExpressionNode, context);
  }

  if (name === "choose") {
    const condition = evaluateNode(argumentNodes[0] as ExpressionNode, context);
    if (condition.kind !== "value") return condition;
    if (condition.value.kind !== "boolean") {
      return refused("invalid-operand", "choose was not given a yes-or-no condition.");
    }
    // The unselected arm is NEVER evaluated, which is what makes choose total: an arm that would refuse
    // or go unresolved costs nothing when it is not the one taken.
    const arm = condition.value.value ? argumentNodes[1] : argumentNodes[2];
    return evaluateNode(arm as ExpressionNode, context);
  }

  const values: ExpressionValue[] = [];
  for (const argument of argumentNodes) {
    const evaluated = evaluateNode(argument, context);
    if (evaluated.kind !== "value") return evaluated;
    values.push(evaluated.value);
  }

  switch (name) {
    case "concat": {
      let text = "";
      for (const value of values) {
        if (value.kind !== "text") {
          return refused("invalid-operand", "concat joins pieces of text.");
        }
        text += value.text;
      }
      const overflow = chargeText(context, text.length);
      return overflow ?? valued({ kind: "text", text });
    }
    case "upper":
    case "lower":
    case "titleCase": {
      const value = values[0];
      if (value?.kind !== "text") return refused("invalid-operand", `${name} works on text.`);
      const text =
        name === "upper"
          ? value.text.toUpperCase()
          : name === "lower"
            ? value.text.toLowerCase()
            : titleCase(value.text);
      const overflow = chargeText(context, text.length);
      return overflow ?? valued({ kind: "text", text });
    }

    case "divideExact":
    case "divideRounded":
    case "allocate":
      return divideOrAllocate(name, values, context);

    case "applyRate": {
      const amount = values[0];
      const rateValue = values[1];
      if (amount?.kind !== "money" || rateValue?.kind !== "rate") {
        return refused("invalid-operand", "applyRate takes an amount of money and a rate.");
      }
      if (amount.currencyCode !== rateValue.currencyCode) {
        return refused(
          "currency-mismatch",
          `an amount in ${amount.currencyCode} met a rate in ${rateValue.currencyCode}.`,
        );
      }
      const product = amount.amountMinor * rateValue.rateE4;
      if (!Number.isSafeInteger(product)) {
        return refused("magnitude", "that amount is larger than this language holds exactly.");
      }
      const minor = roundedMinorUnits(product, 4, amount.currencyCode);
      return minor === undefined
        ? refused(
            "unknown-currency",
            `${amount.currencyCode} is not a currency this platform knows.`,
          )
        : valued({ kind: "money", amountMinor: minor, currencyCode: amount.currencyCode });
    }

    case "percentOf": {
      const amount = values[0];
      const fraction = values[1];
      if (amount?.kind !== "money" || fraction?.kind !== "number") {
        return refused("invalid-operand", "percentOf takes an amount of money and a decimal.");
      }
      const product = amount.amountMinor * fraction.significand;
      if (!Number.isSafeInteger(product)) {
        return refused("magnitude", "that amount is larger than this language holds exactly.");
      }
      const minor = roundedMinorUnits(product, fraction.scale, amount.currencyCode);
      return minor === undefined
        ? refused(
            "unknown-currency",
            `${amount.currencyCode} is not a currency this platform knows.`,
          )
        : valued({ kind: "money", amountMinor: minor, currencyCode: amount.currencyCode });
    }

    case "addDays":
    case "addMonths":
    case "addYears": {
      const date = values[0];
      const count = values[1];
      if (date?.kind !== "date" || count?.kind !== "number") {
        return refused("invalid-operand", `${name} takes a date and a whole number.`);
      }
      const whole = wholeNumberOf(count);
      if (whole === undefined) {
        return refused("invalid-operand", `${name} moves a date by a whole number of units.`);
      }
      const parts = parseIsoDate(date.isoDate);
      if (parts === undefined) return refused("invalid-operand", "that is not a calendar date.");
      if (name === "addDays") {
        const moved = civilFromDays(daysFromCivil(parts.year, parts.month, parts.day) + whole);
        return valued({ kind: "date", isoDate: isoDateOf(moved.year, moved.month, moved.day) });
      }
      const moved = addCalendarMonths(parts, name === "addMonths" ? whole : whole * 12);
      if (!Number.isSafeInteger(moved.year) || moved.year < 1 || moved.year > 9999) {
        return refused("magnitude", "that date falls outside the years this language works in.");
      }
      return valued({ kind: "date", isoDate: isoDateOf(moved.year, moved.month, moved.day) });
    }

    case "daysBetween": {
      const earlier = values[0];
      const later = values[1];
      if (earlier?.kind !== "date" || later?.kind !== "date") {
        return refused("invalid-operand", "daysBetween takes two dates.");
      }
      const from = parseIsoDate(earlier.isoDate);
      const to = parseIsoDate(later.isoDate);
      if (from === undefined || to === undefined) {
        return refused("invalid-operand", "that is not a calendar date.");
      }
      const gap =
        daysFromCivil(to.year, to.month, to.day) - daysFromCivil(from.year, from.month, from.day);
      return valued({ kind: "number", significand: gap, scale: 0 });
    }

    case "year":
    case "month":
    case "day":
    case "monthName": {
      const date = values[0];
      if (date?.kind !== "date") return refused("invalid-operand", `${name} takes a date.`);
      const parts = parseIsoDate(date.isoDate);
      if (parts === undefined) return refused("invalid-operand", "that is not a calendar date.");
      if (name === "monthName") {
        return valued({ kind: "text", text: MONTH_NAMES[parts.month - 1] ?? String(parts.month) });
      }
      const value = name === "year" ? parts.year : name === "month" ? parts.month : parts.day;
      return valued({ kind: "number", significand: value, scale: 0 });
    }

    case "count":
    case "isEmpty": {
      const list = values[0];
      if (list?.kind !== "list") return refused("invalid-operand", `${name} takes a list.`);
      const overflow = charge(context, list.items.length);
      if (overflow !== undefined) return overflow;
      return name === "count"
        ? valued({ kind: "number", significand: list.items.length, scale: 0 })
        : valued({ kind: "boolean", value: list.items.length === 0 });
    }

    default:
      // Unreachable: the parser resolved this name against the catalog, so no other name exists here.
      // Kept as a refusal rather than a throw because nothing in this folder throws.
      return refused("invalid-operand", `${name} is not a calculation this system knows.`);
  }
}

// ONE bounded pass over an already-resolved collection — the same bound a repeating block runs under,
// and the only place a helper's cost grows with the firm's data. The set of values folded is fixed
// before the fold starts: the field path was a literal in the source, the collection came from one
// batched read, the item cap applies unchanged, and every element costs a step against the budget the
// whole document shares. There is no expression under the fold and nothing an author could write to put
// one there.
function evaluateAggregate(
  name: "sum" | "minimum" | "maximum",
  target: ExpressionNode | undefined,
  context: EvaluationContext,
): Evaluation {
  if (target === undefined || target.kind !== "name") {
    return refused("invalid-operand", `${name} was not given the name of a field on a list.`);
  }
  const path = splitListFieldPath(target.name);
  if (path === undefined) {
    return refused("invalid-operand", `${name} was not given the name of a field on a list.`);
  }

  const collection = context.values.get(path.collectionKey);
  if (collection === undefined) return unresolved(path.collectionKey);
  if (collection.kind !== "list") {
    return refused("invalid-operand", `${name} works across the items of a list.`);
  }

  const items = collection.items;
  if (items.length > EXPRESSION_LIMITS.itemsPerRepeat) {
    return refused(
      "repeat-too-large",
      `a calculation may work across at most ${EXPRESSION_LIMITS.itemsPerRepeat} items.`,
    );
  }
  const overflow = charge(context, items.length);
  if (overflow !== undefined) return overflow;

  // AN AGGREGATE OVER AN EMPTY COLLECTION IS AN ABSENCE, not a zero. A smallest of nothing has no answer
  // in any type, and a total of no amounts would have to name a currency — a fact the firm's data
  // carries, never one a template may invent, which is why there is no money literal either. One rule
  // for the whole family: a rule that changed with the element type is one an author could not predict.
  // Absence then flows where absence already flows — a visible placeholder in a computed field, a failed
  // assembly in a condition — and isEmpty asks the question totally when that is what the author means.
  if (items.length === 0) return unresolved(path.collectionKey);

  let accumulator: ExpressionValue | undefined;
  for (const item of items) {
    const value = item.fields.get(path.fieldName);
    // An item carrying nothing for that field leaves the answer unknown. Skipping it would silently
    // understate a total, and a total that is quietly wrong is the failure this whole subsystem exists
    // to prevent.
    if (value === undefined) return unresolved(target.name);
    if (accumulator === undefined) {
      accumulator = value;
      continue;
    }
    if (name === "sum") {
      // Through the same addition the `+` operator uses: same currency rule, same safe-integer check
      // before the operation, same exact-decimal alignment. A second implementation of adding money is
      // a second place for it to be wrong.
      const total = addOrSubtract("add", accumulator, value);
      if (total.kind !== "value") return total;
      accumulator = total.value;
      continue;
    }
    const ordering = orderOf(accumulator, value);
    if (ordering.kind === "refusal") return { kind: "refusal", refusal: ordering.refusal };
    if (ordering.kind === "incomparable") {
      return refused("invalid-operand", `${name} met two items of different kinds.`);
    }
    const takeCandidate = name === "minimum" ? ordering.comparison > 0 : ordering.comparison < 0;
    if (takeCandidate) accumulator = value;
  }

  return accumulator === undefined ? unresolved(path.collectionKey) : valued(accumulator);
}

function divideOrAllocate(
  name: "divideExact" | "divideRounded" | "allocate",
  values: readonly ExpressionValue[],
  context: EvaluationContext,
): Evaluation {
  const amount = values[0];
  const parts = values[1];
  if (amount?.kind !== "money" || parts?.kind !== "number") {
    return refused("invalid-operand", `${name} takes an amount of money and a whole number.`);
  }
  const divisor = wholeNumberOf(parts);
  if (divisor === undefined) {
    return refused("invalid-operand", `${name} divides by a whole number.`);
  }
  if (divisor === 0) {
    return refused("invalid-operand", "nothing can be divided into zero parts.");
  }

  if (name === "divideExact") {
    if (amount.amountMinor % divisor !== 0) {
      return refused(
        "inexact-division",
        "that amount does not divide evenly into that many parts. Use divideRounded to accept the rounding, or allocate for parts that add back up to the whole.",
      );
    }
    return valued({
      kind: "money",
      amountMinor: amount.amountMinor / divisor,
      currencyCode: amount.currencyCode,
    });
  }

  if (name === "divideRounded") {
    const guard = powerOfTen(DIVISION_GUARD_DIGITS);
    if (guard === undefined)
      return refused("magnitude", "that division cannot be worked out exactly.");
    const sign = amount.amountMinor < 0 !== divisor < 0 ? -1 : 1;
    const magnitude = Math.abs(amount.amountMinor);
    const partCount = Math.abs(divisor);
    const scaled = magnitude * guard;
    if (!Number.isSafeInteger(scaled)) {
      return refused("magnitude", "that amount is too large to divide exactly at this precision.");
    }
    let quotient = Math.floor(scaled / partCount);
    const remainder = scaled - quotient * partCount;
    // The sticky adjustment. A true tie at the cent is exactly representable one digit in, so it
    // arrives with no remainder and half-to-even sees it as the tie it is. A quotient that only LOOKS
    // like a tie after truncation is nudged past it, so it rounds up rather than to even — which is
    // what a value strictly greater than half should do.
    const half = 5 * (powerOfTen(DIVISION_GUARD_DIGITS - 1) ?? 0);
    if (remainder !== 0 && quotient % guard === half) quotient += 1;
    const minor = roundedMinorUnits(sign * quotient, DIVISION_GUARD_DIGITS, amount.currencyCode);
    return minor === undefined
      ? refused("unknown-currency", `${amount.currencyCode} is not a currency this platform knows.`)
      : valued({ kind: "money", amountMinor: minor, currencyCode: amount.currencyCode });
  }

  if (divisor < 0) {
    return refused("invalid-operand", "an amount cannot be split into a negative number of parts.");
  }
  if (divisor > EXPRESSION_LIMITS.itemsPerRepeat) {
    return refused(
      "repeat-too-large",
      `an amount may be split into at most ${EXPRESSION_LIMITS.itemsPerRepeat} parts.`,
    );
  }
  if (!isRegisteredCurrencyCode(amount.currencyCode)) {
    return refused(
      "unknown-currency",
      `${amount.currencyCode} is not a currency this platform knows.`,
    );
  }
  const overflow = charge(context, divisor);
  if (overflow !== undefined) return overflow;
  // Largest-remainder, through the money package's own allocate: the parts SUM EXACTLY to the input.
  // That is the only split whose parts reconcile, and it is the reason a list cannot be pulled apart
  // element by element and quietly fail to add up.
  const split = allocateMoney(
    makeMoney(amount.amountMinor, currencyFromCode(amount.currencyCode)),
    Array.from({ length: divisor }, () => 1),
  );
  return valued({
    kind: "list",
    items: split.map((part) => ({
      fields: new Map<string, ExpressionValue>(),
      scalar: {
        kind: "money",
        amountMinor: toMinor(part),
        currencyCode: amount.currencyCode,
      } satisfies ExpressionValue,
    })),
  });
}
