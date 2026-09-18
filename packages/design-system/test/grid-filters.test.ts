import { describe, expect, it } from "vitest";
import type { GridColumn } from "../src/lib/components/data-table/grid-columns.ts";
import {
  activeGridFilterLabels,
  gridColumnFilterKind,
  gridFilterSummary,
  gridFiltersAfterChange,
  gridSetFilterCounts,
  rowPassesGridColumnFilter,
  rowPassesGridFilters,
  type GridFilters,
} from "../src/lib/components/data-table/grid-filters.ts";

/*
 * The one filter mechanism, parameterized by column type. The load-bearing rules: a filter that
 * no longer narrows is REMOVED (so "filtered" indications are never a lie), the set filter's
 * counts come from the UNFILTERED rows (a stable universe), and a date range's `to` is inclusive
 * through end of day.
 */
type Entry = { id: string; date: string | null; status: string; hours: number | null };

const dateColumn: GridColumn<Entry> = {
  id: "date",
  label: "Date",
  type: "date",
  value: (row) => row.date,
};
const statusColumn: GridColumn<Entry> = {
  id: "status",
  label: "Status",
  filter: "set",
  value: (row) => row.status,
};
const hoursColumn: GridColumn<Entry> = {
  id: "hours",
  label: "Hours",
  type: "number",
  value: (row) => row.hours,
};
const COLUMNS = [dateColumn, statusColumn, hoursColumn];

const ROWS: Entry[] = [
  { id: "e1", date: "2026-08-01", status: "Draft", hours: 1 },
  { id: "e2", date: "2026-08-15", status: "Approved", hours: 2.5 },
  { id: "e3", date: "2026-08-31", status: "Draft", hours: null },
  { id: "e4", date: null, status: "Billed", hours: 4 },
];

describe("per-kind matching", () => {
  it("text matches case-insensitively on containment", () => {
    const filter = { kind: "text", query: "dra" } as const;
    expect(rowPassesGridColumnFilter(statusColumn, filter, ROWS[0]!)).toBe(true);
    expect(rowPassesGridColumnFilter(statusColumn, filter, ROWS[1]!)).toBe(false);
  });

  it("set keeps only the selected values; an empty set matches nothing", () => {
    expect(
      rowPassesGridColumnFilter(statusColumn, { kind: "set", values: ["Draft"] }, ROWS[0]!),
    ).toBe(true);
    expect(
      rowPassesGridColumnFilter(statusColumn, { kind: "set", values: ["Draft"] }, ROWS[1]!),
    ).toBe(false);
    expect(rowPassesGridColumnFilter(statusColumn, { kind: "set", values: [] }, ROWS[0]!)).toBe(
      false,
    );
  });

  it("range bounds are inclusive and an empty value never passes", () => {
    const filter = { kind: "range", from: 2.5, to: 4 } as const;
    expect(rowPassesGridColumnFilter(hoursColumn, filter, ROWS[1]!)).toBe(true);
    expect(rowPassesGridColumnFilter(hoursColumn, filter, ROWS[0]!)).toBe(false);
    expect(rowPassesGridColumnFilter(hoursColumn, filter, ROWS[2]!)).toBe(false);
  });

  it("a date range's `to` is inclusive through end of day", () => {
    const filter = { kind: "dateRange", from: "2026-08-15", to: "2026-08-31" } as const;
    expect(rowPassesGridColumnFilter(dateColumn, filter, ROWS[1]!)).toBe(true);
    expect(rowPassesGridColumnFilter(dateColumn, filter, ROWS[2]!)).toBe(true);
    expect(rowPassesGridColumnFilter(dateColumn, filter, ROWS[0]!)).toBe(false);
    expect(rowPassesGridColumnFilter(dateColumn, filter, ROWS[3]!)).toBe(false);
  });

  it("every active filter must pass", () => {
    const filters: GridFilters = {
      status: { kind: "set", values: ["Draft"] },
      date: { kind: "dateRange", from: "2026-08-15", to: null },
    };
    expect(ROWS.filter((row) => rowPassesGridFilters(COLUMNS, filters, row))).toEqual([ROWS[2]]);
  });
});

