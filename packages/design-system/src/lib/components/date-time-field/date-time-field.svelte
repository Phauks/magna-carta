<script lang="ts">
  /*
   * DateTimeField — one field for a moment: a day, a time of day, or both (owner, 2026-11-10).
   *
   * The field is one bordered box. The day and the time are typed into it as segments (Bits' date
   * and time fields, so every part is a spinbutton with the keyboard and the a11y Bits owns), and
   * the button at its end opens ONE panel: the month on the left and a list of times on the right.
   * A day and the hour on it are one fact, so they are asked in one control and chosen in one
   * panel, rather than a date picker beside a browser time box that looked like neither.
   *
   * `mode` is the shape: `date` is the field and the month alone, `time` the field and the list
   * alone, `date-time` both. Picking a day in `date` mode closes the panel; in `date-time` mode it
   * stays open for the time, and picking a time closes it.
   *
   * THE LIST IS A SHORTCUT, NEVER A CONSTRAINT. It offers every `timeStep` minutes, but the segments
   * take any minute, and a time off the step is put into the list in its place so the list always
   * shows what the field holds (time-choices.ts). Given `durationFrom` — an end on the same day as
   * its start — the list starts after that time and says how long each choice runs.
   *
   * NO TIME IS AN ANSWER, where the caller allows it. `allowNoTime` puts a row above the times
   * (`noTimeLabel`, "No time" by default); choosing it sets the bindable `noTime`, clears the time,
   * and the field reads the label where the time segments were. Choosing a time sets it back. A
   * record that stores an empty time for "all day" binds this rather than keeping a checkbox beside
   * the field.
   *
   * Values: `date` is an `@internationalized/date` DateValue (a CalendarDate, the civil date — the
   * date family's own rule); `time` is the stored wall-clock shape `HH:MM`, or empty. The time is
   * never a ZonedDateTime: the zone it is read in is the record's, and `zoneLabel` only prints its
   * shortcode beside the hour.
   */
  import { DateField as DateFieldPrimitive, TimeField as TimeFieldPrimitive } from "bits-ui";
  import { Time, type DateValue } from "@internationalized/date";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { tick } from "svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { formatWallClockTime } from "../../formatters/wall-clock.ts";
  import type { InputSize } from "../input/variants.ts";
  import { dateFieldClasses } from "../date-picker/variants.ts";
  import { Calendar } from "../calendar/index.ts";
  import * as Popover from "../popover/index.ts";
  import {
    DEFAULT_TIME_STEP_MINUTES,
    minuteOfDay,
    spanLabel,
    timeChoices,
    timeOfMinute,
  } from "./time-choices.ts";

  type DateTimeFieldMode = "date" | "time" | "date-time";

  let {
    mode = "date-time",
    date,
    onDateChange,
    time = $bindable(""),
    noTime = $bindable(false),
    allowNoTime = false,
    noTimeLabel = "No time",
    timeStep = DEFAULT_TIME_STEP_MINUTES,
    durationFrom,
    zoneLabel,
    label,
    id,
    size = "default",
    disabled = false,
    placeholder,
    minValue,
    maxValue,
    locale,
    class: className,
    "aria-invalid": ariaInvalid,
  }: {
    /** Which parts the field asks for: the day, the time of day, or both. */
    mode?: DateTimeFieldMode;
    /** The day chosen, as a civil date. */
    date?: DateValue | undefined;
    /** Called with the day whenever it changes, by typing or from the month. */
    onDateChange?: (next: DateValue | undefined) => void;
    /** The time chosen, `HH:MM`, or empty. Bindable. */
    time?: string;
    /** Whether "no time" is the answer. Bindable; only meaningful with `allowNoTime`. */
    noTime?: boolean;
    /** Offer a "no time" row above the times, for a record whose day may have no hour. */
    allowNoTime?: boolean;
    /** What the "no time" row and the field say when it is chosen: "All day" on an event. */
    noTimeLabel?: string;
    /** Minutes between the times the list offers. Any minute can still be typed. */
    timeStep?: number;
    /** An `HH:MM` start this time is measured from: the list begins after it and shows durations. */
    durationFrom?: string;
    /** The zone's shortcode on the record's day, printed beside the time ("PST"). */
    zoneLabel?: string;
    /** The visible label above the field. */
    label?: string;
    /** The id the field's first segment group takes, for a `<Label for>` outside it. */
    id?: string;
    /** Control height, from the Input's own scale. */
    size?: InputSize;
    /** Holds every part of the field still. */
    disabled?: boolean;
    /** The month the panel opens on when no day is chosen yet. */
    placeholder?: DateValue;
    /** The earliest day that can be chosen. */
    minValue?: DateValue;
    /** The latest day that can be chosen. */
    maxValue?: DateValue;
    /** BCP 47 locale for the segments, the month and the times; the runtime's own when omitted. */
    locale?: string;
    /** Extra classes for the bordered field box. */
    class?: string;
    /** Marks the field refused, for a form that flags its fields together. */
    "aria-invalid"?: "true" | "false" | undefined;
  } = $props();

  const generatedId = $props.id();
  const labelId = `${generatedId}-label`;
  const showsDate = $derived(mode !== "time");
  const showsTime = $derived(mode !== "date");
  const timeIsAbsent = $derived(showsTime && allowNoTime && noTime);

  let open = $state(false);
  let fieldElement = $state<HTMLElement | null>(null);
  let listElement = $state<HTMLElement | null>(null);
  let panelElement = $state<HTMLElement | null>(null);

  const timeValue = $derived.by(() => {
    const minute = minuteOfDay(time);
    return minute === null ? undefined : new Time(Math.floor(minute / 60), minute % 60);
  });

  const choices = $derived(
    timeChoices({
      step: timeStep,
      selected: noTime ? undefined : time,
      from: durationFrom === "" ? undefined : durationFrom,
    }),
  );

  function chooseDate(next: DateValue | undefined): void {
    onDateChange?.(next);
    if (mode === "date" && next !== undefined) open = false;
  }

  function chooseTime(next: string): void {
    time = next;
    noTime = false;
    open = false;
  }

  function chooseNoTime(): void {
    time = "";
    noTime = true;
    open = false;
  }

  function typedTime(next: Time | undefined): void {
    time = next === undefined ? "" : timeOfMinute(next.hour * 60 + next.minute);
    if (next !== undefined) noTime = false;
  }

  /*
   * The panel opens with focus on the answer the field already holds — the chosen day, or failing
   * that the chosen time — rather than on the first control in it, which is the month heading and
   * reads as though the month were the question. With no answer yet, the panel's own first control
   * takes focus, which is the primitive's default.
   */
  function focusTheAnswer(event: Event): void {
    const panel = panelElement;
    if (panel === null) return;
    const answer =
      panel.querySelector<HTMLElement>("[data-selected][data-bits-day]") ??
      panel.querySelector<HTMLElement>('.mc-date-time-field-time[aria-current="true"]');
    if (answer === null) return;
    event.preventDefault();
    answer.focus({ preventScroll: true });
  }

  /*
   * The list opens on the time the field holds rather than on midnight: a reader looking for the
   * afternoon should not have to scroll past the night. Scrolled within the list alone, so the page
   * under the panel never moves.
   */
  $effect(() => {
    if (!open) return;
    void tick().then(() => {
      if (listElement === null) return;
      const current = listElement.querySelector<HTMLElement>('[aria-current="true"]');
      if (current === null) return;
      listElement.scrollTop =
        current.offsetTop - listElement.clientHeight / 2 + current.clientHeight / 2;
    });
  });
