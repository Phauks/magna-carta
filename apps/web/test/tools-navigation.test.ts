/*
 * How a member reaches a tool, since the owner's direction of 2026-09-16: EVERY TOOL IS A TOP-LEVEL
 * ABILITY. Pinned here because the whole ruling is the shape:
 *
 *   - there is no Tools screen. No index, no sub-page, no /tools address at all — the two-sided
 *     screen cost every tool the width of a navigation column listing the tools it is not, and the
 *     index that replaced it was a stop on the way to work;
 *   - a tool is addressed at /<id> and opens onto the whole canvas;
 *   - every permitted tool is a row in the rail's Tools group, exactly once, folded into its
 *     subject CLUSTER — derived from the catalog, never hand-listed, so a tool added there appears
 *     in the rail with no edit to the destination registry;
 *   - a tool with a surface links to its own address; one without is an announced Soon row, never
 *     omitted and never a link to a page that is not there;
 *   - the File Workbench is one of them, in the Files cluster, and is no longer a hand-written
 *     destination of its own;
 *   - a cluster is a FOLD, not a screen: it has no address, and a cluster holding one row is seated
 *     as a plain row instead, because a chevron hiding one thing costs a press and saves nothing.
 */
import { describe, expect, it } from "vitest";
import { CATALOG, toolRoute } from "@magna-carta/tools/catalog";
import { SUBJECT_GROUP_ORDER } from "@magna-carta/tools/types";
import { hasSurface } from "@magna-carta/design-system/maturity";
import {
  DESTINATION_GROUPS,
  DESTINATIONS,
  isCurrentDestination,
  type Destination,
} from "../src/lib/navigation/destinations.ts";
import { NAVIGATION_CLUSTERS } from "../src/lib/navigation/clusters.ts";
import { toolSidebarDestinations } from "../src/lib/navigation/tool-sidebar.ts";
import { sidebarGroups } from "../src/lib/navigation/sidebar-preferences.svelte.ts";

const rows = toolSidebarDestinations();

describe("the tools in the rail", () => {
  it("is every permitted tool exactly once, clustered in the catalog's order", () => {
    expect(rows.length).toBe(CATALOG.length);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    // The clusters arrive in the catalog's declared subject order, each one contiguous.
    const clusterOrder = rows
      .map((row) => row.cluster)
      .filter((cluster, index, all) => cluster !== all[index - 1]);
    expect(clusterOrder).toEqual(
      SUBJECT_GROUP_ORDER.filter((group) => CATALOG.some((tool) => tool.subjectGroup === group)),
    );
  });

  it("addresses each tool at the top level, where the catalog says", () => {
    for (const tool of CATALOG) {
      const row = rows.find((candidate) => candidate.id === `tool-${tool.id}`);
      expect(row, `${tool.name} should have a rail row`).toBeDefined();
      expect(row?.href).toBe(toolRoute(tool));
      expect(row?.href.startsWith("/tools")).toBe(false);
    }
  });

  it("ships a tool with a surface and announces one without", () => {
    for (const row of rows) {
      expect(row.shipped).toBe(hasSurface(row.stage ?? "soon"));
      if (!row.shipped) expect(row.announced).toBe(true);
    }
  });

  it("carries the File Workbench as a tool in the Files cluster", () => {
    // It was a hand-written destination in the Firm group until the tools became top-level
    // abilities; being one of them is what put it back beside the file work it does.
    const workbench = rows.filter((row) => row.href === "/file-workbench");
    expect(workbench).toHaveLength(1);
    expect(workbench[0]?.label).toBe("File Workbench");
    expect(workbench[0]?.cluster).toBe("files");
    expect(DESTINATIONS.some((destination) => destination.id === "file-workbench")).toBe(false);
  });

  it("keeps no Tools index in the registry, because there is no index", () => {
    expect(DESTINATIONS.some((destination) => destination.href === "/tools")).toBe(false);
    expect(DESTINATION_GROUPS.some((group) => group.id === "tools")).toBe(true);
    for (const row of rows) expect(row.group).toBe("tools");
  });

  it("is governed by permissions rather than by the eye, so every row is pinned", () => {
    // Hiding a tool would be a second answer to a question access control has settled, and an inert
    // one — Customize mode leaves the group out for the same reason.
    for (const row of rows) expect(row.pinned).toBe(true);
  });
});

describe("the clusters the Tools group folds into", () => {
  const tools = sidebarGroups().find((group) => group.id === "tools");

  it("declares a cluster for every subject the catalog uses, in the Tools group", () => {
    for (const group of SUBJECT_GROUP_ORDER) {
      const cluster = NAVIGATION_CLUSTERS.find((candidate) => candidate.id === group);
      expect(cluster, `no cluster for ${group}`).toBeDefined();
      expect(cluster?.group).toBe("tools");
    }
  });

  it("folds a cluster of two or more and seats a cluster of one as a plain row", () => {
    expect(tools).toBeDefined();
    for (const node of tools?.nodes ?? []) {
      if (node.kind !== "cluster") continue;
      expect(node.rows.length).toBeGreaterThan(1);
    }
    // Files holds the workbench alone today, so it is a row rather than a chevron over one thing.
    const workbenchRow = (tools?.nodes ?? []).find(
      (node) => node.kind === "row" && node.destination.href === "/file-workbench",
    );
    expect(workbenchRow).toBeDefined();
  });

  it("keeps every row reachable whether it is folded or not", () => {
    // `destinations` is the flat truth the collapsed icon rail draws and the palette mirrors;
    // `nodes` is only how the expanded rail arranges it. A row in one and not the other is a row
    // that disappears at one width.
    const flat = (tools?.destinations ?? []).map((row) => row.id).toSorted();
    const nested = (tools?.nodes ?? [])
      .flatMap((node) =>
        node.kind === "cluster" ? node.rows.map((row) => row.id) : [node.destination.id],
      )
      .toSorted();
    expect(nested).toEqual(flat);
  });
});

describe("which row lights", () => {
  const whoisRow = rows.find((row) => row.href === "/whois-lookup") as Destination;

  it("is the tool's own row while its address is open", () => {
    expect(isCurrentDestination(whoisRow, "/whois-lookup")).toBe(true);
    expect(isCurrentDestination(whoisRow, "/safe-website-viewer")).toBe(false);
  });

  it("keeps a screen beneath a tool on that tool's row", () => {
    // The workbench's password-recovery job is the one screen under a tool today.
    const workbench = rows.find((row) => row.href === "/file-workbench") as Destination;
    expect(isCurrentDestination(workbench, "/file-workbench/recovery/job-1")).toBe(true);
  });
});
