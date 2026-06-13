import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { clampChroma, displayable, wcagContrast } from "culori";
import { CONTRAST_PAIRS } from "../src/contrast-pairs.ts";

/**
 * Culori OKLCH theme generation (design spec, "Build pipeline"): a theme is derived from a
 * small set of anchor decisions — brand hue, chroma character, neutral tint — instead of
 * hand-picked swatch by swatch. The output is a theme context file for resolver.json's
 * `theme` modifier: ramp-VALUE overrides only (same token names and DTCG format as
 * tokens/primitives/color.json). Semantic aliasing is fixed and shared; a theme never
 * changes the mapping. This script is also the future seam for per-firm brand palettes:
 * a firm picks a hue, the generator emits a contrast-validated theme.
 *
 * Run it with: pnpm --filter @magna-carta/design-tokens run generate-theme \
 *   --name <theme> --brand-hue <deg> [--brand-chroma n] \
 *   [--neutral-tint-hue deg --neutral-tint-chroma n] [--write]
 * (A leading "--" separator is tolerated — pnpm forwards it literally.)
 *
 * Validate-only mode — the workshop's re-check path after hand-tweaking a theme file:
 *   pnpm --filter @magna-carta/design-tokens run generate-theme --validate <path-to-theme-file>
 * Mutually exclusive with the generation flags. Loads the existing theme-context JSON
 * (path resolved against the working directory), runs the contrast and gamut validation,
 * and exits 1 on violations without generating or writing anything.
 */

/** The 12 ramp stop names of color.neutral and color.brand, light to dark. */
export const RAMP_STOP_NAMES = [
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
] as const;

/** The 5 stop names of the status mini-ramps (color.blue/green/amber/red), light to dark. */
export const STATUS_RAMP_STOP_NAMES = ["100", "300", "400", "500", "700"] as const;

/**
 * Fixed lightness ladder, one entry per ramp stop. Fixed across all themes so the shared
 * semantic mapping (tokens/semantic.json + tokens/modes/dark.json) lands on the same
 * lightness contrast regardless of anchors — OKLCH lightness tracks WCAG relative
 * luminance closely, which is what makes anchor choice safe by construction.
 * Constraints (tested): stop 0 at least 0.98, stop 1000 at most 0.15, strictly decreasing.
 */
const LIGHTNESS_LADDER = [0.99, 0.975, 0.95, 0.9, 0.83, 0.72, 0.62, 0.52, 0.42, 0.32, 0.22, 0.13];

/**
 * Per-stop chroma multipliers on the anchor (peak) chroma, peaking mid-ramp (stops
 * 500/600): near-white and near-black stops cannot carry much chroma in sRGB, and the
 * working core of the ramp is where color identity lives.
 */
const CHROMA_CURVE = [0.1, 0.18, 0.27, 0.45, 0.64, 0.82, 1, 1, 0.91, 0.73, 0.55, 0.36];

/** Status mini-ramp lightness ladder (stops 100/300/400/500/700), strictly decreasing. */
const STATUS_LIGHTNESS_LADDER = [0.94, 0.76, 0.66, 0.56, 0.44];

/** Status mini-ramp per-stop chroma, absolute (status ramps share one chroma character). */
const STATUS_CHROMA_LADDER = [0.05, 0.1, 0.13, 0.15, 0.12];

/**
 * Default peak chroma for the brand ramp and default neutral tint chroma — the slate
 * character. The neutral floor keeps a hint of hue even at the ramp extremes (a tinted
 * neutral ramp is the theme's surface personality).
 */
const DEFAULT_BRAND_PEAK_CHROMA = 0.11;
const DEFAULT_NEUTRAL_TINT_CHROMA = 0.014;
const NEUTRAL_CHROMA_FLOOR = 0.002;

/** OKLCH components in DTCG order: [lightness, chroma, hue]. */
export type OklchComponents = readonly [number, number, number];

export interface DesignTokenColorValue {
  colorSpace: "oklch";
  components: [number, number, number];
  alpha: 1;
}

export interface DesignTokenColor {
  $type: "color";
  $value: DesignTokenColorValue;
}

