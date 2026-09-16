/*
 * The money gate's rules, in both directions. rules.mjs carries a SELF_TEST table that runs on every
 * invocation of the scan; this file is the wider net around it — the shapes that must fire, and the
 * larger set of shapes that must not, because a gate this tree cannot yet pass is one people will
 * reach to silence the first time it is wrong about something.
 *
 * Run: `pnpm test tooling/lint-money-arithmetic`.
 */
import { describe, expect, it } from "vitest";
import {
  MONEY_HOME,
  RULES,
  SELF_TEST,
  blankNonCode,
  findFloatEscapes,
  findMinorUnitConversions,
  findMoneyArithmetic,
  runSelfTest,
} from "./rules.mjs";

const SURFACE = "apps/web/src/lib/billing/thing.ts";
const rulesFiring = (file, source) =>
  RULES.flatMap((rule) => rule(file, source)).map((f) => f.rule);

describe("the self-test that runs on every invocation", () => {
  it("passes, which is the only reason the scan may report a clean tree", () => {
    expect(runSelfTest()).toEqual([]);
  });

  it("holds samples on both sides, so it cannot pass by matching nothing", () => {
    expect(SELF_TEST.filter((sample) => sample.expect.length > 0).length).toBeGreaterThan(5);
    expect(SELF_TEST.filter((sample) => sample.expect.length === 0).length).toBeGreaterThan(5);
  });
});

describe("comments, strings and template text are blanked, not removed", () => {
  it("keeps the text the same length so every reported line is the real line", () => {
    const source = "const a = 1;\n// totalMinor - appliedMinor\nconst b = x + row.amountMinor;\n";
    const blanked = blankNonCode(source);
    expect(blanked).toHaveLength(source.length);
    expect(blanked.split("\n")).toHaveLength(source.split("\n").length);
    expect(findMoneyArithmetic(SURFACE, source)[0].line).toBe(3);
  });

  it("reads nothing in a comment, so prose about money cannot fail a build", () => {
    const line = "// Unpaid is totalMinor - appliedMinor, and amountMinor / 100 is the display.\n";
    expect(rulesFiring(SURFACE, line)).toEqual([]);
    const block = "/*\n * amountMinor += entry.amountMinor;\n */\n";
    expect(rulesFiring(SURFACE, block)).toEqual([]);
  });

  it("does not read the slashes in a quoted URL as the start of a comment", () => {
    // The URL itself is blanked — it is string content — but the code AFTER it must survive, which
    // is what would be lost if `//` inside a string opened a line comment.
    const blanked = blankNonCode(
      'const u = "https://example.test/a"; const b = x + row.amountMinor;',
    );
    expect(blanked).toContain("row.amountMinor");
  });

  it("blanks SQL, whose integer arithmetic is exact and cannot reach the money package", () => {
    const source = "`UPDATE account_balance SET balance_minor = balance_minor + ?2`";
    expect(rulesFiring("packages/ledger/src/statements.ts", source)).toEqual([]);
  });

  it("keeps the code inside a template hole, including a nested template", () => {
    const nested = "`a ${`b ${totalMinor - appliedMinor}`} c`";
    expect(rulesFiring(SURFACE, nested)).toEqual(["money-arithmetic"]);
  });

  it("does not let a brace inside a hole close the hole early", () => {
    const source = "`${ { totalMinor: 1 }.totalMinor + 1 } and amountMinor / 100`";
    // The arithmetic is inside the hole and must fire; the `/ 100` is template TEXT and must not.
    expect(rulesFiring(SURFACE, source)).toEqual(["money-arithmetic"]);
  });
});

