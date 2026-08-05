import { seededRandomSource } from "@magna-carta/identifiers/random";
import { describe, expect, it } from "vitest";
import { expressionScopeFor } from "../src/dictionary.ts";
import { HELPER_CATALOG, type ExpressionType } from "../src/expression/catalog.ts";
import { checkExpression, layerScope, type NameBinding } from "../src/expression/check.ts";
import {
  createEvaluationBudget,
  evaluate,
  type ExpressionValue,
} from "../src/expression/evaluate.ts";
import { EXPRESSION_LIMITS } from "../src/expression/limits.ts";
import { nodesEqual, parse, prettyPrint } from "../src/expression/parse.ts";

// The security claim is a claim about ALL inputs, so it needs a test method that GENERATES inputs
// rather than enumerating them.
//
// Both generators are seeded through the platform's own deterministic random source, so a failure in
// CI reproduces from its seed rather than from a screenshot. The generator is in-house because the
// repository has no property-testing library and adding one for a single consumer is a dependency
// decision rather than a test decision.

const SYNTHETIC: readonly (readonly [string, ExpressionType])[] = [
  ["custom.amount", "money"],
  ["custom.otherAmount", "money"],
  ["custom.rate", "rate"],
  ["custom.count", "number"],
  ["custom.when", "date"],
  ["custom.note", "text"],
  ["custom.flag", "boolean"],
];

// A collection whose items carry one field of every aggregable kind plus one that is not, so a generated
// aggregate lands on a legal element type about as often as on an illegal one.
const COLLECTION_FIELDS: ReadonlyMap<string, ExpressionType> = new Map<string, ExpressionType>([
  ["amount", "money"],
  ["hours", "number"],
  ["incurredOn", "date"],
  ["describedAs", "text"],
]);

const FIELD_PATHS: readonly string[] = [
  "custom.entries.amount",
  "custom.entries.hours",
  "custom.entries.incurredOn",
  // Paths that do NOT resolve, so the aggregate's own resolution is exercised as hard as everything else.
  "custom.entries.describedAs",
  "custom.entries.missing",
  "custom.nothing.amount",
  "matter.number.amount",
  "matter.parties.role",
];

const SYNTHETIC_FRAME = new Map<string, NameBinding>(
  SYNTHETIC.map(([name, type]) => [name, { type, origin: "dictionary" as const }]),
);
SYNTHETIC_FRAME.set("custom.entries", {
  type: "list",
  origin: "dictionary",
  itemFields: COLLECTION_FIELDS,
});

const SCOPE = layerScope(expressionScopeFor(), SYNTHETIC_FRAME);

// Half the names resolve and half do not, so the generated corpus exercises the unresolved path as
// heavily as the resolved one.
const VALUES: ReadonlyMap<string, ExpressionValue> = new Map<string, ExpressionValue>([
  ["custom.amount", { kind: "money", amountMinor: 123_456, currencyCode: "USD" }],
  ["custom.otherAmount", { kind: "money", amountMinor: -700, currencyCode: "EUR" }],
  ["custom.rate", { kind: "rate", rateE4: 1_250, currencyCode: "USD" }],
  ["custom.count", { kind: "number", significand: 375, scale: 2 }],
  ["custom.when", { kind: "date", isoDate: "2026-08-04" }],
  ["matter.number", { kind: "text", text: "2026-0042" }],
  ["matter.eBilling", { kind: "boolean", value: false }],
  ["matter.parties", { kind: "list", items: [{ fields: new Map() }] }],
  [
    "custom.entries",
    {
      kind: "list",
      items: [
        {
          fields: new Map<string, ExpressionValue>([
            ["amount", { kind: "money", amountMinor: 4_200, currencyCode: "USD" }],
            ["hours", { kind: "number", significand: 15, scale: 1 }],
            ["incurredOn", { kind: "date", isoDate: "2026-02-14" }],
          ]),
        },
        {
          fields: new Map<string, ExpressionValue>([
            ["amount", { kind: "money", amountMinor: -175, currencyCode: "USD" }],
            ["hours", { kind: "number", significand: 3, scale: 0 }],
            ["incurredOn", { kind: "date", isoDate: "2026-11-30" }],
          ]),
        },
      ],
    },
  ],
]);

