<script lang="ts">
  /*
   * When a setting happens: the dates, the wall-clock times and the zone every kind of event shares.
   *
   * One component rather than two copies, because the matter-event form and the firm-event form ask
   * exactly these questions and would otherwise drift in the order they ask them, the ids they mint,
   * and the way an empty time reads. The rules are the draft's (event-draft.ts, `timingShortfalls`);
   * this file renders the answers and decides none of them.
   *
   * ONE MOMENT IS ONE LINE (the standing rule, and the owner's 2026-09-14 round on this form): the
   * day a thing starts, the hour it starts at, and the zone that hour is read in are one fact, so
   * they sit side by side and read left to right. Stacking them made four questions out of two and
   * doubled the height of a form that has to fit beside a calendar.
   *
   * THE TIME IS A TIME FIELD, not a text box hoping for `HH:MM`. The platform's own control knows
   * what a time of day is, offers the right keyboard on a phone, and reads back in the reader's own
   * clock convention — which a box that had to be told "24-hour, please" never could.
   *
   * THE ZONE READS BY SHORTCODE — "PST", not "America / Los Angeles" — because it sits at the end of
   * a line that already carries a date and a time. It is one control and not two: a record has ONE
   * zone (the column is one column, and a hearing does not start in Denver and end in Chicago), so
   * the ends line states the same code as a fact rather than offering a second control that could
   * only ever disagree with the first.
   *
   * AN EMPTY TIME IS ALL DAY. A filing has no hour, and a form that made somebody tick "all day"
   * before it would accept a date without a time is a form that asks a question the blank already
   * answers. So there is no checkbox: leaving the time empty is what all day means.
   */
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import type { DateValue } from "@internationalized/date";
  import { civilDateValue } from "./draft-text.ts";
  import type { EventTimingDraft } from "./event-draft.ts";
  import TimeZonePicker from "./time-zone-picker.svelte";
  import { timeZoneShortCode } from "./time-zone-options.ts";
  import { civilDateAsUtc, isCivilDate } from "./calendar-window.ts";
  import { civilDateText } from "$lib/dates";

  let {
    draft = $bindable(),
    idPrefix,
    preferred,
    disabled = false,
  }: {
    /** The timing half of the draft being edited. Bindable; the fields write straight into it. */
    draft: EventTimingDraft;
    /** Makes the ids this form mints unique on a page that may hold more than one record form. */
    idPrefix: string;
    /** The zones offered first: the reader's own and the firm's offices, in that order. */
    preferred: readonly string[];
    disabled?: boolean;
  } = $props();

  const startsOnValue = $derived(civilDateValue(draft.startsOn));
  const endsOnValue = $derived(civilDateValue(draft.endsOn));

  /*
   * The day the shortcode is worked out for: the event's own, where it has one. The same zone is
   * PST in January and PDT in July, so a control that answered from today would print the wrong
   * three letters beside half the hearings a firm records.
   */
  const shortCodeDay = $derived(
    draft.startsOn !== null && isCivilDate(draft.startsOn)
      ? civilDateAsUtc(draft.startsOn)
      : undefined,
  );
  /** The ends line states the record's one zone rather than offering a second control for it. */
  const zoneCode = $derived(draft.timeZone === "" ? "" : timeZoneShortCode(draft.timeZone, shortCodeDay));

  function recordStartsOn(next: DateValue | undefined): void {
    draft.startsOn = civilDateText(next);
  }

  function recordEndsOn(next: DateValue | undefined): void {
    draft.endsOn = civilDateText(next);
  }
</script>

<div class="flex flex-col gap-16">
  <!-- Starts: the day, the hour, the zone that hour is read in. One fact, one line.
       A flex row rather than a grid: the date takes what is left and the two short controls take
       what they need, which a track template could only say with a length off the token scale. -->
  <div class="flex flex-wrap items-end gap-12">
    <div class="flex min-w-0 flex-1 flex-col gap-8">
      <DatePicker label="Starts" value={startsOnValue} onValueChange={recordStartsOn} {disabled} />
    </div>
    <div class="flex flex-none flex-col gap-8">
      <Label for="{idPrefix}-starts-at-time">Time</Label>
      <Input
        id="{idPrefix}-starts-at-time"
        type="time"
        autocomplete="off"
        class="w-auto"
        {disabled}
        bind:value={draft.startsAtTime}
      />
    </div>
    <div class="flex w-40 flex-none flex-col gap-8">
      <Label for="{idPrefix}-time-zone">Zone</Label>
      <TimeZonePicker
        inputId="{idPrefix}-time-zone"
        label="Zone"
        compact
        on={shortCodeDay}
        {preferred}
        {disabled}
        bind:value={draft.timeZone}
      />
    </div>
  </div>

  <!-- Ends: the same line, and the zone as a STATEMENT — a record has one zone, and a second
       control for it could only ever disagree with the first. -->
  <div class="flex flex-wrap items-end gap-12">
    <div class="flex min-w-0 flex-1 flex-col gap-8">
      <DatePicker label="Ends" value={endsOnValue} onValueChange={recordEndsOn} {disabled} />
    </div>
    <div class="flex flex-none flex-col gap-8">
      <Label for="{idPrefix}-ends-at-time">Time</Label>
      <Input
        id="{idPrefix}-ends-at-time"
        type="time"
        autocomplete="off"
        class="w-auto"
        {disabled}
        bind:value={draft.endsAtTime}
      />
    </div>
    <div class="flex w-40 flex-none flex-col gap-8">
      <span class="text-sm font-medium text-text-default">Zone</span>
      <p class="pt-8 text-sm text-text-muted" title="A setting is read in one zone, set above.">
        {zoneCode === "" ? "—" : zoneCode}
      </p>
    </div>
  </div>
</div>
