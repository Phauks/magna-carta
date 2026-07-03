import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectSourceFiles } from "./source-file-sweep.ts";

/*
 * Off-token fitness functions — golden rule 2 ("all UI through the design system"),
 * machine-checked.
 *
 * Rule home: CLAUDE.md golden rule 2 ("no off-token values", made mechanically lintable).
 * House pattern: fitness functions are Vitest tests that scan source files, like the token
 * gates in packages/design-tokens/test/.
 *
 * Five scanners, each banning one way an off-token value (or a banned glyph) enters the UI:
 *   1. Tailwind arbitrary values  — p-[13px], bg-[#fff], duration-[150ms]
 *   2. Raw color literals         — hex, rgb()/rgba()/hsl()/hsla()/oklch()/oklab()
 *   3. Raw z-index numerals       — z-50 (Z_LAYER_CLASSES in src/lib/internal/floating.ts
 *                                   is the only z home)
 *   4. Raw transition durations   — duration-150 (duration-instant|fast|normal|slow only)
 *   5. Emojis                     — golden rule 2 ("no emojis anywhere"); icons are Lucide. Scans the
 *                                   pictographic ranges only (emoji planes U+1F000–1FAFF and misc
 *                                   symbols U+2600–26FF — an emoji's base always falls in one).
 *                                   Text punctuation the codebase uses in prose/comments is
 *                                   deliberately NOT banned: arrows (→ ↔, U+2190–21FF) and the
 *                                   dingbat multiplication X (✕, U+2715) are legitimate symbols, not
 *                                   emoji. Docs and commit messages are golden-rule-2 surfaces too,
 *                                   enforced outside this UI-source sweep (review + commit hooks).
 *
 * THE SWEEP SURFACE (deliberate; every exclusion justified):
 *   IN  apps/web/src — .svelte, .ts, .css — the product UI. The plan names svelte+ts;
 *       .css is added because app.css is the app's one stylesheet and a literal there
 *       would be the easiest place to hide one.
 *   IN  packages/design-system/src — .svelte, .ts, .css — the design system itself,
 *       INCLUDING src/stories: stories are exemplar code, copied by humans, so they are
 *       held to the same standard.
 *   OUT packages/design-system/test/** — test code asserts ON offending content (this
 *       file's self-checks craft violations; the csp-spike probe under test/csp-spike
 *       deliberately ships raw probe styles and a committed dist bundle).
 *   OUT packages/design-system/.storybook, storybook-static, visual-regression — catalog
 *       harness wiring, build output, and the Playwright VRT harness: not product UI and
 *       not exemplar code.
 *   OUT packages/design-tokens — the ONE home of literal color values, guarded by its own
 *       gates (purity/completeness/contrast/golden files); it is simply not globbed here.
 *
 * Scanning is RAW-LINE based, comments included: an off-token literal in a comment is one
 * copy-paste away from production. If a comment must cite a banned form, use the escape.
 *
 * THE ESCAPE: a line carrying a block comment of the form "fitness-allow: <justification>"
 * (slash-star comment in TS/CSS, `<!-- fitness-allow: ... -->` in Svelte markup) is exempt —
 * but the justification must be non-empty, the line must actually trip a rule (no stale
 * escapes), and every allowance must be listed in EXPECTED_ALLOWANCES below, so adding one
 * is a reviewed test edit, never silent.
 */

const REPOSITORY_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

/** Sweep roots, relative to the repository root, with the extensions swept there. */
const SWEEP_ROOTS: ReadonlyArray<{ root: string; extensions: readonly string[] }> = [
  { root: "apps/web/src", extensions: [".svelte", ".ts", ".css"] },
  { root: "packages/design-system/src", extensions: [".svelte", ".ts", ".css"] },
];

/**
 * The allowance inventory. Each entry is `<repository-relative path> — <justification>`.
 * Empty today and expected to stay near-empty: an addition is a reviewed, justified edit.
 */
const EXPECTED_ALLOWANCES: readonly string[] = [];

// --- the scanners -------------------------------------------------------------------------

/**
 * Rule 1 — Tailwind arbitrary values: any `<utility>-[...]` form. Before matching, the
 * line is stripped of `data-[...]` / `aria-[...]` (optionally `group-`/`peer-`-prefixed)
 * constructs: those are Tailwind's first-class data/aria-attribute VARIANTS — they select
 * on element state, carry no design value, and the house presence pattern
 * (src/lib/internal/floating.ts, `data-[state=open]:...`) is built on them. Every other
 * bracket form — arbitrary values (`p-[13px]`), arbitrary breakpoints (`min-[800px]:`),
 * arbitrary properties — stays banned.
 */