</script>

<div class="mc-date-time-field-stack">
  {#if label}
    <span id={labelId} class="mc-date-field-label">{label}</span>
  {/if}
  <Popover.Root bind:open>
    <div
      bind:this={fieldElement}
      class={mergeClasses(dateFieldClasses({ size }), "mc-date-time-field", className)}
      data-disabled={disabled ? "" : undefined}
    >
      {#if showsDate}
        <DateFieldPrimitive.Root value={date} onValueChange={chooseDate} {disabled} {placeholder} {minValue} {maxValue} {locale}>
          <DateFieldPrimitive.Input
            id={id}
            aria-labelledby={label ? labelId : undefined}
            aria-label={label ? undefined : "Date"}
            aria-invalid={ariaInvalid}
            class="mc-date-time-field-part"
          >
            {#snippet children({ segments })}
              {#each segments as segment, segmentIndex (segmentIndex)}
                <DateFieldPrimitive.Segment part={segment.part} class="mc-date-field-segment">
                  {segment.value}
                </DateFieldPrimitive.Segment>
              {/each}
            {/snippet}
          </DateFieldPrimitive.Input>
        </DateFieldPrimitive.Root>
      {/if}
      {#if showsDate && showsTime}
        <span class="mc-date-time-field-separator" aria-hidden="true">·</span>
      {/if}
      {#if timeIsAbsent}
        <span class="mc-date-time-field-absent">{noTimeLabel}</span>
      {:else if showsTime}
        <TimeFieldPrimitive.Root value={timeValue} onValueChange={typedTime} {disabled} {locale} granularity="minute">
          <TimeFieldPrimitive.Input
            id={showsDate ? undefined : id}
            aria-label={label ? `${label}, time` : "Time"}
            aria-invalid={ariaInvalid}
            class="mc-date-time-field-part"
          >
            {#snippet children({ segments })}
              {#each segments as segment, segmentIndex (segmentIndex)}
                <TimeFieldPrimitive.Segment part={segment.part} class="mc-date-field-segment">
                  {segment.value}
                </TimeFieldPrimitive.Segment>
              {/each}
            {/snippet}
          </TimeFieldPrimitive.Input>
        </TimeFieldPrimitive.Root>
        {#if zoneLabel}
          <span class="mc-date-time-field-zone">{zoneLabel}</span>
        {/if}
      {/if}
      <Popover.Trigger
        class="mc-date-field-trigger"
        {disabled}
        aria-label={mode === "time" ? "Choose a time" : mode === "date" ? "Open calendar" : "Choose a day and time"}
      >
        <ChevronDown class="mc-date-field-trigger-icon" aria-hidden="true" />
      </Popover.Trigger>
    </div>
    <Popover.Content
      customAnchor={fieldElement}
      align="start"
      class="w-auto"
      onOpenAutoFocus={focusTheAnswer}
    >
      <div bind:this={panelElement} class="mc-date-time-field-panel">
        {#if showsDate}
          <Calendar
            type="single"
            density="compact"
            value={date}
            onValueChange={(next: DateValue | undefined) => chooseDate(next)}
            placeholder={date ?? placeholder}
            {minValue}
            {maxValue}
            {locale}
          />
        {/if}
        {#if showsTime}
          <div bind:this={listElement} class="mc-date-time-field-times mc-scrollbar" role="group" aria-label="Times">
            {#if allowNoTime}
              <button
                type="button"
                class="mc-date-time-field-time mc-date-time-field-time-none"
                aria-current={noTime ? "true" : undefined}
                onclick={chooseNoTime}
              >
                {noTimeLabel}
              </button>
            {/if}
            {#each choices as choice (choice.minuteOfDay)}
              <button
                type="button"
                class="mc-date-time-field-time"
                aria-current={!noTime && choice.time === time ? "true" : undefined}
                onclick={() => chooseTime(choice.time)}
              >
                {formatWallClockTime(choice.time, { locale })}
                {#if choice.minutesAfter !== null}
                  <span class="mc-date-time-field-time-span">{spanLabel(choice.minutesAfter)}</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </Popover.Content>
  </Popover.Root>
</div>
