<script lang="ts">
  /*
   * CalendarGrid.Day — one day, drawn as an hour axis crossed with a column per calendar.
   *
   * This is the presentation the other views cannot give: a firm whose six attorneys are in four
   * places at once has a day that reads as eighteen rows in an agenda and as one crowded cell in a
   * month. Here each calendar the reader turned on is a COLUMN, so two settings at ten o'clock
   * stand side by side and the gap at two o'clock is visible as a gap. A caller that hands no lanes
   * gets one column, which is the plain day view.
   *
   * A REAL TABLE: the hours are row heads, the calendars are column heads, and every entry is a
   * control inside the cell of the hour it starts in, in DOM order, so the grid's shape is legible
   * to a screen reader with no ARIA at all.
   *
   * AN ENTRY IS A BLOCK FROM ITS START TO ITS END. It used to be a chip parked in its starting
   * hour, with the duration said in words on the chip; the owner overturned that (2026-09-14:
   * "start and end time need to properly show themselves on the calendar, not just on the start,
   * should stretch accordingly"). The block is positioned inside its starting cell and sized in
   * hours, so it runs down across the rows it actually occupies. The old argument against it — a
   * two-pixel sliver for a fifteen-minute call — is answered by the MINIMUM block in
   * time-placement.ts rather than by refusing to stretch, and the arithmetic lives there so a test
   * reads it without a browser.
   *
   * WHAT RUNS AT THE SAME TIME EITHER DIVIDES THE COLUMN OR LIES OVER IT, and which is the
   * reader's own choice (`concurrency`), not the grid's.
   *
   * ALL DAY IS A BAND, NOT AN HOUR. An entry with no `startMinute` is a filing, a deadline, a
   * holiday: it is true of the whole day and belongs above the hours rather than parked at
   * midnight. The band is the one part of the grid that still stacks rather than places.
   *
   * DOUBLE-CLICKING AN HOUR STARTS A RECORD ON IT. The gesture is an accelerator, not the only
   * path — a screen that offers it also carries the create control every screen carries, which is
   * what a keyboard and a touch device reach for — and it never fires from a press on a chip,
   * because opening the thing you double-clicked and making a new thing beside it are different
   * intentions.
   *
   * It reads no clock: "today" is a fact about a zone, so the caller says whether this day is it.
   */
  import type { HTMLTableAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import Skeleton from "../skeleton/index.ts";
  import CalendarGridEntryChip from "./calendar-grid-entry.svelte";
  import { formatCivilDateLong, formatHourOfDay, parseCivilDate } from "./civil-date.ts";
  import {
    DEFAULT_FIRST_HOUR,
    DEFAULT_LAST_HOUR,
    MINUTES_IN_HOUR,
    dayHours,
    dayLanes,
    hourSlots,
    inAllDayBand,
    placeDayEntries,
  } from "./day-axis.ts";
  import {
    DEFAULT_CONCURRENCY,
    placeTimeEntries,
    type CalendarGridConcurrency,
    type PlacedTimeEntry,
  } from "./time-placement.ts";
  import { blockStyle, blocksByStartingHour } from "./time-blocks.ts";
  import { timedEntriesOn } from "./day-segments.ts";
  import type { CalendarGridEntry, CalendarGridLane } from "./types.ts";

  let {
    ref = $bindable(null),
    entries,
    label,
    date,
    lanes,
    today,
    firstHour = DEFAULT_FIRST_HOUR,
    lastHour = DEFAULT_LAST_HOUR,
    concurrency = DEFAULT_CONCURRENCY,
    loading = false,
    loadingMessage = "Loading the calendar",
    emptyMessage = "Nothing recorded on this day.",
    locale,
    onActivate,
    onCreate,
    class: className,
    ...restProps
  }: WithElementRef<HTMLTableAttributes, HTMLTableElement> & {
    /** The day's entries. One that names another day is still drawn: the caller chose the day. */
    entries: readonly CalendarGridEntry[];
    /** The table's accessible name. Name it for what this particular calendar is. */
    label: string;
    /** The civil day (`YYYY-MM-DD`) this grid is of. */
    date: string;
    /**
     * The columns, in the order the reader arranged them. None means one unnamed column, which is
     * the plain day view; an entry naming a lane that is not here falls into the first column.
     */
    lanes?: readonly CalendarGridLane[];
    /** The civil day to mark as today. When it is not this day, nothing is marked. */
    today?: string;
    /** The first hour drawn. Widened without asking by anything earlier in the day. */
    firstHour?: number;
    /** The last hour drawn. Widened without asking by anything later. */
    lastHour?: number;
    /** How things that run at the same time share a column: divided between them, or stacked over. */
    concurrency?: CalendarGridConcurrency;
    /** True while the entries are being fetched: placeholder lines stand in for them. */
    loading?: boolean;
    /** What a screen reader is told while the grid is loading. */
    loadingMessage?: string;
    /**
     * Shown in the caption region when the grid holds nothing. Name the span in it. THE EMPTY
     * STRING MEANS SAY NOTHING: a caller whose grid already shows its days to a reader — thirty
     * empty squares are their own statement — passes it, and the caption keeps its height without
     * spending a sentence on a fact the reader can see.
     */
    emptyMessage?: string;
    /** The locale the hours and the full date are written in. The viewer's when absent. */
    locale?: string;
    /** Called with the entry when one is activated. */
    onActivate?: (entry: CalendarGridEntry) => void;
    /**
     * Called on a double-click in an empty part of the grid, with this day and the minute past
     * midnight the row stands for — or no minute at all from the all-day band, which is what a
     * record with no time is.
     */
    onCreate?: (date: string, minuteOfDay?: number) => void;
  } = $props();

  /** The row head of the band above the hours. */
  const ALL_DAY_LABEL = "All day";
  /** The time gutter's own column head, which has no visible word of its own. */
  const TIME_LABEL = "Time";
  /** Spoken after the full date when this day is today. */
  const TODAY_LABEL = "today";

  const dayDate = $derived(parseCivilDate(date));
  const columns = $derived(dayLanes(lanes));
  /*
   * The day's own entries: what the band above the hours holds — no hour, or a run of days, so a
   * trial that began yesterday is in the band rather than the whole column — and the timed entries
   * that begin and end on THIS day, for the axis.
   */
  const dayEntries = $derived(
    dayDate === null
      ? entries
      : [...entries.filter(inAllDayBand), ...timedEntriesOn(entries, dayDate)],
  );
  const hours = $derived(dayHours(dayEntries, firstHour, lastHour));
  const slots = $derived(hourSlots(hours));
  const placement = $derived(placeDayEntries(dayEntries, columns));
  /** The axis the blocks are measured against: the first hour drawn to the end of the last. */
  const axis = $derived({
    from: hours.first * MINUTES_IN_HOUR,
    to: (hours.last + 1) * MINUTES_IN_HOUR,
  });
  /**
   * Per lane, the blocks that BEGIN in each drawn hour. A block is rendered inside the cell of the
   * hour it starts in — which is where a screen reader should meet it — and overflows that cell
   * downwards for as long as it runs.
   */
  const blocks = $derived(
    new Map(
      columns.map((lane): [string, ReadonlyMap<number, PlacedTimeEntry[]>] => [
        lane.key,
        blocksByStartingHour(
          placeTimeEntries(placement.timed.get(lane.key) ?? [], axis, concurrency),
          hours,
          axis,
        ),
      ]),
    ),
  );
  const isToday = $derived(today !== undefined && today === date);
  const isEmpty = $derived(!loading && entries.length === 0);
  /** Whether the column heads carry a word. A single unnamed lane heads nothing. */
  const named = $derived(columns.some((lane) => lane.label !== ""));

  /**
   * A double-click that landed on a chip is that chip's, not the cell's: the reader was opening
   * a record, and answering with a blank form over the top of it is the wrong thing twice.
   */
  function create(event: MouseEvent, minuteOfDay?: number): void {
    if (onCreate === undefined) return;
    const target = event.target;
    if (target instanceof Element && target.closest(".mc-calendar-grid-entry") !== null) return;
    onCreate(date, minuteOfDay);
  }
</script>

<table
  bind:this={ref}
  aria-label={label}
  aria-busy={loading ? "true" : undefined}
  class={mergeClasses("mc-calendar-grid mc-calendar-grid-day-view w-full table-fixed", className)}
  {...restProps}
>
  <caption class="mc-calendar-grid-caption">
    {#if loading}
      <span class="sr-only">{loadingMessage}</span>
    {/if}
    <span class="mc-calendar-grid-caption-message">
      {isEmpty && emptyMessage !== "" ? emptyMessage : formatCivilDateLong(dayDate, locale)}{isToday
        ? `, ${TODAY_LABEL}`
        : ""}
    </span>
  </caption>
  <thead>
    <tr>
      <th scope="col" class="mc-calendar-grid-weekday mc-calendar-grid-gutter">
        <span class="sr-only">{TIME_LABEL}</span>
      </th>
      {#each columns as lane (lane.key)}
        <th scope="col" class="mc-calendar-grid-weekday" data-color={lane.color}>
          {#if named}
            <span class="mc-calendar-grid-lane-head">
              {#if lane.color !== undefined}
                <span class="mc-palette-pip" data-palette-color={lane.color} aria-hidden="true"></span>
              {/if}
              <span class="mc-calendar-grid-lane-name">{lane.label}</span>
            </span>
          {:else}
            <span class="sr-only">{label}</span>
          {/if}
        </th>
      {/each}
    </tr>
  </thead>
  <tbody>
    <!-- The band above the hours: what is true of the whole day, never parked at midnight. It is
         the one part of the grid that stacks rather than places, because an all-day thing has no
         position on an hour axis to place it by. -->
    <tr class="mc-calendar-grid-row mc-calendar-grid-all-day-row">
      <th scope="row" class="mc-calendar-grid-hour mc-calendar-grid-gutter">{ALL_DAY_LABEL}</th>
      {#each columns as lane (lane.key)}
        {@const laneEntries = placement.allDay.get(lane.key) ?? []}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -- the create gesture is an
             accelerator on the cell; the keyboard path is the screen's own create control. -->
        <td
          class="mc-calendar-grid-cell mc-calendar-grid-day-cell"
          data-today={isToday ? "true" : undefined}
          ondblclick={(event) => create(event)}
        >
          {#if loading}
            <div class="mc-calendar-grid-placeholders" aria-hidden="true">
              <Skeleton class="mc-calendar-grid-line-placeholder w-full" />
            </div>
          {:else if laneEntries.length > 0}
            <ol class="mc-calendar-grid-entries">
              {#each laneEntries as entry (entry.id)}
                <li class="mc-calendar-grid-item">
                  <CalendarGridEntryChip {entry} showDetail {onActivate} />
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
        {#each columns as lane (lane.key)}
          {@const starting = blocks.get(lane.key)?.get(slot) ?? []}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -- as above. -->
          <td
            class="mc-calendar-grid-cell mc-calendar-grid-day-cell mc-calendar-grid-time-cell"
            data-today={isToday ? "true" : undefined}
            ondblclick={(event) => create(event, slot)}
          >
            {#if loading}
              {#if slotIndex % 3 === 0}
                <div class="mc-calendar-grid-placeholders" aria-hidden="true">
                  <Skeleton class="mc-calendar-grid-line-placeholder w-full" />
                </div>
              {/if}
            {:else if starting.length > 0}
              <!-- The blocks that begin in this hour. Each is positioned inside the cell and sized
                   in hours, so it runs down across every row it occupies; the list is static and
                   the blocks are what is placed. -->
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
