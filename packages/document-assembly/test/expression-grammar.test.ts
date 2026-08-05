import { describe, expect, it } from "vitest";
import { expressionScopeFor } from "../src/dictionary.ts";
import { helperNames, type ExpressionType } from "../src/expression/catalog.ts";
import { checkExpression, layerScope, loopFrame } from "../src/expression/check.ts";
import { lex } from "../src/expression/lex.ts";
import { EXPRESSION_LIMITS } from "../src/expression/limits.ts";
import { nodesEqual, parse, prettyPrint } from "../src/expression/parse.ts";
import { legalFormatsFor } from "../src/format.ts";
import type { MergeValueType } from "../src/types.ts";

// The grammar, proven as a LANGUAGE before it ever meets a document. Input a string, output a checked
// tree or a located failure — no dictionary values, no OOXML package, no evaluation.

const SCOPE = expressionScopeFor();
const legalFormats = (type: ExpressionType): readonly string[] =>
  legalFormatsFor(type as MergeValueType);

function condition(source: string) {
  return checkExpression(source, { scope: SCOPE, required: "boolean" });
}

function computed(source: string, format: string | null = null) {
  return checkExpression(source, {
    scope: SCOPE,
    required: "formattableScalar",
    format,
    legalFormats,
  });
}

describe("lexing", () => {
  it("reads a merge key as ONE atom, dots and all", () => {
    const tokens = lex("matter.number");
    expect(tokens.ok).toBe(true);
    if (!tokens.ok) return;
    expect(tokens.value.map((token) => token.kind)).toEqual(["name", "end"]);
    expect(tokens.value[0]?.text).toBe("matter.number");
  });

  it("holds a decimal as an exact significand and scale, never a float", () => {
    const tokens = lex("0.075");
    expect(tokens.ok).toBe(true);
    if (!tokens.ok) return;
    expect(tokens.value[0]).toMatchObject({ kind: "decimal", significand: 75, scale: 3 });
  });

  it("names the three helpers when it meets a division sign", () => {
    const result = lex("a.b / 2");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.detail).toContain("divideExact");
    expect(result.failure.detail).toContain("divideRounded");
    expect(result.failure.detail).toContain("allocate");
  });

  it("tells an author that boolean operators are words", () => {
    const ampersands = lex("a.b && c.d");
    expect(ampersands.ok).toBe(false);
    if (ampersands.ok) return;
    expect(ampersands.failure.detail).toContain('"and"');
  });

  it("never decodes: an already-decoded < is a comparison and nothing is decoded twice", () => {
    const tokens = lex('matter.title < "x"');
    expect(tokens.ok).toBe(true);
    if (!tokens.ok) return;
    expect(tokens.value.map((token) => token.text)).toEqual(["matter.title", "<", "x", ""]);
  });
});

describe("parsing", () => {
  it("binds and tighter than or, and not tighter than both", () => {
    const parsed = parse("a.b or c.d and e.f");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(prettyPrint(parsed.value.node)).toBe("(a.b or (c.d and e.f))");
  });

  it("reads `not x and y` as `(not x) and y`, which is what a person expects", () => {
    const parsed = parse("not a.b and c.d");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(prettyPrint(parsed.value.node)).toBe("((not a.b) and c.d)");
  });

  it("refuses a chained comparison with a location rather than surprising anyone", () => {
    const parsed = parse("1 == 2 == 3");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.failure.code).toBe("expression-syntax-error");
    expect(parsed.failure.detail).toContain("cannot be chained");
    expect(parsed.failure.offset).toBeGreaterThan(0);
  });

  it("validates a date literal as a calendar date", () => {
    expect(parse('date "2026-02-30"').ok).toBe(false);
    expect(parse('date "2024-02-29"').ok).toBe(true);
    expect(parse('date "2026-02-29"').ok).toBe(false);
  });

  it("pretty-prints and re-parses to an identical tree", () => {
    for (const source of [
      "not a.b and (c.d or e.f)",
      "1 + 2 * 3 - 4",
      "-5 * (2 + 1) == 0 - 15",
      'concat("a", "b", "c")',
      'matter.status in ("open", "closed")',
      'choose(true, date "2026-01-01", date "2026-12-31")',
    ]) {
      const first = parse(source);
      expect(first.ok, source).toBe(true);
      if (!first.ok) continue;
      const second = parse(prettyPrint(first.value.node));
      expect(second.ok, source).toBe(true);
      if (!second.ok) continue;
      expect(nodesEqual(first.value.node, second.value.node), source).toBe(true);
    }
  });
});

