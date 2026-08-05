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
  type ListItem,
} from "../src/expression/evaluate.ts";
import { lex } from "../src/expression/lex.ts";
import { EXPRESSION_LIMITS } from "../src/expression/limits.ts";

// The aggregates, which are the ONE place a helper's cost grows with the firm's data — so the whole
// suite is about the shape of that bound and about what an empty collection means.
//
// Every way an aggregate can be wrong about TYPES is caught at REGISTRATION, with a character offset,
// while a human is still looking at the template. Everything caught at assembly time is about the data
// itself: an amount in another currency, an item carrying nothing, a collection larger than one block
// may expand.

const ITEM_FIELDS: ReadonlyMap<string, ExpressionType> = new Map<string, ExpressionType>([
  ["amount", "money"],
  ["hours", "number"],
  ["incurredOn", "date"],
  ["describedAs", "text"],
  ["reimbursable", "boolean"],
]);

function listBinding(): NameBinding {
  return { type: "list", origin: "dictionary", itemFields: ITEM_FIELDS };
}

const SCOPE = layerScope(
  expressionScopeFor(),
  new Map<string, NameBinding>([
    ["custom.disbursements", listBinding()],
    ["custom.empty", listBinding()],
    ["custom.partial", listBinding()],
    ["custom.foreign", listBinding()],
    ["custom.enormous", listBinding()],
    ["custom.absentCollection", listBinding()],
    ["custom.amount", { type: "money", origin: "dictionary" }],
  ]),
);

interface ItemSpecification {
  readonly amountMinor?: number;
  readonly currencyCode?: string;
  readonly hours?: readonly [significand: number, scale: number];
  readonly incurredOn?: string;
  readonly describedAs?: string;
}

function item(specification: ItemSpecification): ListItem {
  const fields = new Map<string, ExpressionValue>();
  if (specification.amountMinor !== undefined) {
    fields.set("amount", {
      kind: "money",
      amountMinor: specification.amountMinor,
      currencyCode: specification.currencyCode ?? "USD",
    });
  }
  if (specification.hours !== undefined) {
    fields.set("hours", {
      kind: "number",
      significand: specification.hours[0],
      scale: specification.hours[1],
    });
  }
  if (specification.incurredOn !== undefined) {
    fields.set("incurredOn", { kind: "date", isoDate: specification.incurredOn });
  }
  if (specification.describedAs !== undefined) {
    fields.set("describedAs", { kind: "text", text: specification.describedAs });
  }
  return { fields };
}

function list(items: readonly ListItem[]): ExpressionValue {
  return { kind: "list", items };
}

const DISBURSEMENTS: readonly ListItem[] = [
  item({ amountMinor: 12_550, hours: [25, 1], incurredOn: "2026-03-04" }),
  item({ amountMinor: 7_499, hours: [1_075, 2], incurredOn: "2026-01-31" }),
  item({ amountMinor: -2_000, hours: [40, 0], incurredOn: "2026-08-04" }),
];

const VALUES: ReadonlyMap<string, ExpressionValue> = new Map<string, ExpressionValue>([
  ["custom.disbursements", list(DISBURSEMENTS)],
  ["custom.empty", list([])],
  [
    "custom.partial",
    list([item({ amountMinor: 1_000 }), item({ describedAs: "courier, no amount recorded" })]),
  ],
  [
    "custom.foreign",
    list([
      item({ amountMinor: 1_000, currencyCode: "USD" }),
      item({ amountMinor: 1_000, currencyCode: "EUR" }),
    ]),
  ],
  [
    "custom.enormous",
    list(
      Array.from({ length: EXPRESSION_LIMITS.itemsPerRepeat + 1 }, () => item({ amountMinor: 1 })),
    ),
  ],
  ["custom.amount", { kind: "money", amountMinor: 10_000, currencyCode: "USD" }],
]);

function check(source: string, required: "boolean" | "formattableScalar" = "formattableScalar") {
  return checkExpression(source, { scope: SCOPE, required });
}

function run(source: string, budget: EvaluationBudget = createEvaluationBudget()): Evaluation {
  const checked = check(source);
  if (!checked.ok) throw new Error(`${source} did not check: ${checked.failure.detail}`);
  return evaluate(checked.value, { values: VALUES, budget });
}

