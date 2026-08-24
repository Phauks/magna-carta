<script lang="ts">
  /*
   * The file list: the matter's files in the folder being shown, in the columns the reader chose,
   * sorted by the column they clicked, with a right-click menu over the table.
   *
   * Selection is a Set of file ids rather than one id, because every action worth having here —
   * download these, move these, delete these — applies to more than one file, and a list that can
   * only hold one selection forces a person to repeat themselves.
   *
   * One ContextMenu covers the whole table rather than one per row. ContextMenu.Trigger renders its
   * own element and a <div> cannot sit inside a <tbody>, so the row a right-click landed on is
   * recorded from the event and the menu acts on that.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as ContextMenu from "@magna-carta/design-system/context-menu";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import Columns3 from "@lucide/svelte/icons/columns-3";
  import type { DocumentSummary } from "$lib/documents/document-api.ts";
  import {
    documentStatusPresentation,
    formatDocumentSize,
    formatDocumentTimestamp,
  } from "$lib/documents/document-presentation.ts";
  import {
    FILE_COLUMNS,
    fileTypeExtension,
    sortDocuments,
    type FileColumnKey,
    type SortDirection,
  } from "./file-columns.ts";

  let {
    documents,
    selection = $bindable(),
    activeId = $bindable(),
    onOpen,
    onRename,
    onDelete,
    onDownload,
  }: {
    documents: readonly DocumentSummary[];
    selection: Set<string>;
    /** The row the details panel is describing. */
    activeId: string | null;
    onOpen: (document: DocumentSummary) => void;
    onRename: (document: DocumentSummary) => void;
    onDelete: (ids: readonly string[]) => void;
    onDownload: (ids: readonly string[]) => void;
  } = $props();

  let sortKey = $state<FileColumnKey>("name");
  let sortDirection = $state<SortDirection>(1);
  let shownKeys = $state<Set<FileColumnKey>>(
    new Set(FILE_COLUMNS.filter((column) => column.on).map((column) => column.key)),
  );
  let contextTargetId = $state<string | null>(null);

  const columns = $derived(
    FILE_COLUMNS.filter((column) => column.always === true || shownKeys.has(column.key)),
  );
  const rows = $derived(sortDocuments(documents, sortKey, sortDirection));
  const allSelected = $derived(rows.length > 0 && selection.size >= rows.length);
  const contextTarget = $derived(rows.find((row) => row.id === contextTargetId) ?? null);
  /** The menu acts on the selection when the right-clicked row is in it, and on that row if not. */
  const contextTargets = $derived(
    contextTargetId === null
      ? []
      : selection.has(contextTargetId)
        ? [...selection]
        : [contextTargetId],
  );

  function sortBy(key: FileColumnKey): void {
    // A second click on the same column reverses it; a different column starts ascending, because
    // carrying the previous column's direction over surprises people.
    if (sortKey === key) sortDirection = sortDirection === 1 ? -1 : 1;
    else {
      sortKey = key;
      sortDirection = 1;
    }
  }

  function toggleColumn(key: FileColumnKey): void {
    const next = new Set(shownKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    shownKeys = next;
  }

  function selectRow(document: DocumentSummary, event: MouseEvent): void {
    const additive = event.ctrlKey || event.metaKey;
    const next = additive ? new Set(selection) : new Set<string>();
    if (additive && next.has(document.id)) next.delete(document.id);
    else next.add(document.id);
    selection = next;
    // Letting go of the row the panel is describing has to reach the panel; leaving it there reads
    // as the click not having worked.
    activeId = next.has(document.id) ? document.id : ([...next].at(-1) ?? null);
  }

  function onRowContextMenu(document: DocumentSummary): void {
    contextTargetId = document.id;
    if (!selection.has(document.id)) {
      selection = new Set([document.id]);
      activeId = document.id;
    }
  }

  function toggleAll(): void {
    if (allSelected) {
      selection = new Set();
      activeId = null;
      return;
    }
    selection = new Set(rows.map((row) => row.id));
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="flex items-center justify-end gap-8 border-b border-border-default px-8 py-4">
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class={buttonClasses({ variant: "ghost", size: "icon" })}
        aria-label="Choose columns"
        title="Choose columns"
      >
        <Columns3 class="size-16" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.GroupHeading>Columns</DropdownMenu.GroupHeading>
        {#each FILE_COLUMNS.filter((column) => column.always !== true) as column (column.key)}
          <DropdownMenu.CheckboxItem
            checked={shownKeys.has(column.key)}
            onCheckedChange={() => toggleColumn(column.key)}
          >
            {column.label}
          </DropdownMenu.CheckboxItem>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>

  <div class="min-h-0 flex-1 overflow-auto">
    {#if rows.length === 0}
      <EmptyState title="Nothing in this folder">
        Files put here will appear in this list. Everything on the matter is still reachable from
        Home, whichever folder it sits in.
      </EmptyState>
    {:else}
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          <DataTable.Root>
            <DataTable.Caption class="sr-only">Files in this folder</DataTable.Caption>
            <DataTable.Header>
              <DataTable.Row>
                {#each columns as column (column.key)}
                  <DataTable.Head
                    data-align={column.right === true ? "end" : undefined}
                    aria-sort={sortKey === column.key
                      ? sortDirection === 1
                        ? "ascending"
                        : "descending"
                      : "none"}
                  >
                    <button
                      type="button"
                      class="inline-flex items-center gap-4"
                      onclick={() => sortBy(column.key)}
                    >
                      {column.label}
                      {#if sortKey === column.key}
                        {#if sortDirection === 1}
                          <ArrowUp class="size-12" aria-hidden="true" />
                        {:else}
                          <ArrowDown class="size-12" aria-hidden="true" />
                        {/if}
                      {/if}
                    </button>
                  </DataTable.Head>
                {/each}
              </DataTable.Row>
            </DataTable.Header>
            <DataTable.Body>
              {#each rows as document (document.id)}
                {@const status = documentStatusPresentation(document)}
                <DataTable.Row
                  data-state={selection.has(document.id) ? "selected" : undefined}
                  onclick={(event: MouseEvent) => selectRow(document, event)}
                  ondblclick={() => onOpen(document)}
                  oncontextmenu={() => onRowContextMenu(document)}
                >
                  {#each columns as column (column.key)}
                    <DataTable.Cell data-align={column.right === true ? "end" : undefined}>
                      {#if column.key === "name"}
                        <span class="inline-flex items-center gap-8">
                          <FileIcon
                            contentType={document.sniffedContentType ?? undefined}
                            fileName={document.name}
                            class="size-16"
                          />
                          {document.name}
                        </span>
                      {:else if column.key === "fileType"}
                        {fileTypeExtension(document)}
                      {:else if column.key === "safety"}
                        {#if status === null}
                          <span class="text-text-muted">No issues found</span>
                        {:else}
                          <Badge variant={status.variant}>{status.label}</Badge>
                        {/if}
                      {:else if column.key === "version"}
                        v{document.versionNumber}
                      {:else if column.key === "size"}
                        {formatDocumentSize(document.sizeBytes)}
                      {:else if column.key === "created"}
                        {formatDocumentTimestamp(document.createdAt)}
                      {:else}
                        {formatDocumentTimestamp(document.updatedAt)}
                      {/if}
                    </DataTable.Cell>
                  {/each}
                </DataTable.Row>
              {/each}
            </DataTable.Body>
          </DataTable.Root>
        </ContextMenu.Trigger>
        <ContextMenu.Content>
          {#if contextTarget !== null}
            <ContextMenu.Item onSelect={() => onOpen(contextTarget)}>Open</ContextMenu.Item>
            <ContextMenu.Item onSelect={() => onDownload(contextTargets)}>
              Download{contextTargets.length > 1 ? ` ${contextTargets.length} files` : ""}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onSelect={() => onRename(contextTarget)}>Rename</ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onSelect={() => onDelete(contextTargets)}>
              Delete{contextTargets.length > 1 ? ` ${contextTargets.length} files` : ""}
            </ContextMenu.Item>
          {/if}
        </ContextMenu.Content>
      </ContextMenu.Root>
    {/if}
  </div>

  <div
    class="flex items-center gap-12 border-t border-border-default px-12 py-4 text-xs text-text-muted"
  >
    <span>{rows.length} file{rows.length === 1 ? "" : "s"}</span>
    {#if selection.size > 0}
      <span><strong>{selection.size}</strong> selected</span>
    {/if}
    <!-- One control, and it says what pressing it will do. Two buttons meant one of them was always
         the wrong one to press. -->
    <Button
      variant="ghost"
      size="sm"
      class="ml-auto"
      disabled={rows.length === 0}
      onclick={toggleAll}
    >
      {allSelected ? "Select none" : "Select all"}
    </Button>
  </div>
</div>
