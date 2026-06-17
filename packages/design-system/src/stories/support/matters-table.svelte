<script lang="ts" generics="TData">
  /*
   * Story support: a worked composition of the DataTable adapter — NOT part of the design-system API.
   * It shows how a consumer wires @tanstack/table-core through createSvelteTable: sorting state, row
   * selection, and column visibility live in local runes; the styled primitives render the result.
   * Reused by the showcase / empty / loading stories so the composition is written once.
   */
  import type { ColumnDef, RowSelectionState, SortingState, VisibilityState } from "@tanstack/table-core";
  import { getCoreRowModel, getSortedRowModel } from "@tanstack/table-core";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
  import * as DataTable from "../../lib/components/data-table/index.ts";
  import { createSvelteTable, FlexRender } from "../../lib/components/data-table/index.ts";
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

  const table = createSvelteTable({
    get data() {
      return data;
    },
    get columns() {
      return columns;
    },
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
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const ariaSort = (state: false | "asc" | "desc") =>
    state === "asc" ? "ascending" : state === "desc" ? "descending" : "none";

  // Selection column + the visible data columns span the empty/loading placeholder rows.
  const spanCount = $derived(table.getVisibleLeafColumns().length + 1);
</script>

<div class="flex flex-col gap-12">
  <!-- Column-visibility toggles — one per hideable column. -->
  <fieldset class="flex flex-wrap items-center gap-12">
    <legend class="mc-table-toolbar-legend">Columns</legend>
    {#each table.getAllLeafColumns().filter((column) => column.getCanHide()) as column (column.id)}
      <label class="flex items-center gap-4">
        <Checkbox
          checked={column.getIsVisible()}
          onCheckedChange={(value) => column.toggleVisibility(value === true)}
          aria-label="Toggle {column.id} column"
        />
        <span class="mc-table-toolbar-label">{column.id}</span>
      </label>
    {/each}
  </fieldset>

  <DataTable.Root>
    <DataTable.Caption class="sr-only">{caption}</DataTable.Caption>
    <DataTable.Header>
      {#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
        <DataTable.Row>
          <DataTable.Head>
            <Checkbox
              checked={table.getIsAllRowsSelected()}
              indeterminate={table.getIsSomeRowsSelected()}
              onCheckedChange={(value) => table.toggleAllRowsSelected(value === true)}
              aria-label="Select all rows"
            />
          </DataTable.Head>
          {#each headerGroup.headers as header (header.id)}
            <DataTable.Head
              aria-sort={header.column.getCanSort() ? ariaSort(header.column.getIsSorted()) : undefined}
            >
              {#if !header.isPlaceholder}
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
              {/if}
            </DataTable.Head>
          {/each}
        </DataTable.Row>
      {/each}
    </DataTable.Header>
    <DataTable.Body>
      {#if loading}
        {#each Array.from({ length: skeletonRows }, (_, index) => index) as rowIndex (rowIndex)}
          <DataTable.Row>
            <DataTable.Cell><Skeleton class="mc-table-skeleton w-full" /></DataTable.Cell>
            {#each table.getVisibleLeafColumns() as column (column.id)}
              <DataTable.Cell><Skeleton class="mc-table-skeleton w-full" /></DataTable.Cell>
            {/each}
          </DataTable.Row>
        {/each}
      {:else if table.getRowModel().rows.length === 0}
        <DataTable.Row>
          <DataTable.Cell colspan={spanCount} class="mc-table-empty">No matters found.</DataTable.Cell>
        </DataTable.Row>
      {:else}
        {#each table.getRowModel().rows as row (row.id)}
          <DataTable.Row data-state={row.getIsSelected() ? "selected" : undefined}>
            <DataTable.Cell>
              <Checkbox
                checked={row.getIsSelected()}
                onCheckedChange={(value) => row.toggleSelected(value === true)}
                aria-label="Select row"
              />
            </DataTable.Cell>
            {#each row.getVisibleCells() as cell (cell.id)}
              <DataTable.Cell>
                <FlexRender content={cell.column.columnDef.cell} context={cell.getContext()} />
              </DataTable.Cell>
            {/each}
          </DataTable.Row>
        {/each}
      {/if}
    </DataTable.Body>
  </DataTable.Root>
</div>