const TAILWIND_ARBITRARY_VALUE_PATTERN = /\b[\w-]+-\[[^\]]+\]/g;
const DATA_OR_ARIA_VARIANT_PATTERN = /\b(?:group-|peer-)?(?:data|aria)-\[[^\]]+\]/g;

/**
 * Rule 2a — raw hex color literals. Exact hex lengths (3, 4, 6, 8) with a trailing
 * non-word guard, so identifier-ish fragments (`#default`, Svelte's `{#each}`, an
 * `href="#main"` anchor) never match: a hex prefix of a longer word fails the lookahead.
 */
const RAW_HEX_COLOR_PATTERN = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![\w-])/g;

/**
 * Rule 2b — raw color-function literals. `var(--mc-...)` token references do not match —
 * they are the REQUIRED form. packages/design-tokens (where these literals legitimately
 * live) is outside the sweep entirely.
 */
const RAW_COLOR_FUNCTION_PATTERN = /\b(?:rgba?|hsla?|oklch|oklab)\(/g;

/** Rule 3 — raw z-index numerals. The token z-scale (z-dropdown ... z-toast) is the only z home. */
const RAW_Z_INDEX_NUMERAL_PATTERN = /\bz-\d+\b/g;

/** Rule 4 — raw transition-duration numerals. duration-instant|fast|normal|slow only. */
const RAW_DURATION_NUMERAL_PATTERN = /\bduration-\d+\b/g;

/**
 * Rule 5 — emojis (golden rule 2). The pictographic ranges only: the emoji supplementary planes
 * (U+1F000–1FAFF) and Miscellaneous Symbols (U+2600–26FF). An emoji always carries a base in one of
 * these ranges, so the U+FE0F variation selector is not part of the class (a combining char in a
 * character class is misleading, and the base is already matched). Arrows and the dingbat ✕ are
 * excluded — the codebase uses them as plain text symbols in comments, and they are not emoji.
 */
const EMOJI_PATTERN = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}]/gu;

interface RuleMatch {
  readonly rule: string;
  readonly match: string;
}

/** Run every off-token scanner over one line; returns each offending match with its rule. */
export function findOffTokenMatches(line: string): RuleMatch[] {
  const matches: RuleMatch[] = [];
  const lineWithoutStateVariants = line.replace(DATA_OR_ARIA_VARIANT_PATTERN, "");
  for (const hit of lineWithoutStateVariants.matchAll(TAILWIND_ARBITRARY_VALUE_PATTERN)) {
    matches.push({ rule: "tailwind-arbitrary-value", match: hit[0] });
  }
  for (const hit of line.matchAll(RAW_HEX_COLOR_PATTERN)) {
    matches.push({ rule: "raw-hex-color", match: hit[0] });
  }
  for (const hit of line.matchAll(RAW_COLOR_FUNCTION_PATTERN)) {
    matches.push({ rule: "raw-color-function", match: hit[0] });
  }
  for (const hit of line.matchAll(RAW_Z_INDEX_NUMERAL_PATTERN)) {
    matches.push({ rule: "raw-z-index-numeral", match: hit[0] });
  }
  for (const hit of line.matchAll(RAW_DURATION_NUMERAL_PATTERN)) {
    matches.push({ rule: "raw-duration-numeral", match: hit[0] });
  }
  for (const hit of line.matchAll(EMOJI_PATTERN)) {
    matches.push({ rule: "emoji", match: hit[0] });
  }
  return matches;
}

// --- the escape ---------------------------------------------------------------------------

const FITNESS_ALLOW_ESCAPE_PATTERN = /(?:\/\*|<!--)\s*fitness-allow:([^]*?)(?:\*\/|-->)/;

interface FileScanResult {
  /** Formatted `file:line [rule] match` strings — the failure currency of this suite. */
  readonly violations: string[];
  /** Formatted `file — justification` strings, asserted against EXPECTED_ALLOWANCES. */
  readonly allowances: string[];
}

/**
 * Scan one file line by line. A `fitness-allow` escape exempts its line, but the escape
 * itself is policed: an empty justification is a violation, and so is a STALE escape (a
 * line that trips no rule once the escape comment is removed) — escapes must never
 * accumulate as dead permissions.
 */
