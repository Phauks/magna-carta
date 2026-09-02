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
     * The surface's own display settings, rendered under the shared ones so a surface's toggles
     * (hide extensions, sidebar counts) live in the same menu as the columns they sit beside.
     * Render them as ContextMenu.CheckboxItem rows so the whole menu keeps one keyboard model.
     */
    settings?: Snippet;
  };
  let { grid, column, settings }: Props = $props();

  const pinned = $derived(grid.isPinned(column.id));
  const anchored = $derived(column.anchored === true);
  /** Declared by the column model to sit at the trailing edge; no member gesture moves it. */
  const heldAtTheEnd = $derived(column.pinnedEnd === true);
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
  <ContextMenu.Item
    disabled={anchored}
    title={anchored ? `${column.label} always shows` : `Stop showing the ${column.label} column`}
    onSelect={() => grid.setColumnVisible(column.id, false)}
  >
    <EyeOff class="mc-table-grid-head-menu-icon" aria-hidden="true" />
    Hide {column.label}
  </ContextMenu.Item>
  <!--
    A TRAILING-PINNED COLUMN IS NOT THE MEMBER'S TO MOVE. Its place at the end edge is declared by
    the column model — the row's own verbs are pinned there so the list can scroll sideways without
    taking them out of reach — so the item states that and refuses, rather than offering an unpin
    that the model would immediately overrule.
  -->
  <ContextMenu.Item
    disabled={heldAtTheEnd}
    title={heldAtTheEnd
      ? `${column.label} always keeps its place at the trailing edge`
      : pinned
        ? `Unpin: ${column.label} scrolls with the rest again`
        : `Pin ${column.label} so it keeps its place when the list scrolls sideways`}
    onSelect={() => grid.togglePinned(column.id)}
  >
    <Pin
      class="mc-table-grid-head-menu-icon"
      aria-hidden="true"
      fill={pinned || heldAtTheEnd ? "currentColor" : "none"}
    />
    {heldAtTheEnd ? "Pinned" : pinned ? "Unpin" : "Pin"}
    {column.label}
  </ContextMenu.Item>
  <ContextMenu.Separator />
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
      <ContextMenu.Separator />
      <ContextMenu.CheckboxItem bind:checked={grid.zebra}>
        Shade alternate rows
      </ContextMenu.CheckboxItem>
      {#if settings}
        {@render settings()}
      {/if}
    </ContextMenu.SubContent>
  </ContextMenu.Sub>
</ContextMenu.Content>
