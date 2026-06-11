import { readFileSync } from "node:fs";
import { join } from "node:path";
import { displayable } from "culori";
import { describe, expect, it } from "vitest";
import {
  generateRamp,
  generateStatusRamp,
  generateThemeTokens,
  parseGenerateThemeCommandLine,
  RAMP_STOP_NAMES,
  SLATE_THEME_OPTIONS,
  STATUS_RAMP_STOP_NAMES,
  validateThemeAgainstContrastPairs,
} from "../scripts/generate-theme.ts";
import { CONTRAST_PAIRS } from "../src/contrast-pairs.ts";

// Tests for the Culori OKLCH theme generator (scripts/generate-theme.ts): ramp shape
// (fixed lightness ladder, mid-ramp chroma peak, constant hue), sRGB displayability after
// gamut mapping, DTCG output purity, contrast pre-validation against the real semantic
// mapping and contrast pairs, determinism, and the "slate is generated, not hand-drifted"
// pin of tokens/primitives/color.json.

const PACKAGE_ROOT = join(import.meta.dirname, "..");

/** Convert a generator [L, C, H] stop into a culori OKLCH color object. */
function toCuloriOklch(components: readonly [number, number, number]) {
  return { mode: "oklch" as const, l: components[0], c: components[1], h: components[2] };
}

