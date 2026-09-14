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
   *
   * THE FRAME STANDS BEFORE THE FIRST EVENT. With nothing recorded the rail still draws its
   * geometry — one hollow marker where the first event will land, and the words about the emptiness
   * in the body beside it — so a history that is about to start is the same shape as one that has,
   * and a reader learns where events go before any arrive. The words never stand loose on the
   * canvas beside the rail: `emptyMessage` is inside the frame, and so is `note`, the one line a
   * caller may hang beneath the events for what the history does not yet carry.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import Skeleton from "../skeleton/index.ts";
  import {
    formatInstant as formatInstantByDefault,
    instantAttribute,
  } from "../../formatters/instant.ts";
  import type { EventInstant, EventRailEvent } from "./types.ts";

  let {
    ref = $bindable(null),
    events,
    label = "History",
    emptyMessage = "Nothing has been recorded here yet.",
    note = undefined,
    loading = false,
    loadingMessage = "Loading the history",
    placeholderCount = 3,
    formatInstant = formatInstantByDefault,
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    /** The events, oldest first. The last one is the latest and takes the filled marker. */
    events: readonly EventRailEvent[];
    /** The scroll region's accessible name. Name it for what this particular history is. */
    label?: string;
    /** The words inside the rail's frame when there is nothing recorded yet. */
    emptyMessage?: string;
    /**
     * One line beneath the events, inside the frame, for what this history does not yet carry —
     * a source it will draw from once it exists, a fact a reader needs to read the events
     * correctly. It is the rail's own last line, never a paragraph loose on the canvas beneath it.
     */
    note?: string | undefined;
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

<!--
  A scrolling region whose content is prose carries no focusable child, so a keyboard alone could
  never reach the part of a long history that is out of view. Making the region itself focusable and
  naming it is the accepted remedy, and it is why the tabindex sits on a non-interactive role here:
  reaching content is not the same thing as operating a control.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
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
    <!-- The frame with nothing on it: the marker column and the body column of the first event,
         so the words sit exactly where that event's action will. Not a list item, because there
         is no event; the dot is hollow and dashed, which is the same absence the empty table
         states by not lighting up. -->
    <div class="mc-event-rail-events" data-empty="true">
      <div class="mc-event-rail-event" data-placeholder="true">
        <span class="mc-event-rail-track" aria-hidden="true">
          <span class="mc-event-rail-marker">
            <span class="mc-event-rail-dot mc-event-rail-dot-empty"></span>
          </span>
        </span>
        <div class="mc-event-rail-body">
          <p class="mc-event-rail-empty">{emptyMessage}</p>
        </div>
      </div>
    </div>
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
              <time class="mc-event-rail-instant" datetime={instantAttribute(event.at)}>
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
  {#if note !== undefined && !loading}
    <!-- The note takes an event's geometry with an empty marker column, so it reads as the rail's
         own last line rather than as a caption that happens to sit beneath it. -->
    <div class="mc-event-rail-event mc-event-rail-note-row">
      <span class="mc-event-rail-track" aria-hidden="true">
        <span class="mc-event-rail-marker"></span>
      </span>
      <p class="mc-event-rail-note">{note}</p>
    </div>
  {/if}
</div>
