/*
 * The canvas ink-purity fitness check — prevention for the mode-reactivity class of defect
 * (owner report 2026-07-03: meta-bar badges/history read mode-static). Every ink on a canvas
 * component must resolve through a design token so the light/dark flip reaches it; the
 * catchable failure classes are:
 *
 * 1. RAW COLOR LITERALS (hex, rgb()/hsl()/oklch()) — pinned to one mode by construction.
 * 2. CHROME-REGISTER TOKENS on canvas surfaces (--mc-chrome-*) — chrome ink is tuned for the
 *    dark rail and does not flip with the canvas mode.
 *
 * Scope: the settings components + the app's shared canvas components — app-side compositions
 * have no theme-times-mode visual coverage today (the design system's catalog + VRT carry that
 * for its own components), so this static scan is the cheap permanent guard. Failures report
 * file:line.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SCAN_ROOTS = [
  join(import.meta.dirname, "../src/lib/settings"),
  join(import.meta.dirname, "../src/lib/components"),
];

function svelteFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".svelte"))
    .map((entry) => join(entry.parentPath, entry.name));
}

interface InkViolation {
  file: string;
  line: number;
  match: string;
}

function scan(pattern: RegExp): InkViolation[] {
  const violations: InkViolation[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of svelteFiles(root)) {
      const lines = readFileSync(file, "utf-8").split("\n");
      lines.forEach((text, index) => {
        const match = pattern.exec(text);
        pattern.lastIndex = 0;
        if (match !== null) {
          violations.push({
            file: relative(join(import.meta.dirname, ".."), file),
            line: index + 1,
            match: match[0],
          });
        }
      });
    }
  }
  return violations;
}

function report(violations: InkViolation[]): string {
  return violations
    .map((violation) => `${violation.file}:${violation.line} — ${violation.match}`)
    .join("\n");
}

describe("canvas ink purity (settings + shared app components)", () => {
  it("carries no raw hex color literals", () => {
    // Hex colors inside class/style values; longer-than-2 hex runs after # avoid ids/anchors.
    const violations = scan(/#[0-9a-fA-F]{3,8}\b(?=[^\w-]|$)/g).filter(
      // Anchor fragments in hrefs are not colors.
      (violation) => !/href/.test(violation.match),
    );
    expect(violations, `raw hex colors pin one mode:\n${report(violations)}`).toEqual([]);
  });

  it("carries no raw color-function literals", () => {
    const violations = scan(/\b(?:rgba?|hsla?|oklch|oklab)\(/g);
    expect(violations, `raw color functions pin one mode:\n${report(violations)}`).toEqual([]);
  });

  it("uses no chrome-register tokens on canvas surfaces", () => {
    const violations = scan(/--mc-chrome-[a-z-]+/g).filter(
      // The app shell IS the chrome (sidebar + top bar live there); everything else is canvas.
      (violation) => !violation.file.endsWith("app-shell.svelte"),
    );
    expect(
      violations,
      `chrome ink does not flip with the canvas mode:\n${report(violations)}`,
    ).toEqual([]);
  });
});
