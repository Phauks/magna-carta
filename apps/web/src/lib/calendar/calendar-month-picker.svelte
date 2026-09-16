<script lang="ts">
  /*
   * The little month under the rail: where the reader is, and one press to be somewhere else.
   *
   * IT IS PINNED, AND THAT IS THE WHOLE POINT. It sits in the navigation column's footer, outside
   * the scroll region the calendars are in, so a firm with twenty rooms scrolls its rail without
   * losing the way back to today (owner, 2026-09-16). A picker that scrolled away with the list
   * would be a picker a reader had to go looking for, which is the thing the rail already was.
   *
   * IT SHOWS THE WINDOW, NOT A SELECTED DAY. The grid beside it is a month, a week or a day, and
   * what the reader is looking at is a RANGE. So the highlighted day is the window's anchor and
   * pressing another day moves the anchor — the view does not change, because somebody reading a
   * week who presses a Thursday means that Thursday's week, not a day view of it. It is the
   * calendar's own navigation at a second scale, never a second calendar.
   *
   * THE WEEK BEGINS WHERE THE FIRM SAID. The same `weekStartsOn` the grids take, so the little
   * month's columns and the big grid's columns are the same seven days in the same order. A picker
   * that began its week on Sunday beside a grid that began on Monday would be two calendars.
   */
  import { Calendar } from "@magna-carta/design-system/calendar";
  import type { DateValue } from "@internationalized/date";
  import { civilDateValue } from "./draft-text.ts";
  import { civilDateText } from "$lib/dates";
  import type { CalendarController } from "./calendar-controller.svelte.ts";

  let { controller }: { controller: CalendarController } = $props();

  const anchorValue = $derived(civilDateValue(controller.anchor));

  function goToDay(next: DateValue | undefined): void {
    const day = civilDateText(next);
    // Bits clears the value when the selected day is pressed again. The window has to be anchored
    // somewhere, so a clear means "stay" rather than "no day".
    if (day !== null) controller.goToDay(day);
  }
</script>

<!-- A rule above it, because it is a different thing from the list it sits under rather than the
     last row of that list. -->
<div class="border-t border-border-default pt-12">
  <Calendar
    type="single"
    value={anchorValue}
    onValueChange={goToDay}
    weekStartsOn={controller.weekStartsOn}
    fixedWeeks={true}
    aria-label="Go to a date"
  />
</div>
