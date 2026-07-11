<script lang="ts">
  /*
   * The list view — the dense table, and the file surface's default. One row per file: the type
   * glyph and name, the version, the size, when it last moved, and (only when it is not the
   * ordinary case) its ingest outcome.
   *
   * Selection follows the desktop idiom the shell's controller already models: a plain click
   * REPLACES the selection (`select`), a checkbox — or a modified click — ADDS or REMOVES
   * (`toggle`). The checkbox is what makes multi-select reachable without a modifier key, so the
   * behaviour is not keyboard- or mouse-only.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import type { FileSummary } from "@magna-carta/api-client";
  import type { ViewRenderProps } from "$lib/view-shell/view-shell-types.ts";
  import { formatFileSize } from "./file-presentation.ts";
  import FileStatusBadge from "./file-status-badge.svelte";

  let { items, selection }: ViewRenderProps<FileSummary> = $props();

  // A modified click is the multi-select gesture everywhere else in the operating system; an
  // unmodified one starts a fresh selection.
  function onRowClick(event: MouseEvent, file: FileSummary): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey) selection.toggle(file);
    else selection.select(file);
  }
</script>

<DataTable.Root>
  <DataTable.Caption class="sr-only">Files on this matter</DataTable.Caption>
  <DataTable.Header>
    <DataTable.Row>
      <DataTable.Head><span class="sr-only">Select</span></DataTable.Head>
      <DataTable.Head>Name</DataTable.Head>
      <DataTable.Head data-align="end">Version</DataTable.Head>
      <DataTable.Head data-align="end">Size</DataTable.Head>
      <DataTable.Head>Updated</DataTable.Head>
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
        <DataTable.Cell>{DataTable.formatDate(file.updatedAt)}</DataTable.Cell>
        <DataTable.Cell><FileStatusBadge {file} /></DataTable.Cell>
      </DataTable.Row>
    {/each}
  </DataTable.Body>
</DataTable.Root>
