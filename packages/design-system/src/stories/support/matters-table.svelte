<script lang="ts" generics="TData">
  /*
   * Story support: a worked composition of the DataTable adapter — NOT part of the design-system API.
   * Shows how a consumer wires @tanstack/table-core through createSvelteTable: a composable toolbar
   * (Search drives the global filter, ColumnMenu toggles visibility) over the SAME table instance;
   * typed columns (`defaultColumn.cell = typedCell`) format by their `meta.type` and right-align
   * numerics via `columnAlign`; row selection supports shift-click range select. Reused by the
   * showcase / empty / loading stories so the composition is written once.
   */
  import type {
    ColumnDef,
    ColumnFiltersState,
    RowSelectionState,
    SortingState,
    VisibilityState,
  } from "@tanstack/table-core";
  import {
    getCoreRowModel,
    getFacetedRowModel,
    getFacetedUniqueValues,
    getFilteredRowModel,
    getSortedRowModel,
  } from "@tanstack/table-core";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
  import * as DataTable from "../../lib/components/data-table/index.ts";
  import {
    appearanceAttributes,
    columnAlign,
    createSvelteTable,
    defaultTableAppearance,
    FlexRender,
    typedCell,
    typedGlobalFilterFn,
  } from "../../lib/components/data-table/index.ts";
  import Checkbox from "../../lib/components/checkbox/index.ts";
  import Skeleton from "../../lib/components/skeleton/index.ts";

  type Props = {
    data: TData[];
    columns: ColumnDef<TData>[];
    /** The table's accessible name (rendered as a visually-hidden caption). */
    caption?: string;
    /** Render skeleton rows instead of data — the deferred-load state. */
    loading?: boolean;
    /** How many skeleton rows to show while loading. */
    skeletonRows?: number;
  };
  let { data, columns, caption = "Matters", loading = false, skeletonRows = 8 }: Props = $props();

  let sorting = $state<SortingState>([]);
  let rowSelection = $state<RowSelectionState>({});
  let columnVisibility = $state<VisibilityState>({});
  let globalFilter = $state("");
  let columnFilters = $state<ColumnFiltersState>([]);
  let appearance = $state(defaultTableAppearance());

  const table = createSvelteTable({
    get data() {
      return data;
    },
    get columns() {
      return columns;
    },
    // Format every column by its meta.type unless it sets its own cell (the "set a value type" path).
    defaultColumn: { cell: typedCell },
    state: {
      get sorting() {
        return sorting;
      },
      get rowSelection() {
        return rowSelection;
      },
      get columnVisibility() {
        return columnVisibility;
      },
      get globalFilter() {
        return globalFilter;
      },
      get columnFilters() {
        return columnFilters;
      },
    },
    enableRowSelection: true,
    onSortingChange: (updater) => {
      sorting = updater instanceof Function ? updater(sorting) : updater;
    },
    onRowSelectionChange: (updater) => {
      rowSelection = updater instanceof Function ? updater(rowSelection) : updater;
    },
    onColumnVisibilityChange: (updater) => {
      columnVisibility = updater instanceof Function ? updater(columnVisibility) : updater;
    },
    onGlobalFilterChange: (updater) => {
      globalFilter = updater instanceof Function ? updater(globalFilter) : updater;
    },
    onColumnFiltersChange: (updater) => {
      columnFilters = updater instanceof Function ? updater(columnFilters) : updater;
    },
    // Search matches the FORMATTED value (so dates/money are searchable as shown), and every column
    // is included (table-core would otherwise skip the Date column).
    globalFilterFn: typedGlobalFilterFn,
    getColumnCanGlobalFilter: () => true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  const ariaSort = (state: false | "asc" | "desc") =>
    state === "asc" ? "ascending" : state === "desc" ? "descending" : "none";

  // Selection column + the visible data columns span the empty/loading placeholder rows.
  const spanCount = $derived(table.getVisibleLeafColumns().length + 1);


  // Shift-click range selection: an anchor row + the live shift-key state (tracked on the window, so
  // it does not depend on the event being forwarded through bits' checkbox). A shift-click extends the
  // selection from the anchor to the clicked row; a plain click sets a new anchor.
  let anchorRowId: string | null = null;
  let shiftHeld = false;
  // Driven directly from the table state (not the checkbox's change value, which can lag on rapid
  // clicks): a plain click flips the row and sets the anchor; a shift-click applies the ANCHOR's
  // current state to the whole span — so toggling a box off then shift-clicking deselects the range.
  function selectRow(rowId: string): void {
    const rows = table.getRowModel().rows;
    if (shiftHeld && anchorRowId) {
      const from = rows.findIndex((row) => row.id === anchorRowId);
      const to = rows.findIndex((row) => row.id === rowId);
      if (from !== -1 && to !== -1) {
        const target = rows[from]!.getIsSelected();
        const [low, high] = from < to ? [from, to] : [to, from];
        for (let index = low; index <= high; index += 1) rows[index]!.toggleSelected(target);
      }
    } else {
      rows.find((row) => row.id === rowId)?.toggleSelected();
      anchorRowId = rowId;
    }
  }
</script>


<svelte:window
  onkeydown={(event) => {
    if (event.key === "Shift") shiftHeld = true;
  }}
  onkeyup={(event) => {
    if (event.key === "Shift") shiftHeld = false;
  }}
/>

<div class="flex flex-col gap-12">
  <div class="mc-table-toolbar">
    <DataTable.Search {table} label="Search table" fieldClass="max-w-xs" />
    <DataTable.ViewMenu {table} bind:appearance />
  </div>

  <DataTable.Root {...appearanceAttributes(appearance)}>
    <DataTable.Caption class="sr-only">{caption}</DataTable.Caption>
    <DataTable.Header>
      {#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
        <DataTable.Row>
          <DataTable.Head>
            <Checkbox
              bind:checked={
                () => table.getIsAllRowsSelected(),
                (checked) => table.toggleAllRowsSelected(checked)
              }
              indeterminate={table.getIsSomeRowsSelected()}
              aria-label="Select all rows"
            />
          </DataTable.Head>
          {#each headerGroup.headers as header (header.id)}
            <DataTable.Head
              data-align={columnAlign(header.column) === "end" ? "end" : undefined}
              aria-sort={header.column.getCanSort() ? ariaSort(header.column.getIsSorted()) : undefined}
            >
              {#if !header.isPlaceholder}
                <div class="mc-table-head-inner">
                  {#if header.column.getCanSort()}
                    <button
                      type="button"
                      class="mc-table-sort"
                      onclick={header.column.getToggleSortingHandler()}
                    >
                      <FlexRender content={header.column.columnDef.header} context={header.getContext()} />
                      {#if header.column.getIsSorted() === "asc"}
                        <ArrowUp class="mc-table-sort-icon" aria-hidden="true" />
                      {:else if header.column.getIsSorted() === "desc"}
                        <ArrowDown class="mc-table-sort-icon" aria-hidden="true" />
                      {:else}
                        <ChevronsUpDown class="mc-table-sort-icon" aria-hidden="true" />
                      {/if}
                    </button>
                  {:else}
                    <FlexRender content={header.column.columnDef.header} context={header.getContext()} />
                  {/if}
                  <DataTable.ColumnFilter column={header.column} {table} />
                </div>
              {/if}
            </DataTable.Head>
          {/each}
        </DataTable.Row>
      {/each}
    </DataTable.Header>
    <DataTable.Body>
      {#if loading}
        {#each Array.from({ length: skeletonRows }, (_, index) => index) as rowIndex (rowIndex)}
          <DataTable.Row data-placeholder="true">
            <DataTable.Cell><Skeleton class="mc-table-skeleton w-full" /></DataTable.Cell>
            {#each table.getVisibleLeafColumns() as column (column.id)}
              <DataTable.Cell><Skeleton class="mc-table-skeleton w-full" /></DataTable.Cell>
            {/each}
          </DataTable.Row>
        {/each}
      {:else if table.getRowModel().rows.length === 0}
        <DataTable.EmptyRow columns={spanCount} title="No matters found." />
      {:else}
        {#each table.getRowModel().rows as row (row.id)}
          <DataTable.Row data-state={row.getIsSelected() ? "selected" : undefined}>
            <DataTable.Cell>
              <Checkbox
                bind:checked={() => row.getIsSelected(), () => selectRow(row.id)}
                aria-label="Select row"
              />
            </DataTable.Cell>
            {#each row.getVisibleCells() as cell (cell.id)}
              <DataTable.Cell data-align={columnAlign(cell.column) === "end" ? "end" : undefined}>
                <FlexRender content={cell.column.columnDef.cell} context={cell.getContext()} />
              </DataTable.Cell>
            {/each}
          </DataTable.Row>
        {/each}
      {/if}
    </DataTable.Body>
  </DataTable.Root>
</div>
