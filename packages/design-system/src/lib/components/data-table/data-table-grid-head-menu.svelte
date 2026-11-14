<script lang="ts" generics="TRow">
  /*
   * DataTable.GridHeadMenu — the menu a column header opens on right-click, and the ONE home of the
   * column controls. There is no columns button on any surface: the column a reader wants to change
   * is the one they are already pointing at, so its controls are summoned there.
   *
   * Everything a column can be ASKED is here: filtering it, hiding it, pinning it, and — one arrow
   * to the right — the full roster of columns, where a column that is currently hidden (and
   * therefore has no header to right-click) is brought back. What the header still does on its own
   * it does by direct gesture and carries no menu row: clicking the label sorts, the grip resizes
   * and double-click fits. The header cell shows only whether a filter is in play; it holds no
   * control of its own.
   *
   * The pin is ONE glyph everywhere the pin state shows — pinned rows and pinned columns alike —
   * and FILL is the only difference between pinned and not. A second geometry (the crossed-out
   * pin) reads as a different thing and was the settled defect here.
   */
  import type { Snippet } from "svelte";
  import Columns3 from "@lucide/svelte/icons/columns-3";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import Pin from "@lucide/svelte/icons/pin";
  import * as ContextMenu from "../context-menu/index.ts";
  import type { GridColumn } from "./grid-columns.ts";
  import type { DataTableGridState } from "./data-table-grid-state.svelte.ts";
  import { gridColumnFilterKind } from "./grid-filters.ts";
  import GridColumnFilter from "./data-table-grid-filter.svelte";

  type Props = {
    grid: DataTableGridState<TRow>;
    /** The column whose header was right-clicked — the leading items speak about this one. */
    column: GridColumn<TRow>;
    /**
     * The surface's own display settings, rendered in the menu's own root beside the shared ones so
     * a surface's toggles (hide extensions, sidebar counts) are reached in one gesture rather than
     * through a submenu that names something else. Render them as ContextMenu.CheckboxItem rows so
     * the whole menu keeps one keyboard model.
     */
    settings?: Snippet;
  };
  let { grid, column, settings }: Props = $props();

  // A trailing-pinned column is pinned by declaration, not by the reader: it holds its place at the end
  // edge and the grid refuses to toggle it (togglePinned returns early), so the menu shows the pin as
  // held rather than offering a control that would do nothing.
  const pinnedEnd = $derived(column.pinnedEnd === true);
  const pinned = $derived(pinnedEnd || grid.isPinned(column.id));
  const anchored = $derived(column.anchored === true);
  const shown = $derived(grid.isColumnVisible(column.id));
  // A column with nothing to filter on contributes no group, and so no rule above the next one.
  const filterable = $derived(gridColumnFilterKind(column) !== "none");
</script>

<ContextMenu.Content>
  <!-- What the column SHOWS, then what the column IS, then every column: three groups, in the
       order a reader asks them. -->
  <GridColumnFilter {grid} {column} />
  {#if filterable}
    <ContextMenu.Separator />
  {/if}
  {#if shown}
    <ContextMenu.Item
      disabled={anchored}
      title={anchored ? `${column.label} always shows` : `Stop showing the ${column.label} column`}
      onSelect={() => grid.setColumnVisible(column.id, false)}
    >
      <EyeOff class="mc-table-grid-head-menu-icon" aria-hidden="true" />
      Hide {column.label}
    </ContextMenu.Item>
  {:else}
    <!-- The menu outlives its own column: the roster below can hide it while the menu stays open,
         so the row turns round and brings it back. -->
    <ContextMenu.Item
      title={`Show the ${column.label} column again`}
      onSelect={() => grid.setColumnVisible(column.id, true)}
    >
      <Eye class="mc-table-grid-head-menu-icon" aria-hidden="true" />
      Show {column.label}
    </ContextMenu.Item>
  {/if}
  <ContextMenu.Item
    disabled={pinnedEnd}
    title={pinnedEnd
      ? `${column.label} always keeps its place at the trailing edge`
      : pinned
        ? `Unpin: ${column.label} scrolls with the rest again`
        : `Pin ${column.label} so it keeps its place when the list scrolls sideways`}
    onSelect={() => grid.togglePinned(column.id)}
  >
    <Pin
      class="mc-table-grid-head-menu-icon"
      aria-hidden="true"
      fill={pinned ? "currentColor" : "none"}
    />
    {pinned ? "Unpin" : "Pin"}
    {column.label}
  </ContextMenu.Item>
  <ContextMenu.Separator />
  <!-- COLUMNS HOLDS COLUMNS, AND NOTHING ELSE. The roster is what a submenu is for: one row per
       column, including the hidden ones that have no header left to right-click. How the table
       LOOKS is not a column, so it does not hide behind a trigger named after one — a setting
       filed under "Columns" is a setting nobody finds. -->
  <ContextMenu.Sub>
    <ContextMenu.SubTrigger>
      <Columns3 class="mc-table-grid-head-menu-icon" aria-hidden="true" />
      Columns
    </ContextMenu.SubTrigger>
    <ContextMenu.SubContent class="mc-table-grid-head-menu-columns mc-scrollbar">
      {#each grid.columns as rosterColumn (rosterColumn.id)}
        <ContextMenu.CheckboxItem
          disabled={rosterColumn.anchored === true}
          title={rosterColumn.anchored === true
            ? `${rosterColumn.label} always shows`
            : undefined}
          bind:checked={
            () => grid.isColumnVisible(rosterColumn.id),
            (checked) => grid.setColumnVisible(rosterColumn.id, checked)
          }
        >
          {rosterColumn.label}
        </ContextMenu.CheckboxItem>
      {/each}
    </ContextMenu.SubContent>
  </ContextMenu.Sub>
  <ContextMenu.Separator />
  <!-- The display settings, in the menu's ROOT: the table's own (shading), then whatever the
       surface adds. One gesture, in the menu a reader already has open. -->
  <ContextMenu.CheckboxItem bind:checked={grid.zebra}>
    Shade alternate rows
  </ContextMenu.CheckboxItem>
  {#if settings}
    {@render settings()}
  {/if}
</ContextMenu.Content>
