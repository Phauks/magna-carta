// @vitest-environment happy-dom
/*
 * Reports is a two-sided screen: the reports column on the left, grouped by family, and the
 * chosen report's run screen on the right, on the design system's NavigationLayout. Pinned here,
 * mounted, for the same reasons the tools column is: the column lists every declared report once
 * under its family, a built report links to its run screen while a soon one stands unlinked with
 * its mark and what it waits on, the row for the report on screen is current, and the column is
 * beside the page rather than instead of it.
 */
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "./stubs/app-state.ts";
import { soonDependencySentence } from "@magna-carta/design-system/maturity";
import ReportsLayout from "../src/routes/(app)/reports/+layout.svelte";
import { reportCatalogueSections } from "../src/lib/reports/report-catalogue.ts";
import {
  REPORT_FAMILIES,
  REPORTS,
  isBuiltReport,
  reportHref,
} from "../src/lib/reports/report-registry.ts";

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

const content = createRawSnippet(() => ({ render: () => "<p>the report</p>" }));

function drawReports(pathname: string): HTMLElement {
  page.url = new URL(`https://magna-carta.test${pathname}`);
  instance = mount(ReportsLayout, { target, props: { children: content } });
  flushSync();
  return target;
}

function navigation(rendered: HTMLElement): HTMLElement {
  const found = rendered.querySelector<HTMLElement>('nav[aria-label="Reports"]');
  if (found === null) throw new Error("the reports column did not render as a named landmark");
  return found;
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
  page.url = new URL("https://magna-carta.test/");
});

describe("the reports column", () => {
  it("lists every declared report once, under its family, in the registry's order", () => {
    const column = navigation(drawReports("/reports"));
    const headings = [...column.querySelectorAll("p.mc-field-label")].map(
      (heading) => heading.textContent?.trim() ?? "",
    );
    expect(headings).toEqual(reportCatalogueSections().map((section) => section.label));
    for (const heading of headings) {
      expect(REPORT_FAMILIES.map((family) => family.label)).toContain(heading);
    }
    const names = [...column.querySelectorAll("li")].map((row) =>
      (row.textContent?.trim() ?? "").replace(/Soon$/u, "").trim(),
    );
    expect(names).toEqual(
      reportCatalogueSections().flatMap((section) => section.entries.map((entry) => entry.name)),
    );
    expect(names).toHaveLength(REPORTS.length);
  });

  it("links a built report to its run screen; a soon one stands unlinked, marked, naming what it waits on", () => {
    const column = navigation(drawReports("/reports"));
    for (const report of REPORTS) {
      const link = column.querySelector(`a[href="${reportHref(report)}"]`);
      if (isBuiltReport(report)) {
        expect(link, `${report.name} should link to its run screen`).not.toBeNull();
      } else {
        expect(link, `${report.name} is not built and must not link`).toBeNull();
        const row = [...column.querySelectorAll('[aria-disabled="true"]')].find((candidate) =>
          candidate.textContent?.includes(report.name),
        );
        expect(row?.textContent).toContain("Soon");
        expect(row?.getAttribute("title")).toBe(soonDependencySentence(report.waitsOn));
      }
    }
  });

  it("lights the report the reader is on, and nothing on the landing screen", () => {
    const onReport = navigation(drawReports("/reports/trust-compliance"));
    expect(onReport.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe(
      "/reports/trust-compliance",
    );
    if (instance !== undefined) void unmount(instance);
    instance = undefined;
    target.replaceChildren();

    const onLanding = navigation(drawReports("/reports"));
    expect(onLanding.querySelector('[aria-current="page"]')).toBeNull();
  });

  it("renders the page beside the column, in a column that scrolls", () => {
    const rendered = drawReports("/reports/trust-compliance");
    const column = rendered.querySelector<HTMLElement>('[data-navigation-layout="content"]');
    expect(column?.textContent).toContain("the report");
    expect(column?.classList.contains("mc-navigation-layout-content-scrolling")).toBe(true);
  });

  it("draws every row as the design system's navigation row, with no treatment of its own", () => {
    const column = navigation(drawReports("/reports/trust-compliance"));
    const rows = [...column.querySelectorAll("li > *")];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // Tools and Reports share the column component, and both share the row with Settings. A
      // class list or an inline style written at either call site is how that stops being true.
      expect(row.classList.contains("mc-navigation-layout-row")).toBe(true);
      expect(row.getAttribute("style")).toBeNull();
    }
  });
});
