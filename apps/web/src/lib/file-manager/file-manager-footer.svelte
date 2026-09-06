<script lang="ts" generics="TRow">
  /*
   * The counts strip: how much is here, how much is selected, what a filter is hiding — and, at the
   * far end, the controls that belong beside the counts rather than beside Back and Forward.
   *
   * UNDO AND REDO LIVE HERE, away from the navigation controls. The pair is the design system's
   * `UndoRedoControls` over this surface's own stack: this file decides only WHERE it sits, never
   * how it behaves, what it says, or what it wears. They cover MOVEMENT — drag-and-drop, cut and
   * paste, a move between folders — which is the class of act a pointer performs by accident.
   *
   * THE SCALE CONTROL carries no visible text label: the meaning is implied by the two glyphs and
   * the figure between them, and the name lives on the hover and on the accessible name, where a
   * keyboard or a screen reader still reaches it.
   *
   * THE TWO PANE TOGGLES END THE STRIP (owner's ruling, 2026-09-03). They were the last things on
   * the toolbar, which is a row this screen draws anyway — so this surface never had the complaint
   * that moved them, which was that the four financial ledgers each grew a ROW to hold one glyph.
   * They came down here regardless, because a reader should not have to remember that the answer is
   * at the top of one screen and the bottom of four others. The folder tree keeps its toggle for now.
   *
   * EVERY GLYPH IN THIS BAND IS THE SMALL SQUARE. One band wears one chrome, and the small square is
   * the one that fits inside the strip's own height rather than pushing it four points taller.
   */
  import type { Snippet } from "svelte";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Button from "@magna-carta/design-system/button";
  import UndoRedoControls, { type HistoryOutcome } from "@magna-carta/design-system/history";
  import ZoomIn from "@lucide/svelte/icons/zoom-in";
  import ZoomOut from "@lucide/svelte/icons/zoom-out";
  import type { DataTableGridState } from "@magna-carta/design-system/data-table";
  import * as DetailsPanel from "$lib/details-panel/index.ts";
  import PanelLeft from "@lucide/svelte/icons/panel-left";
  import { SCALE_STEPS, type FileManagerState } from "./file-manager-state.svelte.ts";

  let {
    manager,
    grid,
    tally = undefined,
    extras = undefined,
    onHistoryOutcome = undefined,
    onToggleRail,
    onTogglePanel,
  }: {
    manager: FileManagerState;
    grid: DataTableGridState<TRow>;
    /** The surface's own unfiltered tally ("2 folders, 5 files"), replacing the bare item count. */
    tally?: string;
    /** A view's own trailing controls, ahead of undo/redo — a view-specific act's home. */
    extras?: Snippet;
    /** What a walk came to, for the surface to say. */
    onHistoryOutcome?: (outcome: HistoryOutcome) => void;
    onToggleRail: () => void;
    onTogglePanel: () => void;
  } = $props();

  const scaleIndex = $derived(
    Math.max(0, SCALE_STEPS.indexOf(manager.scalePercent as (typeof SCALE_STEPS)[number])),
  );

  // Says which way pressing goes, rather than naming both directions at once: the glyph already
  // shows the state, so the label can state the next step.
  const railLabel = $derived(manager.railOpen ? "Hide the folder tree" : "Show the folder tree");

  function step(by: -1 | 1): void {
    const next = SCALE_STEPS[Math.min(SCALE_STEPS.length - 1, Math.max(0, scaleIndex + by))];
    if (next !== undefined) manager.setScalePercent(next);
  }
</script>

{#snippet controls()}
  <span class="flex items-center gap-4">
    {#if extras}
      {@render extras()}
    {/if}
    <UndoRedoControls history={manager.history} onOutcome={onHistoryOutcome} />
    <span
      class="flex items-center gap-4"
      title="Scale the file area: previews, row height and text"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={scaleIndex === 0}
        aria-label="Scale the file area down"
        onclick={() => step(-1)}
      >
        <ZoomOut class="size-16" aria-hidden="true" />
      </Button>
      <span
        class="w-48 text-center text-xs tabular-nums text-text-muted"
        role="status"
        aria-live="polite"
      >
        {manager.scalePercent}%
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={scaleIndex === SCALE_STEPS.length - 1}
        aria-label="Scale the file area up"
        onclick={() => step(1)}
      >
        <ZoomIn class="size-16" aria-hidden="true" />
      </Button>
    </span>
    <!-- The two pane toggles end the strip, in the order the panes they open sit on the screen.

         The DETAILS PANEL's is the shared control, because five surfaces show that panel and four
         of them once drew their own button for it. The FOLDER TREE's is written out here, because
         this is the only screen in the product that has a folder tree to hide — a component shared
         by one caller is indirection, not reuse, and calling it a DetailsPanel toggle would be a
         plain misnomer. If the tree's toggle survives its next review and a second surface ever
         grows one, that is when it earns a component. -->
    <Button
      variant="ghost"
      size="icon-sm"
      aria-pressed={manager.railOpen}
      title={railLabel}
      aria-label={railLabel}
      onclick={onToggleRail}
    >
      <PanelLeft class="size-16" aria-hidden="true" />
    </Button>
    <DetailsPanel.Toggle open={manager.panelOpen} onToggle={() => onTogglePanel()} />
  </span>
{/snippet}

<DataTable.GridFooter
  {grid}
  end={controls}
  tallyText={tally}
  selectAllToggle
  class="border-t border-border-default"
/>
