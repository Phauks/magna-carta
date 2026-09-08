import { describe, expect, it } from "vitest";
import type { GridColumn } from "../src/lib/components/data-table/grid-columns.ts";
import {
  gridRowMatchesSearch,
  gridRowsMatchingSearch,
} from "../src/lib/components/data-table/grid-search.ts";

/*
 * The grid's search grammar, pinned. A reader forms a habit around which words reach which row —
 * whether two words both have to match, whether a word has to start something, whether a state word
 * or the identifier under it is what they type — so the rules are asserted rather than left to the
 * reading of one regular expression. Every screen that searches a grid applies these and holds no
 * matching logic of its own.
 */
type Load = {
  id: string;
  source: string | null;
  state: "loading" | "complete";
  arrived: number;
};

const COLUMNS: GridColumn<Load>[] = [
  { id: "source", label: "Delivery", value: (row) => row.source },
  {
    id: "state",
    label: "State",
    filter: "set",
    value: (row) => row.state,
    // The word the cell shows, not the enum underneath it: what a reader types is "Complete".
    text: (row) => (row.state === "complete" ? "Complete" : "Still loading"),
  },
  { id: "arrived", label: "Arrived", type: "number", value: (row) => row.arrived },
];

const ROWS: Load[] = [
  { id: "load_1", source: "Defendant's second production", state: "complete", arrived: 3987 },
  { id: "load_2", source: "Our collection", state: "loading", arrived: 12 },
  { id: "load_3", source: null, state: "complete", arrived: 0 },
];

describe("matching one row", () => {
  it("matches every row on an empty or whitespace-only query", () => {
    for (const row of ROWS) {
      expect(gridRowMatchesSearch(COLUMNS, row, "")).toBe(true);
      expect(gridRowMatchesSearch(COLUMNS, row, "   ")).toBe(true);
    }
  });

  it("matches inside a word, not only at its start", () => {
    expect(gridRowMatchesSearch(COLUMNS, ROWS[0]!, "fendant")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(gridRowMatchesSearch(COLUMNS, ROWS[1]!, "  OUR Collection ")).toBe(true);
  });

  it("requires every word, so a second word narrows and never widens", () => {
    expect(gridRowMatchesSearch(COLUMNS, ROWS[0]!, "defendant production")).toBe(true);
    expect(gridRowMatchesSearch(COLUMNS, ROWS[0]!, "defendant collection")).toBe(false);
  });

  it("reads the text the column renders rather than the value under it", () => {
    // "Still loading" is what the cell shows for `loading`; both reach the row, and neither is the
    // identifier, which a reader never types.
    expect(gridRowMatchesSearch(COLUMNS, ROWS[1]!, "still loading")).toBe(true);
    expect(gridRowMatchesSearch(COLUMNS, ROWS[1]!, "load_2")).toBe(false);
  });

  it("reaches a number cell, which is text like any other once rendered", () => {
    expect(gridRowMatchesSearch(COLUMNS, ROWS[1]!, "12")).toBe(true);
    expect(gridRowMatchesSearch(COLUMNS, ROWS[0]!, "12")).toBe(false);
  });

  it("treats an empty cell as nothing to match rather than a failure", () => {
    expect(gridRowMatchesSearch(COLUMNS, ROWS[2]!, "complete")).toBe(true);
    expect(gridRowMatchesSearch(COLUMNS, ROWS[2]!, "production")).toBe(false);
  });
});

describe("narrowing the rows", () => {
  it("keeps the original order", () => {
    expect(gridRowsMatchingSearch(COLUMNS, ROWS, "complete").map((row) => row.id)).toEqual([
      "load_1",
      "load_3",
    ]);
  });

  it("hands back the same array on a query that narrows nothing", () => {
    // Identity, not just equality: a resting screen must not hand the grid a new rows array on
    // every read, which would re-key the view for nothing.
    expect(gridRowsMatchingSearch(COLUMNS, ROWS, "  ")).toBe(ROWS);
  });

  it("returns nothing rather than everything when no row answers", () => {
    expect(gridRowsMatchingSearch(COLUMNS, ROWS, "privilege log")).toEqual([]);
  });
});
