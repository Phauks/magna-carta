/*
 * The Tools palette provider is a registry projection, not a hand-list: it must surface every
 * catalog tool, route each through toolRoute(), and light up exactly the tools that have a real
 * surface (hasSurface) — a `soon` tool inert, an alpha-or-better tool launchable. The guard that
 * keeps a newly-added catalog tool from rendering blank (a missing presentation entry throws) is
 * asserted here too, so the palette can never quietly outrun its presentation layer.
 *
 * EVERY tool is here, with no exception for one addressed elsewhere, because there is nowhere else:
 * a tool is a top-level ability at /<id> (owner's direction, 2026-09-16) and the palette is the one
 * surface that searches them all.
 */
import { describe, expect, it } from "vitest";
import { CATALOG, toolRoute } from "@magna-carta/tools/catalog";
import { toolDestinations } from "../src/lib/navigation/tool-destinations.ts";
import { toolPresentation } from "../src/lib/tools/tool-presentation.ts";
import { hasSurface } from "@magna-carta/design-system/maturity";

const entries = toolDestinations();
const catalogIds = CATALOG.map((tool) => tool.id).sort();

describe("toolDestinations", () => {
  it("surfaces every catalog tool exactly once", () => {
    expect(entries.map((entry) => entry.id).sort()).toEqual(catalogIds);
  });

  it("addresses every tool at the top level, at its own id", () => {
    // There is no Tools area to be inside any more, so there is no /tools/ prefix to derive. A
    // reader who kept a link to a tool kept a link to its name.
    for (const entry of entries) {
      expect(entry.href).toBe(`/${entry.id}`);
      expect(entry.href.startsWith("/tools/")).toBe(false);
    }
    expect(toolRoute(CATALOG.find((tool) => tool.id === "whois-lookup")!)).toBe("/whois-lookup");
  });

  it("carries the File Workbench like any other tool", () => {
    // It spent a while promoted out of the catalog's surfaces and into a hand-written destination.
    // It is a tool again — the Files cluster's only member — so the palette offers it here, once.
    const workbench = entries.filter((entry) => entry.id === "file-workbench");
    expect(workbench).toHaveLength(1);
    expect(workbench[0]?.href).toBe("/file-workbench");
    expect(workbench[0]?.launchable).toBe(true);
  });

  it("marks launchable to match hasSurface(stage) for every tool", () => {
    for (const tool of CATALOG) {
      const entry = entries.find((candidate) => candidate.id === tool.id);
      expect(entry?.launchable).toBe(hasSurface(toolPresentation(tool).stage));
    }
  });

  it("leaves a soon tool not launchable", () => {
    // The property-listing links ship at `soon` — no page yet, so the row must render as an inert
    // "— soon" rather than a link. Shipping used to be this example and stopped being one when its
    // four surfaces landed; the case is about the STAGE, so it follows whichever tool still has it.
    const listingLinks = entries.find((entry) => entry.id === "property-listing-links");
    expect(listingLinks).toBeDefined();
    expect(toolPresentation({ ...CATALOG[0]!, id: "property-listing-links" }).stage).toBe("soon");
    expect(listingLinks?.launchable).toBe(false);
  });

  it("makes an alpha-or-better tool launchable", () => {
    // The Network Speed Test is the first tool with a real surface (stage alpha).
    const speedTest = entries.find((entry) => entry.id === "network-speed-test");
    expect(speedTest?.launchable).toBe(true);
  });

  it("folds the cluster's own name into the keywords", () => {
    // "internet" is the word the rail shows over these three, so it has to be a word that finds
    // them — the vocabulary a member is shown and the vocabulary that answers must be the same one.
    const whois = entries.find((entry) => entry.id === "whois-lookup");
    expect(whois?.keywords.join(" ").toLowerCase()).toContain("internet");
    const workbench = entries.find((entry) => entry.id === "file-workbench");
    expect(workbench?.keywords.join(" ").toLowerCase()).toContain("files");
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
