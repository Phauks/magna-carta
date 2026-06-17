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

export { createSvelteTable } from "./data-table.svelte.ts";
export { renderComponent, renderSnippet } from "./render-helpers.ts";

export {
  Root,
  Header,
  Body,
  Row,
  Head,
  Cell,
  Caption,
  FlexRender,
  //
  Root as Table,
  Header as TableHeader,
  Body as TableBody,
  Row as TableRow,
  Head as TableHead,
  Cell as TableCell,
  Caption as TableCaption,
};
