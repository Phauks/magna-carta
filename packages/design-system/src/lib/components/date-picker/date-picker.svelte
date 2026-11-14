<script lang="ts">
  /*
   * DatePicker — a date you TYPE the way you say it, or pick from a calendar (owner-approved
   * data-entry mockup, 2026-11-13). The box is one text input: "Nov 13", "11/13", "today", "fri",
   * "+3" all work (`typed-date.ts` is the one reading of that text), and once the field is left it
   * shows the date in words with its weekday, "Fri, Nov 13, 2026", so a reader can check what they
   * typed landed where they meant. The calendar button opens the month beside it.
   *
   * It replaced a segmented field (one spinbutton per month, day and year), which made a person
   * type in three boxes and tab between them, and showed the date as "11 / 13 / 2026".
   *
   * A refused entry is marked the way every refused field is: the danger edge and `aria-invalid`,
   * the reason on hover, no text under the field. The value does not change until the text names a
   * day the field accepts; Escape puts the last good date back. Up and Down move a day.
   *
   * IT RENDERS TWO SIBLINGS, NOT ONE ELEMENT: the label and the field, with nothing around them. In
   * a flex column that stacks correctly; in a GRID it takes two tracks and the label lands in the
   * next column, so a caller putting one in a grid gives it a wrapper. The label carries its own
   * `margin-block-end`.
   *
   * Values are @internationalized/date CalendarDate (the civil date), never a ZonedDateTime.
   */
  import {
    getLocalTimeZone,
    today as todayIn,
    type CalendarDate,
    type DateValue,
  } from "@internationalized/date";
  import CalendarIcon from "@lucide/svelte/icons/calendar";
  import { tick } from "svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { InputSize } from "../input/variants.ts";
  import Calendar from "../calendar/calendar.svelte";
  import * as Popover from "../popover/index.ts";
  import { formatDateWithWeekday } from "../../formatters/civil-date.ts";
  import { parseTypedDate } from "./typed-date.ts";
  import { dateFieldClasses } from "./variants.ts";

  let {
    value = $bindable(),
    onValueChange,
    label,
    size = "default",
    disabled = false,
    readonly = false,
    required = false,
    minValue,
    maxValue,
    isDateDisabled,
    isDateUnavailable,
    placeholder,
    id,
    name,
    title,
    class: className,
    "aria-label": ariaLabel,
    "aria-invalid": ariaInvalid,
    "aria-describedby": ariaDescribedby,
  }: {
    /** The chosen day, or undefined for none. Bindable. */
    value?: DateValue;
    /** Told every time the day changes, including to none when the box is cleared. */
    onValueChange?: (value: DateValue | undefined) => void;
    /** Visible label above the field; it names the input. */
    label?: string;
    /** Control height, from the same scale the Input and the Button use. */
    size?: InputSize;
    /** Shut: nothing can be typed or picked. */
    disabled?: boolean;
    /** Shown but not changeable. */
    readonly?: boolean;
    /** Marks the input required for assistive technology and the browser. */
    required?: boolean;
    /** The earliest day accepted, typed or picked. */
    minValue?: DateValue;
    /** The latest day accepted, typed or picked. */
    maxValue?: DateValue;
    /** Days the calendar greys and the field refuses. */
    isDateDisabled?: (date: DateValue) => boolean;
    /** Days the calendar marks unavailable and the field refuses. */
    isDateUnavailable?: (date: DateValue) => boolean;
    /** The month the calendar opens on when the field is empty. */
    placeholder?: DateValue;
    /** The input's id; one is minted when omitted. */
    id?: string;
    /** Submits the day as YYYY-MM-DD under this name, through a hidden input. */
    name?: string;
    /** Hover text for the field at rest; a refusal's reason replaces it while it stands. */
    title?: string;
    /** Classes for the field box. */
    class?: string;
    /** Accessible name for a field with no visible label. */
    "aria-label"?: string;
    /** Marks the field refused, for a form that flags its fields together. */
    "aria-invalid"?: "true" | "false" | boolean | undefined;
    /** Points at whatever describes the field. */
    "aria-describedby"?: string;
  } = $props();

  const mintedId = $props.id();
  const inputId = $derived(id ?? `${mintedId}-date`);

  /** The text being typed; null when the box shows the chosen day in words. */
  let draft = $state<string | null>(null);
  /** Why the typed text was refused, or null. */
  let refusal = $state<string | null>(null);
  let calendarOpen = $state(false);
  let fieldBox = $state<HTMLElement | null>(null);
  let input = $state<HTMLInputElement | null>(null);
  let calendar = $state<HTMLElement | null>(null);

  const shown = $derived(draft ?? (value === undefined ? "" : formatDateWithWeekday(value.toString())));
  const invalid = $derived(refusal !== null || ariaInvalid === true || ariaInvalid === "true");

  function today(): CalendarDate {
    return todayIn(getLocalTimeZone());
  }

  /** Why a real day is still not accepted here, or null when it is. */
  function refusalOf(day: DateValue): string | null {
    if (minValue !== undefined && day.compare(minValue) < 0) {
      return `The earliest date allowed is ${formatDateWithWeekday(minValue.toString())}.`;
    }
    if (maxValue !== undefined && day.compare(maxValue) > 0) {
      return `The latest date allowed is ${formatDateWithWeekday(maxValue.toString())}.`;
    }
    if (isDateDisabled?.(day) || isDateUnavailable?.(day)) return "That date cannot be chosen here.";
    return null;
  }

  function choose(day: DateValue | undefined): void {
    draft = null;
    refusal = null;
    const changed =
      day === undefined || value === undefined ? day !== value : day.compare(value) !== 0;
    if (!changed) return;
    value = day;
    onValueChange?.(day);
  }

  /** Reads what was typed; a refusal keeps the text so it can be corrected. */
  function commit(): void {
    if (draft === null) return;
    if (draft.trim() === "") {
      choose(undefined);
      return;
    }
    const day = parseTypedDate(draft, today());
    if (day === null) {
      refusal = "Not a date. Try Nov 13, 11/13/2026, today or fri.";
      return;
    }
    const reason = refusalOf(day);
    if (reason !== null) {
      refusal = reason;
      return;
    }
    choose(day);
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      if (draft !== null) {
        event.preventDefault();
        commit();
      }
      return;
    }
    if (event.key === "Escape" && (draft !== null || refusal !== null)) {
      event.preventDefault();
      event.stopPropagation();
      draft = null;
      refusal = null;
      return;
    }
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !readonly) {
      event.preventDefault();
      const from = draft === null ? value : (parseTypedDate(draft, today()) ?? value);
      const next = (from ?? today()).add({ days: event.key === "ArrowUp" ? 1 : -1 });
      if (refusalOf(next) === null) choose(next);
    }
  }

  /** The chosen day, else today, else the month's first day: where arrow keys should start. */
  async function focusDay(): Promise<void> {
    await tick();
    const day =
      calendar?.querySelector<HTMLElement>("[data-bits-day][data-selected]") ??
      calendar?.querySelector<HTMLElement>("[data-bits-day][data-today]:not([data-outside-month])") ??
      calendar?.querySelector<HTMLElement>("[data-bits-day]:not([data-outside-month])");
    day?.focus();
  }

  async function pick(day: DateValue | undefined): Promise<void> {
    if (day === undefined) return;
    choose(day);
    calendarOpen = false;
    await tick();
    input?.focus();
  }