describe("set filter counts", () => {
  it("counts distinct values over the UNFILTERED rows, sorted", () => {
    const counts = gridSetFilterCounts(statusColumn, ROWS);
    expect([...counts.entries()]).toEqual([
      ["Approved", 1],
      ["Billed", 1],
      ["Draft", 2],
    ]);
  });

  it("offers a column's DECLARED values whole, in declared order, counting zero for the absent", () => {
    // A column over a vocabulary the firm declares must offer all of it: a set filter that drops a
    // value because no loaded row carries it tells the reader the firm cannot hold one.
    const declared: GridColumn<Entry> = {
      ...statusColumn,
      filterValues: ["Draft", "Submitted", "Approved", "Billed", "Void"],
    };
    expect([...gridSetFilterCounts(declared, ROWS).entries()]).toEqual([
      ["Draft", 2],
      ["Submitted", 0],
      ["Approved", 1],
      ["Billed", 1],
      ["Void", 0],
    ]);
  });

  it("offers the declared values even over NO rows at all", () => {
    const declared: GridColumn<Entry> = { ...statusColumn, filterValues: ["Draft", "Void"] };
    expect([...gridSetFilterCounts(declared, []).entries()]).toEqual([
      ["Draft", 0],
      ["Void", 0],
    ]);
  });

  it("puts a value the rows carry but the vocabulary does not name AFTER the declared ones", () => {
    // An undeclared value is still real and still filterable — a matter type deactivated after the
    // rows were written, say — so it follows the vocabulary rather than displacing it.
    const declared: GridColumn<Entry> = { ...statusColumn, filterValues: ["Billed", "Draft"] };
    expect([...gridSetFilterCounts(declared, ROWS).keys()]).toEqual([
      "Billed",
      "Draft",
      "Approved",
    ]);
  });
});

describe("filter lifecycle", () => {
  it("a filter that no longer narrows is removed — empty text, open range, full set", () => {
    const active: GridFilters = { status: { kind: "set", values: ["Draft"] } };
    expect(gridFiltersAfterChange(active, "status", { kind: "text", query: "  " })).toEqual({});
    expect(
      gridFiltersAfterChange(active, "status", { kind: "range", from: null, to: null }),
    ).toEqual({});
    expect(
      gridFiltersAfterChange(active, "status", { kind: "set", values: ["A", "B"] }, 2),
    ).toEqual({});
    expect(gridFiltersAfterChange(active, "status", undefined)).toEqual({});
  });

  it("an empty SET stays an active filter — none selected is not all selected", () => {
    const next = gridFiltersAfterChange({}, "status", { kind: "set", values: [] }, 3);
    expect(next["status"]).toEqual({ kind: "set", values: [] });
  });

  it("active filter labels follow the declared column order", () => {
    const filters: GridFilters = {
      hours: { kind: "range", from: 1, to: null },
      date: { kind: "dateRange", from: "2026-08-01", to: null },
    };
    expect(activeGridFilterLabels(COLUMNS, filters)).toEqual(["Date", "Hours"]);
  });
});

describe("summaries", () => {
  it("reads each kind honestly", () => {
    expect(gridFilterSummary(statusColumn, { kind: "set", values: ["Draft", "Billed"] })).toBe(
      "Draft, Billed",
    );
    expect(gridFilterSummary(statusColumn, { kind: "set", values: [] })).toBe("nothing selected");
    expect(gridFilterSummary(statusColumn, { kind: "text", query: "call" })).toBe(
      'contains "call"',
    );
    expect(gridFilterSummary(hoursColumn, { kind: "range", from: 1, to: null })).toBe("1 and up");
    expect(
      gridFilterSummary(dateColumn, { kind: "dateRange", from: "2026-08-01", to: "2026-08-15" }),
    ).toBe("Aug 1, 2026 to Aug 15, 2026");
  });
});

/*
 * Which control a column gets. A text column's filter is the SET — a filter is chosen from what the
 * column holds, and a box matching typed text is a search — and the contains box is only for the
 * prose column that declares it.
 */
describe("the filter kind a column gets", () => {
  it("a text column, typed or untyped, gets the set", () => {
    expect(gridColumnFilterKind({ id: "a", label: "A", type: "text", value: () => "" })).toBe(
      "set",
    );
    expect(gridColumnFilterKind({ id: "a", label: "A", value: () => "" })).toBe("set");
  });

  it("numbers and money get the range, dates the date range", () => {
    expect(gridColumnFilterKind(hoursColumn)).toBe("range");
    expect(gridColumnFilterKind({ ...hoursColumn, type: "money" })).toBe("range");
    expect(gridColumnFilterKind(dateColumn)).toBe("dateRange");
  });

  it("a column of prose keeps the contains box only by declaring it", () => {
    expect(gridColumnFilterKind({ id: "a", label: "A", filter: "text", value: () => "" })).toBe(
      "text",
    );
    expect(gridColumnFilterKind({ id: "a", label: "A", filter: "none", value: () => "" })).toBe(
      "none",
    );
  });
});
