/*
 * Selecting files on the workbench. Bulk conversion is why the selection exists, so the gestures
 * that build one — click, shift-range, ctrl-toggle — and the reconciliation that keeps it honest
 * when files come and go are worth pinning off the DOM.
 */
import { describe, expect, it } from "vitest";
import {
  applySelection,
  EMPTY_SELECTION,
  reconcile,
  selectAll,
  type SelectionState,
} from "../src/lib/tools/file-workbench/selection.ts";

const ORDER = ["a", "b", "c", "d", "e"];
const click = (state: SelectionState, id: string) =>
  applySelection(state, { id, range: false, toggle: false }, ORDER);
const shiftClick = (state: SelectionState, id: string) =>
  applySelection(state, { id, range: true, toggle: false }, ORDER);
const toggleClick = (state: SelectionState, id: string) =>
  applySelection(state, { id, range: false, toggle: true }, ORDER);

const ids = (state: SelectionState) => [...state.selected].sort();

describe("selecting one file", () => {
  it("replaces the selection and takes focus", () => {
    const state = click(click(EMPTY_SELECTION, "d"), "b");
    expect(ids(state)).toEqual(["b"]);
    expect(state.activeId).toBe("b");
  });
});

describe("extending a range", () => {
  it("covers everything between the anchor and here, in either direction", () => {
    expect(ids(shiftClick(click(EMPTY_SELECTION, "b"), "d"))).toEqual(["b", "c", "d"]);
    expect(ids(shiftClick(click(EMPTY_SELECTION, "d"), "b"))).toEqual(["b", "c", "d"]);
  });

  it("keeps the anchor put, so dragging the far end back and forth still extends from it", () => {
    const anchored = click(EMPTY_SELECTION, "b");
    const wide = shiftClick(anchored, "e");
    const narrowed = shiftClick(wide, "c");
    expect(ids(narrowed)).toEqual(["b", "c"]);
    expect(narrowed.anchorId).toBe("b");
  });

  it("selects just the one when there is no anchor to extend from", () => {
    expect(ids(shiftClick(EMPTY_SELECTION, "c"))).toEqual(["c"]);
  });
});

describe("toggling one file without disturbing the rest", () => {
  it("adds and removes, leaving the others alone", () => {
    const two = toggleClick(click(EMPTY_SELECTION, "a"), "d");
    expect(ids(two)).toEqual(["a", "d"]);
    expect(ids(toggleClick(two, "a"))).toEqual(["d"]);
  });

  it("hands focus to another selected file when the focused one is deselected", () => {
    const two = toggleClick(click(EMPTY_SELECTION, "a"), "d");
    const dropped = toggleClick(two, "d");
    expect(dropped.activeId).toBe("a");
  });
});

describe("keeping the selection honest as files come and go", () => {
  it("drops ids that are no longer on the workbench", () => {
    const all = selectAll(ORDER);
    const remaining = reconcile(all, ["a", "c"]);
    expect(ids(remaining)).toEqual(["a", "c"]);
  });

  it("moves focus onto a surviving file when the focused one is discarded", () => {
    const state = reconcile(click(EMPTY_SELECTION, "e"), ["a", "b"]);
    expect(state.activeId).toBe("a");
    // The focused file is always part of the selection: a bulk action offered beside the panels
    // describing it must include it.
    expect(state.selected.has("a")).toBe(true);
  });

  it("empties out when the workbench does", () => {
    const state = reconcile(selectAll(ORDER), []);
    expect(ids(state)).toEqual([]);
    expect(state.activeId).toBeNull();
  });
});
