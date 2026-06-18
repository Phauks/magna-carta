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
import Header from "./table-header.svelte";
import Body from "./table-body.svelte";
import Row from "./table-row.svelte";
import Head from "./table-head.svelte";
import Cell from "./table-cell.svelte";
import Caption from "./table-caption.svelte";
import FlexRender from "./flex-render.svelte";
import Search from "./data-table-search.svelte";
import ViewMenu from "./data-table-view-menu.svelte";
import ColumnFilter from "./data-table-column-filter.svelte";

export { createSvelteTable } from "./data-table.svelte.ts";
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
  Header,
  Body,
  Row,
  Head,
  Cell,
  Caption,
  FlexRender,
  Search,
  ViewMenu,
  ColumnFilter,
  //
  Root as Table,
  Header as TableHeader,
  Body as TableBody,
  Row as TableRow,
  Head as TableHead,
  Cell as TableCell,
  Caption as TableCaption,
  Search as TableSearch,
  ViewMenu as TableViewMenu,
  ColumnFilter as TableColumnFilter,
};
