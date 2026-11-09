/*
 * Grid columns — the declarative column model behind DataTable.Grid, the platform's one table.
 * A surface declares WHAT its columns are (label, value type, filter kind, totals) and the grid
 * supplies every behavior the matter surfaces settled on: type-aware stable sorting, the
 * one-mechanism per-column filters, show/hide, drag-reorder, pinning, resize with double-click
 * fit, and scope-honest totals. Pure functions here; the runes state lives in
 * data-table-grid-state.svelte.ts and the rendering in data-table-grid.svelte.
 */
import { formatDate, formatMoney, formatNumber } from "./typed-columns.ts";

/** The value a column accessor may produce. Dates may arrive as Date or an ISO/YYYY-MM-DD string. */
export type GridColumnValue = string | number | Date | null | undefined;

export type GridColumnType = "text" | "number" | "money" | "date";
/**
 * The per-column filter control: a checkbox set with counts, a numeric range, a date range — and a
 * contains-text box, only for a column of prose that declares it (see `filter`).
 */
export type GridColumnFilterKind = "text" | "set" | "range" | "dateRange" | "none";
export type GridSortDirection = "ascending" | "descending";

export interface GridColumn<TRow> {
  /** Stable identity — keys the order/width/pin/visibility/filter state. */
  id: string;
  /** The human label: header cell, header menu, filter heading, footer filter list. */
  label: string;
  /** The value type — drives sorting, alignment, default formatting, and the default filter kind. */
  type?: GridColumnType;
  /**
   * The filter control; defaults from `type` (number/money → range, date → dateRange, everything
   * else → set).
   *
   * A text column's filter is the SET — its distinct values, each with a checkbox and a count —
   * because a filter is chosen from what the column holds, and a box that matches typed text is a
   * search wearing a filter's name: it offers no baseline to choose from, and the table already
   * has a search. The contains box survives only for prose — a narrative, a description — where
   * no two rows share a value and a checklist would be the column read twice; such a column says
   * so with `filter: "text"`.
   */
  filter?: GridColumnFilterKind;
  /**
   * The values a SET filter always offers, whether or not any loaded row carries them.
   *
   * A set filter's options are otherwise read off the rows in hand, which is right for a column
   * whose values are whatever the data happens to hold (a client name) and WRONG for a column over
   * a vocabulary the firm declares (a lifecycle status, a matter type, an office). A firm with
   * nothing closed today can still hold closed matters, and a filter that drops "Closed" because
   * none is loaded tells the reader the firm cannot have one. So a column over a declared
   * vocabulary declares it here: those values lead, in this order, each carrying its true count —
   * zero when nothing on screen has it — and any value the rows carry that the vocabulary does not
   * name follows them alphabetically.
   */
  filterValues?: readonly string[];
  /** The comparable/filterable value for a row. `null`/`undefined` sorts last and renders muted. */
  value: (row: TRow) => GridColumnValue;
  /** The display text when the consumer supplies no cell snippet; also the double-click-fit measure.
   * Defaults to the type-formatted `value`. */
  text?: (row: TRow) => string;
  /** Override the type-derived alignment ("end" for number/money). */
  align?: "start" | "end";
  /** Anchored columns always show and always lead — the row's anchor (the Timesheet's Date).
   * Not hideable, not draggable, never dropped behind. */
  anchored?: boolean;
  /** Start hidden; the header menu's Columns submenu shows it on demand. */
  hidden?: boolean;
  /** Start pinned (sticky under horizontal scroll). */
  pinned?: boolean;
  /**
   * Pinned to the TRAILING edge: the column stays stuck to the end of the scroll viewport while
   * the rest of the table scrolls under it (the Time Sheet's always-in-reach column). Declarative,
   * not a member toggle — it always renders last, never drags, and the leading pin control leaves
   * it alone.
   */
  pinnedEnd?: boolean;
  /** Sum this column in the totals row. Only meaningful for number/money columns. */
  total?: "sum";
  /** Formats the totals-row sum; defaults to the column's type formatting. */
  totalText?: (sum: number) => string;
  /** One honest line under a range filter's inputs (the unit: "In hours, as billed."). */
  filterNote?: string;
  /** Currency code for a money column (default "USD"). */
  currency?: string;
  /** BCP-47 locale for formatting (default the runtime locale). */
  locale?: string;
  /** Extra px a cell's furniture takes beyond its text (an avatar, a chip) — feeds double-click fit. */
  fitExtra?: number;
}

