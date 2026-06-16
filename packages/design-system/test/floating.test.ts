import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FLOATING_WRAPPER_RULE,
  floatingContentClasses,
  PRESENCE_FADE,
  PRESENCE_SCALE_FADE,
  PRESENCE_SLIDE_FROM_BOTTOM,
  PRESENCE_SLIDE_FROM_LEFT,
  PRESENCE_SLIDE_FROM_RIGHT,
  PRESENCE_SLIDE_FROM_TOP,
  Z_LAYER_CLASSES,
} from "../src/lib/internal/floating.ts";

/*
 * The floating/presence pattern is class STRINGS, so these tests verify them
 * against the same source of truth the browser will: the generated Tailwind
 * theme in @magna-carta/design-tokens (the pattern merge-classes.test.ts
 * established). A z-layer or motion utility that names a token the theme does
 * not emit would silently produce no CSS — that is the failure mode this suite
 * makes loud.
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
const durationTokens = themeTokens(generatedTheme, "transition-duration");
const easeTokens = themeTokens(generatedTheme, "ease");

const PRESENCE_CONSTANTS = {
  PRESENCE_FADE,
  PRESENCE_SCALE_FADE,
  PRESENCE_SLIDE_FROM_TOP,
  PRESENCE_SLIDE_FROM_BOTTOM,
  PRESENCE_SLIDE_FROM_LEFT,
  PRESENCE_SLIDE_FROM_RIGHT,
} as const;

describe("source-of-truth wiring (vacuity guards)", () => {
  it("the generated theme emits z-index, duration, and ease token namespaces", () => {
    // If any of these sets were empty, the membership assertions below would be
    // unreachable-vacuous rather than failing — guard the parse itself.
    expect(zIndexTokens.size).toBeGreaterThan(0);
    expect(durationTokens.size).toBeGreaterThan(0);
    expect(easeTokens.size).toBeGreaterThan(0);
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

/*
 * Presence-constant discipline: every class must match the allowlist below —
 * token-named motion utilities (duration-* and ease-* verified against the theme),
 * the transition property selectors, and opacity/scale/translate state targets
 * under data-[state=…] variants. Anything else (arbitrary values like
 * duration-[150ms], raw numeral durations like duration-150, unknown variants)
 * fails the sweep.
 */

/** variant prefixes a presence class may carry (at most one). */
const ALLOWED_VARIANTS = /^(data-\[state=(open|closed)\]|motion-reduce):/;

/** base utilities a presence class may resolve to, beyond theme-checked motion ones. */
const ALLOWED_BASE_UTILITIES = [
  /^transition(-(opacity|transform|colors|none))?$/,
  /^opacity-(0|100)$/,
  /^scale-(95|100)$/,
  /^-?translate-(x|y)-(0|4|8|full)$/, // spacing-token distances (0/4/8), or full = 100% (a panel's own size, for edge-pinned drawers)
];

function classifyPresenceClass(presenceClass: string): { variant: string; base: string } {
  const variantMatch = presenceClass.match(ALLOWED_VARIANTS);
  if (variantMatch === null) return { variant: "", base: presenceClass };
  return { variant: variantMatch[0], base: presenceClass.slice(variantMatch[0].length) };
}

describe.each(Object.entries(PRESENCE_CONSTANTS))("%s", (constantName, constant) => {
  const classes = constant.split(/\s+/).filter((candidate) => candidate.length > 0);

  it("contains the structural reduced-motion gate motion-reduce:transition-none", () => {
    expect(classes).toContain("motion-reduce:transition-none");
  });

  it("declares a transition property, a theme duration, and a theme easing", () => {
    expect(classes.some((candidate) => /^transition(-(opacity|transform))?$/.test(candidate))).toBe(
      true,
    );
    expect(classes.some((candidate) => candidate.startsWith("duration-"))).toBe(true);
    // Easing may be a single base utility OR per-direction under the data-state variants
    // (a drawer decelerates in, accelerates out), so classify away any variant first.
    expect(
      classes.some((candidate) => classifyPresenceClass(candidate).base.startsWith("ease-")),
    ).toBe(true);
  });

  it("styles both data-state targets (open and closed)", () => {
    expect(classes.some((candidate) => candidate.startsWith("data-[state=open]:"))).toBe(true);
    expect(classes.some((candidate) => candidate.startsWith("data-[state=closed]:"))).toBe(true);
  });

  it.each(classes)(
    "class %s is on the token allowlist (no arbitrary values, no raw ms)",
    (presenceClass) => {
      const { base } = classifyPresenceClass(presenceClass);
      expect(base, `variant prefix left an empty utility in "${presenceClass}"`).not.toBe("");
      // No arbitrary values anywhere in the utility itself (the data-[state=…]
      // variant bracket is consumed by classifyPresenceClass above).
      expect(base, `arbitrary value in "${presenceClass}"`).not.toMatch(/[[\]]/);

      if (base.startsWith("duration-")) {
        const token = base.slice("duration-".length);
        expect(
          durationTokens.has(token),
          `duration token "${token}" is not in the generated theme (raw numerals like duration-150 are banned here)`,
        ).toBe(true);
        return;
      }
      if (base.startsWith("ease-")) {
        const token = base.slice("ease-".length);
        expect(easeTokens.has(token), `ease token "${token}" is not in the generated theme`).toBe(
          true,
        );
        return;
      }
      expect(
        ALLOWED_BASE_UTILITIES.some((pattern) => pattern.test(base)),
        `"${presenceClass}" is outside the presence allowlist`,
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
