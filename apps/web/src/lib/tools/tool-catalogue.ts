/*
 * The Tools catalogue — the tool catalog and its presentation layer projected into the shared
 * catalogue vocabulary ($lib/catalogue), which is what the /tools screen renders.
 *
 * Nothing about a tool is decided here. The catalog owns identity and subject group, the
 * presentation layer owns the descriptor, the stage and the glyph, and tool-permissions.ts owns
 * what a member may see; this module only says which of those facts fills which part of a
 * catalogue entry. The rule for `href` is the palette's rule, from the same predicate: a tool with
 * a surface routes at /tools/<id>, and one without goes nowhere rather than to a page that is not
 * there.
 *
 * Imported by RELATIVE path rather than the $lib alias, and none of it type-only: this module is
 * exercised by a unit test in the plugin-less node pool, the same constraint tool-destinations.ts
 * carries.
 */
import { hasSurface } from "@magna-carta/design-system/maturity";
import { toolRoute } from "@magna-carta/tools/catalog";
import type { CatalogueEntry, CatalogueSection } from "../catalogue/catalogue.ts";
import {
  SUBJECT_GROUP_LABELS,
  toolIcon,
  toolPresentation,
  toolSearchKeywords,
  visibleToolGroups,
} from "./tool-presentation.ts";

/** Where the tools catalogue remembers whether this browser reads it as tiles or as rows. */
export const TOOLS_VIEW_STORAGE_KEY = "mc-tools-view";

/**
 * Every tool the member may see, grouped by subject in the catalog's canonical order. Throws only
 * if the catalog outran the presentation layer, through that layer's own guarded accessors.
 */
export function toolCatalogueSections(): readonly CatalogueSection[] {
  return visibleToolGroups().map(({ group, tools }) => ({
    id: group,
    label: SUBJECT_GROUP_LABELS[group],
    entries: tools.map((tool): CatalogueEntry => {
      const presentation = toolPresentation(tool);
      return {
        id: tool.id,
        name: tool.name,
        description: presentation.description,
        stage: presentation.stage,
        icon: toolIcon(tool),
        href: hasSurface(presentation.stage) ? toolRoute(tool) : null,
        keywords: toolSearchKeywords(tool),
      };
    }),
  }));
}
