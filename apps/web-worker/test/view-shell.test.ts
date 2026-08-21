/*
 * Behavioural tests for the multi-view shell controller. The shell's `.svelte` components carry no
 * behaviour to test, but the controller (createViewShell) holds the parts that can silently go
 * wrong: selection reconciled against the current items, region visibility with and without a
 * persisted home, and the active-view fallback. The controller uses only SvelteSet/SvelteMap and
 * plain getters — no runes — so it exercises synchronously here without a component context.
 */
import { describe, expect, it } from "vitest";
import type { Component } from "svelte";
import type { PersistedPreference } from "../src/lib/preferences/persisted-preference.svelte.ts";
import { createViewShell } from "../src/lib/view-shell/view-shell.svelte.ts";
import type { RegionVisibility, ViewDefinition } from "../src/lib/view-shell/view-shell-types.ts";

interface Row {
  id: string;
}

// The controller stores view/icon components but never renders them here, so a stub stands in.
const stubComponent = (() => undefined) as unknown as Component;

function view<ViewId extends string>(id: ViewId, label: string): ViewDefinition<Row, ViewId> {
  return { id, label, icon: stubComponent, view: stubComponent as ViewDefinition<Row>["view"] };
}

/** A preference standing in for the persisted store — an in-memory current + set, no storage. */
function fakePreference<Value>(initial: Value): PersistedPreference<Value> {
  let value = initial;
  return {
    get current(): Value {
      return value;
    },
    set(next: Value): void {
      value = next;
    },
    followAcrossTabs(): () => void {
      return () => {};
    },
  };
}

describe("view shell — selection reconciled against current items", () => {
  it("count and selectedItems never disagree when an item leaves the list", () => {
    let items: Row[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const shell = createViewShell<Row, "list">({
      views: [view("list", "List")],
      activeViewPreference: fakePreference<"list">("list"),
      items: () => items,
      itemKey: (row) => row.id,
    });
    const { selection } = shell;

    selection.toggle(items[0]!);
    selection.toggle(items[1]!);
    selection.toggle(items[2]!);
    expect(selection.count).toBe(3);
    expect(selection.selectedItems.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(selection.selectedKeys.size).toBe(3);

    // Drop a selected item from the list (a deletion, a folder change, a filter).
    items = items.filter((row) => row.id !== "b");
    // count, selectedItems, and selectedKeys all reconcile — no phantom "b".
    expect(selection.count).toBe(2);
    expect(selection.selectedItems.map((row) => row.id)).toEqual(["a", "c"]);
    expect(selection.selectedKeys.has("b")).toBe(false);
    expect(selection.isEmpty).toBe(false);
  });

  it("a filtered-out item that returns is still selected (reconcile, not prune)", () => {
    const all: Row[] = [{ id: "a" }, { id: "b" }];
    let items: Row[] = all;
    const shell = createViewShell<Row, "list">({
      views: [view("list", "List")],
      activeViewPreference: fakePreference<"list">("list"),
      items: () => items,
      itemKey: (row) => row.id,
    });
    shell.selection.toggle(all[1]!);
    items = all.filter((row) => row.id !== "b");
    expect(shell.selection.count).toBe(0); // "b" not present -> does not count
    items = all; // the filter clears; "b" is back
    expect(shell.selection.count).toBe(1);
    expect(shell.selection.selectedItems.map((row) => row.id)).toEqual(["b"]);
  });

  it("select replaces the whole selection; clear empties it", () => {
    const items: Row[] = [{ id: "a" }, { id: "b" }];
    const shell = createViewShell<Row, "list">({
      views: [view("list", "List")],
      activeViewPreference: fakePreference<"list">("list"),
      items: () => items,
      itemKey: (row) => row.id,
    });
    shell.selection.toggle(items[0]!);
    shell.selection.select(items[1]!);
    expect(shell.selection.selectedItems.map((row) => row.id)).toEqual(["b"]);
    shell.selection.clear();
    expect(shell.selection.isEmpty).toBe(true);
  });
});

describe("view shell — regions", () => {
  const regions = [{ id: "tree", label: "Folders", icon: stubComponent, defaultShown: true }];

  it("toggles in-session even with no persisted preference", () => {
    const shell = createViewShell<Row, "list">({
      views: [view("list", "List")],
      activeViewPreference: fakePreference<"list">("list"),
      regions,
    });
    expect(shell.isRegionShown("tree")).toBe(true); // default
    shell.toggleRegion("tree");
    expect(shell.isRegionShown("tree")).toBe(false); // session override, no preference needed
    shell.setRegionShown("tree", true);
    expect(shell.isRegionShown("tree")).toBe(true);
  });

  it("persists through the preference when one is injected", () => {
    const regionsPreference = fakePreference<RegionVisibility>({});
    const shell = createViewShell<Row, "list">({
      views: [view("list", "List")],
      activeViewPreference: fakePreference<"list">("list"),
      regions,
      regionsPreference,
    });
    shell.setRegionShown("tree", false);
    expect(regionsPreference.current.tree).toBe(false); // written to the durable home
    expect(shell.isRegionShown("tree")).toBe(false);
  });

  it("ignores an unknown region id", () => {
    const shell = createViewShell<Row, "list">({
      views: [view("list", "List")],
      activeViewPreference: fakePreference<"list">("list"),
      regions,
    });
    expect(shell.isRegionShown("nope")).toBe(false);
    shell.setRegionShown("nope", true); // no throw, no effect
    expect(shell.isRegionShown("nope")).toBe(false);
  });
});

describe("view shell — active view", () => {
  it("falls back to the first view when the stored id is not registered", () => {
    const shell = createViewShell<Row, "tiles" | "list">({
      // Preference holds a retired/hand-edited id.
      views: [view("tiles", "Tiles"), view("list", "List")],
      activeViewPreference: fakePreference<"tiles" | "list">("gallery" as "tiles"),
    });
    expect(shell.activeViewId).toBe("tiles"); // first registered, not the stale "gallery"
    shell.setActiveView("list");
    expect(shell.activeViewId).toBe("list");
  });

  it("throws when no view is registered", () => {
    expect(() =>
      createViewShell<Row, "list">({
        views: [],
        activeViewPreference: fakePreference<"list">("list"),
      }),
    ).toThrow(/at least one/);
  });
});
