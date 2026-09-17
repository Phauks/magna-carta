<script lang="ts">
  /*
   * Calendar day states — every state the month-grid day recipe can be in, on one screen.
   *
   * This page exists because one of those states was UNREACHABLE on demand. A day that is both
   * today and the selected day only happens when the reader's selection lands on the real date, so
   * the bug where it rendered as near-white text on the white surface survived every review: you
   * could only see it by waiting for the calendar to be opened on the right day. The specimens
   * below select today deliberately, which is the whole simulation — `data-today` comes from the
   * clock and cannot be faked, so the fixture is the SELECTION, not the date.
   *
   * Everything else is anchored on a fixed month (the placeholder below) so the page reads the same
   * on every render and a screenshot pass is never chasing data. There is no fetch here and nothing
   * to wait for: the calendars are pure date arithmetic, so the screen is drawn in one frame.
   *
   * Dev builds only, like the developer console itself — behind the import.meta.env.DEV gate.
   */
  import type { Snippet } from "svelte";
  import { Calendar } from "@magna-carta/design-system/calendar";
  import { DateRangePicker } from "@magna-carta/design-system/date-range-picker";
  import {
    CalendarDate,
    getLocalTimeZone,
    today as todayIn,
    type DateValue,
  } from "@internationalized/date";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { DEVELOPER_CONSOLE_BACK } from "$lib/screen/screen-header.ts";

  /*
   * Today, in the reader's own zone — the same reading Bits makes when it sets `data-today`. A UTC
   * today would be a different day for half of every evening, and a specimen that quietly stopped
   * being about today is worse than no specimen: it would show the fixed state and prove nothing.
   * Selecting this value is the entire fixture for the today-and-selected pair.
   */
  const today = todayIn(getLocalTimeZone());

  /*
   * The fixed fixture month — March 2026. Chosen because it neither begins nor ends on the first
   * column of a week, so both neighbouring months show through the grid and the outside-month wash
   * has something to draw on either side of the month's own shape.
   */
  const FIXTURE_MONTH = new CalendarDate(2026, 3, 1);
  const fixtureDay = (dayOfMonth: number): CalendarDate => new CalendarDate(2026, 3, dayOfMonth);

  // A fortnight in the fixture month, for the range picker's band states.
  let fixtureRange = $state<{ start: DateValue | undefined; end: DateValue | undefined }>({
    start: fixtureDay(9),
    end: fixtureDay(20),
  });

  // Out of range below the 5th and above the 26th; the two mid-month Fridays are held unavailable,
  // which is a different refusal from out of range and has to read as one.
  const UNAVAILABLE_DAYS = [13, 20];
  const isFixtureDayUnavailable = (date: DateValue): boolean =>
    date.month === FIXTURE_MONTH.month && UNAVAILABLE_DAYS.includes(date.day);
</script>

<svelte:head><title>Calendar day states · Magna Carta</title></svelte:head>

