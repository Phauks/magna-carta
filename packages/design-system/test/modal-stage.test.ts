import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The modal stage, pinned at the source: the box every windowed modal panel is centred in, and the
 * reason no panel touches the edge of the screen. A rendered panel shows the gutter only on a
 * screen short enough to need it, which is exactly the screen a reviewer's monitor is not, so the
 * mechanism is asserted here where a laptop is not required to see it.
 */

const LIB = join(import.meta.dirname, "../src/lib");
const read = (relative: string): string => readFileSync(join(LIB, relative), "utf8");

describe("the modal stage", () => {
  const stage = read("styles/recipes/modal-stage.css");

  it("pulls in from every screen edge by the gutter token, and drops it when the panel is expanded", () => {
    expect(stage).toMatch(/\.mc-modal-stage \{[^}]*inset: var\(--mc-size-modal-gutter\);/);
    expect(stage).toMatch(
      /\.mc-modal-stage:has\(> \[data-expanded="true"\]\) \{[^}]*inset: var\(--mc-space-0\);/,
    );
  });

  it("centres its panel with flex, which is also what caps a panel taller than the screen", () => {
    expect(stage).toMatch(/\.mc-modal-stage \{[^}]*display: flex;/);
    expect(stage).toMatch(/\.mc-modal-stage \{[^}]*flex-direction: column;/);
    expect(stage).toMatch(/\.mc-modal-stage \{[^}]*pointer-events: none;/);
  });

  it("is in the cascade before the panels it holds", () => {
    const components = read("styles/components.css");
    expect(components.indexOf("./recipes/modal-stage.css")).toBeGreaterThan(-1);
    expect(components.indexOf("./recipes/modal-stage.css")).toBeLessThan(
      components.indexOf("../components/dialog/dialog.css"),
    );
  });
});

describe.each([
  [
    "Dialog",
    "components/dialog/dialog-content.svelte",
    "components/dialog/dialog.css",
    "mc-dialog-content",
  ],
  [
    "AlertDialog",
    "components/alert-dialog/alert-dialog-content.svelte",
    "components/alert-dialog/alert-dialog.css",
    "mc-alert-dialog-content",
  ],
])("%s's panel", (_name, shellPath, recipePath, recipeClass) => {
  const shell = read(shellPath);
  const recipe = read(recipePath);

  it("renders inside the stage, which carries the modal z-layer so the panel paints above the scrim", () => {
    expect(shell).toMatch(/class=\{mergeClasses\(Z_LAYER_CLASSES\.modal, "mc-modal-stage"\)\}/);
  });

  it("wears a width cap and no height cap: the stage is the height cap", () => {
    expect(shell).toMatch(/w-full max-w-lg/);
    expect(shell).not.toMatch(/max-h-screen/);
  });

  it("is a shrinkable flex item that keeps its own content height when it fits", () => {
    const rule = recipe.slice(recipe.indexOf(`.${recipeClass} {`));
    const block = rule.slice(0, rule.indexOf("}"));
    expect(block).toContain("position: relative;");
    expect(block).toContain("pointer-events: auto;");
    expect(block).toContain("block-size: fit-content;");
    expect(block).toContain("min-block-size: var(--mc-space-0);");
    expect(block).not.toContain("position: fixed;");
  });
});

describe("the record window's windowed size", () => {
  it("names a width cap only, and leaves the height to the stage", () => {
    const window = read("components/record-window/record-window.svelte");
    expect(window).toContain('expansion.panelClasses("w-full max-w-record-window")');
    expect(window).not.toContain("max-h-screen");
  });
});
