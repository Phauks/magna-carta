/*
 * The rules of the money gate, and why each one exists. The runner is index.mjs; every decision here
 * is a pure function over (path, source) so it can be unit-tested without a repository.
 *
 * WHAT THIS GATE IS FOR. An amount of money has one authority on this platform: the package
 * `@magna-carta/money` (packages/money/src). It is a Dinero seam with branded Money, Rate, Ratio and
 * Intermediate types, exact integer arithmetic, named rounding helpers in rounding.ts, largest-
 * remainder splitting in allocate.ts, ordering in compare.ts and the minor-unit boundary in
 * format.ts. Forty-one files import it, so the authority is neither hypothetical nor unpopular.
 *
 * It is also not the only place money is added up. Scanning apps, packages and tooling for an
 * identifier ending `Minor`, `_minor`, `Cents`, `_cents`, `E4` or `_e4` standing next to an
 * arithmetic operator finds 152 sites outside the package, across 73 files, none of which go through
 * it. That is the failure mode this scans for, and it is the same shape as the date gate's: not a
 * WRONG answer to "what is money", a SECOND one. A second answer type-checks, reviews clean, agrees
 * with the first on every amount anyone tried, and then stops agreeing — when a currency with a
 * different number of minor digits is registered, when a product grows past a safe integer, when a
 * split has to add back up to the whole, or when somebody corrects one copy of the rounding and
 * cannot find the other seven.
 *
 * WHAT WAS THERE WHEN THIS LANDED, by the three rules below, and what each kind actually is:
 *
 *   - 42 hard-coded minor-unit conversions. The largest cluster, 26 of them, is
 *     `formatMoney(amountMinor / 100)`: the design system's money formatter takes an amount in the
 *     currency's MAJOR unit, so every surface divides by a literal 100 on the way in. The literal is
 *     the whole problem — how many minor units make a major unit belongs to the CURRENCY (two for
 *     USD and EUR, zero for JPY, three for TND), and not one of those call sites can see which
 *     currency it is dividing. Three more of the 42 are a data-table column's `value()` accessor on
 *     a column declared `total: "sum"`, which means those are not display at all: the grid adds the
 *     divided FLOATS across every row and formats the result, so the conversion has become
 *     arithmetic one layer down where nobody reading the call site can see it.
 *   - 101 pieces of raw minor-unit arithmetic. Most restate a definition the ledger already owns —
 *     `totalMinor - appliedMinor` for what is unpaid, written out in eight files — or sum a column
 *     with `reduce`, which is 27 of them and is what `sum` (@magna-carta/money/money) exists for.
 *     The serious ones are neither: packages/document-assembly/src/expression/evaluate.ts carries a
 *     whole second money engine for template expressions (add, multiply, divide, remainder, an
 *     exact-division refusal and its own safe-integer guard beside each one), and
 *     packages/billing/src/contingency.ts derives a contingency entitlement in bare numbers.
 *   - 9 float escapes, where a money value goes through `toFixed`, `parseFloat` or `Number`.
 *
 * THE ONE CHOKEPOINT THAT ALREADY EXISTS, named here so it is not mistaken for a gap: the ledger
 * asserts integer minor units at the last boundary before SQL (packages/ledger/src/statements.ts).
 * It needs no exemption and gets none, because it does no arithmetic and because it does not answer
 * the question itself — it calls `assertSafeInteger` from the money package. That is what a correct
 * boundary looks like, and it is the shape the rest of this list should end up in.
 *
 * WHERE THE RULES DO NOT APPLY, and why:
 *
 *   - packages/money — the authority itself, src AND test. The package has to do raw minor-unit
 *     arithmetic; that is what it is for. Its tests have to as well: a test that proves `allocate`
 *     returns parts which add back up to the whole has to add the parts up itself, and a test that
 *     re-derived the answer through the thing it is testing would prove nothing.
 *   - This tool's own directory, which necessarily writes out every pattern it bans.
 *
 * Nothing else. In particular the ledger, the billing package and the trust package are NOT exempt,
 * however close to the storage boundary they sit: "it is only a subtraction, and it is right" is
 * precisely what each of the hundred and one sites believes about itself.
 *
 * WHAT THIS DOES NOT CATCH, stated plainly, because a gate that claims more than it delivers is
 * worse than none:
 *
 *   - Money with no money-shaped name on it. `const owed = total - paid` on values that happen to be
 *     cents is invisible here. Every rule keys on the naming convention (`*Minor`, `*_minor`,
 *     `*Cents`, `*_cents`, `*E4`, `*_e4`), which this codebase keeps consistently enough that the
 *     schema-conformance test asserts every money column carries one. A value that abandons the
 *     convention defeats the scan, and review is the only answer to that.
 *   - Arithmetic inside a SQL string. Strings are blanked before any rule runs, so
 *     `SET applied_minor = applied_minor + ?3` is not a finding — SQLite's integer arithmetic over
 *     INTEGER columns is exact and cannot reach the money package anyway. The cost of that decision
 *     is real and is recorded here rather than hidden: packages/billing/src/fitness.ts computes a
 *     contingency entitlement as `share_e4 / 10000.0 + 0.5` cast to INTEGER, which is a float divide
 *     and a hand-rolled half-up rounding inside a string this gate deliberately cannot read.
 *   - Unary negation. `-amountMinor` is `negate()`, but excluding it costs one true finding and
 *     including it would fire on every negative literal in a fixture, so every rule requires a
 *     binary context: an operand on the left of the operator.
 *   - A conversion through a named constant. `quantityE4 / RATE_SCALE_DIVISOR` is reported as
 *     arithmetic (rule two) rather than as a minor-unit conversion (rule one), because the scale is
 *     not a literal in the text. That is the right way round: a named constant is at least findable.
 *   - Whether the arithmetic is CORRECT. Every site in the baseline was right on the day it was
 *     written. The finding is that the answer lives in two places, not that one of them is wrong.
 *
 * Run: `pnpm run lint:money-arithmetic`, or `node tooling/lint-money-arithmetic/index.mjs`. Pure
 * text over first-party source; no install, no build. `--update-baseline` re-records the debt.
 */

