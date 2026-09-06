<script lang="ts">
  /*
   * The source table — the files of one upload as the product's one grid, nested the way they sit
   * on the reader's disk, each row saying where it stands.
   *
   * It is one component because it is read in two places: inside the Upload dialog while a batch
   * is chosen and started, and on the Uploads page afterwards, where every batch this tab is
   * running is laid out in full. Two tables would be two answers to "what does an upload look
   * like"; the rulings ledger records what this one looks like, once.
   *
   * The grid is built here and stays here. What a caller needs of it — which rows are selected,
   * and a way to clear them — comes out through `onSelectionChange` and the exported clear, so no
   * caller reaches into the grid's state and two callers cannot drift in how they use it.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import type { GridColumn } from "@magna-carta/design-system/data-table";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import FolderGlyph from "@magna-carta/design-system/folder-glyph";
  import type { DroppedEntry } from "@magna-carta/design-system/dropzone";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CopyCheck from "@lucide/svelte/icons/copy-check";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import {
    intakeColumns,
    intakePhrase,
    intakeRows,
    intakeStageSentence,
    orderIntakeRows,
    type IntakeProgress,
    type IntakeRow,
  } from "./upload-intake.ts";

  let {
    entries,
    progress,
    expanded = $bindable(new Set<string>()),
    caption,
    emptyTitle = "Nothing chosen yet",
    emptyLine = "",
    selectable = true,
    onSelectionChange,
    class: className = "",
  }: {
    entries: readonly DroppedEntry[];
    progress: ReadonlyMap<string, IntakeProgress>;
    /** The folder paths showing their contents. Bindable; the caller seeds it as files arrive. */
    expanded?: Set<string>;
    caption: string;
    emptyTitle?: string;
    emptyLine?: string;
    /** Whether rows may be selected (a batch that has started has nothing to select for). */
    selectable?: boolean;
    onSelectionChange?: (keys: readonly string[]) => void;
    class?: string;
  } = $props();

  function toggleFolder(path: string): void {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    expanded = next;
  }

  // The grid's own filter state decides the shape of its rows and columns, so both thunks read it
  // back off the grid — through a reference filled in right after construction, because the state
  // calls `columns()` once while it is being built, before the constant below exists.
  let built: DataTable.DataTableGridState<IntakeRow> | null = null;
  const filtering = (): boolean => built?.isFiltered ?? false;
  const grid = DataTable.createDataTableGrid<IntakeRow>({
    columns: (): GridColumn<IntakeRow>[] => intakeColumns({ filtering: filtering() }),
    // A filter flattens the tree to the files that answer it (upload-intake.ts says why).
    rows: () => intakeRows(entries, progress, filtering() ? null : expanded),
    rowKey: (row) => row.key,
    itemNoun: { singular: "item", plural: "items" },
    orderRows: orderIntakeRows,
    onActivate: (row) => {
      if (row.kind === "folder") toggleFolder(row.path);
    },
    onSelectionChange: (keys) => onSelectionChange?.(keys),
  });
  built = grid;

  export function clearSelection(): void {
    grid.clearSelection();
  }
</script>

<div class="flex min-h-0 grow flex-col {className}">
  <DataTable.Grid
    {grid}
    {cell}
    {caption}
    empty={emptyIntake}
    density="compact"
    class="min-h-0 grow rounded-b-none"
  />
  <DataTable.GridFooter
    {grid}
    tallyText={intakePhrase(entries)}
    selectAllToggle={selectable}
    class="rounded-b-md border border-t-0 border-border-default"
  />
</div>

{#snippet emptyIntake()}
  <EmptyState title={emptyTitle}>
    {emptyLine}
  </EmptyState>
{/snippet}

{#snippet cell({ row, column, text }: DataTable.GridCellContext<IntakeRow>)}
  {#if column.id === "name"}
    <!-- The indent is one tree step per level, the same measure the folder rail steps by. -->
    <span
      class="flex min-w-0 items-center gap-4"
      style="padding-inline-start: calc(var(--mc-space-16) * {row.depth})"
    >
      {#if row.kind === "folder"}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-expanded={row.expanded}
          aria-label={row.expanded ? `Collapse ${row.name}` : `Expand ${row.name}`}
          onclick={(event: MouseEvent) => {
            event.stopPropagation();
            toggleFolder(row.path);
          }}
        >
          {#if row.expanded}
            <ChevronDown class="size-16" aria-hidden="true" />
          {:else}
            <ChevronRight class="size-16" aria-hidden="true" />
          {/if}
        </Button>
        <FolderGlyph class="size-16 shrink-0" />
      {:else}
        <!-- A file has no twisty; the same width keeps its glyph in the folder glyph's column. -->
        <span class="inline-block size-24 shrink-0" aria-hidden="true"></span>
        <FileIcon
          contentType={row.entry.file.type === "" ? undefined : row.entry.file.type}
          fileName={row.name}
          class="size-16 shrink-0"
        />
      {/if}
      <span
        class="truncate"
        title={row.kind === "file" ? row.entry.relativePath || row.name : row.path}
      >
        {text}
      </span>
    </span>
  {:else if column.id === "status" && row.kind === "file"}
    <span class="flex items-center gap-8" title={intakeStageSentence(row)}>
      {#if row.stage === "settled"}
        <CircleCheck
          class="size-16 shrink-0 text-status-success-subtle-foreground"
          aria-hidden="true"
        />
      {:else if row.stage === "already"}
        <CopyCheck class="size-16 shrink-0 text-text-subtle" aria-hidden="true" />
      {:else if row.stage === "failed"}
        <CircleAlert
          class="size-16 shrink-0 text-status-danger-subtle-foreground"
          aria-hidden="true"
        />
      {:else if row.stage !== "chosen" && row.stage !== "cancelled"}
        <LoaderCircle class="size-16 shrink-0 text-text-subtle" aria-hidden="true" />
      {/if}
      <span
        class={row.stage === "chosen" || row.stage === "cancelled" || row.stage === "already"
          ? "text-text-subtle"
          : undefined}
      >
        {text}
      </span>
    </span>
  {:else}
    {text}
  {/if}
{/snippet}