export function scanFileContent(filePath: string, content: string): FileScanResult {
  const violations: string[] = [];
  const allowances: string[] = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const lineNumber = index + 1;
    const escape = FITNESS_ALLOW_ESCAPE_PATTERN.exec(line);
    const effectiveLine = escape
      ? line.replace(new RegExp(FITNESS_ALLOW_ESCAPE_PATTERN.source, "g"), "")
      : line;
    const matches = findOffTokenMatches(effectiveLine);
    if (escape) {
      const justification = (escape[1] ?? "").trim();
      if (justification === "") {
        violations.push(
          `${filePath}:${lineNumber} [fitness-allow] the escape requires a non-empty justification`,
        );
      } else if (matches.length === 0) {
        violations.push(
          `${filePath}:${lineNumber} [fitness-allow] stale escape — the line trips no rule; remove it`,
        );
      } else {
        allowances.push(`${filePath} — ${justification}`);
      }
      continue;
    }
    for (const { rule, match } of matches) {
      violations.push(`${filePath}:${lineNumber} [${rule}] ${match}`);
    }
  }
  return { violations, allowances };
}

// --- the sweep ----------------------------------------------------------------------------

const sweptFiles: string[] = SWEEP_ROOTS.flatMap(({ root, extensions }) =>
  collectSourceFiles(join(REPOSITORY_ROOT, root), { extensions }).map(
    (relativePath) => `${root}/${relativePath}`,
  ),
);

describe("off-token sweep surface (vacuity guard)", () => {
  it("finds the files the gate exists to police", () => {
    // An empty or misrooted sweep would pass every assertion below vacuously.
    expect(sweptFiles).toContain("apps/web/src/lib/components/app-shell.svelte");
    expect(sweptFiles).toContain("apps/web/src/app.css");
    expect(sweptFiles).toContain("packages/design-system/src/lib/internal/floating.ts");
    expect(sweptFiles).toContain("packages/design-system/src/lib/styles/components.css");
    expect(sweptFiles).toContain("packages/design-system/src/stories/design-tokens.stories.svelte");
    expect(sweptFiles.length).toBeGreaterThanOrEqual(10);
  });
});

describe("no off-token values in the UI sources (golden rule 2)", () => {
  it.each(sweptFiles)("%s contains no off-token values", (file) => {
    const content = readFileSync(join(REPOSITORY_ROOT, file), "utf8");
    expect(scanFileContent(file, content).violations).toEqual([]);
  });

  it("the fitness-allow inventory matches EXPECTED_ALLOWANCES exactly", () => {
    // Every escape in the tree must be listed here — adding one is a reviewed test edit.
    const allowances = sweptFiles
      .flatMap((file) => {
        const content = readFileSync(join(REPOSITORY_ROOT, file), "utf8");
        return scanFileContent(file, content).allowances;
      })
      .sort();
    expect(allowances).toEqual([...EXPECTED_ALLOWANCES].sort());
  });
});

// --- self-checks: the scanners themselves catch crafted violations (house pattern, --------
// --- see packages/design-tokens/test/purity.test.ts) ---------------------------------------

