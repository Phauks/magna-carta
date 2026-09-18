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
   * day a thing starts and the hour it starts at are one fact, so they sit side by side and read
   * left to right. Stacking them made four questions out of two and doubled the height of a form
   * that has to fit beside a calendar.
   *
   * EACH DATE FIELD IS WRAPPED, AND THE WRAPPER IS LOAD-BEARING. A labelled DatePicker renders TWO
   * SIBLINGS — the primitive's Root is a context provider with no DOM of its own, so the label and
   * the segmented field come out side by side with nothing around them. In a flex column they
   * stack; in a GRID they take two tracks, which is exactly what FieldRow is. Unwrapped, "Starts"
   * took the first column, the date field took the second, and Time wrapped onto a line of its own
   * — so the row this file exists to keep straight was three cells in two columns (owner,
   * 2026-09-16: "start time and end time fields look wierd"). The design system documents the trap
   * and names the thirteen consumers that wrap for it. The gap is 4 rather than 8 because the date
   * label carries its own 4 of margin, and 4 + 4 is the 8 the Time group beside it uses — the two
   * labels sit the same distance above their controls, which is the whole point of the row.
   *
   * THE TWO LINES ARE THE SAME LINE TWICE, which is why they are built on the design system's
   * FieldRow rather than out of flex parts. A row of FITTED controls is a row whose widths move with
   * what is in them: an empty time field and a filled one are different widths in every browser, so
   * Starts and Ends drifted out of alignment the moment somebody answered one of them (owner,
   * 2026-09-14: "size of start and end boxes are slightly different, perhaps only when one has
   * value"). Equal tracks cannot do that.
   *
   * THE TIME IS A TIME FIELD, not a text box hoping for `HH:MM`. The platform's own control knows
   * what a time of day is, offers the right keyboard on a phone, and reads back in the reader's own
   * clock convention — which a box that had to be told "24-hour, please" never could.
   *
   * THE ZONE IS ITS OWN LINE, AND A REAL CONTROL. It sat in a 40-pixel slot at the end of the Starts
   * line, with the Ends line stating the same code as a sentence in a slot the same size — so the
   * list of zones opened into a field too narrow to read it, and the two lines were visibly
   * different shapes (owner, 2026-09-14: "zone dropdown is separate from where it should be, one is
   * a dropdown, the other isn't and i cant see the contents of the dropdown"). A record still has
   * ONE zone, so there is one control for it, asked under the two moments it qualifies, at a measure
   * that can show a list of continents and cities.
   *
   * A FIELD SAYS WHAT IT STILL NEEDS, ONCE A SAVE HAS BEEN REFUSED. The commit's refusal is one
 * sentence at the weak end of the bar, which tells a reader what is wrong and leaves them to find
 * the field (owner, 2026-09-16: "We need better visual language to showcase what is still required
 * when the item cannot be saved"). A shortfall now carries the field it is about (shortfall.ts), so
 * the same sentence is also shown beneath the control and the control is marked `aria-invalid` —
 * one wording, written in the draft and rendered twice, so the bar and the field cannot disagree.
 * Nothing is marked before a save was ASKED for: a form that opens with every unanswered field
 * already marked has told the reader they are wrong for not having typed yet.
 *
 * AN EMPTY TIME IS ALL DAY, AND THERE IS A CONTROL THAT SAYS SO. A filing has no hour, so the
   * record stores no time for it and a date with no time has always meant all day. What was missing
   * was the way to SAY it: a person recording a three-day trial typed hours into both ends because
   * the form offered nothing else, and the grid then drew the trial across the hours (owner,
   * 2026-09-18: "allow setting events as All Day to put them there, rather than by timing"). The
   * All Day switch is a reading of the two time fields (event-draft.ts, `readsAsAllDay`): choosing
   * it clears them and holds them disabled, so the record still stores what it always stored. The
   * time fields stay in place rather than vanishing, because a control that disappears moves the
   * fields under it.
   */
  import Checkbox from "@magna-carta/design-system/checkbox";
  import FieldRow from "@magna-carta/design-system/field-row";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import type { DateValue } from "@internationalized/date";
  import { civilDateValue } from "./draft-text.ts";
  import { asAllDay, readsAsAllDay, TIMING_FIELDS, type EventTimingDraft } from "./event-draft.ts";
  import { shortfallFor, type Shortfall } from "./shortfall.ts";
  import FieldRefusal from "./field-refusal.svelte";
  import TimeZonePicker from "./time-zone-picker.svelte";
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

  /*
   * Whether the hours are switched off. Read from the draft ONCE, when the fields mount: a record
   * opened with no hours is all day, a form opened from an hour on the grid is not. It is not a
   * derived, because a blank form whose date has just been chosen has no hours yet either, and a
   * switch that flipped itself on at that moment would disable the time field the reader was about
   * to reach for.
   */
  let allDay = $state(readsAsAllDay(draft));

  function chooseAllDay(next: boolean): void {
    allDay = next;
    if (next) draft = { ...draft, ...asAllDay(draft) };
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
  function recordStartsOn(next: DateValue | undefined): void {
    draft.startsOn = civilDateText(next);
  }

  function recordEndsOn(next: DateValue | undefined): void {
    draft.endsOn = civilDateText(next);
  }
</script>

<div class="flex flex-col gap-16">
  <!-- Starts: the day and the hour, on equal tracks so the line below can be the same line. -->
  <FieldRow columns={2}>
    <div class="flex flex-col gap-4">
      <DatePicker
        label="Starts"
        value={startsOnValue}
        onValueChange={recordStartsOn}
        aria-invalid={startsOnRefusal === undefined ? undefined : "true"}
        {disabled}
      />
      <FieldRefusal refusal={startsOnRefusal} />
    </div>
    <div class="flex flex-col gap-8">
      <Label for="{idPrefix}-starts-at-time">Time</Label>
      <Input
        id="{idPrefix}-starts-at-time"
        type="time"
        autocomplete="off"
        aria-invalid={startsAtTimeRefusal === undefined ? undefined : "true"}
        disabled={disabled || allDay}
        bind:value={draft.startsAtTime}
      />
      <FieldRefusal refusal={startsAtTimeRefusal} />
    </div>
  </FieldRow>

  <!-- Ends: the same two tracks, so answering a start never shifts the fields under it. -->
  <FieldRow columns={2}>
    <div class="flex flex-col gap-4">
      <DatePicker
        label="Ends"
        value={endsOnValue}
        onValueChange={recordEndsOn}
        aria-invalid={endsOnRefusal === undefined ? undefined : "true"}
        {disabled}
      />
      <FieldRefusal refusal={endsOnRefusal} />
    </div>
    <div class="flex flex-col gap-8">
      <Label for="{idPrefix}-ends-at-time">Time</Label>
      <Input
        id="{idPrefix}-ends-at-time"
        type="time"
        autocomplete="off"
        aria-invalid={endsAtTimeRefusal === undefined ? undefined : "true"}
        disabled={disabled || allDay}
        bind:value={draft.endsAtTime}
      />
      <FieldRefusal refusal={endsAtTimeRefusal} />
    </div>
  </FieldRow>

  <!-- All day: the hours switched off and cleared. The record stores an empty time for it. -->
  <div class="flex items-center gap-8">
    <Checkbox
      id="{idPrefix}-all-day"
      checked={allDay}
      {disabled}
      onCheckedChange={(checked) => chooseAllDay(checked === true)}
    />
    <Label for="{idPrefix}-all-day" class="font-normal">All day</Label>
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