/** What a grid `cell` snippet receives — the row, its column, and the model's default text. */
export interface GridCellContext<TRow> {
  row: TRow;
  column: GridColumn<TRow>;
  /** The column model's default display text for this cell ("" when the value is empty). */
  text: string;
}

/** "end" for numeric/money columns (or an explicit `align`), else "start". */
export function gridColumnAlign<TRow>(column: GridColumn<TRow>): "start" | "end" {
  if (column.align) return column.align;
  return column.type === "number" || column.type === "money" ? "end" : "start";
}

/** The column's filter control kind — explicit `filter`, else derived from `type`. */
export function gridColumnFilterKind<TRow>(column: GridColumn<TRow>): GridColumnFilterKind {
  if (column.filter) return column.filter;
  switch (column.type) {
    case "number":
    case "money":
      return "range";
    case "date":
      return "dateRange";
    default:
      return "set";
  }
}

/** The default display text for a cell — the type-formatted value ("" for an empty value). */
export function gridCellText<TRow>(column: GridColumn<TRow>, row: TRow): string {
  if (column.text) return column.text(row);
  const value = column.value(row);
  if (value == null || value === "") return "";
  switch (column.type) {
    case "money":
      return formatMoney(Number(value), column);
    case "number":
      return formatNumber(Number(value), column);
    case "date":
      return formatDate(value as Date | string, column);
    default:
      return String(value);
  }
}

/** A date value as a comparable UTC instant; strings parse as ISO (date-only lands at UTC midnight). */
export function gridDateInstant(value: GridColumnValue): number | null {
  if (value == null || value === "") return null;
  const time = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isNaN(time) ? null : time;
}

/** Locale-aware text order that reads a run of digits as the number it is. */
const TEXT_COLLATOR = new Intl.Collator(undefined, { numeric: true });

/**
 * Type-aware comparison of two rows under one column: numeric for number/money, instant for date,
 * locale-aware text otherwise. Text compares runs of digits AS NUMBERS, so a client's matters read
 * 3333-1, 3333-2 ... 3333-9, 3333-10 rather than 3333-10 landing between 3333-1 and 3333-2, and
 * "Exhibit 2" sorts before "Exhibit 10" (owner ruling, 2026-11-09: a number is never written with
 * padding just so it sorts). Empty values sort LAST in either direction (an absent value is not
 * "smallest", it is "no answer").
 */
export function compareGridRows<TRow>(column: GridColumn<TRow>, left: TRow, right: TRow): number {
  const a = column.value(left);
  const b = column.value(right);
  const aEmpty = a == null || a === "";
  const bEmpty = b == null || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  switch (column.type) {
    case "number":
    case "money":
      return Number(a) - Number(b);
    case "date":
      return (gridDateInstant(a) ?? 0) - (gridDateInstant(b) ?? 0);
    default:
      return TEXT_COLLATOR.compare(String(a), String(b));
  }
}

/**
 * The comparator the grid sorts with: the column's typed comparison in the asked direction, with
 * equal values (and empty-vs-empty) tie-breaking on the row key, so re-sorting never shuffles
 * equal rows and a filtered view keeps a deterministic order. Empties stay last in both directions
 * — only the comparison inverts, never the empty-last rule.
 *
 * Exposed on its own so a surface that arranges its rows itself (a hierarchy sorting siblings
 * within their parent) sorts by exactly the rule the flat table would have used.
 */
