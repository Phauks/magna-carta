/*
 * The tool catalog, projected into sidebar rows.
 *
 * WHY THERE IS NO TOOLS SCREEN LEFT. Until 2026-09-16 every tool was reached through a two-sided
 * /tools screen — a navigation column of tools on the left, the chosen tool on the right — and then
 * briefly through a /tools index that listed what each one did. Both are gone on the owner's
 * direction, for the reasons that made the column wrong in the first place. The tools are not a
 * family: a postage rate, a WHOIS record, a county recorder's site and a bandwidth measurement have
 * nothing to say to each other, so a screen listing them beside the one you opened is a screen of
 * things you are not doing. And an index is a stop on the way to work — a member who wants the
 * WHOIS lookup wants the WHOIS lookup, not a page about it.
 *
 * So EVERY TOOL IS A TOP-LEVEL ABILITY: its own address at /<id>, its own row in the rail, one
 * press from wherever the reader is, and the whole canvas when it opens. What the index carried
 * that was worth keeping — the descriptions, the search vocabulary — was never the index's: it is
 * the presentation layer's, and the command palette has rendered it all along.
 *
 * WHAT THE FOLD DOES. Nine flat rows under one heading is a wall, so each row names its catalog
 * subject as its CLUSTER (navigation/clusters.ts) and the rail folds it there: Records, Internet,
 * Mailing, Files. A cluster is a fold and never a screen — nothing is reached through one — so this
 * is the opposite of the sub-page it replaced, which charged a navigation for the same grouping.
 *
 * NOTHING ABOUT A TOOL IS DECIDED HERE. The catalog (@magna-carta/tools) owns identity, subject
 * cluster, the permission that gates it and its order within the cluster; the presentation layer
 * ($lib/tools/tool-presentation.ts) owns the descriptor, the stage and the glyph; toolRoute() owns
 * the address. This module only says which of those facts fills which part of a sidebar row.
 */
import { toolRoute } from "@magna-carta/tools/catalog";
import { hasSurface } from "@magna-carta/design-system/maturity";
import { toolIcon, toolPresentation, visibleToolGroups } from "../tools/tool-presentation.ts";
import type { Destination } from "./destinations.ts";

/**
 * Every tool this member may see, as sidebar rows: clusters in the catalog's canonical order, tools
 * alphabetical by name within a cluster.
 *
 * `pinned` is the truthful answer to the visibility layer rather than a way around it: what a member
 * sees here is decided by what they are PERMITTED to run, and an eye beside a tool would be a second
 * answer to a question access control has already settled. Customize mode leaves the group out for
 * the same reason (sidebar-preferences.svelte.ts) — what a member can do about a tool row they do
 * not want is fold its cluster, or favourite the ones they do.
 *
 * A tool with no surface yet renders exactly as an announced destination does: a Soon row that goes
 * nowhere, never a link to a page that is not there.
 */
export function toolSidebarDestinations(): readonly Destination[] {
  return visibleToolGroups().flatMap(({ group, tools }) =>
    tools.map((tool): Destination => {
      const presentation = toolPresentation(tool);
      const shipped = hasSurface(presentation.stage);
      const row: Destination = {
        // Prefixed, so a tool can never collide with a registry id — the two registries are in
        // different packages and neither can see the other's ids.
        id: `tool-${tool.id}`,
        label: tool.name,
        href: toolRoute(tool),
        icon: toolIcon(tool),
        description: presentation.description,
        group: "tools",
        cluster: group,
        shipped,
        pinned: true,
        defaultShown: true,
        stage: presentation.stage,
      };
      // `announced` is meaningful only without `shipped` — the registry's rule is that the pair is
      // the one combination rendering disabled — so it is added rather than always set.
      return shipped ? row : { ...row, announced: true };
    }),
  );
}
