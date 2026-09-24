import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertCreateNoun,
  CREATE_BARE_LABEL,
  CREATE_NOUN_MAX_LENGTH,
  createLabel,
} from "../src/lib/components/create-control/create-label.ts";

/*
 * CreateControl's package-local contract: the one label grammar every create control speaks, and
 * the two facts the fixed width rests on — the width is a token, and the recipe holds it rather
 * than fitting the label. What is rendered belongs to the stories.
 */

const PACKAGE_ROOT = join(import.meta.dirname, "..");

describe("the create label grammar", () => {
  it('reads "New" and the noun, or the bare verb with no noun', () => {
    expect(createLabel("Fee")).toBe("New Fee");
    expect(createLabel("Matter")).toBe("New Matter");
    expect(CREATE_BARE_LABEL).toBe("New");
  });

  it("takes one capitalised word within the budget and nothing else", () => {
    for (const noun of ["Fee", "Cost", "File", "Matter", "Packet", "Party", "Template"]) {
      expect(() => assertCreateNoun(noun)).not.toThrow();
      expect(noun.length).toBeLessThanOrEqual(CREATE_NOUN_MAX_LENGTH);
    }
    expect(() => assertCreateNoun("New Folder")).toThrow(/one capitalised word/u);
    expect(() => assertCreateNoun("matter")).toThrow(/one capitalised word/u);
    // Nine characters is the first length the measured width cannot hold.
    expect(() => assertCreateNoun("Agreement")).toThrow(/fixed width holds 8/u);
  });

  it("refuses the noun rather than letting a screen widen the control for itself", () => {
    // The refusal names the shared token, because the tempting fix is the wrong one: the width is
    // one value on every screen, and a screen that stretched it for its own label would move the
    // control on all of them. The budget moved once, for "New Template", and moved the token with
    // it — that is a measurement, not a screen opting out.
    expect(() => assertCreateNoun("Correspondence")).toThrow(/one token shared by every screen/u);
  });
});

describe("the width is a token the recipe holds", () => {
  it("is declared once in the tokens and read by the recipe, never fitted to the label", () => {
    const recipe = readFileSync(
      join(PACKAGE_ROOT, "src/lib/components/create-control/create-control.css"),
      "utf8",
    );
    expect(recipe).toMatch(/inline-size:\s*var\(--mc-size-create-control\)/u);
    expect(recipe).toMatch(/text-overflow:\s*ellipsis/u);
    expect(recipe).not.toMatch(/inline-size:\s*(?:auto|fit-content|max-content)/u);

    const tokens = readFileSync(
      join(PACKAGE_ROOT, "../design-tokens/generated/tokens.css"),
      "utf8",
    );
    expect(tokens).toMatch(/--mc-size-create-control:\s*\d+px;/u);
  });

  it("is imported by the recipe index after the button it dresses", () => {
    const index = readFileSync(join(PACKAGE_ROOT, "src/lib/styles/components.css"), "utf8");
    const button = index.indexOf("button/button.css");
    const control = index.indexOf("create-control/create-control.css");
    expect(button).toBeGreaterThanOrEqual(0);
    expect(control).toBeGreaterThan(button);
  });
});
