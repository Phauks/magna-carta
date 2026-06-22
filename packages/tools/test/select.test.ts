import { assertPermission, type Permission } from "@magna-carta/access-control/registry";
import { describe, expect, it } from "vitest";
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
