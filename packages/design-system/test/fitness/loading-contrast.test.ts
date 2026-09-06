/*
 * The bone's contrast against the surfaces it sits on, measured from the generated tokens in both
 * modes, so the question "can a member see the placeholder at all" has a number rather than an
 * opinion.
 *
 * WCAG 1.4.11 asks 3:1 of a graphic a person must perceive to understand the interface. Whether a
 * loading bone is such a graphic is the owner's open question (docs/specs/2026-09-05-loading-region-
 * design.md, section 8): the pulse was tuned to be faint on purpose, and the loading STATE is
 * carried by the region's sentence, not by the bones. So this test does two things and no more: it
 * prints the ratio on every surface in both modes, and it pins a floor under the faintest pairing
 * so a token change cannot make a bone vanish without failing here. The 3:1 target is stated
 * beside the floor, not asserted, until the owner rules.
 *
 * The colour maths is written out rather than imported: OKLCH to linear sRGB to relative luminance
 * is forty lines, and a fitness gate that pulls a colour library in for them is a dependency the
 * gate's own package does not otherwise carry.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TOKENS_CSS = join(import.meta.dirname, "../../../design-tokens/generated/tokens.css");

/** Every `--name: value;` in a `:root…{}` block, keyed by the block's selector. */
function tokenBlocks(css: string): Map<string, Map<string, string>> {
  const blocks = new Map<string, Map<string, string>>();
  const blockPattern = /(:root[^{]*)\{([^}]*)\}/g;
  for (const match of css.matchAll(blockPattern)) {
    const selector = (match[1] ?? "").trim();
    const declarations = blocks.get(selector) ?? new Map<string, string>();
    for (const declaration of (match[2] ?? "").split(";")) {
      const [name, ...rest] = declaration.split(":");
      if (name === undefined || rest.length === 0) continue;
      const trimmed = name.trim();
      if (trimmed.startsWith("--")) declarations.set(trimmed, rest.join(":").trim());
    }
    blocks.set(selector, declarations);
  }
  return blocks;
}

/** Follow `var(--x)` references until a literal value is reached. */
function resolve(declarations: Map<string, string>, name: string, depth = 0): string {
  const value = declarations.get(name);
  if (value === undefined) throw new Error(`${name} is not declared in this block`);
  const reference = /^var\((--[a-z0-9-]+)\)$/i.exec(value);
  if (reference === null) return value;
  if (depth > 10) throw new Error(`${name} refers to itself`);
  return resolve(declarations, reference[1] ?? "", depth + 1);
}

/** `oklch(L% C H)` to relative luminance, through OKLab and linear sRGB. */
function luminanceOfOklch(value: string): number {
  const parsed = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (parsed === null) throw new Error(`not an oklch literal: ${value}`);
  const lightness = Number(parsed[1]) / 100;
  const chroma = Number(parsed[2]);
  const hue = (Number(parsed[3]) * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const m = (lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const s = (lightness - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
  const red = 4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s;
  const green = -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s;
  const blue = -0.004_196_086_3 * l - 0.703_418_614_8 * m + 1.707_614_701 * s;
  const clamp = (channel: number) => Math.min(1, Math.max(0, channel));
  return 0.2126 * clamp(red) + 0.7152 * clamp(green) + 0.0722 * clamp(blue);
}

function contrast(first: number, second: number): number {
  const [light, dark] = first > second ? [first, second] : [second, first];
  return (light + 0.05) / (dark + 0.05);
}

const SURFACES = ["--mc-surface-default", "--mc-surface-raised", "--mc-surface-sunken"];
const BONE = "--mc-action-disabled";

/**
 * The floor under the faintest pairing today, in both modes, rounded down. A change that lowers it
 * is a change to how visible a placeholder is and needs the owner; the 3:1 target above it is the
 * open question, printed beside every measurement.
 */
const FLOOR = 1.05;
const WCAG_NON_TEXT_TARGET = 3;

describe("the loading bone against every surface", () => {
  const css = readFileSync(TOKENS_CSS, "utf8");
  const blocks = tokenBlocks(css);
  const modes = [...blocks.entries()].filter(([, declarations]) => declarations.has(BONE));

  it("reads both modes from the generated tokens (vacuity guard)", () => {
    expect(modes.length).toBeGreaterThanOrEqual(2);
  });

  for (const [selector, declarations] of modes) {
    for (const surface of SURFACES) {
      it(`${selector}: ${BONE} on ${surface} is visible, and says how far from 3:1 it is`, () => {
        const ratio = contrast(
          luminanceOfOklch(resolve(declarations, BONE)),
          luminanceOfOklch(resolve(declarations, surface)),
        );
        const verdict = ratio >= WCAG_NON_TEXT_TARGET ? "meets" : "below";
        console.log(
          `loading bone ${selector} ${surface}: ${ratio.toFixed(2)}:1 (${verdict} the 3:1 non-text target)`,
        );
        expect(ratio).toBeGreaterThanOrEqual(FLOOR);
      });
    }
  }
});
