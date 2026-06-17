<script lang="ts" generics="TData">
  /*
   * DataTable.ColumnMenu — the "show/hide columns" control: a dropdown of checkbox items, one per
   * hideable column, driving `column.toggleVisibility` on the shared table instance. Replaces a row
   * of bare checkboxes with the toolbar control the List/Index archetype calls for. Composable — pass
   * it the table instance.
   */
  import type { Table } from "@tanstack/table-core";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import * as DropdownMenu from "../dropdown-menu/index.ts";
  import { columnLabel } from "./typed-columns.ts";

  type Props = {
    table: Table<TData>;
    label?: string;
  };
  let { table, label = "Columns" }: Props = $props();
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger class="mc-button mc-button-secondary mc-button-md">
    <SlidersHorizontal class="mc-table-toolbar-icon" aria-hidden="true" />
    {label}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end">
    {#each table.getAllLeafColumns().filter((column) => column.getCanHide()) as column (column.id)}
      <DropdownMenu.CheckboxItem
        checked={column.getIsVisible()}
        onCheckedChange={(value) => column.toggleVisibility(value === true)}
      >
        {columnLabel(column)}
      </DropdownMenu.CheckboxItem>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
