<script lang="ts">
  /*
   * The wait for a document opening in the browser editor, as ONE panel that tells the open as it
   * happens: a line for each stage as it finishes, the stage under way saying what it is doing, a
   * bar filling over the time an open usually takes with the usual time said beside it, and,
   * behind one control, the timings and the host's last answer. Past the point Retry is worth
   * offering, the sentence and the button appear in a row that was there from the start; when the
   * open has stopped, the notice the caller renders and the facts a report needs land here too.
   * Everything the member is told about the open is told here, in one place: the panel sits over
   * the frame, centered, and what it says is decided without a DOM in ./editor-open-progress.ts.
   *
   * The feed is the design system's ProgressSteps, in its streamed posture: only the stages that
   * have happened, each with its stamp as the step's note. That list is a live region, so a screen
   * reader hears the open advance as a sighted member watches it; the stamps are hidden from it,
   * because a stamp that ticks would be announced on every tick. The status row for Retry exists
   * from mount and is filled at forty-five seconds, which is what lets it be announced at all.
   * Nothing here draws a spinner or a marker of its own.
   */
  import type { Snippet } from "svelte";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import Button from "@magna-carta/design-system/button";
  import FailureDetails, {
    type FailureDetailRow,
  } from "@magna-carta/design-system/failure-details";
  import Progress from "@magna-carta/design-system/progress";
  import ProgressSteps from "@magna-carta/design-system/progress-steps";
  import {
    feedSteps,
    TAKING_LONGER_SENTENCE,
    TYPICAL_OPEN_MILLISECONDS,
    usualTimeWords,
    type OpenFeedLine,
    type OpenPace,
  } from "./editor-open-progress.ts";

  let {
    feed,
    pace,
    stalled = false,
    onRetry,
    rows,
    trace,
    stopped = false,
    children,
  }: {
    /** The open so far: one line per stage that has happened, then the one under way or stopped. */
    feed: readonly OpenFeedLine[];
    /** The wait against the usual wait. Absent once the open has stopped: there is no wait left. */
    pace?: OpenPace;
    /** True once the open has run long enough that Retry is worth offering. */
    stalled?: boolean;
    /** How to ask again. Shown beside the stalled sentence; a stopped open's notice carries its own. */
    onRetry?: () => void;
    /**
     * The open's log so far (what the container, the host and the page each did, in order), or on a
     * stop the stage timings followed by that log: the details, behind the control.
     */
    rows?: readonly FailureDetailRow[];
    /** The same facts as one block for a report, re-read at the press. */
    trace?: string | (() => string);
    /** True once the open has stopped: the details show unasked, since they are why the member is looking. */
    stopped?: boolean;
    /** What the caller has to say about the stop, rendered between the feed and the details. */
    children?: Snippet;
  } = $props();

  const detailsId = $props.id();
  let detailsShown = $state(false);
  const showDetails = $derived(stopped || detailsShown);
  const hasDetails = $derived(rows !== undefined && trace !== undefined);
</script>

<div class="flex w-full max-w-prose flex-col gap-12">
  <ProgressSteps steps={feedSteps(feed)} />

  {#if pace !== undefined}
    <div class="flex flex-col gap-4">
      <Progress
        value={pace.elapsedMilliseconds}
        max={TYPICAL_OPEN_MILLISECONDS}
        aria-label="How long this open has run, against the usual {usualTimeWords()}"
        aria-valuetext={pace.sentence}
      />
      <!-- The pace sentence yields to the Retry row's once that row speaks: two sentences saying
           the open is running long, one above the other, are one thought said twice. -->
      {#if !stalled}
        <p class="text-xs text-text-muted">{pace.sentence}</p>
      {/if}
    </div>
  {/if}

  {#if !stopped}
    <div class="flex flex-wrap items-center justify-between gap-12" role="status">
      {#if stalled}
        <p class="text-sm">{TAKING_LONGER_SENTENCE}</p>
        {#if onRetry}
          <Button variant="secondary" size="sm" onclick={onRetry}>Retry</Button>
        {/if}
      {/if}
    </div>
  {/if}

  {#if children}
    {@render children()}
  {/if}

  {#if hasDetails && !stopped}
    <div>
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={showDetails}
        aria-controls={detailsId}
        onclick={() => (detailsShown = !detailsShown)}
      >
        {#if showDetails}
          <ChevronUp class="size-16" aria-hidden="true" />
          Hide details
        {:else}
          <ChevronDown class="size-16" aria-hidden="true" />
          Show details
        {/if}
      </Button>
    </div>
  {/if}

  {#if hasDetails && showDetails && rows !== undefined && trace !== undefined}
    <div id={detailsId}>
      <FailureDetails {rows} {trace} showTrace={false} />
    </div>
  {/if}
</div>
