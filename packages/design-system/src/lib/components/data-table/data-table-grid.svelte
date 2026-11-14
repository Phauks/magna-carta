<script lang="ts" generics="TRow">
  /*
   * DataTable.Grid — the platform's ONE table (the settled cross-surface ruling: any behavior gap
   * between two tables is a defect by definition). Driven by the declarative column model
   * (grid-columns.ts) through a shared state object (createDataTableGrid), it carries the settled
   * machinery: type-aware stable sorting, the per-column filters, column show/hide,
   * drag-reorder (anchored columns lead), pinning at measured sticky offsets, resize grips with
   * double-click fit, the Docket's selection model (click / Ctrl / Shift / Ctrl+A scoped to the
   * table / arrows / click-empty-clears), activation as its own event, the scope-honest totals
   * row, the filtered-empty state that says why, and the row groups and row marks (pinned items
   * above a rule; the pin, clipboard and quiet marks) the state's grid-rows model defines.
   *
   * Rendering stays the consumer's: the `cell` snippet supplies each cell (status chips and the
   * like are the surface's business); without it, cells render the column model's typed text.
   * Selection is emitted, never presented — this component opens nothing.
   *
   * Every column control — filtering included — is summoned from the header itself (GridHeadMenu,
   * on right-click), never from a button on the surface or in the header cell. The cell shows only
   * whether a filter is in play; see that component for what the menu carries and why.
   */
  import type { Snippet } from "svelte";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Funnel from "@lucide/svelte/icons/funnel";
  import FunnelX from "@lucide/svelte/icons/funnel-x";
  import Pin from "@lucide/svelte/icons/pin";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import Button from "../button/index.ts";
  import Skeleton from "../skeleton/index.ts";
  import ScrollEdgeHint from "../scroll-edge-hint/index.ts";
  import * as ContextMenu from "../context-menu/index.ts";
  import type { GridBandFoot, GridCellContext, GridColumn } from "./grid-columns.ts";
  import { gridCellText, gridColumnAlign } from "./grid-columns.ts";
  import type { DataTableGridState } from "./data-table-grid-state.svelte.ts";
  import { gridFilterSummary } from "./grid-filters.ts";
  import { gridRowMarkAttributes } from "./grid-rows.ts";
  import GridHeadMenu from "./data-table-grid-head-menu.svelte";

  type Props = {
    grid: DataTableGridState<TRow>;
    /** The table's accessible name (the visually hidden caption + the scroll region's label). */
    caption: string;
    /** Renders each body cell; omit to render the column model's typed text. */
    cell?: Snippet<[GridCellContext<TRow>]>;
    /**
     * Renders a record's second line: a full-width row under the primary one, spanning every
     * scrolling column. The pair reads as ONE row of two lines — the hairline moves to the
     * second line, and hover, selection, and the stripe cover both. With a trailing-pinned
     * column the second line keeps an empty pinned cell so that column's hairline runs unbroken.
     */
    rowDetail?: Snippet<[TRow]>;
    /**
     * A line at the foot of every band — or once, after the last row, where the rows are not
     * banded — where a surface lets a record be written in place: the task list's "Add a task to
     * Litigation". At rest it is one cell across the table (`rest`); while `editing` answers true
     * for its band it is one cell per visible column (`cell`), so each answer is typed in the
     * column it will be read in. It is NOT a record: it carries no `data-grid-row`, takes no part in
     * selection, and the grid's own keys leave everything inside it alone. `bandKey` is null where
     * there are no bands.
     */
    bandFoot?: GridBandFoot<TRow>;
    /**
     * Renders what a band heading carries after its label and count, when the state groups rows
     * into bands — a muted date range, an action that applies to the band. Given the band's key.
     */
    bandDetail?: Snippet<[string]>;
    /** Placeholder rows stand in for data until it arrives. */
    loading?: boolean;
    placeholderCount?: number;
    /** Row density; compact trims the row height a step further. */
    density?: "comfortable" | "compact";
    /**
     * The reader's own scale for this list, as a plain multiplier — 1 is the design's own size, 1.5
     * is half again, 0.5 is half. It moves the four things a reader is actually asking about when
     * they scale a list: its text, its row height, the padding inside a row, and the glyphs that
     * ride in a row. It deliberately moves nothing else — not the hairlines, which blur when
     * scaled, and not the header band or the footer strip, which are the frame around the list
     * rather than the list, so growing them would push the rows off the bottom of the screen.
     *
     * Density is a separate axis and multiplies in: a compact row at 1.5 is a compact row, half
     * again as tall. Never derive one from the other — a scale offering ten steps that only flips a
     * two-value density has nine steps that do nothing.
     */
    scale?: number;
    /**
     * How the grid meets what is around it.
     *
     * `card` — the default — is the hairline, rounded table-card: the grid is a contained object on
     * the page, and its LAST ROW DROPS ITS HAIRLINE because the card's own bottom rule runs a
     * hairline below it and two lines a pixel apart read as a thick one.
     *
     * `flush` is edge to edge inside a frame the SURFACE already draws — a toolbar above, a footer
     * below. There is no card, so the table takes the frame's full height and the surface simply
     * continues beneath the last record; and the last record KEEPS its hairline, because there is
     * no bottom rule left for it to meet. Dropping it there left the last file in a list as the one
     * row with nothing under it while every other row was separated from its neighbour.
     */
    frame?: "card" | "flush";
    /** Right-click on a row: the selection re-targets first, then this fires for the surface's
     * menu. Rows carry no menu of their own here. */
    onRowContextMenu?: (event: MouseEvent, row: TRow, selectedRows: readonly TRow[]) => void;
    /**
     * The surface's own display settings, rendered in the header menu's Columns submenu beneath the
     * shared ones. ContextMenu.CheckboxItem rows, so the menu keeps one keyboard model throughout.
     */
    settings?: Snippet;
    class?: string;
  };
  let {
    grid,
    caption,
    cell,
    rowDetail,
    bandFoot,
    bandDetail,
    loading = false,
    placeholderCount = 8,
    density = "comfortable",
    scale = 1,
    frame = "card",
    onRowContextMenu,
    settings,
    class: className,
  }: Props = $props();

  let scrollElement = $state<HTMLDivElement | null>(null);
  let headElement = $state<HTMLTableSectionElement | null>(null);

  /*
   * THE HEADER'S HEIGHT, PUBLISHED TO CSS, so a band heading sticks directly beneath the sticky
   * header instead of sliding under it. Measured rather than assumed: the header grows with the
   * reader's scale and with a wrapped label, and a guessed offset leaves a gap or an overlap.
   */
  $effect(() => {
    const frame = scrollElement;
    const head = headElement;
    if (frame === null || head === null || grid.bands === null) return;
    const publish = (): void => {
      frame.style.setProperty("--mc-table-grid-head-block-size", `${String(head.offsetHeight)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(head);
    return () => {
      observer.disconnect();
    };
  });
  let headerCells = $state<Record<string, HTMLTableCellElement | null>>({});

  /** Each band by the index of its last row, for the foot line drawn under it. */
  const bandEnds = $derived.by(() => {
    const ends = new Map<number, { key: string; label: string }>();
    for (const [start, band] of grid.bandStarts) {
      ends.set(start + band.rows.length - 1, { key: band.key, label: band.label });
    }
    return ends;
  });

  /*
   * THE FRAME'S OWN WIDTH, PUBLISHED TO CSS.
   *
   * A placeholder row spans every column, so its cell is as wide as the TABLE — which is wider than
   * the frame the moment the columns are. Content centred in that cell centres in a box the reader
   * cannot see the far side of, so the empty state's watermark and heading sit off to the inline
   * end with the sentence trailing past them. Centring has to happen in the VISIBLE width, and the
   * only thing that knows the visible width is the scroll element.
   *
   * `clientWidth` rather than a container query: it excludes the scrollbar, and a container query's
   * `cqi` does not, which would put the empty state a scrollbar's width out and hand a table with
   * no rows a horizontal scrollbar of its own.
   */
  $effect(() => {
    const frame = scrollElement;
    if (frame === null) return;
    // Written on the NEXT frame, and only when the width actually changed. A style write inside the
    // observer's own callback is a layout change the observer then reports again, and under load
    // (the story suite, a filter field being typed into while rows come and go) that churn made the
    // focused filter field lose focus to its menu mid-word. Deferring the write breaks the loop, and
    // skipping an unchanged width means a resize that only moved rows writes nothing at all.
    let published = "";
    let scheduled = 0;
    const publish = (): void => {
      scheduled = 0;
      const next = `${String(frame.clientWidth)}px`;
      if (next === published) return;
      published = next;
      frame.style.setProperty("--mc-table-frame-inline-size", next);
    };
    publish();
    const observer = new ResizeObserver(() => {
      if (scheduled === 0) scheduled = requestAnimationFrame(publish);
    });
    observer.observe(frame);
    return () => {
      observer.disconnect();
      if (scheduled !== 0) cancelAnimationFrame(scheduled);
    };
  });

  const rowKeyOf = (row: TRow): string => grid.options.rowKey(row);
  /** The filter mark's tooltip, or undefined when no filter is in play and no mark is drawn. */
  const filterMarkTitle = (column: GridColumn<TRow>): string | undefined => {
    const filter = grid.filterFor(column.id);
    if (filter === undefined) return undefined;
    return `Filtered: ${gridFilterSummary(column, filter)}. Right-click the header to change or clear it`;
  };
  const ariaSortOf = (columnId: string): "ascending" | "descending" | "none" =>
    grid.sortColumnId === columnId ? grid.sortDirection : "none";

  // ---- pinning: sticky offsets measured from the rendered header ------------------------------
  // The anchored block joins the sticky set the moment anything is pinned, so the stuck columns
  // are contiguous from the leading edge (the Docket's ordering).
  const pinningActive = $derived(grid.pinnedColumnIds.size > 0);
  const stickyColumnIds = $derived.by((): readonly string[] => {
    if (!pinningActive) return [];
    return grid.visibleColumns
      .filter(
        (column) =>
          column.pinnedEnd !== true && (column.anchored || grid.pinnedColumnIds.has(column.id)),
      )
      .map((column) => column.id);
  });
  const stickyEdgeColumnId = $derived(stickyColumnIds.at(-1));
  // The trailing-pinned block is declared by the column model, not toggled: stuck to the end of
  // the scroll viewport, its FIRST member carrying the hairline that says "pinned, not floating".
  const pinnedEndColumns = $derived(
    grid.visibleColumns.filter((column) => column.pinnedEnd === true),
  );
  const pinnedEndEdgeColumnId = $derived(pinnedEndColumns[0]?.id);
  /*
   * Whether the totals strip is on screen. Asked once, because two things depend on the same
   * answer: the strip itself, and the filler row that holds it down at the bottom of the frame.
   * Two copies of this condition is how the filler starts appearing under a table with no totals.
   */
  const showTotals = $derived(grid.hasTotals && grid.rowsInView.length > 0 && !loading);
  /*
   * Whether the table asks for the frame's full height and hands the difference to the filler row.
   * Two reasons to, and they want the same machinery: a totals strip needs something below it to be
   * held down against, and a FLUSH grid needs the surface to continue past the last record rather
   * than the table ending mid-frame with bare page under it.
   */
  const fillsFrame = $derived(showTotals || frame === "flush");

  /*
   * The scale, written onto the table as the four lengths the recipe reads. The multiplication is
   * HERE and not in the recipe because a recipe is token references and structural keywords —
   * a gate says so (`components-css-token-purity`) — and `calc()` is neither. The recipe declares
   * each metric as the token it already was; this inline declaration outranks that when, and only
   * when, a surface has asked for a scale. At 1 there is no style at all, so a table nobody scales
   * carries no inline declaration to reason about.
   */
  const scaleStyle = $derived.by((): string | undefined => {
    if (scale === 1) return undefined;
    const times = (token: string): string => `calc(var(${token}) * ${String(scale)})`;
    return [
      `--mc-table-grid-font-size: ${times("--mc-font-size-sm")}`,
      `--mc-table-grid-row-height: ${times("--mc-control-sm")}`,
      `--mc-table-grid-row-height-compact: ${times("--mc-control-xs")}`,
      `--mc-table-grid-row-stack: ${times("--mc-space-4")}`,
      `--mc-table-grid-glyph-size: ${times("--mc-space-16")}`,
    ].join("; ");
  });
  let pinnedOffsets = $state<Readonly<Record<string, number>>>({});
  let pinnedEndOffsets = $state<Readonly<Record<string, number>>>({});
  $effect(() => {
    // Track everything that can move a header cell, then measure the rendered header.
    void grid.visibleColumns;
    void grid.columnWidths;
    void grid.rowsInView;
    const ids = stickyColumnIds;
    const next: Record<string, number> = {};
    let offset = 0;
    for (const id of ids) {
      next[id] = offset;
      offset += headerCells[id]?.getBoundingClientRect().width ?? 0;
    }
    if (JSON.stringify(next) !== JSON.stringify(pinnedOffsets)) pinnedOffsets = next;
    // Trailing offsets accumulate from the END edge inward (the last column sits flush at 0).
    const endNext: Record<string, number> = {};
    let endOffset = 0;
    for (const column of pinnedEndColumns.toReversed()) {
      endNext[column.id] = endOffset;
      endOffset += headerCells[column.id]?.getBoundingClientRect().width ?? 0;
    }
    if (JSON.stringify(endNext) !== JSON.stringify(pinnedEndOffsets)) pinnedEndOffsets = endNext;
  });
  const pinnedAttributes = (
    columnId: string,
  ): {
    "data-pinned"?: "true";
    "data-pinned-edge"?: "true";
    "data-pinned-end"?: "true";
    "data-pinned-end-edge"?: "true";
    style?: string;
  } => {
    if (pinnedEndOffsets[columnId] !== undefined) {
      return {
        "data-pinned-end": "true",
        ...(columnId === pinnedEndEdgeColumnId ? { "data-pinned-end-edge": "true" as const } : {}),
        style: `inset-inline-end: ${pinnedEndOffsets[columnId]}px`,
      };
    }
    if (!pinningActive || pinnedOffsets[columnId] === undefined) return {};
    return {
      "data-pinned": "true",
      ...(columnId === stickyEdgeColumnId ? { "data-pinned-edge": "true" as const } : {}),
      style: `inset-inline-start: ${pinnedOffsets[columnId]}px`,
    };
  };

  // ---- column drag-reorder --------------------------------------------------------------------
  let draggingColumnId = $state<string | null>(null);
  let dropTarget = $state<{ columnId: string; after: boolean } | null>(null);
  function headDragOver(event: DragEvent, column: GridColumn<TRow>): void {
    if (
      draggingColumnId === null ||
      draggingColumnId === column.id ||
      column.anchored ||
      column.pinnedEnd === true
    )
      return;
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropTarget = { columnId: column.id, after: event.clientX >= rect.left + rect.width / 2 };
  }
  function headDrop(event: DragEvent, column: GridColumn<TRow>): void {
    event.preventDefault();
    if (draggingColumnId !== null && dropTarget !== null && dropTarget.columnId === column.id) {
      grid.moveColumn(draggingColumnId, column.id, dropTarget.after);
    }
    draggingColumnId = null;
    dropTarget = null;
  }

  // ---- column resize + double-click fit -------------------------------------------------------
  let resizingColumnId = $state<string | null>(null);

  function measuredWidths(): Record<string, number> {
    const widths: Record<string, number> = {};
    for (const column of grid.visibleColumns) {
      widths[column.id] = Math.round(
        headerCells[column.id]?.getBoundingClientRect().width ?? 120,
      );
    }
    return widths;
  }

  let measureContext: CanvasRenderingContext2D | null = null;
  function textWidth(text: string, font: string): number {
    measureContext ??= document.createElement("canvas").getContext("2d");
    if (!measureContext) return text.length * 8;
    measureContext.font = font;
    return measureContext.measureText(text).width;
  }

  /** The column fitted to its widest value — header included, cell furniture accounted for. */
  function fittedWidth(column: GridColumn<TRow>): number {
    const table = headerCells[column.id]?.closest("table");
    const styles = table ? getComputedStyle(table) : null;
    const family = styles?.fontFamily ?? "sans-serif";
    const bodyFont = `${styles?.fontSize ?? "14px"} ${family}`;
    const headFont = `600 12px ${family}`;
    // Header: the caps label + its letterspacing + the arrow slot + the funnel slot + padding.
    let width = textWidth(column.label.toUpperCase(), headFont) + column.label.length * 1.1 + 60;
    for (const row of grid.rows) {
      width = Math.max(width, textWidth(gridCellText(column, row), bodyFont) + (column.fitExtra ?? 0) + 18);
    }
    return Math.ceil(width);
  }

  function gripPointerDown(event: PointerEvent, column: GridColumn<TRow>): void {
    // Only the primary button drags: a right-click on the grip is asking for the header's menu,
    // and starting a resize under an open menu leaves the column following the pointer.
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    grid.snapshotColumnWidths(measuredWidths());
    const startX = event.clientX;
    const startWidth = grid.columnWidthOf(column.id) ?? 120;
    resizingColumnId = column.id;
    const grip = event.currentTarget as HTMLElement;
    grip.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent): void => {
      grid.setColumnWidth(column.id, startWidth + moveEvent.clientX - startX);
    };
    const up = (): void => {
      resizingColumnId = null;
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
  }
  function gripDoubleClick(event: MouseEvent, column: GridColumn<TRow>): void {
    event.preventDefault();
    event.stopPropagation();
    grid.snapshotColumnWidths(measuredWidths());
    grid.setColumnWidth(column.id, fittedWidth(column));
  }

  // ---- the second line's pair hover -----------------------------------------------------------
  // With a rowDetail the record is TWO <tr>s, and CSS :hover only knows one — so the grid tracks
  // which pair the pointer is in and stamps data-pair-hover on both lines, keeping the pair one
  // hover unit.
  let hoveredPairKey = $state<string | null>(null);
  const pairHoverOf = (key: string): "true" | undefined =>
    rowDetail !== undefined && hoveredPairKey === key ? "true" : undefined;

  // ---- selection gestures ---------------------------------------------------------------------
  function rowClick(event: MouseEvent, key: string): void {
    grid.rowClick(key, {
      shift: event.shiftKey,
      toggle: event.ctrlKey || event.metaKey,
      // The second click of a double-click never lets the sole selection go — activation must not
      // churn select → deselect → select (the settled defect fix).
      repeated: event.detail > 1,
    });
  }
  function rowDoubleClick(key: string): void {
    grid.activate(key);
  }
  // The column the header menu speaks about: the one whose cell was right-clicked. Held by id and
  // resolved against every column, not only the visible ones, so hiding it from the menu's own
  // roster leaves the menu open on it.
  let menuColumnId = $state<string | null>(null);
  const menuColumn = $derived(menuColumnId === null ? undefined : grid.columnById(menuColumnId));
  function headContextMenu(event: MouseEvent): void {
    event.stopPropagation();
    const headCell =
      event.target instanceof Element ? event.target.closest("th[data-grid-column]") : null;
    const columnId = headCell?.getAttribute("data-grid-column") ?? null;
    // A press between cells names no column, so nothing opens there.
    if (columnId === null) {
      event.preventDefault();
      return;
    }
    menuColumnId = columnId;
  }
  function rowContextMenu(event: MouseEvent, row: TRow): void {
    if (!onRowContextMenu) return;
    event.preventDefault();
    const key = rowKeyOf(row);
    // Right-click outside the selection re-targets it; inside, the menu speaks for the whole set.
    if (!grid.isSelected(key)) grid.rowClick(key, { repeated: true });
    onRowContextMenu(event, row, grid.selectedRows);
  }
  function surfaceClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest("tr, thead, tfoot, button, input, label")) return;
    grid.clearSelection();
  }

  function scrollFocusIntoView(): void {
    const key = grid.selection.focus;
    if (key === null || !scrollElement) return;
    scrollElement
      .querySelector(`[data-grid-row="${CSS.escape(key)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  function surfaceKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    // Text fields keep their native keys (select-all, caret movement).
    if (target.closest("input, textarea, select, [contenteditable]")) return;
    // A band's foot line is a form, not a record: its buttons keep Enter and the arrows.
    if (target.closest("[data-grid-band-foot]")) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      grid.selectAll();
      return;
    }
    switch (event.key) {
      // The list has no horizontal axis, so Left/Right also move — never dead keys.
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        grid.arrow(1, event.shiftKey);
        scrollFocusIntoView();
        return;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        grid.arrow(-1, event.shiftKey);
        scrollFocusIntoView();
        return;
      case "Enter":
        if (grid.selection.focus !== null) grid.activate(grid.selection.focus);
        return;
      case "Escape":
        grid.clearSelection();
        return;
      default:
        return;
    }
  }
</script>

<!-- A band's foot line: the add line at rest, or the band's own form while it is being written. -->
{#snippet footLine(bandKey: string | null, label: string | null)}
  {#if bandFoot}
    {#if bandFoot.editing(bandKey)}
      <tr class="mc-table-row mc-table-grid-band-foot" data-grid-band-foot={bandKey ?? ""} data-editing="true">
        {#each grid.visibleColumns as column (column.id)}
          {@const pinned = pinnedAttributes(column.id)}
          <td
            class="mc-table-cell mc-table-grid-cell"
            data-align={gridColumnAlign(column) === "end" ? "end" : undefined}
            data-pinned={pinned["data-pinned"]}
            data-pinned-edge={pinned["data-pinned-edge"]}
            data-pinned-end={pinned["data-pinned-end"]}
            data-pinned-end-edge={pinned["data-pinned-end-edge"]}
            style={pinned.style}
          >
            {@render bandFoot.cell({ column, bandKey })}
          </td>
        {/each}
      </tr>
    {:else}
      <tr class="mc-table-row mc-table-grid-band-foot" data-grid-band-foot={bandKey ?? ""}>
        <td class="mc-table-cell mc-table-grid-cell" colspan={grid.visibleColumns.length}>
          {@render bandFoot.rest({ bandKey, label })}
        </td>
      </tr>
    {/if}
  {/if}
{/snippet}

<!--
  The frame is a positioned shell around the scroll region, and it exists so the gilt edge rule at
  the bottom of this file has the scrollport's own box to resolve an absolute position against.

  THE CONSUMER'S CLASS LANDS ON BOTH BOXES, because a surface passes one class describing one thing
  — its frame — and the two halves of that description now live on two elements. The box is the
  shell's (`min-h-0 flex-1`, `h-full`, `max-h-svh`: a surface says how much of the screen the frame
  takes, and the scrollport fills whatever that comes to), while the card is still the scrollport's,
  which is what carries the hairline and the radius — so a flush surface asking for
  `rounded-none border-0` has to reach the element wearing them. Sent to the shell alone, every
  money ledger and the file manager's archive listing would grow the rounded card back. Each half is
  inert on the box it does not describe. The one thing it must therefore not carry is SPACING: a
  margin or a padding utility would apply twice.
-->
<div class={mergeClasses("relative flex min-h-0 w-full flex-col", className)}>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions --
       the scroll region takes focus for the grid's keyboard model (arrows, Ctrl+A, Enter), and a
       scrollable region must be reachable; the click listener only clears selection on empty space. -->
  <div
    bind:this={scrollElement}
    class={mergeClasses("mc-table-grid-scroll mc-scrollbar min-h-0 w-full grow", className)}
    data-frame={frame === "flush" ? "flush" : undefined}
    tabindex="0"
    role="group"
    aria-label={caption}
    onkeydown={surfaceKeydown}
    onclick={surfaceClick}
  >
    <!--
      `h-full` only while the totals strip is there: it is what gives the strip room to be held down
      at the frame's bottom instead of coming to rest under the last row. A table with no totals has
      nothing to hold down and keeps ending where its rows end.
      A HEIGHT and not a min-height, and the difference is not stylistic: on `display: table` a
      height is a MINIMUM the browser will exceed for content that needs more, so a long table still
      grows and scrolls — while a percentage `min-height` gives the row layout nothing definite to
      resolve the filler row's own percentage against, and the slack is never handed out at all.
      Measured both ways; only this one moves the strip.
    -->
    <table
      class={mergeClasses("mc-table mc-table-grid w-full", fillsFrame ? "h-full" : undefined)}
      data-zebra={grid.zebra ? "on" : undefined}
      data-fixed-columns={grid.columnWidthsFixed ? "on" : undefined}
      style={scaleStyle}
      data-row-density={density}
      data-row-marks={grid.marksRows ? "on" : undefined}
      data-row-detail={rowDetail ? "on" : undefined}
      data-totals={showTotals ? "on" : undefined}
    >
      <caption class="sr-only">{caption}</caption>
      <thead class="mc-table-header" bind:this={headElement}>
        <!--
          ONE menu for the whole header row, not one per cell. The menu speaks about the column whose
          cell was right-clicked, and its Columns roster can hide that very column; a menu owned by the
          cell would unmount with it and vanish mid-choice, when a reader is usually adding and
          removing several columns in one go. Owned by the row, it stays open until Escape or a press
          outside. The row is rendered through Bits' delegation snippet because nothing may wrap a
          `<tr>`; its contextmenu handler records the column and stops the event at the header, so a
          surface listening for a ROW's right-click over the same region (the file manager) never
          re-targets its selection off a header.
        -->
        <ContextMenu.Root>
          <ContextMenu.Trigger oncontextmenu={headContextMenu}>
            {#snippet child({ props })}
              <tr {...props} class="mc-table-row">
                {#each grid.visibleColumns as column (column.id)}
                  {@const pinned = pinnedAttributes(column.id)}
                  {@const width = grid.columnWidthOf(column.id)}
                  <th
                    bind:this={headerCells[column.id]}
                    style={[pinned.style, width === undefined ? undefined : `width: ${width}px`]
                      .filter(Boolean)
                      .join("; ") || undefined}
                    scope="col"
                    class="mc-table-head mc-table-grid-head"
                    data-grid-column={column.id}
                    data-align={gridColumnAlign(column) === "end" ? "end" : undefined}
                    data-pinned={pinned["data-pinned"]}
                    data-pinned-edge={pinned["data-pinned-edge"]}
                    data-pinned-end={pinned["data-pinned-end"]}
                    data-pinned-end-edge={pinned["data-pinned-end-edge"]}
                    data-dragging={draggingColumnId === column.id ? "true" : undefined}
                    data-drop={dropTarget?.columnId === column.id
                      ? dropTarget.after
                        ? "after"
                        : "before"
                      : undefined}
                    aria-sort={ariaSortOf(column.id)}
                    draggable={column.anchored || column.pinnedEnd === true ? undefined : true}
                    ondragstart={(event) => {
                      if (column.anchored || column.pinnedEnd === true) return;
                      draggingColumnId = column.id;
                      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
                    }}
                    ondragend={() => {
                      draggingColumnId = null;
                      dropTarget = null;
                    }}
                    ondragover={(event) => headDragOver(event, column)}
                    ondragleave={() => {
                      if (dropTarget?.columnId === column.id) dropTarget = null;
                    }}
                    ondrop={(event) => headDrop(event, column)}
                  >
                    <span class="mc-table-grid-head-inner">
                      <button
                        type="button"
                        class="mc-table-grid-sort"
                        title="Sort by {column.label}. Right-click the header for its column controls"
                        onclick={() => grid.toggleSort(column.id)}
                      >
                        {column.label}
                        <span class="mc-table-grid-sort-arrow">
                          {#if grid.sortColumnId === column.id}
                            {#if grid.sortDirection === "ascending"}
                              <ArrowUp class="mc-table-grid-sort-arrow" aria-hidden="true" />
                            {:else}
                              <ArrowDown class="mc-table-grid-sort-arrow" aria-hidden="true" />
                            {/if}
                          {/if}
                        </span>
                      </button>
                      <!--
                        The filter's MARK, not its control: it says a filter is in play on this column
                        and nothing else, so the cell holds only the column's name and its state. The
                        slot is reserved whether or not it shows, so a filter appearing moves nothing.
                      -->
                      <span
                        class="mc-table-grid-filter-mark"
                        data-active={grid.filterFor(column.id) === undefined ? undefined : "true"}
                        title={filterMarkTitle(column)}
                      >
                        {#if grid.filterFor(column.id) !== undefined}
                          <Funnel class="mc-table-filter-icon" aria-hidden="true" />
                          <span class="sr-only">{column.label} is filtered</span>
                        {/if}
                      </span>
                    </span>
                    <span
                      class="mc-table-grid-grip"
                      data-resizing={resizingColumnId === column.id ? "true" : undefined}
                      aria-hidden="true"
                      title="Drag to resize the {column.label} column. Double-click fits it to its widest value"
                      onpointerdown={(event) => gripPointerDown(event, column)}
                      ondblclick={(event) => gripDoubleClick(event, column)}
                      onclick={(event) => event.stopPropagation()}
                      ondragstart={(event) => event.preventDefault()}
                    ></span>
                  </th>
                {/each}
              </tr>
            {/snippet}
          </ContextMenu.Trigger>
          {#if menuColumn}
            <GridHeadMenu {grid} column={menuColumn} {settings} />
          {/if}
        </ContextMenu.Root>
      </thead>
      <tbody class="mc-table-body">
        {#if loading}
          {#each Array.from({ length: placeholderCount }, (_, index) => index) as placeholderRow (placeholderRow)}
            <tr class="mc-table-row" data-placeholder="true">
              {#each grid.visibleColumns as column (column.id)}
                {@const pinned = pinnedAttributes(column.id)}
                <td
                  class="mc-table-cell mc-table-grid-cell"
                  data-pinned={pinned["data-pinned"]}
                  data-pinned-edge={pinned["data-pinned-edge"]}
                  data-pinned-end={pinned["data-pinned-end"]}
                  data-pinned-end-edge={pinned["data-pinned-end-edge"]}
                  style={pinned.style}><Skeleton class="mc-table-skeleton w-full" /></td
                >
              {/each}
            </tr>
          {/each}
          <!--
            NO RESULTS, AND NOTHING ELSE. Both empty branches say the same two words, and the Grid
            says them — there is no `empty` snippet for a surface to pass, which is what keeps this
            true rather than merely asked for. Fourteen surfaces used to compose their own, and what
            they composed was a paragraph defining the domain term ("A packet is the physical thing
            the firm holds and moves: an envelope, a deed box, a sealed wallet…"), which is the
            explanatory prose the "no info lines" ruling already forbids everywhere else and which
            belongs in docs/user/. A reader looking at a table they have narrowed, or at a firm that
            has not started, does not need the noun explained to them.

            The two branches differ in exactly one thing, and it is a control rather than a sentence:
            a narrowed table offers the way back. That difference is worth keeping — the sentence
            naming which filters are set was not, because the filters are on screen, in the header,
            where the reader set them.
          -->
        {:else if grid.rowsInView.length === 0 && grid.isFiltered}
          <tr class="mc-table-row" data-placeholder="true">
            <td
              class="mc-table-cell mc-table-grid-cell mc-table-grid-placeholder"
              colspan={grid.visibleColumns.length}
            >
              <div class="mc-table-grid-placeholder-frame">
                <div class="mc-table-grid-empty">
                  <p>No Results</p>
                  <Button variant="secondary" size="sm" onclick={() => grid.clearAllFilters()}>
                    <FunnelX class="mc-table-filter-icon" aria-hidden="true" />
                    Clear All Filters
                  </Button>
                </div>
              </div>
            </td>
          </tr>
        {:else if grid.rowsInView.length === 0}
          <tr class="mc-table-row" data-placeholder="true">
            <td
              class="mc-table-cell mc-table-grid-cell mc-table-grid-placeholder"
              colspan={grid.visibleColumns.length}
            >
              <div class="mc-table-grid-placeholder-frame">
                <div class="mc-table-grid-empty">
                  <p>No Results</p>
                </div>
              </div>
            </td>
          </tr>
          {#if bandFoot}
            {@render footLine(null, null)}
          {/if}
        {:else}
          {#each grid.rowsInView as row, rowIndex (rowKeyOf(row))}
            {@const endsBand = bandEnds.get(rowIndex)}
            {@const key = rowKeyOf(row)}
            {@const mark = grid.markFor(row)}
            {@const stripe = rowIndex % 2 === 1 ? ("even" as const) : undefined}
            {@const band = grid.bandStarts.get(rowIndex)}
            {#if grid.pinnedRowCount > 0 && rowIndex === grid.pinnedRowCount && band === undefined}
              <!-- The rule that separates the pinned block from the list: pinned items sit above
                   EVERYTHING, not above their own kind, and the rule is what says so. A band
                   heading does the same job when the list is grouped, so the rule gives way. -->
              <tr class="mc-table-grid-pin-rule">
                <td colspan={grid.visibleColumns.length}></td>
              </tr>
            {/if}
            {#if band !== undefined}
              <!-- A band heading: the group's name and how many rows are in it. A row of its own
                   so it scrolls with the list and sticks beneath the header while its rows pass. -->
              <tr class="mc-table-grid-band" data-grid-band={band.key}>
                <th class="mc-table-grid-band-cell" colspan={grid.visibleColumns.length} scope="colgroup">
                  <span class="mc-table-grid-band-inner">
                    <span class="mc-table-grid-band-label">{band.label}</span>
                    <span class="mc-table-grid-band-count">{band.rows.length}</span>
                    {#if bandDetail}
                      {@render bandDetail(band.key)}
                    {/if}
                  </span>
                </th>
              </tr>
            {/if}
            <tr
              class="mc-table-row"
              data-grid-row={key}
              data-state={grid.isSelected(key) ? "selected" : undefined}
              data-stripe={stripe}
              data-pair-hover={pairHoverOf(key)}
              {...gridRowMarkAttributes(mark)}
              onclick={(event) => rowClick(event, key)}
              ondblclick={() => rowDoubleClick(key)}
              oncontextmenu={(event) => rowContextMenu(event, row)}
              onpointerenter={rowDetail ? () => (hoveredPairKey = key) : undefined}
              onpointerleave={rowDetail ? () => (hoveredPairKey = null) : undefined}
            >
              {#each grid.visibleColumns as column, columnIndex (column.id)}
                {@const pinned = pinnedAttributes(column.id)}
                {@const text = gridCellText(column, row)}
                <td
                  class="mc-table-cell mc-table-grid-cell"
                  data-align={gridColumnAlign(column) === "end" ? "end" : undefined}
                  data-pinned={pinned["data-pinned"]}
                  data-pinned-edge={pinned["data-pinned-edge"]}
                  data-pinned-end={pinned["data-pinned-end"]}
                  data-pinned-end-edge={pinned["data-pinned-end-edge"]}
                  style={pinned.style}
                >
                  {#if columnIndex === 0 && mark?.pinned === true}
                    <!-- One pin glyph everywhere the pin state shows; fill is the only difference.
                         It is PAINTED INTO the first cell's leading padding rather than rendered
                         ahead of the cell's content, so the cell keeps exactly one in-flow child
                         whatever the surface composes there. The space it needs is reserved by that
                         padding on every row of a table that marks rows, so pinning lights a pin
                         and shifts nothing. See the recipe for what the inline box cost. -->
                    <Pin class="mc-table-grid-row-pin" fill="currentColor" aria-hidden="true" />
                  {/if}
                  {#if cell}
                    {@render cell({ row, column, text })}
                  {:else if text === ""}
                    <!-- A muted em dash reads as "intentionally empty", not a rendering gap. -->
                    <span class="mc-table-grid-empty-value" aria-hidden="true">—</span>
                  {:else}
                    {text}
                  {/if}
                </td>
              {/each}
            </tr>
            {#if rowDetail}
              <!-- The record's second line: one cell across the scrolling columns, carrying the
                   hairline the primary line gave up — the pair reads as one row of two lines. -->
              <tr
                class="mc-table-grid-detail-row"
                data-grid-detail-row={key}
                data-state={grid.isSelected(key) ? "selected" : undefined}
                data-stripe={stripe}
                data-pair-hover={pairHoverOf(key)}
                {...gridRowMarkAttributes(mark)}
                onclick={(event) => rowClick(event, key)}
                ondblclick={() => rowDoubleClick(key)}
                oncontextmenu={(event) => rowContextMenu(event, row)}
                onpointerenter={() => (hoveredPairKey = key)}
                onpointerleave={() => (hoveredPairKey = null)}
              >
                <td
                  class="mc-table-cell mc-table-grid-cell mc-table-grid-detail-cell"
                  colspan={grid.visibleColumns.length - pinnedEndColumns.length}
                >
                  {@render rowDetail(row)}
                </td>
                {#if pinnedEndColumns.length > 0}
                  <!-- An empty pinned cell keeps the trailing column's hairline continuous. -->
                  <td
                    class="mc-table-cell mc-table-grid-cell mc-table-grid-detail-pinned-cell"
                    colspan={pinnedEndColumns.length}
                    data-pinned-end="true"
                    data-pinned-end-edge="true"
                  ></td>
                {/if}
              </tr>
            {/if}
            {#if bandFoot && endsBand !== undefined}
              {@render footLine(endsBand.key, endsBand.label)}
            {/if}
          {/each}
          {#if bandFoot && grid.bands === null}
            {@render footLine(null, null)}
          {/if}
        {/if}
        <!--
          THE SLACK, GIVEN A HOME. The totals strip is sticky to the bottom of the scroll frame,
          which holds it down only while there is something below it to scroll past. A table shorter
          than its frame has nothing below it, so the strip used to come to rest wherever the last row
          happened to end, leaving a band of empty surface beneath it — the totals of a four-row
          ledger sitting halfway up the screen.
          The table now asks for the frame's full height, and this row is where the difference goes.
          It has to be the LAST ROW OF THE BODY and it has to ask in `h-full`; both were established
          by measurement in a real browser rather than reasoned about, because table layout does not
          behave the way it reads:
            • in the FOOT, or as a percentage on the cell rather than the row, it is given nothing at
              all and the surplus is handed to the last record instead, which stretches to 210px;
            • with `tbody { height: 0 }` the records keep their height but are pushed to the BOTTOM
              of the body, leaving the gap above them instead of below;
            • here, as the last body row, it takes the whole surplus and the records keep the one
              line each the density gives them.
          It renders for a totals strip and for a FLUSH grid: the strip needs holding down, and a
          flush grid's surface has to continue past the last record. A carded table with neither
          ends where its rows end, which is right.
          It is scenery, so it is hidden from assistive technology, and it carries no `data-grid-row`
          — the attribute that says "this row is a record", which every count of real rows filters
          on. The body already holds other structural rows for the same reason: the pin rule and the
          row-detail second lines.
        -->
        {#if fillsFrame}
          <tr class="mc-table-grid-filler-row h-full" aria-hidden="true">
            <td class="mc-table-grid-filler-cell" colspan={grid.visibleColumns.length}></td>
          </tr>
        {/if}
      </tbody>
      {#if showTotals}
        <tfoot>
          <tr class="mc-table-row">
            {#each grid.visibleColumns as column, columnIndex (column.id)}
              {@const pinned = pinnedAttributes(column.id)}
              <td
                class="mc-table-grid-total-cell"
                data-align={gridColumnAlign(column) === "end" ? "end" : undefined}
                data-pinned={pinned["data-pinned"]}
                data-pinned-end={pinned["data-pinned-end"]}
                data-pinned-end-edge={pinned["data-pinned-end-edge"]}
                style={pinned.style}
              >
                {#if columnIndex === 0}
                  <span
                    class="mc-table-grid-scope"
                    data-filtered={grid.isFiltered ? "true" : undefined}
                    title={grid.isFiltered
                      ? "Totals over the rows in view only"
                      : "Totals over every " + grid.itemNoun.singular}
                  >
                    {grid.isFiltered ? "In view" : "Total"}
                  </span>
                {:else if column.total === "sum"}
                  {grid.totalTextFor(column)}
                {/if}
              </td>
            {/each}
          </tr>
        </tfoot>
      {/if}
    </table>
  </div>
  <!--
    The inline pair only. The ask is the columns off to the side: this table's vertical
    scrollbar is drawn (mc-scrollbar), so it already says what a block-end rule would, while
    nothing on the frame says that the record continues past its inline edge.
  -->
  <ScrollEdgeHint element={scrollElement} axis="inline" />
</div>
