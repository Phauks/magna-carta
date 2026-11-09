/*
 * Boot-script mirror pin.
 *
 * The inline no-FOUC boot script in apps/web/src/app.html duplicates the read+apply logic of
 * src/lib/internal/theme-preference.ts (it must run before first paint, so it cannot import the
 * module). That duplication is governed by the MIRROR RULE comment in both files, but a comment
 * cannot fail CI — this test can. It is a cheap mechanical pin: if either side renames a storage
 * key, changes the default theme, or drops the prefers-color-scheme resolution, the literals
 * stop matching and this test fails, forcing the same-commit mirror update.
 *
 * Deliberately a literal-containment check, not a behavioral one: the behavior is covered by
 * theme-preference.test.ts, and parsing the inline script would couple the test to its exact
 * phrasing rather than its contract.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTRAST_STORAGE_KEY,
  DEFAULT_THEME,
  DENSITY_STORAGE_KEY,
  MODE_STORAGE_KEY,
  MOTION_STORAGE_KEY,
  SCROLL_EDGE_HINTS_STORAGE_KEY,
  THEME_STORAGE_KEY,
  TYPEFACE_STORAGE_KEY,
} from "../src/lib/internal/theme-preference.ts";

const appHtml = readFileSync(join(import.meta.dirname, "../../../apps/web/src/app.html"), "utf-8");

describe("apps/web/src/app.html inline boot script mirrors theme-preference.ts", () => {
  it("reads the same theme storage key", () => {
    expect(appHtml).toContain(`"${THEME_STORAGE_KEY}"`);
  });

  it("reads the same mode storage key", () => {
    expect(appHtml).toContain(`"${MODE_STORAGE_KEY}"`);
  });

  it("falls back to the same default theme", () => {
    expect(appHtml).toContain(`"${DEFAULT_THEME}"`);
  });

  it("resolves system mode via the same media query", () => {
    expect(appHtml).toContain('"(prefers-color-scheme: dark)"');
  });

  it("reads the same motion storage key", () => {
    expect(appHtml).toContain(`"${MOTION_STORAGE_KEY}"`);
  });

  it("resolves system motion via the same media query", () => {
    expect(appHtml).toContain('"(prefers-reduced-motion: reduce)"');
  });

  it("reads the same density storage key", () => {
    expect(appHtml).toContain(`"${DENSITY_STORAGE_KEY}"`);
  });

  it("reads the same contrast storage key", () => {
    expect(appHtml).toContain(`"${CONTRAST_STORAGE_KEY}"`);
  });

  it("resolves system contrast via the same media query", () => {
    expect(appHtml).toContain('"(prefers-contrast: more)"');
  });

  it("reads the same typeface storage key", () => {
    expect(appHtml).toContain(`"${TYPEFACE_STORAGE_KEY}"`);
  });

  it("writes the same data-typeface attribute the token overlays key on", () => {
    expect(appHtml).toContain("root.dataset.typeface");
  });

  /*
   * The scroll-edge-hint axis is DELIBERATELY not mirrored, and this asserts that rather than
   * leaving its absence to read as an oversight. The boot script exists to dress the FIRST PAINT;
   * nothing paints a scroll-edge rule before the application mounts, because the hint is a
   * component that renders only once its scrollport reports there is more content that way. There
   * is no flash to end, so mirroring it would widen the duplicated surface for no gain.
   */
  it("does not mirror the scroll-edge-hint axis, which paints nothing before the app mounts", () => {
    expect(appHtml).not.toContain(SCROLL_EDGE_HINTS_STORAGE_KEY);
  });

  // The one write in the boot script that is not about our own cascade. styles/base.css declares
  // the same scheme, but a stylesheet is a separate request and this document has an empty body
  // until the application mounts, so without the inline write the browser paints that whole window
  // — canvas, scrollbars, form controls — in the scheme it last knew.
  it("writes the same color-scheme applyThemeToDocument does", () => {
    expect(appHtml).toContain("root.style.colorScheme");
  });
});