describe("rule one: the minor-unit exponent belongs to the currency", () => {
  it("catches the conversion in every scale spelling the tree uses", () => {
    for (const source of [
      "formatMoney(amountMinor / 100, { currency })",
      "const rate = row.rateE4 / 10_000;",
      "const dollars = amount_minor / 100;",
      "const major = totalCents / 100;",
      "const scaled = 100 * fee.amountMinor;",
      "const legacy = amountMinor / 1e2;",
    ]) {
      expect(findMinorUnitConversions(SURFACE, source), source).toHaveLength(1);
    }
  });

  it("names the currency as the owner of the exponent, not the call site", () => {
    const [found] = findMinorUnitConversions(SURFACE, "formatMoney(amountMinor / 100)");
    expect(found.detail).toContain("CURRENCY");
    expect(found.detail).toContain("fromMinor");
  });

  it("claims the operator, so one division is one finding and not two", () => {
    expect(rulesFiring(SURFACE, "const d = fee.amountMinor / 100;")).toEqual([
      "minor-unit-conversion",
    ]);
  });

  it("leaves a number that merely looks like a scale to the arithmetic rule", () => {
    // 100.5 is not a minor-unit scale; the division is still arithmetic on money.
    expect(rulesFiring(SURFACE, "const average = totalMinor / 100.5;")).toEqual([
      "money-arithmetic",
    ]);
    expect(rulesFiring(SURFACE, "const share = totalMinor / 1005;")).toEqual(["money-arithmetic"]);
  });

  it("reports a conversion through a NAMED constant as arithmetic, which is findable", () => {
    expect(rulesFiring(SURFACE, "const q = quantityE4 / RATE_SCALE_DIVISOR;")).toEqual([
      "money-arithmetic",
    ]);
  });
});

describe("rule two: arithmetic on money happens in the money package", () => {
  it("catches money on the left of the operator", () => {
    for (const source of [
      "unpaidMinor: totalMinor - appliedMinor,",
      "const product = amount.amountMinor * whole;",
      "if (amount.amountMinor % divisor !== 0) return;",
      "const half = heldMinor / 2;",
    ]) {
      expect(findMoneyArithmetic(SURFACE, source), source).toHaveLength(1);
    }
  });

  it("catches money on the right, including through a property path", () => {
    for (const source of [
      "expect(balance).toBe(operatingBefore + totalMinor);",
      ".reduce((total, row) => total + row.summary.totalMinor, 0)",
      "const net = running - balance!.appliedMinor;",
      "const net = running - summary?.unpaidMinor;",
    ]) {
      expect(findMoneyArithmetic(SURFACE, source), source).toHaveLength(1);
    }
  });

  it("catches the accumulator form, which reads least like arithmetic", () => {
    for (const source of [
      "receivableMinor += feeMinor;",
      "leaf.heldMinor -= outMinor;",
      "share.amountMinor += entry.amountMinor ?? 0;",
    ]) {
      expect(findMoneyArithmetic(SURFACE, source), source).toHaveLength(1);
    }
  });

  it("reports one finding per OPERATOR, not one per money-shaped operand", () => {
    // Money on both sides of one minus is one problem, not two.
    expect(findMoneyArithmetic(SURFACE, "unpaidMinor: totalMinor - appliedMinor,")).toHaveLength(1);
    // Two operators on one line are two problems, because each is a separate answer.
    expect(
      findMoneyArithmetic(SURFACE, "const t = openingMinor + movedMinor - chargeMinor;"),
    ).toHaveLength(2);
  });

  it("names the remedy for each shape of the work, not just the fault", () => {
    const [found] = findMoneyArithmetic(SURFACE, "unpaidMinor: totalMinor - appliedMinor,");
    expect(found.detail).toContain("allocate");
    expect(found.detail).toContain("toMinor");
  });

  it("does not read a regular expression's leading slash as a division", () => {
    const source = "expect(/declared_value_amount_minor|declaredValue/.test(text)).toBe(true);";
    expect(rulesFiring("packages/matter-assets/test/custody-link.test.ts", source)).toEqual([]);
  });

  it("leaves comparison, increment and assignment alone — none of them is arithmetic", () => {
    for (const source of [
      "if (availableMinor < requestedMinor) return refused;",
      "if (bookBalanceMinor !== clientTotalMinor) return;",
      "if (heldMinor >= 0) return;",
      "amountMinor++;",
      "const totalMinor = row.totalMinor;",
      "export interface Row { readonly totalMinor: number; }",
      "function of(amountMinor: number): string {",
      "const { totalMinor, appliedMinor } = summary;",
    ]) {
      expect(rulesFiring(SURFACE, source), source).toEqual([]);
    }
  });

  it("deliberately says nothing about unary negation", () => {
    // Excluding it costs one true finding; including it would fire on every negative literal.
    expect(
      rulesFiring(SURFACE, "return direction === normal ? amountMinor : -amountMinor;"),
    ).toEqual([]);
  });

  it("is not fooled by a name that merely contains a money suffix", () => {
    for (const source of [
      "const next = amountMinorityShare + 1;",
      "const next = minorVersion + 1;",
      "const next = releaseE45 + 1;",
    ]) {
      expect(rulesFiring(SURFACE, source), source).toEqual([]);
    }
  });
});

