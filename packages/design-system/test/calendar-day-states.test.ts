/*
 * The month-grid day recipe's state pins.
 *
 * Two of these rules failed in production, in a way no type and no component test could catch,
 * because the defect lived in the CASCADE rather than in any one declaration. date-range-picker.css
 * declared its band states as bare `.mc-calendar-day[...]` selectors and is imported after
 * calendar.css, so at equal specificity and later source order the range picker's today rule —
 * `background-color: transparent` — beat the plain calendar's `[data-selected]` fill everywhere in
 * the product, while `[data-selected]`'s near-white foreground survived. A day that was both today
 * and selected therefore painted its number in the fill's colour with no fill behind it: white on
 * the white surface, unreadable, and reachable only on the one day of the month when it happens.
 *
 * So these tests read the stylesheets as text, in the manner of stylesheet-mirror.test.ts. A
 * jsdom render cannot see this: jsdom applies no cascade across stylesheets, which is exactly the
 * thing that broke.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENTS = join(import.meta.dirname, "../src/lib/components");
const calendarCss = readFileSync(join(COMPONENTS, "calendar/calendar.css"), "utf-8");
const rangePickerCss = readFileSync(
  join(COMPONENTS, "date-range-picker/date-range-picker.css"),
  "utf-8",
);
const rangePickerSvelte = readFileSync(
  join(COMPONENTS, "date-range-picker/date-range-picker.svelte"),
  "utf-8",
);
const componentsCss = readFileSync(
  join(import.meta.dirname, "../src/lib/styles/components.css"),
  "utf-8",
);

/** Every selector in a stylesheet, one per comma-separated part, comments stripped. */
function selectors(css: string): string[] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/^\s*([^@{}]+?)\s*\{/gm)]
    .flatMap(([, selectorList]) => selectorList!.split(","))
    .map((selector) => selector.trim())
    .filter((selector) => selector !== "");
}

/** Where a selector is declared in a stylesheet, as a character offset; -1 when it is absent. */
function declaredAt(css: string, selector: string): number {
  return css.indexOf(selector);
}

describe("the range picker's band states stay inside the range picker", () => {
  it("scopes every day and cell rule to .mc-date-range-calendar", () => {
    const dayOrCellRules = selectors(rangePickerCss).filter((selector) =>
      /\.mc-calendar-(day|cell)\b/.test(selector),
    );
    // A guard against the scan silently matching nothing if the file is restructured.
    expect(dayOrCellRules.length).toBeGreaterThan(8);
    for (const selector of dayOrCellRules) {
      expect(selector.startsWith(".mc-date-range-calendar ")).toBe(true);
    }
  });

  it("applies that scope to the popover the calendar renders in", () => {
    expect(rangePickerSvelte).toContain('"mc-date-range-calendar"');
  });

  it("is imported after the calendar recipe, which is why the scope is load-bearing", () => {
    expect(componentsCss.indexOf("calendar/calendar.css")).toBeLessThan(
      componentsCss.indexOf("date-range-picker/date-range-picker.css"),
    );
  });
});

describe("today composes with selection instead of replacing it", () => {
  it("declares today before selected, and the pair after both", () => {
    const today = declaredAt(calendarCss, ".mc-calendar-day[data-today] {");
    const selected = declaredAt(calendarCss, ".mc-calendar-day[data-selected] {");
    const both = declaredAt(calendarCss, ".mc-calendar-day[data-today][data-selected] {");
    expect(today).toBeGreaterThan(-1);
    expect(today).toBeLessThan(selected);
    expect(selected).toBeLessThan(both);
  });

  it("marks today with a ring rather than a fill, so a selected today keeps its background", () => {
    const todayRule = calendarCss.slice(
      declaredAt(calendarCss, ".mc-calendar-day[data-today] {"),
      declaredAt(calendarCss, ".mc-calendar-day[data-selected] {"),
    );
    expect(todayRule).toContain("box-shadow: inset");
    expect(todayRule).not.toContain("background-color");
  });

  it("re-colours only the ring when a day is today and selected", () => {
    const pairStart = declaredAt(calendarCss, ".mc-calendar-day[data-today][data-selected] {");
    const pairRule = calendarCss.slice(pairStart, calendarCss.indexOf("}", pairStart));
    expect(pairRule).toContain("var(--mc-action-primary-foreground)");
    expect(pairRule).not.toContain("background-color");
    expect(pairRule).not.toContain("color:");
  });

  it("leaves the range picker one ring, not two", () => {
    const rangeToday = declaredAt(
      rangePickerCss,
      ".mc-date-range-calendar .mc-calendar-day[data-today] {",
    );
    const rangeTodayRule = rangePickerCss.slice(
      rangeToday,
      rangePickerCss.indexOf("}", rangeToday),
    );
    expect(rangeTodayRule).toContain("box-shadow: none");
  });
});

describe("outside the month is shaded", () => {
  it("washes the cell, so the neighbouring days read as one band", () => {
    expect(calendarCss).toContain(".mc-calendar-cell:has(.mc-calendar-day[data-outside-month]) {");
  });

  it("darkens an outside-month day on hover, past the band it already sits on", () => {
    const hover = declaredAt(calendarCss, ".mc-calendar-day[data-outside-month]:hover {");
    expect(hover).toBeGreaterThan(-1);
    const hoverRule = calendarCss.slice(hover, calendarCss.indexOf("}", hover));
    expect(hoverRule).toContain("var(--mc-action-secondary-hover)");
  });
});