// ---------------------------------------------------------------------------------------------
// A structure-aware generator over the grammar
// ---------------------------------------------------------------------------------------------

class Generator {
  private readonly random: (bytes: number) => Uint8Array;

  constructor(seed: string) {
    this.random = seededRandomSource(seed);
  }

  next(bound: number): number {
    const bytes = this.random(4);
    const value =
      ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
    return (value >>> 0) % bound;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.next(items.length)] as T;
  }

  expression(depth: number): string {
    if (depth <= 0) return this.primary();
    switch (this.next(8)) {
      case 0:
        return `(${this.expression(depth - 1)} and ${this.expression(depth - 1)})`;
      case 1:
        return `(${this.expression(depth - 1)} or ${this.expression(depth - 1)})`;
      case 2:
        return `not ${this.expression(depth - 1)}`;
      case 3:
        return `(${this.expression(depth - 1)} ${this.pick(["==", "!=", "<", "<=", ">", ">="])} ${this.expression(depth - 1)})`;
      case 4:
        return `(${this.expression(depth - 1)} ${this.pick(["+", "-", "*"])} ${this.expression(depth - 1)})`;
      case 5:
        return `-${this.primary()}`;
      case 6:
        return this.call(depth - 1);
      default:
        return `(${this.expression(depth - 1)} in (${this.literal()}, ${this.literal()}))`;
    }
  }

  private call(depth: number): string {
    const helper = this.pick(HELPER_CATALOG);
    const count = helper.variadic === undefined ? helper.parameters.length : 1 + this.next(3);
    const args = Array.from({ length: count }, (_unused, index) => {
      const specification = helper.parameters[index];
      if (specification === "mergeKey") return this.name();
      // An aggregate's argument is a NAME naming a field of a collection, never an expression — so the
      // generator writes one, and half of what it writes does not resolve.
      if (specification === "listField") return this.pick(FIELD_PATHS);
      return this.expression(depth);
    });
    return `${helper.name}(${args.join(", ")})`;
  }

  private primary(): string {
    return this.next(2) === 0 ? this.name() : this.literal();
  }

  private name(): string {
    return this.pick([
      ...SYNTHETIC.map(([name]) => name),
      "matter.number",
      "matter.status",
      "matter.eBilling",
      "system.today",
      "matter.parties",
      // Names that do NOT resolve, so name resolution is exercised as hard as everything else.
      "matter.nothing",
      "custom.missing",
      "loop.index",
      // A collection's field path means nothing on its own outside a repeating block, which is a name
      // resolution the generator should keep hitting.
      "custom.entries.amount",
    ]);
  }

  private literal(): string {
    switch (this.next(6)) {
      case 0:
        return String(this.next(10_000));
      case 1:
        return `${this.next(100)}.${String(this.next(1_000)).padStart(3, "0")}`;
      case 2:
        return `"${"text".repeat(1 + this.next(3))}"`;
      case 3:
        return this.next(2) === 0 ? "true" : "false";
      case 4:
        return `date "2026-0${1 + this.next(9)}-1${this.next(9)}"`;
      default:
        return `-${this.next(1_000)}`;
    }
  }
}

