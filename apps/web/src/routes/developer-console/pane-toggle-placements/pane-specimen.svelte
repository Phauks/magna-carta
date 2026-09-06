<script lang="ts">
  /*
   * One surface, rendered several ways — the same real table and the same real pane frame, with the
   * pane toggles in a different place each time. Everything a placement can be judged on follows
   * from where the control sits, so the only things that vary between specimens are `placement`
   * and `surface`; the grid, the panes, the panel and the counts strip are shared.
   *
   * TWO SURFACES, because they are not the same problem. A LEDGER (Time, Fees, Costs, Billing) has
   * one pane and nothing else above its table, so a row for the toggle is a row the screen would
   * not otherwise draw. FILES has three panes and a toolbar it needs anyway — back, forward, up,
   * the breadcrumb, the search — so its toggles end a row that is already earned. The gallery has
   * to show both or it answers half the question.
   *
   * The panel's CONTENT is a stand-in rather than the shipping details panel or inspector. What is
   * under review is where a reader reaches to open a pane and what that reach costs the screen;
   * the real panels would drag four ledgers' worth of record types into a gallery about a button.
   *
   * The DETAILS PANEL'S TOGGLE is the shipping one — `DetailsPanel.Toggle`, the same component the
   * four ledgers and the file manager render. A gallery that drew its own copy would be comparing
   * placements for a button that does not exist, and would go stale the first time the real one
   * changed. The folder tree's glyph is written out here, as it is in the file manager's footer,
   * because one surface having one of them is not yet a component.
   */
  import { untrack } from "svelte";
  import Button from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Badge from "@magna-carta/design-system/badge";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import { createDataTableGrid, type GridColumn } from "@magna-carta/design-system/data-table";
  import * as Resizable from "@magna-carta/design-system/resizable";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import FunnelX from "@lucide/svelte/icons/funnel-x";
  import Search from "@lucide/svelte/icons/search";
  import * as DetailsPanel from "$lib/details-panel/index.ts";
  import PanelLeft from "@lucide/svelte/icons/panel-left";
  import { SPECIMEN_ENTRIES, type SpecimenEntry } from "./specimen-entries.ts";

  /**
   * Where this specimen puts the controls that show and hide the panes.
   *
   * - `row` — today: the surface's own row above the table. On a ledger that row exists for the
   *   toggle alone; on Files it is the toolbar, which the screen draws either way.
   * - `footer` — the inline end of the counts strip the table already draws, beside the figures.
   * - `edge` — pinned to each pane's own outer edge, over the surface rather than above it.
   * - `selection` — nowhere: selecting rows opens the details pane, letting go of them closes it.
   * - `band` — a slot in the screen's header band, beside the search and the create control.
   */
  export type PanePlacement = "row" | "footer" | "edge" | "selection" | "band";

  let {
    placement,
    surface = "ledger",
    railToggle = true,
    filtered = false,
  }: {
    placement: PanePlacement;
    /** `files` adds the folder rail and the toolbar the file manager draws above its list. */
    surface?: "ledger" | "files";
    /** Files only: whether the folder tree can be closed at all. False leaves it always open. */
    railToggle?: boolean;
    /** Renders under a filter, so the surface's other controls share the row with the toggle. */
    filtered?: boolean;
  } = $props();

  const COLUMNS: GridColumn<SpecimenEntry>[] = [
    { id: "workDate", label: "Date", type: "date", anchored: true, value: (row) => row.workDate },
    { id: "timekeeper", label: "Timekeeper", filter: "set", value: (row) => row.timekeeper },
    { id: "title", label: "Title", value: (row) => row.title },
    { id: "hours", label: "Hours", type: "number", total: "sum", value: (row) => row.hours },
    { id: "amount", label: "Amount", type: "money", total: "sum", value: (row) => row.amount },
    {
      id: "status",
      label: "Status",
      filter: "set",
      value: (row) => statusEntry(row.status).label,
    },
  ];

  const grid = createDataTableGrid<SpecimenEntry>({
    columns: () => COLUMNS,
    rows: () => SPECIMEN_ENTRIES,
    rowKey: (row) => row.id,
    initialSort: { columnId: "workDate", direction: "descending" },
    itemNoun: { singular: "entry", plural: "entries" },
  });
  /*
   * The filter is a fact about which specimen this is, not a state the specimen changes, so it is
   * read once at construction — untracked, to say that reading it here is the whole intent rather
   * than a missed reaction.
   */
  if (untrack(() => filtered)) {
    grid.setFilter("status", { kind: "set", values: ["Draft", "Submitted"] });
  }

  /*
   * Each specimen remembers its panes in memory only. The shipping surfaces persist this
   * (createPersistedPreference), which is a fact about the surface rather than about the placement,
   * and a gallery of them writing preferences would open in whatever state its last reader left it.
   */
  let openedByHand = $state(false);
  let railOpenState = $state(true);

  /*
   * Under the selection placement the details pane is not something the reader opens: it is what
   * having a row selected LOOKS like, so it follows the selection and nothing else.
   */
  const panelOpen = $derived(
    placement === "selection" ? grid.selectedKeys.length > 0 : openedByHand,
  );
  /** The rail is either closable and closed, or not closable and therefore open. */
  const railOpen = $derived(railToggle ? railOpenState : true);

  const isFiles = $derived(surface === "files");
  /** True where the surface draws a row above the table for reasons of its own. */
  const drawsRowAbove = $derived(isFiles || filtered || placement === "row");

  /*
   * The panes are told their share explicitly. Two of the three mount and unmount as the toggles
   * are pressed, and a pane group left to infer the middle pane's size hands the freed width back
   * proportionally — so closing the folder tree would visibly widen the details panel instead of
   * giving the list what it just gained.
   */
  const RAIL_SIZE = 22;
  const PANEL_SIZE = 28;
  const listSize = $derived(
    100 - (isFiles && railOpen ? RAIL_SIZE : 0) - (panelOpen ? PANEL_SIZE : 0),
  );