export type Ramp = Record<string, OklchComponents>;

export interface GenerateRampOptions {
  /** OKLCH hue in degrees, constant across the ramp. */
  hue: number;
  /** Peak chroma, reached mid-ramp; the chroma curve scales every other stop from it. */
  chroma: number;
  /** Optional chroma floor so even the lightest and darkest stops keep the hue. */
  chromaFloor?: number;
}

/**
 * Floor (not round) to four decimals: flooring a gamut-clamped chroma can only move it
 * further INTO the sRGB gamut, so the rounded stop stays displayable.
 */
function floorToFourDecimals(value: number): number {
  return Math.floor(value * 10000) / 10000;
}

/** Largest chroma at this lightness and hue that sRGB can display (CSS gamut mapping). */
function gamutMapChroma(lightness: number, chroma: number, hue: number): number {
  // culori 4.x: clampChroma(color, "oklch") binary-searches the largest in-sRGB-gamut
  // chroma at fixed lightness and hue, returning the color in its original space.
  const clamped = clampChroma({ mode: "oklch", l: lightness, c: chroma, h: hue }, "oklch");
  return floorToFourDecimals(clamped.c ?? 0);
}

/**
 * Generate a 12-stop OKLCH ramp: the fixed lightness ladder, the mid-ramp-peaking chroma
 * curve scaled by the anchor chroma (floored at `chromaFloor` when given), constant hue,
 * every stop gamut-mapped into sRGB. Pure and deterministic: same options, same bytes.
 */
export function generateRamp(options: GenerateRampOptions): Ramp {
  const ramp: Record<string, OklchComponents> = {};
  RAMP_STOP_NAMES.forEach((stopName, index) => {
    const lightness = LIGHTNESS_LADDER[index] as number;
    const curvedChroma = options.chroma * (CHROMA_CURVE[index] as number);
    const flooredChroma = Math.max(curvedChroma, options.chromaFloor ?? 0);
    ramp[stopName] = [
      lightness,
      gamutMapChroma(lightness, flooredChroma, options.hue),
      options.hue,
    ];
  });
  return ramp;
}

export interface GenerateStatusRampOptions {
  /** OKLCH hue in degrees, constant across the ramp. */
  hue: number;
}

/**
 * Generate a 5-stop status mini-ramp (the 100/300/400/500/700 shape). Not yet wired into
 * theme generation — status ramps stay shared (see generateThemeTokens) — but this is the
 * shape the owner workshop will regenerate status hues through.
 */
export function generateStatusRamp(options: GenerateStatusRampOptions): Ramp {
  const ramp: Record<string, OklchComponents> = {};
  STATUS_RAMP_STOP_NAMES.forEach((stopName, index) => {
    const lightness = STATUS_LIGHTNESS_LADDER[index] as number;
    const chroma = STATUS_CHROMA_LADDER[index] as number;
    ramp[stopName] = [lightness, gamutMapChroma(lightness, chroma, options.hue), options.hue];
  });
  return ramp;
}

export interface GenerateThemeTokensOptions {
  /** Theme name (the resolver context name and the tokens/themes/<name>.json filename). */
  name: string;
  /** Brand ramp hue in OKLCH degrees. */
  brandHue: number;
  /** Brand ramp peak chroma; defaults to the slate character (0.11). */
  brandChroma?: number;
  /** Neutral ramp tint; defaults to the brand hue at the slate tint chroma (0.014). */
  neutralTint?: { hue: number; chroma: number };
}

export interface ThemeTokensDocument {
  color: {
    $description: string;
    neutral: Record<string, DesignTokenColor>;
    brand: Record<string, DesignTokenColor>;
  };
}

/** Wrap a generated ramp's stops in DTCG color tokens (same format as the primitives). */
function toDesignTokens(ramp: Ramp): Record<string, DesignTokenColor> {
  const tokens: Record<string, DesignTokenColor> = {};
  for (const [stopName, components] of Object.entries(ramp)) {
    tokens[stopName] = {
      $type: "color",
      $value: { colorSpace: "oklch", components: [...components], alpha: 1 },
    };
  }
  return tokens;
}