describe("generateRamp", () => {
  // A spread of anchors including high-chroma ones that force gamut clamping at the
  // ramp extremes — displayability must hold for any plausible workshop anchor.
  const anchorSets = [
    { hue: 250, chroma: 0.11 },
    { hue: 250, chroma: 0.014, tint: 0.002 },
    { hue: 30, chroma: 0.2 },
    { hue: 145, chroma: 0.25 },
    { hue: 80, chroma: 0.16, tint: 0.004 },
  ];

  it("returns exactly the 12 ramp stop names, in ramp order", () => {
    expect(RAMP_STOP_NAMES).toEqual([
      "0",
      "50",
      "100",
      "200",
      "300",
      "400",
      "500",
      "600",
      "700",
      "800",
      "900",
      "1000",
    ]);
    for (const anchors of anchorSets) {
      expect(Object.keys(generateRamp(anchors))).toEqual([...RAMP_STOP_NAMES]);
    }
  });

  it.each(anchorSets)("lightness ladder for %o: bounds and strict monotonic descent", (anchors) => {
    const ramp = generateRamp(anchors);
    const lightnesses = RAMP_STOP_NAMES.map((stop) => ramp[stop]![0]);
    expect(lightnesses[0]).toBeGreaterThanOrEqual(0.98);
    expect(lightnesses[lightnesses.length - 1]).toBeLessThanOrEqual(0.15);
    for (let index = 1; index < lightnesses.length; index += 1) {
      expect(
        lightnesses[index]!,
        `stop ${RAMP_STOP_NAMES[index]} must be strictly darker than ${RAMP_STOP_NAMES[index - 1]}`,
      ).toBeLessThan(lightnesses[index - 1]!);
    }
  });

  it.each(anchorSets)("hue is constant across every stop for %o", (anchors) => {
    const ramp = generateRamp(anchors);
    for (const stop of RAMP_STOP_NAMES) {
      expect(ramp[stop]![2], `stop ${stop}`).toBe(anchors.hue);
    }
  });

  it.each(anchorSets)("chroma is unimodal with a mid-ramp peak for %o", (anchors) => {
    // The DESIGNED curve peaks at stops 500/600, but the sRGB gamut ceiling itself peaks
    // near lightness 0.72 (stop 400): for anchors high enough to hit the ceiling at the
    // mid stops, gamut mapping legitimately shifts the realized peak toward stop 400.
    // The invariant that survives clamping: unimodal (one rise, one fall, plateaus
    // allowed), with the peak inside the working core (stops 300-700) and both ends below it.
    const ramp = generateRamp(anchors);
    const chromas = RAMP_STOP_NAMES.map((stop) => ramp[stop]![1]);
    const peak = Math.max(...chromas);
    const peakIndex = chromas.indexOf(peak);
    expect(peakIndex).toBeGreaterThanOrEqual(RAMP_STOP_NAMES.indexOf("300"));
    expect(peakIndex).toBeLessThanOrEqual(RAMP_STOP_NAMES.indexOf("700"));
    for (let index = 1; index <= peakIndex; index += 1) {
      expect(chromas[index]!, `rise at stop ${RAMP_STOP_NAMES[index]}`).toBeGreaterThanOrEqual(
        chromas[index - 1]!,
      );
    }
    for (let index = peakIndex + 1; index < chromas.length; index += 1) {
      expect(chromas[index]!, `fall at stop ${RAMP_STOP_NAMES[index]}`).toBeLessThanOrEqual(
        chromas[index - 1]!,
      );
    }
    expect(chromas[0]!).toBeLessThan(peak);
    expect(chromas[chromas.length - 1]!).toBeLessThan(peak);
  });

  it("for anchors not gamut-bound mid-ramp, the peak lands exactly at stops 500/600", () => {
    // The slate-character anchors: the designed curve survives clamping untouched mid-ramp.
    for (const anchors of [
      { hue: 250, chroma: 0.11 },
      { hue: 250, chroma: 0.014, tint: 0.002 },
    ]) {
      const ramp = generateRamp(anchors);
      expect(ramp["500"]![1]).toBe(anchors.chroma);
      expect(ramp["600"]![1]).toBe(anchors.chroma);
    }
  });

  it.each(anchorSets)("every stop is displayable in sRGB after gamut mapping for %o", (anchors) => {
    const ramp = generateRamp(anchors);
    for (const stop of RAMP_STOP_NAMES) {
      expect(
        displayable(toCuloriOklch(ramp[stop]!)),
        `stop ${stop} of ${JSON.stringify(ramp[stop])}`,
      ).toBe(true);
    }
  });

  it("the displayability check itself fails an out-of-gamut color (self-check)", () => {
    // Guards the sweep above: if displayable() were vacuous, every assertion would pass.
    expect(displayable({ mode: "oklch", l: 0.6, c: 0.3, h: 30 })).toBe(false);
  });

  it("tint floors the chroma so even the lightest and darkest stops keep the hue", () => {
    const tint = 0.002;
    const ramp = generateRamp({ hue: 250, chroma: 0.014, tint });
    for (const stop of RAMP_STOP_NAMES) {
      expect(ramp[stop]![1], `stop ${stop}`).toBeGreaterThanOrEqual(tint);
    }
    // Without the floor, the curve would dip below the tint at stop 0 — proves the floor acts.
    const unfloored = generateRamp({ hue: 250, chroma: 0.014 });
    expect(unfloored["0"]![1]).toBeLessThan(tint);
  });

  it("is deterministic: same options produce byte-identical output", () => {
    for (const anchors of anchorSets) {
      expect(JSON.stringify(generateRamp(anchors))).toBe(JSON.stringify(generateRamp(anchors)));
    }
  });
});

describe("generateStatusRamp", () => {
  const hues = [25, 80, 150, 240];

  it("returns exactly the 5 status stop names, in ramp order", () => {
    expect(STATUS_RAMP_STOP_NAMES).toEqual(["100", "300", "400", "500", "700"]);
    for (const hue of hues) {
      expect(Object.keys(generateStatusRamp({ hue }))).toEqual([...STATUS_RAMP_STOP_NAMES]);
    }
  });

  it.each(hues)("hue %i: strict monotonic lightness descent, constant hue, displayable", (hue) => {
    const ramp = generateStatusRamp({ hue });
    const lightnesses = STATUS_RAMP_STOP_NAMES.map((stop) => ramp[stop]![0]);
    for (let index = 1; index < lightnesses.length; index += 1) {
      expect(lightnesses[index]!).toBeLessThan(lightnesses[index - 1]!);
    }
    for (const stop of STATUS_RAMP_STOP_NAMES) {
      expect(ramp[stop]![2], `stop ${stop}`).toBe(hue);
      expect(displayable(toCuloriOklch(ramp[stop]!)), `stop ${stop}`).toBe(true);
    }
  });

  it("is deterministic: same options produce byte-identical output", () => {
    expect(JSON.stringify(generateStatusRamp({ hue: 150 }))).toBe(
      JSON.stringify(generateStatusRamp({ hue: 150 })),
    );
  });
});

