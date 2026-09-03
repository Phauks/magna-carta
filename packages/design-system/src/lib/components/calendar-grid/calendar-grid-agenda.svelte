<script lang="ts">
  /*
   * CalendarGrid.Agenda — the entries over a span, grouped by day, as a list.
   *
   * A heading per day carrying the full date, then the day's entries as rows with the time at the
   * reading edge. Days with nothing on them are left out: an agenda answers "what is coming", and
   * a run of empty headings answers nothing. It is the form that survives a narrow canvas and the
   * one a small host embeds.
   *
   * IT IS A SCROLLING CHILD, NOT A GROWING BLOCK. A span gets long, and a long one must cost the
   * surface around it nothing: the agenda fills the space it is given and scrolls inside it. The
   * scroll region is focusable and named so a keyboard can reach and scroll it; the rows inside
   * are controls, but the region itself must still be reachable when they are out of view.
   *
   * The day a heading names is the civil day it was given: the words come from `Intl` over the
   * civil parts placed on a UTC date, so no zone can shift a heading by a day. The host owns
   * heading levels, so a day heading is a paragraph in the heading recipe rather than an `<h3>`
   * that presumes where in the page the agenda sits.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import Skeleton from "../skeleton/index.ts";
  import CalendarGridEntryChip from "./calendar-grid-entry.svelte";
  import {
    formatCivilDateLong,
    parseCivilDate,
    placeEntries,
    readCivilDate,
  } from "./civil-date.ts";
  import type { CalendarGridEntry } from "./types.ts";

  let {
    ref = $bindable(null),
    entries,
    label,
    from,
    to,
    loading = false,
    loadingMessage = "Loading the calendar",
    emptyMessage = "Nothing recorded.",
    placeholderCount = 2,
    locale,
    formatDayHeading = (date: string) => formatCivilDateLong(parseCivilDate(date), locale),
    onActivate,
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    /** The entries, each on its civil day. Presented in the order handed over, day by day. */
    entries: readonly CalendarGridEntry[];
    /** The scroll region's accessible name. Name it for what this particular calendar is. */
    label: string;
    /** The first civil day (`YYYY-MM-DD`) of the span. When absent, the span starts at the earliest entry. */
    from?: string;
    /** The last civil day (`YYYY-MM-DD`) of the span. When absent, the span ends at the latest entry. */
    to?: string;
    /** True while the entries are being fetched: placeholder day groups stand in for them. */
    loading?: boolean;
    /** What a screen reader is told while the agenda is loading. */
    loadingMessage?: string;
    /** Shown instead of the list when the span holds nothing. Name the span in it. */
    emptyMessage?: string;
    /** How many placeholder day groups the loading state shows. */
    placeholderCount?: number;
    /** The locale the day headings are written in. The viewer's when absent. */
    locale?: string;
    /**
     * How a day heading is written from its civil day (`YYYY-MM-DD`). The default writes the full
     * date in the locale; an override must still name the whole day.
     */
    formatDayHeading?: (date: string) => string;
    /** Called with the entry when one is activated. */
    onActivate?: (entry: CalendarGridEntry) => void;
  } = $props();

  const placed = $derived(placeEntries(entries, readCivilDate(from) ?? undefined, readCivilDate(to) ?? undefined));
  // `YYYY-MM-DD` orders as text the way it orders as days, so the keys sort without parsing again.
  const days = $derived([...placed.entries()].sort(([left], [right]) => left.localeCompare(right)));
  const placeholders = $derived(
    Array.from({ length: Math.max(placeholderCount, 0) }, (_unused, index) => index),
  );
</script>

<!--
  A scrolling region has to be reachable by keyboard even when every control inside it is out of
  view, so the region itself is focusable and named. That is why the tabindex sits on a
  non-interactive role here: reaching content is not the same thing as operating a control.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={ref}
  role="region"
  tabindex="0"
  aria-label={label}
  aria-busy={loading ? "true" : undefined}
  class={mergeClasses("mc-calendar-agenda mc-scrollbar", className)}
  {...restProps}
>
  {#if loading}
    <p class="sr-only">{loadingMessage}</p>
    <div class="mc-calendar-agenda-days" aria-hidden="true">
      {#each placeholders as placeholder (placeholder)}
        <div class="mc-calendar-agenda-day">
          <Skeleton class="mc-calendar-agenda-heading-placeholder w-48" />
          <Skeleton class="mc-calendar-agenda-line-placeholder w-full" />
          <Skeleton class="mc-calendar-agenda-line-placeholder w-2/3" />
        </div>
      {/each}
    </div>
  {:else if days.length === 0}
    <p class="mc-calendar-agenda-empty">{emptyMessage}</p>
  {:else}
    <div class="mc-calendar-agenda-days">
      {#each days as [key, dayEntries] (key)}
        <section class="mc-calendar-agenda-day">
          <p class="mc-calendar-agenda-heading">{formatDayHeading(key)}</p>
          <ol class="mc-calendar-agenda-entries">
            {#each dayEntries as item (item.entry.id)}
              <li class="mc-calendar-grid-item">
                <CalendarGridEntryChip
                  entry={item.entry}
                  layout="row"
                  showDetail
                  span={item.span}
                  spanStart={item.spanStart}
                  spanEnd={item.spanEnd}
                  {onActivate}
                />
              </li>
            {/each}
          </ol>
        </section>
      {/each}
    </div>
  {/if}
</div>
