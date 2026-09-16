/*
 * The Reports catalogue, checked against its own registry. What is worth holding still is the
 * projection the registry makes into the shared catalogue framework: every declared report reaches
 * the screen exactly once, under a heading, and an entry is a link when and only when there is
 * something behind it.
 *
 * Tools rendered through the same framework until 2026-09-16 and no longer does: every tool is a
 * top-level ability with a rail row of its own, so there is no tools catalogue left to project.
 * The framework stays — one screen using a shared shape is not a reason to un-share it, and the
 * projection rules below are the ones the next catalogue will be held to.
 */
import { describe, expect, it } from "vitest";
import { hasSurface } from "@magna-carta/design-system/maturity";
import { countCatalogueEntries } from "../src/lib/catalogue/catalogue.ts";
import { reportCatalogueSections } from "../src/lib/reports/report-catalogue.ts";
import { REPORTS, isBuiltReport, reportHref } from "../src/lib/reports/report-registry.ts";

describe("the Reports catalogue", () => {
  const sections = reportCatalogueSections();
  const entries = sections.flatMap((section) => section.entries);

  it("surfaces every declared report exactly once", () => {
    expect(entries.map((entry) => entry.id).toSorted()).toEqual(
      REPORTS.map((report) => report.id).toSorted(),
    );
    expect(countCatalogueEntries(sections)).toBe(REPORTS.length);
  });

  it("groups reports under their family's heading, empty families omitted", () => {
    for (const section of sections) {
      expect(section.label).not.toBe("");
      expect(section.entries.length).toBeGreaterThan(0);
    }
  });

  it("links a built report to its run screen and sends a soon report nowhere", () => {
    for (const report of REPORTS) {
      const entry = entries.find((candidate) => candidate.id === report.id);
      expect(entry?.href).toBe(isBuiltReport(report) ? reportHref(report) : null);
    }
  });

  it("says what an unbuilt report waits on, and says nothing of the kind about a built one", () => {
    for (const report of REPORTS) {
      const entry = entries.find((candidate) => candidate.id === report.id);
      expect(entry?.waitsOn).toBe(isBuiltReport(report) ? undefined : report.waitsOn);
    }
  });

  it("prints the question the report answers as its descriptive line", () => {
    for (const report of REPORTS) {
      const entry = entries.find((candidate) => candidate.id === report.id);
      expect(entry?.description).toBe(report.answers);
    }
  });
});