/**
 * Generate the DTCG document for a theme context file: ramp-value overrides for
 * color.neutral and color.brand only, spec-pure, same token names and OKLCH object format
 * as tokens/primitives/color.json.
 *
 * The status mini-ramps (blue/green/amber/red) are deliberately NOT themed: status colors
 * carry meaning (info/success/warning/danger) and must read identically across themes, so
 * every theme shares the primitives' status values. When a theme someday needs status
 * hues tuned to its palette, wire generateStatusRamp in here — and extend
 * validateThemeAgainstContrastPairs's ramp lookup, which already falls back to the shared
 * primitives for status aliases.
 */
export function generateThemeTokens(options: GenerateThemeTokensOptions): ThemeTokensDocument {
  const brandChroma = options.brandChroma ?? DEFAULT_BRAND_PEAK_CHROMA;
  const neutralTint = options.neutralTint ?? {
    hue: options.brandHue,
    chroma: DEFAULT_NEUTRAL_TINT_CHROMA,
  };
  const neutral = generateRamp({
    hue: neutralTint.hue,
    chroma: neutralTint.chroma,
    chromaFloor: NEUTRAL_CHROMA_FLOOR,
  });
  const brand = generateRamp({ hue: options.brandHue, chroma: brandChroma });
  return {
    color: {
      $description:
        `Theme "${options.name}" ramp-value overrides, generated by scripts/generate-theme.ts — ` +
        `anchors: brand hue ${options.brandHue}, peak chroma ${brandChroma}; ` +
        `neutral tint hue ${neutralTint.hue}, chroma ${neutralTint.chroma}. ` +
        `Do not hand-edit; regenerate from anchors. Status mini-ramps stay shared from ` +
        `tokens/primitives/color.json.`,
      neutral: toDesignTokens(neutral),
      brand: toDesignTokens(brand),
    },
  };
}

/**
 * The Chancery anchors: the flagship default theme (Ink & Gold — a warm near-black ink
 * brand at low chroma), committed into tokens/primitives/color.json. The pin test
 * (test/generate-theme.test.ts) holds the committed neutral and brand ramps byte-equal to
 * this generator output, so the flagship can be re-anchored without reverse-engineering
 * hand drift. The brand/flagship color is a swappable anchor (design language §3): change
 * these numbers, regenerate the primitives, re-pin. The accent (gold) is separate and
 * shared (tokens/primitives/color.json `accent`), never themed.
 */
export const CHANCERY_THEME_OPTIONS = {
  name: "chancery",
  brandHue: 70,
  brandChroma: 0.035,
  neutralTint: { hue: 70, chroma: DEFAULT_NEUTRAL_TINT_CHROMA },
} satisfies GenerateThemeTokensOptions;

export interface ContrastViolation {
  kind: "contrast";
  mode: "light" | "dark";
  /** Contrast-pair foreground name (dashed semantic name, as in src/contrast-pairs.ts). */
  foreground: string;
  /** Contrast-pair background name. */
  background: string;
  /** The semantic alias the foreground resolved to, e.g. "{color.neutral.0}". */
  foregroundAlias: string;
  /** The semantic alias the background resolved to, e.g. "{color.brand.600}". */
  backgroundAlias: string;
  /** Measured WCAG 2.2 contrast ratio. */
  ratio: number;
  /** The pair's required minimum ratio. */
  minimumRatio: number;
}

export interface GamutViolation {
  kind: "gamut";
  mode: "light" | "dark";
  /** Contrast-pair foreground name (dashed semantic name, as in src/contrast-pairs.ts). */
  foreground: string;
  /** Contrast-pair background name. */
  background: string;
  /** The semantic alias whose resolved stop sits outside the sRGB gamut. */
  alias: string;
  /** The out-of-gamut stop's OKLCH components. */
  components: OklchComponents;
}

export type ThemeValidationViolation = ContrastViolation | GamutViolation;

const PACKAGE_ROOT = join(import.meta.dirname, "..");

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, relativePath), "utf8"));
}

/**
 * Flatten a semantic document's color tokens into dashed-name -> alias entries
 * (token `action.primary-foreground` -> "action-primary-foreground" -> "{color.brand.600}"),
 * matching the variable-name convention the contrast pairs use.
 */