describe("rule three: money never becomes a float", () => {
  it("catches the receiver-to-the-left and subject-to-the-right spellings", () => {
    expect(
      findFloatEscapes(SURFACE, "amountText = (entry.amountMinor / 100).toFixed(2);"),
    ).toHaveLength(1);
    expect(findFloatEscapes(SURFACE, "const v = Number(row.amount_minor);")).toHaveLength(1);
    expect(findFloatEscapes(SURFACE, "const v = parseFloat(String(totalMinor));")).toHaveLength(1);
  });

  it("names both directions of the remedy", () => {
    const [found] = findFloatEscapes(SURFACE, "const text = (amountMinor / 100).toFixed(2);");
    expect(found.detail).toContain("format");
    expect(found.detail).toContain("fromDecimal");
  });

  it("says nothing when the line carries no money", () => {
    expect(findFloatEscapes(SURFACE, "const page = Number(parameters.get('page'));")).toEqual([]);
    expect(findFloatEscapes(SURFACE, "const text = ratio.toFixed(2);")).toEqual([]);
  });

  it("does not read a function whose NAME ends in Number as the Number constructor", () => {
    expect(
      findFloatEscapes(SURFACE, 'const amountMinor = factNumber(row.facts, "amountMinor");'),
    ).toEqual([]);
    expect(findFloatEscapes(SURFACE, "if (!Number.isSafeInteger(productMinor)) return;")).toEqual(
      [],
    );
  });

  it("reads the line after blanking, so money named only in a string does not count", () => {
    expect(findFloatEscapes(SURFACE, 'const page = Number(query.get("amountMinor"));')).toEqual([]);
  });
});

describe("the one home that is allowed to do all of it", () => {
  it("is silent for the authority's own source", () => {
    const source = "const remainderMinor = totalMinor - allocatedMinor;";
    expect(rulesFiring(`${MONEY_HOME}/src/allocate.ts`, source)).toEqual([]);
    expect(rulesFiring(SURFACE, source)).toEqual(["money-arithmetic"]);
  });

  it("is silent for the authority's own tests, which have to add a split back up", () => {
    const source = "expect(parts.reduce((sum, part) => sum + toMinor(part), 0)).toBe(1003);";
    expect(rulesFiring(`${MONEY_HOME}/test/allocate.test.ts`, source)).toEqual([]);
  });

  it("exempts no other package, however close to storage it sits", () => {
    const source = "availableMinor: row.balance_minor - row.held_minor,";
    for (const file of [
      "packages/ledger/src/statements.ts",
      "packages/trust/src/holds.ts",
      "packages/billing/src/queries.ts",
      "packages/money-formatting/src/thing.ts",
    ]) {
      expect(rulesFiring(file, source), file).toEqual(["money-arithmetic"]);
    }
  });
});
