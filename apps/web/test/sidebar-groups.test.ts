/*
 * The rail's render tree: which groups it draws, what each holds, how a fold works at both levels,
 * and where rows come from that the destination registry does not declare.
 *
 *   - FIVE GROUPS, each answering one question (owner's direction, 2026-09-16): Favorites (the
 *     member's own shortcuts), My Desk (what is on MY plate), Workspace (the firm's work), Money,
 *     Firm, Tools. Home and Notifications used to sit in a fourteen-row Workspace group, which put
 *     "your morning" in the same list as "the firm's evidence".
 *   - Tools is the one group the registry does not hold the rows for: it is the tool catalog,
 *     projected (navigation/tool-sidebar.ts), so a tool added to the catalog reaches the rail with
 *     no edit to the registry — and cannot reach it twice. Favorites is the member's own.
 *   - Folding is a member preference over group ids AND cluster ids, stored as DEPARTURES: every
 *     fold is open until somebody closes it, so a group or cluster shipped later arrives open
 *     rather than inheriting a fold nobody asked for.
 *   - Customize mode leaves Tools out whole. What a member sees there is what they are permitted to
 *     run, and an eye beside a tool would be a second, inert answer to that.
 */
import { afterEach, describe, expect, it } from "vitest";
import { DESTINATION_GROUPS, DESTINATIONS } from "../src/lib/navigation/destinations.ts";
import { toolSidebarDestinations } from "../src/lib/navigation/tool-sidebar.ts";
import {
  isClusterCollapsed,
  isGroupCollapsed,
  setClusterCollapsed,
  setGroupCollapsed,
  sidebarEditingGroups,
  sidebarGroups,
  toggleClusterCollapsed,
  toggleGroupCollapsed,
} from "../src/lib/navigation/sidebar-preferences.svelte.ts";

afterEach(() => {
  for (const group of DESTINATION_GROUPS) setGroupCollapsed(group.id, false);
  setClusterCollapsed("records", false);
});

describe("the groups the rail draws", () => {
  it("declares the five platform groups in their canonical order, favorites first", () => {
    expect(DESTINATION_GROUPS.map((group) => group.id)).toEqual([
      "favorites",
      "desk",
      "work",
      "money",
      "firm",
      "tools",
    ]);
  });

  it("puts the member's own surfaces on the desk and the firm's work in the workspace", () => {
    const groupOf = (id: string) =>
      DESTINATIONS.find((destination) => destination.id === id)?.group;
    for (const id of ["home", "notifications", "tasks", "calendar", "magnus"]) {
      expect(groupOf(id), id).toBe("desk");
    }
    for (const id of ["matters", "intake", "directory", "discovery", "custodian"]) {
      expect(groupOf(id), id).toBe("work");
    }
  });

  it("puts Firm Usage in the Firm group, where a firm reads its own records", () => {
    // It was filed as a tool, behind a heading nobody with a billing question would open. It runs
    // nothing — it reads the firm's own records, which is what Reports beside it does.
    const usage = DESTINATIONS.find((destination) => destination.id === "firm-usage");
    expect(usage?.group).toBe("firm");
    expect(usage?.href).toBe("/firm-usage");
    // The gate travelled with the row: a destination may carry the permission that gates it.
    expect(usage?.permission).toBe("tools:firmUsage");
    expect(toolSidebarDestinations().some((row) => row.href === "/firm-usage")).toBe(false);
  });

  it("fills the Tools group from the catalog alone", () => {
    const tools = sidebarGroups().find((group) => group.id === "tools");
    expect(tools, "the rail should carry a Tools group").toBeDefined();
    expect(tools?.label).toBe("Tools");
    expect(tools?.destinations.map((row) => row.id)).toEqual(
      toolSidebarDestinations().map((row) => row.id),
    );
  });

  it("never lists a destination twice, in the Tools group or anywhere else in the rail", () => {
    const everyRow = sidebarGroups().flatMap((group) => group.destinations);
    expect(new Set(everyRow.map((row) => row.id)).size).toBe(everyRow.length);
    expect(new Set(everyRow.map((row) => row.href)).size).toBe(everyRow.length);
  });

  it("leaves the Tools group out of Customize mode entirely", () => {
    expect(sidebarEditingGroups().some((group) => group.id === "tools")).toBe(false);
    // The other groups are still arrangeable, so this is an exclusion and not a regression.
    expect(sidebarEditingGroups().some((group) => group.id === "desk")).toBe(true);
  });

  it("omits a group with nothing in it — Favorites until a member makes one", () => {
    expect(sidebarGroups().some((group) => group.id === "favorites")).toBe(false);
  });
});

describe("folding a group", () => {
  it("starts open for every group the registry ships", () => {
    for (const group of DESTINATION_GROUPS) expect(isGroupCollapsed(group.id)).toBe(false);
  });

  it("folds and unfolds one group without touching the others", () => {
    setGroupCollapsed("money", true);
    expect(isGroupCollapsed("money")).toBe(true);
    expect(isGroupCollapsed("desk")).toBe(false);
    expect(isGroupCollapsed("firm")).toBe(false);
    setGroupCollapsed("money", false);
    expect(isGroupCollapsed("money")).toBe(false);
  });

  it("never records the same fold twice", () => {
    setGroupCollapsed("firm", true);
    setGroupCollapsed("firm", true);
    toggleGroupCollapsed("firm");
    expect(isGroupCollapsed("firm")).toBe(false);
  });

  it("leaves the group's rows in the tree — the shell draws the fold, not this", () => {
    // Folding hides rows in the RAIL. It must never reach the command palette, which renders the
    // registry directly: hiding must not remove capability.
    const before = sidebarGroups().find((group) => group.id === "firm")?.destinations.length;
    setGroupCollapsed("firm", true);
    expect(sidebarGroups().find((group) => group.id === "firm")?.destinations.length).toBe(before);
  });
});

describe("folding a cluster", () => {
  it("starts open, folds, and unfolds independently of its group", () => {
    expect(isClusterCollapsed("records")).toBe(false);
    setClusterCollapsed("records", true);
    expect(isClusterCollapsed("records")).toBe(true);
    expect(isClusterCollapsed("internet")).toBe(false);
    expect(isGroupCollapsed("tools")).toBe(false);
    toggleClusterCollapsed("records");
    expect(isClusterCollapsed("records")).toBe(false);
  });

  it("leaves the cluster's rows in the tree, the same invariant a group's fold keeps", () => {
    const rowsIn = () => sidebarGroups().find((group) => group.id === "tools")?.destinations.length;
    const before = rowsIn();
    setClusterCollapsed("records", true);
    expect(rowsIn()).toBe(before);
  });
});
