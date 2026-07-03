<script lang="ts" generics="TData">
  /*
   * DataTable.Search — the global-filter box. Composable: it takes the shared table instance and
   * drives its global filter, so it sits in a toolbar above the table rather than being baked in.
   * Requires the table to have a filtered row model (`getFilteredRowModel()`); table-core's default
   * global filter substring-matches across the visible columns.
   */
  import type { Table } from "@tanstack/table-core";
  import Input from "../input/index.ts";

  type Props = {
    table: Table<TData>;
    placeholder?: string;
    class?: string;
  };
  let { table, placeholder = "Search…", class: className }: Props = $props();
</script>

<Input
  type="search"
  {placeholder}
  class={className}
  aria-label="Search table"
  value={(table.getState().globalFilter ?? "") as string}
  oninput={(event) => table.setGlobalFilter(event.currentTarget.value)}
/>
