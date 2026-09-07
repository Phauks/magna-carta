/*
 * The document base pin.
 *
 * Two facts every screen inherits and no screen states for itself: which colour scheme the browser
 * is painting in, and what colour text is when nothing has named one. Both were missing, and the
 * defect they produced looked like a component bug — the file manager's breadcrumb read BLACK on
 * the dark themes, because a bare element takes `canvastext` and a document with no `color-scheme`
 * leaves `canvastext` black whatever the page behind it looks like. Nothing in the token cascade
 * can catch that: the tokens were correct the whole time.
 *
 * A comment cannot fail CI, so this can. It asserts the two declarations exist, that dark is
 * selected by the same `.dark` class the theme cascade and `applyThemeToDocument` use, and that the
 * root ink is a token rather than a literal — an off-token colour here would be inherited by the
 * entire product.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const baseCss = readFileSync(join(import.meta.dirname, "../src/lib/styles/base.css"), "utf-8");

describe("the document base", () => {
  it("declares a colour scheme for each mode, dark on the theme cascade's own selector", () => {
    expect(baseCss).toMatch(/:root\s*\{[^}]*color-scheme:\s*light;/);
    expect(baseCss).toMatch(/:root\.dark\s*\{[^}]*color-scheme:\s*dark;/);
  });

  it("gives the root a text colour, so text that names none is not the browser's black", () => {
    expect(baseCss).toMatch(/:root\s*\{[^}]*color:\s*var\(--mc-text-default\);/);
  });

  it("sits in the base layer, under the recipes and the utilities", () => {
    expect(baseCss.trimStart().startsWith("@layer base {")).toBe(true);
  });
});
