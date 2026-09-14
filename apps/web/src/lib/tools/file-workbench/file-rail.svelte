<script lang="ts">
  /*
   * The files on the workbench, as the product's one table.
   *
   * It sorts by name, type, size and when it arrived; it filters, it hides and reorders columns, it
   * selects by click, shift-range and ctrl-toggle, and its footer carries the count and the
   * selection. None of that is decided here — it is DataTable.Grid, the same table the matter's
   * costs and bills are read in, so a person who has sorted one has sorted this.
   *
   * IT STARTS AT THE TOP. The controls that used to sit in a strip above it — adding files — are
   * the screen's, not the list's, and they live in the masthead with everything else that acts on
   * the whole surface. The column controls are not on the screen at all: they are summoned by
   * right-clicking a heading. What is left here is the list, which is what the pane is for,
   * beginning where the pane begins.
   *
   * DRAGGING FILES ONTO IT. The whole region is the drop target; there is no dashed box. A box
   * would either cover the rows or sit under them taking space, and the thing a person actually
   * drags onto is the list. The behaviour is DropTarget, which draws nothing — the region lights up
   * through its own border while a drag is over it.
   *
   * ONE MENU, TWO GESTURES. Each row's triple-dot button and a right-click on the row open the same
   * decided list (row-menu.ts). Discarding a file is that file's own verb and lives only there:
   * a standing Discard button above the list acts on whatever happens to be selected, and that is
   * the button that throws away the wrong thing.
   */
  import * as ContextMenu from "@magna-carta/design-system/context-menu";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Badge from "@magna-carta/design-system/badge";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
  import Upload from "@lucide/svelte/icons/upload";
  import { scanStatus } from "./capabilities/malware-scan.ts";
  import { RAIL_COLUMNS } from "./rail-columns.ts";
  import { DropTarget } from "./drop-target.svelte.ts";
  import { rowMenuItems, type RowMenuItem } from "./row-menu.ts";
  import { scanVerdictOf, type WorkbenchFile } from "./workbench-file.ts";

  let {
    grid,
    files,
    onFiles,
    onDiscard,
    onRowAction,
    onAddFiles,
  }: {
    /** The grid, created by the screen because the screen reads and drives its selection. */
    grid: DataTable.DataTableGridState<WorkbenchFile>;
    files: readonly WorkbenchFile[];
    onFiles: (dropped: File[]) => void;
    onDiscard: (ids: readonly string[]) => void;
    onRowAction: (item: RowMenuItem, file: WorkbenchFile) => void;
    /** Open the file picker. The right-click menu offers it on the empty space below the rows. */
    onAddFiles: () => void;
  } = $props();

  // Called through, not captured: `onFiles` is a prop and may be replaced.
  const dropTarget = new DropTarget((dropped) => onFiles(dropped));
  // Which row a right-click landed on. The grid re-targets its selection first and then tells us,
  // so the menu speaks for the row under the pointer rather than for whatever was selected before.
  let contextTarget = $state<WorkbenchFile | null>(null);

  /** Point the menu at the row under the pointer, and select it if it was not already. */
  function retarget(event: MouseEvent): void {
    const element = event.target instanceof Element ? event.target.closest("[data-grid-row]") : null;
    const key = element?.getAttribute("data-grid-row") ?? null;
    // Null on the empty space below the rows, which is a real place to right-click: the menu offers
    // adding a file there rather than the previous row's verbs.
    contextTarget = key === null ? null : (files.find((file) => file.id === key) ?? null);
    if (key !== null && !grid.isSelected(key)) grid.rowClick(key, { repeated: true });
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


<div class="flex h-full min-h-0 flex-col">
  <!-- The drop region is the list itself. The border is the only thing that changes under a drag,
       so no row moves and nothing is covered. -->
  <div
    class="flex min-h-0 flex-1 flex-col rounded-md border-2 border-transparent"
    class:border-accent-default={dropTarget.over}
    class:bg-accent-subtle={dropTarget.over}
    {...dropTarget.handlers}
  >
    <ContextMenu.Root>
      <ContextMenu.Trigger class="flex min-h-0 flex-1 flex-col">
        <!-- The re-target reads which row the pointer was over and does NOT swallow the event, so
             the menu that opens is still the product's. The grid's own `onRowContextMenu` cannot be
             used for this: it calls preventDefault, which stops the very menu it is meant to
             summon. The element is presentational — it adds no semantics, it only notices where
             the pointer was. -->
        <div role="presentation" class="flex min-h-0 flex-1 flex-col" oncontextmenu={retarget}>
          <DataTable.Grid
            {grid}
            {cell}
            density="compact"
            caption="Files on the workbench"
            class="min-h-0 flex-1"
          />
        </div>
      </ContextMenu.Trigger>
      <!-- Mounted whatever the target is: the menu opens before anything could conditionally render
           it, so a menu behind an `{#if}` on the row simply never appears. Right-clicking the empty
           space below the rows is not nothing either — it is where a person reaches to add one. -->
      <ContextMenu.Content>
        {#if contextTarget === null}
          <ContextMenu.Item onSelect={onAddFiles}>
            <Upload class="size-16" aria-hidden="true" />
            Add Files
          </ContextMenu.Item>
        {:else}
          {@const target = contextTarget}
          {#each rowMenuItems(target) as item (item.identifier)}
            {@const Icon = item.icon}
            <ContextMenu.Item
              disabled={item.disabledReason !== undefined}
              title={item.disabledReason}
              onSelect={() => runRowAction(item, target)}
            >
              <Icon class="size-16" aria-hidden="true" />
              {item.label}
            </ContextMenu.Item>
          {/each}
        {/if}
      </ContextMenu.Content>
    </ContextMenu.Root>
  </div>

  <DataTable.GridFooter {grid} />
</div>
