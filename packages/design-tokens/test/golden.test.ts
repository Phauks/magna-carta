import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Golden-file gate: generated/tokens.css and generated/tailwind-theme.css must be
// byte-identical to their committed twins in test/golden/. This is the
// generator-escape-hatch insurance: if the generator is ever swapped
// (Terrazzo → Style Dictionary or anything else) or Terrazzo is upgraded, the new
// pipeline is verified mechanically against known-good output instead of by eyeball.
//
// Freshness (does the committed generated/ match a fresh `tz build`?) is NOT this gate's
// job: the authoritative CI drift check regenerates and diffs
// (`pnpm --filter @magna-carta/design-tokens build && git diff --exit-code
// packages/design-tokens/generated` — wired in Phase E). An mtime comparison was
// considered and rejected — mtimes are unreliable across git operations and CI checkouts.
//
// Both generated/** and test/golden/** are exempt from the formatter (root vite.config.ts
// fmt.ignorePatterns) so neither side of the byte comparison can be reflowed.

const PACKAGE_ROOT = join(import.meta.dirname, "..");
const GENERATED_DIRECTORY = join(PACKAGE_ROOT, "generated");
const GOLDEN_DIRECTORY = join(PACKAGE_ROOT, "test", "golden");

/** The exact set of generated artifacts the gate pins, by filename. */
const EXPECTED_GOLDEN_FILES = ["tailwind-theme.css", "tokens.css"];

/** First differing lines between two texts, as a compact unified-diff-style hint. */
function firstDifferingLines(generated: string, golden: string, maxLines = 10): string {
  const generatedLines = generated.split("\n");
  const goldenLines = golden.split("\n");
  const lineCount = Math.max(generatedLines.length, goldenLines.length);
  const hints: string[] = [];
  for (let index = 0; index < lineCount && hints.length < maxLines * 2; index += 1) {
    const generatedLine = generatedLines[index];
    const goldenLine = goldenLines[index];
    if (generatedLine === goldenLine) continue;
    if (goldenLine !== undefined) hints.push(`  -${index + 1}: ${goldenLine}`);
    if (generatedLine !== undefined) hints.push(`  +${index + 1}: ${generatedLine}`);
  }
  if (hints.length === 0) {
    // Lines compare equal but bytes did not: a line-ending or trailing-content difference.
    return "  (no differing lines — difference is in line endings or a trailing byte)";
  }
  return hints.join("\n");
}

describe("golden directory shape", () => {
  it("contains exactly the expected golden files, each non-empty", () => {
    // Guards the gate itself: a missing or empty golden file (or a stray extra one) would
    // make the byte-equality sweep below vacuous or misleading.
    const goldenFiles = readdirSync(GOLDEN_DIRECTORY).sort();
    expect(goldenFiles).toEqual(EXPECTED_GOLDEN_FILES);
    for (const file of goldenFiles) {
      expect(
        readFileSync(join(GOLDEN_DIRECTORY, file), "utf8").length,
        `test/golden/${file} is empty`,
      ).toBeGreaterThan(0);
    }
  });

  it("pins every file the generator emits (no unpinned generated artifact)", () => {
    const generatedFiles = readdirSync(GENERATED_DIRECTORY).sort();
    expect(generatedFiles).toEqual(EXPECTED_GOLDEN_FILES);
  });
});

describe("generated CSS matches the committed golden files byte-for-byte", () => {
  it.each(EXPECTED_GOLDEN_FILES)("generated/%s equals its test/golden twin", (file) => {
    const generated = readFileSync(join(GENERATED_DIRECTORY, file), "utf8");
    const golden = readFileSync(join(GOLDEN_DIRECTORY, file), "utf8");
    if (generated !== golden) {
      throw new Error(
        `generated/${file} no longer matches test/golden/${file}.\n` +
          `Generated output changed. If intentional (token edit), update test/golden/ in the ` +
          `same commit and review the diff. Never hand-edit generated files.\n` +
          `First differing lines (-golden, +generated):\n${firstDifferingLines(generated, golden)}`,
      );
    }
    expect(generated).toBe(golden);
  });
});
