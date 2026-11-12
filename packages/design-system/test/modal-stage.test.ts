import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODAL_PLACEMENT,
  MODAL_PLACEMENT_ATTRIBUTE,
} from "../src/lib/internal/modal-placement.ts";

/*
 * The modal stage, pinned at the source: the box every modal panel is centred in, the placement
 * rules that make a panel its well-behaved child, and the two shells rendering inside it. A rendered
 * panel shows the gutter only on a screen short enough to need it, which is exactly the screen a
 * reviewer's monitor is not; the browser measurement lives in modal-geometry/, and this is the
 * structure it relies on.
 */

const LIB = join(import.meta.dirname, "../src/lib");
const read = (relative: string): string => readFileSync(join(LIB, relative), "utf8");
const ruleOf = (css: string, selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} is declared`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
};

describe("the stage recipe", () => {
  const recipe = read("styles/recipes/modal-stage.css");

  it("pulls in from every screen edge by the gutter token, and drops it when the panel is expanded", () => {
    expect(ruleOf(recipe, ".mc-modal-stage")).toContain("inset: var(--mc-size-modal-gutter);");
    expect(ruleOf(recipe, '.mc-modal-stage:has(> [data-expanded="true"])')).toContain(
      "inset: var(--mc-space-0);",
    );
  });

  it("centres its panel with flex, which is also what caps a panel taller than the screen", () => {
    const stage = ruleOf(recipe, ".mc-modal-stage");
    expect(stage).toContain("display: flex;");
    expect(stage).toContain("flex-direction: column;");
    expect(stage).toContain("pointer-events: none;");
  });

  it("owns the panel's placement: positioned, content-height, free to shrink, taking pointer events", () => {
    const panel = ruleOf(recipe, ".mc-modal-panel");
    expect(panel).toContain("position: relative;");
    expect(panel).toContain("pointer-events: auto;");
    expect(panel).toContain("block-size: fit-content;");
    expect(panel).toContain("min-block-size: var(--mc-space-0);");
  });

  it("takes an anchored panel out of the stage's layout and back against the viewport", () => {
    expect(ruleOf(recipe, `.mc-modal-panel[${MODAL_PLACEMENT_ATTRIBUTE}="anchored"]`)).toContain(
      "position: fixed;",
    );
  });

  it("is in the cascade before the panels it holds", () => {
    const components = read("styles/components.css");
    const stageAt = components.indexOf("./recipes/modal-stage.css");
    expect(stageAt).toBeGreaterThan(-1);
    expect(stageAt).toBeLessThan(components.indexOf("../components/dialog/dialog.css"));
  });
});

describe("the stage component", () => {
  const stage = read("internal/modal-stage.svelte");

  it("carries the modal z-layer and the attribute the sweep and the print sheet find it by", () => {
    expect(stage).toContain('data-modal-stage=""');
    expect(stage).toMatch(/class=\{mergeClasses\(Z_LAYER_CLASSES\.modal, "mc-modal-stage"\)\}/);
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

  it("renders inside the shared stage rather than a stage of its own", () => {
    expect(shell).toContain("<ModalStage>");
    expect(shell).toContain("</ModalStage>");
    expect(shell).not.toContain("mc-modal-stage");
  });

  it("carries the placement recipe beside its own look, the scrollbar, a width cap, and no height cap", () => {
    // The scrollbar recipe sits with the other two rather than being left to the panel that opens
    // inside it: this shell declares `overflow-y: auto` in its own CSS, so a panel wearing no
    // recipe wears the operating system's scrollbar the moment its content outgrows the frame.
    expect(shell).toContain(`mc-modal-panel ${recipeClass} mc-scrollbar w-full max-w-lg`);
    expect(shell).not.toMatch(/max-h-screen/);
  });

  it("stamps its placement so a reader of the DOM knows where it sits", () => {
    expect(shell).toContain(`[MODAL_PLACEMENT_ATTRIBUTE]:`);
  });

  it("leaves every placement declaration to the stage recipe", () => {
    const look = ruleOf(recipe, `.${recipeClass}`);
    for (const declaration of [
      "position:",
      "inset:",
      "margin: auto",
      "block-size:",
      "pointer-events:",
    ]) {
      expect(look, `${recipeClass} does not declare ${declaration}`).not.toContain(declaration);
    }
  });
});

describe("the placement axis", () => {
  it("defaults to the stage's centre", () => {
    expect(DEFAULT_MODAL_PLACEMENT).toBe("centered");
    expect(MODAL_PLACEMENT_ATTRIBUTE).toBe("data-modal-placement");
  });
});

describe("the record window's windowed size", () => {
  it("names a width cap only, and leaves the height to the stage", () => {
    const window = read("components/record-window/record-window.svelte");
    expect(window).toContain('expansion.panelClasses("w-full max-w-record-window")');
    expect(window).toContain('expansion.panelClasses("w-full max-w-record-window-wide")');
    expect(window).not.toContain("max-h-screen");
  });
});
