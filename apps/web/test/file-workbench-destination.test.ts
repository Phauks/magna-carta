/*
 * The File Workbench is a sidebar destination in its own right, not a screen inside the Tools area.
 * Two registries have to agree about that, and they are in different packages: the destination
 * registry (navigation/destinations.ts) holds the sidebar row, and the tool catalog
 * (@magna-carta/tools) holds the manifest whose `route` keeps every link-builder off /tools/<id>.
 * Nothing in the type system ties the two, so this file does: if one moves, the other fails.
 */
import { describe, expect, it } from "vitest";
import { CATALOG, toolRoute } from "@magna-carta/tools/catalog";
import { grantedPermissions } from "../src/lib/tools/tool-permissions.ts";
import { toolSearchKeywords } from "../src/lib/tools/tool-presentation.ts";
import { CAPABILITIES } from "../src/lib/tools/file-workbench/capabilities.ts";
import {
  DESTINATIONS,
  destinationById,
  destinationStage,
  isCurrentDestination,
} from "../src/lib/navigation/destinations.ts";

const workbench = destinationById("file-workbench");
const manifest = CATALOG.find((tool) => tool.id === "file-workbench");

describe("the File Workbench destination", () => {
  it("is a shipped, default-starred row in the Firm group", () => {
    expect(workbench).not.toBeNull();
    expect(workbench?.group).toBe("firm");
    expect(workbench?.shipped).toBe(true);
    expect(workbench?.defaultStarred).toBe(true);
    expect(destinationStage(workbench!)).toBe("alpha");
  });

  it("keeps its catalog manifest, so the file context tag still has a tool to offer", () => {
    expect(manifest).toBeDefined();
    expect(manifest?.contextTags).toContain("file");
  });

  it("is addressed at the same place by both registries", () => {
    expect(workbench?.href).toBe("/file-workbench");
    expect(toolRoute(manifest!)).toBe(workbench?.href);
  });

  it("is addressed outside the Tools area, so Tools does not light up under it", () => {
    // Destination currency is a path-prefix match, so a workbench still living at
    // /tools/file-workbench would mark BOTH rows current on the same screen.
    const tools = destinationById("tools");
    expect(tools).not.toBeNull();
    expect(isCurrentDestination(tools!, workbench!.href)).toBe(false);
    expect(isCurrentDestination(workbench!, "/file-workbench")).toBe(true);
    // The recovery job's own screen sits under the workbench and keeps it current.
    expect(isCurrentDestination(workbench!, "/file-workbench/recovery/job-1")).toBe(true);
  });

  it("leads the Firm group, ahead of Tools", () => {
    const firm = DESTINATIONS.filter((destination) => destination.group === "firm");
    expect(firm.findIndex((destination) => destination.id === "file-workbench")).toBeLessThan(
      firm.findIndex((destination) => destination.id === "tools"),
    );
  });
});

describe("the retired file utilities", () => {
  // Ten catalog rows were retired into the workbench's capability tabs. Two things had to survive
  // that, and neither is enforced by a type: the permissions the rows carried (the capabilities are
  // gated on them, and they used to reach the member THROUGH the catalog), and the words the rows
  // answered to in search.
  const RETIRED_PERMISSIONS = [
    "tools:fileTypeVerifier",
    "tools:fileIntegrity",
    "tools:metadataScrubber",
    "tools:emailInspector",
    "tools:fileConverter",
    "tools:fileRepair",
    "tools:ocr",
    "tools:decryption",
    "tools:aiTextDetection",
    "firm:scanFile",
  ];

  it("still grants every permission its capability is gated on", () => {
    // Without this the tabs vanish silently: grantedPermissions() built the set from CATALOG, and
    // the retired manifests are what put these keys in it.
    const granted = grantedPermissions();
    for (const key of RETIRED_PERMISSIONS) {
      expect([...granted], key).toContain(key);
    }
  });

  it("keeps every capability's own permission granted", () => {
    const granted = grantedPermissions();
    for (const capability of CAPABILITIES) {
      expect([...granted], capability.id).toContain(capability.permission);
    }
  });

  it("keeps the words those rows answered to reaching the workbench", () => {
    // A member who searched "ocr" or "scrub metadata" reached a row of its own. The row is gone;
    // the vocabulary moved onto the workbench, and this is what says so.
    const net = toolSearchKeywords(manifest!).join(" ").toLowerCase();
    for (const word of [
      "convert",
      "metadata",
      "hash",
      "unlock",
      "password",
      "file type",
      "ai text",
      "repair",
      "ocr",
      "text recognition",
      "email inspector",
      "malware",
    ]) {
      expect(net, word).toContain(word);
    }
  });
});
