<script lang="ts" generics="TRow">
  /*
   * DataTable.GridColumnsMenu — the grid's columns control: a checkbox row per column (an
   * anchored column shows checked and disabled — it always shows), each row carrying the pin
   * toggle at its end (sticky under horizontal scroll), and the display settings beneath a
   * hairline (zebra striping). Place it wherever the surface's chrome puts its controls (the tabs
   * row, a toolbar) — it drives the same shared grid state as the table.
   *
   * The pin is ONE glyph everywhere the pin state shows — pinned rows and pinned columns alike —
   * and FILL is the only difference between pinned and not. A second geometry (the crossed-out
   * pin) reads as a different thing and was the settled defect here.
   */
  import type { Snippet } from "svelte";
  import Columns3 from "@lucide/svelte/icons/columns-3";
  import Pin from "@lucide/svelte/icons/pin";
  import * as Popover from "../popover/index.ts";
  import Checkbox from "../checkbox/index.ts";
  import type { DataTableGridState } from "./data-table-grid-state.svelte.ts";

  type Props = {
    grid: DataTableGridState<TRow>;
    /** The trigger's label. */
    label?: string;
    /**
     * Renders the trigger as a quiet icon button instead of the labelled secondary button, for
     * toolbars whose controls are all glyphs (the file manager's) — a lone labelled box among
     * icon buttons reads as a different kind of control.
     */
    iconOnly?: boolean;
    /**
     * The surface's own display settings, rendered under the shared ones so a surface's toggles
     * (hide extensions, sidebar counts) live in the same menu as the columns they sit beside.
     */
    settings?: Snippet;
  };
  let { grid, label = "Columns", iconOnly = false, settings }: Props = $props();
</script>

<Popover.Root>
  <Popover.Trigger
    class={iconOnly
      ? "mc-button mc-button-ghost mc-button-icon"
      : "mc-button mc-button-secondary mc-button-sm"}
    title="Choose columns"
    aria-label={iconOnly ? label : undefined}
  >
    <Columns3 class="mc-table-toolbar-icon" aria-hidden="true" />
    {#if !iconOnly}{label}{/if}
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
          aria-pressed={column.pinnedEnd === true || grid.isPinned(column.id)}
          disabled={column.pinnedEnd === true}
          title={column.pinnedEnd === true
            ? `${column.label} always keeps its place at the trailing edge`
            : grid.isPinned(column.id)
              ? `Unpin: ${column.label} scrolls with the rest again`
              : `Pin ${column.label} so it keeps its place when the list scrolls sideways`}
          onclick={(event) => {
            // Inside the label: the pin must not toggle the visibility checkbox.
            event.preventDefault();
            grid.togglePinned(column.id);
          }}
        >
          <Pin
            class="mc-table-grid-pin-icon"
            aria-hidden="true"
            fill={column.pinnedEnd === true || grid.isPinned(column.id) ? "currentColor" : "none"}
          />
        </button>
      </label>
    {/each}
    <div class="mc-table-grid-columns-rule"></div>
    <label class="mc-table-grid-columns-option">
      <Checkbox bind:checked={grid.zebra} aria-label="Shade alternate rows" />
      <span>Shade alternate rows</span>
    </label>
    {#if settings}
      {@render settings()}
    {/if}
  </Popover.Content>
</Popover.Root>
