<script lang="ts">
  /*
   * Whether a setting repeats, and on what rule.
   *
   * ONE CONTROL, BOTH FORMS. A repeating hearing and a weekly staff meeting are the same question,
   * so they are the same component -- the same shape `record-timing-fields.svelte` takes for the
   * dates every event shares, and for the same reason: two copies drift in the order they ask and
   * in what an empty answer means.
   *
   * THE ANSWER IS EDITED, THE LINE IS WRITTEN ONCE. The draft holds a `RecurrenceRule` and the
   * request writes it out at the send, so nothing here parses or spells RFC 5545. The grammar is
   * @magna-carta/civil-time's and the server refuses a line it could not itself have written, which
   * is the whole reason the grammar lives in a package both sides depend on.
   *
   * IT SAYS BACK WHAT IT UNDERSTOOD. Every combination of four controls is read out as a sentence
   * under them ("Repeats every second Tuesday, 12 times"), because a repeat rule is the one answer
   * on this form whose consequence is invisible: a person who meant fortnightly and got weekly finds
   * out when somebody misses a hearing. The sentence is the same one the record pane shows.
   *
   * A RULE FROM ANOTHER CALENDAR IS SHOWN, NEVER SILENTLY REWRITTEN. `parseRecurrence` answers null
   * for a line with parts this form cannot offer, and the draft carries that null -- so the control
   * states that the rule was recorded elsewhere and offers to replace it rather than presenting a
   * simplified version that saving would make true.
   */
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Switch from "@magna-carta/design-system/switch";
  import FieldRow from "@magna-carta/design-system/field-row";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import * as Select from "@magna-carta/design-system/select";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import type { DateValue } from "@internationalized/date";
  import {
    weeklyRecurrence,
    MAX_COUNT,
    MAX_INTERVAL,
    type RecurrenceEnd,
    type RecurrenceFrequency,
    type RecurrenceRule,
    type WeekdayCode,
  } from "@magna-carta/civil-time/recurrence";
  import { civilDateValue } from "./draft-text.ts";
  import { civilDateText } from "$lib/dates";
  import { lastOccurrenceSentence, WEEKDAY_CHOICES, writtenRecurrence } from "./recurrence-sentence.ts";

  let {
    rule = $bindable(),
    startsOn,
    idPrefix,
    disabled = false,
    unreadable = false,
  }: {
    /** The rule being edited, or null for a setting that happens once. Bindable. */
    rule: RecurrenceRule | null;
    /** The day the series begins: two frequencies are stated relative to it. */
    startsOn: string | null;
    idPrefix: string;
    disabled?: boolean;
    /**
     * Whether the record carries a rule this product cannot present. The draft cannot say so by
     * itself -- an unreadable line parses to the same null a one-off has -- so the caller, which saw
     * the stored line, tells the control.
     */
    unreadable?: boolean;
  } = $props();

  const FREQUENCIES: { value: RecurrenceFrequency; label: string }[] = [
    { value: "daily", label: "Day" },
    { value: "weekly", label: "Week" },
    { value: "monthly", label: "Month" },
    { value: "yearly", label: "Year" },
  ];

  const repeats = $derived(rule !== null);
  const sentence = $derived(rule === null ? "" : writtenRecurrence(rule, startsOn));
  const lastLine = $derived(rule === null ? "" : lastOccurrenceSentence(rule, startsOn));
  const endsOnValue = $derived(civilDateValue(rule?.end.kind === "on" ? rule.end.date : null));

  /** The monthly question, which only makes sense once a start day says which weekday it is. */
  const monthlyChoices = $derived(
    startsOn === null || rule === null
      ? []
      : [
          { value: "byDate", label: `On the same date` },
          { value: "byWeekday", label: `On the same weekday` },
        ],
  );

  function setRepeats(on: boolean): void {
    // Turning it on opens on the commonest answer rather than an empty rule nobody can commit.
    rule = on ? weeklyRecurrence() : null;
  }

  function change(patch: Partial<RecurrenceRule>): void {
    if (rule === null) return;
    rule = { ...rule, ...patch };
  }

  function setInterval(text: string): void {
    const value = Number(text);
    if (!Number.isInteger(value) || value < 1 || value > MAX_INTERVAL) return;
    change({ interval: value });
  }

  function toggleWeekday(code: WeekdayCode): void {
    if (rule === null) return;
    const chosen = rule.weekdays.includes(code)
      ? rule.weekdays.filter((each) => each !== code)
      : [...rule.weekdays, code];
    change({ weekdays: chosen });
  }

  function setEnding(kind: RecurrenceEnd["kind"]): void {
    if (kind === "never") change({ end: { kind: "never" } });
    // Opening values a person is likely to keep: a dozen occurrences, or today's own date to move.
    if (kind === "after") change({ end: { kind: "after", count: 12 } });
    if (kind === "on") change({ end: { kind: "on", date: startsOn ?? "" } });
  }

  function setCount(text: string): void {
    const value = Number(text);
    if (!Number.isInteger(value) || value < 1 || value > MAX_COUNT) return;
    change({ end: { kind: "after", count: value } });
  }

  function setEndDate(next: DateValue | undefined): void {
    change({ end: { kind: "on", date: civilDateText(next) ?? "" } });
  }
</script>

