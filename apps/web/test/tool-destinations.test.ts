/*
 * The Tools palette provider is a registry projection, not a hand-list: it must surface every
 * catalog tool that the Tools area still addresses, route each through toolRoute(), and light up
 * exactly the tools that have a real surface (hasSurface) — a `soon` tool inert, an alpha-or-better
 * tool launchable. The guard that keeps a newly-added catalog tool from rendering blank (a missing
 * presentation entry throws) is asserted here too, so the palette can never quietly outrun its
 * presentation layer.
 *
 * A tool that declares its own route has been promoted to a sidebar destination, which the palette
 * renders from the destination registry instead. It must NOT also appear here, or one surface is
 * offered twice in a single flat search.
 */
import { describe, expect, it } from "vitest";
import { CATALOG, toolRoute } from "@magna-carta/tools/catalog";
import { toolDestinations } from "../src/lib/navigation/tool-destinations.ts";
import { toolPresentation } from "../src/lib/tools/tool-presentation.ts";
import { hasSurface } from "@magna-carta/design-system/maturity";

const entries = toolDestinations();
const areaTools = CATALOG.filter((tool) => tool.route === undefined);
const promotedTools = CATALOG.filter((tool) => tool.route !== undefined);
const catalogIds = areaTools.map((tool) => tool.id).sort();

describe("toolDestinations", () => {
  it("surfaces every Tools-area tool exactly once", () => {
    expect(entries.map((entry) => entry.id).sort()).toEqual(catalogIds);
  });

  it("routes every tool at /tools/<id>", () => {
    for (const entry of entries) {
      expect(entry.href).toBe(`/tools/${entry.id}`);
    }
  });

  it("omits a tool promoted to its own destination, so the palette never offers it twice", () => {
    // The File Workbench is the one promoted row today: it holds a sidebar destination of its own
    // (navigation/destinations.ts), which the palette renders beside this list.
    expect(promotedTools.map((tool) => tool.id)).toEqual(["file-workbench"]);
    for (const tool of promotedTools) {
      expect(entries.some((entry) => entry.id === tool.id)).toBe(false);
    }
  });

  it("addresses a promoted tool where it declares, not under /tools", () => {
    for (const tool of promotedTools) {
      expect(toolRoute(tool)).toBe(tool.route);
      expect(toolRoute(tool).startsWith("/tools/")).toBe(false);
    }
    // An ordinary tool still derives its address from its id.
    const whois = CATALOG.find((tool) => tool.id === "whois-lookup")!;
    expect(toolRoute(whois)).toBe("/tools/whois-lookup");
  });

  it("marks launchable to match hasSurface(stage) for every tool", () => {
    for (const tool of areaTools) {
      const entry = entries.find((candidate) => candidate.id === tool.id);
      expect(entry?.launchable).toBe(hasSurface(toolPresentation(tool).stage));
    }
  });

  it("leaves a soon tool not launchable", () => {
    // Shipping ships at `soon` — no page yet, so it must render as an inert "— soon" row.
    const shipping = entries.find((entry) => entry.id === "shipping");
    expect(shipping).toBeDefined();
    expect(toolPresentation({ ...CATALOG[0]!, id: "shipping" }).stage).toBe("soon");
    expect(shipping?.launchable).toBe(false);
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
