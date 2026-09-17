/*
 * The File Workbench is a TOOL, and is reached as one. Three registries have to agree about that
 * and they live in three places: the catalog holds the manifest (@magna-carta/tools), the rail
 * projects its row from there (navigation/tool-sidebar.ts), and the back-link vocabulary spells the
 * workbench out for the one screen that sits beneath it (screen/screen-header.ts). Nothing in the
 * type system ties the three, so this file does: if one moves, the others fail.
 *
 * It spent a fortnight as a hand-written destination in the Firm group, because a `/tools` area
 * charged a navigation to reach it and its ten capability tabs read as ten tools. Both reasons are
 * gone: every tool is a top-level ability now, so the workbench is addressed exactly as it was and
 * is one row in the Tools group's Files cluster rather than an exception to it.
 */
import { describe, expect, it } from "vitest";
import { CATALOG, toolRoute } from "@magna-carta/tools/catalog";
import { grantedPermissions } from "../src/lib/tools/tool-permissions.ts";
import { toolSearchKeywords } from "../src/lib/tools/tool-presentation.ts";
import { CAPABILITIES } from "../src/lib/tools/file-workbench/capabilities.ts";
import { DESTINATIONS, isCurrentDestination } from "../src/lib/navigation/destinations.ts";
import { toolSidebarDestinations } from "../src/lib/navigation/tool-sidebar.ts";
import { FILE_WORKBENCH_BACK } from "../src/lib/screen/screen-header.ts";

const manifest = CATALOG.find((tool) => tool.id === "file-workbench");
const row = toolSidebarDestinations().find((candidate) => candidate.id === "tool-file-workbench");

describe("the File Workbench as a tool", () => {
  it("is a catalog manifest, so the file context tag still has a tool to offer", () => {
    expect(manifest).toBeDefined();
    expect(manifest?.contextTags).toContain("file");
    expect(manifest?.subjectGroup).toBe("files");
  });

  it("is a shipped row in the Tools group's Files cluster, and nothing in the registry", () => {
    expect(row).toBeDefined();
    expect(row?.group).toBe("tools");
    expect(row?.cluster).toBe("files");
    expect(row?.shipped).toBe(true);
    expect(row?.stage).toBe("alpha");
    // No hand-written destination: a second row for the same screen is two rows a reader has to
    // tell apart, and the registry is not where a tool is declared.
    expect(DESTINATIONS.some((destination) => destination.href === "/file-workbench")).toBe(false);
  });

  it("is addressed at the same place by the catalog, the rail and the way back", () => {
    expect(toolRoute(manifest!)).toBe("/file-workbench");
    expect(row?.href).toBe("/file-workbench");
    expect(FILE_WORKBENCH_BACK.href).toBe("/file-workbench");
    expect(FILE_WORKBENCH_BACK.label).toBe(manifest?.name);
  });

  it("keeps the recovery job beneath it current on its own row", () => {
    expect(isCurrentDestination(row!, "/file-workbench")).toBe(true);
    expect(isCurrentDestination(row!, "/file-workbench/recovery/job-1")).toBe(true);
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