<div class="flex flex-col gap-12">
  <div class="flex items-center justify-between gap-12">
    <Label id="{idPrefix}-repeats-label">Repeats</Label>
    <Switch
      aria-labelledby="{idPrefix}-repeats-label"
      checked={repeats}
      onCheckedChange={setRepeats}
      {disabled}
    />
  </div>

  {#if unreadable && rule === null}
    <!-- Said plainly rather than shown as "does not repeat", which is the one wrong answer here. -->
    <p class="text-xs text-text-muted">
      This setting repeats on a rule recorded in another calendar. Turning Repeats on replaces it.
    </p>
  {/if}

  {#if rule !== null}
    <!-- Every N days/weeks/months/years: one fact on one line, as the timing fields read. -->
    <FieldRow columns={2}>
      <div class="flex flex-col gap-8">
        <Label for="{idPrefix}-repeat-interval">Every</Label>
        <Input
          id="{idPrefix}-repeat-interval"
          type="number"
          min="1"
          max={MAX_INTERVAL}
          inputmode="numeric"
          autocomplete="off"
          {disabled}
          value={String(rule.interval)}
          oninput={(event) => setInterval(event.currentTarget.value)}
        />
      </div>
      <div class="flex flex-col gap-8">
        <Label id="{idPrefix}-repeat-frequency-label">Unit</Label>
        <Select.Root
          type="single"
          items={FREQUENCIES}
          {disabled}
          value={rule.frequency}
          onValueChange={(picked) => change({ frequency: picked as RecurrenceFrequency })}
        >
          <Select.Trigger aria-labelledby="{idPrefix}-repeat-frequency-label">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {#each FREQUENCIES as choice (choice.value)}
              <Select.Item value={choice.value} label={choice.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    </FieldRow>

    {#if rule.frequency === "weekly"}
      <!-- Which days. Empty means the day the series starts on, which the sentence says out loud. -->
      <div class="flex flex-col gap-8">
        <Label id="{idPrefix}-repeat-weekdays-label">On</Label>
        <div class="flex flex-wrap gap-4" role="group" aria-labelledby="{idPrefix}-repeat-weekdays-label">
          {#each WEEKDAY_CHOICES as day (day.code)}
            <Button
              type="button"
              size="sm"
              variant={rule.weekdays.includes(day.code) ? "primary" : "secondary"}
              aria-pressed={rule.weekdays.includes(day.code)}
              aria-label={day.name}
              {disabled}
              onclick={() => toggleWeekday(day.code)}
            >
              {day.short}
            </Button>
          {/each}
        </div>
      </div>
    {/if}

    {#if rule.frequency === "monthly" && monthlyChoices.length > 0}
      <div class="flex flex-col gap-8">
        <Label id="{idPrefix}-repeat-monthly-label">Which day</Label>
        <Select.Root
          type="single"
          items={monthlyChoices}
          {disabled}
          value={rule.monthly}
          onValueChange={(picked) => change({ monthly: picked === "byWeekday" ? "byWeekday" : "byDate" })}
        >
          <Select.Trigger aria-labelledby="{idPrefix}-repeat-monthly-label">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {#each monthlyChoices as choice (choice.value)}
              <Select.Item value={choice.value} label={choice.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    {/if}

    <!-- Where it stops: three rows, each carrying its own answer, so the choice and the value it
         needs are read together rather than across two tracks. -->
    <div class="flex flex-col gap-8">
      <Label id="{idPrefix}-repeat-ends-label">Ends</Label>
      <RadioGroup.Root
        aria-labelledby="{idPrefix}-repeat-ends-label"
        value={rule.end.kind}
        onValueChange={(picked) => setEnding(picked as RecurrenceEnd["kind"])}
        {disabled}
      >
        <div class="flex min-h-32 items-center gap-8">
          <RadioGroup.Item value="never" id="{idPrefix}-repeat-ends-never" />
          <Label for="{idPrefix}-repeat-ends-never">Never</Label>
        </div>
        <div class="flex min-h-32 items-center gap-8">
          <RadioGroup.Item value="after" id="{idPrefix}-repeat-ends-after" />
          <Label for="{idPrefix}-repeat-ends-after">After</Label>
          <div class="w-96">
            <Input
              id="{idPrefix}-repeat-count"
              type="number"
              min="1"
              max={MAX_COUNT}
              inputmode="numeric"
              autocomplete="off"
              aria-label="Number of times"
              disabled={disabled || rule.end.kind !== "after"}
              value={rule.end.kind === "after" ? String(rule.end.count) : "12"}
              oninput={(event) => setCount(event.currentTarget.value)}
            />
          </div>
          <span class="text-sm text-text-muted">times</span>
        </div>
        <div class="flex min-h-32 items-center gap-8">
          <RadioGroup.Item value="on" id="{idPrefix}-repeat-ends-on" />
          <Label for="{idPrefix}-repeat-ends-on">On</Label>
          <div class="min-w-0 flex-1">
            <DatePicker
              aria-label="Last day"
              value={endsOnValue}
              onValueChange={setEndDate}
              disabled={disabled || rule.end.kind !== "on"}
            />
          </div>
        </div>
      </RadioGroup.Root>
    </div>

    <!-- What the four controls above add up to, in the words the record pane will use. -->
    <p class="text-xs text-text-muted">Repeats {sentence}. {lastLine}</p>
  {/if}
</div>
