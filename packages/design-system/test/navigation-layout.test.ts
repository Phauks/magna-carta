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

/*
 * The row is the part of this component that three screens had each drawn by hand. What a test can
 * hold about it is the shape of the decision: that the element follows from `href` and nothing
 * else, that every treatment is recipe (so a screen cannot carry a treatment of its own again), and
 * that the name is never truncated — the wrap is the reason the part exists rather than a class
 * string copied between two columns.
 */
const rowRecipe = read(join(HOME, "navigation-layout-row.css"));
const row = read(join(HOME, "navigation-layout-row.svelte"));
// The recipes explain themselves at length, and a comment saying "there is no `white-space: nowrap`
// here" must not read to a test as the declaration it is denying.
const rowDeclarations = rowRecipe.replaceAll(/\/\*[\s\S]*?\*\//g, "");
/** The branch that draws an entry with nowhere to go, on its own. */
const unreachableBranch = row.slice(
  row.indexOf("{:else if href === null}"),
  row.lastIndexOf("{:else}"),
);

describe("the row's element follows from href, and the part decides nothing else", () => {
  it("renders an anchor for a destination, a button for an act, and a plain row for nowhere", () => {
    expect(row).toMatch(/\{#if typeof href === "string"\}[\s\S]*?<a\b/);
    expect(row).toMatch(/\{:else if href === null\}[\s\S]*?<span\b/);
    expect(row).toMatch(/\{:else\}[\s\S]*?<button\b/);
  });

  it("says which row is current to a screen reader as well as to the eye", () => {
    expect(row).toContain('aria-current={current ? "page" : undefined}');
    expect(row).toContain('data-current={current ? "true" : undefined}');
  });

  it("marks the row with nowhere to go, and never dresses it as a disabled control", () => {
    expect(unreachableBranch).toContain('aria-disabled="true"');
    expect(unreachableBranch).not.toMatch(/(?<!aria-)\bdisabled\b/);
  });
});

describe("every one of the row's three treatments is in the recipe", () => {
  it("rests muted, tints on hover, and lights the current row with the gilt start-edge bar", () => {
    expect(declarationsOf(rowRecipe, ".mc-navigation-layout-row")).toContain(
      "color: var(--mc-text-muted)",
    );
    expect(
      declarationsOf(rowRecipe, '.mc-navigation-layout-row:not([aria-disabled="true"]):hover'),
    ).toContain("background-color: var(--mc-surface-raised)");
    const current = declarationsOf(rowRecipe, '.mc-navigation-layout-row[data-current="true"]');
    expect(current).toContain("background-color: var(--mc-surface-selected)");
    expect(current).toContain("font-weight: var(--mc-weight-medium)");
    expect(current.join(" ")).toContain("box-shadow: inset");
    expect(current.join(" ")).toContain("var(--mc-accent-default)");
  });

  it("holds the control height as a MINIMUM and never stops the name wrapping", () => {
    expect(declarationsOf(rowRecipe, ".mc-navigation-layout-row")).toContain(
      "min-block-size: var(--mc-control-sm)",
    );
    expect(rowDeclarations).not.toContain("white-space:");
    expect(rowDeclarations).not.toContain("text-overflow:");
    expect(row).not.toContain("truncate");
  });

  it("carries no calc and no literal length", () => {
    expect(rowDeclarations).not.toContain("calc(");
    expect(rowDeclarations).not.toMatch(/\b\d+(px|rem|em|%)/);
  });
});

describe("the row is registered beside the layout it belongs to", () => {
  it("the stylesheet imports the row's recipe", () => {
    expect(read(join(PACKAGE_ROOT, "src/lib/styles/components.css"))).toContain(
      '@import "../components/navigation-layout/navigation-layout-row.css";',
    );
  });

  it("the entry exports the row under both the bare and the prefixed name", () => {
    const index = read(join(HOME, "index.ts"));
    expect(index).toContain('export { default as Row } from "./navigation-layout-row.svelte";');
    expect(index).toContain(
      'export { default as NavigationLayoutRow } from "./navigation-layout-row.svelte";',
    );
    // The default export came first and every consumer imports the layout that way.
    expect(index).toContain('export { default } from "./navigation-layout.svelte";');
  });
});