/** Where an amount of money is defined, added, rounded and split. Nothing else may do any of it. */
export const MONEY_HOME = "packages/money";

/*
 * Comments, string literals and template text are ordinary prose and must not trip a scan, so they
 * are blanked before any rule runs.
 *
 * BLANKED, NOT REMOVED — every blanked character becomes a space and every newline is kept, so the
 * text stays the same length and every index into it is still an index into the real file. Deleting
 * instead shifts every offset after the first cut, and a gate that reports a real problem at the
 * wrong line is a gate people stop trusting: it sends the reader to whatever happens to sit on that
 * line, which is a different function.
 *
 * A template literal keeps the contents of its `${...}` holes, because that is code — an
 * interpolated `${totalMinor - appliedMinor}` is exactly as much a second answer as the same
 * expression on its own line. Only the literal text around the holes is blanked, which is what makes
 * the SQL carve-out above work: the SQL is text, the interpolated table name is not.
 *
 * This is a state machine rather than a set of regular expressions because the two interleave —
 * a quote inside a comment is not a string, a `//` inside a string is not a comment, and a template
 * hole can contain another template. Two things it deliberately gets wrong, both in the safe
 * direction of blanking too much rather than too little: an apostrophe in Svelte markup text opens a
 * string that is closed by the end of the line, and a quote character inside a regular expression
 * literal does the same. Both cost a false blank on the rest of one line; neither can invent a
 * finding, and the operand guard below is what keeps a regular expression's leading slash from being
 * read as a division.
 */