describe("the off-token scanners catch crafted violations (self-check)", () => {
  it("flags Tailwind arbitrary values", () => {
    const rules = (line: string) => findOffTokenMatches(line).map((violation) => violation.rule);
    expect(rules('<div class="p-[13px]">')).toContain("tailwind-arbitrary-value");
    expect(rules('class="bg-[#fff]"')).toContain("tailwind-arbitrary-value");
    expect(rules('"duration-[150ms] ease-standard"')).toContain("tailwind-arbitrary-value");
    expect(rules('class="min-[800px]:flex"')).toContain("tailwind-arbitrary-value");
  });

  it("exempts data/aria state variants but not the values they prefix", () => {
    // The house presence pattern (floating.ts) — variants select state, no design value.
    expect(findOffTokenMatches('"data-[state=open]:opacity-100"')).toEqual([]);
    expect(findOffTokenMatches('"group-data-[state=closed]:scale-95"')).toEqual([]);
    expect(findOffTokenMatches('"aria-[expanded=true]:bg-surface-raised"')).toEqual([]);
    // ...but an arbitrary VALUE behind a state variant is still caught.
    expect(
      findOffTokenMatches('"data-[state=open]:p-[3px]"').map((violation) => violation.rule),
    ).toContain("tailwind-arbitrary-value");
  });

  it("flags raw hex colors at every legal hex length, with no identifier false positives", () => {
    const rules = (line: string) => findOffTokenMatches(line).map((violation) => violation.rule);
    expect(rules("color: #fff;")).toContain("raw-hex-color");
    expect(rules("#fffa")).toContain("raw-hex-color");
    expect(rules("background: #2563eb;")).toContain("raw-hex-color");
    expect(rules("#2563eb80")).toContain("raw-hex-color");
    // Non-hex words, Svelte block tags, and anchor fragments must NOT match.
    expect(findOffTokenMatches("{#each items as item}")).toEqual([]);
    expect(findOffTokenMatches('querySelector("#main-content")')).toEqual([]);
    expect(findOffTokenMatches('href="#defaults"')).toEqual([]);
  });

  it("flags raw color functions but not var(--mc-...) token references", () => {
    const rules = (line: string) => findOffTokenMatches(line).map((violation) => violation.rule);
    expect(rules("rgb(0, 0, 0)")).toContain("raw-color-function");
    expect(rules("rgba(0 0 0 / 0.5)")).toContain("raw-color-function");
    expect(rules("hsl(220 14% 96%)")).toContain("raw-color-function");
    expect(rules("oklch(0.55 0.15 250)")).toContain("raw-color-function");
    expect(rules("oklab(0.5 0.1 0.1)")).toContain("raw-color-function");
    expect(findOffTokenMatches("color: var(--mc-color-text-default);")).toEqual([]);
  });

  it("flags raw z-index and duration numerals but not the token scales", () => {
    const rules = (line: string) => findOffTokenMatches(line).map((violation) => violation.rule);
    expect(rules('class="z-50"')).toContain("raw-z-index-numeral");
    expect(rules('"duration-150"')).toContain("raw-duration-numeral");
    expect(findOffTokenMatches('"z-modal z-dropdown z-toast"')).toEqual([]);
    expect(findOffTokenMatches('"duration-fast duration-normal"')).toEqual([]);
  });

  it("flags pictographic emojis but not the text symbols the codebase uses", () => {
    const rules = (line: string) => findOffTokenMatches(line).map((violation) => violation.rule);
    expect(rules("// celebrate 🎉")).toContain("emoji");
    expect(rules("const rocket = '🚀';")).toContain("emoji");
    expect(rules("warning ⚠️ here")).toContain("emoji"); // U+26A0 + U+FE0F
    // Arrows and the dingbat X are plain text symbols the codebase uses in comments — NOT emoji.
    expect(findOffTokenMatches("schema → data-access → API")).toEqual([]);
    expect(findOffTokenMatches("the corner ✕ dismiss")).toEqual([]);
  });

  it("reports file, line number, rule, and the offending match", () => {
    const { violations } = scanFileContent("crafted/example.svelte", '<div class="p-[13px]">');
    expect(violations).toEqual(["crafted/example.svelte:1 [tailwind-arbitrary-value] p-[13px]"]);
  });

  it("honors a justified fitness-allow escape and records the allowance", () => {
    const content = 'const probe = "bg-[red]"; /* fitness-allow: crafted probe for a test */';
    const { violations, allowances } = scanFileContent("crafted/example.ts", content);
    expect(violations).toEqual([]);
    expect(allowances).toEqual(["crafted/example.ts — crafted probe for a test"]);
  });

  it("honors the Svelte-markup escape form", () => {
    const content = '<div class="p-[13px]"><!-- fitness-allow: crafted probe for a test -->';
    const { violations, allowances } = scanFileContent("crafted/example.svelte", content);
    expect(violations).toEqual([]);
    expect(allowances).toHaveLength(1);
  });

  it("rejects a fitness-allow escape with an empty justification", () => {
    const { violations } = scanFileContent("crafted/example.ts", '"z-50" /* fitness-allow: */');
    expect(violations).toEqual([
      "crafted/example.ts:1 [fitness-allow] the escape requires a non-empty justification",
    ]);
  });

  it("rejects a stale fitness-allow escape on a line that trips no rule", () => {
    const content = 'const clean = "z-modal"; /* fitness-allow: left over from a refactor */';
    const { violations, allowances } = scanFileContent("crafted/example.ts", content);
    expect(allowances).toEqual([]);
    expect(violations).toEqual([
      "crafted/example.ts:1 [fitness-allow] stale escape — the line trips no rule; remove it",
    ]);
  });
});
