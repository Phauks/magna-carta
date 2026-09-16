/*
 * The tool catalog, projected into sidebar rows.
 *
 * WHY THE TOOLS LEFT THEIR SUB-PAGE. Until the owner's direction of 2026-09-16 every tool was
 * reached through a two-sided /tools screen: a navigation column of tools on the left, the chosen
 * tool on the right. Two things were wrong with it. The tools are not a family — a postage rate, a
 * WHOIS record, a county recorder's site and a bandwidth measurement have nothing to say to each
 * other, so a column listing them beside the one you opened is a column of things you are not
 * doing. And it cost the tool the width of that column permanently, which the surfaces that will
 * be used most — mailing and postage above all, where a label, a rate table and an address sit
 * side by side — are the ones that can least afford.
 *
 * So the rail carries them. A tool is a destination like any other now: one reach from wherever
 * the reader is, and the whole canvas when it opens.
 *
 * NOTHING ABOUT A TOOL IS DECIDED HERE. The catalog (@magna-carta/tools) owns identity, subject
 * group and the permission that gates it; the presentation layer ($lib/tools/tool-presentation.ts)
 * owns the descriptor, the stage and the glyph; toolRoute() owns the address. This module only
 * says which of those facts fills which part of a sidebar row — the same arrangement
 * tool-catalogue.ts and tool-destinations.ts already have for the index and the palette.
 *
 * A tool that declares its own `route` is left out, for the reason it always has been: declaring
 * one is what a tool does when it has outgrown the catalog and earned a destination row written by
 * hand in the registry (the File Workbench), and offering it twice would be two rows a reader has
 * to tell apart.
 */
import { toolRoute } from "@magna-carta/tools/catalog";
import { hasSurface } from "@magna-carta/design-system/maturity";
import { toolIcon, toolPresentation, visibleToolGroups } from "../tools/tool-presentation.ts";
import type { Destination } from "./destinations.ts";

/**
 * Every tool this member may see, as sidebar rows, in the catalog's canonical subject order.
 *
 * `pinned` is the truthful answer to the star layer rather than a way around it: what a member
 * sees here is decided by what they are PERMITTED to run, and a star that could hide a permitted
 * tool — or, worse, appear to grant one — would be a second answer to a question access control
 * has already settled. Customize mode leaves the group out for the same reason
 * (sidebar-preferences.svelte.ts).
 *
 * A tool with no surface yet renders exactly as an announced destination does: a Soon row that
 * goes nowhere, never a link to a page that is not there.
 */
export function toolSidebarDestinations(): readonly Destination[] {
  return visibleToolGroups().flatMap(({ tools }) =>
    tools
      .filter((tool) => tool.route === undefined)
      .map((tool): Destination => {
        const presentation = toolPresentation(tool);
        const shipped = hasSurface(presentation.stage);
        const row: Destination = {
          // Prefixed, so a tool can never collide with a registry id — `file-workbench` is both a
          // catalog manifest and a hand-written destination, and the day another tool graduates the
          // same way the two must still be separable.
          id: `tool-${tool.id}`,
          label: tool.name,
          href: toolRoute(tool),
          icon: toolIcon(tool),
          description: presentation.description,
          group: "tools",
          shipped,
          pinned: true,
          defaultStarred: true,
          stage: presentation.stage,
        };
        // `announced` is meaningful only without `shipped` — the registry's rule is that the pair is
        // the one combination rendering disabled — so it is added rather than always set.
        return shipped ? row : { ...row, announced: true };
      }),
  );
}
