import { assertPermission } from "@magna-carta/access-control/registry";
import type { ToolManifest } from "./types.ts";

// The single source of truth for the Tools area. The sidebar renders this grouped by subject;
// contextual surfaces query it by context tag. Adding a tool is one row here (and, for the UI, one
// id->component mapping in the shell). Each permission is validated at module load — an unregistered
// key fails loud here rather than rendering a tool no one can be granted.
export const CATALOG: readonly ToolManifest[] = [
  {
    id: "property-listing-links",
    name: "Property Listing Links",
    icon: "house",
    subjectGroup: "property",
    permission: assertPermission("tools:propertyListings"),
    contextTags: ["address"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "county-property-records",
    name: "County Property Records",
    icon: "landmark",
    subjectGroup: "property",
    permission: assertPermission("tools:propertyRecords"),
    contextTags: ["address"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "business-entity-lookup",
    name: "Business Entity Lookup",
    icon: "building-2",
    subjectGroup: "business-entities",
    permission: assertPermission("tools:businessLookup"),
    contextTags: ["company"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "attorney-license-lookup",
    name: "Attorney License Lookup",
    icon: "badge-check",
    subjectGroup: "people-licenses",
    permission: assertPermission("tools:attorneyLicense"),
    contextTags: ["person"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "shipping",
    name: "Shipping & Postage",
    icon: "package",
    subjectGroup: "mailing-shipping",
    permission: assertPermission("tools:shipping"),
    contextTags: ["address"],
    backing: { kind: "integration", category: "shipping" },
    matterContext: "none",
  },
  {
    id: "network-speed-test",
    name: "Network Speed Test",
    icon: "gauge",
    subjectGroup: "diagnostics",
    permission: assertPermission("tools:speedTest"),
    contextTags: ["none"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "firm-usage",
    name: "Firm Usage",
    icon: "chart-pie",
    subjectGroup: "diagnostics",
    permission: assertPermission("tools:firmUsage"),
    contextTags: ["none"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "whois-lookup",
    name: "WHOIS Lookup",
    icon: "globe",
    subjectGroup: "web-domains",
    permission: assertPermission("tools:whois"),
    contextTags: ["website"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "safe-website-viewer",
    name: "Safe Website Viewer",
    icon: "shield",
    subjectGroup: "web-domains",
    permission: assertPermission("tools:safeBrowse"),
    contextTags: ["website"],
    backing: { kind: "library" },
    matterContext: "none",
  },
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
    // Addressed at the top level, because it is a sidebar destination in its own right rather than
    // a utility reached through the Tools area (apps/web/src/lib/navigation/destinations.ts). The
    // manifest row stays for one reason only: so a `file` in hand can still be offered it through
    // toolsFor(). The Tools area's own listing and column leave it out, as does the palette's tool
    // provider, each because it is no longer one of the things they enumerate.
    route: "/file-workbench",
  },
];

/**
 * Where a tool's surface is addressed. The ordinary tool lives inside the Tools area at a route
 * named after its id; one that declares its own `route` has outgrown that area and is addressed
 * where it declares. Every consumer that turns a manifest into a link goes through here, so the
 * two facts a link needs — the address, and who is allowed to derive it — stay in one place.
 */
export function toolRoute(tool: ToolManifest): string {
  return tool.route ?? `/tools/${tool.id}`;
}
