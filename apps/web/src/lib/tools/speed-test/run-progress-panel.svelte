<script lang="ts">
  /*
   * What the run is doing, arranged so that nothing moves when anything changes.
   *
   * The counter is anchored left and the data-used figure right, with slack between them, so each
   * grows into the gap rather than pushing the other. Figures are tabular, so a digit changing
   * width cannot jitter the line. The descriptor sits in a cell whose width is reserved by the
   * longest label the engine can emit — rendered invisibly beneath it — so a phase change never
   * resizes the panel or shoves the controls beside it. The bar underlines the whole block.
   *
   * Renders in every phase: before a run, the counter and size cells are empty strings, not absent
   * elements — an element that disappears takes its height with it, and the controls beside this
   * panel would move once when a run starts and again when it stops.
   */
  import Progress from "@magna-carta/design-system/progress";
  import { formatBytes, LONGEST_PHASE_LABEL } from "./run-progress.ts";

  let {
    phaseText,
    stepIndex,
    stepCount,
    bytesUsed,
  }: {
    phaseText: string;
    stepIndex: number | null;
    stepCount: number;
    bytesUsed: number;
  } = $props();

  const percent = $derived(
    stepIndex === null || stepCount === 0 ? 0 : ((stepIndex + 1) / stepCount) * 100,
  );
</script>

<div class="grid gap-4">
  <div class="flex items-baseline justify-between gap-16 text-xs tabular-nums text-text-muted">
    <span>{stepIndex !== null ? `Step ${stepIndex + 1} of ${stepCount}` : ""}</span>
    <span>{bytesUsed > 0 ? `${formatBytes(bytesUsed)} used` : ""}</span>
  </div>

  <!-- The invisible copy reserves the cell's width; the visible label overlays it. -->
  <div class="grid">
    <span class="invisible col-start-1 row-start-1 text-sm whitespace-nowrap">
      {LONGEST_PHASE_LABEL}
    </span>
    <span class="col-start-1 row-start-1 text-sm whitespace-nowrap text-text-muted">
      {phaseText}
    </span>
  </div>

  <Progress value={percent} max={100} aria-label="Test progress" />
</div>
