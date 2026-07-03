/*
 * Stylesheet-entry mirror pin.
 *
 * The catalog (.storybook/preview.css) and the app (apps/web/src/app.css) must build the SAME
 * cascade — fonts, Tailwind layer declaration, tokens, Tailwind theme mapping, keyframes,
 * recipes, in that order — or the catalog reviews a different product than the one that ships.
 * The mirror is governed by comments in both files, but a comment cannot fail CI — this pin can.
 * It already failed once in real life: the app shipped without the fonts import and rendered the
 * whole design language in the system-ui fallback while the catalog looked correct.
 *
 * Deliberately a normalized-import-sequence check, not byte equality: the two files differ in
 * how they reach the same targets (the preview uses relative paths into src/, the app uses the
 * package specifiers) and in their @source pins, so each import is normalized to its basename
 * before comparing the ordered sequence.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function importSequence(css: string): string[] {
  return [...css.matchAll(/^@import\s+"([^"]+)";/gm)]
    .map(([, specifier]) => specifier!)
    .map((specifier) => specifier.split("/").pop()!);
}

const previewCss = readFileSync(join(import.meta.dirname, "../.storybook/preview.css"), "utf-8");
const appCss = readFileSync(join(import.meta.dirname, "../../../apps/web/src/app.css"), "utf-8");

describe("apps/web/src/app.css mirrors .storybook/preview.css", () => {
  it("imports the same stylesheets in the same order", () => {
    expect(importSequence(appCss)).toEqual(importSequence(previewCss));
  });

  it("both declare the Tailwind layers before tokens (layer-order contract)", () => {
    for (const sequence of [importSequence(appCss), importSequence(previewCss)]) {
      expect(sequence.indexOf("tailwindcss")).toBeLessThan(sequence.indexOf("tokens.css"));
    }
  });
});
