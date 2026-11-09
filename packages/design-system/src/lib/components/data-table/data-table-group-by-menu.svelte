<script lang="ts">
  /*
   * DataTable.GroupByMenu — the reader's choice of what a grouped list is grouped by. A trigger
   * that says the current grouping ("Group By  List") and a menu of the surface's options, one of
   * which may mean "no grouping". The surface owns what each option groups by (it hands the grid a
   * GridGrouping for the chosen value); this control only holds the choice, so every grouped list
   * offers the choice the same way.
   */
  import Rows3 from "@lucide/svelte/icons/rows-3";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import * as DropdownMenu from "../dropdown-menu/index.ts";

  type Option = { value: string; label: string };
  type Props = {
    /** The groupings on offer, in menu order. Include the "no grouping" option if there is one. */
    options: readonly Option[];
    /** The chosen option's value. */
    value: string;
    /** What the trigger calls the choice. */
    label?: string;
  };
  let { options, value = $bindable(), label = "Group By" }: Props = $props();

  const current = $derived(options.find((option) => option.value === value)?.label ?? "");
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger class="mc-button mc-button-secondary mc-button-md">
    <Rows3 class="mc-table-toolbar-icon" aria-hidden="true" />
    <span class="mc-table-group-by-label">{label}</span>
    <span class="mc-table-group-by-value">{current}</span>
    <ChevronDown class="mc-table-toolbar-icon" aria-hidden="true" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end">
    <DropdownMenu.RadioGroup {value} onValueChange={(next) => (value = next)}>
      {#each options as option (option.value)}
        <DropdownMenu.RadioItem value={option.value}>{option.label}</DropdownMenu.RadioItem>
      {/each}
    </DropdownMenu.RadioGroup>
  </DropdownMenu.Content>
</DropdownMenu.Root>
