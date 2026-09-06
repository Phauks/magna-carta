<script lang="ts">
  /*
   * When a setting happens: the dates, the wall-clock times and the zone every kind of event shares.
   *
   * One component rather than two copies, because the matter-event form and the firm-event form ask
   * exactly these questions and would otherwise drift in the order they ask them, the ids they mint,
   * and the way an empty time reads. The rules are the draft's (event-draft.ts, `timingShortfalls`);
   * this file renders the answers and decides none of them.
   *
   * AN EMPTY TIME IS ALL DAY. A filing has no hour, and a form that made somebody tick "all day"
   * before it would accept a date without a time is a form that asks a question the blank already
   * answers. So there is no checkbox: leaving the time empty is what all day means, and a time that
   * does not read as a clock is refused beside the commit rather than explained under the field.
   */
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import type { DateValue } from "@internationalized/date";
  import { civilDateValue } from "./draft-text.ts";
  import type { EventTimingDraft } from "./event-draft.ts";
  import TimeZonePicker from "./time-zone-picker.svelte";

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

  function recordStartsOn(next: DateValue | undefined): void {
    draft.startsOn = next ? next.toString() : null;
  }

  function recordEndsOn(next: DateValue | undefined): void {
    draft.endsOn = next ? next.toString() : null;
  }
</script>

<div class="flex flex-col gap-16">
  <div class="grid gap-16 sm:grid-cols-2">
    <div class="flex flex-col gap-8">
      <DatePicker label="Date" value={startsOnValue} onValueChange={recordStartsOn} {disabled} />
    </div>
    <div class="flex flex-col gap-8">
      <Label for="{idPrefix}-starts-at-time">Time</Label>
      <Input
        id="{idPrefix}-starts-at-time"
        inputmode="numeric"
        autocomplete="off"
        {disabled}
        bind:value={draft.startsAtTime}
      />
    </div>
    <div class="flex flex-col gap-8">
      <DatePicker label="End date" value={endsOnValue} onValueChange={recordEndsOn} {disabled} />
    </div>
    <div class="flex flex-col gap-8">
      <Label for="{idPrefix}-ends-at-time">End time</Label>
      <Input
        id="{idPrefix}-ends-at-time"
        inputmode="numeric"
        autocomplete="off"
        {disabled}
        bind:value={draft.endsAtTime}
      />
    </div>
  </div>

  <div class="flex flex-col gap-8">
    <Label for="{idPrefix}-time-zone">Time zone</Label>
    <TimeZonePicker
      inputId="{idPrefix}-time-zone"
      label="Time zone"
      {preferred}
      {disabled}
      bind:value={draft.timeZone}
    />
  </div>
</div>
