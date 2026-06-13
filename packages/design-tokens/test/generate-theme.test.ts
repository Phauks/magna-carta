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
  CHANCERY_THEME_OPTIONS,
  STATUS_RAMP_STOP_NAMES,
  validateThemeAgainstContrastPairs,
} from "../scripts/generate-theme.ts";
import { CONTRAST_PAIRS } from "../src/contrast-pairs.ts";

// Tests for the Culori OKLCH theme generator (scripts/generate-theme.ts): ramp shape
// (fixed lightness ladder, mid-ramp chroma peak, constant hue), sRGB displayability after
// gamut mapping, DTCG output purity, contrast pre-validation against the real semantic
// mapping and contrast pairs (including the gamut guard on hand-tweaked stops), the
// command-line parse paths (generate and validate-only), determinism, and the "slate is
// generated, not hand-drifted" pin of tokens/primitives/color.json.

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
    { hue: 250, chroma: 0.014, chromaFloor: 0.002 },
    { hue: 30, chroma: 0.2 },
    { hue: 145, chroma: 0.25 },
    { hue: 80, chroma: 0.16, chromaFloor: 0.004 },
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
      { hue: 250, chroma: 0.014, chromaFloor: 0.002 },
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

  it("chromaFloor floors the chroma so even the lightest and darkest stops keep the hue", () => {
    const chromaFloor = 0.002;
    const ramp = generateRamp({ hue: 250, chroma: 0.014, chromaFloor });
    for (const stop of RAMP_STOP_NAMES) {
      expect(ramp[stop]![1], `stop ${stop}`).toBeGreaterThanOrEqual(chromaFloor);
    }
    // Without the floor, the curve would dip below it at stop 0 — proves the floor acts.
    const unfloored = generateRamp({ hue: 250, chroma: 0.014 });
    expect(unfloored["0"]![1]).toBeLessThan(chromaFloor);
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
  const chancery = generateThemeTokens(CHANCERY_THEME_OPTIONS);

  it("emits only neutral and brand ramp overrides (status mini-ramps stay shared)", () => {
    expect(Object.keys(chancery)).toEqual(["color"]);
    const rampNames = Object.keys(chancery.color)
      .filter((key) => !key.startsWith("$"))
      .sort();
    expect(rampNames).toEqual(["brand", "neutral"]);
  });

  it("emits spec-pure DTCG: each token is exactly { $type, $value } in OKLCH object form", () => {
    for (const rampName of ["neutral", "brand"] as const) {
      const ramp = chancery.color[rampName];
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
    const dollarKeys = Object.keys(chancery.color).filter((key) => key.startsWith("$"));
    expect(dollarKeys).toEqual(["$description"]);
    expect(typeof chancery.color.$description).toBe("string");
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
    // Tested independently of the flagship (whose anchors are non-default): omitting
    // brandChroma/neutralTint must equal stating the documented defaults explicitly
    // (DEFAULT_BRAND_PEAK_CHROMA 0.11; neutral tint at the brand hue, chroma 0.014).
    const defaulted = generateThemeTokens({ name: "x", brandHue: 250 });
    const explicit = generateThemeTokens({
      name: "x",
      brandHue: 250,
      brandChroma: 0.11,
      neutralTint: { hue: 250, chroma: 0.014 },
    });
    expect(JSON.stringify(defaulted)).toBe(JSON.stringify(explicit));
  });

  it("is deterministic: same options produce byte-identical output", () => {
    expect(JSON.stringify(generateThemeTokens(CHANCERY_THEME_OPTIONS))).toBe(
      JSON.stringify(chancery),
    );
  });
});

describe("validateThemeAgainstContrastPairs", () => {
  const chancery = generateThemeTokens(CHANCERY_THEME_OPTIONS);

  it("the default Chancery anchors yield no violations", () => {
    expect(validateThemeAgainstContrastPairs(chancery)).toEqual([]);
  });

  it("a deliberately bad brand ramp yields named violations in both modes", () => {
    // Anchor options alone can barely break contrast (the lightness ladder is fixed and
    // OKLCH lightness tracks WCAG luminance closely — by design), so the bad input is a
    // crafted ramp document: brand.800 (light mode's action.primary) far too light for the
    // white-on-brand pairing, brand.400 (dark mode's action.primary) far too dark for its
    // dark-ink-on-brand pairing. This is also the validator's real duty: it must catch ANY
    // bad ramp values (a future workshop hand-tweak), not only generator output.
    const bad = structuredClone(chancery);
    bad.color.brand["800"]!.$value.components = [0.85, 0.05, 250];
    bad.color.brand["400"]!.$value.components = [0.2, 0.05, 250];
    const violations = validateThemeAgainstContrastPairs(bad);
    expect(violations.length).toBeGreaterThan(0);
    const identities = violations.map(
      (violation) => `${violation.mode}:${violation.foreground}/${violation.background}`,
    );
    expect(identities).toContain("light:action-primary-foreground/action-primary");
    expect(identities).toContain("dark:action-primary-foreground/action-primary");
    for (const violation of violations) {
      // The crafted stops stay inside the sRGB gamut, so every violation is a contrast one.
      expect(violation.kind).toBe("contrast");
      if (violation.kind !== "contrast") continue;
      expect(violation.ratio).toBeLessThan(violation.minimumRatio);
      expect([4.5, 3]).toContain(violation.minimumRatio);
    }
  });

  it("sweeps every declared pair in both modes (flat mid-gray ramps violate every theme-dependent pair)", () => {
    // Vacuity guard for the sweep itself: with every neutral and brand stop forced to the
    // same mid lightness, every pair with a neutral/brand-aliased side (including status
    // pairs, whose foregrounds alias the neutral ramp) must fail in both modes.
    //
    // The lone exception is accent-subtle-foreground on accent-subtle: gold-on-gold, both
    // sides aliasing the SHARED accent ramp (color.accent, not the theme's neutral/brand),
    // so it is theme-INDEPENDENT — flattening the theme ramps cannot touch it. That the
    // accent chip's contrast holds regardless of theme is a guarantee, not a gap. Hence
    // (pairs - the theme-independent ones) x modes.
    const THEME_INDEPENDENT_PAIRS = CONTRAST_PAIRS.filter(
      (pair) => pair.foreground.startsWith("accent") && pair.background.startsWith("accent"),
    ).length;
    const flat = structuredClone(chancery);
    for (const rampName of ["neutral", "brand"] as const) {
      for (const stop of RAMP_STOP_NAMES) {
        flat.color[rampName][stop]!.$value.components = [0.55, 0.05, 250];
      }
    }
    const violations = validateThemeAgainstContrastPairs(flat);
    expect(violations).toHaveLength((CONTRAST_PAIRS.length - THEME_INDEPENDENT_PAIRS) * 2);
  });

  it("violations name the resolved ramp aliases for debuggability", () => {
    const bad = structuredClone(chancery);
    bad.color.brand["800"]!.$value.components = [0.85, 0.05, 250];
    const violation = validateThemeAgainstContrastPairs(bad).find(
      (candidate) =>
        candidate.kind === "contrast" &&
        candidate.mode === "light" &&
        candidate.foreground === "action-primary-foreground" &&
        candidate.background === "action-primary",
    );
    expect(violation).toBeDefined();
    if (violation?.kind !== "contrast") throw new Error("expected a contrast violation");
    expect(violation.foregroundAlias).toBe("{color.neutral.0}");
    expect(violation.backgroundAlias).toBe("{color.brand.800}");
  });

  it("an out-of-gamut hand-tweaked stop is a named gamut violation, never a measured ratio", () => {
    const bad = structuredClone(chancery);
    // oklch(60% 0.3 30) sits well outside sRGB — the same probe the CI gate's self-check
    // uses (test/contrast.test.ts) — simulating a workshop hand-tweak gone wrong. brand.800
    // is light mode's action.primary stop.
    bad.color.brand["800"]!.$value.components = [0.6, 0.3, 30];
    const violations = validateThemeAgainstContrastPairs(bad);
    const gamutViolations = violations.filter((violation) => violation.kind === "gamut");
    expect(gamutViolations.length).toBeGreaterThan(0);
    for (const violation of gamutViolations) {
      expect(violation.alias).toBe("{color.brand.800}");
      expect(violation.components).toEqual([0.6, 0.3, 30]);
    }
    const identities = gamutViolations.map(
      (violation) => `${violation.mode}:${violation.foreground}/${violation.background}`,
    );
    expect(identities).toContain("light:action-primary-foreground/action-primary");
    // The affected pair is excluded from contrast measurement: a raw out-of-gamut value
    // could flatter the ratio (the CI gate throws in the same situation).
    const measuredAnyway = violations.find(
      (violation) =>
        violation.kind === "contrast" &&
        violation.mode === "light" &&
        violation.foreground === "action-primary-foreground" &&
        violation.background === "action-primary",
    );
    expect(measuredAnyway).toBeUndefined();
  });

  it("an out-of-range lightness (no displayable chroma at all) is also a gamut violation", () => {
    const bad = structuredClone(chancery);
    bad.color.brand["600"]!.$value.components = [1.2, 0, 250];
    const gamutViolations = validateThemeAgainstContrastPairs(bad).filter(
      (violation) => violation.kind === "gamut",
    );
    expect(gamutViolations.length).toBeGreaterThan(0);
    expect(gamutViolations[0]!.alias).toBe("{color.brand.600}");
  });

  it("stops resolved from the shared primitives are exempt from the gamut guard", () => {
    // Several committed status stops rely on Terrazzo's build-time gamut mapping (the CI
    // gate measures the mapped output, so it passes them): prove one such stop the pairs
    // actually resolve (blue.700, status-info-foreground in light mode) is outside the
    // raw sRGB gamut, then prove the validator still passes Chancery — a theme document
    // cannot fix shared primitives and must not fail for them.
    const primitives = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, "tokens", "primitives", "color.json"), "utf8"),
    ) as {
      color: Record<string, Record<string, { $value: { components: [number, number, number] } }>>;
    };
    const [lightness, chroma, hue] = primitives.color["blue"]!["700"]!.$value.components;
    expect(displayable({ mode: "oklch", l: lightness, c: chroma, h: hue })).toBe(false);
    expect(validateThemeAgainstContrastPairs(chancery)).toEqual([]);
  });

  it("fresh generator output never trips the gamut guard, even for aggressive anchors", () => {
    // The generator gamut-maps every stop (clampChroma floored to four decimals), so its
    // output must pass the validator's gamut check with the same temperament as the CI gate.
    const aggressive = generateThemeTokens({ name: "vivid", brandHue: 145, brandChroma: 0.25 });
    const gamutViolations = validateThemeAgainstContrastPairs(aggressive).filter(
      (violation) => violation.kind === "gamut",
    );
    expect(gamutViolations).toEqual([]);
  });
});

