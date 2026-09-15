/*
 * The two catalogues, checked against their own registries. Tools and Reports render through one
 * shared framework now, so what is worth holding still is the projection each registry makes into
 * it: every declared thing reaches the screen exactly once, under a heading, and an entry is a link
 * when and only when there is something behind it.
 */
import { describe, expect, it } from "vitest";
import { CATALOG, toolRoute } from "@magna-carta/tools/catalog";
import { hasSurface } from "@magna-carta/design-system/maturity";
import { countCatalogueEntries } from "../src/lib/catalogue/catalogue.ts";
import { toolCatalogueSections } from "../src/lib/tools/tool-catalogue.ts";
import { reportCatalogueSections } from "../src/lib/reports/report-catalogue.ts";
import { REPORTS, isBuiltReport, reportHref } from "../src/lib/reports/report-registry.ts";

describe("the Tools catalogue", () => {
  const sections = toolCatalogueSections();
  const entries = sections.flatMap((section) => section.entries);

  it("surfaces every permitted tool exactly once", () => {
    // Every tool the area still addresses. A tool that declares its own route has become a
    // destination elsewhere and is not one of this listing's rows any more.
    expect(entries.map((entry) => entry.id).toSorted()).toEqual(
      CATALOG.filter((tool) => tool.route === undefined)
        .map((tool) => tool.id)
        .toSorted(),
    );
  });

  it("leaves out a tool promoted to its own destination", () => {
    expect(entries.some((entry) => entry.id === "file-workbench")).toBe(false);
    expect(CATALOG.some((tool) => tool.id === "file-workbench")).toBe(true);
  });

  it("gives every section a heading and something under it", () => {
    for (const section of sections) {
      expect(section.label).not.toBe("");
      expect(section.entries.length).toBeGreaterThan(0);
    }
  });

  it("links a tool that has a surface at its own route, and nowhere otherwise", () => {
    // The listing still carries a tool promoted to its own destination — a page about the Tools
    // area should show the host its file utilities are run from — but links it where the manifest
    // says it lives, not at a /tools address that no longer resolves.
    for (const entry of entries) {
      const tool = CATALOG.find((candidate) => candidate.id === entry.id)!;
      expect(entry.href).toBe(hasSurface(entry.stage) ? toolRoute(tool) : null);
    }
  });

  it("carries a descriptive line and a glyph on every entry", () => {
    for (const entry of entries) {
      expect(entry.description).not.toBe("");
      expect(entry.icon).toBeDefined();
    }
  });

  it("folds the lay synonyms into the search net, so a speed test answers to bandwidth", () => {
    const speedTest = entries.find((entry) => entry.id === "network-speed-test");
    expect((speedTest?.keywords ?? []).join(" ")).toContain("bandwidth");
  });
});

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