describe("generateThemeTokens", () => {
  const slate = generateThemeTokens(SLATE_THEME_OPTIONS);

  it("emits only neutral and brand ramp overrides (status mini-ramps stay shared)", () => {
    expect(Object.keys(slate)).toEqual(["color"]);
    const rampNames = Object.keys(slate.color)
      .filter((key) => !key.startsWith("$"))
      .sort();
    expect(rampNames).toEqual(["brand", "neutral"]);
  });

  it("emits spec-pure DTCG: each token is exactly { $type, $value } in OKLCH object form", () => {
    for (const rampName of ["neutral", "brand"] as const) {
      const ramp = slate.color[rampName];
      expect(Object.keys(ramp)).toEqual([...RAMP_STOP_NAMES]);
      for (const stop of RAMP_STOP_NAMES) {
        const token = ramp[stop]!;
        expect(Object.keys(token).sort()).toEqual(["$type", "$value"]);
        expect(token.$type).toBe("color");
        expect(Object.keys(token.$value).sort()).toEqual(["alpha", "colorSpace", "components"]);
        expect(token.$value.colorSpace).toBe("oklch");
        expect(token.$value.alpha).toBe(1);
        expect(token.$value.components).toHaveLength(3);
        for (const component of token.$value.components) {
          expect(Number.isFinite(component)).toBe(true);
        }
      }
    }
  });

  it("carries a $description and no other $-keys (purity-gate compatible)", () => {
    const dollarKeys = Object.keys(slate.color).filter((key) => key.startsWith("$"));
    expect(dollarKeys).toEqual(["$description"]);
    expect(typeof slate.color.$description).toBe("string");
  });

  it("brand uses the brand hue; neutral uses the neutral tint hue when given", () => {
    const themed = generateThemeTokens({
      name: "example",
      brandHue: 145,
      neutralTint: { hue: 80, chroma: 0.01 },
    });
    expect(themed.color.brand["500"]!.$value.components[2]).toBe(145);
    expect(themed.color.neutral["500"]!.$value.components[2]).toBe(80);
  });

  it("defaults: omitted brandChroma and neutralTint resolve to the documented defaults", () => {
    const defaulted = generateThemeTokens({ name: "slate", brandHue: 250 });
    expect(JSON.stringify(defaulted)).toBe(JSON.stringify(slate));
  });

  it("is deterministic: same options produce byte-identical output", () => {
    expect(JSON.stringify(generateThemeTokens(SLATE_THEME_OPTIONS))).toBe(JSON.stringify(slate));
  });
});

