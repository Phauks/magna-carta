<script lang="ts" generics="TData">
  /*
   * DataTable.ViewMenu — the table's View/Settings control: a dropdown that holds both column
   * visibility (a checkbox per hideable column) AND appearance (zebra striping, column dividers, and
   * density). Composable — it takes the shared table instance plus a bindable `appearance` object the
   * consumer also feeds to the table as data-attributes (data-zebra / data-dividers / data-density).
   */
  import type { Table } from "@tanstack/table-core";
  import Settings from "@lucide/svelte/icons/settings-2";
  import * as DropdownMenu from "../dropdown-menu/index.ts";
  import { columnLabel } from "./typed-columns.ts";
  import type { TableAppearance, TableDensity } from "./appearance.ts";

  type Props = {
    table: Table<TData>;
    appearance: TableAppearance;
    label?: string;
  };
  let { table, appearance = $bindable(), label = "View" }: Props = $props();
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger class="mc-button mc-button-secondary mc-button-md">
    <Settings class="mc-table-toolbar-icon" aria-hidden="true" />
    {label}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end">
    <DropdownMenu.Group>
      <DropdownMenu.GroupHeading>Columns</DropdownMenu.GroupHeading>
      {#each table.getAllLeafColumns().filter((column) => column.getCanHide()) as column (column.id)}
        <DropdownMenu.CheckboxItem
          checked={column.getIsVisible()}
          onCheckedChange={(value) => column.toggleVisibility(value === true)}
        >
          {columnLabel(column)}
        </DropdownMenu.CheckboxItem>
      {/each}
    </DropdownMenu.Group>

    <DropdownMenu.Separator />
    <DropdownMenu.Group>
      <DropdownMenu.GroupHeading>Appearance</DropdownMenu.GroupHeading>
      <DropdownMenu.CheckboxItem
        checked={appearance.zebra}
        onCheckedChange={(value) => (appearance.zebra = value === true)}
      >
        Zebra stripes
      </DropdownMenu.CheckboxItem>
      <DropdownMenu.CheckboxItem
        checked={appearance.dividers}
        onCheckedChange={(value) => (appearance.dividers = value === true)}
      >
        Column dividers
      </DropdownMenu.CheckboxItem>
    </DropdownMenu.Group>

    <DropdownMenu.Separator />
    <DropdownMenu.RadioGroup
      value={appearance.density}
      onValueChange={(value) => (appearance.density = value as TableDensity)}
    >
      <DropdownMenu.GroupHeading>Density</DropdownMenu.GroupHeading>
      <DropdownMenu.RadioItem value="comfortable">Comfortable</DropdownMenu.RadioItem>
      <DropdownMenu.RadioItem value="compact">Compact</DropdownMenu.RadioItem>
    </DropdownMenu.RadioGroup>
  </DropdownMenu.Content>
</DropdownMenu.Root>
