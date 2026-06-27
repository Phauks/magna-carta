import { isPermission } from "@magna-carta/access-control/registry";
import { describe, expect, it } from "vitest";
import { CATALOG } from "../src/catalog.ts";
import { SUBJECT_GROUP_ORDER } from "../src/types.ts";

describe("tool catalog", () => {
  it("has unique ids", () => {
    const ids = CATALOG.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every manifest is well-formed: name, known group, registered permission, >=1 context tag", () => {
    for (const tool of CATALOG) {
      expect(tool.name.length, tool.id).toBeGreaterThan(0);
      expect(SUBJECT_GROUP_ORDER, tool.id).toContain(tool.subjectGroup);
      expect(isPermission(tool.permission), tool.id).toBe(true);
      expect(tool.contextTags.length, tool.id).toBeGreaterThan(0);
    }
  });

  it("every integration-backed tool names a non-empty category", () => {
    for (const tool of CATALOG) {
      if (tool.backing.kind === "integration") {
        expect(tool.backing.category.length, tool.id).toBeGreaterThan(0);
      }
    }
  });

  it("includes the tools that exist today", () => {
    expect(CATALOG.map((tool) => tool.id)).toEqual([
      "property-listing-links",
      "county-property-records",
      "business-entity-lookup",
      "attorney-license-lookup",
      "shipping",
      "network-speed-test",
      "firm-usage",
      "whois-lookup",
      "safe-website-viewer",
      "file-converter",
      "metadata-scrubber",
      "file-hash-integrity",
    ]);
  });

  it("registers a matter-free, library-backed file converter", () => {
    const tool = CATALOG.find((entry) => entry.id === "file-converter");
    expect(tool).toBeDefined();
    expect(tool?.subjectGroup).toBe("documents");
    expect(tool?.backing).toEqual({ kind: "library" });
    expect(tool?.matterContext).toBe("none");
    expect(tool?.contextTags).toEqual(["none"]);
  });
});
