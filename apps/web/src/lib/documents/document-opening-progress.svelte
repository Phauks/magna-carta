<script lang="ts">
  /*
   * The staged wait for a document opening in the browser editor, as ONE panel: every stage named
   * as it happens, how long the open has been running beneath them, the sentence and the Retry
   * for a wait that has run long, and, when the open has stopped, the notice the caller renders
   * and the facts a report needs. Everything the member is told about the open is told here, in
   * one place that does not move: the panel sits over the frame, centered, and grows downward
   * only, so a sentence appearing at fifteen seconds and a failure appearing at ninety land in the
   * same spot rather than pushing the screen about. What it says is decided without a DOM in
   * ./editor-open-progress.ts.
   *
   * ProgressSteps is the sanctioned staged wait; nothing here draws a spinner or a skeleton of its
   * own, and the panel is not a loading region: the editor's frame is not data that has not
   * arrived, it is work handed off and waited on, which is what ProgressSteps exists for.
   */
  import type { Snippet } from "svelte";
  import Button from "@magna-carta/design-system/button";
  import FailureDetails, {
    type FailureDetailRow,
  } from "@magna-carta/design-system/failure-details";
  import ProgressSteps, { type ProgressStep } from "@magna-carta/design-system/progress-steps";
  import { TAKING_LONGER_SENTENCE } from "./editor-open-progress.ts";

  let {
    steps,
    elapsed,
    stalled = false,
    onRetry,
    rows,
    trace,
    children,
  }: {
    /** The sequence, already worded and already decided, one entry per stage. */
    steps: readonly ProgressStep[];
    /** How long the open has been running, or ran: "12 seconds so far", "Stopped after 90 seconds". */
    elapsed: string;
    /** True once the open has run long enough that waiting on wants saying, and Retry offering. */
    stalled?: boolean;
    /** How to ask again. Shown beside the stalled sentence; a stopped open's notice carries its own. */
    onRetry?: () => void;
    /** The facts of a stopped open. Given, FailureDetails renders beneath the steps. */
    rows?: readonly FailureDetailRow[];
    /** The same facts as one block for a report, re-read at the press. */
    trace?: string | (() => string);
    /** What the caller has to say about the stop, rendered between the steps and the facts. */
    children?: Snippet;
  } = $props();
</script>

<div class="flex w-full max-w-prose flex-col gap-12">
  <ProgressSteps {steps} />
  <p class="text-sm text-text-muted">{elapsed}</p>
  {#if stalled}
    <div class="flex flex-wrap items-center justify-between gap-12" role="status">
      <p class="text-sm">{TAKING_LONGER_SENTENCE}</p>
      {#if onRetry}
        <Button variant="secondary" size="sm" onclick={onRetry}>Retry</Button>
      {/if}
    </div>
  {/if}
  {#if children}
    {@render children()}
  {/if}
  {#if rows !== undefined && trace !== undefined}
    <FailureDetails {rows} {trace} showTrace={false} />
  {/if}
</div>
