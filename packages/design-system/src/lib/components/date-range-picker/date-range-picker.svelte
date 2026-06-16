<script lang="ts">
  /*
   * DateRangePicker — Tier 4 (Bits UI), composition-heavy. Two segmented date fields (start + end) in
   * one control, paired with a popover range calendar. Bits owns segment editing, the range
   * selection + highlight, the popover, and the a11y; we bake the composition so a caller writes
   * `<DateRangePicker bind:value label="Engagement period" />` (value is a {start, end} range of
   * @internationalized/date CalendarDate). Reuses the mc-date-field-* and mc-calendar-* recipes; the
   * range day states (data-range-start/middle/end, data-highlighted) add to the day recipe.
   */
  import { DateRangePicker as DateRangePickerPrimitive } from "bits-ui";
  import CalendarIcon from "@lucide/svelte/icons/calendar";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { floatingContentClasses, PRESENCE_SCALE_FADE } from "../../internal/floating.ts";
  import type { WithoutChildrenOrChild } from "../../internal/types.ts";

  const RANGE_PARTS = ["start", "end"] as const;

  // DateRangePicker.Root renders no DOM of its own; the consumer's class dresses the field.
  let {
    class: className,
    label,
    ...restProps
  }: WithoutChildrenOrChild<DateRangePickerPrimitive.RootProps> & {
    class?: string;
    label?: string;
  } = $props();
</script>

<DateRangePickerPrimitive.Root {...restProps}>
  {#if label}
    <DateRangePickerPrimitive.Label class="mc-date-field-label">{label}</DateRangePickerPrimitive.Label>
  {/if}
  <div class={mergeClasses("mc-date-field", className)}>
    {#each RANGE_PARTS as rangePart (rangePart)}
      <DateRangePickerPrimitive.Input type={rangePart} class="mc-date-range-input">
        {#snippet children({ segments })}
          {#each segments as segment, segmentIndex (segmentIndex)}
            <DateRangePickerPrimitive.Segment part={segment.part} class="mc-date-field-segment">
              {segment.value}
            </DateRangePickerPrimitive.Segment>
          {/each}
        {/snippet}
      </DateRangePickerPrimitive.Input>
      {#if rangePart === "start"}
        <span class="mc-date-range-separator" aria-hidden="true">–</span>
      {/if}
    {/each}
    <DateRangePickerPrimitive.Trigger class="mc-date-field-trigger" aria-label="Open calendar">
      <CalendarIcon class="mc-date-field-trigger-icon" aria-hidden="true" />
    </DateRangePickerPrimitive.Trigger>
  </div>
  <DateRangePickerPrimitive.Content
    sideOffset={6}
    class={mergeClasses(
      floatingContentClasses("dropdown", PRESENCE_SCALE_FADE),
      "mc-date-picker-content",
    )}
  >
      <DateRangePickerPrimitive.Calendar>
        {#snippet children({ months, weekdays })}
          <DateRangePickerPrimitive.Header role="presentation" class="mc-calendar-header">
            <DateRangePickerPrimitive.PrevButton class="mc-calendar-nav">
              <ChevronLeft class="mc-calendar-nav-icon" aria-hidden="true" />
            </DateRangePickerPrimitive.PrevButton>
            <div class="mc-calendar-selects">
              <DateRangePickerPrimitive.MonthSelect aria-label="Month" class="mc-calendar-select" />
              <DateRangePickerPrimitive.YearSelect aria-label="Year" class="mc-calendar-select" />
            </div>
            <DateRangePickerPrimitive.NextButton class="mc-calendar-nav">
              <ChevronRight class="mc-calendar-nav-icon" aria-hidden="true" />
            </DateRangePickerPrimitive.NextButton>
          </DateRangePickerPrimitive.Header>
          {#each months as month (month.value.toString())}
            <DateRangePickerPrimitive.Grid class="mc-calendar-grid">
              <DateRangePickerPrimitive.GridHead>
                <DateRangePickerPrimitive.GridRow class="mc-calendar-weekdays">
                  {#each weekdays as weekday, weekdayIndex (weekdayIndex)}
                    <DateRangePickerPrimitive.HeadCell class="mc-calendar-weekday">
                      {weekday}
                    </DateRangePickerPrimitive.HeadCell>
                  {/each}
                </DateRangePickerPrimitive.GridRow>
              </DateRangePickerPrimitive.GridHead>
              <DateRangePickerPrimitive.GridBody>
                {#each month.weeks as week, weekIndex (weekIndex)}
                  <DateRangePickerPrimitive.GridRow>
                    {#each week as date (date.toString())}
                      <DateRangePickerPrimitive.Cell
                        {date}
                        month={month.value}
                        class="mc-calendar-cell"
                      >
                        <DateRangePickerPrimitive.Day class="mc-calendar-day" />
                      </DateRangePickerPrimitive.Cell>
                    {/each}
                  </DateRangePickerPrimitive.GridRow>
                {/each}
              </DateRangePickerPrimitive.GridBody>
            </DateRangePickerPrimitive.Grid>
          {/each}
        {/snippet}
      </DateRangePickerPrimitive.Calendar>
    </DateRangePickerPrimitive.Content>
</DateRangePickerPrimitive.Root>
