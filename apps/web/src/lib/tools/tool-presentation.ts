/*
 * The tools' presentation layer. The domain catalog (@magna-carta/tools) owns tool identity; this
 * module owns how a tool READS — its one-line descriptor, how finished its UI surface is (the
 * maturity stage), and the icon component its catalog icon-name resolves to. A covering test
 * asserts this layer stays complete against the catalog, so a tool added to the catalog cannot
 * render blank.
 *
 * The human label for each subject cluster is NOT here any more: a cluster is a thing the rail
 * draws, with a glyph and a fold of its own, so it lives with the rail's other clusters
 * (navigation/clusters.ts) rather than in a table only the retired /tools index ever read.
 *
 * A tool stays `soon` until its own page exists; four have one today, all `alpha` — the network
 * speed test, the WHOIS lookup, the safe website viewer and the file workbench. As a tool's page is
 * built its entry advances (alpha/beta/ready) and its rail row becomes a link; nothing here is
 * faked meanwhile. (The firm usage report had one too, and is no longer a tool: it reads the firm's
 * own records rather than running anything, so it is a Firm destination now.)
 *
 * The ten file utilities that used to sit beside the workbench were its own capability tabs under
 * another name, and were retired into them. Their search vocabulary did not retire with them: it
 * moved onto the workbench's synonyms below, so the words that used to reach "OCR" or "Metadata
 * Scrubber" still reach the screen that does the work.
 */
import type { Component } from "svelte";
import House from "@lucide/svelte/icons/house";
import Landmark from "@lucide/svelte/icons/landmark";
import Building2 from "@lucide/svelte/icons/building-2";
import BadgeCheck from "@lucide/svelte/icons/badge-check";
import Package from "@lucide/svelte/icons/package";
import Gauge from "@lucide/svelte/icons/gauge";
import Globe from "@lucide/svelte/icons/globe";
import Shield from "@lucide/svelte/icons/shield";
import Microscope from "@lucide/svelte/icons/microscope";
import { CATALOG } from "@magna-carta/tools/catalog";
import { toolsByGroup, type GroupedTools } from "@magna-carta/tools/select";
import type { ToolManifest } from "@magna-carta/tools/types";
import { grantedPermissions } from "./tool-permissions.ts";
// Type-only: elided at build, so the plugin-less test config never resolves the $lib alias.
import type { MaturityStage } from "@magna-carta/design-system/maturity";

export interface ToolPresentation {
  /** One line, plain language, what the tool does — no marketing voice. */
  readonly description: string;
  /** How finished the tool's UI surface is. `ready` → launchable, wears no badge. */
  readonly stage: MaturityStage;
}

// Keyed by ToolManifest.id. The completeness test pins this to the catalog id set.
export const TOOL_PRESENTATION: Record<string, ToolPresentation> = {
  "property-listing-links": {
    description: "Open a property address across the major listing sites.",
    stage: "soon",
  },
  "county-property-records": {
    description: "Jump to the county assessor and recorder for an address.",
    stage: "soon",
  },
  "business-entity-lookup": {
    description: "Find a company's registration in the state business registry.",
    stage: "soon",
  },
  "attorney-license-lookup": {
    // Not "check": the screen opens the state's own register and reads nothing back. Saying it
    // checks standing would promise an answer this platform never sees, and standing is exactly the
    // fact that changes after you look.
    description: "Open the official register where a lawyer's standing is verified.",
    stage: "alpha",
  },
  shipping: { description: "Rate and buy postage for a mailing.", stage: "alpha" },
  "network-speed-test": {
    description: "Measure this connection's download, upload, latency, and quality.",
    stage: "alpha",
  },
  "whois-lookup": { description: "Look up who registered a domain, and when.", stage: "alpha" },
  "safe-website-viewer": {
    description: "Open an untrusted website at arm's length.",
    stage: "alpha",
  },
  "file-workbench": {
    description: "Bring a file that belongs to no matter, and read it every way at once.",
    stage: "alpha",
  },
};

// Catalog icon-name string → imported Lucide component. Explicit imports (the destinations.ts
// idiom), not dynamic import; the completeness test asserts every catalog icon appears here.
export const TOOL_ICONS: Record<string, Component> = {
  house: House,
  landmark: Landmark,
  "building-2": Building2,
  "badge-check": BadgeCheck,
  package: Package,
  gauge: Gauge,
  globe: Globe,
  shield: Shield,
  microscope: Microscope,
};

