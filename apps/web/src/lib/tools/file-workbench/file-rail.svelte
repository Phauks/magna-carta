<script lang="ts">
  /*
   * The files on the workbench, as the product's one table.
   *
   * It sorts by name, type, size, when it arrived and what the scanner made of it; it filters, it
   * hides and reorders columns, it selects by click, shift-range and ctrl-toggle, and its footer
   * carries the count and the selection. None of that is decided here — it is DataTable.Grid, the
   * same table the matter's costs and bills are read in, so a person who has sorted one has sorted
   * this.
   *
   * DRAGGING FILES ONTO IT. The whole region is the drop target; there is no dashed box. A box
   * would either cover the rows or sit under them taking space, and the thing a person actually
   * drags onto is the list. The behaviour is DropTarget, which draws nothing — the region lights up
   * through its own border while a drag is over it.
   *
   * Each row carries its own menu, always drawn rather than appearing on hover: a row that changes
   * shape under the pointer is a row you cannot aim at.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Upload from "@lucide/svelte/icons/upload";
  import { scanStatus } from "./capabilities/malware-scan.ts";
  import { RAIL_COLUMNS, railColumns } from "./rail-columns.ts";
  import { DropTarget } from "./drop-target.svelte.ts";
  import { rowMenuItems, type RowMenuItem } from "./row-menu.ts";
  import { scanVerdictOf, type WorkbenchFile } from "./workbench-file.ts";

  let {
    files,
    selectedKeys = $bindable(),
    activeId = $bindable(),
    onFiles,
    onDiscard,
    onRowAction,
  }: {
    files: readonly WorkbenchFile[];
    /** The keys a bulk capability would act on. */
    selectedKeys: readonly string[];
    /** The file the panels describe. */
    activeId: string | null;
    onFiles: (dropped: File[]) => void;
    onDiscard: (ids: readonly string[]) => void;
    onRowAction: (item: RowMenuItem, file: WorkbenchFile) => void;
  } = $props();

  // Called through, not captured: `onFiles` is a prop and may be replaced.
  const dropTarget = new DropTarget((dropped) => onFiles(dropped));
  let picker = $state<HTMLInputElement | null>(null);

  const grid = DataTable.createDataTableGrid<WorkbenchFile>({
    columns: railColumns,
    rows: () => files,
    rowKey: (file) => file.id,
    // Newest last is how a person reads a bench they are adding to: the file they just dropped is
    // where they left it, not at the top pushing everything down.
    initialSort: { columnId: RAIL_COLUMNS.added, direction: "ascending" },
    itemNoun: { singular: "file", plural: "files" },
    onSelectionChange: (keys) => {
      selectedKeys = keys;
    },
  });

  // The grid owns selection; the surface reads which row is in focus off it. Focus rather than
  // "the first selected" because focus is where the reader's attention is, and it survives a range.
  $effect(() => {
    activeId = grid.selection.focus ?? grid.selectedKeys[0] ?? null;
  });

  // A file arriving on an empty bench selects itself. Somebody who drops a file has already said
  // which file they mean, and making them click it again to see what it is buys nothing.
  $effect(() => {
    const first = grid.rowsInView[0];
    if (first !== undefined && grid.selectedKeys.length === 0) grid.rowClick(first.id);
  });

  function pick(event: Event & { currentTarget: HTMLInputElement }): void {
    if (event.currentTarget.files) onFiles([...event.currentTarget.files]);
    // Cleared so picking the same file twice in a row still fires a change.
    event.currentTarget.value = "";
  }

  function runRowAction(item: RowMenuItem, file: WorkbenchFile): void {
    if (item.identifier === "discard") onDiscard([file.id]);
    else onRowAction(item, file);
  }
</script>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<WorkbenchFile>)}
  {#if column.id === RAIL_COLUMNS.name}
    <span class="flex min-w-0 items-center gap-8">
      <FileIcon fileName={row.name} contentType={row.declaredMediaType} size="sm" />
      <span class="block truncate" title={row.name}>{row.name}</span>
    </span>
  {:else if column.id === RAIL_COLUMNS.safety}
    {@const status = scanStatus(scanVerdictOf(row))}
    <Badge variant={status.tone} title={status.meaning}>{status.label}</Badge>
  {:else if column.id === RAIL_COLUMNS.actions}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class={buttonClasses({ variant: "ghost", size: "icon" })}
        title="What you can do with {row.name}"
        aria-label="What you can do with {row.name}"
      >
        <EllipsisVertical class="size-16" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        {#each rowMenuItems(row) as item (item.identifier)}
          {@const Icon = item.icon}
          <DropdownMenu.Item
            disabled={item.disabledReason !== undefined}
            title={item.disabledReason}
            onSelect={() => runRowAction(item, row)}
          >
            <Icon class="size-16" aria-hidden="true" />
            {item.label}
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {:else}
    <span class="block truncate" title={text}>{text}</span>
  {/if}
{/snippet}

{#snippet emptyBench()}
  <!-- Short on purpose: this sits in a narrow pane, and a paragraph here would be clipped by the
       column it lives in rather than read. What the workbench does and does not keep is said in the
       masthead, where there is room for it. -->
  <EmptyState title="Nothing on the Workbench">Drop a file here, or add one.</EmptyState>
{/snippet}

<div class="flex h-full min-h-0 flex-col border-e border-border-default">
  <div class="flex items-center gap-8 border-b border-border-default px-12 py-8">
    <Button variant="secondary" size="sm" onclick={() => picker?.click()}>
      <Upload class="size-16" aria-hidden="true" />
      Add Files
    </Button>
    <DataTable.GridColumnsMenu {grid} />
    {#if selectedKeys.length > 0}
      <Button
        variant="ghost"
        size="sm"
        class="ms-auto"
        onclick={() => onDiscard(selectedKeys)}
      >
        <Trash2 class="size-16" aria-hidden="true" />
        Discard
      </Button>
    {/if}
    <!-- The real control, off-screen but focusable through the button above it: a file picker is
         the one thing a page cannot open without a native input. -->
    <input
      bind:this={picker}
      type="file"
      multiple
      class="sr-only"
      aria-label="Add files to the workbench"
      onchange={pick}
    />
  </div>

  <!-- The drop region is the list itself. The border is the only thing that changes under a drag,
       so no row moves and nothing is covered. -->
  <div
    class="flex min-h-0 flex-1 flex-col border-2 border-transparent"
    class:border-accent-default={dropTarget.over}
    class:bg-accent-subtle={dropTarget.over}
    {...dropTarget.handlers}
  >
    <DataTable.Grid
      {grid}
      {cell}
      density="compact"
      caption="Files on the workbench"
      empty={emptyBench}
      class="min-h-0 flex-1"
    />
  </div>

  <DataTable.GridFooter {grid} />
</div>
