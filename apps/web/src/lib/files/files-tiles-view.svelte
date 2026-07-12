<script lang="ts">
  /*
   * The tiles view — the same files as an icon grid, for the member who recognizes a document by its
   * shape before its name. Each tile carries the large type glyph, the name, the size, and (only when
   * it is not the ordinary case) its ingest outcome, so nothing the list view says is lost here.
   *
   * Selection follows the same idiom as the list (./files-list-view.svelte): a plain click REPLACES
   * the selection (`select`), a checkbox — or a modified click — ADDS or REMOVES (`toggle`).
   *
   * The tile itself is a real <button>, so it is reachable and operable by keyboard with no handlers
   * of our own. Its selected state rides on `aria-pressed` rather than the list's `aria-selected`:
   * `aria-selected` is only meaningful on a row or an option, and a role="option" may not contain the
   * checkbox that makes multi-select reachable without a modifier key. `data-state` mirrors the list
   * so the two views style selection off the same attribute.
   */
  import Checkbox from "@magna-carta/design-system/checkbox";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import type { FileSummary } from "@magna-carta/api-client";
  import type { ViewRenderProps } from "$lib/view-shell/view-shell-types.ts";
  import { formatFileSize } from "./file-presentation.ts";
  import type { FilesViewContext } from "./files-view-context.ts";
  import FileStatusBadge from "./file-status-badge.svelte";

  // The host's context (the sort) is declared but not read here: the tiles are ordered by whatever the
  // server was asked for, and the chrome owns that control. Naming the type keeps every file view
  // interchangeable in the registry.
  let { items, selection }: ViewRenderProps<FileSummary, FilesViewContext> = $props();

  // A modified click is the multi-select gesture everywhere else in the operating system; an
  // unmodified one starts a fresh selection.
  function onTileClick(event: MouseEvent, file: FileSummary): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey) selection.toggle(file);
    else selection.select(file);
  }
</script>

<ul class="grid grid-cols-2 gap-16 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
  {#each items as file (file.id)}
    {@const selected = selection.isSelected(file)}
    <li class="relative">
      <button
        type="button"
        data-state={selected ? "selected" : undefined}
        aria-pressed={selected}
        onclick={(event: MouseEvent) => onTileClick(event, file)}
        class="flex w-full min-w-0 flex-col items-center gap-8 rounded-md border border-border-default p-16 text-center hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring data-[state=selected]:border-border-strong data-[state=selected]:bg-surface-selected"
      >
        <FileIcon
          class="size-32"
          contentType={file.sniffedContentType ?? undefined}
          fileName={file.name}
        />
        <!-- The name is the one field that can be arbitrarily long; it truncates so a tile never
             outgrows its column, and carries the full name as its tooltip. -->
        <span class="w-full truncate text-sm text-text-default" title={file.name}>{file.name}</span>
        <span class="text-xs text-text-muted">{formatFileSize(file.sizeBytes)}</span>
        <!-- A rejected file's reason can run long; it is clipped rather than allowed to widen the
             tile. The status badge renders nothing at all for the ordinary clean file. -->
        <span class="w-full truncate"><FileStatusBadge {file} /></span>
      </button>
      <!-- The checkbox sits beside the button, not inside it: a control nested in a button is
           inoperable. Being a sibling, its click reaches no tile handler to double-fire. -->
      <span class="absolute start-8 top-8">
        <Checkbox
          checked={selected}
          aria-label={`Select ${file.name}`}
          onCheckedChange={() => selection.toggle(file)}
        />
      </span>
    </li>
  {/each}
</ul>