</script>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<SpecimenEntry>)}
  {#if column.id === "status"}
    <Badge {...statusBadgeAttributes(row.status)}>{statusEntry(row.status).label}</Badge>
  {:else}
    {text}
  {/if}
{/snippet}

{#snippet railGlyph()}
  <Button
    variant="ghost"
    size="icon-sm"
    aria-pressed={railOpen}
    title={railOpen ? "Hide the folder tree" : "Show the folder tree"}
    aria-label={railOpen ? "Hide the folder tree" : "Show the folder tree"}
    onclick={() => (railOpenState = !railOpenState)}
  >
    <PanelLeft class="size-16" aria-hidden="true" />
  </Button>
{/snippet}

{#snippet panelGlyph()}
  <DetailsPanel.Toggle open={panelOpen} onToggle={() => (openedByHand = !openedByHand)} />
{/snippet}

<!-- Both glyphs, in the order the panes they open sit on the screen. -->
{#snippet bothGlyphs()}
  {#if isFiles && railToggle}
    {@render railGlyph()}
  {/if}
  {@render panelGlyph()}
{/snippet}

{#snippet paneBody()}
  <div class="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-12">
    <FieldLabel as="p">Details</FieldLabel>
    {#if grid.selectedKeys.length === 0}
      <p class="text-sm text-text-muted">
        Nothing selected. The panel speaks for the matter until a row is chosen.
      </p>
    {:else}
      <p class="text-sm text-text-default">
        {grid.selectedKeys.length}
        {grid.selectedKeys.length === 1 ? "entry" : "entries"} selected.
      </p>
    {/if}
  </div>
{/snippet}

<!-- A fixed height, so the specimens can be compared: what a placement costs is height taken from
     the table, and a surface free to grow would hide exactly that — every specimen would simply be
     as tall as its own chrome plus ten rows. The height is a token rather than a number, and it is
     stated inline because the spacing scale tops out well below it (the record context's width,
     borrowed as a height, is about what a ledger gets between the matter header and the fold). -->
<div
  class="flex flex-col rounded-md border border-border-default bg-surface-default"
  style="block-size: var(--mc-size-record-context)"
>
  {#if placement === "band"}
    <!-- Standing in for the matter's header band: the search and the create control share its
         inline end on every section, and the toggles join them there instead of each section
         growing chrome of its own. -->
    <div class="flex items-center justify-between gap-8 border-b border-border-default px-12 py-8">
      <FieldLabel>Matter 2026-0147 · {isFiles ? "Files" : "Time"}</FieldLabel>
      <span class="flex items-center gap-8">
        <span
          class="flex h-32 items-center gap-4 rounded-md border border-border-default px-12 text-xs text-text-muted"
        >
          <Search class="size-12" aria-hidden="true" />
          Search this matter
        </span>
        <Button variant="secondary">New {isFiles ? "File" : "Time"}</Button>
        {@render bothGlyphs()}
      </span>
    </div>
  {/if}

  {#if drawsRowAbove}
    <div
      class="flex flex-none flex-wrap items-center gap-4 border-b border-border-default px-8 py-4"
    >
      {#if isFiles}
        <!-- The toolbar Files draws whatever else is true: the way back through the tree, the
             breadcrumb, the search. This is the row the ledgers copied a button out of without
             copying the row it was standing in. -->
        <Button variant="ghost" size="icon" title="Back" aria-label="Back">
          <ArrowLeft class="size-16" aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon" title="Forward" aria-label="Forward">
          <ArrowRight class="size-16" aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon" title="Up" aria-label="Up">
          <ArrowUp class="size-16" aria-hidden="true" />
        </Button>
        <span class="min-w-0 flex-1 truncate px-8 text-sm">Pleadings / Motion to Compel</span>
        <Button variant="ghost" size="icon" title="Search these files" aria-label="Search">
          <Search class="size-16" aria-hidden="true" />
        </Button>
      {:else}
        <span class="flex-1"></span>
      {/if}
      {#if filtered}
        <Button variant="secondary" size="sm" onclick={() => grid.clearAllFilters()}>
          <FunnelX class="size-16" aria-hidden="true" />
          Clear Filters
        </Button>
      {/if}
      {#if placement === "row"}
        {@render bothGlyphs()}
      {/if}
    </div>
  {/if}

  <!-- The frame is positioned only so the edge placement has something to pin to; every other
       specimen is unaffected by it. -->
  <div class="relative flex min-h-0 flex-1 flex-col">
    <Resizable.PaneGroup
      direction="horizontal"
      autoSaveId={`pane-toggle-${surface}-${placement}-${String(railToggle)}`}
      class="min-h-0 flex-1"
    >
      {#if isFiles && railOpen}
        <Resizable.Pane
          defaultSize={RAIL_SIZE}
          minSize={12}
          maxSize={36}
          class="flex min-h-0 flex-col"
        >
          <!-- The sunken surface sets the rail apart from the list, as the file manager's does. -->
          <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-surface-sunken p-8">
            {#each ["Pleadings", "Discovery", "Correspondence", "Exhibits", "Research"] as folder (folder)}
              <span class="truncate rounded-sm px-8 py-4 text-sm text-text-default">{folder}</span>
            {/each}
          </div>
        </Resizable.Pane>
        <Resizable.Handle />
      {/if}

      <Resizable.Pane defaultSize={listSize} minSize={30} class="flex min-h-0 flex-col">
        <DataTable.Grid {grid} {cell} class="min-h-0 flex-1" caption="Entries on this matter" />
      </Resizable.Pane>

      {#if panelOpen}
        <Resizable.Handle />
        <Resizable.Pane
          defaultSize={PANEL_SIZE}
          minSize={18}
          maxSize={44}
          class="flex min-h-0 flex-col"
        >
          {@render paneBody()}
        </Resizable.Pane>
      {/if}
    </Resizable.PaneGroup>

    {#if placement === "edge"}
      <!-- Each glyph on the outer edge of the pane it moves, centred: the control sits where the
           pane arrives from, so it costs the screen no height and reads as part of the boundary
           rather than as an act on the records. -->
      {#if isFiles && railToggle}
        <div class="absolute inset-y-0 start-0 flex items-center ps-4">
          {@render railGlyph()}
        </div>
      {/if}
      <div class="absolute inset-y-0 end-0 flex items-center pe-4">
        {@render panelGlyph()}
      </div>
    {/if}
  </div>

  <DataTable.GridFooter {grid} class="border-t border-border-default">
    {#snippet end()}
      <span class="inline-flex items-baseline gap-4">
        <span class="text-text-subtle">Recorded</span>
        <span class="font-semibold tabular-nums">$6,262.50</span>
      </span>
      {#if placement === "footer"}
        {@render bothGlyphs()}
      {/if}
    {/snippet}
  </DataTable.GridFooter>
</div>
