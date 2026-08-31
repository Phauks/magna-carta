/*
 * The Tools provider for the command palette — searchable tool entries DERIVED from the tool
 * catalog (@magna-carta/tools) and the web presentation layer (tool-presentation.ts), never a
 * hand-list. Adding a tool to the catalog (with its presentation entry) is exactly what makes it
 * searchable here, the same contract by which a destination becomes searchable by joining the
 * destination registry (navigation/destinations.ts). The palette (components/command-palette.svelte)
 * renders this registry; it must never hardcode a tool row.
 *
 * Two facts are reused, not re-derived:
 *   - Each tool routes at /tools/<id> — the route directory is named after the catalog id.
 *   - Whether a tool is launchable is hasSurface(stage) from maturity.ts, the exact predicate the
 *     Tools listing's tiles and rows (tools/tool-tile.svelte, tools/tool-row.svelte) use to decide
 *     whether to render an anchor. A `soon` tool has no surface yet; alpha and above do.
 *
 * A tool whose presentation entry is missing throws at the guarded accessor (toolPresentation),
 * failing loud rather than surfacing a blank row.
 *
 * The two app-local dependencies are imported by RELATIVE path, not the $lib alias, and neither is
 * a type-only import: this module is exercised by a unit test (test/tool-destinations.test.ts) that
 * runs in vitest's plugin-less node pool (vitest.config.ts), where the SvelteKit $lib alias is not
 * resolved. It is the same constraint that keeps tool-presentation.ts's $lib import type-only.
 */
import { CATALOG } from "@magna-carta/tools/catalog";
import { hasSurface } from "../maturity/maturity.ts";
import { SUBJECT_GROUP_LABELS, toolPresentation } from "../tools/tool-presentation.ts";

export interface ToolDestination {
  /** Stable catalog id (kebab-case); also the route segment. */
  readonly id: string;
  /** Display name — the primary thing a member searches by. */
  readonly name: string;
  /** Routes at /tools/<id>. Only followed when `launchable` is true. */
  readonly href: string;
  /** One-line descriptor from the presentation layer, shown and folded into the search net. */
  readonly description: string;
  /** True when the tool has a real surface to open; false renders a disabled "— soon" row. */
  readonly launchable: boolean;
  /** Extra search terms so a tool is findable by more than its name (see below). */
  readonly keywords: readonly string[];
}

/*
 * Lay search synonyms — words a member is likely to type that a tool's name and one-line
 * description do not literally contain (a speed test hunted as "bandwidth", a WHOIS lookup as
 * "registrant"). Search-only, and deliberately PARTIAL: a tool absent here is still findable by its
 * name, description, and subject group, so a new catalog tool never becomes invisible for lacking an
 * entry — this map only widens the net. Keyed by catalog id. The durable home for richer synonyms
 * is the presentation layer (tool-presentation.ts) once it grows a keywords field.
 */
const TOOL_SEARCH_SYNONYMS: Record<string, readonly string[]> = {
  "network-speed-test": ["bandwidth", "throughput", "ping", "latency", "internet", "connection"],
  "whois-lookup": ["registrant", "registration", "dns", "nameserver", "domain owner"],
  "safe-website-viewer": [
    "phishing",
    "suspicious link",
    "screenshot",
    "redirect",
    "url preview",
    "sandbox",
  ],
};

/**
 * Every catalog tool as a searchable palette entry, in the catalog's canonical order. Throws only
 * if the catalog outran the presentation registry (via toolPresentation's guard).
 */
export function toolDestinations(): readonly ToolDestination[] {
  return CATALOG.map((tool) => {
    const presentation = toolPresentation(tool);
    const contextTerms = tool.contextTags.filter((tag) => tag !== "none");
    const synonyms = TOOL_SEARCH_SYNONYMS[tool.id] ?? [];
    return {
      id: tool.id,
      name: tool.name,
      href: `/tools/${tool.id}`,
      description: presentation.description,
      launchable: hasSurface(presentation.stage),
      keywords: [
        presentation.description,
        SUBJECT_GROUP_LABELS[tool.subjectGroup],
        ...contextTerms,
        ...synonyms,
      ],
    };
  });
}
