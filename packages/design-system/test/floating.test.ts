import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FLOATING_WRAPPER_RULE,
  floatingContentClasses,
  PRESENCE_FADE,
  Z_LAYER_CLASSES,
} from "../src/lib/internal/floating.ts";

/*
 * The floating z-scale is class STRINGS, so these tests verify them against the
 * same source of truth the browser will: the generated Tailwind theme in
 * @magna-carta/design-tokens (the pattern merge-classes.test.ts established). A
 * z-layer utility that names a token the theme does not emit would silently
 * produce no CSS — that is the failure mode this suite makes loud. (The presence
 * recipes — PRESENCE_FADE / PRESENCE_SCALE_FADE — are now plain recipe class
 * names whose token purity is covered by the components.css/animations.css
 * fitness gates, so they need no string-composition checks here.)
 */

const GENERATED_THEME_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "design-tokens",
  "generated",
  "tailwind-theme.css",
);

/** Token names emitted under one `--<namespace>-*` prefix in the generated theme. */
function themeTokens(css: string, namespace: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of css.matchAll(new RegExp(`^\\s*--${namespace}-([a-z0-9-]+)\\s*:`, "gm"))) {
    tokens.add(match[1] as string);
  }
  return tokens;
}

const generatedTheme = readFileSync(GENERATED_THEME_PATH, "utf8");
const zIndexTokens = themeTokens(generatedTheme, "z-index");

describe("source-of-truth wiring (vacuity guards)", () => {
  it("the generated theme emits the z-index token namespace", () => {
    // If this set were empty, the membership assertions below would be
    // unreachable-vacuous rather than failing — guard the parse itself.
    expect(zIndexTokens.size).toBeGreaterThan(0);
  });
});

describe("Z_LAYER_CLASSES — the token z-scale", () => {
  it("covers exactly the floating layers, in stacking order", () => {
    expect(Object.keys(Z_LAYER_CLASSES)).toEqual([
      "dropdown",
      "sticky",
      "overlay",
      "modal",
      "toast",
    ]);
  });

  it.each(Object.entries(Z_LAYER_CLASSES))(
    "%s maps to a z-* utility whose token the generated theme emits",
    (layer, utility) => {
      expect(utility).toBe(`z-${layer}`);
      expect(
        zIndexTokens.has(layer),
        `--z-index-${layer} is missing from the generated theme — the ${utility} utility would emit no CSS`,
      ).toBe(true);
    },
  );
});

describe("floatingContentClasses", () => {
  it("composes the z-layer utility with presence classes and caller classes", () => {
    const composed = floatingContentClasses("modal", PRESENCE_FADE, "p-8");
    expect(composed).toContain("z-modal");
    for (const presenceClass of PRESENCE_FADE.split(" ")) {
      expect(composed).toContain(presenceClass);
    }
    expect(composed).toContain("p-8");
  });

  it("dedupes: a caller z-layer override wins over the layer argument", () => {
    // Exercises the tailwind-merge z registration end to end: both classes are
    // token z utilities, so the later one must replace the earlier one.
    const composed = floatingContentClasses("dropdown", Z_LAYER_CLASSES.toast);
    expect(composed).toBe("z-toast");
  });

  it("dedupes conflicting presence durations — the later constant wins", () => {
    const composed = floatingContentClasses("dropdown", "duration-fast", "duration-slow");
    expect(composed.split(" ")).not.toContain("duration-fast");
    expect(composed.split(" ")).toContain("duration-slow");
  });

  it("collapses literal duplicates", () => {
    expect(floatingContentClasses("toast", "p-4", "p-4")).toBe("z-toast p-4");
  });
});

describe("FLOATING_WRAPPER_RULE", () => {
  it("states the two-level rule: wrapperProps element unstyled, styling on the inner element", () => {
    expect(FLOATING_WRAPPER_RULE).toContain("wrapperProps");
    expect(FLOATING_WRAPPER_RULE).toContain("unstyled");
    expect(FLOATING_WRAPPER_RULE).toContain("inner");
  });
});
