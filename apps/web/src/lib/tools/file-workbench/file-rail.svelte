<script lang="ts">
  /*
   * The files on the workbench. Navigation, not content: it is here to be scanned and got out of
   * the way, and the file it points at fills the rest of the screen.
   *
   * Rows select without checkbox squares, ranges extend with shift and single files toggle with
   * ctrl or cmd, and the count and the clear action live in the footer. That is the matter file
   * manager's settled behaviour; this rail is the same behaviour over a different source, so a
   * person who has used one has used both.
   *
   * The dropzone sits under the rows rather than replacing them, which is why there is no separate
   * empty screen: with nothing on the workbench this rail is the same rail with no rows in it.
   */
  import Dropzone from "@magna-carta/design-system/dropzone";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import Button from "@magna-carta/design-system/button";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import Badge from "@magna-carta/design-system/badge";
  import { scanStatus } from "./capabilities/malware-scan.ts";
  import { describeType } from "./file-facts.ts";
  import { formatSize, scanVerdictOf, type WorkbenchFile } from "./workbench-file.ts";
  import type { SelectionGesture, SelectionState } from "./selection.ts";

  let {
    files,
    arriving,
    selection,
    onSelect,
    onSelectAll,
    onClear,
    onFiles,
  }: {
    files: readonly WorkbenchFile[];
    /** How many dropped files are still being read. Shown rather than hidden. */
    arriving: number;
    selection: SelectionState;
    onSelect: (gesture: SelectionGesture) => void;
    onSelectAll: () => void;
    onClear: () => void;
    onFiles: (dropped: File[]) => void;
  } = $props();

  const allSelected = $derived(files.length > 0 && selection.selected.size === files.length);

  function gestureFrom(event: MouseEvent | KeyboardEvent, id: string): SelectionGesture {
    return { id, range: event.shiftKey, toggle: event.ctrlKey || event.metaKey };
  }
</script>

<div class="flex min-h-0 flex-col border-e border-border-default">
  <div class="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-8">
    {#if files.length > 0}
      <ul class="m-0 flex list-none flex-col p-0" role="listbox" aria-label="Files on the workbench">
        {#each files as file (file.id)}
          {@const verdict = scanVerdictOf(file)}
          {@const active = selection.activeId === file.id}
          <li role="none">
            <button
              type="button"
              role="option"
              aria-selected={selection.selected.has(file.id)}
              class="flex w-full items-center gap-8 rounded-md border-s-2 border-transparent p-8 text-start hover:bg-surface-raised"
              class:bg-surface-selected={selection.selected.has(file.id)}
              class:border-s-accent-strong={active}
              onclick={(event) => onSelect(gestureFrom(event, file.id))}
            >
              <FileIcon fileName={file.name} contentType={file.declaredMediaType} size="sm" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">{file.name}</span>
                <span class="block truncate text-xs text-text-subtle tabular-nums">
                  {formatSize(file.sizeBytes)} · {describeType(file)}
                </span>
              </span>
              <!-- The verdict rides the row only once the scanner has said something. A chip
                   reading "Not scanned" on every row, before any scan is wired, is noise on every
                   row — and it is the state a person can already read off the Overview. -->
              {#if verdict !== "unscanned"}
                {@const status = scanStatus(verdict)}
                <Badge variant={status.tone} title={status.meaning}>{status.label}</Badge>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#each { length: arriving } as _, index (index)}
      <Skeleton class="h-40 w-full" />
    {/each}

    <Dropzone
      label="Add files to the workbench"
      prompt={files.length > 0 ? "Drop more files here" : "Drop files here, or use the button"}
      multiple
      {onFiles}
    />
  </div>

  <div
    class="flex items-center gap-8 border-t border-border-default px-12 py-8 text-xs text-text-muted"
  >
    {#if files.length === 0}
      <span>No files yet</span>
    {:else}
      <Button
        variant="ghost"
        size="sm"
        onclick={allSelected ? onClear : onSelectAll}
        class="tabular-nums"
      >
        {selection.selected.size} of {files.length} selected
      </Button>
    {/if}
  </div>
</div>