function valueOf(source: string): ExpressionValue {
  const outcome = run(source);
  if (outcome.kind !== "value") {
    throw new Error(`${source} produced ${outcome.kind}`);
  }
  return outcome.value;
}

// ---------------------------------------------------------------------------------------------
// The two atom kinds, side by side
// ---------------------------------------------------------------------------------------------

// A firm's own field is an atom whose alphabet includes the hyphen, matched stickily by exact length
// ahead of the general word scan; an aggregate's field path is an atom of three dotted segments matched
// by the general scan. Both are names, and the collection field path is the one that arrives with a dot
// the custom key would have to give up. The pair is tested together because the ordering between them is
// the kind of thing that works until someone reorders two branches.
const HYPHENATED_CUSTOM_KEY = "custom.customField_a-b_cDeFgHiJkLmNoPqRs";

describe("a field path and a firm's own field are different atoms and neither eats the other", () => {
  it("lexes both as ONE name each in the same expression", () => {
    const tokens = lex(`sum(matter.parties.role) > ${HYPHENATED_CUSTOM_KEY}`);
    expect(tokens.ok).toBe(true);
    if (!tokens.ok) return;
    expect(tokens.value.map((token) => token.text)).toEqual([
      "sum",
      "(",
      "matter.parties.role",
      ")",
      ">",
      HYPHENATED_CUSTOM_KEY,
      "",
    ]);
    expect(tokens.value[2]?.kind).toBe("name");
    expect(tokens.value[5]?.kind).toBe("name");
  });

  it("still reads a subtraction beside a field path, hyphen alphabet and all", () => {
    const tokens = lex(`${HYPHENATED_CUSTOM_KEY} - sum(matter.parties.role)`);
    expect(tokens.ok).toBe(true);
    if (!tokens.ok) return;
    expect(tokens.value.map((token) => token.text)).toEqual([
      HYPHENATED_CUSTOM_KEY,
      "-",
      "sum",
      "(",
      "matter.parties.role",
      ")",
      "",
    ]);
  });

  it("does not read a firm's own field as a collection, because it never is one", () => {
    // A firm's field holds one value per matter. The atom carries one dot, so the prefix a field path
    // would need has none, and the refusal says what the author has to change rather than pretending the
    // key might have been a collection.
    const checked = check(`sum(${HYPHENATED_CUSTOM_KEY})`);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.failure.code).toBe("expression-unknown-key");
    expect(checked.failure.detail).toContain("matter.parties.role");
  });

  it("stops a firm's own field at its declared length rather than swallowing a dotted suffix", () => {
    // The custom-key atom is matched by EXACT length, so a dotted suffix after it is a lone dot — a
    // located syntax error, not a longer name nobody wrote and not a silent mis-parse.
    const tokens = lex(`sum(${HYPHENATED_CUSTOM_KEY}.amount)`);
    expect(tokens.ok).toBe(false);
    if (tokens.ok) return;
    expect(tokens.failure.code).toBe("expression-syntax-error");
    expect(tokens.failure.offset).toBe(`sum(${HYPHENATED_CUSTOM_KEY}`.length);
  });
});

// ---------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------