export function blankNonCode(source) {
  const characters = [...source];
  const blank = (at) => {
    if (characters[at] !== undefined && characters[at] !== "\n") characters[at] = " ";
  };
  // Brace depths of the template-literal interpolations currently open, innermost last.
  const interpolations = [];
  let mode = "code";
  let position = 0;
  while (position < characters.length) {
    const character = characters[position];
    const next = characters[position + 1];
    if (mode === "code") {
      if (character === "/" && next === "/") {
        blank(position);
        blank(position + 1);
        mode = "line-comment";
        position += 2;
      } else if (character === "/" && next === "*") {
        blank(position);
        blank(position + 1);
        mode = "block-comment";
        position += 2;
      } else if (character === '"' || character === "'") {
        mode = character === '"' ? "double-quoted" : "single-quoted";
        position += 1;
      } else if (character === "`") {
        mode = "template";
        position += 1;
      } else if (character === "{" && interpolations.length > 0) {
        interpolations[interpolations.length - 1] += 1;
        position += 1;
      } else if (character === "}" && interpolations.length > 0) {
        if (interpolations[interpolations.length - 1] === 0) {
          interpolations.pop();
          mode = "template";
        } else {
          interpolations[interpolations.length - 1] -= 1;
        }
        position += 1;
      } else {
        position += 1;
      }
      continue;
    }
    if (mode === "line-comment") {
      if (character === "\n") mode = "code";
      else blank(position);
      position += 1;
      continue;
    }
    if (mode === "block-comment") {
      if (character === "*" && next === "/") {
        blank(position);
        blank(position + 1);
        mode = "code";
        position += 2;
      } else {
        blank(position);
        position += 1;
      }
      continue;
    }
    if (mode === "double-quoted" || mode === "single-quoted") {
      const quote = mode === "double-quoted" ? '"' : "'";
      if (character === "\\") {
        blank(position);
        blank(position + 1);
        position += 2;
      } else if (character === quote || character === "\n") {
        // An unterminated quote is markup or a regular expression, not a string; give up at the line
        // end rather than blanking the rest of the file.
        mode = "code";
        position += 1;
      } else {
        blank(position);
        position += 1;
      }
      continue;
    }
    // mode === "template"
    if (character === "\\") {
      blank(position);
      blank(position + 1);
      position += 2;
    } else if (character === "$" && next === "{") {
      interpolations.push(0);
      mode = "code";
      position += 2;
    } else if (character === "`") {
      mode = "code";
      position += 1;
    } else {
      blank(position);
      position += 1;
    }
  }
  return characters.join("");
}

export function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/*
 * A money-shaped name, as this codebase spells one.
 *
 * The suffixes are the documented storage encodings — `amount_minor` for integer minor units and
 * `rate_e4` for scaled ten-thousandths — in both the column spelling and the camel-case spelling the
 * data-access layer maps them to, plus the `Cents` spelling that arrives from outside (a carrier's
 * or a processor's payload) before it is renamed. A trailing character class rather than `\b` so
 * `amountMinorityShare` is not read as a money name.
 */
const MONEY_NAME = String.raw`[A-Za-z_$][A-Za-z0-9_$]*(?:Minor|_minor|Cents|_cents|E4|_e4)(?![A-Za-z0-9_$])`;

/** The same shape, for asking whether a line mentions money at all. */
export const MONEY_NAME_PATTERN = new RegExp(MONEY_NAME);

/*
 * The same name reached through a property path — `row.amountMinor`, `balance!.totalMinor`,
 * `summary?.unpaidMinor`. Only the rules that look for money to the RIGHT of an operator need this:
 * the ones looking to the left match the name itself and never see the dots in front of it. Without
 * it `running + row.amountMinor` reads as clean, which is the commonest way an amount gets folded
 * into a total that is not itself named as money.
 */
const MONEY_REFERENCE = String.raw`(?:[A-Za-z_$][A-Za-z0-9_$]*!?\??\.)*` + MONEY_NAME;

/*
 * A literal that can only be a minor-unit scale: a one followed by two, three or four zeros, in the
 * spellings the tree uses (`100`, `10_000`, `10000.0`, `1e4`). The optional `.0+` tail catches the
 * float spelling, and the closing lookahead stops `100` matching the front of `100.5` or `1005`.
 */
const SCALE_LITERAL = String.raw`(?:10_000|10000|1_000|1000|100|1e4|1e3|1e2)(?:\.0+)?(?![0-9_.])`;

/** The left operand's last character: what tells a division from a regular expression literal. */
const OPERAND_END = String.raw`[A-Za-z0-9_$)\]]`;

const problem = (rule, file, text, index, detail) => ({
  rule,
  file,
  line: lineOf(text, index),
  detail,
});

/** Where the operator sat, so two rules matching around the same operator report it once. */
const operatorIndexOf = (match) => match.indices.groups.operator[0];

function inAllowedHome(filePath) {
  return filePath === MONEY_HOME || filePath.startsWith(`${MONEY_HOME}/`);
}

// --- rule one: the minor-unit exponent belongs to the currency ----------------------------------

/**
 * A money-shaped value divided or multiplied by a hard-coded minor-unit scale.
 *
 * Both directions, because both are written: `amountMinor / 100` on the way out to a reader, and
 * `100 * dollars` on the way in. This is reported ahead of the general arithmetic rule and claims
 * the operator, because the two findings would otherwise name the same character twice and because
 * the remedies differ — a conversion is fixed by reading the exponent off the currency, general
 * arithmetic is fixed by moving the expression into the money package.
 */
