<script lang="ts">
  /*
   * THE DAY BEING BOOKED, beside the form booking it.
   *
   * The owner's round of 2026-09-14: "when you select a day for scheduling, on the right side of the
   * modal, you should see that day's calendar so you can identify when people will have
   * availability." A person picking a time is answering a question about other people's afternoons,
   * and a form that asked it with nothing on screen was asking them to remember.
   *
   * IT IS THE PRODUCT'S ONE CALENDAR, not a second rendering of one. `CalendarView` with the firm
   * scope, the day view, no toolbar and no rail: the same reads, the same projection, the same
   * chips, so what stands beside the form is what the calendar screen would have shown for that day.
   * A second implementation here is exactly what `tooling/lint-one-ui` exists to refuse.
   *
   * IT FOLLOWS THE DATE FIELD, and says so when there is no date yet: a day grid anchored on today
   * while the form is being filled in for a Thursday three weeks out would be worse than nothing,
   * because it would look like an answer.
   *
   * WHOSE DAY IT IS CAN BE CHOSEN HERE. Availability is a question about particular calendars — this
   * attorney's, that room's — so the pane carries the Calendars menu (calendar-menu.svelte), which
   * is the rail's own selection in a dropdown: turn a colleague on here and their day appears in its
   * own column, and the rail says the same when the form closes (owner, 2026-09-18).
   */
  import FieldLabel from "@magna-carta/design-system/field-label";
  import CalendarView from "./calendar-view.svelte";
  import { isCivilDate } from "./calendar-window.ts";

  let {
    date,
    heading = "That day",
  }: {
    /** The civil day the form is being filled in for, or null while nobody has said. */
    date: string | null;
    /** What the pane is called above the grid. */
    heading?: string;
  } = $props();

  const day = $derived(date !== null && isCivilDate(date) ? date : null);
  /** The one honest thing to say before a date has been chosen. */
  const WAITING = "Choose a date and this day's calendar appears here.";
</script>

<div class="flex h-full min-h-0 flex-col gap-8">
  <FieldLabel as="p">{heading}</FieldLabel>
  {#if day === null}
    <p class="text-sm text-text-muted">{WAITING}</p>
  {:else}
    {#key day}
      <CalendarView
        scope={{ kind: "firm" }}
        view="day"
        anchor={day}
        toolbar={false}
        calendarMenu
        class="min-h-0 flex-1"
      />
    {/key}
  {/if}
</div>
