/*
 * The report registry is a projection the screens render from, so its shape is what the tests hold
 * still: every id is a route segment, every permission is a reports key, a soon report says what it
 * waits on and has no ports, a built report has both, and the four families the reporting design
 * named are all present.
 */
import { describe, expect, it } from "vitest";
import {
  REPORT_FAMILIES,
  REPORTS,
  isBuiltReport,
  reportById,
  reportHref,
  reportsInFamily,
} from "../src/lib/reports/report-registry.ts";
import { IDENTITY_CAPTIONS } from "../src/lib/reports/trust-compliance-presenter.ts";

describe("the report registry", () => {
  it("gives every report a kebab-case id that is its route segment", () => {
    for (const report of REPORTS) {
      expect(report.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(reportHref(report)).toBe(`/reports/${report.id}`);
      expect(reportById(report.id)).toBe(report);
    }
    expect(new Set(REPORTS.map((report) => report.id)).size).toBe(REPORTS.length);
  });

  it("gates every report on a reports: key", () => {
    for (const report of REPORTS) expect(report.permission).toMatch(/^reports:[a-zA-Z]+$/);
  });

  it("covers the four families the design named, in the order the catalogue shows them", () => {
    expect(REPORT_FAMILIES.map((family) => family.id)).toEqual([
      "trust-compliance",
      "financial",
      "productivity",
      "operational",
    ]);
    for (const family of REPORT_FAMILIES) {
      expect(reportsInFamily(family.id).length).toBeGreaterThan(0);
    }
  });

  it("declares a soon report with what it waits on, and a built report with its ports", () => {
    for (const report of REPORTS) {
      if (isBuiltReport(report)) {
        expect(typeof report.run).toBe("function");
        const fixture = report.fixture(IDENTITY_CAPTIONS);
        expect(fixture.sections.length).toBeGreaterThan(0);
        expect(fixture.title).toBe(report.name);
      } else {
        expect(report.waitsOn.length).toBeGreaterThan(0);
        expect("run" in report).toBe(false);
      }
    }
  });

  it("names the trust-compliance pack as the one built report, about one trust account", () => {
    const built = REPORTS.filter(isBuiltReport);
    expect(built.map((report) => report.id)).toEqual(["trust-compliance"]);
    expect(built[0]?.scope.trustAccount).toBe(true);
    expect(built[0]?.temporal).toBe("bitemporal");
    expect(built[0]?.permission).toBe("reports:trustCompliance");
  });

  it("answers null for a report nobody declared", () => {
    expect(reportById("profitability")).toBeNull();
  });
});