</script>

{#if label}
  <label for={inputId} class="mc-date-field-label">{label}</label>
{/if}
<div
  bind:this={fieldBox}
  class={mergeClasses(dateFieldClasses({ size }), className)}
  data-disabled={disabled ? "" : undefined}
  data-invalid={invalid ? "" : undefined}
>
  <input
    bind:this={input}
    id={inputId}
    class="mc-date-field-input"
    type="text"
    inputmode="text"
    autocomplete="off"
    spellcheck="false"
    value={shown}
    {disabled}
    {readonly}
    {required}
    aria-label={label ? undefined : ariaLabel}
    aria-invalid={invalid ? "true" : undefined}
    aria-describedby={ariaDescribedby}
    title={refusal ?? title ?? "Type a date, such as Nov 13, 11/13 or today, or pick one."}
    oninput={(event) => {
      draft = event.currentTarget.value;
      refusal = null;
    }}
    onblur={commit}
    {onkeydown}
  />
  {#if name}
    <input type="hidden" {name} value={value?.toString() ?? ""} />
  {/if}
  <Popover.Root bind:open={calendarOpen}>
    <Popover.Trigger
      class="mc-date-field-trigger"
      aria-label="Open calendar"
      disabled={disabled || readonly}
    >
      <CalendarIcon class="mc-date-field-trigger-icon" aria-hidden="true" />
    </Popover.Trigger>
    <!-- Start-aligned: the month opens under the field it fills, which sits at the start of its row
         far more often than at the end. The popover's own first-focus would land on the Previous arrow; the calendar puts focus
         on the chosen day (or today) instead, which is where arrow keys should start. -->
    <Popover.Content
      customAnchor={fieldBox}
      align="start"
      class="mc-date-picker-content"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        void focusDay();
      }}
    >
      <Calendar
        bind:ref={calendar}
        type="single"
        class="border-0 bg-transparent p-0"
        value={value as never}
        onValueChange={(next) => pick(next as DateValue | undefined)}
        placeholder={(value ?? placeholder) as never}
        {minValue}
        {maxValue}
        {isDateDisabled}
        {isDateUnavailable}
      />
    </Popover.Content>
  </Popover.Root>
</div>
