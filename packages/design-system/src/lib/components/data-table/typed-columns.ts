/*
 * Typed columns — declare a column's value TYPE in its `meta` and the table formats + aligns it,
 * instead of dumping the raw value. Set `defaultColumn: { cell: typedCell }` on the table so every
 * column without an explicit `cell` formats by its type; read `columnAlign(column)` in the head/cell
 * markup to right-align numerics with tabular figures.
 *
 * Money is formatted with `Intl.NumberFormat` for DISPLAY only (a thin, locale-correct presenter).
 * Authoritative monetary values live in `@magna-carta/money` (branded minor-units) at the data layer;
 * a money column receives the already-correct numeric amount and only presents it. Dates render in UTC
 * so a date-only value never shifts across the runner's timezone.
 */
import type { CellContext, ColumnMeta, Row, RowData } from "@tanstack/table-core";
import type { Column } from "@tanstack/table-core";

export type ColumnValueType = "text" | "number" | "money" | "date";
/** The per-column filter control: a contains box, faceted value list, numeric range, or date range. */
export type ColumnFilterKind = "text" | "facet" | "range" | "date";

declare module "@tanstack/table-core" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** The column's value type — drives formatting + alignment when `typedCell` is the default cell. */
    type?: ColumnValueType;
    /** Override the type-derived alignment ("end" for number/money). */
    align?: "start" | "end";
    /** Currency code for a `money` column (default "USD"). */
    currency?: string;
    /** BCP-47 locale for formatting (default the runtime locale). */
    locale?: string;
    /** Human label for the column (the Columns menu + headers); falls back to a title-cased id. */
    label?: string;
    /** The per-column filter control. Defaults from `type` (number/money → range, date → date, text →
     * text); set explicitly for a faceted (distinct-value) filter, or omit for no column filter. */
    filter?: ColumnFilterKind;
  }
}

export function formatMoney(
  value: number,
  options: { currency?: string; locale?: string } = {},
): string {
  return new Intl.NumberFormat(options.locale, {
    style: "currency",
    currency: options.currency ?? "USD",
  }).format(value);
}

export function formatNumber(value: number, options: { locale?: string } = {}): string {
  return new Intl.NumberFormat(options.locale).format(value);
}

export function formatDate(
  value: Date | string | number,
  options: { locale?: string } = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(options.locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Format a raw value by a column's declared `meta.type` — the shared core of cells and search. */
function formatValue(value: unknown, meta: ColumnMeta<RowData, unknown> | undefined): string {
  if (value == null) return "";
  switch (meta?.type) {
    case "money":
      return formatMoney(Number(value), meta);
    case "number":
      return formatNumber(Number(value), meta);
    case "date":
      return formatDate(value as Date | string | number, meta);
    default:
      // The text path expects a primitive accessor value; cast so the linter knows it is stringifiable.
      return String(value as string | number | boolean);
  }
}

/** The default cell that formats a value by its column's declared `meta.type`. */
export function typedCell<TData extends RowData>(context: CellContext<TData, unknown>): string {
  return formatValue(context.getValue(), context.column.columnDef.meta);
}

/**
 * The searchable text for a value — the displayed form PLUS, for money/number, the bare number, so a
 * money cell shown as "$2,125.00" also matches "2125" and "2,125" (any of the forms a user might type).
 */
function searchableValue(value: unknown, meta: ColumnMeta<RowData, unknown> | undefined): string {
  const formatted = formatValue(value, meta);
  if (value != null && (meta?.type === "money" || meta?.type === "number")) {
    return `${formatted} ${String(value as number)}`;
  }
  return formatted;
}

/**
 * A global-filter function that matches the FORMATTED (displayed) value, not the raw one — so a date
 * is searchable as "Mar 13, 2025" and money as "$2,125.00", what the user actually sees. Pair it with
 * `getColumnCanGlobalFilter: () => true` so date/object columns (which table-core would otherwise skip)
 * are included.
 */
export function typedGlobalFilterFn<TData extends RowData>(
  row: Row<TData>,
  columnId: string,
  filterValue: unknown,
): boolean {
  const query = String((filterValue ?? "") as string)
    .trim()
    .toLowerCase();
  if (query === "") return true;
  const cell = row.getAllCells().find((candidate) => candidate.column.id === columnId);
  if (!cell) return false;
  return searchableValue(cell.getValue(), cell.column.columnDef.meta).toLowerCase().includes(query);
}

/** "end" for numeric/money columns (or an explicit `meta.align`), else "start". */
export function columnAlign<TData extends RowData>(
  column: Column<TData, unknown>,
): "start" | "end" {
  const meta = column.columnDef.meta;
  if (meta?.align) return meta.align;
  return meta?.type === "money" || meta?.type === "number" ? "end" : "start";
}

/** The per-column filter control kind, from `meta.filter` or derived from `meta.type` (undefined → no filter). */
export function columnFilterKind<TData extends RowData>(
  column: Column<TData, unknown>,
): ColumnFilterKind | undefined {
  const meta = column.columnDef.meta;
  if (meta?.filter) return meta.filter;
  switch (meta?.type) {
    case "money":
    case "number":
      return "range";
    case "date":
      return "date";
    case "text":
      return "text";
    default:
      return undefined;
  }
}

/**
 * A filter function for a `date` column over a `[from, to]` pair of `YYYY-MM-DD` strings (either side
 * optional). Compares in UTC and treats `to` as inclusive through end-of-day, matching the displayed
 * date-only values.
 */
export function dateRangeFilterFn<TData extends RowData>(
  row: Row<TData>,
  columnId: string,
  filterValue: unknown,
): boolean {
  const [from, to] = (Array.isArray(filterValue) ? filterValue : []) as [string?, string?];
  if (!from && !to) return true;
  const value = row.getValue(columnId);
  const time = (value instanceof Date ? value : new Date(value as string)).getTime();
  if (from && time < new Date(`${from}T00:00:00Z`).getTime()) return false;
  if (to && time > new Date(`${to}T23:59:59Z`).getTime()) return false;
  return true;
}

/** The column's display label — `meta.label`, else the string header, else a title-cased id. */
export function columnLabel<TData extends RowData>(column: Column<TData, unknown>): string {
  const meta = column.columnDef.meta;
  if (meta?.label) return meta.label;
  const header = column.columnDef.header;
  if (typeof header === "string" && header !== "") return header;
  return column.id.charAt(0).toUpperCase() + column.id.slice(1);
}