export function gridRowComparator<TRow>(
  column: GridColumn<TRow>,
  direction: GridSortDirection,
  rowKey: (row: TRow) => string,
): (left: TRow, right: TRow) => number {
  const sign = direction === "descending" ? -1 : 1;
  return (left, right) => {
    const a = column.value(left);
    const b = column.value(right);
    const aEmpty = a == null || a === "";
    const bEmpty = b == null || b === "";
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    const comparison = aEmpty ? 0 : compareGridRows(column, left, right);
    if (comparison !== 0) return comparison * sign;
    return rowKey(left).localeCompare(rowKey(right));
  };
}

/** Stable sort by `gridRowComparator` — the flat table's own ordering. */
export function sortGridRows<TRow>(
  rows: readonly TRow[],
  column: GridColumn<TRow>,
  direction: GridSortDirection,
  rowKey: (row: TRow) => string,
): TRow[] {
  return rows.toSorted(gridRowComparator(column, direction, rowKey));
}

/**
 * The visible columns in render order: the anchored block first (the row's anchor reads first),
 * then the pinned block (sticky columns stay contiguous from the leading edge), then the rest —
 * each block preserving the member-set order — and the trailing-pinned block LAST, stuck to the
 * end of the viewport. The Docket's ordering, shared exactly.
 */
export function visibleGridColumns<TRow>(
  columns: readonly GridColumn<TRow>[],
  order: readonly string[],
  hiddenColumnIds: ReadonlySet<string>,
  pinnedColumnIds: ReadonlySet<string>,
): GridColumn<TRow>[] {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const ordered = order
    .map((id) => byId.get(id))
    .filter((column): column is GridColumn<TRow> => column !== undefined)
    .filter((column) => column.anchored || !hiddenColumnIds.has(column.id));
  const scrolling = ordered.filter((column) => !column.anchored && column.pinnedEnd !== true);
  return [
    ...ordered.filter((column) => column.anchored),
    ...scrolling.filter((column) => pinnedColumnIds.has(column.id)),
    ...scrolling.filter((column) => !pinnedColumnIds.has(column.id)),
    ...ordered.filter((column) => !column.anchored && column.pinnedEnd === true),
  ];
}

/**
 * The column order after dropping `fromId` before/after `toId`. Anchored columns hold their
 * ground: nothing lands ahead of the anchored block, and an anchored column never moves. A
 * trailing-pinned column never moves either — both its edges are declared, not arranged.
 */
export function movedGridColumnOrder<TRow>(
  columns: readonly GridColumn<TRow>[],
  order: readonly string[],
  fromId: string,
  toId: string,
  after: boolean,
): string[] {
  if (fromId === toId) return [...order];
  const held = columns.find((column) => column.id === fromId);
  if (held?.pinnedEnd === true) return [...order];
  const anchored = new Set(columns.filter((column) => column.anchored).map((column) => column.id));
  if (anchored.has(fromId)) return [...order];
  const next = order.filter((id) => id !== fromId);
  let to = next.indexOf(toId) + (after ? 1 : 0);
  const firstMovable = next.findIndex((id) => !anchored.has(id));
  if (firstMovable !== -1 && to < firstMovable) to = firstMovable;
  next.splice(to, 0, fromId);
  return next;
}

/** The sum of a column's numeric values over the given rows (empty values contribute nothing). */
export function gridColumnSum<TRow>(column: GridColumn<TRow>, rows: readonly TRow[]): number {
  let sum = 0;
  for (const row of rows) {
    const value = column.value(row);
    if (value == null || value === "") continue;
    sum += Number(value);
  }
  return sum;
}

/** The totals-row text for a column — `totalText`, else the column's own type formatting. */
export function gridColumnTotalText<TRow>(column: GridColumn<TRow>, rows: readonly TRow[]): string {
  const sum = gridColumnSum(column, rows);
  if (column.totalText) return column.totalText(sum);
  if (column.type === "money") return formatMoney(sum, column);
  return formatNumber(sum, column);
}
