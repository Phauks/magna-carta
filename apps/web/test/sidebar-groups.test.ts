/*
 * The rail's render tree: which groups it draws, what the Tools group is made of, and the fold.
 *
 *   - Tools is the one group the destination registry does not hold the rows for. It is the tool
 *     catalog, projected (navigation/tool-sidebar.ts), so a tool added to the catalog reaches the
 *     rail with no edit to the registry — and cannot reach it twice.
 *   - Folding is a member preference over group ids, stored as DEPARTURES: every group is open
 *     until somebody folds it, so a group shipped later arrives open rather than inheriting a fold
 *     nobody asked for.
 *   - Customize mode leaves Tools out whole. What a member sees there is what they are permitted to
 *     run, and a star beside a tool would be a second, inert answer to that.
 */
import { afterEach, describe, expect, it } from "vitest";
import { DESTINATION_GROUPS } from "../src/lib/navigation/destinations.ts";
import { toolSidebarDestinations } from "../src/lib/navigation/tool-sidebar.ts";
import {
  isGroupCollapsed,
  setGroupCollapsed,
  sidebarEditingGroups,
  sidebarGroups,
  toggleGroupCollapsed,
} from "../src/lib/navigation/sidebar-preferences.svelte.ts";

afterEach(() => {
  for (const group of DESTINATION_GROUPS) setGroupCollapsed(group.id, false);
});

describe("the groups the rail draws", () => {
  it("heads the Tools group with the registry's index and follows it with the catalog", () => {
    const tools = sidebarGroups().find((group) => group.id === "tools");
    expect(tools, "the rail should carry a Tools group").toBeDefined();
    expect(tools?.label).toBe("Tools");
    expect(tools?.destinations[0]?.id).toBe("tools");
    expect(tools?.destinations.slice(1).map((row) => row.id)).toEqual(
      toolSidebarDestinations().map((row) => row.id),
    );
  });

  it("never lists a tool twice, in the Tools group or anywhere else in the rail", () => {
    const everyRow = sidebarGroups().flatMap((group) => group.destinations);
    expect(new Set(everyRow.map((row) => row.id)).size).toBe(everyRow.length);
    expect(new Set(everyRow.map((row) => row.href)).size).toBe(everyRow.length);
  });

  it("leaves the Tools group out of Customize mode entirely", () => {
    expect(sidebarEditingGroups().some((group) => group.id === "tools")).toBe(false);
    // The other groups are still arrangeable, so this is an exclusion and not a regression.
    expect(sidebarEditingGroups().some((group) => group.id === "top")).toBe(true);
  });
});

describe("folding a group", () => {
  it("starts open for every group the registry ships", () => {
    for (const group of DESTINATION_GROUPS) expect(isGroupCollapsed(group.id)).toBe(false);
  });

  it("folds and unfolds one group without touching the others", () => {
    setGroupCollapsed("money", true);
    expect(isGroupCollapsed("money")).toBe(true);
    expect(isGroupCollapsed("top")).toBe(false);
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
