<script lang="ts">
  /*
   * DatePicker — Tier 4 (Bits UI), composition-heavy. A segmented date field (each part — month, day,
   * year — is an editable spinbutton) paired with a popover calendar. Bits owns segment editing,
   * keyboard entry, the popover, and all the a11y; we bake the full composition so a caller writes
   * `<DatePicker type="single" bind:value label="Closing date" />`. Values are @internationalized/date
   * CalendarDate. The popover calendar reuses the mc-calendar-* recipes (golden rule 1); only the
   * segmented field adds recipes here.
   *
   * IT RENDERS TWO SIBLINGS, NOT ONE ELEMENT. The primitive's Root is a context provider with no DOM,
   * so a labelled picker emits the label and the field side by side with nothing around them. In a
   * flex column that stacks correctly; in a GRID it takes two tracks and the label lands in the next
   * column. So a caller putting one in a grid gives it a wrapper — every consumer does, and the four
   * that did not were caught the same way. The label carries its own `margin-block-end`, which is why
   * the component has never needed the wrapper for spacing and why the trap is quiet.
   */
  import { DatePicker as DatePickerPrimitive } from "bits-ui";
  import CalendarIcon from "@lucide/svelte/icons/calendar";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { floatingContentClasses, PRESENCE_SCALE_FADE } from "../../internal/floating.ts";
  import type { WithoutChildrenOrChild } from "../../internal/types.ts";
  import type { InputSize } from "../input/variants.ts";
  import { dateFieldClasses } from "./variants.ts";

  /*
   * DatePicker.Root renders no DOM of its own (no ref/class); the consumer's class dresses the field.
   *
   * `label` and `aria-label` are the two ways this control gets a name, and they are declared
   * separately because they land on DIFFERENT elements. The label is the primitive's own — it mints
   * the id the segment group points `aria-labelledby` at. An `aria-label` has to reach the group
   * itself, and the spread goes to Root, which renders nothing: left in restProps it would vanish
   * without a warning and leave the field unnamed. A field with a visible label wants the label; a
   * field with no room for one — a range's two boxes inside a column's filter menu — wants the
   * aria-label, and the group's own aria-labelledby is undefined there, so nothing overrides it.
   *
   * `aria-invalid` is declared for the same reason and no other: a form that marks its fields
   * refused has to be able to mark this one too. Bits stamps `data-invalid` from its own validation
   * and never writes `aria-invalid`, so a caller's flag is additive rather than a second opinion.
   */
  let {
    class: className,
    label,
    size = "default",
    "aria-label": ariaLabel,
    "aria-invalid": ariaInvalid,
    ...restProps
  }: WithoutChildrenOrChild<DatePickerPrimitive.RootProps> & {
    class?: string;
    /** Visible label above the field, rendered by the primitive so it names the segment group. */
    label?: string;
    /** Control height, from the same scale the Input and the Button use. */
    size?: InputSize;
    /** Accessible name for a field with no visible label. Lands on the segment group. */
    "aria-label"?: string;
    /** Marks the field refused, for a form that flags its fields together. Lands on the group. */
    "aria-invalid"?: "true" | "false" | undefined;
  } = $props();
</script>

<DatePickerPrimitive.Root {...restProps}>
  {#if label}
    <DatePickerPrimitive.Label class="mc-date-field-label">{label}</DatePickerPrimitive.Label>
  {/if}
  <DatePickerPrimitive.Input
    aria-label={ariaLabel}
    aria-invalid={ariaInvalid}
    class={mergeClasses(dateFieldClasses({ size }), className)}
  >
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
        floatingContentClasses("anchored", PRESENCE_SCALE_FADE),
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
