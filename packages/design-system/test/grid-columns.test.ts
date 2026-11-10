import { describe, expect, it } from "vitest";
import {
  compareGridRows,
  gridCellText,
  gridColumnAlign,
  gridColumnSum,
  gridColumnTotalText,
  movedGridColumnOrder,
  gridRowComparator,
  sortGridRows,
  visibleGridColumns,
  type GridColumn,
} from "../src/lib/components/data-table/grid-columns.ts";

/*
 * The declarative column model behind DataTable.Grid: type-aware STABLE sorting (empties last in
 * both directions, ties broken by row key), the anchored-then-pinned-then-rest visible order, the
 * never-ahead-of-the-anchor reorder rule, and the totals math.
 */
type Entry = {
  id: string;
  date: string | null;
  title: string;
  hours: number | null;
  amount: number | null;
};

const rowKey = (row: Entry): string => row.id;

const dateColumn: GridColumn<Entry> = {
  id: "date",
  label: "Date",
  type: "date",
  anchored: true,
  value: (row) => row.date,
};
const titleColumn: GridColumn<Entry> = {
  id: "title",
  label: "Title",
  value: (row) => row.title,
};
const hoursColumn: GridColumn<Entry> = {
  id: "hours",
  label: "Hours",
  type: "number",
  total: "sum",
  value: (row) => row.hours,
};
const amountColumn: GridColumn<Entry> = {
  id: "amount",
  label: "Amount",
  type: "money",
  total: "sum",
  value: (row) => row.amount,
};
const COLUMNS = [dateColumn, titleColumn, hoursColumn, amountColumn];

const ROWS: Entry[] = [
  { id: "e1", date: "2026-08-03", title: "Draft motion", hours: 2.5, amount: 875 },
  { id: "e2", date: "2026-08-01", title: "Client call", hours: 0.5, amount: 175 },
  { id: "e3", date: null, title: "Review file", hours: null, amount: null },
  { id: "e4", date: "2026-08-01", title: "client call", hours: 1, amount: 350 },
];

describe("sorting", () => {
  it("reads runs of digits in text as numbers, so 3333-10 follows 3333-9 without padding", () => {
    const titles = ["3333-10", "3333-2", "10000-1", "3333-1", "9999-1", "3333-9"];
    const rows: Entry[] = titles.map((title, index) => ({
      id: `r${index}`,
      date: null,
      title,
      hours: null,
      amount: null,
    }));
    expect(sortGridRows(rows, titleColumn, "ascending", rowKey).map((row) => row.title)).toEqual([
      "3333-1",
      "3333-2",
      "3333-9",
      "3333-10",
      "9999-1",
      "10000-1",
    ]);
  });

  it("is numeric for number columns, not lexicographic", () => {
    const rows: Entry[] = [
      { id: "a", date: null, title: "", hours: 10, amount: null },
      { id: "b", date: null, title: "", hours: 2, amount: null },
    ];
    const sorted = sortGridRows(rows, hoursColumn, "ascending", rowKey);
    expect(sorted.map((row) => row.hours)).toEqual([2, 10]);
  });

  it("compares dates as instants", () => {
    expect(compareGridRows(dateColumn, ROWS[1]!, ROWS[0]!)).toBeLessThan(0);
  });

  it("keeps empty values LAST in both directions", () => {
    const ascending = sortGridRows(ROWS, dateColumn, "ascending", rowKey);
    const descending = sortGridRows(ROWS, dateColumn, "descending", rowKey);
    expect(ascending.at(-1)?.id).toBe("e3");
    expect(descending.at(-1)?.id).toBe("e3");
    expect(descending[0]?.id).toBe("e1");
  });

  it("is stable: equal values tie-break on the row key, in either direction", () => {
    const ascending = sortGridRows(ROWS, dateColumn, "ascending", rowKey);
    expect(ascending.map((row) => row.id)).toEqual(["e2", "e4", "e1", "e3"]);
    const descending = sortGridRows(ROWS, dateColumn, "descending", rowKey);
    expect(descending.map((row) => row.id)).toEqual(["e1", "e2", "e4", "e3"]);
  });

  it("hands a hierarchy the same rule it sorts flat rows by", () => {
    // A tree surface sorts siblings within their parent with this comparator; it has to be the
    // very rule the flat table uses, or the reader's sort would mean two things on two surfaces.
    const compare = gridRowComparator(dateColumn, "descending", rowKey);
    expect(ROWS.toSorted(compare).map((row) => row.id)).toEqual(
      sortGridRows(ROWS, dateColumn, "descending", rowKey).map((row) => row.id),
    );
  });

  it("does not mutate the input", () => {
    const rows = [...ROWS];
    sortGridRows(rows, titleColumn, "ascending", rowKey);
    expect(rows).toEqual(ROWS);
  });
});