function collectColorAliases(node: unknown, path = "", into = new Map<string, string>()) {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return into;
  const record = node as Record<string, unknown>;
  if (record["$type"] === "color" && typeof record["$value"] === "string") {
    into.set(path.replaceAll(".", "-"), record["$value"]);
    return into;
  }
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith("$")) continue;
    collectColorAliases(value, path === "" ? key : `${path}.${key}`, into);
  }
  return into;
}

const COLOR_ALIAS_PATTERN = /^\{color\.([\w-]+)\.(\d+)\}$/;

interface ResolvedAlias {
  components: OklchComponents;
  /** Whether the alias landed on the theme document or fell back to the shared primitives. */
  source: "theme" | "primitives";
}

/** Resolve a "{color.<ramp>.<stop>}" alias: theme overrides first, shared primitives second. */
function resolveAliasComponents(
  alias: string,
  themeTokens: ThemeTokensDocument,
  primitiveColor: Record<string, Record<string, DesignTokenColor>>,
): ResolvedAlias {
  const match = COLOR_ALIAS_PATTERN.exec(alias);
  if (match === null) throw new Error(`Unsupported semantic color alias: "${alias}"`);
  const [, rampName, stopName] = match as unknown as [string, string, string];
  const themeRamps = themeTokens.color as unknown as Record<
    string,
    Record<string, DesignTokenColor> | string
  >;
  const themeRamp = themeRamps[rampName];
  const fromTheme = typeof themeRamp === "object";
  const token = fromTheme ? themeRamp[stopName] : primitiveColor[rampName]?.[stopName];
  if (token === undefined) {
    throw new Error(`Alias "${alias}" names no stop in the theme or the shared primitives`);
  }
  return { components: token.$value.components, source: fromTheme ? "theme" : "primitives" };
}

/**
 * True when an OKLCH stop sits outside the sRGB gamut beyond floating-point fuzz. Fresh
 * generator output always passes: its chroma is clampChroma-mapped and then floored to
 * four decimals, which can only move it further INTO the gamut, so displayable() holds.
 * For hand-entered values, the fallback applies the same gamut mapping the generator
 * does and tolerates a chroma within one floored decimal step of the boundary — unless
 * no chroma at all is displayable at this lightness (lightness itself out of range).
 */
function isOutOfSrgbGamut([lightness, chroma, hue]: OklchComponents): boolean {
  if (displayable({ mode: "oklch", l: lightness, c: chroma, h: hue })) return false;
  if (!displayable({ mode: "oklch", l: lightness, c: 0, h: hue })) return true;
  return floorToFourDecimals(chroma) > gamutMapChroma(lightness, chroma, hue);
}

/**
 * Contrast pre-validation: simulate the fixed semantic mapping (light truth from
 * tokens/semantic.json, dark overlay from tokens/modes/dark.json) over the generated ramp
 * values and measure every pair in src/contrast-pairs.ts in both modes — so a bad anchor
 * choice fails AT GENERATION with named pairs, not later in CI. Reads the real semantic,
 * mode, pairs, and primitives files: no duplicated tables to drift.
 *
 * A THEME-OWNED stop outside the sRGB gamut (after the same gamut-mapping tolerance the
 * generator applies) is reported as a named gamut violation and excluded from contrast
 * measurement — measuring the raw value could flatter the ratio, and the CI gate would
 * refuse it anyway. Stops resolved from the shared primitives are exempt: several
 * committed status stops deliberately exceed the raw sRGB gamut and rely on Terrazzo's
 * build-time gamut mapping, which the CI gate measures after the fact; a theme document
 * cannot fix them and must not fail for them.
 *
 * This is a pre-flight simulation, not the authority: the Terrazzo-resolved contrast gate
 * (test/contrast.test.ts over generated/tokens.css) remains the authority if this
 * simulation ever drifts from real resolver behavior.
 */
