/*
 * The scrollbar gate's own tests. Each states a screen as a string, because the rules are pure and
 * the file system lives in index.mjs.
 */
import { describe, expect, it } from "vitest";
import { auditFile, auditScrollbars, scrollingRecipeClasses } from "./scrollbar.mjs";

/** A recipe file that satisfies the premise, so a test can get to the rule it means to state. */
const RECIPE_SOURCE = ".mc-scrollbar::-webkit-scrollbar { width: 8px; } .mc-scrollbar-hidden { }";

const audit = (source, scrollingClasses = new Set()) =>
  auditFile({ path: "screen.svelte", source, scrollingClasses });

describe("which classes scroll", () => {
  it("reads them out of the design system's own stylesheets", () => {
    const found = scrollingRecipeClasses([
      { path: "modal.css", source: ".mc-modal-frame-pane { overflow-y: auto; display: flex; }" },
      { path: "table.css", source: ".mc-table-scroll { overflow: auto }" },
    ]);
    expect([...found].toSorted()).toEqual(["mc-modal-frame-pane", "mc-table-scroll"]);
  });

  it("does not count a class that only clips", () => {
    const found = scrollingRecipeClasses([
      { path: "frame.css", source: ".mc-modal-frame { overflow: hidden; }" },
    ]);
    expect([...found]).toEqual([]);
  });

  it("does not read a class out of a comment explaining one", () => {
    const found = scrollingRecipeClasses([
      {
        path: "frame.css",
        source: "/* .mc-explained { overflow: auto } */ .mc-real { color: red }",
      },
    ]);
    expect([...found]).toEqual([]);
  });

  it("never registers the recipes themselves", () => {
    const found = scrollingRecipeClasses([
      {
        path: "recipe.css",
        source: ".mc-scrollbar { overflow: auto } .mc-scrollbar-hidden { overflow: auto }",
      },
    ]);
    expect([...found]).toEqual([]);
  });
});

describe("an element that scrolls by utility", () => {
  it("is a problem when it names no recipe", () => {
    const problems = audit(`<div class="min-h-0 flex-1 overflow-y-auto"></div>`);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ line: 1, scroller: "overflow-y-auto", reason: "utility" });
  });

  it("is clean when it names the scrollbar", () => {
    expect(audit(`<div class="mc-scrollbar min-h-0 overflow-y-auto"></div>`)).toEqual([]);
  });

  it("is clean when it hides the scrollbar deliberately", () => {
    expect(audit(`<div class="mc-scrollbar-hidden overflow-x-auto"></div>`)).toEqual([]);
  });

  it("is caught under a variant prefix", () => {
    expect(audit(`<div class="lg:overflow-auto"></div>`)).toHaveLength(1);
  });

  it("ignores the overflow utilities that never draw a scrollbar", () => {
    expect(audit(`<div class="overflow-hidden overflow-x-clip"></div>`)).toEqual([]);
  });
});

describe("an element that scrolls in its own CSS", () => {
  const scrolling = new Set(["mc-modal-frame-pane"]);

  it("is a problem even though the markup says nothing about overflow", () => {
    const problems = audit(`<form class="mc-modal-frame-pane mc-fields"></form>`, scrolling);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ scroller: "mc-modal-frame-pane", reason: "recipe" });
  });

  it("is clean once it names the scrollbar", () => {
    expect(audit(`<form class="mc-modal-frame-pane mc-scrollbar"></form>`, scrolling)).toEqual([]);
  });
});

describe("what counts as one class expression", () => {
  it("takes the whole attribute, so a mergeClasses call is dressed as one region", () => {
    const source = `<div class={mergeClasses("mc-event-rail mc-scrollbar", className, "overflow-auto")}></div>`;
    expect(audit(source)).toEqual([]);
  });

  it("catches a shared class constant outside any attribute", () => {
    const problems = audit(`const PANEL = "aspect-square overflow-y-auto p-12";`);
    expect(problems).toHaveLength(1);
  });

  it("clears that constant when the recipe is in the same string", () => {
    expect(audit(`const PANEL = "mc-scrollbar aspect-square overflow-y-auto";`)).toEqual([]);
  });

  it("reports the line the attribute opens on, not the line the file starts on", () => {
    const problems = audit(`<div>\n  <p></p>\n</div>\n<div\n  class="overflow-auto"\n></div>`);
    expect(problems[0]?.line).toBe(5);
  });
});

describe("what the scan does not read", () => {
  it("ignores a markup comment naming a scroll utility", () => {
    expect(audit(`<!-- the work canvas is overflow-y-auto, dressed by the shell -->`)).toEqual([]);
  });

  it("ignores a block comment naming one", () => {
    expect(audit(`<script>\n/* overflow-auto is what makes it scroll */\n</script>`)).toEqual([]);
  });

  it("ignores a line comment naming one", () => {
    expect(audit(`// a pane with overflow-y-auto scrolls\nconst x = 1;`)).toEqual([]);
  });

  it("does not mistake a URL for a line comment", () => {
    const problems = audit(
      `const help = "https://example.test/x";\nconst PANEL = "overflow-auto";`,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.line).toBe(2);
  });

  it("leaves a class directive alone", () => {
    expect(audit(`<div class:overflow-auto={scrolls}></div>`)).toEqual([]);
  });
});

describe("the premise", () => {
  it("fails on the premise when the recipe class is gone", () => {
    const outcome = auditScrollbars({
      files: [{ path: "screen.svelte", source: `<div class="overflow-auto"></div>` }],
      stylesheets: [],
      recipeSource: ".mc-thin-scrollbar { }",
    });
    expect(outcome.premiseProblem).toContain("mc-scrollbar");
    // No file problems alongside it: the rule has no ground to stand on until the premise is answered.
    expect(outcome.problems).toEqual([]);
  });

  it("scans normally once both recipes are defined", () => {
    const outcome = auditScrollbars({
      files: [{ path: "screen.svelte", source: `<div class="overflow-auto"></div>` }],
      stylesheets: [{ path: "x.css", source: ".mc-pane { overflow-y: auto }" }],
      recipeSource: RECIPE_SOURCE,
    });
    expect(outcome.premiseProblem).toBeUndefined();
    expect(outcome.problems).toHaveLength(1);
    expect(outcome.scrollingClasses).toEqual(["mc-pane"]);
    expect(outcome.regionsSeen).toBe(1);
  });
});
