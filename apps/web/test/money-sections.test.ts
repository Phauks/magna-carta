/*
 * The money toolbar's registry: the five sub-parts, read from the matter strip's Money group and
 * never written out by hand.
 *
 * These pin the facts a wrong toolbar would get quietly wrong: a sixth link or a missing one, an
 * order that disagrees with the strip's menu, a link that names no section, an address that is not
 * the one the section strip links to, and a stored view setting that decodes to something the
 * surface cannot render.
 */
import { describe, expect, it } from "vitest";
import { matterSections, matterStrip } from "../src/lib/matters/sections.ts";
import { destinationById, type DestinationId } from "../src/lib/navigation/destinations.ts";
import {
  MONEY_SURFACE_DENSITY_KEY,
  MONEY_SURFACE_LAYOUT_KEY,
  isMoneySectionSlug,
  moneySectionFirmDestination,
  moneySectionHref,
  moneySections,
  moneySurfaceDensityPreference,
  moneySurfaceLayoutPreference,
} from "../src/lib/money/money-sections.ts";

describe("the money sections", () => {
  it("are Time, Fees, Costs, Billing and Trust, in that order", () => {
    expect(moneySections.map((section) => section.slug)).toEqual([
      "time",
      "fees",
      "costs",
      "billing",
      "trust",
    ]);
    expect(moneySections.map((section) => section.label)).toEqual([
      "Time",
      "Fees",
      "Costs",
      "Billing",
      "Trust",
    ]);
  });

  it("are exactly the strip's Money group, in the group's own order", () => {
    const group = matterStrip.find((entry) => entry.kind === "group" && entry.label === "Money");
    expect(group).toBeDefined();
    if (group === undefined || group.kind !== "group") return;
    expect(moneySections).toEqual(group.sections);
  });

  it("are every one a registered matter section", () => {
    for (const section of moneySections) {
      expect(matterSections).toContain(section);
    }
  });

  it("recognise their own slugs and nothing else", () => {
    for (const section of moneySections) expect(isMoneySectionSlug(section.slug)).toBe(true);
    expect(isMoneySectionSlug("files")).toBe(false);
    expect(isMoneySectionSlug("")).toBe(false);
  });

  it("link to the same address the section strip links to", () => {
    expect(moneySectionHref("mat_1", "costs")).toBe("/matters/mat_1/costs");
    for (const section of moneySections) {
      expect(moneySectionHref("mat_1", section.slug)).toBe(`/matters/mat_1/${section.slug}`);
    }
  });
});

describe("the way out to a section's firm-wide twin", () => {
  it("names the sidebar destination, so the rail and the toolbar cannot call one place two things", () => {
    for (const slug of ["time", "fees", "costs", "billing"] as const) {
      const named = moneySectionFirmDestination(slug);
      expect(named).toBe(slug);
      // The href, the label and the glyph all come from the registry entry this id resolves to.
      const destination = destinationById(named as DestinationId);
      expect(destination?.href).toBe(`/${slug}`);
      expect(destination?.shipped).toBe(true);
    }
  });

  it("lets the sidebar's own shipped flag decide when a way out appears", () => {
    // A way out to a page that is not built is worse than no way out, so the toolbar renders
    // nothing until the firm's own screen is real. Trust names its twin here like the other four;
    // whether the link appears is the registry's answer, never a second list kept in this module.
    const destination = destinationById("trust");
    expect(destination?.href).toBe("/trust");
    expect(moneySectionFirmDestination("trust")).toBe(
      destination?.shipped === true ? "trust" : null,
    );
  });

  it("keeps every money section answered, so a sixth cannot be added without deciding", () => {
    for (const section of moneySections) {
      expect(() =>
        moneySectionFirmDestination(
          section.slug as Parameters<typeof moneySectionFirmDestination>[0],
        ),
      ).not.toThrow();
    }
  });
});

describe("the money surface's view settings", () => {
  it("share one layout key across every money section, and fall back to flush", () => {
    const codec = moneySurfaceLayoutPreference();
    expect(codec.storageKey).toBe(MONEY_SURFACE_LAYOUT_KEY);
    expect(MONEY_SURFACE_LAYOUT_KEY).toBe("magna-carta-money-surface-layout");
    expect(codec.decode(null)).toBe("flush");
    expect(codec.decode("framed")).toBe("framed");
    expect(codec.decode("flush")).toBe("flush");
    expect(codec.decode("sideways")).toBe("flush");
    expect(codec.encode("framed")).toBe("framed");
  });

  it("share one density key across every money section, and fall back to comfortable", () => {
    const codec = moneySurfaceDensityPreference();
    expect(codec.storageKey).toBe(MONEY_SURFACE_DENSITY_KEY);
    expect(MONEY_SURFACE_DENSITY_KEY).toBe("magna-carta-money-surface-density");
    expect(codec.decode(null)).toBe("comfortable");
    expect(codec.decode("compact")).toBe("compact");
    expect(codec.decode("comfortable")).toBe("comfortable");
    expect(codec.decode("dense")).toBe("comfortable");
    expect(codec.encode("compact")).toBe("compact");
  });
});
