<script lang="ts">
  /*
   * EventRail — how a history is presented, anywhere the platform has one.
   *
   * A marker per event on a hairline; the action semibold; one metadata line reading
   * "instant · source"; anything anyone recorded with the event quoted beneath. Oldest first, and
   * the latest marker filled so the eye lands on where the story has got to.
   *
   * It knows nothing about what kind of thing has a history. A record's history, a document's
   * version history, a safety-check history and a history view's details panel are the same
   * presentation of the same shape, so this component takes events and renders them and never
   * learns what they were about. A prop or a class name that named a domain would fork it.
   *
   * IT IS A SCROLLING CHILD, NOT A GROWING BLOCK. A history gets long, and a long one must cost the
   * surface around it nothing: the rail fills the space it is given and scrolls inside it, rather
   * than sizing to its content and pushing its host's other panes down. That is what makes it
   * usable as a tab's whole body. Because the content is prose rather than controls, the scroll
   * region is focusable and named, so a keyboard reader can reach and scroll it.
   *
   * ORDER IS THE CALLER'S. Events render exactly as handed over, because two events can share an
   * instant and the recorded order is then the only truth about which came first — and because some
   * events are ruled to be first regardless (the one that says a record was entered, and the one
   * that says it moved between ledgers). A caller whose source arrives newest-first sorts it with
   * `orderedOldestFirst` rather than the rail second-guessing it.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import Skeleton from "../skeleton/index.ts";
  import { eventInstantAttribute, eventInstantText } from "./event-instant.ts";
  import type { EventInstant, EventRailEvent } from "./types.ts";

  let {
    ref = $bindable(null),
    events,
    label = "History",
    emptyMessage = "Nothing has been recorded here yet.",
    loading = false,
    loadingMessage = "Loading the history",
    placeholderCount = 3,
    formatInstant = eventInstantText,
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    /** The events, oldest first. The last one is the latest and takes the filled marker. */
    events: readonly EventRailEvent[];
    /** The scroll region's accessible name. Name it for what this particular history is. */
    label?: string;
    /** Shown instead of the rail when there is nothing recorded. */
    emptyMessage?: string;
    /** True while the events are being fetched: placeholder rows stand in for the real ones. */
    loading?: boolean;
    /** What a screen reader is told while the rail is loading. */
    loadingMessage?: string;
    /** How many placeholder rows the loading state shows. */
    placeholderCount?: number;
    /**
     * How an instant is rendered. The default states the actual moment in the viewer's local time;
     * an override must do the same — elapsed time ("Just now") is never an acceptable rendering of
     * a recorded event.
     */
    formatInstant?: (at: EventInstant) => string;
  } = $props();

  /**
   * What the metadata line's second half is, for a reader who cannot see the layout. It is "Source"
   * and not "Person" because the thing that caused an event is not always a person: the platform
   * acts on its own, and a name that assumes otherwise turns false the first time it does.
   */
  const SOURCE_LABEL = "Source";

  const placeholders = $derived(
    Array.from({ length: Math.max(placeholderCount, 0) }, (_unused, index) => index),
  );
</script>

<div
  bind:this={ref}
  role="region"
  tabindex="0"
  aria-label={label}
  aria-busy={loading ? "true" : undefined}
  class={mergeClasses("mc-event-rail mc-scrollbar", className)}
  {...restProps}
>
  {#if loading}
    <p class="sr-only">{loadingMessage}</p>
    <div class="mc-event-rail-events" aria-hidden="true">
      {#each placeholders as placeholder (placeholder)}
        <div class="mc-event-rail-event">
          <span class="mc-event-rail-track">
            <span class="mc-event-rail-marker">
              <Skeleton class="mc-event-rail-dot-placeholder" />
            </span>
            {#if placeholder < placeholders.length - 1}
              <span class="mc-event-rail-connector"></span>
            {/if}
          </span>
          <div class="mc-event-rail-body">
            <Skeleton class="mc-event-rail-line-placeholder w-96" />
            <Skeleton class="mc-event-rail-line-placeholder w-64" />
          </div>
        </div>
      {/each}
    </div>
  {:else if events.length === 0}
    <p class="mc-event-rail-empty">{emptyMessage}</p>
  {:else}
    <ol class="mc-event-rail-events">
      {#each events as event, position (event.id)}
        {@const isLatest = position === events.length - 1}
        <li class="mc-event-rail-event" data-latest={isLatest ? "true" : undefined}>
          <span class="mc-event-rail-track" aria-hidden="true">
            <span class="mc-event-rail-marker">
              <span class="mc-event-rail-dot"></span>
            </span>
            {#if !isLatest}
              <span class="mc-event-rail-connector"></span>
            {/if}
          </span>
          <div class="mc-event-rail-body">
            <p class="mc-event-rail-action">{event.action}</p>
            <p class="mc-event-rail-meta">
              <time class="mc-event-rail-instant" datetime={eventInstantAttribute(event.at)}>
                {formatInstant(event.at)}
              </time>
              <span class="mc-event-rail-separator" aria-hidden="true">·</span>
              <span class="sr-only">{SOURCE_LABEL}</span>
              <span class="mc-event-rail-source">{event.source}</span>
            </p>
            {#if event.detail}
              <blockquote class="mc-event-rail-detail">{event.detail}</blockquote>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</div>
