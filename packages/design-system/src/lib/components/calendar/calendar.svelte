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
   */
  import { Calendar as CalendarPrimitive } from "bits-ui";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChildrenOrChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<CalendarPrimitive.RootProps> = $props();
</script>

<CalendarPrimitive.Root bind:ref class={mergeClasses("mc-calendar", className)} {...restProps}>
  {#snippet children({ months, weekdays })}
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