{#snippet specimen(heading: string, note: string, body: Snippet)}
  <section class="flex flex-col gap-12">
    <div class="flex max-w-prose flex-col gap-4">
      <h2 class="text-lg font-semibold">{heading}</h2>
      <p class="text-sm text-text-muted">{note}</p>
    </div>
    <div class="flex flex-wrap items-start gap-24">{@render body()}</div>
  </section>
{/snippet}

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-32 bg-surface-default p-24 text-text-default">
    <header class="flex max-w-prose flex-col gap-8">
      <ScreenHeader title="Calendar day states" favoritable={false} back={DEVELOPER_CONSOLE_BACK} />
      <p class="text-sm text-text-muted">
        The month-grid day recipe in every state, rendered from the real design system. Today is a
        hairline ring and a heavier numeral rather than a fill, so it composes with selection instead
        of replacing it; outside-month days carry a wash on the cell, so the month's own shape is
        read rather than counted out. Nothing here fetches anything.
      </p>
    </header>

    {#snippet todayAndSelected()}
      <figure class="flex flex-col gap-8">
        <Calendar type="single" fixedWeeks={true} aria-label="Today, unselected" />
        <figcaption class="text-xs text-text-muted">Today, nothing selected</figcaption>
      </figure>
      <figure class="flex flex-col gap-8">
        <Calendar type="single" value={today} fixedWeeks={true} aria-label="Today, selected" />
        <figcaption class="text-xs text-text-muted">Today, and today is selected</figcaption>
      </figure>
      <figure class="flex flex-col gap-8">
        <Calendar
          type="single"
          value={today.add({ days: 2 })}
          fixedWeeks={true}
          aria-label="Today, another day selected"
        />
        <figcaption class="text-xs text-text-muted">Today, a different day selected</figcaption>
      </figure>
    {/snippet}
    {@render specimen(
      "Today, and today selected",
      "The pair the ring exists for. While today painted a fill, the middle calendar lost its " +
        "background to that fill and kept selection's near-white foreground — white on white, and " +
        "the date could not be read. Selection now keeps its fill and today redraws its hairline in " +
        "the fill's own foreground colour. Selecting today is the entire fixture: the clock supplies " +
        "the date, so this is the state as it really renders, not a mock of it.",
      todayAndSelected,
    )}

    {#snippet outsideMonth()}
      <figure class="flex flex-col gap-8">
        <Calendar
          type="single"
          placeholder={FIXTURE_MONTH}
          value={fixtureDay(17)}
          fixedWeeks={true}
          aria-label="Outside the month, fixed weeks"
        />
        <figcaption class="text-xs text-text-muted">Fixed weeks — always six rows</figcaption>
      </figure>
      <figure class="flex flex-col gap-8">
        <Calendar
          type="single"
          placeholder={FIXTURE_MONTH}
          value={fixtureDay(17)}
          aria-label="Outside the month, natural weeks"
        />
        <figcaption class="text-xs text-text-muted">Natural weeks — as many rows as the month needs</figcaption>
      </figure>
    {/snippet}
    {@render specimen(
      "Outside the month",
      "March 2026, which neither begins nor ends on a week boundary, so both neighbours show " +
        "through. The wash sits on the CELL rather than the day, so the neighbouring days read as " +
        "one continuous band while each day keeps its own rounded chip for hover and selection. " +
        "Hover an outside-month day: it darkens one step further, because its resting band is " +
        "already the colour an ordinary day hovers to.",
      outsideMonth,
    )}

    {#snippet refusals()}
      <figure class="flex flex-col gap-8">
        <Calendar
          type="single"
          placeholder={FIXTURE_MONTH}
          minValue={fixtureDay(5)}
          maxValue={fixtureDay(26)}
          isDateUnavailable={isFixtureDayUnavailable}
          fixedWeeks={true}
          aria-label="Out of range and unavailable"
        />
        <figcaption class="text-xs text-text-muted">
          Before the 5th and after the 26th is out of range; the 13th and the 20th are unavailable
        </figcaption>
      </figure>
    {/snippet}
    {@render specimen(
      "Out of range, and unavailable",
      "Two different refusals that share one appearance, deliberately: a reader does not need to " +
        "distinguish a day the field will not accept from a day that is spoken for — either way the " +
        "day cannot be chosen, and a second grey would only ask them to learn a code.",
      refusals,
    )}

    {#snippet bandStates()}
      <div class="flex flex-col gap-8">
        <DateRangePicker bind:value={fixtureRange} label="Engagement period" />
        <p class="text-xs text-text-muted">
          Open the calendar: the endpoints are filled chips, the span between them is a muted band,
          and today keeps its own ring inside all of it.
        </p>
      </div>
    {/snippet}
    {@render specimen(
      "The range picker's band states",
      "The same day recipe with the range states added. These rules are scoped to the range picker " +
        "and the scope is load-bearing: written bare, its transparent today fill reached every " +
        "calendar in the product and was what made a selected today unreadable in the first place. " +
        "This specimen is here so that scope cannot be lost without somebody seeing the band break.",
      bandStates,
    )}
  </div>
{:else}
  <p class="p-16 text-sm text-text-muted">
    The calendar day-states page is only available in development builds.
  </p>
{/if}
