/*
 * DataTable.Grid state — the runes engine behind the platform's one table. A surface creates this
 * once (createDataTableGrid) and hands it to <DataTable.Grid> plus any companion controls
 * (GridFooter, a clear-filters button). The state is the contract: sorting,
 * filters, column visibility/order/pins/widths, selection, and the derived views (visible columns,
 * rows in view, totals) all live here, so every control reads and writes the SAME table — the
 * one-table ruling in code.
 *
 * Selection is state, never presentation: the grid emits onSelectionChange and onActivate and
 * opens nothing itself.
 */
import type { GridColumn, GridSortDirection } from "./grid-columns.ts";
import {
  gridColumnTotalText,
  gridRowComparator,
  movedGridColumnOrder,
  visibleGridColumns,
} from "./grid-columns.ts";
import type { GridColumnFilter, GridFilters } from "./grid-filters.ts";
import {
  activeGridFilterLabels,
  gridFiltersAfterChange,
  gridSetFilterCounts,
  rowPassesGridFilters,
} from "./grid-filters.ts";
import type { GridRowGrouping, GridRowMark } from "./grid-rows.ts";
import { groupedGridRows } from "./grid-rows.ts";
import type { GridClickModifiers, GridSelection } from "./grid-selection.ts";
import {
  emptyGridSelection,
  gridSelectionAfterArrow,
  gridSelectionAfterRowClick,
  gridSelectionOfAll,
} from "./grid-selection.ts";

export interface GridItemNoun {
  singular: string;
  plural: string;
}

export interface DataTableGridOptions<TRow> {
  /** The declarative column model. A thunk so the grid tracks a reactive source. */
  columns: () => readonly GridColumn<TRow>[];
  /** The rows. A thunk so the grid tracks a reactive source. */
  rows: () => readonly TRow[];
  /** Stable row identity — keys selection and the stable-sort tiebreak. */
  rowKey: (row: TRow) => string;
  /**
   * Initial sort; defaults to the first column, ascending.
   *
   * A `columnId` of null opens the table UNSORTED — the rows render in the order the surface handed
   * them over. That is what a ranked answer needs: its order is the server's, and re-ordering a
   * capped best-of by a column would put the best of an arbitrary slice at the top and read as the
   * best of the whole record. The reader can still sort by clicking a header, which is them asking
   * a different question.
   */
  initialSort?: { columnId: string | null; direction: GridSortDirection };
  /** Which rows count toward the totals row (e.g. voids never count). Defaults to all. */
  totalIncludes?: (row: TRow) => boolean;
  /** What a row is called in the footer and the filtered-empty copy ("entry"/"entries"). */
  itemNoun?: GridItemNoun;
  /** Zebra striping on at first render (the header menu's Columns submenu toggles it). */
  zebra?: boolean;
  /**
   * Row keys pinned to the top, in the member's OWN arranged order — pinning is an act of
   * arranging, so the table's sort never reorders the block. A thunk so the grid tracks a
   * reactive source; the surface owns what pinning means and where it persists.
   */
  pinnedRowKeys?: () => readonly string[];
  /**
   * What the list says about a row before its data: the pin, a clipboard mark, a quieter voice.
   * One vocabulary across every surface, so two lists cannot disagree about what a mark means.
   */
  rowMark?: (row: TRow) => GridRowMark | undefined;
  /** Selection changed — the grid emits, the surface decides what presenting it means. */
  onSelectionChange?: (keys: readonly string[], rows: readonly TRow[]) => void;
  /** A row was activated (double-click / Enter) — distinct from selection. */
  onActivate?: (row: TRow) => void;
  /**
   * How the filtered rows are put in order, when a flat sort is not the whole answer. The grid
   * hands over the rows that passed its filters and the comparator it would have sorted them
   * with (the chosen column, in the chosen direction, ties broken on the key); the surface returns
   * them arranged. A hierarchy uses this to sort siblings within their parent and keep every child
   * under it, so the reader's sort still means what it says on every level while the tree holds.
   * Omitted, the rows are sorted flat — which is every table but the hierarchical ones.
   */
  orderRows?: (
    rows: readonly TRow[],
    compare: (left: TRow, right: TRow) => number,
  ) => readonly TRow[];
}

/** Per-column default sort direction: dates read newest-first, everything else ascending. */
function defaultDirection<TRow>(column: GridColumn<TRow> | undefined): GridSortDirection {
  return column?.type === "date" ? "descending" : "ascending";
}

export class DataTableGridState<TRow> {
  readonly options: DataTableGridOptions<TRow>;

  sortColumnId = $state<string | null>(null);
  sortDirection = $state<GridSortDirection>("ascending");
  filters = $state<GridFilters>({});
  hiddenColumnIds = $state<ReadonlySet<string>>(new Set());
  pinnedColumnIds = $state<ReadonlySet<string>>(new Set());
  columnOrder = $state<readonly string[]>([]);
  /** Member-set widths by column id; empty until the first resize snapshots the layout. */
  columnWidths = $state<Readonly<Record<string, number>>>({});
  /** False until somebody resizes; from then on the table is fixed-layout and widths are theirs. */
  columnWidthsFixed = $state(false);
  selection = $state<GridSelection>(emptyGridSelection());
  zebra = $state(false);