export function validateThemeAgainstContrastPairs(
  themeTokens: ThemeTokensDocument,
): ThemeValidationViolation[] {
  const semanticDocument = readJson("tokens/semantic.json");
  const darkDocument = readJson("tokens/modes/dark.json");
  const primitiveColor = (readJson("tokens/primitives/color.json") as { color: unknown })
    .color as Record<string, Record<string, DesignTokenColor>>;

  const lightAliases = collectColorAliases(semanticDocument);
  // Dark is an overlay on the light truth: start from light, overwrite with dark entries.
  const darkAliases = new Map(lightAliases);
  for (const [name, alias] of collectColorAliases(darkDocument)) darkAliases.set(name, alias);

  const violations: ThemeValidationViolation[] = [];
  const modes = [
    { mode: "light" as const, aliases: lightAliases },
    { mode: "dark" as const, aliases: darkAliases },
  ];
  for (const { mode, aliases } of modes) {
    for (const pair of CONTRAST_PAIRS) {
      const foregroundAlias = aliases.get(pair.foreground);
      const backgroundAlias = aliases.get(pair.background);
      if (foregroundAlias === undefined || backgroundAlias === undefined) {
        throw new Error(
          `Contrast pair "${pair.foreground}" on "${pair.background}" names a semantic token ` +
            `missing from the ${mode} mapping`,
        );
      }
      const resolvedForeground = resolveAliasComponents(
        foregroundAlias,
        themeTokens,
        primitiveColor,
      );
      const resolvedBackground = resolveAliasComponents(
        backgroundAlias,
        themeTokens,
        primitiveColor,
      );
      let pairIsOutOfGamut = false;
      for (const side of [
        { alias: foregroundAlias, resolved: resolvedForeground },
        { alias: backgroundAlias, resolved: resolvedBackground },
      ]) {
        if (side.resolved.source === "theme" && isOutOfSrgbGamut(side.resolved.components)) {
          pairIsOutOfGamut = true;
          violations.push({
            kind: "gamut",
            mode,
            foreground: pair.foreground,
            background: pair.background,
            alias: side.alias,
            components: side.resolved.components,
          });
        }
      }
      if (pairIsOutOfGamut) continue;
      const [foregroundLightness, foregroundChroma, foregroundHue] = resolvedForeground.components;
      const [backgroundLightness, backgroundChroma, backgroundHue] = resolvedBackground.components;
      const ratio = wcagContrast(
        { mode: "oklch", l: foregroundLightness, c: foregroundChroma, h: foregroundHue },
        { mode: "oklch", l: backgroundLightness, c: backgroundChroma, h: backgroundHue },
      );
      if (ratio < pair.minimumRatio) {
        violations.push({
          kind: "contrast",
          mode,
          foreground: pair.foreground,
          background: pair.background,
          foregroundAlias,
          backgroundAlias,
          ratio,
          minimumRatio: pair.minimumRatio,
        });
      }
    }
  }
  return violations;
}

export type ParsedCommandLine =
  | { command: "generate"; options: GenerateThemeTokensOptions; write: boolean }
  | { command: "validate"; themeFilePath: string };

