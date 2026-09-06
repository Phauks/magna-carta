<script lang="ts">
  /*
   * LoadingRegion — the ONE way a region of a screen says where its data stands (Tier 1, native
   * elements). The component is its own skeleton: while `loading`, the region renders the
   * `fixture` snippet (representative content in the real components — two or three rows from the
   * sample vocabulary in ../../loading-fixtures, a card with sample words) under the mc-loading
   * recipe, which turns every text, media and control leaf into a bone and leaves the frame, the
   * headings, the labels and the rules real. Nothing is measured and nothing is drawn by hand, so
   * the placeholder cannot drift from the screen it stands in for: it IS the screen.
   *
   * The region holds the whole state set a read can be in, so no screen writes the chain by hand:
   *   failed   → the `failure` snippet (the surface's FailureNotice with Retry), first, so a failed
   *              read never leaves a shape standing;
   *   loading  → the sentence and the inert fixture (or the children, when no fixture is given —
   *              right for a surface whose resting furniture is already the shape);
   *   empty    → the `emptyState` snippet;
   *   settled  → the children.
   * `refreshing` is the fifth posture: a re-read of something already on screen keeps the content
   * where the reader is looking, marks the region busy, and says so for assistive technology.
   *
   * The loading STATE is announced once, here: a polite status line carries the sentence while the
   * read is in flight and says it finished when the content lands, and the region's aria-busy
   * agrees. The fixture is `inert`, so nothing in it can be focused, pressed, selected or read as
   * if it were real. A read that stays in flight past STALLED_AFTER_MILLISECONDS says so on the
   * screen and offers Retry when the caller can re-ask, so a permanent skeleton cannot happen by
   * construction. Every settle is measured (the User Timing API, and a bubbling
   * `mc-loading-settled` event the app shell records), so how long members wait is a fact, not a
   * guess.
   *
   * What this component owns, it owns by having no prop for it: the pulse, the bone colour, the
   * announcement's mechanics, the stall threshold. A caller supplies the facts only it knows —
   * where the read stands, what it is reading, how to ask again — and the shape, which is its own
   * markup. `stalledAfter` is the one seam, for the story that proves the stall, and nothing else.
   */
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import Button from "../button/index.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import {
    SETTLED_EVENT,
    STALLED_AFTER_MILLISECONDS,
    finishedSentence,
    stalledSentence,
    type LoadingSettledDetail,
  } from "./loading-region.ts";

  let {
    loading,
    label,
    refreshing = false,
    failed = false,
    empty = false,
    fixture,
    failure,
    emptyState,
    onRetry,
    stalledAfter = STALLED_AFTER_MILLISECONDS,
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    /** True while the region's data has not arrived. */
    loading: boolean;
    /**
     * The sentence assistive technology hears while loading, in the house voice — "Reading this
     * record's names", "Looking for near matches". Required: a loading region that says nothing is
     * the defect this component exists to end.
     */
    label: string;
    /**
     * True while something already on screen is being read again. The content stays, the region
     * is busy, and the sentence is spoken; nothing is greyed. Ignored while `loading`.
     */
    refreshing?: boolean;
    /** True when the read failed. Renders `failure` first, before anything else. */
    failed?: boolean;
    /** True when the read settled to nothing. Renders `emptyState` in place of the children. */
    empty?: boolean;
    /**
     * Representative content rendered as the shape while loading, in the same components the real
     * content uses. Absent, the children render as the shape.
     */
    fixture?: Snippet;
    /** What a failed read shows — the surface's failure notice with Retry. */
    failure?: Snippet;
    /** What an empty answer shows — the surface's empty state. */
    emptyState?: Snippet;
    /** How to ask again. Offered beside the stalled sentence; the failure snippet carries its own. */
    onRetry?: () => void;
    /** The stall threshold in milliseconds. A test seam only; the product keeps the constant. */
    stalledAfter?: number;
    children: Snippet;
  } = $props();

  const identity = $props.id();

  const showingFailure = $derived(failed && failure !== undefined);
  const showingFixture = $derived(!showingFailure && loading);
  const showingEmpty = $derived(!showingFailure && !loading && empty && emptyState !== undefined);
  const busy = $derived(showingFixture || (!showingFailure && !loading && refreshing));

  /*
   * The one status line. Its text is the sentence while the read is in flight and the finished
   * sentence once the content lands; a change is what a polite live region announces, so the
   * element is always in the document and only its words move.
   */
  let announcement = $state("");
  let stalled = $state(false);
  let wasBusy = false;
  let startedAt = 0;

  $effect(() => {
    if (busy) {
      const sentence = label;
      announcement = sentence;
      stalled = false;
      startedAt = performance.now();
      const markName = `mc-loading:${identity}`;
      performance.mark(markName);
      const timer = setTimeout(() => {
        stalled = true;
      }, stalledAfter);
      wasBusy = true;
      return () => {
        clearTimeout(timer);
        performance.clearMarks(markName);
      };
    }
    if (wasBusy) {
      wasBusy = false;
      stalled = false;
      announcement = finishedSentence(label);
      const milliseconds = Math.round(performance.now() - startedAt);
      const detail: LoadingSettledDetail = { label, milliseconds, failed };
      performance.measure(`mc-loading ${label}`, {
        start: startedAt,
        end: performance.now(),
        detail,
      });
      ref?.dispatchEvent(new CustomEvent(SETTLED_EVENT, { bubbles: true, detail }));
    }
    return undefined;
  });
</script>

<p class="sr-only" role="status" aria-live="polite">{announcement}</p>
{#if showingFixture && stalled}
  <div class="mc-loading-stalled" role="status">
    <p class="mc-loading-stalled-sentence">{stalledSentence(label)}</p>
    {#if onRetry}
      <Button variant="secondary" size="sm" onclick={onRetry}>Retry</Button>
    {/if}
  </div>
{/if}
<div
  bind:this={ref}
  class={mergeClasses("mc-loading-region", className)}
  data-mc-loading={showingFixture ? "" : undefined}
  data-mc-refreshing={busy && !showingFixture ? "" : undefined}
  inert={showingFixture}
  aria-busy={busy ? "true" : undefined}
  {...restProps}
>
  {#if showingFailure && failure}
    {@render failure()}
  {:else if showingFixture && fixture}
    {@render fixture()}
  {:else if showingEmpty && emptyState}
    {@render emptyState()}
  {:else}
    {@render children()}
  {/if}
</div>