describe("validateThemeAgainstContrastPairs", () => {
  const slate = generateThemeTokens(SLATE_THEME_OPTIONS);

  it("the default slate anchors yield no violations", () => {
    expect(validateThemeAgainstContrastPairs(slate)).toEqual([]);
  });

  it("a deliberately bad brand ramp yields named violations in both modes", () => {
    // Anchor options alone can barely break contrast (the lightness ladder is fixed and
    // OKLCH lightness tracks WCAG luminance closely — by design), so the bad input is a
    // crafted ramp document: brand.600 far too light for light mode's white-on-brand
    // pairings, brand.400 far too dark for dark mode's. This is also the validator's real
    // duty: it must catch ANY bad ramp values (a future workshop hand-tweak), not only
    // generator output.
    const bad = structuredClone(slate);
    bad.color.brand["600"]!.$value.components = [0.85, 0.05, 250];
    bad.color.brand["400"]!.$value.components = [0.2, 0.05, 250];
    const violations = validateThemeAgainstContrastPairs(bad);
    expect(violations.length).toBeGreaterThan(0);
    const identities = violations.map(
      (violation) => `${violation.mode}:${violation.foreground}/${violation.background}`,
    );
    expect(identities).toContain("light:action-primary-foreground/action-primary");
    expect(identities).toContain("dark:action-primary-foreground/action-primary");
    for (const violation of violations) {
      expect(violation.ratio).toBeLessThan(violation.minimumRatio);
      expect([4.5, 3]).toContain(violation.minimumRatio);
    }
  });

  it("sweeps every declared pair in both modes (flat mid-gray ramps violate all of them)", () => {
    // Vacuity guard for the sweep itself: with every neutral and brand stop forced to the
    // same mid lightness, every pair (including status pairs, whose foregrounds alias the
    // neutral ramp) must fail in both modes — exactly pairs x modes violations.
    const flat = structuredClone(slate);
    for (const rampName of ["neutral", "brand"] as const) {
      for (const stop of RAMP_STOP_NAMES) {
        flat.color[rampName][stop]!.$value.components = [0.55, 0.05, 250];
      }
    }
    const violations = validateThemeAgainstContrastPairs(flat);
    expect(violations).toHaveLength(CONTRAST_PAIRS.length * 2);
  });

  it("violations name the resolved ramp aliases for debuggability", () => {
    const bad = structuredClone(slate);
    bad.color.brand["600"]!.$value.components = [0.85, 0.05, 250];
    const violation = validateThemeAgainstContrastPairs(bad).find(
      (candidate) =>
        candidate.mode === "light" &&
        candidate.foreground === "action-primary-foreground" &&
        candidate.background === "action-primary",
    );
    expect(violation).toBeDefined();
    expect(violation!.foregroundAlias).toBe("{color.neutral.0}");
    expect(violation!.backgroundAlias).toBe("{color.brand.600}");
  });
});

describe("slate is generated, not hand-drifted (primitives pin)", () => {
  // The committed neutral and brand ramps in tokens/primitives/color.json must equal the
  // generator's output for the slate anchors exactly — so the owner workshop can later
  // regenerate from new anchors without first reverse-engineering hand drift.
  const primitives = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, "tokens", "primitives", "color.json"), "utf8"),
  ) as { color: Record<string, unknown> };
  const slate = generateThemeTokens(SLATE_THEME_OPTIONS);

  it("committed color.neutral equals the generator's slate neutral ramp", () => {
    expect(primitives.color["neutral"]).toEqual(slate.color.neutral);
  });

  it("committed color.brand equals the generator's slate brand ramp", () => {
    expect(primitives.color["brand"]).toEqual(slate.color.brand);
  });
});

describe("parseGenerateThemeCommandLine", () => {
  it("parses the full flag set into generator options plus the write switch", () => {
    const parsed = parseGenerateThemeCommandLine([
      "--name",
      "ocean",
      "--brand-hue",
      "220",
      "--brand-chroma",
      "0.12",
      "--neutral-tint-hue",
      "230",
      "--neutral-tint-chroma",
      "0.01",
      "--write",
    ]);
    expect(parsed).toEqual({
      options: {
        name: "ocean",
        brandHue: 220,
        brandChroma: 0.12,
        neutralTint: { hue: 230, chroma: 0.01 },
      },
      write: true,
    });
  });

  it("applies no defaults of its own: optional anchors stay absent for the generator", () => {
    const parsed = parseGenerateThemeCommandLine(["--name", "slate", "--brand-hue", "250"]);
    expect(parsed).toEqual({ options: { name: "slate", brandHue: 250 }, write: false });
  });

  it("rejects a missing --name or --brand-hue", () => {
    expect(() => parseGenerateThemeCommandLine(["--brand-hue", "250"])).toThrow(/--name/);
    expect(() => parseGenerateThemeCommandLine(["--name", "slate"])).toThrow(/--brand-hue/);
  });

  it("rejects a non-numeric --brand-hue", () => {
    expect(() => parseGenerateThemeCommandLine(["--name", "x", "--brand-hue", "blue"])).toThrow(
      /--brand-hue/,
    );
  });

  it("rejects a lone neutral-tint flag (both hue and chroma or neither)", () => {
    expect(() =>
      parseGenerateThemeCommandLine([
        "--name",
        "x",
        "--brand-hue",
        "250",
        "--neutral-tint-hue",
        "80",
      ]),
    ).toThrow(/neutral-tint/);
  });
});
