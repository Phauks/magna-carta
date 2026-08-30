/*
 * Row groups and row marks — the settled shape of what a list says about a row before it says
 * anything about the row's data. Each case pins one ruled property: pinned items sit above
 * EVERYTHING (not above their own kind), their order is the member's arrangement rather than the
 * table's sort, and a mark renders as an attribute the recipe can dress.
 */
import { describe, expect, it } from "vitest";
import {
  gridRowMarkAttributes,
  groupedGridRows,
} from "../src/lib/components/data-table/grid-rows.ts";

type Row = { id: string; kind: "folder" | "file" };
const rowKey = (row: Row): string => row.id;

const ROWS: Row[] = [
  { id: "folder-a", kind: "folder" },
  { id: "folder-b", kind: "folder" },
  { id: "file-a", kind: "file" },
  { id: "file-b", kind: "file" },
  { id: "file-c", kind: "file" },
];

describe("groupedGridRows", () => {
  it("leaves the order alone and draws no rule when nothing is pinned", () => {
    const grouping = groupedGridRows(ROWS, [], rowKey);
    expect(grouping.rows).toBe(ROWS);
    expect(grouping.pinnedCount).toBe(0);
  });

  it("puts pinned items above EVERYTHING, not above their own kind", () => {
    // A pinned FILE leads a list whose folders would otherwise sort ahead of it.
    const grouping = groupedGridRows(ROWS, ["file-b"], rowKey);
    expect(grouping.rows.map(rowKey)).toEqual([
      "file-b",
      "folder-a",
      "folder-b",
      "file-a",
      "file-c",
    ]);
    expect(grouping.pinnedCount).toBe(1);
  });

  it("keeps the pinned block in the member's arranged order, never the table's", () => {
    const grouping = groupedGridRows(ROWS, ["file-c", "folder-b", "file-a"], rowKey);
    expect(grouping.rows.slice(0, 3).map(rowKey)).toEqual(["file-c", "folder-b", "file-a"]);
    expect(grouping.pinnedCount).toBe(3);
    expect(grouping.rows.slice(3).map(rowKey)).toEqual(["folder-a", "file-b"]);
  });

  it("drops a pinned key whose row is not in view, so the counts stay honest", () => {
    // A filter is the reader's own ask: a pinned row it excluded must not slip back in.
    const inView = ROWS.filter((row) => row.kind === "folder");
    const grouping = groupedGridRows(inView, ["file-b", "folder-b"], rowKey);
    expect(grouping.rows.map(rowKey)).toEqual(["folder-b", "folder-a"]);
    expect(grouping.pinnedCount).toBe(1);
  });

  it("draws no rule when every pinned key is out of view", () => {
    const inView = ROWS.filter((row) => row.kind === "folder");
    const grouping = groupedGridRows(inView, ["file-b"], rowKey);
    expect(grouping.rows).toBe(inView);
    expect(grouping.pinnedCount).toBe(0);
  });

  it("never duplicates a row that is both pinned and in the list", () => {
    const grouping = groupedGridRows(ROWS, ["file-a", "file-b"], rowKey);
    expect(grouping.rows).toHaveLength(ROWS.length);
    expect(new Set(grouping.rows.map(rowKey)).size).toBe(ROWS.length);
  });
});

describe("gridRowMarkAttributes", () => {
  it("renders nothing for an unmarked row", () => {
    expect(gridRowMarkAttributes(undefined)).toEqual({});
    expect(gridRowMarkAttributes({})).toEqual({});
  });

  it("renders only the marks a row actually carries", () => {
    expect(gridRowMarkAttributes({ pinned: true })).toEqual({ "data-row-pinned": "true" });
    expect(gridRowMarkAttributes({ clipboard: "cut" })).toEqual({ "data-clipboard": "cut" });
    expect(gridRowMarkAttributes({ quiet: true })).toEqual({ "data-quiet": "true" });
  });

  it("carries every mark at once — the fields are independent", () => {
    expect(gridRowMarkAttributes({ pinned: true, clipboard: "copy", quiet: true })).toEqual({
      "data-row-pinned": "true",
      "data-clipboard": "copy",
      "data-quiet": "true",
    });
  });

  it("renders no attribute for a mark explicitly turned off", () => {
    expect(gridRowMarkAttributes({ pinned: false, quiet: false })).toEqual({});
  });
});
