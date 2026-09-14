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
    subjectGroup: over.subjectGroup ?? "property",
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
    subjectGroup: "property",
    contextTags: ["address"],
  }),
  makeTool({
    id: "b",
    permission: businessLookup,
    subjectGroup: "business-entities",
    contextTags: ["company"],
  }),
  makeTool({
    id: "c",
    permission: shipping,
    subjectGroup: "mailing-shipping",
    contextTags: ["address"],
  }),
];

const allPermissions = new Set<Permission>([propertyListings, businessLookup, shipping]);

describe("toolsByGroup", () => {
  it("groups permitted tools in fixed subject order, omitting empty groups", () => {
    const grouped = toolsByGroup(catalog, allPermissions);
    expect(grouped.map((entry) => entry.group)).toEqual([
      "property",
      "business-entities",
      "mailing-shipping",
    ]);
    expect(grouped[0]!.tools.map((tool) => tool.id)).toEqual(["a"]);
  });

  it("hides tools the principal lacks permission for, and drops a group that empties", () => {
    const grouped = toolsByGroup(catalog, new Set<Permission>([businessLookup]));
    expect(grouped.map((entry) => entry.group)).toEqual(["business-entities"]);
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

describe("web-domains group and website context tag", () => {
  const whois = assertPermission("tools:whois");
  const safeBrowse = assertPermission("tools:safeBrowse");

  const webDomainsCatalog: ToolManifest[] = [
    makeTool({
      id: "whois-lookup",
      permission: whois,
      subjectGroup: "web-domains",
      contextTags: ["website"],
    }),
    makeTool({
      id: "safe-website-viewer",
      permission: safeBrowse,
      subjectGroup: "web-domains",
      contextTags: ["website"],
    }),
  ];

  const webPermissions = new Set<Permission>([whois, safeBrowse]);

  it("web-domains group surfaces both website tools in order", () => {
    const groups = toolsByGroup(webDomainsCatalog, webPermissions);
    const webDomains = groups.find((g) => g.group === "web-domains");
    expect(webDomains?.tools.map((t) => t.id)).toEqual(["whois-lookup", "safe-website-viewer"]);
  });

  it("toolsFor('website') returns both website tools", () => {
    const ids = toolsFor(webDomainsCatalog, "website", webPermissions).map((t) => t.id);
    expect(ids).toEqual(["whois-lookup", "safe-website-viewer"]);
  });
});