const CONVERSION_AFTER_NAME = new RegExp(
  `${MONEY_NAME}\\s*(?<operator>[*/])\\s*${SCALE_LITERAL}`,
  "gd",
);
const CONVERSION_BEFORE_NAME = new RegExp(
  `${SCALE_LITERAL}\\s*(?<operator>\\*)\\s*${MONEY_REFERENCE}`,
  "gd",
);

/** The operator offsets rule one has claimed, so rule two can leave them alone. */
export function conversionOperatorIndices(text) {
  const indices = new Set();
  for (const pattern of [CONVERSION_AFTER_NAME, CONVERSION_BEFORE_NAME]) {
    for (const match of text.matchAll(pattern)) indices.add(operatorIndexOf(match));
  }
  return indices;
}

export function findMinorUnitConversions(filePath, source) {
  if (inAllowedHome(filePath)) return [];
  const text = blankNonCode(source);
  return [...conversionOperatorIndices(text)]
    .toSorted((left, right) => left - right)
    .map((index) =>
      problem(
        "minor-unit-conversion",
        filePath,
        text,
        index,
        "converts a money value with a hard-coded minor-unit scale. How many minor units make one " +
          "major unit is a property of the CURRENCY, not of this call site — two for USD and EUR, " +
          "zero for JPY, three for TND — and the literal here cannot see which currency it is " +
          "dividing, so it is a second answer to a question the currency already answers. Carry " +
          "the value as Money: `fromMinor(value, currencyFromCode(code))` (@magna-carta/money/" +
          "format and /money), and print it with `format` from @magna-carta/money/format. Handing " +
          "a bare divided float to a formatter is the same bug one step later",
      ),
    );
}

// --- rule two: arithmetic on money happens in the money package ---------------------------------

/**
 * A money-shaped identifier standing next to an arithmetic operator.
 *
 * Three spellings, all reported as one rule and deduplicated by the operator's offset so a
 * subtraction with money on both sides is one finding rather than two:
 *
 *   - the name on the left of the operator (`totalMinor - appliedMinor`),
 *   - the name on the right of it (`receivableBefore + totalMinor`), which is how a raw amount gets
 *     folded into a running total that is not itself named as money,
 *   - a compound assignment (`heldMinor -= outMinor`), which is the accumulator form and the one
 *     that reads least like arithmetic.
 *
 * The right-hand spelling requires a real left operand before the operator, which is what keeps a
 * regular expression literal's leading slash — `/declared_value_amount_minor|.../` — from being read
 * as a division. Increment, decrement and the comparison operators are not arithmetic and are not
 * matched; `**` is, because raising an amount to a power is not less wrong for being rarer.
 */
const ARITHMETIC_AFTER_NAME = new RegExp(
  `${MONEY_NAME}\\s*(?<operator>\\*\\*(?!=)|[*/%](?!=)|\\+(?![+=])|-(?![-=]))`,
  "gd",
);
const ARITHMETIC_BEFORE_NAME = new RegExp(
  `${OPERAND_END}\\s*(?<operator>\\*\\*|[*/%]|\\+(?![+=])|-(?![-=]))\\s*${MONEY_REFERENCE}`,
  "gd",
);
const COMPOUND_ASSIGNMENT = new RegExp(`${MONEY_NAME}\\s*(?<operator>\\*\\*=|[*/%+-]=)`, "gd");

export function findMoneyArithmetic(filePath, source) {
  if (inAllowedHome(filePath)) return [];
  const text = blankNonCode(source);
  const claimed = conversionOperatorIndices(text);
  const operators = new Set();
  for (const pattern of [ARITHMETIC_AFTER_NAME, ARITHMETIC_BEFORE_NAME, COMPOUND_ASSIGNMENT]) {
    for (const match of text.matchAll(pattern)) {
      const index = operatorIndexOf(match);
      if (!claimed.has(index)) operators.add(index);
    }
  }
  return [...operators]
    .toSorted((left, right) => left - right)
    .map((index) =>
      problem(
        "money-arithmetic",
        filePath,
        text,
        index,
        "does arithmetic on a raw minor-unit number. @magna-carta/money is where an amount is " +
          "added, subtracted, scaled and split: `add` / `subtract` / `sum` / `negate` " +
          "(@magna-carta/money/money), `multiplyByQuantity` or `percentOf` followed by a named " +
          "helper from @magna-carta/money/rounding, `allocate` (@magna-carta/money/allocate) for a " +
          "split whose parts must add back up to the whole, and `compare` / `minimum` / `maximum` " +
          "(@magna-carta/money/compare) for ordering. A bare operator here is exact only while " +
          "every operand is a safe integer in the same currency, and nothing on this line checks " +
          "either — the money package checks both on every operation. Read the amounts with " +
          "`fromMinor`, do the work in Money, and go back to minor units with `toMinor` at the " +
          "storage boundary only",
      ),
    );
}