  constructor(options: DataTableGridOptions<TRow>) {
    this.options = options;
    const columns = options.columns();
    this.columnOrder = columns.map((column) => column.id);
    this.hiddenColumnIds = new Set(
      columns.filter((column) => column.hidden && !column.anchored).map((column) => column.id),
    );
    this.pinnedColumnIds = new Set(
      columns
        .filter((column) => column.pinned && column.pinnedEnd !== true)
        .map((column) => column.id),
    );
    // A null (or unknown) sort column leaves `sortColumnId` null, and the rows then render in the
    // order the surface gave them — the shape a ranked answer arrives in.
    const initialSortColumn = options.initialSort
      ? columns.find((column) => column.id === options.initialSort?.columnId)
      : columns[0];
    this.sortColumnId = initialSortColumn?.id ?? null;
    this.sortDirection = options.initialSort?.direction ?? defaultDirection(initialSortColumn);
    this.zebra = options.zebra ?? false;
  }

  get itemNoun(): GridItemNoun {
    return this.options.itemNoun ?? { singular: "row", plural: "rows" };
  }

  columns = $derived.by((): readonly GridColumn<TRow>[] => this.options.columns());
  rows = $derived.by((): readonly TRow[] => this.options.rows());

  columnById(columnId: string): GridColumn<TRow> | undefined {
    return this.columns.find((column) => column.id === columnId);
  }

  /** The visible columns in render order: anchored, then pinned, then the rest. */
  visibleColumns = $derived.by((): readonly GridColumn<TRow>[] =>
    visibleGridColumns(this.columns, this.columnOrder, this.hiddenColumnIds, this.pinnedColumnIds),
  );

  filteredRows = $derived.by((): readonly TRow[] =>
    this.rows.filter((row) => rowPassesGridFilters(this.columns, this.filters, row)),
  );

  sortedRows = $derived.by((): readonly TRow[] => {
    const column = this.sortColumnId === null ? undefined : this.columnById(this.sortColumnId);
    const arrange = this.options.orderRows;
    // No sort column is not a missing answer: it is "as given", the order the surface handed over.
    if (!column) {
      return arrange ? arrange(this.filteredRows, () => 0) : this.filteredRows;
    }
    const compare = gridRowComparator(column, this.sortDirection, this.options.rowKey);
    return arrange ? arrange(this.filteredRows, compare) : this.filteredRows.toSorted(compare);
  });

  /**
   * The rows in view — filtered, stably sorted, then grouped so pinned items lead in their own
   * arranged order. `pinnedCount` is where the grid draws the rule that separates the two.
   */
  rowGrouping = $derived.by((): GridRowGrouping<TRow> =>
    groupedGridRows(this.sortedRows, this.options.pinnedRowKeys?.() ?? [], this.options.rowKey),
  );

  rowsInView = $derived.by((): readonly TRow[] => this.rowGrouping.rows);
  /** How many leading rows are pinned; 0 when nothing is pinned and no rule renders. */
  pinnedRowCount = $derived.by((): number => this.rowGrouping.pinnedCount);

  /** The row's mark — the pin, a clipboard mark, a quieter voice — or undefined for a plain row. */
  markFor(row: TRow): GridRowMark | undefined {
    return this.options.rowMark?.(row);
  }

  /**
   * Whether this table marks rows at all. A table that CAN mark one keeps the mark's space in every
   * first cell, so marking a row lights a glyph and moves nothing; without that, the first pin
   * shifts the row's text by the glyph and its gap, and the reader sees the list twitch at the
   * moment they act on it. A table that never marks anything reserves nothing and is unchanged.
   */
  get marksRows(): boolean {
    return this.options.rowMark !== undefined;
  }

  rowKeysInView = $derived.by((): readonly string[] =>
    this.rowsInView.map((row) => this.options.rowKey(row)),
  );

  totalRowCount = $derived.by((): number => this.rows.length);
  rowsInViewCount = $derived.by((): number => this.rowsInView.length);

  activeFilterCount = $derived.by((): number => Object.keys(this.filters).length);
  activeFilterLabels = $derived.by((): string[] =>
    activeGridFilterLabels(this.columns, this.filters),
  );
  isFiltered = $derived.by((): boolean => this.activeFilterCount > 0);

  /** The rows the totals row sums: what is in view, minus rows the surface excludes (voids). */
  totalEligibleRows = $derived.by((): readonly TRow[] => {
    const includes = this.options.totalIncludes;
    return includes ? this.rowsInView.filter((row) => includes(row)) : this.rowsInView;
  });

  hasTotals = $derived.by((): boolean =>
    this.visibleColumns.some((column) => column.total === "sum"),
  );

  totalTextFor(column: GridColumn<TRow>): string {
    return gridColumnTotalText(column, this.totalEligibleRows);
  }

  // ---- sorting -------------------------------------------------------------------------------

  toggleSort(columnId: string): void {
    if (this.sortColumnId === columnId) {
      this.sortDirection = this.sortDirection === "ascending" ? "descending" : "ascending";
      return;
    }
    this.sortColumnId = columnId;
    this.sortDirection = defaultDirection(this.columnById(columnId));
  }

