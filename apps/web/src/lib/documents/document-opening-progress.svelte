<script lang="ts">
  /*
   * The staged wait for a document opening in the browser editor: every stage named as it
   * happens, and how long the open has been running beneath them. When the open has stopped, the
   * same panel carries the notice the caller renders between the steps and the facts a report
   * needs (the rows and the trace), so a stall reads as one surface rather than a sequence here
   * and a diagnosis somewhere else.
   *
   * It sits inside a LoadingRegion while the region is loading, so it is marked `data-loading-keep`:
   * the region turns every text leaf under it into a bone, and a sequence that is the one thing on
   * the screen saying where the open is must stay readable. ProgressSteps is the sanctioned staged
   * wait; nothing here draws a spinner or a skeleton of its own. The words come from
   * ./editor-open-progress.ts, which decides them without a DOM.
   */
  import type { Snippet } from "svelte";
  import FailureDetails, {
    type FailureDetailRow,
  } from "@magna-carta/design-system/failure-details";
  import ProgressSteps, { type ProgressStep } from "@magna-carta/design-system/progress-steps";

  let {
    steps,
    elapsed,
    rows,
    trace,
    children,
  }: {
    /** The sequence, already worded and already decided, one entry per stage. */
    steps: readonly ProgressStep[];
    /** How long the open has been running, or ran: "12 s so far", "Stopped after 90 s". */
    elapsed: string;
    /** The facts of a stopped open. Given, FailureDetails renders beneath the steps. */
    rows?: readonly FailureDetailRow[];
    /** The same facts as one block for a report, re-read at the press. */
    trace?: string | (() => string);
    /** What the caller has to say about the stop, rendered between the steps and the facts. */
    children?: Snippet;
  } = $props();
</script>

<div class="flex max-w-prose flex-col gap-8" data-loading-keep>
  <ProgressSteps {steps} />
  <p class="text-sm text-text-muted">{elapsed}</p>
  {#if children}
    {@render children()}
  {/if}
  {#if rows !== undefined && trace !== undefined}
    <FailureDetails {rows} {trace} showTrace={false} />
  {/if}
</div>
