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
    // The host the other file utilities are run from: a file is brought here once and every
    // capability addresses it, rather than each tool asking for the same bytes again. Ephemeral by
    // definition — nothing here is attached to a matter, so there is no matter context to carry.
    backing: { kind: "library" },
    matterContext: "none",
    // Addressed at the top level, because it is a sidebar destination in its own right rather than
    // a utility reached through the Tools area (apps/web/src/lib/navigation/destinations.ts). It
    // keeps its manifest row so that the file context tag still has a tool to offer, and so the
    // listing that carries the ten file utilities still shows the host they are run from.
    route: "/file-workbench",
  },
  {
    id: "file-converter",
    name: "File Converter",
    icon: "file-cog",
    subjectGroup: "files",
    permission: assertPermission("tools:fileConverter"),
    contextTags: ["file", "none"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "metadata-scrubber",
    name: "Metadata Inspector & Scrubber",
    icon: "file-search",
    subjectGroup: "files",
    permission: assertPermission("tools:metadataScrubber"),
    contextTags: ["file", "none"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "file-hash-integrity",
    name: "File Hash & Integrity",
    icon: "fingerprint",
    subjectGroup: "files",
    permission: assertPermission("tools:fileIntegrity"),
    contextTags: ["file", "none"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "file-decryption",
    name: "File Decryption & Recovery",
    icon: "lock-open",
    subjectGroup: "files",
    permission: assertPermission("tools:decryption"),
    contextTags: ["file"],
    // The workbench for removing password protection. Today: unlock a file with a known password and
    // recover a lost one. A future operation strips a PDF's owner/permissions ("editing") restrictions
    // from a document that opens without a prompt — the engine already does this via pdf-core's
    // decryptDocument on an owner-only document; only this tool's UI and route seam remain.
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "file-type-verifier",
    name: "File Type Verifier",
    icon: "file-check",
    subjectGroup: "files",
    permission: assertPermission("tools:fileTypeVerifier"),
    contextTags: ["file", "none"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "ai-text-detection",
    name: "AI-Text Detection",
    icon: "scan-text",
    subjectGroup: "files",
    permission: assertPermission("tools:aiTextDetection"),
    contextTags: ["none"],
    backing: { kind: "integration", category: "ai-detection" },
    matterContext: "optional",
  },
  {
    id: "file-repair",
    name: "File Repair & Salvage",
    icon: "wrench",
    subjectGroup: "files",
    permission: assertPermission("tools:fileRepair"),
    contextTags: ["file", "none"],
    // The recovery engine runs in an internal Container, not a connected third-party integration, so
    // this is `library` (the same backing the other in-house file utilities use). Stateless by default;
    // the "optional" matter context is the seam for the opt-in attach-to-matter path.
    backing: { kind: "library" },
    matterContext: "optional",
  },
  {
    id: "ocr",
    name: "Text Recognition",
    icon: "scan-text",
    subjectGroup: "files",
    permission: assertPermission("tools:ocr"),
    contextTags: ["file", "none"],
    // The recognition engine runs in an internal Container, not a connected third-party integration,
    // so this is `library` — the same backing the other in-house file utilities use. Stateless: the
    // engine writes nothing. Turning the recognized text into a searchable PDF lands in a later slice.
    backing: { kind: "library" },
    matterContext: "optional",
  },
  {
    id: "email-inspector",
    name: "Email Inspector",
    icon: "mail-search",
    subjectGroup: "files",
    permission: assertPermission("tools:emailInspector"),
    contextTags: ["file", "none"],
    // The parse engine is in-house WebAssembly, not a connected third-party service.
    backing: { kind: "library" },
    // Stateless: bytes in, a report out. Nothing is stored, so no matter is involved.
    matterContext: "none",
  },
  {
    id: "malware-scan",
    name: "Malware Scan",
    icon: "shield-check",
    subjectGroup: "files",
    // Gated on the same capability the scan diagnostic route requires (POST /api/v1/scan/diagnose),
    // seeded to every default role. A one-off, matter-less diagnostic: the file is not stored.
    permission: assertPermission("firm:scanFile"),
    contextTags: ["file"],
    backing: { kind: "library" },
    matterContext: "none",
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
