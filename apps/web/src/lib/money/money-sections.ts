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
import { destinationById, type DestinationId } from "$lib/navigation/destinations.ts";
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

/**
 * Where one bill is read: the matter's Billing section, with that bill already open.
 *
 * The seam every money surface uses to answer "what was the client actually told" — the cost and
 * time ledgers from a billed row's menu, the invoice window from the list of matters a bill
 * charges, the firm's own register from a row. It is spelled once because it was spelled three
 * times, and one of the three forgot to encode the identifier.
 *
 * A bill is read on the matter it charges rather than at the firm's scale, because the acts
 * against it are that matter's — applying its trust money, writing off its balance — and a reader
 * who followed a bill wants to be somewhere those are possible.
 */
export function billHref(matterId: string, invoiceId: string): string {
  return `${moneySectionHref(matterId, "billing")}?invoice=${encodeURIComponent(invoiceId)}`;
}

/**
 * The FIRM-wide surface a money section has a sibling on, or null while that surface is unbuilt.
 *
 * All five exist at both scopes — a matter's Time, Fees, Costs, Billing and Trust each have a
 * firm-wide screen answering the question the matter's own section cannot: what the whole firm
 * recorded this week, charged this month, advanced this month, is owed, or holds for its clients.
 * The toolbar's way out is what makes that pair discoverable rather than something a member finds
 * by noticing a sidebar row; without it the two scopes are two places that happen to be about the
 * same thing.
 *
 * The addresses come from the sidebar's own registry rather than being spelled here, so a section
 * cannot point at a destination the sidebar calls something else or that has moved. A destination
 * that is announced and not yet shipped answers null on the same registry's word, so the toolbar
 * renders nothing rather than a link to a Soon page: naming the section here and letting the
 * shipped flag decide is what stops the two from being two separate answers.
 */
export function moneySectionFirmDestination(slug: MoneySectionSlug): DestinationId | null {
  const named: Readonly<Record<MoneySectionSlug, DestinationId | null>> = {
    time: "time",
    fees: "fees",
    costs: "costs",
    billing: "billing",
    trust: "trust",
  };
  const destinationId = named[slug];
  if (destinationId === null) return null;
  // A destination that is announced but not shipped is a Soon row, and a way OUT to a page that
  // does not exist is worse than no way out: the link is offered only once the surface is real.
  const destination = destinationById(destinationId);
  return destination !== null && destination.shipped ? destinationId : null;
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