// Both lookups are keyed by a plain string (Record<string, T>), so an indexed read types as
// possibly-undefined under this project's noUncheckedIndexedAccess — even though the
// completeness test above guarantees every catalog tool resolves both. These two accessors are
// the one place that guarantee is asserted, so call sites (the rail's tool rows, the palette's tool
// provider) read a plain ToolPresentation/Component, never an optional.

/** A catalog tool's presentation entry. Throws only if the catalog outran this module's table. */
export function toolPresentation(tool: ToolManifest): ToolPresentation {
  const presentation = TOOL_PRESENTATION[tool.id];
  if (presentation === undefined) {
    throw new Error(`No presentation entry for tool "${tool.id}".`);
  }
  return presentation;
}

/** A catalog tool's icon component. Throws only if the catalog outran this module's icon map. */
export function toolIcon(tool: ToolManifest): Component {
  const icon = TOOL_ICONS[tool.icon];
  if (icon === undefined) {
    throw new Error(`No icon component for icon "${tool.icon}".`);
  }
  return icon;
}

/*
 * Lay search synonyms — words a member is likely to type that a tool's name and one-line
 * descriptor do not literally contain (a speed test hunted as "bandwidth", a WHOIS lookup as
 * "registrant"). Search-only, never shown, and deliberately PARTIAL: a tool absent here is still
 * findable by its name, its descriptor and its subject group, so a newly added catalog tool never
 * becomes invisible for lacking an entry — this map only widens the net. Keyed by catalog id.
 *
 * It lives in the presentation layer because it is a fact about the tool rather than about any one
 * surface: the command palette (navigation/tool-destinations.ts) casts this net today, and the next
 * surface that searches tools gets the same words for free rather than a second list.
 */
const TOOL_SEARCH_SYNONYMS: Record<string, readonly string[]> = {
  "network-speed-test": ["bandwidth", "throughput", "ping", "latency", "internet", "connection"],
  "whois-lookup": ["registrant", "registration", "dns", "nameserver", "domain owner"],
  "attorney-license-lookup": [
    "bar",
    "bar number",
    "good standing",
    "admitted",
    "admission",
    "disbarred",
    "suspended",
    "discipline",
    "opposing counsel",
    "state bar",
  ],
  "safe-website-viewer": [
    "phishing",
    "suspicious link",
    "screenshot",
    "redirect",
    "url preview",
    "sandbox",
  ],
  /*
   * THE RETIRED TEN. Each of these words used to reach a catalog row of its own, and each of those
   * rows was a File Workbench capability tab under another name. The rows are gone; the words must
   * not be, or retiring them would have taken the vocabulary with them and a member searching "ocr"
   * would find nothing. Keep this list in step with the capability registry
   * (file-workbench/capabilities.ts) — a capability added there wants its lay words here.
   */
  "file-workbench": [
    "convert",
    "converter",
    "metadata",
    "scrub metadata",
    "exif",
    "hash",
    "checksum",
    "sha256",
    "md5",
    "integrity",
    "decrypt",
    "decryption",
    "unlock",
    "password",
    "file type",
    "verify type",
    "extension",
    "magic bytes",
    "ai text",
    "ai detection",
    "repair",
    "salvage",
    "corrupt",
    "ocr",
    "text recognition",
    "scanned",
    "email inspector",
    "headers",
    "eml",
    "msg",
    "malware",
    "virus",
    "scan",
  ],
};

/**
 * The extra words a tool is findable by, beyond what a surface already shows: the contexts it runs
 * in, and its lay synonyms. A caller adds whatever it displays — the name, the descriptor, the
 * group heading — rather than receiving them twice.
 */
export function toolSearchKeywords(tool: ToolManifest): readonly string[] {
  return [
    ...tool.contextTags.filter((tag) => tag !== "none"),
    ...(TOOL_SEARCH_SYNONYMS[tool.id] ?? []),
  ];
}

// The rail's data: permitted tools grouped by subject cluster in the catalog's fixed order, empty
// clusters omitted, tools alphabetical within a cluster — the same gate the contextual tool
// surfaces use. The grant itself is the
// area-wide seam in tool-permissions.ts, shared with the workbench so the two cannot disagree
// about what a member holds.
export function visibleToolGroups(): GroupedTools[] {
  return toolsByGroup(CATALOG, grantedPermissions());
}
