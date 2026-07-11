<script lang="ts">
  /*
   * The timeline view — the matter's documents in the order they last moved, newest first, with the
   * folder structure deliberately FLATTENED. The other views answer "where does this file live"; this
   * one answers "what happened to this matter's documents, and when", and a file's folder is beside
   * the point when that is the question being asked.
   *
   * Days are the grain: one heading per calendar day, the files that moved that day beneath it. The
   * day is computed in UTC because the heading is rendered by the design system's formatDate, which
   * formats in UTC (packages/design-system/src/lib/components/data-table/typed-columns.ts) — grouping
   * in any other zone would put a file under a heading that names a different day.
   *
   * Selection follows the same idiom as the list view (files-list-view.svelte): a plain click
   * REPLACES the selection (`select`), a modified click ADDS or REMOVES (`toggle`). Rows are options
   * in a multi-selectable listbox, so the gesture is reachable from the keyboard as well as the mouse.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import type { FileSummary } from "@magna-carta/api-client";
  import type { ViewRenderProps } from "$lib/view-shell/view-shell-types.ts";
  import { formatFileSize } from "./file-presentation.ts";
  import FileStatusBadge from "./file-status-badge.svelte";

  let { items, selection }: ViewRenderProps<FileSummary> = $props();

  /** One calendar day of the timeline: its heading, and the files that last moved that day. */
  interface TimelineDay {
    readonly key: string;
    readonly heading: string;
    readonly files: FileSummary[];
  }

  // A timestamp the browser cannot parse is grouped apart rather than dropped: a file the member can
  // see in every other view must not vanish from this one because its clock reading was malformed.
  const unknownDayKey = "unknown";

  function dayKeyOf(timestamp: string): string {
    const moment = new Date(timestamp);
    return Number.isNaN(moment.getTime()) ? unknownDayKey : moment.toISOString().slice(0, 10);
  }

  function sortableTime(timestamp: string): number {
    const moment = new Date(timestamp);
    // An unparsable timestamp sorts to the end, behind every file whose time is known.
    return Number.isNaN(moment.getTime()) ? Number.NEGATIVE_INFINITY : moment.getTime();
  }

  // `items` belongs to the shell and is shared with the other views — sort a COPY, never in place.
  const days = $derived.by((): TimelineDay[] => {
    const newestFirst = [...items].sort(
      (left, right) => sortableTime(right.updatedAt) - sortableTime(left.updatedAt),
    );
    const grouped: TimelineDay[] = [];
    for (const file of newestFirst) {
      const key = dayKeyOf(file.updatedAt);
      const open = grouped.at(-1);
      // The list is already in day order, so a run of same-day files extends the group being filled.
      if (open !== undefined && open.key === key) open.files.push(file);
      else {
        grouped.push({
          key,
          heading: key === unknownDayKey ? "Date unknown" : DataTable.formatDate(key),
          files: [file],
        });
      }
    }
    return grouped;
  });

  function onRowClick(event: MouseEvent, file: FileSummary): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey) selection.toggle(file);
    else selection.select(file);
  }

  // Enter and Space are the row's activation keys; the same modifiers that make a click additive make
  // the keystroke additive, so neither input carries a gesture the other cannot.
  function onRowKeydown(event: KeyboardEvent, file: FileSummary): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (event.metaKey || event.ctrlKey || event.shiftKey) selection.toggle(file);
    else selection.select(file);
  }
</script>

<div
  role="listbox"
  aria-multiselectable="true"
  aria-label="Files on this matter, most recently updated first"
  class="flex flex-col gap-24"
>
  {#each days as day (day.key)}
    <div role="group" aria-label={day.heading} class="flex flex-col">
      <!-- The heading is the group's accessible name already; as content it would only repeat itself. -->
      <p
        aria-hidden="true"
        class="border-b border-border-default pb-4 text-xs font-semibold text-text-muted"
      >
        {day.heading}
      </p>
      {#each day.files as file (file.id)}
        {@const selected = selection.isSelected(file)}
        <div
          role="option"
          tabindex="0"
          aria-selected={selected}
          data-state={selected ? "selected" : undefined}
          onclick={(event: MouseEvent) => onRowClick(event, file)}
          onkeydown={(event: KeyboardEvent) => onRowKeydown(event, file)}
          class="flex cursor-default items-center gap-8 rounded-md px-8 py-4 text-sm focus-visible:outline-2 focus-visible:outline-focus-ring {selected
            ? 'bg-surface-selected'
            : 'hover:bg-surface-sunken'}"
        >
          <FileIcon
            contentType={file.sniffedContentType ?? undefined}
            fileName={file.name}
            class="shrink-0"
          />
          <span class="truncate">{file.name}</span>
          <span class="ms-auto shrink-0 text-xs text-text-muted">v{file.versionNumber}</span>
          <span class="shrink-0 text-xs text-text-muted">{formatFileSize(file.sizeBytes)}</span>
          <FileStatusBadge {file} />
        </div>
      {/each}
    </div>
  {/each}
</div>
