<script lang="ts">
  /*
   * CalendarGrid.Week — seven days, one row, in the month grid's own cell grammar.
   *
   * The same table shape as the month — weekday heads, day cells, entries as controls in DOM
   * order — over exactly one week, with room in each cell for every entry and its detail line,
   * so nothing folds behind a "more" control. This is the civil-day form of a week: a column is a
   * day, not a time axis, and an entry sits in its day in the order it was handed over.
   *
   * Like the month, it knows nothing about what kind of thing has a day, reads no clock, and holds
   * its shape empty and loading.
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
    parseCivilDate,
    placeEntries,
    weekdayNames,
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
    emptyMessage = "Nothing recorded in this week.",
    locale,
    onActivate,
    onCreate,
    class: className,
    ...restProps
  }: WithElementRef<HTMLTableAttributes, HTMLTableElement> & {
    /** The entries, each on its civil day. Presented in the order handed over, day by day. */
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
  } = $props();

  /** Spoken after the full date on the day that is today. */
  const TODAY_LABEL = "today";

  const anchorDate = $derived(parseCivilDate(anchor));
  const days = $derived(daysOfWeek(anchorDate, weekStartsOn));
  const heads = $derived(weekdayNames(weekStartsOn, locale));
  const placed = $derived(placeEntries(entries, days[0]!, days[days.length - 1]!));
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
  class={mergeClasses("mc-calendar-grid mc-calendar-grid-week w-full table-fixed", className)}
  {...restProps}
>
  <caption class="mc-calendar-grid-caption">
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
    <tr class="mc-calendar-grid-row">
      {#each days as day, dayIndex (formatCivilDate(day))}
        {@const key = formatCivilDate(day)}
        {@const isToday = today !== undefined && key === today}
        {@const dayEntries = placed.get(key) ?? []}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -- the create gesture is an
             accelerator on the cell; the keyboard path is the screen's own create control. -->
        <td
          class="mc-calendar-grid-cell"
          data-today={isToday ? "true" : undefined}
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
              {#if dayIndex % 2 === 0}
                <Skeleton class="mc-calendar-grid-line-placeholder w-2/3" />
              {/if}
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
  </tbody>
</table>
