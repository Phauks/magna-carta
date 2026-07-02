import { APCAcontrast, sRGBtoY } from "apca-w3";
import { converter, parse, wcagContrast } from "culori";
import { describe, expect, it } from "vitest";
import { CONTRAST_PAIRS } from "../src/contrast-pairs.ts";
import { parseGeneratedCss } from "../src/parse-generated-css.ts";

// Accessibility contrast gate: every pairing declared in src/contrast-pairs.ts must clear
// its WCAG 2.2 minimum ratio (1.4.3 text AA = 4.5, 1.4.11 non-text = 3) in every base
// theme-and-mode context of generated/tokens.css. The gate asserts WCAG 2.2 only; APCA Lc
// is computed and reported as an advisory signal (it left the WCAG 3 draft — never asserted).
//
// Semantic variables emit as `var(--mc-<primitive>)` references, so each side is resolved
// by following the var() chain WITHIN the same context block (the primitives are defined in
// the same block) down to a concrete oklch(...) value, then converted to sRGB with culori.
// The base blocks are pre-gamut-mapped to sRGB by Terrazzo, so any channel outside [0, 1]
// by more than floating-point fuzz means that assumption broke — the guard below throws
// rather than silently clamping an out-of-gamut color into a flattering contrast ratio.

const VARIABLE_REFERENCE_PATTERN = /^var\((--[\w-]+)\)$/;

/** Follow a var() chain within one context's variable map to its concrete value. */
function resolveVariable(variables: Record<string, string>, variableName: string): string {
  const visited: string[] = [];
  let current = variableName;
  for (;;) {
    if (visited.includes(current)) {
      throw new Error(
        `var() cycle while resolving ${variableName}: ${[...visited, current].join(" -> ")}`,
      );
    }
    visited.push(current);
    const value = variables[current];
    if (value === undefined) {
      throw new Error(
        `undefined variable ${current} while resolving ${variableName} (chain: ${visited.join(" -> ")})`,
      );
    }
    const reference = VARIABLE_REFERENCE_PATTERN.exec(value);
    if (reference === null) return value;
    current = reference[1] as string;
  }
}

const toSrgb = converter("rgb");

// Base blocks are pre-gamut-mapped by Terrazzo, so conversion to sRGB may only miss [0, 1]
// by floating-point fuzz. Anything beyond this epsilon means that assumption broke.
const CHANNEL_GAMUT_EPSILON = 0.001;

/** Clamp a channel into [0, 1]; throw if it is out of gamut by more than the epsilon. */
function guardChannel(channel: number, color: string, channelName: string): number {
  if (channel < -CHANNEL_GAMUT_EPSILON || channel > 1 + CHANNEL_GAMUT_EPSILON) {
    throw new Error(
      `sRGB channel ${channelName} of "${color}" is ${channel}, outside [0, 1] by more than ` +
        `${CHANNEL_GAMUT_EPSILON} — the base blocks are expected to be pre-gamut-mapped by Terrazzo`,
    );
  }
  return Math.min(1, Math.max(0, channel));
}

/** Parse a concrete CSS color and convert it to sRGB channels in 0–1 (epsilon-guarded). */
function parseToSrgbChannels(cssColor: string): [number, number, number] {
  const parsed = parse(cssColor);
  if (parsed === undefined) throw new Error(`Unparseable color value: "${cssColor}"`);
  const srgb = toSrgb(parsed);
  return [
    guardChannel(srgb.r, cssColor, "r"),
    guardChannel(srgb.g, cssColor, "g"),
    guardChannel(srgb.b, cssColor, "b"),
  ];
}

/** WCAG 2.2 relative-luminance contrast ratio (1 to 21) between two concrete CSS colors. */
function wcagContrastRatio(foregroundCss: string, backgroundCss: string): number {
  const [fr, fg, fb] = parseToSrgbChannels(foregroundCss);
  const [br, bg, bb] = parseToSrgbChannels(backgroundCss);
  return wcagContrast({ mode: "rgb", r: fr, g: fg, b: fb }, { mode: "rgb", r: br, g: bg, b: bb });
}

/** APCA lightness contrast Lc between two concrete CSS colors (advisory only). */
function apcaLightnessContrast(foregroundCss: string, backgroundCss: string): number {
  const toEightBit = (channels: [number, number, number]): [number, number, number] => [
    Math.round(channels[0] * 255),
    Math.round(channels[1] * 255),
    Math.round(channels[2] * 255),
  ];
  return Number(
    APCAcontrast(
      sRGBtoY(toEightBit(parseToSrgbChannels(foregroundCss))),
      sRGBtoY(toEightBit(parseToSrgbChannels(backgroundCss))),
    ),
  );
}

