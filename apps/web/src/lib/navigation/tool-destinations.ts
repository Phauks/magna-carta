/*
 * The Tools provider for the command palette — searchable tool entries DERIVED from the tool
 * catalog (@magna-carta/tools) and the web presentation layer (tool-presentation.ts), never a
 * hand-list. Adding a tool to the catalog (with its presentation entry) is exactly what makes it
 * searchable here, the same contract by which a destination becomes searchable by joining the
 * destination registry (navigation/destinations.ts). The palette (components/command-palette.svelte)
 * renders this registry; it must never hardcode a tool row.
 *
 * SINCE THE TOOLS AREA CLOSED, this is also the only place a tool's descriptor is read outside the
 * rail. The /tools index carried the descriptions and the search; when it was retired (every tool is
 * a top-level ability now — see navigation/tool-sidebar.ts) the palette was already doing the same
 * job better, over every destination at once, from one keystroke, without a navigation first.
 *
 * Three facts are reused, not re-derived:
 *   - Each tool is addressed by toolRoute(): /<id>, at the top level.
 *   - Whether a tool is launchable is hasSurface(stage) from maturity.ts. A `soon` tool has no
 *     surface yet; alpha and above do.
 *   - The extra words a tool is findable by are toolSearchKeywords() from the presentation layer, so
 *     a word that reaches a tool here reaches it in the rail's tooltip vocabulary too.
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
import { toolPresentation, toolSearchKeywords } from "../tools/tool-presentation.ts";
import { clusterById } from "./clusters.ts";

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
 * Every catalog tool as a searchable palette entry, in the catalog's declared order. Throws only if
 * the catalog outran the presentation registry (via toolPresentation's guard).
 *
 * Every tool is listed — there is no longer such a thing as a tool that lives somewhere the palette
 * does not reach, because there is no longer a Tools area for one to live outside of. The cluster's
 * label joins the search net so "internet" reaches the WHOIS lookup and "records" the county
 * recorder, which is the vocabulary the rail now shows a member.
 */
export function toolDestinations(): readonly ToolDestination[] {
  return CATALOG.map((tool) => {
    const presentation = toolPresentation(tool);
    const cluster = clusterById(tool.subjectGroup);
    return {
      id: tool.id,
      name: tool.name,
      href: toolRoute(tool),
      description: presentation.description,
      launchable: hasSurface(presentation.stage),
      keywords: [
        presentation.description,
        ...(cluster === null ? [] : [cluster.label]),
        ...toolSearchKeywords(tool),
      ],
    };
  });
}