describe("structure-aware fuzzing over the grammar", () => {
  it("parses, checks, and evaluates every generated expression WITHOUT throwing, always terminating", () => {
    const generator = new Generator("expression-structure-aware");
    // The budget is shared across the whole sweep, exactly as it is across one document's expressions,
    // so an expression that exhausts it refuses rather than running on.
    for (let trial = 0; trial < 1_500; trial += 1) {
      const source = generator.expression(1 + (trial % 4));
      for (const required of ["boolean", "list", "formattableScalar"] as const) {
        const checked = checkExpression(source, { scope: SCOPE, required });
        // Every outcome is TAGGED and, when it fails, LOCATED.
        if (!checked.ok) {
          expect(checked.failure.code, source).toMatch(/^expression-/);
          expect(Number.isInteger(checked.failure.offset), source).toBe(true);
          continue;
        }
        const budget = createEvaluationBudget();
        const outcome = evaluate(checked.value, { values: VALUES, budget });
        expect(["value", "unresolved", "refusal"], source).toContain(outcome.kind);
        expect(budget.steps, source).toBeLessThanOrEqual(EXPRESSION_LIMITS.evaluationSteps);
        // A CHECKED expression's result type always matches the type its evaluation produced. A
        // mismatch here is the checker and the evaluator disagreeing, which is how a wrong value
        // reaches a document without anything looking broken.
        if (outcome.kind === "value") {
          expect(outcome.value.kind, source).toBe(checked.value.resultType);
        }
      }
    }
  });

  it("pretty-prints and re-parses every generated expression to an IDENTICAL tree", () => {
    // The standard detector for parser-ambiguity and precedence bugs: a precedence mistake shows up as
    // a tree that differs, rather than as a document with the wrong clause in it.
    const generator = new Generator("expression-round-trip");
    for (let trial = 0; trial < 1_500; trial += 1) {
      const source = generator.expression(1 + (trial % 4));
      const first = parse(source);
      if (!first.ok) continue;
      const printed = prettyPrint(first.value.node);
      const second = parse(printed);
      expect(second.ok, `${source} -> ${printed}`).toBe(true);
      if (!second.ok) continue;
      expect(nodesEqual(first.value.node, second.value.node), `${source} -> ${printed}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Byte-level fuzzing of the lexer and parser
// ---------------------------------------------------------------------------------------------

const ALPHABET = [
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,()\"\\'`{}[]<>=!+-*/%^&|~?:;# \t\n",
  " ",
  "ÿ",
  "中",
  "😀",
  "\ud800", // a lone surrogate: not valid text, and still not allowed to throw
  "&lt;",
  "&amp;",
  "‮", // a right-to-left override, the classic homograph trick
];

describe("byte-level fuzzing of the lexer and parser", () => {
  it("always returns a typed, located failure or a tree — never a throw, never a hang", () => {
    const generator = new Generator("expression-bytes");
    for (let trial = 0; trial < 4_000; trial += 1) {
      const length = generator.next(80);
      let source = "";
      for (let index = 0; index < length; index += 1) source += generator.pick(ALPHABET);
      const parsed = parse(source);
      if (parsed.ok) {
        expect(parsed.value.depth, JSON.stringify(source)).toBeLessThanOrEqual(
          EXPRESSION_LIMITS.treeDepth,
        );
        expect(parsed.value.callNodes, JSON.stringify(source)).toBeLessThanOrEqual(
          EXPRESSION_LIMITS.callNodes,
        );
        continue;
      }
      expect(parsed.failure.code, JSON.stringify(source)).toMatch(/^expression-/);
      expect(parsed.failure.offset, JSON.stringify(source)).toBeGreaterThanOrEqual(0);
      expect(parsed.failure.detail.length, JSON.stringify(source)).toBeGreaterThan(0);
    }
  });

  it("refuses deeply nested parentheses at the depth bound rather than blowing the stack", () => {
    for (const depth of [EXPRESSION_LIMITS.treeDepth, 200, 5_000]) {
      const source = `${"(".repeat(depth)}1${")".repeat(depth)}`;
      const parsed = parse(source);
      if (parsed.ok) {
        expect(parsed.value.depth).toBeLessThanOrEqual(EXPRESSION_LIMITS.treeDepth);
        continue;
      }
      expect(parsed.failure.code).toMatch(/^expression-/);
    }
  });

  it("refuses a megabyte of input at the source-length bound, without reading it", () => {
    const parsed = parse("(".repeat(1_000_000));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.failure.code).toBe("expression-too-complex");
  });
});
