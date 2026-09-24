import { assertPermission } from "@magna-carta/access-control/registry";
import type { ToolManifest } from "./types.ts";

/*
 * The single source of truth for the firm's standalone tools. The rail renders this grouped by
 * subject cluster; contextual surfaces query it by context tag. Adding a tool is one row here (and,
 * for the UI, a route and a presentation entry in the web app). Each permission is validated at
 * module load — an unregistered key fails loud here rather than rendering a tool no one can be
 * granted.
 *
 * EVERY TOOL IS A TOP-LEVEL ABILITY (owner's direction, 2026-09-16). There is no Tools area to be
 * inside any more: no index screen, no sub-page, no /tools/<id> address. A tool is addressed at
 * /<id>, reached in one press from the rail, and opens onto the whole canvas. The rail folds them
 * into subject clusters (types.ts) so nine rows read as four; the clusters are a fold, not a
 * screen — nothing is reached THROUGH one.
 *
 * ROW ORDER HERE IS NOT RENDER ORDER. Tools sort alphabetically by name within their cluster
 * (select.ts); this list is grouped by cluster only so a reader of the catalog sees the shape.
 */
export const CATALOG: readonly ToolManifest[] = [
  // Records — a public register or a record site, opened for a subject the firm is working on.
  {
    id: "attorney-license-lookup",
    name: "Attorney License Lookup",
    icon: "badge-check",
    subjectGroup: "records",
    permission: assertPermission("tools:attorneyLicense"),
    contextTags: ["person"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "business-entity-lookup",
    name: "Business Entity Lookup",
    icon: "building-2",
    subjectGroup: "records",
    permission: assertPermission("tools:businessLookup"),
    contextTags: ["company"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "county-property-records",
    name: "County Property Records",
    icon: "landmark",
    subjectGroup: "records",
    permission: assertPermission("tools:propertyRecords"),
    contextTags: ["address"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "property-listing-links",
    name: "Property Listing Links",
    icon: "house",
    subjectGroup: "records",
    permission: assertPermission("tools:propertyListings"),
    contextTags: ["address"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  // Internet — the network itself, and what is on it.
  {
    id: "network-speed-test",
    name: "Network Speed Test",
    icon: "gauge",
    subjectGroup: "internet",
    permission: assertPermission("tools:speedTest"),
    contextTags: ["none"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "safe-website-viewer",
    name: "Safe Website Viewer",
    icon: "shield",
    subjectGroup: "internet",
    permission: assertPermission("tools:safeBrowse"),
    contextTags: ["website"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "whois-lookup",
    name: "WHOIS Lookup",
    icon: "globe",
    subjectGroup: "internet",
    permission: assertPermission("tools:whois"),
    contextTags: ["website"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  // Mailing — what the firm sends.
  {
    id: "shipping",
    name: "Shipping & Postage",
    icon: "package",
    subjectGroup: "mailing",
    permission: assertPermission("tools:shipping"),
    contextTags: ["address"],
    backing: { kind: "integration", category: "shipping" },
    // A shipment MAY belong to a matter and often does not — a firm posts to a bank, an insurer, a
    // supplier with nothing to bill. Optional rather than none because the matter is what makes the
    // postage recoverable: a shipment with no matter emits no cost at all (the recoverable-charge
    // adapter treats a null matter as firm-administrative), so leaving this at none would mean no
    // firm ever bills postage back, with the whole recovery path built and unable to fire.
    matterContext: "optional",
  },
  // Files — a file that belongs to no matter.
  {
    id: "file-workbench",
    name: "File Workbench",
    icon: "microscope",
    subjectGroup: "files",
    permission: assertPermission("tools:fileWorkbench"),
    contextTags: ["file", "none"],
    // THE ONLY FILE ROW, and deliberately so. Ten sibling manifests used to sit here — convert,
    // scrub metadata, hash, unlock, verify a type, detect AI text, repair, recognize text, read an
    // email, scan for malware — and every one of them was this screen's own capability tab under
    // another name, so the catalog listed eleven doors into one room. They were retired into the
    // tabs they always were; the permissions they declared live on, each named by the capability
    // module that uses it (apps/web/src/lib/tools/file-workbench/capabilities/).
    //
    // Ephemeral by definition — nothing here is attached to a matter, so there is no matter context
    // to carry.
    backing: { kind: "library" },
    matterContext: "none",
  },
];

/**
 * Where a tool's surface is addressed: the top level, at its own id. Every consumer that turns a
 * manifest into a link goes through here, so the address is stated once.
 *
 * There is no area prefix because there is no area (see the note on CATALOG). The id is the path
 * segment, which is also what keeps the two from drifting: a tool cannot be renamed in the catalog
 * and left addressed at its old URL.
 */
export function toolRoute(tool: ToolManifest): string {
  return `/${tool.id}`;
}
