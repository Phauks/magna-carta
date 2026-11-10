<script lang="ts">
  /*
   * When a setting happens: the two moments and the zone every kind of event shares.
   *
   * One component rather than two copies, because the matter-event form and the firm-event form ask
   * exactly these questions and would otherwise drift in the order they ask them, the ids they mint,
   * and the way an empty time reads. The rules are the draft's (event-draft.ts, `timingShortfalls`,
   * `withStartsOn`, `withStartsAtTime`); this file renders the answers and decides none of them.
   *
   * ONE MOMENT IS ONE FIELD (owner, 2026-11-10). The day a thing starts and the hour it starts at
   * are one fact, so they are asked in the design system's DateTimeField: one box holding the day
   * and the time, opening one panel with the month and a list of times. It replaced a date picker
   * beside the browser's own time box, which drew in a different shape from everything around it
   * (owner, 2026-11-09: "the time is not good looking"). The list offers every fifteen minutes and
   * the field takes any minute, so a hearing at 9:40 is still one answer.
   *
   * THE END FOLLOWS THE START. Choosing a start date fills the end date with it, and choosing a
   * start time on an event with no end time puts the end an hour later (owner, 2026-11-09: "when
   * making an event, assume start and end date are the same"). The Ends list then starts after the
   * start time and says how long each choice runs. Both defaults live in the draft, so they are
   * tested without a browser.
   *
   * ALL DAY IS THE START'S "NO TIME" ROW. A filing has no hour, so the record stores no time for
   * it, and a date with no time has always meant all day. The way to SAY it used to be a checkbox
   * under the fields (owner, 2026-09-18); it is now the first row of the Starts list, because that
   * is where a person choosing an hour is looking. Choosing it clears both times, the Starts field
   * reads "All day" where its time was, and the Ends field asks for a day alone. Choosing a time
   * sets it back. `allDay` is read from the draft ONCE, when the fields mount: a blank form whose
   * date has just been chosen has no hours yet either, and a field that turned itself all day at
   * that moment would hide the time the reader was about to choose.
   *
   * A FIELD SAYS WHAT IT STILL NEEDS, ONCE A SAVE HAS BEEN REFUSED. A shortfall carries the field it
   * is about (shortfall.ts), so the same sentence the bar shows is shown beneath the control and the
   * control is marked `aria-invalid`. The date and the time of one moment share one control now,
   * so either half's refusal marks it and both sentences sit beneath it. Nothing is marked before a
   * save was ASKED for.
   *
   * THE ZONE IS ITS OWN LINE, AND A REAL CONTROL, asked once under the two moments it qualifies, at
   * a measure that can show a list of continents and cities (owner, 2026-09-14). Its shortcode on
   * the record's own day rides beside each time, because the same zone is PST in January and PDT
   * in July.
   */
  import Label from "@magna-carta/design-system/label";
  import { DateTimeField } from "@magna-carta/design-system/date-time-field";
  import { describeTimeZone } from "@magna-carta/design-system/formatters";
  import type { DateValue } from "@internationalized/date";
  import { civilDateValue } from "./draft-text.ts";
  import {
    asAllDay,
    readsAsAllDay,
    TIMING_FIELDS,
    withStartsAtTime,
    withStartsOn,
    type EventTimingDraft,
  } from "./event-draft.ts";
  import { shortfallFor, type Shortfall } from "./shortfall.ts";
  import FieldRefusal from "./field-refusal.svelte";
  import TimeZonePicker from "./time-zone-picker.svelte";
  import { isResolvableTimeZone } from "./time-zone-options.ts";
  import { civilDateAsUtc, isCivilDate } from "./calendar-window.ts";
  import { civilDateText } from "$lib/dates";

  let {
    draft = $bindable(),
    idPrefix,
    preferred,
    disabled = false,
    shortfalls = [],
  }: {
    /** The timing half of the draft being edited. Bindable; the fields write straight into it. */
    draft: EventTimingDraft;
    /** Makes the ids this form mints unique on a page that may hold more than one record form. */
    idPrefix: string;
    /** The zones offered first: the reader's own and the firm's offices, in that order. */
    preferred: readonly string[];
    disabled?: boolean;
    /**
     * What these fields still need, each naming its own. Empty until the form has asked to save and
     * been refused, which is what keeps an untouched form unmarked.
     */
    shortfalls?: readonly Shortfall[];
  } = $props();

  const startsOnRefusal = $derived(shortfallFor(shortfalls, TIMING_FIELDS.startsOn));
  const startsAtTimeRefusal = $derived(shortfallFor(shortfalls, TIMING_FIELDS.startsAtTime));
  const endsOnRefusal = $derived(shortfallFor(shortfalls, TIMING_FIELDS.endsOn));
  const endsAtTimeRefusal = $derived(shortfallFor(shortfalls, TIMING_FIELDS.endsAtTime));
  const timeZoneRefusal = $derived(shortfallFor(shortfalls, TIMING_FIELDS.timeZone));
  const startsRefused = $derived(
    startsOnRefusal !== undefined || startsAtTimeRefusal !== undefined,
  );
  const endsRefused = $derived(endsOnRefusal !== undefined || endsAtTimeRefusal !== undefined);

  let allDay = $state(readsAsAllDay(draft));

  function chooseAllDay(next: boolean): void {
    allDay = next;
    if (next) draft = asAllDay(draft);
  }

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
  const zoneCode = $derived(
    isResolvableTimeZone(draft.timeZone)
      ? describeTimeZone(draft.timeZone, shortCodeDay).abbreviation
      : undefined,
  );

  /* The Ends list measures from the start only while both moments are on the same day. */
  const endsMeasuredFrom = $derived(
    draft.startsAtTime !== "" && (draft.endsOn === null || draft.endsOn === draft.startsOn)
      ? draft.startsAtTime
      : undefined,
  );

  function recordStartsOn(next: DateValue | undefined): void {
    draft = withStartsOn(draft, civilDateText(next));
  }

  function recordEndsOn(next: DateValue | undefined): void {
    draft.endsOn = civilDateText(next);
  }
