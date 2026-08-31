/*
 * The Tools listing's presentation layer. The domain catalog (@magna-carta/tools) owns tool
 * identity; this module owns how a tool READS on the page — its one-line descriptor, how
 * finished its UI surface is (the maturity stage), the icon component its catalog icon-name
 * resolves to, and the human label for each subject group. A covering test asserts this layer
 * stays complete against the catalog, so a tool added to the catalog cannot render blank.
 *
 * A tool stays `soon` until its own page exists; four have one today (the network speed test,
 * the WHOIS lookup, the safe website viewer, and the firm usage report, all `alpha`). As each
 * remaining tool's page is built, its entry advances (alpha/beta/ready) and the listing entry
 * becomes launchable — nothing here is faked meanwhile.
 */
import type { Component } from "svelte";
import House from "@lucide/svelte/icons/house";
import Landmark from "@lucide/svelte/icons/landmark";
import Building2 from "@lucide/svelte/icons/building-2";
import BadgeCheck from "@lucide/svelte/icons/badge-check";
import Package from "@lucide/svelte/icons/package";
import Gauge from "@lucide/svelte/icons/gauge";
import ChartPie from "@lucide/svelte/icons/chart-pie";
import Globe from "@lucide/svelte/icons/globe";
import Shield from "@lucide/svelte/icons/shield";
import FileCog from "@lucide/svelte/icons/file-cog";
import FileSearch from "@lucide/svelte/icons/file-search";
import Fingerprint from "@lucide/svelte/icons/fingerprint";
import LockOpen from "@lucide/svelte/icons/lock-open";
import FileCheck from "@lucide/svelte/icons/file-check";
import ScanText from "@lucide/svelte/icons/scan-text";
import Wrench from "@lucide/svelte/icons/wrench";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import MailSearch from "@lucide/svelte/icons/mail-search";
import { CATALOG } from "@magna-carta/tools/catalog";
import { toolsByGroup, type GroupedTools } from "@magna-carta/tools/select";
import type { SubjectGroup, ToolManifest } from "@magna-carta/tools/types";
// Type-only: elided at build, so the plugin-less test config never resolves the $lib alias.
import type { MaturityStage } from "$lib/maturity/maturity.ts";

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
    description: "Check a lawyer's bar standing and discipline history.",
    stage: "soon",
  },
  shipping: { description: "Rate and buy postage for a mailing.", stage: "soon" },
  "network-speed-test": {
    description: "Measure this connection's download, upload, latency, and quality.",
    stage: "alpha",
  },
  "firm-usage": { description: "See the firm's storage and platform consumption.", stage: "alpha" },
  "whois-lookup": { description: "Look up who registered a domain, and when.", stage: "alpha" },
  "safe-website-viewer": {
    description: "Open an untrusted website at arm's length.",
    stage: "alpha",
  },
  "file-converter": { description: "Convert a file from one format to another.", stage: "soon" },
  "metadata-scrubber": {
    description: "Inspect and strip hidden metadata from a file.",
    stage: "soon",
  },
  "file-hash-integrity": {
    description: "Compute a file's hash and confirm it hasn't changed.",
    stage: "soon",
  },
  "file-decryption": {
    description: "Unlock a protected file or recover its password.",
    stage: "soon",
  },
  "file-type-verifier": {
    description: "Confirm what a file really is, whatever its extension says.",
    stage: "soon",
  },
  "ai-text-detection": {
    description: "Estimate whether a passage was written by AI.",
    stage: "soon",
  },
  "file-repair": {
    description: "Repair and salvage a damaged or corrupted file.",
    stage: "soon",
  },
  ocr: {
    description: "Extract selectable text from a scanned document or image.",
    stage: "soon",
  },
  "email-inspector": {
    description: "Inspect an email file's headers, routing, and attachments.",
    stage: "soon",
  },
  "malware-scan": {
    description: "Scan a file for malware and see what it finds.",
    stage: "soon",
  },
};

// SubjectGroup → engraved section label.
export const SUBJECT_GROUP_LABELS: Record<SubjectGroup, string> = {
  property: "Property",
  "business-entities": "Business Entities",
  "people-licenses": "People & Licenses",
  "mailing-shipping": "Mailing & Shipping",
  printing: "Printing",
  "web-domains": "Web & Domains",
  files: "Documents & Files",
  diagnostics: "Diagnostics",
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
  "chart-pie": ChartPie,
  globe: Globe,
  shield: Shield,
  "file-cog": FileCog,
  "file-search": FileSearch,
  fingerprint: Fingerprint,
  "lock-open": LockOpen,
  "file-check": FileCheck,
  "scan-text": ScanText,
  wrench: Wrench,
  "shield-check": ShieldCheck,
  "mail-search": MailSearch,
};

// Both lookups are keyed by a plain string (Record<string, T>), so an indexed read types as
// possibly-undefined under this project's noUncheckedIndexedAccess — even though the
// completeness test above guarantees every catalog tool resolves both. These two accessors are
// the one place that guarantee is asserted, so call sites (tool-tile.svelte, tool-row.svelte,
// the /tools page) read a plain ToolPresentation/Component, never an optional.

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

// Mock permission seam: the managing partner sees everything, so grant every permission the
// catalog declares. The member's real grants replace this set when auth lands; the
// toolsByGroup call site below does not change.
const mockPermissions = new Set(CATALOG.map((tool) => tool.permission));

// The page's data: permitted tools grouped by subject in the catalog's fixed order, empty
// groups omitted — the same gate the contextual tool surfaces use.
export function visibleToolGroups(): GroupedTools[] {
  return toolsByGroup(CATALOG, mockPermissions);
}
