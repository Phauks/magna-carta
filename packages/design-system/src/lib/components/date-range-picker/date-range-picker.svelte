<script lang="ts">
  /*
   * DateRangePicker — Tier 4 (Bits UI), composition-heavy. Two segmented date fields (start + end) in
   * one control, paired with a popover range calendar. Bits owns segment editing, the range
   * selection + highlight, the popover, and the a11y; we bake the composition so a caller writes
   * `<DateRangePicker bind:value label="Engagement period" />` (value is a {start, end} range of
   * @internationalized/date CalendarDate). Reuses the mc-date-field-* and mc-calendar-* recipes; the
   * range day states (data-range-start/middle/end, data-highlighted) add to the day recipe.
   *
   * Drag-to-select: press a day and drag across to define the range in one gesture. A drag spans
   * different days, so Bits' own click selection (which needs press + release on the SAME day) never
   * fires for it — the two paths coexist, and a plain click still selects via Bits. We drive the
   * bound `value` on pointer enter while pressed; pointer-up anywhere ends the drag.
   */
  import { DateRangePicker as DateRangePickerPrimitive } from "bits-ui";
  import type { DateValue } from "@internationalized/date";
  import CalendarIcon from "@lucide/svelte/icons/calendar";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { floatingContentClasses, PRESENCE_SCALE_FADE } from "../../internal/floating.ts";
  import type { WithoutChildrenOrChild } from "../../internal/types.ts";

  const RANGE_PARTS = ["start", "end"] as const;

  // DateRangePicker.Root renders no DOM of its own; the consumer's class dresses the field.
  // closeOnRangeSelect defaults false: the calendar stays open after a range so the user can adjust
  // the endpoints (re-pick or drag) rather than having it dismiss on the second click.
  let {
    value = $bindable(),
    class: className,
    label,
    closeOnRangeSelect = false,
    ...restProps
  }: WithoutChildrenOrChild<DateRangePickerPrimitive.RootProps> & {
    class?: string;
    label?: string;
  } = $props();

  // The day the current drag started on (set on pointer-down, cleared on pointer-up); null when idle.
  let dragAnchor = $state<DateValue | null>(null);

  function beginDrag(date: DateValue): void {
    dragAnchor = date;
    // Immediate feedback on press: if a COMPLETE range is already on the calendar, reset to the
    // pressed day at once so the old range doesn't linger until the pointer reaches another day (the
    // "only changes once I cover the other date" feel). While a selection is still in progress (start
    // picked, end not yet) we leave it to Bits, so click-a-start-then-click-an-end keeps working.
    if (value?.start && value?.end) {
      value = { start: date, end: date };
    }
  }
  function extendDrag(date: DateValue): void {
    // Only while a press is in progress, and only once the pointer reaches a DIFFERENT day (so a
    // plain click — same day, no movement — stays Bits' job).
    if (!dragAnchor || date.compare(dragAnchor) === 0) return;
    value =
      dragAnchor.compare(date) <= 0 ? { start: dragAnchor, end: date } : { start: date, end: dragAnchor };
  }
</script>

<!-- End the drag on pointer-up anywhere (the release may land outside the calendar). -->
<svelte:window onpointerup={() => (dragAnchor = null)} />

<DateRangePickerPrimitive.Root bind:value {closeOnRangeSelect} {...restProps}>
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
      floatingContentClasses("anchored", PRESENCE_SCALE_FADE),
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
                        <DateRangePickerPrimitive.Day
                          class="mc-calendar-day"
                          onpointerdown={() => beginDrag(date)}
                          onpointerenter={() => extendDrag(date)}
                        />
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
