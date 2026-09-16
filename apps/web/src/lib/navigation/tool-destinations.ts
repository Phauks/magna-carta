/*
 * The Tools provider for the command palette — searchable tool entries DERIVED from the tool
 * catalog (@magna-carta/tools) and the web presentation layer (tool-presentation.ts), never a
 * hand-list. Adding a tool to the catalog (with its presentation entry) is exactly what makes it
 * searchable here, the same contract by which a destination becomes searchable by joining the
 * destination registry (navigation/destinations.ts). The palette (components/command-palette.svelte)
 * renders this registry; it must never hardcode a tool row.
 *
 * Three facts are reused, not re-derived:
 *   - Each tool is addressed by toolRoute(): /tools/<id> for a tool reached inside the Tools
 *     area, and its declared route for one addressed at the top level.
 *   - Whether a tool is launchable is hasSurface(stage) from maturity.ts, the exact predicate the
 *     Tools catalogue (tools/tool-catalogue.ts) uses to decide whether an entry is a link. A `soon`
 *     tool has no surface yet; alpha and above do.
 *   - The extra words a tool is findable by are toolSearchKeywords() from the presentation layer,
 *     the same net the Tools catalogue's own search casts, so a word that reaches a tool in one
 *     place reaches it in the other.
 *
 * A tool whose presentation entry is missing throws at the guarded accessor (toolPresentation),
 * failing loud rather than surfacing a blank row.
 *
 * The two app-local dependencies are imported by RELATIVE path, not the $lib alias, and neither is
 * a type-only import: this module is exercised by a unit test (test/tool-destinations.test.ts) that
 * runs in vitest's plugin-less node pool (vitest.config.ts), where the SvelteKit $lib alias is not
 * resolved. It is the same constraint that keeps tool-presentation.ts's $lib import type-only.
 */
import { CATALOG, toolRoute } from "@magna-carta/tools/catalog";
import { hasSurface } from "@magna-carta/design-system/maturity";
import {
  SUBJECT_GROUP_LABELS,
  toolPresentation,
  toolSearchKeywords,
} from "../tools/tool-presentation.ts";

export interface ToolDestination {
  /** Stable catalog id (kebab-case). */
  readonly id: string;
  /** Display name — the primary thing a member searches by. */
  readonly name: string;
  /** The tool's own address (toolRoute). Only followed when `launchable` is true. */
  readonly href: string;
  /** One-line descriptor from the presentation layer, shown and folded into the search net. */
  readonly description: string;
  /** True when the tool has a real surface to open; false renders a disabled "— soon" row. */
  readonly launchable: boolean;
  /** Extra search terms so a tool is findable by more than its name. */
  readonly keywords: readonly string[];
}

/**
 * Every catalog tool as a searchable palette entry, in the catalog's canonical order. Throws only
 * if the catalog outran the presentation registry (via toolPresentation's guard).
 *
 * A tool that declares its own `route` is skipped: declaring one is what a tool does when it has
 * outgrown the Tools area and earned a destination row of its own, and the palette already renders
 * the destination registry beside this list. Offering the same surface twice in one flat search is
 * two rows a reader has to tell apart, and the destination row is the one carrying the description
 * and the maturity badge. The Tools area's own projection drops it for its own reason
 * (tools/tool-catalogue.ts): every row in that column loads beside the column.
 */
export function toolDestinations(): readonly ToolDestination[] {
  return CATALOG.filter((tool) => tool.route === undefined).map((tool) => {
    const presentation = toolPresentation(tool);
    return {
      id: tool.id,
      name: tool.name,
      href: toolRoute(tool),
      description: presentation.description,
      launchable: hasSurface(presentation.stage),
      keywords: [
        presentation.description,
        SUBJECT_GROUP_LABELS[tool.subjectGroup],
        ...toolSearchKeywords(tool),
      ],
    };
  });
}
