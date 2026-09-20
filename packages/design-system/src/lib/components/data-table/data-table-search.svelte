<script lang="ts" generics="TData">
  /*
   * DataTable.Search — ScreenSearch with its `onsearch` already wired to a table's global filter,
   * for the common case where the rows are already in the browser. It is a PRESET, not a second
   * control: the appearance, the expand-and-collapse behaviour and the keyboard are the component's,
   * so a table inherits the shape rather than re-deciding it, and a screen that outgrows the preset
   * reaches for ScreenSearch directly without anything on screen changing.
   *
   * That is the whole design. The previous version of this file WAS the search box, bound so tightly
   * to `@tanstack/table-core` that a screen whose search ran on a server could not use it — and
   * every such screen went off and built its own. Keeping the table binding as a thin preset over
   * the shared control is what stops that happening again.
   *
   * Requires the table to have a filtered row model (`getFilteredRowModel()`); table-core's default
   * global filter substring-matches across the visible columns.
   */
  import type { Table } from "@tanstack/table-core";
  import ScreenSearch from "../screen-search/index.ts";
  import type { InputSize } from "../input/variants.ts";

  type Props = {
    table: Table<TData>;
    /** Accessible name for the control. Name the surface: "Search matters". */
    label?: string;
    /** Whether the field is showing. Bindable, so a screen can open the control itself. */
    expanded?: boolean;
    /** Control height, from the same scale the Button and Input use. */
    size?: InputSize;
    /** Disables the control so it cannot be expanded or typed into. */
    disabled?: boolean;
    /** Width utility for the expanded field. */
    fieldClass?: string;
    class?: string;
  };

  let {
    table,
    label = "Search this list",
    expanded = $bindable(false),
    size = "default",
    disabled = false,
    fieldClass,
    class: className,
  }: Props = $props();

  // The table's global filter is the single source of truth for the query, so a screen that clears
  // the filter elsewhere (a "clear all" action) empties the field with it.
  const query = $derived((table.getState().globalFilter ?? "") as string);
</script>

<ScreenSearch
  value={query}
  bind:expanded
  onsearch={(next) => table.setGlobalFilter(next)}
  searchOn="keystroke"
  {label}
  {size}
  {disabled}
  {fieldClass}
  class={className}
/>