describe("name resolution and typing", () => {
  it("reports an unknown atom as an unknown merge field, naming it", () => {
    const result = condition('matter.numbre == "x"');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("expression-unknown-key");
    expect(result.failure.detail).toContain("matter.numbre");
  });

  it("records the merge keys an expression reads, sorted, so the manifest can plan the reads", () => {
    const result = condition('has(client.code) and matter.status == "open"');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.keys).toEqual(["client.code", "matter.status"]);
  });

  it("refuses a condition that does not work out to yes or no", () => {
    const result = condition("matter.number");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("expression-type-error");
  });

  it("refuses money added to a number, and money multiplied by money", () => {
    const scope = layerScope(
      SCOPE,
      new Map([["custom.fee", { type: "money" as ExpressionType, origin: "dictionary" as const }]]),
    );
    const added = checkExpression("custom.fee + 1", { scope, required: "formattableScalar" });
    expect(added.ok).toBe(false);
    const multiplied = checkExpression("custom.fee * custom.fee", {
      scope,
      required: "formattableScalar",
    });
    expect(multiplied.ok).toBe(false);
    if (multiplied.ok) return;
    expect(multiplied.failure.detail).toContain("would not be money");
  });

  it("points a date arithmetic attempt at the date helpers", () => {
    const result = computed("system.today + 30");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.detail).toContain("addDays");
  });

  it("points a text + attempt at concat", () => {
    const result = computed("matter.title + matter.number");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.detail).toContain("concat");
  });

  it("refuses a list anywhere but a repeat, count, and isEmpty", () => {
    expect(computed("matter.parties").ok).toBe(false);
    expect(condition("isEmpty(matter.parties)").ok).toBe(true);
    expect(computed("count(matter.parties)").ok).toBe(true);
    expect(computed("default(matter.parties, matter.parties)").ok).toBe(false);
  });

  it("checks a computed field's format suffix STATICALLY against the result type", () => {
    expect(computed("matter.title", "upper").ok).toBe(true);
    expect(computed("matter.title", "currency").ok).toBe(false);
    const illegal = computed("system.today", "titleCase");
    expect(illegal.ok).toBe(false);
    if (illegal.ok) return;
    expect(illegal.failure.code).toBe("expression-format-illegal");
  });

  it("refuses a bare boolean computed field, which would print the word true", () => {
    const result = computed("has(client.code)");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("expression-format-illegal");
    expect(result.failure.detail).toContain("choose");
    expect(computed("has(client.code)", "yesNo").ok).toBe(true);
  });

  it("resolves a loop reference only inside a repeating block", () => {
    const outside = condition("loop.first");
    expect(outside.ok).toBe(false);
    if (outside.ok) return;
    expect(outside.failure.detail).toContain("repeating block");

    const inside = checkExpression("loop.first", {
      scope: layerScope(SCOPE, loopFrame("matter.parties", new Map(), undefined)),
      required: "boolean",
    });
    expect(inside.ok).toBe(true);
    if (!inside.ok) return;
    // A loop-scoped name costs NO read of its own: the collection was read once, as a whole.
    expect(inside.value.keys).toEqual([]);
    expect(inside.value.loopNames).toEqual(["loop.first"]);
  });

  it("makes has() take a written-out name rather than a calculation", () => {
    expect(condition("has(client.code)").ok).toBe(true);
    expect(condition('has(concat("client", ".code"))').ok).toBe(false);
  });

  it("ties default and choose to the type of the value they stand in for", () => {
    const chosen = computed('choose(has(client.code), client.code, "none")');
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) return;
    expect(chosen.value.resultType).toBe("text");
    expect(computed("default(client.code, 3)").ok).toBe(false);
  });

  it("keeps every catalog helper reachable and spelled the way the catalog says", () => {
    expect(helperNames()).toContain("divideExact");
    expect(helperNames()).toContain("allocate");
    expect(new Set(helperNames()).size).toBe(helperNames().length);
  });
});

