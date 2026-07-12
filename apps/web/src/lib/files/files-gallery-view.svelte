<script lang="ts">
  /*
   * The gallery view — the file surface at its most visual: one large cell per file, laid out on a
   * responsive grid, with the type glyph carrying the cell.
   *
   * ALPHA, and the badge above the grid says so plainly. A gallery earns its name by showing the
   * page, not the file type, and this one cannot yet: nothing renders a thumbnail of a stored file,
   * so there is no image to show. Rather than fake one, every cell — image files included — draws
   * the same type glyph the other views use (@magna-carta/design-system/file-icon). When renditions
   * exist, the glyph gives way to the real thing and the badge comes off; until then the view tells
   * the member what it is showing instead of implying it is showing a preview.
   *
   * Selection follows the same gesture as the list view (./files-list-view.svelte): a plain click
   * REPLACES the selection (`select`), a modified click ADDS or REMOVES (`toggle`). The grid is a
   * multi-selectable listbox and each cell an option — the role that actually carries a selected
   * state (a button does not support aria-selected). Cells are focusable and answer Enter and Space
   * with the same gesture as a click, modifier included, so the grid is not mouse-only.
   */
  import Badge from "@magna-carta/design-system/badge";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import type { FileSummary } from "@magna-carta/api-client";
  import type { ViewRenderProps } from "$lib/view-shell/view-shell-types.ts";
  import { formatFileSize } from "./file-presentation.ts";
  import type { FilesViewContext } from "./files-view-context.ts";
  import FileStatusBadge from "./file-status-badge.svelte";

  // The host's context (the sort) is declared but not read here: the cells are ordered by whatever the
  // server was asked for, and the chrome owns that control. Naming the type keeps every file view
  // interchangeable in the registry.
  let { items, selection }: ViewRenderProps<FileSummary, FilesViewContext> = $props();

  // A modified click is the multi-select gesture everywhere else in the operating system; an
  // unmodified one starts a fresh selection. Keyboard activation carries the same modifiers, so
  // both entry points share one decision.
  function applySelectionGesture(event: MouseEvent | KeyboardEvent, file: FileSummary): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey) selection.toggle(file);
    else selection.select(file);
  }

  function onCellKeyDown(event: KeyboardEvent, file: FileSummary): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    // Space would otherwise scroll the grid out from under the cell the member just picked.
    event.preventDefault();
    applySelectionGesture(event, file);
  }
</script>

<div class="flex flex-col gap-16">
  <div class="flex flex-wrap items-center gap-8">
    <Badge variant="warning">Alpha</Badge>
    <p class="text-sm text-text-muted">
      Thumbnails are not available yet — files are shown by type. Image previews arrive with the
      rendition pipeline.
    </p>
  </div>

  <ul
    role="listbox"
    aria-multiselectable="true"
    aria-label="Files on this matter"
    class="grid list-none grid-cols-2 gap-16 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
  >
    {#each items as file (file.id)}
      {@const selected = selection.isSelected(file)}
      <li
        role="option"
        tabindex="0"
        data-state={selected ? "selected" : undefined}
        aria-selected={selected}
        onclick={(event: MouseEvent) => applySelectionGesture(event, file)}
        onkeydown={(event: KeyboardEvent) => onCellKeyDown(event, file)}
        class="flex cursor-pointer flex-col gap-8 rounded-md border border-border-default bg-surface-raised p-12 hover:bg-surface-sunken data-[state=selected]:border-border-strong data-[state=selected]:bg-surface-selected"
      >
        <span
          class="flex h-96 w-full items-center justify-center rounded-sm bg-surface-sunken"
          aria-hidden="true"
        >
          <FileIcon
            contentType={file.sniffedContentType ?? undefined}
            fileName={file.name}
            class="size-48"
          />
        </span>
        <span class="truncate text-sm text-text-default">{file.name}</span>
        <span class="text-xs text-text-muted">
          {formatFileSize(file.sizeBytes)} · v{file.versionNumber}
        </span>
        <FileStatusBadge {file} />
      </li>
    {/each}
  </ul>
</div>
