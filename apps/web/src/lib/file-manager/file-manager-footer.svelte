<script lang="ts" generics="TRow">
  /*
   * The counts strip: how much is here, how much is selected, what a filter is hiding — and, at the
   * far end, the controls that belong beside the counts rather than beside Back and Forward.
   *
   * UNDO AND REDO LIVE HERE, away from the navigation controls. The pair itself is the design
   * system's `UndoRedoControls` over the surface's own stack: this file decides only WHERE the pair
   * sits, never how it behaves or what it says. The hand-built copy that used to live here — two
   * split controls, four callbacks and its own wording — is what the shared control replaced.
   *
   * THE SCALE CONTROL carries no visible text label: the meaning is implied by the two glyphs and
   * the figure between them, and the name lives on the hover and on the accessible name, where a
   * keyboard or a screen reader still reaches it.
   */
  import type { Snippet } from "svelte";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Button from "@magna-carta/design-system/button";
  import UndoRedoControls, { type HistoryOutcome } from "@magna-carta/design-system/history";
  import ZoomIn from "@lucide/svelte/icons/zoom-in";
  import ZoomOut from "@lucide/svelte/icons/zoom-out";
  import type { DataTableGridState } from "@magna-carta/design-system/data-table";
  import { SCALE_STEPS, type FileManagerState } from "./file-manager-state.svelte.ts";

  let {
    manager,
    grid,
    tally = undefined,
    extras = undefined,
    onHistoryOutcome = undefined,
  }: {
    manager: FileManagerState;
    grid: DataTableGridState<TRow>;
    /** The surface's own unfiltered tally ("2 folders, 5 files"), replacing the bare item count. */
    tally?: string;
    /** A view's own trailing controls, ahead of undo/redo — a view-specific act's home. */
    extras?: Snippet;
    /** What a walk came to, for the surface to say. */
    onHistoryOutcome?: (outcome: HistoryOutcome) => void;
  } = $props();

  const scaleIndex = $derived(
    Math.max(0, SCALE_STEPS.indexOf(manager.scalePercent as (typeof SCALE_STEPS)[number])),
  );

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
        size="icon"
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
        size="icon"
        disabled={scaleIndex === SCALE_STEPS.length - 1}
        aria-label="Scale the file area up"
        onclick={() => step(1)}
      >
        <ZoomIn class="size-16" aria-hidden="true" />
      </Button>
    </span>
  </span>
{/snippet}

<DataTable.GridFooter
  {grid}
  end={controls}
  tallyText={tally}
  selectAllToggle
  class="border-t border-border-default"
/>
