import { isPermission } from "@magna-carta/access-control/registry";
import { describe, expect, it } from "vitest";
import { CATALOG, toolRoute } from "../src/catalog.ts";
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

  it("includes the tools that exist today, grouped by the cluster they fold into", () => {
    expect(CATALOG.map((tool) => tool.id)).toEqual([
      "attorney-license-lookup",
      "business-entity-lookup",
      "county-property-records",
      "legal-citations",
      "property-listing-links",
      "network-speed-test",
      "safe-website-viewer",
      "whois-lookup",
      "shipping",
      "file-workbench",
    ]);
  });

  it("addresses every tool at the top level, at its own id", () => {
    // Owner's direction, 2026-09-16: a tool is a top-level ability, not a screen inside an area.
    // There is no /tools to be under, so a manifest cannot be addressed as though there were.
    for (const tool of CATALOG) {
      expect(toolRoute(tool), tool.id).toBe(`/${tool.id}`);
    }
  });

  it("holds no firm-usage row: reading the firm's own records is not running a tool", () => {
    // It is a destination in the Firm group now (apps/web/src/lib/navigation/destinations.ts),
    // beside Reports, which is what it has in common with anything.
    expect(CATALOG.some((tool) => tool.id === "firm-usage")).toBe(false);
  });

  it("registers the workbench as a matter-free, library-backed file tool", () => {
    const tool = CATALOG.find((entry) => entry.id === "file-workbench");
    expect(tool).toBeDefined();
    expect(tool?.subjectGroup).toBe("files");
    expect(tool?.backing).toEqual({ kind: "library" });
    expect(tool?.matterContext).toBe("none");
    // It acts on a file, so it must be reachable from a file context (toolsFor("file")); it also
    // stands alone in the general listing.
    expect(tool?.contextTags).toEqual(["file", "none"]);
  });

  it("keeps the files group to the workbench alone", () => {
    // Ten sibling manifests used to sit beside it — convert, scrub metadata, hash, unlock, verify a
    // type, detect AI text, repair, recognize text, read an email, scan for malware — and every one
    // was a File Workbench capability tab under another name, so the catalog listed eleven doors
    // into one room. They were retired into the tabs they always were. A new row here means
    // somebody is re-opening a door the workbench already has.
    expect(CATALOG.filter((tool) => tool.subjectGroup === "files").map((tool) => tool.id)).toEqual([
      "file-workbench",
    ]);
  });

  it("tags every file-accepting tool in the files group as accepting a file", () => {
    // Every tool in the `files` group acts on file bytes, so each must carry the "file" context tag
    // or it silently vanishes from any surface filtering by file context (toolsFor("file")) —
    // exactly the defect a file workbench would hit.
    const fileTools = CATALOG.filter((tool) => tool.subjectGroup === "files");
    expect(fileTools.length).toBeGreaterThan(0);
    for (const tool of fileTools) {
      expect(tool.contextTags, tool.id).toContain("file");
    }
  });

  it("has no manifest left declaring a retired file utility", () => {
    const retired = [
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
    ];
    for (const id of retired) {
      expect(
        CATALOG.some((tool) => tool.id === id),
        `${id} is a File Workbench capability tab, not a tool beside it`,
      ).toBe(false);
    }
  });
});
