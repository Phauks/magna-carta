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
   * AN EMPTY TIME IS ALL DAY. A filing has no hour, and a form that made somebody tick "all day"
   * before it would accept a date without a time is a form that asks a question the blank already
   * answers. So there is no checkbox: leaving the time empty is what all day means.
   */
  import FieldRow from "@magna-carta/design-system/field-row";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import type { DateValue } from "@internationalized/date";
  import { civilDateValue } from "./draft-text.ts";
  import type { EventTimingDraft } from "./event-draft.ts";
  import TimeZonePicker from "./time-zone-picker.svelte";
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
      <DatePicker label="Starts" value={startsOnValue} onValueChange={recordStartsOn} {disabled} />
    </div>
    <div class="flex flex-col gap-8">
      <Label for="{idPrefix}-starts-at-time">Time</Label>
      <Input
        id="{idPrefix}-starts-at-time"
        type="time"
        autocomplete="off"
        {disabled}
        bind:value={draft.startsAtTime}
      />
    </div>
  </FieldRow>

  <!-- Ends: the same two tracks, so answering a start never shifts the fields under it. -->
  <FieldRow columns={2}>
    <div class="flex flex-col gap-4">
      <DatePicker label="Ends" value={endsOnValue} onValueChange={recordEndsOn} {disabled} />
    </div>
    <div class="flex flex-col gap-8">
      <Label for="{idPrefix}-ends-at-time">Time</Label>
      <Input
        id="{idPrefix}-ends-at-time"
        type="time"
        autocomplete="off"
        {disabled}
        bind:value={draft.endsAtTime}
      />
    </div>
  </FieldRow>

  <!-- The zone both moments are read in, asked once, at a measure that can show the list. -->
  <div class="flex flex-col gap-8">
    <Label for="{idPrefix}-time-zone">Zone</Label>
    <TimeZonePicker
      inputId="{idPrefix}-time-zone"
      label="Zone"
      on={shortCodeDay}
      {preferred}
      {disabled}
      bind:value={draft.timeZone}
    />
  </div>
</div>
