<script lang="ts">
  /*
   * CalendarGrid.Month — a month, presented as the weeks it spans.
   *
   * A real table: a column head per weekday, a row per week, a cell per day, so the grid's shape
   * is legible to a screen reader with no ARIA at all. Every row is a whole week — the days that
   * belong to the neighbouring months are drawn dimmed rather than left out — and every entry is a
   * focusable control in DOM order, day by day.
   *
   * It knows nothing about what kind of thing has a day. It takes civil dates and entries and
   * presents them, and never learns what they were about; a prop that named a domain would fork it.
   * It reads no clock either: "today" is a fact about a zone, and the grid has none, so the caller
   * says which day is today or no day is marked.
   *
   * THE GRID HOLDS ITS SHAPE. A month with nothing in it is the same grid, empty, with the empty
   * statement in the caption region; a month still loading is the same grid with placeholder
   * lines in its cells. Arriving entries fill a shape the reader already has.
   */
  import type { HTMLTableAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import Skeleton from "../skeleton/index.ts";
  import CalendarGridEntryChip from "./calendar-grid-entry.svelte";
  import {
    type CalendarGridWeekStart,
    formatCivilDate,
    formatCivilDateLong,
    parseCivilDate,
    placeEntries,
    weekdayNames,
    weeksOfMonth,
  } from "./civil-date.ts";
  import type { CalendarGridEntry } from "./types.ts";

  let {
    ref = $bindable(null),
    entries,
    label,
    anchor,
    weekStartsOn = 0,
    today,
    loading = false,
    loadingMessage = "Loading the calendar",
    emptyMessage = "Nothing recorded in this month.",
    maxEntriesPerDay = 3,
    locale,
    onActivate,
    onShowDay,
    onCreate,
    class: className,
    ...restProps
  }: WithElementRef<HTMLTableAttributes, HTMLTableElement> & {
    /** The entries, each on its civil day. Presented in the order handed over, day by day. */
    entries: readonly CalendarGridEntry[];
    /** The table's accessible name. Name it for what this particular calendar is. */
    label: string;
    /** Any civil day (`YYYY-MM-DD`) inside the month to show. */
    anchor: string;
    /** Which day a week begins on: 0 for Sunday (the default), 1 for Monday. */
    weekStartsOn?: CalendarGridWeekStart;
    /**
     * The civil day to mark as today, `YYYY-MM-DD`. The caller supplies it because today is a
     * fact about a zone and the grid has none; when absent, no day is marked.
     */
    today?: string;
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
    /** How many entries a day shows before the rest fold behind a "more" control. */
    maxEntriesPerDay?: number;
    /** The locale the weekday names and full dates are written in. The viewer's when absent. */
    locale?: string;
    /** Called with the entry when one is activated. */
    onActivate?: (entry: CalendarGridEntry) => void;
    /**
     * Called with the civil day (`YYYY-MM-DD`) on a double-click in an empty part of a day cell —
     * the accelerator for starting a record on the day somebody pointed at. Never fired from a
     * press on a chip: opening a record and making one beside it are different intentions.
     */
    onCreate?: (date: string) => void;
    /** Called with the civil day (`YYYY-MM-DD`) when a day's "more" control is pressed. */
    onShowDay?: (date: string) => void;
  } = $props();

  /** Spoken after the full date on the day that is today. */
  const TODAY_LABEL = "today";
  /** The verb of the "more" control's accessible name; the visible text is the count alone. */
  const SHOW_LABEL = "Show";

  const anchorDate = $derived(parseCivilDate(anchor));
  const weeks = $derived(weeksOfMonth(anchorDate, weekStartsOn));
  const heads = $derived(weekdayNames(weekStartsOn, locale));
  const gridStart = $derived(weeks[0]![0]!);
  const gridEnd = $derived(weeks[weeks.length - 1]![weeks[weeks.length - 1]!.length - 1]!);
  const placed = $derived(placeEntries(entries, gridStart, gridEnd));
  const cap = $derived(Math.max(Math.floor(maxEntriesPerDay), 0));
  const isEmpty = $derived(!loading && placed.size === 0);

  /**
   * A double-click that landed on a chip is that chip's, not the cell's: the reader was opening a
   * record, and answering with a blank form over the top of it is the wrong thing twice.
   */
  function create(event: MouseEvent, day: string): void {
    if (onCreate === undefined) return;
    const target = event.target;
    if (target instanceof Element && target.closest(".mc-calendar-grid-entry") !== null) return;
    onCreate(day);
  }
</script>

<table
  bind:this={ref}
  aria-label={label}
  aria-busy={loading ? "true" : undefined}
  class={mergeClasses("mc-calendar-grid mc-calendar-grid-month w-full table-fixed", className)}
  {...restProps}
>
  <!--
    The caption region is where the grid says what it is missing. It stays mounted, blank, while
    there are entries, so the grid's height never depends on whether there was something to say.

    A caller that never says anything (`emptyMessage=""`) gets the caption for assistive technology
    only. A caption is drawn OUTSIDE the table's own box, so a month told to fill its host (`h-full`)
    was the host's full height PLUS the blank caption line, and the region around it scrolled by that
    line on every screen with nothing to scroll (owner, 2026-11-09: "the calendar on the right has a
    scrollbar when it should not").
  -->
  <caption class={mergeClasses("mc-calendar-grid-caption", emptyMessage === "" && "sr-only")}>
    {#if loading}
      <span class="sr-only">{loadingMessage}</span>
    {/if}
    <span class="mc-calendar-grid-caption-message">{isEmpty && emptyMessage !== "" ? emptyMessage : "\u00a0"}</span>
  </caption>
  <thead>
    <tr>
      {#each heads as head, index (index)}
        <th scope="col" class="mc-calendar-grid-weekday">{head}</th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each weeks as week, weekIndex (weekIndex)}
      <tr class="mc-calendar-grid-row">
        {#each week as day, dayIndex (formatCivilDate(day))}
          {@const key = formatCivilDate(day)}
          {@const isToday = today !== undefined && key === today}
          {@const outsideMonth = day.month !== anchorDate.month || day.year !== anchorDate.year}
          {@const dayEntries = placed.get(key) ?? []}
          {@const hidden = Math.max(dayEntries.length - cap, 0)}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -- the create gesture is an
               accelerator on the cell; the keyboard path is the screen's own create control. -->
          <td
            class="mc-calendar-grid-cell"
            data-today={isToday ? "true" : undefined}
            data-outside-month={outsideMonth ? "true" : undefined}
            ondblclick={(event) => create(event, key)}
          >
            <span class="mc-calendar-grid-day">
              <span class="mc-calendar-grid-day-number" aria-hidden="true">{day.day}</span>
              <span class="sr-only">
                {formatCivilDateLong(day, locale)}{isToday ? `, ${TODAY_LABEL}` : ""}
              </span>
            </span>
            {#if loading}
              <div class="mc-calendar-grid-placeholders" aria-hidden="true">
                <Skeleton class="mc-calendar-grid-line-placeholder w-full" />
                {#if (weekIndex + dayIndex) % 3 === 0}
                  <Skeleton class="mc-calendar-grid-line-placeholder w-2/3" />
                {/if}
              </div>
            {:else if dayEntries.length > 0}
              <ol class="mc-calendar-grid-entries">
                {#each dayEntries.slice(0, cap) as item (item.entry.id)}
                  <li class="mc-calendar-grid-item">
                    <CalendarGridEntryChip
                      entry={item.entry}
                      span={item.span}
                      spanStart={item.spanStart}
                      spanEnd={item.spanEnd}
                      {onActivate}
                    />
                  </li>
                {/each}
              </ol>
              {#if hidden > 0}
                <button
                  type="button"
                  class="mc-calendar-grid-more"
                  onclick={() => onShowDay?.(key)}
                >
                  <span class="sr-only">{SHOW_LABEL} </span><span aria-hidden="true">+</span
                  >{hidden} more<span class="sr-only"> on {formatCivilDateLong(day, locale)}</span>
                </button>
              {/if}
            {/if}
          </td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>