describe("alignment and cell text", () => {
  it("number and money columns read at the end with everything else at the start", () => {
    expect(gridColumnAlign(hoursColumn)).toBe("end");
    expect(gridColumnAlign(amountColumn)).toBe("end");
    expect(gridColumnAlign(titleColumn)).toBe("start");
    expect(gridColumnAlign({ ...hoursColumn, align: "start" })).toBe("start");
  });

  it("formats by type and renders an empty value as empty text", () => {
    expect(gridCellText(amountColumn, ROWS[0]!)).toBe("$875.00");
    expect(gridCellText(dateColumn, ROWS[0]!)).toBe("Aug 3, 2026");
    expect(gridCellText(amountColumn, ROWS[2]!)).toBe("");
  });

  it("a text accessor overrides the typed formatting", () => {
    const custom: GridColumn<Entry> = { ...hoursColumn, text: (row) => `${row.hours ?? 0} h` };
    expect(gridCellText(custom, ROWS[0]!)).toBe("2.5 h");
  });
});

describe("visible order", () => {
  it("anchored leads, pinned follows contiguously, then the rest", () => {
    const visible = visibleGridColumns(
      COLUMNS,
      ["date", "title", "hours", "amount"],
      new Set(),
      new Set(["amount"]),
    );
    expect(visible.map((column) => column.id)).toEqual(["date", "amount", "title", "hours"]);
  });

  it("hides hidden columns but never an anchored one", () => {
    const visible = visibleGridColumns(
      COLUMNS,
      ["date", "title", "hours", "amount"],
      new Set(["title", "date"]),
      new Set(),
    );
    expect(visible.map((column) => column.id)).toEqual(["date", "hours", "amount"]);
  });

  it("a trailing-pinned column renders LAST, whatever the member-set order says", () => {
    const columns = [dateColumn, { ...titleColumn, pinnedEnd: true }, hoursColumn, amountColumn];
    const visible = visibleGridColumns(
      columns,
      ["date", "title", "hours", "amount"],
      new Set(),
      new Set(),
    );
    expect(visible.map((column) => column.id)).toEqual(["date", "hours", "amount", "title"]);
  });

  it("the leading pin set leaves a trailing-pinned column at the trailing edge", () => {
    const columns = [dateColumn, { ...titleColumn, pinnedEnd: true }, hoursColumn, amountColumn];
    const visible = visibleGridColumns(
      columns,
      ["date", "title", "hours", "amount"],
      new Set(),
      new Set(["title", "amount"]),
    );
    expect(visible.map((column) => column.id)).toEqual(["date", "amount", "hours", "title"]);
  });
});

describe("reorder", () => {
  const ORDER = ["date", "title", "hours", "amount"];

  it("drops before or after the target by the entered half", () => {
    expect(movedGridColumnOrder(COLUMNS, ORDER, "amount", "title", false)).toEqual([
      "date",
      "amount",
      "title",
      "hours",
    ]);
    expect(movedGridColumnOrder(COLUMNS, ORDER, "title", "hours", true)).toEqual([
      "date",
      "hours",
      "title",
      "amount",
    ]);
  });

  it("nothing lands ahead of the anchored block, and the anchor itself never moves", () => {
    expect(movedGridColumnOrder(COLUMNS, ORDER, "hours", "date", false)).toEqual([
      "date",
      "hours",
      "title",
      "amount",
    ]);
    expect(movedGridColumnOrder(COLUMNS, ORDER, "date", "hours", true)).toEqual(ORDER);
  });

  it("a trailing-pinned column never moves — both its edges are declared, not arranged", () => {
    const columns = [dateColumn, titleColumn, hoursColumn, { ...amountColumn, pinnedEnd: true }];
    expect(movedGridColumnOrder(columns, ORDER, "amount", "title", false)).toEqual(ORDER);
  });
});

describe("totals", () => {
  it("sums numeric values, skipping empties", () => {
    expect(gridColumnSum(hoursColumn, ROWS)).toBe(4);
    expect(gridColumnSum(amountColumn, ROWS)).toBe(1400);
  });

  it("formats a money total as currency and honors a custom totalText", () => {
    expect(gridColumnTotalText(amountColumn, ROWS)).toBe("$1,400.00");
    const custom: GridColumn<Entry> = { ...hoursColumn, totalText: (sum) => `${sum.toFixed(1)} h` };
    expect(gridColumnTotalText(custom, ROWS)).toBe("4.0 h");
  });
});
