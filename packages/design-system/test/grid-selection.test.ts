import { describe, expect, it } from "vitest";
import {
  emptyGridSelection,
  gridSelectionAfterArrow,
  gridSelectionAfterRowClick,
  gridSelectionOfAll,
  gridSelectionRetained,
  type GridSelection,
} from "../src/lib/components/data-table/grid-selection.ts";

/*
 * The grid's selection model — the Docket's, shared exactly: click selects one (again lets go),
 * Ctrl toggles, Shift ranges from the anchor, Ctrl+A takes the view, arrows move and Shift+arrows
 * extend. The double-click guard is the settled defect fix: the second click of a double-click
 * must never let the sole selection go, or activation churns select → deselect → select.
 */
const ORDER = ["a", "b", "c", "d", "e"];

const selected = (keys: string[], anchor: string | null = null): GridSelection => ({
  keys,
  anchor: anchor ?? keys.at(-1) ?? null,
  focus: keys.at(-1) ?? null,
});

describe("row clicks", () => {
  it("a plain click selects the row solely", () => {
    const next = gridSelectionAfterRowClick(ORDER, emptyGridSelection(), "b");
    expect(next.keys).toEqual(["b"]);
    expect(next.anchor).toBe("b");
  });

  it("a plain click on the sole selection lets it go", () => {
    const next = gridSelectionAfterRowClick(ORDER, selected(["b"]), "b");
    expect(next.keys).toEqual([]);
    expect(next.anchor).toBeNull();
  });

  it("the second click of a double-click never lets the sole selection go (no dblclick churn)", () => {
    const next = gridSelectionAfterRowClick(ORDER, selected(["b"]), "b", { repeated: true });
    expect(next.keys).toEqual(["b"]);
  });

  it("a plain click collapses a multi-selection to the clicked row", () => {
    const next = gridSelectionAfterRowClick(ORDER, selected(["a", "b", "c"]), "b");
    expect(next.keys).toEqual(["b"]);
  });

  it("Ctrl+click toggles membership and moves the anchor", () => {
    const one = gridSelectionAfterRowClick(ORDER, selected(["a"], "a"), "c", { toggle: true });
    expect(one.keys).toEqual(["a", "c"]);
    expect(one.anchor).toBe("c");
    const two = gridSelectionAfterRowClick(ORDER, one, "a", { toggle: true });
    expect(two.keys).toEqual(["c"]);
  });

  it("Shift+click extends a range from the anchor, in either direction", () => {
    const down = gridSelectionAfterRowClick(ORDER, selected(["b"], "b"), "d", { shift: true });
    expect(down.keys).toEqual(["b", "c", "d"]);
    expect(down.anchor).toBe("b");
    const up = gridSelectionAfterRowClick(ORDER, selected(["d"], "d"), "b", { shift: true });
    expect(up.keys).toEqual(["b", "c", "d"]);
  });

  it("Ctrl+Shift+click unions the range into the existing selection", () => {
    const start: GridSelection = { keys: ["a"], anchor: "c", focus: "c" };
    const next = gridSelectionAfterRowClick(ORDER, start, "e", { shift: true, toggle: true });
    expect([...next.keys].toSorted()).toEqual(["a", "c", "d", "e"]);
  });

  it("a Shift+click with no anchor falls back to a sole selection", () => {
    const next = gridSelectionAfterRowClick(ORDER, emptyGridSelection(), "c", { shift: true });
    expect(next.keys).toEqual(["c"]);
  });
});

describe("keyboard", () => {
  it("an arrow moves the sole selection", () => {
    const next = gridSelectionAfterArrow(ORDER, selected(["b"]), 1, false);
    expect(next.keys).toEqual(["c"]);
    expect(next.focus).toBe("c");
  });

  it("arrows never walk off either end", () => {
    expect(gridSelectionAfterArrow(ORDER, selected(["a"]), -1, false).keys).toEqual(["a"]);
    expect(gridSelectionAfterArrow(ORDER, selected(["e"]), 1, false).keys).toEqual(["e"]);
  });

  it("an arrow with nothing selected starts at the first row", () => {
    expect(gridSelectionAfterArrow(ORDER, emptyGridSelection(), 1, false).keys).toEqual(["a"]);
  });

  it("Shift+arrow extends the range from the anchor", () => {
    const one = gridSelectionAfterArrow(ORDER, selected(["b"], "b"), 1, true);
    expect(one.keys).toEqual(["b", "c"]);
    const two = gridSelectionAfterArrow(ORDER, one, 1, true);
    expect(two.keys).toEqual(["b", "c", "d"]);
    expect(two.anchor).toBe("b");
  });

  it("Shift+arrow back through the anchor shrinks the range", () => {
    const wide: GridSelection = { keys: ["b", "c", "d"], anchor: "b", focus: "d" };
    const next = gridSelectionAfterArrow(ORDER, wide, -1, true);
    expect(next.keys).toEqual(["b", "c"]);
  });

  it("select-all takes every row in view", () => {
    const next = gridSelectionOfAll(ORDER);
    expect(next.keys).toEqual(ORDER);
    expect(next.anchor).toBe("a");
  });

  it("an empty view selects nothing", () => {
    expect(gridSelectionOfAll([]).keys).toEqual([]);
  });
});

describe("retention", () => {
  it("keys that left the view are dropped; a surviving selection is untouched", () => {
    const wide: GridSelection = { keys: ["a", "c", "e"], anchor: "c", focus: "e" };
    const next = gridSelectionRetained(wide, new Set(["a", "e"]));
    expect(next.keys).toEqual(["a", "e"]);
    expect(next.anchor).toBeNull();
    expect(gridSelectionRetained(next, new Set(["a", "e"]))).toBe(next);
  });
});
