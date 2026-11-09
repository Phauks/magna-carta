<script lang="ts">
  /*
   * Calendar — Tier 4 (Bits UI), composition-heavy. A self-contained month grid: Bits owns the date
   * math, keyboard grid navigation, and the a11y (grid/rows/cells, aria-selected, focus management);
   * we bake the standard composition (Header + nav, weekday head, week rows of Day cells) so a caller
   * just writes `<Calendar type="single" bind:value />`. Values are `@internationalized/date`
   * DateValue (use CalendarDate — the civil date — never ZonedDateTime).
   *
   * The Day recipe keys its states off Bits' data attributes: data-selected, data-today,
   * data-outside-month, data-disabled, data-unavailable.
   *
   * TWO DENSITIES. `default` is the date picker's: a framed panel whose header chooses a month and a
   * year from two native selects. `compact` is the month a column pins under a list (the calendar
   * screen's rail): no frame of its own, smaller days, so seven of them fit the navigation measure,
   * and a header that NAMES the month in words, with the arrows at its end and the name itself
   * opening MonthJump — twelve months at once rather than a select to scroll (owner, 2026-11-09).
   */
  import { Calendar as CalendarPrimitive } from "bits-ui";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { CalendarDate, today as todayIn, getLocalTimeZone, type DateValue } from "@internationalized/date";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { formatMonth } from "../../formatters/civil-date.ts";
  import type { WithoutChildrenOrChild } from "../../internal/types.ts";
  import * as Popover from "../popover/index.ts";
  import MonthJump from "./month-jump.svelte";

  let {
    ref = $bindable(null),
    placeholder = $bindable(),
    density = "default",
    locale,
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<CalendarPrimitive.RootProps> & {
    /** `default` is the framed date-picker panel; `compact` is the unframed month a column pins. */
    density?: "default" | "compact";
  } = $props();

  /** Whether the compact heading's month jump is open. */
  let jumpOpen = $state(false);

  function monthHeading(month: DateValue): string {
    return formatMonth(month.toString().slice(0, 10), { locale });
  }

  const thisMonth = todayIn(getLocalTimeZone());
</script>

<CalendarPrimitive.Root
  bind:ref
  bind:placeholder
  {locale}
  class={mergeClasses("mc-calendar", density === "compact" && "mc-calendar-compact", className)}
  {...restProps}
>
  {#snippet children({ months, weekdays })}
    {#if density === "compact"}
      {@const shown = months[0]?.value}
      <CalendarPrimitive.Header role="presentation" class="mc-calendar-header">
        <Popover.Root bind:open={jumpOpen}>
          <Popover.Trigger class="mc-calendar-heading" aria-label="Choose a month">
            {shown === undefined ? "" : monthHeading(shown)}
            <ChevronDown class="mc-calendar-nav-icon" aria-hidden="true" />
          </Popover.Trigger>
          <Popover.Content align="start" class="w-auto">
            {#if shown !== undefined}
              <MonthJump
                value={{ year: shown.year, month: shown.month }}
                today={{ year: thisMonth.year, month: thisMonth.month }}
                {locale}
                onchoose={(chosen) => {
                  placeholder = new CalendarDate(chosen.year, chosen.month, 1);
                  jumpOpen = false;
                }}
              />
            {/if}
          </Popover.Content>
        </Popover.Root>
        <span class="mc-calendar-steps">
          <CalendarPrimitive.PrevButton class="mc-calendar-nav">
            <ChevronLeft class="mc-calendar-nav-icon" aria-hidden="true" />
          </CalendarPrimitive.PrevButton>
          <CalendarPrimitive.NextButton class="mc-calendar-nav">
            <ChevronRight class="mc-calendar-nav-icon" aria-hidden="true" />
          </CalendarPrimitive.NextButton>
        </span>
      </CalendarPrimitive.Header>
    {:else}
    <!-- Bits renders Header as a <header> (a banner landmark); the calendar's internal header is not a
         page banner, so neutralize the landmark to satisfy axe's landmark-banner-is-top-level. -->
    <CalendarPrimitive.Header role="presentation" class="mc-calendar-header">
      <!-- Bits labels these "Previous"/"Next" (its props win), so no aria-label here. -->
      <CalendarPrimitive.PrevButton class="mc-calendar-nav">
        <ChevronLeft class="mc-calendar-nav-icon" aria-hidden="true" />
      </CalendarPrimitive.PrevButton>
      <!-- Month + year are jump-to selects (native, accessible). The year list is bounded by
           minValue/maxValue, so an earliest-date floor (e.g. 1900) trims it. -->
      <div class="mc-calendar-selects">
        <CalendarPrimitive.MonthSelect aria-label="Month" class="mc-calendar-select" />
        <CalendarPrimitive.YearSelect aria-label="Year" class="mc-calendar-select" />
      </div>
      <CalendarPrimitive.NextButton class="mc-calendar-nav">
        <ChevronRight class="mc-calendar-nav-icon" aria-hidden="true" />
      </CalendarPrimitive.NextButton>
    </CalendarPrimitive.Header>
    {/if}
    {#each months as month (month.value.toString())}
      <CalendarPrimitive.Grid class="mc-calendar-grid">
        <CalendarPrimitive.GridHead>
          <CalendarPrimitive.GridRow class="mc-calendar-weekdays">
            {#each weekdays as weekday, weekdayIndex (weekdayIndex)}
              <CalendarPrimitive.HeadCell class="mc-calendar-weekday">
                {weekday}
              </CalendarPrimitive.HeadCell>
            {/each}
          </CalendarPrimitive.GridRow>
        </CalendarPrimitive.GridHead>
        <CalendarPrimitive.GridBody>
          {#each month.weeks as week, weekIndex (weekIndex)}
            <CalendarPrimitive.GridRow>
              {#each week as date (date.toString())}
                <CalendarPrimitive.Cell {date} month={month.value} class="mc-calendar-cell">
                  <CalendarPrimitive.Day class="mc-calendar-day" />
                </CalendarPrimitive.Cell>
              {/each}
            </CalendarPrimitive.GridRow>
          {/each}
        </CalendarPrimitive.GridBody>
      </CalendarPrimitive.Grid>
    {/each}
  {/snippet}
</CalendarPrimitive.Root>