describe("chancery is generated, not hand-drifted (primitives pin)", () => {
  // The committed neutral and brand ramps in tokens/primitives/color.json must equal the
  // generator's output for the Chancery flagship anchors exactly — so the flagship can be
  // re-anchored later without first reverse-engineering hand drift.
  const primitives = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, "tokens", "primitives", "color.json"), "utf8"),
  ) as { color: Record<string, unknown> };
  const chancery = generateThemeTokens(CHANCERY_THEME_OPTIONS);

  it("committed color.neutral equals the generator's Chancery neutral ramp", () => {
    expect(primitives.color["neutral"]).toEqual(chancery.color.neutral);
  });

  it("committed color.brand equals the generator's Chancery brand ramp", () => {
    expect(primitives.color["brand"]).toEqual(chancery.color.brand);
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
      command: "generate",
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
    expect(parsed).toEqual({
      command: "generate",
      options: { name: "slate", brandHue: 250 },
      write: false,
    });
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

  it("parses --validate into the validate-only command (no generation flags required)", () => {
    expect(parseGenerateThemeCommandLine(["--validate", "tokens/themes/slate.json"])).toEqual({
      command: "validate",
      themeFilePath: "tokens/themes/slate.json",
    });
  });

  it("tolerates the pnpm-forwarded separator before --validate", () => {
    expect(parseGenerateThemeCommandLine(["--", "--validate", "theme.json"])).toEqual({
      command: "validate",
      themeFilePath: "theme.json",
    });
  });

  it("rejects --validate combined with any generation flag (mutually exclusive)", () => {
    const validateArguments = ["--validate", "theme.json"];
    expect(() => parseGenerateThemeCommandLine([...validateArguments, "--name", "slate"])).toThrow(
      /mutually exclusive.*--name/s,
    );
    expect(() =>
      parseGenerateThemeCommandLine([...validateArguments, "--brand-hue", "250"]),
    ).toThrow(/mutually exclusive.*--brand-hue/s);
    expect(() =>
      parseGenerateThemeCommandLine([...validateArguments, "--neutral-tint-hue", "80"]),
    ).toThrow(/mutually exclusive.*--neutral-tint-hue/s);
    expect(() => parseGenerateThemeCommandLine([...validateArguments, "--write"])).toThrow(
      /mutually exclusive.*--write/s,
    );
  });
});
