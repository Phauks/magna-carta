<script lang="ts">
  /*
   * DatePicker — Tier 4 (Bits UI), composition-heavy. A segmented date field (each part — month, day,
   * year — is an editable spinbutton) paired with a popover calendar. Bits owns segment editing,
   * keyboard entry, the popover, and all the a11y; we bake the full composition so a caller writes
   * `<DatePicker type="single" bind:value label="Closing date" />`. Values are @internationalized/date
   * CalendarDate. The popover calendar reuses the mc-calendar-* recipes (golden rule 1); only the
   * segmented field adds recipes here.
   */
  import { DatePicker as DatePickerPrimitive } from "bits-ui";
  import CalendarIcon from "@lucide/svelte/icons/calendar";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { floatingContentClasses, PRESENCE_SCALE_FADE } from "../../internal/floating.ts";
  import type { WithoutChildrenOrChild } from "../../internal/types.ts";

  // DatePicker.Root renders no DOM of its own (no ref/class); the consumer's class dresses the field.
  let {
    class: className,
    label,
    ...restProps
  }: WithoutChildrenOrChild<DatePickerPrimitive.RootProps> & { class?: string; label?: string } =
    $props();
</script>

<DatePickerPrimitive.Root {...restProps}>
  {#if label}
    <DatePickerPrimitive.Label class="mc-date-field-label">{label}</DatePickerPrimitive.Label>
  {/if}
  <DatePickerPrimitive.Input class={mergeClasses("mc-date-field", className)}>
    {#snippet children({ segments })}
      {#each segments as segment, segmentIndex (segmentIndex)}
        <DatePickerPrimitive.Segment part={segment.part} class="mc-date-field-segment">
          {segment.value}
        </DatePickerPrimitive.Segment>
      {/each}
      <DatePickerPrimitive.Trigger class="mc-date-field-trigger" aria-label="Open calendar">
        <CalendarIcon class="mc-date-field-trigger-icon" aria-hidden="true" />
      </DatePickerPrimitive.Trigger>
    {/snippet}
  </DatePickerPrimitive.Input>
  <DatePickerPrimitive.Portal>
    <DatePickerPrimitive.Content
      sideOffset={6}
      class={mergeClasses(
        floatingContentClasses("dropdown", PRESENCE_SCALE_FADE),
        "mc-date-picker-content",
      )}
    >
      <DatePickerPrimitive.Calendar>
        {#snippet children({ months, weekdays })}
          <!-- Header is a <header> banner landmark; neutralize it (not a page banner). -->
          <DatePickerPrimitive.Header role="presentation" class="mc-calendar-header">
            <DatePickerPrimitive.PrevButton class="mc-calendar-nav">
              <ChevronLeft class="mc-calendar-nav-icon" aria-hidden="true" />
            </DatePickerPrimitive.PrevButton>
            <div class="mc-calendar-selects">
              <DatePickerPrimitive.MonthSelect aria-label="Month" class="mc-calendar-select" />
              <DatePickerPrimitive.YearSelect aria-label="Year" class="mc-calendar-select" />
            </div>
            <DatePickerPrimitive.NextButton class="mc-calendar-nav">
              <ChevronRight class="mc-calendar-nav-icon" aria-hidden="true" />
            </DatePickerPrimitive.NextButton>
          </DatePickerPrimitive.Header>
          {#each months as month (month.value.toString())}
            <DatePickerPrimitive.Grid class="mc-calendar-grid">
              <DatePickerPrimitive.GridHead>
                <DatePickerPrimitive.GridRow class="mc-calendar-weekdays">
                  {#each weekdays as weekday, weekdayIndex (weekdayIndex)}
                    <DatePickerPrimitive.HeadCell class="mc-calendar-weekday">
                      {weekday}
                    </DatePickerPrimitive.HeadCell>
                  {/each}
                </DatePickerPrimitive.GridRow>
              </DatePickerPrimitive.GridHead>
              <DatePickerPrimitive.GridBody>
                {#each month.weeks as week, weekIndex (weekIndex)}
                  <DatePickerPrimitive.GridRow>
                    {#each week as date (date.toString())}
                      <DatePickerPrimitive.Cell
                        {date}
                        month={month.value}
                        class="mc-calendar-cell"
                      >
                        <DatePickerPrimitive.Day class="mc-calendar-day" />
                      </DatePickerPrimitive.Cell>
                    {/each}
                  </DatePickerPrimitive.GridRow>
                {/each}
              </DatePickerPrimitive.GridBody>
            </DatePickerPrimitive.Grid>
          {/each}
        {/snippet}
      </DatePickerPrimitive.Calendar>
    </DatePickerPrimitive.Content>
  </DatePickerPrimitive.Portal>
</DatePickerPrimitive.Root>
