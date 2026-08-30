import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeClasses } from "../src/lib/internal/merge-classes.ts";

describe("mergeClasses — clsx + tailwind-merge composition", () => {
  it("merges conflicting utilities; the later class wins", () => {
    expect(mergeClasses("p-2", "p-4")).toBe("p-4");
  });

  it("keeps non-conflicting utilities in input order", () => {
    expect(mergeClasses("p-4", "text-sm")).toBe("p-4 text-sm");
  });

  it("drops falsy and conditional inputs and flattens arrays (clsx semantics)", () => {
    const inactive: boolean = false;
    expect(mergeClasses("a", inactive && "b", undefined, ["c"])).toBe("a c");
    expect(mergeClasses(null, "", { active: false }, { open: true })).toBe("open");
  });
});

/*
 * Token-namespace merging, derived from the REAL generated Tailwind theme.
 *
 * Every `--<namespace>-<token>` variable in @theme/@theme inline becomes a Tailwind
 * utility; tailwind-merge only resolves conflicts between utilities it can classify.
 * A token name outside tailwind-merge's default validators (e.g. shadow-elevation-1,
 * ease-standard, font-regular) silently falls into the wrong class group — or none —
 * and conflicting classes are then BOTH kept. That is the silent-merge footgun this
 * suite guards: it re-derives its cases from the generated file on every run, so a
 * token added to the theme without a matching mergeClasses registration fails loudly.
 */

const GENERATED_THEME_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "design-tokens",
  "generated",
  "tailwind-theme.css",
);

/**
 * Tailwind v4 theme namespaces, longest-prefix-first so compound namespaces
 * (font-weight, inset-shadow, …) win over their prefixes (font, shadow, …).
 * Source: Tailwind v4 theme variable namespace table.
 */
const TAILWIND_THEME_NAMESPACES = [
  "transition-duration",
  "font-weight",
  "inset-shadow",
  "drop-shadow",
  "text-shadow",
  "breakpoint",
  "container",
  "perspective",
  "tracking",
  "z-index",
  "leading",
  "spacing",
  "radius",
  "shadow",
  "color",
  "font",
  "text",
  "blur",
  "aspect",
  "ease",
  "animate",
] as const;

/**
 * For each namespace: how to turn a token name into a representative utility class,
 * and a Tailwind DEFAULT-scale class in the same conflict group. The cross checks
 * against the canonical class are what catch misclassification — two unknown tokens
 * can accidentally land in the same (wrong) group and still merge with each other.
 */
const NAMESPACE_CASES: Record<string, { utility: (token: string) => string; canonical: string }> = {
  color: { utility: (token) => `bg-${token}`, canonical: "bg-transparent" },
  spacing: { utility: (token) => `p-${token}`, canonical: "p-px" },
  radius: { utility: (token) => `rounded-${token}`, canonical: "rounded-xl" },
  shadow: { utility: (token) => `shadow-${token}`, canonical: "shadow-2xl" },
  font: { utility: (token) => `font-${token}`, canonical: "font-serif" },
  "font-weight": { utility: (token) => `font-${token}`, canonical: "font-bold" },
  text: { utility: (token) => `text-${token}`, canonical: "text-base" },
  leading: { utility: (token) => `leading-${token}`, canonical: "leading-none" },
  tracking: { utility: (token) => `tracking-${token}`, canonical: "tracking-widest" },
  // --container-* feeds the `max-w-*` (and `w-*`/`min-w-*`) named widths. The canonical here is a
  // default cap a panel might already be carrying: the whole point of registering the namespace is
  // that a token-fed cap REPLACES it rather than sitting beside it.
  container: { utility: (token) => `max-w-${token}`, canonical: "max-w-lg" },
  ease: { utility: (token) => `ease-${token}`, canonical: "ease-linear" },
  // --transition-duration-* feeds `duration-*` utilities; --z-index-* feeds `z-*`
  // (Tailwind v4 theme-key names, verified against tailwindcss 4.3.0).
  "transition-duration": { utility: (token) => `duration-${token}`, canonical: "duration-150" },
  "z-index": { utility: (token) => `z-${token}`, canonical: "z-50" },
};

function parseThemeTokensByNamespace(css: string): Map<string, string[]> {
  const tokensByNamespace = new Map<string, string[]>();
  for (const match of css.matchAll(/^\s*--([a-z][a-z0-9-]*)\s*:/gm)) {
    const variableName = match[1] as string;
    const namespace = TAILWIND_THEME_NAMESPACES.find(
      (candidate) => variableName === candidate || variableName.startsWith(`${candidate}-`),
    );
    if (namespace === undefined) {
      throw new Error(
        `Theme variable --${variableName} matches no known Tailwind v4 namespace — ` +
          `extend TAILWIND_THEME_NAMESPACES (and the mergeClasses configuration) for it.`,
      );
    }
    const token = variableName.slice(namespace.length + 1);
    if (token === "") continue; // bare namespace variable (no utility suffix to merge on)
    const tokens = tokensByNamespace.get(namespace) ?? [];
    tokens.push(token);
    tokensByNamespace.set(namespace, tokens);
  }
  return tokensByNamespace;
}

const tokensByNamespace = parseThemeTokensByNamespace(readFileSync(GENERATED_THEME_PATH, "utf8"));

describe("mergeClasses — token namespaces from the generated Tailwind theme", () => {
  it("found theme namespaces to derive cases from (the generated file is non-empty)", () => {
    expect(tokensByNamespace.size).toBeGreaterThan(0);
  });

  for (const [namespace, tokens] of tokensByNamespace) {
    const namespaceCase = NAMESPACE_CASES[namespace];

    it(`has a merge case for the "${namespace}" namespace`, () => {
      expect(
        namespaceCase,
        `the generated theme defines --${namespace}-* tokens but this suite has no case for ` +
          `that namespace — register it in mergeClasses and add it to NAMESPACE_CASES`,
      ).toBeDefined();
    });
    if (namespaceCase === undefined) continue;
    const { utility, canonical } = namespaceCase;

    const [firstToken, secondToken] = tokens;
    if (firstToken !== undefined && secondToken !== undefined) {
      it(`merges two conflicting "${namespace}" token utilities (later wins)`, () => {
        expect(mergeClasses(utility(firstToken), utility(secondToken))).toBe(utility(secondToken));
      });
    }

    for (const token of tokens) {
      it(`classifies ${utility(token)} into the same group as ${canonical} (token first)`, () => {
        expect(mergeClasses(utility(token), canonical)).toBe(canonical);
      });
      it(`classifies ${utility(token)} into the same group as ${canonical} (token last)`, () => {
        expect(mergeClasses(canonical, utility(token))).toBe(utility(token));
      });
    }
  }
});
