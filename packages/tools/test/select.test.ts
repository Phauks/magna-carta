import { assertPermission, type Permission } from "@magna-carta/access-control/registry";
import { describe, expect, it } from "vitest";
import { CATALOG } from "../src/catalog.ts";
import { toolsByGroup, toolsFor } from "../src/select.ts";
import type { ToolManifest } from "../src/types.ts";

function makeTool(
  over: Partial<ToolManifest> & Pick<ToolManifest, "id" | "permission">,
): ToolManifest {
  return {
    id: over.id,
    name: over.name ?? over.id,
    icon: over.icon ?? "circle",
    subjectGroup: over.subjectGroup ?? "records",
    permission: over.permission,
    contextTags: over.contextTags ?? ["none"],
    backing: over.backing ?? { kind: "library" },
    matterContext: over.matterContext ?? "none",
  };
}

const propertyListings = assertPermission("tools:propertyListings");
const businessLookup = assertPermission("tools:businessLookup");
const shipping = assertPermission("tools:shipping");

const catalog: ToolManifest[] = [
  makeTool({
    id: "a",
    permission: propertyListings,
    subjectGroup: "records",
    contextTags: ["address"],
  }),
  makeTool({
    id: "b",
    permission: businessLookup,
    subjectGroup: "internet",
    contextTags: ["company"],
  }),
  makeTool({
    id: "c",
    permission: shipping,
    subjectGroup: "mailing",
    contextTags: ["address"],
  }),
];

const allPermissions = new Set<Permission>([propertyListings, businessLookup, shipping]);

describe("toolsByGroup", () => {
  it("groups permitted tools in fixed subject order, omitting empty groups", () => {
    const grouped = toolsByGroup(catalog, allPermissions);
    expect(grouped.map((entry) => entry.group)).toEqual(["records", "internet", "mailing"]);
    expect(grouped[0]!.tools.map((tool) => tool.id)).toEqual(["a"]);
  });

  it("sorts a group's tools alphabetically by name, not by catalog order", () => {
    // Owner's direction, 2026-09-16. A member scans the rail for a NAME; the order rows were
    // written in is a fact about this repository and not about the firm.
    const unsorted = [
      makeTool({ id: "z", name: "Zoning Lookup", permission: propertyListings }),
      makeTool({ id: "a", name: "Assessor Records", permission: businessLookup }),
      makeTool({ id: "m", name: "map overlays", permission: shipping }),
    ];
    const grouped = toolsByGroup(unsorted, allPermissions);
    expect(grouped[0]!.tools.map((tool) => tool.name)).toEqual([
      "Assessor Records",
      "map overlays",
      "Zoning Lookup",
    ]);
  });

  it("hides tools the principal lacks permission for, and drops a group that empties", () => {
    const grouped = toolsByGroup(catalog, new Set<Permission>([businessLookup]));
    expect(grouped.map((entry) => entry.group)).toEqual(["internet"]);
  });

  it("returns [] when the principal holds nothing", () => {
    expect(toolsByGroup(catalog, new Set<Permission>())).toEqual([]);
  });
});

describe("toolsFor", () => {
  it("returns permitted tools accepting the tag, in catalog order", () => {
    expect(toolsFor(catalog, "address", allPermissions).map((tool) => tool.id)).toEqual(["a", "c"]);
  });

  it("excludes tools the principal cannot access", () => {
    expect(
      toolsFor(catalog, "address", new Set<Permission>([propertyListings])).map((tool) => tool.id),
    ).toEqual(["a"]);
  });

  it("returns [] when nothing matches the tag", () => {
    expect(toolsFor(catalog, "person", allPermissions)).toEqual([]);
  });
});

describe("file context tag", () => {
  // The File Workbench is the whole of the files group now: the ten utilities that used to answer
  // the file tag beside it were its own capability tabs, and retired into them. This is what keeps
  // the tag answerable at all — a file context with nothing to offer is a dead menu.
  it("surfaces the workbench for the 'file' context when permitted", () => {
    const permissions = new Set([assertPermission("tools:fileWorkbench")]);
    const ids = toolsFor(CATALOG, "file", permissions).map((tool) => tool.id);
    expect(ids).toContain("file-workbench");
  });

  it("hides it without the permission", () => {
    const ids = toolsFor(CATALOG, "file", new Set()).map((tool) => tool.id);
    expect(ids).not.toContain("file-workbench");
  });
});

describe("the internet cluster and the website context tag", () => {
  const whois = assertPermission("tools:whois");
  const safeBrowse = assertPermission("tools:safeBrowse");

  const webDomainsCatalog: ToolManifest[] = [
    makeTool({
      id: "whois-lookup",
      name: "WHOIS Lookup",
      permission: whois,
      subjectGroup: "internet",
      contextTags: ["website"],
    }),
    makeTool({
      id: "safe-website-viewer",
      name: "Safe Website Viewer",
      permission: safeBrowse,
      subjectGroup: "internet",
      contextTags: ["website"],
    }),
  ];

  const webPermissions = new Set<Permission>([whois, safeBrowse]);

  it("surfaces both website tools under Internet, alphabetically", () => {
    const groups = toolsByGroup(webDomainsCatalog, webPermissions);
    const internet = groups.find((group) => group.group === "internet");
    expect(internet?.tools.map((tool) => tool.id)).toEqual(["safe-website-viewer", "whois-lookup"]);
  });

  it("toolsFor('website') returns both website tools", () => {
    const ids = toolsFor(webDomainsCatalog, "website", webPermissions).map((t) => t.id);
    expect(ids).toEqual(["whois-lookup", "safe-website-viewer"]);
  });
});
