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
import {
  MONEY_SURFACE_DENSITY_KEY,
  MONEY_SURFACE_LAYOUT_KEY,
  isMoneySectionSlug,
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