describe("an aggregate is typed at registration, against the collection it names", () => {
  it("takes the element type of the field it names, so a total of money is money", () => {
    const checked = check("sum(custom.disbursements.amount)");
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value.resultType).toBe("money");
  });

  it("preserves the element type through minimum and maximum, dates included", () => {
    for (const [source, type] of [
      ["minimum(custom.disbursements.amount)", "money"],
      ["maximum(custom.disbursements.amount)", "money"],
      ["minimum(custom.disbursements.hours)", "number"],
      ["maximum(custom.disbursements.incurredOn)", "date"],
    ] as const) {
      const checked = check(source);
      expect(checked.ok, source).toBe(true);
      if (!checked.ok) continue;
      expect(checked.value.resultType, source).toBe(type);
    }
  });

  it("records the COLLECTION as the key it reads, never the field path", () => {
    // The collection is one batched read for the whole of it; the field costs no read of its own. If
    // the path landed in the manifest instead, the read plan would name something nothing resolves.
    const checked = check("sum(custom.disbursements.amount)");
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value.keys).toEqual(["custom.disbursements"]);
  });

  it("refuses a total of text or of a yes-or-no, naming what the field actually is", () => {
    for (const source of [
      "sum(custom.disbursements.describedAs)",
      "sum(custom.disbursements.reimbursable)",
      "minimum(custom.disbursements.describedAs)",
      "maximum(custom.disbursements.reimbursable)",
    ]) {
      const checked = check(source);
      expect(checked.ok, source).toBe(false);
      if (checked.ok) continue;
      expect(checked.failure.code, source).toBe("expression-type-error");
      expect(checked.failure.detail.length, source).toBeGreaterThan(0);
    }
  });

  it("refuses a date total, because dates do not add up", () => {
    const checked = check("sum(custom.disbursements.incurredOn)");
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.failure.code).toBe("expression-type-error");
  });

  it("names an unknown collection and an unknown item field separately", () => {
    const unknownCollection = check("sum(custom.nothing.amount)");
    expect(unknownCollection.ok).toBe(false);
    if (!unknownCollection.ok) {
      expect(unknownCollection.failure.code).toBe("expression-unknown-key");
      expect(unknownCollection.failure.detail).toContain("custom.nothing");
    }

    const unknownField = check("sum(custom.disbursements.nothing)");
    expect(unknownField.ok).toBe(false);
    if (!unknownField.ok) {
      expect(unknownField.failure.code).toBe("expression-unknown-key");
      expect(unknownField.failure.detail).toContain("nothing");
    }
  });

  it("refuses a field path whose collection is not a list", () => {
    const checked = check("sum(matter.number.amount)");
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.failure.code).toBe("expression-type-error");
    expect(checked.failure.detail).toContain("matter.number");
  });

  it("refuses the collection itself, which is not a field path", () => {
    const checked = check("sum(matter.parties)");
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.failure.code).toBe("expression-unknown-key");
  });

  it("refuses a CALCULATION where the field path belongs, which is the iteration line", () => {
    // Admitting an expression here would make the aggregate a fold over computed values — iteration an
    // author writes, rather than one bounded pass over data the firm already has.
    for (const source of [
      "sum(custom.amount + custom.amount)",
      "sum(default(custom.amount, custom.amount))",
      'sum("custom.disbursements.amount")',
      "sum(1)",
    ]) {
      const checked = check(source);
      expect(checked.ok, source).toBe(false);
    }
  });

  it("refuses an aggregate as a whole condition, because an amount is not a yes or no", () => {
    const checked = check("sum(custom.disbursements.amount)", "boolean");
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.failure.code).toBe("expression-type-error");
  });

  it("composes into the rest of the language once its type is known", () => {
    const condition = check("sum(custom.disbursements.amount) > custom.amount", "boolean");
    expect(condition.ok).toBe(true);

    const arithmetic = check("sum(custom.disbursements.amount) - custom.amount");
    expect(arithmetic.ok).toBe(true);
    if (!arithmetic.ok) return;
    expect(arithmetic.value.resultType).toBe("money");

    // And a currency still cannot be crossed, even through an aggregate.
    const nonsense = check("sum(custom.disbursements.amount) + sum(custom.disbursements.hours)");
    expect(nonsense.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------

describe("an aggregate is one bounded pass over an already-resolved collection", () => {
  it("totals money in integer minor units, exactly", () => {
    expect(valueOf("sum(custom.disbursements.amount)")).toEqual({
      kind: "money",
      amountMinor: 12_550 + 7_499 - 2_000,
      currencyCode: "USD",
    });
  });

  it("totals numbers at the aligned scale, exactly", () => {
    // 2.5 + 10.75 + 40 = 53.25, held as (5325, 2) rather than as a float that would land at 53.249999.
    expect(valueOf("sum(custom.disbursements.hours)")).toEqual({
      kind: "number",
      significand: 5_325,
      scale: 2,
    });
  });

  it("takes the smallest and largest, and the earliest and latest", () => {
    expect(valueOf("minimum(custom.disbursements.amount)")).toEqual({
      kind: "money",
      amountMinor: -2_000,
      currencyCode: "USD",
    });
    expect(valueOf("maximum(custom.disbursements.amount)")).toEqual({
      kind: "money",
      amountMinor: 12_550,
      currencyCode: "USD",
    });
    expect(valueOf("minimum(custom.disbursements.incurredOn)")).toEqual({
      kind: "date",
      isoDate: "2026-01-31",
    });
    expect(valueOf("maximum(custom.disbursements.incurredOn)")).toEqual({
      kind: "date",
      isoDate: "2026-08-04",
    });
  });

  it("answers a one-item collection with that item", () => {
    const values = new Map(VALUES);
    values.set("custom.disbursements", list([item({ amountMinor: 4_242, hours: [7, 0] })]));
    for (const source of [
      "sum(custom.disbursements.amount)",
      "minimum(custom.disbursements.amount)",
      "maximum(custom.disbursements.amount)",
    ]) {
      const checked = check(source);
      expect(checked.ok, source).toBe(true);
      if (!checked.ok) continue;
      const outcome = evaluate(checked.value, { values, budget: createEvaluationBudget() });
      expect(outcome, source).toEqual({
        kind: "value",
        value: { kind: "money", amountMinor: 4_242, currencyCode: "USD" },
      });
    }
  });

  it("leaves an EMPTY collection unknown rather than answering zero, for all three", () => {
    // A smallest of nothing has no answer in any type, and a total of no amounts would have to name a
    // currency — a fact the firm's data carries, never one a template invents. One rule for the family:
    // a rule that changed with the element type is one an author could not predict. isEmpty asks the
    // question totally when that is what the author means.
    for (const source of [
      "sum(custom.empty.amount)",
      "sum(custom.empty.hours)",
      "minimum(custom.empty.amount)",
      "maximum(custom.empty.incurredOn)",
    ]) {
      const outcome = run(source);
      expect(outcome.kind, source).toBe("unresolved");
      if (outcome.kind !== "unresolved") continue;
      expect(outcome.name, source).toBe("custom.empty");
    }
  });

  it("offers a total answer for the empty case through isEmpty, which is the escape", () => {
    const checked = checkExpression("isEmpty(custom.empty)", { scope: SCOPE, required: "boolean" });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(evaluate(checked.value, { values: VALUES, budget: createEvaluationBudget() })).toEqual({
      kind: "value",
      value: { kind: "boolean", value: true },
    });
  });

  it("leaves the answer unknown when ONE item carries nothing for the field", () => {
    // Skipping the item would silently understate the total, and a total that is quietly wrong is the
    // failure this whole subsystem exists to prevent.
    for (const source of [
      "sum(custom.partial.amount)",
      "minimum(custom.partial.amount)",
      "maximum(custom.partial.amount)",
    ]) {
      const outcome = run(source);
      expect(outcome.kind, source).toBe("unresolved");
      if (outcome.kind !== "unresolved") continue;
      expect(outcome.name, source).toBe("custom.partial.amount");
    }
  });

  it("leaves the answer unknown when the collection itself never resolved", () => {
    const outcome = run("sum(custom.absentCollection.amount)");
    expect(outcome.kind).toBe("unresolved");
    if (outcome.kind !== "unresolved") return;
    expect(outcome.name).toBe("custom.absentCollection");
  });

  it("REFUSES a collection holding two currencies rather than inventing a rate", () => {
    for (const source of [
      "sum(custom.foreign.amount)",
      "minimum(custom.foreign.amount)",
      "maximum(custom.foreign.amount)",
    ]) {
      const outcome = run(source);
      expect(outcome.kind, source).toBe("refusal");
      if (outcome.kind !== "refusal") continue;
      expect(outcome.refusal.code, source).toBe("currency-mismatch");
    }
  });

  it("refuses a total that leaves the exact-integer range, checked BEFORE the addition", () => {
    const values = new Map(VALUES);
    values.set(
      "custom.disbursements",
      list([
        item({ amountMinor: Number.MAX_SAFE_INTEGER }),
        item({ amountMinor: Number.MAX_SAFE_INTEGER }),
      ]),
    );
    const checked = check("sum(custom.disbursements.amount)");
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const outcome = evaluate(checked.value, { values, budget: createEvaluationBudget() });
    expect(outcome.kind).toBe("refusal");
    if (outcome.kind !== "refusal") return;
    expect(outcome.refusal.code).toBe("magnitude");
  });

  it("refuses a collection larger than a repeating block may walk — the SAME bound", () => {
    // An aggregate is bounded by exactly what {{#each}} is bounded by, which is the argument that it
    // costs the firm's data rather than the expression.
    const outcome = run("sum(custom.enormous.amount)");
    expect(outcome.kind).toBe("refusal");
    if (outcome.kind !== "refusal") return;
    expect(outcome.refusal.code).toBe("repeat-too-large");
  });

  it("charges a step per element against the budget the whole document shares", () => {
    const budget = createEvaluationBudget();
    run("sum(custom.disbursements.amount)", budget);
    expect(budget.steps).toBeGreaterThanOrEqual(DISBURSEMENTS.length);
    expect(budget.steps).toBeLessThanOrEqual(EXPRESSION_LIMITS.evaluationSteps);
  });

  it("exhausts the step budget with a refusal rather than running on", () => {
    const values = new Map(VALUES);
    values.set(
      "custom.disbursements",
      list(
        Array.from({ length: EXPRESSION_LIMITS.itemsPerRepeat }, () => item({ amountMinor: 1 })),
      ),
    );
    const checked = check("sum(custom.disbursements.amount)");
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const budget = createEvaluationBudget();
    budget.steps = EXPRESSION_LIMITS.evaluationSteps - 1;
    const outcome = evaluate(checked.value, { values, budget });
    expect(outcome.kind).toBe("refusal");
    if (outcome.kind !== "refusal") return;
    expect(outcome.refusal.code).toBe("step-budget");
  });
});

// ---------------------------------------------------------------------------------------------
// The property sweep, against an independent BigInt reference
// ---------------------------------------------------------------------------------------------

describe("aggregates against an independent exact reference (property)", () => {
  it("totals and extremes match a BigInt oracle over generated collections", () => {
    // The evaluator folds in numbers with a declared scale; the oracle folds the same values in BigInt,
    // which is a different implementation of the same arithmetic — so the two agreeing is evidence
    // rather than a tautology. Seeded, so a CI failure reproduces from its seed.
    const random = seededRandomSource("expression-aggregates");
    const next = (bound: number): number => {
      const bytes = random(4);
      const value =
        ((bytes[0] ?? 0) << 24) |
        ((bytes[1] ?? 0) << 16) |
        ((bytes[2] ?? 0) << 8) |
        (bytes[3] ?? 0);
      return (value >>> 0) % bound;
    };

    for (let trial = 0; trial < 400; trial += 1) {
      // Zero-length collections are generated too: the empty case is a property, not an edge note.
      const length = next(9);
      const amounts = Array.from({ length }, () => next(2_000_000) - 1_000_000);
      const values = new Map(VALUES);
      values.set("custom.disbursements", list(amounts.map((amountMinor) => item({ amountMinor }))));

      const asBigInt = amounts.map((amount) => BigInt(amount));
      const expectedTotal = asBigInt.reduce((total, amount) => total + amount, 0n);
      const expectedSmallest = asBigInt.reduce(
        (smallest, amount) => (amount < smallest ? amount : smallest),
        asBigInt[0] ?? 0n,
      );
      const expectedLargest = asBigInt.reduce(
        (largest, amount) => (amount > largest ? amount : largest),
        asBigInt[0] ?? 0n,
      );

      for (const [source, expected] of [
        ["sum(custom.disbursements.amount)", expectedTotal],
        ["minimum(custom.disbursements.amount)", expectedSmallest],
        ["maximum(custom.disbursements.amount)", expectedLargest],
      ] as const) {
        const checked = check(source);
        expect(checked.ok, source).toBe(true);
        if (!checked.ok) continue;
        const outcome = evaluate(checked.value, { values, budget: createEvaluationBudget() });
        if (length === 0) {
          expect(outcome.kind, `${source} over an empty collection`).toBe("unresolved");
          continue;
        }
        expect(outcome.kind, `${source} over ${amounts.join(",")}`).toBe("value");
        if (outcome.kind !== "value" || outcome.value.kind !== "money") continue;
        // A checked expression's result type always matches what its evaluation produced.
        expect(outcome.value.kind, source).toBe(checked.value.resultType);
        expect(BigInt(outcome.value.amountMinor), `${source} over ${amounts.join(",")}`).toBe(
          expected,
        );
      }
    }
  });
});
