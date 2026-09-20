/*
 * Grid filters — ONE filter mechanism, parameterized by column type (the settled rule across the
 * matter surfaces): a checkbox set with counts (the facet-selection model carries the all/none
 * math; the default for text), a numeric from/to range, a date from/to range, and a contains-text
 * box for the prose column that asks for it. A column with no entry in the filter record is
 * unfiltered; an entry always narrows. Pure functions — the grid state applies them, the filter
 * popover renders them.
 */
import type { GridColumn } from "./grid-columns.ts";
import { gridColumnFilterKind, gridDateInstant } from "./grid-columns.ts";
import { formatDate } from "./typed-columns.ts";

export type GridColumnFilter =
  | { kind: "text"; query: string }
  | {
      /** The still-selected subset of the column's distinct values; [] means none (matches nothing). */
      kind: "set";
      values: readonly string[];
    }
  | { kind: "range"; from: number | null; to: number | null }
  | {
      /** YYYY-MM-DD bounds, either side open; `to` is inclusive through end of day (UTC). */
      kind: "dateRange";
      from: string | null;
      to: string | null;
    };

/** Active filters by column id. Absence of a key = that column is unfiltered. */
export type GridFilters = Readonly<Record<string, GridColumnFilter>>;

/** A column's value as the string the set filter groups and matches on ("" for empty). */
export function gridSetValue<TRow>(column: GridColumn<TRow>, row: TRow): string {
  const value = column.value(row);
  return value == null ? "" : String(value);
}

/**
 * Distinct set-filter values with their counts over the UNFILTERED rows — a stable universe, so
 * options never vanish as the selection narrows (the settled facet inversion fix).
 *
 * A column that declares `filterValues` gets those FIRST, in the order it declared them, each with
 * its true count and zero where no loaded row carries it: a vocabulary the firm declares is offered
 * whole, so the control cannot imply the firm has no such thing merely because none is on screen.
 * Whatever else the rows carry follows, alphabetically, which is the whole answer for a column with
 * no declared vocabulary.
 */
export function gridSetFilterCounts<TRow>(
  column: GridColumn<TRow>,
  rows: readonly TRow[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = gridSetValue(column, row);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const declared = column.filterValues ?? [];
  const observed = [...counts.entries()]
    .filter(([value]) => !declared.includes(value))
    .toSorted(([a], [b]) => a.localeCompare(b));
  return new Map([
    ...declared.map((value): [string, number] => [value, counts.get(value) ?? 0]),
    ...observed,
  ]);
}

/** Whether one row passes one column's filter. */
export function rowPassesGridColumnFilter<TRow>(
  column: GridColumn<TRow>,
  filter: GridColumnFilter,
  row: TRow,
): boolean {
  switch (filter.kind) {
    case "text": {
      const query = filter.query.trim().toLowerCase();
      if (query === "") return true;
      return gridSetValue(column, row).toLowerCase().includes(query);
    }
    case "set":
      return filter.values.includes(gridSetValue(column, row));
    case "range": {
      const value = column.value(row);
      if (value == null || value === "") return false;
      const numeric = Number(value);
      if (filter.from !== null && numeric < filter.from) return false;
      if (filter.to !== null && numeric > filter.to) return false;
      return true;
    }
    case "dateRange": {
      const instant = gridDateInstant(column.value(row));
      if (instant === null) return false;
      if (filter.from !== null && instant < Date.parse(`${filter.from}T00:00:00Z`)) return false;
      if (filter.to !== null && instant > Date.parse(`${filter.to}T23:59:59.999Z`)) return false;
      return true;
    }
  }
}

/** Whether one row passes EVERY active filter. */
export function rowPassesGridFilters<TRow>(
  columns: readonly GridColumn<TRow>[],
  filters: GridFilters,
  row: TRow,
): boolean {
  for (const [columnId, filter] of Object.entries(filters)) {
    const column = columns.find((candidate) => candidate.id === columnId);
    if (!column) continue;
    if (!rowPassesGridColumnFilter(column, filter, row)) return false;
  }
  return true;
}

/**
 * A one-line reading of a column's active filter, for the funnel's hover: what is being kept.
 * ("Filtered: Draft, Submitted. Change or clear the filter" is composed by the caller.)
 */
export function gridFilterSummary<TRow>(
  column: GridColumn<TRow>,
  filter: GridColumnFilter,
): string {
  switch (filter.kind) {
    case "set":
      return filter.values.length === 0 ? "nothing selected" : filter.values.join(", ");
    case "text":
      return `contains "${filter.query}"`;
    case "range": {
      if (filter.from !== null && filter.to !== null) return `${filter.from} to ${filter.to}`;
      return filter.from !== null ? `${filter.from} and up` : `up to ${filter.to}`;
    }
    case "dateRange": {
      const show = (bound: string): string => formatDate(bound, column);
      if (filter.from !== null && filter.to !== null)
        return `${show(filter.from)} to ${show(filter.to)}`;
      return filter.from !== null
        ? `${show(filter.from)} and later`
        : `up to ${show(String(filter.to))}`;
    }
  }
}

/**
 * The next filter record after a change to one column. A filter that no longer narrows — an empty
 * text query, both range bounds open, or a set covering the whole universe — is REMOVED, so
 * "filtered" state (funnel lit, footer counting, clear affordances present) is never a lie.
 */
export function gridFiltersAfterChange(
  filters: GridFilters,
  columnId: string,
  filter: GridColumnFilter | undefined,
  setUniverseSize?: number,
): GridFilters {
  const next: Record<string, GridColumnFilter> = { ...filters };
  const clears =
    filter === undefined ||
    (filter.kind === "text" && filter.query.trim() === "") ||
    (filter.kind === "range" && filter.from === null && filter.to === null) ||
    (filter.kind === "dateRange" && filter.from === null && filter.to === null) ||
    (filter.kind === "set" &&
      setUniverseSize !== undefined &&
      filter.values.length >= setUniverseSize);
  if (clears) delete next[columnId];
  else next[columnId] = filter;
  return next;
}

/** The active filters' column labels, in the columns' declared order (footer + empty-state copy). */
export function activeGridFilterLabels<TRow>(
  columns: readonly GridColumn<TRow>[],
  filters: GridFilters,
): string[] {
  return columns.filter((column) => filters[column.id] !== undefined).map((column) => column.label);
}

/** Kind helper re-exported beside the filter math so the popover derives its control in one import. */
export { gridColumnFilterKind };
