<script lang="ts" generics="TRow">
  /*
   * DataTable.GridColumnsContextMenu — the grid's columns control, reached by right-clicking the
   * list instead of by finding a button in the surface's chrome.
   *
   * IT IS THE SAME STATE AS THE BUTTON, NOT A SECOND ONE. Both drive `DataTableGridState`, so a
   * column hidden here is hidden there, and a surface may offer either, both, or neither without
   * anything to keep in step. The button (`GridColumnsMenu`) remains for the registers that place a
   * labelled control in a toolbar; this is for the ones whose gesture is the right-click the rest of
   * this product already teaches — the file manager's actions, the folder tree's, the row menus'.
   *
   * IT WRAPS THE REGISTER, NOT THE HEADER. A menu per header cell is one floating surface per column
   * for a menu whose contents never change, and the reader's gesture is "right-click the list", not
   * "find the exact strip of pixels the labels sit in". Where a surface also wants row actions, it
   * composes its own context menu instead of this one and reads the columns control off the same
   * grid state — two menus over one region would race for the same gesture.
   *
   * The pin is ONE glyph everywhere the pin state shows, and FILL is the only difference between
   * pinned and not — the same rule the button's menu follows, for the same reason.
   */
  import type { Snippet } from "svelte";
  import Pin from "@lucide/svelte/icons/pin";
  import * as ContextMenu from "../context-menu/index.ts";
  import type { DataTableGridState } from "./data-table-grid-state.svelte.ts";

  type Props = {
    grid: DataTableGridState<TRow>;
    /** The region the gesture belongs to — normally the table itself. */
    children: Snippet;
    /**
     * The surface's own display settings, rendered under the shared ones so a surface's toggles live
     * in the same menu as the columns they sit beside.
     */
    settings?: Snippet;
    class?: string;
  };
  let { grid, children, settings, class: className }: Props = $props();
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger class={className}>
    {@render children()}
  </ContextMenu.Trigger>
  <ContextMenu.Content>
    <!-- The same heading element the button's menu uses, not ContextMenu.GroupHeading: a heading
         outside a Group has no group to name, and Bits' own heading wants one. -->
    <p class="mc-table-filter-heading">Columns</p>
    {#each grid.columns as column (column.id)}
      <ContextMenu.CheckboxItem
        closeOnSelect={false}
        disabled={column.anchored}
        title={column.anchored ? `${column.label} always shows` : undefined}
        bind:checked={
          () => grid.isColumnVisible(column.id),
          (checked) => grid.setColumnVisible(column.id, checked)
        }
      >
        <!-- Layout is a utility on the element; the recipe layer owns visual design only. -->
        <span class="min-w-0 flex-1">{column.label}</span>
        <button
          type="button"
          class="mc-table-grid-pin"
          aria-pressed={grid.isPinned(column.id)}
          title={grid.isPinned(column.id)
            ? `Unpin: ${column.label} scrolls with the rest again`
            : `Pin ${column.label} so it keeps its place when the list scrolls sideways`}
          onclick={(event) => {
            // Inside the item: the pin must not also toggle the column's visibility.
            event.preventDefault();
            event.stopPropagation();
            grid.togglePinned(column.id);
          }}
        >
          <Pin
            class="mc-table-grid-pin-icon"
            aria-hidden="true"
            fill={grid.isPinned(column.id) ? "currentColor" : "none"}
          />
        </button>
      </ContextMenu.CheckboxItem>
    {/each}
    <ContextMenu.Separator />
    <ContextMenu.CheckboxItem closeOnSelect={false} bind:checked={grid.zebra}>
      Shade alternate rows
    </ContextMenu.CheckboxItem>
    {#if settings}
      {@render settings()}
    {/if}
  </ContextMenu.Content>
</ContextMenu.Root>
