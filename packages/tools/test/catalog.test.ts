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
      "file-workbench",
      "file-converter",
      "metadata-scrubber",
      "file-hash-integrity",
      "file-decryption",
      "file-type-verifier",
      "ai-text-detection",
      "file-repair",
      "ocr",
      "email-inspector",
      "malware-scan",
    ]);
  });

  it("registers a matter-free, library-backed file converter", () => {
    const tool = CATALOG.find((entry) => entry.id === "file-converter");
    expect(tool).toBeDefined();
    expect(tool?.subjectGroup).toBe("files");
    expect(tool?.backing).toEqual({ kind: "library" });
    expect(tool?.matterContext).toBe("none");
    // A file converter acts on a file, so it must be reachable from a file context (toolsFor("file"));
    // it also stands alone in the general listing.
    expect(tool?.contextTags).toEqual(["file", "none"]);
  });

  it("tags every file-accepting tool in the files group as accepting a file", () => {
    // The `files` subject group holds the file utilities. Every one that acts on file bytes must carry
    // the "file" context tag, or it silently vanishes from any surface filtering by file context
    // (toolsFor("file")) — exactly the defect a file workbench would hit.
    //
    // The one exception is AI-Text Detection: its worker route (/api/v1/ai-detection/detect) accepts a
    // pasted `text` field, not a file, so it is correctly general-only ("none"). If it ever gains a
    // file-upload path, add "file" here and drop it from this exclusion.
    const textOnly = new Set(["ai-text-detection"]);
    const fileTools = CATALOG.filter(
      (tool) => tool.subjectGroup === "files" && !textOnly.has(tool.id),
    );
    expect(fileTools.length).toBeGreaterThan(0);
    for (const tool of fileTools) {
      expect(tool.contextTags, tool.id).toContain("file");
    }
  });

  it("includes the AI-text detection tool backed by the ai-detection integration", () => {
    const tool = CATALOG.find((entry) => entry.id === "ai-text-detection");
    expect(tool).toBeDefined();
    expect(tool?.subjectGroup).toBe("files");
    expect(tool?.backing).toEqual({ kind: "integration", category: "ai-detection" });
    expect(tool?.matterContext).toBe("optional");
  });
});
