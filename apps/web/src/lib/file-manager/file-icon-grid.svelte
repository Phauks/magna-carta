<script lang="ts">
  /*
   * The icon layout — the second of the two ways this list is read. A folder of photographs is
   * unreadable as a table of names, and a folder of pleadings is unreadable as a wall of identical
   * page glyphs, so the reader picks.
   *
   * The tiles are the SAME ROWS the table shows, in the same order, under the same filters and the
   * same pinned block: switching layout changes how the rows are drawn and nothing about which rows
   * they are. Selection is the grid's own, so a selection survives the switch.
   *
   * Arrow keys move in two dimensions here, because the grid genuinely has two. The table has no
   * horizontal axis, so there Left and Right move up and down rather than being dead keys.
   *
   * A NAME WRAPS, AND NO TILE EVER COVERS ITS NEIGHBOUR. A tile has a fixed width and its whole job
   * is to name one file, so the name breaks onto a second and a third line rather than being cut
   * off at the first — the same reading a navigation row is given, for the same reason. What it may
   * not do is grow without end: past the third line the name ends in an ellipsis and the whole name
   * is on the tile's hover, so a folder of long names stays a grid of even tiles. The name could
   * only spill over its neighbours because its own box was never told it could shrink; it is told
   * now, which is the part that makes the wrap honest rather than decorative.
   *
   * THE PIN'S SPACE IS RESERVED WHETHER OR NOT THE TILE IS PINNED, and an equal space closes the
   * line, so pinning lights a glyph and moves nothing — not the name under the pointer, and not the
   * tiles beside it.
   */
  import FileIcon from "@magna-carta/design-system/file-icon";
  import FolderGlyph from "@magna-carta/design-system/folder-glyph";
  import type { FolderColorName, FolderIconName } from "@magna-carta/design-system/folder-tree";
  import Separator from "@magna-carta/design-system/separator";
  import Pin from "@lucide/svelte/icons/pin";
  import type { DataTableGridState } from "@magna-carta/design-system/data-table";
  import type { FileManagerRow } from "./file-rows.ts";
  import { displayName } from "./file-names.ts";
  import { safetyKeyOf } from "./file-columns.ts";
  import SafetyMark from "./safety-mark.svelte";

  let {
    grid,
    folderAppearance,
    hideExtensions,
    /** The reader's scale, applied to the tile as a whole so previews and text grow together. */
    scalePercent,
    onActivate,
    onRowContextMenu,
  }: {
    grid: DataTableGridState<FileManagerRow>;
    /** Each folder's colour and mark, so a tile draws the folder the firm marked. */
    folderAppearance: Record<string, { color?: FolderColorName; icon?: FolderIconName }>;
    hideExtensions: boolean;
    scalePercent: number;
    onActivate: (row: FileManagerRow) => void;
    onRowContextMenu: (event: MouseEvent, row: FileManagerRow) => void;
  } = $props();

  const rows = $derived(grid.rowsInView);
  const pinnedCount = $derived(grid.pinnedRowCount);

  /** Tile size follows the reader's scale. It is a runtime dimension, so it rides inline. */
  const tileStyle = $derived(`font-size: ${scalePercent}%`);
</script>

<div
  class="mc-scrollbar min-h-0 flex-1 overflow-auto p-12"
  role="group"
  aria-label="Files in this folder, as icons"
>
  <div class="flex flex-wrap gap-12" style={tileStyle}>
    {#each rows as row, index (row.key)}
      {#if pinnedCount > 0 && index === pinnedCount}
        <!-- The pinned block sits above EVERYTHING, and the rule is what says the block is a
             different thing from the list beneath it. -->
        <Separator class="w-full" />
      {/if}
      {@const mark = grid.markFor(row)}
      {@const name =
        row.kind === "folder" ? row.folder.name : displayName(row.file.name, hideExtensions)}
      <button
        type="button"
        class="flex w-96 flex-col items-center gap-4 rounded-md p-8 text-center"
        title={name}
        data-state={grid.isSelected(row.key) ? "selected" : undefined}
        data-clipboard={mark?.clipboard}
        aria-pressed={grid.isSelected(row.key)}
        ondblclick={() => onActivate(row)}
        oncontextmenu={(event) => onRowContextMenu(event, row)}
        onclick={(event) =>
          grid.rowClick(row.key, {
            toggle: event.ctrlKey || event.metaKey,
            shift: event.shiftKey,
          })}
      >
        {#if row.kind === "folder"}
          <FolderGlyph
            class="size-48"
            color={folderAppearance[row.folder.id]?.color}
            icon={folderAppearance[row.folder.id]?.icon}
          />
        {:else}
          <FileIcon
            contentType={row.file.sniffedContentType ?? undefined}
            fileName={row.file.name}
            class="size-48"
          />
        {/if}
        <span class="flex w-full items-start justify-center gap-4 text-xs">
          <!-- The pin's gutter, held open on every tile. An empty span is the reserved space. -->
          <span class="size-12 shrink-0 text-accent-default">
            {#if mark?.pinned === true}
              <Pin class="size-12" aria-hidden="true" fill="currentColor" />
            {/if}
          </span>
          <span class="line-clamp-3 min-w-0 break-words">{name}</span>
          <!-- The gutter's twin, so the name stays centred in the tile whichever state it is in. -->
          <span class="size-12 shrink-0" aria-hidden="true"></span>
        </span>
        {#if row.kind === "file"}
          <SafetyMark verdict={safetyKeyOf(row.file)} />
        {/if}
      </button>
    {/each}
  </div>
</div>
