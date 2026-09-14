/*
 * NavigationLayout's contract, pinned where the browser story cannot reach it: that the two widths
 * are TOKENS and not arithmetic, that the recipe is what makes the columns scroll and reserve their
 * gutter, that the component imposes no list structure on the navigation (snippets only — an
 * `items` prop is the failure this component exists to refuse), and that the recipe and the export
 * path are both registered, since a component the stylesheet does not import renders unstyled and
 * one the package does not export cannot be adopted.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = join(import.meta.dirname, "..");
const HOME = join(PACKAGE_ROOT, "src/lib/components/navigation-layout");

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

/** The declarations of one recipe block, by its selector, from a stylesheet. */
function declarationsOf(css: string, selector: string): string[] {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return [];
  const body = css.slice(start + selector.length + 2, css.indexOf("}", start));
  return body
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration !== "");
}

const recipe = read(join(HOME, "navigation-layout.css"));
const component = read(join(HOME, "navigation-layout.svelte"));

describe("the navigation column's two widths are tokens, not arithmetic", () => {
  it("sizes the content box to the popover measure and pads it with the standard gutter", () => {
    const navigation = declarationsOf(recipe, ".mc-navigation-layout-navigation");
    expect(navigation).toContain("box-sizing: content-box");
    expect(navigation).toContain("inline-size: var(--mc-size-popover)");
    expect(navigation).toContain("padding: var(--mc-space-24)");
  });

  it("narrows by the gutter alone", () => {
    expect(declarationsOf(recipe, ".mc-navigation-layout-navigation-narrow")).toEqual([
      "padding-inline: var(--mc-space-16)",
    ]);
  });

  it("carries no calc and no literal length", () => {
    expect(recipe).not.toContain("calc(");
    expect(recipe).not.toMatch(/\b\d+(px|rem|em|%)/);
  });
});

describe("the columns scroll independently with a reserved gutter", () => {
  it.each([".mc-navigation-layout-navigation", ".mc-navigation-layout-content-scrolling"])(
    "%s scrolls and reserves its gutter",
    (selector) => {
      const declarations = declarationsOf(recipe, selector);
      expect(declarations).toContain("overflow-y: auto");
      expect(declarations).toContain("scrollbar-gutter: stable");
    },
  );

  it("names the house scrollbar on every element the recipe or a utility makes scroll", () => {
    // The root scrolls only in the stacked (narrow-viewport) state; the two columns at every width.
    const classExpressions = [...component.matchAll(/class=\{mergeClasses\(([\s\S]*?)\)\}/g)].map(
      ([, expression]) => expression,
    );
    expect(classExpressions).toHaveLength(3);
    for (const expression of classExpressions) {
      expect(expression).toContain("mc-scrollbar");
    }
  });
});

describe("the navigation is a named landmark that holds whatever the consumer draws", () => {
  it("renders a <nav> whose accessible name is the required prop", () => {
    expect(component).toMatch(/<nav\s[\s\S]*?aria-label=\{navigationLabel\}/);
    expect(component).toMatch(/navigationLabel: string;/);
  });

  it("takes the navigation and the content as snippets and imposes no list of its own", () => {
    expect(component).toMatch(/navigation: Snippet;/);
    expect(component).toMatch(/children: Snippet;/);
    expect(component).not.toMatch(/\bitems\??:/);
    expect(component).not.toMatch(/<(ul|ol|li)\b/);
  });
});

describe("registration", () => {
  it("the stylesheet imports the recipe", () => {
    expect(read(join(PACKAGE_ROOT, "src/lib/styles/components.css"))).toContain(
      '@import "../components/navigation-layout/navigation-layout.css";',
    );
  });

  it("the package exports the component at ./navigation-layout", () => {
    const manifest = JSON.parse(read(join(PACKAGE_ROOT, "package.json"))) as {
      exports: Record<string, string>;
    };
    expect(manifest.exports["./navigation-layout"]).toBe(
      "./src/lib/components/navigation-layout/index.ts",
    );
  });
});