  /**
   * Put the table in an order, as `initialSort` does — including null for "as given".
   *
   * The seam for a surface whose rows change their MEANING under it: the directory lists its book in
   * name order and answers a query in the firm's relevance order, and the order has to follow the
   * question rather than the reader's last click. Not a way to sort on the reader's behalf between
   * times; that is `toggleSort`, which is the header.
   */
  setSort(columnId: string | null, direction?: GridSortDirection): void {
    const column = columnId === null ? undefined : this.columnById(columnId);
    this.sortColumnId = column?.id ?? null;
    this.sortDirection = direction ?? defaultDirection(column);
  }

  // ---- filtering -----------------------------------------------------------------------------

  filterFor(columnId: string): GridColumnFilter | undefined {
    return this.filters[columnId];
  }

  setFilter(columnId: string, filter: GridColumnFilter | undefined): void {
    const column = this.columnById(columnId);
    const universeSize =
      column && filter?.kind === "set" ? gridSetFilterCounts(column, this.rows).size : undefined;
    this.filters = gridFiltersAfterChange(this.filters, columnId, filter, universeSize);
  }

  clearFilter(columnId: string): void {
    this.filters = gridFiltersAfterChange(this.filters, columnId, undefined);
  }

  clearAllFilters(): void {
    this.filters = {};
  }

  /** The set filter's stable universe with counts, over ALL rows (never the filtered view). */
  setFilterCounts(columnId: string): Map<string, number> {
    const column = this.columnById(columnId);
    return column ? gridSetFilterCounts(column, this.rows) : new Map();
  }

  // ---- column layout -----------------------------------------------------------------

  setColumnVisible(columnId: string, visible: boolean): void {
    const column = this.columnById(columnId);
    if (!column || column.anchored) return;
    const next = new Set(this.hiddenColumnIds);
    if (visible) next.delete(columnId);
    else next.add(columnId);
    this.hiddenColumnIds = next;
  }

  isColumnVisible(columnId: string): boolean {
    const column = this.columnById(columnId);
    return column?.anchored === true || !this.hiddenColumnIds.has(columnId);
  }

  togglePinned(columnId: string): void {
    // A trailing-pinned column is already stuck to its own edge — the leading pin leaves it alone.
    if (this.columnById(columnId)?.pinnedEnd === true) return;
    const next = new Set(this.pinnedColumnIds);
    if (next.has(columnId)) next.delete(columnId);
    else next.add(columnId);
    this.pinnedColumnIds = next;
  }

  isPinned(columnId: string): boolean {
    return this.pinnedColumnIds.has(columnId);
  }

  moveColumn(fromId: string, toId: string, after: boolean): void {
    this.columnOrder = movedGridColumnOrder(this.columns, this.columnOrder, fromId, toId, after);
  }

  /** The first resize fixes the layout at the widths measured from the rendered header. */
  snapshotColumnWidths(measured: Readonly<Record<string, number>>): void {
    if (this.columnWidthsFixed) return;
    this.columnWidths = { ...measured };
    this.columnWidthsFixed = true;
  }

  setColumnWidth(columnId: string, width: number): void {
    this.columnWidths = { ...this.columnWidths, [columnId]: Math.max(48, Math.round(width)) };
  }

  columnWidthOf(columnId: string): number | undefined {
    return this.columnWidthsFixed ? this.columnWidths[columnId] : undefined;
  }

  // ---- selection -----------------------------------------------------------------------------

  selectedKeys = $derived.by((): readonly string[] => this.selection.keys);

  selectedRows = $derived.by((): readonly TRow[] => {
    const selected = new Set(this.selection.keys);
    return this.rowsInView.filter((row) => selected.has(this.options.rowKey(row)));
  });

  isSelected(key: string): boolean {
    return this.selection.keys.includes(key);
  }

  private applySelection(next: GridSelection): void {
    this.selection = next;
    this.options.onSelectionChange?.(next.keys, this.selectedRows);
  }

  rowClick(key: string, modifiers: GridClickModifiers = {}): void {
    this.applySelection(
      gridSelectionAfterRowClick(this.rowKeysInView, this.selection, key, modifiers),
    );
  }

  arrow(step: -1 | 1, shift: boolean): void {
    this.applySelection(gridSelectionAfterArrow(this.rowKeysInView, this.selection, step, shift));
  }

  selectAll(): void {
    this.applySelection(gridSelectionOfAll(this.rowKeysInView));
  }

  clearSelection(): void {
    if (this.selection.keys.length === 0 && this.selection.anchor === null) return;
    this.applySelection(emptyGridSelection());
  }

  /** Double-click / Enter — activation is its own event, never a selection side effect. */
  activate(key: string): void {
    const row = this.rowsInView.find((candidate) => this.options.rowKey(candidate) === key);
    if (row !== undefined) this.options.onActivate?.(row);
  }
}

export function createDataTableGrid<TRow>(
  options: DataTableGridOptions<TRow>,
): DataTableGridState<TRow> {
  return new DataTableGridState(options);
}
