<script lang="ts">
  /*
   * CalendarGrid.Week — seven days on an hour axis.
   *
   * It was seven civil-day cells in the month's grammar, each holding a list of chips, and the
   * owner replaced that (2026-09-14: "week view should be taller since we can include time"). A
   * week is the span a firm plans IN — who is where on Wednesday afternoon, what Thursday morning
   * still has room for — and a list per day answers none of that. So the week is the Day's shape
   * with seven columns: hours down the leading edge, a day across the top, and every timed entry a
   * block from its start to its end.
   *
   * A REAL TABLE, as every grid in this family is: the hours are row heads, the days are column
   * heads, and each entry is a control inside the cell of the hour it starts in, so the grid reads
   * row by row to a screen reader with no ARIA at all.
   *
   * ALL DAY IS A BAND. A filing, a deadline, a holiday, and anything spanning several days sit
   * above the hours, where a thing true of a whole day belongs; the band is the only part of the
   * week that still stacks rather than places, and it is where a multi-day run is drawn across its
   * days.
   *
   * WHAT RUNS AT THE SAME TIME EITHER DIVIDES ITS DAY'S COLUMN OR LIES OVER IT — the reader's own
   * choice, and the same choice the Day takes.
   *
   * Like every grid here it knows nothing about what kind of thing has a day, reads no clock, and
   * holds its shape empty and loading.
   */
  import type { HTMLTableAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import Skeleton from "../skeleton/index.ts";
  import CalendarGridEntryChip from "./calendar-grid-entry.svelte";
  import {
    type CalendarGridWeekStart,
    daysOfWeek,
    formatCivilDate,
    formatCivilDateLong,
    formatHourOfDay,
    parseCivilDate,
    placeEntries,
    weekdayNames,
  } from "./civil-date.ts";
  import {
    DEFAULT_FIRST_HOUR,
    DEFAULT_LAST_HOUR,
    MINUTES_IN_HOUR,
    dayHours,
    hourSlots,
    inAllDayBand,
  } from "./day-axis.ts";
  import {
    DEFAULT_CONCURRENCY,
    placeTimeEntries,
    type CalendarGridConcurrency,
    type PlacedTimeEntry,
  } from "./time-placement.ts";
  import { blockStyle, blocksByStartingHour } from "./time-blocks.ts";
  import { timedEntriesOn } from "./day-segments.ts";
  import type { CalendarGridEntry } from "./types.ts";

  let {
    ref = $bindable(null),
    entries,
    label,
    anchor,
    weekStartsOn = 0,
    today,
    firstHour = DEFAULT_FIRST_HOUR,
    lastHour = DEFAULT_LAST_HOUR,
    concurrency = DEFAULT_CONCURRENCY,
    loading = false,
    loadingMessage = "Loading the calendar",
    emptyMessage = "Nothing recorded in this week.",
    locale,
    onActivate,
    onCreate,
    class: className,
    ...restProps
  }: WithElementRef<HTMLTableAttributes, HTMLTableElement> & {
    /** The entries, each on its civil day. */
    entries: readonly CalendarGridEntry[];
    /** The table's accessible name. Name it for what this particular calendar is. */
    label: string;
    /** Any civil day (`YYYY-MM-DD`) inside the week to show. */
    anchor: string;
    /** Which day a week begins on: 0 for Sunday (the default), 1 for Monday. */
    weekStartsOn?: CalendarGridWeekStart;
    /**
     * The civil day to mark as today, `YYYY-MM-DD`. The caller supplies it because today is a
     * fact about a zone and the grid has none; when absent, no day is marked.
     */
    today?: string;
    /** The first hour drawn. Widened without asking by anything earlier in the week. */
    firstHour?: number;
    /** The last hour drawn. Widened without asking by anything later. */
    lastHour?: number;
    /** How things that run at the same time share a day's column: divided, or stacked over. */
    concurrency?: CalendarGridConcurrency;
    /** True while the entries are being fetched: placeholder lines stand in for them. */
    loading?: boolean;
    /** What a screen reader is told while the grid is loading. */
    loadingMessage?: string;
    /**
     * Shown in the caption region when the grid holds nothing. Name the span in it. THE EMPTY
     * STRING MEANS SAY NOTHING: a caller whose grid already shows its days to a reader — seven
     * empty columns are their own statement — passes it, and the caption keeps its height without
     * spending a sentence on a fact the reader can see.
     */
    emptyMessage?: string;
    /** The locale the weekday names, hours and full dates are written in. The viewer's when absent. */
    locale?: string;
    /** Called with the entry when one is activated. */
    onActivate?: (entry: CalendarGridEntry) => void;
    /**
     * Called on a double-click in an empty part of the grid, with the civil day and the minute past
     * midnight the row stands for — or no minute at all from the all-day band, which is what a
     * record with no time is.
     */
    onCreate?: (date: string, minuteOfDay?: number) => void;
  } = $props();

  /** The row head of the band above the hours. */
  const ALL_DAY_LABEL = "All day";
  /** The time gutter's own column head, which has no visible word of its own. */
  const TIME_LABEL = "Time";
  /** Spoken after the full date on the day that is today. */
  const TODAY_LABEL = "today";

  const anchorDate = $derived(parseCivilDate(anchor));
  const days = $derived(daysOfWeek(anchorDate, weekStartsOn));
  const heads = $derived(weekdayNames(weekStartsOn, locale));
  const hours = $derived(dayHours(entries, firstHour, lastHour));
  const slots = $derived(hourSlots(hours));
  const axis = $derived({
    from: hours.first * MINUTES_IN_HOUR,
    to: (hours.last + 1) * MINUTES_IN_HOUR,
  });

  /*
   * The all-day band reads through the same span placement the month uses, so a run of days is
   * drawn across its days and marked at each end. What reaches it is what has no hour AND what runs
   * across days (`inAllDayBand`): a three-day trial is a fact about days, and drawing it as three
   * full columns on the axis — reaching above and below the working hours the week draws — was
   * what the owner met on 2026-09-18. Its hours stay on the chip as text.
   */
  const allDay = $derived(placeEntries(entries.filter(inAllDayBand), days[0]!, days[days.length - 1]!));

  /*
   * Per civil day, the blocks that BEGIN in each drawn hour: the entries that start and end on
   * that day, placed on the axis.
   */
  const blocks = $derived.by(() => {
    const byDay = new Map<string, ReadonlyMap<number, PlacedTimeEntry[]>>();
    for (const day of days) {
      const timed = timedEntriesOn(entries, day);
      byDay.set(
        formatCivilDate(day),
        blocksByStartingHour(placeTimeEntries(timed, axis, concurrency), hours, axis),
      );
    }
    return byDay;
  });

  const isEmpty = $derived(!loading && entries.length === 0);

  /**
   * A double-click that landed on a chip is that chip's, not the cell's: the reader was opening a
   * record, and answering with a blank form over the top of it is the wrong thing twice.
   */
  function create(event: MouseEvent, day: string, minuteOfDay?: number): void {
    if (onCreate === undefined) return;
    const target = event.target;
    if (target instanceof Element && target.closest(".mc-calendar-grid-entry") !== null) return;
    onCreate(day, minuteOfDay);
  }
</script>

<table
  bind:this={ref}
  aria-label={label}
  aria-busy={loading ? "true" : undefined}
  class={mergeClasses(
    "mc-calendar-grid mc-calendar-grid-week mc-calendar-grid-day-view w-full table-fixed",
    className,
  )}
  {...restProps}
>
  <!-- Assistive technology only when the caller has nothing to say, as the month's: a blank visible
       line over the week is height the hours could have had. -->
  <caption class={mergeClasses("mc-calendar-grid-caption", emptyMessage === "" && "sr-only")}>
    {#if loading}
      <span class="sr-only">{loadingMessage}</span>
    {/if}
    <span class="mc-calendar-grid-caption-message"
      >{isEmpty && emptyMessage !== "" ? emptyMessage : " "}</span
    >
  </caption>
  <thead>
    <tr>
      <th scope="col" class="mc-calendar-grid-weekday mc-calendar-grid-gutter">
        <span class="sr-only">{TIME_LABEL}</span>
      </th>
      {#each days as day, index (formatCivilDate(day))}
        {@const key = formatCivilDate(day)}
        {@const isToday = today !== undefined && key === today}
        <th scope="col" class="mc-calendar-grid-weekday" data-today={isToday ? "true" : undefined}>
          <span class="mc-calendar-grid-lane-head">
            <span class="mc-calendar-grid-lane-name" aria-hidden="true">
              {heads[index]} {day.day}
            </span>
          </span>
          <span class="sr-only">
            {formatCivilDateLong(day, locale)}{isToday ? `, ${TODAY_LABEL}` : ""}
          </span>
        </th>
      {/each}
    </tr>
  </thead>
  <tbody>
    <!-- What is true of a whole day, and what runs across several: above the hours, never parked
         at midnight. This band is the one part of the week that stacks rather than places. -->
    <tr class="mc-calendar-grid-row mc-calendar-grid-all-day-row">
      <th scope="row" class="mc-calendar-grid-hour mc-calendar-grid-gutter">{ALL_DAY_LABEL}</th>
      {#each days as day (formatCivilDate(day))}
        {@const key = formatCivilDate(day)}
        {@const isToday = today !== undefined && key === today}
        {@const dayEntries = allDay.get(key) ?? []}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -- the create gesture is an
             accelerator on the cell; the keyboard path is the screen's own create control. -->
        <td
          class="mc-calendar-grid-cell mc-calendar-grid-day-cell"
          data-today={isToday ? "true" : undefined}
          ondblclick={(event) => create(event, key)}
        >
          {#if loading}
            <div class="mc-calendar-grid-placeholders" aria-hidden="true">
              <Skeleton class="mc-calendar-grid-line-placeholder w-full" />
            </div>
          {:else if dayEntries.length > 0}
            <ol class="mc-calendar-grid-entries">
              {#each dayEntries as item (item.entry.id)}
                <li class="mc-calendar-grid-item">
                  <CalendarGridEntryChip
                    entry={item.entry}
                    showDetail
                    span={item.span}
                    spanStart={item.spanStart}
                    spanEnd={item.spanEnd}
                    {onActivate}
                  />
                </li>
              {/each}
            </ol>
          {/if}
        </td>
      {/each}
    </tr>
    {#each slots as slot, slotIndex (slot)}
      <tr class="mc-calendar-grid-row mc-calendar-grid-hour-row">
        <th scope="row" class="mc-calendar-grid-hour mc-calendar-grid-gutter">
          {formatHourOfDay(slot, locale)}
        </th>
        {#each days as day (formatCivilDate(day))}
          {@const key = formatCivilDate(day)}
          {@const isToday = today !== undefined && key === today}
          {@const starting = blocks.get(key)?.get(slot) ?? []}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -- as above. -->
          <td
            class="mc-calendar-grid-cell mc-calendar-grid-day-cell mc-calendar-grid-time-cell"
            data-today={isToday ? "true" : undefined}
            ondblclick={(event) => create(event, key, slot)}
          >
            {#if loading}
              {#if slotIndex % 3 === 0}
                <div class="mc-calendar-grid-placeholders" aria-hidden="true">
                  <Skeleton class="mc-calendar-grid-line-placeholder w-full" />
                </div>
              {/if}
            {:else if starting.length > 0}
              <ol class="mc-calendar-grid-blocks">
                {#each starting as placed (placed.entry.id)}
                  <li class="mc-calendar-grid-block" style={blockStyle(placed, slot, axis)}>
                    <CalendarGridEntryChip entry={placed.entry} showDetail {onActivate} />
                  </li>
                {/each}
              </ol>
            {/if}
          </td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>