// One test per row of the limits table, each hitting the bound EXACTLY and asserting the named refusal
// rather than a timeout. A bound the product discovered is not a bound it declared.
describe("resource bounds", () => {
  it("refuses a source longer than the cap", () => {
    const source = "matter.title".padEnd(EXPRESSION_LIMITS.sourceLength + 1, " ");
    const result = condition(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("expression-too-complex");
    expect(result.failure.detail).toContain(String(EXPRESSION_LIMITS.sourceLength));
  });

  it("refuses more tokens than the cap", () => {
    // Each `1 +` is two tokens, so this crosses the token cap well inside the source-length cap.
    const source = `${"1+".repeat(EXPRESSION_LIMITS.tokens)}1`;
    const result = computed(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("expression-too-complex");
  });

  it("refuses a tree deeper than the cap, counting NODES rather than brackets", () => {
    // Left-nested addition: `1+1+1` is one node per `+`, so this is a tree exactly one deeper than the
    // cap. Brackets alone are not depth — they produce no node, and if they counted, pretty-printing
    // an expression would change whether it is legal.
    const source = `${"1+".repeat(EXPRESSION_LIMITS.treeDepth)}1`;
    const result = computed(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("expression-too-complex");
    expect(result.failure.detail).toContain("nest");

    const atTheCap = computed(`${"1+".repeat(EXPRESSION_LIMITS.treeDepth - 1)}1`);
    expect(atTheCap.ok).toBe(true);
    if (!atTheCap.ok) return;
    expect(atTheCap.value.depth).toBe(EXPRESSION_LIMITS.treeDepth);
  });

  it("refuses a bracket nest deep enough to threaten the stack", () => {
    // Well inside the source-length cap, so what refuses this is the descent guard rather than the
    // length check: one bracket costs several stack frames and produces no node at all.
    const source = `${"(".repeat(100)}1${")".repeat(100)}`;
    const result = computed(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("expression-too-complex");
  });

  it("refuses more calls than the cap", () => {
    const source = `concat(${Array.from({ length: EXPRESSION_LIMITS.callNodes + 1 }, () => 'upper("a")').join(", ")})`;
    const result = computed(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("expression-too-complex");
  });

  it("refuses more merge keys than the cap", () => {
    const scope = layerScope(
      SCOPE,
      new Map(
        Array.from({ length: EXPRESSION_LIMITS.keysPerExpression + 1 }, (_unused, index) => [
          `custom.f${index}`,
          { type: "text" as ExpressionType, origin: "dictionary" as const },
        ]),
      ),
    );
    const source = `concat(${Array.from({ length: EXPRESSION_LIMITS.keysPerExpression + 1 }, (_unused, index) => `custom.f${index}`).join(", ")})`;
    const result = checkExpression(source, { scope, required: "formattableScalar" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("expression-too-complex");
    expect(result.failure.detail).toContain(String(EXPRESSION_LIMITS.keysPerExpression));
  });

  it("refuses an integer literal outside the exact range", () => {
    const result = computed(`${Number.MAX_SAFE_INTEGER}0`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("expression-too-complex");
  });

  it("refuses a decimal with more places than the scale cap", () => {
    const source = `0.${"1".repeat(EXPRESSION_LIMITS.numericScale + 1)}`;
    const result = computed(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("expression-too-complex");
  });
});
