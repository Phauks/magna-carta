<script lang="ts" generics="TRow">
  /*
   * DataTable.GridColumnsMenu — the grid's columns control: a checkbox row per column (an
   * anchored column shows checked and disabled — it always shows), each row carrying the pin
   * toggle at its end (filled pin while pinned, sticky under horizontal scroll), and the display
   * settings beneath a hairline (zebra striping). Place it wherever the surface's chrome puts its
   * controls (the tabs row, a toolbar) — it drives the same shared grid state as the table.
   */
  import Columns3 from "@lucide/svelte/icons/columns-3";
  import Pin from "@lucide/svelte/icons/pin";
  import PinOff from "@lucide/svelte/icons/pin-off";
  import * as Popover from "../popover/index.ts";
  import Checkbox from "../checkbox/index.ts";
  import type { DataTableGridState } from "./data-table-grid-state.svelte.ts";

  type Props = {
    grid: DataTableGridState<TRow>;
    /** The trigger's label. */
    label?: string;
  };
  let { grid, label = "Columns" }: Props = $props();
</script>

<Popover.Root>
  <Popover.Trigger class="mc-button mc-button-secondary mc-button-sm" title="Choose columns">
    <Columns3 class="mc-table-toolbar-icon" aria-hidden="true" />
    {label}
  </Popover.Trigger>
  <Popover.Content align="end" class="mc-table-grid-columns">
    <p class="mc-table-filter-heading">Columns</p>
    {#each grid.columns as column (column.id)}
      <label class="mc-table-grid-columns-option">
        <Checkbox
          disabled={column.anchored}
          title={column.anchored ? `${column.label} always shows` : undefined}
          bind:checked={
            () => grid.isColumnVisible(column.id),
            (checked) => grid.setColumnVisible(column.id, checked)
          }
          aria-label={column.label}
        />
        <span>{column.label}</span>
        <button
          type="button"
          class="mc-table-grid-pin"
          aria-pressed={grid.isPinned(column.id)}
          title={grid.isPinned(column.id)
            ? `Unpin: ${column.label} scrolls with the rest again`
            : `Pin ${column.label} so it keeps its place when the list scrolls sideways`}
          onclick={(event) => {
            // Inside the label: the pin must not toggle the visibility checkbox.
            event.preventDefault();
            grid.togglePinned(column.id);
          }}
        >
          {#if grid.isPinned(column.id)}
            <Pin class="mc-table-grid-pin-icon" aria-hidden="true" fill="currentColor" />
          {:else}
            <PinOff class="mc-table-grid-pin-icon" aria-hidden="true" />
          {/if}
        </button>
      </label>
    {/each}
    <div class="mc-table-grid-columns-rule"></div>
    <label class="mc-table-grid-columns-option">
      <Checkbox bind:checked={grid.zebra} aria-label="Shade alternate rows" />
      <span>Shade alternate rows</span>
    </label>
  </Popover.Content>
</Popover.Root>
