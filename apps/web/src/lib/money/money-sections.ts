/*
 * The five money sections, read from the matter strip rather than written out again.
 *
 * On a money section the section strip shows only "Money" with the gold bar under it, so nothing
 * on screen names WHICH of the five the reader is on. The money toolbar answers that with a row of
 * the siblings, and that row is built from `matterStrip`'s Money group here so the two cannot
 * disagree: a section added to the group appears on the row, one removed from it disappears, and a
 * slug this module does not know is a module-load failure rather than a link to nowhere. The slug
 * union is the closed set a surface declares itself against; the registry decides the order and
 * the words.
 *
 * The two reader preferences every money section shares live here too, as pure codecs. One key
 * each, deliberately: the point of the surface is that Time, Fees, Costs, Billing and Trust look
 * the same, so a layout chosen on one of them is the layout of all of them.
 */
import { matterStrip, type MatterSection } from "$lib/matters/sections.ts";
import {
  stringUnionPreference,
  type PreferenceCodec,
} from "$lib/preferences/persisted-preference.ts";

export type MoneySectionSlug = "time" | "fees" | "costs" | "billing" | "trust";

const MONEY_SECTION_SLUGS: readonly MoneySectionSlug[] = [
  "time",
  "fees",
  "costs",
  "billing",
  "trust",
];

/** The label the strip gives the group; the one string this module and sections.ts must agree on. */
const MONEY_GROUP_LABEL = "Money";

export function isMoneySectionSlug(slug: string): slug is MoneySectionSlug {
  return (MONEY_SECTION_SLUGS as readonly string[]).includes(slug);
}

function readMoneyGroup(): readonly MatterSection[] {
  const group = matterStrip.find(
    (entry) => entry.kind === "group" && entry.label === MONEY_GROUP_LABEL,
  );
  if (group === undefined || group.kind !== "group") {
    throw new Error(
      `The matter strip has no "${MONEY_GROUP_LABEL}" group, so the money toolbar has nothing to ` +
        "list. The money sections are read from that group, never written out by hand.",
    );
  }
  for (const section of group.sections) {
    if (!isMoneySectionSlug(section.slug)) {
      throw new Error(
        `The matter strip's "${MONEY_GROUP_LABEL}" group holds "${section.slug}", which the money ` +
          "surface does not know. Add it to MoneySectionSlug so every surface can declare itself " +
          "against it, or take it out of the group.",
      );
    }
  }
  for (const slug of MONEY_SECTION_SLUGS) {
    if (!group.sections.some((section) => section.slug === slug)) {
      throw new Error(
        `The money surface knows a "${slug}" section that the matter strip's "${MONEY_GROUP_LABEL}" ` +
          "group no longer holds. Take it out of MoneySectionSlug, or put it back in the group.",
      );
    }
  }
  return group.sections;
}

/** The money sections in the order the strip's group lists them. Validated at module load. */
export const moneySections: readonly MatterSection[] = readMoneyGroup();

/** Where a money section lives: the same address the section strip links to. */
export function moneySectionHref(matterId: string, slug: string): string {
  return `/matters/${matterId}/${slug}`;
}

/*
 * How the surface is dressed. FLUSH is the file manager's look: the toolbar directly under the
 * section strip, the table running to the edges of the screen, the counts strip on its bottom
 * edge. FRAMED keeps the table inside the page's own padding with its rounded frame. A reader
 * picks one and every money section wears it.
 */
export type MoneySurfaceLayout = "flush" | "framed";
export const MONEY_SURFACE_LAYOUTS: readonly MoneySurfaceLayout[] = ["flush", "framed"];
export const MONEY_SURFACE_LAYOUT_KEY = "magna-carta-money-surface-layout";

export function moneySurfaceLayoutPreference(): PreferenceCodec<MoneySurfaceLayout> {
  return stringUnionPreference(MONEY_SURFACE_LAYOUT_KEY, MONEY_SURFACE_LAYOUTS, "flush");
}

/** How tall a row is. The grid's own two densities, chosen once for every money table. */
export type MoneySurfaceDensity = "comfortable" | "compact";
export const MONEY_SURFACE_DENSITIES: readonly MoneySurfaceDensity[] = ["comfortable", "compact"];
export const MONEY_SURFACE_DENSITY_KEY = "magna-carta-money-surface-density";

export function moneySurfaceDensityPreference(): PreferenceCodec<MoneySurfaceDensity> {
  return stringUnionPreference(MONEY_SURFACE_DENSITY_KEY, MONEY_SURFACE_DENSITIES, "comfortable");
}
