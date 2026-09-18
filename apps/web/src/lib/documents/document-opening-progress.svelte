<script lang="ts">
  /*
   * The wait for a document opening in the browser editor, as ONE panel that tells the open as it
   * happens: a line for each stage as it finishes, the stage under way saying what it is doing, a
   * bar filling over the time an open usually takes with the usual time said beside it, and,
   * behind one control, the full sequence with its timings and the host's last answer. Past the
   * point Retry is worth offering, the sentence and the button appear inside the same panel; when
   * the open has stopped, the notice the caller renders and the facts a report needs land here
   * too. Everything the member is told about the open is told here, in one place that does not
   * move: the panel sits over the frame, centered, and grows downward only, so a line appearing at
   * thirty seconds and a failure appearing at ninety land in the same spot rather than pushing the
   * screen about. What it says is decided without a DOM in ./editor-open-progress.ts.
   *
   * The feed is a live region so a screen reader hears the open advance as a sighted member
   * watches it, politely: a stage finishing is news, not an interruption. The details are the
   * design system's ProgressSteps and FailureDetails; nothing here draws a spinner of its own.
   */
  import type { Snippet } from "svelte";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import X from "@lucide/svelte/icons/x";
  import Button from "@magna-carta/design-system/button";
  import FailureDetails, {
    type FailureDetailRow,
  } from "@magna-carta/design-system/failure-details";
  import Progress from "@magna-carta/design-system/progress";
  import ProgressSteps, { type ProgressStep } from "@magna-carta/design-system/progress-steps";
  import {
    TAKING_LONGER_SENTENCE,
    TYPICAL_OPEN_MILLISECONDS,
    type OpenFeedLine,
    type OpenPace,
  } from "./editor-open-progress.ts";

  let {
    feed,
    steps,
    pace,
    stalled = false,
    onRetry,
    rows,
    trace,
    children,
  }: {
    /** The open so far: one line per stage that has happened, then the one under way or stopped. */
    feed: readonly OpenFeedLine[];
    /** The whole sequence, already worded and decided, for the details. */
    steps: readonly ProgressStep[];
    /** The wait against the usual wait. Absent once the open has stopped: there is no wait left. */
    pace?: OpenPace;
    /** True once the open has run long enough that Retry is worth offering. */
    stalled?: boolean;
    /** How to ask again. Shown beside the stalled sentence; a stopped open's notice carries its own. */
    onRetry?: () => void;
    /** The facts of a stopped open. Given, FailureDetails renders in the details. */
    rows?: readonly FailureDetailRow[];
    /** The same facts as one block for a report, re-read at the press. */
    trace?: string | (() => string);
    /** What the caller has to say about the stop, rendered between the feed and the details. */
    children?: Snippet;
  } = $props();

  const detailsId = $props.id();
  // A stopped open shows its details unasked: the facts are the reason the member is looking.
  let detailsShown = $state(false);
  const showDetails = $derived(detailsShown || rows !== undefined);
</script>

<div class="flex w-full max-w-prose flex-col gap-12">
  <ol aria-live="polite" class="flex flex-col gap-8 text-sm">
    {#each feed as line (line.stage)}
      <li
        class="flex items-start gap-8"
        class:text-text-subtle={line.status === "done"}
        class:text-text-default={line.status === "active"}
        class:font-medium={line.status === "active"}
        class:text-status-danger-subtle-foreground={line.status === "failed"}
      >
        <span
          class="mt-2 flex size-16 shrink-0 items-center justify-center rounded-full"
          class:bg-status-success={line.status === "done"}
          class:text-status-success-foreground={line.status === "done"}
          class:bg-accent-strong={line.status === "active"}
          class:bg-status-danger={line.status === "failed"}
          class:text-status-danger-foreground={line.status === "failed"}
          aria-hidden="true"
        >
          {#if line.status === "done"}
            <Check size={12} />
          {:else if line.status === "failed"}
            <X size={12} />
          {/if}
        </span>
        <span class="min-w-0 grow">{line.text}</span>
        <span class="shrink-0 text-xs text-text-muted tabular-nums">{line.at}</span>
      </li>
    {/each}
  </ol>

  {#if pace !== undefined}
    <div class="flex flex-col gap-4">
      <Progress
        value={pace.elapsedMilliseconds}
        max={TYPICAL_OPEN_MILLISECONDS}
        aria-label="How long this open has run, against the usual half minute"
      />
      <p class="text-xs text-text-muted">{pace.sentence}</p>
    </div>
  {/if}

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

  {#if rows === undefined}
    <div>
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={showDetails}
        aria-controls={detailsId}
        onclick={() => (detailsShown = !detailsShown)}
      >
        {#if showDetails}
          <ChevronUp size={16} aria-hidden="true" />
          Hide details
        {:else}
          <ChevronDown size={16} aria-hidden="true" />
          Show details
        {/if}
      </Button>
    </div>
  {/if}

  {#if showDetails}
    <div id={detailsId} class="flex flex-col gap-12">
      <ProgressSteps {steps} />
      {#if rows !== undefined && trace !== undefined}
        <FailureDetails {rows} {trace} showTrace={false} />
      {/if}
    </div>
  {/if}
</div>
