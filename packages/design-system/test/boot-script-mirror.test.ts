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
  DEFAULT_THEME,
  MODE_STORAGE_KEY,
  THEME_STORAGE_KEY,
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
});
