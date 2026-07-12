/*
 * The Tools palette provider is a registry projection, not a hand-list: it must surface every
 * catalog tool, route each at /tools/<id>, and light up exactly the tools that have a real surface
 * (hasSurface) — a `soon` tool inert, an alpha-or-better tool launchable. The guard that keeps a
 * newly-added catalog tool from rendering blank (a missing presentation entry throws) is asserted
 * here too, so the palette can never quietly outrun its presentation layer.
 */
import { describe, expect, it } from "vitest";
import { CATALOG } from "@magna-carta/tools/catalog";
import { toolDestinations } from "../src/lib/navigation/tool-destinations.ts";
import { toolPresentation } from "../src/lib/tools/tool-presentation.ts";
import { hasSurface } from "../src/lib/maturity/maturity.ts";

const entries = toolDestinations();
const catalogIds = CATALOG.map((tool) => tool.id).sort();

describe("toolDestinations", () => {
  it("surfaces every catalog tool exactly once", () => {
    expect(entries.map((entry) => entry.id).sort()).toEqual(catalogIds);
  });

  it("routes every tool at /tools/<id>", () => {
    for (const entry of entries) {
      expect(entry.href).toBe(`/tools/${entry.id}`);
    }
  });

  it("marks launchable to match hasSurface(stage) for every tool", () => {
    for (const tool of CATALOG) {
      const entry = entries.find((candidate) => candidate.id === tool.id);
      expect(entry?.launchable).toBe(hasSurface(toolPresentation(tool).stage));
    }
  });

  it("leaves a soon tool not launchable", () => {
    // Firm Usage ships at `soon` — no page yet, so it must render as an inert "— soon" row.
    const firmUsage = entries.find((entry) => entry.id === "firm-usage");
    expect(firmUsage).toBeDefined();
    expect(toolPresentation({ ...CATALOG[0]!, id: "firm-usage" }).stage).toBe("soon");
    expect(firmUsage?.launchable).toBe(false);
  });

  it("makes an alpha-or-better tool launchable", () => {
    // The Network Speed Test is the first tool with a real surface (stage alpha).
    const speedTest = entries.find((entry) => entry.id === "network-speed-test");
    expect(speedTest?.launchable).toBe(true);
  });

  it("folds search terms beyond the name into each entry's keywords", () => {
    // A member hunting "latency" or "bandwidth" reaches the speed test; "domain" reaches WHOIS.
    const speedTest = entries.find((entry) => entry.id === "network-speed-test");
    const speedTerms = speedTest?.keywords.join(" ").toLowerCase() ?? "";
    expect(speedTerms).toContain("latency");
    expect(speedTerms).toContain("bandwidth");

    const whois = entries.find((entry) => entry.id === "whois-lookup");
    expect(whois?.keywords.join(" ").toLowerCase()).toContain("domain");
  });

  it("throws when the catalog outruns the presentation registry", () => {
    // The provider builds each entry through the guarded accessor, so a catalog tool with no
    // presentation entry fails loud rather than rendering a blank row (tool-presentation.ts).
    const orphan = { ...CATALOG[0]!, id: "tool-with-no-presentation-entry" };
    expect(() => toolPresentation(orphan)).toThrow();
  });
});
