/*
 * DataTable (Tier 4) — a THIN adapter over @tanstack/table-core, not a monolith. Two layers:
 *
 *   1. The styled <table> primitives (Table/Header/Body/Row/Head/Cell/Caption) — the mc-table-*
 *      recipes, presentation only. The dual export (bare names + Table-prefixed aliases) is the house
 *      namespace shape: `import * as DataTable` then <DataTable.Root>, or { Table, TableRow }.
 *   2. The headless wiring — `createSvelteTable` (reactive table-core bridge) plus `FlexRender` and
 *      `renderComponent`/`renderSnippet` for component/snippet cells. The consumer owns the column
 *      definitions and which row models to enable (sorting, selection, visibility, …); the table is
 *      composed at the call site (the stories show the full sortable/selectable/hideable shape).
 *
 * Keeping the table-core API the contract is deliberate: it is the single seam to the official
 * @tanstack/svelte-table v9 adapter when that stabilises.
 */
import Root from "./table.svelte";
import Grid from "./data-table-grid.svelte";
import GridFooter from "./data-table-grid-footer.svelte";
import GridFigures from "./data-table-grid-figures.svelte";
import ClearFilters from "./data-table-clear-filters.svelte";
import LoadMore from "./data-table-load-more.svelte";
import Header from "./table-header.svelte";
import Body from "./table-body.svelte";
import EmptyRow from "./data-table-empty-row.svelte";
import Row from "./table-row.svelte";
import Head from "./table-head.svelte";
import Cell from "./table-cell.svelte";
import Caption from "./table-caption.svelte";
import FlexRender from "./flex-render.svelte";
import Search from "./data-table-search.svelte";
import ViewMenu from "./data-table-view-menu.svelte";
import GroupByMenu from "./data-table-group-by-menu.svelte";
import ColumnFilter from "./data-table-column-filter.svelte";

export { createSvelteTable } from "./data-table.svelte.ts";
export type { GridFigure, GridFigureScope } from "./grid-figures.ts";
// The one-table composition (DataTable.Grid) — the declarative column model and its state engine.
export {
  createDataTableGrid,
  DataTableGridState,
  type DataTableGridOptions,
  type GridItemNoun,
} from "./data-table-grid-state.svelte.ts";
export {
  type GridCellContext,
  type GridColumn,
  type GridColumnFilterKind,
  type GridColumnType,
  type GridColumnValue,
  type GridSortDirection,
  compareGridRows,
  gridCellText,
  gridColumnAlign,
  gridColumnSum,
  gridColumnTotalText,
  gridRowComparator,
  movedGridColumnOrder,
  sortGridRows,
  visibleGridColumns,
} from "./grid-columns.ts";
export {
  type GridColumnFilter,
  type GridFilters,
  activeGridFilterLabels,
  gridColumnFilterKind,
  gridFilterSummary,
  gridFiltersAfterChange,
  gridSetFilterCounts,
  rowPassesGridColumnFilter,
  rowPassesGridFilters,
} from "./grid-filters.ts";
export {
  type GridGrouping,
  type GridRowBand,
  type GridRowGrouping,
  type GridRowMark,
  bandedGridRows,
  gridRowMarkAttributes,
  groupedGridRows,
} from "./grid-rows.ts";
export {
  type GridClickModifiers,
  type GridSelection,
  emptyGridSelection,
  gridSelectionAfterArrow,
  gridSelectionAfterRowClick,
  gridSelectionOfAll,
  gridSelectionRetained,
} from "./grid-selection.ts";
export { renderComponent, renderSnippet } from "./render-helpers.ts";
export {
  type ColumnValueType,
  type ColumnFilterKind,
  formatDate,
  formatMoney,
  formatNumber,
  typedCell,
  typedGlobalFilterFn,
  columnAlign,
  columnLabel,
  columnFilterKind,
  dateRangeFilterFn,
  facetFilterFn,
} from "./typed-columns.ts";
export {
  type FacetSelection,
  isAllFacetsSelected,
  isSomeFacetsSelected,
  isFacetSelected,
  facetSelectionAfterToggle,
  facetSelectionAfterToggleAll,
} from "./facet-selection.ts";
export {
  type DateRangePreset,
  type DateRangePresetId,
  DATE_RANGE_PRESETS,
  presetFilterValue,
  activeDateRangePresetId,
} from "./date-range-presets.ts";
export {
  type TableAppearance,
  type TableDensity,
  defaultTableAppearance,
  appearanceAttributes,
} from "./appearance.ts";

export {
  Root,
  Grid,
  GridFooter,
  GridFigures,
  ClearFilters,
  LoadMore,
  Header,
  Body,
  EmptyRow,
  Row,
  Head,
  Cell,
  Caption,
  FlexRender,
  Search,
  ViewMenu,
  GroupByMenu,
  ColumnFilter,
  //
  Root as Table,
  Grid as DataTableGrid,
  GridFooter as DataTableGridFooter,
  GridFigures as DataTableGridFigures,
  ClearFilters as DataTableClearFilters,
  LoadMore as DataTableLoadMore,
  Header as TableHeader,
  Body as TableBody,
  EmptyRow as TableEmptyRow,
  Row as TableRow,
  Head as TableHead,
  Cell as TableCell,
  Caption as TableCaption,
  Search as TableSearch,
  ViewMenu as TableViewMenu,
  GroupByMenu as TableGroupByMenu,
  ColumnFilter as TableColumnFilter,
};