// --- rule three: money never becomes a float ----------------------------------------------------

/**
 * `toFixed`, `parseFloat` and `Number` on a line that mentions money.
 *
 * Each of the three is a one-way door out of exact integer arithmetic, and each arrives for a
 * plausible reason: `toFixed` to put two decimals on a figure, `parseFloat`/`Number` to read an
 * amount a person or a payload wrote down. All three are already answered — `format` prints an
 * amount exactly (it hands Intl the decimal STRING, because converting through a number is lossy
 * near the top of the safe-integer range), and `fromDecimal` parses one, rejecting sub-cent
 * precision instead of silently absorbing it.
 *
 * SCOPED TO THE LINE, because that is the only cheap way to tell `(amountMinor / 100).toFixed(2)`,
 * where the receiver is to the LEFT, from `Number(row.amount_minor)`, where the subject is to the
 * right. A line carrying an unrelated `Number(` and an unrelated money name is a false positive; the
 * tree holds none, and the baseline would make one visible rather than silent.
 */
const FLOAT_ESCAPE = /(?<operator>\.toFixed\(|\bparseFloat\(|\bNumber\()/dg;

export function findFloatEscapes(filePath, source) {
  if (inAllowedHome(filePath)) return [];
  const text = blankNonCode(source);
  const lines = text.split("\n");
  const problems = [];
  for (const match of text.matchAll(FLOAT_ESCAPE)) {
    const index = operatorIndexOf(match);
    const line = lineOf(text, index);
    if (!MONEY_NAME_PATTERN.test(lines[line - 1] ?? "")) continue;
    problems.push(
      problem(
        "money-float-escape",
        filePath,
        text,
        index,
        "puts a money value through a float conversion. A binary float cannot hold every exact " +
          "cent, and once an amount has been through one there is no way to tell a rounding that " +
          "was intended from one that happened. To PRINT an amount, `format` from " +
          "@magna-carta/money/format hands Intl the exact decimal string rather than a number. To " +
          "READ one a person or a payload wrote down, `fromDecimal` from @magna-carta/money/money " +
          "parses it into exact minor units and refuses sub-cent precision instead of absorbing it",
      ),
    );
  }
  return problems;
}

/** Every rule, in the order a failure reads best: the conversion, then the arithmetic, then the float. */
export const RULES = Object.freeze([
  findMinorUnitConversions,
  findMoneyArithmetic,
  findFloatEscapes,
]);

// --- the scan proves itself before it scans -----------------------------------------------------

/*
 * A check that cannot fail is indistinguishable from a clean tree, and this one is especially easy to
 * break into silence: every rule is a regular expression over text that a formatter, a rename or an
 * added suffix can quietly stop matching, and the tree it guards is expected to have findings in it,
 * so a run that reported nothing would look like progress rather than like a broken gate.
 *
 * So the table runs on EVERY invocation, not only under the test runner. rules.test.mjs covers the
 * same ground in more detail and in both directions; this is the part that cannot be skipped.
 *
 * Each sample names the rules it must produce, in order, so a rule that starts firing on a negative
 * sample fails as loudly as one that stops firing on a positive.
 */
export const SELF_TEST = Object.freeze([
  {
    name: "a display conversion by a literal hundred",
    file: "apps/web/src/lib/billing/columns.ts",
    source: "value: (fee) => fee.amountMinor / 100,",
    expect: ["minor-unit-conversion"],
  },
  {
    name: "a rate conversion by a literal ten thousand",
    file: "apps/web/src/lib/time/columns.ts",
    source: "value: (row) => row.rateE4 / 10_000,",
    expect: ["minor-unit-conversion"],
  },
  {
    name: "the conversion claims the operator, so it is not also reported as arithmetic",
    file: "apps/web/src/lib/billing/columns.ts",
    source: "const dollars = fee.amountMinor / 100;",
    expect: ["minor-unit-conversion"],
  },
  {
    name: "a subtraction that restates a definition the ledger owns",
    file: "packages/billing/src/queries.ts",
    source: "unpaidMinor: totalMinor - appliedMinor,",
    expect: ["money-arithmetic"],
  },
  {
    name: "money folded into a running total that is not itself named as money",
    file: "apps/api-worker/test/billing-routes.test.ts",
    source: "expect(balance).toBe(operatingBefore + totalMinor);",
    expect: ["money-arithmetic"],
  },
  {
    name: "the accumulator form",
    file: "packages/fixtures/src/load-profile/generate.ts",
    source: "receivableMinor += feeMinor;",
    expect: ["money-arithmetic"],
  },
  {
    name: "an amount folded into a total through a property path",
    file: "apps/web/src/lib/billing/bill-figures.ts",
    source: ".reduce((total, row) => total + row.summary.totalMinor, 0)",
    expect: ["money-arithmetic"],
  },
  {
    name: "a second money engine multiplying minor units",
    file: "packages/document-assembly/src/expression/evaluate.ts",
    source: "const product = amount.amountMinor * rateValue.rateE4;",
    expect: ["money-arithmetic"],
  },
  {
    name: "a float escape with the receiver to the left",
    file: "apps/web/src/lib/costs/cost-record-window.svelte",
    source: "amountText = (entry.amountMinor / 100).toFixed(2);",
    expect: ["minor-unit-conversion", "money-float-escape"],
  },
  {
    name: "a float escape with the subject to the right",
    file: "packages/document-assembly/test/format.test.ts",
    source: "expect(Number(rendered), String(amountMinor)).toBe(1);",
    expect: ["money-float-escape"],
  },
  {
    name: "the authority itself is silent",
    file: "packages/money/src/allocate.ts",
    source: "const remainderMinor = totalMinor - allocatedMinor;",
    expect: [],
  },
  {
    name: "the authority's own tests are silent, because proving a split means adding it up",
    file: "packages/money/test/allocate.test.ts",
    source: "expect(parts.reduce((sum, part) => sum + toMinor(part), 0)).toBe(1003);",
    expect: [],
  },
  {
    name: "a comment is prose and cannot fail a build",
    file: "packages/billing/src/queries.ts",
    source: "// What is unpaid is totalMinor - appliedMinor, and it is computed below.",
    expect: [],
  },
  {
    name: "SQL in a template literal is text, not JavaScript arithmetic",
    file: "packages/ledger/src/statements.ts",
    source: "`UPDATE account_balance SET balance_minor = balance_minor + ?2`",
    expect: [],
  },
  {
    name: "but an interpolation hole inside that template is still code",
    file: "packages/billing/src/statements.ts",
    source: "`SELECT ${String(totalMinor - appliedMinor)} AS unpaid`",
    expect: ["money-arithmetic"],
  },
  {
    name: "a regular expression's leading slash is not a division",
    file: "packages/matter-assets/test/custody-link.test.ts",
    source: "expect(/declared_value_amount_minor|declaredValue/.test(text)).toBe(true);",
    expect: [],
  },
  {
    name: "a name that merely starts with a money suffix is not money",
    file: "apps/web/src/lib/versions/model.ts",
    source: "const next = amountMinorityShare + 1;",
    expect: [],
  },
  {
    name: "a comparison is not arithmetic",
    file: "packages/trust/src/holds.ts",
    source: "if (availableMinor < requestedMinor) return refused;",
    expect: [],
  },
  {
    name: "a type annotation is not arithmetic",
    file: "packages/billing/src/types.ts",
    source: "export interface Row { readonly totalMinor: number; }",
    expect: [],
  },
  {
    name: "a float conversion with no money on the line is somebody else's question",
    file: "apps/web/src/lib/table/paging.ts",
    source: "const page = Number(parameters.get('page') ?? '1');",
    expect: [],
  },
  {
    name: "a division by a scale-shaped number that is not a scale",
    file: "apps/web/src/lib/billing/summary.ts",
    source: "const average = totalMinor / 100.5;",
    expect: ["money-arithmetic"],
  },
]);

export function runSelfTest() {
  const failures = [];
  for (const { name, file, source, expect } of SELF_TEST) {
    const found = RULES.flatMap((rule) => rule(file, source)).map((one) => one.rule);
    if (
      JSON.stringify(found.toSorted((left, right) => left.localeCompare(right))) !==
      JSON.stringify([...expect].toSorted((left, right) => left.localeCompare(right)))
    ) {
      failures.push({ name, found, expect });
    }
  }
  return failures;
}
