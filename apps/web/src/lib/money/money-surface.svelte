<script lang="ts" generics="TRow">
  /*
   * The one surface every money section renders inside.
   *
   * Time, Fees, Costs and Billing were four tables that looked good and looked different: each
   * drew its own frame, its own row above the table, its own counts strip and its own pane toggle,
   * and the owner preferred the file manager, where the controls and the table start at the top
   * and are connected up there. This is that arrangement, once, for the five money sub-parts, so
   * a ledger declares its columns, its cells, its panel and its figures and decides nothing about
   * the frame around them. A ledger that draws any of this for itself is the defect this file
   * exists to remove.
   *
   * THE ANATOMY, top to bottom, inside the list column: the money toolbar (money-toolbar.svelte),
   * the notices band, the list, whatever the ledger puts beneath the list (Time and Costs load
   * more from there), and the counts strip whose end carries the ledger's figures and then, last
   * on the line, the details-panel toggle. The details panel runs the full height beside the
   * column, through the same panes the ledgers already shared.
   *
   * TWO DRESSINGS, ONE ANATOMY, and the reader picks. FLUSH is the file manager's: the horizontal
   * margins cancel the work canvas's padding and the top one cancels the gap under the section
   * strip, so the toolbar sits directly under the tabs, the grid gives up its rounded frame, and
   * the toolbar and counts strip carry the rules. FRAMED is the ledgers' earlier look plus the
   * toolbar: inside the page's padding, the grid keeps its frame, and the column's gap does the
   * spacing. Both settings are stored under one key for all five sections, because the point is
   * that they look the same.
   *
   * IT TAKES THE REST OF THE SCREEN AND KEEPS IT, through FullHeightSection: the list scrolls
   * inside itself and the counts strip stays on the bottom of the screen whatever arrives.
   */
  import type { Snippet } from "svelte";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import type { DataTableGridState } from "@magna-carta/design-system/data-table";
  import FullHeightSection from "$lib/components/full-height-section.svelte";
  import * as DetailsPanel from "$lib/details-panel/index.ts";
  import { LedgerPanes } from "$lib/records/index.ts";
  import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
  import MoneyToolbar from "./money-toolbar.svelte";
  import {
    moneySurfaceDensityPreference,
    moneySurfaceLayoutPreference,
    type MoneySectionSlug,
    type MoneySurfaceDensity,
  } from "./money-sections.ts";

  let {
    matterId,
    section,
    grid,
    autoSaveId,
    panelOpen = false,
    onTogglePanel,
    panelSize = undefined,
    panelMinSize = undefined,
    panelMaxSize = undefined,
    acts = undefined,
    notices = undefined,
    list,
    panel,
    beneath = undefined,
    figures = undefined,
  }: {
    /** For the toolbar's sub-part links. */
    matterId: string;
    /** Which of the five this surface is. */
    section: MoneySectionSlug;
    /** The ledger's grid: the counts strip and the way out of a filter read it. */
    grid: DataTableGridState<TRow>;
    /** Where this surface's pane layout is remembered. One id per surface, never shared. */
    autoSaveId: string;
    /** Whether the details pane is showing. The ledger keeps the preference; this renders it. */
    panelOpen?: boolean;
    /** Called with what the panel should become. */
    onTogglePanel: (open: boolean) => void;
    panelSize?: number;
    panelMinSize?: number;
    panelMaxSize?: number;
    /** The ledger's own acts on the toolbar, after Clear Filters. */
    acts?: Snippet;
    /** Failure and notice alerts, and a ledger's standing line. Pass it only when it has content. */
    notices?: Snippet;
    /**
     * The list. It receives the density and the class the grid must wear in the current layout,
     * and passes both to its DataTable.Grid.
     */
    list: Snippet<[{ density: MoneySurfaceDensity; tableClass: string; frame: "card" | "flush" }]>;
    /** The details beside the list. */
    panel: Snippet;
    /** Directly above the counts strip: a Load more control, an archive line. */
    beneath?: Snippet;
    /** The counts strip's trailing figures, ahead of the pane toggle. */
    figures?: Snippet;
  } = $props();

  /*
   * The reader's two view settings. Read here rather than handed down, so a ledger cannot hold a
   * layout of its own; a change in another tab lands here through the follower.
   */
  const layoutPreference = createPersistedPreference(moneySurfaceLayoutPreference());
  const densityPreference = createPersistedPreference(moneySurfaceDensityPreference());
  $effect(() => layoutPreference.followAcrossTabs());
  $effect(() => densityPreference.followAcrossTabs());

  const layout = $derived(layoutPreference.current);
  const density = $derived(densityPreference.current);
  const flush = $derived(layout === "flush");

  /*
   * Flush, the grid gives up its rounded frame and its border: the toolbar's rule above and the
   * counts strip's rule below are the frame, and a second one inside them drew a box within a box.
   * That is the grid's own `frame` prop rather than two utilities spelling it out here, because
   * giving up the card changes more than the paint — the last row's hairline goes with it if
   * nothing says the card is gone. The class is left holding only what it is for: the height.
   */
  const tableClass = "min-h-0 flex-1";
  const frame = $derived<"card" | "flush">(flush ? "flush" : "card");
</script>

{#snippet footerEnd()}
  {#if figures}
    {@render figures()}
  {/if}
  <!-- The toggle ends the strip, after the figures: the last thing on the line, on every surface
       in the product that has a panel. -->
  <DetailsPanel.Toggle open={panelOpen} onToggle={onTogglePanel} />
{/snippet}

<!-- The list COLUMN: everything the surface stacks above and below the ledger's own list, in one
     flex chain so the height reaches the grid. Framed, the gap spaces the parts; flush, the parts
     carry their own rules and gutters. Named apart from the `list` prop it renders, so the two
     cannot be confused for one another. -->
{#snippet column()}
  <div class={flush ? "flex min-h-0 flex-1 flex-col" : "flex min-h-0 flex-1 flex-col gap-12"}>
    <MoneyToolbar
      {matterId}
      {section}
      {grid}
      {acts}
      {layout}
      {density}
      onLayoutChange={(next) => layoutPreference.set(next)}
      onDensityChange={(next) => densityPreference.set(next)}
    />

    {#if notices}
      {#if flush}
        <div class="p-12">
          {@render notices()}
        </div>
      {:else}
        {@render notices()}
      {/if}
    {/if}

    {@render list({ density, tableClass, frame })}

    {#if beneath}
      {#if flush}
        <div class="border-t border-border-default px-12 py-8">
          {@render beneath()}
        </div>
      {:else}
        {@render beneath()}
      {/if}
    {/if}

    <DataTable.GridFooter
      {grid}
      end={footerEnd}
      class={flush ? "border-t border-border-default" : undefined}
    />
  </div>
{/snippet}

<FullHeightSection class={flush ? "-mx-24 -mt-24" : undefined}>
  <LedgerPanes
    {autoSaveId}
    {panelOpen}
    {panelSize}
    {panelMinSize}
    {panelMaxSize}
    list={column}
    {panel}
  />
</FullHeightSection>