/** Parse main()'s flags. Applies no defaults of its own: defaulting lives in the generator. */
export function parseGenerateThemeCommandLine(argv: string[]): ParsedCommandLine {
  // pnpm forwards a literal "--" separator to the script; parseArgs strict mode
  // would reject it as a positional, so strip one leading occurrence.
  const argumentsWithoutSeparator = argv[0] === "--" ? argv.slice(1) : argv;
  const { values } = parseArgs({
    args: argumentsWithoutSeparator,
    strict: true,
    options: {
      name: { type: "string" },
      "brand-hue": { type: "string" },
      "brand-chroma": { type: "string" },
      "neutral-tint-hue": { type: "string" },
      "neutral-tint-chroma": { type: "string" },
      write: { type: "boolean", default: false },
      validate: { type: "string" },
    },
  });

  if (values.validate !== undefined) {
    const generationFlagsGiven: string[] = [];
    if (values.name !== undefined) generationFlagsGiven.push("--name");
    if (values["brand-hue"] !== undefined) generationFlagsGiven.push("--brand-hue");
    if (values["brand-chroma"] !== undefined) generationFlagsGiven.push("--brand-chroma");
    if (values["neutral-tint-hue"] !== undefined) generationFlagsGiven.push("--neutral-tint-hue");
    if (values["neutral-tint-chroma"] !== undefined) {
      generationFlagsGiven.push("--neutral-tint-chroma");
    }
    if (values.write) generationFlagsGiven.push("--write");
    if (generationFlagsGiven.length > 0) {
      throw new Error(
        `--validate is mutually exclusive with the generation flags ` +
          `(got ${generationFlagsGiven.join(", ")})`,
      );
    }
    return { command: "validate", themeFilePath: values.validate };
  }

  function requireNumber(flag: string, raw: string | undefined): number | undefined {
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) throw new Error(`--${flag} must be a number, got "${raw}"`);
    return parsed;
  }

  if (values.name === undefined) throw new Error("--name is required");
  const brandHue = requireNumber("brand-hue", values["brand-hue"]);
  if (brandHue === undefined) throw new Error("--brand-hue is required");
  const brandChroma = requireNumber("brand-chroma", values["brand-chroma"]);
  const neutralTintHue = requireNumber("neutral-tint-hue", values["neutral-tint-hue"]);
  const neutralTintChroma = requireNumber("neutral-tint-chroma", values["neutral-tint-chroma"]);
  if ((neutralTintHue === undefined) !== (neutralTintChroma === undefined)) {
    throw new Error("--neutral-tint-hue and --neutral-tint-chroma must be given together");
  }

  const options: GenerateThemeTokensOptions = { name: values.name, brandHue };
  if (brandChroma !== undefined) options.brandChroma = brandChroma;
  if (neutralTintHue !== undefined && neutralTintChroma !== undefined) {
    options.neutralTint = { hue: neutralTintHue, chroma: neutralTintChroma };
  }
  return { command: "generate", options, write: values.write };
}

/** Run the validator over a theme document and print the outcome; true when it passes. */
function reportThemeValidation(themeTokens: ThemeTokensDocument): boolean {
  const violations = validateThemeAgainstContrastPairs(themeTokens);
  const checkCount = CONTRAST_PAIRS.length * 2;
  if (violations.length > 0) {
    const violationWord = violations.length === 1 ? "violation" : "violations";
    console.error(
      `Theme validation: ${violations.length} ${violationWord} across ${checkCount} contrast checks:`,
    );
    for (const violation of violations) {
      if (violation.kind === "gamut") {
        console.error(
          `  ${violation.mode}: ${violation.foreground} on ${violation.background} resolves ` +
            `${violation.alias} to oklch(${violation.components.join(" ")}), which sits ` +
            `outside the sRGB gamut`,
        );
      } else {
        console.error(
          `  ${violation.mode}: ${violation.foreground} (${violation.foregroundAlias}) on ` +
            `${violation.background} (${violation.backgroundAlias}) measures ` +
            `${violation.ratio.toFixed(3)}, below the minimum ${violation.minimumRatio}`,
        );
      }
    }
    return false;
  }
  console.info(`Contrast validation: all ${checkCount} checks pass.`);
  return true;
}

/** Thin entry point: generate, contrast-validate, print, optionally write the theme file. */
function main(): void {
  const parsed = parseGenerateThemeCommandLine(process.argv.slice(2));

  if (parsed.command === "validate") {
    const themeTokens = JSON.parse(
      readFileSync(parsed.themeFilePath, "utf8"),
    ) as ThemeTokensDocument;
    if (!reportThemeValidation(themeTokens)) process.exitCode = 1;
    return;
  }

  const { options, write } = parsed;
  const themeTokens = generateThemeTokens(options);
  const serialized = `${JSON.stringify(themeTokens, null, 2)}\n`;
  console.info(serialized);

  if (!reportThemeValidation(themeTokens)) {
    // Never write a theme that fails its own gate.
    process.exitCode = 1;
    return;
  }

  if (write) {
    const themesDirectory = join(PACKAGE_ROOT, "tokens", "themes");
    mkdirSync(themesDirectory, { recursive: true });
    const filePath = join(themesDirectory, `${options.name}.json`);
    writeFileSync(filePath, serialized);
    console.info(`Wrote ${filePath}`);
  }
}

if (import.meta.main) main();