describe("the var() chain resolver (crafted-input self-check)", () => {
  const crafted = {
    "--mc-text-default": "var(--mc-color-neutral-900)",
    "--mc-color-neutral-900": "oklch(22% 0.008 250)",
    "--mc-double-hop": "var(--mc-text-default)",
    "--mc-cycle-a": "var(--mc-cycle-b)",
    "--mc-cycle-b": "var(--mc-cycle-a)",
    "--mc-dangling": "var(--mc-nowhere)",
  };

  it("follows a var() chain to the concrete value, across multiple hops", () => {
    expect(resolveVariable(crafted, "--mc-text-default")).toBe("oklch(22% 0.008 250)");
    expect(resolveVariable(crafted, "--mc-double-hop")).toBe("oklch(22% 0.008 250)");
  });

  it("returns an already-concrete value as-is", () => {
    expect(resolveVariable(crafted, "--mc-color-neutral-900")).toBe("oklch(22% 0.008 250)");
  });

  it("throws on a var() cycle instead of looping forever", () => {
    expect(() => resolveVariable(crafted, "--mc-cycle-a")).toThrow(/cycle/);
  });

  it("throws on a reference to a variable the context never defines", () => {
    expect(() => resolveVariable(crafted, "--mc-dangling")).toThrow(/undefined variable/);
    expect(() => resolveVariable(crafted, "--mc-absent")).toThrow(/undefined variable/);
  });
});

describe("the contrast computation (known-ratio sanity check)", () => {
  it("black on white measures the WCAG maximum of 21", () => {
    expect(wcagContrastRatio("oklch(0% 0 0)", "oklch(100% 0 0)")).toBeCloseTo(21, 5);
  });

  it("a color against itself measures the WCAG minimum of 1", () => {
    expect(wcagContrastRatio("oklch(51% 0.11 250)", "oklch(51% 0.11 250)")).toBeCloseTo(1, 5);
  });

  it("rejects an unparseable color value loudly", () => {
    expect(() => wcagContrastRatio("definitely-not-a-color", "oklch(100% 0 0)")).toThrow(
      /Unparseable color/,
    );
  });

  it("throws on a color outside the sRGB gamut instead of silently clamping it", () => {
    // oklch(60% 0.3 30) sits well outside sRGB — if the pre-gamut-mapping assumption ever
    // breaks, the gate must fail loudly, not flatter the ratio with a clamped channel.
    expect(() => wcagContrastRatio("oklch(60% 0.3 30)", "oklch(100% 0 0)")).toThrow(
      /outside \[0, 1\]/,
    );
  });
});

const parsed = parseGeneratedCss();
// Contrast is a COLOR contract, so the sweep covers the theme x mode context blocks only. The
// motion overlays (`:root[data-motion="…"]`) are duration-only re-points with no color variables
// — the completeness gate asserts that shape, so nothing color-bearing can hide in one.
const contexts = Object.entries(parsed.base).filter(([selector]) =>
  selector.startsWith(':root[data-theme="'),
);

describe("WCAG 2.2 contrast gate (every theme x mode context, every declared pair)", () => {
  it("has non-degenerate inputs (contexts and pairs)", () => {
    // Guards the sweep itself: an empty context list or pair list would vacuously pass.
    expect(contexts.length).toBeGreaterThanOrEqual(2);
    expect(CONTRAST_PAIRS.length).toBeGreaterThanOrEqual(13);
  });

  const cases = contexts.flatMap(([selector, variables]) =>
    CONTRAST_PAIRS.map((pair) => ({ selector, variables, ...pair })),
  );

  it.each(cases)(
    "$selector: $foreground on $background clears $minimumRatio",
    ({ selector, variables, foreground, background, minimumRatio }) => {
      const foregroundValue = resolveVariable(variables, `--mc-${foreground}`);
      const backgroundValue = resolveVariable(variables, `--mc-${background}`);
      const ratio = wcagContrastRatio(foregroundValue, backgroundValue);
      expect(
        ratio,
        `${selector}: ${foreground} (${foregroundValue}) on ${background} (${backgroundValue}) measures ${ratio.toFixed(3)}, below the WCAG 2.2 minimum ${minimumRatio}`,
      ).toBeGreaterThanOrEqual(minimumRatio);
    },
  );
});

describe("APCA Lc advisory report (WCAG 3 draft metric — reported, never asserted)", () => {
  it("computes a finite Lc for every context and pair, and reports it", () => {
    for (const [selector, variables] of contexts) {
      const lines = CONTRAST_PAIRS.map((pair) => {
        const foregroundValue = resolveVariable(variables, `--mc-${pair.foreground}`);
        const backgroundValue = resolveVariable(variables, `--mc-${pair.background}`);
        const lightnessContrast = apcaLightnessContrast(foregroundValue, backgroundValue);
        // Finiteness only — an Lc threshold must never become an assertion here.
        expect(Number.isFinite(lightnessContrast)).toBe(true);
        return `  ${pair.foreground} on ${pair.background}: Lc ${lightnessContrast.toFixed(1)}`;
      });
      console.info(`APCA advisory — ${selector}\n${lines.join("\n")}`);
    }
  });
});
