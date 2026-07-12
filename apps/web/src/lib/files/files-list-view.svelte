<script lang="ts">
  /*
   * The list view — the dense table, and the file surface's default. One row per file: the type
   * glyph and name, the version, the size, when it was filed and when it last changed, and (only
   * when it is not the ordinary case) its ingest outcome.
   *
   * The headings sort. They do not sort THIS TABLE, though — they ask the SERVER to reorder the whole
   * matter and hand back the first page of the new order. Sorting the rows already loaded would answer
   * a different question: the biggest file of this page, not of the matter. So the heading hands the
   * choice up to the host through the shell's context, and the host re-runs the query.
   *
   * Selection follows the desktop idiom the shell's controller already models: a plain click
   * REPLACES the selection (`select`), a checkbox — or a modified click — ADDS or REMOVES
   * (`toggle`). The checkbox is what makes multi-select reachable without a modifier key, so the
   * behaviour is not keyboard- or mouse-only.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import type { FileSummary } from "@magna-carta/api-client";
  import type { ViewRenderProps } from "$lib/view-shell/view-shell-types.ts";
  import { formatFileSize } from "./file-presentation.ts";
  import { ariaSortFor, FILE_SORT_LABELS, type FileSortKey } from "./file-sort.ts";
  import type { FilesViewContext } from "./files-view-context.ts";
  import FileStatusBadge from "./file-status-badge.svelte";

  let { items, selection, context }: ViewRenderProps<FileSummary, FilesViewContext> = $props();

  const sort = $derived(context.sort);

  // A modified click is the multi-select gesture everywhere else in the operating system; an
  // unmodified one starts a fresh selection.
  function onRowClick(event: MouseEvent, file: FileSummary): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey) selection.toggle(file);
    else selection.select(file);
  }

  // Right-aligned for the numeric columns, so the digits line up to be compared down the column.
  const COLUMN_ALIGN: Partial<Record<FileSortKey, "end">> = { sizeBytes: "end" };
</script>

{#snippet sortableHeading(key: FileSortKey)}
  {@const active = sort.key === key}
  <DataTable.Head aria-sort={ariaSortFor(sort, key)} data-align={COLUMN_ALIGN[key]}>
    <button
      type="button"
      class="inline-flex items-center gap-4 hover:text-text-default"
      onclick={() => context.onSortByColumn(key)}
    >
      <span>{FILE_SORT_LABELS[key]}</span>
      {#if active}
        {#if sort.direction === "asc"}
          <ArrowUp class="size-12" aria-hidden="true" />
        {:else}
          <ArrowDown class="size-12" aria-hidden="true" />
        {/if}
      {/if}
    </button>
  </DataTable.Head>
{/snippet}

<DataTable.Root>
  <DataTable.Caption class="sr-only">Files on this matter</DataTable.Caption>
  <DataTable.Header>
    <DataTable.Row>
      <DataTable.Head><span class="sr-only">Select</span></DataTable.Head>
      {@render sortableHeading("name")}
      <DataTable.Head data-align="end">Version</DataTable.Head>
      {@render sortableHeading("sizeBytes")}
      {@render sortableHeading("createdAt")}
      {@render sortableHeading("updatedAt")}
      <DataTable.Head>Status</DataTable.Head>
    </DataTable.Row>
  </DataTable.Header>
  <DataTable.Body>
    {#each items as file (file.id)}
      {@const selected = selection.isSelected(file)}
      <DataTable.Row
        data-state={selected ? "selected" : undefined}
        aria-selected={selected}
        onclick={(event: MouseEvent) => onRowClick(event, file)}
      >
        <DataTable.Cell>
          <Checkbox
            checked={selected}
            aria-label={`Select ${file.name}`}
            onCheckedChange={() => selection.toggle(file)}
            onclick={(event: MouseEvent) => event.stopPropagation()}
          />
        </DataTable.Cell>
        <DataTable.Cell>
          <span class="inline-flex items-center gap-8">
            <FileIcon contentType={file.sniffedContentType ?? undefined} fileName={file.name} />
            <span>{file.name}</span>
          </span>
        </DataTable.Cell>
        <DataTable.Cell data-align="end">{file.versionNumber}</DataTable.Cell>
        <DataTable.Cell data-align="end">{formatFileSize(file.sizeBytes)}</DataTable.Cell>
        <DataTable.Cell>{DataTable.formatDate(file.createdAt)}</DataTable.Cell>
        <DataTable.Cell>{DataTable.formatDate(file.updatedAt)}</DataTable.Cell>
        <DataTable.Cell><FileStatusBadge {file} /></DataTable.Cell>
      </DataTable.Row>
    {/each}
  </DataTable.Body>
</DataTable.Root>