</script>

<div class="flex flex-col gap-16">
  <div class="flex flex-col gap-4">
    <DateTimeField
      id="{idPrefix}-starts-on"
      label="Starts"
      date={startsOnValue}
      onDateChange={recordStartsOn}
      bind:time={() => draft.startsAtTime, (next) => (draft = withStartsAtTime(draft, next))}
      bind:noTime={() => allDay, chooseAllDay}
      allowNoTime
      noTimeLabel="All day"
      zoneLabel={zoneCode}
      aria-invalid={startsRefused ? "true" : undefined}
      {disabled}
    />
    <FieldRefusal refusal={startsOnRefusal} />
    <FieldRefusal refusal={startsAtTimeRefusal} />
  </div>

  <div class="flex flex-col gap-4">
    <DateTimeField
      id="{idPrefix}-ends-on"
      label="Ends"
      mode={allDay ? "date" : "date-time"}
      date={endsOnValue}
      onDateChange={recordEndsOn}
      bind:time={draft.endsAtTime}
      durationFrom={endsMeasuredFrom}
      placeholder={startsOnValue}
      zoneLabel={zoneCode}
      aria-invalid={endsRefused ? "true" : undefined}
      {disabled}
    />
    <FieldRefusal refusal={endsOnRefusal} />
    <FieldRefusal refusal={endsAtTimeRefusal} />
  </div>

  <!-- The zone both moments are read in, asked once, at a measure that can show the list. Named in
       full: "Zone" alone read as a question about a place (owner, 2026-09-18). -->
  <div class="flex flex-col gap-8">
    <Label for="{idPrefix}-time-zone">Time zone</Label>
    <TimeZonePicker
      inputId="{idPrefix}-time-zone"
      label="Time zone"
      on={shortCodeDay}
      {preferred}
      {disabled}
      bind:value={draft.timeZone}
    />
    <FieldRefusal refusal={timeZoneRefusal} />
  </div>
</div>
